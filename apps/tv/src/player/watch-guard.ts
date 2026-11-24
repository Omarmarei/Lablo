import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Timers } from '../live/live-state';

/**
 * "Still watching?" and the sleep timer (RELAY step 39c, architecture.md §1.4 item 10 "Built in
 * step 39c"): two counts that end in one prompt over the player.
 * - **The no-key count** runs while the player is open: `hours` after the last key, the prompt
 *   asks (`null`: never). It starts again at each key, when the player opens and when the app
 *   comes back. A pause doesn't stop it: it is the time since the last key, whatever plays.
 * - **The sleep timer** is set in minutes from now and kept on the wall clock, for the app's run
 *   only. It ends once: with the player open the prompt asks; with nothing playing it only goes
 *   back to off. Hiding the app keeps it; back after its time, it is off.
 * - **The prompt** counts `PROMPT_SECONDS` down, then the player closes (`stop`). The seconds are
 *   read off the clock at each step (`now`), so a late timer shows the true time left and the
 *   player closes on time. `keep` takes it away ("Keep watching"). It needs room (`room`: no card over the player): until then it
 *   waits, and `retry` shows it. A card that comes while it shows takes its place (`covered`),
 *   and it waits again. A key drops a waiting no-key prompt; a waiting sleep prompt stays.
 * - **The app hidden:** both counts stop and the prompt goes (leaving the app is an answer).
 */

/** The hours "Still watching?" can wait for a key. */
export const STILL_HOURS: readonly number[] = [2, 4, 6];
/** Its hours until Settings › "Player" says otherwise. */
export const DEFAULT_STILL_HOURS = 4;
/** The minutes the sleep timer can be set to. */
export const SLEEP_MINUTES: readonly number[] = [30, 60, 90, 120];
/** The prompt closes the player this many seconds after it shows. */
export const PROMPT_SECONDS = 60;
/** The countdown's step. */
export const PROMPT_TICK_MS = 1000;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Why the prompt asks: no key for the set hours, or the sleep timer ended. */
export type StillReason = 'idle' | 'sleep';

/** The prompt on show. */
export interface StillPrompt {
  readonly reason: StillReason;
  /** Seconds before the player closes. */
  readonly seconds: number;
}

/** The sleep timer while it runs. */
export interface SleepTimer {
  /** The minutes it was set to. */
  readonly minutes: number;
  /** When it ends (epoch ms). */
  readonly until: number;
}

export interface WatchGuardOptions {
  readonly timers: Timers;
  /** The wall clock (epoch ms): the sleep timer is kept on it. */
  readonly clock: () => number;
  /** The clock the prompt's countdown is timed by (ms). */
  readonly now: () => number;
  /** The hours without a key before the prompt (`null`: never). */
  readonly hours: number | null;
  /** Whether the prompt can show now: the player has no card over it. */
  readonly room: () => boolean;
  /** The prompt is about to show: the player makes room and gives it the focus. */
  readonly shown: () => void;
  /** The prompt went and the player stays ("Keep watching", or the app hid): the focus goes back. */
  readonly kept: () => void;
  /** The countdown ended: the player closes. */
  readonly stop: () => void;
}

export interface WatchGuard {
  /** The prompt (`null`: none shows). */
  readonly prompt: ReadonlySignal<StillPrompt | null>;
  /** The hours without a key before the prompt (`null`: never). */
  readonly hours: ReadonlySignal<number | null>;
  /** The sleep timer (`null`: off). */
  readonly sleep: ReadonlySignal<SleepTimer | null>;
  /** Other hours from now on; the count starts again. */
  setHours(hours: number | null): void;
  /** Sets the sleep timer to `minutes` from now (`null`: off). */
  setSleep(minutes: number | null): void;
  /** The player opened or closed. */
  watching(on: boolean): void;
  /** A key was pressed (while the prompt shows, its own keys answer it: nothing here). */
  activity(): void;
  /** "Keep watching": the prompt goes and the count starts again. */
  keep(): void;
  /** A card took the prompt's place: it waits for the card to go. */
  covered(): void;
  /** The player has room again: a prompt that waited shows. */
  retry(): void;
  /** The app hid. */
  hidden(): void;
  /** The app is back. */
  visible(): void;
  dispose(): void;
}

