import { randomBytes } from 'node:crypto';
import type { BackupKeys } from '@lablo/crypto';
import { backupKeys, openBackup, sealBackup, toBase64Url, tokenHash, utf8 } from '@lablo/crypto';
import { BACKUP_BODY_MAX_BYTES, BACKUP_CT_MAX_BYTES, BACKUP_WRITE_HEADER, backupEnvelopeSchema } from '@lablo/protocol';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import * as backupRouteModule from '../src/app/v1/backup/[lookupId]/route';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { BackupDeps } from '../src/server/backup';
import { BACKUP_LIMITS, BACKUP_SWEEP_MAX, BACKUP_TTL_MS, backupBlobKey, backupRoute, deleteBackup, getBackup, putBackup, sweepBackups } from '../src/server/backup';
import { MemoryBlobStore } from '../src/server/blob-store';
import { createDb } from '../src/server/db';
import { MemoryRateLimiter, rateKey } from '../src/server/rate-limit';
import { resetServices, services } from '../src/server/services';

/**
 * The backup API against a real Postgres (RELAY step 32a): every answer of the three calls, the
 * write token, the sweep, the rate limits, and "the server only ever holds ciphertext". The test
 * plays the TV with `@lablo/crypto`, as the TV app will.
 */

const url = inject('databaseUrl');
let client: PrismaClient;
let raw: pg.Client;

const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const DAY = 86_400_000;
let clock: number;
let blobs: MemoryBlobStore;
let limiter: MemoryRateLimiter;

function deps(changes: Partial<BackupDeps> = {}): BackupDeps {
  return { db: () => client, blobs, limiter, rateSecret: 'r'.repeat(32), now: () => clock, ...changes };
}

const noDb = (): PrismaClient => {
  throw new Error('no database');
};

interface Options {
  readonly body?: unknown;
  readonly token?: string;
  readonly ip?: string;
}

function request(method: 'PUT' | 'GET' | 'DELETE' | 'OPTIONS', lookupId: string, options: Options = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': options.ip ?? '203.0.113.1' };
  if (options.token !== undefined) headers[BACKUP_WRITE_HEADER] = options.token;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  return new Request(`http://localhost:3100/v1/backup/${lookupId}`, { method, headers, body });
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly cors: string | null;
  readonly cache: string | null;
  readonly type: string | null;
  readonly retryAfter: string | null;
}

async function answer(response: Response | Promise<Response>): Promise<Answer> {
  const r = await response;
  return {
    status: r.status,
    body: await r.json(),
    cors: r.headers.get('access-control-allow-origin'),
    cache: r.headers.get('cache-control'),
    type: r.headers.get('content-type'),
    retryAfter: r.headers.get('retry-after'),
  };
}

/** A TV's keys, from a master key as its scrypt would give. */
function newTv(): BackupKeys {
  return backupKeys(new Uint8Array(randomBytes(32)));
}

const PROFILE = '{"v":8,"sources":[{"id":"s1","type":"xtream","server":"http://panel.example:8080","username":"marker-user","password":"marker-pass"}]}';

const sealed = (tv: BackupKeys, plain: string = PROFILE) => sealBackup(utf8(plain), tv.encKey);

const put = (tv: BackupKeys, body: unknown = sealed(tv), options: Options = {}, d: BackupDeps = deps()): Promise<Answer> =>
  answer(putBackup(d, request('PUT', tv.lookupId, { token: tv.writeToken, body, ...options }), tv.lookupId));
const get = (tv: BackupKeys, options: Options = {}, d: BackupDeps = deps()): Promise<Answer> => answer(getBackup(d, request('GET', tv.lookupId, options), tv.lookupId));
const del = (tv: BackupKeys, options: Options = {}, d: BackupDeps = deps()): Promise<Answer> =>
  answer(deleteBackup(d, request('DELETE', tv.lookupId, { token: tv.writeToken, ...options }), tv.lookupId));

