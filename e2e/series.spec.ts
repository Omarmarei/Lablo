import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addM3uAndWatch, addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The series screen (RELAY step 27a) by keys, in English and Arabic: the header's "Series"
 * (after "Movies", before "Settings") opens the movies screen for series: a rail of "Recently
 * updated" (the panel's shows by their `last_modified`, newest first), "All series" and the
 * panel's series categories, beside a grid of the shows' covers. The mock's two shows: the Arabic
 * one was updated last (2 days ago), "Lablo Test Series" 4 days ago, so "Recently updated" lists
 * them in the order opposite to the panel's.
 *
 * A playlist (the mock's `get.php`, added as an M3U link) has no dates and lists its series as
 * episodes, one tile a line ("Lablo Test Series S01 E01", its "S01 E01" under the name so the
 * tile's two lines never cut it): its counts are of episodes, and OK on one opens it as a movie
 * (the line's facts, "Play" asks for its `/series/…` file).
 *
 * The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const SAYS = {
  en: { header: 'Series', recent: 'Recently updated', all: 'All series', shows: '2 series', episodes: '7 episodes' },
  ar: { header: 'المسلسلات', recent: 'حُدّثت مؤخرًا', all: 'كل المسلسلات', shows: 'مسلسلان', episodes: '7 حلقات' },
} as const;

const GROUP = 'Test Series | مسلسلات تجريبية';
const ARABIC_SHOW = 'مسلسل الاختبار';
const SHOW = 'Lablo Test Series';
/** The playlist's episodes, in its order. */
const EPISODES = [
  `${SHOW} S01 E01`,
  `${SHOW} S01 E02`,
  `${SHOW} S01 E03`,
  `${SHOW} S02 E01`,
  `${SHOW} S02 E02`,
  `${ARABIC_SHOW} S01 E01`,
  `${ARABIC_SHOW} S01 E02`,
];

/** The bidi marks the i18n runtime puts around arguments. */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

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

/** The grid's tiles as drawn: each one's title, poster and box. */
function readGrid(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid=series-grid]')!;
    const tiles = Array.prototype.slice.call(grid.querySelectorAll('.z-vgrid__item')) as HTMLElement[];
    return {
      tiles: tiles.map((t) => {
        const box = t.getBoundingClientRect();
        const img = t.querySelector('img');
        const subtitle = t.querySelector('.z-tile__subtitle');
        return {
          title: t.querySelector('.z-tile__title')!.textContent,
          subtitle: subtitle === null ? null : subtitle.textContent,
          poster: img === null ? null : img.getAttribute('src'),
          left: box.left,
          right: box.right,
        };
      }),
      box: grid.getBoundingClientRect().toJSON() as { left: number; right: number },
      rail: document.querySelector('[data-testid=series-rail]')!.getBoundingClientRect().toJSON() as { left: number; right: number },
    };
  });
}

/** The header's meta as read: its label and count, the marks taken out. */
async function meta(page: Page): Promise<string> {
  return ((await page.getByTestId('series-meta').textContent()) ?? '').replace(MARKS, '');
}

