// The query worker as the TV runs it (RELAY step 7): `packages/data/src/query.worker.ts` bundled
// by the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, ES2016 syntax gate), checked
// against the worker budget, then started in a fresh realm that stands in for a worker: `self`
// is a message port, `indexedDB` is fake-indexeddb, and the ES2017 APIs that Chromium 53 lacks
// are deleted. A UI-side DataClient then searches a catalog written by the data layer. Real
// Chromium 53/56 runs of the data workers come with step 8b (engines harness, Blob worker + IDB).

import vm from 'node:vm';
import { join } from 'node:path';
import type { RpcPort } from '@zoma/data';
import { createDataClient, openDatabase } from '@zoma/data';
import { describe, expect, it } from 'vitest';
import { freshFactory, ingest, item } from '../packages/data/src/test-support';
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

describe('the bundled query worker', () => {
  it('builds to gated Chromium 53 code within the worker budget and serves search over IndexedDB', async () => {
    const input = join(import.meta.dirname, '..', 'packages', 'data', 'src', 'query.worker.ts');
    const { code } = await bundleIife({ input, platform: 'webos', label: 'query.worker.js' });
    const budget = checkBudget('query.worker.js', 'worker', code);
    console.log(formatBudget(budget));
    expect(budget.ok).toBe(true);

    const factory = freshFactory();
    const db = await openDatabase(factory);
    await ingest(db, 'tv', [
      item('tv', 'live', 1, 'قناة الأخبار', 'AR | News'),
      item('tv', 'live', 2, 'Sky News HD', 'UK | News'),
      item('tv', 'movie', 3, 'News of the World', 'EN | Drama'),
    ]);
    db.close();

    // As in a real worker, the global object is the port and `self` is the global object
    // (core-js's `self` polyfill replaces any other `self`).
    const [workerPort, uiPort] = pipe();
    const realm = vm.createContext({
      postMessage: workerPort.postMessage,
      addEventListener: workerPort.addEventListener,
      removeEventListener: workerPort.removeEventListener,
      indexedDB: factory,
      IDBKeyRange,
      setTimeout,
      clearTimeout,
    });
    vm.runInContext('var self = globalThis;', realm);
    vm.runInContext('delete Object.entries; delete Object.values; delete String.prototype.padStart; delete String.prototype.padEnd;', realm);
    vm.runInContext(code, realm);

    const client = createDataClient(uiPort);
    const result = await client.call('search', { query: 'news' });
    expect(result.total).toBe(2);
    const items = await client.call('items', { refs: result.hits });
    expect(items.map((i) => i?.name)).toEqual(['Sky News HD', 'News of the World']);
    expect((await client.call('search', { query: 'الاخبار' })).hits).toHaveLength(1);
    expect(await client.call('setFavourites', { keys: ['x:tv:movie:3'] })).toBe(1);
    expect((await client.call('categories', { src: 'tv', kind: 'live' })).map((c) => c.name)).toEqual(['AR | News', 'UK | News']);
    await expect(client.call('chunk', { src: 'tv', kind: 'live', catIdx: 5, chunk: 0 })).resolves.toEqual([]);
    const status = await client.call('status');
    expect(status.segments.map((s) => `${s.kind}:${s.count}`)).toEqual(['live:2', 'movie:1']);
  }, 120_000);
});
