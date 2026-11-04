/**
 * Test doubles for the player: a clock tests drive by hand, and an engine whose every load
 * follows a script on that clock. Not exported from the package entry; the controller's tests
 * (and later the engines' and the player UI's) import it directly.
 *
 * The engine keeps state changes and their callbacks apart in time (a stop closes the
 * connection `stopMs` after it is called), and counts open connections, so a controller that
 * loads before the previous stop finished shows up as two at once.
 */

import type { Clock } from './clock';
import type { EngineCaps, EngineEvent, EngineSource, EngineStats, LoadOptions, PlaybackError, PlayerEngine, Rect, Track } from './engine';

/** Node's `setImmediate` (not in the DOM lib); Windows clamps `setTimeout(0)` to its timer tick. */
const immediate = (globalThis as unknown as { setImmediate?: (fn: () => void) => void }).setImmediate ?? ((fn: () => void) => setTimeout(fn, 0));

/** Lets every pending promise callback run (one macrotask turn). */
export function settle(): Promise<void> {
  return new Promise((resolve) => immediate(resolve));
}

interface Timer {
  readonly id: number;
  readonly at: number;
  readonly fn: () => void;
}

export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: Timer[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /** Timers not yet run. */
  get pending(): number {
    return this.timers.length;
  }

  /** Moves time on by `ms`, running due timers in order and settling promises after each. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await settle();
    for (;;) {
      let next: Timer | null = null;
      for (const timer of this.timers) if (timer.at <= end && (next === null || timer.at < next.at)) next = timer;
      if (next === null) break;
      const due = next;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.t = due.at;
      due.fn();
      await settle();
    }
    this.t = end;
  }
}

/** How one load behaves; every time is in ms after the `load` call. */
export interface FakeScript {
  /** `load()` settles this long after the call (default 0). */
  readonly loadMs?: number;
  /** `load()` rejects with this. */
  readonly loadError?: PlaybackError;
  /** The first frame; `null` never (default 500). */
  readonly frameMs?: number | null;
  /** An `error` event. */
  readonly error?: { readonly atMs: number; readonly error: PlaybackError };
  /** The position stops moving, with no event (a frozen stream). */
  readonly freezeMs?: number;
  /** A `buffering` event (the position stops), and the `playing` event that ends it. */
  readonly bufferingMs?: number;
  readonly playingMs?: number;
  /** An `ended` event. */
  readonly endMs?: number;
}

export interface FakeLoad {
  readonly token: number;
  readonly source: EngineSource;
  readonly opts: LoadOptions;
  readonly at: number;
}

interface Playback {
  readonly token: number;
  readonly timers: unknown[];
  readonly abort: () => void;
  /** Position when it last stopped moving. */
  base: number;
  /** When it started moving (null: still). */
  movingSince: number | null;
}

const ABORTED: PlaybackError = { kind: 'app', code: 'ABORTED' };

export class FakeEngine implements PlayerEngine {
  readonly kind = 'html5' as const;
  readonly caps: EngineCaps = { maxHeight: 1080, trackSwitch: 'reliable', deliversSubtitleText: false, preloadSlots: 0, rates: [1] };
  /** What the controller called, in order: `load <token> <container>`, `stop`, `closed`, `pause`, `play`. */
  readonly log: string[] = [];
  readonly loads: FakeLoad[] = [];
  /** Connections open now, and the most ever open at once. */
  open = 0;
  maxOpen = 0;
  /** How long a stop takes to close the connection. */
  stopMs = 50;
  /** A stop leaves the load's scripted events running: they arrive late, with the old token. */
  leaky = false;
  /** `play()` after a pause starts the position moving (false: an engine that resumes stuck). */
  resumeMoves = true;
  /** A `resume()` shows its first frame this long after the call (`null`: never). */
  resumeFrameMs: number | null = 500;
  private playback: Playback | null = null;
  /** The load `suspend()` closed, until `resume()`. */
  private suspended: Playback | null = null;
  private listeners: ((e: EngineEvent & { readonly token: number }) => void)[] = [];

  constructor(
    private readonly clock: FakeClock,
    private readonly script: (source: EngineSource, n: number) => FakeScript = () => ({}),
  ) {}

  load(source: EngineSource, token: number, opts: LoadOptions = {}): Promise<void> {
    this.loads.push({ token, source, opts, at: this.clock.now() });
    this.log.push(`load ${token} ${source.container}`);
    this.open++;
    this.maxOpen = Math.max(this.maxOpen, this.open);
    const script = this.script(source, this.loads.length);
    return new Promise<void>((resolve, reject) => {
      const p: Playback = { token, timers: [], abort: () => reject(ABORTED), base: opts.startMs ?? 0, movingSince: null };
      this.playback = p;
      const at = (ms: number | undefined, fn: () => void): void => {
        if (ms !== undefined) p.timers.push(this.clock.setTimeout(fn, ms));
      };
      at(script.loadMs ?? 0, () => (script.loadError === undefined ? resolve() : reject(script.loadError)));
      const frameMs = script.frameMs === undefined ? 500 : script.frameMs;
      at(frameMs ?? undefined, () => {
        p.movingSince = this.clock.now();
        this.emit(token, { type: 'firstFrame' });
      });
      at(script.freezeMs, () => this.still(p));
      at(script.bufferingMs, () => {
        this.still(p);
        this.emit(token, { type: 'buffering' });
      });
      at(script.playingMs, () => {
        p.movingSince = this.clock.now();
        this.emit(token, { type: 'playing' });
      });
      at(script.endMs, () => {
        this.still(p);
        this.emit(token, { type: 'ended' });
      });
      const failure = script.error;
      if (failure !== undefined) at(failure.atMs, () => this.emit(token, { type: 'error', error: failure.error }));
    });
  }

  stop(): Promise<void> {
    this.log.push('stop');
    const p = this.playback;
    this.playback = null;
    if (p === null) return Promise.resolve();
    // A suspended load's connection is closed already.
    const closed = this.suspended === p;
    this.suspended = null;
    if (!this.leaky) for (const timer of p.timers) this.clock.clearTimeout(timer);
    p.abort();
    return new Promise((resolve) => {
      this.clock.setTimeout(() => {
        if (!closed) this.open--;
        this.log.push('closed');
        resolve();
      }, this.stopMs);
    });
  }

  /** Sends an event as if the engine did (any token, to test stale ones). */
  emit(token: number, event: EngineEvent): void {
    for (const listener of this.listeners.slice()) listener({ ...event, token });
  }

  positionMs(): number {
    const p = this.playback;
    if (p === null) return 0;
    return p.base + (p.movingSince === null ? 0 : this.clock.now() - p.movingSince);
  }

  play(): void {
    this.log.push('play');
    if (this.resumeMoves && this.playback !== null && this.playback.movingSince === null) this.playback.movingSince = this.clock.now();
  }

  pause(): void {
    this.log.push('pause');
    if (this.playback !== null) this.still(this.playback);
  }

  on(cb: (e: EngineEvent & { readonly token: number }) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  get listenerCount(): number {
    return this.listeners.length;
  }

  seek(): Promise<void> {
    return Promise.resolve();
  }

  setRect(_r: Rect | 'full'): void {}

  getTracks(): { audio: Track[]; text: Track[] } {
    return { audio: [], text: [] };
  }

  selectAudio(): Promise<boolean> {
    return Promise.resolve(false);
  }

  selectText(): Promise<boolean> {
    return Promise.resolve(false);
  }

  stats(): EngineStats {
    return { width: 0, height: 0, bitrate: null, droppedFrames: null };
  }

  /**
   * The app went to the background: the load's scripted events stop, the position stops and the
   * connection closes at once (the TV's own suspend), until `resume`.
   */
  suspend(): void {
    this.log.push('suspend');
    const p = this.playback;
    if (p === null || this.suspended !== null) return;
    for (const timer of p.timers) this.clock.clearTimeout(timer);
    p.timers.length = 0;
    this.still(p);
    this.open--;
    this.suspended = p;
  }

  /** Opens the connection again: a new first frame `resumeFrameMs` later (`null`: never), with the load's token. */
  resume(): void {
    this.log.push('resume');
    const p = this.suspended;
    this.suspended = null;
    if (p === null || this.playback !== p) return;
    this.open++;
    this.maxOpen = Math.max(this.maxOpen, this.open);
    if (this.resumeFrameMs === null) return;
    p.timers.push(
      this.clock.setTimeout(() => {
        p.movingSince = this.clock.now();
        this.emit(p.token, { type: 'firstFrame' });
      }, this.resumeFrameMs),
    );
  }

  destroy(): void {}

  private still(p: Playback): void {
    if (p.movingSince === null) return;
    p.base += this.clock.now() - p.movingSince;
    p.movingSince = null;
  }
}
