// The live channels without a guide (RELAY step 24c): `QueryService.unmatched` over catalogs
// ingested for real (chunks of two, so a category spans chunks) and match tables written straight
// into the store.

import type { CatalogItem, ContentKey } from '@zoma/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EpgChannelTable } from './epg-store';
import { beginEpgGeneration, commitEpgGeneration, putEpgChannels } from './epg-store';
import { openDatabase, transact } from './idb';
import type { UnmatchedPage } from './query-service';
import { QueryService, UNMATCHED_MAX_ROWS } from './query-service';
import { STORE } from './schema';
import { freshFactory, ingest, item } from './test-support';

const live = (src: string, id: number, name: string, group: string): CatalogItem => item(src, 'live', id, name, group);
const key = (src: string, id: number): ContentKey => live(src, id, '', '').key;

/** Two sources. s1: News (1, 2, 3: two chunks), Sports (4, 5), no category (6), and a film. s2: Kids (11, 12), News (13). */
const S1 = [live('s1', 1, 'One', 'News'), live('s1', 4, 'Four', 'Sports'), live('s1', 2, 'Two', 'News'), live('s1', 6, 'Six', ''), live('s1', 3, 'Three', 'News'), live('s1', 5, 'Five', 'Sports'), item('s1', 'movie', 7, 'A film')];
const S2 = [live('s2', 11, 'Eleven', 'Kids'), live('s2', 12, 'Twelve', 'Kids'), live('s2', 13, 'Thirteen', 'News')];

/** A guide's match table: the keys it matches (all by id), and the live channels it lists as its own unmatched. */
function table(matched: ContentKey[], unmatched: ContentKey[] = []): EpgChannelTable {
  return {
    matches: matched.map((k) => ({ key: k, channel: `${k}.tv`, method: 'id', ambiguous: false, shift: 0 })),
    channels: [],
    unmatched: unmatched.map((k) => ({ key: k, name: '', epgId: null })),
  };
}

async function storeGuide(db: IDBDatabase, epgSrc: string, rank: number, t: EpgChannelTable): Promise<void> {
  const gen = await beginEpgGeneration(db, epgSrc, rank);
  await putEpgChannels(db, epgSrc, gen, t);
  await commitEpgGeneration(db, epgSrc, gen, 1, { rank });
}

/** A row as `src category name`. */
const shown = (page: UnmatchedPage): string[] => page.rows.map((r) => `${r.src} ${r.category} ${r.name}`);

const deleteRecord = (db: IDBDatabase, store: string, k: IDBValidKey): Promise<void> =>
  transact(db, store, 'readwrite', (tx) => {
    tx.objectStore(store).delete(k);
  });

let db: IDBDatabase;
let q: QueryService;
/** The keys of every live channel of s1 then s2, in "All channels" order. */
const ORDER = [1, 2, 3, 4, 5, 6].map((id) => key('s1', id)).concat([11, 12, 13].map((id) => key('s2', id)));
/** The combined guides match 1, 2, 4 and 11; the others are listed, in this order. */
const WHOLE = ['s1 News Three', 's1 Sports Five', 's1  Six', 's2 Kids Twelve', 's2 News Thirteen'];

beforeEach(async () => {
  db = await openDatabase(freshFactory());
  await ingest(db, 's1', S1, { chunkSize: 2 });
  await ingest(db, 's2', S2, { chunkSize: 2 });
  q = new QueryService({ openDb: async () => db });
});
afterEach(() => {
  db.close();
});

