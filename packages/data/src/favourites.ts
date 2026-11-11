/**
 * Favourites across refreshes (architecture.md §1.4 step 10, ADR-009). Favourites reference
 * ContentKeys, which survive most refreshes. A key can still disappear:
 * - an Xtream panel renumbers its streams (`x:<src>:<kind>:<id>` changes with the id);
 * - an M3U channel that has a tvg-id is renamed (its key hashes tvg-id plus name);
 * - the provider drops the item.
 *
 * After each committed refresh, every favourite of that source is checked against the new
 * generation. A missing one is re-matched when the new catalog has exactly one plausible
 * successor, otherwise it is kept as unavailable (`missingSince`) and dropped after 30 days.
 *
 * Re-matching never guesses: a key that disappears is better than one that silently points at
 * another channel (ADR-009). The candidates, in this order:
 * 1. the same kind and normalized name; several are narrowed by the tvg-id, then by the group
 *    the favourite was in (a channel listed in two groups, an HD and SD variant);
 * 2. if no item has that name: the same kind and tvg-id (an M3U rename), narrowed by group.
 * Keys already used by another favourite never count, so two favourites can't merge.
 */

import type { CatalogItem, ContentKey, ContentKind } from '@lablo/core';
import type { FavouriteRef } from './profile';

/** How long an unavailable favourite is kept before it is dropped. */
export const MISSING_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** Candidates remembered per name or tvg-id (more than this is hopelessly ambiguous anyway). */
const MAX_CANDIDATES = 16;

/** An item of the new generation that could be a favourite's successor. */
export interface Candidate {
  key: ContentKey;
  group: string;
  epgId: string | null;
}

export interface FavouriteReport {
  src: string;
  /** The profile changed (and was saved). */
  changed: boolean;
  /** Favourites of this source found under their key. */
  present: number;
  rematched: { from: ContentKey; to: ContentKey }[];
  /** Missing since this refresh. */
  missing: ContentKey[];
  /** Missing for 30 days or more: removed from the profile. */
  dropped: ContentKey[];
  /** Were missing, now found under their key again. */
  restored: ContentKey[];
}

/** The new generation as reconciliation sees it. */
export interface CatalogView {
  /** Is the favourite's key in the new generation? */
  has(fav: FavouriteRef): boolean;
  byName(kind: ContentKind, normName: string): readonly Candidate[];
  byEpgId(kind: ContentKind, epgId: string): readonly Candidate[];
}

const SEP = String.fromCharCode(1);
const nameId = (kind: ContentKind, normName: string): string => `${kind}${SEP}${normName}`;
const epgIdOf = (kind: ContentKind, epgId: string): string => `${kind}${SEP}${epgId.toLowerCase()}`;

/**
 * Watches the items of one refresh as they stream past, remembering what reconciliation will
 * need for the favourites known when the refresh began: whether their keys appeared, and the
 * items sharing their names or tvg-ids. Memory stays proportional to the favourites.
 */
export class FavouriteMatcher {
  private readonly tracked = new Set<ContentKey>();
  private readonly seen = new Set<ContentKey>();
  private readonly names = new Map<string, Candidate[]>();
  private readonly epgIds = new Map<string, Candidate[]>();

  constructor(
    readonly src: string,
    favourites: readonly FavouriteRef[],
  ) {
    for (const f of favourites) {
      if (f.src !== src) continue;
      this.tracked.add(f.key);
      if (!this.names.has(nameId(f.kind, f.normName))) this.names.set(nameId(f.kind, f.normName), []);
      if (f.epgId && !this.epgIds.has(epgIdOf(f.kind, f.epgId))) this.epgIds.set(epgIdOf(f.kind, f.epgId), []);
    }
  }

