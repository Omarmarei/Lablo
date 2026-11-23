/**
 * A stand-in for apps/web's pairing API (RELAY step 31c2a; the real one is step 31a's), in memory,
 * for the TV's e2e and the old-engine walk (31c2b): the test's server answers the `/v1/pair`
 * paths and the blob's `/dev/blob` path through `answer`, on the same origin as its config
 * (`?api=`), so the TV's pair worker fetches it as it fetches the real API. A scripted phone uses
 * the phone's routes over HTTP.
 *
 * The same answers as the real routes, without their database or rate limits:
 * - `POST /v1/pair` → 201 `{sid, code, pollToken, exp}` (a code lives `STAND_IN_CODE_MS`), the
 *   session's purpose kept (RELAY step 38c4: `check`, else an add);
 * - `GET /v1/pair/:code` → `{tvPk, exp, purpose}` while the code works, else 404;
 * - `POST /v1/pair/:code/upload-url` `{size}` (RELAY step 31d2b2a) → `{url, key, exp}`, a PUT for
 *   exactly that many bytes, while the code works and nothing was sent; asking again deletes the
 *   earlier file; 404 for an unknown or ended code, 409 once a payload came;
 * - `POST /v1/pair/:code/payload` → `{state: 'sent'}` once, while the code works; 409 after;
 * - `GET /v1/pair/:code/status` → `open`, `sent`, `received` or `done` with the TV's status;
 * - `GET /v1/pair/s/:sid` (the poll token as `Bearer`) → `waiting`, `ready` once (the payload
 *   goes with the read), 409 after it, 410 once the code ended with nothing sent; 401, 404;
 * - `GET /v1/pair/s/:sid/file` (31d2b2a) → the file's GET `{url, key, exp}`; 409 before the
 *   payload's read, 404 with no file;
 * - `POST /v1/pair/s/:sid/status` → `{state: 'done', status}` once after the read, else 409; the
 *   file goes with it; a status that doesn't fit the session's purpose, 400;
 * - the blob (31d2b2a) at development's URL shape, a path on this origin, which the TV resolves
 *   against its API base as it does against `next start`:
 *   `/dev/blob/pair/<sid>/<fileId>?m=PUT|GET&n=<size>&e=<exp>&s=<token>`, honoured only exactly as
 *   given and before `e` (403 otherwise). A PUT takes exactly `n` bytes (400 otherwise); a GET
 *   answers the bytes with CORS `*` and their length, or 404 once they are gone;
 * - the TV's CORS: any origin, an `OPTIONS` preflight for `authorization` and `content-type`.
 *
 * The test reads what happened (`sessions`, `blobs`) and can end a code at once (`expire`).
 */
import { randomBytes } from 'node:crypto';
import { toBase64Url } from '@lablo/crypto';
import type { PairFileUrlResponse, PairProgressResponse, PairPurpose, PairStatus, PairUploadResponse, SealedPayloadWire } from '@lablo/protocol';
import { pairCode, pairCreateRequestSchema, pairStatusFits, pairStatusRequestSchema, pairUploadRequestSchema, sealedPayloadSchema } from '@lablo/protocol';

/** How long a code works (the real API's `PAIR_CODE_TTL_MS`). */
export const STAND_IN_CODE_MS = 10 * 60_000;
/** How long a blob's URL works (the real API's `PAIR_URL_TTL_MS`). */
export const STAND_IN_URL_MS = 10 * 60_000;
/** Where the blob's URLs start (apps/web's `DEV_BLOB_PATH`). */
export const BLOB_PATH = '/dev/blob/';

/** Crockford base32 (no I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface StandInSession {
  readonly sid: string;
  readonly code: string;
  readonly tvPk: string;
  readonly pollToken: string;
  /** Why the TV shows the code (step 38c4). */
  readonly purpose: PairPurpose;
  exp: number;
  /** The sealed payload until the TV reads it. */
  payload: SealedPayloadWire | null;
  /** Every payload posted, kept for the test (the real API keeps none after the read). */
  readonly posted: SealedPayloadWire[];
  delivered: boolean;
  status: PairStatus | null;
  /** The TV's polls of this session. */
  polls: number;
  /** The session's file, while it has one: the blob `pair/<sid>/<fileId>`. */
  fileId: string | null;
  /** Every file uploaded to this session, kept for the test (the real API deletes it with the status). */
  readonly uploads: Uint8Array[];
}

export interface StandInAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

/** A blob URL the stand-in gave: what it may do, until when. */
interface Presigned {
  readonly method: 'PUT' | 'GET';
  readonly key: string;
  readonly size: number | null;
  readonly exp: number;
}

const TV_CORS: Readonly<Record<string, string>> = { 'access-control-allow-origin': '*' };
const PREFLIGHT: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};
const NO_STORE: Readonly<Record<string, string>> = { 'cache-control': 'no-store' };

function json(status: number, value: unknown, cors = true): StandInAnswer {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (cors) Object.assign(headers, TV_CORS);
  return { status, headers, body: JSON.stringify(value) };
}

