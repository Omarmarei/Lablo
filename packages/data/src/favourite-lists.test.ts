// The favourites lists and the live groups (RELAY step 35a): the checks on read (favourite-lists.ts),
// the edits (favourite-edits.ts) and their place in `applyProfileEdit`.

import { describe, expect, it } from 'vitest';
import type { FavouriteChange, FavouriteItem, GroupChange } from './favourite-edits';
import { applyFavouriteChange, applyGroupChange, isFavouriteItem, relinkLists } from './favourite-edits';
import type { FavouriteList, GroupRef } from './favourite-lists';
import {
  LIST_ID_MAX,
  LIST_NAME_MAX,
  MAX_FAVOURITES,
  MAX_FAVOURITE_LISTS,
  MAX_GROUP_REFS,
  MAX_LIST_ITEMS,
  favouriteListsOf,
  groupId,
  groupOrderOf,
  hiddenGroupsOf,
  isGroupRef,
  isListId,
  isListName,
} from './favourite-lists';
import type { FavouriteRef, ProfileDoc } from './profile';
import { applyProfileEdit, emptyProfile, favouriteKeysOf } from './profile';

const item = (n: number, extra: Partial<FavouriteItem> = {}): FavouriteItem => ({ key: `x:s1:live:${n}`, src: 's1', kind: 'live', normName: `channel ${n}`, added: 100 + n, ...extra });
const ref = (n: number, extra: Partial<FavouriteRef> = {}): FavouriteRef => ({ ...item(n), missingSince: null, ...extra });
const key = (n: number): string => `x:s1:live:${n}`;
const list = (id: string, keys: number[], name: string | null = null): FavouriteList => ({ id, name, keys: keys.map(key) });

/** A document with `favourites` and `favouriteLists`. */
const docOf = (favourites: FavouriteRef[], lists?: FavouriteList[]): ProfileDoc => (lists === undefined ? { ...emptyProfile(), favourites } : { ...emptyProfile(), favourites, favouriteLists: lists });
const change = (doc: ProfileDoc, c: FavouriteChange): ReturnType<typeof applyFavouriteChange> => applyFavouriteChange(doc, doc.favourites, c);
const keysOf = (pool: readonly FavouriteRef[]): string[] => pool.map((f) => f.key);

