// RELAY step 8: the ingest pipeline against the in-process mock provider over a real socket,
// with the real fetch transport (Node's fetch: streamed body, reader.cancel). The mock imports
// nothing from core or data, so its catalog is an independent oracle. "Done when": favourites
// survive a renumbered refresh (every Xtream id shifted), and a refresh that breaks off keeps
// the old generation (the hard-crash case is in packages/data/src/ingest.test.ts).

import type { CatalogItem, ContentKind } from '@lablo/core';
import { panelZone } from '@lablo/core';
import type { FavouriteRef, IngestJob, IngestOptions, ProfileDoc } from '@lablo/data';
import { INGEST_VERSION, IngestError, QueryService, STORE, emptyProfile, fetchTransport, getSource, loadProfile, onSuccess, openDatabase, runIngest, saveProfile, transact } from '@lablo/data';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import { parseScenario } from '../apps/mock-provider/src/faults';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { freshFactory } from '../packages/data/src/test-support';

const DAY = 86_400_000;
const catalog = loadCatalog();

let app: MockServer;
let base: string;
let db: IDBDatabase;

beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  app.mockState.catalog = catalog;
  db = await openDatabase(freshFactory());
});
afterEach(() => {
  db.close();
});

const m3uJob = (query = ''): IngestJob => ({ src: 'pl', source: { type: 'm3u', url: `${base}/get.php?username=${U}&password=${P}&type=m3u_plus${query}` } });
const xtream = (): IngestJob => ({ src: 'xt', source: { type: 'xtream', account: { base, username: U, password: P } } });
const ingest = (job: IngestJob, options: Partial<IngestOptions> = {}) => runIngest(job, { db, transport: fetchTransport(), now: () => NOW, ...options });

/** Every live, movie and series id (and episode id) moved by `by`: a provider renumbering. */
function renumbered(c: Catalog, by: number): Catalog {
  return {
    ...c,
    live: c.live.map((x) => ({ ...x, id: x.id + by })),
    movies: c.movies.map((x) => ({ ...x, id: x.id + by })),
    series: c.series.map((s) => ({ ...s, id: s.id + by, seasons: s.seasons.map((season) => ({ ...season, episodes: season.episodes.map((e) => ({ ...e, id: e.id + by })) })) })),
  };
}

async function allItems(src: string, kind: ContentKind): Promise<CatalogItem[]> {
  const q = new QueryService({ openDb: async () => db });
  const out: CatalogItem[] = [];
  for (const cat of await q.categories(src, kind)) for (let n = 0; n < cat.chunks.length; n++) out.push(...(await q.chunk({ src, kind, catIdx: cat.catIdx, chunk: n })));
  return out;
}

const favourite = (i: CatalogItem): FavouriteRef => ({ key: i.key, src: i.src, kind: i.kind, normName: i.normName, group: i.group, epgId: i.epgId, added: NOW, missingSince: null });

