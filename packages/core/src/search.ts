/**
 * Catalog search (architecture.md §1.4 steps 8 and 11): one index segment per source and kind,
 * built at ingest, stored in IndexedDB as typed arrays, and searched in the query worker.
 *
 * A segment holds:
 * - `text`: every item's `normName`, each preceded by a U+0001 separator, plus a final one
 *   (`·a·b·c·`). `normalizeName` never outputs U+0001 or other control characters, so a query
 *   term can't match across two names;
 * - `starts`: where each name begins in `text` (`count + 1` entries; the last is `text.length`);
 * - a key map as typed arrays: `hash53` of every ContentKey, sorted, with the item index of each
 *   (`keyHashes`, `keyOrder`). Lookups compare hashes only; a 53-bit collision inside one
 *   segment is about a one-in-a-million event for 200k items, and costs a favourite boost;
 * - the chunk table: items are numbered in the order the ingest wrote its 500-item chunks, so
 *   item `i` lives in the chunk whose range holds it (`chunkStarts`, `chunkCats`, `chunkNos`).
 *
 * Searching runs `indexOf` over `text`, finds the item with a binary search over `starts`, then
 * jumps to the next item, so each item is looked at once whatever the query. Ranking, best first:
 * 1. every query word starts a word of the name (`exact`, `start`, `word`), before names that
 *    only contain a query word inside a word (`substring`);
 * 2. favourites;
 * 3. live, then movies, then series;
 * 4. `exact` (the whole name), then `start` (the name begins with the query), then `word`;
 * 5. segment order (the caller's source order), then catalog order.
 * Results are capped (200 by default); `total` counts every match.
 *
 * Query words are ANDed: `mbc drama` finds `drama mbc 1`. The query goes through
 * `normalizeName`, the same folding the names went through (Arabic letter forms, diacritics,
 * Arabic-Indic digits, accents, case).
 *
 * ES2017 only (runs in the Chromium 53 query worker).
 */

import { hash53 } from './hash';
import type { ContentKey, ContentKind } from './model';
import { normalizeName } from './normalize';

/** Separator between names in a segment's text. */
export const SEARCH_SEPARATOR = String.fromCharCode(1);
/** Default and maximum number of results. */
export const SEARCH_LIMIT = 200;
export const SEARCH_LIMIT_MAX = 1000;
/** Layout version of `SearchSegmentData`; a stored segment with another version is rebuilt. */
export const SEARCH_INDEX_VERSION = 1;

const SEP = 1;
const SPACE = 32;

/** A catalog chunk (`[src, gen, kind, catIdx, chunk]` in IndexedDB, minus the first three). */
export interface ChunkRef {
  catIdx: number;
  chunk: number;
}

/** A segment as stored in IndexedDB and sent between workers (structured-clonable). */
export interface SearchSegmentData {
  v: number;
  src: string;
  kind: ContentKind;
  /** Generation of the catalog it indexes. */
  gen: number;
  count: number;
  text: string;
  /** `count + 1` offsets into `text`. */
  starts: Uint32Array;
  /** `hash53` of each item's key, ascending. */
  keyHashes: Float64Array;
  /** The item index of each `keyHashes` entry. */
  keyOrder: Uint32Array;
  /** First item index of each chunk, plus `count` at the end (`chunks + 1` entries). */
  chunkStarts: Uint32Array;
  chunkCats: Uint32Array;
  chunkNos: Uint32Array;
}

/** How a result matched, best first. */
export type SearchMatch = 'exact' | 'start' | 'word' | 'substring';

export interface SearchHit {
  src: string;
  kind: ContentKind;
  gen: number;
  /** Item index in its segment. */
  index: number;
  /** Where the item is stored. */
  catIdx: number;
  chunk: number;
  slot: number;
  match: SearchMatch;
  favourite: boolean;
}

export interface SearchResult {
  /** The normalized query that was run (`''` when nothing searchable was typed). */
  query: string;
  hits: SearchHit[];
  /** How many items matched in all (`hits` is capped at the limit). */
  total: number;
}

