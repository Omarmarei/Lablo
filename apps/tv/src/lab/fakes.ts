/**
 * Test doubles for the lab's player batteries (RELAY steps 15c and 15c2): a clock the checks'
 * sleeps move (with interval timers on it), and a scripted AVPlay on that clock. Only tests import
 * this module; the lab's bundles never reach it.
 */
import type { AvplayError, AvplayListener, AvplayManager, AvplayStreamInfo } from '@zoma/platform-tizen';
import type { AvplayRect, AvplayStage } from './avplay-player';
import type { BatteryClock } from './battery';
import type { LabMedia, LabMediaItem } from './media';
import type { VideoTimers } from './video-player';

/**
 * A clock the battery's sleeps move. On each sleep the interval timers fire at their own times
 * along the way, then every tick runs once at the end (the fake engines' timelines).
 */
export class FakeClock implements BatteryClock {
  t = 1000;
  readonly ticks: Array<(t: number) => void> = [];
  private readonly intervals = new Map<number, { handler: () => void; ms: number; next: number }>();
  private nextId = 1;

  now = (): number => this.t;

  sleep = (ms: number): Promise<void> => {
    this.advance(ms);
    return Promise.resolve();
  };

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let due: { handler: () => void; ms: number; next: number } | null = null;
      for (const timer of this.intervals.values()) if (timer.next <= end && (due === null || timer.next < due.next)) due = timer;
      if (due === null) break;
      this.t = due.next;
      due.next += due.ms;
      due.handler();
    }
    this.t = end;
    for (const tick of this.ticks.slice()) tick(this.t);
  }

  readonly timers: VideoTimers = {
    setInterval: (handler, ms) => {
      const id = this.nextId;
      this.nextId += 1;
      this.intervals.set(id, { handler, ms, next: this.t + ms });
      return id;
    },
    clearInterval: (id) => {
      this.intervals.delete(id);
    },
  };

  /** Interval timers still running. */
  get running(): number {
    return this.intervals.size;
  }
}

/** A stage that records its captions and whether it was removed. */
export function fakeAvplayStage(rect: AvplayRect = { x: 1112, y: 556, width: 768, height: 432 }): AvplayStage & { readonly captions: string[]; removed: number } {
  const stage = {
    captions: [] as string[],
    removed: 0,
    rect: () => rect,
    caption: (text: string) => {
      stage.captions.push(text);
    },
    remove: () => {
      stage.removed += 1;
    },
  };
  return stage;
}

/** How the fake AVPlay plays one open. */
export interface AvplayPlan {
  /** ms from `prepareAsync` to its answer; null: never (AVPlay's 302 freeze). */
  prepareAfterMs: number | null;
  /** The error callback instead of the success one. */
  prepareError?: AvplayError;
  /** ms from `play` to the clock moving (default 100); null: it never moves. */
  startAfterMs?: number | null;
  /** `onerror(name)` this long after `play`. */
  error?: { readonly afterMs: number; readonly name: string };
  /** The video stream's size (default 1920×1080); null: no video stream. */
  video?: { readonly width: number; readonly height: number } | null;
  audio?: ReadonlyArray<{ readonly lang: string; readonly codec: string; readonly channels: number }>;
  text?: ReadonlyArray<{ readonly lang: string; readonly codec: string }>;
  /** ms after the clock started moving when it stops (a stall). */
  stallAfterMs?: number;
  /** ms after the clock started moving when a VOD file ends (`onstreamcompleted`). */
  endAfterMs?: number;
  /** A subtitle callback this often while a text track is selected and not silenced (default 5000). */
  cueEveryMs?: number;
  /** ms from `restore` to the clock moving again (default 300). */
  restoreAfterMs?: number;
  /** `onerror(name)` right after the prepare succeeded, before any play. */
  readyError?: string;
  /** A switch that starts the stream over (the clock goes back to the start). */
  restartOnSwitch?: boolean;
}

