/**
 * Test doubles for the AvplayEngine and the redirect probe (RELAY step 19): a clock tests drive by
 * hand, a `webapis.avplay` with AVPlay's state machine, and an `XMLHttpRequest`. Not exported from
 * the package entry; the lab has its own AVPlay fake (`apps/tv/src/lab/fakes.ts`) on its battery
 * clock.
 *
 * Like the player's `fake-video.ts`, the AVPlay fake keeps state changes and callbacks apart:
 * `move()` and `freeze()` only change the clock, `fire()` only calls the listener, and a prepare
 * answers when the test says (`answerPrepare()`), so a test scripts the order and the time
 * between them. Calls AVPlay refuses in a state throw an `InvalidStateError`, as on a TV.
 */

import type { Clock } from '@lablo/player';
import type { AvplayError, AvplayListener, AvplayManager, AvplayStreamInfo } from './avplay';
import type { ProbeXhr } from './redirect-probe';

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

/** The player's `Clock`, moved by hand: due timers run in order, equal times in the order they were set. */
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

  get pending(): number {
    return this.timers.length;
  }

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

class Thrown extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

const stream = (index: number, type: string, extra: Record<string, string>): AvplayStreamInfo => {
  const fields = Object.keys(extra).map((key) => '"' + key + '":"' + (extra[key] ?? '') + '"');
  return { index, type, extra_info: '{' + fields.join(',') + '}' };
};

/** A file with a 1080p video stream (0), two audio streams (1 ara, 2 eng AC3 5.1) and an English text stream (3). */
export const STREAMS: readonly AvplayStreamInfo[] = [
  stream(0, 'VIDEO', { fourCC: 'H264', Width: '1920', Height: '1080', Bit_rate: '4500000' }),
  stream(1, 'AUDIO', { language: 'ara', fourCC: 'AAC', channels: '2' }),
  stream(2, 'AUDIO', { language: 'eng', fourCC: 'AC3', channels: '6' }),
  stream(3, 'TEXT', { track_lang: 'eng', fourCC: 'SRT', subtitle_type: '0' }),
];

export class FakeAvplay implements AvplayManager {
  /** Every call, in order: `open <url>`, `setListener`, `setDisplayRect x,y,w,h`, `setDisplayMethod <mode>`, `prepareAsync`, `play`, `seekTo <ms>`, `restore`, `restore null <ms>`… */
  readonly log: string[] = [];
  /** Methods that throw this `WebAPIException` name instead of running. */
  readonly throws: { [method: string]: string } = {};
  state = 'NONE';
  /** The file's streams (from READY on). */
  streams: readonly AvplayStreamInfo[] = STREAMS;
  /** Connections open: from `open` to `close` (AVPlay keeps the socket until it is closed). */
  connections = 0;
  /** Every URL opened, in order. */
  readonly urls: string[] = [];
  /**
   * Plays by itself: ms from `prepareAsync` until the prepare answers and the clock starts
   * moving, by URL; null: the prepare never answers (AVPlay's 302 freeze). Unset: the test answers.
   */
  autoPlay: ((url: string) => number | null) | null = null;
  /** Every prepare's and seek's callbacks, kept after a close: tests send stale ones with them. */
  readonly prepares: Array<{ readonly ok?: () => void; readonly error?: (e: AvplayError) => void }> = [];
  readonly seeks: Array<{ readonly ms: number; readonly ok?: () => void; readonly error?: (e: AvplayError) => void }> = [];
  private listener: AvplayListener | null = null;
  private preparing: { readonly ok?: () => void; readonly error?: (e: AvplayError) => void } | null = null;
  private seeking: { readonly ms: number; readonly ok?: () => void; readonly error?: (e: AvplayError) => void } | null = null;
  private base = 0;
  private movingSince: number | null = null;
  private suspendedIn: string | null = null;
  private audio = 1;
  private text: number | null = null;

  constructor(private readonly clock: FakeClock) {}

