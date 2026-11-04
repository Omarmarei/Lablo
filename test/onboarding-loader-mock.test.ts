// RELAY step 13b: onboarding's engine loader (apps/tv/src/onboarding/engine-loader.ts) on the
// app's DataEngine, with the real query, ingest and EPG services each served over a
// MessageChannel the way a worker serves them, against the mock provider over a real socket
// (Node's fetch). The e2e runs the same through the screens in Chromium; this pins what the
// screens show: the mock's counts, the profile entry, the guide, and each failure's code.

import type { RpcHandlers, RpcPort } from '@zoma/data';
import { EpgService, IngestService, QueryService, fetchTransport, openDatabase, serveRpc } from '@zoma/data';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Catalog } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { WorkerLike } from '../apps/tv/src/data/engine';
import { DataEngine } from '../apps/tv/src/data/engine';
import { createEngineLoader } from '../apps/tv/src/onboarding/engine-loader';
import type { SourceDraft } from '../apps/tv/src/onboarding/form';
import type { LoadProgress } from '../apps/tv/src/onboarding/loader';
import { freshFactory } from '../packages/data/src/test-support';

const catalog: Catalog = loadCatalog();
const episodes = catalog.series.reduce((n, s) => n + s.seasons.reduce((m, season) => m + season.episodes.length, 0), 0);

let app: MockServer;
let base: string;
const opened: MessagePort[] = [];
const engines: DataEngine[] = [];

beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  for (const port of opened.splice(0)) port.close();
});

/** A DataEngine whose workers are the real services on one fake-indexeddb database. */
function engine(): DataEngine {
  const factory = freshFactory();
  const transport = fetchTransport();
  const openDb = (dbs: IDBDatabase[]) => async (): Promise<IDBDatabase> => {
    const db = await openDatabase(factory);
    dbs.push(db);
    return db;
  };
  function worker(handlers: RpcHandlers, dbs: IDBDatabase[]): WorkerLike {
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    const server = serveRpc(port1 as unknown as RpcPort, handlers);
    return {
      onerror: null,
      postMessage: (message, transfer) => port2.postMessage(message, transfer ?? []),
      addEventListener: (type, listener) => port2.addEventListener(type, listener as (event: Event) => void),
      removeEventListener: (type, listener) => port2.removeEventListener(type, listener as (event: Event) => void),
      start: () => port2.start(),
      terminate: () => {
        server.close();
        for (const db of dbs) db.close();
        port1.close();
        port2.close();
      },
    };
  }
  const made = new DataEngine({
    now: () => NOW,
    startQueryWorker: () => {
      const dbs: IDBDatabase[] = [];
      return worker(new QueryService({ openDb: openDb(dbs), now: () => NOW }).handlers(), dbs);
    },
    startIngestWorker: () => {
      const dbs: IDBDatabase[] = [];
      return worker(new IngestService({ transport, openDb: openDb(dbs) }).handlers(), dbs);
    },
    startEpgWorker: () => {
      const dbs: IDBDatabase[] = [];
      return worker(new EpgService({ transport, openDb: openDb(dbs), now: () => NOW }).handlers(), dbs);
    },
  });
  engines.push(made);
  return made;
}

function loader(data: DataEngine) {
  return createEngineLoader({ engine: data, tier: () => Promise.resolve('full'), languages: () => ['en'], now: () => NOW });
}

const xtream = (username = U, password = P): SourceDraft => ({ type: 'xtream', name: 'Mock', account: { base, username, password }, epgUrl: null });
const m3u = (url: string): SourceDraft => ({ type: 'm3u', name: 'Mock list', url, epgUrl: null });

describe("onboarding's loader against the mock provider", () => {
  it('adds an Xtream login: the mock counts, its guide, and the source in the profile', async () => {
    const data = engine();
    const phases: LoadProgress['phase'][] = [];
    const result = await loader(data).start(xtream(), (p) => {
      if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
    }).done;
    expect(result).toEqual({ live: catalog.live.length, movies: catalog.movies.length, series: catalog.series.length });
    expect(phases).toEqual(['checking', 'download', 'saving', 'guide']);
    // The panel's guide was read with it.
    const status = await data.epgStatus();
    expect(status.guides.map((g) => [g.epgSrc, g.gen > 0])).toEqual([['s1:xmltv', true]]);
    expect(status.matched).toBeGreaterThan(0);
    const profile = await data.profile();
    expect(profile?.doc).toMatchObject({ v: 4, sources: [{ id: 's1', type: 'xtream', name: 'Mock', account: { base, username: U, password: P }, added: NOW }], guides: [] });
    expect(await data.summary()).toEqual({ sources: 1, items: catalog.live.length + catalog.movies.length + catalog.series.length, stale: 0 });
  });

  it("adds an M3U link with the user's guide link, and a second source gets the next id", async () => {
    const data = engine();
    const guide = `${base}/xmltv.php?username=${U}&password=${P}`;
    const list = { ...m3u(`${base}/get.php?username=${U}&password=${P}&type=m3u_plus`), epgUrl: guide };
    expect(await loader(data).start(list, () => undefined).done).toEqual({ live: catalog.live.length, movies: catalog.movies.length, series: episodes });
    const guides = (await data.epgStatus()).guides.map((g) => g.epgSrc);
    // The typed guide first (`u~s1`); the playlist's own url-tvg is the same address, read once.
    expect(guides).toEqual(['u~s1']);
    await loader(data).start(xtream(), () => undefined).done;
    // The typed link is in the profile's guide list (version 4), under its source's id.
    expect((await data.profile())?.doc).toMatchObject({ sources: [{ id: 's1', type: 'm3u' }, { id: 's2', type: 'xtream' }], guides: [{ id: 's1', url: guide }] });
    // The panel's own guide is the same address as the typed one: still read once, as `u~s1`.
    expect((await data.epgStatus()).guides.map((g) => g.epgSrc)).toEqual(['u~s1']);
  });

  it("names each failure: a wrong password, an expired, banned or disabled account, a link that isn't there", async () => {
    const data = engine();
    const fails = (draft: SourceDraft) => loader(data).start(draft, () => undefined).done;
    await expect(fails(xtream(U, 'wrong'))).rejects.toMatchObject({ name: 'LoadError', code: 'auth' });
    await expect(fails(xtream('expired', 'expired-test'))).rejects.toMatchObject({ code: 'expired' });
    await expect(fails(xtream('banned', 'banned-test'))).rejects.toMatchObject({ code: 'blocked' });
    await expect(fails(xtream('disabled', 'disabled-test'))).rejects.toMatchObject({ code: 'blocked' });
    // The HTTP status crosses the worker boundary for the message.
    await expect(fails(m3u(`${base}/no-such-list.m3u`))).rejects.toMatchObject({ code: 'http', status: 404 });
    await expect(fails(m3u(`${base}/get.php?username=${U}&password=wrong&type=m3u_plus`))).rejects.toMatchObject({ code: 'auth' });
    await expect(fails(m3u('http://127.0.0.1:9/list.m3u'))).rejects.toMatchObject({ code: 'network' });
    // Nothing was saved for any of them.
    expect(await data.profile()).toBeNull();
    expect(await data.summary()).toEqual({ sources: 0, items: 0, stale: 0 });
  });
});
