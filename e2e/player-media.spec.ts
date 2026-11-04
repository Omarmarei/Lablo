import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { parseScenario } from '../apps/mock-provider/src/faults';
import { FileMedia } from '../apps/mock-provider/src/file-media';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The player in the app on the generated media (RELAY step 20a; `pnpm e2e:media`, in
 * `pnpm verify:media`, CI job `media`): OK on a live channel plays it full screen through the
 * browser platform's Html5Engine (desktop Chromium refuses the `.ts` form, the `.m3u8` plays and
 * is remembered), a zap plays the next one, and when the mock breaks the stream's segments the
 * player retries under the "Reconnecting…" badge (no error card) until the stream comes back.
 * The picture goes black meanwhile: Html5Engine closes the connection before each reopen (the
 * last frame kept on screen is later work).
 *
 * The track menu (RELAY step 20b) on the multi-audio MKV: the UI's language chosen as the tracks
 * appear, a pick from the menu, and the channel's choice kept across a zap. `audioTracks` is
 * behind a Blink flag on the desktop (webOS ships it), turned on here.
 */
const MEDIA_DIR = path.resolve(import.meta.dirname, '../.cache/media');
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

test.use({ launchOptions: { args: ['--enable-blink-features=AudioVideoTracks'] } });

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  expect(existsSync(path.join(MEDIA_DIR, 'manifest.json')), `no generated media in ${MEDIA_DIR}: run pnpm mock:media first`).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  // The real clock: live streams sit on the epoch timeline.
  app = await mock({ now: Date.now, media: new FileMedia({ dir: MEDIA_DIR }) });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

/** The stage's `<video>`: its clock and picture. */
function video(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector('#stage video') as HTMLVideoElement | null;
    return v === null ? null : { time: v.currentTime, width: v.videoWidth, height: v.videoHeight, paused: v.paused };
  });
}

async function expectMoving(page: Page): Promise<void> {
  const before = await video(page);
  await page.waitForTimeout(1500);
  const after = await video(page);
  expect(before?.width ?? 0).toBeGreaterThan(0);
  expect((after?.time ?? 0) - (before?.time ?? 0), 'the picture moves').toBeGreaterThan(0.5);
}

test('plays a live channel in the app, zaps to the next, and shows "Reconnecting…" through a broken stream until it comes back', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'hls');
  await expectMoving(page);
  // The bar goes 5 s after the last key once the picture shows.
  await expect(player).toHaveAttribute('data-info', 'false', { timeout: 10_000 });
  await remote.press('INFO');
  await expect(page.getByTestId('player-bar')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'player-live-en.png'), animations: 'disabled' });

  // CH+: the next channel, straight to HLS (remembered for the source).
  await remote.press('CH_UP');
  await expect(player).toHaveAttribute('data-playing', '1');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'hls');
  await expectMoving(page);

  // The panel stops serving the stream's segments: the player retries with the badge up.
  app.mockState.scenario = parseScenario({ description: 'Segments fail', rules: [{ match: { path: '/hls/**' }, faults: [{ type: 'status', status: 503 }] }] }, 'broken-segments');
  await expect(player).toHaveAttribute('data-state', 'reconnecting', { timeout: 60_000 });
  await expect(page.getByTestId('player-reconnecting')).toBeVisible();
  await expect(page.getByTestId('player-card')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'player-reconnecting-en.png'), animations: 'disabled' });
  // It comes back before the player gives up.
  app.mockState.scenario = null;
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 40_000 });
  await expect(page.getByTestId('player-reconnecting')).toHaveCount(0);
  await expectMoving(page);

  await remote.press('BACK');
  await remote.expectFocus('live/channels/1');
  // Stopped: the stage's element holds no source.
  expect(await page.evaluate(() => (document.querySelector('#stage video') as HTMLVideoElement).getAttribute('src'))).toBeNull();
  // The failed segments are logged by the browser.
  expect(errors.filter((e) => e.indexOf('status of 503') === -1)).toEqual([]);
});

/** The stage's `<video>`: which of its audio tracks plays (the Blink flag lists them). */
function enabledAudio(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector('#stage video') as (HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean; language: string } } }) | null;
    const list = v?.audioTracks;
    if (list === undefined) return null;
    const out: string[] = [];
    for (let i = 0; i < list.length; i += 1) if (list[i]!.enabled) out.push(list[i]!.language);
    return out;
  });
}

test("the audio menu on a stream with three languages: the UI's language first, a pick from the menu, remembered for the channel", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  // Channel 104 (row 5) answers with the multi-audio MKV (AAC ara, eng, spa; ara is its default):
  // desktop Chromium lists no languages for HLS audio, but it does for Matroska.
  const mkv = `http://${host}/movie/${U}/${P}/206.mkv`;
  await page.route(`**/live/${U}/${P}/104.*`, (route) => route.fulfill({ status: 302, headers: { location: mkv } }));
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  for (let i = 0; i < 5; i += 1) await remote.press('DOWN');
  await remote.expectFocus('live/channels/5');
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  // English, the UI's language, took over from the file's Arabic as the tracks appeared.
  await expect.poll(() => enabledAudio(page)).toEqual(['eng']);
  await expectMoving(page);

  await remote.press('AUDIO');
  await remote.expectFocus('tracks/audio/1');
  const menu = page.getByTestId('tracks');
  await expect(menu).toHaveAttribute('data-switching', 'reliable');
  expect(await page.getByTestId('tracks-audio-list').locator('[role=menuitemradio]').allTextContents()).toEqual(['Arabic', 'English', 'Spanish']);
  await expect(page.getByTestId('tracks-audio-1')).toHaveAttribute('data-selected', 'true');
  // No in-band subtitles on the desktop.
  await expect(page.getByTestId('tracks-text-note')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'player-tracks-media-en.png'), animations: 'disabled' });

  // Arabic from the menu: it plays at once, without a restart, and the menu stays.
  await remote.press('UP', 'OK');
  await expect(page.getByTestId('tracks-audio-0')).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => enabledAudio(page)).toEqual(['ara']);
  await expect(menu).toHaveAttribute('data-refused', '');
  await expect(player).toHaveAttribute('data-state', 'playing');
  await expect(player).toHaveAttribute('data-session', '1');
  await remote.press('BACK');
  await expect(player).toHaveAttribute('data-menu', 'false');

  // Away to the next channel and back: the channel's own choice wins over the UI's language.
  await remote.press('CH_UP');
  await expect(player).toHaveAttribute('data-playing', '6');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await remote.press('CH_DOWN');
  await expect(player).toHaveAttribute('data-playing', '5');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect.poll(() => enabledAudio(page)).toEqual(['ara']);
  await remote.press('AUDIO');
  await remote.expectFocus('tracks/audio/0');
  await remote.press('BACK', 'BACK');
  await remote.expectFocus('live/channels/5');
  expect(errors).toEqual([]);
});
