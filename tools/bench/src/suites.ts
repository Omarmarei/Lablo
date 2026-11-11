// Benchmark cases over the scale fixtures (`pnpm fixtures`). The `*-scan` and `*-json-parse`
// cases are baselines: the naive way to read each input. The real parsers run next to them:
// core's M3U parser is `m3u-parse` (step 5); the Xtream list parser over the JSON-array splitter
// is `xtream-vod-json-split` and the XMLTV tokenizer `xmltv-gz-tokenize` (step 6); the search
// index build and the 200k search are `search-index-build` and `search-200k` (step 7). The EPG
// guide reads (matching, window, time repair, per-channel-day buckets) are `epg-ingest-*` (step
// 9); they carry limits derived from spike S6 (architecture.md §1.5 step 10), and `pnpm bench`
// fails when a case goes over its limit.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createGunzip } from 'node:zlib';
import type { CatalogItem, ContentKind, DeviceTier, EpgSourceReport } from '@lablo/core';
import {
  CONTENT_KINDS,
  EpgGuideReader,
  EpgWantedSet,
  M3uCatalogParser,
  SearchIndexBuilder,
  SearchSegment,
  XmltvTokenizer,
  XtreamListParser,
  searchSegments,
} from '@lablo/core';
import type { BenchCase, BenchLimit } from './harness';

export interface Suite {
  /** Fixture file the case reads (relative to the fixtures folder). */
  input: string;
  make(path: string): BenchCase;
}

/** Counts occurrences of `needle` in a stream of byte chunks, across chunk boundaries. */
export async function countInStream(stream: AsyncIterable<unknown>, needle: string): Promise<number> {
  const decoder = new TextDecoder();
  let count = 0;
  let carry = '';
  for await (const chunk of stream) {
    const text = carry + decoder.decode(chunk as Uint8Array, { stream: true });
    let last = 0;
    let i = text.indexOf(needle);
    while (i !== -1) {
      count++;
      last = i + needle.length;
      i = text.indexOf(needle, last);
    }
    carry = text.slice(Math.max(last, text.length - needle.length + 1));
  }
  return count;
}

/**
 * Streams bytes through TextDecoder into core's M3U catalog parser, as the ingest worker will,
 * dropping each chunk's items (so peak memory is the streaming cost). Returns the item count.
 */
export async function parseM3uStream(stream: AsyncIterable<unknown>): Promise<number> {
  const decoder = new TextDecoder();
  const parser = new M3uCatalogParser('bench');
  let items = 0;
  for await (const chunk of stream) items += parser.push(decoder.decode(chunk as Uint8Array, { stream: true })).length;
  items += parser.push(decoder.decode()).length;
  return items + parser.end().length;
}

/**
 * Streams an Xtream list response through TextDecoder and core's list parser (JSON-array splitter,
 * per-element JSON.parse, tolerant decoding into catalog items), dropping each chunk's items.
 */
export async function parseXtreamListStream(stream: AsyncIterable<unknown>): Promise<number> {
  const decoder = new TextDecoder();
  const parser = new XtreamListParser('movie', { src: 'bench', account: { base: 'http://127.0.0.1:8080', username: 'lablo', password: 'lablo-test' } });
  let items = 0;
  for await (const chunk of stream) items += parser.push(decoder.decode(chunk as Uint8Array, { stream: true })).length;
  items += parser.push(decoder.decode()).length;
  return items + parser.end().length;
}

/**
 * Streams XMLTV text through core's tokenizer, keeping the channels `want` accepts (all of them
 * when absent), dropping each chunk's items. Returns the programme count.
 */
export async function tokenizeXmltvStream(stream: AsyncIterable<unknown>, want?: (id: string) => boolean): Promise<number> {
  const decoder = new TextDecoder();
  const tokenizer = new XmltvTokenizer({ languages: ['ar', 'en'], wantChannel: want });
  for await (const chunk of stream) tokenizer.push(decoder.decode(chunk as Uint8Array, { stream: true }));
  tokenizer.push(decoder.decode());
  tokenizer.end();
  return tokenizer.stats.programmes;
}

/**
 * The scale guide's centre (tools/fixtures `XMLTV_ANCHOR_MS`, checked by test/epg-fixture.test.ts):
 * it covers 7 days either side, so the full tier's 7 + 7-day window keeps all of it.
 */
export const EPG_BENCH_NOW = Date.UTC(2026, 10, 1);

/**
 * Reads a guide as the ingest worker will (TextDecoder, then EpgGuideReader: tokenizer, matcher,
 * window, time repair, buckets), dropping the buckets it hands out. Returns the report.
 */
