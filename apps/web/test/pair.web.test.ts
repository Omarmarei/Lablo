import { randomBytes } from 'node:crypto';
import type { BoxKeyPair } from '@lablo/crypto';
import { fromBase64Url, newBoxKeyPair, newFileKey, newFileNonceBase, openFile, openPairPayload, sealFile, sealPairPayload, toBase64Url, tokenHash, utf8 } from '@lablo/crypto';
import type { PairPayload, SealedPayloadWire } from '@lablo/protocol';
import {
  pairCreateResponseSchema,
  pairFileUrlResponseSchema,
  pairPayloadSchema,
  pairPollResponseSchema,
  pairProgressResponseSchema,
  pairTvKeyResponseSchema,
  pairUploadResponseSchema,
} from '@lablo/protocol';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import * as createRoute from '../src/app/v1/pair/route';
import * as keyRoute from '../src/app/v1/pair/[code]/route';
import * as payloadRoute from '../src/app/v1/pair/[code]/payload/route';
import * as progressRoute from '../src/app/v1/pair/[code]/status/route';
import * as uploadRoute from '../src/app/v1/pair/[code]/upload-url/route';
import * as pollRoute from '../src/app/v1/pair/s/[sid]/route';
import * as fileRoute from '../src/app/v1/pair/s/[sid]/file/route';
import * as statusRoute from '../src/app/v1/pair/s/[sid]/status/route';
import type { PrismaClient } from '../src/generated/prisma/client';
import { MemoryBlobStore } from '../src/server/blob-store';
import { createDb } from '../src/server/db';
import type { PairDeps } from '../src/server/pair';
import {
  codeHash,
  createPair,
  PAIR_CODE_TTL_MS,
  PAIR_ROW_TTL_MS,
  PAIR_URL_TTL_MS,
  pairBlobKey,
  pairFileUrl,
  pairProgress,
  pairStatus,
  pairTvKey,
  pairUploadUrl,
  pollPair,
  postPairPayload,
  sweepPairs,
} from '../src/server/pair';
import { MemoryRateLimiter, rateKey } from '../src/server/rate-limit';
import { resetServices, services } from '../src/server/services';

/**
 * The pairing API against a real Postgres (RELAY step 31a): every route's answers, expiry, the poll
 * token, the rate limits, the sweep, and "the server only ever holds ciphertext". The test plays
 * the TV and the phone with `@lablo/crypto`, as the TV app and the phone page will.
 */

const url = inject('databaseUrl');
let client: PrismaClient;
let raw: pg.Client;

const T0 = Date.UTC(2026, 10, 17, 18, 0, 0);
let clock: number;
let blobs: MemoryBlobStore;
let limiter: MemoryRateLimiter;

function deps(changes: Partial<PairDeps> = {}): PairDeps {
  return { db: client, blobs, limiter, rateSecret: 'r'.repeat(32), now: () => clock, random: (n) => new Uint8Array(randomBytes(n)), ...changes };
}

interface Options {
  readonly body?: unknown;
  readonly token?: string;
  readonly ip?: string;
  readonly headers?: Record<string, string>;
}

function request(method: 'GET' | 'POST', path: string, options: Options = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': options.ip ?? '203.0.113.1', ...options.headers };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  return new Request(`http://localhost:3100${path}`, { method, headers, body });
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly cors: string | null;
  readonly cache: string | null;
  readonly retryAfter: string | null;
}

async function answer(response: Response | Promise<Response>): Promise<Answer> {
  const r = await response;
  return {
    status: r.status,
    body: r.status === 204 ? null : await r.json(),
    cors: r.headers.get('access-control-allow-origin'),
    cache: r.headers.get('cache-control'),
    retryAfter: r.headers.get('retry-after'),
  };
}

interface Tv {
  readonly sid: string;
  readonly code: string;
  readonly pollToken: string;
  readonly exp: number;
  readonly keys: BoxKeyPair;
}

async function newTv(d: PairDeps = deps(), ip?: string, purpose?: unknown): Promise<Tv> {
  const keys = newBoxKeyPair();
  const body = purpose === undefined ? { tvPk: toBase64Url(keys.publicKey) } : { tvPk: toBase64Url(keys.publicKey), purpose };
  const made = await answer(createPair(d, request('POST', '/v1/pair', { body, ip })));
  expect(made.status).toBe(201);
  return { ...pairCreateResponseSchema.parse(made.body), keys };
}

const SOURCE: PairPayload = { v: 1, source: { type: 'xtream', server: 'http://panel.example:8080', username: 'u', password: 'p' } };

function seal(tv: Tv, payload: PairPayload = SOURCE): SealedPayloadWire {
  return sealPairPayload(utf8(JSON.stringify(payload)), tv.keys.publicKey);
}

function open(tv: Tv, sealed: SealedPayloadWire): unknown {
  const plain = openPairPayload(sealed, tv.keys.secretKey);
  if (plain === null) throw new Error('the payload does not open');
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}

const send = (tv: Tv, sealed: SealedPayloadWire = seal(tv), ip?: string): Promise<Answer> =>
  answer(postPairPayload(deps(), request('POST', `/v1/pair/${tv.code}/payload`, { body: sealed, ip }), tv.code));
