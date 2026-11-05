// RELAY steps 8b and 9b: the app's DataEngine (apps/tv/src/data/engine.ts) against the real
// query, ingest and EPG services, each served over its own MessageChannel the way a worker would
// serve it, on one fake-indexeddb database. It checks the wiring the old-engine harness then runs
// for real in Chromium 53/56/68: prune at start, one ingest or EPG worker per refresh (terminated
// after), one refresh at a time, `swapped` → the query worker's `reload`, remote keys →
// `setBusy`, and now/next from the stored guides.

import type { RpcHandlers } from '@zoma/data';
import { EPG_REFRESH_MS, EpgService, IngestService, QueryService, STORE, getSources, newSourceMeta, openDatabase, serveRpc } from '@zoma/data';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkerLike } from '../apps/tv/src/data/engine';
import { DataEngine } from '../apps/tv/src/data/engine';
import type { FakeResponse } from '../packages/data/src/test-support';
import { dumpStore, fakeTransport, freshFactory, ingest, item } from '../packages/data/src/test-support';

const opened: MessagePort[] = [];
const engines: DataEngine[] = [];

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  for (const port of opened.splice(0)) port.close();
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const NOW = Date.UTC(2026, 10, 2, 12);
const GUIDE_URL = 'http://p.test/guide.xml';

/** An M3U playlist: `news` channels named "Sky News n", the rest "Channel n". */
function playlist(count: number, newsEvery = 4, guide = false): string {
  const lines = [guide ? `#EXTM3U url-tvg="${GUIDE_URL}"` : '#EXTM3U'];
  for (let i = 1; i <= count; i++) {
    const name = i % newsEvery === 0 ? `Sky News ${i}` : `Channel ${i}`;
    lines.push(`#EXTINF:-1 tvg-id="ch${i}" group-title="Group ${i % 3}",${name}`, `http://p.test/live/${i}.ts`);
  }
  return `${lines.join('\n')}\n`;
}

/** A guide for channels ch1..chN: hourly programmes "chN at H" (described, in "Test") from yesterday to 3 days ahead. */
function guide(count: number): string {
  const lines = ['<?xml version="1.0"?>', '<tv>'];
  for (let i = 1; i <= count; i++) lines.push(`<channel id="ch${i}"><display-name>Channel ${i}</display-name></channel>`);
  const t = (ms: number): string => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  for (let i = 1; i <= count; i++) {
    for (let ms = NOW - 86_400_000; ms < NOW + 3 * 86_400_000; ms += 3_600_000) {
      lines.push(`<programme start="${t(ms)}" stop="${t(ms + 3_600_000)}" channel="ch${i}"><title>ch${i} at ${new Date(ms).getUTCHours()}</title><desc>About ch${i} at ${new Date(ms).getUTCHours()}</desc><category>Test</category></programme>`);
    }
  }
  lines.push('</tv>');
  return lines.join('\n');
}

interface Setup {
  engine: DataEngine;
  factory: IDBFactory;
  started: { query: number; ingest: number; epg: number };
  /** Moves the engine's clock (it decides which guides are due). */
  clock: { now: number };
  /** Ingest workers still running. */
  live: () => number;
  /** Every setBusy call the ingest workers got, in order. */
  busyCalls: boolean[];
  busyChanges: boolean[];
}