/** The backup's row as Prisma reads it (node-postgres would read its timestamps as local time). */
async function row(lookupId: string): Promise<Record<string, unknown> | undefined> {
  return (await client.backup.findUnique({ where: { lookupId } })) ?? undefined;
}

async function count(): Promise<number> {
  return client.backup.count();
}

const TV_ANSWER = { cors: '*', cache: 'no-store' };

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
  await raw.query('DELETE FROM "Backup"');
  clock = T0;
  blobs = new MemoryBlobStore({ now: () => clock });
  limiter = new MemoryRateLimiter({ now: () => clock });
});

afterEach(() => vi.restoreAllMocks());

describe('PUT /v1/backup/:lookupId', () => {
  it('stores exactly the envelope, which the TV’s key opens; the row holds the token’s hash and the size', async () => {
    const tv = newTv();
    const envelope = sealed(tv);
    expect(await put(tv, envelope)).toStrictEqual({ status: 200, body: { state: 'stored' }, ...TV_ANSWER, type: 'application/json', retryAfter: null });

    const got = await get(tv);
    expect(got).toStrictEqual({ status: 200, body: envelope, ...TV_ANSWER, type: 'application/json', retryAfter: null });
    const opened = openBackup(backupEnvelopeSchema.parse(got.body), tv.encKey);
    expect(new TextDecoder().decode(opened!)).toBe(PROFILE);

    const size = JSON.stringify(envelope).length;
    expect(await row(tv.lookupId)).toStrictEqual({ lookupId: tv.lookupId, writeTokenHash: tokenHash(tv.writeToken), size, createdAt: new Date(T0), updatedAt: new Date(T0) });
    expect(backupBlobKey('abc')).toBe('backup/abc');
    expect(blobs.keys()).toStrictEqual([`backup/${tv.lookupId}`]);
    expect((await blobs.get(backupBlobKey(tv.lookupId)))!.length).toBe(size);
    expect(JSON.stringify(await row(tv.lookupId))).not.toContain(tv.writeToken);
  });

  it('keeps only the envelope’s four fields', async () => {
    const tv = newTv();
    const envelope = sealed(tv);
    expect((await put(tv, { ...envelope, device: 'marker-device', note: 'marker-note' })).status).toBe(200);
    expect((await get(tv)).body).toStrictEqual(envelope);
  });

  it('replaces the envelope for the same token, keeping when it was first made', async () => {
    const tv = newTv();
    await put(tv, sealed(tv, 'first'));
    clock = T0 + 5 * 60_000;
    const second = sealed(tv, 'the second, longer one');
    expect((await put(tv, second)).status).toBe(200);
    expect((await get(tv)).body).toStrictEqual(second);
    expect(await row(tv.lookupId)).toMatchObject({ size: JSON.stringify(second).length, createdAt: new Date(T0), updatedAt: new Date(clock) });
    expect(await count()).toBe(1);
    expect(blobs.size).toBe(1);
  });

  it('refuses another token, none or a malformed one (401), leaving the stored envelope and its row', async () => {
    const tv = newTv();
    const envelope = sealed(tv);
    await put(tv, envelope);
    const before = await row(tv.lookupId);
    clock = T0 + 60_000;
    const other = newTv();
    for (const token of [other.writeToken, undefined, '', tv.writeToken.slice(1), `${tv.writeToken}A`, `${tv.writeToken.slice(0, 42)}!`]) {
      const refused = await answer(putBackup(deps(), request('PUT', tv.lookupId, { token, body: sealed(other, 'another') }), tv.lookupId));
      expect(refused, String(token)).toStrictEqual({ status: 401, body: { error: 'unauthorized' }, ...TV_ANSWER, type: 'application/json', retryAfter: null });
    }
    expect((await get(tv)).body).toStrictEqual(envelope);
    expect(await row(tv.lookupId)).toStrictEqual(before);
  });

  it('refuses a token before it reads the body, and writes nothing for one', async () => {
    const tv = newTv();
    const noToken = request('PUT', tv.lookupId, { body: sealed(tv) });
    expect((await answer(putBackup(deps(), noToken, tv.lookupId))).status).toBe(401);
    expect(noToken.bodyUsed).toBe(false);
    expect([await count(), blobs.size]).toStrictEqual([0, 0]);
  });

  it('answers 404 for a lookup ID that is not 32 bytes of base64url, before the token', async () => {
    const tv = newTv();
    for (const id of [tv.lookupId.slice(1), `${tv.lookupId}A`, `${tv.lookupId.slice(0, 42)}.`, 'x']) {
      const refused = await answer(putBackup(deps(), request('PUT', id, { body: sealed(tv) }), id));
      expect(refused, id).toMatchObject({ status: 404, body: { error: 'not_found' }, ...TV_ANSWER });
    }
    expect([await count(), blobs.size]).toStrictEqual([0, 0]);
  });

  it('refuses a body that is no envelope (400) or over 512 KB (413), and stores the longest one', async () => {
    const tv = newTv();
    const envelope = sealed(tv);
    for (const [body, status] of [
      [{ ...envelope, kdf: 'scrypt-14-8-1' }, 400],
      [{ ...envelope, v: 2 }, 400],
      [{ v: 1, kdf: envelope.kdf, nonce: envelope.nonce }, 400],
      ['{"v":1,', 400],
      [{ ...envelope, pad: 'p'.repeat(BACKUP_BODY_MAX_BYTES) }, 413],
    ] as const) {
      expect(await put(tv, body), JSON.stringify(body).slice(0, 60)).toMatchObject({ status, ...TV_ANSWER });
    }
    expect([await count(), blobs.size]).toStrictEqual([0, 0]);

    const longest = sealBackup(new Uint8Array(randomBytes(BACKUP_CT_MAX_BYTES - 16)), tv.encKey);
    const size = JSON.stringify(longest).length;
    expect(size).toBeLessThanOrEqual(BACKUP_BODY_MAX_BYTES);
    expect(size).toBeGreaterThan(BACKUP_BODY_MAX_BYTES - 2048);
    expect((await put(tv, longest)).status).toBe(200);
    expect(await row(tv.lookupId)).toMatchObject({ size });
    const back = (await get(tv)).body as { ct: string };
    expect(back.ct === longest.ct).toBe(true);
  });

  it('gives a lookup ID to one of two first puts at once', async () => {
    const tv = newTv();
    const thief = newTv();
    const mine = sealed(tv, 'mine');
    const theirs = sealed(thief, 'theirs');
    const both = await Promise.all([put(tv, mine), answer(putBackup(deps(), request('PUT', tv.lookupId, { token: thief.writeToken, body: theirs }), tv.lookupId))]);
    expect(both.map((a) => a.status).sort()).toStrictEqual([200, 401]);
    // Whoever won, the row and the envelope are the same caller's.
    const winner = both[0].status === 200 ? { hash: tokenHash(tv.writeToken), envelope: mine } : { hash: tokenHash(thief.writeToken), envelope: theirs };
    expect(await row(tv.lookupId)).toMatchObject({ writeTokenHash: winner.hash });
    expect((await get(tv)).body).toStrictEqual(winner.envelope);
  });

  it('never puts the blob for a token the row refused', async () => {
    const tv = newTv();
    await put(tv);
    const puts = vi.spyOn(blobs, 'put');
    expect((await answer(putBackup(deps(), request('PUT', tv.lookupId, { token: newTv().writeToken, body: sealed(tv) }), tv.lookupId))).status).toBe(401);
    expect(puts).not.toHaveBeenCalled();
  });
});

