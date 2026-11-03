import { gzipSync } from 'node:zlib';
import type { CatalogItem } from '@zoma/core';
import { parseM3uCatalog } from '@zoma/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fnv1a } from './bytes';
import type { SourceMeta } from './catalog-store';
import { getSource } from './catalog-store';
import { onSuccess, openDatabase, transact } from './idb';
import type { IngestOptions, IngestProgress, IngestSwap } from './ingest';
import { INGEST_VERSION, IngestError, runIngest } from './ingest';
import type { FavouriteRef, ProfileDoc } from './profile';
import { emptyProfile, loadProfile, saveProfile } from './profile';
import { QueryService } from './query-service';
import { CancelError, CancelSource } from './rpc';
import { STORE } from './schema';
import type { FakeResponse } from './test-support';
import { dumpStore, fakeTransport, freshFactory } from './test-support';
import type { Clock } from './throttle';
import { LOW_TIER_DUTY, Throttle } from './throttle';

const SRC = 'pl';
const URL = 'http://p.test/get.php?username=u&password=secret&type=m3u_plus';
const NOW = Date.UTC(2026, 10, 2, 12);
const DAY = 24 * 60 * 60 * 1000;

interface Entry {
  name: string;
  group: string;
  kind?: 'live' | 'movie' | 'series';
  tvgId?: string;
}

function playlist(entries: Entry[]): string {
  const lines = ['#EXTM3U url-tvg="http://p.test/xmltv.php"'];
  entries.forEach((e, i) => {
    const dir = e.kind ?? 'live';
    const ext = dir === 'live' ? 'ts' : 'mp4';
    lines.push(`#EXTINF:-1 tvg-id="${e.tvgId ?? ''}" group-title="${e.group}",${e.name}`, `http://p.test/${dir}/u/p/${i + 1}.${ext}`);
  });
  return `${lines.join('\n')}\n`;
}

/** 1,200 live channels in 7 groups, 30 movies and 5 series entries. */
function bigList(prefix = 'Channel'): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < 1200; i++) out.push({ name: `${prefix} ${i}`, group: `G${i % 7}`, tvgId: `ch${i}.test` });
  for (let i = 0; i < 30; i++) out.push({ name: `Film ${i}`, group: 'Movies', kind: 'movie' });
  for (let i = 0; i < 5; i++) out.push({ name: `Show ${i} S01 E01`, group: 'Shows', kind: 'series' });
  return out;
}

const keysOf = (text: string): Map<string, CatalogItem> => new Map(parseM3uCatalog(SRC, text).items.map((i) => [i.name, i]));
const hashOf = (bytes: Uint8Array): string => {
  const h = new Fnv1a();
  h.update(bytes);
  return h.digest();
};

let factory: IDBFactory;
let db: IDBDatabase;

beforeEach(async () => {
  factory = freshFactory();
  db = await openDatabase(factory);
});
afterEach(() => {
  db.close();
});

function run(respond: (url: string, headers: Record<string, string>) => FakeResponse, extra: Partial<IngestOptions> & { force?: boolean; now?: () => number } = {}) {
  const transport = fakeTransport(respond);
  const { force, ...options } = extra;
  const result = runIngest({ src: SRC, source: { type: 'm3u', url: URL }, force }, { db, transport, now: () => NOW, ...options });
  return { transport, result };
}

const serve = (body: string | Uint8Array, more: FakeResponse = {}) => () => ({ body, ...more });

/** The names a search for `query` must find: every word somewhere in the name (plain ASCII names). */
const matching = (entries: Entry[], query: string): string[] =>
  entries
    .map((e) => e.name)
    .filter((n) => query.split(' ').every((w) => n.toLowerCase().includes(w)))
    .sort();

async function names(database: IDBDatabase, query: string): Promise<string[]> {
  const q = new QueryService({ openDb: async () => database });
  const res = await q.search({ query, limit: 1000 });
  return (await q.items(res.hits)).map((i) => i!.name).sort();
}

async function sourceMeta(database = db): Promise<SourceMeta> {
  return (await getSource(database, SRC))!;
}

