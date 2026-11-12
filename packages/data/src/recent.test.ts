import type { CatalogItem } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import type { RecentItem } from './recent';
import { RECENT_KINDS, RECENT_MAX, RecentList, mergeRecent } from './recent';

function film(src: string, n: number): CatalogItem {
  return {
    key: `x:${src}:movie:${n}`,
    src,
    kind: 'movie',
    name: `Film ${src} ${n}`,
    normName: `film ${src} ${n}`,
    group: 'Films',
    url: `http://panel.test/movie/u/p/${n}.mp4`,
    logo: n % 2 === 0 ? `http://img.test/${n}.jpg` : null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

/** The films a list keeps, as `src n@added`. */
const names = (list: readonly RecentItem[]): string[] => list.map((r) => `${r.item.src} ${r.item.key.slice(r.item.key.lastIndexOf(':') + 1)}@${r.added}`);

describe('RecentList (RELAY step 26e)', () => {
  it('keeps the newest 100 movies, newest first', () => {
    expect(RECENT_MAX).toBe(100);
    expect(RECENT_KINDS).toEqual(['movie']);
    const list = new RecentList();
    // 250 films, their dates out of order: film n was added at 1000 + (n * 37) % 250 (each date once).
    for (let n = 0; n < 250; n += 1) list.push(film('a', n), 1000 + ((n * 37) % 250));
    const kept = list.list();
    expect(kept).toHaveLength(100);
    expect(kept.map((r) => r.added)).toEqual(Array.from({ length: 100 }, (_v, i) => 1249 - i));
    // Each film with its own date.
    for (const r of kept) expect(1000 + ((Number(r.item.key.split(':')[3]) * 37) % 250)).toBe(r.added);
  });

  it('keeps the order equal dates came in, and a full list takes only a strictly newer one', () => {
    const list = new RecentList(3);
    list.push(film('a', 1), 50);
    list.push(film('a', 2), 50);
    list.push(film('a', 3), 60);
    list.push(film('a', 4), 50);
    expect(names(list.list())).toEqual(['a 3@60', 'a 1@50', 'a 2@50']);
    // Full: an equal date to the oldest kept came later, so it stays out; a newer one pushes the oldest out.
    list.push(film('a', 5), 50);
    expect(names(list.list())).toEqual(['a 3@60', 'a 1@50', 'a 2@50']);
    list.push(film('a', 6), 51);
    expect(names(list.list())).toEqual(['a 3@60', 'a 6@51', 'a 1@50']);
    list.push(film('a', 7), 60);
    expect(names(list.list())).toEqual(['a 3@60', 'a 7@60', 'a 6@51']);
    list.push(film('a', 8), 99);
    expect(names(list.list())).toEqual(['a 8@99', 'a 3@60', 'a 7@60']);
  });

  it('leaves out a movie with no date, or none after 1970', () => {
    const list = new RecentList();
    list.push(film('a', 1), null);
    list.push(film('a', 2), 0);
    list.push(film('a', 3), -5);
    list.push(film('a', 4), Number.NaN);
    list.push(film('a', 5), 1);
    expect(names(list.list())).toEqual(['a 5@1']);
    // A list of none keeps nothing.
    const none = new RecentList(0);
    none.push(film('a', 1), 10);
    expect(none.list()).toEqual([]);
  });

  it('keeps its own copies of the items, equal to them, and gives a copy of its list', () => {
    const list = new RecentList();
    const item = film('a', 2);
    const odd: CatalogItem = { ...film('a', 3), epgId: 'e', tvgName: 't', matchName: 'm', chno: 7, catchup: { mode: 'xc', days: 3, source: 's' }, radio: true, hints: { userAgent: 'u', referrer: null } };
    list.push(item, 10);
    list.push(odd, 5);
    const kept = list.list();
    expect(kept[0]!.item).toEqual(item);
    expect(kept[0]!.item).not.toBe(item);
    expect(kept[1]!.item).toEqual(odd);
    expect(kept[1]!.item.catchup).not.toBe(odd.catchup);
    expect(kept[1]!.item.hints).not.toBe(odd.hints);
    kept.pop();
    expect(list.list()).toHaveLength(2);
  });
});

describe('mergeRecent (RELAY step 26e)', () => {
  const at = (src: string, ...dates: number[]): RecentItem[] => dates.map((added, n) => ({ added, item: film(src, n) }));

  it('gives the newest across the lists, newest first, up to the limit', () => {
    const a = at('a', 90, 70, 50, 10);
    const b = at('b', 80, 60);
    const c = at('c', 95, 5);
    expect(names(mergeRecent([a, b, c], 100))).toEqual(['c 0@95', 'a 0@90', 'b 0@80', 'a 1@70', 'b 1@60', 'a 2@50', 'a 3@10', 'c 1@5']);
    expect(names(mergeRecent([a, b, c], 3))).toEqual(['c 0@95', 'a 0@90', 'b 0@80']);
    expect(mergeRecent([a, b, c], 0)).toEqual([]);
  });

  it('puts the list given first first on an equal date, each list in its own order', () => {
    const a = at('a', 50, 50, 40);
    const b = at('b', 60, 50, 50);
    expect(names(mergeRecent([a, b], 10))).toEqual(['b 0@60', 'a 0@50', 'a 1@50', 'b 1@50', 'b 2@50', 'a 2@40']);
    expect(names(mergeRecent([b, a], 10))).toEqual(['b 0@60', 'b 1@50', 'b 2@50', 'a 0@50', 'a 1@50', 'a 2@40']);
  });

  it('takes any date a list holds, 0 and below included', () => {
    expect(names(mergeRecent([at('a', 0, -5), at('b', -1)], 10))).toEqual(['a 0@0', 'b 0@-1', 'a 1@-5']);
  });

  it('skips a missing or empty list', () => {
    expect(names(mergeRecent([null, at('b', 3), [], null], 10))).toEqual(['b 0@3']);
    expect(mergeRecent([], 10)).toEqual([]);
    expect(mergeRecent([null], 10)).toEqual([]);
  });
});
