import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { posterPng } from '../tools/engines/src/poster';
import { BIG_MOVIE_ID, bigCatalog } from './big-catalog';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import type { PressBudget, PressTiming } from './remote-keys';
import { budgetFailures, summarize } from './remote-keys';
import { THROTTLE, busyMs, throttle, transitionOf } from './throttle';

/**
 * The poster grid on a large catalog at 4x CPU throttle (RELAY step 26b, architecture.md §4), as
 * live-throttled.spec.ts and guide-throttled.spec.ts do for the live list and the grid guide:
 * "Movies" opened from the live header over "All movies" (20,000 movies in 100 categories), then
 * every press timed from its key event to the paint of the frame that shows the new focus: down
 * the rows, page by page with CH−, to the rail and down it, OK on a category, down its rows, and
 * Back to the rail and to the header. Then the same in the forced low tier (`?tier=low`).
 *
 * The posters are watched in the page meanwhile (`recordPosters`):
 * - the `img` elements drawn, at every change of the DOM: never more than the view's 18;
 * - each poster's first download starts only once the view has rested for the tier's time
 *   (150 ms full, 300 ms low) after the last key: a held key starts none;
 * - between two keys, at most the view's 18 first downloads;
 * - at each rest the walk waits for, the view's 18 tiles draw their own posters, loaded.
 *
 * The posters are provider-sized (500 x 750 PNG, as a panel's TMDB posters), not the mock's 1x1
 * images, so each one drawn is decoded and scaled down as on a TV, and each takes
 * `POSTER_LATENCY_MS` to come, as from an image server across the internet: the keys after a
 * short stop come while the view's first posters are still on their way.
 */
const CHANNELS = 1_000;
const CATEGORIES = 10;
const MOVIES = 20_000;
const MOVIE_CATEGORIES = 100;
const COLUMNS = 6;
const ROWS = 3;
const VIEW = COLUMNS * ROWS;
/** The tiers' rest before the posters are asked (apps/tv posters.ts `POSTER_TIERS`). */
const REST_MS = { full: 150, low: 300 } as const;
/** The rail entry the walk opens: category 30, the 30th of the panel's (its movies from 29 x 200). */
const CATEGORY = 30;
const PER_CATEGORY = MOVIES / MOVIE_CATEGORIES;
/**
 * Each press in the movies screen within 150 ms (PLAN 6.2's grid budget, as the grid guide's),
 * and no main-thread task longer than that while the keys go down.
 */
const BUDGET: PressBudget = { pressMs: 150, longTaskMs: 150 };
/**
 * The presses on the live screen that open "Movies" (UP to the header, RIGHT to "Movies", and OK:
 * the screen's first draw) have the live screen's budget, spike S6's key press threshold for the
 * 2018 TVs (live-throttled.spec.ts), as the grid guide's opening does.
 */
const OPEN_BUDGET: PressBudget = { pressMs: 200, longTaskMs: 200 };
const REPORT = path.resolve(import.meta.dirname, '../artifacts/perf');
/** How long each poster takes to answer. */
const POSTER_LATENCY_MS = 80;
/** A panel's poster: 500 x 750. */
const POSTER = posterPng(500, 750, [40, 70, 120], [10, 20, 40]);

const catalog = bigCatalog({ channels: CHANNELS, categories: CATEGORIES, movies: { count: MOVIES, categories: MOVIE_CATEGORIES } });
let app: MockServer;
let host: string;

