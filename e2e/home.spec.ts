import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Home (RELAY step 28b1) by keys, in English and Arabic, against the mock. The header: "Guide",
 * "Movies", "Series", "Home", then the icons "Search" and "Settings" (named for screen readers),
 * all six inside the safe area. Nothing played: Home shows "Recently added movies" (the mock's six,
 * Big Buck Bunny first) and "Recently updated series" (302, then 301). Big Buck Bunny played from
 * Home's tile and left at 0:40 (four RIGHTs): back on Home, "Continue watching" leads, with its bar
 * (40/596), and the focus is still on the tile it was played from. OK on the new tile opens its
 * details on "Resume from 0:40"; Back returns to the tile. A show's tile opens its details; Back
 * returns to it. Back closes Home onto the header's "Home".
 *
 * The streams reach the mock and are never answered (the routes hold them): the player stays
 * "Connecting…", and the place it was left is the one asked. The screenshots go to
 * artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

const BBB = 'x:s1:movie:201';
const LEFT_MS = 40_000;

const SAYS = {
  en: {
    home: 'Home',
    search: 'Search',
    settings: 'Settings',
    continue: 'Continue watching',
    movies: 'Recently added movies',
    series: 'Recently updated series',
    shows: ['مسلسل الاختبار', 'Lablo Test Series'],
    resume: 'Resume from 0:40',
  },
  ar: {
    home: 'الرئيسية',
    search: 'البحث',
    settings: 'الإعدادات',
    continue: 'متابعة المشاهدة',
    movies: 'أفلام أضيفت حديثًا',
    series: 'مسلسلات حُدّثت مؤخرًا',
    shows: ['مسلسل الاختبار', 'Lablo Test Series'],
    resume: 'استئناف من 0:40',
  },
} as const;

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** An element's text without them. */
async function plain(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(MARKS, '');
}

/** The bar's share on tile `testId`, in percent (`null`: no bar). */
async function tileBar(page: Page, testId: string): Promise<number | null> {
  const bar = page.getByTestId(testId).locator('.z-tile__progress');
  if ((await bar.count()) === 0) return null;
  return Number(await bar.getAttribute('aria-valuenow'));
}