/** Generations that have records in any catalog store. */
async function storedGens(database = db): Promise<number[]> {
  const gens = new Set<number>();
  for (const store of [STORE.chunks, STORE.cats, STORE.index]) {
    for (const [key] of await dumpStore(database, store)) gens.add((key as [string, number])[1]);
  }
  return [...gens].sort((a, b) => a - b);
}

describe('runIngest: M3U', () => {
  it('streams a playlist into a new generation that the query service serves', async () => {
    const text = playlist(bigList());
    const swaps: IngestSwap[] = [];
    const progress: IngestProgress[] = [];
    let clock = NOW;
    const { result, transport } = run(serve(text, { chunk: 1000, headers: { 'Content-Length': String(text.length) } }), {
      chunkSize: 100,
      now: () => (clock += 100),
      onSwap: (s) => swaps.push(s),
      onProgress: (p) => progress.push(p),
    });
    const r = await result;
    expect(r).toMatchObject({ src: SRC, status: 'committed', gen: 1, previous: 0, counts: { live: 1200, movie: 30, series: 5 }, gzipped: false });
    const bytes = new TextEncoder().encode(text);
    expect(r.fetch).toEqual({ v: INGEST_VERSION, hash: hashOf(bytes), bytes: bytes.length, etag: null, lastModified: null });
    expect(r.m3u?.epgUrls).toEqual(['http://p.test/xmltv.php']);
    expect(swaps).toEqual([{ src: SRC, gen: 1, previous: 0, counts: { live: 1200, movie: 30, series: 5 } }]);
    expect(progress.some((p) => p.phase === 'download' && p.items > 0 && p.total === text.length)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: 'commit', items: 1235, bytes: bytes.length });
    expect(transport.requests[0]!.headers).toEqual({});

    expect(await names(db, 'channel 1199')).toEqual(['Channel 1199']);
    expect(await names(db, 'film 2')).toEqual(matching(bigList(), 'film 2'));
    const meta = await sourceMeta();
    expect(meta).toMatchObject({ gen: 1, building: null, counts: { live: 1200, movie: 30, series: 5 }, server: null });
    expect(meta.checkedAt).toBe(meta.updatedAt);
    expect(await storedGens()).toEqual([1]);
  });

  for (const gunzip of ['fflate', 'native'] as const) {
    it(`gunzips a raw .gz body (${gunzip})`, async () => {
      const text = playlist(bigList());
      const gz = new Uint8Array(gzipSync(text));
      const r = await run(serve(gz, { chunk: 777 }), { gunzip }).result;
      expect(r).toMatchObject({ status: 'committed', gzipped: true, counts: { live: 1200, movie: 30, series: 5 } });
      expect(r.fetch).toMatchObject({ hash: hashOf(gz), bytes: gz.length });
      expect(await names(db, 'channel 42')).toEqual(matching(bigList(), 'channel 42'));
    });
  }

  it('keeps the old generation when the app dies mid-ingest, and the next refresh cleans up', async () => {
    const v1 = playlist(bigList());
    await run(serve(v1)).result;
    const before = await names(db, 'channel 11');

    // The refresh dies after a few network chunks: the database connection goes away with the
    // worker, so nothing after this point reaches IndexedDB (no clean-up either).
    const v2 = playlist(bigList('Kanal'));
    const crashed = run(
      serve(v2, {
        chunk: 2000,
        beforeChunk: (n) => {
          if (n === 6) {
            db.close();
            throw new Error('worker terminated');
          }
        },
      }),
      { chunkSize: 10 },
    ).result;
    await expect(crashed).rejects.toThrow();

    db = await openDatabase(factory);
    const meta = await sourceMeta();
    expect(meta).toMatchObject({ gen: 1, building: 2, counts: { live: 1200, movie: 30, series: 5 } });
    expect(await storedGens()).toEqual([1, 2]);
    // Still serving the old generation, exactly as before.
    expect(await names(db, 'channel 11')).toEqual(before);
    expect(await names(db, 'kanal')).toEqual([]);
    const status = await new QueryService({ openDb: async () => db }).status();
    expect(status.segments.map((s) => `${s.kind}:${s.gen}:${s.count}`)).toEqual(['live:1:1200', 'movie:1:30', 'series:1:5']);

    // The next refresh prunes the half-written generation and swaps in its own.
    const r = await run(serve(v2)).result;
    expect(r).toMatchObject({ status: 'committed', gen: 3, previous: 1 });
    expect(await storedGens()).toEqual([3]);
    expect((await sourceMeta()).building).toBeNull();
    expect(await names(db, 'kanal 11')).toEqual(matching(bigList('Kanal'), 'kanal 11'));
  });

  it('keeps the old generation when the connection breaks, and drops the new one at once', async () => {
    await run(serve(playlist(bigList()))).result;
    const v2 = playlist(bigList('Kanal'));
    const error = await run(serve(v2, { chunk: 1000, failAfter: 20_000 }), { chunkSize: 10 }).result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IngestError);
    expect((error as IngestError).code).toBe('network');
    expect((await sourceMeta()).gen).toBe(1);
    expect((await sourceMeta()).building).toBeNull();
    expect(await storedGens()).toEqual([1]);
    expect(await names(db, 'channel 5')).toContain('Channel 5');
  });

  it('stops on cancel: the download is cancelled and the old generation stays', async () => {
    await run(serve(playlist(bigList()))).result;
    const cancel = new CancelSource();
    const { result, transport } = run(
      serve(playlist(bigList('Kanal')), {
        chunk: 1000,
        beforeChunk: (n) => {
          if (n === 5) cancel.cancel();
        },
      }),
      { token: cancel.token, chunkSize: 10 },
    );
    await expect(result).rejects.toBeInstanceOf(CancelError);
    expect(transport.cancelled).toBe(1);
    expect(await sourceMeta()).toMatchObject({ gen: 1, building: null });
    expect(await storedGens()).toEqual([1]);
  });

  it('fails on an empty playlist, a stream URL, HTTP errors and bad gzip, without touching the catalog', async () => {
    await run(serve(playlist(bigList()))).result;
    const expectFailure = async (response: FakeResponse, code: string, status: number | null = null): Promise<IngestError> => {
      const error = (await run(() => response).result.catch((e: unknown) => e)) as IngestError;
      expect(error).toBeInstanceOf(IngestError);
      expect([error.code, error.status]).toEqual([code, status]);
      expect(error.message).not.toContain('secret');
      return error;
    };
    await expectFailure({ body: '#EXTM3U\n' }, 'empty');
    const hls = await expectFailure({ body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n' }, 'empty');
    expect(hls.message).toMatch(/single stream/);
    await expectFailure({ status: 404, body: 'Not found' }, 'http', 404);
    await expectFailure({ status: 401, body: 'Unauthorized' }, 'auth', 401);
    await expectFailure({ status: 304 }, 'http', 304);
    const gz = new Uint8Array(gzipSync(playlist(bigList())));
    await expectFailure({ body: gz.subarray(0, gz.length - 100) }, 'format');
    expect(await sourceMeta()).toMatchObject({ gen: 1, building: null, counts: { live: 1200 } });
    expect(await storedGens()).toEqual([1]);
  });
});

