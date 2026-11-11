// RELAY step 7 "Done when", at full scale: the 200k fixture playlist (`pnpm fixtures`) goes
// through core's M3U parser, the data layer's chunker, search index and generation commit into
// IndexedDB (fake-indexeddb), and the query service loads the segments back and answers typical
// searches in ≤ 200 ms each in Node. Every result is checked against the parsed names. Runs in
// `pnpm test:media` (CI job `media`); `pnpm bench search-200k` times the search alone, and the
// 200k generated catalog in packages/core/src/search.test.ts covers `pnpm test`.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogItem } from '@lablo/core';
import { normalizeName, searchTerms } from '@lablo/core';
import { QueryService, getSources, openDatabase } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { freshFactory, ingest } from '../packages/data/src/test-support';
import { parsePlaylistFile } from '../tools/fixtures/test/m3u-oracle';

const fixtures = process.env['LABLO_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '.cache', 'fixtures');

const QUERIES = ['a', 'e', 'lablo', 'لابلو', 'أخبار', 'الحلقة', 'news', 'golden night', 'cine', 'hd', '12', 'épisode 3', 'qqq'];

function bestOf<T>(runs: number, fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  return (async () => {
    let best = Infinity;
    let value!: T;
    for (let r = 0; r < runs; r++) {
      const t = performance.now();
      value = await fn();
      best = Math.min(best, performance.now() - t);
    }
    return { ms: best, value };
  })();
}

describe('search over the 200k fixture through the data layer', () => {
  it('ingests into IndexedDB, loads the index back, and answers each query in ≤ 200 ms', async () => {
    const playlist = join(fixtures, 'playlist.m3u');
    if (!existsSync(playlist)) throw new Error(`${playlist} is missing: run pnpm fixtures (pnpm verify:media does)`);
    const parsed = await parsePlaylistFile(playlist);
    expect(parsed.items).toHaveLength(200_000);

    const factory = freshFactory();
    const db = await openDatabase(factory);
    let t = performance.now();
    const { gen } = await ingest(db, 'fx', parsed.items);
    const ingestMs = performance.now() - t;
    const [meta] = await getSources(db);
    expect(meta).toMatchObject({ src: 'fx', gen, counts: { live: 20_000, movie: 120_000, series: 60_000 } });

    const svc = new QueryService({ openDb: () => openDatabase(factory) });
    t = performance.now();
    const status = await svc.reload();
    const loadMs = performance.now() - t;
    expect(status.segments.map((s) => s.count)).toEqual([20_000, 120_000, 60_000]);
    expect(status.stale).toEqual([]);

    const byKey = new Map<string, CatalogItem>(parsed.items.map((i) => [i.key, i]));
    const times: Record<string, number> = {};
    for (const query of QUERIES) {
      const { ms, value: result } = await bestOf(3, () => svc.search({ query }));
      times[query] = Math.round(ms * 10) / 10;
      // Oracle: every item whose name holds all query words, counted from the parsed playlist.
      const terms = searchTerms(normalizeName(query));
      const expected = parsed.items.filter((i) => terms.every((w) => i.normName.includes(w))).length;
      expect(result.total, query).toBe(expected);
      expect(result.hits.length, query).toBe(Math.min(200, expected));
      const items = await svc.items(result.hits);
      items.forEach((item, n) => {
        expect(item, `${query} #${n}`).not.toBeNull();
        expect(byKey.get(item!.key)?.normName).toBe(item!.normName);
        for (const w of terms) expect(item!.normName).toContain(w);
      });
      // Word-prefix matches come before substring matches, live before movies before series.
      const ranks = result.hits.map((h) => (h.match === 'substring' ? 3 : 0) + ['live', 'movie', 'series'].indexOf(h.kind));
      expect(ranks, query).toEqual([...ranks].sort((x, y) => x - y));
    }
    console.log(`200k search: ingest into fake-indexeddb ${(ingestMs / 1000).toFixed(1)} s, index load ${loadMs.toFixed(0)} ms, queries (ms) ${JSON.stringify(times)}`);
    expect(Math.max(...Object.values(times)), JSON.stringify(times)).toBeLessThanOrEqual(200);
    db.close();
  }, 300_000);
});
