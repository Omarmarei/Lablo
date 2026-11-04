import { gzipSync } from 'node:zlib';
import type { CatalogItem, EpgBucket, EpgProgramme } from '@zoma/core';
import { EpgGuideReader, EpgWantedSet, epgNowNext, epgProgrammes, mergeEpgBuckets } from '@zoma/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fnv1a } from './bytes';
import { markChecked } from './catalog-store';
import type { EpgIngestOptions, EpgProgress, EpgRefreshJob, EpgSwap } from './epg-ingest';
import { EPG_INGEST_VERSION, runEpgRefresh } from './epg-ingest';
import type { EpgGuide } from './epg-sources';
import { epgRefreshDue } from './epg-sources';
import { beginEpgGeneration, getEpgMeta, getEpgMetas, putEpgChannels, readEpgChannels } from './epg-store';
import { openDatabase } from './idb';
import { QueryService } from './query-service';
import { CancelError, CancelSource } from './rpc';
import { STORE } from './schema';
import type { FakeResponse } from './test-support';
import { dumpStore, fakeTransport, freshFactory, ingest, item } from './test-support';

const NOW = Date.UTC(2026, 10, 2, 12);
const MIN = 60_000;
const DAY = 86_400_000;
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** XMLTV time of an epoch minute, written at `offset` minutes east of UTC (or without a zone). */
function xmltvTime(minute: number, offset: number | null = 0): string {
  const d = new Date((minute + (offset ?? 0)) * MIN);
  const wall = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
  if (offset === null) return wall;
  const sign = offset < 0 ? '-' : '+';
  return `${wall} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
}

interface GuideOptions {
  channels?: string[];
  /** Slot length per channel, in minutes. */
  slot?: (channel: string) => number;
  /** Days around NOW covered. */
  from?: number;
  to?: number;
  offset?: number | null;
  /** Programmes sorted by time over every channel (fragments), not grouped by channel. */
  byTime?: boolean;
  tag?: string;
}

/** A guide: channels `a.tv`, `b.tv`, ... with slots from `from` to `to` days around NOW. */
function guide(o: GuideOptions = {}): string {
  const channels = o.channels ?? ['a.tv', 'b.tv', 'c.tv', 'z.tv'];
  const slot = o.slot ?? ((c: string) => [30, 45, 60, 90][channels.indexOf(c) % 4]!);
  const start = Math.floor(NOW / DAY + (o.from ?? -3)) * 1440;
  const end = Math.floor(NOW / DAY + (o.to ?? 5)) * 1440;
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>'];
  for (const c of channels) lines.push(`<channel id="${c}"><display-name>${c.toUpperCase()}</display-name></channel>`);
  const progs: { at: number; text: string }[] = [];
  for (const c of channels) {
    for (let t = start, i = 0; t < end; t += slot(c), i++) {
      const title = `${c} ${o.tag ?? ''}${i}`;
      progs.push({ at: t, text: `<programme start="${xmltvTime(t, o.offset)}" stop="${xmltvTime(t + slot(c), o.offset)}" channel="${c}"><title>${title}</title><desc>About ${title}</desc></programme>` });
    }
  }
  if (o.byTime) progs.sort((x, y) => x.at - y.at);
  for (const p of progs) lines.push(p.text);
  lines.push('</tv>', '');
  return lines.join('\n');
}

/** Live channels: a.tv twice (once with tvg-shift +1), b.tv, c.tv by name only, an unmatched one. */
function catalogItems(src = 'tv'): CatalogItem[] {
  const live = (id: number, name: string, epgId: string | null, tvgShift = 0): CatalogItem => ({ ...item(src, 'live', id, name), epgId, tvgShift });
  return [live(1, 'Alpha', 'a.tv'), live(2, 'Alpha +1', 'A.TV', 1), live(3, 'Bravo', 'b.tv'), live(4, 'C.TV HD', null), live(5, 'Nothing', 'none.tv'), item(src, 'movie', 9, 'A Film')];
}

let db: IDBDatabase;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
  await ingest(db, 'tv', catalogItems());
});
afterEach(() => {
  db.close();
});

const G: EpgGuide = { epgSrc: 'tv:tvg0', url: 'http://p.test/guide.xml?u=secret', zone: { minutes: 0 } };

function refresh(respond: (url: string, headers: Record<string, string>) => FakeResponse, job: Partial<EpgRefreshJob> = {}, options: Partial<EpgIngestOptions> = {}, database = db) {
  const transport = fakeTransport(respond);
  const result = runEpgRefresh({ guides: [G], tier: 'full', languages: ['en'], ...job }, { db: database, transport, now: () => NOW, ...options });
  return { transport, result };
}

/** The reader's buckets for `text`, merged in memory: what the store must hold. */
async function expected(text: string, tier: 'full' | 'low' = 'full', fallback = 0, nowMs = NOW): Promise<Map<string, string[]>> {
  const q = new QueryService({ openDb: async () => db });
  const items: CatalogItem[] = [];
  for (const cat of await q.categories('tv', 'live')) for (let n = 0; n < cat.chunks.length; n++) items.push(...(await q.chunk({ src: 'tv', kind: 'live', catIdx: cat.catIdx, chunk: n })));
  const reader = new EpgGuideReader({ epgSrc: G.epgSrc, wanted: EpgWantedSet.fromItems(items), tier, nowMs, languages: ['en'], fallback, flushAt: 1_000_000 });
  const merged = new Map<string, EpgBucket>();
  for (const b of [...reader.push(text), ...reader.end()]) {
    const k = `${b.channel}|${b.day}`;
    const before = merged.get(k);
    merged.set(k, before ? mergeEpgBuckets(before, b) : b);
  }
  return new Map([...merged].map(([k, b]) => [k, epgProgrammes(b).map(show)]));
}

const show = (p: EpgProgramme): string => `${p.start}-${p.end} ${p.title} | ${p.desc} | ${p.flags}`;

/** The buckets stored for generation `gen` of `epgSrc`. */
async function stored(gen: number, epgSrc = G.epgSrc, database = db): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const [key, value] of await dumpStore(database, STORE.epgBuckets)) {
    const [src, g, channel, day] = key as [string, number, string, number];
    if (src !== epgSrc || g !== gen) continue;
    out.set(`${channel}|${day}`, epgProgrammes({ channel, day, merge: false, ...(value as Omit<EpgBucket, 'channel' | 'day' | 'merge'>) }).map(show));
  }
  return out;
}

const hashOf = (text: string): string => {
  const h = new Fnv1a();
  h.update(new TextEncoder().encode(text));
  return h.digest();
};

describe('runEpgRefresh', () => {
  it('stores exactly what the reader keeps, fragments merged, and swaps it in', async () => {
    const text = guide({ byTime: true });
    const swaps: EpgSwap[] = [];
    const progress: EpgProgress[] = [];
    let clock = NOW;
    const { result, transport } = refresh(() => ({ body: text, chunk: 700, headers: { 'Content-Length': String(text.length) } }), {}, {
      flushAt: 25,
      now: () => (clock += 10),
      onSwap: (s) => swaps.push(s),
      onProgress: (p) => progress.push(p),
    });
    const r = await result;
    expect(r.deleted).toEqual([]);
    expect(r.wanted).toBe(5);
    const [outcome] = r.outcomes;
    expect(outcome!.error).toBeNull();
    const res = outcome!.result!;
    expect(res).toMatchObject({ epgSrc: G.epgSrc, status: 'committed', gen: 1, previous: 0, gzipped: false });
    expect(res.fetch).toEqual({ v: EPG_INGEST_VERSION, hash: hashOf(text), bytes: text.length, etag: null, lastModified: null });
    // a.tv by id (twice; Xtream keys, so `xtream-id`), b.tv by id, c.tv by match name; z.tv feeds nothing.
    expect(res.summary).toMatchObject({ wanted: 5, matched: 4, byMethod: { 'xtream-id': 3, 'match-name': 1 }, declared: 4, used: 3, pastDays: 1, futureDays: 7 });
    expect(transport.requests).toEqual([{ url: G.url, headers: {} }]);
    expect(swaps).toEqual([{ epgSrc: G.epgSrc, gen: 1, previous: 0 }]);
    expect(progress.some((p) => p.bytes > 0 && p.total === text.length && p.kept > 0)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ bytes: text.length, kept: res.summary!.kept });

    const want = await expected(text);
    expect(await stored(1)).toEqual(want);
    // The time-sorted guide really came in fragments, and each channel-day is one record.
    expect([...want.keys()].every((k) => !k.startsWith('z.tv'))).toBe(true);
    expect(res.summary!.buckets).toBeGreaterThan(want.size);

    const meta = (await getEpgMeta(db, G.epgSrc))!;
    const ends = [...want.values()].flat().map((s) => Number(s.split(' ')[0]!.split('-')[1]));
    expect(meta).toMatchObject({ gen: 1, building: null, rank: 0, until: Math.max(...ends), basis: `v${EPG_INGEST_VERSION}|full|tv:1|-` });
    const [table] = await readEpgChannels(db, [{ epgSrc: G.epgSrc, gen: 1 }]);
    expect(table!.matches.map((m) => `${m.key} ${m.channel} ${m.method} ${m.shift}`)).toEqual([
      'x:tv:live:1 a.tv xtream-id 0',
      'x:tv:live:2 a.tv xtream-id 1',
      'x:tv:live:3 b.tv xtream-id 0',
      'x:tv:live:4 c.tv match-name 0',
    ]);
    expect(table!.channels.map((c) => `${c.id} ${c.name}`)).toEqual(['a.tv A.TV', 'b.tv B.TV', 'c.tv C.TV']);
    expect(table!.unmatched).toEqual([{ key: 'x:tv:live:5', name: 'Nothing', epgId: 'none.tv' }]);
  });

  it('gives now and next from the store, with tvg-shift, for the query side', async () => {
    const text = guide();
    await refresh(() => ({ body: text })).result;
    const q = new QueryService({ openDb: async () => db, now: () => NOW + 7 * MIN });
    const keys = ['x:tv:live:1', 'x:tv:live:2', 'x:tv:live:3', 'x:tv:live:4', 'x:tv:live:5', 'x:tv:live:404'];
    const got = await q.nowNext(keys);
    // The same from the reader's own buckets.
    const reader = new EpgGuideReader({ epgSrc: G.epgSrc, wanted: EpgWantedSet.fromItems(catalogItems()), tier: 'full', nowMs: NOW, languages: ['en'] });
    const all = [...reader.push(text), ...reader.end()];
    const of = (channel: string): EpgBucket[] => all.filter((b) => b.channel === channel);
    const at = NOW + 7 * MIN;
    expect(got.map((g) => [g.key, g.channel, g.method, g.now?.title ?? null, g.next?.title ?? null])).toEqual([
      ['x:tv:live:1', 'a.tv', 'xtream-id', epgNowNext(of('a.tv'), at).now!.title, epgNowNext(of('a.tv'), at).next!.title],
      ['x:tv:live:2', 'a.tv', 'xtream-id', epgNowNext(of('a.tv'), at, 1).now!.title, epgNowNext(of('a.tv'), at, 1).next!.title],
      ['x:tv:live:3', 'b.tv', 'xtream-id', epgNowNext(of('b.tv'), at).now!.title, epgNowNext(of('b.tv'), at).next!.title],
      ['x:tv:live:4', 'c.tv', 'match-name', epgNowNext(of('c.tv'), at).now!.title, epgNowNext(of('c.tv'), at).next!.title],
      ['x:tv:live:5', null, null, null, null],
      ['x:tv:live:404', null, null, null, null],
    ]);
    // a.tv runs 30-minute slots: at 12:07 the 12:00 one is on, the +1 copy shows 11:00's an hour later.
    expect(got[0]!.now).toMatchObject({ start: NOW / MIN, end: NOW / MIN + 30 });
    expect(got[1]!.now).toMatchObject({ start: NOW / MIN, end: NOW / MIN + 30, title: got[0]!.now!.title.replace(/\d+$/, (n) => String(Number(n) - 2)) });
    // Just before midnight UTC, the next programme is stored under the next day.
    const late = await q.nowNext(['x:tv:live:3'], Date.UTC(2026, 10, 2, 23, 59));
    expect(late[0]!.next!.start).toBe(Date.UTC(2026, 10, 3) / MIN);
    expect((await q.epgStatus())).toMatchObject({ matched: 4, guides: [{ epgSrc: G.epgSrc, gen: 1 }] });
  });

  it('gives the grid guide the stored programmes over a range, as now/next has them', async () => {
    const text = guide();
    await refresh(() => ({ body: text })).result;
    const q = new QueryService({ openDb: async () => db });
    const reader = new EpgGuideReader({ epgSrc: G.epgSrc, wanted: EpgWantedSet.fromItems(catalogItems()), tier: 'full', nowMs: NOW, languages: ['en'] });
    const all = [...reader.push(text), ...reader.end()];
    const keys = ['x:tv:live:1', 'x:tv:live:2', 'x:tv:live:3', 'x:tv:live:4', 'x:tv:live:5'];
    const channels = ['a.tv', 'a.tv', 'b.tv', 'c.tv'];
    const shifts = [0, 60, 0, 0];
    // Across midnight UTC, five hours.
    const from = Math.floor(NOW / DAY + 1) * 1440 - 150;
    const to = from + 300;
    const rows = await q.guide({ keys, from, to });
    expect(rows.map((r) => r.epgSrc)).toEqual([G.epgSrc, G.epgSrc, G.epgSrc, G.epgSrc, null]);
    channels.forEach((channel, i) => {
      const s = shifts[i]!;
      const want = all
        .filter((b) => b.channel === channel)
        .sort((x, y) => x.day - y.day)
        .flatMap((b) => epgProgrammes(b))
        .filter((p) => p.start + s < to && p.end + s > from)
        .map((p) => `${p.start + s}-${p.end + s} ${p.title}`);
      const r = rows[i]!;
      expect(want.length, channel).toBeGreaterThan(2);
      expect(r.start.map((t, j) => `${t}-${r.end[j]} ${r.title[j]}`), keys[i]).toEqual(want);
    });
    for (let t = from; t < to; t += 25) {
      const nn = await q.nowNext(keys.slice(0, 4), t * MIN);
      nn.forEach((n, i) => {
        const r = rows[i]!;
        const on = r.start.findIndex((st, j) => st <= t && t < r.end[j]!);
        expect(r.title[on], `${keys[i]} at ${t}`).toBe(n.now!.title);
      });
    }
  });

  it('finds a programme that started the day before, and prefers the guide listed first', async () => {
    // 100-minute slots from 3 days back: one starts 20 minutes before midnight UTC of NOW's day.
    const spanning = guide({ slot: () => 100, tag: 'first ' });
    const second = guide({ tag: 'second ' });
    const other: EpgGuide = { epgSrc: 'u~x', url: 'http://p.test/x.xml', zone: { minutes: 0 } };
    // `u~x` is listed first, although `tv:tvg0` sorts before it by id.
    await refresh((url) => ({ body: url === other.url ? spanning : second }), { guides: [other, G] }).result;
    const q = new QueryService({ openDb: async () => db });
    const midnight = Math.floor(NOW / DAY) * DAY;
    const [a] = await q.nowNext(['x:tv:live:1'], midnight + 5 * MIN);
    expect(a).toMatchObject({ epgSrc: 'u~x', now: { start: midnight / MIN - 20, end: midnight / MIN + 80 } });
    expect(a!.now!.title).toMatch(/^a\.tv first \d+$/);
  });

  it('stops at a 304 for its own validators, and prunes past days instead', async () => {
    const text = guide();
    await refresh(() => ({ body: text, headers: { ETag: '"v1"', 'Last-Modified': 'Mon, 02 Nov 2026 10:00:00 GMT' } })).result;
    const before = await stored(1);
    const later = NOW + 3 * DAY;
    const { transport, result } = refresh((_url, headers) => (headers['If-None-Match'] === '"v1"' ? { status: 304 } : { body: text }), {}, { now: () => later });
    const [o] = (await result).outcomes;
    expect(o!.result).toMatchObject({ status: 'unchanged', gen: 1, previous: 1, fetch: null });
    expect(transport.requests[0]!.headers).toEqual({ 'If-None-Match': '"v1"', 'If-Modified-Since': 'Mon, 02 Nov 2026 10:00:00 GMT' });
    expect((await getEpgMeta(db, G.epgSrc))!.checkedAt).toBe(later);
    // 1 past day kept around the new now, plus the day before it.
    const firstDay = Math.floor(later / DAY) - 2;
    const after = await stored(1);
    expect([...after.keys()].sort()).toEqual([...before.keys()].filter((k) => Number(k.split('|')[1]) >= firstDay).sort());
    expect(after.size).toBeLessThan(before.size);
  });

  it('drops a new generation built from the same bytes, but reads them again for a new catalog', async () => {
    const text = guide();
    await refresh(() => ({ body: text })).result;
    const again = await refresh(() => ({ body: text })).result;
    expect(again.outcomes[0]!.result).toMatchObject({ status: 'unchanged', gen: 1, fetch: { hash: hashOf(text) } });
    expect((await getEpgMeta(db, G.epgSrc))!.nextGen).toBe(3);
    expect([...new Set((await dumpStore(db, STORE.epgBuckets)).map(([k]) => (k as unknown[])[1]))]).toEqual([1]);

    // The provider renames C.TV HD: a new catalog generation, so the same guide bytes are read again.
    await ingest(db, 'tv', catalogItems().map((i) => (i.name === 'C.TV HD' ? { ...i, name: 'Charlie', normName: 'charlie', matchName: null } : i)));
    const third = refresh(() => ({ body: text }));
    const r = (await third.result).outcomes[0]!.result!;
    expect(r).toMatchObject({ status: 'committed', gen: 3, previous: 1, summary: { matched: 3 } });
    expect(third.transport.requests[0]!.headers).toEqual({});
    expect((await getEpgMeta(db, G.epgSrc))!.basis).toBe(`v${EPG_INGEST_VERSION}|full|tv:2|-`);
    expect([...(await stored(3)).keys()].some((k) => k.startsWith('c.tv'))).toBe(false);
    expect(await stored(1)).toEqual(new Map());
    // `force` reads unchanged bytes again too.
    const forced = await refresh(() => ({ body: text }), { force: true }).result;
    expect(forced.outcomes[0]!.result).toMatchObject({ status: 'committed', gen: 4 });
  });

  it('keeps the old generation through a crash mid-ingest, and the next refresh cleans up', async () => {
    const factory = freshFactory();
    const crashDb = await openDatabase(factory);
    await ingest(crashDb, 'tv', catalogItems());
    const first = guide({ tag: 'old ' });
    await refresh(() => ({ body: first }), {}, {}, crashDb).result;
    const before = await stored(1, G.epgSrc, crashDb);
    const q = new QueryService({ openDb: async () => crashDb });
    const nowNext = await q.nowNext(['x:tv:live:1'], NOW);

    const second = guide({ tag: 'new ' });
    const { result } = refresh(() => ({ body: second, chunk: 500, beforeChunk: (n) => (n === 150 ? crashDb.close() : undefined) }), {}, { flushAt: 10 }, crashDb);
    const crashed = await result;
    expect(crashed.outcomes[0]!.error).not.toBeNull();

    const reopened = await openDatabase(factory);
    try {
      const meta = (await getEpgMeta(reopened, G.epgSrc))!;
      expect(meta).toMatchObject({ gen: 1, building: 2 });
      expect(await stored(1, G.epgSrc, reopened)).toEqual(before);
      const q2 = new QueryService({ openDb: async () => reopened });
      expect(await q2.nowNext(['x:tv:live:1'], NOW)).toEqual(nowNext);
      // Something of generation 2 was written before the crash; the next refresh prunes it.
      expect((await dumpStore(reopened, STORE.epgBuckets)).some(([k]) => (k as unknown[])[1] === 2)).toBe(true);
      const next = await refresh(() => ({ body: second }), {}, {}, reopened).result;
      expect(next.outcomes[0]!.result).toMatchObject({ status: 'committed', gen: 3, previous: 1 });
      expect([...new Set((await dumpStore(reopened, STORE.epgBuckets)).map(([k]) => (k as unknown[])[1]))]).toEqual([3]);
    } finally {
      reopened.close();
    }
  });

  it('fails a guide cut short or not XMLTV, keeps the stored one, and still reads the others', async () => {
    const good = guide();
    const guides: EpgGuide[] = [
      { epgSrc: 'u~cut', url: 'http://p.test/cut.xml', zone: { minutes: 0 } },
      { epgSrc: 'u~html', url: 'http://p.test/page.html', zone: { minutes: 0 } },
      { epgSrc: 'u~401', url: 'http://p.test/denied.xml', zone: { minutes: 0 } },
      { epgSrc: 'u~404', url: 'http://p.test/missing.xml', zone: { minutes: 0 } },
      { epgSrc: 'u~net', url: 'http://p.test/drop.xml', zone: { minutes: 0 } },
      G,
    ];
    const respond = (url: string): FakeResponse => {
      if (url.includes('cut')) return { body: good.slice(0, Math.floor(good.length / 2) + 7) };
      if (url.includes('page')) return { body: '<html><body>Hello</body></html>' };
      if (url.includes('denied')) return { status: 401 };
      if (url.includes('missing')) return { status: 404 };
      if (url.includes('drop')) return { body: good, failAfter: 2000 };
      return { body: good };
    };
    const r = await refresh(respond, { guides }, { now: () => NOW + 1 }).result;
    expect(r.outcomes.map((o) => [o.epgSrc, o.error?.code ?? o.result!.status, o.error?.message ?? ''])).toEqual([
      ['u~cut', 'format', 'The guide was cut short'],
      ['u~html', 'format', 'This is not an XMLTV guide'],
      ['u~401', 'auth', 'Catalog refresh failed: auth (HTTP 401)'],
      ['u~404', 'http', 'Catalog refresh failed: http (HTTP 404)'],
      ['u~net', 'network', 'Connection lost'],
      [G.epgSrc, 'committed', ''],
    ]);
    for (const o of r.outcomes) expect(o.error?.message ?? '').not.toContain('p.test');
    expect(r.outcomes.map((o) => o.error?.status ?? null)).toEqual([null, null, 401, 404, null, null]);
    const metas = await getEpgMetas(db);
    expect(metas.filter((m) => m.failedAt === NOW + 1).map((m) => m.epgSrc).sort()).toEqual(['u~401', 'u~404', 'u~cut', 'u~html', 'u~net']);
    // Why each one failed is kept for the guides screen (step 22b), never a message or a URL.
    expect(metas.map((m) => [m.epgSrc, m.failure ?? null]).sort()).toEqual([
      [G.epgSrc, null],
      ['u~401', { code: 'auth', status: 401 }],
      ['u~404', { code: 'http', status: 404 }],
      ['u~cut', { code: 'format', status: null }],
      ['u~html', { code: 'format', status: null }],
      ['u~net', { code: 'network', status: null }],
    ]);
    expect(metas.every((m) => m.building === null)).toBe(true);
    expect(epgRefreshDue(metas.find((m) => m.epgSrc === 'u~cut'), NOW + 2)).toBeNull();
    // Nothing of the failed guides was kept.
    expect((await dumpStore(db, STORE.epgBuckets)).every(([k]) => (k as unknown[])[0] === G.epgSrc)).toBe(true);
    // A refresh that works clears the failure.
    await refresh(() => ({ body: good }), { guides, only: ['u~404'] }, { now: () => NOW + 3 * 3_600_000 }).result;
    expect(await getEpgMeta(db, 'u~404')).toMatchObject({ gen: 1, failedAt: null, failure: null });
    expect(await getEpgMeta(db, 'u~401')).toMatchObject({ failure: { code: 'auth', status: 401 } });
  });

  it('sets the ranks of listed guides with no download, and reads no live item when it reads no guide (step 22b)', async () => {
    const text = guide();
    const other: EpgGuide = { epgSrc: 'u~x', url: 'http://p.test/x.xml', zone: { minutes: 0 } };
    const first = await refresh(() => ({ body: text }), { guides: [other, G] }).result;
    expect(first.reranked).toEqual([]);
    expect(first.wanted).toBeGreaterThan(0);
    const ranks = async (): Promise<string[]> => (await getEpgMetas(db)).map((m) => `${m.epgSrc} ${m.rank}`).sort();
    expect(await ranks()).toEqual(['tv:tvg0 1', 'u~x 0']);
    const before = await stored(1);
    let asked = 0;
    const swaps: EpgSwap[] = [];
    const moved = await refresh(
      () => {
        asked += 1;
        return { body: text };
      },
      { guides: [G, other], only: [] },
      { onSwap: (s) => swaps.push(s) },
    ).result;
    expect(moved).toEqual({ outcomes: [], deleted: [], reranked: [G.epgSrc, 'u~x'], wanted: 0 });
    expect(asked).toBe(0);
    expect(swaps).toEqual([]);
    expect(await ranks()).toEqual(['tv:tvg0 0', 'u~x 1']);
    expect(await stored(1)).toEqual(before);
    // The same order again: nothing to set.
    expect((await refresh(() => ({ body: text }), { guides: [G, other], only: [] }).result).reranked).toEqual([]);
    // A guide read in its new place gets that rank too, and the one not read is set beside it.
    const read = await refresh(() => ({ body: text }), { guides: [other, G], only: ['u~x'] }).result;
    expect(read.reranked.sort()).toEqual([G.epgSrc, 'u~x']);
    expect(await ranks()).toEqual(['tv:tvg0 1', 'u~x 0']);
  });

  it('reads gzip, deletes guides no longer listed, and reports nothing to match', async () => {
    const text = guide();
    const gz = new Uint8Array(gzipSync(text));
    const r = await refresh(() => ({ body: gz, chunk: 333 }), { tier: 'low' }).result;
    expect(r.outcomes[0]!.result).toMatchObject({ status: 'committed', gzipped: true, summary: { pastDays: 1, futureDays: 3 } });
    expect(await stored(1)).toEqual(await expected(text, 'low'));

    const swaps: EpgSwap[] = [];
    const other: EpgGuide = { epgSrc: 'u~x', url: 'http://p.test/x.xml', zone: { minutes: 0 } };
    const r2 = await refresh(() => ({ body: text }), { guides: [other] }, { onSwap: (s) => swaps.push(s) }).result;
    expect(r2.deleted).toEqual([G.epgSrc]);
    expect(swaps).toEqual([
      { epgSrc: G.epgSrc, gen: 0, previous: 1 },
      { epgSrc: 'u~x', gen: 1, previous: 0 },
    ]);
    expect(await getEpgMeta(db, G.epgSrc)).toBeNull();
    expect(await stored(1)).toEqual(new Map());

    // `only` reads a subset but keeps the other listed guides.
    const r3 = await refresh(() => ({ body: text }), { guides: [other, G], only: [G.epgSrc] }).result;
    expect(r3.outcomes.map((o) => o.epgSrc)).toEqual([G.epgSrc]);
    expect((await getEpgMetas(db)).map((m) => `${m.epgSrc} ${m.rank}`).sort()).toEqual(['tv:tvg0 1', 'u~x 0']);

    const empty = await openDatabase(freshFactory());
    try {
      const r4 = await refresh(() => ({ body: text }), {}, {}, empty).result;
      expect(r4.outcomes[0]!.error).toEqual({ code: 'empty', status: null, message: 'There are no live channels to match a guide to' });
    } finally {
      empty.close();
    }
  });

  it('prunes the leftovers and past days of listed guides it does not read this time', async () => {
    const text = guide();
    await refresh(() => ({ body: text })).result;
    const before = await stored(1);
    // A crashed refresh of G left generation 2 half written.
    const g2 = await beginEpgGeneration(db, G.epgSrc);
    await putEpgChannels(db, G.epgSrc, g2, { matches: [], channels: [], unmatched: [] });
    const other: EpgGuide = { epgSrc: 'u~x', url: 'http://p.test/x.xml', zone: { minutes: 0 } };
    const later = NOW + 3 * DAY;
    const r = await refresh(() => ({ body: text }), { guides: [G, other], only: ['u~x'] }, { now: () => later }).result;
    expect(r.outcomes.map((o) => o.epgSrc)).toEqual(['u~x']);
    expect(await getEpgMeta(db, G.epgSrc)).toMatchObject({ gen: 1, building: null });
    expect((await dumpStore(db, STORE.epgChannels)).map(([k]) => (k as unknown[]).join(' '))).toEqual(['tv:tvg0 1', 'u~x 1']);
    const firstDay = Math.floor(later / DAY) - 2;
    expect([...(await stored(1)).keys()].sort()).toEqual([...before.keys()].filter((k) => Number(k.split('|')[1]) >= firstDay).sort());
  });

  it('reads times without an offset in the panel zone of an Xtream source', async () => {
    // A panel 3 hours east of UTC (its clock says so; no zone name).
    await markChecked(db, 'tv', NOW, { server: { timezone: null, timeNow: '2026-11-02 15:00:00', timestampNow: NOW / 1000, url: null, port: null, httpsPort: null, protocol: null } as never });
    const local = guide({ offset: null, slot: () => 60 });
    const xt: EpgGuide = { epgSrc: 'tv:xmltv', url: 'http://p.test/xmltv.php', zone: { panel: 'tv' } };
    await refresh(() => ({ body: local }), { guides: [xt] }).result;
    // Wall 15:00 there is 12:00 UTC.
    const q = new QueryService({ openDb: async () => db });
    const [a] = await q.nowNext(['x:tv:live:1'], NOW + MIN);
    expect(a!.now!.start).toBe(NOW / MIN);
    expect(await stored(1, 'tv:xmltv')).toEqual(await expected(local, 'full', 180));
  });

  it('cancels the whole refresh and keeps nothing of it', async () => {
    const cancel = new CancelSource();
    const text = guide();
    const { result } = refresh(() => ({ body: text, chunk: 500, beforeChunk: (n) => (n === 2 ? cancel.cancel() : undefined) }), {}, { token: cancel.token });
    await expect(result).rejects.toBeInstanceOf(CancelError);
    expect(await dumpStore(db, STORE.epgBuckets)).toEqual([]);
    expect((await getEpgMeta(db, G.epgSrc))!).toMatchObject({ gen: 0, building: null });
  });
});
