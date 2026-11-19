// The telemetry worker as the TV runs it (RELAY step 33b1): `packages/data/src/telemetry.worker.ts`
// bundled by the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, the ES2016 gate), checked
// against the worker budget, then started in fresh realms that stand in for Chromium 53 workers
// (none of the ES2017+ APIs Chromium 53 lacks, no `globalThis`, no code generation). IndexedDB is
// fake-indexeddb, shared by the runs as a TV's database is; the realm's `crypto.getRandomValues`
// makes the install ID, and its `fetch` records the posts. The posted batch is read with the
// server's own schema.
import { randomFillSync } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import type { DiagSendRequest, RpcPort, TelemetrySendRequest } from '@lablo/data';
import { createTelemetryClient, emptyProfile, getValue, openDatabase, saveProfile, STORE, TELEMETRY_ID_KEY, TELEMETRY_QUEUE_KEY } from '@lablo/data';
import type { TelemetryEvent } from '@lablo/protocol';
import { diagRequestSchema, readTelemetryEvents, telemetryBatchSchema } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import { freshFactory } from '../packages/data/src/test-support';
import { checkBudget, formatBudget } from '../tools/build/src/budgets';
import { bundleIife } from '../tools/build/src/bundle';
import { CHROMIUM_53_MISSING, pipe } from './realm-support';

interface Post {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string;
}

/** A `fetch` for the realm that records each post and answers with the next status (200 once they run out). */
function recordingFetch(posts: Post[], statuses: number[], answer = '{"state":"stored"}') {
  return (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; credentials?: string }): Promise<Response> => {
    expect(init.credentials).toBe('omit');
    posts.push({ url, method: init.method, headers: init.headers ?? {}, body: init.body ?? '' });
    return Promise.resolve(new Response(answer, { status: statuses.shift() ?? 200 }));
  };
}

