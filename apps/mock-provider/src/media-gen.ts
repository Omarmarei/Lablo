// Runs the media plan (media-plan.ts) with ffmpeg into a cache folder and writes manifest.json,
// which FileMedia (file-media.ts) serves. Each asset lives under a folder named by a hash of
// its ffmpeg arguments, so an unchanged asset is never re-encoded and a changed one is.
//
// Layout of the media folder (default: <repo>/.cache/media, gitignored):
//   manifest.json                 what FileMedia reads
//   live/live-101-<hash>/seg-N.ts 60 s loops in 6 s segments (+ index.m3u8, the done marker)
//   files/movie-201-<hash>.mp4    VOD and episodes
//   open-movies/                  the Blender films (pnpm mock:open-movies, opt-in)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { Catalog } from './config';
import type { FileManifestEntry, LiveManifestEntry, MediaManifest } from './file-media';
import { MANIFEST_FILE } from './file-media';
import type { FileAsset, LiveAsset, MediaAsset } from './media-plan';
import {
  LIVE_LOOP_SECONDS,
  SEGMENT_SECONDS,
  assetHash,
  assetSlug,
  fileClipArgs,
  fileMuxArgs,
  labelTexts,
  liveArgs,
  planMedia,
  srtText,
} from './media-plan';

export const DEFAULT_MEDIA_DIR = join(import.meta.dirname, '..', '..', '..', '.cache', 'media');

/** Fonts with Latin glyphs that drawtext can load by path (the default font crashes on Windows). */
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
];

export class MediaToolError extends Error {
  override name = 'MediaToolError';
}

/** The ffmpeg binary (`FFMPEG` env or PATH) and its version line, or undefined if missing. */
export function findTool(name: 'ffmpeg' | 'ffprobe'): { bin: string; version: string } | undefined {
  const bin = process.env[name.toUpperCase()] ?? name;
  const res = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) return undefined;
  return { bin, version: res.stdout.split('\n')[0]?.trim() ?? name };
}

/** `LABLO_MEDIA_FONT`, else the first font found; null means no burned-in text. */
export function findFont(): string | null {
  const override = process.env['LABLO_MEDIA_FONT'];
  if (override) {
    if (!existsSync(override)) throw new MediaToolError(`LABLO_MEDIA_FONT=${override} does not exist`);
    return override;
  }
  return FONT_CANDIDATES.find((f) => existsSync(f)) ?? null;
}

export function run(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new MediaToolError(`${bin} exited with ${code} in ${cwd}\n${args.join(' ')}\n${stderr}`));
    });
  });
}

export interface GenerateOptions {
  catalog: Catalog;
  outDir?: string;
  ffmpeg?: string;
  /** Font for the burned-in text; default: findFont(). */
  font?: string | null;
  concurrency?: number;
  /** Re-encode even when the cached asset exists. */
  force?: boolean;
  log?: (line: string) => void;
}

export interface GenerateResult {
  manifest: MediaManifest;
  encoded: string[];
  reused: string[];
  ms: number;
}

async function writeLabels(dir: string, asset: MediaAsset): Promise<void> {
  const texts = labelTexts(asset);
  await Promise.all(texts.map((t, i) => writeFile(join(dir, `label-${i}.txt`), t, 'utf8')));
}

async function encodeLive(ffmpeg: string, asset: LiveAsset, font: string | null, final: string): Promise<void> {
  const tmp = `${final}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  if (font) await writeLabels(tmp, asset);
  await run(ffmpeg, liveArgs(asset, font), tmp);
  const expected = LIVE_LOOP_SECONDS / SEGMENT_SECONDS;
  // An encoder flush can add a sliver of audio (LAME: one 24 ms frame) as one more segment.
  const durations = [...(await readFile(join(tmp, 'index.m3u8'), 'utf8')).matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
  const bad = durations.findIndex((d, i) => (i < expected ? Math.abs(d - SEGMENT_SECONDS) > 0.001 : d > 0.5));
  if (durations.length < expected || bad >= 0) {
    throw new MediaToolError(`${asset.key}: expected ${expected} segments of ${SEGMENT_SECONDS} s, got ${durations.join(', ')}`);
  }
  for (let i = expected; i < durations.length; i++) await rm(join(tmp, `seg-${i}.ts`));
  await Promise.all((await readdir(tmp)).filter((f) => f.startsWith('label-')).map((f) => rm(join(tmp, f))));
  await rm(final, { recursive: true, force: true });
  await rename(tmp, final);
}

async function encodeFile(ffmpeg: string, asset: FileAsset, font: string | null, final: string): Promise<void> {
  const tmp = `${final}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  if (font) await writeLabels(tmp, asset);
  await Promise.all(asset.subtitles.map((s) => writeFile(join(tmp, `sub-${s.lang}.srt`), srtText(s.lang, asset.durationSecs), 'utf8')));
  await run(ffmpeg, fileClipArgs(asset, font), tmp);
  const out = `out.${asset.ext}`;
  await run(ffmpeg, fileMuxArgs(asset, out), tmp);
  await rm(final, { force: true });
  await rename(join(tmp, out), final);
  await rm(tmp, { recursive: true, force: true });
}

