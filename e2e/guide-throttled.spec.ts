import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { DenseGuide } from './big-catalog';
import { NO_GUIDE_EVERY, bigCatalog, denseProgrammes, gridGuide, writeBigGuide } from './big-catalog';
import type { Grid } from './guide-grid';
import { ROWS, SPAN, readGrid } from './guide-grid';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import type { PressBudget, PressTiming } from './remote-keys';
import { budgetFailures, summarize } from './remote-keys';
import { THROTTLE, busyMs, throttle, transitionOf } from './throttle';

/**
 * The grid guide on a large catalog at 4x CPU throttle (RELAY step 23d, architecture.md §4), as
 * live-throttled.spec.ts does for the live list: the guide opened from the live header over
 * "All channels" (20,000 rows), then every press timed from its key event to the paint of the
 * frame that shows the new focus (for LEFT and RIGHT, the new time cursor), down the rows, page
 * by page, along the time and back, and the main thread's long tasks counted meanwhile. Then the
 * same in the forced low tier (`?tier=low`: motion off, 3 days on instead of 7).
 *
 * The rows the presses walk, and the rows their asks reach (a page either side), have a dense
 * guide over every day the store keeps (`gridGuide`), so each view the presses draw is full of
 * programmes, as a real provider's guide is. The other channels keep the live run's four
 * programmes around now.
 *
 * With the catch-up days (RELAY step 25c): the first `ARCHIVED` channels have seven days of
 * catch-up, so the store keeps seven days back in the full tier and two in the low one, and the
 * guide reaches that far. Each run walks back in time twice before it goes down the pages: on
 * row 20, among the channels with catch-up (every programme gone by carries the archive mark),
 * and on row 155, among those without (no marks). The report gives both walks' timings. The
 * first walk also pays for coming first: a control run with no catch-up channels showed the same
 * gap between them in the full tier, so the marks' cost is the marked walk against the same walk
 * of that control run (architecture.md §4, "Built in step 25c").
 */
const CHANNELS = 20_000;
const CATEGORIES = 200;
/** "All channels" rows 0-99 have seven days of catch-up (the walk on row 20); row 155's have none. */
const ARCHIVED = 100;
const MINUTE = 60_000;
/** Each tier's days back: the store keeps the channels' seven days of catch-up within its limit. */
const DAYS_BACK = { full: 7, low: 2 } as const;
/** The presses of each walk back in time, and the rows they walk. */
const PAST_PRESSES = 20;
const MARKED_ROW = 20;
/** The row the CH− pages end on, where the time presses walk: it has a guide id. */
const DEEPEST = 20 + 15 * ROWS;
/**
 * Each press in the grid within 150 ms (PLAN 6.2's grid budget), and no main-thread task longer
 * than that while the keys go down, so a key pressed at any moment waits at most as long.
 */
const BUDGET: PressBudget = { pressMs: 150, longTaskMs: 150 };
/**
 * The two presses on the live screen that open the guide (UP to the header, OK on "Guide": the
 * grid's first draw, the screen's heaviest frame) have the live screen's budget, spike S6's key
 * press threshold for the 2018 TVs (live-throttled.spec.ts). On CI the first draw took 62 and
 * 155 ms before its first ask went after the frame (architecture.md §4, "Built in step 23d").
 */
const OPEN_BUDGET: PressBudget = { pressMs: 200, longTaskMs: 200 };
const REPORT = path.resolve(import.meta.dirname, '../artifacts/perf');

const catalog = bigCatalog({ channels: CHANNELS, categories: CATEGORIES, archive: { channels: ARCHIVED, days: 7 } });
let dense: DenseGuide;
let app: MockServer;
let host: string;
let guideDir: string;

test.beforeAll(async () => {
  guideDir = mkdtempSync(path.join(tmpdir(), 'zoma-e2e-grid-'));
  const guide = path.join(guideDir, 'guide.xml');
  const now = Date.now();
  dense = gridGuide(now);
  writeBigGuide(catalog, now, guide, dense);
  app = await mock({ catalog, xmltvFile: guide, now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
  mkdirSync(REPORT, { recursive: true });
});
test.afterAll(async () => {
  await app.close();
  rmSync(guideDir, { recursive: true, force: true });
});

/** The focused cell as the grid draws it, the time cursor the screen draws, and its data's version. */
interface Focused {
  readonly start: number;
  readonly end: number;
  readonly time: number;
  /** The guide screen's `data-version`: it bumps when programmes arrive (null on the gallery page). */
  readonly version: string | null;
}

function focusedCell(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const cell = document.querySelector('[data-testid=guide] .z-guide__cell[data-state=focused]');
    const root = document.querySelector('#app > [data-screen]');
    return {
      start: Number(cell?.getAttribute('data-start') ?? NaN),
      end: Number(cell?.getAttribute('data-end') ?? NaN),
      time: Number(root?.getAttribute('data-time') ?? NaN),
      version: root?.getAttribute('data-version') ?? null,
    };
  });
}

