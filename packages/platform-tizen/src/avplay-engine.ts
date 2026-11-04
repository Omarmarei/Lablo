/**
 * AvplayEngine (architecture.md §2, RELAY step 19): a `PlayerEngine` over Samsung's native
 * player, `webapis.avplay` (typed in `avplay.ts`). Tizen plays everything through it (4K, TS,
 * AC3/E-AC3, track switches); `FallbackEngine` hands HLS it refuses to the `<video>` engine.
 * Written from the lab's AVPlay player (spikes S4 and S8, step 15c2) and Samsung's reference;
 * no Samsung TV has run it yet (step 19b).
 *
 * - **Open:** `open`, `setListener`, `setDisplayRect` (the rect `setRect` gave, in AVPlay's
 *   1920×1080 space), `prepareAsync`, then `play`. `load()` resolves once `play` was called and
 *   rejects with the error that comes before it. A prepare that hasn't answered within 8 s
 *   (AVPlay freezes on some 302s) fails as `timeout`/`PREPARE_TIMEOUT`; the controller's ladder
 *   then re-runs the redirect probe (`redirect-probe.ts`).
 * - **The first frame:** AVPlay paints on the TV's video plane, which the page can't see, so a
 *   frame is the clock moving while `PLAYING`: two readings (polled every 50 ms, or
 *   `oncurrentplaytime`) that differ. A jump to a VOD's start position is no frame.
 * - **Errors:** AVPlay's `PLAYER_ERROR_*` names by kind (`avplayError`); the name stays the code.
 *   Only the "not supported" names are `unsupported` (never retried on the URL).
 * - **`stop()`:** `stop` and `close`, each on its own, which ends the connection; a pending
 *   `load()` rejects with `app`/`ABORTED`. Callbacks of a closed open are dropped.
 * - **Lifecycle:** `suspend()`/`resume()` are AVPlay's `suspend()`/`restore()` (the player
 *   keeps its place; live without a resume time, VOD at its position). A source that isn't
 *   prepared yet, or a player that refuses, is closed and opened again instead.
 * - **Tracks:** `getTotalTrackInfo` and `getCurrentStreamInfo`, `setSelectTrack`; ids are the
 *   streams' indexes. Embedded subtitles arrive as `cue` events while a text track is selected
 *   (`setSilentSubtitle(false)`): AVPlay draws none itself.
 */

import type { Clock, EngineCaps, EngineEvent, EngineSource, EngineStats, LoadOptions, PlaybackError, PlayerEngine, Rect, Track } from '@zoma/player';
import { NO_STATS, SYSTEM_CLOCK } from '@zoma/player';
import type { AvplayListener, AvplayManager, AvplayTrack } from './avplay';
import { avplayTracks, avplayUnsupported } from './avplay';

/** How often the engine reads the clock for the first frame. */
export const AVPLAY_FRAME_POLL_MS = 50;
/** A prepare that hasn't answered by then is AVPlay's freeze (architecture.md §2: re-probe after 8 s). */
export const PREPARE_TIMEOUT_MS = 8000;

/** `setDisplayRect` for the whole screen (AVPlay's 1920×1080 space). */
const FULL: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

/** AVPlay's catch-all during playback: the data arrived, the player failed on it. */
const DECODE_ERRORS = ['PLAYER_ERROR_GENEREIC', 'PLAYER_ERROR_GENERIC'];
/**
 * A call in the wrong state or with a wrong argument: AVPlay's own names and the
 * `WebAPIException`s its methods throw. A `TypeError` is a method a firmware lacks.
 */
const APP_ERRORS = ['PLAYER_ERROR_INVALID_PARAMETER', 'PLAYER_ERROR_INVALID_OPERATION', 'PLAYER_ERROR_INVALID_STATE', 'PLAYER_ERROR_SEEK_FAILED', 'InvalidStateError', 'InvalidValuesError', 'TypeMismatchError', 'TypeError'];

