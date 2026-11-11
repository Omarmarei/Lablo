// Checks core's Xtream list parser (JSON-array splitter + tolerant decoding) against what the
// fixture generator says it wrote: xtream/*.json (the panel's answers) must come back as exactly
// the items of catalog.json (the mock's catalog, written in the same pass). Shared by the small
// catalog test (`pnpm test`) and the 200k one (`pnpm test:media`).

import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { XtreamCategory, XtreamListItem, XtreamListStats } from '@lablo/core';
import { XtreamListParser, decodeCategory, matchName, normalizeName } from '@lablo/core';
import { expect } from 'vitest';
import { ANCHOR_SEC } from '../src/catalog';

const ACCOUNT = { base: 'http://127.0.0.1:8080', username: 'lablo', password: 'lablo-test' };
type Kind = 'live' | 'movie' | 'series';
const FILES: Record<Kind, [list: string, categories: string]> = {
  live: ['live_streams', 'live_categories'],
  movie: ['vod_streams', 'vod_categories'],
  series: ['series', 'series_categories'],
};

export interface ParsedXtream {
  items: Record<Kind, XtreamListItem[]>;
  stats: Record<Kind, XtreamListStats>;
  ms: number;
  bytes: number;
}

/** Streams each list file through TextDecoder and XtreamListParser, as the ingest worker will. */
export async function parseXtreamFixture(dir: string, chunkBytes = 64 * 1024): Promise<ParsedXtream> {
  const t0 = performance.now();
  const out: ParsedXtream = { items: { live: [], movie: [], series: [] }, stats: {} as Record<Kind, XtreamListStats>, ms: 0, bytes: 0 };
  for (const kind of ['live', 'movie', 'series'] as const) {
    const [list, cats] = FILES[kind];
    const categories = (JSON.parse(readFileSync(join(dir, 'xtream', `${cats}.json`), 'utf8')) as unknown[])
      .map(decodeCategory)
      .filter((c): c is XtreamCategory => c !== null);
    const parser = new XtreamListParser(kind, { src: 'fx', account: ACCOUNT, categories: new Map(categories.map((c) => [c.id, c.name])) });
    const decoder = new TextDecoder();
    const items = out.items[kind];
    for await (const chunk of createReadStream(join(dir, 'xtream', `${list}.json`), { highWaterMark: chunkBytes })) {
      const buf = chunk as Buffer;
      out.bytes += buf.length;
      for (const item of parser.push(decoder.decode(buf, { stream: true }))) items.push(item);
    }
    for (const item of parser.push(decoder.decode())) items.push(item);
    for (const item of parser.end()) items.push(item);
    out.stats[kind] = parser.stats();
  }
  out.ms = performance.now() - t0;
  return out;
}

interface MockCatalog {
  live_categories: { id: number; name: string }[];
  vod_categories: { id: number; name: string }[];
  series_categories: { id: number; name: string }[];
  live: { id: number; num: number; name: string; category: number; added_days_ago: number; epg_id?: string; archive_days?: number; radio?: boolean; adult?: boolean }[];
  movies: { id: number; name: string; category: number; ext: string; year: number; rating: number; added_days_ago: number }[];
  series: { id: number; name: string; category: number; year: number; rating: number; added_days_ago: number }[];
}

/** Asserts the parsed lists are exactly what catalog.json describes. */
export function expectXtreamMatchesCatalog(parsed: ParsedXtream, catalogJsonPath: string): void {
  const catalog = JSON.parse(readFileSync(catalogJsonPath, 'utf8')) as MockCatalog;
  const names = new Map<number, string>();
  for (const c of [...catalog.live_categories, ...catalog.vod_categories, ...catalog.series_categories]) names.set(c.id, c.name);
  const added = (days: number): number => ANCHOR_SEC - days * 86_400;

  // Compare field by field without building 200k diff objects on success.
  const check = (kind: Kind, index: number, got: XtreamListItem | undefined, ok: (g: XtreamListItem) => boolean, want: object): void => {
    if (got === undefined || !ok(got)) expect({ kind, index, got }).toEqual({ kind, index, got: want });
  };

  const { live, movie, series } = parsed.items;
  expect([live.length, movie.length, series.length]).toEqual([catalog.live.length, catalog.movies.length, catalog.series.length]);
  catalog.live.forEach((c, i) => {
    const catchup = c.archive_days ? { mode: 'xc', days: c.archive_days, source: null } : null;
    const want = { key: `x:fx:live:${c.id}`, name: c.name, group: names.get(c.category), epgId: c.epg_id ?? null, chno: c.num, catchup, radio: c.radio === true };
    check('live', i, live[i], (g) =>
      g.item.key === want.key &&
      g.item.kind === 'live' &&
      g.item.name === want.name &&
      g.item.normName === normalizeName(c.name) &&
      g.item.matchName === matchName(c.name) &&
      g.item.group === want.group &&
      g.item.epgId === want.epgId &&
      g.item.chno === want.chno &&
      JSON.stringify(g.item.catchup) === JSON.stringify(catchup) &&
      g.item.radio === want.radio &&
      g.item.url === `${ACCOUNT.base}/live/lablo/lablo-test/${c.id}.ts` &&
      g.adult === (c.adult === true) &&
      g.added === added(c.added_days_ago),
    want);
  });
  catalog.movies.forEach((m, i) => {
    const want = { key: `x:fx:movie:${m.id}`, name: m.name, group: names.get(m.category), year: m.year, rating: m.rating };
    check('movie', i, movie[i], (g) =>
      g.item.key === want.key &&
      g.item.kind === 'movie' &&
      g.item.name === m.name &&
      g.item.group === want.group &&
      g.item.url === `${ACCOUNT.base}/movie/lablo/lablo-test/${m.id}.${m.ext}` &&
      g.year === m.year &&
      g.rating === m.rating &&
      g.added === added(m.added_days_ago),
    want);
  });
  catalog.series.forEach((s, i) => {
    const want = { key: `x:fx:series:${s.id}`, name: s.name, group: names.get(s.category), year: s.year, rating: s.rating };
    check('series', i, series[i], (g) =>
      g.item.key === want.key && g.item.kind === 'series' && g.item.name === s.name && g.item.group === want.group && g.year === s.year && g.rating === s.rating && g.added === added(s.added_days_ago),
    want);
  });
  for (const kind of ['live', 'movie', 'series'] as const) {
    expect(parsed.stats[kind]).toMatchObject({ badJson: 0, skipped: 0, duplicates: 0, json: { shape: 'array', truncated: false, oversized: 0, stray: 0, trailing: 0 } });
  }
}
