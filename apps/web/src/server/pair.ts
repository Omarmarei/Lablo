/**
 * The pairing relay (architecture.md §3.2 and §3.3 A; RELAY step 31a). The TV registers its
 * ephemeral public key and shows a code; the phone seals a source to that key and posts it; the
 * TV polls, reads it once and reports a category back for the phone to show.
 *
 * **The server only ever holds ciphertext and hashes:** the sealed payload (until the TV reads
 * it: the read deletes it in the same statement), the TV's public key, the code's and the poll
 * token's SHA-256, the category, and an encrypted file in the blob store (deleted when the TV
 * reports, or with the row). The code and the token exist in plain only in the answer to the TV.
 *
 * - The code lives `PAIR_CODE_TTL_MS`; a payload or an upload after it is refused. A payload
 *   posted in time stays readable, and the phone's progress too, until the row goes,
 *   `PAIR_ROW_TTL_MS` after it was made (each new pairing sweeps the old rows and their blobs).
 * - Every route is rate-limited per caller address, through `rateKey` (never the address).
 * - The TV's routes (`createPair`, `pollPair`, `pairStatus`, `pairFileUrl`) answer any origin;
 *   the phone's are same-origin only.
 * - A session has a purpose (RELAY step 38c4): an add, or the PIN's login check (`purpose:
 *   'check'`, kept in the row), which the typed code's key answer gives the phone page and which
 *   decides the statuses the TV may report (`pairStatusFits`).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256, toBase64Url, tokenHash, utf8 } from '@lablo/crypto';
import type {
  PairCreateResponse,
  PairFileUrlResponse,
  PairPollResponse,
  PairProgressResponse,
  PairPurpose,
  PairStatus,
  PairTvKeyResponse,
  PairUploadResponse,
  SealedPayloadWire,
} from '@lablo/protocol';
import {
  bytes16,
  PAIR_BODY_MAX_BYTES,
  pairCode,
  pairCreateRequestSchema,
  pairStatusFits,
  pairStatusRequestSchema,
  pairUploadRequestSchema,
  sealedPayloadSchema,
} from '@lablo/protocol';
import type { PairSession, PrismaClient } from '../generated/prisma/client';
import type { BlobStore } from './blob-store';
import { db } from './db';
import { errorKind } from './health';
import { apiError, bearerToken, clientIp, json, readBody, TV_CORS } from './http';
import type { RateLimiter, RateRule } from './rate-limit';
import { rateKey, retryAfterSeconds } from './rate-limit';
import { services } from './services';

/** How long a code works: the TV shows a new one before then. */
export const PAIR_CODE_TTL_MS = 600_000;
/** How long a row lives, from when it was made (architecture.md §3.2 "Retention"). */
export const PAIR_ROW_TTL_MS = 3_600_000;
/** How long a presigned upload or download URL works. */
export const PAIR_URL_TTL_MS = 600_000;
/** The cap on every body but the payload's (`PAIR_BODY_MAX_BYTES`). */
export const PAIR_SMALL_BODY_BYTES = 1024;
/** How many codes `createPair` tries when one is taken. */
export const PAIR_CREATE_ATTEMPTS = 3;

const WINDOW_MS = 600_000;

/** Each route's rate limit per caller: its scope and rule. */
export const PAIR_LIMITS: Readonly<Record<'create' | 'code' | 'phone' | 'tv', { readonly scope: string; readonly rule: RateRule }>> = {
  /** Making codes (the TV). */
  create: { scope: 'pair-new', rule: { limit: 20, windowMs: WINDOW_MS } },
  /** Anything that names a code once: a typed code's key, the payload, the upload. Each is a guess. */
  code: { scope: 'pair-code', rule: { limit: 30, windowMs: WINDOW_MS } },
  /** The phone's progress, every 2 s for 10 minutes at most. */
  phone: { scope: 'pair-phone', rule: { limit: 400, windowMs: WINDOW_MS } },
  /** The TV's poll every 2 s, its status and its file. */
  tv: { scope: 'pair-tv', rule: { limit: 400, windowMs: WINDOW_MS } },
};

