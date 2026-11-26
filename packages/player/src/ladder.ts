/**
 * The watchdog's thresholds and the retry ladder (architecture.md §2).
 *
 * Stalls: a live stream whose position hasn't moved for 6 s while playing, or that has
 * buffered for 12 s; a VOD file or recording that has buffered for 20 s. Nothing on the screen
 * 10 s after a load is an open timeout (a three-302 chain took up to 4.1 s on the LG TV). A live
 * URL that hasn't shown a frame in the session while another URL is still untried gets 6 s, then
 * that URL is tried (the fallback's cap, RELAY step 39s2: AVPlay retried a `.m3u8` answering 404
 * for about 15 s before the app went on to `.ts`).
 *
 * After a failure the ladder decides the next attempt:
 * 1. Before the stream has shown a frame on a URL, the next untried URL (the URL strategy).
 * 2. Otherwise: reopen the same URL, re-run the redirect probe (only where the platform probes),
 *    switch container (only with a second URL), then reopen with backoff (1, 2, 4 s).
 * 3. A failure that a retry of the same URL can't fix (`isDefinitive`) tries an untried URL
 *    first, and the URL stays out of the session: the switch rung never goes back to it (on the
 *    desktop a `.ts` URL the browser can't play would otherwise take an attempt, and its
 *    "unsupported" would hide the provider's failure on `.m3u8`). With no untried URL left, the
 *    ladder goes on with a URL that hasn't failed that way (RELAY step 20a: a switch from a
 *    broken `.m3u8` to a `.ts` the TV refuses goes back to the `.m3u8` with backoff), and gives
 *    up only when every URL has.
 * It gives up when 4 attempts have been made within the last 60 s. A frame on the screen
 * starts the ladder again from its first rung; the attempts keep counting in the window, except
 * that the session's first frame forgets the attempts that found a URL (RELAY step 39s7).
 *
 * Stalls also include a live stream whose inflow (`PlayerEngine.inflow`: AVPlay's current
 * bandwidth, or an HLS live window's end) hasn't changed for 30 s while it plays (step 39s7).
 *
 * The app chooses the numbers for each play (`PlayTuning`, RELAY step 39d): Settings › "Player"'s
 * "Buffering" (Fast start or Stable) and remote config's tunables.
 */

import type { EngineBuffer, PlaybackError } from './engine';
import { isDefinitive } from './failure';

export interface WatchdogConfig {
  /** Live: the position hasn't moved for this long while playing. */
  readonly liveFrozenMs: number;
  /** Live: buffering for this long. */
  readonly liveBufferingMs: number;
  /**
   * Live: what the engine says arrives (`PlayerEngine.inflow`) hasn't changed for this long while
   * it plays (RELAY step 39s7). A held socket can freeze the picture while the engine's clock runs
   * on and no buffering is reported (the Samsung TV on 2026-11-25); the bytes stop either way.
   */
  readonly liveNoDataMs: number;
  /** VOD and catch-up: buffering for this long. */
  readonly vodBufferingMs: number;
  /** No first frame this long after a load starts. */
  readonly openTimeoutMs: number;
  /**
   * Live: no first frame this long after a load starts, on a URL that hasn't shown one in the
   * session while another URL is untried, tries that URL (the fallback's cap; capped by
   * `openTimeoutMs`).
   */
  readonly fallbackMs: number;
  /** How often the watchdog reads the position. */
  readonly tickMs: number;
  /** Give up once this many attempts were made within `windowMs`. */
  readonly maxAttempts: number;
  readonly windowMs: number;
  /** Delays before the reopens after the first pass of the ladder; the last one repeats. */
  readonly backoffMs: readonly number[];
}

export const DEFAULT_WATCHDOG: WatchdogConfig = {
  liveFrozenMs: 6000,
  liveBufferingMs: 12_000,
  liveNoDataMs: 30_000,
  vodBufferingMs: 20_000,
  openTimeoutMs: 10_000,
  fallbackMs: 6000,
  tickMs: 500,
  maxAttempts: 4,
  windowMs: 60_000,
  backoffMs: [1000, 2000, 4000],
};

/**
 * What one play is tuned with (RELAY step 39d): the watchdog's numbers, and the engine's buffers
 * for a live stream and for VOD or catch-up (`null`: the engine's own).
 */
