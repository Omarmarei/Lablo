import { createHash } from 'node:crypto';
import { pairCode, pairCreateRequestSchema } from '@lablo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBlobKey, MemoryBlobStore } from '../src/server/blob-store';
import { apiError, bearerToken, clientIp, json, preflight, PREFLIGHT_MAX_AGE_S, readBody, readJsonBody, TV_CORS } from '../src/server/http';
import type { PairDeps } from '../src/server/pair';
import {
  codeHash,
  CROCKFORD,
  newPairCode,
  PAIR_CODE_TTL_MS,
  PAIR_CREATE_ATTEMPTS,
  PAIR_LIMITS,
  PAIR_ROW_TTL_MS,
  PAIR_SMALL_BODY_BYTES,
  PAIR_URL_TTL_MS,
  pairBlobKey,
  pairRoute,
} from '../src/server/pair';
import { MemoryRateLimiter } from '../src/server/rate-limit';
import { createServices, DEV_BLOB_URL, rateSecretFrom, resetServices, services } from '../src/server/services';

/** The pairing API's parts that need no database (RELAY step 31a); the routes are in pair.web.test.ts. */

const URL_ = 'http://localhost:3100/v1/pair';

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(URL_, { method: 'POST', headers, body });
}

/** A body that arrives in chunks, with no content-length. */
function streamed(chunks: Uint8Array[]): { request: Request; cancelled: () => boolean } {
  let cancelled = false;
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { request: new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit), cancelled: () => cancelled };
}

async function answer(response: Response): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
}