/** Starts `code` in a fresh Chromium 53 stand-in realm. */
function startWorker(code: string, factory: IDBFactory, randoms: { calls: number }, fetch: ReturnType<typeof recordingFetch>): RpcPort {
  const [workerPort, uiPort] = pipe();
  const realm = vm.createContext(
    {
      fetch,
      TextEncoder,
      TextDecoder,
      postMessage: workerPort.postMessage,
      addEventListener: workerPort.addEventListener,
      removeEventListener: workerPort.removeEventListener,
      indexedDB: factory,
      IDBKeyRange,
      setTimeout,
      clearTimeout,
      crypto: {
        getRandomValues: (array: Uint8Array): Uint8Array => {
          randoms.calls++;
          return randomFillSync(array);
        },
      },
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  vm.runInContext('var self = this;', realm);
  vm.runInContext(CHROMIUM_53_MISSING, realm);
  expect(vm.runInContext('typeof globalThis + " " + typeof Object.values', realm)).toBe('undefined undefined');
  expect(() => vm.runInContext('new Function("return 1")', realm)).toThrow(/Code generation from strings disallowed/);
  vm.runInContext(code, realm);
  return uiPort;
}

const EVENTS: TelemetryEvent[] = [
  { kind: 'app_start', at: 1_700_000_000_000, tier: 'low', coldStartMs: 4321, catalog: '10k+' },
  { kind: 'capability', at: 1_700_000_000_001, model: 'UE43NU7100', firmware: 'T-KTMDEUC-1250.4', chromium: 56, probes: { year: 2018, lowTier: true, mse: true, hevc: false } },
];

const REQUEST: TelemetrySendRequest = { events: EVENTS, base: 'http://api.test:8091', platform: 'tizen', appVersion: '1.0.0', sampling: { crash: 1 } };

/** The worker as the TV build bundles it (once for the file). */
let bundled: Promise<string> | null = null;
function workerCode(): Promise<string> {
  bundled ??= bundleIife({ input: join(import.meta.dirname, '..', 'packages', 'data', 'src', 'telemetry.worker.ts'), platform: 'tizen', label: 'telemetry.worker.js' }).then((b) => b.code);
  return bundled;
}

describe('the bundled telemetry worker', () => {
  it('builds to gated Chromium 53 code within the worker budget, and posts a batch the server reads whole, then keeps the ID and clears the queue', async () => {
    const code = await workerCode();
    const budget = checkBudget('telemetry.worker.js', 'worker', code);
    console.log(formatBudget(budget));
    expect(budget.ok).toBe(true);
    // No zod in it: the buckets come from their schema-free subpath.
    expect(code).not.toContain('discriminatedUnion');

    const tv = freshFactory();
    const randoms = { calls: 0 };
    const posts: Post[] = [];

    // A 500 first: the events stay in the queue.
    const first = createTelemetryClient(startWorker(code, tv, randoms, recordingFetch(posts, [500])));
    expect(await first.call('send', REQUEST)).toEqual({ state: 'failed', failure: 'status', status: 500, queued: 2 });
    first.close();
    expect(randoms.calls).toBe(1);

    // A later worker posts them again with the same ID, and empties the queue on 200.
    const second = createTelemetryClient(startWorker(code, tv, randoms, recordingFetch(posts, [])));
    expect(await second.call('send', { ...REQUEST, events: [] })).toEqual({ state: 'sent', sent: 2, queued: 0 });
    second.close();
    expect(randoms.calls).toBe(1);

    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.url).toBe('http://api.test:8091/v1/telemetry');
      expect(post.method).toBe('POST');
      expect(post.headers).toEqual({ 'content-type': 'application/json' });
      const batch = JSON.parse(post.body) as { installId: string; events: unknown[] };
      expect(telemetryBatchSchema.safeParse(batch).success).toBe(true);
      expect(readTelemetryEvents(batch.events)).toEqual({ events: EVENTS, dropped: 0 });
    }
    expect(posts[1]!.body).toBe(posts[0]!.body);
    const db = await openDatabase(tv);
    expect(await getValue(db, STORE.kv, TELEMETRY_ID_KEY)).toBe((JSON.parse(posts[0]!.body) as { installId: string }).installId);
    expect(await getValue(db, STORE.kv, TELEMETRY_QUEUE_KEY)).toBeUndefined();

    // The profile's switch off: the worker posts nothing and forgets the ID.
    await saveProfile(db, { ...emptyProfile(), telemetry: false });
    db.close();
    const third = createTelemetryClient(startWorker(code, tv, randoms, recordingFetch(posts, [])));
    expect(await third.call('send', REQUEST)).toEqual({ state: 'off' });
    third.close();
    expect(posts).toHaveLength(2);
    const after = await openDatabase(tv);
    expect(await getValue(after, STORE.kv, TELEMETRY_ID_KEY)).toBeUndefined();
    after.close();
  }, 120_000);

  it("scrubs a crash's stack with the stored profile's logins before it is queued (step 33c), in the Chromium 53 realm", async () => {
    const code = await workerCode();
    const tv = freshFactory();
    const db = await openDatabase(tv);
    await saveProfile(db, {
      ...emptyProfile(),
      sources: [{ id: 's1', type: 'xtream', name: 'Panel', account: { base: 'http://Panel.Example.tv:8080/sub', username: 'omar.k', password: 'p@ss99' }, added: 1 }],
      guides: [{ id: 'g1', url: 'http://cdn.list-host.xyz/epg?username=listuser' }],
    });
    db.close();
    const raw =
      'Uncaught (in promise) Error: The panel said no to omar.k with p@ss99 at http://Panel.Example.tv:8080/sub/player_api.php?username=omar.k&password=p@ss99\n' +
      '    at f (file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/main.js:1:2345)\n' +
      '    at listhost cdn.list-host.xyz listuser 10.1.2.3:8000';
    const worker: TelemetryEvent = { kind: 'crash', at: 1_700_000_000_002, where: 'worker', stack: 'Uncaught Error: boom\n    at blob:file:///0b8c3c48-5d1e-4f43-9a83-1b0a5c4c2a11:1:26' };
    const posts: Post[] = [];
    const client = createTelemetryClient(startWorker(code, tv, { calls: 0 }, recordingFetch(posts, [500])));
    expect(await client.call('send', { ...REQUEST, events: [{ kind: 'crash', at: 1_700_000_000_001, where: 'main', stack: raw }, worker] })).toEqual({ state: 'failed', failure: 'status', status: 500, queued: 2 });
    client.close();
    const scrubbed = [
      { kind: 'crash', at: 1_700_000_000_001, where: 'main', stack: 'Uncaught (in promise) Error: The panel said no to [login] with [login] at [url]\n    at f (main.js:1:2345)\n    at listhost [login] [login] [ip]' },
      { kind: 'crash', at: 1_700_000_000_002, where: 'worker', stack: 'Uncaught Error: boom\n    at worker:1:26' },
    ];
    const stored = await openDatabase(tv);
    expect(await getValue(stored, STORE.kv, TELEMETRY_QUEUE_KEY)).toEqual(scrubbed);
    stored.close();
    expect(readTelemetryEvents((JSON.parse(posts[0]!.body) as { events: unknown[] }).events)).toEqual({ events: scrubbed, dropped: 0 });
    for (const secret of ['omar.k', 'p@ss99', 'Panel.Example', 'list-host', 'listuser', '10.1.2.3', '/media/', 'blob:']) expect(posts[0]!.body).not.toContain(secret);
  }, 120_000);

  it('sends the diagnostics report (step 33d2) and reads its support code, in the Chromium 53 realm', async () => {
    const code = await workerCode();
    const tv = freshFactory();
    const db = await openDatabase(tv);
    await saveProfile(db, {
      ...emptyProfile(),
      sources: [
        { id: 's1', type: 'xtream', name: 'Panel', account: { base: 'http://Panel.Example.tv:8080/sub', username: 'omar.k', password: 'p@ss99' }, added: 1 },
        { id: 's2', type: 'm3u', name: 'List', url: null, origin: 'http://cdn.list-host.xyz', added: 2 },
      ],
      telemetry: false,
    } as never);
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE.sources, STORE.epgMeta], 'readwrite');
      tx.objectStore(STORE.sources).put({ src: 's1', gen: 1, building: null, nextGen: 2, updatedAt: now - 2 * 86_400_000, checkedAt: now - 7_200_000, counts: { live: 900, movie: 100 } });
      tx.objectStore(STORE.epgMeta).put({ epgSrc: 'g2', gen: 0, building: null, nextGen: 1, updatedAt: null, checkedAt: now - 60_000, rank: 1, failure: { code: 'http', status: 404 } });
      tx.objectStore(STORE.epgMeta).put({ epgSrc: 'g1', gen: 1, building: null, nextGen: 2, updatedAt: now, checkedAt: now, rank: 0, summary: { wanted: 900, matched: 450, programmes: 25000 } });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const crash: TelemetryEvent = { kind: 'crash', at: now - 10, where: 'main', stack: 'Uncaught Error: no omar.k at http://Panel.Example.tv:8080/sub\n    at f (file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/main.js:1:2)' };
    const request: DiagSendRequest = {
      base: 'http://api.test:8091',
      platform: 'tizen',
      appVersion: '1.0.0',
      parts: { at: now, zoneMin: 240, locale: 'ar', tier: 'low', model: 'UE43NU7100', firmware: 'T-KTMDEUC-1250.4', chromium: 56, probes: { year: 2018, lowTier: true }, config: 'none' },
      events: [EVENTS[0]!, crash],
    };
    const posts: Post[] = [];
    const client = createTelemetryClient(startWorker(code, tv, { calls: 0 }, recordingFetch(posts, [201], '{"code":"K7M2Q9"}')));
    expect(await client.call('report', request)).toEqual({ state: 'sent', code: 'K7M2Q9' });
    client.close();
    expect(posts.map((p) => [p.url, p.method])).toEqual([['http://api.test:8091/v1/diag', 'POST']]);
    const body = JSON.parse(posts[0]!.body) as unknown;
    expect(diagRequestSchema.parse(body)).toEqual(body);
    expect((body as { report: unknown }).report).toEqual({
      v: 1,
      ...request.parts,
      telemetry: false,
      sources: [
        { type: 'xtream', items: '1k+', checked: '1h+', needs: null },
        { type: 'm3u', items: '0', checked: null, needs: 'link' },
      ],
      guides: [
        { programmes: '10k+', matched: '50-74', checked: '<1h', failure: null },
        { programmes: '0', matched: '0', checked: '<1h', failure: { code: 'http', status: 404 } },
      ],
      events: [EVENTS[0], { ...crash, stack: 'Uncaught Error: no [login] at [url]\n    at f (main.js:1:2)' }],
    });
    for (const secret of ['omar.k', 'p@ss99', 'Panel.Example', 'list-host', '/media/', 'List', 'Panel']) expect(posts[0]!.body).not.toContain(secret);
  }, 120_000);
});
