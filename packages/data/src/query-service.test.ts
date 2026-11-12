import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogItem } from '@lablo/core';
import { createDataClient } from './client';
import { openDatabase, transact } from './idb';
import { QueryService } from './query-service';
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
    expect(await client.call('profile')).toEqual({
      doc: {
        v: 5,
        favourites: [],
        sources: [source],
        onboarding: { language: 'ar', disclaimerAt: null, consent: null },
        player: { last: null, containers: { s1: 'hls' }, redirects: {}, tracks: {}, subtitleSize: null },
        guides: [{ id: 'g1', url: 'http://g.test/a.xml' }],
        progress: { 'x:s1:movie:201': { positionMs: 30_000, lengthMs: 596_000, updated: 7 } },
      },
      newer: false,
      migratedFrom: null,
    });
    // A version 1 profile (step 7) is upgraded when the app reads it.
    await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc: { v: 1, favourites: [] } }));
    expect(await client.call('profile')).toMatchObject({ migratedFrom: 1, doc: { v: 5, sources: [], onboarding: { language: null }, player: { last: null }, guides: [], progress: {} } });
    // A version 3 profile's guide link moves to the guide list.
    const v3 = { v: 3, favourites: [], sources: [{ ...source, epgUrl: 'http://g.test/b.xml' }], onboarding: { language: null, disclaimerAt: null, consent: null }, player: {} };
    await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc: v3 }));
    expect(await client.call('profile')).toMatchObject({ migratedFrom: 3, doc: { v: 5, sources: [source], guides: [{ id: 's1', url: 'http://g.test/b.xml' }], progress: {} } });
    // A profile from a newer app version is shown and never written over.
    await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc: { v: 9, sources: [] } }));
    expect(await client.call('editProfile', { kind: 'answers', answers: { consent: true } })).toBe(false);
    expect(await client.call('profile')).toEqual({ doc: { v: 9, sources: [] }, newer: true, migratedFrom: null });
    db.close();
  });
});