describe('json and apiError', () => {
  it('answer JSON that no cache keeps, with any extra headers', async () => {
    expect(await answer(json({ a: 1 }, 201, { 'x-a': 'b' }))).toStrictEqual({
      status: 201,
      body: { a: 1 },
      headers: { 'cache-control': 'no-store', 'content-type': 'application/json', 'x-a': 'b' },
    });
    expect((await answer(json({ a: 1 }))).status).toBe(200);
    // Its own cache-control wins over a caller's.
    expect(json({}, 200, { 'cache-control': 'max-age=60' }).headers.get('cache-control')).toBe('no-store');
    expect(await answer(apiError(404, 'not_found', TV_CORS))).toStrictEqual({
      status: 404,
      body: { error: 'not_found' },
      headers: { 'cache-control': 'no-store', 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  });
});

describe('readJsonBody', () => {
  it('reads a JSON body up to its cap', async () => {
    expect(await readJsonBody(post('{"a":[1,"x"]}'), 100)).toStrictEqual({ ok: true, value: { a: [1, 'x'] } });
    const exact = `"${'a'.repeat(98)}"`;
    expect(exact.length).toBe(100);
    expect(await readJsonBody(post(exact), 100)).toStrictEqual({ ok: true, value: 'a'.repeat(98) });
  });

  it('refuses with 413 by the declared length, before reading', async () => {
    const request = post('{}', { 'content-length': '101' });
    const result = await readJsonBody(request, 100, TV_CORS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(await answer(result.response)).toMatchObject({ status: 413, body: { error: 'too_large' }, headers: { 'access-control-allow-origin': '*' } });
    expect(request.bodyUsed).toBe(false);
    const body = `"${'c'.repeat(98)}"`;
    expect(await readJsonBody(post(body, { 'content-length': '100' }), 100)).toStrictEqual({ ok: true, value: 'c'.repeat(98) });
  });

  it('refuses with 413 while reading a body without a length, and stops reading it', async () => {
    const chunk = new Uint8Array(40).fill(0x20);
    const { request, cancelled } = streamed([chunk, chunk, chunk, chunk]);
    const result = await readJsonBody(request, 100);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    expect(cancelled()).toBe(true);
    // 101 bytes in chunks is one too many; 100 is fine.
    const ok = streamed([new TextEncoder().encode(`"${'b'.repeat(48)}`), new TextEncoder().encode(`${'b'.repeat(50)}"`)]);
    expect(await readJsonBody(ok.request, 100)).toStrictEqual({ ok: true, value: 'b'.repeat(98) });
    const over = streamed([new TextEncoder().encode(`"${'b'.repeat(49)}`), new TextEncoder().encode(`${'b'.repeat(50)}"`)]);
    expect((await readJsonBody(over.request, 100)).ok).toBe(false);
  });

  it('refuses with 400 a body that is missing, not UTF-8 or not JSON', async () => {
    for (const request of [post(null), post(Uint8Array.from([0x22, 0xff, 0x22])), post('{a:1}'), post(''), post('{"a":1')]) {
      const result = await readJsonBody(request, 100, TV_CORS);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(await answer(result.response)).toMatchObject({ status: 400, body: { error: 'bad_request' }, headers: { 'access-control-allow-origin': '*' } });
    }
  });
});

describe('readBody', () => {
  const tvPk = `${'x'.repeat(42)}w`;

  it("gives the schema's output: fields it doesn't know are dropped", async () => {
    expect(await readBody(post(JSON.stringify({ tvPk, extra: 'x' })), 100, pairCreateRequestSchema)).toStrictEqual({ ok: true, value: { tvPk } });
  });

  it('refuses with 400 what the schema refuses, and 413 or 400 as the reader does', async () => {
    for (const [request, status] of [
      [post(JSON.stringify({ tvPk: `${tvPk}=` })), 400],
      [post(JSON.stringify({})), 400],
      [post('[1]'), 400],
      [post('nope'), 400],
      [post(JSON.stringify({ tvPk: 'x'.repeat(200) })), 413],
    ] as const) {
      const result = await readBody(request, 100, pairCreateRequestSchema, { 'x-a': 'b' });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect([result.response.status, result.response.headers.get('x-a')]).toStrictEqual([status, 'b']);
    }
  });
});

describe('bearerToken', () => {
  const token = `${'Ab-_'.repeat(10)}AbE`;

  it('reads an Authorization: Bearer token', () => {
    expect(bearerToken(new Headers({ authorization: `Bearer ${token}` }))).toBe(token);
    expect(bearerToken(new Headers({ authorization: `bearer ${token}` }))).toBe(token);
    // Headers trims a value's ends itself.
    expect(bearerToken(new Headers({ authorization: ` Bearer ${token} ` }))).toBe(token);
  });

  it('is null without one, or for anything else', () => {
    expect(bearerToken(new Headers())).toBeNull();
    for (const value of [token, `Basic ${token}`, `Bearer`, `Bearer  ${token}`, `Bearer ${token} x`, `Bearer ${token}=`, `Bearer a+b`, `Bearer ${'a'.repeat(129)}`]) {
      expect([value, bearerToken(new Headers({ authorization: value }))]).toStrictEqual([value, null]);
    }
    expect(bearerToken(new Headers({ authorization: `Bearer ${'a'.repeat(128)}` }))).toBe('a'.repeat(128));
  });
});

describe('clientIp', () => {
  it("takes x-forwarded-for's first entry, else x-real-ip, else 'unknown'", () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1', 'x-real-ip': '198.51.100.2' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': ' 198.51.100.2 ' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIp(new Headers({ 'x-real-ip': ' ' }))).toBe('unknown');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('the TV routes’ CORS', () => {
  it('answers any origin, and a preflight with the methods and both headers', () => {
    expect(TV_CORS).toStrictEqual({ 'access-control-allow-origin': '*' });
    const response = preflight('GET');
    expect(response.status).toBe(204);
    expect(Object.fromEntries(response.headers)).toStrictEqual({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
    });
    expect(PREFLIGHT_MAX_AGE_S).toBe(600);
    expect(preflight('POST').headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  });
});

describe('the services', () => {
  afterEach(() => resetServices());

  it('take the rate secret from LABLO_RATE_SECRET, or make one per process', () => {
    expect(rateSecretFrom({ LABLO_RATE_SECRET: 's'.repeat(32) })).toBe('s'.repeat(32));
    expect(() => rateSecretFrom({ LABLO_RATE_SECRET: 's'.repeat(31) })).toThrow('LABLO_RATE_SECRET is shorter than 32 characters');
    const a = rateSecretFrom({});
    const b = rateSecretFrom({ LABLO_RATE_SECRET: '' });
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('are the memory fakes, pointed at the development blob route or LABLO_DEV_BLOB_URL', async () => {
    const made = createServices({ LABLO_RATE_SECRET: 'r'.repeat(40) });
    expect(made.blobs).toBeInstanceOf(MemoryBlobStore);
    expect(made.limiter).toBeInstanceOf(MemoryRateLimiter);
    expect(made.rateSecret).toBe('r'.repeat(40));
    expect(DEV_BLOB_URL).toBe('http://127.0.0.1:3100/dev/blob');
    expect((await made.blobs.presignGet('pair/a/b', 1000)).url.startsWith(`${DEV_BLOB_URL}/pair/a/b?`)).toBe(true);
    const other = createServices({ LABLO_DEV_BLOB_URL: 'http://192.168.1.5:3100/dev/blob', VERCEL: '' });
    expect((await other.blobs.presignGet('pair/a/b', 1000)).url.startsWith('http://192.168.1.5:3100/dev/blob/pair/a/b?')).toBe(true);
  });

  it('refuse on Vercel, where the fakes must never run', () => {
    expect(() => createServices({ VERCEL: '1' })).toThrow('no production blob store or rate limiter yet (RELAY step 34)');
  });

  it('are made once per process', () => {
    const first = services({});
    expect(services({ VERCEL: '1' })).toBe(first);
    resetServices();
    expect(() => services({ VERCEL: '1' })).toThrow();
    expect(services({})).not.toBe(first);
  });
});

describe('the code', () => {
  it('is 8 Crockford characters from 5 bytes, 5 bits each, high bits first', () => {
    expect(CROCKFORD).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(newPairCode(new Uint8Array(5))).toBe('00000000');
    expect(newPairCode(new Uint8Array(5).fill(255))).toBe('ZZZZZZZZ');
    // 00001 00010 00011 00100 00101 00110 00111 01000.
    expect(newPairCode(Uint8Array.from([0x08, 0x86, 0x42, 0x98, 0xe8]))).toBe('12345678');
    expect(newPairCode(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xfe]))).toBe('ZZZZZZZY');
    expect(newPairCode(Uint8Array.from([0x80, 0, 0, 0, 0]))).toBe('G0000000');
  });

  it('uses every one of the 40 bits, and always passes the protocol’s check', () => {
    const codes = new Set<string>();
    for (let bit = 0; bit < 40; bit++) {
      const bytes = new Uint8Array(5);
      bytes[bit >> 3] = 0x80 >> (bit & 7);
      const code = newPairCode(bytes);
      expect(pairCode.safeParse(code).success).toBe(true);
      codes.add(code);
    }
    expect(codes.size).toBe(40);
    for (let i = 0; i < 200; i++) expect(pairCode.safeParse(newPairCode(Uint8Array.from({ length: 5 }, () => Math.floor(Math.random() * 256)))).success).toBe(true);
  });

  it('takes exactly 5 bytes', () => {
    expect(() => newPairCode(new Uint8Array(4))).toThrow(RangeError);
    expect(() => newPairCode(new Uint8Array(6))).toThrow(RangeError);
  });

  it('is kept as b64url(SHA-256) of its characters', () => {
    expect(codeHash('7K3M9QZT')).toBe(createHash('sha256').update('7K3M9QZT').digest('base64url'));
    expect(codeHash('7K3M9QZT')).not.toBe(codeHash('7K3M9QZV'));
  });
});

describe('the pairing constants', () => {
  it('are the ones architecture.md §3.2 and RELAY 31a give', () => {
    expect(PAIR_CODE_TTL_MS).toBe(10 * 60_000);
    expect(PAIR_ROW_TTL_MS).toBe(60 * 60_000);
    expect(PAIR_URL_TTL_MS).toBe(10 * 60_000);
    expect(PAIR_SMALL_BODY_BYTES).toBe(1024);
    expect(PAIR_CREATE_ATTEMPTS).toBe(3);
    expect(PAIR_LIMITS).toStrictEqual({
      create: { scope: 'pair-new', rule: { limit: 20, windowMs: 600_000 } },
      code: { scope: 'pair-code', rule: { limit: 30, windowMs: 600_000 } },
      phone: { scope: 'pair-phone', rule: { limit: 400, windowMs: 600_000 } },
      tv: { scope: 'pair-tv', rule: { limit: 400, windowMs: 600_000 } },
    });
  });

  it('give blob keys the store accepts', () => {
    const key = pairBlobKey(`${'k'.repeat(21)}g`, `${'f'.repeat(21)}A`);
    expect(key).toBe(`pair/${'k'.repeat(21)}g/${'f'.repeat(21)}A`);
    expect(isBlobKey(key)).toBe(true);
  });
});

describe('pairRoute', () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives the operation's answer", async () => {
    const deps = {} as PairDeps;
    const response = await pairRoute('x', (d) => Promise.resolve(json({ same: d === deps })), undefined, () => deps);
    expect(await response.json()).toStrictEqual({ same: true });
  });

  it("answers 503 when the dependencies or the operation fail, and logs only the error's kind", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missing = await pairRoute('poll', () => Promise.resolve(json({})), TV_CORS, () => {
      throw new Error('DATABASE_URL is not set: postgresql://secret-host');
    });
    expect(await answer(missing)).toMatchObject({ status: 503, body: { error: 'unavailable' }, headers: { 'access-control-allow-origin': '*' } });
    const failed = await pairRoute('payload', () => Promise.reject(Object.assign(new Error('the password is hunter2'), { code: 'P2010' })), undefined, () => ({}) as PairDeps);
    expect(await answer(failed)).toMatchObject({ status: 503, body: { error: 'unavailable' } });
    expect(failed.headers.get('access-control-allow-origin')).toBeNull();
    expect(errors.mock.calls).toStrictEqual([['pair: poll failed (Error)'], ['pair: payload failed (P2010)']]);
  });
});
