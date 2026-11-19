import type { DiagReport, TelemetryEvent } from '@lablo/protocol';
import { diagRequestSchema } from '@lablo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ByteRequest, ByteResponse, ByteTransport } from './bytes';
import { NetworkError } from './bytes';
import type { SourceMeta } from './catalog-store';
import type { EpgMeta } from './epg-store';
import { openDatabase, transact } from './idb';
import type { ProfileDoc } from './profile';
import { emptyProfile, saveProfile } from './profile';
import { STORE } from './schema';
import type { DiagParts, DiagSendRequest } from './telemetry-service';
import { DIAG_ANSWER_MAX_BYTES, diagGuide, diagReport, diagSource, TELEMETRY_TIMEOUT_MS, telemetryHandlers } from './telemetry-service';
import type { Clock } from './throttle';
import { freshFactory } from './test-support';

/**
 * The telemetry worker's diagnostics report (RELAY step 33d2): what it reads from the database, what
 * it posts (read by the server's own schema), nothing of a source's name, link, server or login in
 * the body, and the code it answers.
 */

const opened: IDBDatabase[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

const BASE = 'http://api.test';
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);

const PARTS: DiagParts = {
  at: NOW - 5,
  zoneMin: 180,
  locale: 'ar',
  tier: 'low',
  model: '43UK6300PLB',
  firmware: '05.30.40',
  chromium: 68,
  probes: { year: 2018, lowTier: true, mse: true, hevc: false },
  config: 'cached',
};

/** The user's own things, none of which may reach the body. */
const XTREAM = { id: 'src-marker-x', type: 'xtream', name: 'Marker Panel', account: { base: 'http://panel.marker.example:8080', username: 'marker-user', password: 'marker-pass' }, added: 1 };
const M3U = { id: 'src-marker-m', type: 'm3u', name: 'Marker List', url: 'http://lists.marker.example/get.php?token=marker-token', added: 2 };
const FILE = { id: 'src-marker-f', type: 'm3u-file', name: 'Marker File', added: 3 };
const XTREAM_BARE = { id: 'src-marker-b', type: 'xtream', name: 'Marker Bare', account: null, base: 'http://bare.marker.example', added: 4 };
const M3U_BARE = { id: 'src-marker-n', type: 'm3u', name: 'Marker No Link', url: null, origin: 'http://nolink.marker.example', added: 5 };
const GUIDE = { id: 'g-marker', url: 'http://epg.marker.example/guide.xml?password=marker-epg', origin: 'http://epg.marker.example', added: 6 };
const MARKERS = ['marker', 'Marker', 'src-', 'panel', 'epg.', '//', '8080', 'token', 'password'];

function meta(src: string, fields: Partial<SourceMeta>): SourceMeta {
  return { src, gen: 1, building: null, nextGen: 2, updatedAt: null, counts: {}, ...fields };
}

function guideMeta(epgSrc: string, rank: number, fields: Partial<EpgMeta> = {}): EpgMeta {
  return { epgSrc, gen: 1, building: null, nextGen: 2, updatedAt: null, checkedAt: null, rank, ...fields };
}

function summary(programmes: number, matched: number, wanted: number): EpgMeta['summary'] {
  // (Kept in the window: none, so a report that read `kept` would show it.)
  return { wanted, matched, byMethod: {} as never, ambiguous: 0, declared: 10, used: 4, programmes, kept: 0, buckets: 1, pastDays: 1, futureDays: 3 } as EpgMeta['summary'];
}

const play = (at: number): TelemetryEvent => ({ kind: 'play_result', at, engine: 'html5', container: 'hls', mode: 'live', ttffMs: 800, error: null });
const STALL: TelemetryEvent = { kind: 'stall', at: NOW - 40, recovered: true, attempts: 2 };
const CRASH: TelemetryEvent = { kind: 'crash', at: NOW - 30, where: 'main', stack: 'Uncaught Error: no marker-user at http://panel.marker.example:8080/live/marker-user/marker-pass/1.ts\n    at e (file:///app/main.js:1:2)' };

function request(events: TelemetryEvent[] = [play(NOW - 50), STALL, CRASH], fields: Partial<DiagSendRequest> = {}): DiagSendRequest {
  return { base: BASE, platform: 'webos', appVersion: '1.2.3', parts: PARTS, events, ...fields };
}

/** How the transport answers the post: a status and a body, a network failure, or never. */
type Answer = { readonly status: number; readonly body?: string; readonly broken?: boolean } | 'network' | 'hang';