test.beforeAll(async () => {
  app = await mock({ catalog, now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
  mkdirSync(REPORT, { recursive: true });
});
test.afterAll(async () => {
  await app.close();
});

/** What the page records about the posters (`recordPosters`). */
interface PosterLog {
  /** Each keydown's `timeStamp` (ms from the page's time origin). */
  readonly keys: number[];
  /** Each poster download: its movie id and its start (Resource Timing's `startTime`, same clock). */
  readonly starts: Array<[number, number]>;
  /** The most `img` elements the page held at any change of its DOM. */
  maxImages: number;
}

/**
 * In the page: records the keys, the poster downloads and the `img` count (see `PosterLog`). The
 * observers run after each change of the DOM and keep only counts, so the presses they share the
 * frame with stay as they are.
 */
function recordPosters(): void {
  const w = window as unknown as { __zomaPosters: PosterLog };
  const log: PosterLog = { keys: [], starts: [], maxImages: 0 };
  w.__zomaPosters = log;
  addEventListener('keydown', (event) => log.keys.push(event.timeStamp), true);
  performance.setResourceTimingBufferSize(100_000);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const match = /\/images\/movie-(\d+)\.png/.exec(entry.name);
      if (match !== null) log.starts.push([Number(match[1]), entry.startTime]);
    }
  }).observe({ type: 'resource' });
  const images = document.getElementsByTagName('img');
  new MutationObserver(() => {
    if (images.length > log.maxImages) log.maxImages = images.length;
  }).observe(document.body, { subtree: true, childList: true });
}

/** The poster log so far; the page keeps recording. */
function readPosterLog(page: Page): Promise<PosterLog> {
  return page.evaluate(() => {
    const log = (window as unknown as { __zomaPosters: PosterLog }).__zomaPosters;
    return { keys: log.keys.slice(), starts: log.starts.slice(), maxImages: log.maxImages };
  });
}

/** A rest the walk waited for: the grid's first row, the category on show, and its tiles as drawn. */
interface Rest {
  readonly label: string;
  readonly top: number;
  readonly category: number;
  readonly tiles: ReadonlyArray<{ readonly index: number; readonly poster: number | null; readonly drawn: boolean }>;
  readonly images: number;
}

function readRest(page: Page, label: string): Promise<Rest> {
  return page.evaluate((label) => {
    const screen = document.querySelector('[data-testid=movies-screen]')!;
    const grid = screen.querySelector('[data-testid=movies-grid]')!;
    const tiles = Array.prototype.slice.call(grid.querySelectorAll('.z-vgrid__item')) as HTMLElement[];
    return {
      label,
      top: Number(grid.getAttribute('data-top')),
      category: Number(screen.getAttribute('data-category')),
      tiles: tiles.map((tile) => {
        const img = tile.querySelector('img');
        const id = img === null ? null : /movie-(\d+)\.png/.exec(img.src);
        return { index: Number(tile.getAttribute('data-index')), poster: id === null ? null : Number(id[1]), drawn: img !== null && img.complete && img.naturalWidth > 0 };
      }),
      images: document.getElementsByTagName('img').length,
    };
  }, label);
}

/**
 * A viewer's short stop: until the view has rested and its first posters are drawn (and
 * downloading), then the keys go on at once, while the rest of the view's posters still wait
 * for their turn: a key must hold them (apps/tv posters.ts `hold`).
 */
async function pause(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=movies-grid] img').length > 0, undefined, { polling: 'raf', timeout: 10_000 });
}

/** The movie tile `index` of rail entry `category` shows ("All movies" lists the categories in turn). */
const movieAt = (category: number, index: number): number => BIG_MOVIE_ID + (category === 0 ? 0 : (category - 1) * PER_CATEGORY) + index;

/** What is wrong with a rest: its 18 tiles, each drawing its own movie's poster, loaded. */
function restFailures(rest: Rest, want: { top: number; category: number }): string[] {
  const failures: string[] = [];
  const indices: number[] = [];
  for (let i = want.top * COLUMNS; i < (want.top + ROWS) * COLUMNS; i += 1) indices.push(i);
  if (rest.top !== want.top || rest.category !== want.category) failures.push(`${rest.label}: rows from ${rest.top} of entry ${rest.category}, expected ${want.top} of ${want.category}`);
  if (rest.tiles.map((t) => t.index).join() !== indices.join()) failures.push(`${rest.label}: tiles ${rest.tiles.map((t) => t.index).join(', ')}, expected ${indices.join(', ')}`);
  const wrong = rest.tiles.filter((t) => t.poster !== movieAt(rest.category, t.index) || !t.drawn).map((t) => `${t.index}: ${t.poster ?? 'no poster'}${t.drawn ? '' : ' (not drawn)'}`);
  if (wrong.length > 0) failures.push(`${rest.label}: ${wrong.length} tiles without their poster: ${wrong.join('; ')}`);
  if (rest.images !== VIEW) failures.push(`${rest.label}: ${rest.images} images drawn, expected ${VIEW}`);
  return failures;
}

