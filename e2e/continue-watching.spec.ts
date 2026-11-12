import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * "Continue watching" (RELAY step 27d) by keys, in English and Arabic. Nothing played: the movies
 * and series rails start with "Recently added" and "Recently updated". Big Buck Bunny played and
 * left at 0:40 (four RIGHTs): back on the grid, "Continue watching" came first in the rail (one
 * movie), "Recently added" still on show and focused where it was. On "Continue watching" its tile
 * draws its bar (40/596); OK opens its details on "Resume from 0:40", and OK resumes it from
 * there. The same for "Lablo Test Series": S1 E2 left at 0:40, the show in the series screen's
 * "Continue watching" with its episode's bar (40/300); OK opens its details on S1 E2, and OK
 * resumes it. S1 E2 played on to 4:50 is watched with S1 E3 after it: the show stays (no bar),
 * the profile's entry saying so (`more`), and OK lands on S1 E3. A relaunch opens both screens on
 * "Continue watching".
 *
 * The streams reach the mock and are never answered (the routes hold them): the player stays
 * "Connecting…", and the place it was left is the one asked. The screenshots go to
 * artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const BBB = 'x:s1:movie:201';
const SHOW_KEY = 'x:s1:series:301';
const E2 = 'x:s1:episode:3002';
const LEFT_MS = 40_000;

const SAYS = {
  en: {
    continue: 'Continue watching',
    recent: 'Recently added',
    updated: 'Recently updated',
    movies: 'Continue watching · 1 movie',
    series: 'Continue watching · 1 series',
    resume: 'Resume from 0:40',
  },
  ar: {
    continue: 'متابعة المشاهدة',
    recent: 'أضيف حديثًا',
    updated: 'حُدّثت مؤخرًا',
    movies: null,
    series: null,
    resume: 'استئناف من 0:40',
  },
} as const;

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** An element's text without them. */
async function plain(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(MARKS, '');
}

type Kept = { progress?: Record<string, { positionMs: number }>; shows?: Record<string, { episode: string; watched: boolean; more?: boolean }> };

/** The profile's places and shows' last episodes. */
function stored(page: Page): Promise<Kept | undefined> {
  return page.evaluate(
    () =>
      new Promise<Kept | undefined>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { doc: Kept } | undefined)?.doc);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The bar's share on tile `testId`, in percent (`null`: no bar). */
async function tileBar(page: Page, testId: string): Promise<number | null> {
  const bar = page.getByTestId(testId).locator('.z-tile__progress');
  if ((await bar.count()) === 0) return null;
  return Number(await bar.getAttribute('aria-valuenow'));
}

/** The rail's labels, in order. */
function chips(page: Page, screen: 'movies' | 'series') {
  return page.locator(`[data-testid^=${screen}-chip-] .z-chip__label`);
}

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

