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
 * appear, a pick from the menu, and the channel's choice kept across a zap and, through the
 * profile, across a relaunch that starts on that channel (step 20c1). `audioTracks` is behind a
 * Blink flag on the desktop (webOS ships it), turned on here.
 *
 * The stream info (RELAY step 20c2a) on real live channels: the picture size, the frame rate and
 * the bitrate measured from the `<video>`'s counters, the format and the player.
 *
 * The picture's 4:3 mode (RELAY step 20c2b) on a real picture, read from the screen's pixels.
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

test("the audio menu on a stream with three languages: the UI's language first, a pick from the menu, remembered for the channel across a relaunch", async ({ page }) => {
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

  // A relaunch (step 20c1): the last channel plays at once, in the Arabic the profile kept for it.
  await page.reload();
  await remote.expectFocus('player/actions/0');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-playing', '5');
  await expect.poll(() => enabledAudio(page)).toEqual(['ara']);
  await remote.press('BACK');
  await remote.expectFocus('live/channels/5');
  expect(errors).toEqual([]);
});

/** A figure of the stream info panel. */
function figure(page: Page, id: string) {
  return page.getByTestId(`stream-info-${id}`).locator('.stream-info__value');
}

/** The panel's bitrate in kb/s. */
async function kbps(page: Page): Promise<number> {
  const shown = (await figure(page, 'bitrate').textContent()) ?? '';
  const m = /^([\d.]+) (kb|Mb)\/s$/.exec(shown.replace(/[\u2066-\u2069]/g, ''));
  if (m === null) return NaN;
  return Number(m[1]) * (m[2] === 'Mb' ? 1000 : 1);
}

test('the stream info on real live channels: the size, a measured frame rate and bitrate, the format and the player, following a channel change', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  // Zoma Test 1 SMPTE: 960x540 at 25 fps, about 0.5 Mb/s of video.
  await remote.press('OK');
  const player = page.getByTestId('player');
  await remote.expectFocus('player/actions/0');
  await remote.go('RIGHT', 'player/actions/1');
  await remote.go('RIGHT', 'player/actions/2');
  await remote.press('OK');
  await expect(player).toHaveAttribute('data-stats', 'true');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  const info = page.getByTestId('player-stream-info');
  await expect(info).toHaveAttribute('data-picture', 'true');
  await expect(figure(page, 'resolution')).toHaveText('960×540');
  await expect(figure(page, 'format')).toHaveText('HLS');
  await expect(figure(page, 'engine')).toHaveText('HTML5');
  // Measured over a few seconds of playback.
  await expect(figure(page, 'fps')).toHaveText(/^(2[2-8]) fps$/, { timeout: 10_000 });
  await expect.poll(() => kbps(page), { timeout: 10_000 }).toBeGreaterThan(200);
  expect(await kbps(page)).toBeLessThan(2000);
  // The <video> names no codec.
  await expect(page.getByTestId('stream-info-video')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'player-stream-info-live-en.png'), animations: 'disabled' });

  // The number 6: Zoma Sports Test HD, 1280x720 at 50 fps, about 1.8 Mb/s of video.
  await remote.press('DIGIT_6');
  await expect(player).toHaveAttribute('data-playing', '8', { timeout: 5_000 });
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-stats', 'true');
  await expect(figure(page, 'resolution')).toHaveText('1280×720', { timeout: 10_000 });
  await expect(figure(page, 'fps')).toHaveText(/^(4[5-9]|5[0-5]) fps$/, { timeout: 10_000 });
  await expect.poll(() => kbps(page), { timeout: 10_000 }).toBeGreaterThan(1000);

  await remote.press('BACK');
  await remote.expectFocus('live/channels/8');
  expect(errors).toEqual([]);
});

/** The screen's colour (r, g, b) at each point, from a screenshot the page decodes itself. */
async function colours(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> {
  const png = (await page.screenshot({ animations: 'disabled' })).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return [];
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
    },
    { png, points },
  );
}

/** Black: the side bars. The SMPTE HD bars' edges are 40% grey. */
const dark = (rgb: number[]): boolean => rgb.every((v) => v < 24);

test('the picture in 4:3 on a real live channel: the 16:9 bars squeezed into the middle, black at the sides', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  // Zoma Test 1 SMPTE: 960x540 HD colour bars, grey at both edges.
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expectMoving(page);
  // Fit: the 16:9 picture fills the 16:9 screen, edge to edge (above the info bar).
  const edges = [[24, 200], [1896, 200]] as const;
  expect((await colours(page, edges)).map(dark)).toEqual([false, false]);
  await remote.expectFocus('player/actions/0');
  await remote.go('RIGHT', 'player/actions/1');
  await remote.go('RIGHT', 'player/actions/2');
  await remote.go('RIGHT', 'player/actions/3');
  await remote.press('OK');
  await remote.press('OK');
  await remote.press('OK');
  await expect(player).toHaveAttribute('data-picture', '4:3');
  // The picture between x 240 and 1680, black beside it; the stream plays on.
  const shown = await colours(page, [...edges, [216, 200], [264, 200], [1656, 200], [1704, 200]]);
  expect(shown.map(dark)).toEqual([true, true, true, false, false, true]);
  await expectMoving(page);
  await expect(player).toHaveAttribute('data-plays', '1');
  await page.screenshot({ path: path.join(SHOTS, 'player-picture-43-live-en.png'), animations: 'disabled' });
  // Fit again: edge to edge.
  await remote.press('OK');
  await expect(player).toHaveAttribute('data-picture', 'fit');
  expect((await colours(page, edges)).map(dark)).toEqual([false, false]);
  await remote.press('BACK');
  await remote.expectFocus('live/channels/0');
  expect(errors).toEqual([]);
});