/** Crockford's base32 (no I, L, O, U): the code's alphabet. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface PairDeps {
  readonly db: PrismaClient;
  readonly blobs: BlobStore;
  readonly limiter: RateLimiter;
  readonly rateSecret: string;
  readonly now: () => number;
  readonly random: (bytes: number) => Uint8Array;
}

/** The 8-character code of 5 random bytes: 40 bits, 5 to a character. */
export function newPairCode(bytes: Uint8Array): string {
  if (bytes.length !== 5) throw new RangeError('a pairing code takes 5 random bytes');
  let code = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      code += CROCKFORD[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return code;
}

/** What the row keeps of a code: b64url(SHA-256(its characters)). */
export function codeHash(code: string): string {
  return toBase64Url(sha256(utf8(code)));
}

/** The blob of a session's file. */
export function pairBlobKey(sid: string, fileId: string): string {
  return `pair/${sid}/${fileId}`;
}

/** Two stored hashes compared in constant time. */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isUniqueClash(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** Counts the request against the caller's limit: null to go ahead, else the 429 answer. */
async function limited(deps: PairDeps, request: Request, which: keyof typeof PAIR_LIMITS, headers?: Readonly<Record<string, string>>): Promise<Response | null> {
  const { scope, rule } = PAIR_LIMITS[which];
  const decision = await deps.limiter.limit(rateKey(scope, clientIp(request.headers), deps.rateSecret), rule);
  return decision.ok ? null : apiError(429, 'rate_limited', { ...headers, 'retry-after': retryAfterSeconds(decision) });
}

/** The row of a well-formed code, or null. */
async function codeRow(deps: PairDeps, code: string): Promise<PairSession | null> {
  if (!pairCode.safeParse(code).success) return null;
  return deps.db.pairSession.findUnique({ where: { codeHash: codeHash(code) } });
}

/** A row's purpose: `check` as kept, else an add (step 38c4). */
function purposeOf(row: PairSession): PairPurpose {
  return row.purpose === 'check' ? 'check' : 'add';
}

/** The phone has sent its payload (the TV may have read it since). */
function sent(row: PairSession): boolean {
  return row.payload !== null || row.deliveredAt !== null;
}

/** Why a code's write found no row to change: 404 for no code (or one past its time), else 409. */
async function codeRefusal(deps: PairDeps, code: string, now: number): Promise<Response> {
  const row = await codeRow(deps, code);
  return row === null || (!sent(row) && row.expiresAt.getTime() <= now) ? apiError(404, 'not_found') : apiError(409, 'conflict');
}

/** Deletes the rows made `PAIR_ROW_TTL_MS` or more ago, and their blobs. How many went. */
export async function sweepPairs(deps: PairDeps, now: number): Promise<number> {
  // A row's code ends PAIR_CODE_TTL_MS after it is made: the index on expiresAt finds them.
  const cutoff = new Date(now - (PAIR_ROW_TTL_MS - PAIR_CODE_TTL_MS));
  const withFiles = await deps.db.pairSession.findMany({ where: { expiresAt: { lte: cutoff }, fileId: { not: null } }, select: { id: true, fileId: true } });
  for (const row of withFiles) await deps.blobs.delete(pairBlobKey(row.id, row.fileId!));
  const { count } = await deps.db.pairSession.deleteMany({ where: { expiresAt: { lte: cutoff } } });
  return count;
}

/** `POST /v1/pair`: the TV's key in; the session id, the code, the poll token and the code's end out. */
export async function createPair(deps: PairDeps, request: Request): Promise<Response> {
  const refused = await limited(deps, request, 'create', TV_CORS);
  if (refused !== null) return refused;
  const body = await readBody(request, PAIR_SMALL_BODY_BYTES, pairCreateRequestSchema, TV_CORS);
  if (!body.ok) return body.response;
  const now = deps.now();
  await sweepPairs(deps, now);
  for (let attempt = 1; ; attempt++) {
    const sid = toBase64Url(deps.random(16));
    const code = newPairCode(deps.random(5));
    const pollToken = toBase64Url(deps.random(32));
    const exp = now + PAIR_CODE_TTL_MS;
    try {
      await deps.db.pairSession.create({
        data: {
          id: sid,
          codeHash: codeHash(code),
          tvPk: body.value.tvPk,
          pollTokenHash: tokenHash(pollToken)!,
          createdAt: new Date(now),
          expiresAt: new Date(exp),
          // Only a check is kept (step 38c4): null is an add.
          purpose: body.value.purpose === 'check' ? 'check' : null,
        },
      });
    } catch (error) {
      // Another live (or unswept) session has this code: make another.
      if (attempt < PAIR_CREATE_ATTEMPTS && isUniqueClash(error)) continue;
      throw error;
    }
    const answer: PairCreateResponse = { sid, code, pollToken, exp };
    return json(answer, 201, TV_CORS);
  }
}

/** `GET /v1/pair/:code`: the TV's key for a typed code, and the session's purpose, while the code works. */
export async function pairTvKey(deps: PairDeps, request: Request, code: string): Promise<Response> {
  const refused = await limited(deps, request, 'code');
  if (refused !== null) return refused;
  const row = await codeRow(deps, code);
  if (row === null || row.expiresAt.getTime() <= deps.now()) return apiError(404, 'not_found');
  const answer: PairTvKeyResponse = { tvPk: row.tvPk, exp: row.expiresAt.getTime(), purpose: purposeOf(row) };
  return json(answer);
}

/** `POST /v1/pair/:code/payload`: the sealed payload, once, while the code works. */
export async function postPairPayload(deps: PairDeps, request: Request, code: string): Promise<Response> {
  const refused = await limited(deps, request, 'code');
  if (refused !== null) return refused;
  if (!pairCode.safeParse(code).success) return apiError(404, 'not_found');
  const body = await readBody(request, PAIR_BODY_MAX_BYTES, sealedPayloadSchema);
  if (!body.ok) return body.response;
  const now = deps.now();
  // Only what the schema read: the phone's key, the nonce and the ciphertext.
  const sealed: SealedPayloadWire = { phonePk: body.value.phonePk, nonce: body.value.nonce, ct: body.value.ct };
  const stored = await deps.db.$queryRaw<{ id: string }[]>`
    UPDATE "PairSession" SET "payload" = ${JSON.stringify(sealed)}::jsonb
    WHERE "codeHash" = ${codeHash(code)} AND "expiresAt" > ${new Date(now)} AND "payload" IS NULL AND "deliveredAt" IS NULL
    RETURNING "id"`;
  if (stored.length !== 1) return codeRefusal(deps, code, now);
  const answer: PairProgressResponse = { state: 'sent' };
  return json(answer);
}

/**
 * `POST /v1/pair/:code/upload-url`: a presigned PUT for the encrypted file (its exact size), before
 * the payload. Asking again replaces the session's file (the earlier blob is deleted).
 */
export async function pairUploadUrl(deps: PairDeps, request: Request, code: string): Promise<Response> {
  const refused = await limited(deps, request, 'code');
  if (refused !== null) return refused;
  if (!pairCode.safeParse(code).success) return apiError(404, 'not_found');
  const body = await readBody(request, PAIR_SMALL_BODY_BYTES, pairUploadRequestSchema);
  if (!body.ok) return body.response;
  const now = deps.now();
  const fileId = toBase64Url(deps.random(16));
  const rows = await deps.db.$queryRaw<{ id: string; oldFileId: string | null }[]>`
    UPDATE "PairSession" AS p SET "fileId" = ${fileId}
    FROM (SELECT "id", "fileId" FROM "PairSession" WHERE "codeHash" = ${codeHash(code)} FOR UPDATE) AS old
    WHERE p."id" = old."id" AND p."payload" IS NULL AND p."deliveredAt" IS NULL AND p."expiresAt" > ${new Date(now)}
    RETURNING p."id" AS "id", old."fileId" AS "oldFileId"`;
  const row = rows[0];
  if (row === undefined) return codeRefusal(deps, code, now);
  if (row.oldFileId !== null) await deps.blobs.delete(pairBlobKey(row.id, row.oldFileId));
  const put = await deps.blobs.presignPut(pairBlobKey(row.id, fileId), body.value.size, PAIR_URL_TTL_MS);
  const answer: PairUploadResponse = { url: put.url, key: fileId, exp: put.expiresAt };
  return json(answer);
}

/** `GET /v1/pair/:code/status`: how far the phone's payload got. */
export async function pairProgress(deps: PairDeps, request: Request, code: string): Promise<Response> {
  const refused = await limited(deps, request, 'phone');
  if (refused !== null) return refused;
  const row = await codeRow(deps, code);
  if (row === null) return apiError(404, 'not_found');
  let answer: PairProgressResponse;
  if (row.status !== null) answer = { state: 'done', status: row.status as PairStatus };
  else if (row.deliveredAt !== null) answer = { state: 'received' };
  else if (row.payload !== null) answer = { state: 'sent' };
  else if (row.expiresAt.getTime() > deps.now()) answer = { state: 'open', exp: row.expiresAt.getTime() };
  else return apiError(404, 'not_found');
  return json(answer);
}

/** The TV's session, by its id and poll token: the row, or the 404 or 401 answer. */
async function tvSession(deps: PairDeps, request: Request, sid: string): Promise<{ readonly row: PairSession } | { readonly response: Response }> {
  if (!bytes16.safeParse(sid).success) return { response: apiError(404, 'not_found', TV_CORS) };
  const token = bearerToken(request.headers);
  const hash = token === null ? null : tokenHash(token);
  if (hash === null) return { response: apiError(401, 'unauthorized', TV_CORS) };
  const row = await deps.db.pairSession.findUnique({ where: { id: sid } });
  if (row === null) return { response: apiError(404, 'not_found', TV_CORS) };
  if (!sameHash(hash, row.pollTokenHash)) return { response: apiError(401, 'unauthorized', TV_CORS) };
  return { row };
}

/**
 * `GET /v1/pair/s/:sid`: `waiting` until the phone sends, then `ready` with the payload once (the
 * read deletes it), then 409; 410 when the code ended with nothing sent.
 */
export async function pollPair(deps: PairDeps, request: Request, sid: string): Promise<Response> {
  const refused = await limited(deps, request, 'tv', TV_CORS);
  if (refused !== null) return refused;
  const session = await tvSession(deps, request, sid);
  if ('response' in session) return session.response;
  const now = deps.now();
  const read = await deps.db.$queryRaw<{ payload: SealedPayloadWire }[]>`
    UPDATE "PairSession" AS p SET "payload" = NULL, "deliveredAt" = ${new Date(now)}
    FROM (SELECT "id", "payload" FROM "PairSession" WHERE "id" = ${sid} AND "payload" IS NOT NULL FOR UPDATE) AS old
    WHERE p."id" = old."id"
    RETURNING old."payload" AS "payload"`;
  const first = read[0];
  if (first !== undefined) {
    const answer: PairPollResponse = { state: 'ready', payload: first.payload };
    return json(answer, 200, TV_CORS);
  }
  // Read again: another poll may have taken the payload since this one looked.
  const row = await deps.db.pairSession.findUnique({ where: { id: sid } });
  if (row === null) return apiError(404, 'not_found', TV_CORS);
  if (row.deliveredAt !== null) return apiError(409, 'conflict', TV_CORS);
  if (row.expiresAt.getTime() <= now) return apiError(410, 'expired', TV_CORS);
  const answer: PairPollResponse = { state: 'waiting', exp: row.expiresAt.getTime() };
  return json(answer, 200, TV_CORS);
}

/**
 * `POST /v1/pair/s/:sid/status`: the TV's category, once, after its read; the file goes. A status
 * that doesn't fit the session's purpose (step 38c4: a check's for an add, or an add's for a
 * check) is refused, 400, and changes nothing.
 */
export async function pairStatus(deps: PairDeps, request: Request, sid: string): Promise<Response> {
  const refused = await limited(deps, request, 'tv', TV_CORS);
  if (refused !== null) return refused;
  const session = await tvSession(deps, request, sid);
  if ('response' in session) return session.response;
  const body = await readBody(request, PAIR_SMALL_BODY_BYTES, pairStatusRequestSchema, TV_CORS);
  if (!body.ok) return body.response;
  // The purpose is set when the row is made and never changes: the row read above decides.
  if (!pairStatusFits(purposeOf(session.row), body.value.status)) return apiError(400, 'bad_request', TV_CORS);
  const done = await deps.db.$queryRaw<{ fileId: string | null }[]>`
    UPDATE "PairSession" AS p SET "status" = ${body.value.status}, "fileId" = NULL
    FROM (SELECT "id", "fileId" FROM "PairSession" WHERE "id" = ${sid} FOR UPDATE) AS old
    WHERE p."id" = old."id" AND p."deliveredAt" IS NOT NULL AND p."status" IS NULL
    RETURNING old."fileId" AS "fileId"`;
  const first = done[0];
  if (first === undefined) return apiError(409, 'conflict', TV_CORS);
  if (first.fileId !== null) await deps.blobs.delete(pairBlobKey(sid, first.fileId));
  const answer: PairProgressResponse = { state: 'done', status: body.value.status };
  return json(answer, 200, TV_CORS);
}

/** `GET /v1/pair/s/:sid/file`: a presigned GET of the session's file, after the payload's read. */
export async function pairFileUrl(deps: PairDeps, request: Request, sid: string): Promise<Response> {
  const refused = await limited(deps, request, 'tv', TV_CORS);
  if (refused !== null) return refused;
  const session = await tvSession(deps, request, sid);
  if ('response' in session) return session.response;
  const { row } = session;
  if (row.deliveredAt === null) return apiError(409, 'conflict', TV_CORS);
  if (row.fileId === null) return apiError(404, 'not_found', TV_CORS);
  const get = await deps.blobs.presignGet(pairBlobKey(sid, row.fileId), PAIR_URL_TTL_MS);
  const answer: PairFileUrlResponse = { url: get.url, key: row.fileId, exp: get.expiresAt };
  return json(answer, 200, TV_CORS);
}

/** The process's dependencies: the database, the services, the clock and node's random bytes. */
export function pairDeps(): PairDeps {
  const { blobs, limiter, rateSecret } = services();
  return { db: db(), blobs, limiter, rateSecret, now: Date.now, random: (bytes) => new Uint8Array(randomBytes(bytes)) };
}

/**
 * Runs a route's operation: 503 when the database or a service is missing or fails. Only the
 * error's kind reaches the log (a driver's message can name the host; no body is ever logged).
 */
export async function pairRoute(
  name: string,
  operation: (deps: PairDeps) => Promise<Response>,
  headers?: Readonly<Record<string, string>>,
  deps: () => PairDeps = pairDeps,
): Promise<Response> {
  try {
    return await operation(deps());
  } catch (error) {
    console.error(`pair: ${name} failed (${errorKind(error)})`);
    return apiError(503, 'unavailable', headers);
  }
}