interface PosterCheck {
  /** Posters downloaded for the first time. */
  readonly downloads: number;
  /** The fewest ms from a key to a first download after it (null: none). */
  readonly soonestMs: number | null;
  /** The most first downloads between two keys. */
  readonly mostBetweenKeys: number;
  readonly failures: string[];
}

/** Each poster's first download against the keys before it: after the rest, and 18 at most between two keys. */
function checkDownloads(log: PosterLog, restMs: number): PosterCheck {
  const first = new Map<number, number>();
  for (const [id, start] of log.starts) if (!first.has(id) || start < first.get(id)!) first.set(id, start);
  const keys = log.keys.slice().sort((a, b) => a - b);
  const failures: string[] = [];
  const between = new Map<number, number>();
  let soonest: number | null = null;
  for (const [id, start] of first) {
    let k = -1;
    while (k + 1 < keys.length && keys[k + 1]! <= start) k += 1;
    between.set(k, (between.get(k) ?? 0) + 1);
    if (k < 0) {
      failures.push(`movie ${id}'s poster started before any key`);
      continue;
    }
    const after = start - keys[k]!;
    soonest = soonest === null ? after : Math.min(soonest, after);
    // (A millisecond for the clocks' coarsening.)
    if (after < restMs - 1) failures.push(`movie ${id}'s poster started ${Math.round(after)} ms after a key, before the ${restMs} ms rest`);
  }
  let most = 0;
  between.forEach((n) => {
    most = Math.max(most, n);
  });
  if (most > VIEW) failures.push(`${most} posters started between two keys, more than the view's ${VIEW}`);
  if (log.maxImages > VIEW) failures.push(`${log.maxImages} images drawn at once, more than the view's ${VIEW}`);
  return { downloads: first.size, soonestMs: soonest === null ? null : Math.round(soonest), mostBetweenKeys: most, failures };
}

interface Run {
  readonly tier: 'full' | 'low';
  /** UP, RIGHT and OK on the live screen, and the long tasks until then. */
  readonly opening: readonly PressTiming[];
  readonly openingTasks: readonly number[];
  /** Every press in the movies screen, the Back that closes it included. */
  readonly presses: readonly PressTiming[];
  readonly longTasks: readonly number[];
  readonly slowdown: number;
  readonly rests: readonly Rest[];
  readonly posters: PosterCheck;
}

/**
 * The keys of a viewer looking through a large film library, timed at 4x throttle: UP to the
 * live header, RIGHT to "Movies" and OK (the screen's first draw), down 20 rows, 15 pages with
 * CH−, to the rail and 30 categories down it, OK on one, 5 rows down, Back to the rail and Back
 * to the header. The rows and the pages stop briefly every fifth key (`pause`), long enough for
 * a view's first posters, then go on. Each tier starts the app afresh with the source stored, so both runs begin alike.
 */
