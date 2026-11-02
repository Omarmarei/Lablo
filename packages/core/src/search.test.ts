import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ContentKind } from './model';
import { normalizeName } from './normalize';
import type { FavouriteMarks, SearchHit, SearchMatch, SearchSegmentData } from './search';
import {
  SEARCH_LIMIT,
  SEARCH_SEPARATOR,
  SearchIndexBuilder,
  SearchIndexError,
  SearchSegment,
  buildSearchSegment,
  favouriteMarks,
  searchSegments,
  searchTerms,
} from './search';

interface Named {
  key: string;
  normName: string;
}

const named = (src: string, names: string[]): Named[] => names.map((name, i) => ({ key: `x:${src}:k:${i}`, normName: normalizeName(name) }));
const segment = (src: string, kind: ContentKind, names: string[], gen = 1): SearchSegment =>
  new SearchSegment(buildSearchSegment(src, kind, named(src, names), gen));
const brief = (hits: SearchHit[], segs: SearchSegment[]): string[] =>
  hits.map((h) => `${h.kind}:${segs.find((s) => s.src === h.src && s.kind === h.kind)!.nameAt(h.index)}:${h.match}${h.favourite ? ':fav' : ''}`);

describe('search segments', () => {
  it('lays names out between separators, with offsets, a key map and a chunk table', () => {
    const b = new SearchIndexBuilder('tv', 'movie', 3);
    b.beginChunk(4, 0);
    b.add('x:tv:movie:1', 'alpha');
    b.add('x:tv:movie:2', '');
    b.beginChunk(9, 9); // empty chunk: replaced by the next one
    b.beginChunk(4, 1);
    b.add('x:tv:movie:3', 'beta gamma');
    const data = b.finish();
    const sep = SEARCH_SEPARATOR;
    expect(data.text).toBe(`${sep}alpha${sep}${sep}beta gamma${sep}`);
    expect([...data.starts]).toEqual([1, 7, 8, data.text.length]);
    expect([...data.chunkStarts]).toEqual([0, 2, 3]);
    expect([...data.chunkCats]).toEqual([4, 4]);
    expect([...data.chunkNos]).toEqual([0, 1]);
    const seg = new SearchSegment(data);
    expect([0, 1, 2].map((i) => seg.nameAt(i))).toEqual(['alpha', '', 'beta gamma']);
    expect(seg.chunkOf(1)).toEqual({ catIdx: 4, chunk: 0, slot: 1 });
    expect(seg.chunkOf(2)).toEqual({ catIdx: 4, chunk: 1, slot: 0 });
    expect(['x:tv:movie:3', 'x:tv:movie:1', 'x:tv:movie:2', 'x:tv:movie:4'].map((k) => seg.indexOfKey(k))).toEqual([2, 0, 1, -1]);
    expect(seg.gen).toBe(3);
  });

  it('keeps a separator inside a name from splitting it', () => {
    const seg = segment('tv', 'live', []);
    expect(seg.count).toBe(0);
    const data = buildSearchSegment('tv', 'live', [{ key: 'x:tv:live:1', normName: `a${SEARCH_SEPARATOR}b` }]);
    expect(new SearchSegment(data).nameAt(0)).toBe('a b');
  });

  it('survives a structured clone (IndexedDB, postMessage) and rejects other layouts', () => {
    const data = buildSearchSegment('tv', 'live', named('tv', ['One', 'Two']));
    const copy = structuredClone(data);
    expect(copy.starts).toBeInstanceOf(Uint32Array);
    expect(brief(searchSegments([new SearchSegment(copy)], 'tw').hits, [new SearchSegment(copy)])).toEqual(['live:two:start']);
    expect(() => new SearchSegment({ ...data, v: 2 })).toThrow(SearchIndexError);
    expect(() => new SearchSegment({ ...data, count: 3 })).toThrow(SearchIndexError);
    expect(() => new SearchSegment({ ...data, text: data.text.slice(1) })).toThrow(/Inconsistent/);
    expect(() => new SearchSegment({ ...data, chunkStarts: new Uint32Array([0, 1]) })).toThrow(/Inconsistent/);
  });
});

