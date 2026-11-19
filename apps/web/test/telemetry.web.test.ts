import { randomBytes } from 'node:crypto';
import { toBase64Url } from '@lablo/crypto';
import { TELEMETRY_BATCH_MAX, TELEMETRY_BODY_MAX_BYTES } from '@lablo/protocol';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import * as telemetryRouteModule from '../src/app/v1/telemetry/route';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createDb } from '../src/server/db';
import { MemoryRateLimiter, rateKey } from '../src/server/rate-limit';
import { resetServices, services } from '../src/server/services';
import type { TelemetryDeps } from '../src/server/telemetry';
import { eventData, postTelemetry, sweepTelemetry, TELEMETRY_LIMIT, TELEMETRY_SWEEP_MAX, TELEMETRY_TTL_MS, telemetryRoute } from '../src/server/telemetry';

/**
 * The telemetry API against a real Postgres (RELAY step 33a): a batch kept one row per event, the
 * events it can't read dropped, a crash's stack scrubbed again, the limits, the sweep, and no
 * address or URL in any row.
 */

const url = inject('databaseUrl');
let client: PrismaClient;
let raw: pg.Client;

const T0 = Date.UTC(2026, 10, 19, 9, 0, 0);
const DAY = 86_400_000;
let clock: number;
let limiter: MemoryRateLimiter;

function deps(changes: Partial<TelemetryDeps> = {}): TelemetryDeps {
  return { db: () => client, limiter, rateSecret: 'r'.repeat(32), now: () => clock, ...changes };
}

const INSTALL = toBase64Url(new Uint8Array(randomBytes(16)));

function batch(events: readonly unknown[], changes: Record<string, unknown> = {}): Record<string, unknown> {
  return { installId: INSTALL, platform: 'webos', appVersion: '1.2.3', events, ...changes };
}

const APP_START = { kind: 'app_start', at: T0 - 5000, tier: 'full', coldStartMs: 2100, catalog: '10k+' };
const PLAY = { kind: 'play_result', at: T0 - 4000, engine: 'html5', container: 'hls', mode: 'live', ttffMs: 900, error: null };
const CRASH_STACK =
  'TypeError: x of http://panel.example.com:8080/live/marker-user/marker-pass/1.ts\n    at e (file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/main.js:1:2345)\n    password=marker-pass at 192.168.1.8';
const CRASH = { kind: 'crash', at: T0 - 3000, where: 'main', stack: CRASH_STACK };

function request(body: unknown, options: { readonly ip?: string; readonly method?: string } = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': options.ip ?? '203.0.113.1', 'content-type': 'application/json' };
  return new Request('http://localhost:3100/v1/telemetry', { method: options.method ?? 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
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
    body: await r.json(),
    cors: r.headers.get('access-control-allow-origin'),
    cache: r.headers.get('cache-control'),
    retryAfter: r.headers.get('retry-after'),
  };
}

const post = (body: unknown, options: { readonly ip?: string } = {}, d: TelemetryDeps = deps()): Promise<Answer> => answer(postTelemetry(d, request(body, options)));

/** The rows as Prisma reads them (node-postgres would read their timestamps as local time). */
async function rows(): Promise<Record<string, unknown>[]> {
  return (await client.telemetryEvent.findMany({ orderBy: { id: 'asc' } })).map(({ id: _id, ...row }) => row);
}

const TV_ANSWER = { cors: '*', cache: 'no-store', retryAfter: null };

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
  await raw.query('DELETE FROM "TelemetryEvent"');
  clock = T0;
  limiter = new MemoryRateLimiter({ now: () => clock });
});

afterEach(() => vi.restoreAllMocks());

