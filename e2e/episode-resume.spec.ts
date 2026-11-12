import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Playing a show's episode and resuming it (RELAY step 27c1) by keys, in English and Arabic.
 * "Lablo Test Series" (301) opens on its first episode. OK on S1 E2 plays it: the player asks
 * for `/series/…/3002.mkv`, and its info bar names the show and "S1 E2 · Tone and Clock". Four
 * RIGHTs move it to 0:40 (a new play from there: no picture to seek inside). Back returns to the
 * details on that episode: its row says "Resume from 0:40" in its plot's place and draws its bar
 * (40/300) from the inline start, and the profile (version 6) holds its place and the show's last
 * episode. OK resumes it from 0:40. The show opens again on it, and so does a relaunch. S1 E3
 * played to 4:50 (FF stops 10 s before the end) is watched: its place goes, and Back lands on the
 * next episode, season 2's first, the seasons' row on season 2.
 *
 * The episodes' streams reach the mock and are never answered (the route holds them), so the
 * player stays "Connecting…": the mock's media here is synthetic. `e2e:media` resumes a real
 * episode inside its file (player-media.spec.ts). The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const SHOW_KEY = 'x:s1:series:301';
const E2 = 'x:s1:episode:3002';
const E3 = 'x:s1:episode:3003';
const LEFT_MS = 40_000;
const LENGTH_MS = 300_000;

const SAYS = {
  en: { mark2: 'S1 E2 · Tone and Clock', mark3: 'S1 E3 · Lip Sync', resume: 'Resume from 0:40' },
  ar: { mark2: 'م1 ح2 · Tone and Clock', mark3: 'م1 ح3 · Lip Sync', resume: 'استئناف من 0:40' },
} as const;

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** An element's text without them. */
async function plain(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(MARKS, '');
}

type Kept = { progress?: Record<string, { positionMs: number; lengthMs: number | null }>; shows?: Record<string, { episode: string; watched: boolean }>; v?: number };

/** The profile's version, places and shows' last episodes. */
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

