// RELAY step 4 "Done when": `pnpm mock` serves streams that ffprobe validates. Generates the
// media (cached in .cache/media), serves it from a real socket and checks with ffprobe/ffmpeg:
// - every live channel as TS: codecs, sizes, audio languages; 14 s decoded across a lap
//   boundary with no warnings (timestamps and continuity counters are seamless);
// - live HLS and catch-up (TS and HLS): exact packet counts for the requested window;
// - every movie and episode: codecs, track languages, subtitles, duration; 14 s decoded cleanly.
// Needs ffmpeg + ffprobe on PATH. Not part of `pnpm test`: run `pnpm test:media` (or
// `pnpm verify:media`); CI runs it in the `media` job.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/config';
import type { FileManifestEntry } from '../src/file-media';
import { FileMedia } from '../src/file-media';
import { DEFAULT_MEDIA_DIR, findTool, generateMedia } from '../src/media-gen';
import type { MockServer } from '../src/server';
import { buildServer } from '../src/server';

const exec = promisify(execFile);
const dir = process.env['MOCK_MEDIA_DIR'] ?? DEFAULT_MEDIA_DIR;
const catalog = loadCatalog();
const LAP = 10;
/** Pinned clock: 1 s into the last segment of a lap, so live crosses a lap boundary 5 s in. */
const SEQ = 296_000_000 + LAP - 1;
const NOW = (SEQ * 6 + 1) * 1000;
const AUTH = 'lablo/lablo-test';

interface Stream {
  codec_type: string;
  codec_name: string;
  codec_tag_string?: string;
  width?: number;
  height?: number;
  channels?: number;
  avg_frame_rate?: string;
  nb_read_packets?: string;
  tags?: { language?: string };
}
interface Probe {
  streams: Stream[];
  format: { duration?: string; format_name: string };
}

let ffprobe: string;
let ffmpeg: string;
let app: MockServer;
let base: string;
let media: FileMedia;

async function probe(path: string, extra: string[] = []): Promise<Probe> {
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', ...extra, `${base}${path}`], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as Probe;
}

