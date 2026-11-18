// RELAY steps 8b and 9b: the app's DataEngine (apps/tv/src/data/engine.ts) against the real
// query, ingest and EPG services, each served over its own MessageChannel the way a worker would
// serve it, on one fake-indexeddb database. It checks the wiring the old-engine harness then runs
// for real in Chromium 53/56/68: prune at start, one ingest or EPG worker per refresh (terminated
// after), one refresh at a time, `swapped` → the query worker's `reload`, remote keys →
// `setBusy`, and now/next from the stored guides. Step 30b2: one config worker per config refresh
// (the cached policy first, terminated after), and the query worker's blocklist read again.
// Step 32b: one backup worker per prepareBackup (terminated after). Step 32c1: per uploadBackup and
// restoreBackup too, against the backup API in memory; a cancelled look-up ends its worker.

import { boxKeyPairFromSecretKey, sealFile, sealPairPayload, toBase64Url, utf8 } from '@lablo/crypto';
import type { ConfigResult, RpcHandlers } from '@lablo/data';
import type { BackupStandIn, ByteRequest } from '@lablo/data';
import {
  BACKUP_CODE_KEY,
  BACKUP_MASTER_KEY,
  BACKUP_SENT_KEY,
  CancelSource,
  EPG_REFRESH_MS,
  EpgService,
  IngestService,
  QueryService,
  STORE,
  backupHandlers,
  backupStandIn,
  configHandlers,
  getSources,
  getValue,
  newSourceMeta,
  openDatabase,
  pairHandlers,
  serveRpc,
} from '@lablo/data';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerLike } from '../apps/tv/src/data/engine';
import { BlockedSourceError, DataEngine, sourceUrlOf } from '../apps/tv/src/data/engine';
import { createEngineLoader } from '../apps/tv/src/onboarding/engine-loader';
import type { SourceDraft } from '../apps/tv/src/onboarding/form';
import { fileError } from '../apps/tv/src/pairing/pair-draft';
import type { FakeResponse } from '../packages/data/src/test-support';
import { configAnswer, configDocFields, configSigner, dumpStore, fakeTransport, freshFactory, ingest, item } from '../packages/data/src/test-support';

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
  started: { query: number; ingest: number; epg: number; config: number; pair: number };
  /** Config workers still running. */
  configLive: () => number;
  /** Pair workers still running. */
  pairLive: () => number;
  /** Backup workers started, and still running (step 32b). */
  backup: { started: number; live: number };
  /** The backup API the backup workers call (step 32c1), and a hold on its next GET. */
  backupApi: BackupStandIn;
  backupHold: { gate: Promise<void> | null; held: number; urls: string[] };
  /** Moves the engine's clock (it decides which guides are due). */
  clock: { now: number };
  /** Ingest workers still running. */
  live: () => number;
  /** Every setBusy call the ingest workers got, in order. */
  busyCalls: boolean[];
  busyChanges: boolean[];
  /** `onProfileChanged` calls (step 32c2). */
  profileChanges: { n: number };
}

function setup(respond: (url: string) => FakeResponse, idleMs = 40, configRun?: RpcHandlers['run'], reloadConfig?: RpcHandlers['reloadConfig']): Setup {
  const factory = freshFactory();
  const transport = fakeTransport(respond);
  const started = { query: 0, ingest: 0, epg: 0, config: 0, pair: 0 };
  const clock = { now: NOW };
  let live = 0;
  let configLive = 0;
  let pairLive = 0;
  const backup = { started: 0, live: 0 };
  const backupApi = backupStandIn();
  const backupHold: Setup['backupHold'] = { gate: null, held: 0, urls: [] };
  const busyCalls: boolean[] = [];
  const busyChanges: boolean[] = [];
  const profileChanges = { n: 0 };

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
    onProfileChanged: () => {
      profileChanges.n++;
    },
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
      return worker(reloadConfig ? { ...service.handlers(), reloadConfig } : service.handlers(), dbs);
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
    startConfigWorker: () => {
      started.config++;
      configLive++;
      const dbs: IDBDatabase[] = [];
      const handlers = configHandlers({
        transport,
        clock: { now: () => clock.now, sleep: (ms) => delay(ms) },
        openDb: async () => {
          const db = await openDatabase(factory);
          dbs.push(db);
          return db;
        },
      });
      return worker(configRun ? { run: configRun } : handlers, dbs, () => {
        configLive--;
      });
    },
    startPairWorker: () => {
      started.pair++;
      pairLive++;
      return worker(pairHandlers({ transport, clock: { now: () => clock.now, sleep: (ms) => delay(ms) }, keyPair: () => PAIR_KEYS }), [], () => {
        pairLive--;
      });
    },
    startBackupWorker: () => {
      backup.started++;
      backup.live++;
      const dbs: IDBDatabase[] = [];
      const handlers = backupHandlers({
        openDb: async () => {
          const db = await openDatabase(factory);
          dbs.push(db);
          return db;
        },
        derive: backupDerive,
        random: () => new Uint8Array(16).fill(9),
        transport: {
          async get(url: string, request?: ByteRequest) {
            backupHold.urls.push(url);
            const gate = backupHold.gate;
            if (gate !== null && (request?.method ?? 'GET') === 'GET') {
              backupHold.gate = null;
              backupHold.held++;
              await gate;
            }
            return backupApi.transport.get(url, request);
          },
        },
        clock: { now: () => clock.now, sleep: () => new Promise<void>(() => undefined) },
      });
      return worker(handlers, dbs, () => {
        backup.live--;
      });
    },
  });
  engines.push(engine);
  return { engine, factory, started, configLive: () => configLive, pairLive: () => pairLive, backup, backupApi, backupHold, clock, live: () => live, busyCalls, busyChanges, profileChanges };
}

