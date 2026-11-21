// The query worker as the TV runs it (RELAY step 7): `packages/data/src/query.worker.ts` bundled
// by the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, ES2016 syntax gate), checked
// against the worker budget, then started in a fresh realm that stands in for a worker: `self`
// is a message port, `indexedDB` is fake-indexeddb, and the ES2017 APIs that Chromium 53 lacks
// are deleted. A UI-side DataClient then searches a catalog written by the data layer. Real
// Chromium 53/56 runs of the data workers come with step 8b (engines harness, Blob worker + IDB).

import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { join } from 'node:path';
import { CONFIG_KEY, STORE, createDataClient, openDatabase, transact } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { configAnswer, configDocFields, freshFactory, ingest, item } from '../packages/data/src/test-support';
import { checkBudget, formatBudget } from '../tools/build/src/budgets';
import { bundleIife } from '../tools/build/src/bundle';
import { pipe } from './realm-support';

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
      // The blocklist hash (step 30b2): Chromium 53 has TextEncoder in workers too.
      TextEncoder,
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
    // A favourites list (step 35a): its name trimmed, and the movie boosted at once.
    const movie = { key: 'x:tv:movie:3', src: 'tv', kind: 'movie' as const, normName: 'news of the world', added: 1 };
    expect(await client.call('editProfile', { kind: 'favourite', change: { op: 'newList', id: 'l1', name: ' Films ', item: movie } })).toBe(true);
    expect((await client.call('profile'))!.doc).toMatchObject({ favouriteLists: [{ id: 'l1', name: 'Films', keys: ['x:tv:movie:3'] }] });
    expect((await client.call('search', { query: 'news' })).hits.map((h) => h.favourite)).toEqual([true, false]);
    // A changed channel (step 36a): renamed (trimmed), then numbered; a number another has moves; the switch.
    const channel = { key: 'x:tv:live:1', src: 'tv', kind: 'live' as const, normName: 'sky news hd', added: 2 };
    expect(await client.call('editProfile', { kind: 'channel', change: { op: 'rename', item: channel, name: ' Sky ' } })).toBe(true);
    expect(await client.call('editProfile', { kind: 'channel', change: { op: 'number', item: channel, number: 7 } })).toBe(true);
    expect(await client.call('editProfile', { kind: 'channel', change: { op: 'number', item: { ...channel, key: 'x:tv:live:2' }, number: 7 } })).toBe(true);
    expect(await client.call('editProfile', { kind: 'cleanNames', on: true })).toBe(true);
    expect((await client.call('profile'))!.doc).toMatchObject({
      channelEdits: [
        { key: 'x:tv:live:1', name: 'Sky', missingSince: null },
        { key: 'x:tv:live:2', number: 7 },
      ],
      cleanNames: true,
    });
    expect((await client.call('categories', { src: 'tv', kind: 'live' })).map((c) => c.name)).toEqual(['AR | News', 'UK | News']);
    await expect(client.call('chunk', { src: 'tv', kind: 'live', catIdx: 5, chunk: 0 })).resolves.toEqual([]);
    // The worker shows them at once (step 36a2): the names and numbers served, the new name searched,
    // the number found; a hidden channel out of its chunk, with its place in its category.
    const shown = async (catIdx: number): Promise<string[]> => (await client.call('chunk', { src: 'tv', kind: 'live', catIdx, chunk: 0 })).map((i) => `${i.name}/${i.chno}`);
    expect([await shown(0), await shown(1)]).toEqual([['Sky/null'], ['Sky News HD/7']]);
    expect((await client.call('items', { refs: (await client.call('search', { query: 'sky' })).hits })).map((i) => i?.key)).toEqual(['x:tv:live:1', 'x:tv:live:2']);
    expect(await client.call('numbered', { number: 7, sources: ['tv'] })).toMatchObject({ catIdx: 1, slot: 0, item: { key: 'x:tv:live:2', chno: 7 }, hidden: false });
    expect(await client.call('editProfile', { kind: 'channel', change: { op: 'hide', item: { ...channel, key: 'x:tv:live:2' } } })).toBe(true);
    expect((await client.call('categories', { src: 'tv', kind: 'live' })).map((c) => c.hidden)).toEqual([undefined, [0]]);
    expect(await shown(1)).toEqual([]);
    const status = await client.call('status');
    expect(status.segments.map((s) => `${s.kind}:${s.count}`)).toEqual(['live:2', 'movie:1']);

    // No guide matches the channel: the panel's short EPG, once, then from the cache.
    const account = { base: 'http://p.test', username: 'u', password: 'secret' };
    const focus = { key: 'x:tv:live:1', url: 'http://p.test/live/u/secret/1.ts', source: { type: 'xtream' as const, account }, at: (noon + 60) * 1000 };
    expect(await client.call('shortEpg', focus)).toMatchObject({ from: 'panel', cached: false, now: { title: 'Bundled 0' }, next: { title: 'Bundled 1' } });
    expect(await client.call('shortEpg', focus)).toMatchObject({ from: 'panel', cached: true, now: { title: 'Bundled 0' } });
    expect(asked).toEqual(['http://p.test/player_api.php?username=u&password=secret&action=get_short_epg&stream_id=1&limit=4']);

    // The signed config's blocklist (step 30b2): nothing cached, nothing blocked; the config
    // worker's copy read at `reloadConfig`, a Unicode host mapped to punycode first.
    const urls = ['http://live.blocked.example/1.ts', 'http://free.example/1.ts', 'http://xn--mnchen-3ya.example/x', `http://m${String.fromCharCode(0xfc)}nchen.example/y`];
    expect(await client.call('blocked', { urls })).toEqual([false, false, false, false]);
    const salt = 'QtHj17D-F3HxhSWwfvhERM83_Cu0K5lHS7cQ_PczpBA';
    const hashes = ['blocked.example', 'xn--mnchen-3ya.example'].map((host) => createHash('sha256').update(salt + host, 'utf8').digest('base64url'));
    const signed = JSON.parse(configAnswer(configDocFields({ blocklist: { salt, hashes } }))) as { doc: string; sig: string };
    const kv = await openDatabase(factory);
    await transact(kv, STORE.kv, 'readwrite', (tx) => {
      tx.objectStore(STORE.kv).put({ doc: signed.doc, sig: signed.sig, country: null, fetchedAt: 1 }, CONFIG_KEY);
    });
    kv.close();
    expect(await client.call('reloadConfig')).toBe(2);
    expect(await client.call('blocked', { urls })).toEqual([true, false, true, true]);
  }, 120_000);
});