/** Home as drawn: its shelves' titles and tiles' names, the boxes out of the safe area and the words cut. */
function drawn(page: Page) {
  return page.evaluate((safe) => {
    const name = (el: Element): string => `${el.className}: ${(el.textContent ?? '').slice(0, 40)}`;
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.home__header > *, .home__shelf, .home__shelf-title, .z-tile, .home__text'))) {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left || r.top < safe.top || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(name(el));
    }
    const cut = Array.from(document.querySelectorAll('.home__title, .home__clock, .home__shelf-title'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(name);
    const shelves = Array.from(document.querySelectorAll('.home__shelf')).map((shelf) => ({
      title: shelf.querySelector('.home__shelf-title')?.textContent ?? '',
      tiles: Array.from(shelf.querySelectorAll('.z-tile__title')).map((t) => t.textContent ?? ''),
    }));
    // Where the shelves' titles and tiles start (HOME in home-state.ts: 134 px down, a shelf every 364 px, the tiles 56 px under the title).
    const tops = Array.from(document.querySelectorAll('.home__shelf')).map((shelf) => [
      Math.round(shelf.getBoundingClientRect().top),
      Math.round(shelf.querySelector('.z-tile')?.getBoundingClientRect().top ?? -1),
    ]);
    return { scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const, outside, cut, shelves, tops };
  }, SAFE);
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

test.describe('Home by keys (RELAY step 28b1)', () => {
  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`the header's six buttons; Home's shelves, a movie played from it leads "Continue watching", OK and Back (${locale})`, async ({ page }) => {
      test.setTimeout(150_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
      // The streams reach the mock and are never answered: the player stays "Connecting…".
      await page.route('**/movie/**', async (route) => {
        await route.fetch().catch(() => undefined);
      });
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      const home = page.getByTestId('home-screen');
      const player = page.getByTestId('player');
      const seek = page.getByTestId('player-seek');

      // The header: "Home" after "Series"; "Search" and "Settings" are icons with their names; all six inside the safe area.
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await remote.go(forward, 'live/header/2');
      await remote.go(forward, 'live/header/3');
      await expect(page.getByTestId('live-home')).toHaveText(says.home);
      await expect(page.getByTestId('live-home')).toHaveAttribute('data-state', 'focused');
      for (const [id, label] of [
        ['live-search', says.search],
        ['live-settings', says.settings],
      ] as const) {
        const icon = page.getByTestId(id);
        await expect(icon).toHaveAttribute('aria-label', label);
        await expect(icon).toHaveText('');
        await expect(icon.locator('svg')).toBeVisible();
      }
      const buttons = await page.locator('.live__end .z-button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { left: number; right: number; top: number; width: number; height: number }));
      expect(buttons).toHaveLength(6);
      for (const b of buttons) {
        expect(b.left).toBeGreaterThanOrEqual(SAFE.left);
        expect(b.right).toBeLessThanOrEqual(SAFE.right);
        expect(b.top).toBe(buttons[0]!.top);
      }
      // The icons are squares as tall as the header's buttons, each drawn in its middle.
      expect([buttons[4]!.width, buttons[4]!.height, buttons[5]!.width, buttons[5]!.height]).toEqual([56, 56, 56, 56]);
      for (const id of ['live-search', 'live-settings']) {
        const off = await page.getByTestId(id).evaluate((el) => {
          const box = el.getBoundingClientRect();
          const icon = el.querySelector('svg')!.getBoundingClientRect();
          return [Math.round(icon.left + icon.width / 2 - (box.left + box.width / 2)), Math.round(icon.top + icon.height / 2 - (box.top + box.height / 2)), Math.round(icon.width)];
        });
        expect(off).toEqual([0, 0, 28]);
      }
      // In Arabic the row runs from the right: "Guide" first on the right, "Settings" last on the left.
      if (language === 'ar') expect(buttons[0]!.left).toBeGreaterThan(buttons[5]!.left);
      else expect(buttons[0]!.left).toBeLessThan(buttons[5]!.left);
      await page.screenshot({ path: path.join(SHOTS, `home-header-${locale}.png`), animations: 'disabled' });
      // The two icons focused, drawn as such.
      await remote.go(forward, 'live/header/4');
      await expect(page.getByTestId('live-search')).toHaveAttribute('data-state', 'focused');
      await remote.go(forward, 'live/header/5');
      await expect(page.getByTestId('live-settings')).toHaveAttribute('data-state', 'focused');
      await expect(page.getByTestId('live-settings')).toHaveClass(/is-focused/);
      await page.screenshot({ path: path.join(SHOTS, `home-header-settings-${locale}.png`), animations: 'disabled' });
      await remote.go(language === 'ar' ? 'RIGHT' : 'LEFT', 'live/header/4');
      await remote.go(language === 'ar' ? 'RIGHT' : 'LEFT', 'live/header/3');

      // Nothing played: the newest movies, then the series updated last.
      await remote.go('OK', 'home/movies/0');
      await expect(home).toHaveAttribute('data-status', 'ready');
      await settled(home);
      await expect(home).toHaveAttribute('data-shelves', 'movies series');
      let shown = await drawn(page);
      expect(shown.shelves).toEqual([
        { title: says.movies, tiles: expect.arrayContaining(['Big Buck Bunny', 'Sintel']) as unknown as string[] },
        { title: says.series, tiles: says.shows.slice() },
      ]);
      expect(shown.shelves[0]!.tiles).toHaveLength(6);
      expect(shown.shelves[0]!.tiles[0]).toBe('Big Buck Bunny');
      expect(shown).toMatchObject({ scroll: [1920, 1080], outside: [], cut: [], tops: [[134, 190], [498, 554]] });
      await expect(page.getByTestId('home-movies-0')).toHaveAttribute('data-state', 'focused');
      await page.screenshot({ path: path.join(SHOTS, `home-new-${locale}.png`), animations: 'disabled' });

      // Big Buck Bunny's details from its tile, played, four RIGHTs: 0:40.
      await remote.go('OK', 'movie/actions/0');
      await expect(page.getByTestId('movie-details')).toHaveAttribute('data-status', 'read');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', BBB);
      for (let i = 0; i < 4; i += 1) await remote.press('RIGHT');
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(seek).toHaveAttribute('data-seeking', 'false');
      await remote.go('BACK', 'movie/actions/0');
      // Back on Home: "Continue watching" leads with it, its bar drawn; the focus on the tile it was played from.
      await remote.go('BACK', 'home/movies/0');
      await expect(home).toHaveAttribute('data-shelves', 'continue movies series');
      await settled(home);
      await remote.expectFocus('home/movies/0');
      shown = await drawn(page);
      expect(shown.shelves.map((s) => s.title)).toEqual([says.continue, says.movies]);
      expect(shown.shelves[0]!.tiles).toEqual(['Big Buck Bunny']);
      await expect.poll(() => tileBar(page, 'home-continue-0')).toBe(6.7);
      // Its bar on the movies shelf too.
      await expect.poll(() => tileBar(page, 'home-movies-0')).toBe(6.7);
      expect(shown).toMatchObject({ scroll: [1920, 1080], outside: [], cut: [] });

      // UP: the tile; OK opens its details on "Resume from 0:40"; Back returns to the tile.
      await remote.go('UP', 'home/continue/0');
      await page.screenshot({ path: path.join(SHOTS, `home-continue-${locale}.png`), animations: 'disabled' });
      await remote.go('OK', 'movie/actions/0');
      await expect.poll(() => plain(page, 'movie-resume')).toBe(says.resume);
      await expect(page.getByTestId('movie-resume')).toHaveAttribute('data-state', 'focused');
      await remote.go('BACK', 'home/continue/0');
      await settled(home);

      // DOWN twice: the series, the shelves moved up one; OK on the first show opens its details; Back returns to it.
      await remote.go('DOWN', 'home/movies/0');
      await remote.go('DOWN', 'home/series/0');
      await expect(home).toHaveAttribute('data-top', '1');
      shown = await drawn(page);
      expect(shown.shelves.map((s) => s.title)).toEqual([says.movies, says.series]);
      expect(shown).toMatchObject({ outside: [], cut: [] });
      await remote.go(forward, 'home/series/1');
      await page.screenshot({ path: path.join(SHOTS, `home-series-${locale}.png`), animations: 'disabled' });
      await remote.go('OK', 'show/episodes/0');
      await expect(page.getByTestId('show-details')).toHaveAttribute('data-status', 'read');
      await expect(page.getByTestId('show-details')).toContainText('Lablo Test Series');
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'home/series/1');

      // Back closes Home onto the header's "Home"; DOWN: the list.
      await remote.go('BACK', 'live/header/3');
      await expect(page.getByTestId('live-home')).toHaveAttribute('data-state', 'focused');
      await remote.go('DOWN', 'live/channels/0');
      // Opened again: read again, on the first shelf's first tile.
      await remote.go('UP', 'live/header/3');
      await remote.go('OK', 'home/continue/0');
      await settled(home);
      await expect(page.getByTestId('home-continue-0')).toContainText('Big Buck Bunny');
      await remote.go('BACK', 'live/header/3');
      expect(errors).toEqual([]);
    });
  }
});
