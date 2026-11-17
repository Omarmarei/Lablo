/**
 * A stand-in for apps/web's pairing API (RELAY step 31c2a; the real one is step 31a's), in memory,
 * for the TV's e2e and the old-engine walk (31c2b): the test's server answers the `/v1/pair`
 * paths through `answer`, on the same origin as its config (`?api=`), so the TV's pair worker
 * fetches it as it fetches the real API. A scripted phone uses the phone's routes over HTTP.
 *
 * The same answers as the real routes, without their database, rate limits or files:
 * - `POST /v1/pair` → 201 `{sid, code, pollToken, exp}` (a code lives `STAND_IN_CODE_MS`);
 * - `GET /v1/pair/:code` → `{tvPk, exp}` while the code works, else 404;
 * - `POST /v1/pair/:code/payload` → `{state: 'sent'}` once, while the code works; 409 after;
 * - `GET /v1/pair/:code/status` → `open`, `sent`, `received` or `done` with the TV's status;
 * - `GET /v1/pair/s/:sid` (the poll token as `Bearer`) → `waiting`, `ready` once (the payload
 *   goes with the read), 409 after it, 410 once the code ended with nothing sent; 401, 404;
 * - `POST /v1/pair/s/:sid/status` → `{state: 'done', status}` once after the read, else 409;
 * - the TV's CORS: any origin, an `OPTIONS` preflight for `authorization` and `content-type`.
 *
 * The test reads what happened (`sessions`) and can end a code at once (`expire`).
 */
import { randomBytes } from 'node:crypto';
import { toBase64Url } from '@lablo/crypto';
import type { PairProgressResponse, PairStatus, SealedPayloadWire } from '@lablo/protocol';
import { pairCode, pairCreateRequestSchema, pairStatusRequestSchema, sealedPayloadSchema } from '@lablo/protocol';

/** How long a code works (the real API's `PAIR_CODE_TTL_MS`). */
export const STAND_IN_CODE_MS = 10 * 60_000;

/** Crockford base32 (no I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface StandInSession {
  readonly sid: string;
  readonly code: string;
  readonly tvPk: string;
  readonly pollToken: string;
  exp: number;
  /** The sealed payload until the TV reads it. */
  payload: SealedPayloadWire | null;
  /** Every payload posted, kept for the test (the real API keeps none after the read). */
  readonly posted: SealedPayloadWire[];
  delivered: boolean;
  status: PairStatus | null;
  /** The TV's polls of this session. */
  polls: number;
}

export interface StandInAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const TV_CORS: Readonly<Record<string, string>> = { 'access-control-allow-origin': '*' };
const PREFLIGHT: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
};

function json(status: number, value: unknown, cors = true): StandInAnswer {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (cors) Object.assign(headers, TV_CORS);
  return { status, headers, body: JSON.stringify(value) };
}

function error(status: number, code: string, cors = true): StandInAnswer {
  return json(status, { error: code }, cors);
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
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

export class PairStandIn {
  readonly sessions: StandInSession[] = [];

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

  /** The answer to a `/v1/pair` request; `null` for any other path. */
  answer(method: string, url: string, authorization: string | undefined, body: string): StandInAnswer | null {
    const path = url.split('?')[0]!;
    if (path !== '/v1/pair' && !path.startsWith('/v1/pair/')) return null;
    if (method === 'OPTIONS') return { status: 204, headers: PREFLIGHT, body: '' };
    const parts = path.split('/').slice(3);
    if (path === '/v1/pair' && method === 'POST') return this.create(body);
    if (parts[0] === 's' && parts.length >= 2) {
      const session = this.sessions.find((s) => s.sid === parts[1]);
      if (session === undefined) return error(404, 'not_found');
      if (authorization !== `Bearer ${session.pollToken}`) return error(401, 'unauthorized');
      if (parts.length === 2 && method === 'GET') return this.poll(session);
      if (parts.length === 3 && parts[2] === 'status' && method === 'POST') return this.status(session, body);
      return error(404, 'not_found');
    }
    const code = parts[0] ?? '';
    const session = pairCode.safeParse(code).success ? this.byCode(code) : undefined;
    if (parts.length === 1 && method === 'GET') {
      if (session === undefined || session.exp <= this.now()) return error(404, 'not_found', false);
      return json(200, { tvPk: session.tvPk, exp: session.exp }, false);
    }
    if (parts.length === 2 && parts[1] === 'payload' && method === 'POST') return this.post(session, body);
    if (parts.length === 2 && parts[1] === 'status' && method === 'GET') return this.progress(session);
    return error(404, 'not_found', false);
  }

  private byCode(code: string): StandInSession | undefined {
    for (let i = this.sessions.length - 1; i >= 0; i -= 1) if (this.sessions[i]!.code === code) return this.sessions[i];
    return undefined;
  }

  private create(body: string): StandInAnswer {
    const request = pairCreateRequestSchema.safeParse(parse(body));
    if (!request.success) return error(400, 'bad_request');
    const session: StandInSession = {
      sid: toBase64Url(randomBytes(16)),
      code: newCode(),
      tvPk: request.data.tvPk,
      pollToken: toBase64Url(randomBytes(32)),
      exp: this.now() + STAND_IN_CODE_MS,
      payload: null,
      posted: [],
      delivered: false,
      status: null,
      polls: 0,
    };
    this.sessions.push(session);
    return json(201, { sid: session.sid, code: session.code, pollToken: session.pollToken, exp: session.exp });
  }

  private post(session: StandInSession | undefined, body: string): StandInAnswer {
    if (session === undefined) return error(404, 'not_found', false);
    const sealed = sealedPayloadSchema.safeParse(parse(body));
    if (!sealed.success) return error(400, 'bad_request', false);
    if (session.exp <= this.now() && session.payload === null && !session.delivered) return error(404, 'not_found', false);
    if (session.payload !== null || session.delivered) return error(409, 'conflict', false);
    const payload: SealedPayloadWire = { phonePk: sealed.data.phonePk, nonce: sealed.data.nonce, ct: sealed.data.ct };
    session.payload = payload;
    session.posted.push(payload);
    return json(200, { state: 'sent' }, false);
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

  private status(session: StandInSession, body: string): StandInAnswer {
    const request = pairStatusRequestSchema.safeParse(parse(body));
    if (!request.success) return error(400, 'bad_request');
    if (!session.delivered || session.status !== null) return error(409, 'conflict');
    session.status = request.data.status;
    return json(200, { state: 'done', status: session.status });
  }
}
