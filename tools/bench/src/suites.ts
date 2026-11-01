// Benchmark cases over the scale fixtures (`pnpm fixtures`). These are baselines: the naive
// way to read each input. Steps 5-9 add the real parsers here (core's M3U parser, the JSON-array
// splitter, the XMLTV tokenizer) so they are measured on the same inputs, next to these numbers.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
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

export const SUITES: Record<string, Suite> = {
  'm3u-extinf-scan': {
    input: 'playlist.m3u',
    make: (path) => ({ name: 'm3u-extinf-scan', bytes: statSync(path).size, run: () => countInStream(createReadStream(path), '#EXTINF') }),
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
  'xmltv-gz-programme-scan': {
    input: 'xmltv-300mb.xml.gz',
    make: (path) => ({
      name: 'xmltv-gz-programme-scan',
      bytes: statSync(path).size,
      run: () => countInStream(createReadStream(path).pipe(createGunzip()), '<programme '),
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
