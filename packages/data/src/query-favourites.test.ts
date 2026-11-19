// The search boost from the profile's favourites (RELAY step 35a): the query worker reads them at
// each reload and takes them from each `favourite` edit's write, with no call from the app.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogItem } from '@lablo/core';
import { openDatabase } from './idb';
import { emptyProfile, saveProfile } from './profile';
import { QueryService } from './query-service';
import { favItem, freshFactory, ingest, item } from './test-support';

const channels: CatalogItem[] = [item('tv', 'live', 1, 'News One'), item('tv', 'live', 2, 'News Two'), item('tv', 'live', 3, 'News Three')];

let db: IDBDatabase;
let q: QueryService;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
  await ingest(db, 'tv', channels);
  q = new QueryService({ openDb: async () => db });
});
afterEach(() => {
  db.close();
});

/** The names the search for "news" gives, a favourite marked `*`. */
async function ranked(): Promise<string[]> {
  const result = await q.search({ query: 'news' });
  const items = await q.items(result.hits);
  return result.hits.map((h, i) => `${h.favourite ? '*' : ''}${items[i]!.name}`);
}

const add = (n: number, list = 'l1'): Promise<boolean> => q.editProfile({ kind: 'favourite', change: { op: 'add', list, item: favItem(channels[n - 1]!) } });
const PLAIN = ['News One', 'News Two', 'News Three'];

describe('QueryService: favourites boosted in search (step 35a)', () => {
  it('reads the stored favourites at the first load, and again at each reload', async () => {
    await saveProfile(db, { ...emptyProfile(), favourites: [{ ...favItem(channels[2]!), missingSince: null }] });
    expect(await ranked()).toEqual(['*News Three', 'News One', 'News Two']);
    // Written by another worker (a refresh's re-match): the next reload reads it.
    await saveProfile(db, { ...emptyProfile(), favourites: [{ ...favItem(channels[1]!), missingSince: null }] });
    expect(await ranked()).toEqual(['*News Three', 'News One', 'News Two']);
    await q.reload();
    expect(await ranked()).toEqual(['*News Two', 'News One', 'News Three']);
  });

  it('boosts nothing without a profile', async () => {
    expect(await ranked()).toEqual(PLAIN);
  });

  it("takes each favourite edit's favourites at once; other edits, and edits that change nothing, keep them", async () => {
    expect(await ranked()).toEqual(PLAIN);
    expect(await q.editProfile({ kind: 'favourite', change: { op: 'newList', id: 'l1', name: null, item: favItem(channels[1]!) } })).toBe(true);
    expect(await ranked()).toEqual(['*News Two', 'News One', 'News Three']);
    expect(await add(3)).toBe(true);
    expect(await ranked()).toEqual(['*News Two', '*News Three', 'News One']);
    expect(await add(3)).toBe(false);
    expect(await q.editProfile({ kind: 'answers', answers: { language: 'ar' } })).toBe(true);
    expect(await q.editProfile({ kind: 'group', change: { op: 'hide', group: { src: 'tv', name: '' } } })).toBe(true);
    expect(await ranked()).toEqual(['*News Two', '*News Three', 'News One']);
    expect(await q.editProfile({ kind: 'favourite', change: { op: 'remove', list: 'l1', key: channels[1]!.key } })).toBe(true);
    expect(await ranked()).toEqual(['*News Three', 'News One', 'News Two']);
    expect(await q.editProfile({ kind: 'favourite', change: { op: 'removeList', list: 'l1' } })).toBe(true);
    expect(await ranked()).toEqual(PLAIN);
  });

  it('never lets a read of the favourites that went out before an edit undo it', async () => {
    await saveProfile(db, { ...emptyProfile(), favourites: [], favouriteLists: [{ id: 'l1', name: null, keys: [] }] });
    // The reload reads the profile first; the edit is written after that read, and lands before the reload ends.
    const reload = q.reload();
    expect(await add(1)).toBe(true);
    await reload;
    expect(await ranked()).toEqual(['*News One', 'News Two', 'News Three']);
    // A reload that starts after the edit reads it from the profile.
    await q.reload();
    expect(await ranked()).toEqual(['*News One', 'News Two', 'News Three']);
  });
});