const poll = (tv: Tv, token = tv.pollToken): Promise<Answer> => answer(pollPair(deps(), request('GET', `/v1/pair/s/${tv.sid}`, { token }), tv.sid));
const report = (tv: Tv, status: unknown): Promise<Answer> =>
  answer(pairStatus(deps(), request('POST', `/v1/pair/s/${tv.sid}/status`, { token: tv.pollToken, body: { status } }), tv.sid));
const progress = (tv: Tv, ip?: string): Promise<Answer> => answer(pairProgress(deps(), request('GET', `/v1/pair/${tv.code}/status`, { ip }), tv.code));
const upload = (tv: Tv, size: unknown): Promise<Answer> =>
  answer(pairUploadUrl(deps(), request('POST', `/v1/pair/${tv.code}/upload-url`, { body: { size } }), tv.code));
const fileUrl = (tv: Tv): Promise<Answer> => answer(pairFileUrl(deps(), request('GET', `/v1/pair/s/${tv.sid}/file`, { token: tv.pollToken }), tv.sid));

/** The session's row as Prisma reads it (node-postgres would read its timestamps as local time). */
async function row(sid: string): Promise<Record<string, unknown> | undefined> {
  return (await client.pairSession.findUnique({ where: { id: sid } })) ?? undefined;
}

beforeAll(async () => {
  client = createDb(url);
  raw = new pg.Client({ connectionString: url });
  await raw.connect();
});

afterAll(async () => {
  await client.$disconnect();
  await raw.end();
});

beforeEach(async () => {
  await raw.query('DELETE FROM "PairSession"');
  clock = T0;
  blobs = new MemoryBlobStore({ baseUrl: 'https://blobs.test/dev/blob', now: () => clock });
  limiter = new MemoryRateLimiter({ now: () => clock });
});

afterEach(() => vi.restoreAllMocks());

describe('POST /v1/pair', () => {
  it('makes a session: the code and the token once in the answer, only their hashes in the row', async () => {
    const tv = await newTv();
    expect(tv.exp).toBe(T0 + PAIR_CODE_TTL_MS);
    const saved = await row(tv.sid);
    expect(saved).toStrictEqual({
      id: tv.sid,
      codeHash: codeHash(tv.code),
      tvPk: toBase64Url(tv.keys.publicKey),
      pollTokenHash: tokenHash(tv.pollToken),
      payload: null,
      deliveredAt: null,
      fileId: null,
      status: null,
      purpose: null,
      createdAt: new Date(T0),
      expiresAt: new Date(T0 + PAIR_CODE_TTL_MS),
    });
    expect(JSON.stringify(saved)).not.toContain(tv.code);
    expect(JSON.stringify(saved)).not.toContain(tv.pollToken);
  });

  it("keeps a check's purpose (RELAY step 38c4); an add's, given or not, is null", async () => {
    expect((await row((await newTv(deps(), undefined, 'check')).sid))!.purpose).toBe('check');
    expect((await row((await newTv(deps(), undefined, 'add')).sid))!.purpose).toBeNull();
    const made = await answer(createPair(deps(), request('POST', '/v1/pair', { body: { tvPk: toBase64Url(newBoxKeyPair().publicKey), purpose: 'reset' } })));
    expect(made).toMatchObject({ status: 400, body: { error: 'bad_request' }, cors: '*' });
  });

  it('answers 201 to any origin, never cached', async () => {
    const made = await answer(createPair(deps(), request('POST', '/v1/pair', { body: { tvPk: toBase64Url(newBoxKeyPair().publicKey) } })));
    expect(made).toMatchObject({ status: 201, cors: '*', cache: 'no-store', retryAfter: null });
  });

  it('gives each session its own id, code and token', async () => {
    const a = await newTv();
    const b = await newTv();
    expect([a.sid === b.sid, a.code === b.code, a.pollToken === b.pollToken]).toStrictEqual([false, false, false]);
  });

  it('refuses a body that is not a public key, too large or not JSON (400, 413), with CORS', async () => {
    for (const [body, status] of [
      [{ tvPk: 'short' }, 400],
      [{}, 400],
      ['{"tvPk":', 400],
      [{ tvPk: `${'x'.repeat(42)}w`, pad: 'p'.repeat(1100) }, 413],
    ] as const) {
      expect(await answer(createPair(deps(), request('POST', '/v1/pair', { body })))).toMatchObject({ status, cors: '*' });
    }
    expect((await raw.query('SELECT 1 FROM "PairSession"')).rowCount).toBe(0);
  });

  it('makes another code when one is taken, up to three tries', async () => {
    const taken = await newTv(deps({ random: (n) => new Uint8Array(n).fill(7) }));
    expect(taken.code).toBe(newCodeOf(7));
    // The first try draws the same bytes as the taken session (its id and code clash); the second doesn't.
    let draws = 0;
    const second = await newTv(deps({ random: (n) => new Uint8Array(n).fill(draws++ < 3 ? 7 : 9) }));
    expect(second.code).toBe(newCodeOf(9));
    // Three clashes (a fourth try would find a free code): the error goes up (the route answers 503).
    draws = 0;
    await expect(
      createPair(deps({ random: (n) => new Uint8Array(n).fill(draws++ < 9 ? 7 : 11) }), request('POST', '/v1/pair', { body: { tvPk: toBase64Url(newBoxKeyPair().publicKey) } })),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(draws).toBe(9);
    // A clash on the code alone (a new id) is a clash too.
    draws = 0;
    const third = await newTv(deps({ random: (n) => (n === 5 && draws++ < 1 ? new Uint8Array(5).fill(7) : new Uint8Array(randomBytes(n))) }));
    expect(third.code).not.toBe(newCodeOf(7));
    expect((await raw.query('SELECT 1 FROM "PairSession"')).rowCount).toBe(3);
  });
});

/** The code 5 bytes of `fill` make. */
function newCodeOf(fill: number): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = '';
  for (let i = 0; i < 5; i++) bits += fill.toString(2).padStart(8, '0');
  let code = '';
  for (let i = 0; i < 40; i += 5) code += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  return code;
}