test.describe('the series screen (RELAY step 27a)', () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`a panel's shows by keys: "Recently updated", "All series", Back (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const asked: string[] = [];
      page.on('request', (request) => {
        const found = /\/images\/(series-\d+)\.png/.exec(request.url());
        if (found !== null) asked.push(found[1]!);
      });
      const says = SAYS[language];
      const forward = dir === 'rtl' ? 'LEFT' : 'RIGHT';
      const backward = dir === 'rtl' ? 'RIGHT' : 'LEFT';
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);

      // The header: "Guide", "Movies", "Series", "Settings", all four inside the header's end.
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await remote.go(forward, 'live/header/2');
      await expect(page.getByTestId('live-series')).toHaveText(says.header);
      const buttons = await page.locator('.live__end .z-button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { left: number; right: number; top: number }));
      expect(buttons).toHaveLength(4);
      for (const b of buttons) {
        expect(b.left).toBeGreaterThanOrEqual(96);
        expect(b.right).toBeLessThanOrEqual(1920 - 96);
        expect(b.top).toBe(buttons[0]!.top);
      }
      await page.screenshot({ path: path.join(SHOTS, `series-header-${locale}.png`), animations: 'disabled' });
      await remote.go('OK', 'series/grid/0');
      const screen = page.getByTestId('series-screen');
      await expect(screen).toHaveAttribute('data-status', 'ready');
      await expect(screen).toHaveAttribute('data-kind', 'series');
      await expect(screen).toHaveAttribute('data-language', language);
      await settled(screen);
      // Its title, and its own test ids: the rail, the grid and the tiles ("show-0"), none of the movies screen's.
      await expect(screen.locator('h1')).toHaveText(says.header);
      await expect(page.getByTestId('series-rail')).toBeVisible();
      await expect(page.getByTestId('show-0')).toHaveAttribute('data-state', 'focused');
      await expect(page.locator('[data-testid^=movie]')).toHaveCount(0);

      // The rail: "Recently updated", "All series", the panel's category; the screen on the first.
      await expect(page.locator('[data-testid^=series-chip-] .z-chip__label')).toHaveText([says.recent, says.all, GROUP]);
      await expect(screen).toHaveAttribute('data-category', '0');
      await expect(page.getByTestId('series-meta').locator('[data-n]')).toHaveAttribute('data-n', '2');
      expect(await meta(page)).toBe(`${says.recent} · ${says.shows}`);

      // The newest first: the Arabic show, then ours; each cover asked once, at the inline start.
      let grid = await readGrid(page);
      expect(grid.tiles.map((t) => t.title)).toEqual([ARABIC_SHOW, SHOW]);
      expect(grid.tiles.map((t) => t.subtitle)).toEqual([null, null]);
      expect(grid.tiles.map((t) => /series-\d+/.exec(t.poster ?? '')?.[0])).toEqual(['series-302', 'series-301']);
      expect(asked.slice().sort()).toEqual(['series-301', 'series-302']);
      if (dir === 'ltr') {
        expect(grid.tiles[0]!.left).toBeCloseTo(grid.box.left, 0);
        expect(grid.rail.right).toBeLessThan(grid.box.left);
      } else {
        expect(grid.tiles[0]!.right).toBeCloseTo(grid.box.right, 0);
        expect(grid.rail.left).toBeGreaterThan(grid.box.right);
      }
      await page.screenshot({ path: path.join(SHOTS, `series-${locale}.png`), animations: 'disabled' });

      // OK on a show: its details come with step 27b; nothing opens yet.
      await remote.go(forward, 'series/grid/1');
      await remote.press('OK');
      await remote.expectFocus('series/grid/1');

      // "All series": the panel's order.
      await remote.go(backward, 'series/grid/0');
      await remote.go(backward, 'series/rail/0');
      await remote.go('DOWN', 'series/rail/1');
      await remote.go('OK', 'series/grid/0');
      await expect(screen).toHaveAttribute('data-category', '1');
      await settled(screen);
      grid = await readGrid(page);
      expect(grid.tiles.map((t) => t.title)).toEqual([SHOW, ARABIC_SHOW]);
      expect(await meta(page)).toBe(`${says.all} · ${says.shows}`);
      // No cover asked twice.
      expect(asked.slice().sort()).toEqual(['series-301', 'series-302']);

      // Back: the rail on the entry on show, then the header on "Series".
      await remote.go('BACK', 'series/rail/1');
      await remote.go('BACK', 'live/header/2');
      await expect(screen).toHaveCount(0);
      await remote.go('DOWN', 'live/channels/0');
      expect(errors).toEqual([]);
    });
  }

  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`a playlist's episodes, one a tile, one played as a movie (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
      // The episodes' files reach the mock and are never answered: the player stays "Connecting…".
      const streams: string[] = [];
      page.on('request', (request) => {
        const url = request.url();
        if (url.indexOf('/series/') !== -1) streams.push(new URL(url).pathname);
      });
      await page.route('**/series/**', async (route) => {
        await route.fetch().catch(() => undefined);
      });
      const remote = new RemoteDriver(page);
      const live = await addM3uAndWatch(remote, `${host}/get.php?username=${U}&password=${P}&type=m3u_plus`, `locale=${locale}`);
      await settled(live);
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await remote.go(forward, 'live/header/2');
      await remote.go('OK', 'series/grid/0');
      const screen = page.getByTestId('series-screen');
      await expect(screen).toHaveAttribute('data-status', 'ready');
      await settled(screen);

      // No dates: no "Recently updated". Every line a tile, counted in episodes.
      await expect(page.locator('[data-testid^=series-chip-] .z-chip__label')).toHaveText([says.all, GROUP]);
      await expect(page.getByTestId('series-meta').locator('[data-n]')).toHaveAttribute('data-n', String(EPISODES.length));
      expect(await meta(page)).toBe(`${says.all} · ${says.episodes}`);
      const grid = await readGrid(page);
      expect(grid.tiles.map((t) => `${t.title} ${t.subtitle}`)).toEqual(EPISODES);
      expect(grid.tiles.map((t) => t.title)).toEqual([SHOW, SHOW, SHOW, SHOW, SHOW, ARABIC_SHOW, ARABIC_SHOW]);
      // The mark is never cut: the subtitle's text fits its box.
      const cut = await page.locator('[data-testid=series-grid] .z-tile__subtitle').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length);
      expect(cut).toBe(0);
      await page.screenshot({ path: path.join(SHOTS, `series-playlist-${locale}.png`), animations: 'disabled' });

      // OK: the episode's details, as a movie's (the line's facts), and "Play" asks for its file.
      await remote.go('OK', 'movie/actions/0');
      const details = page.getByTestId('movie-details');
      await expect(details).toHaveAttribute('data-language', language);
      await expect(page.getByTestId('movie-title')).toHaveText(EPISODES[0]!);
      await expect(page.getByTestId('movie-group')).toHaveText(GROUP);
      await remote.go('OK', 'player/seek/0');
      await expect(page.getByTestId('player-name')).toHaveText(EPISODES[0]!);
      await expect.poll(() => streams.length).toBeGreaterThan(0);
      expect(streams.every((s) => s === `/series/${U}/${P}/3001.mkv`)).toBe(true);

      // Back: the details, the grid on the episode, the rail, the header on "Series".
      await remote.go('BACK', 'movie/actions/0');
      await remote.go('BACK', 'series/grid/0');
      await remote.go('BACK', 'series/rail/0');
      await remote.go('BACK', 'live/header/2');
      expect(errors).toEqual([]);
    });
  }
});