/**
 * One timed LEFT or RIGHT on row `row`: done once the screen draws the new time. RIGHT lands
 * on the start of the next cell, LEFT on the cell before the focused one (the cells tile).
 * Programmes can arrive meanwhile (a view the presses rested on is asked after 200 ms) and
 * replace the placeholders the press moved by: then only the direction is checked.
 */
async function timeStep(remote: RemoteDriver, intent: 'LEFT' | 'RIGHT', row: number, n: number, note = ''): Promise<void> {
  const before = await focusedCell(remote.page);
  await remote.timedPress(intent, `guide/grid/${row}`, { timeMoves: true, label: `${intent} ${n} on row ${row}${note === '' ? '' : ` ${note}`}` });
  const after = await focusedCell(remote.page);
  if (intent === 'RIGHT') expect(after.time, `RIGHT ${n}`).toBeGreaterThan(before.time);
  else expect(after.time, `LEFT ${n}`).toBeLessThan(before.time);
  if (after.version !== before.version) return;
  if (intent === 'RIGHT') expect(after.start, `RIGHT ${n}`).toBe(before.end);
  else expect(after.end, `LEFT ${n}`).toBe(before.start);
  expect(after.time).toBe(after.start);
}

/**
 * Each drawn row against the guide written: a channel with a dense guide shows its programmes
 * over the view, with their own times and titles; one without a guide id only placeholders.
 */
function checkDense(g: Grid): void {
  expect(g.rows.length).toBe(ROWS);
  for (const row of g.rows) {
    expect(row.row).toBeLessThan(dense.channels);
    const channel = catalog.live[row.row]!;
    expect(row.name).toBe(channel.name);
    expect(row.number).toBe(String(channel.num));
    const cells = g.cells.filter((c) => c.row === row.row);
    if (channel.epgId === null) {
      expect(cells.every((c) => c.programme === -1)).toBe(true);
      continue;
    }
    const want = denseProgrammes(channel.id, dense.fromMs, dense.toMs).filter((p) => p.stop > g.view * MINUTE && p.start < (g.view + SPAN) * MINUTE);
    expect(
      cells.map((c) => [c.start, c.end, c.title]),
      channel.name,
    ).toEqual(want.map((p) => [p.start / MINUTE, p.stop / MINUTE, p.title]));
  }
}

/** The archive marks drawn (`.z-guide__mark`), by the rows they are on. */
function marksOn(g: Grid): number[] {
  return g.cells.filter((c) => c.mark !== null).map((c) => c.row);
}

/** Local midnight `days` days back on the page, in UTC minutes. */
function midnightBack(page: Page, days: number): Promise<number> {
  return page.evaluate((back) => {
    const d = new Date();
    return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime() / 60_000);
  }, days);
}

interface Run {
  readonly tier: string;
  /** UP to the header and OK on "Guide", on the live screen, and the long tasks until then. */
  readonly opening: readonly PressTiming[];
  readonly openingTasks: readonly number[];
  /** Every press in the grid, Back to the list included. */
  readonly presses: readonly PressTiming[];
  readonly longTasks: readonly number[];
  /** How much slower the fixed work ran under the throttle. */
  readonly slowdown: number;
  /** The grid after the time presses, read once it settled. */
  readonly afterTime: Grid;
  readonly firstView: number;
  /** The range's start, and the local midnight the tier's days back give. */
  readonly from: number;
  readonly wantFrom: number;
  /** The marks drawn after each walk back in time: on row 20's view, and on row 155's. */
  readonly marked: readonly number[];
  readonly unmarked: readonly number[];
}

/**
 * The keys of a viewer looking through the guide, timed at 4x throttle: UP to the live header
 * and OK on "Guide" (the grid's first draw), down the rows, page by page with CH−, along the
 * time with RIGHT (the view moves on every two hours, and past midnight), back up with CH+ and
 * UP, back in time with LEFT, and Back to the list. Each tier starts the app afresh with the
 * source stored (a TV's usual start), so both runs begin alike.
 */