const CONFIG_URL = 'http://api.test/v1/config';
/** The backup worker's scrypt in these tests (step 32b): halfway, done, and a master from the secret; `boom` fails. */
function backupDerive(secret: string, platform: string, appId: string, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  if (secret === 'boom') return Promise.reject(new Error('scrypt failed'));
  onProgress?.(0.5);
  onProgress?.(1);
  return Promise.resolve(new Uint8Array(createHash('sha256').update(`${platform}|${appId}|${secret}`).digest()));
}
const BACKUP_REQUEST = { platform: 'webos', appId: 'com.lablo.iptv', secret: 'LGUDID-1' };
/** An upload's or a restore's request (step 32c1): the API's origin added. */
const BACKUP_CALL = { ...BACKUP_REQUEST, base: 'http://api.test' };
/** The pair worker's key pair in these tests (step 31c1): the scripted phone seals to it. */
const PAIR_KEYS = boxKeyPairFromSecretKey(new Uint8Array(32).fill(5));
const SALT = 'QtHj17D-F3HxhSWwfvhERM83_Cu0K5lHS7cQ_PczpBA';
/** A dev-signed config in force at NOW: a kill rule, and `blocked.example` on the blocklist. */
const CONFIG_DOC = configDocFields({
  issuedAt: NOW - 60_000,
  expiresAt: NOW + 86_400_000,
  kill: [{ id: 'k1', match: {}, mode: 'disable-playback' }],
  blocklist: { salt: SALT, hashes: [createHash('sha256').update(`${SALT}blocked.example`, 'utf8').digest('base64url')] },
});
const CONFIG_REQUEST = { base: 'http://api.test', platform: 'webos' as const, version: '0.1.0', keys: [toBase64Url(configSigner().publicKey)] };
const BLOCK_URLS = ['http://live.blocked.example/1.ts', 'http://free.example/1.ts'];

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
    expect(s.started).toEqual({ query: 1, ingest: 1, epg: 0, config: 0, pair: 0 });
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
    expect(s.started).toEqual({ query: 1, ingest: 2, epg: 0, config: 0, pair: 0 });
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

  it("finds the search screen's hits in the sources asked, cancellable, and reads their items (step 28a)", async () => {
    const s = setup(() => ({ body: playlist(40) }));
    await s.engine.start();
    await s.engine.refresh(job());
    const result = await s.engine.find({ query: 'sky news', sources: ['debug'], limit: 5 });
    expect(result.total).toBe(10);
    expect(result.hits).toHaveLength(5);
    const items = await s.engine.items(result.hits.map((h) => ({ src: h.src, kind: h.kind, gen: h.gen, catIdx: h.catIdx, chunk: h.chunk, slot: h.slot })));
    expect(items).toHaveLength(5);
    for (const found of items) expect(found!.name).toMatch(/^Sky News \d+$/);
    // A source not asked lists nothing.
    expect((await s.engine.find({ query: 'sky news', sources: ['other'] })).total).toBe(0);
    // Cancelled: rejected, never answered.
    const cancel = new CancelSource();
    const running = s.engine.find({ query: 'channel' }, cancel.token);
    cancel.cancel();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect((await s.engine.find({ query: 'channel' }, new CancelSource().token)).total).toBe(30);
    expect((await s.engine.find({ query: 'channel' })).total).toBe(30);
  });

  it("hands out each source's allowed_output_formats and panel zone from the sources' records (steps 20c2a, 25a)", async () => {
    const s = setup(() => ({ body: playlist(10) }));
    await s.engine.refresh(job());
    // A playlist has no formats, and UTC.
    const own = await s.engine.sourceFacts();
    expect([...own.keys()]).toHaveLength(1);
    const [playlistFacts] = [...own.values()];
    expect(playlistFacts!.outputFormats).toBeNull();
    expect(playlistFacts!.zone(Date.UTC(2026, 10, 3))).toBe(0);
    // An Xtream source's record, as its ingest leaves it.
    const db = await openDatabase(s.factory);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE.sources, 'readwrite');
      tx.objectStore(STORE.sources).put({
        ...newSourceMeta('xt'),
        outputFormats: ['m3u8'],
        server: { url: 'panel', port: '80', httpsPort: '443', protocol: 'http', timezone: null, timeNow: '2026-11-03 21:00:00', timestampNow: Date.UTC(2026, 10, 3, 18) / 1000 },
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await s.engine.query.call('reload');
    const xt = (await s.engine.sourceFacts()).get('xt')!;
    expect(xt.outputFormats).toEqual(['m3u8']);
    // The panel's clock: three hours ahead of UTC.
    expect(xt.zone(Date.UTC(2026, 10, 3))).toBe(180);
  });

  it("takes a get.php link's panel zone and formats from the refresh's login (step 25b)", async () => {
    const login = JSON.stringify({
      user_info: { auth: 1, status: 'Active', allowed_output_formats: ['ts'] },
      server_info: { url: 'p.test', port: '80', timezone: 'Asia/Riyadh', timestamp_now: NOW / 1000, time_now: '2026-11-02 15:00:00' },
    });
    const s = setup((url) => (url.indexOf('/player_api.php?') !== -1 ? { body: login } : { body: playlist(10) }));
    await s.engine.refresh(job('http://p.test/get.php?username=u&password=p&type=m3u_plus'));
    const facts = (await s.engine.sourceFacts()).get('debug')!;
    expect(facts.outputFormats).toEqual(['ts']);
    expect(facts.zone(Date.UTC(2026, 10, 3))).toBe(180);
  });

  it('tells the backup schedule after a profile edit that changed it and after a refresh that committed, and only then (step 32c2)', async () => {
    let status = 200;
    const s = setup(() => ({ status, body: status === 200 ? playlist(20) : 'gone' }));
    expect(s.profileChanges.n).toBe(0);
    await s.engine.refresh(job());
    expect(s.profileChanges.n).toBe(1);
    // Unchanged (a 304 or the same bytes): no call.
    await s.engine.refresh(job());
    expect(s.profileChanges.n).toBe(1);
    status = 404;
    await expect(s.engine.refresh(job())).rejects.toThrow(/HTTP 404/);
    expect(s.profileChanges.n).toBe(1);
    expect(await s.engine.editProfile({ kind: 'answers', answers: { language: 'ar' } })).toBe(true);
    expect(s.profileChanges.n).toBe(2);
    // The same answer again changes nothing.
    expect(await s.engine.editProfile({ kind: 'answers', answers: { language: 'ar' } })).toBe(false);
    expect(s.profileChanges.n).toBe(2);
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
    expect(s.started).toEqual({ query: 1, ingest: 2, epg: 1, config: 0, pair: 0 });
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
    // And the live channels no guide matches (step 24c), category by category as first seen.
    expect(await s.engine.unmatched({ sources: ['debug'], offset: 0, limit: 10 })).toMatchObject({
      count: 2,
      offset: 0,
      rows: [
        { key: seven!.key, name: 'Channel 7', src: 'debug', category: 'Group 1' },
        { name: 'Sky News 8', src: 'debug', category: 'Group 2' },
      ],
    });

    // Nothing is due right after: no worker starts. Twelve hours on, it is due again.
    const quiet = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true });
    expect(quiet).toEqual({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    expect(s.started.epg).toBe(1);
    s.clock.now = NOW + EPG_REFRESH_MS;
    const later = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true });
    expect(later.outcomes.map((o) => o.result?.status)).toEqual(['unchanged']);
    expect(s.started.epg).toBe(2);
  });

  it("gives the past days the stored guides keep: their channels' longest catch-up within the tier's limit (step 25c)", async () => {
    // Channel 1 has five days of catch-up.
    const archive = (): string => playlist(8, 4, true).replace('tvg-id="ch1"', 'tvg-id="ch1" catchup="shift" catchup-days="5"');
    const s = setup((url) => (url === GUIDE_URL ? { body: guide(6) } : { body: archive() }));
    await s.engine.refresh(job());
    expect(await s.engine.guidePastDays()).toBe(0);
    const catalogs = [{ src: 'debug', type: 'm3u' as const }];
    await s.engine.refreshEpg(catalogs, { tier: 'full' });
    expect((await s.engine.epgStatus()).guides.map((g) => g.summary?.pastDays)).toEqual([5]);
    expect(await s.engine.guidePastDays()).toBe(5);
    // The low tier keeps two.
    await s.engine.refreshEpg(catalogs, { tier: 'low', force: true });
    expect(await s.engine.guidePastDays()).toBe(2);
    // A playlist without catch-up: the one day every window keeps.
    const plain = setup((url) => (url === GUIDE_URL ? { body: guide(6) } : { body: playlist(8, 4, true) }));
    await plain.engine.refresh(job());
    await plain.engine.refreshEpg(catalogs, { tier: 'full' });
    expect(await plain.engine.guidePastDays()).toBe(1);
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

  it('reads every guide again once the manual mappings change, and searches the guides’ channels (step 24d)', async () => {
    const asked: string[] = [];
    const s = setup((url) => {
      asked.push(url);
      return url.startsWith('http://u.test/') ? { body: guide(6) } : { body: playlist(8, 4) };
    });
    await s.engine.refresh(job());
    const catalogs = [{ src: 'debug', type: 'm3u' as const }];
    const user = [
      { id: 'g1', url: 'http://u.test/a.xml' },
      { id: 'g2', url: 'http://u.test/b.xml' },
    ];
    await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user });
    const downloads = asked.length;
    const [seven] = (await s.engine.search('channel 7', { names: 1 })).keys;
    expect((await s.engine.nowNext([seven!], NOW))[0]).toMatchObject({ epgSrc: null });
    expect((await s.engine.epgStatus()).mapping).toBe('-');

    // Channel 7 (no guide has ch7) mapped to the second guide's ch3: both guides are due at once.
    expect(await s.engine.editProfile({ kind: 'epgOverride', key: seven!, pin: { epgSrc: 'u~g2', channel: 'ch3' } })).toBe(true);
    expect((await s.engine.epgStatus()).mapping).not.toBe('-');
    const again = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user });
    expect(again.outcomes.map((o) => [o.epgSrc, o.result?.status])).toEqual([
      ['u~g1', 'committed'],
      ['u~g2', 'committed'],
    ]);
    expect(asked.length).toBe(downloads + 2);
    expect((await s.engine.nowNext([seven!], NOW))[0]).toMatchObject({ epgSrc: 'u~g2', channel: 'ch3', method: 'override', now: { title: 'ch3 at 12' } });
    // Then nothing is due: no worker starts.
    const started = s.started.epg;
    expect(await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user })).toEqual({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    expect(s.started.epg).toBe(started);

    // The picker's search over both guides' declared channels, through the query worker.
    expect(await s.engine.guideChannels({ query: 'channel 3', offset: 0, limit: 10 })).toEqual({
      version: expect.any(Number) as number,
      count: 2,
      offset: 0,
      rows: [
        { epgSrc: 'u~g1', id: 'ch3', name: 'Channel 3' },
        { epgSrc: 'u~g2', id: 'ch3', name: 'Channel 3' },
      ],
    });
    expect((await s.engine.guideChannels({ epgSrc: 'u~g2', query: '', offset: 0, limit: 0 })).count).toBe(6);
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

  it('refreshes the config in its own worker: the cached policy first, then the fetched one, and the query worker reads the new blocklist (step 30b2)', async () => {
    let configStatus = 200;
    const s = setup((url) => (url === CONFIG_URL ? { status: configStatus, body: configAnswer(CONFIG_DOC) } : { body: playlist(10) }));
    // The query worker running, with no config cached: nothing blocked.
    expect(await s.engine.blocked(BLOCK_URLS)).toEqual([false, false]);
    const pushed: ConfigResult[] = [];
    const first = await s.engine.refreshConfig(CONFIG_REQUEST, (r) => pushed.push(r));
    expect(pushed.map((r) => r.status)).toEqual(['none']);
    expect(first).toMatchObject({ status: 'fresh', failure: null, stored: true, policy: { kill: { id: 'k1', mode: 'disable-playback' }, updateRequired: false } });
    expect(s.started.config).toBe(1);
    expect(s.configLive()).toBe(0);
    expect(await s.engine.blocked(BLOCK_URLS)).toEqual([true, false]);

    // The next run: the cached copy first again, and kept when the fetch fails.
    configStatus = 503;
    const second = await s.engine.refreshConfig(CONFIG_REQUEST, (r) => pushed.push(r));
    expect(pushed.map((r) => `${r.status} ${r.policy.kill?.id ?? '-'}`)).toEqual(['none -', 'cached k1']);
    expect(second).toMatchObject({ status: 'cached', failure: 'status', policy: { kill: { id: 'k1' } } });
    expect(s.started).toMatchObject({ query: 1, config: 2 });
    expect(s.configLive()).toBe(0);
    expect(await s.engine.blocked(BLOCK_URLS)).toEqual([true, false]);
    // Nothing of the config runs took the refresh slot.
    expect(s.engine.refreshing).toBe(false);
  });

  it('refuses a catalog refresh of a source on a blocked server before any worker starts, and keeps the slot free (step 30c3a)', async () => {
    const asked: string[] = [];
    const s = setup((url) => {
      asked.push(url);
      return url === CONFIG_URL ? { body: configAnswer(CONFIG_DOC) } : { body: playlist(10) };
    });
    // Before any config: nothing is blocked, the source loads.
    expect(await s.engine.refresh(job('http://lists.blocked.example/a.m3u'))).toMatchObject({ status: 'committed' });
    expect((await s.engine.refreshConfig(CONFIG_REQUEST)).status).toBe('fresh');
    const before = { ...s.started };
    const fetched = asked.length;
    // A playlist on a blocked host, and a panel on a parent of one (with a port).
    const panel = { src: 'p1', source: { type: 'xtream' as const, account: { base: 'http://blocked.example:8080', username: 'u', password: 'p' } } };
    await expect(s.engine.refresh(job('http://lists.blocked.example/a.m3u'))).rejects.toMatchObject({ name: 'BlockedSourceError', code: 'blocklisted' });
    await expect(s.engine.refresh(panel)).rejects.toBeInstanceOf(BlockedSourceError);
    expect(s.started).toEqual(before);
    expect(asked.length).toBe(fetched);
    expect(s.engine.refreshing).toBe(false);
    // The catalog loaded before stays; another source still loads.
    expect(await s.engine.summary()).toMatchObject({ sources: 1, items: 10 });
    expect(await s.engine.refresh({ src: 'free', source: { type: 'm3u', url: 'http://free.example/list.m3u' } })).toMatchObject({ status: 'committed' });
  });

  it("lets a source through when the blocklist can't be read (step 30c3a)", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = setup((url) => (url === CONFIG_URL ? { body: configAnswer(CONFIG_DOC) } : { body: playlist(10) }));
    expect((await s.engine.refreshConfig(CONFIG_REQUEST)).status).toBe('fresh');
    vi.spyOn(s.engine, 'blocked').mockRejectedValue(new Error('IndexedDB is gone'));
    expect(await s.engine.refresh(job('http://lists.blocked.example/a.m3u'))).toMatchObject({ status: 'committed' });
    expect(warn).toHaveBeenCalledWith('The blocklist could not be read', expect.any(Error));
    warn.mockRestore();
  });

  it("answers the player with blockedOrNone: the query worker's answer, or nothing blocked when it can't read it (step 30c3b)", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = setup((url) => (url === CONFIG_URL ? { body: configAnswer(CONFIG_DOC) } : { body: playlist(10) }));
    expect((await s.engine.refreshConfig(CONFIG_REQUEST)).status).toBe('fresh');
    expect(await s.engine.blockedOrNone(BLOCK_URLS)).toEqual([true, false]);
    expect(warn).not.toHaveBeenCalled();
    vi.spyOn(s.engine, 'blocked').mockRejectedValue(new Error('IndexedDB is gone'));
    expect(await s.engine.blockedOrNone(BLOCK_URLS)).toEqual([false, false]);
    expect(warn).toHaveBeenCalledWith('The blocklist could not be read', expect.any(Error));
    warn.mockRestore();
  });

  it("doesn't read a guide on a blocked server, with or without due, and keeps what it stored (step 30c3a)", async () => {
    const BLOCKED_GUIDE = 'http://guides.blocked.example/a.xml';
    const asked: string[] = [];
    const s = setup((url) => {
      asked.push(url);
      if (url === CONFIG_URL) return { body: configAnswer(CONFIG_DOC) };
      return url.endsWith('.xml') ? { body: guide(6) } : { body: playlist(8, 4, true) };
    });
    await s.engine.refresh(job());
    const catalogs = [{ src: 'debug', type: 'm3u' as const }];
    const user = [{ id: 'g1', url: BLOCKED_GUIDE }];
    // No config yet: both guides read.
    const first = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user });
    expect(first.outcomes.map((o) => [o.epgSrc, o.result?.status])).toEqual([
      ['u~g1', 'committed'],
      ['debug:tvg0', 'committed'],
    ]);
    expect((await s.engine.refreshConfig(CONFIG_REQUEST)).status).toBe('fresh');
    const fetched = asked.length;
    // Due again: only the free one is read; the blocked one is neither fetched nor deleted.
    s.clock.now = NOW + EPG_REFRESH_MS;
    const due = await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user });
    expect(due.outcomes.map((o) => o.epgSrc)).toEqual(['debug:tvg0']);
    expect(due.deleted).toEqual([]);
    // Without `due` (every guide): the same.
    const all = await s.engine.refreshEpg(catalogs, { tier: 'full', user, force: true });
    expect(all.outcomes.map((o) => o.epgSrc)).toEqual(['debug:tvg0']);
    expect(all.deleted).toEqual([]);
    expect(asked.slice(fetched).indexOf(BLOCKED_GUIDE)).toBe(-1);
    expect((await s.engine.epgStatus()).guides.map((g) => [g.epgSrc, g.gen > 0])).toEqual([
      ['u~g1', true],
      ['debug:tvg0', true],
    ]);
    // Only the blocked guide due: no worker starts at all.
    const epgWorkers = s.started.epg;
    s.clock.now = NOW + 2 * EPG_REFRESH_MS;
    await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user });
    expect(s.started.epg).toBe(epgWorkers + 1);
    s.clock.now = NOW + 2 * EPG_REFRESH_MS + 60_000;
    expect(await s.engine.refreshEpg(catalogs, { tier: 'full', due: true, user })).toEqual({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    expect(s.started.epg).toBe(epgWorkers + 1);
  });

  it("names a source's API URL: an Xtream account's server, an M3U link", () => {
    expect(sourceUrlOf({ type: 'm3u', url: 'http://lists.test/a.m3u?u=x' })).toBe('http://lists.test/a.m3u?u=x');
    expect(sourceUrlOf({ type: 'xtream', account: { base: 'https://panel.test:8443', username: 'u', password: 'p' } })).toBe('https://panel.test:8443');
  });

  it("doesn't start the query worker for a config refresh: it reads the blocklist when first asked", async () => {
    const s = setup((url) => (url === CONFIG_URL ? { body: configAnswer(CONFIG_DOC) } : { body: playlist(10) }));
    expect((await s.engine.refreshConfig(CONFIG_REQUEST)).status).toBe('fresh');
    expect(s.started).toEqual({ query: 0, ingest: 0, epg: 0, config: 1, pair: 0 });
    expect(await s.engine.blocked(BLOCK_URLS)).toEqual([true, false]);
    expect(s.started.query).toBe(1);
  });

  it("answers a config run even when the query worker can't read the blocklist again", async () => {
    let reloads = 0;
    const s = setup(
      (url) => (url === CONFIG_URL ? { body: configAnswer(CONFIG_DOC) } : { body: playlist(10) }),
      40,
      undefined,
      () => {
        reloads++;
        throw new Error('IndexedDB is gone');
      },
    );
    await s.engine.summary();
    expect((await s.engine.refreshConfig(CONFIG_REQUEST)).status).toBe('fresh');
    expect(reloads).toBe(1);
  });

  it('rejects a config run whose worker fails, terminates it, and keeps the blocklist', async () => {
    const s = setup(() => ({ body: playlist(10) }), 40, () => {
      throw new Error('boom');
    });
    expect(await s.engine.blocked(BLOCK_URLS)).toEqual([false, false]);
    await expect(s.engine.refreshConfig(CONFIG_REQUEST)).rejects.toThrow('boom');
    expect(s.configLive()).toBe(0);
    expect(await s.engine.blocked(BLOCK_URLS)).toEqual([false, false]);
  });

  it('runs a pairing in a pair worker of its own, ended by close (step 31c1)', async () => {
    const sid = 'AAAAAAAAAAAAAAAAAAAAAA';
    const payload = { v: 1, source: { type: 'm3u', url: 'http://p.test/list.m3u' } };
    let polls = 0;
    const s = setup((url) => {
      if (url === 'http://api.test/v1/pair') return { status: 201, body: JSON.stringify({ sid, code: '7K3MZ9QX', pollToken: 'A'.repeat(43), exp: NOW + 600_000 }) };
      if (url === `http://api.test/v1/pair/s/${sid}`) {
        polls += 1;
        if (polls === 1) return { status: 200, body: JSON.stringify({ state: 'waiting', exp: NOW + 600_000 }) };
        return { status: 200, body: JSON.stringify({ state: 'ready', payload: sealPairPayload(utf8(JSON.stringify(payload)), PAIR_KEYS.publicKey) }) };
      }
      if (url === `http://api.test/v1/pair/s/${sid}/status`) return { status: 200, body: '{"state":"done","status":"blocked"}' };
      return { status: 404 };
    });
    const session = s.engine.pairing();
    expect(s.started.pair).toBe(1);
    expect(s.pairLive()).toBe(1);
    const opened = await session.open('http://api.test');
    expect(opened.ok && opened.code.code).toBe('7K3MZ9QX');
    expect(opened.ok && opened.code.typed).toBe('api.test/p');
    expect(await session.poll()).toEqual({ state: 'waiting' });
    // No payload was read: a status is refused in the worker.
    await expect(session.status('ok')).rejects.toThrow('No pairing payload was read');
    expect(await session.poll()).toEqual({ state: 'ready', payload });
    // The status goes to the worker as given: one the protocol lacks is refused there.
    await expect(session.status('fine' as 'ok')).rejects.toThrow('Unknown pairing status');
    expect(await session.status('blocked')).toEqual({ ok: true });
    session.close();
    expect(s.pairLive()).toBe(0);
    session.close();
    expect(s.pairLive()).toBe(0);
    await expect(session.poll()).rejects.toThrow('RPC client closed');
    // Each opening starts its own; the query worker never started.
    const second = s.engine.pairing();
    expect(s.started.pair).toBe(2);
    second.close();
    expect(s.started.query).toBe(0);
  });

  it("adds the phone's file through both workers: the pair worker opens its frames, the ingest worker reads them (step 31d2a)", async () => {
    const sid = 'AAAAAAAAAAAAAAAAAAAAAA';
    const blobKey = 'b'.repeat(21) + 'A';
    const fileKey = new Uint8Array(32).fill(6);
    const base = new Uint8Array(24).fill(7);
    // 50 channels and 1.2 MB of comment lines: two frames.
    const text = playlist(50).replace('#EXTM3U\n', `#EXTM3U\n${`#PAD ${'x'.repeat(30_000)}\n`.repeat(40)}`);
    const plain = utf8(text);
    const good = sealFile(plain, fileKey, base);
    const broken = good.slice();
    broken[good.length - 5] = broken[good.length - 5]! ^ 1;
    let sealed = good;
    const blobPath = `/dev/blob/pair/${sid}/${blobKey}?m=GET&n=0&e=${NOW + 600_000}&s=sig`;
    const payload = { v: 1, source: { type: 'm3u-file', file: { key: blobKey, fileKey: toBase64Url(fileKey), base: toBase64Url(base), size: plain.length } }, name: 'Family list' };
    const asked: string[] = [];
    const s = setup((url) => {
      asked.push(url);
      if (url === 'http://api.test/v1/pair') return { status: 201, body: JSON.stringify({ sid, code: '7K3MZ9QX', pollToken: 'A'.repeat(43), exp: NOW + 600_000 }) };
      if (url === `http://api.test/v1/pair/s/${sid}`) return { status: 200, body: JSON.stringify({ state: 'ready', payload: sealPairPayload(utf8(JSON.stringify(payload)), PAIR_KEYS.publicKey) }) };
      if (url === `http://api.test/v1/pair/s/${sid}/file`) return { status: 200, body: JSON.stringify({ url: blobPath, key: blobKey, exp: NOW + 600_000 }) };
      if (url === `http://api.test${blobPath}`) return { status: 200, headers: { 'Content-Length': String(sealed.length) }, body: sealed, chunk: 65536 };
      if (url === `http://api.test/v1/pair/s/${sid}/status`) return { status: 200, body: '{"state":"done","status":"ok"}' };
      return { status: 404 };
    });
    expect(plain.length).toBeGreaterThan(1048576);

    const session = s.engine.pairing();
    await session.open('http://api.test');
    expect(await session.poll()).toEqual({ state: 'ready', payload });
    const got = await session.file();
    if (!got.ok) throw new Error(`no file: ${got.failure}`);
    expect(got.feed.size).toBe(plain.length);
    const progress: number[] = [];
    // A file has no catalog server: the blocklist isn't asked (its streams meet it when they play).
    const blocked = vi.spyOn(s.engine, 'blocked');
    const result = await s.engine.refresh({ src: 's1', source: { type: 'm3u-file' } }, { file: got.feed, onProgress: (p) => progress.push(p.total ?? -1) });
    expect(blocked).not.toHaveBeenCalled();
    blocked.mockRestore();
    expect(result).toMatchObject({ src: 's1', status: 'committed', counts: { live: 50 } });
    expect(progress.length > 0 && progress.every((total) => total === plain.length)).toBe(true);
    expect(await s.engine.summary()).toEqual({ sources: 1, items: 50, stale: 0 });
    expect(s.live()).toBe(0);
    expect(await session.status('ok')).toEqual({ ok: true });
    session.close();
    expect(s.pairLive()).toBe(0);
    // The file's GET took no token; nothing else was fetched for it.
    expect(asked.filter((url) => url.indexOf('/dev/blob/') !== -1)).toEqual([`http://api.test${blobPath}`]);

    // A file whose last frame was changed on the way: the refresh fails with `file`, the catalog stays.
    sealed = broken;
    const again = s.engine.pairing();
    await again.open('http://api.test');
    await again.poll();
    const feed = await again.file();
    if (!feed.ok) throw new Error(`no file: ${feed.failure}`);
    await expect(s.engine.refresh({ src: 's1', source: { type: 'm3u-file' } }, { file: feed.feed })).rejects.toMatchObject({ code: 'file' });
    expect(await s.engine.summary()).toEqual({ sources: 1, items: 50, stale: 0 });
    again.close();

    // No feed: the ingest worker refuses the file source.
    await expect(s.engine.refresh({ src: 's2', source: { type: 'm3u-file' } })).rejects.toMatchObject({ code: 'file' });
    expect(s.live()).toBe(0);
  });

  it("adds the phone's file through the onboarding loader as a source with no link, and replaces it when the same name comes again (step 31d2b1)", async () => {
    const sid = 'AAAAAAAAAAAAAAAAAAAAAA';
    const blobKey = 'b'.repeat(21) + 'A';
    const fileKey = new Uint8Array(32).fill(6);
    const base = new Uint8Array(24).fill(7);
    // Two frames the first time, 30 channels (one frame) the second.
    const first = utf8(playlist(50).replace('#EXTM3U\n', `#EXTM3U\n${`#PAD ${'x'.repeat(30_000)}\n`.repeat(40)}`));
    const second = utf8(playlist(30));
    let plain = first;
    const blobPath = `/dev/blob/pair/${sid}/${blobKey}?m=GET&n=0&e=${NOW + 600_000}&s=sig`;
    const payloadOf = () => ({ v: 1, source: { type: 'm3u-file', file: { key: blobKey, fileKey: toBase64Url(fileKey), base: toBase64Url(base), size: plain.length } }, name: 'Family list' });
    const s = setup((url) => {
      if (url === 'http://api.test/v1/pair') return { status: 201, body: JSON.stringify({ sid, code: '7K3MZ9QX', pollToken: 'A'.repeat(43), exp: NOW + 600_000 }) };
      if (url === `http://api.test/v1/pair/s/${sid}`) return { status: 200, body: JSON.stringify({ state: 'ready', payload: sealPairPayload(utf8(JSON.stringify(payloadOf())), PAIR_KEYS.publicKey) }) };
      if (url === `http://api.test/v1/pair/s/${sid}/file`) return { status: 200, body: JSON.stringify({ url: blobPath, key: blobKey, exp: NOW + 600_000 }) };
      if (url === `http://api.test${blobPath}`) {
        const sealed = sealFile(plain, fileKey, base);
        return { status: 200, headers: { 'Content-Length': String(sealed.length) }, body: sealed, chunk: 65536 };
      }
      return { status: 404 };
    });
    const loader = createEngineLoader({ engine: s.engine, tier: () => Promise.resolve('full'), languages: () => ['en'], now: () => NOW });
    /** One pairing: the payload read, the file draft as the pairing screen makes it, loaded. */
    const send = async (): Promise<unknown> => {
      const session = s.engine.pairing();
      await session.open('http://api.test');
      await session.poll();
      const draft: SourceDraft = {
        type: 'm3u-file',
        name: 'Family list',
        epgUrls: [],
        file: () => session.file().then((got) => (got.ok ? got.feed : Promise.reject(fileError(got.failure)))),
      };
      try {
        return await loader.start(draft, () => undefined).done;
      } finally {
        session.close();
      }
    };
    expect(await send()).toEqual({ live: 50, movies: 0, series: 0 });
    const record = { id: 's1', type: 'm3u-file', name: 'Family list', added: NOW };
    expect((await s.engine.profile())!.doc).toMatchObject({ v: 8, sources: [record], guides: [] });
    expect(await s.engine.summary()).toEqual({ sources: 1, items: 50, stale: 0 });
    // Sent again under the same name: the same source, its catalog replaced.
    plain = second;
    expect(await send()).toEqual({ live: 30, movies: 0, series: 0 });
    expect((await s.engine.profile())!.doc).toMatchObject({ v: 8, sources: [record] });
    expect(await s.engine.summary()).toEqual({ sources: 1, items: 30, stale: 0 });
    expect(await s.engine.sourceIds()).toEqual(['s1']);
    expect(s.live()).toBe(0);
    expect(s.pairLive()).toBe(0);
  });

  it("answers a file the pair worker couldn't get, and lets the feed's port go (step 31d2a)", async () => {
    const sid = 'AAAAAAAAAAAAAAAAAAAAAA';
    const payload = { v: 1, source: { type: 'm3u-file', file: { key: 'b'.repeat(21) + 'A', fileKey: toBase64Url(new Uint8Array(32)), base: toBase64Url(new Uint8Array(24)), size: 10 } } };
    const s = setup((url) => {
      if (url === 'http://api.test/v1/pair') return { status: 201, body: JSON.stringify({ sid, code: '7K3MZ9QX', pollToken: 'A'.repeat(43), exp: NOW + 600_000 }) };
      if (url === `http://api.test/v1/pair/s/${sid}`) return { status: 200, body: JSON.stringify({ state: 'ready', payload: sealPairPayload(utf8(JSON.stringify(payload)), PAIR_KEYS.publicKey) }) };
      return { status: 404 };
    });
    const session = s.engine.pairing();
    await session.open('http://api.test');
    await session.poll();
    expect(await session.file()).toEqual({ ok: false, failure: 'gone' });
    session.close();
    // A worker gone: the call rejects.
    await expect(session.file()).rejects.toThrow('RPC client closed');
  });

  it('keeps the backup master in a backup worker of its own, ended when it answers (step 32b)', async () => {
    const s = setup(() => ({ status: 404 }));
    const progress: number[] = [];
    expect(await s.engine.prepareBackup(BACKUP_REQUEST, (f) => progress.push(f))).toEqual({ source: 'device', derived: true });
    expect(progress).toEqual([0.5, 1]);
    expect(s.backup).toEqual({ started: 1, live: 0 });
    // No other worker starts for it.
    expect(s.started).toEqual({ query: 0, ingest: 0, epg: 0, config: 0, pair: 0 });
    const db = await openDatabase(s.factory);
    expect(await getValue(db, STORE.kv, BACKUP_MASTER_KEY)).toMatchObject({ source: 'device' });
    expect(await getValue(db, STORE.kv, BACKUP_CODE_KEY)).toBeUndefined();
    db.close();

    // A second call: a worker of its own again, which reads the kept master.
    expect(await s.engine.prepareBackup(BACKUP_REQUEST, (f) => progress.push(f))).toEqual({ source: 'device', derived: false });
    expect(progress).toEqual([0.5, 1]);
    expect(s.backup).toEqual({ started: 2, live: 0 });
  });

  it('makes and keeps the backup code when there is no device secret (step 32b)', async () => {
    const s = setup(() => ({ status: 404 }));
    expect(await s.engine.prepareBackup({ ...BACKUP_REQUEST, secret: null })).toEqual({ source: 'code', derived: true });
    const db = await openDatabase(s.factory);
    expect(await getValue(db, STORE.kv, BACKUP_CODE_KEY)).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    db.close();
    expect(await s.engine.prepareBackup({ ...BACKUP_REQUEST, secret: null })).toEqual({ source: 'code', derived: false });
  });

  it('rejects a backup call that fails in its worker, and ends the worker', async () => {
    const s = setup(() => ({ status: 404 }));
    await expect(s.engine.prepareBackup({ ...BACKUP_REQUEST, secret: 'boom' })).rejects.toThrow('scrypt failed');
    expect(s.backup).toEqual({ started: 1, live: 0 });
  });

  it('sends the profile, then restores it on a wiped TV, each in a backup worker of its own (step 32c1)', async () => {
    const s = setup(() => ({ status: 404 }));
    const source = { id: 's1', type: 'm3u' as const, name: 'Home', url: 'http://p.test/list.m3u', added: 1 };
    expect(await s.engine.editProfile({ kind: 'source', source })).toBe(true);
    expect(await s.engine.uploadBackup(BACKUP_CALL)).toEqual({ state: 'sent' });
    expect(s.backup).toEqual({ started: 1, live: 0 });
    expect(await s.engine.uploadBackup(BACKUP_CALL)).toEqual({ state: 'same' });
    expect(s.backup).toEqual({ started: 2, live: 0 });
    expect(s.backupApi.requests.map((r) => `${r.method} ${r.status}`)).toEqual(['GET 404', 'PUT 200']);
    // At the request's own origin.
    expect(s.backupHold.urls.map((url) => url.slice(0, url.lastIndexOf('/') + 1))).toEqual(['http://api.test/v1/backup/', 'http://api.test/v1/backup/']);

    // The same TV wiped: a new database, the same API.
    const wiped = setup(() => ({ status: 404 }));
    for (const [id, blob] of s.backupApi.blobs) wiped.backupApi.blobs.set(id, blob);
    const progress: number[] = [];
    expect(await wiped.engine.restoreBackup(BACKUP_CALL, { onProgress: (f) => progress.push(f) })).toEqual({ state: 'restored', language: null, sources: 1 });
    expect(progress).toEqual([0.5, 1]);
    expect(wiped.backup).toEqual({ started: 1, live: 0 });
    expect(wiped.backupHold.urls.map((url) => url.slice(0, url.lastIndexOf('/') + 1))).toEqual(['http://api.test/v1/backup/']);
    // No other worker starts for it; the query worker then reads the restored profile.
    expect(wiped.started).toEqual({ query: 0, ingest: 0, epg: 0, config: 0, pair: 0 });
    expect((await wiped.engine.profile())!.doc.sources).toEqual([source]);
  });

  it("serves Settings' backup page, each call in a backup worker of its own (step 32d2a)", async () => {
    const s = setup(() => ({ status: 404 }));
    const source = { id: 's1', type: 'm3u' as const, name: 'Home', url: 'http://p.test/list.m3u', added: 1 };
    expect(await s.engine.editProfile({ kind: 'source', source })).toBe(true);
    expect(await s.engine.uploadBackup(BACKUP_CALL)).toEqual({ state: 'sent' });
    // A new install of the same TV: its own profile, and the backup held.
    const after = setup(() => ({ status: 404 }));
    for (const [id, blob] of s.backupApi.blobs) after.backupApi.blobs.set(id, blob);
    for (const [id, hash] of s.backupApi.hashes) after.backupApi.hashes.set(id, hash);
    const other = { ...source, name: 'Other' };
    expect(await after.engine.editProfile({ kind: 'source', source: other })).toBe(true);
    expect(await after.engine.uploadBackup(BACKUP_CALL)).toEqual({ state: 'held' });
    expect(await after.engine.backupStatus(BACKUP_REQUEST)).toMatchObject({ on: true, source: 'device', code: null, deleting: false });
    // "Replace it": sent with no GET.
    expect(await after.engine.replaceHeldBackup(BACKUP_CALL)).toEqual({ state: 'sent' });
    // "Restore it" over a changed profile: the copy on the server comes back.
    expect(await after.engine.editProfile({ kind: 'source', source: { ...source, id: 's2', name: 'Third' } })).toBe(true);
    expect(await after.engine.restoreHeldBackup(BACKUP_CALL)).toEqual({ state: 'restored', language: null, sources: 1 });
    expect((await after.engine.profile())!.doc.sources).toEqual([other]);
    expect(await after.engine.setBackup({ ...BACKUP_CALL, on: false })).toEqual({ state: 'off', deleted: true });
    expect(await after.engine.uploadBackup(BACKUP_CALL)).toEqual({ state: 'off' });
    expect(await after.engine.setBackup({ ...BACKUP_CALL, on: true })).toEqual({ state: 'on' });
    expect(after.backupApi.requests.map((r) => `${r.method} ${r.status}`)).toEqual(['GET 200', 'PUT 200', 'GET 200', 'DELETE 200']);
    expect(after.backup).toEqual({ started: 7, live: 0 });
    expect(after.started).toEqual({ query: 1, ingest: 0, epg: 0, config: 0, pair: 0 });
  });

  it('restores with a typed backup code on a wiped TV, in a backup worker of its own, and ends it on a cancel (step 32d3b)', async () => {
    const s = setup(() => ({ status: 404 }));
    const source = { id: 's1', type: 'm3u' as const, name: 'Home', url: 'http://p.test/list.m3u', added: 1 };
    expect(await s.engine.editProfile({ kind: 'source', source })).toBe(true);
    const NOT_NOW = { ...BACKUP_CALL, secret: null };
    expect(await s.engine.uploadBackup(NOT_NOW)).toEqual({ state: 'sent' });
    const db = await openDatabase(s.factory);
    const code = (await getValue(db, STORE.kv, BACKUP_CODE_KEY)) as string;
    db.close();
    const typed = { platform: BACKUP_CALL.platform, appId: BACKUP_CALL.appId, base: BACKUP_CALL.base, code: code.toLowerCase() };

    // A cancel while it looks ends the worker and keeps nothing.
    const cancelled = setup(() => ({ status: 404 }));
    let release!: () => void;
    cancelled.backupHold.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancel = new CancelSource();
    const looking = cancelled.engine.restoreBackupCode(typed, { cancel: cancel.token });
    for (let i = 0; i < 100 && cancelled.backupHold.held === 0; i++) await delay(5);
    expect(cancelled.backup.live).toBe(1);
    cancel.cancel();
    await expect(looking).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelled.backup).toEqual({ started: 1, live: 0 });
    release();

    // The same TV wiped: the typed code brings the profile back.
    const wiped = setup(() => ({ status: 404 }));
    for (const [id, blob] of s.backupApi.blobs) wiped.backupApi.blobs.set(id, blob);
    const progress: number[] = [];
    expect(await wiped.engine.restoreBackupCode(typed, { onProgress: (f) => progress.push(f) })).toEqual({ state: 'restored', language: null, sources: 1 });
    expect(progress).toEqual([0.5, 1]);
    expect(wiped.backup).toEqual({ started: 1, live: 0 });
    expect(wiped.started).toEqual({ query: 0, ingest: 0, epg: 0, config: 0, pair: 0 });
    expect((await wiped.engine.profile())!.doc.sources).toEqual([source]);
    expect(await wiped.engine.backupStatus({ ...BACKUP_REQUEST, secret: null })).toMatchObject({ source: 'code', code });
  });

  it("ends the look-up's worker when its call is cancelled (the app's time limit), keeping nothing", async () => {
    const s = setup(() => ({ status: 404 }));
    let release!: () => void;
    s.backupHold.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancel = new CancelSource();
    const looking = s.engine.restoreBackup(BACKUP_CALL, { cancel: cancel.token });
    for (let i = 0; i < 100 && s.backupHold.held === 0; i++) await delay(5);
    expect(s.backupHold.held).toBe(1);
    expect(s.backup.live).toBe(1);
    cancel.cancel();
    await expect(looking).rejects.toMatchObject({ code: 'cancelled' });
    expect(s.backup).toEqual({ started: 1, live: 0 });
    release();
    await delay(20);
    const db = await openDatabase(s.factory);
    expect(await getValue(db, STORE.kv, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await getValue(db, STORE.kv, BACKUP_SENT_KEY)).toBeUndefined();
    expect(await getValue(db, STORE.profile, 'current')).toBeUndefined();
    db.close();
  });

  it('refuses to back up without a backup worker', async () => {
    const engine = new DataEngine({
      startQueryWorker: () => {
        throw new Error('unused');
      },
      startIngestWorker: () => {
        throw new Error('unused');
      },
      startEpgWorker: () => {
        throw new Error('unused');
      },
      startConfigWorker: () => {
        throw new Error('unused');
      },
    });
    engines.push(engine);
    await expect(engine.prepareBackup(BACKUP_REQUEST)).rejects.toThrow('This data engine has no backup worker');
    await expect(engine.uploadBackup(BACKUP_CALL)).rejects.toThrow('This data engine has no backup worker');
    await expect(engine.restoreBackup(BACKUP_CALL)).rejects.toThrow('This data engine has no backup worker');
    await expect(engine.restoreBackupCode({ platform: 'webos', appId: 'com.lablo.iptv', base: 'http://api.test', code: '0' })).rejects.toThrow('This data engine has no backup worker');
  });

  it('refuses to pair without a pair worker', () => {
    const engine = new DataEngine({
      startQueryWorker: () => {
        throw new Error('unused');
      },
      startIngestWorker: () => {
        throw new Error('unused');
      },
      startEpgWorker: () => {
        throw new Error('unused');
      },
      startConfigWorker: () => {
        throw new Error('unused');
      },
    });
    engines.push(engine);
    expect(() => engine.pairing()).toThrow('This data engine has no pair worker');
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
