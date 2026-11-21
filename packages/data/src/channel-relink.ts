/**
 * The changed channels' side of a refresh's re-match (RELAY step 36a), the ingest worker's: the
 * refs a refresh tracks, and the entries re-keyed after it, each key once (an entry whose key is a
 * favourite's follows the favourite).
 */

import type { ContentKey, ContentKind } from '@lablo/core';
import { changed } from './channel-changes';
import type { ChannelEdit } from './channel-edits';
import { channelEditsOf } from './channel-edits';
import type { CatalogView, FavouriteReport } from './favourites';
import { reconcileFavourites } from './favourites';
import type { FavouriteRef } from './profile';

/**
 * The refs a refresh of `src` tracks (`FavouriteMatcher`): the favourites, then each changed
 * channel no favourite has (step 36a: re-matched once per key).
 */
export function trackedRefs(favourites: readonly FavouriteRef[], edits: readonly ChannelEdit[]): FavouriteRef[] {
  const out: FavouriteRef[] = favourites.slice();
  for (let i = 0; i < edits.length; i += 1) if (!favourites.some((f) => f.key === edits[i]!.key)) out.push(edits[i]!);
  return out;
}

/**
 * The changed channels after a refresh of `src` (step 36a), given the favourites before it
 * (`before`) and their re-match (`report`, `after`: `reconcileFavourites`'s). An entry whose key
 * is a favourite's follows the favourite: re-keyed with it, missing or back with it, dropped with
 * it. The others are re-matched as favourites are, never to a key another entry has or takes.
 * `null` when no entry changes.
 */
export function relinkChannelEdits(
  doc: unknown,
  before: readonly FavouriteRef[],
  report: FavouriteReport,
  after: readonly FavouriteRef[],
  src: string,
  catalog: CatalogView,
  now: number,
  kinds?: readonly ContentKind[],
): ChannelEdit[] | null {
  const edits = channelEditsOf(doc);
  const own: ChannelEdit[] = [];
  /** Each entry's result: a favourite's follows it (`null`: dropped); the others' (`undefined` here) come from their own re-match. */
  const results: (ChannelEdit | null | undefined)[] = [];
  const taken = new Set<ContentKey>();
  for (const edit of edits) {
    taken.add(edit.key);
    if (!before.some((f) => f.key === edit.key)) {
      own.push(edit);
      results.push(undefined);
      continue;
    }
    let key = edit.key;
    for (const r of report.rematched) if (r.from === edit.key) key = r.to;
    // (A dropped favourite is not in `after`, and no other was re-matched to its key: it was taken.)
    const fav = after.find((f) => f.key === key);
    if (fav === undefined) {
      results.push(null);
      continue;
    }
    taken.add(fav.key);
    if (fav.key === edit.key && fav.missingSince === edit.missingSince && fav.group === edit.group && fav.epgId === edit.epgId) {
      results.push(edit);
      continue;
    }
    // (An entry read through `channelEditsOf` has a change, so `changed` makes a copy.)
    const moved = changed(edit, {})!;
    moved.key = fav.key;
    moved.missingSince = fav.missingSince;
    if (fav.group !== undefined) moved.group = fav.group;
    if (fav.epgId !== undefined) moved.epgId = fav.epgId;
    results.push(moved);
  }
  const mine = reconcileFavourites(own, src, catalog, now, kinds, taken).outcomes;
  const out: ChannelEdit[] = [];
  let changes = 0;
  let o = 0;
  for (let i = 0; i < edits.length; i += 1) {
    const result = (results[i] === undefined ? mine[o++] : results[i]) as ChannelEdit | null;
    if (result !== edits[i]) changes += 1;
    if (result !== null) out.push(result);
  }
  return changes === 0 ? null : out;
}
