import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogItem } from '@lablo/core';
import { createDataClient } from './client';
import { openDatabase, transact } from './idb';
import { KEY_ITEMS_MAX, QueryService } from './query-service';
import type { RecentItem } from './recent';
import { RECENT_MAX } from './recent';
import type { RpcPort } from './rpc';
import { CancelSource, serveRpc } from './rpc';
import { STORE } from './schema';
import { freshFactory, ingest, item } from './test-support';

const opened: MessagePort[] = [];
afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

function catalog(src: string): CatalogItem[] {
  return [
    item(src, 'live', 1, 'MBC Drama HD', 'AR | Drama'),
    item(src, 'live', 2, 'Sky News', 'UK | News'),
    item(src, 'live', 3, 'الجزيرة الإخبارية', 'AR | News'),
    item(src, 'live', 4, 'News 24', 'UK | News'),
    item(src, 'movie', 10, 'News of the World', 'EN | Drama'),
    item(src, 'movie', 11, 'Golden River', 'EN | Drama'),
    item(src, 'series', 20, 'Breaking News', 'EN | Series'),
  ];
}

async function service(): Promise<{ db: IDBDatabase; svc: QueryService; opens: () => number }> {
  const factory = freshFactory();
  const db = await openDatabase(factory);
  let opens = 0;
  const svc = new QueryService({
    openDb: () => {
      opens++;
      return openDatabase(factory);
    },
    chunkCache: 2,
  });
  return { db, svc, opens: () => opens };
}