function error(status: number, code: string, cors = true): StandInAnswer {
  return json(status, { error: code }, cors);
}

/** A blob answer with no body: the TV reads a GET's from any origin, the phone's PUT is its own. */
function emptyBlob(status: number, get: boolean): StandInAnswer {
  return { status, headers: get ? { ...NO_STORE, ...TV_CORS } : NO_STORE, body: '' };
}

function parse(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return undefined;
  }
}

/** A new code: 8 Crockford characters from 40 random bits. */
function newCode(): string {
  const bytes = randomBytes(5);
  let bits = 0;
  let value = 0;
  let code = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      code += CROCKFORD[(value >> bits) & 31];
    }
  }
  return code;
}

/** The path a stand-in answers: the pairing API's or the blob's. */
export function standInPath(url: string): boolean {
  const path = url.split('?')[0]!;
  return path === '/v1/pair' || path.startsWith('/v1/pair/') || path.startsWith(BLOB_PATH);
}

/** The blob of a session's file (apps/web's `pairBlobKey`). */
export const blobKey = (sid: string, fileId: string): string => `pair/${sid}/${fileId}`;

export class PairStandIn {
  readonly sessions: StandInSession[] = [];
  /** The blobs held, by key (`pair/<sid>/<fileId>`): ciphertext only. */
  readonly blobs = new Map<string, Uint8Array>();
  /** The blob URLs given, by their path and query. */
  private readonly presigned = new Map<string, Presigned>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** The newest session (the code on the TV). */
  latest(): StandInSession | undefined {
    return this.sessions[this.sessions.length - 1];
  }

  /** Ends `code` now: the TV's poll answers 410 when nothing was sent. */
  expire(code: string): void {
    const session = this.byCode(code);
    if (session !== undefined) session.exp = this.now() - 1;
  }

  /** The answer to a `/v1/pair` or `/dev/blob` request; `null` for any other path. */
  answer(method: string, url: string, authorization: string | undefined, body: Uint8Array): StandInAnswer | null {
    if (!standInPath(url)) return null;
    const path = url.split('?')[0]!;
    if (path.startsWith(BLOB_PATH)) return this.blob(method, url, body);
    if (method === 'OPTIONS') return { status: 204, headers: PREFLIGHT, body: '' };
    const parts = path.split('/').slice(3);
    if (path === '/v1/pair' && method === 'POST') return this.create(body);
    if (parts[0] === 's' && parts.length >= 2) {
      const session = this.sessions.find((s) => s.sid === parts[1]);
      if (session === undefined) return error(404, 'not_found');
      if (authorization !== `Bearer ${session.pollToken}`) return error(401, 'unauthorized');
      if (parts.length === 2 && method === 'GET') return this.poll(session);
      if (parts.length === 3 && parts[2] === 'status' && method === 'POST') return this.status(session, body);
      if (parts.length === 3 && parts[2] === 'file' && method === 'GET') return this.fileUrl(session);
      return error(404, 'not_found');
    }
    const code = parts[0] ?? '';
    const session = pairCode.safeParse(code).success ? this.byCode(code) : undefined;
    if (parts.length === 1 && method === 'GET') {
      if (session === undefined || session.exp <= this.now()) return error(404, 'not_found', false);
      return json(200, { tvPk: session.tvPk, exp: session.exp, purpose: session.purpose }, false);
    }
    if (parts.length === 2 && parts[1] === 'payload' && method === 'POST') return this.post(session, body);
    if (parts.length === 2 && parts[1] === 'upload-url' && method === 'POST') return this.uploadUrl(session, body);
    if (parts.length === 2 && parts[1] === 'status' && method === 'GET') return this.progress(session);
    return error(404, 'not_found', false);
  }

  private byCode(code: string): StandInSession | undefined {
    for (let i = this.sessions.length - 1; i >= 0; i -= 1) if (this.sessions[i]!.code === code) return this.sessions[i];
    return undefined;
  }

  private create(body: Uint8Array): StandInAnswer {
    const request = pairCreateRequestSchema.safeParse(parse(body));
    if (!request.success) return error(400, 'bad_request');
    const session: StandInSession = {
      sid: toBase64Url(randomBytes(16)),
      code: newCode(),
      tvPk: request.data.tvPk,
      pollToken: toBase64Url(randomBytes(32)),
      purpose: request.data.purpose === 'check' ? 'check' : 'add',
      exp: this.now() + STAND_IN_CODE_MS,
      payload: null,
      posted: [],
      delivered: false,
      status: null,
      polls: 0,
      fileId: null,
      uploads: [],
    };
    this.sessions.push(session);
    return json(201, { sid: session.sid, code: session.code, pollToken: session.pollToken, exp: session.exp });
  }

  /** Why the phone's code can't take a payload or a file now: null when it can. */
  private codeRefusal(session: StandInSession | undefined): StandInAnswer | null {
    if (session === undefined) return error(404, 'not_found', false);
    const sent = session.payload !== null || session.delivered;
    if (!sent && session.exp <= this.now()) return error(404, 'not_found', false);
    return sent ? error(409, 'conflict', false) : null;
  }

