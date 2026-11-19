/**
 * The favourites lists' and the live groups' edits (RELAY step 35a), applied by the query worker
 * (`applyProfileEdit`), and the lists' side of a refresh's re-match (the ingest worker). Pure: each
 * returns the changed parts as new objects, or `null` when the edit changes nothing (one past a
 * cap, or naming nothing, too). The stored parts are read through favourite-lists.ts's checks, so
 * a malformed one is read as the app would show it.
 *
 * The rules (favourite-lists.ts): every key in a list is in the pool (`favourites`), and a pool
 * item that no list holds any more leaves it. A pool item no list ever held (a profile from before
 * step 35a) stays until an edit touches its key.
 */

import type { ContentKey, ContentKind } from '@lablo/core';
import type { FavouriteList, GroupRef } from './favourite-lists';
import {
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
} from './favourite-lists';
import type { FavouriteRef } from './profile';

/** A favourite as the app gives it: the catalog item's facts re-matching needs, and when it was added. */
export type FavouriteItem = Omit<FavouriteRef, 'missingSince'>;

/** A change to the favourites lists (step 35a). */
export type FavouriteChange =
  /** Adds `item` at list `list`'s end (the pool gets its ref when it has none). */
  | { op: 'add'; list: string; item: FavouriteItem }
  /** Takes `key` out of list `list` (and out of the pool when no other list holds it). */
  | { op: 'remove'; list: string; key: ContentKey }
  /** Moves `key` to place `to` in list `list` (clamped to it). */
  | { op: 'move'; list: string; key: ContentKey; to: number }
  /** A new list at the end, named `name` (`null`: "Favourites"), holding `item` when one is given. */
  | { op: 'newList'; id: string; name: string | null; item?: FavouriteItem }
  /** Names list `list` (`null`: "Favourites" again). */
  | { op: 'rename'; list: string; name: string | null }
  /** Removes list `list` (its items no other list holds leave the pool). */
  | { op: 'removeList'; list: string }
  /** Moves list `list` to place `to` among the lists (clamped). */
  | { op: 'moveList'; list: string; to: number };

/** A change to the live groups (step 35a). */
export type GroupChange =
  | { op: 'hide'; group: GroupRef }
  | { op: 'show'; group: GroupRef }
  /**
   * The groups in the user's order, as the rail shows them after a move: repeats left out, at
   * most `MAX_GROUP_REFS` kept (the rest keep the provider's order after them); `[]` takes the
   * order away.
   */
  | { op: 'order'; groups: GroupRef[] };

/** The favourites part of a profile document. */
export type FavouritesPart = { favourites: FavouriteRef[]; favouriteLists: FavouriteList[] };

const KINDS: readonly ContentKind[] = ['live', 'movie', 'series'];

/** An item the app may add: a key, its source, kind and normalized name, and an add time. */
export function isFavouriteItem(value: unknown): value is FavouriteItem {
  if (typeof value !== 'object' || value === null) return false;
  const { key, src, kind, normName, group, epgId, added } = value as Record<string, unknown>;
  return (
    typeof key === 'string' &&
    key !== '' &&
    typeof src === 'string' &&
    src !== '' &&
    KINDS.indexOf(kind as ContentKind) !== -1 &&
    typeof normName === 'string' &&
    (group === undefined || typeof group === 'string') &&
    (epgId === undefined || epgId === null || typeof epgId === 'string') &&
    typeof added === 'number' &&
    isFinite(added)
  );
}

/** `name` trimmed when it is a list name then (1 to `LIST_NAME_MAX`), `null` for no name, else `undefined`. */
function listName(name: unknown): string | null | undefined {
  if (name === null) return null;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= LIST_NAME_MAX ? trimmed : undefined;
}

/** `list` with its entry at `from` moved to place `to` (clamped), or `null` when it stays. */
function moved<T>(list: readonly T[], from: number, to: unknown): T[] | null {
  if (typeof to !== 'number' || to !== to) return null;
  const next = list.slice();
  const entry = next.splice(from, 1)[0]!;
  const at = Math.max(0, Math.min(next.length, Math.floor(to)));
  if (at === from) return null;
  next.splice(at, 0, entry);
  return next;
}

/** A new ref for `item`, present now. Its fields one by one: the app's object may carry more. */
function refOf(item: FavouriteItem): FavouriteRef {
  const ref: FavouriteRef = { key: item.key, src: item.src, kind: item.kind, normName: item.normName, added: item.added, missingSince: null };
  if (item.group !== undefined) ref.group = item.group;
  if (item.epgId !== undefined) ref.epgId = item.epgId;
  return ref;
}

/** `pool` with `item`'s ref added when it has none (`null` past `MAX_FAVOURITES`). */
function withItem(pool: readonly FavouriteRef[], item: FavouriteItem): FavouriteRef[] | null {
  if (pool.some((f) => f.key === item.key)) return pool.slice();
  if (pool.length >= MAX_FAVOURITES) return null;
  return pool.concat([refOf(item)]);
}

/** `pool` without the refs of `keys` that no list of `lists` holds. */
function prunedPool(pool: readonly FavouriteRef[], lists: readonly FavouriteList[], keys: readonly ContentKey[]): FavouriteRef[] {
  const held = (key: ContentKey): boolean => lists.some((l) => l.keys.indexOf(key) !== -1);
  return pool.filter((f) => keys.indexOf(f.key) === -1 || held(f.key));
}