describe('GET /v1/pair/:code', () => {
  it("gives the TV's key and the code's end while the code works, same-origin only", async () => {
    const tv = await newTv();
    const got = await answer(pairTvKey(deps(), request('GET', `/v1/pair/${tv.code}`), tv.code));
    expect(got).toStrictEqual({ status: 200, body: { tvPk: toBase64Url(tv.keys.publicKey), exp: tv.exp, purpose: 'add' }, cors: null, cache: 'no-store', retryAfter: null });
    expect(pairTvKeyResponseSchema.safeParse(got.body).success).toBe(true);
  });

  it("gives a check's purpose (RELAY step 38c4)", async () => {
    const tv = await newTv(deps(), undefined, 'check');
    const got = await answer(pairTvKey(deps(), request('GET', `/v1/pair/${tv.code}`), tv.code));
    expect(got.body).toStrictEqual({ tvPk: toBase64Url(tv.keys.publicKey), exp: tv.exp, purpose: 'check' });
  });

  it('answers 404 for an unknown, malformed or ended code', async () => {
    const tv = await newTv();
    const ask = (code: string): Promise<Answer> => answer(pairTvKey(deps(), request('GET', `/v1/pair/${code}`), code));
    for (const code of [tv.code.toLowerCase(), `${tv.code}0`, tv.code.slice(1), 'IIIIIIII', tv.code === '00000000' ? '11111111' : '00000000']) {
      expect([code, (await ask(code)).status]).toStrictEqual([code, 404]);
    }
    clock = tv.exp - 1;
    expect((await ask(tv.code)).status).toBe(200);
    clock = tv.exp;
    expect(await ask(tv.code)).toMatchObject({ status: 404, body: { error: 'not_found' }, cors: null });
  });
});

describe('POST /v1/pair/:code/payload', () => {
  it('keeps exactly the sealed payload, once', async () => {
    const tv = await newTv();
    const sealed = seal(tv);
    expect(await send(tv, { ...sealed, extra: 'dropped' } as SealedPayloadWire)).toStrictEqual({ status: 200, body: { state: 'sent' }, cors: null, cache: 'no-store', retryAfter: null });
    expect((await row(tv.sid))!.payload).toStrictEqual(sealed);
    expect(await send(tv)).toMatchObject({ status: 409, body: { error: 'conflict' } });
    expect((await row(tv.sid))!.payload).toStrictEqual(sealed);
  });

  it('refuses after the code ends (404), and after the TV read it (409)', async () => {
    const late = await newTv();
    clock = late.exp;
    expect(await send(late)).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect((await row(late.sid))!.payload).toBeNull();
    clock = T0;
    const read = await newTv();
    await send(read);
    clock = read.exp - 1;
    expect((await poll(read)).status).toBe(200);
    expect((await send(read)).status).toBe(409);
    clock = read.exp + 1;
    expect((await send(read)).status).toBe(409);
    clock = T0;
    // Sent in time, then the code ended: still 409 (it was sent), not 404.
    const sentEarly = await newTv();
    await send(sentEarly);
    clock = sentEarly.exp + 1;
    expect((await send(sentEarly)).status).toBe(409);
  });

  it('answers 404 for an unknown or malformed code, before reading the body', async () => {
    const tv = await newTv();
    for (const code of ['ZZZZZZZZ', 'zzzzzzzz', 'ZZZZ']) {
      if (code === tv.code) continue;
      const r = request('POST', `/v1/pair/${code}/payload`, { body: seal(tv) });
      expect((await answer(postPairPayload(deps(), r, code))).status).toBe(404);
      expect(r.bodyUsed).toBe(code === 'ZZZZZZZZ');
    }
  });

  it('takes the largest payload (32 KB of JSON, 43 KB on the wire)', async () => {
    const tv = await newTv();
    const big = sealPairPayload(new Uint8Array(32768).fill(0x20), tv.keys.publicKey);
    expect(JSON.stringify(big).length).toBeGreaterThan(43_000);
    expect((await send(tv, big)).status).toBe(200);
    expect((await row(tv.sid))!.payload).toStrictEqual(big);
  });

  it('refuses a body that is no sealed payload (400) or over 64 KB (413)', async () => {
    const tv = await newTv();
    const sealed = seal(tv);
    for (const [body, status] of [
      [{ ...sealed, phonePk: 'x' }, 400],
      [{ ...sealed, ct: 'c'.repeat(20) }, 400],
      [{ phonePk: sealed.phonePk, nonce: sealed.nonce }, 400],
      ['not json', 400],
      [{ ...sealed, pad: 'p'.repeat(65536) }, 413],
    ] as const) {
      expect([status, (await answer(postPairPayload(deps(), request('POST', `/v1/pair/${tv.code}/payload`, { body }), tv.code))).status]).toStrictEqual([status, status]);
    }
    expect((await row(tv.sid))!.payload).toBeNull();
  });
});

