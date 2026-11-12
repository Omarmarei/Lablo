/**
 * "Recently added" (RELAY step 26e): each source's newest movies, kept at ingest so that no read
 * ever scans a catalog (a panel can list 120,000 movies).
 *
 * - **The ingest** pushes every movie with its panel's date (Xtream `added`, epoch seconds) into a
 *   `RecentList`, which keeps the `RECENT_MAX` newest, newest first. The list is stored with the
 *   kind's categories (`putCatalogKind`), in the same generation, so a refresh swaps it with the
 *   catalog and deletes it with the old generation.
 * - **A playlist's movies have no date**, so an M3U source keeps none (its list is empty). Decided
 *   in step 26e: a "first refresh that saw it" date would give every movie of a source's first
 *   refresh the same date, so the list would be the playlist's own order, not the newest.
 * - **The query worker** (`QueryService.recent`) reads the lists of the sources asked and merges
 *   them (`mergeRecent`): the newest first, at most `RECENT_MAX`. The newest of every source
 *   together are among each source's own newest, so one list per source is enough.
 * - **Equal dates** (a panel that imported many movies at once) keep a stable order: the order
 *   the panel listed them in, then the order the sources were asked in. Nothing relies on
 *   `Array.prototype.sort` being stable (it isn't on Chromium 53-68's V8).
 */

import type { CatalogItem, ContentKind } from '@lablo/core';

/** The newest items kept per source and kind, and the most one query gives. */
export const RECENT_MAX = 100;

/** The kinds that keep their newest at ingest (series may join in step 27). */
export const RECENT_KINDS: readonly ContentKind[] = ['movie'];

/** An item and the date its panel added it. */
export interface RecentItem {
  /** Epoch seconds (Xtream `added`). */
  added: number;
  item: CatalogItem;
}

/**
 * A copy of `s` that keeps no larger string alive. An item's strings can be slices of the text
 * chunk it was parsed from, and V8 keeps the whole chunk alive while a slice lives: an item kept
 * for the whole ingest would pin its chunk (as core's `ownString` explains for the guides).
 */
const own = (s: string): string => (' ' + s).slice(1);
const ownOrNull = (s: string | null): string | null => (s === null ? null : own(s));

function ownItem(item: CatalogItem): CatalogItem {
  return {
    key: own(item.key),
    src: own(item.src),
    kind: item.kind,
    name: own(item.name),
    normName: own(item.normName),
    group: own(item.group),
    url: own(item.url),
    logo: ownOrNull(item.logo),
    epgId: ownOrNull(item.epgId),
    tvgName: ownOrNull(item.tvgName),
    matchName: ownOrNull(item.matchName),
    chno: item.chno,
    tvgShift: item.tvgShift,
    catchup: item.catchup === null ? null : { mode: ownOrNull(item.catchup.mode), days: item.catchup.days, source: ownOrNull(item.catchup.source) },
    radio: item.radio,
    hints: item.hints === null ? null : { userAgent: ownOrNull(item.hints.userAgent), referrer: ownOrNull(item.hints.referrer) },
  };
}

/** Keeps the `max` newest items pushed, newest first; items with equal dates keep the order they came in. */
export class RecentList {
  private readonly items: RecentItem[] = [];

  constructor(private readonly max = RECENT_MAX) {}

  /** Offers an item with its date (`null`, or not a date after 1970: it has none, and is left out). */
  push(item: CatalogItem, added: number | null): void {
    if (added === null || !(added > 0)) return;
    const list = this.items;
    const last = list[list.length - 1];
    // Full: only a newer item than the oldest kept gets in (an equal one came later). Without this
    // the item would be copied, put last and dropped again: the same list, for more work.
    if (list.length >= this.max && (last === undefined || added <= last.added)) return;
    // After every item of its date or newer: equal dates stay in the order they came.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.added >= added) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, { added, item: ownItem(item) });
    if (list.length > this.max) list.pop();
  }

  /** The items kept, newest first. */
  list(): RecentItem[] {
    return this.items.slice();
  }
}

/**
 * The `limit` newest items of several sources' lists (each newest first, as stored), newest first.
 * Equal dates: the list given first, then each list's own order. A missing list adds nothing.
 */
export function mergeRecent(lists: readonly (readonly RecentItem[] | null)[], limit: number): RecentItem[] {
  const out: RecentItem[] = [];
  const at: number[] = [];
  for (let i = 0; i < lists.length; i += 1) at.push(0);
  while (out.length < limit) {
    let best = -1;
    let bestAdded = -Infinity;
    for (let i = 0; i < lists.length; i += 1) {
      const head = lists[i]?.[at[i]!];
      // (Strictly newer: on an equal date the list given first keeps its turn.)
      if (head !== undefined && head.added > bestAdded) {
        best = i;
        bestAdded = head.added;
      }
    }
    if (best === -1) break;
    out.push(lists[best]![at[best]!]!);
    at[best] = at[best]! + 1;
  }
  return out;
}
