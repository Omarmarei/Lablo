/**
 * What S6's live stage reads off the page (RELAY step 15b), kept apart from the component so unit
 * tests cover it with stand-ins for the DOM and the frame clock: the focus the live screen draws,
 * whether it shows its rows, and "the end of the first frame where something holds".
 */

export interface AttrSource {
  getAttribute(name: string): string | null;
}

export interface QueryRoot {
  querySelector(selector: string): AttrSource | null;
}

/** The focus the live screen in `stage` draws (`live/channels/3`), or null before it draws one. */
export function drawnFocus(stage: QueryRoot): string | null {
  const root = stage.querySelector('[data-testid="live"]');
  if (root === null || root.getAttribute('data-screen') === null) return null;
  return `${root.getAttribute('data-screen')}/${root.getAttribute('data-zone')}/${root.getAttribute('data-index')}`;
}

/**
 * Has the live screen drawn its first row? `firstRow` is `live.row(0)` (null while its chunk
 * loads). A screen that is empty or failed never will, so that throws.
 */
export function showsRows(status: string, firstRow: unknown, stage: QueryRoot): boolean {
  if (status === 'empty' || status === 'failed') throw new Error(`the live screen is ${status}`);
  return status === 'ready' && firstRow !== null && stage.querySelector('[data-testid="row-0"]') !== null;
}

export interface FrameClock {
  now(): number;
  /** Before the next frame is painted (`requestAnimationFrame`). */
  frame(run: () => void): void;
  /** A task: after a frame callback, it runs once that frame has been painted. */
  later(run: () => void): void;
}

export const BROWSER_FRAMES: FrameClock = {
  now: () => performance.now(),
  frame: (run) => {
    requestAnimationFrame(run);
  },
  later: (run) => {
    setTimeout(run, 0);
  },
};

/**
 * Resolves with the ms from `started` to the end of the first frame at which `test` holds (a
 * frame callback, then a task after its paint). Rejects after `timeoutMs`, or with what `test`
 * throws.
 */
export function afterFrameWhere(test: () => boolean, started: number, timeoutMs: number, what: string, clock: FrameClock = BROWSER_FRAMES): Promise<number> {
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      let holds: boolean;
      try {
        holds = test();
      } catch (error) {
        reject(error);
        return;
      }
      if (holds) clock.later(() => resolve(clock.now() - started));
      else if (clock.now() - started > timeoutMs) reject(new Error(`${what} within ${timeoutMs} ms`));
      else clock.frame(tick);
    };
    clock.frame(tick);
  });
}
