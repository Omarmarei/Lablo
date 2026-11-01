// The real media source (RELAY step 4): serves what `pnpm mock:media` generated and, when
// fetched, the Blender open movies. Anything it has no media for falls back to placeholder
// bytes, so the mock works with a partial cache, a scale catalog or no cache at all.
//
// - Live TS: the channel's 60 s loop, placed on the epoch timeline (ts-rewrite.ts) and paced
//   at real-time speed after a one-segment burst, like a restreamer's initial buffer. Endless.
// - HLS segment `seq`: the same bytes the TS carries for epoch seconds [seq × 6, seq × 6 + 6).
// - Catch-up: the segments of the window, back to back, unpaced (a download, like an archive).
// - VOD and episodes: the generated file when the requested extension matches it.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { MediaFile, MediaSource } from './media';
import { HLS_SEGMENT_SECONDS, PlaceholderMedia, contentTypeFor } from './media';
import { LoopChannel } from './ts-rewrite';

export const MANIFEST_FILE = 'manifest.json';
export const OPEN_MOVIES_DIR = 'open-movies';

interface TrackInfo {
  lang: string;
  codec: string;
  channels: number;
}

interface VideoInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
}

export interface LiveManifestEntry {
  /** Folder (relative to the media folder) with seg-0.ts … seg-N.ts. */
  dir: string;
  segments: number;
  segmentSeconds: number;
  video: VideoInfo | null;
  audio: TrackInfo[];
}

export interface FileManifestEntry {
  /** File path relative to the media folder. */
  path: string;
  ext: string;
  durationSecs: number;
  video: VideoInfo;
  audio: TrackInfo[];
  subtitles: { lang: string; codec: string }[];
  /** A stand-in for this open movie, replaced by the film once it is fetched. */
  openMovie?: string;
}

export interface MediaManifest {
  version: 1;
  generatedAt: string;
  ffmpeg: string;
  font: string | null;
  /** By channel id, plus `generic` for every channel without its own loop. */
  live: Record<string, LiveManifestEntry>;
  /** By `movie:<id>` / `episode:<id>`, plus `generic:mp4` and `generic:mkv`. */
  files: Record<string, FileManifestEntry>;
}

/** open-movies/manifest.json, written by `pnpm mock:open-movies`. */
export type OpenMoviesManifest = Record<string, { path: string; ext: string; sha256: string; bytes: number }>;

export interface FileMediaOptions {
  /** The media folder (with manifest.json). */
  dir: string;
  now?: () => number;
  /** Live pacing multiplier: 1 = real time (default); tests speed it up. */
  liveSpeed?: number;
  /** Ends live streams after this many bytes (tests); endless when unset. */
  liveLimitBytes?: number;
  /** Serves everything the manifest lacks (default: PlaceholderMedia). */
  fallback?: MediaSource;
}

/** Chunks per segment when pacing live (one every segmentSeconds / CHUNKS). */
const LIVE_CHUNKS_PER_SEGMENT = 20;

export class FileMedia implements MediaSource {
  readonly kind = 'files';
  readonly manifest: MediaManifest;
  readonly openMovies: OpenMoviesManifest;
  private readonly dir: string;
  private readonly now: () => number;
  private readonly liveSpeed: number;
  private readonly liveLimit: number | undefined;
  private readonly fallback: MediaSource;
  private readonly loops = new Map<string, LoopChannel>();

  constructor(options: FileMediaOptions) {
    this.dir = options.dir;
    const manifestPath = join(options.dir, MANIFEST_FILE);
    this.manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as MediaManifest;
    if (this.manifest.version !== 1) throw new Error(`${manifestPath}: unsupported manifest version ${String(this.manifest.version)}`);
    const openPath = join(options.dir, OPEN_MOVIES_DIR, MANIFEST_FILE);
    this.openMovies = existsSync(openPath) ? (JSON.parse(readFileSync(openPath, 'utf8')) as OpenMoviesManifest) : {};
    this.now = options.now ?? Date.now;
    this.liveSpeed = options.liveSpeed ?? 1;
    this.liveLimit = options.liveLimitBytes;
    this.fallback = options.fallback ?? new PlaceholderMedia({ liveLimitBytes: options.liveLimitBytes });
  }

  /** A FileMedia for `dir`, or undefined when it has no manifest (media never generated). */
  static open(options: FileMediaOptions): FileMedia | undefined {
    return existsSync(join(options.dir, MANIFEST_FILE)) ? new FileMedia(options) : undefined;
  }