async function browse(remote: RemoteDriver, live: Locator, tier: 'full' | 'low'): Promise<Run> {
  const { page } = remote;
  await page.goto(tier === 'low' ? '/?locale=en-US&tier=low' : '/?locale=en-US');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-tier', tier);
  await remote.expectFocus('live/channels/0');
  await settled(live, 30_000);
  await page.evaluate(recordPosters);
  remote.timings.length = 0;
  const base = await busyMs(page);
  const release = await throttle(page, THROTTLE);
  const slowdown = (await busyMs(page)) / base;
  await remote.watchLongTasks();
  const screen = page.getByTestId('movies-screen');
  const rests: Rest[] = [];
  try {
    await remote.timedPress('UP', 'live/header/0');
    await remote.timedPress('RIGHT', 'live/header/1');
    await remote.timedPress('OK', 'movies/grid/0', { label: 'OK opens Movies' });
    const opening = remote.timings.splice(0);
    const openingTasks = await remote.longTasks();
    await expect(screen).toHaveAttribute('data-status', 'ready');
    await settled(screen, 30_000);
    // The tier's motion: a tile's focus transition, none on the low tier.
    expect(await transitionOf(page, '[data-testid=movies-grid] .z-tile')).toBe(tier === 'low' ? '0s' : '0.12s');
    await expect(page.getByTestId('movies-meta').locator('[data-n]')).toHaveAttribute('data-n', String(MOVIES));
    rests.push(await readRest(page, 'opened'));
    for (let i = 1; i <= 20; i++) {
      await remote.timedPress('DOWN', `movies/grid/${i * COLUMNS}`);
      // Every fifth row a short stop: rows 3-5, 8-10 and 13-15 have never been in view before.
      if (i % 5 === 0 && i < 20) await pause(page);
    }
    await settled(screen, 30_000);
    rests.push(await readRest(page, '20 rows down'));
    for (let k = 1; k <= 15; k++) {
      await remote.timedPress('CH_DOWN', `movies/grid/${(20 + k * ROWS) * COLUMNS}`);
      if (k % 5 === 0 && k < 15) await pause(page);
    }
    await settled(screen, 30_000);
    rests.push(await readRest(page, '15 pages down'));
    await remote.timedPress('LEFT', 'movies/rail/0');
    for (let i = 1; i <= CATEGORY; i++) await remote.timedPress('DOWN', `movies/rail/${i}`);
    await remote.timedPress('OK', 'movies/grid/0', { label: `OK on category ${CATEGORY}` });
    await expect(screen).toHaveAttribute('data-category', String(CATEGORY));
    await settled(screen, 30_000);
    rests.push(await readRest(page, `category ${CATEGORY}`));
    for (let i = 1; i <= 5; i++) await remote.timedPress('DOWN', `movies/grid/${i * COLUMNS}`);
    await remote.timedPress('BACK', `movies/rail/${CATEGORY}`);
    await remote.timedPress('BACK', 'live/header/1', { label: 'BACK closes Movies' });
    await settled(live, 30_000);
    const posters = checkDownloads(await readPosterLog(page), REST_MS[tier]);
    return { tier, opening, openingTasks, presses: [...remote.timings], longTasks: await remote.longTasks(), slowdown, rests, posters };
  } finally {
    await release();
  }
}

