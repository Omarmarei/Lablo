/**
 * Favourites lists and the live groups' order and hiding (RELAY step 35a, architecture.md §1.3).
 *
 * - The profile's `favourites` is the pool: each favourite item once, with what re-matching needs
 *   (favourites.ts, step 8).
 * - `favouriteLists` says which list holds which items, each list in its own order. Every key in a
 *   list is in the pool, and an edit drops a pool item that no list holds any more
 *   (favourite-edits.ts). Optional: a document without it has no lists.
 * - `hiddenGroups` and `groupOrder` name a source's live categories by their names (a category's
 *   index changes when the provider adds one before it; its name rarely does).
 *
 * Main reads these through `@lablo/data/client`, so this module imports nothing and uses nothing
 * Babel would polyfill in main.js (no `trim`, `sort`, regex `test`, `for…of`): the edits, which
 * need more, are the workers' (favourite-edits.ts).
 */

import type { ContentKey } from '@lablo/core';

/** A favourites list: its items' keys in the user's order, each in the pool (`favourites`). */
export type FavouriteList = {
  /** Picked by the app when it makes the list (never one the lists have). */
  id: string;
  /** `null`: the catalog's "Favourites", in the UI's language. */
  name: string | null;
  keys: ContentKey[];
};

/** A source's live category by its name (`''`: the playlist gave none), as `LastChannel.category` keeps it. */
export type GroupRef = { src: string; name: string };

/** The most lists a profile keeps. */
export const MAX_FAVOURITE_LISTS = 20;
/** The most items one list holds. */
export const MAX_LIST_ITEMS = 300;
/** The most favourite items in the pool, every list's together. */
export const MAX_FAVOURITES = 1000;
/** A list's name: at most this many UTF-16 code units, after trimming. */
export const LIST_NAME_MAX = 40;
/** A list's id: at most this many characters. */
export const LIST_ID_MAX = 32;
/** The most hidden groups, and the most groups an order names (the rest keep the provider's order). */
export const MAX_GROUP_REFS = 1000;

/** `doc[name]`, or `undefined` for a document that isn't an object. */
function field(doc: unknown, name: string): unknown {
  return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>)[name] : undefined;
}

/** A list id this version keeps: 1 to `LIST_ID_MAX` characters. */
export function isListId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LIST_ID_MAX;
}

/** A stored list name: 1 to `LIST_NAME_MAX` characters (an edit trims it first). */
export function isListName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LIST_NAME_MAX;
}

/**
 * The favourites lists of a profile document of any version (`favouriteLists`), in its order:
 * entries that aren't lists left out, a repeated id's later list left out, a key that isn't a
 * string or is repeated in its list left out; at most `MAX_FAVOURITE_LISTS` lists of
 * `MAX_LIST_ITEMS` keys. A document without them (written before step 35a) has none.
 */
export function favouriteListsOf(doc: unknown): FavouriteList[] {
  const stored = field(doc, 'favouriteLists');
  const out: FavouriteList[] = [];
  if (!Array.isArray(stored)) return out;
  for (let i = 0; i < stored.length && out.length < MAX_FAVOURITE_LISTS; i += 1) {
    const list = stored[i] as unknown;
    if (typeof list !== 'object' || list === null) continue;
    const { id, name, keys } = list as Record<string, unknown>;
    if (!isListId(id) || (name !== null && !isListName(name)) || !Array.isArray(keys)) continue;
    if (out.some((l) => l.id === id)) continue;
    const kept: ContentKey[] = [];
    for (let k = 0; k < keys.length && kept.length < MAX_LIST_ITEMS; k += 1) {
      const key = keys[k] as unknown;
      if (typeof key === 'string' && key !== '' && kept.indexOf(key) === -1) kept.push(key);
    }
    out.push({ id, name, keys: kept });
  }
  return out;
}

const SEP = String.fromCharCode(1);

/** A group's identity as one string (sources' ids never hold U+0001). */
export function groupId(group: GroupRef): string {
  return group.src + SEP + group.name;
}

/** `doc[name]` as groups: entries that aren't groups, and repeats, left out; at most `MAX_GROUP_REFS`. */
function groupsOf(doc: unknown, name: string): GroupRef[] {
  const stored = field(doc, name);
  const out: GroupRef[] = [];
  if (!Array.isArray(stored)) return out;
  const seen: Record<string, true> = {};
  for (let i = 0; i < stored.length && out.length < MAX_GROUP_REFS; i += 1) {
    const group = stored[i] as unknown;
    if (!isGroupRef(group)) continue;
    // (It starts with the source's id, which is never empty: no name an object inherits.)
    const id = groupId(group);
    if (seen[id] === true) continue;
    seen[id] = true;
    out.push({ src: group.src, name: group.name });
  }
  return out;
}

/** A group this version keeps: a source's id and a category name (`''` is one). */
export function isGroupRef(value: unknown): value is GroupRef {
  if (typeof value !== 'object' || value === null) return false;
  const { src, name } = value as Record<string, unknown>;
  return typeof src === 'string' && src !== '' && typeof name === 'string';
}

/** The live groups the user hid (`hiddenGroups`), as `groupsOf` reads them; none in an older document. */
export function hiddenGroupsOf(doc: unknown): GroupRef[] {
  return groupsOf(doc, 'hiddenGroups');
}

/** The live groups in the user's order (`groupOrder`), as `groupsOf` reads them; none in an older document. */
export function groupOrderOf(doc: unknown): GroupRef[] {
  return groupsOf(doc, 'groupOrder');
}