describe('searchSegments ranking', () => {
  const live = segment('a', 'live', ['MBC Drama HD', 'Sky News', 'News', 'Newsroom 24', 'Renews TV', 'AR: الجزيرة الإخبارية', 'قناة الأخبار']);
  const movies = segment('a', 'movie', ['News of the World', 'Bignews Show', 'Golden News']);
  const series = segment('a', 'series', ['News Hour S01E01']);
  const segs = [series, movies, live];

  it('puts word-prefix matches first, then live before movies before series, then exact, start, word', () => {
    expect(brief(searchSegments(segs, 'NEWS').hits, segs)).toEqual([
      'live:news:exact',
      'live:newsroom 24:start',
      'live:sky news:word',
      'movie:news of the world:start',
      'movie:golden news:word',
      'series:news hour s01e01:start',
      'live:renews tv:substring',
      'movie:bignews show:substring',
    ]);
    expect(searchSegments(segs, 'news').total).toBe(8);
  });

  it('boosts favourites within their match class', () => {
    const favs = favouriteMarks(segs, ['x:a:k:3', 'x:a:k:1', 'x:b:k:0', 'nonsense']);
    expect(favs[0]).toBeNull();
    expect([...favs[1]!]).toEqual([1]);
    expect([...favs[2]!]).toEqual([3, 1]);
    // A favourite that only matches inside a word stays behind every word match.
    expect(brief(searchSegments(segs, 'news', { favourites: favs }).hits, segs)).toEqual([
      'live:newsroom 24:start:fav',
      'live:sky news:word:fav',
      'live:news:exact',
      'movie:news of the world:start',
      'movie:golden news:word',
      'series:news hour s01e01:start',
      'movie:bignews show:substring:fav',
      'live:renews tv:substring',
    ]);
  });

  it('folds Arabic and Latin the way names were folded, and ANDs query words in any order', () => {
    expect(brief(searchSegments(segs, 'الاخبار').hits, segs)).toEqual(['live:ar الجزيره الاخباريه:word', 'live:قناه الاخبار:word']);
    expect(brief(searchSegments(segs, 'أخبار').hits, segs)).toEqual(['live:ar الجزيره الاخباريه:substring', 'live:قناه الاخبار:substring']);
    expect(brief(searchSegments(segs, 'الجزيرة').hits, segs)).toEqual(['live:ar الجزيره الاخباريه:word']);
    expect(brief(searchSegments(segs, 'drama mbc').hits, segs)).toEqual(['live:mbc drama hd:word']);
    expect(brief(searchSegments(segs, 'mbc drama').hits, segs)).toEqual(['live:mbc drama hd:start']);
    expect(brief(searchSegments(segs, 'mbc dram hd').hits, segs)).toEqual(['live:mbc drama hd:word']);
    expect(brief(searchSegments(segs, 'mbc rama').hits, segs)).toEqual(['live:mbc drama hd:substring']);
    expect(searchSegments(segs, 'mbc news').hits).toEqual([]);
  });

  it('returns nothing for a query with nothing searchable', () => {
    for (const q of ['', '   ', '!!', String.fromCharCode(1), '-']) expect(searchSegments(segs, q)).toEqual({ query: '', hits: [], total: 0 });
  });

  it('filters kinds, caps results and reports where each hit is stored', () => {
    expect(brief(searchSegments(segs, 'news', { kinds: ['movie'] }).hits, segs)).toEqual([
      'movie:news of the world:start',
      'movie:golden news:word',
      'movie:bignews show:substring',
    ]);
    const capped = searchSegments(segs, 'news', { limit: 2 });
    expect(capped.hits).toHaveLength(2);
    expect(capped.total).toBe(8);
    expect(searchSegments(segs, 'news', { limit: Number.NaN }).hits).toHaveLength(8);
    expect(capped.hits[0]).toEqual({ src: 'a', kind: 'live', gen: 1, index: 2, catIdx: 0, chunk: 0, slot: 2, match: 'exact', favourite: false });
  });

  it('caps at 200 by default and keeps catalog order within a class', () => {
    const names = Array.from({ length: 1000 }, (_, i) => `Channel ${i}`);
    const seg = segment('big', 'live', names);
    const result = searchSegments([seg], 'chan');
    expect(result.total).toBe(1000);
    expect(result.hits).toHaveLength(SEARCH_LIMIT);
    expect(result.hits.map((h) => h.index)).toEqual(Array.from({ length: SEARCH_LIMIT }, (_, i) => i));
  });

  it('splits query words on spaces, distinct and longest first', () => {
    expect(searchTerms('ab c ab abc')).toEqual(['abc', 'ab', 'c']);
    expect(searchTerms('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Oracle: the same ranking computed naively, name by name.

const KIND_RANK: Record<ContentKind, number> = { live: 0, movie: 1, series: 2 };
const FINE: Record<SearchMatch, number> = { exact: 0, start: 1, word: 2, substring: 0 };

function naiveSearch(segs: SearchSegment[], names: string[][], query: string, favs: FavouriteMarks, limit: number): { hits: string[]; total: number } {
  const phrase = normalizeName(query);
  const terms = phrase.split(' ').filter((t) => t);
  if (!terms.length) return { hits: [], total: 0 };
  const found: { rank: number; order: number; text: string }[] = [];
  segs.forEach((seg, s) => {
    names[s]!.forEach((name, i) => {
      const words = name.split(' ');
      const inWord = (t: string): boolean => words.some((w) => w.startsWith(t));
      if (!terms.every((t) => name.includes(t))) return;
      const wordMatch = terms.every(inWord);
      const match: SearchMatch = !wordMatch ? 'substring' : name === phrase ? 'exact' : name.startsWith(phrase) ? 'start' : 'word';
      const fav = favs[s]?.has(i) ?? false;
      const rank = (((wordMatch ? 0 : 1) * 2 + (fav ? 0 : 1)) * 3 + KIND_RANK[seg.kind]) * 3 + FINE[match];
      found.push({ rank, order: found.length, text: `${s}:${i}:${match}:${fav}` });
    });
  });
  found.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return { hits: found.slice(0, limit).map((f) => f.text), total: found.length };
}

describe('searchSegments against a naive oracle', () => {
  // Few letters, so random queries hit often, with word boundaries, Arabic, digits and accents.
  const letter = fc.constantFrom('a', 'b', 'c', 'ab', 'ba', ' ', ' ', 'ا', 'أ', 'ة', 'ه', '1', '١', 'É', 'e', '-');
  const name = fc.array(letter, { maxLength: 12 }).map((parts) => parts.join(''));
  const kind = fc.constantFrom<ContentKind>('live', 'movie', 'series');
  const segmentSpec = fc.record({ kind, names: fc.array(name, { maxLength: 25 }), chunk: fc.integer({ min: 1, max: 7 }) });
  const query = fc.array(letter, { maxLength: 5 }).map((parts) => parts.join(''));

  it('returns the same hits in the same order, for any names, query, favourites and limit', () => {
    fc.assert(
      fc.property(fc.array(segmentSpec, { maxLength: 4 }), query, fc.integer({ min: 1, max: 30 }), fc.integer({ min: 0, max: 2 ** 30 }), (specs, q, limit, favSeed) => {
        const segs: SearchSegment[] = [];
        const norm: string[][] = [];
        const favKeys: string[] = [];
        specs.forEach((spec, s) => {
          const src = `s${s}`;
          const b = new SearchIndexBuilder(src, spec.kind);
          spec.names.forEach((raw, i) => {
            if (i % spec.chunk === 0) b.beginChunk(s, i / spec.chunk);
            const key = `x:${src}:${spec.kind}:${i}`;
            b.add(key, normalizeName(raw));
            if ((favSeed >> ((s * 7 + i) % 30)) & 1) favKeys.push(key);
          });
          segs.push(new SearchSegment(b.finish()));
          norm.push(spec.names.map(normalizeName));
        });
        const favs = favouriteMarks(segs, favKeys);
        const got = searchSegments(segs, q, { limit, favourites: favs });
        const want = naiveSearch(segs, norm, q, favs, limit);
        expect(got.total).toBe(want.total);
        expect(got.hits.map((h) => `${segs.findIndex((x) => x.src === h.src)}:${h.index}:${h.match}:${h.favourite}`)).toEqual(want.hits);
        for (const h of got.hits) {
          const spec = specs[Number(h.src.slice(1))]!;
          expect(h).toMatchObject({ catIdx: Number(h.src.slice(1)), chunk: Math.floor(h.index / spec.chunk), slot: h.index % spec.chunk });
        }
      }),
      { numRuns: 400 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Scale: 200k generated items (the fixture-sized catalog; the real 200k fixture runs in
// tools/fixtures/test/search-scale.media.test.ts). Done-when for RELAY step 7: ≤ 200 ms a query.

const WORDS = [
  ['Last', 'Night', 'City', 'Shadow', 'River', 'Golden', 'Silent', 'Broken', 'Hidden', 'Summer', 'Storm', 'Island', 'Secret', 'Kingdom', 'Heart', 'Fire'],
  ['الليل', 'المدينة', 'الظل', 'النهر', 'الذهبي', 'الصامت', 'الخفي', 'الصيف', 'الشتاء', 'العاصفة', 'الجزيرة', 'السر', 'المملكة', 'القلب', 'النار', 'الأخير'],
  ['Nuit', 'Ville', 'Ombre', 'Rivière', 'Doré', 'Été', 'Hiver', 'Tempête', 'Île', 'Royaume', 'Cœur', 'Feu'],
  ['Noche', 'Ciudad', 'Sombra', 'Río', 'Dorado', 'Verano', 'Invierno', 'Tormenta', 'Isla', 'Reino', 'Corazón', 'Fuego'],
];

function generated(count: number, kind: ContentKind, seed: number): SearchSegmentData {
  let state = seed;
  const next = (n: number): number => {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    return ((state >>> 8) & 0xffffff) % n;
  };
  const b = new SearchIndexBuilder('big', kind);
  for (let i = 0; i < count; i++) {
    if (i % 500 === 0) b.beginChunk(i % 37, i / 500);
    const words = WORDS[next(4)]!;
    const parts: string[] = [];
    const n = 1 + next(4);
    for (let w = 0; w < n; w++) parts.push(words[next(words.length)]!);
    if (kind === 'live') parts.push(String(next(500)), ['HD', 'FHD', '4K', ''][next(4)]!);
    b.add(`x:big:${kind}:${i}`, normalizeName(parts.join(' ')));
  }
  return b.finish();
}

function bestOf(runs: number, fn: () => void): number {
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

describe('search at 200k items', () => {
  it('answers typical queries in ≤ 200 ms each', () => {
    const segs = [generated(20_000, 'live', 1), generated(120_000, 'movie', 2), generated(60_000, 'series', 3)].map((d) => new SearchSegment(d));
    expect(segs.reduce((n, s) => n + s.count, 0)).toBe(200_000);
    const favs = favouriteMarks(segs, Array.from({ length: 500 }, (_, i) => `x:big:movie:${i * 97}`));
    const times: Record<string, number> = {};
    for (const q of ['a', 'e', 'ال', 'ni', 'st', 'sto', 'golden', 'الجزيرة', 'cœur', 'storm 4', 'river night', 'zzz', 'ri']) {
      let result = searchSegments(segs, q, { favourites: favs });
      times[q] = bestOf(3, () => {
        result = searchSegments(segs, q, { favourites: favs });
      });
      expect(result.hits.length).toBeLessThanOrEqual(SEARCH_LIMIT);
      if (q !== 'zzz') expect(result.total).toBeGreaterThan(0);
    }
    const slowest = Math.max(...Object.values(times));
    expect(slowest, JSON.stringify(times)).toBeLessThanOrEqual(200);
  }, 60_000);
});