describe('runIngest: conditional fetch', () => {
  const text = playlist(bigList());
  const LM = 'Mon, 02 Nov 2026 10:00:00 GMT';

  it('sends the validators back and stops on 304 before writing anything', async () => {
    await run(serve(text, { headers: { ETag: '"v1"', 'Last-Modified': LM } })).result;
    expect((await sourceMeta()).fetch).toMatchObject({ etag: '"v1"', lastModified: LM });
    const { result, transport } = run((_url, headers) => (headers['If-None-Match'] === '"v1"' ? { status: 304 } : { body: text }), { now: () => NOW + DAY });
    const r = await result;
    expect(transport.requests[0]!.headers).toEqual({ 'If-None-Match': '"v1"', 'If-Modified-Since': LM });
    expect(r).toMatchObject({ status: 'unchanged', gen: 1, previous: 1, fetch: null, counts: { live: 1200 } });
    const meta = await sourceMeta();
    expect(meta).toMatchObject({ gen: 1, nextGen: 2, building: null, checkedAt: NOW + DAY, updatedAt: NOW });
  });

  it('recognises the same bytes by their hash when the server ignores the validators', async () => {
    await run(serve(text, { headers: { ETag: '"v1"' } })).result;
    const r = await run(serve(text, { headers: { ETag: '"v2"' } }), { now: () => NOW + DAY }).result;
    expect(r).toMatchObject({ status: 'unchanged', gen: 1, previous: 1 });
    const meta = await sourceMeta();
    expect(meta).toMatchObject({ gen: 1, building: null, checkedAt: NOW + DAY, updatedAt: NOW });
    expect(meta.fetch?.etag).toBe('"v2"');
    expect(await storedGens()).toEqual([1]);
  });

  it('rebuilds unchanged bytes when forced or when an older ingest version built them', async () => {
    await run(serve(text, { headers: { ETag: '"v1"' } })).result;
    const forced = run(serve(text), { force: true });
    expect((await forced.result).status).toBe('committed');
    expect(forced.transport.requests[0]!.headers).toEqual({});
    await transact(db, STORE.sources, 'readwrite', (tx) => {
      const store = tx.objectStore(STORE.sources);
      onSuccess(store.get(SRC), (meta) => store.put({ ...(meta as SourceMeta), fetch: { ...(meta as SourceMeta).fetch!, v: INGEST_VERSION - 1 } }));
    });
    const old = run(serve(text));
    expect((await old.result).status).toBe('committed');
    expect(old.transport.requests[0]!.headers).toEqual({});
    expect(await storedGens()).toEqual([3]);
  });

  it('commits changed bytes, also when the length stays the same', async () => {
    await run(serve(text)).result;
    const sameLength = playlist(bigList('Chennel'));
    expect(sameLength.length).toBe(text.length);
    const r = await run(serve(sameLength)).result;
    expect(r).toMatchObject({ status: 'committed', gen: 2, previous: 1 });
    expect(await names(db, 'chennel 7')).toEqual(matching(bigList('Chennel'), 'chennel 7'));
    const r2 = await run(serve(playlist(bigList('Kanal')))).result;
    expect(r2).toMatchObject({ status: 'committed', gen: 3, previous: 2 });
  });
});