export function createWatchGuard(options: WatchGuardOptions): WatchGuard {
  const timers = options.timers;
  const prompt = signal<StillPrompt | null>(null);
  const hours = signal<number | null>(options.hours);
  const sleep = signal<SleepTimer | null>(null);
  /** The player is open. */
  let open = false;
  /** The app is hidden. */
  let away = false;
  /** A prompt that waits for room. */
  let waiting: StillReason | null = null;
  /** When the prompt on show closes the player (`now`'s ms). */
  let closeAt = 0;
  let idleTimer: unknown = null;
  let sleepTimer: unknown = null;
  let tickTimer: unknown = null;

  const clear = (handle: unknown): null => {
    if (handle !== null) timers.clear(handle);
    return null;
  };

  /** One step of the countdown: the seconds left by the clock, or the player closes. */
  const tick = (): void => {
    tickTimer = timers.set(() => {
      tickTimer = null;
      const left = Math.ceil((closeAt - options.now()) / 1000);
      if (left > 0) {
        // (The timer goes with the prompt.)
        prompt.value = { reason: prompt.value!.reason, seconds: left };
        tick();
        return;
      }
      prompt.value = null;
      options.stop();
    }, PROMPT_TICK_MS);
  };

  /**
   * Shows the prompt that waits, once the player has room for it. (Nothing waits while the player
   * is closed, the app is hidden or a prompt shows: each of those drops or takes what waited.)
   */
  const ask = (): void => {
    const reason = waiting;
    if (reason === null || !options.room()) return;
    waiting = null;
    idleTimer = clear(idleTimer);
    options.shown();
    closeAt = options.now() + PROMPT_SECONDS * 1000;
    prompt.value = { reason, seconds: PROMPT_SECONDS };
    tick();
  };

  /** A count ended: its prompt shows, or waits for room. One prompt answers for both counts. */
  const due = (reason: StillReason): void => {
    if (prompt.value !== null) return;
    waiting = reason;
    ask();
  };

  /** The no-key count from zero: none while the player is closed, the app hidden, or set to never. */
  const count = (): void => {
    idleTimer = clear(idleTimer);
    const after = hours.value;
    if (!open || away || after === null) return;
    idleTimer = timers.set(() => {
      idleTimer = null;
      due('idle');
    }, after * HOUR_MS);
  };

  /** The sleep timer for what is left of it: off once its time has passed; none while the app is hidden. */
  const armSleep = (): void => {
    sleepTimer = clear(sleepTimer);
    const set = sleep.value;
    if (set === null || away) return;
    const left = set.until - options.clock();
    if (left <= 0) {
      sleep.value = null;
      return;
    }
    sleepTimer = timers.set(() => {
      sleepTimer = null;
      // Off from now; the prompt only when something plays.
      sleep.value = null;
      if (open) due('sleep');
    }, left);
  };

  return {
    prompt,
    hours,
    sleep,
    setHours(next: number | null): void {
      if (next === hours.value) return;
      hours.value = next;
      if (waiting === 'idle') waiting = null;
      count();
    },
    setSleep(minutes: number | null): void {
      sleep.value = minutes === null ? null : { minutes, until: options.clock() + minutes * MINUTE_MS };
      // A new setting replaces a timer that ended and still waits to ask.
      if (waiting === 'sleep') waiting = null;
      armSleep();
    },
    watching(on: boolean): void {
      if (on === open) return;
      open = on;
      if (!on) {
        waiting = null;
        tickTimer = clear(tickTimer);
        prompt.value = null;
      }
      count();
    },
    activity(): void {
      if (prompt.value !== null) return;
      if (waiting === 'idle') waiting = null;
      count();
    },
    keep(): void {
      if (prompt.value === null) return;
      tickTimer = clear(tickTimer);
      prompt.value = null;
      options.kept();
      count();
    },
    covered(): void {
      const shown = prompt.value;
      if (shown === null) return;
      tickTimer = clear(tickTimer);
      prompt.value = null;
      waiting = shown.reason;
    },
    retry: ask,
    hidden(): void {
      away = true;
      idleTimer = clear(idleTimer);
      sleepTimer = clear(sleepTimer);
      waiting = null;
      if (prompt.value === null) return;
      tickTimer = clear(tickTimer);
      prompt.value = null;
      options.kept();
    },
    visible(): void {
      away = false;
      armSleep();
      count();
    },
    dispose(): void {
      idleTimer = clear(idleTimer);
      sleepTimer = clear(sleepTimer);
      tickTimer = clear(tickTimer);
    },
  };
}