const STREAM = (index: number, type: string, extra: Record<string, string>): AvplayStreamInfo => {
  const fields = Object.keys(extra).map((key) => `"${key}":"${extra[key] ?? ''}"`);
  return { index, type, extra_info: `{${fields.join(',')}}` };
};

class Thrown extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/**
 * A scripted `webapis.avplay` on a `FakeClock`: its state machine (NONE, IDLE, READY, PLAYING,
 * PAUSED), its callbacks on the clock's ticks, its streams in `extra_info` JSON, and every call
 * recorded. `throws` makes a method throw a `WebAPIException`-like error.
 */
export class FakeAvplay implements AvplayManager {
  readonly calls: string[] = [];
  readonly urls: string[] = [];
  readonly throws: { [method: string]: string } = {};
  state = 'NONE';
  plan: AvplayPlan = { prepareAfterMs: 100 };
  private listener: AvplayListener = {};
  private preparing: { at: number; ok?: () => void; error?: (e: AvplayError) => void } | null = null;
  private playAt: number | null = null;
  /** When the clock started moving, and from which position. */
  private movingAt: number | null = null;
  private base = 0;
  private errorSent = false;
  private ended = false;
  private lastTimeCallback = 0;
  private audioIndex = 1;
  private textIndex: number | null = null;
  private silent = true;
  private nextCue: number | null = null;
  private seek: { at: number; ms: number; ok?: () => void } | null = null;

  constructor(
    private readonly clock: FakeClock,
    private readonly script: (url: string, n: number) => AvplayPlan = () => ({ prepareAfterMs: 100 }),
  ) {
    clock.ticks.push((t) => this.tick(t));
  }

  private call(name: string, detail = ''): void {
    this.calls.push(detail === '' ? name : `${name} ${detail}`);
    const thrown = this.throws[name];
    if (thrown !== undefined) throw new Thrown(thrown, `${name} refused`);
  }

  private streams(): AvplayStreamInfo[] {
    const p = this.plan;
    const out: AvplayStreamInfo[] = [];
    let index = 0;
    const video = p.video === undefined ? { width: 1920, height: 1080 } : p.video;
    if (video !== null) out.push(STREAM(index++, 'VIDEO', { fourCC: 'H264', Width: String(video.width), Height: String(video.height) }));
    for (const a of p.audio ?? [{ lang: 'eng', codec: 'aac', channels: 2 }]) out.push(STREAM(index++, 'AUDIO', { language: a.lang, fourCC: a.codec.toUpperCase(), channels: String(a.channels) }));
    for (const t of p.text ?? []) out.push(STREAM(index++, 'TEXT', { track_lang: t.lang, fourCC: t.codec.toUpperCase(), subtitle_type: '0' }));
    return out;
  }

  /** The position now, from the plan's timeline. */
  position(t = this.clock.t): number {
    if (this.movingAt === null || t < this.movingAt) return this.base;
    const p = this.plan;
    let until = t;
    if (p.stallAfterMs !== undefined) until = Math.min(until, this.movingAt + p.stallAfterMs);
    if (p.endAfterMs !== undefined) until = Math.min(until, this.movingAt + p.endAfterMs);
    return this.base + Math.max(0, until - this.movingAt);
  }

  private tick(t: number): void {
    const p = this.plan;
    const prep = this.preparing;
    if (prep !== null && p.prepareAfterMs !== null && t - prep.at >= p.prepareAfterMs) {
      this.preparing = null;
      if (p.prepareError !== undefined) prep.error?.(p.prepareError);
      else {
        this.state = 'READY';
        this.listener.onbufferingcomplete?.();
        prep.ok?.();
        if (p.readyError !== undefined) this.listener.onerror?.(p.readyError);
      }
    }
    const seek = this.seek;
    if (seek !== null && t - seek.at >= 100) {
      this.seek = null;
      this.base = seek.ms;
      if (this.movingAt !== null) this.movingAt = t;
      seek.ok?.();
    }
    if (this.state !== 'PLAYING' || this.playAt === null) return;
    if (p.error !== undefined && !this.errorSent && t - this.playAt >= p.error.afterMs) {
      this.errorSent = true;
      this.listener.onerror?.(p.error.name);
    }
    if (this.movingAt === null) return;
    if (p.endAfterMs !== undefined && !this.ended && t - this.movingAt >= p.endAfterMs) {
      this.ended = true;
      this.listener.onstreamcompleted?.();
    }
    if (t >= this.movingAt && t - this.lastTimeCallback >= 500) {
      this.lastTimeCallback = t;
      this.listener.oncurrentplaytime?.(this.position(t));
    }
    if (this.textIndex !== null && !this.silent && this.nextCue !== null && t >= this.nextCue) {
      this.nextCue = t + (p.cueEveryMs ?? 5000);
      this.listener.onsubtitlechange?.('2000', 'English subtitle 00:05', '0', []);
    }
  }