describe('GET /v1/backup/:lookupId', () => {
  it('answers 404 for nothing stored and for a malformed lookup ID', async () => {
    const tv = newTv();
    expect(await get(tv)).toStrictEqual({ status: 404, body: { error: 'not_found' }, ...TV_ANSWER, type: 'application/json', retryAfter: null });
    const reads = vi.spyOn(blobs, 'get');
    expect((await answer(getBackup(deps(), request('GET', 'x'), 'x'))).status).toBe(404);
    expect(reads).not.toHaveBeenCalled();
  });

  it('needs no token and no database', async () => {
    const tv = newTv();
    const envelope = sealed(tv);
    await put(tv, envelope);
    expect(await get(tv, {}, deps({ db: noDb }))).toMatchObject({ status: 200, body: envelope });
    expect((await get(newTv(), {}, deps({ db: noDb }))).status).toBe(404);
  });

  it('gives each lookup ID its own envelope', async () => {
    const a = newTv();
    const b = newTv();
    const ea = sealed(a, 'a');
    const eb = sealed(b, 'b');
    await put(a, ea);
    await put(b, eb);
    expect([(await get(a)).body, (await get(b)).body]).toStrictEqual([ea, eb]);
    // Another TV's key opens nothing.
    expect(openBackup(ea, b.encKey)).toBeNull();
  });
});

