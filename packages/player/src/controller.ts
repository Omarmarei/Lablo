/**
 * PlayerController (architecture.md §2, RELAY step 17): the platform-agnostic owner of
 * playback. It drives one `PlayerEngine` and owns:
 * - **session tokens:** every engine load gets a new token, and events carrying any other token
 *   are dropped, so a late event from a channel the user zapped away from changes nothing;
 * - **close-before-open:** the engine's `stop()` is awaited before every `load` (providers often
 *   allow one connection), and a stop already under way is shared, not overtaken;
 * - **the URL strategy:** a request's URLs are tried in order, with the container that last
 *   played for the source first (`request.ts`);
 * - **the watchdog and the retry ladder** (`ladder.ts`): stalls and errors reopen, re-probe or
 *   switch container while the UI shows "Reconnecting…", and give up after 4 attempts in 60 s;
 * - **the error classifier** (`failure.ts`): giving up yields a category and a code, with the
 *   account re-checked after a provider failure.
 *
 * - **the app lifecycle** (`hide`/`show`, step 20a): the watchdog rests while the app is hidden;
 * - **tracks** (step 20b, `tracks.ts`): the stream's audio and subtitle tracks in the status, the
 *   channel's remembered choice or the preferred languages applied when they appear, and the
 *   menu's switches remembered for the channel.
 *
 * Debounced zapping, number entry, the info bar and the track menu are the app's
 * (apps/tv/src/player); the subtitle overlay comes with step 20b2. Platform-specific needs arrive
 * as callbacks (ADR-008).
 */

import type { ContentKey } from '@zoma/core';
import type { Clock } from './clock';
import { SYSTEM_CLOCK } from './clock';
import type { Container, EngineEvent, PlaybackError, PlayerEngine } from './engine';
import { isPlaybackError } from './engine';
import type { AccountStatus, PlaybackFailure } from './failure';
import { classifyFailure, wantsAccountCheck } from './failure';
import type { WatchdogConfig } from './ladder';
import { DEFAULT_WATCHDOG, RetryLadder } from './ladder';
import type { PlayCandidate, PlayRequest, SourceMemory } from './request';
import { MemorySourceMemory, orderCandidates } from './request';
import type { PlayerTrack, PlayerTracks, TrackChoice, TrackMemory, TrackPreferences } from './tracks';
import { MemoryTrackMemory, NO_PREFERENCES, NO_TRACKS, findPick, playerTracks, preferredTrack, trackPick } from './tracks';

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

export interface ControllerOptions {
  readonly clock?: Clock;
  readonly memory?: SourceMemory;
  readonly config?: WatchdogConfig;
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
}

/** The states in which the screensaver is kept away. */
const KEEPS_SCREENSAVER_AWAY: readonly PlayerState[] = ['opening', 'playing', 'buffering', 'reconnecting'];

export interface PlayOptions {
  /** A VOD or catch-up position to start from, in ms (live streams always start at the live edge). */
  readonly startMs?: number;
}

interface Session {
  readonly req: PlayRequest;
  readonly candidates: readonly PlayCandidate[];
  readonly live: boolean;
  readonly ladder: RetryLadder;
  /** Index of the URL being played or tried. */
  current: number;
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
}

const IDLE: PlayerStatus = { state: 'idle', session: 0, key: null, container: null, attempt: 0, failure: null, tracks: NO_TRACKS };

const NO_CHOICE: TrackChoice = { audio: null, text: null };

/** The track with `id`, or `null`. */
function byId(tracks: readonly PlayerTrack[], id: string): PlayerTrack | null {
  for (const t of tracks) if (t.id === id) return t;
  return null;
}

/** A rejection from an engine or probe as a `PlaybackError` (anything unexpected is an app error). */
function asPlaybackError(reason: unknown): PlaybackError {
  return isPlaybackError(reason) ? reason : { kind: 'app', code: 'EXCEPTION' };
}