describe('POST /v1/pair/:code/upload-url', () => {
  it('presigns a PUT of exactly the size, for a file the payload names', async () => {
    const tv = await newTv();
    const got = await upload(tv, 100);
    expect(got).toMatchObject({ status: 200, cors: null, cache: 'no-store' });
    const { url: putUrl, key, exp } = pairUploadResponseSchema.parse(got.body);
    expect(exp).toBe(T0 + PAIR_URL_TTL_MS);
    expect((await row(tv.sid))!.fileId).toBe(key);
    expect(putUrl.startsWith(`https://blobs.test/dev/blob/${pairBlobKey(tv.sid, key)}?`)).toBe(true);
    expect((await blobs.redeem('PUT', putUrl, new Uint8Array(99))).status).toBe(400);
    expect((await blobs.redeem('PUT', putUrl, new Uint8Array(100).fill(1))).status).toBe(200);
    expect(await blobs.get(pairBlobKey(tv.sid, key))).toStrictEqual(new Uint8Array(100).fill(1));
  });

  it('replaces the session’s file when asked again, deleting the earlier blob', async () => {
    const tv = await newTv();
    const first = pairUploadResponseSchema.parse((await upload(tv, 16)).body);
    await blobs.redeem('PUT', first.url, new Uint8Array(16));
    const second = pairUploadResponseSchema.parse((await upload(tv, 20)).body);
    expect(second.key).not.toBe(first.key);
    expect(blobs.keys()).toStrictEqual([]);
    expect((await row(tv.sid))!.fileId).toBe(second.key);
    await blobs.redeem('PUT', second.url, new Uint8Array(20));
    expect(blobs.keys()).toStrictEqual([pairBlobKey(tv.sid, second.key)]);
  });

  it('refuses after the payload (409), after the code ends or for no code (404), and a size out of range (400)', async () => {
    const tv = await newTv();
    for (const size of [15, 41943041, 1.5, '100', null]) expect([size, (await upload(tv, size)).status]).toStrictEqual([size, 400]);
    await send(tv);
    expect(await upload(tv, 100)).toMatchObject({ status: 409, body: { error: 'conflict' } });
    await poll(tv);
    expect(await upload(tv, 100)).toMatchObject({ status: 409, body: { error: 'conflict' } });
    expect((await row(tv.sid))!.fileId).toBeNull();
    const late = await newTv();
    clock = late.exp;
    expect((await upload(late, 100)).status).toBe(404);
    expect((await row(late.sid))!.fileId).toBeNull();
    const malformed = request('POST', '/v1/pair/0000000/upload-url', { body: { size: 100 } });
    expect((await answer(pairUploadUrl(deps(), malformed, '0000000'))).status).toBe(404);
    expect(malformed.bodyUsed).toBe(false);
  });
});

describe('GET /v1/pair/:code/status', () => {
  it('follows the payload: open, sent, received, done with the TV’s category', async () => {
    const tv = await newTv();
    const states: unknown[] = [];
    const look = async (): Promise<void> => {
      const got = await progress(tv);
      expect(got).toMatchObject({ status: 200, cors: null, cache: 'no-store' });
      expect(pairProgressResponseSchema.safeParse(got.body).success).toBe(true);
      states.push(got.body);
    };
    await look();
    await send(tv);
    await look();
    await poll(tv);
    await look();
    await report(tv, 'auth_failed');
    await look();
    // Past the code's end it still reads: the row lives an hour.
    clock = T0 + PAIR_ROW_TTL_MS - 1;
    await look();
    expect(states).toStrictEqual([{ state: 'open', exp: tv.exp }, { state: 'sent' }, { state: 'received' }, { state: 'done', status: 'auth_failed' }, { state: 'done', status: 'auth_failed' }]);
  });

  it('answers 404 for an unknown code, and for one that ended with nothing sent', async () => {
    const tv = await newTv();
    const sentOne = await newTv();
    await send(sentOne);
    clock = tv.exp;
    expect(await progress(tv)).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect((await progress(sentOne)).body).toStrictEqual({ state: 'sent' });
    expect((await answer(pairProgress(deps(), request('GET', '/v1/pair/x/status'), 'x'))).status).toBe(404);
  });
});

