import type { LoadedProfile } from '@lablo/data';
import type { TelemetrySendRequest, TelemetrySendResult } from '@lablo/data/client';
import type { LifecycleEvent } from '@lablo/platform-api';
import type { TelemetryEvent } from '@lablo/protocol';
import type { SchedulerTimers } from '../data/refresh-scheduler';

/**
 * Telemetry while the app runs (RELAY step 33b1, architecture.md §3.4). Main only records: plain
 * event objects in memory, handed to the telemetry worker at each send (`DataEngine.sendTelemetry`),
 * which samples them, keeps them in `kv` and posts them. This module decides when:
 *
 * - **The switch:** `load` gives the profile's (`telemetryOn`). Events recorded before it
 *   are held; off drops them, and records nothing more. `setOn(false)` (Settings, step 33b3) drops
 *   what is held and sends at once (or right after a send in progress), so the worker, which reads
 *   the profile's switch itself, clears the queue and the install ID; it resolves once that send
 *   has answered (at once while the sends are stopped). An app ended between the
 *   switch's edit and that send keeps them on the TV, never sent while off; only an "on" later
 *   would send them with the old ID.
 * - **Not before the live screen:** `start` (from the live screen, as the backup) arms the sends.
 *   Nothing leaves the TV while onboarding is still telling the user about it; what was recorded
 *   meanwhile is sent after.
 * - **After an event:** a send `TELEMETRY_FIRST_MS` after the first event not yet sent, never
 *   sooner than `TELEMETRY_GAP_MS` after the last send began.
 * - **After a send that left a queue** (a failure, or a body that couldn't take it all): once more,
 *   `TELEMETRY_GAP_MS` after it began.
 * - **Hidden:** one send at once, if anything is pending (a TV may end a hidden app without
 *   warning). Nothing is timed while hidden.
 * - **One at a time;** an event recorded during a send waits for the next. A worker that died puts
 *   its events back.
 * - **Stop:** the config's `disable-app` stops the sends (`stop`), and `start` arms them again.
 * - At most `TELEMETRY_MEMORY_MAX` events are held; a new one past it drops the oldest.
 */

/** A send comes this long after the first event not yet sent. */
export const TELEMETRY_FIRST_MS = 60_000;
/** At least this long between the starts of two sends (the hidden app's send aside). */
export const TELEMETRY_GAP_MS = 15 * 60_000;
/** Events held in memory between sends. */
export const TELEMETRY_MEMORY_MAX = 200;

/** The profile's switch: on unless it says `telemetry: false` (no profile yet: on). */
export function telemetryOn(profile: LoadedProfile | null): boolean {
  return profile === null || (profile.doc as { telemetry?: unknown }).telemetry !== false;
}

/** What the schedule needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface TelemetryEngine {
  sendTelemetry(request: TelemetrySendRequest): Promise<TelemetrySendResult>;
}

/** A send's request but its events: the API's base, the build, the config's sampling. */
export type TelemetryCall = Omit<TelemetrySendRequest, 'events'>;

export interface TelemetryOptions {
  readonly engine: TelemetryEngine;
  /** Asked afresh at each send (the config's sampling may have changed). */
  readonly request: () => TelemetryCall;
  /** Subscribes to the app's visibility (`Platform.onLifecycle`). */
  readonly lifecycle?: (listener: (event: LifecycleEvent) => void) => () => void;
  readonly now?: () => number;
  readonly timers?: SchedulerTimers;
  /** Where a send that left its events is told (default: `console.warn`). */
  readonly warn?: (message: string, detail: unknown) => void;
}

export interface Telemetry {
  /** Records an event: held until a send, dropped while the switch is off. */
  record(event: TelemetryEvent): void;
  /** The profile's switch, read at the start. */
  load(on: boolean): void;
  /**
   * Settings' switch (step 33b3): off drops what is held and sends once, so the worker clears the
   * queue, resolving when that send has answered (at once when the sends are stopped); on resolves at once.
   */
  setOn(on: boolean): Promise<void>;
  /** Arms the sends (the live screen); again after `stop`. */
  start(): void;
  /** No more sends until `start` (a send in progress finishes); events stay held. */
  stop(): void;
  /** A send now, or right after the one running, resolving with its answer (`null`: its worker died, or not started). For the test hook. */
  sendNow(): Promise<TelemetrySendResult | null>;
  /** No send in progress: no telemetry worker is in the database. */
  idle(): boolean;
  dispose(): void;
}