export class PlayerController {
  private readonly clock: Clock;
  private readonly memory: SourceMemory;
  private readonly config: WatchdogConfig;
  private readonly online: () => boolean | Promise<boolean>;
  private readonly checkAccount: ((src: string) => Promise<AccountStatus | null>) | undefined;
  private readonly resolveUrl: ((url: string, src: string, fresh: boolean) => Promise<string>) | undefined;
  private readonly screenSaver: ((allowed: boolean) => void) | undefined;
  private readonly preferences: () => TrackPreferences;
  private readonly trackMemory: TrackMemory;
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

  constructor(
    private readonly engine: PlayerEngine,
    options: ControllerOptions = {},
  ) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.memory = options.memory ?? new MemorySourceMemory();
    this.config = options.config ?? DEFAULT_WATCHDOG;
    this.online = options.online ?? (() => true);
    this.checkAccount = options.checkAccount;
    this.resolveUrl = options.resolveUrl;
    this.screenSaver = options.screenSaver;
    this.preferences = options.preferences ?? (() => NO_PREFERENCES);
    this.trackMemory = options.trackMemory ?? new MemoryTrackMemory();
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

  /**
   * Plays `req`, replacing whatever plays now (a zap). Resolves once its first load has been
   * issued, or once a newer `play` or `stop` took over.
   */
  play(req: PlayRequest, opts: PlayOptions = {}): Promise<void> {
    ++this.sessionSeq;
    const candidates = orderCandidates(req.candidates, this.memory.preferred(req.src));
    const s: Session = {
      req,
      candidates,
      live: req.mode === 'live',
      ladder: new RetryLadder(this.config, { candidates: candidates.length, canReprobe: this.resolveUrl !== undefined }),
      current: 0,
      framed: [],
      played: false,
      resumeMs: req.mode === 'live' ? undefined : opts.startMs,
      attempt: 0,
      tracks: this.noTracks(),
      tracksToken: 0,
      audioChosen: false,
      textChosen: false,
    };
    this.s = s;
    this.liveToken = 0;
    this.hidden = null;
    this.clearTimers();
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
    this.setState('idle');
    return this.closeEngine();
  }

  /**
   * The app went to the background (`Platform.onLifecycle` `hidden`, RELAY step 20a): the
   * watchdog rests and engine events are dropped until `show()`.
   * - A stream that showed a picture (playing, buffering, paused) is suspended in the engine:
   *   Tizen keeps AVPlay's player (`suspend`/`restore`), webOS and the desktop close the
   *   connection and reopen the same URL.
   * - A stream still opening or waiting for a retry is closed (its load, probe or backoff is
   *   dropped) and opened again on show.
   */
  hide(): void {
    if (this.hidden !== null) return;
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
    this.setState('playing');
    this.scheduleTick();
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
    // The user's choice: a later list of this load doesn't override it.
    s.audioChosen = true;
    const ok = await this.engine.selectAudio(id).catch(() => false);
    if (this.s !== s) return false;
    if (ok) this.trackMemory.remember(s.req.key, { audio: trackPick(track), text: this.choice(s).text });
    this.readTracks(s);
    this.publish();
    return ok;
  }

  /** Shows subtitle track `id` of `status.tracks.text` (`null`: none), remembered like `selectAudio`. */
  async selectText(id: string | null): Promise<boolean> {
    const s = this.s;
    const track = s === null || id === null ? null : byId(s.tracks.text, id);
    if (s === null || (id !== null && track === null)) return false;
    s.textChosen = true;
    const ok = await this.engine.selectText(id).catch(() => false);
    if (this.s !== s) return false;
    if (ok) this.trackMemory.remember(s.req.key, { audio: this.choice(s).audio, text: track === null ? 'off' : trackPick(track) });
    this.readTracks(s);
    this.publish();
    return ok;
  }

  /** Stops playback and lets go of the engine (the platform owns and destroys it). */
  dispose(): void {
    void this.stop();
    this.unsubscribe();
    this.listeners = [];
  }