export interface SearchOptions {
  /** Maximum results (default `SEARCH_LIMIT`, at most `SEARCH_LIMIT_MAX`). */
  limit?: number;
  /** Only these kinds (default: all). */
  kinds?: readonly ContentKind[];
  /** Favourite item indexes per segment (from `favouriteMarks`), aligned with the segments. */
  favourites?: FavouriteMarks;
}

/** Per segment, the item indexes that are favourites (`null`: none). */
export type FavouriteMarks = ReadonlyArray<ReadonlySet<number> | null>;

/** Builds a segment from items in chunk order. */
export class SearchIndexBuilder {
  private readonly names: string[] = [];
  private readonly hashes: number[] = [];
  private readonly starts: number[] = [];
  private length = 1;
  private readonly chunkStarts: number[] = [];
  private readonly chunkCats: number[] = [];
  private readonly chunkNos: number[] = [];

  constructor(
    readonly src: string,
    readonly kind: ContentKind,
    readonly gen = 0,
  ) {}

  /** Number of items added so far. */
  get count(): number {
    return this.names.length;
  }

  /** Starts a chunk: the items added next are stored in `[…, catIdx, chunk]`. */
  beginChunk(catIdx: number, chunk: number): void {
    const n = this.names.length;
    const last = this.chunkStarts.length - 1;
    if (last >= 0 && this.chunkStarts[last] === n) {
      // The previous chunk got no items: replace it.
      this.chunkCats[last] = catIdx;
      this.chunkNos[last] = chunk;
      return;
    }
    this.chunkStarts.push(n);
    this.chunkCats.push(catIdx);
    this.chunkNos.push(chunk);
  }

  /** Adds the next item. `normName` should be `normalizeName` output. */
  add(key: ContentKey, normName: string): void {
    if (this.chunkStarts.length === 0) this.beginChunk(0, 0);
    // Defensive: a separator inside a name would split it in two.
    const name = normName.indexOf(SEARCH_SEPARATOR) === -1 ? normName : normName.split(SEARCH_SEPARATOR).join(' ');
    this.starts.push(this.length);
    this.names.push(name);
    this.hashes.push(hash53(key));
    this.length += name.length + 1;
  }

  finish(): SearchSegmentData {
    const n = this.names.length;
    const starts = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) starts[i] = this.starts[i]!;
    starts[n] = this.length;
    const order: number[] = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const hashes = this.hashes;
    order.sort((a, b) => hashes[a]! - hashes[b]! || a - b);
    const keyHashes = new Float64Array(n);
    const keyOrder = new Uint32Array(n);
    for (let j = 0; j < n; j++) {
      keyOrder[j] = order[j]!;
      keyHashes[j] = hashes[order[j]!]!;
    }
    const chunks = this.chunkStarts.length;
    const chunkStarts = new Uint32Array(chunks + 1);
    const chunkCats = new Uint32Array(chunks);
    const chunkNos = new Uint32Array(chunks);
    for (let c = 0; c < chunks; c++) {
      chunkStarts[c] = this.chunkStarts[c]!;
      chunkCats[c] = this.chunkCats[c]!;
      chunkNos[c] = this.chunkNos[c]!;
    }
    chunkStarts[chunks] = n;
    const text = n === 0 ? SEARCH_SEPARATOR : SEARCH_SEPARATOR + this.names.join(SEARCH_SEPARATOR) + SEARCH_SEPARATOR;
    return {
      v: SEARCH_INDEX_VERSION,
      src: this.src,
      kind: this.kind,
      gen: this.gen,
      count: n,
      text,
      starts,
      keyHashes,
      keyOrder,
      chunkStarts,
      chunkCats,
      chunkNos,
    };
  }
}

/** Builds a segment from `[key, normName]` pairs (one chunk). For tests and small sources. */
export function buildSearchSegment(src: string, kind: ContentKind, items: Iterable<{ key: ContentKey; normName: string }>, gen = 0): SearchSegmentData {
  const builder = new SearchIndexBuilder(src, kind, gen);
  for (const item of items) builder.add(item.key, item.normName);
  return builder.finish();
}

/** Thrown when stored segment data is from another layout version or inconsistent. */
export class SearchIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchIndexError';
  }
}

