// FileMedia against a synthetic media folder (no ffmpeg): manifest lookups, fallbacks, live
// pacing and limits, HLS/archive alignment, VOD files by extension and the open-movie switch.
// The real ffmpeg output is validated with ffprobe in ffprobe.media.test.ts (pnpm verify:media).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaManifest } from '../src/file-media';
import { FileMedia } from '../src/file-media';
import type { MockServer } from '../src/server';
import { NOW, mock } from './helpers';
import { VIDEO_PID, syntheticSegment, timestamps } from './ts-helpers';

let dir: string;
const SEGMENTS = 3;

function writeLoop(name: string): void {
  mkdirSync(join(dir, 'live', name), { recursive: true });
  for (let i = 0; i < SEGMENTS; i++) writeFileSync(join(dir, 'live', name, `seg-${i}.ts`), syntheticSegment(i));
}

const loopEntry = (name: string) => ({ dir: `live/${name}`, segments: SEGMENTS, segmentSeconds: 6, video: null, audio: [] });
const fileEntry = (path: string, ext: string, openMovie?: string) => ({
  path,
  ext,
  durationSecs: 60,
  video: { codec: 'h264', width: 640, height: 360, fps: 25 },
  audio: [],
  subtitles: [],
  ...(openMovie ? { openMovie } : {}),
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lablo-file-media-'));
  writeLoop('ch101');
  writeLoop('generic');
  mkdirSync(join(dir, 'files'));
  mkdirSync(join(dir, 'open-movies'));
  writeFileSync(join(dir, 'files', 'm205.mp4'), Buffer.from('MOVIE-205-BYTES'));
  writeFileSync(join(dir, 'files', 'm201.mp4'), Buffer.from('STAND-IN-201'));
  writeFileSync(join(dir, 'files', 'm202.mkv'), Buffer.from('STAND-IN-202'));
  writeFileSync(join(dir, 'files', 'g.mkv'), Buffer.from('GENERIC-MKV'));
  writeFileSync(join(dir, 'open-movies', 'big-buck-bunny.mp4'), Buffer.from('THE-REAL-FILM'));
  const manifest: MediaManifest = {
    version: 1,
    generatedAt: '2026-11-02T00:00:00Z',
    ffmpeg: 'test',
    font: null,
    live: { '101': loopEntry('ch101'), generic: loopEntry('generic') },
    files: {
      'movie:205': fileEntry('files/m205.mp4', 'mp4'),
      'movie:201': fileEntry('files/m201.mp4', 'mp4', 'big-buck-bunny'),
      'movie:202': fileEntry('files/m202.mkv', 'mkv', 'sintel'),
      'generic:mkv': fileEntry('files/g.mkv', 'mkv'),
    },
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'open-movies', 'manifest.json'), JSON.stringify({ 'big-buck-bunny': { path: 'big-buck-bunny.mp4', ext: 'mp4', sha256: 'x', bytes: 13 } }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const media = (options: Partial<ConstructorParameters<typeof FileMedia>[0]> = {}): FileMedia => new FileMedia({ dir, now: () => NOW, ...options });

/** Everything the stream sends until it ends, or until `maxMs` (then it is destroyed). */
function collect(stream: Readable, maxMs = 5000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const done = (): void => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => {
      stream.destroy();
      done();
    }, maxMs);
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', done);
    stream.on('error', reject);
  });
}

const seqNow = Math.floor(NOW / 1000 / 6);
const firstPcr = (buf: Buffer): number => timestamps(buf).find((t) => t.pcr !== undefined)!.pcr!;

