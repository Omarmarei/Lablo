import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Focus, Navigator, Screen, ZoneSpec } from '@lablo/ui';
import type { SchedulerTimers } from '../data/refresh-scheduler';

/**
 * A file main.js loads the first time it is needed (RELAY step 35e, ADR-003's amendment of
 * 2026-11-21): settings.js, the settings and the screens reached from them. The build writes it
 * beside main.js, and main.js asks for it with a dynamic `import()`, which the TV build turns into
 * a `<script>` tag (tools/build/src/amd-loader.ts) and `pnpm dev` into a module request.
 *
 * `use(then)` runs `then` with what the file gives: at once once it has loaded, else after the
 * load, with a loading screen on the navigator meanwhile (`LOADING_SCREEN`):
 *
 *   quiet    the first `SPINNER_AFTER_MS`: the screen under it stays painted (`under`), so the
 *            usual load (from the TV's own storage, a few tens of ms) shows nothing but the next
 *            screen;
 *   spinner  then a spinner;
 *   failed   the load failed, or took `LOAD_LIMIT_MS`: the failure and "Try again" (OK asks for
 *            the file again).
 *
 * Once the file is in, with the loading screen still on top, the screen goes and `then` runs.
 * Back closes the loading screen (the navigator pops it): nothing opens, and a load still on its
 * way keeps what it gives for the next time. A `use` while the loading screen is up takes over
 * from the one before it (the last asked runs).
 */
export const LOADING_SCREEN = 'lazy-loading';
/** The failure's "Try again" (no item before the load fails). */
export const LOADING_RETRY = 'retry';
/** Nothing new shows for this long: a quick load goes straight to its screen. */
export const SPINNER_AFTER_MS = 300;
/** A load still on its way after this long is a failed one ("Try again" asks again). */
export const LOAD_LIMIT_MS = 15_000;

export type LoadPhase = 'quiet' | 'spinner' | 'failed';

export interface LazyFileOptions<T> {
  readonly nav: Navigator;
  /** Loads the file (a dynamic `import()`) and makes what it gives. */
  readonly load: () => Promise<T>;
  readonly timers?: SchedulerTimers;
}

export interface LazyFile<T> {
  /** What the file gave, once it has loaded (null before). */
  readonly loaded: ReadonlySignal<T | null>;
  /** The loading screen's phase while it is on the navigator. */
  readonly phase: ReadonlySignal<LoadPhase>;
  /** The focus on show when the loading screen opened: what the quiet phase paints. */
  readonly under: ReadonlySignal<Focus | null>;
  /** Runs `then` with what the file gives: at once when it has loaded, else after the load. */
  use(then: (value: T) => void): void;
}

const defaultTimers: SchedulerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const retryZone = (count: number): ZoneSpec => ({ kind: 'list', id: LOADING_RETRY, axis: 'vertical', count });

export function createLazyFile<T>(options: LazyFileOptions<T>): LazyFile<T> {
  const { nav } = options;
  const timers = options.timers ?? defaultTimers;
  const loaded = signal<T | null>(null);
  const phase = signal<LoadPhase>('quiet');
  const under = signal<Focus | null>(null);
  let screen: Screen | null = null;
  let wanted: ((value: T) => void) | null = null;
  /** Counts the loading screen's tries: an answer for an earlier one is dropped. */
  let attempt = 0;
  let spinnerTimer: unknown = null;
  let limitTimer: unknown = null;
  /**
   * The load on its way: one at a time, kept past the time limit (asking again would only wait
   * for the same file), dropped when it fails, so the next try asks again.
   */
  let loading: Promise<T> | null = null;

  const showing = (): boolean => screen !== null && screen.open && nav.top === screen;

  const stopTimers = (): void => {
    if (spinnerTimer !== null) timers.clear(spinnerTimer);
    if (limitTimer !== null) timers.clear(limitTimer);
    spinnerTimer = null;
    limitTimer = null;
  };

  const request = (): Promise<T> => {
    // (In after a try timed out: the next try opens it, with no second load.)
    const value = loaded.peek();
    if (value !== null) return Promise.resolve(value);
    if (loading !== null) return loading;
    let asked: Promise<T>;
    try {
      asked = options.load();
    } catch (error) {
      asked = Promise.reject(error);
    }
    const kept = asked.then(
      (value) => {
        loaded.value = value;
        return value;
      },
      (error: unknown) => {
        if (loading === kept) loading = null;
        throw error;
      },
    );
    loading = kept;
    return kept;
  };

  const fail = (): void => {
    stopTimers();
    // This try is over: an answer still on its way only keeps its value.
    attempt += 1;
    const shown = screen;
    if (shown === null || !showing()) return;
    phase.value = 'failed';
    shown.update(retryZone(1));
    shown.focus(LOADING_RETRY, 0);
  };

  const arrive = (value: T): void => {
    stopTimers();
    if (!showing()) return;
    const then = wanted;
    wanted = null;
    screen = null;
    nav.pop();
    then?.(value);
  };

  const start = (): void => {
    attempt += 1;
    const mine = attempt;
    stopTimers();
    phase.value = 'quiet';
    screen?.update(retryZone(0));
    spinnerTimer = timers.set(() => {
      spinnerTimer = null;
      if (mine === attempt && showing()) phase.value = 'spinner';
    }, SPINNER_AFTER_MS);
    limitTimer = timers.set(() => {
      limitTimer = null;
      if (mine === attempt) fail();
    }, LOAD_LIMIT_MS);
    request().then(
      (value) => {
        if (mine === attempt) arrive(value);
      },
      (error: unknown) => {
        if (mine !== attempt) return;
        console.warn('A file of the app did not load', error);
        fail();
      },
    );
  };

  return {
    loaded,
    phase,
    under,
    use(then) {
      const value = loaded.peek();
      if (value !== null) {
        then(value);
        return;
      }
      wanted = then;
      // Already loading on show: this one runs instead of the earlier one, on the same load.
      if (showing() && phase.peek() !== 'failed') return;
      if (!showing()) {
        under.value = nav.snapshot();
        screen = nav.push({
          id: LOADING_SCREEN,
          zones: [retryZone(0)],
          onSelect: () => {
            if (phase.peek() === 'failed') start();
          },
        });
      }
      start();
    },
  };
}