/** The bar on episode row `index`: its share in percent and its fill's box (`null`: no bar). */
async function rowBar(page: Page, index: number): Promise<{ pct: number; fill: { x: number; width: number }; track: { x: number; width: number } } | null> {
  const bar = page.getByTestId(`episode-${index}`).locator('.show__episode-progress');
  if ((await bar.count()) === 0) return null;
  const fill = (await bar.locator('.z-progress__fill').boundingBox())!;
  const track = (await bar.boundingBox())!;
  return { pct: Number(await bar.getAttribute('aria-valuenow')), fill: { x: fill.x, width: fill.width }, track: { x: track.x, width: track.width } };
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

test.describe("playing a show's episode, and resuming it (RELAY step 27c1)", () => {
  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`play, leave at 0:40, the row's bar, resume, a relaunch, a watched episode (${locale})`, async ({ page }) => {
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
      const details = page.getByTestId('show-details');
      // Never played: no place, no bar, the plot in its place.
      for (let i = 0; i < 3; i += 1) {
        await expect(page.getByTestId(`episode-${i}`)).toHaveAttribute('data-resume', '');
        expect(await rowBar(page, i)).toBeNull();
      }

      // OK on S1 E2: the player, its stream asked, the show and the episode on the info bar.
      await remote.go('DOWN', 'show/episodes/1');
      await remote.go('OK', 'player/seek/0');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-movie', E2);
      await expect(player).toHaveAttribute('data-from', '0');
      await expect(player).toHaveAttribute('data-length', String(LENGTH_MS));
      await expect(player).toHaveAttribute('data-state', 'opening');
      await expect(page.getByTestId('player-name')).toHaveText('Lablo Test Series');
      await expect.poll(() => plain(page, 'player-episode')).toBe(says.mark2);
      await expect(page.getByTestId('player-length')).toHaveText('5:00');
      await expect.poll(() => asked.length).toBeGreaterThan(0);
      expect(asked.every((s) => s === `/series/${U}/${P}/3002.mkv`)).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `episode-player-${locale}.png`), animations: 'disabled' });

      // Four RIGHTs: 0:40, and one new play from there once the keys rest.
      const seek = page.getByTestId('player-seek');
      for (let i = 0; i < 4; i += 1) await remote.press('RIGHT');
      await expect(seek).toHaveAttribute('data-at', String(LEFT_MS));
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(seek).toHaveAttribute('data-seeking', 'false');

      // Back: the details on that episode, "Resume from 0:40" in its plot's place, its bar.
      await remote.go('BACK', 'show/episodes/1');
      const row = page.getByTestId('episode-1');
      await expect(row).toHaveAttribute('data-resume', String(LEFT_MS));
      await expect.poll(() => plain(page, 'episode-resume-1')).toBe(says.resume);
      await expect(row.locator('.show__episode-plot')).toHaveCount(0);
      await expect(page.getByTestId('episode-0')).toHaveAttribute('data-resume', '');
      await expect.poll(async () => (await rowBar(page, 1))?.pct).toBe(13.3);
      const bar = (await rowBar(page, 1))!;
      expect(bar.fill.width / bar.track.width).toBeCloseTo(LEFT_MS / LENGTH_MS, 2);
      if (language === 'ar') expect(bar.fill.x + bar.fill.width).toBeCloseTo(bar.track.x + bar.track.width, 0);
      else expect(bar.fill.x).toBeCloseTo(bar.track.x, 0);
      // The bar along the row's bottom, inside it.
      const box = (await row.boundingBox())!;
      const track = (await row.locator('.show__episode-progress').boundingBox())!;
      expect(track.y + track.height).toBeLessThanOrEqual(box.y + box.height);
      expect(track.y + track.height).toBeGreaterThan(box.y + box.height - 8);
      expect(await rowBar(page, 0)).toBeNull();
      // The profile, version 6: the episode's place and the show's last episode.
      await expect
        .poll(() => stored(page))
        .toMatchObject({
          v: 6,
          progress: { [E2]: { positionMs: LEFT_MS, lengthMs: LENGTH_MS } },
          shows: { [SHOW_KEY]: { episode: E2, watched: false } },
        });
      await page.screenshot({ path: path.join(SHOTS, `episode-resume-${locale}.png`), animations: 'disabled' });

      // OK resumes it from 0:40.
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', E2);
      await expect(player).toHaveAttribute('data-from', String(LEFT_MS));
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:40');
      await remote.go('BACK', 'show/episodes/1');

      // Closed and opened again (the answer kept): on the show's last episode.
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'series/grid/1');
      await remote.go('OK', 'show/episodes/1');
      await expect(details).toHaveAttribute('data-season', '0');

      // A relaunch keeps it all.
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'series/grid/1');
      await remote.go('BACK', 'series/rail/0');
      await remote.go('BACK', 'live/header/2');
      await page.reload();
      await settled(page.getByTestId('live'));
      await remote.expectFocus('live/channels/0');
      await openShow(remote, forward, 'show/episodes/1');
      await expect(page.getByTestId('episode-1')).toHaveAttribute('data-resume', String(LEFT_MS));
      await expect.poll(async () => (await rowBar(page, 1))?.pct).toBe(13.3);

      // S1 E3 to 4:50 (FF stops 10 s before its end): watched. Back lands on season 2's first.
      await remote.go('DOWN', 'show/episodes/2');
      await remote.go('OK', 'player/seek/0');
      await expect(player).toHaveAttribute('data-movie', E3);
      await expect.poll(() => plain(page, 'player-episode')).toBe(says.mark3);
      await remote.press('FF');
      await expect(player).toHaveAttribute('data-from', String(LENGTH_MS - 10_000));
      await remote.go('BACK', 'show/episodes/0');
      await expect(details).toHaveAttribute('data-season', '1');
      await expect(page.getByTestId('episode-0')).toHaveAttribute('data-key', /:episode:3011$/);
      await expect.poll(() => stored(page)).toMatchObject({ shows: { [SHOW_KEY]: { episode: E3, watched: true } } });
      const kept = (await stored(page))!;
      expect(Object.keys(kept.progress!)).toEqual([E2]);
      await remote.go('UP', 'show/seasons/1');
      await remote.go('BACK', 'series/grid/1');
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
