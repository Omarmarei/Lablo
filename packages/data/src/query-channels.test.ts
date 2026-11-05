// The manual mapping picker's search (RELAY step 24d): `QueryService.guideChannels` over the
// guides' declared channels, written straight into the store.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeclaredChannel } from './epg-store';
import { beginEpgGeneration, commitEpgGeneration, epgDeclared, putEpgChannels, putEpgDeclared } from './epg-store';
import { openDatabase } from './idb';
import type { GuideChannelsRequest } from './query-service';
import { GUIDE_CHANNELS_MAX_ROWS, QueryService } from './query-service';
import { freshFactory } from './test-support';

const ch = (id: string, ...names: string[]): DeclaredChannel => ({ id, name: names[0] ?? id, names });

/** Guide `g` (first) and `h`; `off` has no active generation. */
const G = [ch('bbc1.uk', 'BBC One', 'BBC 1 HD'), ch('arte.fr', 'Ãrte Ünïcode'), ch('jaz.qa', 'قناة الجزيرة'), ch('zulu.tv', 'Zulu News', 'Zoulou'), ch('only.id')];
const H = [ch('news.uk', 'World News'), ch('bbc2.uk', 'BBC Two')];

/** Commits a generation of `epgSrc` with these declared channels (`null`: none stored, as before step 24d). */
async function storeGuide(db: IDBDatabase, epgSrc: string, rank: number, declared: DeclaredChannel[] | null, used: string[] = [], commit = true): Promise<number> {
  const gen = await beginEpgGeneration(db, epgSrc, rank);
  await putEpgChannels(db, epgSrc, gen, { matches: [], channels: used.map((id) => ({ id, name: `Used ${id}`, icon: null })), unmatched: [] });
  if (declared !== null) await putEpgDeclared(db, epgSrc, gen, epgDeclared(declared));
  if (commit) await commitEpgGeneration(db, epgSrc, gen, 1, { rank });
  return gen;
}

let db: IDBDatabase;
let q: QueryService;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
  q = new QueryService({ openDb: async () => db });
});
afterEach(() => {
  db.close();
});

const find = (req: Partial<GuideChannelsRequest>) => q.guideChannels({ query: '', offset: 0, limit: 100, ...req });
const ids = async (req: Partial<GuideChannelsRequest>): Promise<string[]> => (await find(req)).rows.map((r) => `${r.epgSrc} ${r.id}`);