async function browse(remote: RemoteDriver, live: Locator, tier: 'full' | 'low'): Promise<Run> {
  const { page } = remote;
  await page.goto(tier === 'low' ? '/?locale=en-US&tier=low' : '/?locale=en-US');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-tier', tier);
  await remote.expectFocus('live/channels/0');
  await settled(live, 30_000);
  // "All channels": every row of the catalog.
  await expect(page.getByTestId('live-meta').locator('[data-n]')).toHaveAttribute('data-n', String(CHANNELS));
  remote.timings.length = 0;
  const base = await busyMs(page);
  const release = await throttle(page, THROTTLE);
  const slowdown = (await busyMs(page)) / base;
  await remote.watchLongTasks();
  const screen = page.getByTestId('guide-screen');
  try {
    await remote.timedPress('UP', 'live/header/0');
    await remote.timedPress('OK', 'guide/grid/0', { label: 'OK opens the guide' });
    const opening = remote.timings.splice(0);
    // (Reading the long tasks starts a new count: the grid's start after the opening frame.)
    const openingTasks = await remote.longTasks();
    await settled(screen, 30_000);
    // The tier's motion: a cell's focus transition, none on the low tier.
    expect(await transitionOf(page, '[data-testid=guide] .z-guide__cell')).toBe(tier === 'low' ? '0s, 0s' : '0.12s, 0.12s');
    const first = await readGrid(page, 'guide-screen', '.guide__header > *');
    const firstView = first.view;
    const wantFrom = await midnightBack(page, DAYS_BACK[tier]);
    for (let i = 1; i <= MARKED_ROW; i++) await remote.timedPress('DOWN', `guide/grid/${i}`);
    await settled(screen, 30_000);
    // Back in time among the channels with catch-up: the programmes gone by carry the mark.
    // (The view rests every five presses, so the days it crosses are read and drawn.)
    for (let n = 1; n <= PAST_PRESSES; n++) {
      await timeStep(remote, 'LEFT', MARKED_ROW, n, '(marks)');
      if (n % 5 === 0) await settled(screen, 30_000);
    }
    const marked = marksOn(await readGrid(page, 'guide-screen', '.guide__header > *'));
    for (let k = 1; k <= 15; k++) await remote.timedPress('CH_DOWN', `guide/grid/${MARKED_ROW + k * ROWS}`);
    await settled(screen, 30_000);
    // The same walk among the channels without catch-up: no marks.
    for (let n = 1; n <= PAST_PRESSES; n++) {
      await timeStep(remote, 'LEFT', DEEPEST, n, '(no marks)');
      if (n % 5 === 0) await settled(screen, 30_000);
    }
    const unmarked = marksOn(await readGrid(page, 'guide-screen', '.guide__header > *'));
    // Along the time, past now and on two hours at a time (the walks went about a day back).
    for (let n = 1; n <= 70; n++) await timeStep(remote, 'RIGHT', DEEPEST, n);
    await settled(screen, 30_000);
    const afterTime = await readGrid(page, 'guide-screen', '.guide__header > *');
    for (let k = 1; k <= 5; k++) await remote.timedPress('CH_UP', `guide/grid/${DEEPEST - k * ROWS}`);
    const top = DEEPEST - 5 * ROWS;
    for (let i = 1; i <= 10; i++) await remote.timedPress('UP', `guide/grid/${top - i}`);
    for (let n = 1; n <= 10; n++) await timeStep(remote, 'LEFT', top - 10, n);
    await settled(screen, 30_000);
    // Back: the live list, on the channel the guide had focused.
    await remote.timedPress('BACK', `live/channels/${top - 10}`);
    await settled(live, 30_000);
    return { tier, opening, openingTasks, presses: [...remote.timings], longTasks: await remote.longTasks(), slowdown, afterTime, firstView, from: first.from, wantFrom, marked, unmarked };
  } finally {
    await release();
  }
}