  private call(entry: string, method: string): void {
    this.log.push(entry);
    const thrown = this.throws[method];
    if (thrown !== undefined) throw new Thrown(thrown, method + ' refused');
  }

  private refuse(method: string): never {
    throw new Thrown('InvalidStateError', method + ' in ' + this.state);
  }

  private get prepared(): boolean {
    return this.state === 'READY' || this.state === 'PLAYING' || this.state === 'PAUSED';
  }

  open(url: string): void {
    this.call('open ' + url, 'open');
    if (this.state !== 'NONE') this.refuse('open');
    this.state = 'IDLE';
    this.connections++;
    this.urls.push(url);
  }

  close(): void {
    this.call('close', 'close');
    if (this.state !== 'NONE') this.connections--;
    this.state = 'NONE';
    this.listener = null;
    this.preparing = null;
    this.seeking = null;
    this.suspendedIn = null;
    this.base = 0;
    this.movingSince = null;
    this.audio = 1;
    this.text = null;
  }

  prepareAsync(onsuccess?: () => void, onerror?: (error: AvplayError) => void): void {
    this.call('prepareAsync', 'prepareAsync');
    if (this.state !== 'IDLE') this.refuse('prepareAsync');
    const preparing = { ok: onsuccess, error: onerror };
    this.preparing = preparing;
    this.prepares.push(preparing);
    const ms = this.autoPlay === null ? null : this.autoPlay(this.urls[this.urls.length - 1] ?? '');
    if (ms === null) return;
    this.clock.setTimeout(() => {
      if (this.preparing !== preparing) return;
      this.answerPrepare();
      this.move();
    }, ms);
  }

  setDisplayRect(x: number, y: number, width: number, height: number): void {
    this.call('setDisplayRect ' + [x, y, width, height].join(','), 'setDisplayRect');
  }

  setDisplayMethod(mode: string): void {
    this.call('setDisplayMethod ' + mode, 'setDisplayMethod');
  }

  setListener(listener: AvplayListener): void {
    this.call('setListener', 'setListener');
    this.listener = listener;
  }

  play(): void {
    this.call('play', 'play');
    if (this.state !== 'READY' && this.state !== 'PAUSED') this.refuse('play');
    this.state = 'PLAYING';
  }

  pause(): void {
    this.call('pause', 'pause');
    if (this.state !== 'PLAYING') this.refuse('pause');
    this.state = 'PAUSED';
    this.freeze();
  }

  stop(): void {
    this.call('stop', 'stop');
    if (this.state === 'NONE') this.refuse('stop');
    this.state = 'IDLE';
    this.freeze();
  }

  seekTo(ms: number, onsuccess?: () => void, onerror?: (error: AvplayError) => void): void {
    this.call('seekTo ' + String(ms), 'seekTo');
    this.seeking = { ms, ok: onsuccess, error: onerror };
    this.seeks.push(this.seeking);
  }

  getState(): string {
    return this.state;
  }

  getCurrentTime(): number {
    if (!this.prepared) this.refuse('getCurrentTime');
    return this.base + (this.movingSince === null ? 0 : this.clock.now() - this.movingSince);
  }

  /** `getDuration` (ms), set by a test; none by default, as on an AVPlay without the method. */
  getDuration?: () => number;

  getTotalTrackInfo(): readonly AvplayStreamInfo[] {
    if (!this.prepared) this.refuse('getTotalTrackInfo');
    return this.streams;
  }

  getCurrentStreamInfo(): readonly AvplayStreamInfo[] {
    if (!this.prepared) this.refuse('getCurrentStreamInfo');
    return this.streams.filter((s) => s.type === 'VIDEO' || s.index === this.audio || s.index === this.text);
  }

  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void {
    this.call('setSelectTrack ' + type + ' ' + String(index), 'setSelectTrack');
    if (type === 'AUDIO') this.audio = index;
    else this.text = index;
  }