export async function readEpgStream(stream: AsyncIterable<unknown>, wanted: EpgWantedSet, tier: DeviceTier, nowMs = EPG_BENCH_NOW): Promise<EpgSourceReport> {
  const decoder = new TextDecoder();
  const reader = new EpgGuideReader({ epgSrc: 'bench', wanted, tier, nowMs, languages: ['ar', 'en'] });
  for await (const chunk of stream) reader.push(decoder.decode(chunk as Uint8Array, { stream: true }));
  reader.push(decoder.decode());
  reader.end();
  return reader.report();
}

/** Parses a whole playlist into memory, or only its items of one kind (setup, not timed). */
export async function parsePlaylistItems(path: string, kind?: ContentKind): Promise<CatalogItem[]> {
  const decoder = new TextDecoder();
  const parser = new M3uCatalogParser('bench');
  const items: CatalogItem[] = [];
  const keep = (list: CatalogItem[]): void => {
    for (const item of list) if (kind === undefined || item.kind === kind) items.push(item);
  };
  for await (const chunk of createReadStream(path)) keep(parser.push(decoder.decode(chunk as Uint8Array, { stream: true })));
  keep(parser.push(decoder.decode()));
  keep(parser.end());
  return items;
}

/** One search segment per kind, items in playlist order, 500 per chunk (as the ingest stores them). */
export function buildSegments(items: readonly CatalogItem[]): SearchSegment[] {
  return CONTENT_KINDS.map((kind: ContentKind) => {
    const builder = new SearchIndexBuilder('bench', kind, 1);
    for (const item of items) {
      if (item.kind !== kind) continue;
      if (builder.count % 500 === 0) builder.beginChunk(0, builder.count / 500);
      builder.add(item.key, item.normName);
    }
    return new SearchSegment(builder.finish());
  });
}

/** Typical queries: 1-3 letters, Latin and Arabic, several words, a rare word, no match. */
export const SEARCH_QUERIES = ['a', 'e', 'lablo', 'لابلو', 'أخبار', 'الحلقة', 'news', 'golden night', 'cine', 'hd', '12', 'épisode 3', 'qqq'];

/** Caches the parsed playlist between runs, so the search cases time only their own work. */
function lazy<T>(make: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | null = null;
  return () => (value ??= make());
}

/** Every tenth EPG channel of the scale catalog (`epg{k}.lablo.test`): a typical matched share. */
const tenthOfChannels = (id: string): boolean => /^epg\d*0\.lablo\.test$/.test(id);

/**
 * The wanted sets of the EPG cases, from the 200k playlist next to the guide: all 20,000 live
 * channels (they point at every channel of the guide: the worst case), or every tenth one
 * (2,000 channels wanting about a tenth of the guide: the usual filtered case).
 */
const wantedSets = new Map<string, Promise<{ all: EpgWantedSet; tenth: EpgWantedSet }>>();
export function epgWanted(guidePath: string): Promise<{ all: EpgWantedSet; tenth: EpgWantedSet }> {
  const playlist = join(dirname(guidePath), 'playlist.m3u');
  let sets = wantedSets.get(playlist);
  if (sets === undefined) {
    sets = parsePlaylistItems(playlist, 'live').then((live) => ({
      all: EpgWantedSet.fromItems(live),
      tenth: EpgWantedSet.fromItems(live.filter((_, i) => i % 10 === 0)),
    }));
    wantedSets.set(playlist, sets);
  }
  return sets;
}

/**
 * Median wall-time limits of the EPG cases on the CI runner (the slow end), derived from spike S6
 * in architecture.md §1.5 step 10. Memory is bounded separately: the worst case must run in a
 * 96 MB heap (test/epg-300mb.media.test.ts), because a sampled heap peak mostly measures how
 * lazily V8 collects garbage.
 */
export const EPG_LIMITS: Record<'epg-ingest-low-10pct' | 'epg-ingest-full', BenchLimit> = {
  // S6: 150 MB guide <= 4 min on webOS 4, so 8 min for 300 MB; half of it CPU (50/50 duty
  // cycle), half of that left for gunzip and IndexedDB: 120 s; a 2018 TV ~15x slower: 8 s.
  'epg-ingest-low-10pct': { medianMs: 8_000 },
  // Full tier (no S6 number): the all-matched worst case <= 4 min on a 2020 TV, no duty cycle,
  // half for gunzip and IndexedDB: 120 s; a 2020 TV ~6x slower: 20 s.
  'epg-ingest-full': { medianMs: 20_000 },
};

