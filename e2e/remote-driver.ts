import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Intent } from '../packages/platform-api/src/index';
import type { PressTiming } from './remote-keys';
import { INTENT_KEYS } from './remote-keys';

/**
 * Drives the dev app the way a remote does (architecture.md §4, RELAY step 14b): it presses
 * Intents through the browser adapter's keys and reads the focus from the focus engine
 * (`window.__LABLO_TEST__.focusPath()`, apps/tv/src/test-hook.ts), not from the DOM.
 *
 * - `expectFocus` waits until the engine's path is the one given, and until the screen on show
 *   (`#app > [data-screen]`) draws the same focus.
 * - `timedPress` measures one press: from the key event to the paint of the first frame that
 *   shows the new focus. In an `epg` zone (the grid guide), LEFT and RIGHT move the time cursor
 *   and keep the path: `{ timeMoves: true }` waits for the screen to draw another time too.
 * - Keys aimed at a text field being edited never reach the focus engine: type with
 *   `page.keyboard` there.
 */
export class RemoteDriver {
  readonly timings: PressTiming[] = [];

  constructor(readonly page: Page) {}

  /** Presses each Intent in turn. */
  async press(...intents: Intent[]): Promise<void> {
    for (const intent of intents) await this.page.keyboard.press(INTENT_KEYS[intent]);
  }

  /** The focus engine's `screen/zone/index`, or null before a screen shows. */
  focusPath(): Promise<string | null> {
    return this.page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? null);
  }

  /** The engine's focus and the one the screen on show draws (`null`: no screen draws one). */
  private focusState(): Promise<{ engine: string | null; drawn: string | null }> {
    return this.page.evaluate(() => {
      const root = document.querySelector('#app > [data-screen]');
      const drawn = root === null ? null : `${root.getAttribute('data-screen')}/${root.getAttribute('data-zone')}/${root.getAttribute('data-index')}`;
      return { engine: window.__LABLO_TEST__?.focusPath() ?? null, drawn };
    });
  }

  /** Waits until the engine has `path` focused and the screen draws it. */
  async expectFocus(path: string, timeout = 5_000): Promise<void> {
    await expect.poll(() => this.focusState(), { timeout, message: `the focus should be ${path}` }).toEqual({ engine: path, drawn: path });
  }

  /** Presses `intent` and waits for the focus to land on `path`. */
  async go(intent: Intent, path: string): Promise<void> {
    await this.press(intent);
    await this.expectFocus(path);
  }

  /**
   * Presses `intent` and returns the time from its key event (`event.timeStamp`) to the end of
   * the first frame whose focus is `path` (a `requestAnimationFrame`, then a task after its
   * paint). With `timeMoves`, that frame must also draw a time cursor other than the one before
   * the press (the screen root's `data-time`). The press is kept in `timings` under `label`; it
   * fails if the focus isn't there after `timeoutMs`.
   */
  async timedPress(
    intent: Intent,
    path: string,
    { label = `${intent} to ${path}`, timeoutMs = PRESS_TIMEOUT_MS, timeMoves = false }: { label?: string; timeoutMs?: number; timeMoves?: boolean } = {},
  ): Promise<number> {
    await this.page.evaluate(armPress, { expected: path, timeoutMs, timeMoves });
    await this.page.keyboard.press(INTENT_KEYS[intent]);
    const result = await this.page.evaluate(() => (window as unknown as PressWindow).__labloPress);
    if (result.ms === null && result.path === path) throw new Error(`${label}: the time never moved from ${result.time ?? 'nothing'} (the focus is at ${path})`);
    if (result.ms === null) throw new Error(`${label}: the focus never reached ${path} (it is at ${result.path ?? 'nothing'})`);
    this.timings.push({ label, ms: result.ms });
    await this.expectFocus(path);
    return result.ms;
  }

  /** Starts recording main-thread long tasks (over 50 ms); `longTasks` reads them. */
  async watchLongTasks(): Promise<void> {
    await this.page.evaluate(() => {
      const w = window as unknown as PressWindow;
      const seen: number[] = [];
      w.__labloLongTasks = seen;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) seen.push(entry.duration);
      }).observe({ type: 'longtask' });
    });
  }

  /** The long tasks since `watchLongTasks`, in ms; reading them starts a new count. */
  async longTasks(): Promise<number[]> {
    return this.page.evaluate(() => {
      const w = window as unknown as PressWindow;
      const seen = w.__labloLongTasks ?? [];
      return seen.splice(0, seen.length);
    });
  }
}

/** A press that hasn't shown its focus after this long has failed. */
const PRESS_TIMEOUT_MS = 10_000;

interface PressResult {
  readonly ms: number | null;
  readonly path: string | null;
  /** The time cursor the screen draws (`data-time`; null: none) when the press ended. */
  readonly time: string | null;
}

interface PressWindow {
  __labloPress: Promise<PressResult>;
  __labloLongTasks?: number[];
}

/** In the page: arms the measurement of the next key press (see `timedPress`). */
function armPress({ expected, timeoutMs, timeMoves }: { expected: string; timeoutMs: number; timeMoves: boolean }): void {
  const w = window as unknown as PressWindow & Window;
  const drawnTime = (): string | null => document.querySelector('#app > [data-screen]')?.getAttribute('data-time') ?? null;
  const before = drawnTime();
  w.__labloPress = new Promise<PressResult>((resolve) => {
    const onKey = (event: KeyboardEvent): void => {
      removeEventListener('keydown', onKey, true);
      const start = event.timeStamp;
      const tick = (): void => {
        const path = w.__LABLO_TEST__?.focusPath() ?? null;
        const time = drawnTime();
        if (path === expected && (!timeMoves || time !== before)) {
          // This frame shows the focus: the task after it runs once it has been painted.
          setTimeout(() => resolve({ ms: performance.now() - start, path, time }), 0);
        } else if (performance.now() - start > timeoutMs) {
          resolve({ ms: null, path, time });
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    };
    addEventListener('keydown', onKey, true);
  });
}
