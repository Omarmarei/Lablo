/**
 * Keeps the ingest worker out of the UI's way (architecture.md §1.4 step 7). The worker calls
 * `checkpoint` between network chunks and write batches:
 * - while the UI says it is busy (zapping, starting playback: `setBusy(true)`), it waits;
 * - on low-tier TVs it runs a duty cycle, by default 50 ms of work then 50 ms of sleep, so the
 *   one weak CPU core stays free for key presses (spike S6: < 200 ms per key during ingest);
 * - otherwise it yields a task every 50 ms so RPC messages (busy, cancel) get through.
 *
 * A busy flag expires after `busyMaxMs` (15 s): a UI that forgets to clear it can't stall a
 * refresh forever. Each `setBusy(true)` restarts that clock.
 */

import type { CancelToken } from './rpc';
import { NEVER } from './rpc';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export interface DutyCycle {
  workMs: number;
  sleepMs: number;
}

/** The low-tier duty cycle (remote config may tune it later). */
export const LOW_TIER_DUTY: DutyCycle = { workMs: 50, sleepMs: 50 };
/** How often a busy pause checks whether the UI is done. */
export const BUSY_POLL_MS = 100;
/** A busy flag older than this is ignored. */
export const BUSY_MAX_MS = 15_000;
/** Without a duty cycle, a task is yielded at least this often. */
export const YIELD_EVERY_MS = 50;

export interface ThrottleStats {
  checkpoints: number;
  /** Time spent paused for the busy UI. */
  busyMs: number;
  /** Time spent sleeping in the duty cycle (and yielding). */
  sleptMs: number;
}

export interface ThrottleOptions {
  duty?: DutyCycle | null;
  clock?: Clock;
  busyMaxMs?: number;
}

export class Throttle {
  /** The duty cycle in force (`null`: full speed). Can change between jobs. */
  duty: DutyCycle | null;
  private readonly clock: Clock;
  private readonly busyMaxMs: number;
  private busySince: number | null = null;
  private sliceStart: number;
  private counters: ThrottleStats = { checkpoints: 0, busyMs: 0, sleptMs: 0 };

  constructor(options: ThrottleOptions = {}) {
    this.duty = options.duty ?? null;
    this.clock = options.clock ?? REAL_CLOCK;
    this.busyMaxMs = options.busyMaxMs ?? BUSY_MAX_MS;
    this.sliceStart = this.clock.now();
  }

  /** The UI is busy (`true`) or idle again (`false`). */
  setBusy(busy: boolean): void {
    this.busySince = busy ? this.clock.now() : null;
  }

  get busy(): boolean {
    return this.busySince !== null && this.clock.now() - this.busySince < this.busyMaxMs;
  }

  /** Starts a new job: fresh counters and a fresh work slice (the busy flag stays). */
  reset(): void {
    this.counters = { checkpoints: 0, busyMs: 0, sleptMs: 0 };
    this.sliceStart = this.clock.now();
  }

  stats(): ThrottleStats {
    return { ...this.counters };
  }

  /**
   * Call between units of work. Resolves when work may go on; rejects with `CancelError` once
   * `token` is cancelled.
   */
  async checkpoint(token: CancelToken = NEVER): Promise<void> {
    token.throwIfCancelled();
    this.counters.checkpoints++;
    const clock = this.clock;
    if (this.busy) {
      const start = clock.now();
      while (this.busy) {
        await clock.sleep(BUSY_POLL_MS);
        token.throwIfCancelled();
      }
      this.counters.busyMs += clock.now() - start;
      this.sliceStart = clock.now();
      return;
    }
    const duty = this.duty;
    if (clock.now() - this.sliceStart < (duty ? duty.workMs : YIELD_EVERY_MS)) return;
    const start = clock.now();
    await clock.sleep(duty ? duty.sleepMs : 0);
    this.counters.sleptMs += clock.now() - start;
    token.throwIfCancelled();
    this.sliceStart = clock.now();
  }
}