describe('QueryService', () => {
  it('loads the active generations lazily and searches them', async () => {
    const { db, svc, opens } = await service();
    await ingest(db, 'tv', catalog('tv'), { chunkSize: 2 });
    const result = await svc.search({ query: 'news' });
    expect(opens()).toBe(1);
    expect(result.total).toBe(4);
    const items = await svc.items(result.hits);
    expect(items.map((i) => `${i!.kind}:${i!.name}`)).toEqual(['live:News 24', 'live:Sky News', 'movie:News of the World', 'series:Breaking News']);
    expect(await svc.status()).toMatchObject({
      sources: [{ src: 'tv', gen: 1 }],
      segments: [
        { src: 'tv', kind: 'live', gen: 1, count: 4 },
        { src: 'tv', kind: 'movie', gen: 1, count: 2 },
        { src: 'tv', kind: 'series', gen: 1, count: 1 },
      ],
      stale: [],
    });
    db.close();
  });

  it('boosts favourites, filters kinds, and orders and filters sources', async () => {
    const { db, svc } = await service();
    await ingest(db, 'a', catalog('a'));
    await ingest(db, 'b', catalog('b'));
    expect(svc.setFavourites(['x:b:live:2'])).toBe(0); // nothing loaded yet
    const names = async (req: Parameters<QueryService['search']>[0]): Promise<string[]> => {
      const result = await svc.search(req);
      return (await svc.items(result.hits)).map((i) => `${i!.src}:${i!.name}`);
    };
    expect(await names({ query: 'news', kinds: ['live'] })).toEqual(['b:Sky News', 'a:News 24', 'b:News 24', 'a:Sky News']);
    expect(svc.setFavourites(['x:b:live:2', 'x:a:movie:10', 'x:zz:live:1'])).toBe(2);
    expect(await names({ query: 'news', kinds: ['movie'], sources: ['b', 'a'] })).toEqual(['a:News of the World', 'b:News of the World']);
    expect(await names({ query: 'الاخباريه', sources: ['b'] })).toEqual(['b:الجزيرة الإخبارية']);
    db.close();
  });

  it('reads categories and chunks of the active generation, through a small cache', async () => {
    const { db, svc } = await service();
    await ingest(db, 'tv', catalog('tv'), { chunkSize: 1 });
    const cats = await svc.categories('tv', 'live');
    expect(cats.map((c) => [c.name, c.count])).toEqual([
      ['AR | Drama', 1],
      ['UK | News', 2],
      ['AR | News', 1],
    ]);
    expect((await svc.chunk({ src: 'tv', kind: 'live', catIdx: 1, chunk: 1 })).map((i) => i.name)).toEqual(['News 24']);
    expect(await svc.chunk({ src: 'tv', kind: 'live', catIdx: 9, chunk: 0 })).toEqual([]);
    expect(await svc.chunk({ src: 'other', kind: 'live', catIdx: 0, chunk: 0 })).toEqual([]);
    expect(await svc.categories('other', 'live')).toEqual([]);
    // Two chunks fit in the cache: reading two more evicts the least recently used (1/1).
    await svc.chunk({ src: 'tv', kind: 'live', catIdx: 0, chunk: 0 });
    await svc.chunk({ src: 'tv', kind: 'live', catIdx: 2, chunk: 0 });
    // With the store wiped, only cached chunks still answer.
    await transact(db, STORE.chunks, 'readwrite', (tx) => tx.objectStore(STORE.chunks).clear());
    expect((await svc.chunk({ src: 'tv', kind: 'live', catIdx: 0, chunk: 0 })).map((i) => i.name)).toEqual(['MBC Drama HD']);
    expect((await svc.chunk({ src: 'tv', kind: 'live', catIdx: 2, chunk: 0 })).map((i) => i.name)).toEqual(['الجزيرة الإخبارية']);
    expect(await svc.chunk({ src: 'tv', kind: 'live', catIdx: 1, chunk: 1 })).toEqual([]);
    db.close();
  });

  it('resolves more chunks in one call than the cache holds', async () => {
    const { db, svc } = await service(); // cache of 2 chunks
    await ingest(db, 'tv', catalog('tv'), { chunkSize: 1 });
    const result = await svc.search({ query: 'e' });
    expect(result.hits).toHaveLength(5); // five items, each in its own chunk
    await svc.items(result.hits.slice(0, 2)); // cached first, evicted during the next call
    const items = await svc.items([...result.hits, ...result.hits]);
    expect(items.every((i) => i !== null)).toBe(true);
  });

  it('switches to a new generation on reload; hits of the old one resolve to null once it is deleted', async () => {
    const { db, svc } = await service();
    await ingest(db, 'tv', catalog('tv'));
    const old = await svc.search({ query: 'golden' });
    expect(old.hits).toHaveLength(1);
    const renamed = catalog('tv').map((i) => (i.name === 'Golden River' ? { ...i, name: 'Silver River', normName: 'silver river' } : i));
    const { gen, previous } = await ingest(db, 'tv', renamed);
    expect(await svc.search({ query: 'silver' })).toMatchObject({ total: 0 }); // not reloaded yet
    await svc.reload();
    const fresh = await svc.search({ query: 'silver' });
    expect(fresh.hits[0]).toMatchObject({ gen });
    await transact(db, [STORE.chunks], 'readwrite', (tx) => tx.objectStore(STORE.chunks).delete(IDBKeyRange.bound(['tv', previous], ['tv', previous, []])));
    expect(await svc.items([...old.hits, ...fresh.hits])).toEqual([null, expect.objectContaining({ name: 'Silver River' })]);
    db.close();
  });

  it('lists segments it cannot load as stale instead of failing', async () => {
    const { db, svc } = await service();
    await ingest(db, 'tv', catalog('tv'));
    await transact(db, STORE.index, 'readwrite', (tx) => {
      const store = tx.objectStore(STORE.index);
      store.delete(['tv', 1, 'series']);
      store.put({ v: 99 }, ['tv', 1, 'movie']);
    });
    const status = await svc.reload();
    expect(status.segments.map((s) => s.kind)).toEqual(['live']);
    expect(status.stale).toEqual([
      { src: 'tv', kind: 'movie', gen: 1, reason: 'Search index version 99, expected 1' },
      { src: 'tv', kind: 'series', gen: 1, reason: 'missing' },
    ]);
    expect((await svc.search({ query: 'news' })).total).toBe(2);
    db.close();
  });

  it('retries opening the database after a failure', async () => {
    let attempts = 0;
    const factory = freshFactory();
    const svc = new QueryService({
      openDb: () => {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error('quota')) : openDatabase(factory);
      },
    });
    await expect(svc.status()).rejects.toThrow('quota');
    await expect(svc.status()).resolves.toMatchObject({ sources: [] });
    expect(attempts).toBe(2);
  });

  it('serves the UI over RPC (the query worker setup), with cancellation', async () => {
    const { db, svc } = await service();
    await ingest(db, 'tv', catalog('tv'));
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    serveRpc(port1, svc.handlers());
    const client = createDataClient(port2 as unknown as RpcPort);
    const result = await client.call('search', { query: 'mbc' });
    expect(result.hits).toHaveLength(1);
    const [found] = await client.call('items', { refs: result.hits });
    expect(found).toMatchObject({ key: 'x:tv:live:1', name: 'MBC Drama HD', url: 'http://p.test/live/u/p/1.ts' });
    expect(await client.call('setFavourites', { keys: ['x:tv:live:1'] })).toBe(1);
    expect((await client.call('status')).segments).toHaveLength(3);
    const source = new CancelSource();
    source.cancel();
    await expect(client.call('search', { query: 'a' }, { cancel: source.token })).rejects.toMatchObject({ name: 'CancelError' });
    db.close();
  });

  it('reads and edits the profile over RPC: the first answer creates it, an older one is upgraded', async () => {
    const { db, svc } = await service();
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    serveRpc(port1, svc.handlers());
    const client = createDataClient(port2 as unknown as RpcPort);
    expect(await client.call('profile')).toBeNull();
    expect(await client.call('editProfile', { kind: 'answers', answers: { language: 'ar' } })).toBe(true);
    // The same answer again changes nothing.
    expect(await client.call('editProfile', { kind: 'answers', answers: { language: 'ar' } })).toBe(false);
    const source = { id: 's1', type: 'm3u', name: 'Home', url: 'http://p.test/list.m3u', added: 5 } as const;
    expect(await client.call('editProfile', { kind: 'source', source })).toBe(true);
    // What the player keeps (step 20c1); the same answer again changes nothing.
    expect(await client.call('editProfile', { kind: 'player', change: { field: 'container', src: 's1', container: 'hls' } })).toBe(true);
    expect(await client.call('editProfile', { kind: 'player', change: { field: 'container', src: 's1', container: 'hls' } })).toBe(false);
    // The user's guides (step 22b); a link already listed changes nothing.
    expect(await client.call('editProfile', { kind: 'guide', change: { op: 'add', guide: { id: 'g1', url: 'http://g.test/a.xml' } } })).toBe(true);
    expect(await client.call('editProfile', { kind: 'guide', change: { op: 'add', guide: { id: 'g2', url: 'http://g.test/a.xml' } } })).toBe(false);
    // A movie's position (step 26d); the same place again changes nothing.
    const left = { positionMs: 30_000, lengthMs: 596_000, updated: 7 };
    expect(await client.call('editProfile', { kind: 'progress', key: 'x:s1:movie:201', progress: left })).toBe(true);
    expect(await client.call('editProfile', { kind: 'progress', key: 'x:s1:movie:201', progress: { ...left, updated: 8 } })).toBe(false);
    // A show's episode (step 27c1): its place and the show's last episode; the same again changes nothing.
    const episode = { kind: 'episode', show: 'x:s1:series:301', last: { episode: 'x:s1:episode:3002', watched: false, updated: 9 }, progress: { positionMs: 40_000, lengthMs: 300_000, updated: 9 } } as const;
    expect(await client.call('editProfile', episode)).toBe(true);
    expect(await client.call('editProfile', episode)).toBe(false);
    expect(await client.call('profile')).toEqual({
      doc: {
        v: 6,
        favourites: [],
        sources: [source],
        onboarding: { language: 'ar', disclaimerAt: null, consent: null },
        player: { last: null, containers: { s1: 'hls' }, redirects: {}, tracks: {}, subtitleSize: null },
        guides: [{ id: 'g1', url: 'http://g.test/a.xml' }],
        progress: { 'x:s1:movie:201': { positionMs: 30_000, lengthMs: 596_000, updated: 7 }, 'x:s1:episode:3002': { positionMs: 40_000, lengthMs: 300_000, updated: 9 } },
        shows: { 'x:s1:series:301': { episode: 'x:s1:episode:3002', watched: false, updated: 9 } },
      },
      newer: false,
      migratedFrom: null,
    });
    // A version 1 profile (step 7) is upgraded when the app reads it.
    await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc: { v: 1, favourites: [] } }));
    expect(await client.call('profile')).toMatchObject({ migratedFrom: 1, doc: { v: 6, sources: [], onboarding: { language: null }, player: { last: null }, guides: [], progress: {}, shows: {} } });
    // A version 3 profile's guide link moves to the guide list.
    const v3 = { v: 3, favourites: [], sources: [{ ...source, epgUrl: 'http://g.test/b.xml' }], onboarding: { language: null, disclaimerAt: null, consent: null }, player: {} };
    await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc: v3 }));
    expect(await client.call('profile')).toMatchObject({ migratedFrom: 3, doc: { v: 6, sources: [source], guides: [{ id: 's1', url: 'http://g.test/b.xml' }], progress: {}, shows: {} } });
    // A profile from a newer app version is shown and never written over.
    await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc: { v: 9, sources: [] } }));
    expect(await client.call('editProfile', { kind: 'answers', answers: { consent: true } })).toBe(false);
    expect(await client.call('profile')).toEqual({ doc: { v: 9, sources: [] }, newer: true, migratedFrom: null });
    db.close();
  });
});