describe('POST /v1/telemetry', () => {
  it('keeps one row per event: the install, kind, platform, version, the fields, when it happened and when it came', async () => {
    expect(await post(batch([APP_START, PLAY]))).toStrictEqual({ status: 200, body: { state: 'stored', stored: 2, dropped: 0 }, ...TV_ANSWER });
    expect(await rows()).toStrictEqual([
      { installId: INSTALL, kind: 'app_start', platform: 'webos', appVersion: '1.2.3', data: { tier: 'full', coldStartMs: 2100, catalog: '10k+' }, at: new Date(T0 - 5000), receivedAt: new Date(T0) },
      {
        installId: INSTALL,
        kind: 'play_result',
        platform: 'webos',
        appVersion: '1.2.3',
        data: { engine: 'html5', container: 'hls', mode: 'live', ttffMs: 900, error: null },
        at: new Date(T0 - 4000),
        receivedAt: new Date(T0),
      },
    ]);
  });

  it('drops and counts the events it can’t read, and strips the fields it doesn’t know from the rest', async () => {
    const newer = { kind: 'zap', at: T0, ms: 300 };
    const broken = { ...PLAY, engine: 'quantum' };
    const extra = { ...APP_START, url: 'http://panel.example.com/get.php', channel: 'News 24' };
    expect(await post(batch([newer, broken, extra, 'not an event']))).toStrictEqual({ status: 200, body: { state: 'stored', stored: 1, dropped: 3 }, ...TV_ANSWER });
    const kept = await rows();
    expect(kept.map((r) => [r.kind, r.data])).toStrictEqual([['app_start', { tier: 'full', coldStartMs: 2100, catalog: '10k+' }]]);
    // None readable: nothing written, still a 200.
    expect(await post(batch([newer]))).toStrictEqual({ status: 200, body: { state: 'stored', stored: 0, dropped: 1 }, ...TV_ANSWER });
    expect(await client.telemetryEvent.count()).toBe(1);
  });

  it('scrubs a crash’s stack again before it keeps it', async () => {
    expect((await post(batch([CRASH]))).status).toBe(200);
    const [row] = await rows();
    expect(row!.data).toStrictEqual({ where: 'main', stack: 'TypeError: x of [url]\n    at e (main.js:1:2345)\n    password=[x] at [ip]' });
    expect(eventData(CRASH as never)).toStrictEqual(row!.data);
    // Only a crash's stack is free text: another event's fields go as the schema read them.
    expect(eventData(APP_START as never)).toStrictEqual({ tier: 'full', coldStartMs: 2100, catalog: '10k+' });
  });

  it('refuses a body over 64 KB with 413, and one that isn’t JSON or a batch with 400, writing nothing', async () => {
    const big = JSON.stringify(batch([{ ...CRASH, stack: 'x'.repeat(TELEMETRY_BODY_MAX_BYTES) }]));
    expect(await post(big)).toStrictEqual({ status: 413, body: { error: 'too_large' }, ...TV_ANSWER });
    expect(await post('{not json')).toStrictEqual({ status: 400, body: { error: 'bad_request' }, ...TV_ANSWER });
    for (const body of [
      batch([]),
      batch(Array.from({ length: TELEMETRY_BATCH_MAX + 1 }, () => APP_START)),
      batch([APP_START], { installId: 'short' }),
      batch([APP_START], { platform: 'roku' }),
      batch([APP_START], { appVersion: '1.2' }),
      { ...batch([APP_START]), events: undefined },
      [APP_START],
    ]) {
      expect(await post(body)).toStrictEqual({ status: 400, body: { error: 'bad_request' }, ...TV_ANSWER });
    }
    // A body of exactly 64 KB is read; one byte more is refused.
    const edge = (extra: number): string => {
      const crashes = Array.from({ length: 17 }, () => ({ ...CRASH, stack: 'x'.repeat(3800) }));
      const base = JSON.stringify(batch(crashes)).length;
      crashes[16]!.stack = 'x'.repeat(3800 + TELEMETRY_BODY_MAX_BYTES - base + extra);
      const body = JSON.stringify(batch(crashes));
      expect(body.length).toBe(TELEMETRY_BODY_MAX_BYTES + extra);
      // Every crash still within the schema's 4,000 characters: only the size can refuse it.
      expect(crashes[16]!.stack.length).toBeLessThan(3800);
      return body;
    };
    expect((await post(edge(0))).body).toStrictEqual({ state: 'stored', stored: 17, dropped: 0 });
    expect((await post(edge(1))).status).toBe(413);
    await raw.query('DELETE FROM "TelemetryEvent"');
    // The largest batch the schema takes is kept whole.
    expect((await post(batch(Array.from({ length: TELEMETRY_BATCH_MAX }, () => APP_START)))).body).toStrictEqual({ state: 'stored', stored: TELEMETRY_BATCH_MAX, dropped: 0 });
    expect(await client.telemetryEvent.count()).toBe(TELEMETRY_BATCH_MAX);
  });

  it('limits each caller to 60 posts in 10 minutes, keyed on an HMAC of its address, with Retry-After', async () => {
    expect(TELEMETRY_LIMIT).toStrictEqual({ scope: 'telemetry', rule: { limit: 60, windowMs: 600_000 } });
    const limits = vi.spyOn(limiter, 'limit');
    for (let i = 0; i < 60; i++) expect((await post(batch([APP_START]), { ip: '198.51.100.7' })).status).toBe(200);
    clock += 1000;
    expect(await post(batch([APP_START]), { ip: '198.51.100.7' })).toStrictEqual({ status: 429, body: { error: 'rate_limited' }, cors: '*', cache: 'no-store', retryAfter: '599' });
    // Another caller, and the same one once the window has passed.
    expect((await post(batch([APP_START]), { ip: '198.51.100.8' })).status).toBe(200);
    clock = T0 + 600_000 + 1;
    expect((await post(batch([APP_START]), { ip: '198.51.100.7' })).status).toBe(200);
    expect(limits.mock.calls[0]![0]).toBe(rateKey('telemetry', '198.51.100.7', 'r'.repeat(32)));
    expect(await client.telemetryEvent.count()).toBe(62);
    // A refused post reads no body.
    const refused = request(batch([APP_START]), { ip: '198.51.100.7' });
    for (let i = 0; i < 59; i++) await post(batch([APP_START]), { ip: '198.51.100.7' });
    expect((await answer(postTelemetry(deps(), refused))).status).toBe(429);
    expect(refused.bodyUsed).toBe(false);
  });

  it('sweeps events received 90 days ago or more, the oldest first and a bounded number a post', async () => {
    expect([TELEMETRY_TTL_MS, TELEMETRY_SWEEP_MAX]).toStrictEqual([90 * DAY, 1000]);
    await post(batch([APP_START, PLAY]));
    clock = T0 + 1;
    await post(batch([CRASH]));
    clock = T0 + 10 * DAY;
    await post(batch([PLAY]));
    // One millisecond short of 90 days: nothing goes.
    clock = T0 + TELEMETRY_TTL_MS - 1;
    expect(await sweepTelemetry(deps(), clock)).toBe(0);
    // At 90 days exactly, the two received at T0 are due and the crash (at T0 + 1) not yet.
    expect(await sweepTelemetry(deps(), T0 + TELEMETRY_TTL_MS, 5)).toBe(2);
    expect((await rows()).map((r) => r.kind)).toStrictEqual(['crash', 'play_result']);
    await raw.query('DELETE FROM "TelemetryEvent"');
    clock = T0;
    await post(batch([APP_START, PLAY]));
    clock = T0 + 1;
    await post(batch([CRASH]));
    clock = T0 + 10 * DAY;
    await post(batch([PLAY]));
    // Bounded to one: the oldest goes first, and of two received together the first written.
    expect(await sweepTelemetry(deps(), T0 + TELEMETRY_TTL_MS + 1, 1)).toBe(1);
    expect((await rows()).map((r) => r.kind)).toStrictEqual(['play_result', 'crash', 'play_result']);
    // A post sweeps before it writes: the crash (received at T0 + 1) and the other one at T0 go.
    clock = T0 + TELEMETRY_TTL_MS + 1;
    expect((await post(batch([APP_START]))).status).toBe(200);
    expect((await rows()).map((r) => [r.kind, (r.receivedAt as Date).getTime()])).toStrictEqual([
      ['play_result', T0 + 10 * DAY],
      ['app_start', T0 + TELEMETRY_TTL_MS + 1],
    ]);
  });

  it('keeps no address, URL, host or login in any row', async () => {
    await post(batch([APP_START, PLAY, CRASH, { ...APP_START, host: 'panel.example.com' }]), { ip: '203.0.113.77' });
    const all = await raw.query<{ j: unknown }>('SELECT row_to_json(t) AS j FROM "TelemetryEvent" t');
    const text = JSON.stringify(all.rows);
    expect(all.rows).toHaveLength(4);
    for (const needle of ['203.0.113.77', '192.168.1.8', 'panel.example', 'marker-user', 'marker-pass', 'http://', 'palm/applications']) {
      expect([needle, text.includes(needle)]).toStrictEqual([needle, false]);
    }
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

  it('answers the preflight for POST with content-type', () => {
    const response = telemetryRouteModule.OPTIONS();
    expect([
      response.status,
      response.headers.get('access-control-allow-origin'),
      response.headers.get('access-control-allow-methods'),
      response.headers.get('access-control-allow-headers'),
    ]).toStrictEqual([204, '*', 'POST, OPTIONS', 'content-type']);
  });

  it('posts through the process’s services and clock', async () => {
    const limits = vi.spyOn(services().limiter, 'limit');
    const started = Date.now();
    expect(await answer(telemetryRouteModule.POST(request(batch([APP_START]))))).toStrictEqual({ status: 200, body: { state: 'stored', stored: 1, dropped: 0 }, ...TV_ANSWER });
    const [row] = await rows();
    const at = (row!.receivedAt as Date).getTime();
    expect([at >= started, at <= Date.now()]).toStrictEqual([true, true]);
    expect(limits.mock.calls.map((c) => c[0])).toStrictEqual([rateKey('telemetry', '203.0.113.1', services().rateSecret)]);
  });

  it('answers 503 when the database fails, logging only the error’s kind', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const failing = (): TelemetryDeps =>
      deps({
        db: () => {
          throw new Error('connect ECONNREFUSED panel.example.com');
        },
      });
    expect(await answer(telemetryRoute((d) => postTelemetry(d, request(batch([APP_START]))), failing))).toStrictEqual({
      status: 503,
      body: { error: 'unavailable' },
      ...TV_ANSWER,
    });
    expect(logged).toStrictEqual(['telemetry: post failed (Error)']);
    // Without a database URL the route's own services fail the same way.
    delete process.env.DATABASE_URL;
    resetServices();
    expect((await answer(telemetryRouteModule.POST(request(batch([APP_START]))))).status).toBe(503);
  });
});