function apiTransport(answer: Answer = { status: 201, body: '{"code":"K7M2Q9"}' }) {
  const posts: { url: string; method: string | undefined; headers: Record<string, string>; body: string }[] = [];
  let cancelled = 0;
  const transport: ByteTransport = {
    get(url: string, req: ByteRequest = {}): Promise<ByteResponse> {
      posts.push({ url, method: req.method, headers: { ...(req.headers ?? {}) }, body: req.body ?? '' });
      if (answer === 'network') return Promise.reject(new NetworkError());
      if (answer === 'hang') return new Promise<ByteResponse>(() => undefined);
      // The body in two chunks, a byte a character.
      const text = answer.body ?? '';
      const chunks = [text.slice(0, 5), text.slice(5)].filter((c) => c !== '').map((c) => Uint8Array.from(c, (ch) => ch.charCodeAt(0)));
      return Promise.resolve({
        status: answer.status,
        header: () => null,
        read: () => {
          if (answer.broken === true) return Promise.reject(new NetworkError());
          return Promise.resolve(chunks.shift() ?? null);
        },
        cancel: () => {
          cancelled++;
        },
      });
    },
  };
  return { transport, posts, cancelled: () => cancelled };
}

function testClock(limit: 'never' | 'now' = 'never'): Clock & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => NOW,
    sleep: (ms) => {
      slept.push(ms);
      return limit === 'now' ? Promise.resolve() : new Promise<void>(() => undefined);
    },
  };
}

async function seed(factory: IDBFactory, doc: Partial<ProfileDoc> | null, metas: SourceMeta[], guides: EpgMeta[]): Promise<void> {
  const db = await openDatabase(factory);
  opened.push(db);
  if (doc !== null) await saveProfile(db, { ...emptyProfile(), ...doc });
  await transact(db, [STORE.sources, STORE.epgMeta], 'readwrite', (tx) => {
    for (const m of metas) tx.objectStore(STORE.sources).put(m);
    for (const g of guides) tx.objectStore(STORE.epgMeta).put(g);
  });
}

function setup(answer?: Answer, limit?: 'never' | 'now') {
  const factory = freshFactory();
  const api = apiTransport(answer);
  const clock = testClock(limit);
  let opens = 0;
  let closes = 0;
  const handlers = telemetryHandlers({
    openDb: async () => {
      opens++;
      const db = await openDatabase(factory);
      opened.push(db);
      const close = db.close.bind(db);
      db.close = () => {
        closes++;
        close();
      };
      return db;
    },
    transport: api.transport,
    clock,
  });
  return { factory, api, clock, report: (req: DiagSendRequest = request()) => handlers.report(req), counts: () => ({ opens, closes }) };
}

/** The posted body as the server reads it. */
function posted(body: string): { platform: string; appVersion: string; report: DiagReport } {
  return diagRequestSchema.parse(JSON.parse(body));
}

const FULL_PROFILE = { sources: [XTREAM, M3U, FILE, XTREAM_BARE, M3U_BARE], guides: [GUIDE], telemetry: false } as unknown as Partial<ProfileDoc>;
const FULL_METAS = [
  meta('src-marker-x', { counts: { live: 1200, movie: 30000, series: 400 }, updatedAt: NOW - 30 * HOUR, checkedAt: NOW - 2 * HOUR }),
  meta('src-marker-m', { counts: { live: 40 }, updatedAt: NOW - 8 * 24 * HOUR }),
  meta('src-marker-f', { counts: {}, updatedAt: null }),
];
const FULL_GUIDES = [
  guideMeta('g-marker', 1, { checkedAt: NOW - 4 * 24 * HOUR, failure: { code: 'http', status: 503 }, summary: summary(120000, 30, 40) }),
  guideMeta('u~src-marker-m', 0, { checkedAt: NOW - 10 * 60_000, summary: summary(800, 40, 40) }),
];

