// Checks core's streaming M3U parser against what the fixture generator says it wrote: the
// mock catalog (catalog.json, written in the same pass as playlist.m3u) and the MALFORMED
// schedule. Shared by the small-catalog test (`pnpm test`) and the 200k one (`pnpm test:media`).

import { createReadStream, readFileSync } from 'node:fs';
import type { CatalogItem, M3uCatalogSummary, M3uStats } from '@zoma/core';
import { M3uCatalogParser, normalizeName } from '@zoma/core';
import { expect } from 'vitest';
import { MALFORMED } from '../src/catalog';

/** What each MALFORMED line (same index) does to the parser's counters. */
export const MALFORMED_EFFECTS: Partial<M3uStats>[] = [
  { extinfWithoutUrl: 1, unbalancedQuotes: 1 }, // unbalanced quote: superseded by the next #EXTINF
  { extinfWithoutUrl: 1 }, // #EXTINF without a URL
  { orphanUrls: 1 }, // URL without #EXTINF
  { extinfWithoutUrl: 1, badDurations: 1 }, // #EXTINF:abc
  {}, // blank line
  { vlcOpts: 1 }, // #EXTVLCOPT user agent: applies to the next entry
  { extgrp: 1 }, // #EXTGRP: the next entry's group-title wins
  { extinfWithoutUrl: 1 }, // bare attributes, no URL
  { extinfWithoutUrl: 1 }, // 4,000-character tvg-name, no URL
];

export interface ParsedPlaylist {
  items: CatalogItem[];
  summary: M3uCatalogSummary;
  ms: number;
  bytes: number;
}

/** Streams a playlist file through TextDecoder and M3uCatalogParser, as the ingest worker will. */
export async function parsePlaylistFile(path: string, chunkBytes = 64 * 1024): Promise<ParsedPlaylist> {
  const t0 = performance.now();
  const decoder = new TextDecoder('utf-8');
  const parser = new M3uCatalogParser('fx');
  const items: CatalogItem[] = [];
  let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: chunkBytes })) {
    const buf = chunk as Buffer;
    bytes += buf.length;
    for (const item of parser.push(decoder.decode(buf, { stream: true }))) items.push(item);
  }
  for (const item of parser.push(decoder.decode())) items.push(item);
  for (const item of parser.end()) items.push(item);
  return { items, summary: parser.summary(), ms: performance.now() - t0, bytes };
}

interface MockCatalog {
  live_categories: { id: number; name: string }[];
  vod_categories: { id: number; name: string }[];
  series_categories: { id: number; name: string }[];
  live: { id: number; num: number; name: string; category: number; epg_id?: string; archive_days?: number; catchup?: string; radio?: boolean }[];
  movies: { id: number; name: string; category: number; ext: string }[];
  series: { name: string; category: number; seasons: { episodes: { id: number; title: string; ext: string }[] }[] }[];
}

/** Asserts the parsed playlist is exactly what catalog.json and the MALFORMED schedule say. */
export function expectMatchesCatalog(parsed: ParsedPlaylist, catalogJsonPath: string, malformedLines: number): void {
  const catalog = JSON.parse(readFileSync(catalogJsonPath, 'utf8')) as MockCatalog;
  const categories = new Map<number, string>();
  for (const c of [...catalog.live_categories, ...catalog.vod_categories, ...catalog.series_categories]) categories.set(c.id, c.name);
  const auth = '/zoma/zoma-test/';

  const expected: Pick<CatalogItem, 'kind' | 'name' | 'group' | 'epgId' | 'chno' | 'catchup' | 'radio'>[] = [];
  const urls: string[] = [];
  for (const l of catalog.live) {
    expected.push({
      kind: 'live',
      name: l.name,
      group: categories.get(l.category)!,
      epgId: l.epg_id ?? null,
      chno: l.num,
      catchup: l.archive_days ? { mode: l.catchup!, days: l.archive_days, source: null } : null,
      radio: l.radio === true,
    });
    urls.push(`/live${auth}${l.id}.ts`);
  }
  for (const m of catalog.movies) {
    expected.push({ kind: 'movie', name: m.name, group: categories.get(m.category)!, epgId: null, chno: null, catchup: null, radio: false });
    urls.push(`/movie${auth}${m.id}.${m.ext}`);
  }
  for (const s of catalog.series) {
    for (const season of s.seasons) {
      for (const e of season.episodes) {
        expected.push({ kind: 'series', name: e.title, group: categories.get(s.category)!, epgId: null, chno: null, catchup: null, radio: false });
        urls.push(`/series${auth}${e.id}.${e.ext}`);
      }
    }
  }

  const { items, summary } = parsed;
  expect(items.length).toBe(expected.length);
  // Compare field by field without building 200k diff objects on success.
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const want = expected[i]!;
    const ok =
      item.kind === want.kind &&
      item.name === want.name &&
      item.group === want.group &&
      item.epgId === want.epgId &&
      item.chno === want.chno &&
      item.radio === want.radio &&
      JSON.stringify(item.catchup) === JSON.stringify(want.catchup) &&
      item.url.endsWith(urls[i]!) &&
      item.normName === normalizeName(want.name);
    if (!ok) expect({ index: i, item }).toEqual({ index: i, item: { ...item, ...want, url: `…${urls[i]}` } });
  }

  // Counters: every MALFORMED line has exactly its documented effect, and nothing else is skipped.
  const want: M3uStats = { ...summary.stats, extinfWithoutUrl: 0, orphanUrls: 0, junkLines: 0, overlongLines: 0, unbalancedQuotes: 0, badDurations: 0, vlcOpts: 0, extgrp: 0, otherDirectives: 0, hlsTags: 0 };
  for (let k = 1; k <= malformedLines; k++) {
    for (const [field, n] of Object.entries(MALFORMED_EFFECTS[k % MALFORMED.length]!)) want[field as keyof M3uStats] += n;
  }
  expect(summary.stats).toEqual({ ...want, entries: expected.length });
  expect(summary.counts).toEqual({ live: catalog.live.length, movie: catalog.movies.length, series: expected.length - catalog.live.length - catalog.movies.length });
  expect(summary.epgUrls).toEqual(['http://127.0.0.1:8080/epg/guide.xml.gz']);
  expect(summary.looksLikeHls).toBe(false);
  const withHints = items.filter((i) => i.hints !== null);
  expect(withHints.length).toBe(want.vlcOpts);
  if (withHints.length > 0) expect(summary.userAgents).toEqual(['ZomaTest/1.0']);

  // Keys: unique, and no two different key identities share a hash.
  const keys = new Set<string>();
  const identities = new Map<string, string>();
  for (const item of items) {
    keys.add(item.key);
    const hash = item.key.split(':')[2]!;
    const identity = item.epgId ? `i ${item.epgId.toLowerCase()} ${item.normName}` : `n ${item.normName} ${normalizeName(item.group)}`;
    const seen = identities.get(hash);
    if (seen !== undefined && seen !== identity) expect({ hash, identity }).toEqual({ hash, identity: seen });
    identities.set(hash, identity);
  }
  expect(keys.size).toBe(items.length);
}
