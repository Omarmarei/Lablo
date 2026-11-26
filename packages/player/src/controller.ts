/**
 * PlayerController (architecture.md §2, RELAY step 17): the platform-agnostic owner of
 * playback. It drives one `PlayerEngine` and owns:
 * - **session tokens:** every engine load gets a new token, and events carrying any other token
 *   are dropped, so a late event from a channel the user zapped away from changes nothing;
 * - **close-before-open:** the engine's `stop()` is awaited before every `load` (providers often
 *   allow one connection), and a stop already under way is shared, not overtaken;
 * - **the URL strategy:** a request's URLs are tried in order, with the source's remembered
 *   container first (`request.ts`); a container other than the request's first is remembered only
 *   after a definitive failure, and a live URL that shows nothing gives way to an untried one
 *   at the fallback's cap (step 39s2);
 * - **the watchdog and the retry ladder** (`ladder.ts`): stalls and errors reopen, re-probe or
 *   switch container while the UI shows "Reconnecting…", and give up after 4 attempts in 60 s;
 * - **the error classifier** (`failure.ts`): giving up yields a category and a code, with the
 *   account re-checked after a provider failure.
 *
 * - **the app lifecycle** (`hide`/`show`, step 20a): the watchdog rests while the app is hidden;
 * - **tracks** (step 20b, `tracks.ts`): the stream's audio and subtitle tracks in the status, the
 *   channel's remembered choice or the preferred languages applied when they appear, and the
 *   menu's switches remembered for the channel;
 * - **the subtitles to draw** (step 20b2b, `subtitles`/`subscribeSubtitles`): a subtitle file
 *   beside the stream (`PlayRequest.externalSubs`, loaded by the app's `loadSubtitles`) timed by
 *   the media clock, or the text an engine delivers for the stream's own subtitles (AVPlay);
 * - **pause, the position and seeking** (step 25d): `pause`/`resume`, and `positionMs`/`seek`
 *   inside a VOD or catch-up stream on show (the app seeks a stream it can't seek by a new URL);
 * - **the config's blocklist** (step 30c3b, `blocked`): every URL is asked about before the
 *   engine opens it (alongside the close), and on Tizen the redirect probe's answer too; a
 *   blocked one gives up at once (`blockedFailure`: no retry, no account check), and
 *   `checkBlocklist` asks again about the stream on show after a config refresh.
 * - **telemetry's reports** (step 33b2, `report`): each play's result once (its time to the first
 *   frame, or the error it gave up on) and each stall's end (recovered or not, with its retries).
 * - **the tuning** (step 39d, `tuning`): the watchdog's numbers and the engine's buffers, asked for
 *   at each `play` (Settings' "Buffering" and remote config's tunables) and kept for the session.
 *
 * Debounced zapping, number entry, the info bar, the track menu and the subtitle overlay are the
 * app's (apps/tv/src/player). Platform-specific needs arrive as callbacks (ADR-008).
 */

import type { ContentKey, SubtitleCue } from '@lablo/core';
import { SubtitleTrack, cueText } from '@lablo/core';
import type { Clock } from './clock';
import { SYSTEM_CLOCK } from './clock';
import type { Container, EngineBuffer, EngineEvent, EngineStats, LoadOptions, PlayMode, PlaybackError, PlayerEngine } from './engine';
import { isPlaybackError } from './engine';
import type { PictureMode } from './picture';
import { pictureLayout, pictureModes } from './picture';
import type { AccountStatus, PlaybackFailure } from './failure';
import { blockedFailure, classifyFailure, wantsAccountCheck } from './failure';
import type { PlayTuning, WatchdogConfig } from './ladder';
import { DEFAULT_TUNING, RetryLadder } from './ladder';
import type { ExternalSub, PlayCandidate, PlayRequest, SourceMemory } from './request';
import { MemorySourceMemory, orderCandidates } from './request';
import type { PlayerTrack, PlayerTracks, TrackChoice, TrackMemory, TrackPreferences } from './tracks';
import { MemoryTrackMemory, NO_PREFERENCES, NO_TRACKS, fileIndex, fileTracks, findPick, playerTracks, preferredTrack, trackPick } from './tracks';

export type PlayerState =
  /** Nothing is loaded. */
  | 'idle'
  /** Opening a stream that hasn't shown a frame in this session yet. */
  | 'opening'
  | 'playing'
  /** Paused by the user. */
  | 'paused'
  /** Waiting for data after it had played. */
  | 'buffering'
  /** A retry after the stream had played: the UI keeps the picture and shows a badge. */
  | 'reconnecting'
  /** The end of a VOD file or recording. */
  | 'ended'
  /** Gave up: `failure` says why. */
  | 'failed';

export interface PlayerStatus {
  readonly state: PlayerState;
  /** Counts `play` and `stop` calls: a new value is a new stream. */
  readonly session: number;
  readonly key: ContentKey | null;
  /** The container of the URL being played or tried. */
  readonly container: Container | null;
  /** Retries since the stream last showed a frame. */
  readonly attempt: number;
  readonly failure: PlaybackFailure | null;
  /** The stream's audio and subtitle tracks (empty until the engine lists them). */
  readonly tracks: PlayerTracks;
}

/**
 * The stream on show, for the stream info (RELAY step 20c2a): the engine's figures, the container
 * of the URL that plays, the engine that plays it, and `load`, which is new with every load (a
 * retry, a zap): the engine's counters start again with it.
 */
export interface StreamStats extends EngineStats {
  readonly container: Container | null;
  readonly engine: PlayerEngine['kind'];
  readonly load: number;
}

/**
 * What the controller tells telemetry (RELAY step 33b2, architecture.md §3.4); never a URL.
 * - `play`: once per play (from `play()` to the next `play` or `stop`), at its first frame
 *   (`ttffMs` from `play()`, `error: null`) or at its give-up before any frame (`ttffMs: null`, the
 *   last error). A play left before either (a zap, a stop) or refused by the blocklist reports
 *   nothing. `container` is `'other'` for a request with no URL.
 * - `stall`: a failure after the play showed a frame, at its end: the next first frame
 *   (`recovered: true`) or the give-up (`recovered: false`), with the retries it took. A resume
 *   after a hide is no stall; a stall left by a zap or a stop reports nothing.
 */
