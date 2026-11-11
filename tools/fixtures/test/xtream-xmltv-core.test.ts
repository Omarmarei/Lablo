// core's Xtream list parser and XMLTV tokenizer over generated fixtures (RELAY step 6): every
// Xtream item the generator wrote comes back with the right fields, and a small guide checks
// out as contiguous per-channel schedules. The 200k lists and the 300 MB guide run in
// xtream-xmltv-scale.media.test.ts (`pnpm test:media`).

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeCatalog } from '../src/catalog';
import type { XmltvSpec } from '../src/xmltv';
import { writeXmltv } from '../src/xmltv';
import { checkXmltvFixture } from './xmltv-oracle';
import { expectXtreamMatchesCatalog, parseXtreamFixture } from './xtream-oracle';

const COUNTS = { live: 2000, movies: 5000, series: 100, episodesPerSeries: 20 };
const SPEC: XmltvSpec = { name: 'xmltv-small.xml', channels: 36, targetBytes: 3e6 };

let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lablo-xtream-xmltv-'));
  mkdirSync(join(dir, 'xtream'));
  await writeCatalog({ outDir: dir, seed: 6, counts: COUNTS });
  await writeXmltv(dir, SPEC, 6);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('core Xtream list parser over the fixture catalog', () => {
  it.each([64 * 1024, 1000, 61])('returns exactly what was written, read in %i-byte chunks', async (chunkBytes) => {
    const parsed = await parseXtreamFixture(dir, chunkBytes);
    expectXtreamMatchesCatalog(parsed, join(dir, 'catalog.json'));
  });
});

describe('core XMLTV tokenizer over a generated guide', () => {
  it.each([
    ['xmltv-small.xml', 64 * 1024],
    ['xmltv-small.xml', 61],
    ['xmltv-small.xml.gz', 4096],
  ])('%s in %i-byte chunks: every channel and a contiguous schedule per channel', async (file, chunkBytes) => {
    const check = await checkXmltvFixture(join(dir, file), SPEC, chunkBytes);
    // The guide's extras are all exercised: second-language titles, CDATA and sub-titles.
    expect(check.englishTitles).toBeGreaterThan(0);
    expect(check.cdataDescs).toBeGreaterThan(0);
    expect(check.subTitles).toBeGreaterThan(0);
  });
});