describe('favourite-lists: the checks on read', () => {
  it('reads no lists from a document without them, or from what is not a document', () => {
    expect(favouriteListsOf(emptyProfile())).toEqual([]);
    for (const doc of [null, undefined, 3, 'x', []]) expect(favouriteListsOf(doc)).toEqual([]);
    for (const stored of [null, {}, 'l1', 7]) expect(favouriteListsOf({ favouriteLists: stored })).toEqual([]);
  });

  it('keeps the lists in their order, and leaves out what is not a list', () => {
    const good = list('l1', [1, 2], 'Sport');
    const stored: unknown[] = [
      null,
      'l0',
      { id: '', name: null, keys: [] },
      { id: 7, name: null, keys: [] },
      { id: 'x'.repeat(LIST_ID_MAX + 1), name: null, keys: [] },
      { id: 'l2', name: '', keys: [] },
      { id: 'l3', name: 'n'.repeat(LIST_NAME_MAX + 1), keys: [] },
      { id: 'l4', name: 5, keys: [] },
      { id: 'l5', keys: [] },
      { id: 'l6', name: null, keys: 'x:s1:live:1' },
      { id: 'l7', name: null },
      good,
      { id: 'l1', name: 'Twice', keys: [] },
      { id: 'y'.repeat(LIST_ID_MAX), name: 'n'.repeat(LIST_NAME_MAX), keys: [] },
      { id: 'l8', name: null, keys: [key(3), 4, '', null, key(3), key(5)], extra: true },
    ];
    expect(favouriteListsOf({ favouriteLists: stored })).toEqual([good, { id: 'y'.repeat(LIST_ID_MAX), name: 'n'.repeat(LIST_NAME_MAX), keys: [] }, list('l8', [3, 5])]);
  });

  it('reads at most the caps: lists, and keys in a list', () => {
    const many = Array.from({ length: MAX_FAVOURITE_LISTS + 2 }, (_, i) => list(`l${i}`, []));
    expect(favouriteListsOf({ favouriteLists: many }).map((l) => l.id)).toEqual(many.slice(0, MAX_FAVOURITE_LISTS).map((l) => l.id));
    // A list that isn't one doesn't count toward the cap.
    expect(favouriteListsOf({ favouriteLists: [null, ...many] })).toHaveLength(MAX_FAVOURITE_LISTS);
    const keys = Array.from({ length: MAX_LIST_ITEMS + 5 }, (_, i) => key(i));
    expect(favouriteListsOf({ favouriteLists: [{ id: 'l1', name: null, keys }] })[0]!.keys).toEqual(keys.slice(0, MAX_LIST_ITEMS));
    // Repeats don't count toward it either.
    const repeated = [key(0), key(0), ...keys];
    expect(favouriteListsOf({ favouriteLists: [{ id: 'l1', name: null, keys: repeated }] })[0]!.keys).toEqual(keys.slice(0, MAX_LIST_ITEMS));
  });

  it('checks ids and names by their length', () => {
    expect([isListId('a'), isListId('x'.repeat(LIST_ID_MAX)), isListId(''), isListId('x'.repeat(LIST_ID_MAX + 1)), isListId(1), isListId(null)]).toEqual([true, true, false, false, false, false]);
    expect([isListName('a'), isListName('n'.repeat(LIST_NAME_MAX)), isListName(''), isListName('n'.repeat(LIST_NAME_MAX + 1)), isListName(null)]).toEqual([true, true, false, false, false]);
  });

  it('reads the hidden groups and the order, each from its own field', () => {
    const a: GroupRef = { src: 's1', name: 'News' };
    const b: GroupRef = { src: 's2', name: 'News' };
    const c: GroupRef = { src: 's1', name: '' };
    const d: GroupRef = { src: 's1', name: 'Sport' };
    // A repeat is left out; a group's other fields are not kept.
    const stored: unknown[] = [a, null, 'x', { src: '', name: 'News' }, { src: 's1' }, { src: 3, name: 'x' }, { src: 's1', name: 4 }, b, c, { src: 's1', name: 'News', extra: 1 }, { ...d, extra: 2 }];
    expect(hiddenGroupsOf({ hiddenGroups: stored })).toEqual([a, b, c, d]);
    expect(groupOrderOf({ groupOrder: stored })).toEqual([a, b, c, d]);
    expect(hiddenGroupsOf({ groupOrder: stored })).toEqual([]);
    expect(groupOrderOf({ hiddenGroups: stored })).toEqual([]);
    for (const doc of [null, emptyProfile(), { hiddenGroups: 'News' }, { hiddenGroups: {} }]) expect(hiddenGroupsOf(doc)).toEqual([]);
    // A name an object inherits is a name like any other.
    expect(hiddenGroupsOf({ hiddenGroups: [{ src: 's1', name: '__proto__' }, { src: 's1', name: 'constructor' }, { src: 's1', name: '__proto__' }] })).toEqual([
      { src: 's1', name: '__proto__' },
      { src: 's1', name: 'constructor' },
    ]);
  });

  it('reads at most MAX_GROUP_REFS groups, repeats not counted', () => {
    const many = Array.from({ length: MAX_GROUP_REFS + 3 }, (_, i) => ({ src: 's1', name: `g${i}` }));
    expect(hiddenGroupsOf({ hiddenGroups: [many[0], ...many] })).toEqual(many.slice(0, MAX_GROUP_REFS));
  });

  it('tells groups apart by source and name together', () => {
    expect(groupId({ src: 's1', name: 'a' })).not.toBe(groupId({ src: 's1', name: 'b' }));
    expect(groupId({ src: 's1', name: 'a' })).not.toBe(groupId({ src: 's2', name: 'a' }));
    expect(groupId({ src: 's1', name: 'a' })).toBe(groupId({ src: 's1', name: 'a' }));
    // A source's id that ends where another's name starts.
    expect(groupId({ src: 's1', name: '1a' })).not.toBe(groupId({ src: 's11', name: 'a' }));
    expect([isGroupRef({ src: 's1', name: '' }), isGroupRef({ src: '', name: 'a' }), isGroupRef(null), isGroupRef({ name: 'a' })]).toEqual([true, false, false, false]);
  });
});