describe('QueryService.recent ("Recently added", RELAY step 26e)', () => {
  /** Source `src`'s movies 100 + n, each added at `dates[n]` (newest first, as the ingest stores them). */
  const newest = (src: string, dates: number[]): RecentItem[] => dates.map((added, n) => ({ added, item: item(src, 'movie', 100 + n, `Film ${src} ${n}`, 'Films') }));
  const films = (list: readonly RecentItem[]): string[] => list.map((r) => `${r.item.name}@${r.added}`);

  it('merges the sources\' lists, newest first; on an equal date the source asked first comes first', async () => {
    const { db, svc } = await service();
    const a = newest('a', [900, 500, 500, 100]);
    const b = newest('b', [700, 500, 300]);
    await ingest(db, 'a', a.map((r) => r.item), { recent: { movie: a } });
    await ingest(db, 'b', b.map((r) => r.item), { recent: { movie: b } });
    expect(films(await svc.recent({ sources: ['a', 'b'], kind: 'movie' }))).toEqual([
      'Film a 0@900',
      'Film b 0@700',
      'Film a 1@500',
      'Film a 2@500',
      'Film b 1@500',
      'Film b 2@300',
      'Film a 3@100',
    ]);
    expect(films(await svc.recent({ sources: ['b', 'a'], kind: 'movie', limit: 4 }))).toEqual(['Film a 0@900', 'Film b 0@700', 'Film b 1@500', 'Film a 1@500']);
    // The items as stored, whole.
    expect((await svc.recent({ sources: ['a'], kind: 'movie', limit: 1 }))[0]).toEqual(a[0]);
    db.close();
  });

  it('reads only the sources asked, each once, and their active generations', async () => {
    const { db, svc } = await service();
    await ingest(db, 'a', [], { recent: { movie: [] } });
    const old = newest('b', [10]);
    await ingest(db, 'b', old.map((r) => r.item), { recent: { movie: old } });
    const b = newest('b', [30, 20]);
    await ingest(db, 'b', b.map((r) => r.item), { recent: { movie: b } });
    // The query worker reads the generation it loaded until it reloads.
    expect(films(await svc.recent({ sources: ['b', 'b', 'zz', 'a'], kind: 'movie' }))).toEqual(['Film b 0@30', 'Film b 1@20']);
    expect(await svc.recent({ sources: ['a', 'zz'], kind: 'movie' })).toEqual([]);
    expect(await svc.recent({ sources: [], kind: 'movie' })).toEqual([]);
    const c = newest('c', [99]);
    await ingest(db, 'c', c.map((r) => r.item), { recent: { movie: c } });
    expect(await svc.recent({ sources: ['c'], kind: 'movie' })).toEqual([]);
    await svc.reload();
    expect(films(await svc.recent({ sources: ['b', 'c'], kind: 'movie' }))).toEqual(['Film c 0@99', 'Film b 0@30', 'Film b 1@20']);
    db.close();
  });

  it('gives nothing for a catalog an older ingest version built (no list stored), or another kind', async () => {
    const { db, svc } = await service();
    const a = newest('a', [5]);
    await ingest(db, 'old', a.map((r) => ({ ...r.item, src: 'old' })));
    await ingest(db, 'a', catalog('a').concat(a.map((r) => r.item)), { recent: { movie: a } });
    expect(films(await svc.recent({ sources: ['old', 'a'], kind: 'movie' }))).toEqual(['Film a 0@5']);
    expect(await svc.recent({ sources: ['old', 'a'], kind: 'series' })).toEqual([]);
    expect(await svc.recent({ sources: ['a'], kind: 'live' })).toEqual([]);
    db.close();
  });

  it(`gives up to ${RECENT_MAX}, and refuses a larger or broken limit`, async () => {
    const { db, svc } = await service();
    const dates = Array.from({ length: RECENT_MAX }, (_v, i) => 1000 - i);
    const a = newest('a', dates);
    const b = newest('b', dates);
    await ingest(db, 'a', a.map((r) => r.item), { recent: { movie: a } });
    await ingest(db, 'b', b.map((r) => r.item), { recent: { movie: b } });
    const all = await svc.recent({ sources: ['a', 'b'], kind: 'movie' });
    expect(all).toHaveLength(RECENT_MAX);
    expect(films(all.slice(0, 3))).toEqual(['Film a 0@1000', 'Film b 0@1000', 'Film a 1@999']);
    expect(films(all.slice(-1))).toEqual(['Film b 49@951']);
    expect(await svc.recent({ sources: ['a'], kind: 'movie', limit: RECENT_MAX })).toHaveLength(RECENT_MAX);
    expect(await svc.recent({ sources: ['a'], kind: 'movie', limit: 0 })).toEqual([]);
    for (const limit of [RECENT_MAX + 1, -1, 2.5, Number.NaN]) await expect(svc.recent({ sources: ['a'], kind: 'movie', limit })).rejects.toThrow(RangeError);
    db.close();
  });

  it('answers over RPC (the query worker setup)', async () => {
    const { db, svc } = await service();
    const a = newest('a', [3, 2]);
    await ingest(db, 'a', a.map((r) => r.item), { recent: { movie: a } });
    const channel = new MessageChannel();
    opened.push(channel.port1, channel.port2);
    serveRpc(channel.port1 as unknown as RpcPort, svc.handlers());
    const client = createDataClient(channel.port2 as unknown as RpcPort);
    expect(films(await client.call('recent', { sources: ['a'], kind: 'movie' }))).toEqual(['Film a 0@3', 'Film a 1@2']);
    db.close();
  });
});

