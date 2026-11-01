// `pnpm mock:media [--out <dir>] [--catalog <file>] [--force] [--concurrency N]`
//   Generates the test channels and files for the catalog into .cache/media (cached by hash).
// `pnpm mock:open-movies [--out <dir>] [--only <key,...>] [--keep-downloads]`
//   Fetches the Blender open movies (opt-in, ~1.2 GB, pinned SHA-256). Never run in CI.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { OpenMovieKey } from './config';
import { DEFAULT_FIXTURES_DIR, OPEN_MOVIE_KEYS, loadCatalog, loadCatalogFile } from './config';
import { DEFAULT_MEDIA_DIR, findTool, generateMedia } from './media-gen';
import { fetchOpenMovies } from './open-movies';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: process.env['MOCK_MEDIA_DIR'] ?? DEFAULT_MEDIA_DIR },
    catalog: { type: 'string' },
    fixtures: { type: 'string', default: DEFAULT_FIXTURES_DIR },
    force: { type: 'boolean', default: false },
    concurrency: { type: 'string' },
    only: { type: 'string' },
    'keep-downloads': { type: 'boolean', default: false },
  },
});

const command = positionals[0] ?? 'generate';
const outDir = resolve(values.out);
const ffmpeg = findTool('ffmpeg');
if (!ffmpeg) {
  console.error('ffmpeg was not found on PATH. Install it (Windows: winget install Gyan.FFmpeg; Debian/Ubuntu: apt-get install ffmpeg) or set FFMPEG.');
  process.exit(2);
}

if (command === 'generate') {
  const catalog = values.catalog ? loadCatalogFile(resolve(values.catalog)) : loadCatalog(values.fixtures);
  console.log(`Generating media into ${outDir} with ${ffmpeg.version}`);
  const result = await generateMedia({
    catalog,
    outDir,
    ffmpeg: ffmpeg.bin,
    force: values.force,
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    log: (line) => console.log(line),
  });
  console.log(`Done in ${(result.ms / 1000).toFixed(1)} s: ${result.encoded.length} encoded, ${result.reused.length} reused. Font: ${result.manifest.font ?? 'none'}`);
} else if (command === 'open-movies') {
  const only = values.only?.split(',').map((k) => k.trim()) as OpenMovieKey[] | undefined;
  const bad = only?.filter((k) => !(OPEN_MOVIE_KEYS as readonly string[]).includes(k)) ?? [];
  if (bad.length > 0) {
    console.error(`Unknown open movie(s): ${bad.join(', ')} (known: ${OPEN_MOVIE_KEYS.join(', ')})`);
    process.exit(2);
  }
  const manifest = await fetchOpenMovies({ mediaDir: outDir, ffmpeg: ffmpeg.bin, only, keepDownloads: values['keep-downloads'], log: (line) => console.log(line) });
  console.log(`Open movies ready: ${Object.keys(manifest).join(', ')}. Restart pnpm mock to serve them.`);
} else {
  console.error(`Unknown command ${command} (generate | open-movies)`);
  process.exit(2);
}