/** The name of an AVPlay error: `onerror`'s text, or a thrown or reported error's `name`; '' when it has none. */
function errorName(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason !== null && typeof reason === 'object') {
    const name = (reason as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/**
 * An AVPlay error as a `PlaybackError`: "not supported" names are `unsupported`, the catch-all
 * `decode`, wrong calls `app`, and the rest (`PLAYER_ERROR_CONNECTION_FAILED`,
 * `PLAYER_ERROR_NO_SUCH_FILE`, `PLAYER_ERROR_INVALID_URI`, names another firmware may add)
 * `network`, which the ladder retries.
 */
export function avplayError(reason: unknown): PlaybackError {
  const name = errorName(reason);
  const code = name === '' ? 'NO_DETAILS' : name;
  if (avplayUnsupported(name)) return { kind: 'unsupported', code };
  if (DECODE_ERRORS.indexOf(name) !== -1) return { kind: 'decode', code };
  if (APP_ERRORS.indexOf(name) !== -1) return { kind: 'app', code };
  return { kind: 'network', code };
}

export interface AvplayEngineOptions {
  readonly clock?: Clock;
  readonly framePollMs?: number;
  readonly prepareTimeoutMs?: number;
  /** The tallest picture the TV shows. */
  readonly maxHeight?: number;
}

/** One `load()`: what it plays and how far it got. */
interface Load {
  readonly token: number;
  readonly source: EngineSource;
  /**
   * VOD: where it comes back to (ms): the requested start, then the position at each hide (kept
   * while a jump to it is under way); null: the file's start, or live (the live edge).
   */
  startMs: number | null;
  settle: { readonly resolve: () => void; readonly reject: (error: PlaybackError) => void } | null;
  prepared: boolean;
  /** A jump to `startMs` is under way: its landing is no frame. */
  seeking: boolean;
  /** The last clock reading while watching for the first frame. */
  lastSeen: number | null;
  framed: boolean;
  waiting: boolean;
  failed: boolean;
  /** `native`: AVPlay's `suspend()`; `closed`: closed, to be opened again. */
  suspended: 'no' | 'native' | 'closed';
  /** A text track is selected: its cues go out. */
  textShown: boolean;
}

const ABORTED: PlaybackError = { kind: 'app', code: 'ABORTED' };
const DESTROYED: PlaybackError = { kind: 'app', code: 'DESTROYED' };
const PREPARE_TIMEOUT: PlaybackError = { kind: 'timeout', code: 'PREPARE_TIMEOUT' };
const NO_SEEK: PlaybackError = { kind: 'app', code: 'NO_SEEK' };

/** Runs an AVPlay call that may throw; whether it went through. */
function attempt(call: () => void): boolean {
  try {
    call();
    return true;
  } catch {
    return false;
  }
}

function read<T>(call: () => T, fallback: T): T {
  try {
    return call();
  } catch {
    return fallback;
  }
}

function trackLabel(t: AvplayTrack): string {
  return t.channels === null ? t.codec : t.codec + ' ' + String(t.channels) + 'ch';
}

export class AvplayEngine implements PlayerEngine {
  readonly kind = 'avplay' as const;
  readonly caps: EngineCaps;
  private readonly clock: Clock;
  private readonly framePollMs: number;
  private readonly prepareTimeoutMs: number;
  private listeners: ((e: EngineEvent & { readonly token: number }) => void)[] = [];
  private cur: Load | null = null;
  /** Counts opens and closes: a callback of an earlier one changes nothing. */
  private openSeq = 0;
  /** AVPlay has a source (a stop must close it). */
  private opened = false;
  private destroyed = false;
  private rect: Rect | 'full' = 'full';
  private lastPos = 0;
  private pollTimer: unknown = null;
  private prepareTimer: unknown = null;

  constructor(
    private readonly api: AvplayManager,
    options: AvplayEngineOptions = {},
  ) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.framePollMs = options.framePollMs ?? AVPLAY_FRAME_POLL_MS;
    this.prepareTimeoutMs = options.prepareTimeoutMs ?? PREPARE_TIMEOUT_MS;
    this.caps = { maxHeight: options.maxHeight ?? 2160, trackSwitch: 'reliable', deliversSubtitleText: true, preloadSlots: 0, rates: [1] };
  }

  load(source: EngineSource, token: number, opts: LoadOptions = {}): Promise<void> {
    if (this.destroyed) return Promise.reject(DESTROYED);
    // The controller always stops first; a load without one replaces the old source.
    this.drop();
    this.close();
    return new Promise<void>((resolve, reject) => {
      const start = opts.startMs;
      const l: Load = {
        token,
        source,
        startMs: !source.live && start !== undefined && start > 0 ? start : null,
        settle: { resolve, reject },
        prepared: false,
        seeking: false,
        lastSeen: null,
        framed: false,
        waiting: false,
        failed: false,
        suspended: 'no',
        textShown: false,
      };
      this.cur = l;
      this.open(l);
    });
  }

  stop(): Promise<void> {
    this.drop();
    this.close();
    return Promise.resolve();
  }

  play(): void {
    // After a pause only: AVPlay's `play` in another state throws.
    if (this.cur !== null && read(() => this.api.getState(), '') === 'PAUSED') attempt(() => this.api.play());
  }

  pause(): void {
    if (this.cur !== null) attempt(() => this.api.pause());
  }

  seek(ms: number): Promise<void> {
    const api = this.api;
    const seekTo = api.seekTo;
    if (this.cur === null || typeof seekTo !== 'function') return Promise.reject(NO_SEEK);
    return new Promise<void>((resolve, reject) => {
      try {
        seekTo.call(
          api,
          ms,
          () => resolve(),
          (error) => reject(avplayError(error)),
        );
      } catch (error) {
        reject(avplayError(error));
      }
    });
  }

  setRect(r: Rect | 'full'): void {
    this.rect = r;
    if (this.opened) this.applyRect();
  }

  getTracks(): { audio: Track[]; text: Track[] } {
    const audio: Track[] = [];
    const text: Track[] = [];
    const l = this.cur;
    const current = this.streams(true);
    for (const t of this.streams(false)) {
      let selected = false;
      // A file's stream indexes are unique across types.
      for (const c of current) if (c.index === t.index) selected = true;
      const track = (on: boolean): Track => ({ id: String(t.index), lang: t.lang, label: trackLabel(t), selected: on });
      if (t.type === 'AUDIO') audio.push(track(selected));
      if (t.type === 'TEXT') text.push(track(selected && l !== null && l.textShown));
    }
    return { audio, text };
  }

  selectAudio(id: string): Promise<boolean> {
    const stream = this.stream('AUDIO', id);
    return Promise.resolve(stream !== null && attempt(() => this.api.setSelectTrack('AUDIO', stream.index)));
  }

  selectText(id: string | null): Promise<boolean> {
    const l = this.cur;
    const api = this.api;
    if (id === null) {
      if (l !== null) l.textShown = false;
      attempt(() => api.setSilentSubtitle?.(true));
      return Promise.resolve(true);
    }
    // A stream list exists only while a load is prepared, so `l` is set when one is found.
    const stream = this.stream('TEXT', id);
    if (l === null || stream === null || !attempt(() => api.setSelectTrack('TEXT', stream.index))) return Promise.resolve(false);
    attempt(() => api.setSilentSubtitle?.(false));
    l.textShown = true;
    return Promise.resolve(true);
  }

  /** AVPlay's clock; the last reading while AVPlay has none (0 once closed). */
  positionMs(): number {
    this.lastPos = read(() => this.api.getCurrentTime(), this.lastPos);
    return this.lastPos;
  }

  /**
   * From the first frame on: the playing video stream's size, codec and declared bitrate, and the
   * playing audio stream's codec and channels (step 20c2a). AVPlay counts no frames or bytes.
   */
  stats(): EngineStats {
    const l = this.cur;
    if (l === null || !l.framed) return NO_STATS;
    let video: AvplayTrack | null = null;
    let audio: AvplayTrack | null = null;
    for (const t of this.streams(true)) {
      if (t.type === 'VIDEO') video = t;
      if (t.type === 'AUDIO') audio = t;
    }
    const bitrate = video === null ? 0 : Number(video.extra.Bit_rate);
    return {
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      bitrate: bitrate > 0 ? bitrate : null,
      droppedFrames: null,
      decodedFrames: null,
      decodedBytes: null,
      videoCodec: video?.codec ?? '',
      audioCodec: audio?.codec ?? '',
      audioChannels: audio?.channels ?? null,
    };
  }

  suspend(): void {
    const l = this.cur;
    if (l === null || l.failed || l.suspended !== 'no') return;
    const seeking = l.seeking;
    this.stopTimers();
    l.framed = false;
    l.waiting = false;
    l.seeking = false;
    l.lastSeen = null;
    if (l.prepared) {
      // VOD: where it is, or where the jump under way goes (`startMs`).
      if (!l.source.live && !seeking) {
        const at = read(() => this.api.getCurrentTime(), 0);
        if (at > 0) l.startMs = at;
      }
      if (attempt(() => this.api.suspend())) {
        l.suspended = 'native';
        return;
      }
    }
    // Not prepared yet, or a player that refuses: closed now, opened again on resume.
    l.suspended = 'closed';
    l.prepared = false;
    this.close();
  }

  resume(): void {
    const l = this.cur;
    if (l === null || l.suspended === 'no') return;
    const how = l.suspended;
    l.suspended = 'no';
    if (how === 'native') {
      const at = l.startMs;
      // Live: no resume time (it means nothing there); VOD: the position, never 0.
      if (attempt(() => (at === null ? this.api.restore() : this.api.restore(null, at)))) {
        this.schedulePoll(l, this.openSeq);
        return;
      }
      l.prepared = false;
      this.close();
    }
    this.open(l);
  }

  on(cb: (e: EngineEvent & { readonly token: number }) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  destroy(): void {
    void this.stop();
    this.destroyed = true;
  }

  /** Opens the load's URL and prepares it; `play` follows the prepare. */
  private open(l: Load): void {
    const api = this.api;
    const mine = ++this.openSeq;
    try {
      api.open(l.source.url);
    } catch (error) {
      this.fail(l, avplayError(error));
      return;
    }
    this.opened = true;
    try {
      api.setListener(this.listenerFor(l, mine));
    } catch (error) {
      this.fail(l, avplayError(error));
      return;
    }
    this.applyRect();
    this.prepareTimer = this.clock.setTimeout(() => this.fail(l, PREPARE_TIMEOUT), this.prepareTimeoutMs);
    try {
      api.prepareAsync(
        () => this.onPrepared(l, mine),
        (error) => {
          if (mine === this.openSeq) this.fail(l, avplayError(error));
        },
      );
    } catch (error) {
      this.fail(l, avplayError(error));
    }
  }

  private onPrepared(l: Load, mine: number): void {
    if (mine !== this.openSeq || l.failed) return;
    this.clock.clearTimeout(this.prepareTimer);
    this.prepareTimer = null;
    l.prepared = true;
    this.emit({ type: 'tracks', token: l.token });
    try {
      this.api.play();
    } catch (error) {
      this.fail(l, avplayError(error));
      return;
    }
    const at = l.startMs;
    const seekTo = this.api.seekTo;
    if (at !== null && typeof seekTo === 'function') {
      l.seeking = true;
      // A landing from an open that was closed since (a hide while it seeked) changes nothing.
      const landed = (): void => {
        if (mine === this.openSeq) l.seeking = false;
      };
      if (!attempt(() => seekTo.call(this.api, at, landed, landed))) landed();
    }
    const settle = l.settle;
    l.settle = null;
    if (settle !== null) settle.resolve();
    this.schedulePoll(l, mine);
  }

  private listenerFor(l: Load, mine: number): AvplayListener {
    const live = (): boolean => mine === this.openSeq && !l.failed;
    return {
      onbufferingstart: () => {
        if (!live() || !l.framed || l.waiting) return;
        l.waiting = true;
        this.emit({ type: 'buffering', token: l.token });
      },
      onbufferingcomplete: () => {
        if (!live() || !l.waiting) return;
        l.waiting = false;
        this.emit({ type: 'playing', token: l.token });
      },
      oncurrentplaytime: (ms) => {
        if (live() && typeof ms === 'number') this.observe(l, ms);
      },
      onstreamcompleted: () => {
        if (live()) this.emit({ type: 'ended', token: l.token });
      },
      onerror: (name) => {
        if (live()) this.fail(l, avplayError(name));
      },
      onsubtitlechange: (duration, text, type) => {
        // Type 1 is a picture subtitle, which the overlay can't draw.
        if (!live() || !l.textShown || typeof text !== 'string' || text === '' || String(type) === '1') return;
        const ms = Number(duration);
        this.emit({ type: 'cue', text, durationMs: ms > 0 ? ms : 0, token: l.token });
      },
    };
  }

  /** A clock reading: the second one that differs from the first is the first frame. */
  private observe(l: Load, ms: number): void {
    this.lastPos = ms;
    if (l.framed || l.seeking) return;
    if (l.lastSeen !== null && ms !== l.lastSeen) {
      l.framed = true;
      this.stopPoll();
      this.emit({ type: 'firstFrame', token: l.token });
      return;
    }
    l.lastSeen = ms;
  }

  private schedulePoll(l: Load, mine: number): void {
    this.stopPoll();
    this.pollTimer = this.clock.setTimeout(() => this.poll(l, mine), this.framePollMs);
  }

  private poll(l: Load, mine: number): void {
    this.pollTimer = null;
    if (read(() => this.api.getState(), '') === 'PLAYING') {
      const ms = read<number | null>(() => this.api.getCurrentTime(), null);
      if (ms !== null) this.observe(l, ms);
    }
    if (!l.framed) this.schedulePoll(l, mine);
  }

  private stopPoll(): void {
    this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private stopTimers(): void {
    this.stopPoll();
    this.clock.clearTimeout(this.prepareTimer);
    this.prepareTimer = null;
  }

  private applyRect(): void {
    const r = this.rect === 'full' ? FULL : this.rect;
    // A rect AVPlay refuses leaves the picture where it was.
    attempt(() => this.api.setDisplayRect(Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)));
  }

  /** The file's streams (`current`: the ones playing), or none in a state that has no list. */
  private streams(current: boolean): AvplayTrack[] {
    const api = this.api;
    return avplayTracks(read<unknown>(() => (current ? api.getCurrentStreamInfo() : api.getTotalTrackInfo()), []));
  }

  /** The `type` stream whose id (its index) is `id`, or null. */
  private stream(type: string, id: string): AvplayTrack | null {
    for (const t of this.streams(false)) if (t.type === type && String(t.index) === id) return t;
    return null;
  }

  /** Forgets the current load: its callbacks no longer count, and a pending `load()` rejects. */
  private drop(): void {
    const l = this.cur;
    this.cur = null;
    this.stopTimers();
    if (l !== null && l.settle !== null) {
      const settle = l.settle;
      l.settle = null;
      settle.reject(ABORTED);
    }
  }

  /** `stop` and `close`, each on its own: a stop in the wrong state must not keep the connection open. */
  private close(): void {
    ++this.openSeq;
    if (!this.opened) return;
    this.opened = false;
    this.lastPos = 0;
    attempt(() => this.api.stop());
    attempt(() => this.api.close());
  }

  /** The load failed: its `load()` rejects, or (once it resolved) an `error` event says so. */
  private fail(l: Load, error: PlaybackError): void {
    // Once per load: a late prepare error after the prepare timed out changes nothing.
    if (l.failed) return;
    l.failed = true;
    this.stopTimers();
    const settle = l.settle;
    l.settle = null;
    if (settle !== null) settle.reject(error);
    else this.emit({ type: 'error', error, token: l.token });
  }

  private emit(e: EngineEvent & { readonly token: number }): void {
    for (const listener of this.listeners.slice()) listener(e);
  }
}

/**
 * AVPlay's `<object type="application/avplayer">`, filling `stage` (the app's player layer).
 * AVPlay paints under the page inside the rect `setDisplayRect` gives, so whatever covers that
 * rect must be transparent: the player route's `html` and `body` too (step 20).
 */
export function createAvplayPlane(stage: HTMLElement): HTMLElement {
  const plane = stage.ownerDocument.createElement('object');
  plane.setAttribute('type', 'application/avplayer');
  plane.setAttribute('data-testid', 'player-avplay');
  const style = plane.style;
  style.position = 'absolute';
  style.left = '0';
  style.top = '0';
  style.width = '100%';
  style.height = '100%';
  stage.appendChild(plane);
  return plane;
}
