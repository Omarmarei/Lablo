// core's streaming M3U parser over a generated catalog (RELAY step 5): every entry the
// generator wrote comes back with the right fields, and every malformed line is survived and
// counted. A 9,000-entry catalog has 18 malformed lines, so each of the 9 kinds appears twice.
// The full 200k playlist runs in m3u-scale.media.test.ts (`pnpm test:media`).

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogResult } from '../src/catalog';
import { MALFORMED, writeCatalog } from '../src/catalog';
import { MALFORMED_EFFECTS, expectMatchesCatalog, parsePlaylistFile } from './m3u-oracle';

const COUNTS = { live: 2000, movies: 5000, series: 100, episodesPerSeries: 20 };

let dir: string;
let written: CatalogResult;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zoma-m3u-core-'));
  mkdirSync(join(dir, 'xtream'));
  written = await writeCatalog({ outDir: dir, seed: 5, counts: COUNTS });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('core M3U parser over the fixture catalog', () => {
  it('documents an effect for every malformed line kind', () => {
    expect(MALFORMED_EFFECTS).toHaveLength(MALFORMED.length);
    expect(written.counts.malformedLines).toBe(18);
  });

  it.each([64 * 1024, 1000, 61])('returns exactly what was written, read in %i-byte chunks', async (chunkBytes) => {
    const parsed = await parsePlaylistFile(join(dir, 'playlist.m3u'), chunkBytes);
    expect(parsed.items).toHaveLength(COUNTS.live + COUNTS.movies + COUNTS.series * COUNTS.episodesPerSeries);
    expectMatchesCatalog(parsed, join(dir, 'catalog.json'), written.counts.malformedLines);
  });
});