/** Index of the last entry of `arr[lo..hi)` that is `<= value` (`lo - 1` if none). */
function lastAtMost(arr: Uint32Array, value: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >>> 1;
    if (arr[mid]! <= value) a = mid + 1;
    else b = mid;
  }
  return a - 1;
}

/** A loaded segment: validates the data and answers lookups. */
export class SearchSegment {
  readonly src: string;
  readonly kind: ContentKind;
  readonly gen: number;
  readonly count: number;

  constructor(readonly data: SearchSegmentData) {
    const d = data;
    if (d.v !== SEARCH_INDEX_VERSION) throw new SearchIndexError(`Search index version ${d.v}, expected ${SEARCH_INDEX_VERSION}`);
    const n = d.count;
    const chunks = d.chunkCats.length;
    const consistent =
      typeof d.text === 'string' &&
      Number.isSafeInteger(n) &&
      n >= 0 &&
      d.starts.length === n + 1 &&
      d.starts[n] === d.text.length &&
      d.keyHashes.length === n &&
      d.keyOrder.length === n &&
      d.chunkNos.length === chunks &&
      d.chunkStarts.length === chunks + 1 &&
      d.chunkStarts[chunks] === n &&
      (n === 0 || (d.starts[0] === 1 && chunks > 0 && d.chunkStarts[0] === 0));
    if (!consistent) throw new SearchIndexError(`Inconsistent search index for ${d.src}/${d.kind}`);
    this.src = d.src;
    this.kind = d.kind;
    this.gen = d.gen;
    this.count = n;
  }

  /** The normalized name of item `i`. */
  nameAt(i: number): string {
    return this.data.text.slice(this.data.starts[i]!, this.data.starts[i + 1]! - 1);
  }

  /** Where item `i` is stored. */
  chunkOf(i: number): ChunkRef & { slot: number } {
    const d = this.data;
    const c = lastAtMost(d.chunkStarts, i, 0, d.chunkCats.length);
    return { catIdx: d.chunkCats[c]!, chunk: d.chunkNos[c]!, slot: i - d.chunkStarts[c]! };
  }

  /** The item index of `key`, or -1. Compares `hash53` values only (see the module comment). */
  indexOfKey(key: ContentKey): number {
    const hashes = this.data.keyHashes;
    const h = hash53(key);
    let a = 0;
    let b = hashes.length;
    while (a < b) {
      const mid = (a + b) >>> 1;
      if (hashes[mid]! < h) a = mid + 1;
      else b = mid;
    }
    return a < hashes.length && hashes[a] === h ? this.data.keyOrder[a]! : -1;
  }
}

/** The source id inside a ContentKey (`x:<src>:…`, `m:<src>:…`), or `''`. */
function keySource(key: string): string {
  const a = key.indexOf(':');
  const b = a === -1 ? -1 : key.indexOf(':', a + 1);
  return b === -1 ? '' : key.slice(a + 1, b);
}

/** Resolves favourite keys to item indexes, per segment. */
export function favouriteMarks(segments: readonly SearchSegment[], keys: Iterable<ContentKey>): FavouriteMarks {
  const marks: (Set<number> | null)[] = segments.map(() => null);
  for (const key of keys) {
    const src = keySource(key);
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]!;
      if (seg.src !== src) continue;
      const i = seg.indexOfKey(key);
      if (i === -1) continue;
      let set = marks[s];
      if (!set) marks[s] = set = new Set<number>();
      set.add(i);
    }
  }
  return marks;
}

const KIND_RANK: Record<ContentKind, number> = { live: 0, movie: 1, series: 2 };
const FINE: SearchMatch[] = ['exact', 'start', 'word'];
/** Ranking classes: (word or substring) x (favourite or not) x kind x (exact, start, word). */
const CLASSES = 2 * 2 * 3 * 3;

/** The words of a normalized query: distinct, longest first (the longest is scanned for). */
export function searchTerms(normQuery: string): string[] {
  const seen: string[] = [];
  for (const t of normQuery.split(' ')) if (t && seen.indexOf(t) === -1) seen.push(t);
  return seen.sort((a, b) => b.length - a.length);
}