  /** The loop for a channel: its own, else the generic one, else undefined. */
  loop(channelId: number): LoopChannel | undefined {
    const key = this.manifest.live[String(channelId)] ? String(channelId) : this.manifest.live['generic'] ? 'generic' : undefined;
    if (key === undefined) return undefined;
    let loop = this.loops.get(key);
    if (!loop) {
      const entry = this.manifest.live[key]!;
      if (entry.segmentSeconds !== HLS_SEGMENT_SECONDS) throw new Error(`${entry.dir}: segments must be ${HLS_SEGMENT_SECONDS} s`);
      const segments = Array.from({ length: entry.segments }, (_, i) => readFileSync(join(this.dir, entry.dir, `seg-${i}.ts`)));
      loop = new LoopChannel(segments, entry.segmentSeconds);
      this.loops.set(key, loop);
    }
    return loop;
  }

  liveTs(channelId: number): Readable {
    const loop = this.loop(channelId);
    if (!loop) return this.fallback.liveTs(channelId);
    let seq = Math.floor(this.now() / 1000 / HLS_SEGMENT_SECONDS);
    const limit = this.liveLimit;
    const tickMs = (loop.segmentSeconds * 1000) / LIVE_CHUNKS_PER_SEGMENT / this.liveSpeed;
    let sent = 0;
    let pending: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    const stream = new Readable({
      read() {
        if (timer) return;
        // A one-segment burst (the restreamer's initial buffer), then real-time pacing.
        pushBytes(loop.segment(seq++));
        timer = setInterval(tick, tickMs);
        timer.unref();
      },
      destroy(error, callback) {
        clearInterval(timer);
        callback(error);
      },
    });
    function pushBytes(buf: Buffer): void {
      if (limit !== undefined && sent >= limit) return;
      const part = limit === undefined ? buf : buf.subarray(0, Math.min(buf.length, limit - sent));
      sent += part.length;
      stream.push(part);
      if (limit !== undefined && sent >= limit) {
        clearInterval(timer);
        stream.push(null);
      }
    }
    function tick(): void {
      if (pending.length === 0) {
        // Exactly LIVE_CHUNKS_PER_SEGMENT chunks on packet boundaries, so a segment takes its
        // real duration whatever its size (a chunk may be empty for tiny segments).
        const seg = loop!.segment(seq++);
        const packets = seg.length / 188;
        pending = Array.from({ length: LIVE_CHUNKS_PER_SEGMENT }, (_, i) =>
          seg.subarray(Math.floor((i * packets) / LIVE_CHUNKS_PER_SEGMENT) * 188, Math.floor(((i + 1) * packets) / LIVE_CHUNKS_PER_SEGMENT) * 188),
        );
      }
      const chunk = pending.shift()!;
      if (chunk.length > 0) pushBytes(chunk);
    }
    return stream;
  }

  hlsSegment(channelId: number, seq: number): Buffer {
    const loop = this.loop(channelId);
    return loop ? loop.segment(seq) : this.fallback.hlsSegment(channelId, seq);
  }

  archiveTs(channelId: number, startSec: number, durationSec: number): Readable {
    const loop = this.loop(channelId);
    if (!loop) return this.fallback.archiveTs(channelId, startSec, durationSec);
    const first = Math.floor(startSec / HLS_SEGMENT_SECONDS);
    const last = Math.max(first, Math.ceil((startSec + durationSec) / HLS_SEGMENT_SECONDS) - 1);
    function* segments(): Generator<Buffer> {
      for (let seq = first; seq <= last; seq++) yield loop!.segment(seq);
    }
    return Readable.from(segments(), { objectMode: false });
  }

  /** Path of the media for a movie or episode, or undefined (then the fallback serves it). */
  filePath(kind: 'movie' | 'episode', id: number, ext: string): string | undefined {
    const entry = this.manifest.files[`${kind}:${id}`];
    const e = ext.toLowerCase();
    if (entry) {
      if (entry.openMovie) {
        const film = this.openMovies[entry.openMovie];
        if (film && film.ext === entry.ext && existsSync(join(this.dir, OPEN_MOVIES_DIR, film.path))) {
          return e === film.ext ? join(this.dir, OPEN_MOVIES_DIR, film.path) : undefined;
        }
      }
      return e === entry.ext ? join(this.dir, entry.path) : undefined;
    }
    const generic = this.manifest.files[`generic:${e}`];
    return generic ? join(this.dir, generic.path) : undefined;
  }

  file(kind: 'movie' | 'episode', id: number, ext: string): MediaFile | undefined {
    const ownEntry = this.manifest.files[`${kind}:${id}`];
    const path = this.filePath(kind, id, ext);
    if (!path) return ownEntry ? undefined : this.fallback.file(kind, id, ext);
    const size = statSync(path).size;
    return {
      size,
      contentType: contentTypeFor(ext),
      read: (start, end) => createReadStream(path, { start, end }),
    };
  }
}