describe('DELETE /v1/backup/:lookupId', () => {
  it('deletes the envelope and its row for the token that wrote them, and frees the ID', async () => {
    const tv = newTv();
    const other = newTv();
    await put(tv);
    await put(other);
    expect(await del(tv)).toStrictEqual({ status: 200, body: { state: 'deleted' }, ...TV_ANSWER, type: 'application/json', retryAfter: null });
    expect(await row(tv.lookupId)).toBeUndefined();
    expect(blobs.keys()).toStrictEqual([backupBlobKey(other.lookupId)]);
    expect((await get(tv)).status).toBe(404);
    expect((await del(tv)).status).toBe(404);
    // Free to claim again, by any token.
    const next = newTv();
    expect((await answer(putBackup(deps(), request('PUT', tv.lookupId, { token: next.writeToken, body: sealed(next) }), tv.lookupId))).status).toBe(200);
    expect(await row(tv.lookupId)).toMatchObject({ writeTokenHash: tokenHash(next.writeToken) });
  });

  it('refuses another token, none or a malformed one (401), a malformed ID and nothing stored (404)', async () => {
    const tv = newTv();
    const envelope = sealed(tv);
    await put(tv, envelope);
    for (const token of [newTv().writeToken, undefined, 'short']) {
      const refused = await answer(deleteBackup(deps(), request('DELETE', tv.lookupId, { token }), tv.lookupId));
      expect(refused, String(token)).toMatchObject({ status: 401, body: { error: 'unauthorized' }, ...TV_ANSWER });
    }
    expect((await get(tv)).body).toStrictEqual(envelope);
    expect(await count()).toBe(1);

    // A malformed ID never reaches the database.
    expect(await answer(deleteBackup(deps({ db: noDb }), request('DELETE', 'x', { token: tv.writeToken }), 'x'))).toMatchObject({ status: 404, ...TV_ANSWER });
    // No token for nothing stored is still 401: the answer doesn't say whether the ID exists.
    const none = newTv();
    expect((await answer(deleteBackup(deps(), request('DELETE', none.lookupId), none.lookupId))).status).toBe(401);
    expect(await del(none)).toMatchObject({ status: 404, body: { error: 'not_found' }, ...TV_ANSWER });
  });

  it('deletes the blob before the row', async () => {
    const tv = newTv();
    await put(tv);
    vi.spyOn(blobs, 'delete').mockRejectedValueOnce(new Error('the store is down'));
    await expect(del(tv)).rejects.toThrow('the store is down');
    // The row is still there, so the same token can try again.
    expect(await count()).toBe(1);
    expect((await del(tv)).status).toBe(200);
    expect([await count(), blobs.size]).toStrictEqual([0, 0]);
  });
});