describe('the report', () => {
  it('posts the sources in the profile’s order, the guides in rank order, the switch and main’s parts, read whole by the server’s schema', async () => {
    const t = setup();
    await seed(t.factory, FULL_PROFILE, FULL_METAS, FULL_GUIDES);
    expect(await t.report()).toStrictEqual({ state: 'sent', code: 'K7M2Q9' });
    expect(t.api.posts.map((p) => [p.url, p.method, p.headers])).toStrictEqual([[BASE + '/v1/diag', 'POST', { 'content-type': 'application/json' }]]);
    const body = posted(t.api.posts[0]!.body);
    expect(body).toStrictEqual({
      platform: 'webos',
      appVersion: '1.2.3',
      report: {
        v: 1,
        ...PARTS,
        telemetry: false,
        sources: [
          { type: 'xtream', items: '10k+', checked: '1h+', needs: null },
          { type: 'm3u', items: '10+', checked: '7d+', needs: null },
          { type: 'm3u-file', items: '0', checked: null, needs: null },
          { type: 'xtream', items: '0', checked: null, needs: 'login' },
          { type: 'm3u', items: '0', checked: null, needs: 'link' },
        ],
        guides: [
          { programmes: '100+', matched: '100', checked: '<1h', failure: null },
          { programmes: '100k+', matched: '75-99', checked: '3d+', failure: { code: 'http', status: 503 } },
        ],
        events: [play(NOW - 50), STALL, { ...CRASH, stack: 'Uncaught Error: no [login] at [url]\n    at e (main.js:1:2)' }],
      },
    });
    // The body is exactly what was posted: no field the schema would strip.
    expect(JSON.parse(t.api.posts[0]!.body)).toStrictEqual(body);
    for (const marker of MARKERS) expect([marker, t.api.posts[0]!.body.includes(marker)]).toStrictEqual([marker, false]);
    // One database open, closed before the post's answer.
    expect(t.counts()).toStrictEqual({ opens: 1, closes: 1 });
  });

  it('sends a report with no profile, no catalogs and no events: the switch on', async () => {
    const t = setup();
    expect(await t.report(request([]))).toStrictEqual({ state: 'sent', code: 'K7M2Q9' });
    expect(posted(t.api.posts[0]!.body).report).toStrictEqual({ v: 1, ...PARTS, telemetry: true, sources: [], guides: [], events: [] });
  });

  it('keeps at most 10 sources, 10 guides (the first ranks) and the newest 10 events', async () => {
    const t = setup();
    const many = Array.from({ length: 12 }, (_, i) => ({ ...FILE, id: `f${i}` }));
    const guides = Array.from({ length: 12 }, (_, i) => guideMeta(`g${i}`, 11 - i, { checkedAt: NOW - i * 25 * HOUR }));
    await seed(t.factory, { sources: many } as unknown as Partial<ProfileDoc>, [], guides);
    const events = Array.from({ length: 12 }, (_, i) => play(NOW - 100 + i));
    await t.report(request(events));
    const report = posted(t.api.posts[0]!.body).report;
    expect(report.sources).toHaveLength(10);
    // Rank 0 is g11 (checked 11 × 25 h ago), rank 9 is g2 (50 h ago).
    expect(report.guides.map((g) => g.checked)).toStrictEqual(['7d+', '7d+', '7d+', '7d+', '7d+', '3d+', '3d+', '3d+', '3d+', '1d+']);
    expect(report.events.map((e) => e.at)).toStrictEqual(events.slice(2).map((e) => e.at));
  });
});