function setup(respond: (url: string) => FakeResponse, idleMs = 40): Setup {
  const factory = freshFactory();
  const transport = fakeTransport(respond);
  const started = { query: 0, ingest: 0, epg: 0 };
  const clock = { now: NOW };
  let live = 0;
  const busyCalls: boolean[] = [];
  const busyChanges: boolean[] = [];

  /** A stand-in Worker: the handlers are served on one end of a channel, the engine gets the other. */
  function worker(handlers: RpcHandlers, dbs: IDBDatabase[], onTerminate: () => void = () => undefined): WorkerLike {
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    const server = serveRpc(port1 as unknown as Parameters<typeof serveRpc>[0], handlers);
    let terminated = false;
    return {
      onerror: null,
      postMessage: (message, transfer) => port2.postMessage(message, transfer ?? []),
      addEventListener: (type, listener) => port2.addEventListener(type, listener as (event: Event) => void),
      removeEventListener: (type, listener) => port2.removeEventListener(type, listener as (event: Event) => void),
      start: () => port2.start(),
      terminate: () => {
        if (terminated) return;
        terminated = true;
        server.close();
        for (const db of dbs) db.close();
        port1.close();
        port2.close();
        onTerminate();
      },
    };
  }

  const engine = new DataEngine({
    idleMs,
    now: () => clock.now,
    onBusy: (busy) => busyChanges.push(busy),
    startQueryWorker: () => {
      started.query++;
      const dbs: IDBDatabase[] = [];
      const service = new QueryService({
        openDb: async () => {
          const db = await openDatabase(factory);
          dbs.push(db);
          return db;
        },
      });
      return worker(service.handlers(), dbs);
    },
    startIngestWorker: () => {
      started.ingest++;
      live++;
      const dbs: IDBDatabase[] = [];
      const service = new IngestService({
        transport,
        openDb: async () => {
          const db = await openDatabase(factory);
          dbs.push(db);
          return db;
        },
      });
      const handlers = service.handlers();
      return worker(
        {
          ...handlers,
          setBusy: (arg: { busy: boolean }) => {
            busyCalls.push(arg.busy);
            return handlers.setBusy(arg);
          },
        },
        dbs,
        () => {
          live--;
        },
      );
    },
    startEpgWorker: () => {
      started.epg++;
      live++;
      const dbs: IDBDatabase[] = [];
      const service = new EpgService({
        transport,
        now: () => clock.now,
        openDb: async () => {
          const db = await openDatabase(factory);
          dbs.push(db);
          return db;
        },
      });
      const handlers = service.handlers();
      return worker(
        {
          ...handlers,
          setBusy: (arg: { busy: boolean }) => {
            busyCalls.push(arg.busy);
            return handlers.setBusy(arg);
          },
        },
        dbs,
        () => {
          live--;
        },
      );
    },
  });
  engines.push(engine);
  return { engine, factory, started, clock, live: () => live, busyCalls, busyChanges };
}

const job = (url = 'http://p.test/list.m3u') => ({ src: 'debug', source: { type: 'm3u' as const, url } });

