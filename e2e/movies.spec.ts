import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Catalog, Movie } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The movies screen (RELAY step 26a) by keys, in English and Arabic: the header's "Movies" (between
 * "Guide" and "Settings") opens a rail of the panel's VOD categories and a grid of poster tiles,
 * six a row, three rows in view. The posters are asked once the view rests, only for the rows in
 * view: each one requested once, no image drawn outside the view. A poster that fails shows the
 * movie's title. The grid fills from the right in Arabic, the rail on the right. DOWN moves the
 * rows (the drawn rows follow), LEFT from the first column goes to the rail (RIGHT in Arabic), OK
 * there shows a category, Back goes to the rail and then to the header.
 *
 * The mock's six films plus `EXTRA` of our own in a third category, so the grid has rows to move
 * through. Its posters are 1x1 PNGs. The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const EXTRA = 40;
const COLUMNS = 6;
const ROWS = 3;
/** Sintel's poster fails (the route aborts it). */
const BROKEN = 202;

const SAYS = {
  en: { all: 'All movies', header: 'Movies' },
  ar: { all: 'كل الأفلام', header: 'الأفلام' },
} as const;

function withMovies(base: Catalog): Catalog {
  const extra: Movie[] = Array.from({ length: EXTRA }, (_v, i) => ({
    id: 300 + i,
    num: 300 + i,
    name: i % 2 === 0 ? `Lablo Test Film ${i + 1}` : `فيلم تجريبي ${i + 1}`,
    categoryId: 12,
    ext: 'mp4',
    year: 2026,
    durationSecs: 600,
    rating: 5,
    genre: 'Test',
    plot: 'Our own test film.',
    addedDaysAgo: i,
    media: 'vod',
  }));
  return { ...base, vodCategories: base.vodCategories.concat([{ id: 12, name: 'Lablo Test Films', parentId: 0 }]), movies: base.movies.concat(extra) };
}

const catalog = withMovies(loadCatalog());
/** The movies in the order "All movies" lists them: category by category, as the panel lists them. */
const ordered: Movie[] = catalog.vodCategories.flatMap((c) => catalog.movies.filter((m) => m.categoryId === c.id));

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ catalog, now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

/** The grid as drawn: its rows, each tile's title, poster and box, and the rail's box. */
function readGrid(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid=movies-grid]')!;
    const rail = document.querySelector('[data-testid=movies-rail]')!.getBoundingClientRect();
    const tiles = Array.prototype.slice.call(grid.querySelectorAll('.z-vgrid__item')) as HTMLElement[];
    return {
      top: Number(grid.getAttribute('data-top')),
      rows: (Array.prototype.slice.call(grid.querySelectorAll('.z-vgrid__row')) as HTMLElement[]).map((r) => Number(r.getAttribute('data-row'))),
      tiles: tiles.map((t) => {
        const box = t.getBoundingClientRect();
        const img = t.querySelector('img');
        return {
          index: Number(t.getAttribute('data-index')),
          title: t.querySelector('.z-tile__title')!.textContent,
          poster: img === null ? null : img.getAttribute('src'),
          left: box.left,
          right: box.right,
          top: box.top,
        };
      }),
      images: document.querySelectorAll('img').length,
      rail: { left: rail.left, right: rail.right },
      box: grid.getBoundingClientRect().toJSON() as { left: number; right: number; top: number; bottom: number },
    };
  });
}

const posterId = (url: string): number => Number(/movie-(\d+)\.png/.exec(url)?.[1] ?? NaN);