  setSilentSubtitle(silent: boolean): void {
    this.call('setSilentSubtitle ' + String(silent), 'setSilentSubtitle');
  }

  /** Takes the call in any state but NONE (the reference doesn't say which it refuses). */
  suspend(): void {
    this.call('suspend', 'suspend');
    if (this.state === 'NONE') this.refuse('suspend');
    this.suspendedIn = this.state;
    this.freeze();
  }

  restore(url?: string | null, resumeTime?: number | null): void {
    this.call(url === undefined && resumeTime === undefined ? 'restore' : 'restore ' + String(url) + ' ' + String(resumeTime), 'restore');
    if (this.suspendedIn === null) this.refuse('restore');
    this.state = this.suspendedIn;
    this.suspendedIn = null;
    if (typeof resumeTime === 'number') this.base = resumeTime;
  }

  // What the TV does, step by step (tests call these).

  /** The prepare succeeds: READY, then the success callback. */
  answerPrepare(): void {
    const p = this.preparing;
    if (p === null) throw new Error('no prepare is waiting');
    this.preparing = null;
    this.state = 'READY';
    p.ok?.();
  }

  /** The prepare fails: the error callback. */
  failPrepare(error: AvplayError): void {
    const p = this.preparing;
    if (p === null) throw new Error('no prepare is waiting');
    this.preparing = null;
    p.error?.(error);
  }

  get preparePending(): boolean {
    return this.preparing !== null;
  }

  /** The seek lands (the clock jumps), then its success callback; `error`: its error callback instead. */
  landSeek(error?: AvplayError): void {
    const s = this.seeking;
    if (s === null) throw new Error('no seek is waiting');
    this.seeking = null;
    if (error !== undefined) {
      s.error?.(error);
      return;
    }
    this.base = s.ms;
    if (this.movingSince !== null) this.movingSince = this.clock.now();
    s.ok?.();
  }

  /** The clock starts moving (no callback). */
  move(): void {
    if (this.movingSince === null) this.movingSince = this.clock.now();
  }

  /** The clock stops (no callback). */
  freeze(): void {
    if (this.movingSince === null) return;
    this.base += this.clock.now() - this.movingSince;
    this.movingSince = null;
  }

  /** Calls the listener the engine set, as AVPlay would. */
  fire<K extends keyof AvplayListener>(name: K, ...args: Parameters<NonNullable<AvplayListener[K]>>): void {
    const callback = this.listener?.[name] as ((...a: unknown[]) => void) | undefined;
    if (callback !== undefined) callback(...args);
  }

  /** The listener from an earlier open, to send stale callbacks with. */
  get currentListener(): AvplayListener | null {
    return this.listener;
  }
}

/** An `XMLHttpRequest` the test answers: `headers()` reaches `readyState` 2, then `abort()` is expected. */
export class FakeXhr implements ProbeXhr {
  readyState = 0;
  status = 0;
  responseURL = '';
  timeout = 0;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  readonly log: string[] = [];
  /** `open` throws this (a refused URL). */
  openThrows: Error | null = null;

  open(method: string, url: string, async: boolean): void {
    this.log.push('open ' + method + ' ' + url + ' ' + String(async));
    if (this.openThrows !== null) throw this.openThrows;
    this.readyState = 1;
    this.onreadystatechange?.();
  }

  send(): void {
    this.log.push('send timeout=' + String(this.timeout));
  }

  abort(): void {
    this.log.push('abort');
    // A browser ends an aborted request in state 4 with status 0, and says so.
    this.readyState = 4;
    this.status = 0;
    this.onreadystatechange?.();
  }

  /** The final answer's headers came (after any redirects, which XHR follows itself). */
  headers(status: number, finalUrl: string): void {
    this.status = status;
    this.responseURL = finalUrl;
    this.readyState = 2;
    this.onreadystatechange?.();
  }

  fail(): void {
    this.readyState = 4;
    this.onerror?.();
  }

  timesOut(): void {
    this.readyState = 4;
    this.ontimeout?.();
  }
}