describe('the sweep', () => {
  it('deletes the backups nobody updated for 180 days, with their blobs, at a later put', async () => {
    expect(BACKUP_TTL_MS).toBe(180 * DAY);
    const old = newTv();
    const edge = newTv();
    const kept = newTv();
    await put(old);
    clock = T0 + 1;
    await put(edge);
    clock = T0 + 2;
    await put(kept);
    // Exactly 180 days after `edge`'s update: `old` and `edge` go, `kept` (1 ms newer) stays.
    clock = T0 + 1 + BACKUP_TTL_MS;
    const later = newTv();
    expect((await put(later)).status).toBe(200);
    expect([await row(old.lookupId), await row(edge.lookupId)]).toStrictEqual([undefined, undefined]);
    expect(blobs.keys()).toStrictEqual([backupBlobKey(kept.lookupId), backupBlobKey(later.lookupId)].sort());
    expect(await count()).toBe(2);
    expect((await get(old)).status).toBe(404);
  });

  it('counts from the last update, not the first write', async () => {
    const tv = newTv();
    await put(tv);
    clock = T0 + 100 * DAY;
    await put(tv);
    clock = T0 + 200 * DAY;
    expect(await sweepBackups(deps(), clock)).toBe(0);
    expect((await get(tv)).status).toBe(200);
    clock = T0 + 280 * DAY;
    expect(await sweepBackups(deps(), clock)).toBe(1);
    expect([await count(), blobs.size]).toStrictEqual([0, 0]);
  });

  it('lets a TV back after 180 days write again under its own ID', async () => {
    const tv = newTv();
    await put(tv);
    clock = T0 + BACKUP_TTL_MS + DAY;
    const envelope = sealed(tv, 'back again');
    expect((await put(tv, envelope)).status).toBe(200);
    expect((await get(tv)).body).toStrictEqual(envelope);
    expect(await row(tv.lookupId)).toMatchObject({ createdAt: new Date(clock), updatedAt: new Date(clock) });
  });

  it('takes at most 20 a call, the oldest first', async () => {
    expect(BACKUP_SWEEP_MAX).toBe(20);
    const tvs: BackupKeys[] = [];
    for (let i = 0; i < 23; i++) {
      clock = T0 + i;
      // Each from its own address: the write limit is per caller.
      const tv = newTv();
      tvs.push(tv);
      expect((await put(tv, sealed(tv), { ip: `198.51.100.${i}` })).status).toBe(200);
    }
    clock = T0 + BACKUP_TTL_MS + DAY;
    expect(await sweepBackups(deps(), clock)).toBe(20);
    expect(blobs.keys()).toStrictEqual(tvs.slice(20).map((tv) => backupBlobKey(tv.lookupId)).sort());
    expect(await sweepBackups(deps(), clock, 2)).toBe(2);
    expect(blobs.keys()).toStrictEqual([backupBlobKey(tvs[22]!.lookupId)]);
    expect(await sweepBackups(deps(), clock)).toBe(1);
    expect(await sweepBackups(deps(), clock)).toBe(0);
  });

  it('keeps the row of a backup whose blob would not go, and one updated while it ran', async () => {
    const stuck = newTv();
    const busy = newTv();
    await put(stuck);
    await put(busy);
    clock = T0 + BACKUP_TTL_MS;
    const gone = vi.spyOn(blobs, 'delete').mockRejectedValueOnce(new Error('the store is down'));
    await expect(sweepBackups(deps(), clock)).rejects.toThrow('the store is down');
    expect(await count()).toBe(2);
    gone.mockRestore();

    // `busy` is updated between the sweep's read and its delete: its row stays.
    vi.spyOn(blobs, 'delete').mockImplementation(async () => {
      await raw.query('UPDATE "Backup" SET "updatedAt" = $2 WHERE "lookupId" = $1', [busy.lookupId, '2030-01-01']);
    });
    expect(await sweepBackups(deps(), clock)).toBe(1);
    expect(await row(stuck.lookupId)).toBeUndefined();
    expect(await row(busy.lookupId)).toBeDefined();
  });
});

