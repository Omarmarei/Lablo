import { DIAG_BODY_MAX_BYTES } from '@lablo/protocol';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import * as diagRouteModule from '../src/app/v1/diag/route';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createDb } from '../src/server/db';
import type { DiagDeps } from '../src/server/diag';
import { DIAG_CODE_ATTEMPTS, DIAG_LIMIT, DIAG_SWEEP_MAX, DIAG_TTL_MS, diagRoute, newDiagCode, postDiag, reportData, sweepDiag } from '../src/server/diag';
import { CROCKFORD } from '../src/server/pair';
import { MemoryRateLimiter, rateKey } from '../src/server/rate-limit';
import { resetServices, services } from '../src/server/services';

/**
 * The diagnostics report's API against a real Postgres (RELAY step 33d1): a report kept under a
 * new support code, a code taken made again, a crash's stack scrubbed again, the limits, the sweep,
 * and no address, URL, host, login or ID in any row.
 */

const url = inject('databaseUrl');
let client: PrismaClient;
let raw: pg.Client;

const T0 = Date.UTC(2026, 10, 19, 9, 0, 0);
const DAY = 86_400_000;
let clock: number;
let limiter: MemoryRateLimiter;
/** The random bytes each code is made of, in turn; then fresh ones counting up. */
let bytes: Uint8Array[];
let fresh: number;

function random(length: number): Uint8Array {
  const next = bytes.shift();
  if (next !== undefined) return next;
  fresh += 1;
  return Uint8Array.from({ length }, (_, i) => (fresh * 7 + i) % 256);
}

function deps(changes: Partial<DiagDeps> = {}): DiagDeps {
  return { db: () => client, limiter, rateSecret: 'r'.repeat(32), now: () => clock, random, ...changes };
}

const CRASH_STACK =
  'Uncaught TypeError: x of http://panel.example.com:8080/live/marker-user/marker-pass/1.ts\n    at e (file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/main.js:1:2345)\n    password=marker-pass at 192.168.1.8';
const CRASH = { kind: 'crash', at: T0 - 3000, where: 'main', stack: CRASH_STACK } as const;
const PLAY = { kind: 'play_result', at: T0 - 4000, engine: 'html5', container: 'hls', mode: 'live', ttffMs: 900, error: null } as const;

const REPORT = {
  v: 1,
  at: T0 - 1000,
  zoneMin: 180,
  locale: 'en',
  tier: 'full',
  model: 'OLED55A1PVA',
  firmware: '03.21.15',
  chromium: 79,
  probes: { year: 2021, lowTier: false, mse: true, hevc: true },
  telemetry: true,
  config: 'fresh',
  sources: [{ type: 'xtream', items: '10k+', checked: '1h+', needs: null }],
  guides: [{ programmes: '100k+', matched: '75-99', checked: '<1h', failure: { code: 'http', status: 503 } }],
  events: [PLAY, CRASH],
} as const;

const SCRUBBED_STACK = 'Uncaught TypeError: x of [url]\n    at e (main.js:1:2345)\n    password=[x] at [ip]';

function body(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return { platform: 'webos', appVersion: '1.2.3', report: REPORT, ...changes };
}

function request(content: unknown, options: { readonly ip?: string } = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': options.ip ?? '203.0.113.1', 'content-type': 'application/json' };
  return new Request('http://localhost:3100/v1/diag', { method: 'POST', headers, body: typeof content === 'string' ? content : JSON.stringify(content) });
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

const post = (content: unknown, options: { readonly ip?: string } = {}, d: DiagDeps = deps()): Promise<Answer> => answer(postDiag(d, request(content, options)));

/** The rows as Prisma reads them, oldest first. */
async function rows(): Promise<Record<string, unknown>[]> {
  return (await client.diagReport.findMany({ orderBy: { id: 'asc' } })).map(({ id: _id, ...row }) => row);
}

const TV_ANSWER = { cors: '*', cache: 'no-store', retryAfter: null };

/** The code `newDiagCode` makes of six bytes each `b`. */
const codeOf = (b: number): string => newDiagCode(new Uint8Array(6).fill(b));

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
  await raw.query('DELETE FROM "DiagReport"');
  clock = T0;
  limiter = new MemoryRateLimiter({ now: () => clock });
  bytes = [];
  fresh = 0;
});

