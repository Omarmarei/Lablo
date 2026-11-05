import type { Page } from '@playwright/test';

/**
 * The CPU throttle of the timed runs (RELAY steps 14b and 23d, architecture.md §4):
 * live-throttled.spec.ts (the live list) and guide-throttled.spec.ts (the grid guide).
 */

/** How many times slower the page's CPU runs. `ZOMA_E2E_THROTTLE` overrides it, to see the margins on a slower machine. */
export const THROTTLE = Number(process.env['ZOMA_E2E_THROTTLE'] ?? 4);

/**
 * Slows the page's CPU `rate` times until the returned function is called. The CDP session
 * stays attached meanwhile: detaching it ends the emulation.
 */
export async function throttle(page: Page, rate: number): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return async () => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
  };
}

/**
 * A fixed piece of work in the page, in ms: it takes longer once throttled. Five runs in total:
 * the throttle suspends the main thread in slices, and one short run can fall between them.
 */
export function busyMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    let total = 0;
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      let x = 0;
      for (let i = 0; i < 2_000_000; i++) x += Math.sqrt(i);
      (window as unknown as { __zomaSink: number }).__zomaSink = x;
      total += performance.now() - start;
    }
    return total;
  });
}

/** The CSS transition durations of the first element `selector` finds: the tier's motion tokens. */
export function transitionOf(page: Page, selector: string): Promise<string> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return el === null ? `no ${selector}` : getComputedStyle(el).transitionDuration;
  }, selector);
}