  /** Opens the session's current URL: close first, then probe (where the platform probes), then load. */
  private async open(s: Session, fresh: boolean): Promise<void> {
    const token = ++this.tokenSeq;
    this.liveToken = token;
    this.clearTimers();
    this.armOpenTimer(token);
    s.tracks = this.noTracks();
    await this.closeEngine();
    if (token !== this.liveToken) return;
    const candidate = s.candidates[s.current]!;
    let url = candidate.url;
    if (this.resolveUrl !== undefined) {
      try {
        url = await this.resolveUrl(candidate.url, s.req.src, fresh);
      } catch (reason) {
        this.fail(token, asPlaybackError(reason));
        return;
      }
      if (token !== this.liveToken) return;
    }
    try {
      await this.engine.load({ url, container: candidate.container, live: s.live }, token, s.resumeMs === undefined ? {} : { startMs: s.resumeMs });
    } catch (reason) {
      this.fail(token, asPlaybackError(reason));
    }
  }

  /** No first frame for the load `token` within the open timeout fails it. */
  private armOpenTimer(token: number): void {
    this.openTimer = this.clock.setTimeout(() => this.fail(token, { kind: 'timeout', code: 'OPEN' }), this.config.openTimeoutMs);
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
        // The subtitle overlay comes with step 20b2.
        return;
    }
  }

  private onFirstFrame(s: Session): void {
    this.clock.clearTimeout(this.openTimer);
    this.openTimer = null;
    s.played = true;
    s.framed[s.current] = true;
    s.attempt = 0;
    s.ladder.recovered();
    // Only a choice between URLs is worth remembering (a VOD play must not reset a live preference).
    if (s.candidates.length > 1) this.memory.remember(s.req.src, s.candidates[s.current]!.container);
    // An engine may list its tracks before the picture without an event.
    this.onTracks(s, this.liveToken);
    this.lastPos = this.engine.positionMs();
    this.lastMoveAt = this.clock.now();
    this.setState('playing');
    this.scheduleTick();
  }

  /** No tracks yet, with the engine's switching as it is now (Tizen's engine changes with the URL). */
  private noTracks(): PlayerTracks {
    return { audio: [], text: [], switching: this.engine.caps.trackSwitch };
  }

  private readTracks(s: Session): void {
    try {
      const listed = this.engine.getTracks();
      s.tracks = { audio: playerTracks(listed.audio), text: playerTracks(listed.text), switching: this.engine.caps.trackSwitch };
    } catch {
      s.tracks = this.noTracks();
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
        if (text.some((t) => t.selected)) this.autoSwitch(s, token, this.engine.selectText(null));
      } else {
        const want = (choice.text === null ? null : findPick(text, choice.text)) ?? preferredTrack(text, this.preferences().text);
        if (want !== null && !want.selected) this.autoSwitch(s, token, this.engine.selectText(want.id));
      }
    }
  }

  /** A switch the player made itself: the status shows the tracks once it settles (not remembered). */
  private autoSwitch(s: Session, token: number, switched: Promise<boolean>): void {
    const settled = (): void => {
      if (this.s !== s || this.liveToken !== token) return;
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
    this.tickTimer = this.clock.setTimeout(() => this.tick(), this.config.tickMs);
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
    const state = this.current.state;
    if (state === 'playing' && s.live && now - this.lastMoveAt >= this.config.liveFrozenMs) {
      this.fail(this.liveToken, { kind: 'stall', code: 'FROZEN' });
      return;
    }
    if (state === 'buffering' && now - this.bufferingSince >= (s.live ? this.config.liveBufferingMs : this.config.vodBufferingMs)) {
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
    s.tracks = this.noTracks();
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

  /** Classifies the failure (re-checking the account after a provider failure) and shows it. */
  private async giveUp(s: Session, error: PlaybackError): Promise<void> {
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
  }
}