describe('GET /v1/pair/s/:sid', () => {
  it('waits, then gives the payload once and deletes it in the same statement', async () => {
    const tv = await newTv();
    expect(await poll(tv)).toStrictEqual({ status: 200, body: { state: 'waiting', exp: tv.exp }, cors: '*', cache: 'no-store', retryAfter: null });
    const sealed = seal(tv);
    await send(tv, sealed);
    clock = T0 + 5000;
    const ready = await poll(tv);
    expect(ready).toMatchObject({ status: 200, cors: '*' });
    expect(pairPollResponseSchema.parse(ready.body)).toStrictEqual({ state: 'ready', payload: sealed });
    expect(open(tv, sealed)).toStrictEqual(SOURCE);
    expect(await row(tv.sid)).toMatchObject({ payload: null, deliveredAt: new Date(T0 + 5000) });
    expect(await poll(tv)).toMatchObject({ status: 409, body: { error: 'conflict' }, cors: '*' });
  });

  it('gives a payload sent in time after the code ended, and 410 when nothing came', async () => {
    const tv = await newTv();
    await send(tv);
    const empty = await newTv();
    clock = tv.exp + 60_000;
    expect((await poll(tv)).body).toMatchObject({ state: 'ready' });
    expect(await poll(empty)).toMatchObject({ status: 410, body: { error: 'expired' }, cors: '*' });
    clock = tv.exp - 1;
    expect((await poll(empty)).body).toStrictEqual({ state: 'waiting', exp: empty.exp });
    clock = empty.exp;
    expect((await poll(empty)).status).toBe(410);
  });

  it('gives the payload to one of two polls at once', async () => {
    const tv = await newTv();
    await send(tv);
    const both = await Promise.all([poll(tv), poll(tv)]);
    expect(both.map((a) => a.status).sort()).toStrictEqual([200, 409]);
  });

  it('needs the session’s own poll token (401) and a known id (404)', async () => {
    const tv = await newTv();
    const other = await newTv();
    await send(tv);
    expect(await poll(tv, other.pollToken)).toMatchObject({ status: 401, body: { error: 'unauthorized' }, cors: '*' });
    expect((await poll(tv, toBase64Url(randomBytes(32)))).status).toBe(401);
    expect((await poll(tv, 'short')).status).toBe(401);
    expect((await answer(pollPair(deps(), request('GET', `/v1/pair/s/${tv.sid}`), tv.sid))).status).toBe(401);
    const unknown = toBase64Url(randomBytes(16));
    expect(await answer(pollPair(deps(), request('GET', `/v1/pair/s/${unknown}`, { token: tv.pollToken }), unknown))).toMatchObject({ status: 404, cors: '*' });
    expect((await answer(pollPair(deps(), request('GET', '/v1/pair/s/nope', { token: tv.pollToken }), 'nope'))).status).toBe(404);
    // None of these took the payload.
    expect((await row(tv.sid))!.payload).not.toBeNull();
  });
});

describe('POST /v1/pair/s/:sid/status', () => {
  it('takes the category once, after the read, and deletes the file', async () => {
    const tv = await newTv();
    const put = pairUploadResponseSchema.parse((await upload(tv, 32)).body);
    await blobs.redeem('PUT', put.url, new Uint8Array(32));
    await send(tv);
    expect(await report(tv, 'ok')).toMatchObject({ status: 409, body: { error: 'conflict' }, cors: '*' });
    await poll(tv);
    expect(await report(tv, 'ok')).toStrictEqual({ status: 200, body: { state: 'done', status: 'ok' }, cors: '*', cache: 'no-store', retryAfter: null });
    expect(await row(tv.sid)).toMatchObject({ status: 'ok', fileId: null });
    expect(blobs.keys()).toStrictEqual([]);
    expect((await report(tv, 'blocked')).status).toBe(409);
    expect((await row(tv.sid))!.status).toBe('ok');
  });

  it('takes only the five categories, with the token', async () => {
    const tv = await newTv();
    await send(tv);
    await poll(tv);
    for (const status of ['failed', 'OK', '', null]) expect([status, (await report(tv, status)).status]).toStrictEqual([status, 400]);
    const other = await newTv();
    expect((await answer(pairStatus(deps(), request('POST', `/v1/pair/s/${tv.sid}/status`, { token: other.pollToken, body: { status: 'ok' } }), tv.sid))).status).toBe(401);
    expect((await row(tv.sid))!.status).toBeNull();
    for (const status of ['ok', 'auth_failed', 'expired', 'unreachable', 'blocked']) {
      const each = await newTv();
      await send(each);
      await poll(each);
      expect((await report(each, status)).body).toStrictEqual({ state: 'done', status });
    }
  });

  it("takes a check's two statuses only for a check, and an add's only for an add (RELAY step 38c4)", async () => {
    const add = await newTv();
    await send(add);
    await poll(add);
    for (const status of ['match', 'no_match']) expect([status, await report(add, status)]).toMatchObject([status, { status: 400, body: { error: 'bad_request' }, cors: '*' }]);
    expect((await row(add.sid))!.status).toBeNull();
    for (const status of ['match', 'no_match']) {
      const check = await newTv(deps(), undefined, 'check');
      await send(check);
      await poll(check);
      for (const other of ['ok', 'auth_failed', 'unreachable']) expect([other, (await report(check, other)).status]).toStrictEqual([other, 400]);
      expect((await row(check.sid))!.status).toBeNull();
      expect(await report(check, status)).toMatchObject({ status: 200, body: { state: 'done', status } });
      expect(await progress(check)).toMatchObject({ status: 200, body: { state: 'done', status } });
    }
  });
});

