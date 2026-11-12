import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Auto-next (RELAY step 27c2) by keys, in English and Arabic, on "Lablo Test Series" (301).
 *
 * - **The countdown:** S2 E1 is left at 0:30 first. S1 E3 ends: its card says "The episode has
 *   ended", the show, "S1 E3 · Lip Sync", then "Next: S2 E1 · Return of the Bars" and "Starts in
 *   10 s", with "Play now" focused and "Back", every line on the card's start side. The profile
 *   has S1 E3 watched. About 10 s later S2 E1 plays in the same player (`/series/…/3011.mp4`)
 *   from 0:30, its line on the info bar, the seek bar focused.
 * - **Hidden, then "Play now":** S2 E1 ends; the app hiding takes the countdown away (the card
 *   stays, without it, once the app shows again); "Play now" plays S2 E2 at once.
 * - **The last:** S2 E2 (the show's last) ends: "The episode has ended" with "Back" alone; Back
 *   lands on it in the details.
 * - **"Back":** S2 E1 again, ended: the card's "Back", then the Back key, land on the next
 *   episode (S2 E2), S2 E1 being watched.
 *
 * The mock's media here is synthetic and its streams are held (the player stays "Connecting…"),
 * so an episode's end is an `ended` event on the stage's `<video>`: Html5Engine passes it on as
 * the stream's end. `e2e:media` plays a real episode to its end (player-media.spec.ts). The
 * screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const SHOW_KEY = 'x:s1:series:301';
const E3 = 'x:s1:episode:3003';
const S2E1 = 'x:s1:episode:3011';
const S2E2 = 'x:s1:episode:3012';

const SAYS = {
  en: {
    ended: 'The episode has ended',
    e3: 'S1 E3 · Lip Sync',
    next21: 'Next: S2 E1 · Return of the Bars',
    next22: 'Next: S2 E2 · Finale',
    s2e1: 'S2 E1 · Return of the Bars',
    s2e2: 'S2 E2 · Finale',
    countdown: /^Starts in (10|9) s$/,
    later: /^Starts in (8|7) s$/,
    playNow: 'Play now',
    back: 'Back',
  },
  ar: {
    ended: 'انتهت الحلقة',
    e3: 'م1 ح3 · Lip Sync',
    next21: 'التالي: م2 ح1 · Return of the Bars',
    next22: 'التالي: م2 ح2 · Finale',
    s2e1: 'م2 ح1 · Return of the Bars',
    s2e2: 'م2 ح2 · Finale',
    countdown: /^تبدأ خلال (10|9) ث$/,
    later: /^تبدأ خلال (8|7) ث$/,
    playNow: 'تشغيل الآن',
    back: 'رجوع',
  },
} as const;

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** An element's text without them. */
async function plain(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(MARKS, '');
}

type Kept = { progress?: Record<string, unknown>; shows?: Record<string, { episode: string; watched: boolean }>; v?: number };

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

/** The left and right of an element's text (its words, not its block). */
function textSpan(page: Page, testId: string): Promise<{ left: number; right: number }> {
  return page.getByTestId(testId).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
}

/** The page hidden or shown, as a TV hides the app (the browser platform reads `document.hidden`). */
function setHidden(page: Page, hidden: boolean): Promise<void> {
  return page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** The episode playing ends: the stage's `<video>` says so (its stream is held, so nothing else would). */
async function endEpisode(page: Page, key: string): Promise<void> {
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-movie', key);
  await expect(page.locator('#stage video')).toHaveCount(1);
  await page.locator('#stage video').dispatchEvent('ended');
  await expect(player).toHaveAttribute('data-state', 'ended');
}

/** From the live list: the header's "Series", the grid ("Recently updated": 302, then 301), and OK on 301. */
async function openShow(remote: RemoteDriver, forward: 'LEFT' | 'RIGHT', focus: string): Promise<void> {
  await remote.go('UP', 'live/header/0');
  await remote.go(forward, 'live/header/1');
  await remote.go(forward, 'live/header/2');
  await remote.go('OK', 'series/grid/0');
  await settled(remote.page.getByTestId('series-screen'));
  await remote.go(forward, 'series/grid/1');
  await remote.press('OK');
  await expect(remote.page.getByTestId('show-details')).toHaveAttribute('data-status', 'read');
  await remote.expectFocus(focus);
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

test.describe('auto-next (RELAY step 27c2)', () => {
  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`S1 E3's end starts S2 E1 after the countdown; "Play now", the last episode, "Back" (${locale})`, async ({ page }) => {
      test.setTimeout(150_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
      // The episodes' streams reach the mock and are never answered: the player stays "Connecting…".
      const asked: string[] = [];
      await page.route(`**/series/${U}/${P}/**`, async (route) => {
        asked.push(new URL(route.request().url()).pathname);
        await route.fetch().catch(() => undefined);
      });
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      await openShow(remote, forward, 'show/episodes/0');
      const player = page.getByTestId('player');
      const card = page.getByTestId('player-ended');

      // S2 E1 left at 0:30 (three RIGHTs: a new play from there).
      const backward = forward === 'RIGHT' ? 'LEFT' : 'RIGHT';
      await remote.go('UP', 'show/seasons/0');
      await remote.go(forward, 'show/seasons/1');
      await remote.go('DOWN', 'show/episodes/0');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', S2E1);
      for (let i = 0; i < 3; i += 1) await remote.press('RIGHT');
      await expect(player).toHaveAttribute('data-from', '30000');
      await remote.go('BACK', 'show/episodes/0');
      await expect(page.getByTestId('episode-0')).toHaveAttribute('data-resume', '30000');

      // S1 E3 plays, and ends: the card offers S2 E1 with "Play now" focused and the countdown.
      await remote.go('UP', 'show/seasons/1');
      await remote.go(backward, 'show/seasons/0');
      await remote.go('DOWN', 'show/episodes/0');
      await remote.go('DOWN', 'show/episodes/1');
      await remote.go('DOWN', 'show/episodes/2');
      await remote.go('OK', 'player/seek/0');
      await expect.poll(() => asked.includes(`/series/${U}/${P}/3003.mkv`)).toBe(true);
      await endEpisode(page, E3);
      const endedAt = Date.now();
      await remote.expectFocus('player/card/0');
      await expect(card.locator('.player__card-title')).toHaveText(says.ended);
      await expect(card).toContainText('Lablo Test Series');
      await expect.poll(() => plain(page, 'player-ended-episode')).toBe(says.e3);
      await expect.poll(() => plain(page, 'player-next-episode')).toBe(says.next21);
      expect(await plain(page, 'player-countdown')).toMatch(says.countdown);
      await expect(page.getByTestId('player-play-next')).toHaveText(says.playNow);
      await expect(page.getByTestId('player-movie-back')).toHaveText(says.back);
      // The focus drawn on "Play now" alone.
      await expect(page.getByTestId('player-play-next')).toHaveAttribute('data-state', 'focused');
      await expect(page.getByTestId('player-movie-back')).toHaveAttribute('data-state', 'idle');
      await expect(player).toHaveAttribute('data-next', S2E1);
      // Every line starts on the card's start side, the show's English name too (in Arabic, on the right).
      const lines = ['player-ended-name', 'player-ended-episode', 'player-next-episode', 'player-countdown'];
      const spans = await Promise.all(lines.map((id) => textSpan(page, id)));
      const edges = spans.map((s) => (language === 'ar' ? s.right : s.left));
      for (const edge of edges) expect(Math.abs(edge - edges[0]!), `${lines.join(', ')}: ${edges.join(', ')}`).toBeLessThanOrEqual(2);
      // The next episode's line stays one line (a long title ends in an ellipsis).
      expect(await page.getByTestId('player-next-episode').evaluate((el) => [getComputedStyle(el).whiteSpace, getComputedStyle(el).textOverflow, getComputedStyle(el).overflow])).toEqual(['nowrap', 'ellipsis', 'hidden']);
      await expect.poll(() => stored(page)).toMatchObject({ shows: { [SHOW_KEY]: { episode: E3, watched: true } } });
      await page.screenshot({ path: path.join(SHOTS, `auto-next-${locale}.png`), animations: 'disabled' });
      // The countdown goes down a second at a time.
      await expect(player).toHaveAttribute('data-countdown', '8', { timeout: 5_000 });
      await expect.poll(() => plain(page, 'player-countdown')).toMatch(says.later);

      // Its end: S2 E1 in the same player, from where it was left, its line on the info bar, the seek bar focused.
      await expect(player).toHaveAttribute('data-movie', S2E1, { timeout: 15_000 });
      expect(Date.now() - endedAt).toBeGreaterThanOrEqual(9_000);
      await expect(player).toHaveAttribute('data-from', '30000');
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:30');
      await expect(player).toHaveAttribute('data-next', '');
      await expect(card).toHaveCount(0);
      await remote.expectFocus('player/seek/0');
      await expect.poll(() => plain(page, 'player-episode')).toBe(says.s2e1);
      await expect.poll(() => asked.includes(`/series/${U}/${P}/3011.mp4`)).toBe(true);
      await expect(page.getByTestId('player-length')).toHaveText('4:00');
      await page.screenshot({ path: path.join(SHOTS, `auto-next-played-${locale}.png`), animations: 'disabled' });

      // S2 E1 ends; the app hides: no countdown, then or once it shows again. "Play now" plays S2 E2 at once.
      await endEpisode(page, S2E1);
      await remote.expectFocus('player/card/0');
      await expect.poll(() => plain(page, 'player-next-episode')).toBe(says.next22);
      await expect(page.getByTestId('player-countdown')).toHaveCount(1);
      await setHidden(page, true);
      await expect(player).toHaveAttribute('data-countdown', '');
      await expect(page.getByTestId('player-countdown')).toHaveCount(0);
      await setHidden(page, false);
      await expect(player).toHaveAttribute('data-next', S2E2);
      await expect(page.getByTestId('player-countdown')).toHaveCount(0);
      await expect(card).toBeVisible();
      await remote.expectFocus('player/card/0');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', S2E2);
      await expect(player).toHaveAttribute('data-countdown', '');
      await expect.poll(() => plain(page, 'player-episode')).toBe(says.s2e2);
      await expect.poll(() => asked.includes(`/series/${U}/${P}/3012.mp4`)).toBe(true);

      // S2 E2, the show's last, ends: "The episode has ended" with "Back" alone; it lands on S2 E2.
      await endEpisode(page, S2E2);
      await remote.expectFocus('player/card/0');
      await expect(card.locator('.player__card-title')).toHaveText(says.ended);
      await expect(page.getByTestId('player-next-episode')).toHaveCount(0);
      await expect(page.getByTestId('player-countdown')).toHaveCount(0);
      await expect(page.getByTestId('player-play-next')).toHaveCount(0);
      await expect(page.getByTestId('player-movie-back')).toHaveAttribute('data-state', 'focused');
      await expect(player).toHaveAttribute('data-next', '');
      await page.screenshot({ path: path.join(SHOTS, `auto-next-last-${locale}.png`), animations: 'disabled' });
      await remote.go('OK', 'show/episodes/1');
      const details = page.getByTestId('show-details');
      await expect(details).toHaveAttribute('data-season', '1');
      await expect(page.getByTestId('episode-1')).toHaveAttribute('data-key', /:episode:3012$/);
      await expect.poll(() => stored(page)).toMatchObject({ shows: { [SHOW_KEY]: { episode: S2E2, watched: true } } });

      // S2 E1 again, ended: the card's "Back" lands on S2 E2 (S2 E1 is watched); so does the Back key.
      for (const leave of ['button', 'key'] as const) {
        await remote.go('UP', 'show/episodes/0');
        await remote.go('OK', 'player/seek/0');
        await endEpisode(page, S2E1);
        await remote.expectFocus('player/card/0');
        await expect(player).toHaveAttribute('data-next', S2E2);
        if (leave === 'button') {
          await remote.go(forward, 'player/card/1');
          await expect(page.getByTestId('player-movie-back')).toHaveAttribute('data-state', 'focused');
          await expect(page.getByTestId('player-play-next')).toHaveAttribute('data-state', 'idle');
          await remote.go('OK', 'show/episodes/1');
        } else {
          await remote.go('BACK', 'show/episodes/1');
        }
        await expect(details).toHaveAttribute('data-season', '1');
        await expect.poll(() => stored(page)).toMatchObject({ shows: { [SHOW_KEY]: { episode: S2E1, watched: true } } });
        await expect(player).toHaveCount(0);
      }
      await remote.go('UP', 'show/episodes/0');
      await remote.go('UP', 'show/seasons/1');
      await remote.go('BACK', 'series/grid/1');
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
