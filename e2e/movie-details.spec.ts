import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * A movie's details and playing it (RELAY step 26c) by keys, in English and Arabic. OK on Big Buck
 * Bunny's poster opens its details: the poster, the title and the category at once, a spinner
 * while the panel's `get_vod_info` is out (the mock holds it), then the year, the length, the
 * rating, the genre and the plot. "Play" asks the mock for `/movie/…/201.mp4` (its
 * `container_extension`); the info bar shows the movie and its length; three RIGHTs move the seek
 * bar 30 s on, and the movie plays again from there once the keys rest (no picture to seek
 * inside). CH+ and a digit do nothing. Back returns to the details, and Back again to the grid.
 * Sintel's read fails (the mock answers 503): its details say so and keep the catalog's facts,
 * and "Play" asks for its `.mkv`. Big Buck Bunny's details open again from the 24 h cache, with
 * no second read.
 *
 * The movies' answers reach the mock but never the page (the route holds them), so the player
 * stays "Connecting…" and the keys stay the seek bar's: the mock's media here is synthetic, and a
 * failed stream's card would take them. `e2e:media` plays a real film and seeks inside it
 * (player-media.spec.ts). The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const SAYS = {
  en: { facts: '2008 · 10 min · Rated 7.5/10', failed: "Couldn't read more about this movie.", play: 'Play', back: 'Back' },
  ar: { facts: '2008 · 10 د · التقييم 7.5/10', failed: 'تعذّرت قراءة المزيد عن هذا الفيلم.', play: 'تشغيل', back: 'رجوع' },
} as const;

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** An element's text without them. */
async function plain(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(MARKS, '');
}

let app: MockServer;
let host: string;
/** Each `get_vod_info` the mock was asked, by its `vod_id`. */
const infoAsked: string[] = [];
/** Ids whose `get_vod_info` waits for `release`, and ids it fails with a 503. */
const held = new Set<string>();
const failing = new Set<string>(['202']);
let release: () => void = () => undefined;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  app.addHook('onRequest', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.action !== 'get_vod_info') return;
    const id = query.vod_id ?? '';
    infoAsked.push(id);
    if (held.has(id)) await new Promise<void>((resolve) => (release = resolve));
    if (failing.has(id)) await reply.code(503).send('busy');
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