test.describe('"Continue watching" (RELAY step 27d)', () => {
  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`a movie and an episode left part way, both in "Continue watching", OK resumes; a relaunch (${locale})`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
      // The streams reach the mock and are never answered: the player stays "Connecting…".
      await page.route('**/movie/**', async (route) => {
        await route.fetch().catch(() => undefined);
      });
      await page.route(`**/series/${U}/${P}/**`, async (route) => {
        await route.fetch().catch(() => undefined);
      });
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      const movies = page.getByTestId('movies-screen');
      const series = page.getByTestId('series-screen');
      const player = page.getByTestId('player');
      const seek = page.getByTestId('player-seek');

      // Nothing played: "Recently added" first.
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await remote.go('OK', 'movies/grid/0');
      await settled(movies);
      await expect(chips(page, 'movies').first()).toHaveText(says.recent);

      // Big Buck Bunny played, four RIGHTs: 0:40.
      await remote.go('OK', 'movie/actions/0');
      await expect(page.getByTestId('movie-details')).toHaveAttribute('data-status', 'read');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', BBB);
      for (let i = 0; i < 4; i += 1) await remote.press('RIGHT');
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(seek).toHaveAttribute('data-seeking', 'false');
      await remote.go('BACK', 'movie/actions/0');
      await remote.go('BACK', 'movies/grid/0');
      // Back on the grid: "Continue watching" came first; "Recently added" stays on show, the focus where it was.
      await settled(movies);
      await expect(chips(page, 'movies').nth(0)).toHaveText(says.continue);
      await expect(chips(page, 'movies').nth(1)).toHaveText(says.recent);
      await expect(page.getByTestId('movies-chip-0').locator('.z-chip__count')).toHaveText('1');
      await expect(movies).toHaveAttribute('data-category', '1');
      await expect(page.getByTestId('movies-meta')).toContainText(says.recent);
      // Back: the rail on the entry on show, one lower; "Continue watching" above it.
      await remote.go('BACK', 'movies/rail/1');
      await remote.go('UP', 'movies/rail/0');
      await remote.go('OK', 'movies/grid/0');
      await settled(movies);
      await expect(movies).toHaveAttribute('data-category', '0');
      await expect(page.getByTestId('movies-meta').locator('[data-n]')).toHaveAttribute('data-n', '1');
      if (says.movies !== null) await expect.poll(() => plain(page, 'movies-meta')).toBe(says.movies);
      else await expect(page.getByTestId('movies-meta')).toContainText(says.continue);
      await expect(page.getByTestId('movie-0')).toContainText('Big Buck Bunny');
      await expect(page.getByTestId('movie-1')).toHaveCount(0);
      await expect.poll(() => tileBar(page, 'movie-0')).toBe(6.7);
      await page.screenshot({ path: path.join(SHOTS, `continue-movies-${locale}.png`), animations: 'disabled' });

      // OK: its details on "Resume from 0:40"; OK resumes it from there.
      await remote.go('OK', 'movie/actions/0');
      await expect.poll(() => plain(page, 'movie-resume')).toBe(says.resume);
      await expect(page.getByTestId('movie-resume')).toHaveAttribute('data-state', 'focused');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', BBB);
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:40');
      await remote.go('BACK', 'movie/actions/0');
      await remote.go('BACK', 'movies/grid/0');
      await remote.go('BACK', 'movies/rail/0');
      await remote.go('BACK', 'live/header/1');

      // The series: nothing played, "Recently updated" first (302, then 301).
      await remote.go(forward, 'live/header/2');
      await remote.go('OK', 'series/grid/0');
      await settled(series);
      await expect(chips(page, 'series').first()).toHaveText(says.updated);
      await remote.go(forward, 'series/grid/1');
      await remote.press('OK');
      const details = page.getByTestId('show-details');
      await expect(details).toHaveAttribute('data-status', 'read');
      await remote.expectFocus('show/episodes/0');
      // S1 E2 played, four RIGHTs: 0:40.
      await remote.go('DOWN', 'show/episodes/1');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', E2);
      for (let i = 0; i < 4; i += 1) await remote.press('RIGHT');
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(seek).toHaveAttribute('data-seeking', 'false');
      await remote.go('BACK', 'show/episodes/1');
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'series/grid/1');
      await settled(series);
      await expect(chips(page, 'series').nth(0)).toHaveText(says.continue);
      await expect(chips(page, 'series').nth(1)).toHaveText(says.updated);
      await expect(series).toHaveAttribute('data-category', '1');
      await remote.go('BACK', 'series/rail/1');
      await remote.go('UP', 'series/rail/0');
      await remote.go('OK', 'series/grid/0');
      await settled(series);
      await expect(page.getByTestId('series-meta').locator('[data-n]')).toHaveAttribute('data-n', '1');
      if (says.series !== null) await expect.poll(() => plain(page, 'series-meta')).toBe(says.series);
      // The show, with its episode's bar.
      await expect(page.getByTestId('show-0')).toContainText('Lablo Test Series');
      await expect(page.getByTestId('show-1')).toHaveCount(0);
      await expect.poll(() => tileBar(page, 'show-0')).toBe(13.3);
      await page.screenshot({ path: path.join(SHOTS, `continue-series-${locale}.png`), animations: 'disabled' });

      // OK: its details on S1 E2; OK resumes it from 0:40.
      await remote.go('OK', 'show/episodes/1');
      await expect(page.getByTestId('episode-1')).toHaveAttribute('data-resume', String(LEFT_MS));
      await expect.poll(() => plain(page, 'episode-resume-1')).toBe(says.resume);
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', E2);
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:40');

      // On to 4:50 (FF): watched, S1 E3 after it. The show stays, with no bar; OK lands on S1 E3.
      await remote.press('FF');
      await expect(player).toHaveAttribute('data-from', String(290_000));
      await remote.go('BACK', 'show/episodes/2');
      await expect.poll(async () => (await stored(page))?.shows?.[SHOW_KEY]).toMatchObject({ episode: E2, watched: true, more: true });
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'series/grid/0');
      await settled(series);
      await expect(page.getByTestId('show-0')).toContainText('Lablo Test Series');
      await expect.poll(() => tileBar(page, 'show-0')).toBeNull();
      await remote.go('OK', 'show/episodes/2');
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'series/grid/0');

      // A relaunch: both screens open on "Continue watching".
      await remote.go('BACK', 'series/rail/0');
      await remote.go('BACK', 'live/header/2');
      await page.reload();
      await settled(page.getByTestId('live'));
      await remote.expectFocus('live/channels/0');
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await remote.go('OK', 'movies/grid/0');
      await settled(movies);
      await expect(movies).toHaveAttribute('data-category', '0');
      await expect(chips(page, 'movies').first()).toHaveText(says.continue);
      await expect(page.getByTestId('movie-0')).toContainText('Big Buck Bunny');
      await expect.poll(() => tileBar(page, 'movie-0')).toBe(6.7);
      await remote.go('BACK', 'movies/rail/0');
      await remote.go('BACK', 'live/header/1');
      await remote.go(forward, 'live/header/2');
      await remote.go('OK', 'series/grid/0');
      await settled(series);
      await expect(series).toHaveAttribute('data-category', '0');
      await expect(chips(page, 'series').first()).toHaveText(says.continue);
      await expect(page.getByTestId('show-0')).toContainText('Lablo Test Series');
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
