import type { Focus, Navigator } from '@zoma/ui';

/**
 * `window.__ZOMA_TEST__` (RELAY step 14b, architecture.md §4): what the focus engine has
 * focused, for the e2e `RemoteDriver` (e2e/remote-driver.ts) and the old-engine harness.
 *
 * - **Engine, not DOM:** the path comes from the navigator of the screen on show, so a test can
 *   tell a focus that moved from one that only rendered.
 * - **In every build:** the old-engine harness tests the bundles that ship, so they carry it. It
 *   is read-only and holds no data: a screen, a zone and an index.
 */
export interface ZomaTestHook {
  /** `screen/zone/index` of the screen on show (`live/channels/3`), or null before one shows. */
  focusPath(): string | null;
}

export interface TestHookTarget {
  __ZOMA_TEST__?: ZomaTestHook;
}

/** `live/channels/3`: the focus as a path. */
export function focusPath(focus: Pick<Focus, 'screen' | 'zone' | 'index'>): string {
  return focus.screen + '/' + focus.zone + '/' + focus.index;
}

/**
 * Puts the hook on `target` (the window). Returns the setter main.tsx calls with each screen's
 * navigator as it shows (`null`: none, e.g. while the start reads the profile).
 */
export function installTestHook(target: TestHookTarget): (nav: Pick<Navigator, 'snapshot'> | null) => void {
  let current: Pick<Navigator, 'snapshot'> | null = null;
  target.__ZOMA_TEST__ = {
    focusPath: () => (current === null ? null : focusPath(current.snapshot())),
  };
  return (nav) => {
    current = nav;
  };
}