describe('runIngest: throttle', () => {
  /** A clock where each reading moves 2 ms on, and sleeps are logged. */
  function workClock(onSleep?: () => void): Clock & { sleeps: number[] } {
    let t = 0;
    const c = {
      sleeps: [] as number[],
      now: () => (t += 2),
      sleep: async (ms: number) => {
        c.sleeps.push(ms);
        t += ms;
        onSleep?.();
      },
    };
    return c;
  }

  it('pauses while the UI is busy, then finishes', async () => {
    let throttle: Throttle | null = null;
    const clock = workClock(() => {
      if (clock.sleeps.length === 4) throttle!.setBusy(false);
    });
    throttle = new Throttle({ clock });
    throttle.setBusy(true);
    const r = await run(serve(playlist(bigList()), { chunk: 1000 }), { throttle }).result;
    expect(r.status).toBe('committed');
    expect(r.throttle.busyMs).toBeGreaterThanOrEqual(400);
    expect(clock.sleeps.slice(0, 4)).toEqual([100, 100, 100, 100]);
  });

  it('runs the low-tier duty cycle', async () => {
    const clock = workClock();
    const throttle = new Throttle({ clock, duty: LOW_TIER_DUTY });
    const r = await run(serve(playlist(bigList()), { chunk: 1000 }), { throttle }).result;
    expect(r.status).toBe('committed');
    expect(clock.sleeps.length).toBeGreaterThan(3);
    expect(clock.sleeps.every((ms) => ms === 50)).toBe(true);
    expect(r.throttle.sleptMs).toBeGreaterThanOrEqual(clock.sleeps.length * 50);
  });
});

