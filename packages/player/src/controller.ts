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
 * Debounced zapping, tracks, subtitles and the app lifecycle come with the engines and the
 * player UI (steps 18–20). Platform-specific needs arrive as callbacks (ADR-008).
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
}

const IDLE: PlayerStatus = { state: 'idle', session: 0, key: null, container: null, attempt: 0, failure: null };

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
    };
    this.s = s;
    this.liveToken = 0;
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
    this.clearTimers();
    this.setState('idle');
    return this.closeEngine();
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
    this.openTimer = this.clock.setTimeout(() => this.fail(token, { kind: 'timeout', code: 'OPEN' }), this.config.openTimeoutMs);
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
    if (e.token !== this.liveToken) return;
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
      case 'cue':
        // Track preferences and the subtitle overlay come with the player UI (step 20).
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
    this.lastPos = this.engine.positionMs();
    this.lastMoveAt = this.clock.now();
    this.setState('playing');
    this.scheduleTick();
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
    };
    const allowed = KEEPS_SCREENSAVER_AWAY.indexOf(state) === -1;
    if (allowed !== this.screenSaverAllowed) {
      this.screenSaverAllowed = allowed;
      if (this.screenSaver !== undefined) this.screenSaver(allowed);
    }
    for (const listener of this.listeners.slice()) listener(this.current);
  }
}
