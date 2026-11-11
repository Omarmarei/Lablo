import type { CatalogItem } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import type { CatalogView } from './favourites';
import { FavouriteMatcher, MISSING_KEEP_MS, reconcileFavourites } from './favourites';
import type { FavouriteRef } from './profile';
import { item } from './test-support';

const NOW = Date.UTC(2026, 10, 2, 12);

const withEpg = (i: CatalogItem, epgId: string | null): CatalogItem => ({ ...i, epgId });
const fav = (i: CatalogItem, extra: Partial<FavouriteRef> = {}): FavouriteRef => ({
  key: i.key,
  src: i.src,
  kind: i.kind,
  normName: i.normName,
  group: i.group,
  epgId: i.epgId,
  added: 1,
  missingSince: null,
  ...extra,
});

/** The new catalog as the ingest sees it: the matcher fed with every item. */
function catalog(favourites: FavouriteRef[], items: CatalogItem[], src = 'tv'): CatalogView {
  const m = new FavouriteMatcher(src, favourites);
  for (const i of items) m.see(i);
  return { has: (f) => m.saw(f.key) ?? false, byName: (k, n) => m.byName(k, n), byEpgId: (k, e) => m.byEpgId(k, e) };
}

const reconcile = (favourites: FavouriteRef[], items: CatalogItem[], now = NOW, kinds?: ('live' | 'movie' | 'series')[]) =>
  reconcileFavourites(favourites, 'tv', catalog(favourites, items), now, kinds);

