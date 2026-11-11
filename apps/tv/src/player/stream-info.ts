import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Container, PlayerEngine, StreamStats } from '@lablo/player';
import type { Timers } from '../live/live-state';

/**
 * The stream info (RELAY step 20c2a, architecture.md §2 "Built in step 20c2a"): a panel the info
 * bar's "Stream info" button turns on and off. While it shows, the player's `stats()` is read
 * every `STATS_MS`:
 * - the picture size, the codecs, the audio channels and the engine are shown as they are read;
 * - the frame rate and the bitrate are measured from the engine's counters (the `<video>` counts
 *   frames and bytes), between the first and the last of the recent readings of one load. A new
 *   load (a zap, a retry), or counters that went back, start the measure again;
 * - a bitrate the stream declares (AVPlay) wins over a measured one.
 */

/** The panel reads the player's figures this often while it shows. */
export const STATS_MS = 1000;
/** The rates are measured over the last readings of a load, at most this many (5 s from the first to the last). */
export const RATE_READINGS = 6;

/** What the panel shows; each figure `null` (or '') when the engine doesn't say. */
export interface StreamInfo {
  readonly width: number;
  readonly height: number;
  /** Frames per second, measured. */
  readonly fps: number | null;
  /** Bits per second: the stream's own, else measured. */
  readonly bitrate: number | null;
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly audioChannels: number | null;
  readonly droppedFrames: number | null;
  readonly engine: PlayerEngine['kind'];
}

/** One reading of the engine's counters. */
export interface Reading {
  readonly time: number;
  readonly frames: number | null;
  readonly bytes: number | null;
}

/** Counts per second from `first` to `last` over `ms`; `null` when either is missing. */
function perSecond(first: number | null, last: number | null, ms: number): number | null {
  return first === null || last === null ? null : ((last - first) * 1000) / ms;
}

/** The panel's figures from the latest stats and the readings of its load (oldest first, the latest last). */
export function streamInfo(stats: StreamStats, readings: readonly Reading[]): StreamInfo {
  const first = readings[0];
  const last = readings[readings.length - 1];
  let fps: number | null = null;
  let bytes: number | null = null;
  if (first !== undefined && last !== undefined && last.time > first.time) {
    fps = perSecond(first.frames, last.frames, last.time - first.time);
    bytes = perSecond(first.bytes, last.bytes, last.time - first.time);
  }
  return {
    width: stats.width,
    height: stats.height,
    fps,
    bitrate: stats.bitrate !== null ? stats.bitrate : bytes === null ? null : bytes * 8,
    videoCodec: stats.videoCodec,
    audioCodec: stats.audioCodec,
    audioChannels: stats.audioChannels,
    droppedFrames: stats.droppedFrames,
    engine: stats.engine,
  };
}

/** A counter that went back (the engine opened the stream again). */
function fell(now: number | null, before: number | null): boolean {
  return now !== null && before !== null && now < before;
}

export interface StreamInfoPanel {
  /** The panel is on. */
  readonly shown: ReadonlySignal<boolean>;
  /** The latest figures; `null` while the stream shows no picture. */
  readonly info: ReadonlySignal<StreamInfo | null>;
  /** Turns the panel on (read at once, then every `STATS_MS`) or off. */
  toggle(): void;
  hide(): void;
}

export interface StreamInfoOptions {
  /** The player's figures (`PlayerController.stats`); `null` while no picture shows. */
  readonly stats: () => StreamStats | null;
  readonly timers: Timers;
  /** The clock the rates are measured by (ms). */
  readonly now?: () => number;
}

export function createStreamInfo(options: StreamInfoOptions): StreamInfoPanel {
  const { timers } = options;
  const now = options.now ?? (() => Date.now());
  const shown = signal(false);
  const info = signal<StreamInfo | null>(null);
  let readings: Reading[] = [];
  let load = 0;
  let timer: unknown = null;

  const read = (): void => {
    const stats = options.stats();
    if (stats === null) {
      readings = [];
      info.value = null;
      return;
    }
    const reading: Reading = { time: now(), frames: stats.decodedFrames, bytes: stats.decodedBytes };
    const before = readings[readings.length - 1];
    if (stats.load !== load || (before !== undefined && (fell(reading.frames, before.frames) || fell(reading.bytes, before.bytes)))) readings = [];
    load = stats.load;
    readings.push(reading);
    if (readings.length > RATE_READINGS) readings.shift();
    info.value = streamInfo(stats, readings);
  };

  const tick = (): void => {
    timer = timers.set(() => {
      read();
      tick();
    }, STATS_MS);
  };

  const hide = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    readings = [];
    shown.value = false;
    info.value = null;
  };

  return {
    shown,
    info,
    toggle(): void {
      if (shown.value) {
        hide();
        return;
      }
      shown.value = true;
      read();
      tick();
    },
    hide,
  };
}

/** The container's name on the panel ('' for a URL that names none). */
const CONTAINER_NAMES: Readonly<Record<Container, string>> = { ts: 'MPEG-TS', hls: 'HLS', mp4: 'MP4', mkv: 'MKV', other: '' };
const ENGINE_NAMES: Readonly<Record<PlayerEngine['kind'], string>> = { avplay: 'AVPlay', html5: 'HTML5', mse: 'MSE' };

export function containerName(container: Container | null): string {
  return container === null ? '' : CONTAINER_NAMES[container];
}

export function engineName(engine: PlayerEngine['kind']): string {
  return ENGINE_NAMES[engine];
}

/** `1920×1080`; '' before a picture. */
export function pictureSize(info: StreamInfo): string {
  return info.width > 0 && info.height > 0 ? `${info.width}×${info.height}` : '';
}

/** The audio's codec and layout: `AAC · 2.0`, `E-AC3 · 5.1`; '' when neither is known. */
export function audioText(info: StreamInfo): string {
  const channels = info.audioChannels;
  const layout = channels === null ? '' : channels === 6 ? '5.1' : channels === 8 ? '7.1' : `${channels}.0`;
  return info.audioCodec !== '' && layout !== '' ? `${info.audioCodec} · ${layout}` : info.audioCodec + layout;
}

/** A bitrate in Mb/s with one decimal from 1 Mb/s up, else in whole kb/s. */
export function bitrateUnits(bps: number): { readonly unit: 'mbps' | 'kbps'; readonly value: number } {
  return bps >= 1_000_000 ? { unit: 'mbps', value: Math.round(bps / 100_000) / 10 } : { unit: 'kbps', value: Math.round(bps / 1000) };
}