async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  });
  await Promise.all(workers);
}

/** Generates (or reuses) every asset of the catalog's media plan and writes manifest.json. */
export async function generateMedia(options: GenerateOptions): Promise<GenerateResult> {
  const started = Date.now();
  const outDir = options.outDir ?? DEFAULT_MEDIA_DIR;
  const tool = options.ffmpeg ? { bin: options.ffmpeg, version: options.ffmpeg } : findTool('ffmpeg');
  if (!tool) throw new MediaToolError('ffmpeg was not found on PATH (set FFMPEG, or install it: winget install Gyan.FFmpeg / apt-get install ffmpeg)');
  const font = options.font === undefined ? findFont() : options.font;
  const log = options.log ?? (() => {});
  if (!font) log('No font found for the burned-in labels (set LABLO_MEDIA_FONT); generating without text.');
  const concurrency = options.concurrency ?? Math.max(2, Math.floor(availableParallelism() / 4));

  await mkdir(join(outDir, 'live'), { recursive: true });
  await mkdir(join(outDir, 'files'), { recursive: true });

  const assets = planMedia(options.catalog);
  const manifest: MediaManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ffmpeg: tool.version,
    font,
    live: {},
    files: {},
  };
  const encoded: string[] = [];
  const reused: string[] = [];
  const jobs: { asset: MediaAsset; path: string }[] = [];

  for (const asset of assets) {
    const name = `${assetSlug(asset)}-${assetHash(asset, font)}`;
    if (asset.kind === 'live') {
      const rel = `live/${name}`;
      const entry: LiveManifestEntry = {
        dir: rel,
        segments: LIVE_LOOP_SECONDS / SEGMENT_SECONDS,
        segmentSeconds: SEGMENT_SECONDS,
        video: asset.video ? { codec: asset.video.codec, width: asset.video.width, height: asset.video.height, fps: asset.video.fps } : null,
        audio: asset.audio.map((a) => ({ lang: a.lang, codec: a.codec, channels: a.channels })),
      };
      manifest.live[asset.key] = entry;
      const done = existsSync(join(outDir, rel, 'index.m3u8'));
      if (done && !options.force) reused.push(asset.key);
      else jobs.push({ asset, path: join(outDir, rel) });
    } else {
      const rel = `files/${name}.${asset.ext}`;
      const entry: FileManifestEntry = {
        path: rel,
        ext: asset.ext,
        durationSecs: asset.durationSecs,
        video: { codec: asset.video.codec, width: asset.video.width, height: asset.video.height, fps: asset.video.fps },
        audio: asset.audio.map((a) => ({ lang: a.lang, codec: a.codec, channels: a.channels })),
        subtitles: asset.subtitles.map((s) => ({ lang: s.lang, codec: asset.ext === 'mp4' ? 'mov_text' : 'subrip' })),
        ...(asset.openMovie ? { openMovie: asset.openMovie } : {}),
      };
      manifest.files[asset.key] = entry;
      if (existsSync(join(outDir, rel)) && !options.force) reused.push(asset.key);
      else jobs.push({ asset, path: join(outDir, rel) });
    }
  }

  await pool(jobs, concurrency, async ({ asset, path }) => {
    const t0 = Date.now();
    if (asset.kind === 'live') await encodeLive(tool.bin, asset, font, path);
    else await encodeFile(tool.bin, asset, font, path);
    encoded.push(asset.key);
    log(`  ${asset.kind === 'live' ? 'live' : 'file'} ${asset.key} (${Date.now() - t0} ms)`);
  });

  // Drop cache entries the plan no longer references (old hashes, interrupted runs).
  const keep = new Set([...Object.values(manifest.live).map((e) => e.dir), ...Object.values(manifest.files).map((e) => e.path)]);
  for (const sub of ['live', 'files']) {
    for (const entry of await readdir(join(outDir, sub))) {
      if (!keep.has(`${sub}/${entry}`)) await rm(join(outDir, sub, entry), { recursive: true, force: true });
    }
  }

  await writeFile(join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, encoded, reused, ms: Date.now() - started };
}