describe('favourite-edits: the items the app adds', () => {
  it('takes an item with a key, a source, a kind, a normalized name and an add time', () => {
    expect(isFavouriteItem(item(1))).toBe(true);
    expect(isFavouriteItem(item(1, { group: 'News', epgId: null }))).toBe(true);
    expect(isFavouriteItem(item(1, { epgId: 'bbc.uk' }))).toBe(true);
    expect(isFavouriteItem(item(1, { kind: 'movie' }))).toBe(true);
    expect(isFavouriteItem(item(1, { kind: 'series' }))).toBe(true);
    const bad: Record<string, unknown>[] = [
      { key: '' },
      { key: 3 },
      { src: '' },
      { src: null },
      { kind: 'episode' },
      { kind: undefined },
      { normName: null },
      { group: 4 },
      { epgId: 5 },
      { added: '1' },
      { added: Infinity },
      { added: NaN },
    ];
    for (const fields of bad) expect(isFavouriteItem({ ...item(1), ...fields })).toBe(false);
    for (const value of [null, 'x', 1]) expect(isFavouriteItem(value)).toBe(false);
  });
});

describe('favourite-edits: the lists', () => {
  it('makes a new list at the end, empty or with its first item (the pool gets its ref)', () => {
    const doc = docOf([ref(1)], [list('l1', [1])]);
    expect(change(doc, { op: 'newList', id: 'l2', name: null })).toEqual({ favourites: [ref(1)], favouriteLists: [list('l1', [1]), list('l2', [])] });
    const withItem = change(doc, { op: 'newList', id: 'l2', name: '  Sport ', item: { ...item(2, { group: 'Sport', epgId: 'sport.tv' }), extra: 1 } as FavouriteItem })!;
    expect(withItem.favouriteLists).toEqual([list('l1', [1]), list('l2', [2], 'Sport')]);
    expect(withItem.favourites).toEqual([ref(1), ref(2, { group: 'Sport', epgId: 'sport.tv' })]);
    // An item the pool has keeps its ref (and when it was added).
    expect(change(doc, { op: 'newList', id: 'l2', name: null, item: item(1, { added: 999 }) })!.favourites).toEqual([ref(1)]);
    // The first list of a document without lists.
    expect(change(docOf([]), { op: 'newList', id: 'l1', name: null, item: item(4) })).toEqual({ favourites: [ref(4)], favouriteLists: [list('l1', [4])] });
  });

  it('refuses a new list with an id the lists have, a bad id or name, a bad item, or past a cap', () => {
    const doc = docOf([ref(1)], [list('l1', [1])]);
    expect(change(doc, { op: 'newList', id: 'l1', name: null })).toBeNull();
    expect(change(doc, { op: 'newList', id: '', name: null })).toBeNull();
    expect(change(doc, { op: 'newList', id: 'x'.repeat(LIST_ID_MAX + 1), name: null })).toBeNull();
    expect(change(doc, { op: 'newList', id: 'l2', name: '   ' })).toBeNull();
    expect(change(doc, { op: 'newList', id: 'l2', name: 'n'.repeat(LIST_NAME_MAX + 1) })).toBeNull();
    expect(change(doc, { op: 'newList', id: 'l2', name: ` ${'n'.repeat(LIST_NAME_MAX)} ` })!.favouriteLists[1]!.name).toBe('n'.repeat(LIST_NAME_MAX));
    expect(change(doc, { op: 'newList', id: 'l2', name: 5 as unknown as string })).toBeNull();
    expect(change(doc, { op: 'newList', id: 'l2', name: null, item: { ...item(2), kind: 'radio' } as unknown as FavouriteItem })).toBeNull();
    const full = docOf([], Array.from({ length: MAX_FAVOURITE_LISTS }, (_, i) => list(`l${i}`, [])));
    expect(change(full, { op: 'newList', id: 'new', name: null })).toBeNull();
    const fewer = docOf([], Array.from({ length: MAX_FAVOURITE_LISTS - 1 }, (_, i) => list(`l${i}`, [])));
    expect(change(fewer, { op: 'newList', id: 'new', name: null })!.favouriteLists).toHaveLength(MAX_FAVOURITE_LISTS);
  });

  it('adds an item at a list end, the pool getting its ref only once', () => {
    const doc = docOf([ref(1), ref(2)], [list('l1', [1]), list('l2', [2])]);
    const added = change(doc, { op: 'add', list: 'l1', item: item(2, { added: 999 }) })!;
    expect(added.favouriteLists).toEqual([list('l1', [1, 2]), list('l2', [2])]);
    expect(added.favourites).toEqual([ref(1), ref(2)]);
    const fresh = change(doc, { op: 'add', list: 'l2', item: item(3) })!;
    expect(fresh.favouriteLists).toEqual([list('l1', [1]), list('l2', [2, 3])]);
    expect(fresh.favourites).toEqual([ref(1), ref(2), ref(3)]);
  });

  it('refuses an add to no list, of a bad item or one the list has, or past a cap', () => {
    const doc = docOf([ref(1)], [list('l1', [1])]);
    expect(change(doc, { op: 'add', list: 'l9', item: item(2) })).toBeNull();
    expect(change(doc, { op: 'add', list: 'l1', item: item(1) })).toBeNull();
    expect(change(doc, { op: 'add', list: 'l1', item: { ...item(2), added: null } as unknown as FavouriteItem })).toBeNull();
    const keys = Array.from({ length: MAX_LIST_ITEMS }, (_, i) => i);
    const fullList = docOf(keys.map((n) => ref(n)), [list('l1', keys), list('l2', [])]);
    expect(change(fullList, { op: 'add', list: 'l1', item: item(MAX_LIST_ITEMS) })).toBeNull();
    // Another list still takes it, and the full one takes an item once one is out.
    expect(change(fullList, { op: 'add', list: 'l2', item: item(MAX_LIST_ITEMS) })).not.toBeNull();
    const oneOut = docOf(keys.map((n) => ref(n)), [list('l1', keys.slice(1))]);
    expect(change(oneOut, { op: 'add', list: 'l1', item: item(MAX_LIST_ITEMS) })!.favouriteLists[0]!.keys).toHaveLength(MAX_LIST_ITEMS);
  });

  it('refuses a new item past the pool cap, but takes one the pool has', () => {
    const all = Array.from({ length: MAX_FAVOURITES }, (_, i) => i);
    const lists = Array.from({ length: Math.ceil(MAX_FAVOURITES / MAX_LIST_ITEMS) }, (_, i) => list(`l${i}`, all.slice(i * MAX_LIST_ITEMS, (i + 1) * MAX_LIST_ITEMS)));
    const doc = docOf(all.map((n) => ref(n)), lists.concat([list('extra', [])]));
    expect(change(doc, { op: 'add', list: 'extra', item: item(MAX_FAVOURITES) })).toBeNull();
    expect(change(doc, { op: 'newList', id: 'new', name: null, item: item(MAX_FAVOURITES) })).toBeNull();
    expect(change(doc, { op: 'add', list: 'extra', item: item(5) })!.favouriteLists[lists.length]!.keys).toEqual([key(5)]);
    const below = docOf(all.slice(1).map((n) => ref(n)), [list('extra', [])]);
    expect(change(below, { op: 'add', list: 'extra', item: item(MAX_FAVOURITES) })!.favourites).toHaveLength(MAX_FAVOURITES);
  });

  it('takes an item out of a list, and out of the pool when no other list holds it', () => {
    const doc = docOf([ref(1), ref(2), ref(3), ref(9)], [list('l1', [1, 2, 3]), list('l2', [2])]);
    const one = change(doc, { op: 'remove', list: 'l1', key: key(1) })!;
    expect(one.favouriteLists).toEqual([list('l1', [2, 3]), list('l2', [2])]);
    // Ref 9 is in no list (a profile from before step 35a): an edit of another key leaves it.
    expect(keysOf(one.favourites)).toEqual([key(2), key(3), key(9)]);
    const shared = change(doc, { op: 'remove', list: 'l1', key: key(2) })!;
    expect(shared.favouriteLists).toEqual([list('l1', [1, 3]), list('l2', [2])]);
    expect(keysOf(shared.favourites)).toEqual([key(1), key(2), key(3), key(9)]);
    expect(change(doc, { op: 'remove', list: 'l2', key: key(1) })).toBeNull();
    expect(change(doc, { op: 'remove', list: 'l9', key: key(1) })).toBeNull();
  });

  it('moves an item in its list, clamped, and refuses a move that stays or has no place', () => {
    const doc = docOf([ref(1), ref(2), ref(3)], [list('l1', [1, 2, 3])]);
    const to = (k: number, place: number): number[] | null => {
      const r = change(doc, { op: 'move', list: 'l1', key: key(k), to: place });
      return r === null ? null : r.favouriteLists[0]!.keys.map((x) => Number(x.slice(x.lastIndexOf(':') + 1)));
    };
    expect(to(1, 2)).toEqual([2, 3, 1]);
    expect(to(3, 0)).toEqual([3, 1, 2]);
    expect(to(1, 1)).toEqual([2, 1, 3]);
    expect(to(1, 1.9)).toEqual([2, 1, 3]);
    expect(to(1, 99)).toEqual([2, 3, 1]);
    expect(to(1, Infinity)).toEqual([2, 3, 1]);
    expect(to(3, -4)).toEqual([3, 1, 2]);
    expect(to(2, 1)).toBeNull();
    expect(to(3, 99)).toBeNull();
    expect(to(1, -1)).toBeNull();
    expect(to(2, 1.5)).toBeNull();
    expect(to(2, NaN)).toBeNull();
    expect(change(doc, { op: 'move', list: 'l1', key: key(2), to: '0' as unknown as number })).toBeNull();
    expect(change(doc, { op: 'move', list: 'l1', key: key(7), to: 0 })).toBeNull();
    expect(change(doc, { op: 'move', list: 'l9', key: key(1), to: 2 })).toBeNull();
    expect(change(doc, { op: 'move', list: 'l1', key: key(1), to: 2 })!.favourites).toEqual([ref(1), ref(2), ref(3)]);
  });

  it('renames a list (trimmed; null is "Favourites" again), and refuses the same name or a bad one', () => {
    const doc = docOf([], [list('l1', [], 'Sport'), list('l2', [])]);
    expect(change(doc, { op: 'rename', list: 'l1', name: ' News ' })!.favouriteLists).toEqual([list('l1', [], 'News'), list('l2', [])]);
    expect(change(doc, { op: 'rename', list: 'l1', name: null })!.favouriteLists).toEqual([list('l1', []), list('l2', [])]);
    expect(change(doc, { op: 'rename', list: 'l2', name: 'Kids' })!.favouriteLists).toEqual([list('l1', [], 'Sport'), list('l2', [], 'Kids')]);
    expect(change(doc, { op: 'rename', list: 'l1', name: 'Sport ' })).toBeNull();
    expect(change(doc, { op: 'rename', list: 'l2', name: null })).toBeNull();
    expect(change(doc, { op: 'rename', list: 'l1', name: '' })).toBeNull();
    expect(change(doc, { op: 'rename', list: 'l9', name: 'X' })).toBeNull();
  });

  it('removes a list: its items no other list holds leave the pool', () => {
    const doc = docOf([ref(1), ref(2), ref(9)], [list('l1', [1, 2]), list('l2', [2])]);
    const gone = change(doc, { op: 'removeList', list: 'l1' })!;
    expect(gone.favouriteLists).toEqual([list('l2', [2])]);
    expect(keysOf(gone.favourites)).toEqual([key(2), key(9)]);
    const last = change(docOf([ref(2)], [list('l2', [2])]), { op: 'removeList', list: 'l2' })!;
    expect(last).toEqual({ favourites: [], favouriteLists: [] });
    expect(change(doc, { op: 'removeList', list: 'l9' })).toBeNull();
  });

  it('moves a list among the lists', () => {
    const doc = docOf([], [list('l1', []), list('l2', []), list('l3', [])]);
    expect(change(doc, { op: 'moveList', list: 'l1', to: 2 })!.favouriteLists.map((l) => l.id)).toEqual(['l2', 'l3', 'l1']);
    expect(change(doc, { op: 'moveList', list: 'l3', to: -1 })!.favouriteLists.map((l) => l.id)).toEqual(['l3', 'l1', 'l2']);
    expect(change(doc, { op: 'moveList', list: 'l2', to: 1 })).toBeNull();
    expect(change(doc, { op: 'moveList', list: 'l9', to: 0 })).toBeNull();
  });

  it('changes nothing for an op this version does not know', () => {
    const doc = docOf([ref(1)], [list('l1', [1])]);
    expect(change(doc, { op: 'clear', list: 'l1', key: key(1) } as unknown as FavouriteChange)).toBeNull();
    expect(change(doc, { op: 'clear', list: 'l1' } as unknown as FavouriteChange)).toBeNull();
  });

  it('reads the stored lists through their checks', () => {
    const doc = { ...docOf([ref(1)]), favouriteLists: [{ id: 'l1', name: null, keys: [key(1), key(1), 5] }, 'junk'] } as unknown as ProfileDoc;
    expect(change(doc, { op: 'add', list: 'l1', item: item(2) })!.favouriteLists).toEqual([list('l1', [1, 2])]);
  });
});