describe('FileMedia', () => {
  it('opens only folders with a manifest', () => {
    expect(FileMedia.open({ dir })).toBeInstanceOf(FileMedia);
    expect(FileMedia.open({ dir: join(dir, 'files') })).toBeUndefined();
    expect(media().kind).toBe('files');
  });

  it('serves HLS segment seq with timestamps for epoch second seq × 6, from the generic loop when a channel has none', () => {
    const m = media();
    expect(firstPcr(m.hlsSegment(101, seqNow))).toBe((seqNow * 6 * 90_000) % 2 ** 33);
    expect(m.hlsSegment(999, seqNow).equals(m.hlsSegment(101, seqNow))).toBe(true); // same synthetic loop bytes
    expect(m.loop(999)).toBe(m.loop(12345));
    expect(m.loop(101)).not.toBe(m.loop(999));
  });

  it('starts live at the current segment, bursts it, then paces the rest', async () => {
    const m = media({ liveSpeed: 20, liveLimitBytes: syntheticSegment(0).length * 2 });
    const started = Date.now();
    const body = await collect(m.liveTs(101));
    expect(body.length).toBe(syntheticSegment(0).length * 2);
    expect(firstPcr(body)).toBe((seqNow * 6 * 90_000) % 2 ** 33);
    // The second segment is paced over 6 s / 20 = 300 ms (timer granularity aside).
    expect(Date.now() - started).toBeGreaterThanOrEqual(270);
    const pts = timestamps(body).filter((t) => t.pid === VIDEO_PID && t.pts !== undefined);
    expect(pts.at(-1)!.dts! - pts[0]!.dts!).toBe(11 * 90_000);
  });

  it('is endless without a limit', async () => {
    const stream = media({ liveSpeed: 1000 }).liveTs(101);
    const body = await collect(stream, 400);
    // More than the burst: it kept going until we hung up.
    expect(body.length).toBeGreaterThan(syntheticSegment(0).length * 1.5);
    expect(stream.destroyed).toBe(true);
  });

  it('serves a catch-up window as whole segments, unpaced', async () => {
    const m = media();
    const start = (seqNow - 100) * 6 + 2; // mid-segment start: the segment that holds it is included
    const body = await collect(m.archiveTs(101, start, 13));
    expect(body.length).toBe(syntheticSegment(0).length * 3);
    expect(firstPcr(body)).toBe(((seqNow - 100) * 6 * 90_000) % 2 ** 33);
  });

  it('serves VOD by extension: own file, generic file, open movie when fetched, else the stand-in', async () => {
    const m = media();
    const read = async (kind: 'movie' | 'episode', id: number, ext: string): Promise<string | undefined> => {
      const f = m.file(kind, id, ext);
      return f ? (await collect(f.read(0, f.size - 1))).toString() : undefined;
    };
    expect(await read('movie', 205, 'mp4')).toBe('MOVIE-205-BYTES');
    expect(await read('movie', 205, 'mkv')).toBeUndefined(); // listed as mp4: other extensions 404
    expect(await read('movie', 201, 'mp4')).toBe('THE-REAL-FILM');
    expect(await read('movie', 202, 'mkv')).toBe('STAND-IN-202'); // sintel not fetched
    expect(await read('episode', 9999, 'mkv')).toBe('GENERIC-MKV');
    const f = m.file('movie', 205, 'mp4')!;
    expect(f.contentType).toBe('video/mp4');
    expect((await collect(f.read(6, 8))).toString()).toBe('205');
    // No generated media at all for this id and extension: placeholder bytes.
    expect(m.file('episode', 9999, 'avi')?.size).toBe(1024 * 1024 + 9999);
  });

  it('plugs into the server: health shows the media, HLS and VOD answer from files', async () => {
    const app: MockServer = await mock({ media: media() });
    try {
      expect((await app.inject({ url: '/__mock/health' })).json()).toMatchObject({ media: 'files' });
      const seg = await app.inject({ url: `/hls/lablo/lablo-test/101/${seqNow - 1}.ts` });
      expect(seg.statusCode).toBe(200);
      expect(firstPcr(seg.rawPayload)).toBe(((seqNow - 1) * 6 * 90_000) % 2 ** 33);
      const vod = await app.inject({ url: '/movie/lablo/lablo-test/205.mp4', headers: { range: 'bytes=0-4' } });
      expect(vod.statusCode).toBe(206);
      expect(vod.body).toBe('MOVIE');
      expect((await app.inject({ url: '/movie/lablo/lablo-test/205.mkv' })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
