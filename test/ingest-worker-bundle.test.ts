// The ingest worker as the TV runs it (RELAY step 8): `packages/data/src/ingest.worker.ts`
// bundled by the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, ES2016 syntax gate),
// checked against the worker budget, then started in a fresh realm that stands in for a
// Chromium 53 worker: `self` is a message port, `indexedDB` is fake-indexeddb, the ES2017 APIs
// Chromium 53 lacks are deleted and there is no DecompressionStream, so gzip goes through the
// bundled fflate. It ingests from the in-process mock provider with Node's fetch; the UI side
// talks to it through createIngestClient, and the query service then reads what it wrote.

import vm from 'node:vm';
import { join } from 'node:path';
import type { IngestProgress, IngestSwap, RpcPort } from '@lablo/data';
import { CancelError, CancelSource, QueryService, createIngestClient, openDatabase } from '@lablo/data';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { freshFactory } from '../packages/data/src/test-support';
import { checkBudget, formatBudget } from '../tools/build/src/budgets';
import { bundleIife } from '../tools/build/src/bundle';

type Listener = (event: MessageEvent) => void;

/** Two ends of a message channel between realms: structured clone, asynchronous delivery. */
function pipe(): [RpcPort, RpcPort] {
  const listeners: [Listener[], Listener[]] = [[], []];
  const end = (mine: Listener[], theirs: Listener[]): RpcPort => ({
    postMessage: (message) => {
      const data = structuredClone(message);
      setTimeout(() => {
        for (const l of theirs.slice()) l({ data } as MessageEvent);
      }, 0);
    },
    addEventListener: (_type, l) => {
      mine.push(l);
    },
    removeEventListener: (_type, l) => {
      const i = mine.indexOf(l);
      if (i !== -1) mine.splice(i, 1);
    },
  });
  return [end(listeners[0], listeners[1]), end(listeners[1], listeners[0])];
}

let app: MockServer;
let base: string;
beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});

describe('the bundled ingest worker', () => {
  it('builds to gated Chromium 53 code within the worker budget and ingests from the mock provider', async () => {
    const input = join(import.meta.dirname, '..', 'packages', 'data', 'src', 'ingest.worker.ts');
    const { code } = await bundleIife({ input, platform: 'webos', label: 'ingest.worker.js' });
    const budget = checkBudget('ingest.worker.js', 'worker', code);
    console.log(formatBudget(budget));
    expect(budget.ok).toBe(true);

    const factory = freshFactory();
    const [workerPort, uiPort] = pipe();
    const realm = vm.createContext({
      postMessage: workerPort.postMessage,
      addEventListener: workerPort.addEventListener,
      removeEventListener: workerPort.removeEventListener,
      indexedDB: factory,
      IDBKeyRange,
      fetch,
      TextDecoder,
      setTimeout,
      clearTimeout,
    });
    vm.runInContext('var self = globalThis;', realm);
    vm.runInContext('delete Object.entries; delete Object.values; delete String.prototype.padStart; delete String.prototype.padEnd;', realm);
    expect(vm.runInContext('typeof DecompressionStream', realm)).toBe('undefined');
    vm.runInContext(code, realm);

    const client = createIngestClient(uiPort);
    const progress: IngestProgress[] = [];
    const swaps: IngestSwap[] = [];
    client.on('progress', (p) => progress.push(p));
    client.on('swapped', (s) => swaps.push(s));
    expect(await client.call('prune')).toBe(0);
    expect(await client.call('setBusy', { busy: false })).toBe(false);

    const catalog = loadCatalog();
    const url = `${base}/get.php?username=${U}&password=${P}&type=m3u_plus&mock_fault=${encodeURIComponent('gzip:mode=raw')}`;
    const result = await client.call('run', { job: { src: 'pl', source: { type: 'm3u', url } }, lowTier: true });
    expect(result).toMatchObject({ status: 'committed', gen: 1, gzipped: true, counts: { live: catalog.live.length, movie: catalog.movies.length } });
    expect(result.fetch?.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(swaps).toEqual([{ src: 'pl', gen: 1, previous: 0, counts: result.counts }]);
    expect(progress.at(-1)?.phase).toBe('commit');

    const xtream = await client.call('run', { job: { src: 'xt', source: { type: 'xtream', account: { base, username: U, password: P } } } });
    expect(xtream).toMatchObject({ status: 'committed', counts: { live: catalog.live.length, movie: catalog.movies.length, series: catalog.series.length } });

    // A cancelled refresh rejects with CancelError and leaves the active generation.
    const cancel = new CancelSource();
    const running = client.call('run', { job: { src: 'xt', source: { type: 'xtream', account: { base, username: U, password: P } }, force: true } }, { cancel: cancel.token });
    cancel.cancel();
    await expect(running).rejects.toBeInstanceOf(CancelError);

    // What the worker wrote, read back as the query worker would.
    const db = await openDatabase(factory);
    const q = new QueryService({ openDb: async () => db });
    const found = await q.search({ query: 'لابلو تجريبي' });
    expect((await q.items(found.hits)).map((i) => `${i?.src}:${i?.name}`).sort()).toEqual(['pl:لابلو تجريبي ٣', 'xt:لابلو تجريبي ٣']);
    // Wait for the cancelled run to settle in the worker, then check the source is intact.
    await new Promise((r) => setTimeout(r, 200));
    expect((await q.reload()).sources.find((s) => s.src === 'xt')).toMatchObject({ gen: xtream.gen });
    db.close();
    client.close();
  }, 120_000);
});