/** Decodes `seconds` of video and audio; returns ffmpeg's warnings and errors (empty when clean). */
async function decodeWarnings(path: string, seconds?: number): Promise<string> {
  const args = ['-hide_banner', '-nostdin', '-v', 'warning', '-i', `${base}${path}`, '-map', '0:v?', '-map', '0:a?'];
  if (seconds !== undefined) args.push('-t', String(seconds));
  const { stderr } = await exec(ffmpeg, [...args, '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 });
  return stderr.trim();
}

const byType = (p: Probe, type: string): Stream[] => p.streams.filter((s) => s.codec_type === type);

beforeAll(async () => {
  const probeTool = findTool('ffprobe');
  const mpegTool = findTool('ffmpeg');
  if (!probeTool || !mpegTool) throw new Error('ffmpeg and ffprobe must be on PATH for the media tests (winget install Gyan.FFmpeg / apt-get install ffmpeg)');
  ffprobe = probeTool.bin;
  ffmpeg = mpegTool.bin;
  const result = await generateMedia({ catalog, outDir: dir, log: (line) => console.log(line) });
  console.log(`media: ${result.encoded.length} encoded, ${result.reused.length} reused in ${(result.ms / 1000).toFixed(1)} s`);
  media = new FileMedia({ dir, now: () => NOW, liveSpeed: 50 });
  app = await buildServer({ now: () => NOW, labLogDir: null, media });
  base = await app.listen({ port: 0, host: '127.0.0.1' });
}, 15 * 60_000);

afterAll(async () => {
  await app?.close();
});

describe('live channels (TS)', () => {
  for (const channel of catalog.live) {
    it(`${channel.id} ${channel.media}: streams match the plan and 14 s decode cleanly across a lap`, async () => {
      const entry = media.manifest.live[String(channel.id)]!;
      const p = await probe(`/live/${AUTH}/${channel.id}.ts`);
      expect(p.format.format_name).toBe('mpegts');
      const video = byType(p, 'video');
      if (entry.video) {
        expect(video).toHaveLength(1);
        expect(video[0]).toMatchObject({ codec_name: 'h264', width: entry.video.width, height: entry.video.height, avg_frame_rate: `${entry.video.fps}/1` });
      } else {
        expect(video).toHaveLength(0);
      }
      const audio = byType(p, 'audio');
      expect(audio.map((a) => a.codec_name)).toEqual(entry.audio.map((a) => a.codec));
      expect(audio.map((a) => a.tags?.language)).toEqual(entry.audio.map((a) => a.lang));
      expect(await decodeWarnings(`/live/${AUTH}/${channel.id}.ts`, 14)).toBe('');
    });
  }
});

describe('live HLS and catch-up', () => {
  it('decodes the sliding-window HLS playlist cleanly', async () => {
    const p = await probe(`/live/${AUTH}/104.m3u8`);
    expect(byType(p, 'audio').map((a) => a.tags?.language)).toEqual(['ara', 'eng']);
    expect(await decodeWarnings(`/live/${AUTH}/101.m3u8`, 12)).toBe('');
  });

  const start = (SEQ - 100) * 6;
  it.each([
    ['flussonic archive TS', `/flussonic/${AUTH}/106/archive-${start}-120.ts`, 50],
    ['flussonic archive HLS', `/flussonic/${AUTH}/106/index-${start}-120.m3u8`, 50],
    ['catchup="default" TS', `/catchup/${AUTH}/102.ts?start=${start}&end=${start + 120}`, 25],
  ])('%s holds exactly the requested 120 s', async (_name, path, fps) => {
    const p = await probe(path, ['-count_packets', '-select_streams', 'v:0']);
    expect(Number(p.streams[0]!.nb_read_packets)).toBe(120 * fps);
    expect(await decodeWarnings(path)).toBe('');
  });
});

describe('VOD and episodes', () => {
  const items = [
    ...catalog.movies.map((m) => ({ kind: 'movie' as const, id: m.id, ext: m.ext, duration: m.durationSecs, path: `/movie/${AUTH}/${m.id}.${m.ext}` })),
    ...catalog.series.flatMap((s) =>
      s.seasons.flatMap((season) =>
        season.episodes.map((e) => ({ kind: 'episode' as const, id: e.id, ext: e.ext, duration: e.durationSecs, path: `/series/${AUTH}/${e.id}.${e.ext}` })),
      ),
    ),
  ];
  for (const item of items) {
    it(`${item.kind} ${item.id}.${item.ext}: tracks, languages and duration`, async () => {
      const entry: FileManifestEntry = media.manifest.files[`${item.kind}:${item.id}`]!;
      const p = await probe(item.path);
      expect(Number(p.format.duration)).toBeCloseTo(item.duration, -0.5); // within ~1.5 s
      const film = entry.openMovie ? media.openMovies[entry.openMovie] : undefined;
      if (film) {
        // The real Blender film (pnpm mock:open-movies): just a playable video with sound.
        expect(byType(p, 'video')).toHaveLength(1);
        expect(byType(p, 'audio').length).toBeGreaterThan(0);
      } else {
        const video = byType(p, 'video');
        expect(video).toHaveLength(1);
        expect(video[0]).toMatchObject({ codec_name: entry.video.codec, width: entry.video.width, height: entry.video.height });
        if (entry.video.codec === 'hevc' && entry.ext === 'mp4') expect(video[0]!.codec_tag_string).toBe('hvc1');
        const audio = byType(p, 'audio');
        expect(audio.map((a) => `${a.codec_name}:${a.channels}:${a.tags?.language}`)).toEqual(entry.audio.map((a) => `${a.codec}:${a.channels}:${a.lang}`));
        const subs = byType(p, 'subtitle');
        expect(subs.map((s) => `${s.codec_name}:${s.tags?.language}`)).toEqual(entry.subtitles.map((s) => `${s.codec}:${s.lang}`));
      }
      expect(await decodeWarnings(item.path, 14)).toBe('');
    });
  }

  it('covers the formats the plan promises: 4K HEVC, 5.1 AC3 and E-AC3, SRT in MKV, mov_text in MP4', () => {
    const entries = Object.values(media.manifest.files);
    expect(entries.some((e) => e.video.codec === 'hevc' && e.video.width === 3840)).toBe(true);
    const audio = entries.flatMap((e) => e.audio);
    expect(audio.some((a) => a.codec === 'ac3' && a.channels === 6)).toBe(true);
    expect(audio.some((a) => a.codec === 'eac3' && a.channels === 6)).toBe(true);
    expect(new Set(audio.map((a) => a.lang))).toEqual(new Set(['ara', 'eng', 'spa']));
    expect(entries.some((e) => e.ext === 'mkv' && e.subtitles.some((s) => s.codec === 'subrip' && s.lang === 'ara'))).toBe(true);
    expect(entries.some((e) => e.ext === 'mp4' && e.subtitles.some((s) => s.codec === 'mov_text' && s.lang === 'eng'))).toBe(true);
  });
});
