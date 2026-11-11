// RELAY step 6 at full scale: core's Xtream list parser reads the 200k fixture's Xtream answers
// (`pnpm fixtures`) and returns exactly the items of catalog.json, and the XMLTV tokenizer reads
// the 300 MB guide (gzipped, as a TV downloads it) into 5,000 contiguous channel schedules.
// Runs in `pnpm test:media` (CI job `media`, after `pnpm fixtures`); throughput is measured by
// `pnpm bench xtream-vod-json-split xmltv-gz-tokenize`.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { XMLTV_SPECS, programmeCount } from '../src/xmltv';
import { checkXmltvFixture } from './xmltv-oracle';
import { expectXtreamMatchesCatalog, parseXtreamFixture } from './xtream-oracle';

const fixtures = process.env['LABLO_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '..', '..', '.cache', 'fixtures');

function need(path: string): string {
  if (!existsSync(path)) throw new Error(`${path} is missing: run pnpm fixtures (pnpm verify:media does)`);
  return path;
}

describe('core parsers over the scale fixtures', () => {
  it('Xtream: all 20k live, 120k movies and 3k series come back exactly', async () => {
    const parsed = await parseXtreamFixture(fixtures);
    expect([parsed.items.live.length, parsed.items.movie.length, parsed.items.series.length]).toEqual([20_000, 120_000, 3_000]);
    expectXtreamMatchesCatalog(parsed, need(join(fixtures, 'catalog.json')));
    console.log(`Xtream lists: ${(parsed.bytes / 1e6).toFixed(1)} MB parsed in ${parsed.ms.toFixed(0)} ms (${(parsed.bytes / 1e3 / parsed.ms).toFixed(1)} MB/s)`);
    // Generous ceiling against pathological slowdowns; the bench tracks real throughput.
    expect(parsed.ms).toBeLessThan(30_000);
  });

  it('XMLTV: the 300 MB guide (gzipped) is 5,000 contiguous channel schedules', async () => {
    const spec = XMLTV_SPECS.find((s) => s.name === 'xmltv-300mb.xml')!;
    const check = await checkXmltvFixture(need(join(fixtures, `${spec.name}.gz`)), spec);
    expect(check.stats.programmes).toBe(programmeCount(spec));
    console.log(`XMLTV 300 MB (gz): ${check.stats.programmes} programmes in ${check.ms.toFixed(0)} ms`);
    expect(check.ms).toBeLessThan(120_000);
  });
});