test.describe("a movie's details and playing it (RELAY step 26c)", () => {
  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`details from the panel, "Play", a seek, Back (${locale})`, async ({ page }) => {
      test.setTimeout(120_000);
      infoAsked.length = 0;
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
      // The movies' streams reach the mock and are never answered: the player stays "Connecting…".
      const streams: string[] = [];
      page.on('request', (request) => {
        const url = request.url();
        if (url.indexOf('/movie/') !== -1) streams.push(new URL(url).pathname);
      });
      await page.route('**/movie/**', async (route) => {
        await route.fetch().catch(() => undefined);
      });
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await remote.go('OK', 'movies/grid/0');
      await settled(page.getByTestId('movies-screen'));

      // Big Buck Bunny: the catalog's facts at once and a spinner while the panel's read is held.
      held.add('201');
      await remote.go('OK', 'movie/actions/0');
      const details = page.getByTestId('movie-details');
      await expect(details).toHaveAttribute('data-status', 'reading');
      await expect(details).toHaveAttribute('data-language', language);
      await expect(page.getByTestId('movie-spinner')).toBeVisible();
      await expect(page.getByTestId('movie-title')).toHaveText('Big Buck Bunny');
      await expect(page.getByTestId('movie-group')).toHaveText('Open Movies | أفلام مفتوحة');
      await expect(page.getByTestId('movie-poster').locator('img')).toHaveAttribute('src', /\/images\/movie-201\.png$/);
      await expect(page.getByTestId('movie-facts')).toHaveCount(0);
      await expect(page.getByTestId('movie-play')).toHaveText(says.play);
      await expect(page.getByTestId('movie-back')).toHaveText(says.back);
      held.delete('201');
      release();
      await expect(details).toHaveAttribute('data-status', 'read');
      await expect(details).toHaveAttribute('data-pending', '0');
      await expect(page.getByTestId('movie-spinner')).toHaveCount(0);
      await expect.poll(() => plain(page, 'movie-facts')).toBe(says.facts);
      await expect(page.getByTestId('movie-genre')).toHaveText('Animation');
      await expect(page.getByTestId('movie-plot')).toHaveText(/^A giant rabbit takes on three bullies\./);
      expect(infoAsked).toEqual(['201']);
      // The poster at the inline start, the text beside it.
      const poster = (await page.getByTestId('movie-poster').boundingBox())!;
      const title = (await page.getByTestId('movie-title').boundingBox())!;
      if (language === 'ar') expect(poster.x).toBeGreaterThan(title.x + title.width);
      else expect(poster.x + poster.width).toBeLessThan(title.x);
      await page.screenshot({ path: path.join(SHOTS, `movie-details-${locale}.png`), animations: 'disabled' });

      // "Play": the movie's own URL with its extension; the info bar shows it and its length.
      await remote.go('OK', 'player/seek/0');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-movie', /:movie:201$/);
      await expect(player).toHaveAttribute('data-length', String(596_000));
      await expect.poll(() => streams.length).toBeGreaterThan(0);
      expect(streams.every((s) => s === `/movie/${U}/${P}/201.mp4`)).toBe(true);
      await expect(page.getByTestId('player-name')).toHaveText('Big Buck Bunny');
      await expect(player).toHaveAttribute('data-state', 'opening');
      await expect(page.getByTestId('player-wait')).toBeVisible();
      await expect(page.getByTestId('player-length')).toHaveText('9:56');
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:00');
      await expect(page.getByTestId('player-previous')).toHaveCount(0);
      await expect(page.getByTestId('player-aired')).toHaveCount(0);
      // Three RIGHTs: 30 s on (left to right in both languages), one new play from there once the keys rest.
      const plays = Number(await player.getAttribute('data-plays'));
      const seek = page.getByTestId('player-seek');
      await remote.press('RIGHT');
      await remote.press('RIGHT');
      await remote.press('RIGHT');
      await expect(seek).toHaveAttribute('data-at', String(30_000));
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:30');
      await expect(player).toHaveAttribute('data-plays', String(plays + 1));
      await expect(seek).toHaveAttribute('data-seeking', 'false');
      await expect(seek).toHaveAttribute('data-at', String(30_000));
      await page.screenshot({ path: path.join(SHOTS, `movie-player-${locale}.png`), animations: 'disabled' });
      // CH+ and a digit do nothing in a movie.
      await remote.press('CH_UP');
      await remote.press('DIGIT_5');
      await page.waitForTimeout(800);
      await expect(player).toHaveAttribute('data-plays', String(plays + 1));
      await expect(player).toHaveAttribute('data-entry', '');
      await expect(player).toHaveAttribute('data-movie', /:movie:201$/);

      // Back: the details as they were; Back again: the grid on the movie.
      await remote.go('BACK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-status', 'read');
      await remote.go('BACK', 'movies/grid/0');

      // Sintel's read fails: the catalog's facts and a note; "Play" asks for its .mkv.
      await remote.go(forward, 'movies/grid/1');
      await remote.go('OK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-status', 'failed');
      await expect(page.getByTestId('movie-title')).toHaveText('Sintel');
      await expect(page.getByTestId('movie-failed')).toHaveText(says.failed);
      await expect(page.getByTestId('movie-facts')).toHaveCount(0);
      await expect(page.getByTestId('movie-plot')).toHaveCount(0);
      const before = streams.length;
      await remote.go('OK', 'player/seek/0');
      await expect.poll(() => streams.length).toBeGreaterThan(before);
      expect(streams.slice(before).every((s) => s === `/movie/${U}/${P}/202.mkv`)).toBe(true);
      await expect(page.getByTestId('player-length')).toHaveText('');
      await remote.go('BACK', 'movie/actions/0');
      await remote.go('BACK', 'movies/grid/1');

      // Big Buck Bunny again: from the 24 h cache, no second read.
      await remote.go(language === 'ar' ? 'RIGHT' : 'LEFT', 'movies/grid/0');
      await remote.go('OK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-status', 'read');
      await expect.poll(() => plain(page, 'movie-facts')).toBe(says.facts);
      expect(infoAsked).toEqual(['201', '202']);
      await remote.go('BACK', 'movies/grid/0');
      await remote.go('BACK', 'movies/rail/0');
      await remote.go('BACK', 'live/header/1');
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
