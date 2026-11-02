// Benchmark cases over the scale fixtures (`pnpm fixtures`). The `*-scan` and `*-json-parse`
// cases are baselines: the naive way to read each input. The real parsers run next to them:
// core's M3U parser is `m3u-parse` (step 5); the Xtream list parser over the JSON-array splitter
// is `xtream-vod-json-split` and the XMLTV tokenizer `xmltv-gz-tokenize` (step 6). Step 9 adds
// the EPG ingest (matching, window, buckets).

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { M3uCatalogParser, XmltvTokenizer, XtreamListParser } from '@zoma/core';
import type { BenchCase } from './harness';

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
  const parser = new XtreamListParser('movie', { src: 'bench', account: { base: 'http://127.0.0.1:8080', username: 'zoma', password: 'zoma-test' } });
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

/** Every tenth EPG channel of the scale catalog (`epg{k}.zoma.test`): a typical matched share. */
const tenthOfChannels = (id: string): boolean => /^epg\d*0\.zoma\.test$/.test(id);

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
