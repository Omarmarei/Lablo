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
 */
const MEDIA_DIR = path.resolve(import.meta.dirname, '../.cache/media');
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

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