describe('favourite-edits: the groups', () => {
  const news: GroupRef = { src: 's1', name: 'News' };
  const sport: GroupRef = { src: 's1', name: 'Sport' };
  const group = (doc: unknown, c: GroupChange): ReturnType<typeof applyGroupChange> => applyGroupChange(doc, c);

  it('hides a group at the end of the hidden ones, once', () => {
    expect(group(emptyProfile(), { op: 'hide', group: news })).toEqual({ hiddenGroups: [news] });
    expect(group({ hiddenGroups: [news] }, { op: 'hide', group: { ...sport, extra: 1 } as GroupRef })).toEqual({ hiddenGroups: [news, sport] });
    expect(group({ hiddenGroups: [news] }, { op: 'hide', group: { src: 's1', name: 'News' } })).toBeNull();
    expect(group({}, { op: 'hide', group: { src: '', name: 'News' } })).toBeNull();
    const many = Array.from({ length: MAX_GROUP_REFS }, (_, i) => ({ src: 's1', name: `g${i}` }));
    expect(group({ hiddenGroups: many }, { op: 'hide', group: news })).toBeNull();
    expect(group({ hiddenGroups: many.slice(1) }, { op: 'hide', group: news })).toEqual({ hiddenGroups: many.slice(1).concat([news]) });
  });

  it('shows a hidden group again', () => {
    expect(group({ hiddenGroups: [news, sport] }, { op: 'show', group: { src: 's1', name: 'News' } })).toEqual({ hiddenGroups: [sport] });
    expect(group({ hiddenGroups: [news] }, { op: 'show', group: news })).toEqual({ hiddenGroups: [] });
    expect(group({ hiddenGroups: [news] }, { op: 'show', group: sport })).toBeNull();
    expect(group({ hiddenGroups: [news] }, { op: 'show', group: null as unknown as GroupRef })).toBeNull();
  });

  it('keeps the order given, checked and capped; the same order, or none for none, changes nothing', () => {
    expect(group({}, { op: 'order', groups: [sport, news, null as unknown as GroupRef, sport] })).toEqual({ groupOrder: [sport, news] });
    expect(group({ groupOrder: [sport, news] }, { op: 'order', groups: [{ src: 's1', name: 'Sport' }, news] })).toBeNull();
    expect(group({ groupOrder: [sport, news] }, { op: 'order', groups: [news, sport] })).toEqual({ groupOrder: [news, sport] });
    expect(group({ groupOrder: [sport, news] }, { op: 'order', groups: [sport] })).toEqual({ groupOrder: [sport] });
    expect(group({ groupOrder: [sport] }, { op: 'order', groups: [sport, news] })).toEqual({ groupOrder: [sport, news] });
    expect(group({ groupOrder: [sport, news] }, { op: 'order', groups: [] })).toEqual({ groupOrder: [] });
    expect(group({}, { op: 'order', groups: [] })).toBeNull();
    expect(group({}, { op: 'order', groups: 'News' as unknown as GroupRef[] })).toBeNull();
    expect(group({ groupOrder: [sport] }, { op: 'order', groups: 'News' as unknown as GroupRef[] })).toBeNull();
    const many = Array.from({ length: MAX_GROUP_REFS + 1 }, (_, i) => ({ src: 's1', name: `g${i}` }));
    expect(group({}, { op: 'order', groups: many })).toEqual({ groupOrder: many.slice(0, MAX_GROUP_REFS) });
  });

  it('changes nothing for an op this version does not know', () => {
    expect(group({}, { op: 'lock', group: news } as unknown as GroupChange)).toBeNull();
  });
});