describe('QueryService.itemsByKey ("Continue watching", RELAY step 27d)', () => {
  const names = (items: readonly CatalogItem[]): string[] => items.map((i) => `${i.src}:${i.name}`);

  it('gives the items of the keys asked, in that order, from their chunks; of one kind, from the sources asked', async () => {
    const { db, svc } = await service(); // cache of 2 chunks
    await ingest(db, 'a', catalog('a'), { chunkSize: 1 });
    await ingest(db, 'b', catalog('b'), { chunkSize: 1 });
    const keys = ['x:b:movie:11', 'x:a:movie:10', 'x:a:series:20', 'x:b:movie:10', 'x:a:live:1'];
    // Each from its own chunk (one item a chunk), more than the cache holds.
    expect(names(await svc.itemsByKey({ keys, kind: 'movie', sources: ['a', 'b'], limit: 10 }))).toEqual(['b:Golden River', 'a:News of the World', 'b:News of the World']);
    expect(names(await svc.itemsByKey({ keys, kind: 'series', sources: ['a', 'b'], limit: 10 }))).toEqual(['a:Breaking News']);
    // The items as stored, whole.
    expect(await svc.itemsByKey({ keys: ['x:a:movie:11'], kind: 'movie', sources: ['a'], limit: 1 })).toEqual([catalog('a')[5]]);
    // A source not asked (removed from the profile), not stored, or with nothing of the kind: nothing.
    expect(names(await svc.itemsByKey({ keys, kind: 'movie', sources: ['a'], limit: 10 }))).toEqual(['a:News of the World']);
    expect(await svc.itemsByKey({ keys: ['x:zz:movie:10'], kind: 'movie', sources: ['zz'], limit: 10 })).toEqual([]);
    // Keys that aren't in the catalog: a show's episode, an item gone, a broken key, another kind's.
    const none = ['x:a:episode:3001', 'x:a:movie:99', 'nonsense', '', 'x:a:live:1'];
    expect(await svc.itemsByKey({ keys: none, kind: 'movie', sources: ['a', ''], limit: 10 })).toEqual([]);
    db.close();
  });

  it('gives the first `limit` found, a key asked twice once, and refuses a larger or broken limit', async () => {
    const { db, svc } = await service();
    await ingest(db, 'a', catalog('a'));
    const keys = ['x:a:movie:99', 'x:a:movie:11', 'x:a:movie:11', 'x:a:live:1', 'x:a:movie:10'];
    expect(names(await svc.itemsByKey({ keys, kind: 'movie', sources: ['a'], limit: 1 }))).toEqual(['a:Golden River']);
    expect(names(await svc.itemsByKey({ keys, kind: 'movie', sources: ['a'], limit: 2 }))).toEqual(['a:Golden River', 'a:News of the World']);
    expect(await svc.itemsByKey({ keys, kind: 'movie', sources: ['a'], limit: 0 })).toEqual([]);
    expect(KEY_ITEMS_MAX).toBe(100);
    expect(await svc.itemsByKey({ keys, kind: 'movie', sources: ['a'], limit: KEY_ITEMS_MAX })).toHaveLength(2);
    for (const limit of [KEY_ITEMS_MAX + 1, -1, 2.5, Number.NaN]) await expect(svc.itemsByKey({ keys, kind: 'movie', sources: ['a'], limit })).rejects.toThrow(RangeError);
    db.close();
  });

  it("reads the generation it loaded until it reloads; a key whose hash only collides gives nothing", async () => {
    const { db, svc } = await service();
    await ingest(db, 'a', catalog('a'));
    expect(names(await svc.itemsByKey({ keys: ['x:a:movie:11'], kind: 'movie', sources: ['a'], limit: 5 }))).toEqual(['a:Golden River']);
    // A refresh drops the film and renames another: seen after the reload.
    const next = catalog('a')
      .filter((i) => i.key !== 'x:a:movie:11')
      .map((i) => (i.key === 'x:a:movie:10' ? { ...i, name: 'News of the Old World' } : i));
    await ingest(db, 'a', next);
    await svc.reload();
    expect(names(await svc.itemsByKey({ keys: ['x:a:movie:11', 'x:a:movie:10'], kind: 'movie', sources: ['a'], limit: 5 }))).toEqual(['a:News of the Old World']);
    // The stored item's own key differs from the one asked (as a 53-bit collision would): dropped.
    const seg = (svc as unknown as { segments: { kind: string; indexOfKey(key: string): number }[] }).segments.find((s) => s.kind === 'movie')!;
    const real = seg.indexOfKey.bind(seg);
    seg.indexOfKey = (key: string) => (key === 'x:a:movie:77' ? real('x:a:movie:10') : real(key));
    expect(names(await svc.itemsByKey({ keys: ['x:a:movie:77', 'x:a:movie:10'], kind: 'movie', sources: ['a'], limit: 1 }))).toEqual([]);
    expect(names(await svc.itemsByKey({ keys: ['x:a:movie:77', 'x:a:movie:10'], kind: 'movie', sources: ['a'], limit: 2 }))).toEqual(['a:News of the Old World']);
    db.close();
  });

  it('answers over RPC (the query worker setup)', async () => {
    const { db, svc } = await service();
    await ingest(db, 'a', catalog('a'));
    const channel = new MessageChannel();
    opened.push(channel.port1, channel.port2);
    serveRpc(channel.port1 as unknown as RpcPort, svc.handlers());
    const client = createDataClient(channel.port2 as unknown as RpcPort);
    expect(names(await client.call('itemsByKey', { keys: ['x:a:series:20', 'x:a:movie:10'], kind: 'movie', sources: ['a'], limit: 20 }))).toEqual(['a:News of the World']);
    db.close();
  });
});