describe('GET /v1/pair/s/:sid/file', () => {
  it('presigns a GET of the file after the read, until the status', async () => {
    const tv = await newTv();
    const put = pairUploadResponseSchema.parse((await upload(tv, 24)).body);
    await blobs.redeem('PUT', put.url, new Uint8Array(24).fill(5));
    await send(tv);
    expect(await fileUrl(tv)).toMatchObject({ status: 409, body: { error: 'conflict' }, cors: '*' });
    await poll(tv);
    const got = await fileUrl(tv);
    expect(got).toMatchObject({ status: 200, cors: '*', cache: 'no-store' });
    const get = pairFileUrlResponseSchema.parse(got.body);
    expect(get.key).toBe(put.key);
    expect(get.exp).toBe(T0 + PAIR_URL_TTL_MS);
    expect(await blobs.redeem('GET', get.url)).toStrictEqual({ status: 200, body: new Uint8Array(24).fill(5) });
    await report(tv, 'ok');
    expect(await fileUrl(tv)).toMatchObject({ status: 404, cors: '*' });
  });

  it('answers 404 when the phone sent no file, and 401 without the token', async () => {
    const tv = await newTv();
    await send(tv);
    await poll(tv);
    expect((await fileUrl(tv)).status).toBe(404);
    expect((await answer(pairFileUrl(deps(), request('GET', `/v1/pair/s/${tv.sid}/file`), tv.sid))).status).toBe(401);
  });
});

describe('the sweep', () => {
  it('deletes the rows an hour old or more, with their files, at each new pairing', async () => {
    const old = await newTv();
    const put = pairUploadResponseSchema.parse((await upload(old, 16)).body);
    await blobs.redeem('PUT', put.url, new Uint8Array(16));
    const oldNoFile = await newTv();
    clock = T0 + 1;
    const young = await newTv();
    const youngPut = pairUploadResponseSchema.parse((await upload(young, 16)).body);
    await blobs.redeem('PUT', youngPut.url, new Uint8Array(16));
    clock = T0 + PAIR_ROW_TTL_MS - 1;
    expect(await sweepPairs(deps(), clock)).toBe(0);
    clock = T0 + PAIR_ROW_TTL_MS;
    await newTv();
    expect([await row(old.sid), await row(oldNoFile.sid)]).toStrictEqual([undefined, undefined]);
    expect(await row(young.sid)).toBeDefined();
    expect(blobs.keys()).toStrictEqual([pairBlobKey(young.sid, youngPut.key)]);
    expect(await sweepPairs(deps(), T0 + 1 + PAIR_ROW_TTL_MS)).toBe(1);
    expect(blobs.keys()).toStrictEqual([]);
  });
});

