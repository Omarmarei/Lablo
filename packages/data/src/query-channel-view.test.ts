// The query worker's view of the changed channels (RELAY step 36a2): hidden channels out of the
// served live chunks with their places in each category, the user's names and numbers (or clean
// names) on every live item read, renamed channels searched by both names, and number entry's
// lookup; taken from the profile at each reload and from each edit at once.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogItem, ContentKind } from '@lablo/core';
import { normalizeName } from '@lablo/core';
import type { ChannelChange } from './channel-changes';
import type { ChannelEdit } from './channel-edits';
import { shownChunks } from './channel-edits';
import { openDatabase } from './idb';
import { emptyProfile, saveProfile } from './profile';
import type { ItemRef } from './query-service';
import { QueryService } from './query-service';
import { favItem, freshFactory, ingest, item } from './test-support';

const withChno = (it: CatalogItem, chno: number): CatalogItem => ({ ...it, chno });
/** Source `tv`: "News" (channels 1-4, chunks of 2) and "Sport" (5-7); one movie. Source `tw`: one channel. */
const TV: CatalogItem[] = [
  item('tv', 'live', 1, 'AR | Al Jazeera HD', 'News'),
  item('tv', 'live', 2, 'UK: BBC News', 'News'),
  withChno(item('tv', 'live', 3, 'Sky News', 'News'), 103),
  item('tv', 'live', 4, 'CNN', 'News'),
  item('tv', 'live', 5, 'beIN Sports 1', 'Sport'),
  item('tv', 'live', 6, '|AR| MBC Pro', 'Sport'),
  item('tv', 'live', 7, 'Dubai Sports', 'Sport'),
  item('tv', 'movie', 8, 'AR | Movie Night', 'Films'),
];
const TW: CatalogItem[] = [item('tw', 'live', 1, 'AR: Other One', 'Misc')];
const ch = (n: number): CatalogItem => TV[n - 1]!;

let db: IDBDatabase;
let q: QueryService;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
  await ingest(db, 'tv', TV, { chunkSize: 2 });
  await ingest(db, 'tw', TW, { chunkSize: 2 });
  q = new QueryService({ openDb: async () => db });
});
afterEach(() => {
  db.close();
});

const edit = (change: ChannelChange): Promise<boolean> => q.editProfile({ kind: 'channel', change });
const hide = (n: number): Promise<boolean> => edit({ op: 'hide', item: favItem(ch(n)) });
const rename = (it: CatalogItem, name: string | null): Promise<boolean> => edit({ op: 'rename', item: favItem(it), name });
const renumber = (n: number, number: number | null): Promise<boolean> => edit({ op: 'number', item: favItem(ch(n)), number });
const clean = (on: boolean): Promise<boolean> => q.editProfile({ kind: 'cleanNames', on });

/** Each served chunk of `src`'s categories of `kind` as `name/chno` strings, by category name. */
async function served(src = 'tv', kind: ContentKind = 'live'): Promise<Record<string, string[][]>> {
  const out: Record<string, string[][]> = {};
  for (const info of await q.categories(src, kind)) {
    const chunks: string[][] = [];
    for (let c = 0; c < info.chunks.length; c += 1) {
      chunks.push((await q.chunk({ src, kind, catIdx: info.catIdx, chunk: c })).map((x) => `${x.name}/${x.chno ?? '-'}`));
    }
    out[info.name] = chunks;
  }
  return out;
}

/** Where channel `n` of `tv` is stored (its category and chunk as the provider has them). */
const refOf = (n: number, gen = 1): ItemRef => ({ src: 'tv', kind: 'live', gen, catIdx: n <= 4 ? 0 : 1, chunk: Math.floor(((n - 1) % 4) / 2), slot: (n - 1) % 2 });
const nameOf = async (n: number): Promise<string> => (await q.items([refOf(n)]))[0]!.name;
const found = async (query: string, sources?: string[]): Promise<string[]> => {
  const result = await q.search({ query, sources });
  const items = await q.items(result.hits);
  return items.map((x) => `${x!.src}:${x!.name}`);
};