  open(url: string): void {
    this.call('open');
    this.urls.push(url);
    this.plan = this.script(url, this.urls.length);
    this.state = 'IDLE';
    this.listener = {};
    this.preparing = null;
    this.playAt = null;
    this.movingAt = null;
    this.base = 0;
    this.errorSent = false;
    this.ended = false;
    this.lastTimeCallback = 0;
    this.audioIndex = this.plan.video === null ? 0 : 1;
    this.textIndex = null;
    this.silent = true;
    this.nextCue = null;
    this.seek = null;
  }
  close(): void {
    this.call('close');
    this.state = 'NONE';
    this.preparing = null;
    this.playAt = null;
    this.movingAt = null;
  }
  prepareAsync(onsuccess?: () => void, onerror?: (error: AvplayError) => void): void {
    this.call('prepareAsync');
    if (this.state !== 'IDLE') throw new Thrown('InvalidStateError', `prepareAsync in ${this.state}`);
    this.listener.onbufferingstart?.();
    this.preparing = { at: this.clock.t, ok: onsuccess, error: onerror };
  }
  setDisplayRect(x: number, y: number, width: number, height: number): void {
    this.call('setDisplayRect', `${x},${y},${width},${height}`);
  }
  setListener(listener: AvplayListener): void {
    this.call('setListener');
    this.listener = listener;
  }
  play(): void {
    this.call('play');
    if (this.state !== 'READY' && this.state !== 'PAUSED') throw new Thrown('InvalidStateError', `play in ${this.state}`);
    this.state = 'PLAYING';
    this.playAt = this.clock.t;
    const start = this.plan.startAfterMs === undefined ? 100 : this.plan.startAfterMs;
    this.movingAt = start === null ? null : this.clock.t + start;
    if (this.movingAt !== null) this.lastTimeCallback = this.movingAt - 500;
  }
  pause(): void {
    this.call('pause');
    this.state = 'PAUSED';
  }
  stop(): void {
    this.call('stop');
    if (this.state === 'NONE') throw new Thrown('InvalidStateError', 'stop in NONE');
    this.state = 'IDLE';
    this.playAt = null;
    this.movingAt = null;
  }
  seekTo(ms: number, onsuccess?: () => void): void {
    this.call('seekTo', String(ms));
    this.seek = { at: this.clock.t, ms, ok: onsuccess };
  }
  getState(): string {
    return this.state;
  }
  getCurrentTime(): number {
    if (this.state !== 'PLAYING' && this.state !== 'PAUSED') throw new Thrown('InvalidStateError', `getCurrentTime in ${this.state}`);
    return this.position();
  }
  getTotalTrackInfo(): readonly AvplayStreamInfo[] {
    if (this.state === 'NONE' || this.state === 'IDLE') throw new Thrown('InvalidStateError', `getTotalTrackInfo in ${this.state}`);
    return this.streams();
  }
  getCurrentStreamInfo(): readonly AvplayStreamInfo[] {
    if (this.state === 'NONE' || this.state === 'IDLE') throw new Thrown('InvalidStateError', `getCurrentStreamInfo in ${this.state}`);
    const all = this.streams();
    return all.filter((s) => s.type === 'VIDEO' || s.index === this.audioIndex || s.index === this.textIndex);
  }
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void {
    this.call('setSelectTrack', `${type} ${index}`);
    const stream = this.streams()[index];
    if (stream === undefined || stream.type !== type) throw new Thrown('InvalidValuesError', `no ${type} stream ${index}`);
    if (type === 'TEXT') {
      this.textIndex = index;
      this.nextCue = this.clock.t + (this.plan.cueEveryMs ?? 5000);
      return;
    }
    this.audioIndex = index;
    if (this.plan.restartOnSwitch === true && this.movingAt !== null) {
      this.base = 0;
      this.movingAt = this.clock.t;
    }
  }
  setSilentSubtitle(silent: boolean): void {
    this.call('setSilentSubtitle', String(silent));
    this.silent = silent;
  }
  suspend(): void {
    this.call('suspend');
    // The clock stops where it is until `restore`.
    this.base = this.position();
    this.movingAt = null;
  }
  restore(url?: string | null, resumeTime?: number | null): void {
    this.call('restore', resumeTime === undefined ? '' : `${String(url)} ${String(resumeTime)}`);
    if (typeof resumeTime === 'number') this.base = resumeTime;
    this.movingAt = this.clock.t + (this.plan.restoreAfterMs ?? 300);
    this.lastTimeCallback = this.movingAt - 500;
  }
  getVersion(): string {
    return 'fake-avplay 1.0';
  }

