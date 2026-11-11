// RELAY step 5 "Done when", at full scale: core's streaming M3U parser reads the 200k fixture
// playlist (`pnpm fixtures`) and returns exactly the 200,000 entries the generator wrote, with
// all 400 malformed lines survived and counted. Runs in `pnpm test:media` (CI job `media`,
// after `pnpm fixtures`); throughput is measured by `pnpm bench m3u-parse`.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL_COUNTS } from '../src/catalog';
import type { FixtureManifest } from '../src/generate';
import { expectMatchesCatalog, parsePlaylistFile } from './m3u-oracle';

const fixtures = process.env['LABLO_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '..', '..', '.cache', 'fixtures');

describe('core M3U parser over the 200k fixture', () => {
  it('returns all 200,000 entries and survives the 400 malformed lines', async () => {
    const playlist = join(fixtures, 'playlist.m3u');
    if (!existsSync(playlist)) throw new Error(`${playlist} is missing: run pnpm fixtures (pnpm verify:media does)`);
    const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json'), 'utf8')) as FixtureManifest;
    expect(manifest.catalog).toMatchObject({ live: FULL_COUNTS.live, movies: FULL_COUNTS.movies, malformedLines: 400 });

    const parsed = await parsePlaylistFile(playlist);
    console.log(`200k playlist: ${(parsed.bytes / 1e6).toFixed(1)} MB parsed in ${parsed.ms.toFixed(0)} ms (${(parsed.bytes / 1e3 / parsed.ms).toFixed(1)} MB/s)`);
    expect(parsed.items).toHaveLength(200_000);
    expectMatchesCatalog(parsed, join(fixtures, 'catalog.json'), manifest.catalog!.malformedLines);
    // Generous ceiling against pathological slowdowns; the bench tracks real throughput.
    expect(parsed.ms).toBeLessThan(30_000);
  });
});