test.describe('the movies screen (RELAY step 26a)', () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`a poster grid by keys, its posters only for the rows in view (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const asked: number[] = [];
      page.on('request', (request) => {
        if (/\/images\/movie-\d+\.png/.test(request.url())) asked.push(posterId(request.url()));
      });
      await page.route(`**/images/movie-${BROKEN}.png`, (route) => route.abort());
      const says = SAYS[language];
      const forward = dir === 'rtl' ? 'LEFT' : 'RIGHT';
      const backward = dir === 'rtl' ? 'RIGHT' : 'LEFT';
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      expect(asked).toEqual([]);

      // The header: "Guide", "Movies", "Settings".
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await expect(page.getByTestId('live-movies')).toHaveText(says.header);
      await remote.go('OK', 'movies/grid/0');
      const screen = page.getByTestId('movies-screen');
      await expect(screen).toHaveAttribute('data-status', 'ready');
      await expect(screen).toHaveAttribute('data-language', language);
      await settled(screen);

      // The rail: "All movies", then the panel's categories, with their counts.
      const chips = page.locator('[data-testid^=movies-chip-] .z-chip__label');
      await expect(chips).toHaveText([says.all, 'Open Movies | أفلام مفتوحة', 'Test Patterns', 'Lablo Test Films']);
      await expect(page.getByTestId('movies-meta')).toContainText(says.all);
      await expect(page.getByTestId('movies-meta').locator('[data-n]')).toHaveAttribute('data-n', String(ordered.length));
      if (language === 'en') await expect(page.getByTestId('movies-meta')).toContainText(`${ordered.length} movies`);

      // Three rows of six, in the panel's order; each poster in view asked once, nothing below.
      let grid = await readGrid(page);
      expect(grid.rows).toEqual([0, 1, 2]);
      expect(grid.tiles.map((t) => t.title)).toEqual(ordered.slice(0, COLUMNS * ROWS).map((m) => m.name));
      const inView = ordered.slice(0, COLUMNS * ROWS).map((m) => m.id);
      expect(asked.slice().sort()).toEqual(inView.slice().sort());
      // The failed poster: Sintel's tile shows its title and no image; every other tile its poster.
      expect(grid.tiles.filter((t) => t.poster === null).map((t) => t.title)).toEqual(['Sintel']);
      expect(grid.tiles.filter((t) => t.poster !== null).every((t) => posterId(t.poster!) === ordered[t.index]!.id)).toBe(true);
      expect(grid.images).toBe(COLUMNS * ROWS - 1);

      // The layout: six tiles a row with 24 px between them, filled from the inline start, the rail at the inline start.
      const first = grid.tiles[0]!;
      const second = grid.tiles[1]!;
      if (dir === 'ltr') {
        expect(first.left).toBeCloseTo(grid.box.left, 0);
        expect(second.left - first.right).toBeCloseTo(24, 0);
        expect(grid.rail.right).toBeLessThan(grid.box.left);
      } else {
        expect(first.right).toBeCloseTo(grid.box.right, 0);
        expect(first.left - second.right).toBeCloseTo(24, 0);
        expect(grid.rail.left).toBeGreaterThan(grid.box.right);
      }
      expect(grid.tiles[COLUMNS]!.top - first.top).toBeCloseTo(276 + 24, 0);
      await page.screenshot({ path: path.join(SHOTS, `movies-${locale}.png`), animations: 'disabled' });

      // Down past the view: the drawn rows follow, and only the rows that came into view are asked.
      for (let i = 1; i <= 4; i += 1) await remote.go('DOWN', `movies/grid/${i * COLUMNS}`);
      await settled(screen);
      grid = await readGrid(page);
      expect(grid.rows).toEqual([2, 3, 4]);
      expect(grid.tiles.map((t) => t.title)).toEqual(ordered.slice(2 * COLUMNS, 5 * COLUMNS).map((m) => m.name));
      expect(grid.tiles.every((t) => t.poster !== null)).toBe(true);
      expect(grid.images).toBe(COLUMNS * ROWS);
      // Nothing beyond the rows that were in view, none twice.
      const seen = ordered.slice(0, 5 * COLUMNS).map((m) => m.id);
      expect(asked.every((id) => seen.indexOf(id) !== -1)).toBe(true);
      expect(new Set(asked).size).toBe(asked.length);
      for (const m of ordered.slice(3 * COLUMNS, 5 * COLUMNS)) expect(asked).toContain(m.id);

      // LEFT from the first column: the rail (RIGHT in Arabic); OK on "Test Patterns" shows its two.
      await remote.go(backward, 'movies/rail/0');
      await remote.go('DOWN', 'movies/rail/1');
      await remote.go('DOWN', 'movies/rail/2');
      await remote.go('OK', 'movies/grid/0');
      await expect(screen).toHaveAttribute('data-category', '2');
      await settled(screen);
      grid = await readGrid(page);
      expect(grid.tiles.map((t) => t.title)).toEqual(['Lablo Test Pattern 4K HEVC', 'اختبار الصوت المتعدد']);
      await expect(page.getByTestId('movies-meta')).toContainText('Test Patterns');
      await remote.go(forward, 'movies/grid/1');

      // Back: the rail on the category on show, then the live screen's header on "Movies".
      await remote.go('BACK', 'movies/rail/2');
      await remote.go('BACK', 'live/header/1');
      await expect(page.getByTestId('movies-screen')).toHaveCount(0);
      await remote.go('DOWN', 'live/channels/0');
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