describe('the rate limits', () => {
  it('refuse the 31st code request from one address in 10 minutes, with Retry-After', async () => {
    const tv = await newTv();
    const kinds = [
      (): Promise<Answer> => answer(pairTvKey(deps(), request('GET', '/v1/pair/x'), 'x')),
      (): Promise<Answer> => answer(postPairPayload(deps(), request('POST', '/v1/pair/x/payload', { body: {} }), 'x')),
      (): Promise<Answer> => answer(pairUploadUrl(deps(), request('POST', '/v1/pair/x/upload-url', { body: {} }), 'x')),
    ];
    for (let i = 0; i < 30; i++) expect((await kinds[i % 3]!()).status).toBe(404);
    for (const kind of kinds) expect(await kind()).toMatchObject({ status: 429, body: { error: 'rate_limited' }, retryAfter: '600', cors: null });
    // The right code is refused too: the limit comes first.
    expect((await answer(pairTvKey(deps(), request('GET', `/v1/pair/${tv.code}`), tv.code))).status).toBe(429);
    expect((await send(tv)).status).toBe(429);
    // Another address, or the same one later, goes ahead.
    expect((await answer(pairTvKey(deps(), request('GET', `/v1/pair/${tv.code}`, { ip: '203.0.113.2' }), tv.code))).status).toBe(200);
    // Ten minutes later the window has passed (and so has the code: 404, no longer 429).
    clock = T0 + 600_000;
    expect((await answer(pairTvKey(deps(), request('GET', `/v1/pair/${tv.code}`), tv.code))).status).toBe(404);
  });

  it('refuse the 21st new code, the 401st progress and the 401st TV call, each on its own', async () => {
    for (let i = 0; i < 20; i++) await newTv(deps(), '198.51.100.9');
    const refused = await answer(createPair(deps(), request('POST', '/v1/pair', { body: { tvPk: toBase64Url(newBoxKeyPair().publicKey) }, ip: '198.51.100.9' })));
    expect(refused).toMatchObject({ status: 429, cors: '*', retryAfter: '600' });
    const tv = await newTv();
    for (let i = 0; i < 400; i++) expect((await progress(tv, '198.51.100.10')).status).toBe(200);
    expect(await progress(tv, '198.51.100.10')).toMatchObject({ status: 429, cors: null });
    for (let i = 0; i < 400; i++) expect((await answer(pollPair(deps(), request('GET', '/', { token: tv.pollToken, ip: '198.51.100.11' }), tv.sid))).status).toBe(200);
    const tvCalls = [
      pollPair(deps(), request('GET', '/', { token: tv.pollToken, ip: '198.51.100.11' }), tv.sid),
      pairStatus(deps(), request('POST', '/', { token: tv.pollToken, ip: '198.51.100.11', body: { status: 'ok' } }), tv.sid),
      pairFileUrl(deps(), request('GET', '/', { token: tv.pollToken, ip: '198.51.100.11' }), tv.sid),
    ];
    for (const call of tvCalls) expect(await answer(call)).toMatchObject({ status: 429, cors: '*' });
    // The progress and the TV's polls didn't count against the code guesses.
    expect((await answer(pairTvKey(deps(), request('GET', `/v1/pair/${tv.code}`, { ip: '198.51.100.10' }), tv.code))).status).toBe(200);
  });

  it('key on an HMAC of the address, never the address', async () => {
    const spy = vi.spyOn(limiter, 'limit');
    await newTv(deps(), '192.0.2.44');
    const key = spy.mock.calls[0]![0];
    expect(key).toMatch(/^pair-new:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain('192.0.2.44');
    expect(key).toBe(rateKey('pair-new', '192.0.2.44', 'r'.repeat(32)));
  });
});

describe('the routes', () => {
  const saved = process.env.DATABASE_URL;

  const savedBlobUrl = process.env.LABLO_DEV_BLOB_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = url;
    // The upload's schema takes R2's https URLs only (RELAY 31d decides how development's http passes).
    process.env.LABLO_DEV_BLOB_URL = 'https://blobs.test/dev/blob';
    resetServices();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    if (savedBlobUrl === undefined) delete process.env.LABLO_DEV_BLOB_URL;
    else process.env.LABLO_DEV_BLOB_URL = savedBlobUrl;
    resetServices();
  });

  it('answer the TV’s preflights; the phone’s routes have none', async () => {
    for (const [route, methods] of [
      [createRoute, 'POST, OPTIONS'],
      [pollRoute, 'GET, OPTIONS'],
      [statusRoute, 'POST, OPTIONS'],
      [fileRoute, 'GET, OPTIONS'],
    ] as const) {
      const response = route.OPTIONS();
      expect([response.status, response.headers.get('access-control-allow-origin'), response.headers.get('access-control-allow-methods')]).toStrictEqual([204, '*', methods]);
    }
    for (const route of [keyRoute, payloadRoute, uploadRoute, progressRoute]) expect('OPTIONS' in route).toBe(false);
  });

  it('answer 503 without a database, to the TV with CORS', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.DATABASE_URL;
    expect(await answer(createRoute.POST(request('POST', '/v1/pair', { body: { tvPk: toBase64Url(newBoxKeyPair().publicKey) } })))).toMatchObject({
      status: 503,
      body: { error: 'unavailable' },
      cors: '*',
    });
    const code = { params: Promise.resolve({ code: 'ABCDEFGH' }) };
    const sid = { params: Promise.resolve({ sid: `${'k'.repeat(21)}g` }) };
    const phone = [
      keyRoute.GET(request('GET', '/v1/pair/ABCDEFGH'), code),
      payloadRoute.POST(request('POST', '/v1/pair/ABCDEFGH/payload', { body: {} }), code),
      uploadRoute.POST(request('POST', '/v1/pair/ABCDEFGH/upload-url', { body: {} }), code),
      progressRoute.GET(request('GET', '/v1/pair/ABCDEFGH/status'), code),
    ];
    for (const call of phone) expect(await answer(call)).toMatchObject({ status: 503, body: { error: 'unavailable' }, cors: null });
    const tv = [
      pollRoute.GET(request('GET', '/v1/pair/s/x'), sid),
      statusRoute.POST(request('POST', '/v1/pair/s/x/status', { body: {} }), sid),
      fileRoute.GET(request('GET', '/v1/pair/s/x/file'), sid),
    ];
    for (const call of tv) expect(await answer(call)).toMatchObject({ status: 503, body: { error: 'unavailable' }, cors: '*' });
    expect(errors.mock.calls.map((c) => c[0])).toStrictEqual([
      'pair: create failed (Error)',
      'pair: key failed (Error)',
      'pair: payload failed (Error)',
      'pair: upload failed (Error)',
      'pair: progress failed (Error)',
      'pair: poll failed (Error)',
      'pair: status failed (Error)',
      'pair: file failed (Error)',
    ]);
  });

  /**
   * "The server only ever holds ciphertext" (architecture.md §3.3 A): a whole pairing through the
   * routes, an Xtream login and an M3U file carrying markers. After every step, every row of every
   * table and every blob is searched for the markers, the code and the poll token.
   */
  it('hold only ciphertext and hashes, at every step of a pairing', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    const store = services().blobs as MemoryBlobStore;
    const lines = ['#EXTM3U', '#EXTINF:-1 tvg-id="marker.31a",Marker Channel 31a', 'http://stream-marker-31a.example/live/user/pass/1.ts'];
    // Two frames: just over 1 MiB of lines.
    const fileText = `${Array.from({ length: 9500 }, (_, i) => `${lines[1]} ${i}\n${lines[2]}?n=${i}`).join('\n')}\n`;
    const file = utf8(`${lines[0]}\n${fileText}`);
    expect(file.length).toBeGreaterThan(1048576);
    const fileKey = newFileKey();
    const base = newFileNonceBase();
    const payloadFor = (key: string): PairPayload => ({
      v: 1,
      source: { type: 'm3u-file', file: { key, fileKey: toBase64Url(fileKey), base: toBase64Url(base), size: file.length } },
      name: 'Marker Living Room 31a',
      epg: ['https://epg-marker-31a.example/guide.xml.gz'],
    });
    const xtream: PairPayload = {
      v: 1,
      source: { type: 'xtream', server: 'http://panel-marker-31a.example:8080', username: 'marker-user-31a', password: 'marker-pass-31a' },
      name: 'Marker Panel 31a',
    };
    // Long enough not to turn up by chance in megabytes of ciphertext (three bytes would).
    const secrets = [
      'marker',
      'Marker',
      ...lines,
      toBase64Url(fileKey),
      toBase64Url(base),
      JSON.stringify(xtream),
    ];

    async function everything(): Promise<string> {
      const parts: string[] = [];
      for (const table of ['PairSession', 'Backup', 'TelemetryEvent', 'DiagReport']) {
        const { rows } = await raw.query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM "${table}" t`);
        parts.push(...rows.map((r) => r.row));
      }
      for (const key of store.keys()) parts.push(key, Buffer.from((await store.get(key))!).toString('latin1'));
      return parts.join('\n');
    }

    async function heldNothing(step: string, also: readonly string[]): Promise<void> {
      const held = await everything();
      for (const secret of [...secrets, ...also]) expect([step, secret, held.includes(secret)]).toStrictEqual([step, secret, false]);
    }

    const ip = '203.0.113.99';
    const ctx = <K extends string>(key: K, value: string): { params: Promise<Record<K, string>> } => ({ params: Promise.resolve({ [key]: value } as Record<K, string>) });

    // Two pairings: an M3U file, then an Xtream login.
    for (const kind of ['file', 'xtream'] as const) {
      const keys = newBoxKeyPair();
      const made = pairCreateResponseSchema.parse((await answer(createRoute.POST(request('POST', '/v1/pair', { body: { tvPk: toBase64Url(keys.publicKey) }, ip })))).body);
      // The routes run on the real clock: the code ends 10 minutes from now.
      expect(Math.abs(made.exp - (Date.now() + PAIR_CODE_TTL_MS))).toBeLessThan(60_000);
      const own = [made.code, made.pollToken, toBase64Url(keys.secretKey)];
      await heldNothing(`${kind}: made`, own);

      // The phone, with a typed code: the TV's key from the server.
      const tvKey = pairTvKeyResponseSchema.parse((await answer(keyRoute.GET(request('GET', `/v1/pair/${made.code}`, { ip }), ctx('code', made.code)))).body);
      let payload = xtream;
      if (kind === 'file') {
        const sealedFile = sealFile(file, fileKey, base);
        const put = pairUploadResponseSchema.parse(
          (await answer(uploadRoute.POST(request('POST', `/v1/pair/${made.code}/upload-url`, { body: { size: sealedFile.length }, ip }), ctx('code', made.code)))).body,
        );
        expect((await store.redeem('PUT', put.url, sealedFile)).status).toBe(200);
        await heldNothing(`${kind}: uploaded`, own);
        payload = payloadFor(put.key);
      }
      const sealed = sealPairPayload(utf8(JSON.stringify(payload)), fromBase64Url(tvKey.tvPk)!);
      expect((await answer(payloadRoute.POST(request('POST', `/v1/pair/${made.code}/payload`, { body: sealed, ip }), ctx('code', made.code)))).body).toStrictEqual({
        state: 'sent',
      });
      await heldNothing(`${kind}: sent`, own);
      // What the server keeps is what the phone sent, nothing more.
      expect((await row(made.sid))!.payload).toStrictEqual(sealed);

      // The TV.
      const polled = pairPollResponseSchema.parse((await answer(pollRoute.GET(request('GET', `/v1/pair/s/${made.sid}`, { token: made.pollToken, ip }), ctx('sid', made.sid)))).body);
      if (polled.state !== 'ready') throw new Error('not ready');
      const opened = pairPayloadSchema.parse(JSON.parse(new TextDecoder().decode(openPairPayload(polled.payload, keys.secretKey)!)));
      expect(opened).toStrictEqual(payload);
      await heldNothing(`${kind}: read`, own);
      if (opened.source.type === 'm3u-file') {
        const get = pairFileUrlResponseSchema.parse((await answer(fileRoute.GET(request('GET', `/v1/pair/s/${made.sid}/file`, { token: made.pollToken, ip }), ctx('sid', made.sid)))).body);
        const fetched = await store.redeem('GET', get.url);
        const plain = openFile(fetched.body!, fromBase64Url(opened.source.file.fileKey)!, fromBase64Url(opened.source.file.base)!, opened.source.file.size);
        expect(plain).toStrictEqual(file);
      }
      expect((await answer(statusRoute.POST(request('POST', `/v1/pair/s/${made.sid}/status`, { token: made.pollToken, body: { status: 'ok' }, ip }), ctx('sid', made.sid)))).body).toStrictEqual({
        state: 'done',
        status: 'ok',
      });
      await heldNothing(`${kind}: done`, own);
      expect((await answer(progressRoute.GET(request('GET', `/v1/pair/${made.code}/status`, { ip }), ctx('code', made.code)))).body).toStrictEqual({ state: 'done', status: 'ok' });
      expect(await row(made.sid)).toMatchObject({ payload: null, fileId: null, status: 'ok' });
    }
    expect(store.keys()).toStrictEqual([]);
    expect(logged).toStrictEqual([]);
  });
});