export type PlayerReport =
  | {
      readonly type: 'play';
      readonly engine: PlayerEngine['kind'];
      readonly container: Container;
      readonly mode: PlayMode;
      readonly ttffMs: number | null;
      readonly error: PlaybackError | null;
    }
  | { readonly type: 'stall'; readonly recovered: boolean; readonly attempts: number };

export interface ControllerOptions {
  readonly clock?: Clock;
  readonly memory?: SourceMemory;
  /**
   * The watchdog's numbers and the engine's buffers (RELAY step 39d), asked for at each `play` and
   * kept for its session (default: `DEFAULT_TUNING`).
   */
  readonly tuning?: () => PlayTuning;
  /** Whether the TV can reach the internet (default: always). */
  readonly online?: () => boolean | Promise<boolean>;
  /** Re-checks a source's account after a provider failure (Xtream `player_api.php`); `null` when it can't. */
  readonly checkAccount?: (src: string) => Promise<AccountStatus | null>;
  /**
   * The redirect probe (Tizen, step 19): the URL to give the engine for `url`. `fresh` asks for
   * a new probe (a retry rung) instead of the source's remembered answer.
   */
  readonly resolveUrl?: (url: string, src: string, fresh: boolean) => Promise<string>;
  /**
   * Lets the TV's screensaver come (`true`) or keeps it away (`false`), called when that changes
   * (step 19; the app passes `Platform.setScreenSaver`). Away while a stream opens, plays,
   * buffers or reconnects; back when it is paused, ended, failed or stopped (Samsung's
   * certification wants it back whenever playback pauses or stops). The TV's own default,
   * allowed, is where it starts.
   */
  readonly screenSaver?: (allowed: boolean) => void;
  /** The preferred audio and subtitle languages, read each time a stream's tracks appear. */
  readonly preferences?: () => TrackPreferences;
  /** Each channel's track choice (default: kept for the app's run). */
  readonly trackMemory?: TrackMemory;
  /**
   * Fetches and parses a subtitle file of `PlayRequest.externalSubs` (the app: `fetch`, a size
   * cap, the charset, `parseSubtitles`). A rejection or no cues means it can't be shown. Without
   * it, a request's files aren't listed.
   */
  readonly loadSubtitles?: (sub: ExternalSub) => Promise<readonly SubtitleCue[]>;
  /**
   * The signed config's blocklist (RELAY step 30c3b; the app passes `DataEngine.blockedOrNone`):
   * for each URL, whether its server may not be played. Asked before the engine opens a URL, and
   * by `checkBlocklist`. A rejection blocks nothing (the blocklist is then unknown).
   */
  readonly blocked?: (urls: string[]) => Promise<boolean[]>;
  /** Telemetry's reports (step 33b2); one that throws changes nothing in playback. */
  readonly report?: (report: PlayerReport) => void;
}

/**
 * Where the subtitles the app draws come from: a file beside the stream, the text an engine
 * delivers for the stream's own subtitles (`caps.deliversSubtitleText`: AVPlay), or nowhere
 * (`null`: subtitles off, or drawn by the TV itself as webOS does).
 */
export type SubtitleFeed = 'file' | 'engine' | null;

/** What the subtitle overlay draws now. */
export interface SubtitleView {
  readonly feed: SubtitleFeed;
  /** The cues showing, top to bottom: plain text, lines joined by `\n` (empty: nothing to draw). */
  readonly cues: readonly string[];
}

/** A file's cues are looked up this often while it shows. */
export const CUE_TICK_MS = 250;
/** An engine cue that gives no duration shows this long. */
export const ENGINE_CUE_MS = 5000;
/** Engine cues showing at once (a newer one pushes the oldest out). */
export const MAX_ENGINE_CUES = 4;

const NO_SUBTITLES: SubtitleView = { feed: null, cues: [] };

/** The states in which a file's cues show. */
const SHOWS_CUES: readonly PlayerState[] = ['playing', 'paused', 'buffering'];

/** The states in which the screensaver is kept away. */
const KEEPS_SCREENSAVER_AWAY: readonly PlayerState[] = ['opening', 'playing', 'buffering', 'reconnecting'];

export interface PlayOptions {
  /** A VOD or catch-up position to start from, in ms (live streams always start at the live edge). */
  readonly startMs?: number;
}

interface Session {
  readonly req: PlayRequest;
  /** When the play began (the clock's time; a show that opens it again starts it again). */
  startedAt: number;
  readonly candidates: readonly PlayCandidate[];
  readonly live: boolean;
  /** The watchdog's numbers for this session (step 39d). */
  readonly watchdog: WatchdogConfig;
  /** What the engine is told to buffer for this session's stream (`null`: its own). */
  readonly buffer: EngineBuffer | null;
  readonly ladder: RetryLadder;
  /** Index of the URL being played or tried. */
  current: number;
  /** The URL the engine was given for it (the redirect probe's answer on Tizen; `null` until then). */
  url: string | null;
  /** URLs that showed a frame in this session. */
  readonly framed: boolean[];
  /** Any frame in this session. */
  played: boolean;
  /** VOD and catch-up: where a reopen starts (the last position the watchdog saw); live: never set. */
  resumeMs: number | undefined;
  /** Retries since the last frame. */
  attempt: number;
  tracks: PlayerTracks;
  /** The load whose tracks were looked at, and whether its audio and subtitles were chosen. */
  tracksToken: number;
  audioChosen: boolean;
  textChosen: boolean;
  /** The request's subtitle files (none without `loadSubtitles`). */
  readonly subs: readonly ExternalSub[];
  /** Each file's load, made once per session (a failed one is tried again next time). */
  readonly loads: (Promise<SubtitleTrack | null> | undefined)[];
  /** The file showing (-1: none) and its cues. */
  fileShown: number;
  file: SubtitleTrack | null;
  /** Counts subtitle switches: a slower one that a newer one overtook changes nothing. */
  textSeq: number;
}

