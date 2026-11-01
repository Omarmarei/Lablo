// Pluggable media behind the stream endpoints. PlaceholderMedia sends bytes with the right
// shapes (MPEG-TS packets, ranged files, endless live) and nothing decodes; FileMedia
// (file-media.ts) serves the ffmpeg test channels and files from `pnpm mock:media` and the
// Blender open movies, and falls back to PlaceholderMedia for whatever it lacks.

import { Readable } from 'node:stream';

export const TS_PACKET_SIZE = 188;
/** HLS segment length. Segment `seq` covers epoch seconds [seq * 6, seq * 6 + 6). */
export const HLS_SEGMENT_SECONDS = 6;

const CONTENT_TYPES: Record<string, string> = {
  ts: 'video/mp2t',
  m3u8: 'application/vnd.apple.mpegurl',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

export interface MediaFile {
  size: number;
  contentType: string;
  /** Bytes [start, endInclusive]. */
  read(start: number, endInclusive: number): Readable;
}

export interface MediaSource {
  /** `placeholder` or `files` (shown by /__mock/health). */
  readonly kind: string;
  /** Live MPEG-TS for a channel; endless unless the source is configured otherwise. */
  liveTs(channelId: number): Readable;
  /** One live or archive HLS segment (MPEG-TS). */
  hlsSegment(channelId: number, seq: number): Buffer;
  /** Catch-up MPEG-TS for a window of a channel. */
  archiveTs(channelId: number, startSec: number, durationSec: number): Readable;
  /** A VOD movie or series episode, or `undefined` when there is no media for it. */
  file(kind: 'movie' | 'episode', id: number, ext: string): MediaFile | undefined;
}

/**
 * MPEG-TS null packets (PID 0x1FFF): valid TS framing that demuxers skip. The payload carries an
 * ASCII label so a captured byte dump says what it was.
 */
export function tsPackets(count: number, label: string): Buffer {
  const buf = Buffer.alloc(count * TS_PACKET_SIZE, 0xff);
  const text = Buffer.from(label.slice(0, 180), 'ascii');
  for (let i = 0; i < count; i++) {
    const o = i * TS_PACKET_SIZE;
    buf[o] = 0x47;
    buf[o + 1] = 0x1f;
    buf[o + 2] = 0xff;
    buf[o + 3] = 0x10 | (i & 0x0f);
    text.copy(buf, o + 4);
  }
  return buf;
}

export interface PlaceholderOptions {
  /** Live pacing: one chunk every `liveIntervalMs` (default 100 ms, about 1 Mbit/s). */
  liveIntervalMs?: number;
  livePacketsPerChunk?: number;
  /** Ends live streams after this many bytes (tests); endless when unset. */
  liveLimitBytes?: number;
  packetsPerSegment?: number;
  /** Placeholder VOD size; each file adds its id so sizes differ. */
  fileBaseSize?: number;
}

export class PlaceholderMedia implements MediaSource {
  readonly kind = 'placeholder';
  private readonly intervalMs: number;
  private readonly packetsPerChunk: number;
  private readonly limit: number | undefined;
  private readonly packetsPerSegment: number;
  private readonly fileBaseSize: number;

  constructor(options: PlaceholderOptions = {}) {
    this.intervalMs = options.liveIntervalMs ?? 100;
    this.packetsPerChunk = options.livePacketsPerChunk ?? 70;
    this.limit = options.liveLimitBytes;
    this.packetsPerSegment = options.packetsPerSegment ?? 64;
    this.fileBaseSize = options.fileBaseSize ?? 1024 * 1024;
  }

  liveTs(channelId: number): Readable {
    const chunk = tsPackets(this.packetsPerChunk, `ZOMA MOCK LIVE ch=${channelId}`);
    const { limit, intervalMs } = this;
    let sent = 0;
    let timer: NodeJS.Timeout | undefined;
    const stream = new Readable({
      // Paced by the timer, not by demand: a live channel keeps its own clock.
      read() {
        if (timer) return;
        push();
        timer = setInterval(push, intervalMs);
        timer.unref();
      },
      destroy(error, callback) {
        clearInterval(timer);
        callback(error);
      },
    });
    function push(): void {
      if (limit !== undefined && sent >= limit) {
        clearInterval(timer);
        stream.push(null);
        return;
      }
      const part = limit === undefined ? chunk : chunk.subarray(0, Math.min(chunk.length, limit - sent));
      sent += part.length;
      stream.push(part);
    }
    return stream;
  }

  hlsSegment(channelId: number, seq: number): Buffer {
    return tsPackets(this.packetsPerSegment, `ZOMA MOCK HLS ch=${channelId} seq=${seq} t=${seq * HLS_SEGMENT_SECONDS}`);
  }

  archiveTs(channelId: number, startSec: number, durationSec: number): Readable {
    return Readable.from([tsPackets(this.packetsPerSegment, `ZOMA MOCK ARCHIVE ch=${channelId} start=${startSec} dur=${durationSec}`)]);
  }

  file(_kind: 'movie' | 'episode', id: number, ext: string): MediaFile {
    return {
      size: this.fileBaseSize + id,
      contentType: contentTypeFor(ext),
      read: (start, end) => Readable.from(patternBytes(id, start, end), { objectMode: false }),
    };
  }
}

/** Deterministic file bytes: byte at offset o is (o * 31 + id) & 0xff, so a range is checkable. */
export function patternByte(id: number, offset: number): number {
  return (offset * 31 + id) & 0xff;
}

function* patternBytes(id: number, start: number, end: number): Generator<Buffer> {
  const CHUNK = 64 * 1024;
  for (let from = start; from <= end; from += CHUNK) {
    const to = Math.min(end, from + CHUNK - 1);
    const buf = Buffer.allocUnsafe(to - from + 1);
    for (let i = 0; i < buf.length; i++) buf[i] = patternByte(id, from + i);
    yield buf;
  }
}