  see(item: CatalogItem): void {
    if (this.tracked.size === 0) return;
    if (this.tracked.has(item.key)) this.seen.add(item.key);
    const candidate = (): Candidate => ({ key: item.key, group: item.group, epgId: item.epgId });
    const byName = this.names.get(nameId(item.kind, item.normName));
    if (byName && byName.length < MAX_CANDIDATES) byName.push(candidate());
    if (item.epgId) {
      const byEpg = this.epgIds.get(epgIdOf(item.kind, item.epgId));
      if (byEpg && byEpg.length < MAX_CANDIDATES) byEpg.push(candidate());
    }
  }

  /** Whether `key` appeared; `undefined` when it wasn't a favourite when the refresh began. */
  saw(key: ContentKey): boolean | undefined {
    return this.tracked.has(key) ? this.seen.has(key) : undefined;
  }

  byName(kind: ContentKind, normName: string): readonly Candidate[] {
    return this.names.get(nameId(kind, normName)) ?? [];
  }

  byEpgId(kind: ContentKind, epgId: string): readonly Candidate[] {
    return this.epgIds.get(epgIdOf(kind, epgId)) ?? [];
  }
}

/** Narrows `list` by `keep` when that leaves at least one. */
function narrow(list: Candidate[], keep: (c: Candidate) => boolean): Candidate[] {
  const kept = list.filter(keep);
  return kept.length > 0 ? kept : list;
}

/** The one plausible successor of a missing favourite, or `null`. */
function successor(fav: FavouriteRef, catalog: CatalogView, taken: ReadonlySet<ContentKey>): Candidate | null {
  const free = (list: readonly Candidate[]): Candidate[] => list.filter((c) => !taken.has(c.key));
  let list = free(catalog.byName(fav.kind, fav.normName));
  if (list.length > 0) {
    const epgId = fav.epgId?.toLowerCase();
    if (epgId) list = narrow(list, (c) => c.epgId !== null && c.epgId.toLowerCase() === epgId);
    if (fav.group !== undefined) list = narrow(list, (c) => c.group === fav.group);
    return list.length === 1 ? list[0]! : null;
  }
  if (!fav.epgId) return null;
  list = free(catalog.byEpgId(fav.kind, fav.epgId));
  if (list.length > 1 && fav.group !== undefined) list = list.filter((c) => c.group === fav.group);
  return list.length === 1 ? list[0]! : null;
}

/**
 * Brings the favourites of `src` up to date with a new generation. Pure: returns a new list
 * (the same objects where nothing changed) in the same order. Other sources, and kinds the
 * refresh didn't load (`kinds`), are untouched.
 */
export function reconcileFavourites(
  favourites: readonly FavouriteRef[],
  src: string,
  catalog: CatalogView,
  now: number,
  kinds?: readonly ContentKind[],
): { favourites: FavouriteRef[]; report: FavouriteReport } {
  const report: FavouriteReport = { src, changed: false, present: 0, rematched: [], missing: [], dropped: [], restored: [] };
  const taken = new Set(favourites.map((f) => f.key));
  const out: FavouriteRef[] = [];
  for (const fav of favourites) {
    if (fav.src !== src || (kinds && kinds.indexOf(fav.kind) === -1)) {
      out.push(fav);
      continue;
    }
    if (catalog.has(fav)) {
      report.present++;
      if (fav.missingSince === null) {
        out.push(fav);
      } else {
        report.restored.push(fav.key);
        out.push({ ...fav, missingSince: null });
      }
      continue;
    }
    const next = successor(fav, catalog, taken);
    if (next) {
      taken.add(next.key);
      report.rematched.push({ from: fav.key, to: next.key });
      out.push({ ...fav, key: next.key, missingSince: null, group: next.group, epgId: next.epgId });
      continue;
    }
    const since = fav.missingSince ?? now;
    if (now - since >= MISSING_KEEP_MS) {
      report.dropped.push(fav.key);
      continue;
    }
    if (fav.missingSince === null) report.missing.push(fav.key);
    out.push(fav.missingSince === null ? { ...fav, missingSince: since } : fav);
  }
  report.changed = report.rematched.length + report.missing.length + report.dropped.length + report.restored.length > 0;
  return { favourites: out, report };
}