export interface PlayTuning {
  readonly watchdog: WatchdogConfig;
  readonly liveBuffer: EngineBuffer | null;
  readonly vodBuffer: EngineBuffer | null;
}

/** Today's watchdog and each engine's own buffers. */
export const DEFAULT_TUNING: PlayTuning = { watchdog: DEFAULT_WATCHDOG, liveBuffer: null, vodBuffer: null };

/** What an attempt does: the next untried URL, the same URL again, the same URL re-probed, or the next URL in the list. */
export type Rung = 'next-url' | 'reopen' | 'reprobe' | 'switch';

export interface RetryPlan {
  readonly rung: Rung;
  /** Index of the URL to open. */
  readonly candidate: number;
  readonly delayMs: number;
}

export interface LadderOptions {
  /** How many URLs the request has. */
  readonly candidates: number;
  /** The platform runs a redirect probe (Tizen), so `reprobe` is a rung. */
  readonly canReprobe: boolean;
}

export class RetryLadder {
  /** When each attempt in the window was made. */
  private attempts: number[] = [];
  /** URLs opened in this play session. */
  private readonly opened: boolean[] = [];
  /** URLs that failed definitively in this play session. */
  private readonly dead: boolean[] = [];
  /** Rungs climbed since the stream last showed a frame. */
  private step = 0;

  constructor(
    private readonly config: WatchdogConfig,
    private readonly options: LadderOptions,
  ) {
    this.opened[0] = true;
  }

  /**
   * The stream showed a frame: the next failure starts again from the first rung. The session's
   * first frame also forgets the attempts that found a URL (RELAY step 39s7: on the Samsung TV a
   * slow start used three of the four, and the provider's first drop 15 s later gave up at once);
   * a stream that keeps failing after it played still gives up after `maxAttempts`.
   */
  recovered(first = false): void {
    this.step = 0;
    if (first) this.attempts = [];
  }

  /** Whether a URL is still untried in this session. */
  untriedLeft(): boolean {
    return this.untried() !== -1;
  }

  /** Whether a URL other than `current` failed definitively in this session. */
  otherFailedForGood(current: number): boolean {
    for (let i = 0; i < this.options.candidates; i++) if (i !== current && this.dead[i] === true) return true;
    return false;
  }

  /**
   * The next attempt after `error` on URL `current`, or `null` to give up. `framed` says
   * whether `current` has shown a frame in this session.
   */
  next(error: PlaybackError, current: number, framed: boolean, now: number): RetryPlan | null {
    const windowStart = now - this.config.windowMs;
    this.attempts = this.attempts.filter((t) => t > windowStart);
    if (this.attempts.length >= this.config.maxAttempts) return null;
    if (isDefinitive(error)) this.dead[current] = true;
    const plan = this.plan(error, current, framed);
    if (plan !== null) {
      this.attempts.push(now);
      this.opened[plan.candidate] = true;
    }
    return plan;
  }

  private untried(): number {
    for (let i = 0; i < this.options.candidates; i++) if (this.opened[i] !== true) return i;
    return -1;
  }

  /** The next URL after `current` (wrapping) that hasn't failed definitively, or -1. */
  private other(current: number): number {
    const n = this.options.candidates;
    for (let k = 1; k < n; k++) {
      const i = (current + k) % n;
      if (this.dead[i] !== true) return i;
    }
    return -1;
  }

  private plan(error: PlaybackError, failed: number, framed: boolean): RetryPlan | null {
    const untried = this.untried();
    if (untried !== -1 && (!framed || isDefinitive(error))) return { rung: 'next-url', candidate: untried, delayMs: 0 };
    // A URL that failed for good hands the ladder to one that hasn't.
    const current = isDefinitive(error) ? this.other(failed) : failed;
    if (current === -1) return null;
    const rungs: Rung[] = ['reopen'];
    if (this.options.canReprobe) rungs.push('reprobe');
    const other = this.other(current);
    if (other !== -1) rungs.push('switch');
    const step = this.step++;
    if (step < rungs.length) {
      const rung = rungs[step]!;
      return { rung, candidate: rung === 'switch' ? other : current, delayMs: 0 };
    }
    const backoff = this.config.backoffMs;
    const delayMs = backoff.length === 0 ? 0 : backoff[Math.min(step - rungs.length, backoff.length - 1)]!;
    return { rung: 'reopen', candidate: current, delayMs };
  }
}