describe('the rate limits', () => {
  it('refuse the 31st write and the 31st read from one address in 10 minutes, each on its own, with Retry-After', async () => {
    expect(BACKUP_LIMITS).toStrictEqual({
      read: { scope: 'backup-read', rule: { limit: 30, windowMs: 600_000 } },
      write: { scope: 'backup-write', rule: { limit: 30, windowMs: 600_000 } },
    });
    const tv = newTv();
    for (let i = 0; i < 29; i++) expect((await put(tv)).status, `put ${i}`).toBe(200);
    clock = T0 + 60_000;
    // A delete counts as a write.
    expect((await del(tv)).status).toBe(200);
    const refused = { status: 429, body: { error: 'rate_limited' }, ...TV_ANSWER, type: 'application/json' };
    expect(await put(tv)).toStrictEqual({ ...refused, retryAfter: '540' });
    expect(await del(tv)).toStrictEqual({ ...refused, retryAfter: '540' });
    expect(await count()).toBe(0);
    // Reads have their own count, and another address its own of each.
    for (let i = 0; i < 30; i++) expect((await get(tv)).status, `get ${i}`).toBe(404);
    expect(await get(tv)).toStrictEqual({ ...refused, retryAfter: '600' });
    expect((await put(tv, sealed(tv), { ip: '203.0.113.2' })).status).toBe(200);
    expect((await get(tv, { ip: '203.0.113.2' })).status).toBe(200);
    // The window passes.
    clock = T0 + 600_001;
    expect((await put(tv)).status).toBe(200);
  });

  it('count a refused request before anything else is looked at', async () => {
    const tv = newTv();
    for (let i = 0; i < 30; i++) await answer(putBackup(deps(), request('PUT', 'x'), 'x'));
    expect((await put(tv)).status).toBe(429);
    for (let i = 0; i < 30; i++) await answer(getBackup(deps(), request('GET', 'x'), 'x'));
    expect((await get(tv)).status).toBe(429);
  });

  it('key on an HMAC of the address, never the address', async () => {
    const keys: string[] = [];
    const spy: BackupDeps['limiter'] = { limit: (key, rule) => (keys.push(key), limiter.limit(key, rule)) };
    const tv = newTv();
    await put(tv, sealed(tv), { ip: '203.0.113.77' }, deps({ limiter: spy }));
    await get(tv, { ip: '203.0.113.77' }, deps({ limiter: spy }));
    await del(tv, { ip: '203.0.113.77' }, deps({ limiter: spy }));
    const secret = 'r'.repeat(32);
    expect(keys).toStrictEqual([rateKey('backup-write', '203.0.113.77', secret), rateKey('backup-read', '203.0.113.77', secret), rateKey('backup-write', '203.0.113.77', secret)]);
    expect(keys.join()).not.toContain('203.0.113');
  });
});