  private post(session: StandInSession | undefined, body: Uint8Array): StandInAnswer {
    if (session === undefined) return error(404, 'not_found', false);
    const sealed = sealedPayloadSchema.safeParse(parse(body));
    if (!sealed.success) return error(400, 'bad_request', false);
    const refused = this.codeRefusal(session);
    if (refused !== null) return refused;
    const payload: SealedPayloadWire = { phonePk: sealed.data.phonePk, nonce: sealed.data.nonce, ct: sealed.data.ct };
    session.payload = payload;
    session.posted.push(payload);
    return json(200, { state: 'sent' }, false);
  }

  /** The phone's upload: a PUT for exactly `size` bytes; an earlier file of the session is deleted. */
  private uploadUrl(session: StandInSession | undefined, body: Uint8Array): StandInAnswer {
    if (session === undefined) return error(404, 'not_found', false);
    const request = pairUploadRequestSchema.safeParse(parse(body));
    if (!request.success) return error(400, 'bad_request', false);
    const refused = this.codeRefusal(session);
    if (refused !== null) return refused;
    this.dropFile(session);
    session.fileId = toBase64Url(randomBytes(16));
    const put = this.presign('PUT', blobKey(session.sid, session.fileId), request.data.size);
    const answer: PairUploadResponse = { url: put.url, key: session.fileId, exp: put.exp };
    return json(200, answer, false);
  }

  /** The TV's GET of the session's file, once it has read the payload. */
  private fileUrl(session: StandInSession): StandInAnswer {
    if (!session.delivered) return error(409, 'conflict');
    if (session.fileId === null) return error(404, 'not_found');
    const get = this.presign('GET', blobKey(session.sid, session.fileId), null);
    const answer: PairFileUrlResponse = { url: get.url, key: session.fileId, exp: get.exp };
    return json(200, answer);
  }

  private presign(method: 'PUT' | 'GET', key: string, size: number | null): { readonly url: string; readonly exp: number } {
    const exp = this.now() + STAND_IN_URL_MS;
    const url = `${BLOB_PATH}${key}?m=${method}&n=${size ?? ''}&e=${exp}&s=${toBase64Url(randomBytes(16))}`;
    this.presigned.set(url, { method, key, size, exp });
    return { url, exp };
  }

  /** A request to a blob URL: only as the stand-in gave it, for its method, before it ends. */
  private blob(method: string, url: string, body: Uint8Array): StandInAnswer {
    const get = method === 'GET';
    if (!get && method !== 'PUT') return emptyBlob(404, get);
    const signed = this.presigned.get(url);
    if (signed === undefined || signed.method !== method || signed.exp <= this.now()) return emptyBlob(403, get);
    if (!get) {
      if (body.length !== signed.size) return emptyBlob(400, get);
      const bytes = Uint8Array.from(body);
      this.blobs.set(signed.key, bytes);
      this.sessions.find((s) => blobKey(s.sid, s.fileId ?? '') === signed.key)?.uploads.push(bytes);
      return emptyBlob(200, get);
    }
    const bytes = this.blobs.get(signed.key);
    if (bytes === undefined) return emptyBlob(404, get);
    return { status: 200, headers: { ...NO_STORE, ...TV_CORS, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }, body: bytes };
  }

  /** Deletes the session's file, if it has one. */
  private dropFile(session: StandInSession): void {
    if (session.fileId !== null) this.blobs.delete(blobKey(session.sid, session.fileId));
    session.fileId = null;
  }

  private progress(session: StandInSession | undefined): StandInAnswer {
    if (session === undefined) return error(404, 'not_found', false);
    let answer: PairProgressResponse;
    if (session.status !== null) answer = { state: 'done', status: session.status };
    else if (session.delivered) answer = { state: 'received' };
    else if (session.payload !== null) answer = { state: 'sent' };
    else if (session.exp > this.now()) answer = { state: 'open', exp: session.exp };
    else return error(404, 'not_found', false);
    return json(200, answer, false);
  }

  private poll(session: StandInSession): StandInAnswer {
    session.polls += 1;
    if (session.payload !== null) {
      const payload = session.payload;
      session.payload = null;
      session.delivered = true;
      return json(200, { state: 'ready', payload });
    }
    if (session.delivered) return error(409, 'conflict');
    if (session.exp <= this.now()) return error(410, 'expired');
    return json(200, { state: 'waiting', exp: session.exp });
  }

  private status(session: StandInSession, body: Uint8Array): StandInAnswer {
    const request = pairStatusRequestSchema.safeParse(parse(body));
    if (!request.success || !pairStatusFits(session.purpose, request.data.status)) return error(400, 'bad_request');
    if (!session.delivered || session.status !== null) return error(409, 'conflict');
    session.status = request.data.status;
    this.dropFile(session);
    return json(200, { state: 'done', status: session.status });
  }
}