describe('DataEngine (the app wiring of the data workers)', () => {
  it('prunes what a killed refresh left behind at start, in a short-lived ingest worker', async () => {
    const s = setup(() => ({ body: playlist(10) }));
    const db = await openDatabase(s.factory);
    await ingest(db, 'debug', [item('debug', 'live', 1, 'Old One')]);
    await ingest(db, 'debug', [item('debug', 'live', 2, 'Half Written')], { commit: false });
    expect((await getSources(db))[0]).toMatchObject({ gen: 1, building: 2 });

    expect(await s.engine.start()).toBe(1);
    expect(s.engine.start()).toBe(s.engine.start()); // one prune per app start
    expect(s.started).toEqual({ query: 1, ingest: 1, epg: 0 });
    expect(s.live()).toBe(0);
    expect((await getSources(db))[0]).toMatchObject({ gen: 1, building: null });
    expect(new Set((await dumpStore(db, STORE.chunks)).map(([k]) => (k as unknown[])[1]))).toEqual(new Set([1]));
    expect(await s.engine.summary()).toEqual({ sources: 1, items: 1, stale: 0 });
    db.close();
  });

  it('refreshes in its own ingest worker and makes the loaded query worker reload on the swap', async () => {
    const s = setup(() => ({ body: playlist(1200), headers: { etag: '"v1"' } }));
    await s.engine.start();
    // The query worker has loaded (an empty catalog) before the refresh: only `reload` can
    // make it see the new generation.
    expect(await s.engine.summary()).toEqual({ sources: 0, items: 0, stale: 0 });
    expect((await s.engine.search('news')).total).toBe(0);

    const progress: number[] = [];
    const result = await s.engine.refresh(job(), { onProgress: (p) => progress.push(p.items) });
    expect(result).toMatchObject({ status: 'committed', gen: 1, previous: 0, counts: { live: 1200 } });
    expect(progress.length).toBeGreaterThan(0);
    expect(s.started).toEqual({ query: 1, ingest: 2, epg: 0 });
    expect(s.live()).toBe(0);
    expect(s.engine.refreshing).toBe(false);

    expect(await s.engine.summary()).toEqual({ sources: 1, items: 1200, stale: 0 });
    const found = await s.engine.search('sky news');
    expect(found.total).toBe(300);
    expect(found.names).toHaveLength(3);
    for (const name of found.names) expect(name).toMatch(/^Sky News \d+$/);

    // The next refresh gets a 304 and reports `unchanged`; the catalog stays.
    const again = await s.engine.refresh(job());
    expect(again).toMatchObject({ status: 'unchanged', gen: 1 });
    expect(s.started.ingest).toBe(3);
    expect((await s.engine.search('news')).total).toBe(300);
  });

  it("hands out each Xtream source's allowed_output_formats from the sources' records (step 20c2a)", async () => {
    const s = setup(() => ({ body: playlist(10) }));
    await s.engine.refresh(job());
    // A playlist has none.
    expect([...(await s.engine.outputFormats())]).toEqual([]);
    // An Xtream source's record, as its ingest leaves it.
    const db = await openDatabase(s.factory);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE.sources, 'readwrite');
      tx.objectStore(STORE.sources).put({ ...newSourceMeta('xt'), outputFormats: ['m3u8'] });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await s.engine.query.call('reload');
    expect([...(await s.engine.outputFormats())]).toEqual([['xt', ['m3u8']]]);
  });

  it('reports a failed refresh, terminates its worker and keeps serving the old catalog', async () => {
    let status = 200;
    const s = setup(() => ({ status, body: status === 200 ? playlist(40) : 'gone' }));
    await s.engine.refresh(job());
    status = 404;
    await expect(s.engine.refresh(job())).rejects.toThrow(/HTTP 404/);
    expect(s.live()).toBe(0);
    expect(s.engine.refreshing).toBe(false);
    expect((await s.engine.search('news')).total).toBe(10);
  });

  it('runs one refresh at a time', async () => {
    const s = setup(() => ({ body: playlist(20) }));
    const first = s.engine.refresh(job());
    await expect(s.engine.refresh(job())).rejects.toThrow('A catalog refresh is already running');
    await expect(first).resolves.toMatchObject({ status: 'committed' });
    await expect(s.engine.refresh(job())).resolves.toMatchObject({ status: 'unchanged' });
  });

  it('pauses a running refresh while remote keys are pressed, and resumes it when they stop', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let chunks = 0;
    const s = setup(() => ({
      body: playlist(400),
      chunk: 1024,
      beforeChunk: async (n) => {
        chunks = n + 1;
        if (n === 1) await gate;
      },
    }));
    const refresh = s.engine.refresh(job());
    while (chunks < 2) await delay(5);

    s.engine.noteActivity();
    s.engine.noteActivity(); // a burst sends busy once
    expect(s.engine.busy).toBe(true);
    await delay(10);
    expect(s.busyCalls).toEqual([true]);
    release();
    // Paused at the next checkpoint: no more chunks are read while busy.
    await delay(25);
    const pausedAt = chunks;
    await delay(10);
    expect(chunks).toBe(pausedAt);

    // idleMs (40 ms) after the last key the UI is idle and the refresh finishes.
    await expect(refresh).resolves.toMatchObject({ status: 'committed', counts: { live: 400 } });
    expect(s.busyCalls).toEqual([true, false]);
    expect(s.busyChanges).toEqual([true, false]);
    expect(s.engine.busy).toBe(false);
  });

  it('tells a refresh that starts mid-burst that the UI is busy', async () => {
    const s = setup(() => ({ body: playlist(50) }));
    await s.engine.start();
    s.engine.noteActivity();
    const done = s.engine.refresh(job());
    await expect(done).resolves.toMatchObject({ status: 'committed' });
    expect(s.busyCalls[0]).toBe(true);
    expect(s.busyCalls).toContain(false);
  });

  it('refreshes the guides a playlist names in an EPG worker, and reads now/next from the store', async () => {
    const s = setup((url) => (url === GUIDE_URL ? { body: guide(6), chunk: 2048 } : { body: playlist(8, 4, true) }));
    await s.engine.refresh(job());
    const catalogs = [{ src: 'debug', type: 'm3u' as const }];
    const progress: number[] = [];
    const r = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, onProgress: (p) => progress.push(p.kept) });
    expect(r.outcomes.map((o) => [o.epgSrc, o.result?.status, o.result?.summary?.matched])).toEqual([['debug:tvg0', 'committed', 6]]);
    expect(r.wanted).toBe(8);
    expect(progress.length).toBeGreaterThan(0);
    expect(s.started).toEqual({ query: 1, ingest: 2, epg: 1 });
    expect(s.live()).toBe(0);
    expect(s.engine.refreshing).toBe(false);

    // The query worker reloaded on the swap: now/next comes back from the store.
    const status = await s.engine.epgStatus();
    expect(status).toMatchObject({ matched: 6, guides: [{ epgSrc: 'debug:tvg0', gen: 1, summary: { wanted: 8, matched: 6 } }] });
    const keys = (await s.engine.search('channel 1', { names: 1 })).keys;
    const [one] = await s.engine.nowNext(keys, NOW + 90 * 60_000);
    expect(one).toMatchObject({ channel: 'ch1', method: 'id', now: { title: 'ch1 at 13' }, next: { title: 'ch1 at 14' } });
    const [seven] = await s.engine.nowNext([(await s.engine.search('channel 7', { names: 1 })).keys[0]!], NOW);
    expect(seven).toMatchObject({ epgSrc: null, now: null, next: null });
    // The grid guide's rows come through the same worker (step 23a), as plain arrays.
    const nowMin = NOW / 60_000;
    const [row, none] = await s.engine.guide({ keys: [keys[0]!, seven!.key], from: nowMin + 60, to: nowMin + 180 });
    expect(row).toEqual({ key: keys[0], epgSrc: 'debug:tvg0', start: [nowMin + 60, nowMin + 120], end: [nowMin + 120, nowMin + 180], title: ['ch1 at 13', 'ch1 at 14'] });
    expect(none).toEqual({ key: seven!.key, epgSrc: null, start: [], end: [], title: [] });
    await expect(s.engine.guide({ keys: [keys[0]!], from: nowMin, to: nowMin + 2_000 * 1440 })).rejects.toThrow('channel-days');
    // And one programme's details (step 24a).
    expect(await s.engine.programme({ key: keys[0]!, start: nowMin + 120 })).toEqual({ start: nowMin + 120, end: nowMin + 180, title: 'ch1 at 14', sub: '', desc: 'About ch1 at 14', category: 'Test', episode: '', flags: 0 });
    expect(await s.engine.programme({ key: keys[0]!, start: nowMin + 121 })).toBeNull();
    expect(await s.engine.programme({ key: seven!.key, start: nowMin + 120 })).toBeNull();

    // Nothing is due right after: no worker starts. Twelve hours on, it is due again.
    const quiet = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true });
    expect(quiet).toEqual({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    expect(s.started.epg).toBe(1);
    s.clock.now = NOW + EPG_REFRESH_MS;
    const later = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true });
    expect(later.outcomes.map((o) => o.result?.status)).toEqual(['unchanged']);
    expect(s.started.epg).toBe(2);
  });

  it("sets a moved user guide's rank with no download, deletes a removed one, and reloads the query worker (step 22b)", async () => {
    const asked: string[] = [];
    const s = setup((url) => {
      asked.push(url);
      return url.startsWith('http://u.test/') ? { body: guide(6) } : { body: playlist(8, 4) };
    });
    await s.engine.refresh(job());
    const catalogs = [{ src: 'debug', type: 'm3u' as const }];
    const a = { id: 'g1', url: 'http://u.test/a.xml' };
    const b = { id: 'g2', url: 'http://u.test/b.xml' };
    const ch1 = (await s.engine.search('channel 1', { names: 1 })).keys;
    const first = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user: [a, b] });
    expect(first.outcomes.map((o) => [o.epgSrc, o.result?.status])).toEqual([
      ['u~g1', 'committed'],
      ['u~g2', 'committed'],
    ]);
    // Both guides match ch1 by id: the first in the order wins.
    expect((await s.engine.nowNext(ch1, NOW))[0]).toMatchObject({ epgSrc: 'u~g1' });
    const downloads = asked.length;

    // Moved: nothing is due, yet a worker starts to set the ranks; nothing is downloaded.
    const moved = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user: [b, a] });
    expect(moved).toEqual({ outcomes: [], deleted: [], reranked: ['u~g1', 'u~g2'], wanted: 0 });
    expect(s.started.epg).toBe(2);
    expect(asked.length).toBe(downloads);
    expect((await s.engine.epgStatus()).guides.map((g) => [g.epgSrc, g.rank])).toEqual([
      ['u~g2', 0],
      ['u~g1', 1],
    ]);
    expect((await s.engine.nowNext(ch1, NOW))[0]).toMatchObject({ epgSrc: 'u~g2' });

    // Removed: deleted, the other moves up, still no download.
    const removed = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user: [a] });
    expect(removed).toEqual({ outcomes: [], deleted: ['u~g2'], reranked: ['u~g1'], wanted: 0 });
    expect(asked.length).toBe(downloads);
    expect((await s.engine.epgStatus()).guides.map((g) => [g.epgSrc, g.rank])).toEqual([['u~g1', 0]]);
    expect((await s.engine.nowNext(ch1, NOW))[0]).toMatchObject({ epgSrc: 'u~g1' });

    // The same list again: no worker at all.
    expect(await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user: [a] })).toEqual({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    expect(s.started.epg).toBe(3);
  });

  it('runs catalog and guide refreshes one at a time, and pauses a guide refresh for keys', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let chunks = 0;
    const s = setup((url) =>
      url === GUIDE_URL
        ? {
            body: guide(20),
            chunk: 1024,
            beforeChunk: async (n) => {
              chunks = n + 1;
              if (n === 1) await gate;
            },
          }
        : { body: playlist(20, 4, true) },
    );
    await s.engine.refresh(job());
    const catalogs = [{ src: 'debug', type: 'm3u' as const }];
    const epg = s.engine.refreshEpg(catalogs, { tier: 'low' });
    await expect(s.engine.refresh(job())).rejects.toThrow('A guide refresh is already running');
    await expect(s.engine.refreshEpg(catalogs, { tier: 'low' })).rejects.toThrow('A guide refresh is already running');
    while (chunks < 2) await delay(5);
    s.engine.noteActivity();
    await delay(10);
    expect(s.busyCalls).toEqual([true]);
    release();
    await delay(25);
    const pausedAt = chunks;
    await delay(10);
    expect(chunks).toBe(pausedAt);
    const r = await epg;
    expect(r.outcomes[0]!.result).toMatchObject({ status: 'committed', summary: { matched: 20, pastDays: 1, futureDays: 3 } });
    expect(s.busyCalls).toEqual([true, false]);

    const catalog = s.engine.refresh(job());
    await expect(s.engine.refreshEpg(catalogs, { tier: 'low' })).rejects.toThrow('A catalog refresh is already running');
    await catalog;
    expect(s.live()).toBe(0);
  });

  it('fails every call once disposed, and keys do nothing', async () => {
    const s = setup(() => ({ body: playlist(5) }));
    await s.engine.start();
    s.engine.dispose();
    s.engine.noteActivity();
    expect(s.busyChanges).toEqual([]);
    expect(() => s.engine.query).toThrow('The data engine was disposed');
  });
});
