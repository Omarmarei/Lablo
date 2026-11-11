import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { bigCatalog, writeBigGuide } from './big-catalog';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import type { PressBudget, PressTiming } from './remote-keys';
import { budgetFailures, summarize } from './remote-keys';
import { THROTTLE, busyMs, throttle, transitionOf } from './throttle';

/**
 * The live screen on a large catalog at 4x CPU throttle (RELAY step 14b, architecture.md §4):
 * every key press is timed from its key event to the paint of the frame that shows the new
 * focus, and the main thread's long tasks are counted while the keys go down. Then the same in
 * the forced low tier (`?tier=low`), which turns motion off.
 *
 * The run has its own Playwright project, after every other e2e test (playwright.config.ts), so
 * no other test's browser competes for the CPU while it measures.
 */
const CHANNELS = 20_000;
const CATEGORIES = 200;
/** The rows the list shows (`CHANNELS_VISIBLE`): CH+/CH− move by a window. */
const VISIBLE = 9;
/**
 * Each press within spike S6's key-press threshold for the 2018 TVs (architecture.md §5), and no
 * main-thread task longer than that, so a key pressed at any moment waits at most as long. The
 * CI runner at 4x is about twice as slow as a desktop at 4x (its slowest press was 121 ms).
 */
const BUDGET: PressBudget = { pressMs: 200, longTaskMs: 200 };
const REPORT = path.resolve(import.meta.dirname, '../artifacts/perf');

const catalog = bigCatalog({ channels: CHANNELS, categories: CATEGORIES });
let app: MockServer;
let host: string;
let guideDir: string;

