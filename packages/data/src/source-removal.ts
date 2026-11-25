/**
 * Removing a source from the profile (RELAY step 40f, architecture.md §3.3): everything that names
 * the source's id goes with it, so a source added later starts fresh (Omar's decision, 2026-11-25:
 * its channels leave the favourites lists and the locks; the confirm says how many favourites go).
 *
 * Where a source's id is stored in the profile document:
 *   - `sources` (the record), `guides` (the guide a source's onboarding typed has the source's id)
 *   - `favourites` (`src`), `favouriteLists[].keys` (ContentKeys), `hiddenGroups` / `groupOrder` (`src`)
 *   - `channelEdits` (`src`), `parental.groups` (`src`)
 *   - `player`: `last` and `channels` (the item's key), `containers` / `redirects` (by id), `tracks` (keys)
 *   - `progress` and `shows` (keys; a show's last episode's key too)
 *   - `epgOffsets` (`<src>:xmltv`, `<src>:tvg<n>` and the typed guide's `u~<src>`), `epgOverrides` (the
 *     channel's key, and a pin into one of the source's guides)
 *
 * The catalog (items, categories, matches) is the ingest worker's `removeSource`
 * (`deleteSource`); the source's own guides are deleted by the next EPG refresh, which lists none
 * of them. Pure; it runs in the query worker and, for the count, in main (`@lablo/data/client`):
 * so it imports nothing and keeps to the TV's subset (no `for…of`, no regex, no `split`).
 */

import type { ParentalDoc } from './parental';
import type { ProfileDoc } from './profile';

/** The source id a ContentKey names (`x:<src>:…`, `m:<src>:…`); `null` for a key that isn't one. */
export function keySource(key: string): string | null {
  if (key.charAt(1) !== ':' || (key.charAt(0) !== 'x' && key.charAt(0) !== 'm')) return null;
  const end = key.indexOf(':', 2);
  return end === -1 ? null : key.slice(2, end);
}

/** Whether `key` belongs to source `src`. */
function ofSource(key: string, src: string): boolean {
  return keySource(key) === src;
}

/** `record` without the entries whose key `drop` names, or `null` when none is (nothing is copied then). */
function withoutKeys<T>(record: Record<string, T> | undefined, drop: (key: string) => boolean): Record<string, T> | null {
  if (record === undefined) return null;
  let next: Record<string, T> | null = null;
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    if (!drop(keys[i]!)) continue;
    if (next === null) {
      next = {};
      for (let k = 0; k < keys.length; k += 1) next[keys[k]!] = record[keys[k]!]!;
    }
    delete next[keys[i]!];
  }
  return next;
}

/** `list` without the entries `drop` names, or `null` when none is. */
function without<T>(list: readonly T[] | undefined, drop: (entry: T) => boolean): T[] | null {
  if (list === undefined) return null;
  let next: T[] | null = null;
  for (let i = 0; i < list.length; i += 1) {
    if (!drop(list[i]!)) {
      if (next !== null) next.push(list[i]!);
    } else if (next === null) next = list.slice(0, i);
  }
  return next;
}

/** How many favourite items of source `src` the profile holds (the pool: each item once, whatever lists hold it). */
export function sourceFavouriteCount(doc: Pick<ProfileDoc, 'favourites'> | null, src: string): number {
  if (doc === null) return 0;
  let count = 0;
  for (let i = 0; i < doc.favourites.length; i += 1) if (doc.favourites[i]!.src === src) count += 1;
  return count;
}

/**
 * `doc` without source `src` and everything that names it (a new object), or `null` when the
 * profile has no record of it: a source never in the profile changes nothing.
 */
export function removeSourceFromProfile(doc: ProfileDoc, src: string): ProfileDoc | null {
  const at = doc.sources.findIndex((s) => s.id === src);
  if (at === -1) return null;
  const next: ProfileDoc = { ...doc, sources: doc.sources.filter((s) => s.id !== src) };
  const guideSrc = 'u~' + src;
  const ownGuide = (epgSrc: string): boolean => epgSrc === guideSrc || epgSrc.indexOf(src + ':') === 0;

  // The guide the source's onboarding typed has the source's id; the guides the user added have their own.
  const guides = without(doc.guides, (g) => g.id === src);
  if (guides !== null) next.guides = guides;
  const favourites = without(doc.favourites, (f) => f.src === src);
  if (favourites !== null) next.favourites = favourites;
  const progress = withoutKeys(doc.progress, (k) => ofSource(k, src));
  if (progress !== null) next.progress = progress;
  const shows = withoutKeys(doc.shows, (k) => ofSource(k, src));
  if (shows !== null) next.shows = shows;
  const channels = without(doc.channels, (c) => ofSource(c.item.key, src));
  if (channels !== null) next.channels = channels;

  const player = { ...doc.player };
  if (player.last !== null && ofSource(player.last.item.key, src)) player.last = null;
  const containers = withoutKeys(doc.player.containers, (k) => k === src);
  if (containers !== null) player.containers = containers;
  const redirects = withoutKeys(doc.player.redirects, (k) => k === src);
  if (redirects !== null) player.redirects = redirects;
  const tracks = withoutKeys(doc.player.tracks, (k) => ofSource(k, src));
  if (tracks !== null) player.tracks = tracks;
  next.player = player;

  const offsets = withoutKeys(doc.epgOffsets, ownGuide);
  if (offsets !== null) {
    if (Object.keys(offsets).length > 0) next.epgOffsets = offsets;
    else delete next.epgOffsets;
  }
  const overrides = withoutKeys(doc.epgOverrides, (k) => ofSource(k, src) || ownGuide(doc.epgOverrides![k]!.epgSrc));
  if (overrides !== null) {
    if (Object.keys(overrides).length > 0) next.epgOverrides = overrides;
    else delete next.epgOverrides;
  }

  if (doc.favouriteLists !== undefined) {
    const lists = doc.favouriteLists.map((list) => ({ id: list.id, name: list.name, keys: list.keys.filter((k) => !ofSource(k, src)) }));
    next.favouriteLists = lists;
  }
  const hidden = without(doc.hiddenGroups, (g) => g.src === src);
  if (hidden !== null) {
    if (hidden.length > 0) next.hiddenGroups = hidden;
    else delete next.hiddenGroups;
  }
  const order = without(doc.groupOrder, (g) => g.src === src);
  if (order !== null) {
    if (order.length > 0) next.groupOrder = order;
    else delete next.groupOrder;
  }
  const edits = without(doc.channelEdits, (e) => e.src === src);
  if (edits !== null) {
    if (edits.length > 0) next.channelEdits = edits;
    else delete next.channelEdits;
  }
  const parental = doc.parental;
  if (parental !== undefined && parental.groups !== undefined) {
    const groups = without(parental.groups, (g) => g.src === src);
    if (groups !== null) {
      const kept: ParentalDoc = { ...parental, groups };
      if (groups.length === 0) delete kept.groups;
      // (A document of nothing but its empty field is no document: the field goes.)
      if (Object.keys(kept).length > 0) next.parental = kept;
      else delete next.parental;
    }
  }
  return next;
}