const PLAIN = {
  News: [['AR | Al Jazeera HD/-', 'UK: BBC News/-'], ['Sky News/103', 'CNN/-']],
  Sport: [['beIN Sports 1/-', '|AR| MBC Pro/-'], ['Dubai Sports/-']],
};

describe('QueryService: the view of the changed channels (step 36a2)', () => {
  it('serves every channel as stored with nothing changed, and categories without `hidden`', async () => {
    expect(await served()).toEqual(PLAIN);
    for (const info of await q.categories('tv', 'live')) expect('hidden' in info).toBe(false);
    // The stored items themselves.
    const [stored] = await q.items([refOf(3)]);
    expect(stored).toEqual(ch(3));
  });

  it("leaves a hidden channel out of its served chunk, with its place in the category; counts, search and other reads keep it", async () => {
    expect(await hide(2)).toBe(true);
    expect(await hide(4)).toBe(true);
    expect(await hide(6)).toBe(true);
    const infos = await q.categories('tv', 'live');
    expect(infos.map((i) => [i.name, i.count, i.chunks, i.hidden])).toEqual([
      ['News', 4, [2, 2], [1, 3]],
      ['Sport', 3, [2, 1], [1]],
    ]);
    expect(await served()).toEqual({ News: [['AR | Al Jazeera HD/-'], ['Sky News/103']], Sport: [['beIN Sports 1/-'], ['Dubai Sports/-']] });
    // `shownChunks` gives each served chunk's length.
    for (const info of infos) {
      const lengths: number[] = [];
      for (let c = 0; c < info.chunks.length; c += 1) lengths.push((await q.chunk({ src: 'tv', kind: 'live', catIdx: info.catIdx, chunk: c })).length);
      expect(shownChunks(info)).toEqual(lengths);
    }
    // Search finds it where the provider stores it; items and keys read it.
    const result = await q.search({ query: 'bbc' });
    expect(result.hits.map((h) => [h.catIdx, h.chunk, h.slot])).toEqual([[0, 0, 1]]);
    expect((await q.items(result.hits))[0]!.name).toBe('UK: BBC News');
    expect((await q.itemsByKey({ keys: [ch(4).key, ch(6).key], kind: 'live', sources: ['tv'], limit: 2 })).map((x) => x.name)).toEqual(['CNN', '|AR| MBC Pro']);
    // So do the guides' "without a guide" list, the movies and the other source.
    expect((await q.unmatched({ sources: ['tv'], offset: 0, limit: 10 })).rows.map((r) => r.name)).toEqual(PLAIN.News.flat().concat(PLAIN.Sport.flat()).map((s) => s.slice(0, s.indexOf('/'))));
    expect(await served('tv', 'movie')).toEqual({ Films: [['AR | Movie Night/-']] });
    expect(await served('tw')).toEqual({ Misc: [['AR: Other One/-']] });
    // Shown again: back in its chunk.
    expect(await edit({ op: 'show', key: ch(4).key })).toBe(true);
    expect((await served()).News).toEqual([['AR | Al Jazeera HD/-'], ['Sky News/103', 'CNN/-']]);
    expect((await q.categories('tv', 'live'))[0]!.hidden).toEqual([1]);
  });

  it("shows the user's names and numbers on every live item read; the stored items and their normalized names stay the provider's", async () => {
    expect(await rename(ch(1), 'Jazeera')).toBe(true);
    expect(await renumber(1, 7)).toBe(true);
    expect(await renumber(3, 50)).toBe(true);
    expect((await served()).News).toEqual([['Jazeera/7', 'UK: BBC News/-'], ['Sky News/50', 'CNN/-']]);
    const [one] = await q.items([refOf(1)]);
    expect(one).toEqual({ ...ch(1), name: 'Jazeera', chno: 7 });
    expect(one!.normName).toBe(normalizeName('AR | Al Jazeera HD'));
    expect((await q.itemsByKey({ keys: [ch(3).key], kind: 'live', sources: ['tv'], limit: 1 }))[0]).toEqual({ ...ch(3), chno: 50 });
    expect((await q.unmatched({ sources: ['tv'], offset: 0, limit: 1 })).rows[0]!.name).toBe('Jazeera');
    // The provider's again: the cached chunk was never changed.
    expect(await rename(ch(1), null)).toBe(true);
    expect(await renumber(3, null)).toBe(true);
    expect((await served()).News).toEqual([['AR | Al Jazeera HD/7', 'UK: BBC News/-'], ['Sky News/103', 'CNN/-']]);
    expect(await edit({ op: 'reset', key: ch(1).key })).toBe(true);
    expect(await served()).toEqual(PLAIN);
  });

  it('cleans the live names of their leading tags while the switch is on; a name the user gave, and movies, stay', async () => {
    expect(await clean(true)).toBe(true);
    expect(await served()).toEqual({
      News: [['Al Jazeera HD/-', 'BBC News/-'], ['Sky News/103', 'CNN/-']],
      Sport: [['beIN Sports 1/-', 'MBC Pro/-'], ['Dubai Sports/-']],
    });
    expect(await served('tw')).toEqual({ Misc: [['Other One/-']] });
    expect(await served('tv', 'movie')).toEqual({ Films: [['AR | Movie Night/-']] });
    expect(await nameOf(6)).toBe('MBC Pro');
    // A name that needs no cleaning is the stored item itself.
    const [sky] = await q.items([refOf(3)]);
    expect((await q.chunk({ src: 'tv', kind: 'live', catIdx: 0, chunk: 1 }))[0]).toBe(sky);
    expect(await rename(ch(2), 'UK: Mine')).toBe(true);
    expect(await nameOf(2)).toBe('UK: Mine');
    expect(await clean(false)).toBe(true);
    expect(await nameOf(6)).toBe('|AR| MBC Pro');
    expect(await nameOf(2)).toBe('UK: Mine');
  });

  it("searches a renamed channel by both names, once, and keeps the other names with their source's order", async () => {
    expect(await rename(ch(5), 'Football One')).toBe(true);
    expect(await rename(TW[0]!, 'Football Two')).toBe(true);
    expect(await found('football')).toEqual(['tv:Football One', 'tw:Football Two']);
    expect(await found('football', ['tw', 'tv'])).toEqual(['tw:Football Two', 'tv:Football One']);
    expect(await found('football', ['tv'])).toEqual(['tv:Football One']);
    expect(await found('football', ['tw'])).toEqual(['tw:Football Two']);
    expect(await found('bein')).toEqual(['tv:Football One']);
    expect(await found('other')).toEqual(['tw:Football Two']);
    // Found by both names: one hit.
    expect(await rename(ch(7), 'Sports Dubai')).toBe(true);
    const sports = await q.search({ query: 'sports' });
    expect(sports.total).toBe(2);
    expect((await q.items(sports.hits)).map((x) => x!.name)).toEqual(['Sports Dubai', 'Football One']);
    // A hidden channel is still found.
    expect(await hide(7)).toBe(true);
    expect(await found('dubai')).toEqual(['tv:Sports Dubai']);
  });

  it('finds the channel the user numbered, where it is stored, shown, and whether it is hidden', async () => {
    expect(await q.numbered({ number: 12, sources: ['tv', 'tw'] })).toBeNull();
    expect(await renumber(4, 12)).toBe(true);
    expect(await q.numbered({ number: 12, sources: ['tv', 'tw'] })).toEqual({ ...refOf(4), item: { ...ch(4), chno: 12 }, hidden: false });
    expect(await hide(4)).toBe(true);
    expect(await q.numbered({ number: 12, sources: ['tw', 'tv'] })).toEqual({ ...refOf(4), item: { ...ch(4), chno: 12 }, hidden: true });
    // Another number, or a source not listed: none.
    expect(await q.numbered({ number: 13, sources: ['tv'] })).toBeNull();
    expect(await q.numbered({ number: 12, sources: ['tw'] })).toBeNull();
    // The number moves to channel 1; channel 4 shows its provider's again (and stays hidden).
    expect(await renumber(1, 12)).toBe(true);
    expect(await q.numbered({ number: 12, sources: ['tv'] })).toEqual({ ...refOf(1), item: { ...ch(1), chno: 12 }, hidden: false });
    expect((await q.items([refOf(4)]))[0]).toEqual(ch(4));
  });

  it('changes nothing for a changed channel the catalog lacks, or of a source with no catalog', async () => {
    const lost = (src: string, n: number, changes: Partial<ChannelEdit>): ChannelEdit => ({
      key: `x:${src}:live:${n}`,
      src,
      kind: 'live',
      normName: 'gone',
      added: 1,
      missingSince: null,
      ...changes,
    });
    await saveProfile(db, { ...emptyProfile(), channelEdits: [lost('tv', 99, { hidden: true, number: 5 }), lost('zz', 1, { hidden: true, name: 'Gone', number: 6 })] });
    expect(await served()).toEqual(PLAIN);
    for (const info of await q.categories('tv', 'live')) expect('hidden' in info).toBe(false);
    expect(await q.numbered({ number: 5, sources: ['tv'] })).toBeNull();
    expect(await q.numbered({ number: 6, sources: ['zz'] })).toBeNull();
    expect(await found('gone')).toEqual([]);
  });

  it('reads the changes at the first load and again at each reload; items read first load them too', async () => {
    const stored = (changes: Partial<ChannelEdit>, cleanNames?: true): Promise<void> =>
      saveProfile(db, { ...emptyProfile(), channelEdits: [{ ...favItem(ch(2)), missingSince: null, ...changes }], ...(cleanNames ? { cleanNames } : {}) });
    await stored({ name: 'Two' });
    // A fresh worker whose first read is `items` (a hit kept from before): the profile is read first.
    expect(await nameOf(2)).toBe('Two');
    // Written by another worker (a refresh's re-match, a restore): the next reload reads it.
    await stored({ hidden: true }, true);
    expect(await nameOf(2)).toBe('Two');
    await q.reload();
    expect(await nameOf(2)).toBe('BBC News');
    expect((await q.categories('tv', 'live'))[0]!.hidden).toEqual([1]);
  });

  it('never lets a read of the changes that went out before an edit undo it', async () => {
    const reload = q.reload();
    expect(await hide(1)).toBe(true);
    await reload;
    expect((await q.categories('tv', 'live'))[0]!.hidden).toEqual([0]);
    await q.reload();
    expect((await q.categories('tv', 'live'))[0]!.hidden).toEqual([0]);
  });

  it('keeps the view through edits of other kinds, and through edits that change nothing', async () => {
    expect(await hide(1)).toBe(true);
    expect(await clean(true)).toBe(true);
    expect(await hide(1)).toBe(false);
    expect(await clean(true)).toBe(false);
    expect(await q.editProfile({ kind: 'answers', answers: { language: 'ar' } })).toBe(true);
    expect(await q.editProfile({ kind: 'favourite', change: { op: 'newList', id: 'l1', name: null, item: favItem(ch(2)) } })).toBe(true);
    expect((await served()).News).toEqual([['BBC News/-'], ['Sky News/103', 'CNN/-']]);
  });
});

describe('shownChunks (step 36a2)', () => {
  it("counts each chunk's channels less its hidden places", () => {
    expect(shownChunks({ chunks: [500, 500, 37] })).toEqual([500, 500, 37]);
    expect(shownChunks({ chunks: [3, 3, 2], hidden: [0, 2, 3, 7] })).toEqual([1, 2, 1]);
    expect(shownChunks({ chunks: [2, 2], hidden: [2, 3] })).toEqual([2, 0]);
    expect(shownChunks({ chunks: [], hidden: [] })).toEqual([]);
  });
});