/**
 * The pool and the lists with `change` applied (new arrays), or `null` when it changes nothing.
 * `doc` is a stored profile document; `favourites` is its pool.
 */
export function applyFavouriteChange(doc: unknown, favourites: readonly FavouriteRef[], change: FavouriteChange): FavouritesPart | null {
  const lists = favouriteListsOf(doc);
  if (change.op === 'newList') {
    if (!isListId(change.id) || lists.length >= MAX_FAVOURITE_LISTS || lists.some((l) => l.id === change.id)) return null;
    const name = listName(change.name);
    if (name === undefined) return null;
    if (change.item === undefined) return { favourites: favourites.slice(), favouriteLists: lists.concat([{ id: change.id, name, keys: [] }]) };
    if (!isFavouriteItem(change.item)) return null;
    const pool = withItem(favourites, change.item);
    return pool === null ? null : { favourites: pool, favouriteLists: lists.concat([{ id: change.id, name, keys: [change.item.key] }]) };
  }
  let at = -1;
  for (let i = 0; i < lists.length; i += 1) if (lists[i]!.id === change.list) at = i;
  if (at === -1) return null;
  const list = lists[at]!;
  const next = lists.slice();
  if (change.op === 'rename') {
    const name = listName(change.name);
    if (name === undefined || name === list.name) return null;
    next[at] = { id: list.id, name, keys: list.keys };
    return { favourites: favourites.slice(), favouriteLists: next };
  }
  if (change.op === 'removeList') {
    next.splice(at, 1);
    return { favourites: prunedPool(favourites, next, list.keys), favouriteLists: next };
  }
  if (change.op === 'moveList') {
    const order = moved(lists, at, change.to);
    return order === null ? null : { favourites: favourites.slice(), favouriteLists: order };
  }
  if (change.op === 'add') {
    if (!isFavouriteItem(change.item) || list.keys.indexOf(change.item.key) !== -1 || list.keys.length >= MAX_LIST_ITEMS) return null;
    const pool = withItem(favourites, change.item);
    if (pool === null) return null;
    next[at] = { id: list.id, name: list.name, keys: list.keys.concat([change.item.key]) };
    return { favourites: pool, favouriteLists: next };
  }
  const from = list.keys.indexOf(change.key);
  if (from === -1) return null;
  if (change.op === 'move') {
    const keys = moved(list.keys, from, change.to);
    if (keys === null) return null;
    next[at] = { id: list.id, name: list.name, keys };
    return { favourites: favourites.slice(), favouriteLists: next };
  }
  // (An op this version doesn't know changes nothing.)
  if (change.op !== 'remove') return null;
  const keys = list.keys.slice();
  keys.splice(from, 1);
  next[at] = { id: list.id, name: list.name, keys };
  return { favourites: prunedPool(favourites, next, [change.key]), favouriteLists: next };
}

/** The groups part of a profile document. */
export type GroupsPart = { hiddenGroups: GroupRef[] } | { groupOrder: GroupRef[] };

/**
 * The hidden groups or the order with `change` applied (a new array: `[]` means the field goes),
 * or `null` when it changes nothing.
 */
export function applyGroupChange(doc: unknown, change: GroupChange): GroupsPart | null {
  if (change.op === 'order') {
    if (!Array.isArray(change.groups)) return null;
    const order = groupOrderOf({ groupOrder: change.groups });
    const before = groupOrderOf(doc);
    if (order.length === before.length && order.every((g, i) => groupId(g) === groupId(before[i]!))) return null;
    return { groupOrder: order };
  }
  if (!isGroupRef(change.group)) return null;
  const hidden = hiddenGroupsOf(doc);
  const id = groupId(change.group);
  let at = -1;
  for (let i = 0; i < hidden.length; i += 1) if (groupId(hidden[i]!) === id) at = i;
  if (change.op === 'show') {
    if (at === -1) return null;
    const next = hidden.slice();
    next.splice(at, 1);
    return { hiddenGroups: next };
  }
  if (change.op !== 'hide' || at !== -1 || hidden.length >= MAX_GROUP_REFS) return null;
  return { hiddenGroups: hidden.concat([{ src: change.group.src, name: change.group.name }]) };
}

/**
 * The lists after a refresh's re-match (step 8's `reconcileFavourites`): a re-matched key replaced
 * in place in every list, a dropped one taken out of every list. `null` when no list changes (a
 * document without lists, or none holds those keys).
 */
export function relinkLists(doc: unknown, rematched: readonly { from: ContentKey; to: ContentKey }[], dropped: readonly ContentKey[]): FavouriteList[] | null {
  const lists = favouriteListsOf(doc);
  let changed = false;
  const next = lists.map((list) => {
    let keys: ContentKey[] | null = null;
    for (let i = 0; i < rematched.length; i += 1) {
      const { from, to } = rematched[i]!;
      const current: ContentKey[] = keys ?? list.keys;
      const at = current.indexOf(from);
      if (at === -1) continue;
      keys = current.slice();
      // A list that holds the new key already (only a malformed one can) keeps it once.
      if (keys.indexOf(to) === -1) keys[at] = to;
      else keys.splice(at, 1);
    }
    for (let i = 0; i < dropped.length; i += 1) {
      const current: ContentKey[] = keys ?? list.keys;
      const at = current.indexOf(dropped[i]!);
      if (at === -1) continue;
      keys = current.slice();
      keys.splice(at, 1);
    }
    if (keys === null) return list;
    changed = true;
    return { id: list.id, name: list.name, keys };
  });
  return changed ? next : null;
}
