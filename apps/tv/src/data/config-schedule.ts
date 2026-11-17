import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ConfigPolicy, ConfigResult, ConfigRunRequest } from '@lablo/data';
import type { LifecycleEvent } from '@lablo/platform-api';
// The client entry only: the package index would pull every data module's polyfills into main.
import { CONFIG_REFRESH_MS, CONFIG_RETRY_MS, noPolicy } from '@lablo/data/client';
import type { SchedulerTimers } from './refresh-scheduler';

/**
 * The signed config while the app runs (RELAY step 30b2, architecture.md §3.3 C). The app never
 * waits for it: the policy starts as the defaults (nothing killed), and the config worker runs
 * in the background.
 *
 * - **When:** the first run after the next paint (`afterPaint`: the start's screen shows first),
 *   then `CONFIG_REFRESH_MS` (6 h) after a run that brought a new doc, or `CONFIG_RETRY_MS`
 *   (30 min) after one that didn't (offline at boot, a timeout, a refusal) or whose worker died.
 *   A run that falls due while the app is hidden happens when it is visible again; a TV that slept
 *   past the due time runs at once when it wakes.
 * - **The policy** (`policy`): the cached copy's as soon as the worker has read it (`cached`),
 *   then the run's answer (the fetched copy's, or the cached one's again). Step 30c enforces it.
 * - **One at a time:** a run never starts while another runs.
 * - **Now** (step 30c1): `refreshNow` runs at once (after the run in progress, if any), whatever
 *   the visibility, and the schedule counts from its end. The test hook calls it, so an e2e test
 *   needn't wait 6 h for a changed config.
 */

/** What the schedule needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface ConfigEngine {
  refreshConfig(request: ConfigRunRequest, onCached?: (result: ConfigResult) => void): Promise<ConfigResult>;
}

export interface ConfigScheduleOptions {
  readonly engine: ConfigEngine;
  /** This build's request: the API base, the platform, the version and the embedded public keys. */
  readonly request: ConfigRunRequest;
  /** Runs `run` once the next frame has painted (default: an animation frame, then a task). */
  readonly afterPaint?: (run: () => void) => void;
  /** Subscribes to the app's visibility (`Platform.onLifecycle`). */
  readonly lifecycle?: (listener: (event: LifecycleEvent) => void) => () => void;
  readonly now?: () => number;
  readonly timers?: SchedulerTimers;
}

export interface ConfigSchedule {
  /** The policy in force: the defaults, then the cached copy's, then each run's. */
  readonly policy: ReadonlySignal<ConfigPolicy>;
  /** The last answer (the cached copy's while a run fetches), `null` before the first. */
  readonly last: ReadonlySignal<ConfigResult | null>;
  /** The first run after the next paint, then the schedule. Only the first call counts. */
  start(): void;
  /**
   * A run now, or right after the one in progress (calls made during a run share the next one),
   * resolving with its answer: `null` when its worker died, before `start()` and once disposed.
   */
  refreshNow(): Promise<ConfigResult | null>;
  /** Stops the schedule (a run in progress finishes, its answer is dropped). */
  dispose(): void;
}

const defaultTimers: SchedulerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** An animation frame comes before its paint; a task queued from it runs after the paint. */
function nextPaint(run: () => void): void {
  requestAnimationFrame(() => {
    setTimeout(run, 0);
  });
}

export function createConfigSchedule(options: ConfigScheduleOptions): ConfigSchedule {
  const { engine, request } = options;
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? defaultTimers;
  const policy = signal<ConfigPolicy>(noPolicy());
  const last = signal<ConfigResult | null>(null);
  let timer: unknown = null;
  /** When the next run is due on the clock (none before the first run). */
  let dueAt = Infinity;
  let started = false;
  let running = false;
  let hidden = false;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  /** `refreshNow` calls waiting for the next run's answer. */
  let waiters: ((result: ConfigResult | null) => void)[] = [];

  const apply = (result: ConfigResult): void => {
    if (disposed) return;
    last.value = result;
    policy.value = result.policy;
  };

  const clearTimer = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const schedule = (ms: number): void => {
    clearTimer();
    dueAt = now() + ms;
    timer = timers.set(() => {
      timer = null;
      // Hidden: the next `visible` runs it.
      if (!hidden) void run();
    }, ms);
  };

  async function run(): Promise<void> {
    if (running || disposed) return;
    running = true;
    // The `refreshNow` calls made so far get this run's answer; later ones the next run's.
    const answered = waiters;
    waiters = [];
    let next = CONFIG_RETRY_MS;
    let answer: ConfigResult | null = null;
    try {
      const result = await engine.refreshConfig(request, apply);
      apply(result);
      answer = result;
      if (result.status === 'fresh') next = CONFIG_REFRESH_MS;
    } catch (error) {
      // The worker died (or couldn't start): the policy in force stays.
      console.warn('The config refresh failed', error);
    } finally {
      running = false;
    }
    for (const settle of answered) settle(disposed ? null : answer);
    if (disposed) return;
    // A `refreshNow` came during the run: the next one now, and the schedule from its end.
    if (waiters.length > 0) void run();
    else schedule(next);
  }

  return {
    policy,
    last,
    start() {
      if (started || disposed) return;
      started = true;
      if (options.lifecycle) {
        unsubscribe = options.lifecycle((event) => {
          if (event === 'hidden') {
            hidden = true;
            return;
          }
          hidden = false;
          // run() refuses while one runs; its end schedules the next.
          if (now() >= dueAt) void run();
        });
      }
      // A `refreshNow` before the paint has run already (its end set the next run).
      (options.afterPaint ?? nextPaint)(() => {
        if (dueAt === Infinity) void run();
      });
    },
    refreshNow() {
      if (!started || disposed) return Promise.resolve(null);
      return new Promise<ConfigResult | null>((resolve) => {
        waiters.push(resolve);
        void run();
      });
    },
    dispose() {
      disposed = true;
      clearTimer();
      unsubscribe?.();
      unsubscribe = null;
      // Calls waiting for a next run that won't come.
      for (const settle of waiters.splice(0)) settle(null);
    },
  };
}