describe('reconcileFavourites', () => {
  it('re-matches a renumbered Xtream stream by name, in its old group', () => {
    const old = item('tv', 'live', 101, 'Lablo News', 'News');
    const f = fav(old);
    // The same channel listed in two groups, both renumbered.
    const { favourites, report } = reconcile([f], [item('tv', 'live', 1101, 'Lablo News', 'News'), item('tv', 'live', 1102, 'Lablo News', 'Kids')]);
    expect(favourites).toEqual([{ ...f, key: 'x:tv:live:1101', group: 'News' }]);
    expect(report).toMatchObject({ changed: true, rematched: [{ from: 'x:tv:live:101', to: 'x:tv:live:1101' }], missing: [] });
  });

  it('prefers the candidate with the same tvg-id', () => {
    const f = fav(withEpg(item('tv', 'live', 1, 'Sport', 'A'), 'Sport.UK'));
    const { report } = reconcile([f], [withEpg(item('tv', 'live', 9, 'Sport', 'B'), 'sport.ar'), withEpg(item('tv', 'live', 8, 'Sport', 'B'), 'sport.uk')]);
    expect(report.rematched).toEqual([{ from: 'x:tv:live:1', to: 'x:tv:live:8' }]);
  });

  it('never guesses between same-name items it cannot tell apart', () => {
    const f = fav(item('tv', 'live', 1, 'Sport', 'Old group'));
    const { favourites, report } = reconcile([f], [item('tv', 'live', 8, 'Sport', 'UK'), item('tv', 'live', 9, 'Sport', 'AR')]);
    expect(favourites).toEqual([{ ...f, missingSince: NOW }]);
    expect(report).toMatchObject({ rematched: [], missing: ['x:tv:live:1'] });
    // Without a recorded group either.
    const bare = { ...f, group: undefined };
    expect(reconcile([bare], [item('tv', 'live', 8, 'Sport', 'UK'), item('tv', 'live', 9, 'Sport', 'AR')]).report.rematched).toEqual([]);
  });

  it('falls back to the tvg-id when no item has the name (an M3U rename)', () => {
    const f = fav(withEpg(item('tv', 'live', 1, 'MBC 1', 'AR'), 'mbc1.ae'));
    expect(reconcile([f], [withEpg(item('tv', 'live', 2, 'MBC One', 'AR'), 'MBC1.ae')]).report.rematched).toEqual([{ from: 'x:tv:live:1', to: 'x:tv:live:2' }]);
    // HD and SD variants share the tvg-id: the group can't tell them apart either.
    const variants = [withEpg(item('tv', 'live', 2, 'MBC One HD', 'AR'), 'mbc1.ae'), withEpg(item('tv', 'live', 3, 'MBC One SD', 'AR'), 'mbc1.ae')];
    expect(reconcile([f], variants).report.rematched).toEqual([]);
    // ...but when only one is in the favourite's group, that one.
    variants[1] = { ...variants[1]!, group: 'Other' };
    expect(reconcile([f], variants).report.rematched).toEqual([{ from: 'x:tv:live:1', to: 'x:tv:live:2' }]);
  });

  it('only matches the same kind', () => {
    const f = fav(item('tv', 'movie', 1, 'Dune', 'Films'));
    expect(reconcile([f], [item('tv', 'series', 2, 'Dune', 'Films')]).report.rematched).toEqual([]);
  });

  it("doesn't merge two favourites into one key", () => {
    const a = fav(item('tv', 'live', 1, 'News', 'G'));
    const b = fav(item('tv', 'live', 2, 'News', 'G'));
    const { favourites, report } = reconcile([a, b], [item('tv', 'live', 10, 'News', 'G')]);
    expect(favourites.map((f) => f.key)).toEqual(['x:tv:live:10', 'x:tv:live:2']);
    expect(report).toMatchObject({ rematched: [{ from: 'x:tv:live:1', to: 'x:tv:live:10' }], missing: ['x:tv:live:2'] });
    // A free candidate can't be another favourite's present key.
    const c = fav(item('tv', 'live', 10, 'News', 'G'));
    expect(reconcile([a, c], [item('tv', 'live', 10, 'News', 'G')]).report).toMatchObject({ present: 1, rematched: [], missing: ['x:tv:live:1'] });
  });

  it('keeps a missing favourite for 30 days, restores it if it comes back, then drops it', () => {
    const i = item('tv', 'live', 5, 'Gone', 'G');
    const missing = fav(i, { missingSince: NOW - MISSING_KEEP_MS + 1 });
    expect(reconcile([missing], []).favourites).toEqual([missing]);
    expect(reconcile([missing], []).report.changed).toBe(false);
    expect(reconcile([missing], [], NOW + 1)).toMatchObject({ favourites: [], report: { changed: true, dropped: [i.key] } });
    expect(reconcile([missing], [i])).toMatchObject({ favourites: [{ ...missing, missingSince: null }], report: { restored: [i.key], present: 1 } });
  });

  it('leaves other sources, and kinds the refresh skipped, alone', () => {
    const other = { ...fav(item('radio', 'live', 1, 'X', 'G')) };
    const movie = fav(item('tv', 'movie', 2, 'Film', 'G'));
    const { favourites, report } = reconcile([other, movie], [item('tv', 'live', 3, 'Y', 'G')], NOW, ['live']);
    expect(favourites).toEqual([other, movie]);
    expect(report.changed).toBe(false);
  });
});

describe('FavouriteMatcher', () => {
  it("answers `saw` only for keys that were favourites when the refresh began", () => {
    const f = fav(item('tv', 'live', 1, 'A', 'G'));
    const m = new FavouriteMatcher('tv', [f, fav(item('other', 'live', 2, 'B', 'G'))]);
    m.see(item('tv', 'live', 1, 'A', 'G'));
    expect(m.saw('x:tv:live:1')).toBe(true);
    expect(m.saw('x:tv:live:3')).toBeUndefined();
    expect(m.saw('x:other:live:2')).toBeUndefined();
  });

  it('remembers at most 16 candidates per name', () => {
    const f = fav(item('tv', 'live', 1, 'Same', 'G'));
    const m = new FavouriteMatcher('tv', [f]);
    for (let i = 2; i < 40; i++) m.see(item('tv', 'live', i, 'Same', 'G'));
    expect(m.byName('live', f.normName)).toHaveLength(16);
    expect(m.byName('movie', f.normName)).toHaveLength(0);
  });
});