describe('favourite-edits: a refresh re-matched or dropped favourites', () => {
  it('replaces a re-matched key in its place in every list, and takes a dropped one out', () => {
    const lists = [list('l1', [1, 2, 3]), list('l2', [3, 1]), list('l3', [7])];
    const doc = { favouriteLists: lists };
    const next = relinkLists(doc, [{ from: key(1), to: key(11) }], [key(3)])!;
    expect(next).toEqual([list('l1', [11, 2]), list('l2', [11]), list('l3', [7])]);
    expect(relinkLists(doc, [{ from: key(2), to: key(12) }, { from: key(3), to: key(13) }], [])).toEqual([list('l1', [1, 12, 13]), list('l2', [13, 1]), list('l3', [7])]);
    expect(relinkLists(doc, [], [key(1), key(2)])).toEqual([list('l1', [3]), list('l2', [3]), list('l3', [7])]);
  });

  it('is null when no list holds those keys, or there are no lists', () => {
    expect(relinkLists({ favouriteLists: [list('l1', [1])] }, [{ from: key(5), to: key(15) }], [key(6)])).toBeNull();
    expect(relinkLists(emptyProfile(), [{ from: key(1), to: key(11) }], [key(2)])).toBeNull();
    expect(relinkLists({ favouriteLists: [list('l1', [1])] }, [], [])).toBeNull();
  });

  it('keeps a key once in a list that held the new one already', () => {
    expect(relinkLists({ favouriteLists: [list('l1', [1, 11, 2])] }, [{ from: key(1), to: key(11) }], [])).toEqual([list('l1', [11, 2])]);
  });
});

