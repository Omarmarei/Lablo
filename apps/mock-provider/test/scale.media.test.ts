// The mock serving the step-4 scale fixtures, as `pnpm mock --catalog .cache/fixtures/catalog.json
// --xmltv .cache/fixtures/xmltv-50mb.xml.gz` would: the 200k catalog loads, every list is
// complete, and a scale channel and movie play the generic media (ffprobe). Needs `pnpm
// fixtures` and `pnpm mock:media` output; `pnpm verify:media` runs them in that order.

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Catalog } from '../src/config';
import { loadCatalogFile } from '../src/config';
import { FileMedia } from '../src/file-media';
import { DEFAULT_MEDIA_DIR, findTool } from '../src/media-gen';
import type { MockServer } from '../src/server';
import { buildServer } from '../src/server';

const exec = promisify(execFile);
const fixtures = process.env['ZOMA_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '..', '..', '.cache', 'fixtures');
const mediaDir = process.env['MOCK_MEDIA_DIR'] ?? DEFAULT_MEDIA_DIR;
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

let catalog: Catalog;
let app: MockServer;
let base: string;

beforeAll(async () => {
  for (const f of [join(fixtures, 'catalog.json'), join(mediaDir, 'manifest.json')]) {
    if (!existsSync(f)) throw new Error(`${f} is missing: run pnpm fixtures and pnpm mock:media (pnpm verify:media does both)`);
  }
  const t0 = Date.now();
  catalog = loadCatalogFile(join(fixtures, 'catalog.json'));
  console.log(`200k catalog loaded in ${Date.now() - t0} ms`);
  app = await buildServer({
    catalog,
    now: () => NOW,
    labLogDir: null,
    xmltvFile: join(fixtures, 'xmltv-50mb.xml.gz'),
    media: new FileMedia({ dir: mediaDir, now: () => NOW, liveSpeed: 50 }),
  });
  base = await app.listen({ port: 0, host: '127.0.0.1' });
}, 120_000);

afterAll(async () => {
  await app?.close();
});

const api = (action: string): string => `/player_api.php?username=zoma&password=zoma-test&action=${action}`;

describe('scale catalog in the mock', () => {
  it('loads 20k live, 120k movies and 3k series (60k episodes)', () => {
    expect(catalog.live).toHaveLength(20_000);
    expect(catalog.movies).toHaveLength(120_000);
    expect(catalog.series.flatMap((s) => s.seasons.flatMap((season) => season.episodes))).toHaveLength(60_000);
  });

  it('serves complete Xtream lists and a 200k-entry M3U', async () => {
    expect(((await app.inject({ url: api('get_live_streams') })).json() as unknown[]).length).toBe(20_000);
    expect(((await app.inject({ url: api('get_vod_streams') })).json() as unknown[]).length).toBe(120_000);
    expect(((await app.inject({ url: api('get_series') })).json() as unknown[]).length).toBe(3_000);
    const m3u = (await app.inject({ url: '/get.php?username=zoma&password=zoma-test&type=m3u_plus' })).body;
    expect(m3u.match(/^#EXTINF/gm)).toHaveLength(200_000);
  });

  it('serves the XMLTV file as given', async () => {
    const gz = await app.inject({ url: '/epg/guide.xml.gz' });
    expect(gz.rawPayload.length).toBe(statSync(join(fixtures, 'xmltv-50mb.xml.gz')).size);
  });

  it('plays the generic loop and generic files for scale ids', async () => {
    const ffprobe = findTool('ffprobe');
    if (!ffprobe) throw new Error('ffprobe must be on PATH');
    const live = catalog.live.find((c) => !c.radio)!;
    const movie = catalog.movies.find((m) => m.ext === 'mp4')!;
    for (const path of [`/live/zoma/zoma-test/${live.id}.ts`, `/movie/zoma/zoma-test/${movie.id}.mp4`]) {
      const { stdout } = await exec(ffprobe.bin, ['-v', 'error', '-print_format', 'json', '-show_streams', `${base}${path}`]);
      const streams = (JSON.parse(stdout) as { streams: { codec_type: string; codec_name: string }[] }).streams;
      expect(streams.map((s) => `${s.codec_type}:${s.codec_name}`), path).toEqual(['video:h264', 'audio:aac']);
    }
  });
});
