import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FULL_COUNTS } from '../src/catalog';
import { generateFixtures } from '../src/generate';
import { Rng } from '../src/prng';
import { XMLTV_SPECS, programmeCount } from '../src/xmltv';

const SMALL = { live: 200, movies: 600, series: 30, episodesPerSeries: 10 };
const SMALL_XMLTV = [{ name: 'small.xml', channels: 20, targetBytes: 300_000 }];

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lablo-fixtures-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const small = (name: string, seed: number) =>
  generateFixtures({ outDir: join(root, name), seed, counts: SMALL, xmltvSpecs: SMALL_XMLTV });

describe('determinism', () => {
  it('writes byte-identical files for the same seed, and different ones for another seed', async () => {
    const a = await small('a', 7);
    const b = await small('b', 7);
    const c = await small('c', 8);
    const hashes = (m: typeof a) => Object.fromEntries(Object.entries(m.files).map(([k, v]) => [k, v.sha256]));
    expect(Object.keys(a.files)).toEqual([
      'catalog.json',
      'playlist.m3u',
      'small.xml',
      'xtream/live_categories.json',
      'xtream/live_streams.json',
      'xtream/series.json',
      'xtream/series_categories.json',
      'xtream/vod_categories.json',
      'xtream/vod_streams.json',
    ]);
    expect(hashes(b)).toEqual(hashes(a));
    for (const name of ['catalog.json', 'playlist.m3u', 'small.xml', 'xtream/vod_streams.json']) expect(hashes(c)[name], name).not.toBe(hashes(a)[name]);
    // The recorded hash is the hash of the file on disk.
    const onDisk = createHash('sha256').update(readFileSync(join(root, 'a', 'playlist.m3u'))).digest('hex');
    expect(onDisk).toBe(a.files['playlist.m3u']!.sha256);
    // The .gz holds exactly the same XML.
    expect(gunzipSync(readFileSync(join(root, 'a', 'small.xml.gz'))).equals(readFileSync(join(root, 'a', 'small.xml')))).toBe(true);
  });

  it('derives independent PRNG streams per label', () => {
    const seq = (r: Rng) => Array.from({ length: 5 }, () => r.u32());
    expect(seq(Rng.derive(1, 'catalog'))).toEqual(seq(Rng.derive(1, 'catalog')));
    expect(seq(Rng.derive(1, 'catalog'))).not.toEqual(seq(Rng.derive(1, 'xmltv')));
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(-2, 2);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(2);
    }
  });
});

describe('the full 200k catalog', () => {
  let dir: string;
  let ms: number;
  beforeAll(async () => {
    dir = join(root, 'full');
    const t0 = Date.now();
    await generateFixtures({ outDir: dir, xmltv: false });
    ms = Date.now() - t0;
    console.log(`200k catalog in ${ms} ms`);
  }, 120_000);

  it('has 20k live, 120k movies and 60k episodes in every shape', () => {
    expect(FULL_COUNTS.live + FULL_COUNTS.movies + FULL_COUNTS.series * FULL_COUNTS.episodesPerSeries).toBe(200_000);
    const catalog = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8')) as {
      live: { id: number; name: string }[];
      movies: { id: number; name: string }[];
      series: { id: number; seasons: { episodes: { id: number }[] }[] }[];
    };
    const episodes = catalog.series.flatMap((s) => s.seasons.flatMap((season) => season.episodes));
    expect([catalog.live.length, catalog.movies.length, episodes.length]).toEqual([20_000, 120_000, 60_000]);
    const ids = new Set([...catalog.live, ...catalog.movies, ...catalog.series, ...episodes].map((x) => x.id));
    expect(ids.size).toBe(20_000 + 120_000 + 3_000 + 60_000);

    const xt = (name: string) => JSON.parse(readFileSync(join(dir, 'xtream', `${name}.json`), 'utf8')) as unknown[];
    expect([xt('live_streams').length, xt('vod_streams').length, xt('series').length]).toEqual([20_000, 120_000, 3_000]);

    const m3u = readFileSync(join(dir, 'playlist.m3u'), 'utf8');
    const urls = m3u.split('\n').filter((l) => /^http:\/\/127\.0\.0\.1:8080\/(live|movie|series)\/lablo\/lablo-test\//.test(l));
    expect(urls).toHaveLength(200_000);
    expect(m3u.startsWith('#EXTM3U url-tvg=')).toBe(true);
  });

  it('mixes languages, duplicates and malformed lines', () => {
    const m3u = readFileSync(join(dir, 'playlist.m3u'), 'utf8');
    expect(m3u).toMatch(/[؀-ۿ]/); // Arabic
    expect(m3u).toMatch(/[٠-٩]/); // Arabic-Indic digits
    expect(m3u).toMatch(/[éè]/); // French
    expect(m3u).toMatch(/ñ/); // Spanish
    expect(m3u).toContain('#EXTINF:-1,Entry without a URL');
    expect(m3u).toContain('tvg-id=noquotes');
    expect(m3u).toContain('group-title="XXX Test"');
    expect(m3u).toContain('catchup="flussonic"');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { catalog: { malformedLines: number; duplicateNames: number } };
    expect(manifest.catalog.malformedLines).toBe(400);
    expect(manifest.catalog.duplicateNames).toBeGreaterThan(1000);
    const names = (JSON.parse(readFileSync(join(dir, 'xtream', 'live_streams.json'), 'utf8')) as { name: string }[]).map((s) => s.name);
    expect(new Set(names).size).toBeLessThan(names.length);
  });
});

describe('XMLTV sizes', () => {
  it('lands the 50 MB file within 5% of its target, with the planned programmes', async () => {
    const spec = XMLTV_SPECS[0]!;
    const dir = join(root, 'xmltv');
    const m = await generateFixtures({ outDir: dir, catalog: false, xmltvSpecs: [spec] });
    const file = m.files[spec.name]!;
    expect(Math.abs(file.bytes - spec.targetBytes) / spec.targetBytes).toBeLessThan(0.05);
    expect(m.xmltv[0]!.programmes).toBe(programmeCount(spec));
    const xml = readFileSync(join(dir, spec.name), 'utf8');
    expect(xml.match(/<programme /g)).toHaveLength(programmeCount(spec));
    expect(xml.match(/<channel /g)).toHaveLength(spec.channels);
    expect(xml).toContain('<![CDATA[');
    expect(xml).toMatch(/start="\d{14} -0500"/);
    expect(xml.trimEnd().endsWith('</tv>')).toBe(true);
  }, 60_000);

  it('plans 5k channels × 14 days for the 300 MB file', () => {
    const big = XMLTV_SPECS.find((s) => s.targetBytes === 300e6)!;
    expect(big.channels).toBe(5_000);
    expect(programmeCount(big)).toBeGreaterThan(5_000 * 14 * 15);
  });
});