describe('the route', () => {
  const saved = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = url;
    resetServices();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    resetServices();
  });

  const ctx = (lookupId: string) => ({ params: Promise.resolve({ lookupId }) });

  it('answers the preflight with its three methods and the write token’s header', () => {
    const response = backupRouteModule.OPTIONS();
    expect(BACKUP_WRITE_HEADER).toBe('x-write-token');
    expect([
      response.status,
      response.headers.get('access-control-allow-origin'),
      response.headers.get('access-control-allow-methods'),
      response.headers.get('access-control-allow-headers'),
    ]).toStrictEqual([204, '*', 'PUT, GET, DELETE, OPTIONS', 'content-type, x-write-token']);
  });

  /**
   * "The server only ever holds ciphertext" (architecture.md §3.3 B): a backup through the route,
   * its profile carrying markers. After every step, every row of every table, every blob and
   * every log line is searched for the markers and the write token.
   */
  it('puts, gets and deletes through the process’s services, holding only ciphertext and a hash', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    const tv = newTv();
    const needles = ['marker-user', 'marker-pass', 'panel.example', tv.writeToken, toBase64Url(tv.encKey)];
    const store = services().blobs as MemoryBlobStore;

    async function held(): Promise<string> {
      const parts: string[] = [...logged];
      const tables = await raw.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_%'`);
      for (const { tablename } of tables.rows) {
        const rows = await raw.query<{ j: unknown }>(`SELECT row_to_json(t) AS j FROM "${tablename}" t`);
        parts.push(JSON.stringify(rows.rows));
      }
      for (const key of store.keys()) parts.push(key, Buffer.from((await store.get(key))!).toString('latin1'));
      return parts.join('\n');
    }
    function expectClean(haystack: string): void {
      for (const needle of needles) expect(haystack.includes(needle), needle).toBe(false);
    }

    const envelope = sealed(tv);
    const limits = vi.spyOn(services().limiter, 'limit');
    const started = Date.now();
    expect(await answer(backupRouteModule.PUT(request('PUT', tv.lookupId, { token: tv.writeToken, body: envelope }), ctx(tv.lookupId)))).toMatchObject({
      status: 200,
      body: { state: 'stored' },
      ...TV_ANSWER,
    });
    // The process's own clock and rate secret.
    const at = ((await row(tv.lookupId))!.updatedAt as Date).getTime();
    expect([at >= started, at <= Date.now()]).toStrictEqual([true, true]);
    expect(limits.mock.calls.map((c) => c[0])).toStrictEqual([rateKey('backup-write', '203.0.113.1', services().rateSecret)]);
    const after = await held();
    // The search sees the row and the blob: it finds what they do hold.
    expect(after).toContain(tv.lookupId);
    expect(after).toContain(tokenHash(tv.writeToken)!);
    expect(after).toContain(envelope.ct);
    expectClean(after);

    expect(await answer(backupRouteModule.GET(request('GET', tv.lookupId), ctx(tv.lookupId)))).toMatchObject({ status: 200, body: envelope, ...TV_ANSWER });
    expect(await answer(backupRouteModule.DELETE(request('DELETE', tv.lookupId, { token: tv.writeToken }), ctx(tv.lookupId)))).toMatchObject({
      status: 200,
      body: { state: 'deleted' },
      ...TV_ANSWER,
    });
    const end = await held();
    expectClean(end);
    expect(end).not.toContain(envelope.ct);
    expect([await count(), store.size]).toStrictEqual([0, 0]);
  });

  it('answers 503 with CORS when the database is missing, logging only the error’s kind; a get still answers', async () => {
    const tv = newTv();
    const envelope = sealed(tv);
    expect((await answer(backupRouteModule.PUT(request('PUT', tv.lookupId, { token: tv.writeToken, body: envelope }), ctx(tv.lookupId)))).status).toBe(200);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.DATABASE_URL;
    const down = { status: 503, body: { error: 'unavailable' }, ...TV_ANSWER, type: 'application/json', retryAfter: null };
    expect(await answer(backupRouteModule.PUT(request('PUT', tv.lookupId, { token: tv.writeToken, body: envelope }), ctx(tv.lookupId)))).toStrictEqual(down);
    expect(await answer(backupRouteModule.DELETE(request('DELETE', tv.lookupId, { token: tv.writeToken }), ctx(tv.lookupId)))).toStrictEqual(down);
    expect(await answer(backupRouteModule.GET(request('GET', tv.lookupId), ctx(tv.lookupId)))).toMatchObject({ status: 200, body: envelope });
    expect(errors.mock.calls.map((c) => c[0])).toStrictEqual(['backup: put failed (Error)', 'backup: delete failed (Error)']);
  });

  it('answers 503 for a failing store too, naming the call', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = (): BackupDeps => {
      throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6379'), { code: 'ECONNREFUSED' });
    };
    expect(await answer(backupRoute('get', () => Promise.resolve(new Response('{}')), failing))).toMatchObject({ status: 503, body: { error: 'unavailable' }, ...TV_ANSWER });
    expect(errors.mock.calls).toStrictEqual([['backup: get failed (ECONNREFUSED)']]);
  });
});
