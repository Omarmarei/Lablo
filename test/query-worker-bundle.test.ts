// The query worker as the TV runs it (RELAY step 7): `packages/data/src/query.worker.ts` bundled
// by the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, ES2016 syntax gate), checked
// against the worker budget, then started in a fresh realm that stands in for a worker: `self`
// is a message port, `indexedDB` is fake-indexeddb, and the ES2017 APIs that Chromium 53 lacks
// are deleted. A UI-side DataClient then searches a catalog written by the data layer. Real
// Chromium 53/56 runs of the data workers come with step 8b (engines harness, Blob worker + IDB).

import vm from 'node:vm';
import { join } from 'node:path';
import type { RpcPort } from '@lablo/data';
import { createDataClient, openDatabase } from '@lablo/data';
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
    // The short-EPG fallback's network (step 9c): fetch and TextDecoder, as in Chromium 53.
    const asked: string[] = [];
    const noon = Date.UTC(2026, 10, 2, 12) / 1000;
    const answer = { epg_listings: [0, 1].map((i) => ({ title: Buffer.from(`Bundled ${i}`).toString('base64'), start_timestamp: noon + i * 1800, stop_timestamp: noon + (i + 1) * 1800 })) };
    const fakeFetch = (url: string): Promise<Response> => {
      asked.push(url);
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    };
    const realm = vm.createContext({
      fetch: fakeFetch,
      TextDecoder,
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

    // No guide matches the channel: the panel's short EPG, once, then from the cache.
    const account = { base: 'http://p.test', username: 'u', password: 'secret' };
    const focus = { key: 'x:tv:live:1', url: 'http://p.test/live/u/secret/1.ts', source: { type: 'xtream' as const, account }, at: (noon + 60) * 1000 };
    expect(await client.call('shortEpg', focus)).toMatchObject({ from: 'panel', cached: false, now: { title: 'Bundled 0' }, next: { title: 'Bundled 1' } });
    expect(await client.call('shortEpg', focus)).toMatchObject({ from: 'panel', cached: true, now: { title: 'Bundled 0' } });
    expect(asked).toEqual(['http://p.test/player_api.php?username=u&password=secret&action=get_short_epg&stream_id=1&limit=4']);
  }, 120_000);
});