const defaultTimers: SchedulerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? defaultTimers;
  const warn = options.warn ?? ((message: string, detail: unknown) => console.warn(message, detail));
  /** The profile's switch (`null`: not read yet). */
  let on: boolean | null = null;
  let held: TelemetryEvent[] = [];
  /** When the first held event came (`null`: none held). */
  let pendingSince: number | null = null;
  /** The last send left events in the queue: one more after the gap. */
  let retry = false;
  let started = false;
  let disposed = false;
  let running = false;
  let hidden = false;
  /** When the last send began. */
  let lastStart = -Infinity;
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  /** `sendNow` calls waiting for the next send. */
  let waiters: ((result: TelemetrySendResult | null) => void)[] = [];

  const clearTimer = (): void => {
    // (Clearing a timer that fired, or none, does nothing.)
    timers.clear(timer);
    timer = null;
  };

  /** Times the next send, when one may come. */
  const arm = (): void => {
    clearTimer();
    // (`dispose` ends `started` too.)
    if (!started || running || hidden || on !== true) return;
    let due = Infinity;
    if (pendingSince !== null) due = Math.max(pendingSince + TELEMETRY_FIRST_MS, lastStart + TELEMETRY_GAP_MS);
    else if (retry) due = lastStart + TELEMETRY_GAP_MS;
    if (due === Infinity) return;
    timer = timers.set(() => void run(), Math.max(0, due - now()));
  };

  /** Puts a dead worker's events back before the ones recorded since, the newest kept. */
  const putBack = (events: TelemetryEvent[], since: number | null): void => {
    if (on === false || events.length === 0) return;
    const merged = events;
    for (let i = 0; i < held.length; i++) merged.push(held[i]!);
    held = merged.length > TELEMETRY_MEMORY_MAX ? merged.slice(merged.length - TELEMETRY_MEMORY_MAX) : merged;
    pendingSince = since;
  };

  async function run(): Promise<void> {
    if (running) return;
    clearTimer();
    running = true;
    lastStart = now();
    const events = held;
    held = [];
    const since = pendingSince;
    pendingSince = null;
    const answered = waiters;
    waiters = [];
    let answer: TelemetrySendResult | null = null;
    try {
      const call = options.request();
      answer = await options.engine.sendTelemetry({ events, base: call.base, platform: call.platform, appVersion: call.appVersion, sampling: call.sampling });
    } catch (error) {
      warn('Telemetry was not sent', error);
      putBack(events, since);
    }
    running = false;
    retry = answer !== null && (answer.state === 'failed' || ((answer.state === 'sent' || answer.state === 'refused') && answer.queued > 0));
    if (answer !== null && answer.state === 'failed') warn('Telemetry was not sent', answer.failure === 'status' ? answer.status : answer.failure);
    else if (answer !== null && answer.state === 'refused') warn('Telemetry was refused', answer.status);
    for (let i = 0; i < answered.length; i++) answered[i]!(answer);
    // (Once disposed, no call waits and nothing is armed: `started` is over.)
    if (waiters.length > 0) {
      void run();
      return;
    }
    // While hidden: one send for each time the app is hidden.
    arm();
  }

  const onLifecycle = (event: LifecycleEvent): void => {
    if (event === 'hidden') {
      if (hidden) return;
      hidden = true;
      // A timer is armed only for what is pending, so this send clears it; one in progress counts.
      if (on === true && (pendingSince !== null || retry)) void run();
      return;
    }
    hidden = false;
    arm();
  };

  return {
    record(event) {
      if (on === false) return;
      held.push(event);
      if (held.length > TELEMETRY_MEMORY_MAX) held.shift();
      if (pendingSince === null) {
        pendingSince = now();
        arm();
      }
    },
    load(value) {
      on = value;
      if (!value) {
        held = [];
        pendingSince = null;
      }
      arm();
    },
    setOn(value) {
      if (on === value) return Promise.resolve();
      on = value;
      // On: nothing is pending (off held none), and the next event arms a send.
      if (value) return Promise.resolve();
      held = [];
      pendingSince = null;
      // The worker reads the profile's switch and clears the queue and the ID: now, or right after
      // the send in progress (which read the switch before it changed). That send's answer ends a
      // retry, and its start clears a timer.
      if (!started) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(() => resolve());
        void run();
      });
    },
    start() {
      if (disposed || started) return;
      started = true;
      if (options.lifecycle) unsubscribe = options.lifecycle(onLifecycle);
      arm();
    },
    stop() {
      started = false;
      clearTimer();
      unsubscribe?.();
      unsubscribe = null;
      hidden = false;
    },
    sendNow() {
      if (!started) return Promise.resolve(null);
      return new Promise<TelemetrySendResult | null>((resolve) => {
        waiters.push(resolve);
        void run();
      });
    },
    idle() {
      return !running;
    },
    dispose() {
      disposed = true;
      started = false;
      clearTimer();
      unsubscribe?.();
      unsubscribe = null;
      const left = waiters;
      waiters = [];
      for (let i = 0; i < left.length; i++) left[i]!(null);
    },
  };
}