test.describe('the grid guide at 4x CPU throttle on a large catalog', () => {
  test(`keeps every key press in the grid within ${BUDGET.pressMs} ms, in the full and the forced low tier`, async ({ page }) => {
    test.setTimeout(300_000);
    expect(DEEPEST % NO_GUIDE_EVERY).not.toBe(NO_GUIDE_EVERY - 1);
    // The deepest rows the asks reach (a page below the view) have the dense guide.
    expect(DEEPEST + 2 * ROWS).toBeLessThanOrEqual(dense.channels);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US', 120_000);
    await settled(live, 30_000);
    await expect(page.getByTestId('live-meta').locator('[data-n]')).toHaveAttribute('data-n', String(CHANNELS));

    const runs: Run[] = [await browse(remote, live, 'full')];
    // The forced low tier: the same source, motion off, a shorter guide.
    runs.push(await browse(remote, live, 'low'));

    // The numbers first, so a run that fails a check below still shows them.
    const walk = (r: Run, note: string) => {
      const s = summarize(r.presses.filter((p) => p.label.endsWith(note)));
      return { count: s.count, median: Math.round(s.median), p95: Math.round(s.p95), max: Math.round(s.max) };
    };
    const report = runs.map((r) => ({
      tier: r.tier,
      slowdown: Number(r.slowdown.toFixed(1)),
      // The marks' cost (step 25c): the same walk back in time, with the marks and without.
      pastWithMarks: { ...walk(r, '(marks)'), marks: r.marked.length },
      pastWithoutMarks: { ...walk(r, '(no marks)'), marks: r.unmarked.length },
      opening: r.opening.map((p) => [p.label, Math.round(p.ms)]),
      openingTasks: r.openingTasks.map(Math.round),
      ...summarize(r.presses),
      longTasks: r.longTasks.map(Math.round),
      presses: r.presses.map((p) => [p.label, Math.round(p.ms)]),
    }));
    writeFileSync(path.join(REPORT, 'guide-throttled.json'), `${JSON.stringify(report, null, 2)}\n`);
    for (const r of report) {
      const slowest = [...r.presses].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5).map(([label, ms]) => `${label} ${ms} ms`);
      const opening = [...r.opening.map(([label, ms]) => `${label} ${ms} ms`), `long tasks ${r.openingTasks.join(', ') || 'none'}`].join(', ');
      console.log(`[grid, ${r.tier} tier, CPU ${r.slowdown}x slower] ${opening}; ${r.count} presses in the grid: median ${r.median.toFixed(0)} ms, p95 ${r.p95.toFixed(0)} ms, max ${r.max.toFixed(0)} ms; long tasks ${r.longTasks.join(', ') || 'none'}; slowest: ${slowest.join('; ')}`);
      const a = r.pastWithMarks;
      const b = r.pastWithoutMarks;
      console.log(`[grid, ${r.tier} tier] back in time with ${a.marks} marks drawn: median ${a.median} ms, p95 ${a.p95} ms, max ${a.max} ms; without marks: median ${b.median} ms, p95 ${b.p95} ms, max ${b.max} ms`);
    }
    for (const run of runs) {
      // The range reaches the tier's days back (seven in the full tier, two in the low one).
      expect(run.from, `${run.tier} tier`).toBe(run.wantFrom);
      // The walk among the channels with catch-up drew marks, only on their rows; the other none.
      expect(run.marked.length, `${run.tier} tier`).toBeGreaterThan(10);
      expect(run.marked.every((row) => row < ARCHIVED)).toBe(true);
      expect(run.unmarked).toEqual([]);
      // The time presses moved the view on, and the rows it drew are the guide's programmes.
      expect(run.afterTime.view, `${run.tier} tier`).toBeGreaterThan(run.firstView);
      expect(run.afterTime.index).toBe(DEEPEST);
      checkDense(run.afterTime);
    }
    for (const run of runs) {
      // The throttle was on: the same work ran at least twice as slow (about 4x on a quiet machine).
      expect(run.slowdown, `${run.tier} tier`).toBeGreaterThan(2);
      expect(budgetFailures(run.opening, run.openingTasks, OPEN_BUDGET), `${run.tier} tier, opening`).toEqual([]);
      expect(budgetFailures(run.presses, run.longTasks, BUDGET), `${run.tier} tier`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('a time press is timed by the time it draws', () => {
  test('RIGHT ends once the new time is drawn; a press that keeps the time never ends', async ({ page }) => {
    const remote = new RemoteDriver(page);
    // The grid guide's gallery page: made-up rows, no data workers.
    await page.goto('/?screen=gallery-guide&locale=en-US');
    await remote.expectFocus('gallery-guide/guide/0');
    const before = await focusedCell(page);
    await remote.timedPress('RIGHT', 'gallery-guide/guide/0', { timeMoves: true });
    const after = await focusedCell(page);
    expect(after.time).toBe(before.end);
    expect(remote.timings).toHaveLength(1);
    // DOWN keeps the time: waiting for another one, the press fails and isn't kept.
    await expect(remote.timedPress('DOWN', 'gallery-guide/guide/1', { timeMoves: true, timeoutMs: 500 })).rejects.toThrow(
      `DOWN to gallery-guide/guide/1: the time never moved from ${after.time} (the focus is at gallery-guide/guide/1)`,
    );
    expect(remote.timings).toHaveLength(1);
  });
});
