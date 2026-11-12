import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Resume (RELAY step 26d) by keys, in English and Arabic. Big Buck Bunny (596 s) plays from its
 * details; FF and three RIGHTs move it to 5:30, and the movie plays again from there (no picture
 * to seek inside). Back keeps that place: the details offer "Resume from 5:30" first (focused),
 * then "Play from the start" and "Back"; the profile holds it; the grid's tile draws its bar at
 * 55.4 % from the inline start. "Resume" asks the player for the stream from 5:30 (within 5 s of
 * where it was left). A relaunch keeps it all; "Resume" pressed there while the panel's
 * `get_vod_info` is still out (the mock holds it) plays with the length kept with the place, and
 * keeps it. A RIGHT moves it to 5:40, and the app hiding (the page's `visibilitychange`) keeps
 * that place while the player is still open. "Play from the
 * start" asks from 0:00, and leaving before 10 s takes the place away: "Play" again, and no bar.
 *
 * The movies' answers reach the mock but never the page (the route holds them), so the player
 * stays "Connecting…" and the place it was left is the one asked: the mock's media here is
 * synthetic. `e2e:media` resumes a real film inside its file (player-media.spec.ts). The
 * screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const BBB = 'x:s1:movie:201';
const LEFT_MS = 330_000;
const LENGTH_MS = 596_000;

const SAYS = {
  en: { resume: 'Resume from 5:30', restart: 'Play from the start', play: 'Play', back: 'Back' },
  ar: { resume: 'استئناف من 5:30', restart: 'التشغيل من البداية', play: 'تشغيل', back: 'رجوع' },
} as const;

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** An element's text without them. */
async function plain(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(MARKS, '');
}

/** The movies' positions the profile holds (`undefined`: none yet). */
function storedProgress(page: Page): Promise<Record<string, { positionMs: number; lengthMs: number | null }> | undefined> {
  return page.evaluate(
    () =>
      new Promise<Record<string, { positionMs: number; lengthMs: number | null }> | undefined>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { doc: { progress?: Record<string, { positionMs: number; lengthMs: number | null }> } } | undefined)?.doc.progress);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The bar on tile `index` of the grid: its share in percent and its fill's box (`null`: no bar). */
async function tileBar(page: Page, index: number): Promise<{ pct: number; fill: { x: number; width: number }; track: { x: number; width: number } } | null> {
  const bar = page.getByTestId(`movie-${index}`).locator('.z-tile__progress');
  if ((await bar.count()) === 0) return null;
  const fill = (await bar.locator('.z-progress__fill').boundingBox())!;
  const track = (await bar.boundingBox())!;
  return { pct: Number(await bar.getAttribute('aria-valuenow')), fill: { x: fill.x, width: fill.width }, track: { x: track.x, width: track.width } };
}

/** The page hidden or shown, as a TV hides the app (the browser platform reads `document.hidden`). */
function setHidden(page: Page, hidden: boolean): Promise<void> {
  return page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** From the live list: the header's "Movies", the grid on its first poster. */
async function openMovies(remote: RemoteDriver, forward: 'LEFT' | 'RIGHT'): Promise<void> {
  await remote.go('UP', 'live/header/0');
  await remote.go(forward, 'live/header/1');
  await remote.go('OK', 'movies/grid/0');
  await settled(remote.page.getByTestId('movies-screen'));
}

let app: MockServer;
let host: string;
/** `get_vod_info` waits for `release` while `holding` is set. */
let holding = false;
let release: () => void = () => undefined;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  app.addHook('onRequest', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.action === 'get_vod_info' && holding) await new Promise<void>((resolve) => (release = resolve));
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

test.describe('resume a movie (RELAY step 26d)', () => {
  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`leave at 5:30, "Resume from 5:30", the tile's bar, a relaunch (${locale})`, async ({ page }) => {
      test.setTimeout(150_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
      // The movies' streams reach the mock and are never answered: the player stays "Connecting…".
      await page.route('**/movie/**', async (route) => {
        await route.fetch().catch(() => undefined);
      });
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      await openMovies(remote, forward);
      expect(await tileBar(page, 0)).toBeNull();

      // Never played: "Play" and "Back".
      await remote.go('OK', 'movie/actions/0');
      const details = page.getByTestId('movie-details');
      await expect(details).toHaveAttribute('data-status', 'read');
      await expect(details).toHaveAttribute('data-resume', '');
      await expect(page.getByTestId('movie-play')).toHaveText(says.play);
      await expect(page.getByTestId('movie-resume')).toHaveCount(0);

      // "Play", then FF and three RIGHTs: 5:30, and one new play from there once the keys rest.
      await remote.go('OK', 'player/seek/0');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-movie', BBB);
      await expect(player).toHaveAttribute('data-from', '0');
      const seek = page.getByTestId('player-seek');
      await remote.press('FF');
      await remote.press('RIGHT');
      await remote.press('RIGHT');
      await remote.press('RIGHT');
      await expect(seek).toHaveAttribute('data-at', String(LEFT_MS));
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(seek).toHaveAttribute('data-seeking', 'false');
      await expect(player).toHaveAttribute('data-state', 'opening');

      // Back: the details offer "Resume from 5:30" first, focused; the profile holds the place.
      await remote.go('BACK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-resume', String(LEFT_MS));
      await expect.poll(() => plain(page, 'movie-resume')).toBe(says.resume);
      await expect(page.getByTestId('movie-play')).toHaveText(says.restart);
      await expect(page.getByTestId('movie-back')).toHaveText(says.back);
      await expect(page.getByTestId('movie-resume')).toHaveAttribute('data-state', 'focused');
      await expect.poll(() => storedProgress(page)).toEqual({ [BBB]: { positionMs: LEFT_MS, lengthMs: LENGTH_MS, updated: expect.any(Number) } });
      // The three buttons on one row, from the inline start, inside the text column.
      const boxes = [];
      for (const id of ['movie-resume', 'movie-play', 'movie-back']) boxes.push((await page.getByTestId(id).boundingBox())!);
      for (const box of boxes) expect(box.y).toBe(boxes[0]!.y);
      if (language === 'ar') for (let i = 1; i < 3; i += 1) expect(boxes[i]!.x + boxes[i]!.width).toBeLessThan(boxes[i - 1]!.x);
      else for (let i = 1; i < 3; i += 1) expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x + boxes[i - 1]!.width);
      const poster = (await page.getByTestId('movie-poster').boundingBox())!;
      for (const box of boxes) {
        if (language === 'ar') expect(box.x + box.width).toBeLessThan(poster.x);
        else expect(box.x).toBeGreaterThan(poster.x + poster.width);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1920);
      }
      await page.screenshot({ path: path.join(SHOTS, `movie-resume-${locale}.png`), animations: 'disabled' });

      // The grid: Big Buck Bunny's tile draws 330/596 of its bar, from the inline start.
      await remote.go('BACK', 'movies/grid/0');
      await expect.poll(async () => (await tileBar(page, 0))?.pct).toBe(55.4);
      const bar = (await tileBar(page, 0))!;
      expect(bar.fill.width / bar.track.width).toBeCloseTo(LEFT_MS / LENGTH_MS, 2);
      if (language === 'ar') expect(bar.fill.x + bar.fill.width).toBeCloseTo(bar.track.x + bar.track.width, 0);
      else expect(bar.fill.x).toBeCloseTo(bar.track.x, 0);
      expect(await tileBar(page, 1)).toBeNull();
      await page.screenshot({ path: path.join(SHOTS, `movie-resume-grid-${locale}.png`), animations: 'disabled' });

      // "Resume": the player asks the stream from where it was left (within 5 s), the bar there.
      await remote.go('OK', 'movie/actions/0');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', BBB);
      const from = Number(await player.getAttribute('data-from'));
      expect(Math.abs(from - LEFT_MS)).toBeLessThanOrEqual(5_000);
      await expect(seek).toHaveAttribute('data-at', String(LEFT_MS));
      await expect(page.getByTestId('player-elapsed')).toHaveText('5:30');
      await remote.go('BACK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-resume', String(LEFT_MS));
      await expect.poll(() => storedProgress(page)).toEqual({ [BBB]: { positionMs: LEFT_MS, lengthMs: LENGTH_MS, updated: expect.any(Number) } });

      // A relaunch keeps it: the tile's bar, and "Resume from 5:30" first. (Back from the grid: the
      // rail on "Recently added", under "Continue watching" since step 27d.)
      await remote.go('BACK', 'movies/grid/0');
      await remote.go('BACK', 'movies/rail/1');
      await remote.go('BACK', 'live/header/1');
      await page.reload();
      await settled(page.getByTestId('live'));
      await remote.expectFocus('live/channels/0');
      // (It opens on "Continue watching" since step 27d: Big Buck Bunny alone.)
      await openMovies(remote, forward);
      await expect(page.getByTestId('movies-screen')).toHaveAttribute('data-category', '0');
      await expect(page.getByTestId('movie-1')).toHaveCount(0);
      await expect.poll(async () => (await tileBar(page, 0))?.pct).toBe(55.4);
      // The panel's read held (a new start asks it again): "Resume" before it comes back.
      holding = true;
      await remote.go('OK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-status', 'reading');
      await expect(details).toHaveAttribute('data-resume', String(LEFT_MS));
      await expect.poll(() => plain(page, 'movie-resume')).toBe(says.resume);
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      // The length kept with the place: the bar's, and kept again.
      await expect(player).toHaveAttribute('data-length', String(LENGTH_MS));
      await expect(page.getByTestId('player-length')).toHaveText('9:56');

      // A RIGHT: 5:40. The app hides with the player open: that place is kept at once.
      await remote.press('RIGHT');
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS + 10_000));
      const before = await storedProgress(page);
      expect(before?.[BBB]?.positionMs).toBe(LEFT_MS);
      await setHidden(page, true);
      await expect.poll(async () => (await storedProgress(page))?.[BBB]?.positionMs).toBe(LEFT_MS + 10_000);
      await setHidden(page, false);
      await remote.go('BACK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-resume', String(LEFT_MS + 10_000));
      await expect.poll(() => storedProgress(page)).toEqual({ [BBB]: { positionMs: LEFT_MS + 10_000, lengthMs: LENGTH_MS, updated: expect.any(Number) } });
      holding = false;
      release();
      await expect(details).toHaveAttribute('data-status', 'read');

      // "Play from the start": from 0:00; left at once, the place goes (it starts over).
      await remote.go(forward, 'movie/actions/1');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-from', '0');
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:00');
      await remote.go('BACK', 'movie/actions/0');
      await expect(details).toHaveAttribute('data-resume', '');
      await expect(page.getByTestId('movie-resume')).toHaveCount(0);
      await expect(page.getByTestId('movie-play')).toHaveText(says.play);
      await expect.poll(() => storedProgress(page)).toEqual({});
      await remote.go('BACK', 'movies/grid/0');
      expect(await tileBar(page, 0)).toBeNull();
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
