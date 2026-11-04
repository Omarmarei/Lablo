/**
 * The watchdog's thresholds and the retry ladder (architecture.md §2).
 *
 * Stalls: a live stream whose position hasn't moved for 6 s while playing, or that has
 * buffered for 12 s; a VOD file or recording that has buffered for 20 s. Nothing on the screen
 * 10 s after a load is an open timeout (a three-302 chain took up to 4.1 s on the LG TV).
 *
 * After a failure the ladder decides the next attempt:
 * 1. Before the stream has shown a frame on a URL, the next untried URL (the URL strategy).
 * 2. Otherwise: reopen the same URL, re-run the redirect probe (only where the platform probes),
 *    switch container (only with a second URL), then reopen with backoff (1, 2, 4 s).
 * 3. A failure that a retry of the same URL can't fix (`isDefinitive`) only tries untried URLs,
 *    and the URL stays out of the session: the switch rung never goes back to it (on the desktop
 *    a `.ts` URL the browser can't play would otherwise take an attempt, and its "unsupported"
 *    would hide the provider's failure on `.m3u8`).
 * It gives up when 4 attempts have been made within the last 60 s. A frame on the screen
 * starts the ladder again from its first rung; the attempts keep counting in the window.
 *
 * Remote config can tune every number per model (`WatchdogConfig`).
 */

import type { PlaybackError } from './engine';
import { isDefinitive } from './failure';

export interface WatchdogConfig {
  /** Live: the position hasn't moved for this long while playing. */
  readonly liveFrozenMs: number;
  /** Live: buffering for this long. */
  readonly liveBufferingMs: number;
  /** VOD and catch-up: buffering for this long. */
  readonly vodBufferingMs: number;
  /** No first frame this long after a load starts. */
  readonly openTimeoutMs: number;
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
  vodBufferingMs: 20_000,
  openTimeoutMs: 10_000,
  tickMs: 500,
  maxAttempts: 4,
  windowMs: 60_000,
  backoffMs: [1000, 2000, 4000],
};

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

  /** The stream showed a frame: the next failure starts again from the first rung. */
  recovered(): void {
    this.step = 0;
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

  private plan(error: PlaybackError, current: number, framed: boolean): RetryPlan | null {
    const untried = this.untried();
    if (untried !== -1 && (!framed || isDefinitive(error))) return { rung: 'next-url', candidate: untried, delayMs: 0 };
    if (isDefinitive(error)) return null;
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