test.describe('the poster grid at 4x CPU throttle on a large catalog', () => {
  test(`keeps every key press within ${BUDGET.pressMs} ms and the posters within the view, in the full and the forced low tier`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors = trackErrors(page);
    await page.route('**/images/movie-*.png', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, POSTER_LATENCY_MS));
      await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'cache-control': 'max-age=86400' }, body: POSTER });
    });
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US', 120_000);
    await settled(live, 30_000);

    const runs: Run[] = [await browse(remote, live, 'full'), await browse(remote, live, 'low')];

    // The numbers first, so a run that fails a check below still shows them.
    const report = runs.map((r) => ({
      tier: r.tier,
      slowdown: Number(r.slowdown.toFixed(1)),
      opening: r.opening.map((p) => [p.label, Math.round(p.ms)]),
      openingTasks: r.openingTasks.map(Math.round),
      ...summarize(r.presses),
      longTasks: r.longTasks.map(Math.round),
      posters: { downloads: r.posters.downloads, soonestAfterKeyMs: r.posters.soonestMs, mostBetweenKeys: r.posters.mostBetweenKeys },
      presses: r.presses.map((p) => [p.label, Math.round(p.ms)]),
    }));
    writeFileSync(path.join(REPORT, 'movies-throttled.json'), `${JSON.stringify(report, null, 2)}\n`);
    for (const r of report) {
      const slowest = [...r.presses].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5).map(([label, ms]) => `${label} ${ms} ms`);
      const opening = [...r.opening.map(([label, ms]) => `${label} ${ms} ms`), `long tasks ${r.openingTasks.join(', ') || 'none'}`].join(', ');
      console.log(`[movies, ${r.tier} tier, CPU ${r.slowdown}x slower] ${opening}; ${r.count} presses: median ${r.median.toFixed(0)} ms, p95 ${r.p95.toFixed(0)} ms, max ${r.max.toFixed(0)} ms; long tasks ${r.longTasks.join(', ') || 'none'}; slowest: ${slowest.join('; ')}`);
      console.log(`[movies, ${r.tier} tier] ${r.posters.downloads} posters downloaded, the soonest ${r.posters.soonestAfterKeyMs ?? '-'} ms after a key, at most ${r.posters.mostBetweenKeys} between two keys`);
    }
    for (const run of runs) {
      const views = [
        { top: 0, category: 0 },
        { top: 20 - ROWS + 1, category: 0 },
        { top: 20 - ROWS + 1 + 15 * ROWS, category: 0 },
        { top: 0, category: CATEGORY },
      ];
      expect(run.rests.flatMap((rest, i) => restFailures(rest, views[i]!)), `${run.tier} tier`).toEqual([]);
      expect(run.posters.failures, `${run.tier} tier`).toEqual([]);
      // The four rests' posters, and some at each of the five short stops.
      expect(run.posters.downloads).toBeGreaterThan(4 * VIEW + 5);
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

test.describe('the poster checks can fail', () => {
  const log = (keys: number[], starts: Array<[number, number]>, maxImages = VIEW): PosterLog => ({ keys, starts, maxImages });

  test('a poster started before the rest, more than a view between two keys, or too many images, each fail', () => {
    // Fine: 18 after the rest, then 18 more after the next key's rest.
    const view = (from: number, at: number): Array<[number, number]> => Array.from({ length: VIEW }, (_v, i) => [from + i, at + i] as [number, number]);
    expect(checkDownloads(log([1000, 2000], [...view(0, 1150), ...view(100, 2150)]), 150)).toEqual({ downloads: 36, soonestMs: 150, mostBetweenKeys: 18, failures: [] });
    // A held key that starts a download.
    expect(checkDownloads(log([1000, 1100], [[7, 1180]]), 150).failures).toEqual(["movie 7's poster started 80 ms after a key, before the 150 ms rest"]);
    // The low tier's rest is longer.
    expect(checkDownloads(log([1000], [[7, 1200]]), 300).failures).toEqual(["movie 7's poster started 200 ms after a key, before the 300 ms rest"]);
    // A poster downloaded again (from the cache, its row back in view) counts by its first start only.
    expect(checkDownloads(log([1000, 2000], [[7, 1150], [7, 2010]]), 150).failures).toEqual([]);
    // 19 between two keys.
    expect(checkDownloads(log([1000], [...view(0, 1150), [99, 1400]]), 150).failures).toEqual(['19 posters started between two keys, more than the view\'s 18']);
    expect(checkDownloads(log([1000], [], 19), 150).failures).toEqual(["19 images drawn at once, more than the view's 18"]);
    expect(checkDownloads(log([1000], [[3, 900]]), 150).failures).toEqual(["movie 3's poster started before any key"]);
  });

  test('a rest whose tiles lack their posters, or that shows another view, fails', () => {
    const tiles = Array.from({ length: VIEW }, (_v, i) => ({ index: i, poster: movieAt(0, i), drawn: true }));
    const rest: Rest = { label: 'opened', top: 0, category: 0, tiles, images: VIEW };
    expect(restFailures(rest, { top: 0, category: 0 })).toEqual([]);
    expect(restFailures({ ...rest, tiles: tiles.map((t) => (t.index === 4 ? { ...t, drawn: false } : t)) }, { top: 0, category: 0 })).toEqual([`opened: 1 tiles without their poster: 4: ${movieAt(0, 4)} (not drawn)`]);
    expect(restFailures({ ...rest, tiles: tiles.map((t) => (t.index === 5 ? { ...t, poster: movieAt(0, 6) } : t)) }, { top: 0, category: 0 })).toHaveLength(1);
    expect(restFailures({ ...rest, images: VIEW - 1 }, { top: 0, category: 0 })).toEqual([`opened: ${VIEW - 1} images drawn, expected ${VIEW}`]);
    expect(restFailures(rest, { top: 1, category: 0 })).toHaveLength(2);
    // Category 30's first movie is the 5,801st.
    expect(movieAt(CATEGORY, 0)).toBe(BIG_MOVIE_ID + 5800);
  });
});