describe('runIngest: favourites', () => {
  const fav = (item: CatalogItem, added = 1, extra: Partial<FavouriteRef> = {}): FavouriteRef => ({
    key: item.key,
    src: item.src,
    kind: item.kind,
    normName: item.normName,
    group: item.group,
    epgId: item.epgId,
    added,
    missingSince: null,
    ...extra,
  });
  const favs = async (): Promise<FavouriteRef[]> => ((await loadProfile(db))!.doc as ProfileDoc).favourites;

  it('keeps present ones, re-matches a renamed channel by tvg-id, and drops a vanished one after 30 days', async () => {
    const base: Entry[] = [
      { name: 'Alpha News', group: 'News', tvgId: 'alpha.test' },
      { name: 'Beta Sport', group: 'Sport', tvgId: 'beta.test' },
      { name: 'Gamma Kids', group: 'Kids', tvgId: 'gamma.test' },
      { name: 'Delta Film', group: 'Movies', kind: 'movie' },
    ];
    const v1 = playlist(base);
    const k1 = keysOf(v1);
    await run(serve(v1)).result;
    const other: FavouriteRef = { key: 'x:other:live:1', src: 'other', kind: 'live', normName: 'x', added: 1, missingSince: null };
    await saveProfile(db, { ...emptyProfile(), favourites: [fav(k1.get('Alpha News')!), fav(k1.get('Beta Sport')!), fav(k1.get('Gamma Kids')!), fav(k1.get('Delta Film')!), other] }, { now: NOW });

    // v2: Beta renamed (same tvg-id, so a new key), Gamma gone.
    const v2 = playlist([base[0]!, { ...base[1]!, name: 'Beta Sports HD' }, base[3]!]);
    const k2 = keysOf(v2);
    const t2 = NOW + DAY;
    const r2 = await run(serve(v2), { now: () => t2 }).result;
    expect(r2.favourites).toEqual({
      src: SRC,
      changed: true,
      present: 2,
      rematched: [{ from: k1.get('Beta Sport')!.key, to: k2.get('Beta Sports HD')!.key }],
      missing: [k1.get('Gamma Kids')!.key],
      dropped: [],
      restored: [],
    });
    let list = await favs();
    expect(list.map((f) => [f.key, f.missingSince])).toEqual([
      [k1.get('Alpha News')!.key, null],
      [k2.get('Beta Sports HD')!.key, null],
      [k1.get('Gamma Kids')!.key, t2],
      [k1.get('Delta Film')!.key, null],
      [other.key, null],
    ]);
    // The re-matched favourite keeps its name for later re-matches; its group is updated.
    expect(list[1]).toMatchObject({ normName: k1.get('Beta Sport')!.normName, group: 'Sport', epgId: 'beta.test', added: 1 });

    // Gamma comes back within 30 days: restored.
    const t3 = t2 + 10 * DAY;
    const r3 = await run(serve(playlist([...base.slice(0, 3), { name: 'Epsilon', group: 'News' }])), { now: () => t3 }).result;
    expect(r3.favourites).toMatchObject({ restored: [k1.get('Gamma Kids')!.key], missing: [k1.get('Delta Film')!.key] });
    // The renamed Beta went back to its old name (and key): re-matched again.
    expect(r3.favourites!.rematched).toEqual([{ from: k2.get('Beta Sports HD')!.key, to: k1.get('Beta Sport')!.key }]);

    // Delta stays missing; 30 days after it vanished it is dropped.
    const r4 = await run(serve(playlist([...base.slice(0, 3), { name: 'Zeta', group: 'News' }])), { now: () => t3 + 29 * DAY }).result;
    expect(r4.favourites).toMatchObject({ changed: false, dropped: [] });
    const r5 = await run(serve(playlist([...base.slice(0, 3), { name: 'Eta', group: 'News' }])), { now: () => t3 + 30 * DAY }).result;
    expect(r5.favourites).toMatchObject({ changed: true, dropped: [k1.get('Delta Film')!.key] });
    list = await favs();
    expect(list.map((f) => f.key)).toEqual([k1.get('Alpha News')!.key, k1.get('Beta Sport')!.key, k1.get('Gamma Kids')!.key, other.key]);
  });

  it('leaves the profile alone when nothing changed, and works without a profile', async () => {
    const r1 = await run(serve(playlist(bigList()))).result;
    expect(r1.favourites).toBeNull();
    expect(await loadProfile(db)).toBeNull();
    const k = keysOf(playlist(bigList()));
    await saveProfile(db, { ...emptyProfile(), favourites: [fav(k.get('Channel 3')!)] }, { now: NOW });
    const r2 = await run(serve(playlist(bigList())), { force: true }).result;
    expect(r2.favourites).toMatchObject({ changed: false, present: 1 });
    expect(r2.favouritesError).toBeNull();
  });
});