const IDLE: PlayerStatus = { state: 'idle', session: 0, key: null, container: null, attempt: 0, failure: null, tracks: NO_TRACKS };

const NO_CHOICE: TrackChoice = { audio: null, text: null };

/** The track with `id`, or `null`. */
function byId(tracks: readonly PlayerTrack[], id: string): PlayerTrack | null {
  for (const t of tracks) if (t.id === id) return t;
  return null;
}

/** One of the stream's own subtitle tracks is on (not a file). */
function ownTextOn(s: Session): boolean {
  return s.tracks.text.some((t) => t.selected && fileIndex(t.id) === -1);
}

function sameTexts(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** An engine cue showing until `until` (the controller's clock). */
interface EngineCue {
  readonly text: string;
  readonly until: number;
}

/**
 * What the engine is told besides the URL: where a VOD or catch-up starts, that a radio
 * channel's stream has no picture (`PlayRequest.hints.audioOnly`, RELAY step 37b), and how much
 * to buffer (step 39d).
 */
function loadOptions(s: Session): LoadOptions {
  const opts: { startMs?: number; audioOnly?: boolean; buffer?: EngineBuffer } = {};
  if (s.resumeMs !== undefined) opts.startMs = s.resumeMs;
  if (s.buffer !== null) opts.buffer = s.buffer;
  const hints = s.req.hints;
  if (hints !== undefined && hints.audioOnly === true) opts.audioOnly = true;
  return opts;
}

/** A rejection from an engine or probe as a `PlaybackError` (anything unexpected is an app error). */
function asPlaybackError(reason: unknown): PlaybackError {
  return isPlaybackError(reason) ? reason : { kind: 'app', code: 'EXCEPTION' };
}

export class PlayerController {
  private readonly clock: Clock;
  private readonly memory: SourceMemory;
  private readonly tuning: () => PlayTuning;
  private readonly online: () => boolean | Promise<boolean>;
  private readonly checkAccount: ((src: string) => Promise<AccountStatus | null>) | undefined;
  private readonly resolveUrl: ((url: string, src: string, fresh: boolean) => Promise<string>) | undefined;
  private readonly screenSaver: ((allowed: boolean) => void) | undefined;
  private readonly preferences: () => TrackPreferences;
  private readonly trackMemory: TrackMemory;
  private readonly loadSubtitles: ((sub: ExternalSub) => Promise<readonly SubtitleCue[]>) | undefined;
  private readonly blocked: ((urls: string[]) => Promise<boolean[]>) | undefined;
  private readonly reportTo: ((report: PlayerReport) => void) | undefined;
  /** What the screensaver was last told (the TV's default: allowed). */
  private screenSaverAllowed = true;
  private readonly unsubscribe: () => void;
  private listeners: ((status: PlayerStatus) => void)[] = [];

  private current: PlayerStatus = IDLE;
  private s: Session | null = null;
  private sessionSeq = 0;
  private tokenSeq = 0;
  /** The token whose engine events count; 0 between loads. */
  private liveToken = 0;
  private stopping: Promise<void> | null = null;
  /**
   * While the app is hidden: `engine` (the engine holds the suspended stream), `reopen` (the
   * stream was still opening: closed, opened again on show) or `idle` (nothing to do). `null`
   * while shown.
   */
  private hidden: 'engine' | 'reopen' | 'idle' | null = null;

  private openTimer: unknown = null;
  private tickTimer: unknown = null;
  private retryTimer: unknown = null;
  private lastPos = 0;
  private lastMoveAt = 0;
  private bufferingSince = 0;
  /** The engine's last inflow reading (`PlayerEngine.inflow`) and when it last changed (step 39s7). */
  private lastInflow: string | null = null;
  private inflowAt = 0;

  private subtitleView: SubtitleView = NO_SUBTITLES;
  private subtitleListeners: ((view: SubtitleView) => void)[] = [];
  /** A file's cues show this much later (negative: earlier): the content's timing. */
  private delayMs = 0;
  private cueTimer: unknown = null;
  /** The engine's cues showing, oldest first, and the timer of the first to go. */
  private engineCues: EngineCue[] = [];
  private engineCueTimer: unknown = null;

  constructor(
    private readonly engine: PlayerEngine,
    options: ControllerOptions = {},
  ) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.memory = options.memory ?? new MemorySourceMemory();
    this.tuning = options.tuning ?? (() => DEFAULT_TUNING);
    this.online = options.online ?? (() => true);
    this.checkAccount = options.checkAccount;
    this.resolveUrl = options.resolveUrl;
    this.screenSaver = options.screenSaver;
    this.preferences = options.preferences ?? (() => NO_PREFERENCES);
    this.trackMemory = options.trackMemory ?? new MemoryTrackMemory();
    this.loadSubtitles = options.loadSubtitles;
    this.blocked = options.blocked;
    this.reportTo = options.report;
    this.unsubscribe = engine.on((e) => this.onEvent(e));
  }

  get status(): PlayerStatus {
    return this.current;
  }

  /** Calls `listener` on every status change; returns its removal. */
  subscribe(listener: (status: PlayerStatus) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** The subtitles to draw now (apart from the status, which would change with every cue). */
  get subtitles(): SubtitleView {
    return this.subtitleView;
  }

  /** Calls `listener` whenever the subtitles to draw change; returns its removal. */
  subscribeSubtitles(listener: (view: SubtitleView) => void): () => void {
    this.subtitleListeners.push(listener);
    return () => {
      this.subtitleListeners = this.subtitleListeners.filter((l) => l !== listener);
    };
  }

  /**
   * The subtitle timing of the content playing (ms; negative: earlier). A `play` sets it to the
   * timing remembered for its content, else 0 (step 20c1).
   */
  get subtitleDelay(): number {
    return this.delayMs;
  }

  /**
   * Shows the subtitle files' cues of the content playing `ms` later (negative: earlier), and
   * remembers that timing with the content's track choice (`TrackMemory`): it is a file's against
   * its stream, so another content starts at no delay. An engine's cues (AVPlay) arrive as the
   * stream plays and can't be moved.
   */
  setSubtitleDelay(ms: number): void {
    if (ms === this.delayMs) return;
    this.delayMs = ms;
    const s = this.s;
    if (s !== null) this.trackMemory.remember(s.req.key, { ...this.choice(s), delayMs: ms });
    this.updateSubtitles();
  }

  /**
   * Plays `req`, replacing whatever plays now (a zap). Resolves once its first load has been
   * issued, or once a newer `play` or `stop` took over.
   */
  play(req: PlayRequest, opts: PlayOptions = {}): Promise<void> {
    ++this.sessionSeq;
    const candidates = orderCandidates(req.candidates, this.memory.preferred(req.src));
    const tuning = this.tuning();
    const live = req.mode === 'live';
    const s: Session = {
      req,
      startedAt: this.clock.now(),
      candidates,
      live,
      watchdog: tuning.watchdog,
      buffer: live ? tuning.liveBuffer : tuning.vodBuffer,
      ladder: new RetryLadder(tuning.watchdog, { candidates: candidates.length, canReprobe: this.resolveUrl !== undefined }),
      current: 0,
      url: null,
      framed: [],
      played: false,
      resumeMs: req.mode === 'live' ? undefined : opts.startMs,
      attempt: 0,
      tracks: NO_TRACKS,
      tracksToken: 0,
      audioChosen: false,
      textChosen: false,
      subs: this.loadSubtitles === undefined ? [] : (req.externalSubs ?? []),
      loads: [],
      fileShown: -1,
      file: null,
      textSeq: 0,
    };
    this.setTracks(s, [], []);
    this.s = s;
    this.liveToken = 0;
    this.hidden = null;
    this.delayMs = this.choice(s).delayMs ?? 0;
    this.clearTimers();
    this.clearSubtitles();
    this.setState('opening');
    if (candidates.length === 0) {
      void this.closeEngine();
      return this.giveUp(s, { kind: 'app', code: 'NO_URL' });
    }
    return this.open(s, false);
  }

  /** Stops playback and closes the connection. */
  stop(): Promise<void> {
    ++this.sessionSeq;
    this.s = null;
    this.liveToken = 0;
    this.hidden = null;
    this.clearTimers();
    this.clearSubtitles();
    this.setState('idle');
    return this.closeEngine();
  }

  /**
   * The config's blocklist may have changed (a config refresh, RELAY step 30c3b): the URL on show
   * (and the redirect probe's answer) is asked about again, and a blocked one stops as at `open`.
   * Nothing is asked between loads (the next load asks itself) or once a VOD ended; a load or a
   * stop that comes before the answer wins.
   */
  checkBlocklist(): void {
    const s = this.s;
    const token = this.liveToken;
    if (s === null || token === 0 || this.blocked === undefined || this.current.state === 'ended') return;
    const urls = [s.candidates[s.current]!.url];
    if (s.url !== null && s.url !== urls[0]) urls.push(s.url);
    void this.isBlocked(urls).then((blocked) => {
      if (blocked && token === this.liveToken) this.refuseBlocked(s);
    });
  }

  /**
   * The app went to the background (`Platform.onLifecycle` `hidden`, RELAY step 20a): the
   * watchdog rests and engine events are dropped until `show()`.
   * - A stream that showed a picture (playing, buffering, paused) is suspended in the engine:
   *   Tizen keeps AVPlay's player (`suspend`/`restore`), webOS and the desktop close the
   *   connection and reopen the same URL.
   * - A stream still opening or waiting for a retry is closed (its load, probe or backoff is
   *   dropped) and opened again on show.
   *
   * No subtitles show while hidden; a file's come back with the picture.
   */
  hide(): void {
    if (this.hidden !== null) return;
    this.clearSubtitles();
    const state = this.current.state;
    if (this.s !== null && (state === 'playing' || state === 'buffering' || state === 'paused')) {
      this.clearTimers();
      this.engine.suspend();
      this.hidden = 'engine';
    } else if (this.s !== null && (state === 'opening' || state === 'reconnecting')) {
      this.liveToken = 0;
      this.clearTimers();
      void this.closeEngine();
      this.hidden = 'reopen';
    } else {
      this.hidden = 'idle';
    }
    this.updateSubtitles();
  }

  /**
   * The app is back (`visible`). A suspended stream resumes in the engine, which shows a new first
   * frame: until then the state is `reconnecting` and the open timeout runs (a paused stream plays
   * again). A stream that was opening opens its URL again.
   */
  show(): void {
    const how = this.hidden;
    this.hidden = null;
    const s = this.s;
    if (s === null) return;
    if (how === 'engine') {
      // webOS opens the stream again, with its default tracks: choose again when they come.
      s.tracksToken = 0;
      this.engine.resume();
      this.armOpenTimer(this.liveToken);
      this.setState('reconnecting');
    } else if (how === 'reopen' && (this.current.state === 'opening' || this.current.state === 'reconnecting')) {
      // The time to the first frame counts from here: the background is not the stream's.
      s.startedAt = this.clock.now();
      void this.open(s, false);
    }
  }

  /** Pauses a playing stream; the watchdog rests while paused. */
  pause(): void {
    const state = this.current.state;
    if (state !== 'playing' && state !== 'buffering') return;
    this.clearTimers();
    this.engine.pause();
    this.setState('paused');
  }

  resume(): void {
    if (this.current.state !== 'paused') return;
    this.engine.play();
    this.lastMoveAt = this.clock.now();
    this.inflowAt = this.lastMoveAt;
    this.setState('playing');
    this.scheduleTick();
  }

  /**
   * Where the stream on show is, in ms of its media time (RELAY step 25d: a catch-up's from the
   * start its URL asked for): the engine's clock while it shows a picture (playing, paused or
   * buffering), else 0.
   */
  positionMs(): number {
    return this.showsPicture() ? this.engine.positionMs() : 0;
  }

  /**
   * The length of the VOD or catch-up stream on show (RELAY step 26c: a movie's seek bar), in ms:
   * the engine's while it shows a picture, else 0 (and always 0 live, or when the engine doesn't
   * know it).
   */
  durationMs(): number {
    const s = this.s;
    return s === null || s.live || !this.showsPicture() ? 0 : this.engine.durationMs();
  }

  /**
   * Moves a VOD or catch-up stream on show to `ms` of its media time (RELAY step 25d), inside
   * the stream: the engine seeks, a later reopen starts there, and a paused stream stays paused.
   * `false` when nothing seekable shows (a live stream, or no picture yet), the engine refused,
   * or another play came first.
   */
  async seek(ms: number): Promise<boolean> {
    const s = this.s;
    if (s === null || s.live || !this.showsPicture()) return false;
    const to = Math.max(0, ms);
    const ok = await this.engine.seek(to).then(
      () => true,
      () => false,
    );
    if (this.s !== s || !ok) return false;
    s.resumeMs = to;
    return true;
  }

  /** A stream shows its picture: playing, paused or buffering. */
  private showsPicture(): boolean {
    const state = this.current.state;
    return this.s !== null && (state === 'playing' || state === 'paused' || state === 'buffering');
  }

  /**
   * Switches the audio to track `id` of `status.tracks.audio`, and remembers it for the channel
   * when the engine took it. `false` when nothing plays, the track isn't listed, or the engine
   * refused (the status's tracks say what plays).
   */
  async selectAudio(id: string): Promise<boolean> {
    const s = this.s;
    const track = s === null ? null : byId(s.tracks.audio, id);
    if (s === null || track === null) return false;
    const ok = await this.engine.selectAudio(id).catch(() => false);
    if (this.s !== s) return false;
    if (ok) this.trackMemory.remember(s.req.key, { ...this.choice(s), audio: trackPick(track) });
    this.readTracks(s);
    this.publish();
    return ok;
  }

  /**
   * Shows subtitle track `id` of `status.tracks.text` (`null`: none), remembered like
   * `selectAudio`. A file (`ext:n`) is loaded first (once per session) and the stream's own
   * subtitles go off; `false` when it can't be loaded or has no cues, or a newer choice overtook it.
   */
  async selectText(id: string | null): Promise<boolean> {
    const s = this.s;
    const track = s === null || id === null ? null : byId(s.tracks.text, id);
    if (s === null || (id !== null && track === null)) return false;
    const ok = await this.switchText(s, id);
    if (this.s !== s) return false;
    if (ok) this.trackMemory.remember(s.req.key, { ...this.choice(s), text: track === null ? 'off' : trackPick(track) });
    this.readTracks(s);
    this.publish();
    return ok;
  }

  /**
   * The stream on show (step 20c2a): `null` unless it shows a picture (playing, paused or
   * buffering): nothing while it opens, reconnects, has ended or failed.
   */
  stats(): StreamStats | null {
    if (!this.showsPicture()) return null;
    const e = this.engine.stats();
    return {
      width: e.width,
      height: e.height,
      bitrate: e.bitrate,
      droppedFrames: e.droppedFrames,
      decodedFrames: e.decodedFrames,
      decodedBytes: e.decodedBytes,
      videoCodec: e.videoCodec,
      audioCodec: e.audioCodec,
      audioChannels: e.audioChannels,
      container: this.current.container,
      engine: this.engine.kind,
      load: this.liveToken,
    };
  }

  /** The picture modes the engine can show (step 20c2b): `fit` always, `zoom` only where it crops (not AVPlay). */
  get pictureModes(): PictureMode[] {
    return pictureModes(this.engine.caps.fits);
  }

  /**
   * Shows every stream from now on in `mode` (step 20c2b): its rect and fit go to the engine,
   * which keeps them for every load. A mode the engine can't show is `fit`. Returns the mode shown.
   */
  setPicture(mode: PictureMode): PictureMode {
    const shown = this.pictureModes.indexOf(mode) === -1 ? 'fit' : mode;
    const layout = pictureLayout(shown);
    this.engine.setRect(layout.rect);
    this.engine.setFit(layout.fit);
    return shown;
  }

  /** Stops playback and lets go of the engine (the platform owns and destroys it). */
  dispose(): void {
    void this.stop();
    this.unsubscribe();
    this.listeners = [];
    this.subtitleListeners = [];
  }

  /**
   * Shows subtitle `id`: one of the stream's tracks (through the engine), a file (`ext:n`, with
   * the stream's own subtitles turned off), or none (`null`).
   */
  private async switchText(s: Session, id: string | null): Promise<boolean> {
    const mine = ++s.textSeq;
    const n = id === null ? -1 : fileIndex(id);
    if (n === -1) {
      // Off while only a file shows: the engine has nothing to turn off.
      const ok = id === null && !ownTextOn(s) ? true : await this.engine.selectText(id).catch(() => false);
      if (this.s !== s || s.textSeq !== mine) return false;
      if (ok) this.showFile(s, -1, null);
      return ok;
    }
    const file = await this.file(s, n);
    if (this.s !== s || s.textSeq !== mine || file === null) return false;
    if (ownTextOn(s)) {
      await this.engine.selectText(null).catch(() => false);
      if (this.s !== s || s.textSeq !== mine) return false;
    }
    this.showFile(s, n, file);
    return true;
  }

  /** File `n`'s cues: loaded once per session; `null` when it can't be loaded or has none (tried again next time). */
  private file(s: Session, n: number): Promise<SubtitleTrack | null> {
    const known = s.loads[n];
    if (known !== undefined) return known;
    const load = this.loadSubtitles!;
    const sub = s.subs[n]!;
    const loading = Promise.resolve()
      .then(() => load(sub))
      .then(
        (cues) => (cues.length > 0 ? new SubtitleTrack(cues) : null),
        () => null,
      )
      .then((track) => {
        if (track === null) s.loads[n] = undefined;
        return track;
      });
    s.loads[n] = loading;
    return loading;
  }

  /** File `n` shows (-1: none); the engine's cues go, since the subtitles changed. */
  private showFile(s: Session, n: number, file: SubtitleTrack | null): void {
    s.fileShown = n;
    s.file = file;
    this.dropEngineCues();
    this.setTracks(s, s.tracks.audio, s.tracks.text.filter((t) => fileIndex(t.id) === -1));
    this.updateSubtitles();
  }

  /**
   * Opens the session's current URL: close first (the blocklist asked meanwhile, step 30c3b), then
   * probe (where the platform probes; a redirect asked about too), then load.
   */
  private async open(s: Session, fresh: boolean): Promise<void> {
    const token = ++this.tokenSeq;
    this.liveToken = token;
    this.clearTimers();
    this.armOpenTimer(token);
    const candidate = s.candidates[s.current]!;
    s.url = null;
    const verdict = this.blocked === undefined ? null : this.isBlocked([candidate.url]);
    await this.closeEngine();
    if (token !== this.liveToken) return;
    if (verdict !== null) {
      const blocked = await verdict;
      if (token !== this.liveToken) return;
      if (blocked) {
        this.refuseBlocked(s);
        return;
      }
    }
    let url = candidate.url;
    if (this.resolveUrl !== undefined) {
      try {
        url = await this.resolveUrl(candidate.url, s.req.src, fresh);
      } catch (reason) {
        this.fail(token, asPlaybackError(reason));
        return;
      }
      if (token !== this.liveToken) return;
      // The probe's answer (Tizen): a redirect may lead to another server.
      if (url !== candidate.url && this.blocked !== undefined) {
        const blocked = await this.isBlocked([url]);
        if (token !== this.liveToken) return;
        if (blocked) {
          this.refuseBlocked(s);
          return;
        }
      }
    }
    s.url = url;
    // The time spent asking (the blocklist, the redirect probe) doesn't count against the open
    // timeout or the fallback's cap (step 39s7): on the Samsung TV a 4.7 s probe left a .ts URL
    // 1.3 s of the cap's 6 s, and the start went to .m3u8.
    if (verdict !== null || this.resolveUrl !== undefined) {
      this.clock.clearTimeout(this.openTimer);
      this.armOpenTimer(token);
    }
    try {
      await this.engine.load({ url, container: candidate.container, live: s.live }, token, loadOptions(s));
    } catch (reason) {
      this.fail(token, asPlaybackError(reason));
    }
  }

  /** Whether the blocklist refuses any of `urls` (step 30c3b); a failed check refuses none. */
  private isBlocked(urls: string[]): Promise<boolean> {
    const ask = this.blocked!;
    return Promise.resolve()
      .then(() => ask(urls))
      .then(
        (answers) => answers.indexOf(true) !== -1,
        () => false,
      );
  }

  /**
   * The blocklist refused the session's URL (step 30c3b): the stream stops and the session gives
   * up at once, with no retry and no account check. Hidden, nothing is left to resume on show.
   */
  private refuseBlocked(s: Session): void {
    this.liveToken = 0;
    this.clearTimers();
    void this.closeEngine();
    this.dropEngineCues();
    this.setTracks(s, [], []);
    if (this.hidden !== null) this.hidden = 'idle';
    this.setState('failed', blockedFailure());
  }

  /**
   * No first frame for the load `token` within the open timeout fails it. A live URL that hasn't
   * shown a frame in the session while another URL is untried fails sooner, at the fallback's cap
   * (RELAY step 39s2), and the ladder tries that URL. Not a `.ts` URL when `.ts` is the source's
   * remembered container (step 39s7: on the Samsung TV a real panel's `.ts` was 0.6 s from playing
   * when the cap cut it, and its `.m3u8` never showed a frame); a remembered `.m3u8` keeps the cap,
   * since AVPlay asks again for a playlist that answers 404 without an error (step 39s2).
   */
  private armOpenTimer(token: number): void {
    const s = this.s!;
    const limits = s.watchdog;
    const trusted = s.candidates[s.current]!.container === 'ts' && this.memory.preferred(s.req.src) === 'ts';
    const capped = s.live && !trusted && s.framed[s.current] !== true && s.ladder.untriedLeft();
    const ms = capped ? Math.min(limits.fallbackMs, limits.openTimeoutMs) : limits.openTimeoutMs;
    this.openTimer = this.clock.setTimeout(() => this.fail(token, { kind: 'timeout', code: 'OPEN' }), ms);
  }

  /** Stops the engine, or joins the stop already under way. */
  private closeEngine(): Promise<void> {
    if (this.stopping === null) {
      const noop = (): void => undefined;
      this.stopping = this.engine
        .stop()
        .then(noop, noop)
        .then(() => {
          this.stopping = null;
        });
    }
    return this.stopping;
  }

  private onEvent(e: EngineEvent & { readonly token: number }): void {
    if (e.token !== this.liveToken || this.hidden !== null) return;
    const s = this.s!;
    switch (e.type) {
      case 'firstFrame':
        this.onFirstFrame(s);
        return;
      case 'buffering':
        if (this.current.state !== 'playing') return;
        this.bufferingSince = this.clock.now();
        this.setState('buffering');
        return;
      case 'playing':
        if (this.current.state !== 'buffering') return;
        this.lastMoveAt = this.clock.now();
        this.inflowAt = this.lastMoveAt;
        this.setState('playing');
        return;
      case 'ended':
        if (s.live) {
          this.fail(e.token, { kind: 'stall', code: 'ENDED' });
          return;
        }
        this.clearTimers();
        this.setState('ended');
        return;
      case 'error':
        this.fail(e.token, e.error);
        return;
      case 'tracks':
        this.onTracks(s, e.token);
        this.publish();
        return;
      case 'cue':
        this.onCue(s, e.text, e.durationMs);
        return;
    }
  }

  /**
   * An engine delivered a cue of the stream's own subtitles (AVPlay): it shows for its duration
   * (a file showing instead turned them off). The same text again only stays longer.
   */
  private onCue(s: Session, raw: string, durationMs: number): void {
    if (!this.engine.caps.deliversSubtitleText || !ownTextOn(s)) return;
    const text = cueText(raw);
    if (text === '') return;
    const until = this.clock.now() + (durationMs > 0 ? durationMs : ENGINE_CUE_MS);
    const kept = this.engineCues.filter((c) => c.text !== text);
    kept.push({ text, until });
    this.engineCues = kept.slice(-MAX_ENGINE_CUES);
    this.armEngineCueTimer();
    this.updateSubtitles();
  }

  /** The next engine cue to go goes when its time is up. */
  private armEngineCueTimer(): void {
    this.clock.clearTimeout(this.engineCueTimer);
    this.engineCueTimer = null;
    if (this.engineCues.length === 0) return;
    let first = this.engineCues[0]!.until;
    for (const c of this.engineCues) if (c.until < first) first = c.until;
    this.engineCueTimer = this.clock.setTimeout(() => {
      const now = this.clock.now();
      this.engineCues = this.engineCues.filter((c) => c.until > now);
      this.armEngineCueTimer();
      this.updateSubtitles();
    }, first - this.clock.now());
  }

  private dropEngineCues(): void {
    this.engineCues = [];
    this.armEngineCueTimer();
  }

  /** Nothing shows: the engine's cues go and a file's lookups stop (`updateSubtitles` starts them again). */
  private clearSubtitles(): void {
    this.dropEngineCues();
    this.clock.clearTimeout(this.cueTimer);
    this.cueTimer = null;
  }

  /** While a file shows and the app is in view, its cues are looked up every `CUE_TICK_MS`. */
  private armCueTick(): void {
    const s = this.s;
    if (this.cueTimer !== null || s === null || s.file === null || this.hidden !== null) return;
    this.cueTimer = this.clock.setTimeout(() => {
      this.cueTimer = null;
      this.updateSubtitles();
    }, CUE_TICK_MS);
  }

  /** Works out what the overlay draws, and tells the listeners when that changed. */
  private updateSubtitles(): void {
    const s = this.s;
    let feed: SubtitleFeed = null;
    let cues: readonly string[] = [];
    if (s !== null && s.file !== null) {
      feed = 'file';
      if (this.hidden === null && SHOWS_CUES.indexOf(this.current.state) !== -1) {
        cues = s.file.cuesAt(this.engine.positionMs() - this.delayMs).map((c) => c.text);
      }
    } else if (s !== null && this.engine.caps.deliversSubtitleText && ownTextOn(s)) {
      feed = 'engine';
      cues = this.engineCues.map((c) => c.text);
    }
    this.armCueTick();
    const view = this.subtitleView;
    if (feed === view.feed && sameTexts(cues, view.cues)) return;
    this.subtitleView = { feed, cues };
    for (const listener of this.subtitleListeners.slice()) listener(this.subtitleView);
  }

  private onFirstFrame(s: Session): void {
    this.clock.clearTimeout(this.openTimer);
    this.openTimer = null;
    // The play's result, or the end of a stall (retries since the last frame); a resume after a
    // hide has none.
    const first = !s.played;
    if (first) this.tell(this.playReport(s, this.clock.now() - s.startedAt, null));
    else if (s.attempt > 0) this.tell({ type: 'stall', recovered: true, attempts: s.attempt });
    s.played = true;
    s.framed[s.current] = true;
    s.attempt = 0;
    s.ladder.recovered(first);
    // Only a choice between URLs is worth remembering (a VOD play must not reset a live preference).
    if (s.candidates.length > 1 && this.movesMemory(s)) this.memory.remember(s.req.src, s.candidates[s.current]!.container);
    // An engine may list its tracks before the picture without an event.
    this.onTracks(s, this.liveToken);
    this.lastPos = this.engine.positionMs();
    this.lastMoveAt = this.clock.now();
    this.lastInflow = this.readInflow();
    this.inflowAt = this.lastMoveAt;
    this.setState('playing');
    this.scheduleTick();
  }

  /**
   * Whether the URL that showed a frame becomes the source's first choice (RELAY step 39s2): the
   * request's own first container always does (the default order is back); another one only when
   * a URL failed definitively in the session (`isDefinitive`). An outage, a timeout or a stall
   * never moves the source: a switch that played after one says nothing about the other URL.
   */
  private movesMemory(s: Session): boolean {
    return s.candidates[s.current]!.container === s.req.candidates[0]!.container || s.ladder.otherFailedForGood(s.current);
  }

  /**
   * The session's tracks: the stream's own (none yet: `[]`), its subtitle files after its own
   * subtitles, and the engine's switching as it is now (Tizen's engine changes with the URL).
   */
  private setTracks(s: Session, audio: readonly PlayerTrack[], text: readonly PlayerTrack[]): void {
    s.tracks = { audio, text: s.subs.length === 0 ? text : text.concat(fileTracks(s.subs, s.fileShown)), switching: this.engine.caps.trackSwitch };
  }

  private readTracks(s: Session): void {
    try {
      const listed = this.engine.getTracks();
      this.setTracks(s, playerTracks(listed.audio), playerTracks(listed.text));
    } catch {
      this.setTracks(s, [], []);
    }
  }

  private choice(s: Session): TrackChoice {
    return this.trackMemory.choice(s.req.key) ?? NO_CHOICE;
  }

  /**
   * The load `token` listed its tracks: the first time each kind appears, the channel's
   * remembered choice, else the first preferred language the stream has, is switched on (a
   * remembered "off" turns subtitles off).
   */
  private onTracks(s: Session, token: number): void {
    this.readTracks(s);
    if (s.tracksToken !== token) {
      s.tracksToken = token;
      s.audioChosen = false;
      s.textChosen = false;
    }
    const { audio, text } = s.tracks;
    const choice = this.choice(s);
    if (!s.audioChosen && audio.length > 0) {
      s.audioChosen = true;
      const want = (choice.audio === null ? null : findPick(audio, choice.audio)) ?? preferredTrack(audio, this.preferences().audio);
      if (want !== null && !want.selected) this.autoSwitch(s, token, this.engine.selectAudio(want.id));
    }
    if (!s.textChosen && text.length > 0) {
      s.textChosen = true;
      if (choice.text === 'off') {
        if (text.some((t) => t.selected)) this.autoSwitch(s, token, this.switchText(s, null));
      } else {
        const want = (choice.text === null ? null : findPick(text, choice.text)) ?? preferredTrack(text, this.preferences().text);
        // A file that still shows after a retry: the new load's own default subtitles go off.
        if (want !== null && (!want.selected || (fileIndex(want.id) !== -1 && ownTextOn(s)))) this.autoSwitch(s, token, this.switchText(s, want.id));
      }
    }
  }

  /**
   * A switch the player made itself: the status shows the tracks once it settles (not
   * remembered), unless the load changed meanwhile (a zap or a retry: tokens are never reused).
   */
  private autoSwitch(s: Session, token: number, switched: Promise<boolean>): void {
    const settled = (): void => {
      if (this.liveToken !== token) return;
      this.readTracks(s);
      this.publish();
    };
    switched.then(settled, settled);
  }

  /** Tells the listeners about a change that kept the state (the tracks). */
  private publish(): void {
    this.setState(this.current.state, this.current.failure);
  }

  private scheduleTick(): void {
    this.tickTimer = this.clock.setTimeout(() => this.tick(), this.s!.watchdog.tickMs);
  }

  /** The engine's inflow reading (step 39s7), or `null` where it has none or the reading throws. */
  private readInflow(): string | null {
    if (this.engine.inflow === undefined) return null;
    try {
      return this.engine.inflow();
    } catch {
      return null;
    }
  }

  /** The watchdog: reads the position and checks the stall rules. */
  private tick(): void {
    const s = this.s!;
    const now = this.clock.now();
    const pos = this.engine.positionMs();
    if (pos !== this.lastPos) {
      this.lastPos = pos;
      this.lastMoveAt = now;
      if (!s.live) s.resumeMs = pos;
    }
    const flow = this.readInflow();
    if (flow === null || flow !== this.lastInflow) {
      this.lastInflow = flow;
      this.inflowAt = now;
    }
    const state = this.current.state;
    const limits = s.watchdog;
    if (state === 'playing' && s.live && now - this.lastMoveAt >= limits.liveFrozenMs) {
      this.fail(this.liveToken, { kind: 'stall', code: 'FROZEN' });
      return;
    }
    // A held socket (step 39s7): nothing has arrived for `liveNoDataMs`, whatever the engine's clock says.
    if (state === 'playing' && s.live && flow !== null && now - this.inflowAt >= limits.liveNoDataMs) {
      this.fail(this.liveToken, { kind: 'stall', code: 'NO_DATA' });
      return;
    }
    if (state === 'buffering' && now - this.bufferingSince >= (s.live ? limits.liveBufferingMs : limits.vodBufferingMs)) {
      this.fail(this.liveToken, { kind: 'stall', code: 'BUFFERING' });
      return;
    }
    this.scheduleTick();
  }

  /** A failure of the load `token`: retry by the ladder, or give up. */
  private fail(token: number, error: PlaybackError): void {
    if (token !== this.liveToken) return;
    const s = this.s!;
    this.liveToken = 0;
    this.clearTimers();
    void this.closeEngine();
    this.dropEngineCues();
    this.setTracks(s, [], []);
    const plan = s.ladder.next(error, s.current, s.framed[s.current] === true, this.clock.now());
    if (plan === null) {
      void this.giveUp(s, error);
      return;
    }
    s.current = plan.candidate;
    s.attempt++;
    this.setState(s.played ? 'reconnecting' : 'opening');
    const fresh = plan.rung === 'reprobe';
    if (plan.delayMs === 0) void this.open(s, fresh);
    else this.retryTimer = this.clock.setTimeout(() => void this.open(s, fresh), plan.delayMs);
  }

  /** The play's report: the engine, the URL's container (`other` with none), the mode. */
  private playReport(s: Session, ttffMs: number | null, error: PlaybackError | null): PlayerReport {
    const candidate = s.candidates[s.current];
    return { type: 'play', engine: this.engine.kind, container: candidate === undefined ? 'other' : candidate.container, mode: s.req.mode, ttffMs, error };
  }

  /** Hands a report to telemetry; one that throws changes nothing here. */
  private tell(report: PlayerReport): void {
    try {
      this.reportTo?.(report);
    } catch (error) {
      console.warn('A player report failed', error);
    }
  }

  /** Classifies the failure (re-checking the account after a provider failure) and shows it. */
  private async giveUp(s: Session, error: PlaybackError): Promise<void> {
    // The play's result when nothing played, else the end of its stall.
    this.tell(s.played ? { type: 'stall', recovered: false, attempts: s.attempt } : this.playReport(s, null, error));
    let online = true;
    try {
      online = await this.online();
    } catch {
      // A broken connectivity check says nothing about the stream.
    }
    if (this.s !== s) return;
    let failure = classifyFailure({ error, online });
    if (wantsAccountCheck(failure.category) && this.checkAccount !== undefined) {
      let account: AccountStatus | null = null;
      try {
        account = await this.checkAccount(s.req.src);
      } catch {
        // No answer: the card shows the stream's own failure.
      }
      if (this.s !== s) return;
      failure = classifyFailure({ error, online, account });
    }
    this.setState('failed', failure);
  }

  private clearTimers(): void {
    this.clock.clearTimeout(this.openTimer);
    this.clock.clearTimeout(this.tickTimer);
    this.clock.clearTimeout(this.retryTimer);
    this.openTimer = null;
    this.tickTimer = null;
    this.retryTimer = null;
  }

  private setState(state: PlayerState, failure: PlaybackFailure | null = null): void {
    const s = this.s;
    this.current = {
      state,
      session: this.sessionSeq,
      key: s === null ? null : s.req.key,
      container: s === null ? null : (s.candidates[s.current]?.container ?? null),
      attempt: s === null ? 0 : s.attempt,
      failure,
      tracks: s === null ? NO_TRACKS : s.tracks,
    };
    const allowed = KEEPS_SCREENSAVER_AWAY.indexOf(state) === -1;
    if (allowed !== this.screenSaverAllowed) {
      this.screenSaverAllowed = allowed;
      if (this.screenSaver !== undefined) this.screenSaver(allowed);
    }
    for (const listener of this.listeners.slice()) listener(this.current);
    this.updateSubtitles();
  }
}