describe('its answer', () => {
  it('is the code of a 201 whose body names one, read in chunks', async () => {
    const t = setup({ status: 201, body: '{"code":"AB12CD","more":1}' });
    expect(await t.report()).toStrictEqual({ state: 'sent', code: 'AB12CD' });
    expect(t.clock.slept).toStrictEqual([TELEMETRY_TIMEOUT_MS]);
  });

  it('fails as `answer` when a 201 has no code, a code of another shape, a body that isn’t JSON, or one too long', async () => {
    for (const body of ['{"code":"K7M2QI"}', '{"code":"K7M2Q"}', '{"code":123456}', '{}', 'null', '', '<html>', `{"code":"K7M2Q9","pad":"${'x'.repeat(DIAG_ANSWER_MAX_BYTES)}"}`]) {
      const t = setup({ status: 201, body });
      expect([body.slice(0, 20), await t.report()]).toStrictEqual([body.slice(0, 20), { state: 'failed', failure: 'answer', status: 201 }]);
    }
    // The longest answer read is DIAG_ANSWER_MAX_BYTES (pinned: the edge below is built from it).
    expect(DIAG_ANSWER_MAX_BYTES).toBe(1024);
    const edge = `{"code":"K7M2Q9","pad":"${'x'.repeat(DIAG_ANSWER_MAX_BYTES - 26)}"}`;
    expect(edge.length).toBe(DIAG_ANSWER_MAX_BYTES);
    expect(await setup({ status: 201, body: edge }).report()).toStrictEqual({ state: 'sent', code: 'K7M2Q9' });
    expect(await setup({ status: 201, body: edge + ' ' }).report()).toStrictEqual({ state: 'failed', failure: 'answer', status: 201 });
    const long = setup({ status: 201, body: edge + ' ' });
    await long.report();
    expect(long.api.cancelled()).toBe(1);
  });

  it('fails as `status` with another status, without reading the body', async () => {
    for (const status of [200, 400, 413, 429, 503]) {
      const t = setup({ status, body: '{"code":"K7M2Q9"}' });
      expect(await t.report()).toStrictEqual({ state: 'failed', failure: 'status', status });
      expect(t.api.cancelled()).toBe(1);
    }
  });

  it('fails as `network` with no connection or a body that breaks off, and as `timeout` past the time limit', async () => {
    expect(await setup('network').report()).toStrictEqual({ state: 'failed', failure: 'network', status: null });
    expect(await setup({ status: 201, body: '{"code":"K7M2Q9"}', broken: true }).report()).toStrictEqual({ state: 'failed', failure: 'network', status: null });
    const hung = setup('hang', 'now');
    expect(await hung.report()).toStrictEqual({ state: 'failed', failure: 'timeout', status: null });
    expect(hung.clock.slept).toStrictEqual([TELEMETRY_TIMEOUT_MS]);
  });

  it('cancels a body that stalls past the time limit', async () => {
    let limit: (() => void) | null = null;
    let cancelled = 0;
    const factory = freshFactory();
    const handlers = telemetryHandlers({
      openDb: () => openDatabase(factory).then((db) => (opened.push(db), db)),
      transport: {
        get: () => Promise.resolve({ status: 201, header: () => null, read: () => new Promise<Uint8Array | null>(() => undefined), cancel: () => void cancelled++ }),
      },
      clock: { now: () => NOW, sleep: () => new Promise<void>((resolve) => (limit = resolve)) },
    });
    const answer = handlers.report(request());
    await expect.poll(() => limit !== null).toBe(true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(cancelled).toBe(0);
    limit!();
    expect(await answer).toStrictEqual({ state: 'failed', failure: 'timeout', status: null });
    expect(cancelled).toBe(1);
  });

  it('cancels an answer that comes after the time limit', async () => {
    let open: ((response: ByteResponse) => void) | null = null;
    let cancelled = 0;
    const factory = freshFactory();
    const handlers = telemetryHandlers({
      openDb: () => openDatabase(factory).then((db) => (opened.push(db), db)),
      transport: { get: () => new Promise<ByteResponse>((resolve) => (open = resolve)) },
      clock: testClock('now'),
    });
    expect(await handlers.report(request())).toStrictEqual({ state: 'failed', failure: 'timeout', status: null });
    open!({ status: 201, header: () => null, read: () => Promise.resolve(null), cancel: () => void cancelled++ });
    await Promise.resolve();
    expect(cancelled).toBe(1);
  });
});

describe('diagSource and diagGuide', () => {
  it('read a source’s items over every kind, its last check (else its last update), and nothing of a record that isn’t a source', () => {
    expect(diagSource(XTREAM, meta('x', { counts: { live: 5, movie: 6 }, checkedAt: NOW - HOUR + 1, updatedAt: NOW - 100 * HOUR }), NOW)).toStrictEqual({ type: 'xtream', items: '10+', checked: '<1h', needs: null });
    expect(diagSource(M3U, meta('m', { counts: { live: 0 }, updatedAt: NOW - 6 * HOUR }), NOW)).toStrictEqual({ type: 'm3u', items: '0', checked: '6h+', needs: null });
    expect(diagSource(M3U, null, NOW)).toStrictEqual({ type: 'm3u', items: '0', checked: null, needs: null });
    for (const record of [null, 'x', { type: 'stalker' }, { ...FILE, type: undefined }]) expect(diagSource(record, null, NOW)).toBeNull();
  });

  it('give a guide’s failure status only from 100 to 599, and a failure code of another shape as `failed`', () => {
    const g = (failure: unknown): unknown => diagGuide(guideMeta('g', 0, { failure: failure as EpgMeta['failure'] }), NOW).failure;
    expect(g({ code: 'network', status: null })).toStrictEqual({ code: 'network', status: null });
    expect(g({ code: 'http', status: 100 })).toStrictEqual({ code: 'http', status: 100 });
    expect(g({ code: 'http', status: 599 })).toStrictEqual({ code: 'http', status: 599 });
    expect(g({ code: 'http', status: 99 })).toStrictEqual({ code: 'http', status: null });
    expect(g({ code: 'http', status: 600 })).toStrictEqual({ code: 'http', status: null });
    expect(g({ code: 'GET http://x failed', status: 404 })).toStrictEqual({ code: 'failed', status: 404 });
    expect(g({ code: 42, status: 404 })).toStrictEqual({ code: 'failed', status: 404 });
    expect(g(null)).toBeNull();
    expect(g(undefined)).toBeNull();
    // A guide never read: no programmes, no match, never checked.
    expect(diagGuide(guideMeta('g', 0), NOW)).toStrictEqual({ programmes: '0', matched: '0', checked: null, failure: null });
  });

  it('build the report from a profile of another shape without failing', () => {
    for (const doc of [undefined, null, 'x', { sources: 'x' }, { sources: [null, 7, { id: 1 }] }]) {
      expect(diagReport(doc, [], [], request([]), NOW).sources).toStrictEqual([]);
    }
  });
});