test.beforeAll(async () => {
  guideDir = mkdtempSync(path.join(tmpdir(), 'lablo-e2e-guide-'));
  const guide = path.join(guideDir, 'guide.xml');
  writeBigGuide(catalog, Date.now(), guide);
  app = await mock({ catalog, xmltvFile: guide, now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
  mkdirSync(REPORT, { recursive: true });
});
test.afterAll(async () => {
  await app.close();
  rmSync(guideDir, { recursive: true, force: true });
});

interface Run {
  readonly tier: string;
  readonly presses: readonly PressTiming[];
  readonly longTasks: readonly number[];
  /** How much slower the fixed work ran under the throttle. */
  readonly slowdown: number;
}

/**
 * The keys of a viewer zapping through a large list, timed at 4x throttle: down the list, page
 * by page (each window reads its chunks), to the rail and down it past what it shows, OK on a
 * category, Back, and into the list again. Each tier starts the app afresh with the source
 * stored (a TV's usual start), so both runs begin alike.
 */
async function zap(remote: RemoteDriver, root: Locator, tier: 'full' | 'low'): Promise<Run> {
  const { page } = remote;
  await page.goto(tier === 'low' ? '/?locale=en-US&tier=low' : '/?locale=en-US');
  await expect(root).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-tier', tier);
  await remote.expectFocus('live/channels/0');
  await settled(root, 30_000);
  // The tier's motion: a row's focus transition, none on the low tier.
  expect(await transitionOf(page, '[data-testid=channels] .z-row')).toBe(tier === 'low' ? '0s, 0s' : '0.12s, 0.12s');
  remote.timings.length = 0;
  const base = await busyMs(page);
  const release = await throttle(page, THROTTLE);
  const slowdown = (await busyMs(page)) / base;
  await remote.watchLongTasks();
  try {
    for (let i = 1; i <= 20; i++) await remote.timedPress('DOWN', `live/channels/${i}`);
    for (let k = 1; k <= 15; k++) await remote.timedPress('CH_DOWN', `live/channels/${20 + k * VISIBLE}`);
    await settled(root, 30_000);
    await remote.timedPress('LEFT', 'live/rail/0');
    for (let i = 1; i <= 30; i++) await remote.timedPress('DOWN', `live/rail/${i}`);
    await remote.timedPress('OK', 'live/channels/0', { label: 'OK on category 30' });
    await expect(root).toHaveAttribute('data-category', '30');
    for (let i = 1; i <= 5; i++) await remote.timedPress('DOWN', `live/channels/${i}`);
    await remote.timedPress('BACK', 'live/rail/30');
    // The list kept its place.
    await remote.timedPress('RIGHT', 'live/channels/5');
    await settled(root, 30_000);
    return { tier, presses: [...remote.timings], longTasks: await remote.longTasks(), slowdown };
  } finally {
    await release();
  }
}

test.describe('the live screen at 4x CPU throttle on a large catalog', () => {
  test(`keeps every key press within ${BUDGET.pressMs} ms, in the full and the forced low tier`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const root = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US', 120_000);
    await settled(root, 30_000);
    await expect(page.getByTestId('live-meta').locator('[data-n]')).toHaveAttribute('data-n', String(CHANNELS));

    const runs: Run[] = [await zap(remote, root, 'full')];
    // The rows on show after the run: the panel's numbers, names and now/next.
    const first = page.locator('[data-testid=channels] .z-vlist__item').first();
    await expect(first.locator('.z-row__number')).toHaveText(String(catalog.live.find((c) => c.categoryId === 1029)!.num));
    await expect(first.locator('.z-row__now .z-row__title')).toHaveText(/\S/);
    await expect(first.locator('.z-row__next .z-row__title')).toHaveText(/\S/);

    // The forced low tier: the same source, motion off.
    runs.push(await zap(remote, root, 'low'));

    const report = runs.map((r) => ({ tier: r.tier, slowdown: Number(r.slowdown.toFixed(1)), ...summarize(r.presses), longTasks: r.longTasks.map(Math.round), presses: r.presses.map((p) => [p.label, Math.round(p.ms)]) }));
    writeFileSync(path.join(REPORT, 'live-throttled.json'), `${JSON.stringify(report, null, 2)}\n`);
    for (const r of report) {
      const slowest = [...r.presses].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5).map(([label, ms]) => `${label} ${ms} ms`);
      console.log(`[${r.tier} tier, CPU ${r.slowdown}x slower] ${r.count} presses: median ${r.median.toFixed(0)} ms, p95 ${r.p95.toFixed(0)} ms, max ${r.max.toFixed(0)} ms; long tasks ${r.longTasks.join(', ') || 'none'}; slowest: ${slowest.join('; ')}`);
    }
    for (const run of runs) {
      // The throttle was on: the same work ran at least twice as slow (about 4x on a quiet machine).
      expect(run.slowdown, `${run.tier} tier`).toBeGreaterThan(2);
      expect(budgetFailures(run.presses, run.longTasks, BUDGET), `${run.tier} tier`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('the key-press budget can fail', () => {
  test('a key handler that holds the main thread for 250 ms is over the budget, and a long task', async ({ page }) => {
    const remote = new RemoteDriver(page);
    // The gallery: a focus engine without data workers.
    await page.goto('/?screen=gallery');
    await remote.expectFocus('gallery/channels/0');
    await remote.watchLongTasks();
    await remote.timedPress('DOWN', 'gallery/channels/1');
    expect(budgetFailures(remote.timings, await remote.longTasks(), BUDGET)).toEqual([]);
    // The seed: a keydown listener that spins for 250 ms before the app sees the key.
    await page.evaluate(() => {
      addEventListener(
        'keydown',
        () => {
          const end = performance.now() + 250;
          while (performance.now() < end) {
            // Spin: the main thread is busy.
          }
        },
        true,
      );
    });
    remote.timings.length = 0;
    const ms = await remote.timedPress('DOWN', 'gallery/channels/2');
    expect(ms).toBeGreaterThanOrEqual(250);
    const failures = budgetFailures(remote.timings, await remote.longTasks(), BUDGET);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toBe(`DOWN to gallery/channels/2: ${Math.round(ms)} ms, over the ${BUDGET.pressMs} ms budget`);
    expect(failures[1]).toMatch(new RegExp(`^1 long task over ${BUDGET.longTaskMs} ms: \\d+ ms$`));
  });

  test('a press is timed only once the focus is where it should be', async ({ page }) => {
    const remote = new RemoteDriver(page);
    await page.goto('/?screen=gallery');
    await remote.expectFocus('gallery/channels/0');
    // DOWN moves to row 1, never to row 5: no frame shows that focus, so there is no time.
    await expect(remote.timedPress('DOWN', 'gallery/channels/5', { timeoutMs: 500 })).rejects.toThrow('DOWN to gallery/channels/5: the focus never reached gallery/channels/5 (it is at gallery/channels/1)');
    expect(remote.timings).toEqual([]);
  });
});