export const SUITES: Record<string, Suite> = {
  'm3u-extinf-scan': {
    input: 'playlist.m3u',
    make: (path) => ({ name: 'm3u-extinf-scan', bytes: statSync(path).size, run: () => countInStream(createReadStream(path), '#EXTINF') }),
  },
  'm3u-parse': {
    input: 'playlist.m3u',
    make: (path) => ({ name: 'm3u-parse', bytes: statSync(path).size, run: () => parseM3uStream(createReadStream(path)) }),
  },
  'xtream-vod-json-parse': {
    input: 'xtream/vod_streams.json',
    make: (path) => ({
      name: 'xtream-vod-json-parse',
      bytes: statSync(path).size,
      // The whole-response JSON.parse that the streaming splitter (step 6) replaces.
      run: () => (JSON.parse(readFileSync(path, 'utf8')) as unknown[]).length,
    }),
  },
  'xtream-vod-json-split': {
    input: 'xtream/vod_streams.json',
    make: (path) => ({ name: 'xtream-vod-json-split', bytes: statSync(path).size, run: () => parseXtreamListStream(createReadStream(path)) }),
  },
  'xmltv-gz-programme-scan': {
    input: 'xmltv-300mb.xml.gz',
    make: (path) => ({
      name: 'xmltv-gz-programme-scan',
      bytes: statSync(path).size,
      run: () => countInStream(createReadStream(path).pipe(createGunzip()), '<programme '),
    }),
  },
  'xmltv-gz-tokenize': {
    input: 'xmltv-300mb.xml.gz',
    make: (path) => ({
      name: 'xmltv-gz-tokenize',
      bytes: statSync(path).size,
      // Every channel wanted: the worst case.
      run: () => tokenizeXmltvStream(createReadStream(path).pipe(createGunzip())),
    }),
  },
  'search-index-build': {
    input: 'playlist.m3u',
    make: (path) => {
      const items = lazy(() => parsePlaylistItems(path));
      // The index build the ingest does per refresh (the warmup run parses the playlist).
      return { name: 'search-index-build', bytes: 0, run: async () => buildSegments(await items()).reduce((n, s) => n + s.count, 0) };
    },
  },
  'search-200k': {
    input: 'playlist.m3u',
    make: (path) => {
      const segments = lazy(async () => buildSegments(await parsePlaylistItems(path)));
      // Each run answers every query in SEARCH_QUERIES once; items/s is queries per second.
      return {
        name: 'search-200k',
        bytes: 0,
        run: async () => {
          const segs = await segments();
          for (const q of SEARCH_QUERIES) searchSegments(segs, q);
          return SEARCH_QUERIES.length;
        },
      };
    },
  },
  'epg-ingest-low-10pct': {
    input: 'xmltv-300mb.xml.gz',
    make: (path) => ({
      name: 'epg-ingest-low-10pct',
      bytes: statSync(path).size,
      limit: EPG_LIMITS['epg-ingest-low-10pct'],
      // S6's scenario: a low-tier TV (1-2 past and 3 future days, 300-character descriptions)
      // with a playlist that matches a tenth of the guide. Items: programmes kept.
      run: async () => (await readEpgStream(createReadStream(path).pipe(createGunzip()), (await epgWanted(path)).tenth, 'low')).programmes.kept,
    }),
  },
  'epg-ingest-full': {
    input: 'xmltv-300mb.xml.gz',
    make: (path) => ({
      name: 'epg-ingest-full',
      bytes: statSync(path).size,
      limit: EPG_LIMITS['epg-ingest-full'],
      // The worst case: every channel of the guide matched, the full tier's 7 + 7 days kept.
      run: async () => (await readEpgStream(createReadStream(path).pipe(createGunzip()), (await epgWanted(path)).all, 'full')).programmes.kept,
    }),
  },
  'xmltv-gz-tokenize-10pct': {
    input: 'xmltv-300mb.xml.gz',
    make: (path) => ({
      name: 'xmltv-gz-tokenize-10pct',
      bytes: statSync(path).size,
      // A tenth of the channels wanted: unwanted programmes are skipped, not tokenized.
      run: () => tokenizeXmltvStream(createReadStream(path).pipe(createGunzip()), tenthOfChannels),
    }),
  },
};

/** The cases whose fixture exists; missing ones are reported, not fatal. */
export function availableCases(fixturesDir: string, names: string[] = Object.keys(SUITES)): { cases: BenchCase[]; missing: string[] } {
  const cases: BenchCase[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const suite = SUITES[name];
    if (!suite) throw new Error(`Unknown benchmark ${name} (known: ${Object.keys(SUITES).join(', ')})`);
    const path = join(fixturesDir, suite.input);
    if (existsSync(path)) cases.push(suite.make(path));
    else missing.push(`${name} (needs ${suite.input}: run pnpm fixtures)`);
  }
  return { cases, missing };
}