describe('applyProfileEdit: the favourite and group edits (step 35a)', () => {
  it('writes the pool and the lists; the last list removed takes the field away', () => {
    const doc = docOf([]);
    const one = applyProfileEdit(doc, { kind: 'favourite', change: { op: 'newList', id: 'l1', name: null, item: item(1) } })!;
    expect(one.favourites).toEqual([ref(1)]);
    expect(one.favouriteLists).toEqual([list('l1', [1])]);
    expect(doc).toEqual(docOf([]));
    const none = applyProfileEdit(one, { kind: 'favourite', change: { op: 'removeList', list: 'l1' } })!;
    expect(none.favourites).toEqual([]);
    expect('favouriteLists' in none).toBe(false);
    expect(applyProfileEdit(one, { kind: 'favourite', change: { op: 'removeList', list: 'l9' } })).toBeNull();
    expect(favouriteKeysOf(one)).toEqual([key(1)]);
  });

  it('writes the hidden groups and the order; none left takes each field away', () => {
    const news = { src: 's1', name: 'News' };
    const hidden = applyProfileEdit(emptyProfile(), { kind: 'group', change: { op: 'hide', group: news } })!;
    expect(hidden.hiddenGroups).toEqual([news]);
    expect('groupOrder' in hidden).toBe(false);
    const shown = applyProfileEdit(hidden, { kind: 'group', change: { op: 'show', group: news } })!;
    expect('hiddenGroups' in shown).toBe(false);
    const ordered = applyProfileEdit(hidden, { kind: 'group', change: { op: 'order', groups: [news] } })!;
    expect(ordered.groupOrder).toEqual([news]);
    expect(ordered.hiddenGroups).toEqual([news]);
    const unordered = applyProfileEdit(ordered, { kind: 'group', change: { op: 'order', groups: [] } })!;
    expect('groupOrder' in unordered).toBe(false);
    expect(unordered.hiddenGroups).toEqual([news]);
    expect(applyProfileEdit(emptyProfile(), { kind: 'group', change: { op: 'show', group: news } })).toBeNull();
  });

  it("reads favourites' keys from any document, skipping entries without one", () => {
    expect(favouriteKeysOf({ favourites: [ref(1), null, { key: '' }, { key: 4 }, { name: 'x' }, ref(2)] })).toEqual([key(1), key(2)]);
    for (const doc of [null, 3, {}, { favourites: 'x' }]) expect(favouriteKeysOf(doc)).toEqual([]);
  });
});
