// RELAY step 8b: the app's DataEngine (apps/tv/src/data/engine.ts) against the real query and
// ingest services, each served over its own MessageChannel the way a worker would serve it, on
// one fake-indexeddb database. It checks the wiring the old-engine harness then runs for real
// in Chromium 53/56/68: prune at start, one ingest worker per refresh (terminated after),
// `swapped` → the query worker's `reload`, and remote keys → `setBusy`.

import type { RpcHandlers } from '@zoma/data';
import { IngestService, QueryService, STORE, getSources, openDatabase, serveRpc } from '@zoma/data';
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

/** An M3U playlist: `news` channels named "Sky News n", the rest "Channel n". */
function playlist(count: number, newsEvery = 4): string {
  const lines = ['#EXTM3U'];
  for (let i = 1; i <= count; i++) {
    const name = i % newsEvery === 0 ? `Sky News ${i}` : `Channel ${i}`;
    lines.push(`#EXTINF:-1 tvg-id="ch${i}" group-title="Group ${i % 3}",${name}`, `http://p.test/live/${i}.ts`);
  }
  return `${lines.join('\n')}\n`;
}

interface Setup {
  engine: DataEngine;
  factory: IDBFactory;
  started: { query: number; ingest: number };
  /** Ingest workers still running. */
  live: () => number;
  /** Every setBusy call the ingest workers got, in order. */
  busyCalls: boolean[];
  busyChanges: boolean[];
}

function setup(respond: (url: string) => FakeResponse, idleMs = 40): Setup {
  const factory = freshFactory();
  const transport = fakeTransport(respond);
  const started = { query: 0, ingest: 0 };
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
  });
  engines.push(engine);
  return { engine, factory, started, live: () => live, busyCalls, busyChanges };
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
    expect(s.started).toEqual({ query: 1, ingest: 1 });
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
    expect(s.started).toEqual({ query: 1, ingest: 2 });
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

  it('fails every call once disposed, and keys do nothing', async () => {
    const s = setup(() => ({ body: playlist(5) }));
    await s.engine.start();
    s.engine.dispose();
    s.engine.noteActivity();
    expect(s.busyChanges).toEqual([]);
    expect(() => s.engine.query).toThrow('The data engine was disposed');
  });
});