describe('QueryService.guideChannels (step 24d)', () => {
  beforeEach(async () => {
    // Stored out of order: listed by rank.
    await storeGuide(db, 'u~h', 1, H);
    await storeGuide(db, 'u~g', 0, G);
    await storeGuide(db, 'u~off', 2, [ch('off.tv', 'BBC Off')], [], false);
  });

  it("lists every active guide's channels in priority order, each in its own order, with the name shown", async () => {
    const page = await find({});
    expect(page).toMatchObject({ count: 7, offset: 0 });
    expect(page.rows).toEqual([
      { epgSrc: 'u~g', id: 'bbc1.uk', name: 'BBC One' },
      { epgSrc: 'u~g', id: 'arte.fr', name: 'Ãrte Ünïcode' },
      { epgSrc: 'u~g', id: 'jaz.qa', name: 'قناة الجزيرة' },
      { epgSrc: 'u~g', id: 'zulu.tv', name: 'Zulu News' },
      { epgSrc: 'u~g', id: 'only.id', name: 'only.id' },
      { epgSrc: 'u~h', id: 'news.uk', name: 'World News' },
      { epgSrc: 'u~h', id: 'bbc2.uk', name: 'BBC Two' },
    ]);
    expect(await ids({ epgSrc: 'u~h' })).toEqual(['u~h news.uk', 'u~h bbc2.uk']);
    expect(await find({ epgSrc: 'u~off' })).toMatchObject({ count: 0, rows: [] });
    expect(await find({ epgSrc: 'u~none' })).toMatchObject({ count: 0, rows: [] });
  });

  it('finds the channels whose names or id hold each word, normalized as the matcher does', async () => {
    expect(await ids({ query: 'bbc' })).toEqual(['u~g bbc1.uk', 'u~h bbc2.uk']);
    expect(await ids({ query: 'BBC  one!' })).toEqual(['u~g bbc1.uk']);
    // Any order, and words from two of its names.
    expect(await ids({ query: 'one bbc' })).toEqual(['u~g bbc1.uk']);
    expect(await ids({ query: 'news zoulou' })).toEqual(['u~g zulu.tv']);
    expect(await ids({ query: 'hd' })).toEqual(['u~g bbc1.uk']);
    // Every word must be found.
    expect(await ids({ query: 'bbc three' })).toEqual([]);
    // Never from one name into the next (`bbc1uk`, then `bbc one`).
    expect(await ids({ query: 'ukbbc' })).toEqual([]);
    expect(await ids({ query: 'ARTE unicode' })).toEqual(['u~g arte.fr']);
    expect(await ids({ query: 'ünï' })).toEqual(['u~g arte.fr']);
    expect(await ids({ query: 'الجزيرة' })).toEqual(['u~g jaz.qa']);
    // Inside a word, and in the id (`bbc1.uk` is `bbc1uk`).
    expect(await ids({ query: 'oulo' })).toEqual(['u~g zulu.tv']);
    expect(await ids({ query: 'bbc2' })).toEqual(['u~h bbc2.uk']);
    expect(await ids({ query: 'only' })).toEqual(['u~g only.id']);
    expect(await ids({ query: 'uk' })).toEqual(['u~g bbc1.uk', 'u~h news.uk', 'u~h bbc2.uk']);
    // Nothing a name keeps: every channel.
    expect((await find({ query: ' .,! ' })).count).toBe(7);
    expect(await ids({ query: 'news', epgSrc: 'u~h' })).toEqual(['u~h news.uk']);
  });

  it('pages over the guides, and counts alone with a limit of 0', async () => {
    expect(await ids({ offset: 4, limit: 2 })).toEqual(['u~g only.id', 'u~h news.uk']);
    expect(await find({ offset: 6, limit: 5 })).toMatchObject({ count: 7, offset: 6, rows: [{ id: 'bbc2.uk' }] });
    expect(await find({ offset: 7, limit: 5 })).toMatchObject({ count: 7, offset: 7, rows: [] });
    expect(await find({ offset: 2, limit: 0 })).toEqual({ version: 1, count: 7, offset: 2, rows: [] });
    expect(await find({ query: 'uk', offset: 1, limit: 1 })).toMatchObject({ count: 3, rows: [{ id: 'news.uk' }] });
    expect((await find({ limit: GUIDE_CHANNELS_MAX_ROWS })).count).toBe(7);
  });

  it('refuses a page that is too large or not from a whole row number', async () => {
    expect(GUIDE_CHANNELS_MAX_ROWS).toBe(500);
    for (const bad of [{ limit: GUIDE_CHANNELS_MAX_ROWS + 1 }, { limit: -1 }, { offset: -1 }, { offset: 1.5 }, { offset: Number.NaN }, { limit: Number.NaN }]) {
      await expect(find(bad), JSON.stringify(bad)).rejects.toThrow(RangeError);
    }
  });

  it('reads each guide once per reload, and its new generation after one', async () => {
    expect(await find({ limit: 0 })).toMatchObject({ version: 1, count: 7 });
    // Written over in place: the list read before is kept until a reload.
    await putEpgDeclared(db, 'u~h', 1, epgDeclared([ch('new.uk', 'New')]));
    expect(await find({ limit: 0 })).toMatchObject({ version: 1, count: 7 });
    await q.reload();
    expect(await ids({ epgSrc: 'u~h' })).toEqual(['u~h new.uk']);
    expect((await find({})).version).toBe(2);
    await storeGuide(db, 'u~h', 1, [ch('third.uk', 'Third')]);
    expect(await ids({ epgSrc: 'u~h' })).toEqual(['u~h new.uk']);
    await q.reload();
    expect(await ids({ epgSrc: 'u~h' })).toEqual(['u~h third.uk']);
  });
});

describe('QueryService.guideChannels for a guide read before step 24d', () => {
  it('lists the channels in use from its match table, and nothing without one', async () => {
    await storeGuide(db, 'u~old', 0, null, ['a.tv', 'b.tv']);
    expect((await find({})).rows).toEqual([
      { epgSrc: 'u~old', id: 'a.tv', name: 'Used a.tv' },
      { epgSrc: 'u~old', id: 'b.tv', name: 'Used b.tv' },
    ]);
    expect(await ids({ query: 'used b' })).toEqual(['u~old b.tv']);
    expect(await ids({ query: 'atv' })).toEqual(['u~old a.tv']);
    const gen = await beginEpgGeneration(db, 'u~bare', 1);
    await commitEpgGeneration(db, 'u~bare', gen, 1, { rank: 1 });
    await q.reload();
    expect(await ids({})).toEqual(['u~old a.tv', 'u~old b.tv']);
  });

  it('tries a read that failed again at the next ask', async () => {
    await storeGuide(db, 'u~g', 0, G);
    let fail = 0;
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === 'transaction' && fail > 0) {
          fail -= 1;
          return () => {
            throw new Error('Read failed');
          };
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    q = new QueryService({ openDb: async () => flaky });
    await q.reload();
    fail = 1;
    await expect(find({})).rejects.toThrow('Read failed');
    expect((await find({})).count).toBe(5);
  });
});