  /** Calls the listener the player set, as AVPlay would. */
  fire<K extends keyof AvplayListener>(name: K, ...args: Parameters<NonNullable<AvplayListener[K]>>): void {
    const callback = this.listener[name] as ((...a: unknown[]) => void) | undefined;
    callback?.(...args);
  }
}

export const labMediaItem = (url: string, over: Partial<LabMediaItem> = {}): LabMediaItem => ({ url, kind: 'live', container: 'ts', fault: null, video: null, audio: null, subtitles: null, ...over });

export const FIVE_AUDIO = [
  { lang: 'ara', codec: 'aac', channels: 2 },
  { lang: 'eng', codec: 'aac', channels: 2 },
  { lang: 'spa', codec: 'aac', channels: 2 },
  { lang: 'eng', codec: 'ac3', channels: 6 },
  { lang: 'eng', codec: 'eac3', channels: 6 },
];

/** The lab server's media list as the mock gives it with generated media (`/__lab/media`). */
export const LAB_MEDIA_FIXTURE: LabMedia = {
  media: 'files',
  items: {
    'live-ts': labMediaItem('http://lab/live/104.ts'),
    'live-hls': labMediaItem('http://lab/live/104.m3u8', { container: 'hls' }),
    'redirect-ts': labMediaItem('http://lab/live/104.ts?mock_fault=redirect:hops=3', { fault: 'redirect:hops=3' }),
    'redirect-hls': labMediaItem('http://lab/live/104.m3u8?mock_fault=redirect:hops=3', { container: 'hls', fault: 'redirect:hops=3' }),
    'stall-ts': labMediaItem('http://lab/live/104.ts?mock_fault=stall:after_bytes=600000', { fault: 'stall:after_bytes=600000' }),
    'stall-vod': labMediaItem('http://lab/series/3011.mp4?mock_fault=stall:after_bytes=1000000', { kind: 'vod', container: 'mp4', fault: 'stall:after_bytes=1000000' }),
    'hevc-4k': labMediaItem('http://lab/movie/205.mp4', { kind: 'vod', container: 'mp4', video: { codec: 'hevc', width: 3840, height: 2160 } }),
    'multi-audio': labMediaItem('http://lab/movie/206.mkv', { kind: 'vod', container: 'mkv', audio: FIVE_AUDIO }),
    'subs-mkv': labMediaItem('http://lab/series/3001.mkv', { kind: 'vod', container: 'mkv' }),
    'subs-mp4': labMediaItem('http://lab/series/3011.mp4', { kind: 'vod', container: 'mp4' }),
  },
};