describe('QueryService.unmatched (step 24c)', () => {
  describe('with two guides', () => {
    const G = [key('s1', 1), key('s1', 4), key('s2', 11)];
    // `h` also matches a channel no catalog has any more.
    const H = [key('s1', 2), key('s2', 11), key('s9', 99)];
    beforeEach(async () => {
      await storeGuide(
        db,
        'g',
        0,
        table(
          G,
          ORDER.filter((k) => G.indexOf(k) === -1),
        ),
      );
      await storeGuide(
        db,
        'h',
        1,
        table(
          H,
          ORDER.filter((k) => H.indexOf(k) === -1),
        ),
      );
    });

    it('lists the live channels no guide matches, source by source and category by category, each with its source and category', async () => {
      const page = await q.unmatched({ sources: ['s1', 's2'], offset: 0, limit: 50 });
      expect(shown(page)).toEqual(WHOLE);
      expect(page.rows.map((r) => r.key)).toEqual([key('s1', 3), key('s1', 5), key('s1', 6), key('s2', 12), key('s2', 13)]);
      expect([page.version, page.count, page.offset]).toEqual([1, 5, 0]);
    });

    it("is the channels every guide's own list leaves unmatched, in the catalogs' order", async () => {
      const own = [ORDER.filter((k) => G.indexOf(k) === -1), ORDER.filter((k) => H.indexOf(k) === -1)];
      const page = await q.unmatched({ sources: ['s1', 's2'], offset: 0, limit: 50 });
      expect(page.rows.map((r) => r.key)).toEqual(ORDER.filter((k) => own.every((list) => list.indexOf(k) !== -1)));
    });

    it("follows the sources' order asked, and skips a source with no catalog", async () => {
      const page = await q.unmatched({ sources: ['s2', 's9', 's1'], offset: 0, limit: 50 });
      expect(shown(page)).toEqual(WHOLE.slice(3).concat(WHOLE.slice(0, 3)));
      expect(page.count).toBe(5);
      expect(await q.unmatched({ sources: ['s2'], offset: 0, limit: 50 })).toMatchObject({ count: 2, rows: [{ name: 'Twelve' }, { name: 'Thirteen' }] });
      expect(await q.unmatched({ sources: [], offset: 0, limit: 50 })).toEqual({ version: 1, count: 0, offset: 0, rows: [] });
    });

    it('pages through the list: pages across sources and chunks make the whole list, and past its end come back empty', async () => {
      const ask = (offset: number, limit: number): Promise<UnmatchedPage> => q.unmatched({ sources: ['s1', 's2'], offset, limit });
      const pages = await Promise.all([ask(0, 2), ask(2, 2), ask(4, 2)]);
      expect(pages.map(shown)).toEqual([WHOLE.slice(0, 2), WHOLE.slice(2, 4), WHOLE.slice(4)]);
      expect(pages.map((p) => [p.count, p.offset])).toEqual([
        [5, 0],
        [5, 2],
        [5, 4],
      ]);
      // Across the sources' boundary, from inside the first.
      expect(shown(await ask(1, 3))).toEqual(WHOLE.slice(1, 4));
      expect(shown(await ask(3, 1))).toEqual([WHOLE[3]]);
      expect(await ask(5, 2)).toEqual({ version: 1, count: 5, offset: 5, rows: [] });
      expect(await ask(40, 2)).toEqual({ version: 1, count: 5, offset: 40, rows: [] });
      // A limit of 0: the count alone.
      expect(await ask(0, 0)).toEqual({ version: 1, count: 5, offset: 0, rows: [] });
      expect(await ask(2, UNMATCHED_MAX_ROWS)).toMatchObject({ count: 5, rows: [{ name: 'Six' }, { name: 'Twelve' }, { name: 'Thirteen' }] });
    });

    it('refuses a page it would have to cut, and a row number that is not whole', async () => {
      const ask = (offset: number, limit: number): Promise<UnmatchedPage> => q.unmatched({ sources: ['s1'], offset, limit });
      await expect(ask(0, UNMATCHED_MAX_ROWS + 1)).rejects.toThrow(RangeError);
      await expect(ask(0, -1)).rejects.toThrow(RangeError);
      await expect(ask(-1, 2)).rejects.toThrow(RangeError);
      await expect(ask(1.5, 2)).rejects.toThrow(RangeError);
      await expect(ask(Number.NaN, 2)).rejects.toThrow(RangeError);
      expect((await ask(0, UNMATCHED_MAX_ROWS)).count).toBe(3);
    });

    it('walks each catalog once per reload, then reads it again with a new version after a guide or a catalog swap', async () => {
      const ask = (): Promise<UnmatchedPage> => q.unmatched({ sources: ['s1', 's2'], offset: 0, limit: 50 });
      expect((await ask()).count).toBe(5);
      // A chunk changed in place (no swap) isn't walked again before a reload: the list stays.
      const sports = S1.filter((i) => i.group === 'Sports').concat([live('s1', 8, 'Eight', 'Sports')]);
      await transact(db, STORE.chunks, 'readwrite', (tx) => {
        tx.objectStore(STORE.chunks).put({ items: sports.slice(0, 2) }, ['s1', 1, 'live', 1, 0]);
        tx.objectStore(STORE.chunks).put({ items: sports.slice(2) }, ['s1', 1, 'live', 1, 1]);
      });
      expect((await ask()).count).toBe(5);
      await q.reload();
      expect(shown(await ask())).toEqual(['s1 News Three', 's1 Sports Five', 's1 Sports Eight', 's1  Six', 's2 Kids Twelve', 's2 News Thirteen']);
      await transact(db, STORE.chunks, 'readwrite', (tx) => {
        tx.objectStore(STORE.chunks).delete(['s1', 1, 'live', 1, 1]);
      });
      await q.reload();
      expect((await ask()).count).toBe(5);
      // A guide swap matching "Three" and "Twelve": nothing changes until the reload.
      const M = H.concat([key('s1', 3), key('s2', 12)]);
      await storeGuide(db, 'h', 1, table(M));
      expect((await ask()).count).toBe(5);
      await q.reload();
      let page = await ask();
      expect(shown(page)).toEqual(['s1 Sports Five', 's1  Six', 's2 News Thirteen']);
      expect(page.version).toBe(4);
      // A catalog swap with a new channel: listed after the next reload, in its category.
      await ingest(db, 's2', S2.concat([live('s2', 14, 'Fourteen', 'Kids')]), { chunkSize: 2 });
      expect((await ask()).count).toBe(3);
      await q.reload();
      page = await ask();
      expect(shown(page)).toEqual(['s1 Sports Five', 's1  Six', 's2 Kids Fourteen', 's2 News Thirteen']);
      expect([page.version, page.count]).toEqual([5, 4]);
    });

    it('leaves a row out when its chunk is gone', async () => {
      // The list is walked first (a limit of 0 reads no chunk), then "Three"'s chunk goes.
      expect((await q.unmatched({ sources: ['s1', 's2'], offset: 0, limit: 0 })).count).toBe(5);
      await deleteRecord(db, STORE.chunks, ['s1', 1, 'live', 0, 1]);
      const page = await q.unmatched({ sources: ['s1', 's2'], offset: 0, limit: 3 });
      expect([page.count, page.offset]).toEqual([5, 0]);
      expect(shown(page)).toEqual(['s1 Sports Five', 's1  Six']);
    });
  });

  it('lists every live channel, and no film, when no guide is stored', async () => {
    const page = await q.unmatched({ sources: ['s1', 's2'], offset: 0, limit: 50 });
    expect(page.count).toBe(9);
    expect(page.rows.map((r) => r.key)).toEqual(ORDER);
  });

  it('walks a catalog again at the next ask when its walk failed', async () => {
    let fail = true;
    const flaky = new Proxy(db, {
      get(target, name) {
        if (name === 'transaction') {
          return (stores: string | string[], mode?: IDBTransactionMode) => {
            if (fail && stores === STORE.chunks) {
              fail = false;
              throw new Error('the chunks are not readable now');
            }
            return target.transaction(stores, mode);
          };
        }
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    q = new QueryService({ openDb: async () => flaky });
    await expect(q.unmatched({ sources: ['s1'], offset: 0, limit: 0 })).rejects.toThrow('the chunks are not readable now');
    expect(await q.unmatched({ sources: ['s1'], offset: 0, limit: 0 })).toMatchObject({ version: 1, count: 6 });
  });

  it('lists 20,000 channels: one walk, then pages from their own chunks', async () => {
    // 20,000 live channels in 200 categories, interleaved as a panel lists them; a guide matches every other one.
    const items: CatalogItem[] = [];
    for (let i = 0; i < 20_000; i += 1) items.push(live('big', i, `Channel ${i}`, `Group ${i % 200}`));
    await ingest(db, 'big', items);
    const matched: ContentKey[] = [];
    for (let i = 0; i < 20_000; i += 2) matched.push(key('big', i));
    await storeGuide(db, 'g', 0, table(matched));
    // "All channels" order: group by group (as first seen), each in the order given.
    const order: string[] = [];
    for (let g = 0; g < 200; g += 1) for (let i = g; i < 20_000; i += 200) if (i % 2 === 1) order.push(`Channel ${i}`);

    let started = performance.now();
    expect((await q.unmatched({ sources: ['big'], offset: 0, limit: 0 })).count).toBe(10_000);
    const walk = performance.now() - started;
    started = performance.now();
    const page = await q.unmatched({ sources: ['big'], offset: 4_975, limit: 50 });
    const read = performance.now() - started;
    expect(page.rows.map((r) => r.name)).toEqual(order.slice(4_975, 5_025));
    expect(page.rows.every((r) => r.src === 'big' && r.category === r.name.replace(/^Channel (\d+)$/, (_m, n: string) => `Group ${Number(n) % 200}`))).toBe(true);
    console.info(`20,000 live channels: walked in ${walk.toFixed(0)} ms, a page of 50 in ${read.toFixed(1)} ms`);
    // Generous bounds for fake-indexeddb on a shared runner: the walk reads 40 chunks, a page two.
    expect(walk).toBeLessThan(5_000);
    expect(read).toBeLessThan(500);
    // Every page of the most a call gives makes the whole list.
    const names: string[] = [];
    for (let offset = 0; offset < 10_000; offset += UNMATCHED_MAX_ROWS) {
      for (const r of (await q.unmatched({ sources: ['big'], offset, limit: UNMATCHED_MAX_ROWS })).rows) names.push(r.name);
    }
    expect(names).toEqual(order);
  }, 60_000);
});