/** Whether `term` occurs in `name` at the start of a word: 2, inside a word only: 1, not: 0. */
function termIn(name: string, term: string): number {
  let i = name.indexOf(term);
  if (i === -1) return 0;
  while (i !== -1) {
    if (i === 0 || name.charCodeAt(i - 1) === SPACE) return 2;
    i = name.indexOf(term, i + 1);
  }
  return 1;
}

/** Searches `segments` (in the caller's source order) for `query` (raw user text). */
export function searchSegments(segments: readonly SearchSegment[], query: string, options: SearchOptions = {}): SearchResult {
  const phrase = normalizeName(query);
  const terms = searchTerms(phrase);
  const want = options.limit;
  const limit = want !== undefined && want >= 1 ? Math.min(SEARCH_LIMIT_MAX, Math.floor(want)) : SEARCH_LIMIT;
  if (terms.length === 0) return { query: phrase, hits: [], total: 0 };
  const kinds = options.kinds;
  // Each bucket holds (segment, item) pairs in scan order, capped at `limit` pairs.
  const buckets: number[][] = [];
  for (let c = 0; c < CLASSES; c++) buckets.push([]);
  const cap = limit * 2;
  let total = 0;
  const scan = terms[0]!;
  const single = terms.length === 1 && scan === phrase;
  const tl = scan.length;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    if (kinds && kinds.indexOf(seg.kind) === -1) continue;
    const favs = options.favourites ? options.favourites[s] : null;
    const kindRank = KIND_RANK[seg.kind];
    const text = seg.data.text;
    const starts = seg.data.starts;
    const n = seg.count;
    let pos = text.indexOf(scan, 1);
    let item = 0;
    while (pos !== -1) {
      item = lastAtMost(starts, pos, item, n);
      const start = starts[item]!;
      const end = starts[item + 1]! - 1; // the separator after the name
      let coarse: number;
      let fine: number;
      if (single) {
        // Find an occurrence at a word start, if any.
        let p = pos;
        let word = false;
        while (p !== -1 && p + tl <= end) {
          const prev = text.charCodeAt(p - 1);
          if (prev === SPACE || prev === SEP) {
            word = true;
            break;
          }
          p = text.indexOf(scan, p + 1);
        }
        coarse = word ? 0 : 1;
        fine = !word ? 0 : p !== start ? 2 : end - start === tl ? 0 : 1;
      } else {
        const name = text.slice(start, end);
        let all = true;
        let words = true;
        for (let t = 1; t < terms.length; t++) {
          const found = termIn(name, terms[t]!);
          if (found === 0) {
            all = false;
            break;
          }
          if (found === 1) words = false;
        }
        if (!all) {
          pos = text.indexOf(scan, end + 1);
          continue;
        }
        if (words && termIn(name, scan) !== 2) words = false;
        coarse = words ? 0 : 1;
        fine = !words ? 0 : name === phrase ? 0 : name.indexOf(phrase) === 0 ? 1 : 2;
      }
      total++;
      const fav = favs !== null && favs !== undefined && favs.has(item);
      const bucket = buckets[((coarse * 2 + (fav ? 0 : 1)) * 3 + kindRank) * 3 + fine]!;
      if (bucket.length < cap) bucket.push(s, item);
      pos = text.indexOf(scan, end + 1);
    }
  }

  const hits: SearchHit[] = [];
  for (let c = 0; c < CLASSES && hits.length < limit; c++) {
    const bucket = buckets[c]!;
    const coarse = c >= CLASSES / 2 ? 1 : 0;
    const fav = ((c / 9) | 0) % 2 === 0;
    const match: SearchMatch = coarse === 1 ? 'substring' : FINE[c % 3]!;
    for (let b = 0; b < bucket.length && hits.length < limit; b += 2) {
      const seg = segments[bucket[b]!]!;
      const index = bucket[b + 1]!;
      const at = seg.chunkOf(index);
      hits.push({ src: seg.src, kind: seg.kind, gen: seg.gen, index, catIdx: at.catIdx, chunk: at.chunk, slot: at.slot, match, favourite: fav });
    }
  }
  return { query: phrase, hits, total };
}