afterEach(() => vi.restoreAllMocks());

describe('newDiagCode', () => {
  it('reads each byte’s low 5 bits as a character of Crockford’s base32', () => {
    expect(newDiagCode(Uint8Array.of(0, 1, 31, 32, 255, 0b10110))).toBe('01Z0ZP');
    expect(newDiagCode(Uint8Array.of(10, 18, 20, 21, 27, 224))).toBe('AJMNV0');
    // Every character of the alphabet, and only those: no I, L, O or U.
    const seen = new Set<string>();
    for (let b = 0; b < 256; b++) seen.add(codeOf(b)[0]!);
    expect([...seen].sort().join('')).toBe([...CROCKFORD].sort().join(''));
    expect(CROCKFORD).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(() => newDiagCode(new Uint8Array(5))).toThrow(RangeError);
    expect(() => newDiagCode(new Uint8Array(7))).toThrow(RangeError);
  });
});

describe('POST /v1/diag', () => {
  it('keeps the report under a new code, with the platform, the version and when it came, and answers 201 with the code', async () => {
    bytes = [Uint8Array.of(19, 7, 21, 2, 23, 9)];
    expect(await post(body())).toStrictEqual({ status: 201, body: { code: 'K7N2Q9' }, ...TV_ANSWER });
    expect(await rows()).toStrictEqual([
      { code: 'K7N2Q9', platform: 'webos', appVersion: '1.2.3', report: { ...REPORT, events: [PLAY, { ...CRASH, stack: SCRUBBED_STACK }] }, createdAt: new Date(T0) },
    ]);
    // Each report gets its own code.
    expect((await post(body({ platform: 'tizen' }))).body).toStrictEqual({ code: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{6}$/) });
    expect((await rows()).map((r) => r.platform)).toStrictEqual(['webos', 'tizen']);
  });

  it('scrubs each crash’s stack again before it keeps it, and nothing else', () => {
    const data = reportData(REPORT as never);
    expect(data).toStrictEqual({ ...REPORT, events: [PLAY, { ...CRASH, stack: SCRUBBED_STACK }] });
    // Without a crash the report is kept as the schema read it.
    expect(reportData({ ...REPORT, events: [PLAY] } as never)).toStrictEqual({ ...REPORT, events: [PLAY] });
  });

  it('makes another code when one is taken, and gives up with 503 after five', async () => {
    expect(DIAG_CODE_ATTEMPTS).toBe(5);
    bytes = [new Uint8Array(6).fill(1)];
    expect((await post(body())).body).toStrictEqual({ code: codeOf(1) });
    // The next post draws the taken code first, then a free one.
    bytes = [new Uint8Array(6).fill(1), new Uint8Array(6).fill(2)];
    expect(await post(body())).toStrictEqual({ status: 201, body: { code: codeOf(2) }, ...TV_ANSWER });
    expect(bytes).toStrictEqual([]);
    // Four taken codes, then a free one: the fifth try is still made.
    bytes = [1, 2, 1, 2, 3].map((b) => new Uint8Array(6).fill(b));
    expect((await post(body())).body).toStrictEqual({ code: codeOf(3) });
    // Five taken codes: the route answers 503 and keeps nothing more.
    bytes = [1, 2, 3, 1, 2, 4].map((b) => new Uint8Array(6).fill(b));
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    expect(await answer(diagRoute((d) => postDiag(d, request(body())), deps))).toStrictEqual({ status: 503, body: { error: 'unavailable' }, ...TV_ANSWER });
    expect(logged).toStrictEqual(['diag: post failed (P2002)']);
    expect(bytes).toStrictEqual([new Uint8Array(6).fill(4)]);
    expect((await rows()).map((r) => r.code)).toStrictEqual([codeOf(1), codeOf(2), codeOf(3)]);
  });

  it('refuses a body over 32 KB with 413, and one that isn’t JSON or a report with 400, writing nothing', async () => {
    expect(DIAG_BODY_MAX_BYTES).toBe(32768);
    // Each post from its own address: more than five would meet the rate limit.
    let caller = 0;
    const postOnce = (content: unknown): Promise<Answer> => post(content, { ip: `192.0.2.${++caller}` });
    // A body of exactly 32 KB is read; one byte more is refused. Nine crashes, each within the schema's 4,000 characters.
    const edge = (extra: number): string => {
      const crashes = Array.from({ length: 9 }, () => ({ ...CRASH, stack: '' }));
      const empty = JSON.stringify(body({ report: { ...REPORT, events: crashes } })).length;
      const total = DIAG_BODY_MAX_BYTES - empty + extra;
      for (let i = 0; i < 9; i++) crashes[i]!.stack = 'x'.repeat(Math.floor(total / 9) + (i === 8 ? total % 9 : 0));
      const content = JSON.stringify(body({ report: { ...REPORT, events: crashes } }));
      expect(content.length).toBe(DIAG_BODY_MAX_BYTES + extra);
      for (const crash of crashes) expect(crash.stack.length).toBeLessThanOrEqual(4000);
      return content;
    };
    expect((await postOnce(edge(0))).status).toBe(201);
    expect(await postOnce(edge(1))).toStrictEqual({ status: 413, body: { error: 'too_large' }, ...TV_ANSWER });
    expect(await postOnce('{not json')).toStrictEqual({ status: 400, body: { error: 'bad_request' }, ...TV_ANSWER });
    for (const content of [
      body({ platform: 'browser' }),
      body({ appVersion: '1.2' }),
      body({ report: undefined }),
      body({ report: { ...REPORT, model: 'http://panel.example.com' } }),
      body({ report: { ...REPORT, sources: [{ type: 'xtream', items: '10k+', checked: '1h+', needs: null, name: 'kept?' }, 'x'] } }),
      body({ report: { ...REPORT, v: 2 } }),
      [REPORT],
    ]) {
      expect(await postOnce(content)).toStrictEqual({ status: 400, body: { error: 'bad_request' }, ...TV_ANSWER });
    }
    expect(await client.diagReport.count()).toBe(1);
  });

  it('limits each caller to 5 reports an hour, keyed on an HMAC of its address, with Retry-After', async () => {
    expect(DIAG_LIMIT).toStrictEqual({ scope: 'diag', rule: { limit: 5, windowMs: 3_600_000 } });
    const limits = vi.spyOn(limiter, 'limit');
    for (let i = 0; i < 5; i++) expect((await post(body(), { ip: '198.51.100.7' })).status).toBe(201);
    clock += 1000;
    expect(await post(body(), { ip: '198.51.100.7' })).toStrictEqual({ status: 429, body: { error: 'rate_limited' }, cors: '*', cache: 'no-store', retryAfter: '3599' });
    // Another caller, and the same one once the hour has passed.
    expect((await post(body(), { ip: '198.51.100.8' })).status).toBe(201);
    clock = T0 + 3_600_000 + 1;
    expect((await post(body(), { ip: '198.51.100.7' })).status).toBe(201);
    expect(limits.mock.calls[0]![0]).toBe(rateKey('diag', '198.51.100.7', 'r'.repeat(32)));
    expect(await client.diagReport.count()).toBe(7);
    // A refused post reads no body.
    for (let i = 0; i < 4; i++) await post(body(), { ip: '198.51.100.7' });
    const refused = request(body(), { ip: '198.51.100.7' });
    expect((await answer(postDiag(deps(), refused))).status).toBe(429);
    expect(refused.bodyUsed).toBe(false);
  });

  it('sweeps reports received 30 days ago or more, the oldest first and a bounded number a post', async () => {
    expect([DIAG_TTL_MS, DIAG_SWEEP_MAX]).toStrictEqual([30 * DAY, 1000]);
    const put = async (at: number, platform: string): Promise<void> => {
      clock = at;
      expect((await post(body({ platform }))).status).toBe(201);
    };
    await put(T0, 'webos');
    await put(T0, 'tizen');
    await put(T0 + 1, 'webos');
    await put(T0 + 10 * DAY, 'tizen');
    const left = async (): Promise<Array<[string, number]>> => (await rows()).map((r) => [r.platform as string, (r.createdAt as Date).getTime()]);
    // One millisecond short of 30 days: nothing goes.
    expect(await sweepDiag(deps(), T0 + DIAG_TTL_MS - 1)).toBe(0);
    // Bounded to one, with three due (two received at T0, one at T0 + 1): the oldest goes first,
    // and of two received together the first written.
    expect(await sweepDiag(deps(), T0 + DIAG_TTL_MS + 1, 1)).toBe(1);
    expect(await left()).toStrictEqual([
      ['tizen', T0],
      ['webos', T0 + 1],
      ['tizen', T0 + 10 * DAY],
    ]);
    // At 30 days exactly, the other one received at T0 is due and the one at T0 + 1 not yet.
    expect(await sweepDiag(deps(), T0 + DIAG_TTL_MS, 5)).toBe(1);
    // A post sweeps before it writes: the one at T0 + 1 goes.
    await put(T0 + DIAG_TTL_MS + 1, 'webos');
    expect(await left()).toStrictEqual([
      ['tizen', T0 + 10 * DAY],
      ['webos', T0 + DIAG_TTL_MS + 1],
    ]);
  });

  it('keeps no address, URL, host, login or ID in any row', async () => {
    const extra = {
      ...REPORT,
      installId: 'AAAAAAAAAAAAAAAAAAAAAA',
      sources: [{ ...REPORT.sources[0], name: 'marker-name', url: 'http://panel.example.com/get.php?username=marker-user' }],
    };
    expect((await post(body({ report: extra, installId: 'BBBBBBBBBBBBBBBBBBBBBB' }), { ip: '203.0.113.77' })).status).toBe(201);
    const all = await raw.query<{ j: unknown }>('SELECT row_to_json(t) AS j FROM "DiagReport" t');
    const text = JSON.stringify(all.rows);
    expect(all.rows).toHaveLength(1);
    for (const needle of ['203.0.113.77', '192.168.1.8', 'panel.example', 'marker-user', 'marker-pass', 'marker-name', 'http://', 'palm/applications', 'AAAAAAAA', 'BBBBBBBB']) {
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
    const response = diagRouteModule.OPTIONS();
    expect([
      response.status,
      response.headers.get('access-control-allow-origin'),
      response.headers.get('access-control-allow-methods'),
      response.headers.get('access-control-allow-headers'),
    ]).toStrictEqual([204, '*', 'POST, OPTIONS', 'content-type']);
  });

  it('posts through the process’s services, clock and random bytes', async () => {
    const limits = vi.spyOn(services().limiter, 'limit');
    const started = Date.now();
    const first = await answer(diagRouteModule.POST(request(body())));
    const second = await answer(diagRouteModule.POST(request(body())));
    expect([first.status, second.status]).toStrictEqual([201, 201]);
    const codes = [(first.body as { code: string }).code, (second.body as { code: string }).code];
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(codes[0]).not.toBe(codes[1]);
    const kept = await rows();
    expect(kept.map((r) => r.code)).toStrictEqual(codes);
    const at = (kept[0]!.createdAt as Date).getTime();
    expect([at >= started, at <= Date.now()]).toStrictEqual([true, true]);
    expect(limits.mock.calls.map((c) => c[0])).toStrictEqual([rateKey('diag', '203.0.113.1', services().rateSecret), rateKey('diag', '203.0.113.1', services().rateSecret)]);
  });

  it('answers 503 when the database fails, logging only the error’s kind', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const failing = (): DiagDeps =>
      deps({
        db: () => {
          throw new Error('connect ECONNREFUSED panel.example.com');
        },
      });
    expect(await answer(diagRoute((d) => postDiag(d, request(body())), failing))).toStrictEqual({ status: 503, body: { error: 'unavailable' }, ...TV_ANSWER });
    expect(logged).toStrictEqual(['diag: post failed (Error)']);
    // Without a database URL the route's own services fail the same way.
    delete process.env.DATABASE_URL;
    resetServices();
    expect((await answer(diagRouteModule.POST(request(body())))).status).toBe(503);
  });
});