describe('ingest against the mock provider: M3U', () => {
  const episodes = catalog.series.reduce((n, s) => n + s.seasons.reduce((m, season) => m + season.episodes.length, 0), 0);

  it('ingests get.php, then stops at the 304 when nothing changed', async () => {
    const r1 = await ingest(m3uJob());
    expect(r1).toMatchObject({ status: 'committed', gen: 1, counts: { live: catalog.live.length, movie: catalog.movies.length, series: episodes }, gzipped: false });
    expect(r1.fetch?.etag).toMatch(/^"/);
    expect(r1.m3u?.epgUrls[0]).toBe(`${base}/xmltv.php?username=${U}&password=${P}`);
    expect((await allItems('pl', 'live')).map((i) => i.name).sort()).toEqual(catalog.live.map((c) => c.name).sort());

    const r2 = await ingest(m3uJob(), { now: () => NOW + DAY });
    expect(r2).toMatchObject({ status: 'unchanged', gen: 1, fetch: null });
    expect((await getSource(db, 'pl'))?.checkedAt).toBe(NOW + DAY);

    // The provider adds a channel: a new ETag and a new generation.
    app.mockState.catalog = { ...catalog, live: catalog.live.slice(0, -1) };
    const r3 = await ingest(m3uJob());
    expect(r3).toMatchObject({ status: 'committed', gen: 2, previous: 1, counts: { live: catalog.live.length - 1 } });
  });

  it('gunzips a raw gzip body (the gzip:mode=raw fault) with fflate and with DecompressionStream', async () => {
    for (const gunzip of ['fflate', 'native'] as const) {
      const r = await ingest({ ...m3uJob(`&mock_fault=${encodeURIComponent('gzip:mode=raw')}`), force: true }, { gunzip });
      expect(r).toMatchObject({ status: 'committed', gzipped: true, counts: { live: catalog.live.length } });
    }
  });

  it('keeps the old generation when the download breaks off mid-body', async () => {
    await ingest(m3uJob());
    const before = await allItems('pl', 'live');
    const broken = await ingest({ ...m3uJob(`&mock_fault=${encodeURIComponent('reset:after_bytes=3000')}`), force: true }).catch((e: unknown) => e);
    expect(broken).toBeInstanceOf(IngestError);
    expect((broken as IngestError).code).toBe('network');
    expect((broken as IngestError).message).not.toContain(P);
    expect(await getSource(db, 'pl')).toMatchObject({ gen: 1, building: null });
    expect(await allItems('pl', 'live')).toEqual(before);
  });

  it("logs in to a get.php link's panel and keeps its zone and the account's formats (step 25b)", async () => {
    app.mockState.scenario = parseScenario({ rules: [{ match: { path: '**' }, faults: [{ type: 'timezone', tz: 'Asia/Riyadh' }] }] }, 'riyadh');
    try {
      expect(await ingest(m3uJob())).toMatchObject({ status: 'committed', counts: { live: catalog.live.length } });
      const meta = (await getSource(db, 'pl'))!;
      expect(meta.server?.timezone).toBe('Asia/Riyadh');
      expect(meta.outputFormats).toEqual(['m3u8', 'ts']);
      // Riyadh is three hours ahead of UTC, all year.
      const zone = panelZone(meta.server!);
      expect([zone.source, zone.offset(NOW), zone.offset(NOW - 180 * DAY)]).toEqual(['intl', 180, 180]);
    } finally {
      app.mockState.scenario = null;
    }
  });

  it('reports a wrong password as an auth error', async () => {
    const job: IngestJob = { src: 'pl', source: { type: 'm3u', url: `${base}/get.php?username=${U}&password=wrong&type=m3u_plus` } };
    await expect(ingest(job)).rejects.toMatchObject({ code: 'auth', status: 401 });
  });
});

describe('ingest against the mock provider: Xtream', () => {
  it('logs in, keeps the panel facts and ingests every kind with its categories', async () => {
    const r = await ingest(xtream());
    expect(r).toMatchObject({ status: 'committed', counts: { live: catalog.live.length, movie: catalog.movies.length, series: catalog.series.length } });
    expect(r.xtream?.server?.timezone).toBeTruthy();
    expect((await getSource(db, 'xt'))?.server).toEqual(r.xtream?.server);
    // The account's allowed_output_formats, for the player (step 20c2a).
    expect((await getSource(db, 'xt'))?.outputFormats).toEqual(['m3u8', 'ts']);
    const live = await allItems('xt', 'live');
    expect(live.find((i) => i.key === 'x:xt:live:101')).toMatchObject({ name: 'Lablo Test 1 SMPTE', group: 'Test News', epgId: 'lablo.test1' });
    // The panel clock in the login answer isn't hashed: a second refresh is unchanged.
    expect((await ingest(xtream())).status).toBe('unchanged');
  });

  it('keeps its newest movies by their panel dates, and rebuilds a catalog an older ingest version built (step 26e)', async () => {
    // The mock's films, newest first by their `added_days_ago`; equal days keep the panel's order.
    const newest = catalog.movies
      .map((m, i) => ({ m, i }))
      .sort((a, b) => a.m.addedDaysAgo - b.m.addedDaysAgo || a.i - b.i)
      .map((x) => x.m);
    expect(newest.map((m) => m.name)).toEqual(['Big Buck Bunny', 'Sintel', 'اختبار الصوت المتعدد', 'Elephants Dream', 'Tears of Steel', 'Lablo Test Pattern 4K HEVC']);
    await ingest(xtream());
    const q = new QueryService({ openDb: async () => db });
    const recent = await q.recent({ sources: ['xt'], kind: 'movie' });
    expect(recent.map((r) => r.item.name)).toEqual(newest.map((m) => m.name));
    // Each with the panel's date (whole days before the mock's day), and the item the catalog stores.
    const movies = await allItems('xt', 'movie');
    for (const r of recent) {
      const m = catalog.movies.find((x) => r.item.key === `x:xt:movie:${x.id}`)!;
      expect(r.added).toBe(Math.floor((Math.floor(NOW / DAY) * DAY - m.addedDaysAgo * DAY) / 1000));
      expect(r.item).toEqual(movies.find((i) => i.key === r.item.key));
    }
    // A playlist's movies have none: the M3U source adds nothing.
    await ingest(m3uJob());
    expect((await q.recent({ sources: ['pl', 'xt'], kind: 'movie' })).map((r) => r.item.src)).toEqual(newest.map(() => 'xt'));

    // A catalog an older ingest version built: its records lack the list, its stamp has the old version.
    await transact(db, [STORE.sources, STORE.cats], 'readwrite', (tx) => {
      const sources = tx.objectStore(STORE.sources);
      onSuccess(sources.get('xt'), (meta) => {
        const m = meta as { gen: number; fetch: { v: number } };
        sources.put({ ...m, fetch: { ...m.fetch, v: INGEST_VERSION - 1 } });
        const cats = tx.objectStore(STORE.cats);
        onSuccess(cats.get(['xt', m.gen, 'movie']), (record) => cats.put({ cats: (record as { cats: unknown }).cats }, ['xt', m.gen, 'movie']));
      });
    });
    await q.reload();
    expect(await q.recent({ sources: ['xt'], kind: 'movie' })).toEqual([]);
    // The same bytes again: rebuilt, not "unchanged", and the list is back.
    const again = await ingest(xtream());
    expect(again).toMatchObject({ status: 'committed', gen: 2, previous: 1 });
    await q.reload();
    expect((await q.recent({ sources: ['xt'], kind: 'movie' })).map((r) => r.item.name)).toEqual(newest.map((m) => m.name));
    expect((await ingest(xtream())).status).toBe('unchanged');
  });

  it('keeps its newest series by their panel dates (`last_modified`), a playlist none (step 27a)', async () => {
    // The mock's shows, newest first: the Arabic show was updated last.
    const newest = catalog.series
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s.addedDaysAgo - b.s.addedDaysAgo || a.i - b.i)
      .map((x) => x.s);
    expect(newest.map((s) => s.id)).toEqual([302, 301]);
    await ingest(xtream());
    const q = new QueryService({ openDb: async () => db });
    const recent = await q.recent({ sources: ['xt'], kind: 'series' });
    expect(recent.map((r) => r.item.key)).toEqual(newest.map((s) => `x:xt:series:${s.id}`));
    const shows = await allItems('xt', 'series');
    for (const r of recent) {
      const s = catalog.series.find((x) => r.item.key === `x:xt:series:${x.id}`)!;
      expect(r.added).toBe(Math.floor((Math.floor(NOW / DAY) * DAY - s.addedDaysAgo * DAY) / 1000));
      expect(r.item).toEqual(shows.find((i) => i.key === r.item.key));
      expect(r.item.url).toBe('');
    }
    // The movies' list is their own.
    expect((await q.recent({ sources: ['xt'], kind: 'movie' })).every((r) => r.item.kind === 'movie')).toBe(true);
    // A playlist's episodes have no date.
    await ingest(m3uJob());
    expect((await q.recent({ sources: ['pl'], kind: 'series' }))).toEqual([]);
    expect((await allItems('pl', 'series')).length).toBe(7);
  });

  it("keeps the account's allowed_output_formats on every login, unchanged refreshes included", async () => {
    const hls: IngestJob = { src: 'xt', source: { type: 'xtream', account: { base, username: 'hls', password: 'hls-test' } } };
    expect((await ingest(hls)).xtream?.outputFormats).toEqual(['m3u8']);
    expect((await getSource(db, 'xt'))?.outputFormats).toEqual(['m3u8']);
    // The panel changed the account (the same catalog): an unchanged refresh still takes it.
    const account = app.mockState.fixture.accounts.find((a) => a.username === 'hls')!;
    const before = account.outputFormats;
    account.outputFormats = ['m3u8', 'ts'];
    try {
      expect((await ingest(hls)).status).toBe('unchanged');
      expect((await getSource(db, 'xt'))?.outputFormats).toEqual(['m3u8', 'ts']);
    } finally {
      account.outputFormats = before;
    }
  });

  it('keeps favourites through a refresh where the provider renumbered every stream', async () => {
    await ingest(xtream());
    const live = await allItems('xt', 'live');
    const movies = await allItems('xt', 'movie');
    const series = await allItems('xt', 'series');
    const picks = [
      live.find((i) => i.key === 'x:xt:live:101')!, // has a same-name, same-tvg-id twin (112) in another group
      live.find((i) => i.key === 'x:xt:live:103')!, // Arabic name
      movies.find((i) => i.key === 'x:xt:movie:202')!,
      series.find((i) => i.key === 'x:xt:series:302')!,
    ];
    await saveProfile(db, { ...emptyProfile(), favourites: picks.map(favourite) }, { now: NOW });

    app.mockState.catalog = renumbered(catalog, 1000);
    const r = await ingest(xtream(), { now: () => NOW + DAY });
    expect(r.status).toBe('committed');
    expect(r.favourites).toEqual({
      src: 'xt',
      changed: true,
      present: 0,
      rematched: [
        { from: 'x:xt:live:101', to: 'x:xt:live:1101' },
        { from: 'x:xt:live:103', to: 'x:xt:live:1103' },
        { from: 'x:xt:movie:202', to: 'x:xt:movie:1202' },
        { from: 'x:xt:series:302', to: 'x:xt:series:1302' },
      ],
      missing: [],
      dropped: [],
      restored: [],
    });
    const favs = ((await loadProfile(db))!.doc as ProfileDoc).favourites;
    expect(favs.map((f) => [f.key, f.missingSince, f.added])).toEqual([
      ['x:xt:live:1101', null, NOW],
      ['x:xt:live:1103', null, NOW],
      ['x:xt:movie:1202', null, NOW],
      ['x:xt:series:1302', null, NOW],
    ]);

    // The re-matched keys resolve in the new generation, and search boosts them.
    const q = new QueryService({ openDb: async () => db });
    expect(await q.reload()).toMatchObject({ stale: [] });
    expect(q.setFavourites(favs.map((f) => f.key))).toBe(4);
    const hits = await q.search({ query: 'lablo test 1 smpte' });
    expect(hits.hits.map((h) => h.favourite)).toEqual([true, false]);
    expect((await q.items(hits.hits)).map((i) => i?.key)).toEqual(['x:xt:live:1101', 'x:xt:live:1112']);

    // The provider later drops a favourite: kept as unavailable, then dropped after 30 days.
    app.mockState.catalog = { ...renumbered(catalog, 1000), movies: renumbered(catalog, 1000).movies.filter((m) => m.id !== 1202) };
    const gone = await ingest(xtream(), { now: () => NOW + 2 * DAY });
    expect(gone.favourites).toMatchObject({ missing: ['x:xt:movie:1202'], present: 3 });
    const later = await ingest({ ...xtream(), force: true }, { now: () => NOW + 32 * DAY });
    expect(later.favourites).toMatchObject({ dropped: ['x:xt:movie:1202'] });
    expect(((await loadProfile(db))!.doc as ProfileDoc).favourites.map((f) => f.key)).toEqual(['x:xt:live:1101', 'x:xt:live:1103', 'x:xt:series:1302']);
  });

  it('keeps the old generation when a list breaks off, and reports a bad login', async () => {
    await ingest(xtream());
    const counts = (await getSource(db, 'xt'))!.counts;
    // Break the VOD list mid-body: the live list was already written into the new generation.
    const breaking: IngestOptions['transport'] = {
      get: (url, request) => fetchTransport().get(url.includes('action=get_vod_streams') ? `${url}&mock_fault=${encodeURIComponent('reset:after_bytes=500')}` : url, request),
    };
    await expect(ingest({ ...xtream(), force: true }, { transport: breaking })).rejects.toMatchObject({ code: 'network' });
    expect(await getSource(db, 'xt')).toMatchObject({ gen: 1, building: null, counts });
    expect((await allItems('xt', 'live')).length).toBe(catalog.live.length);

    const bad: IngestJob = { src: 'xt', source: { type: 'xtream', account: { base, username: U, password: 'nope' } } };
    await expect(ingest(bad)).rejects.toMatchObject({ code: 'auth' });
  });

  it("stops on the account's status: expired, banned or disabled accounts log in but get nothing", async () => {
    // The mock's test accounts in every `user_info` state (apps/mock-provider/fixtures/server.yaml).
    const job = (username: string): IngestJob => ({ src: 'xt', source: { type: 'xtream', account: { base, username, password: `${username}-test` } } });
    await expect(ingest(job('expired'))).rejects.toMatchObject({ name: 'IngestError', code: 'expired' });
    await expect(ingest(job('banned'))).rejects.toMatchObject({ name: 'IngestError', code: 'blocked' });
    await expect(ingest(job('disabled'))).rejects.toMatchObject({ name: 'IngestError', code: 'blocked' });
    // Nothing was written for them, not even the source's record.
    expect(await getSource(db, 'xt')).toBeNull();
    // Active accounts load, a trial and one that never expires included.
    for (const username of ['trial', 'forever']) {
      expect(await ingest({ ...job(username), src: username })).toMatchObject({ status: 'committed' });
    }
  });
});
