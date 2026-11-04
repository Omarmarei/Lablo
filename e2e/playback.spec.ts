import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { PlaybackInput, PlaybackSnapshot, PlaybackTarget } from '../apps/tv/src/playback/harness';

/**
 * The playback harness without generated media (RELAY step 18; `pnpm e2e`, so `pnpm verify` and
 * CI's `verify` job): the browser platform builds its engine, and a channel the panel doesn't
 * have fails fast and is blamed on the provider, never on the TV, although desktop Chromium also
 * can't play its `.ts` form. The plays themselves need ffmpeg's media: e2e/playback-media.spec.ts.
 */
let app: MockServer;
let base: string;

test.beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
test.afterAll(async () => {
  await app.close();
});

function play(page: Page, input: PlaybackInput): Promise<void> {
  return page.evaluate((i) => (window as PlaybackTarget).__ZOMA_PLAYBACK__?.play(i), input);
}

async function snapshot(page: Page): Promise<PlaybackSnapshot> {
  const s = await page.evaluate(() => (window as PlaybackTarget).__ZOMA_PLAYBACK__?.snapshot());
  if (s === undefined) throw new Error('no playback harness on the page');
  return s;
}

test('a channel the panel lacks: TS refused by the desktop, HLS 404s, and the provider is blamed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/playback.html');
  const root = page.getByTestId('playback');
  await expect(root).toHaveAttribute('data-ready', 'true');
  const ready = await snapshot(page);
  expect(ready).toMatchObject({ state: 'idle', engines: ['html5'], history: [], trace: [] });
  // Without the Blink flag desktop Chromium has no audioTracks: the track menu would say so.
  expect(ready.trackSwitch).toBe('none');
  await expect(page.locator('#stage video[playsinline]')).toHaveCount(1);

  await play(page, { url: `${base}/live/${U}/${P}/999.ts`, mode: 'live' });
  // Four attempts with 1 and 2 s of backoff: about 3 s.
  await expect(root).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
  const s = await snapshot(page);
  expect(s.trace.filter((t) => t.indexOf('load ') === 0)).toEqual(['load 1 ts', 'load 2 hls', 'load 3 hls', 'load 4 hls', 'load 5 hls']);
  expect(s.trace[1]).toBe('rejected 1 unsupported/MEDIA_ERR_SRC_NOT_SUPPORTED');
  // The browser can play HLS, so its "not supported" is the 404 page: a provider failure, retried.
  expect(s.trace[3]).toBe('rejected 2 network/MEDIA_ERR_SRC_NOT_SUPPORTED');
  expect(s.failure).toMatchObject({ category: 'provider', detail: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
  await expect(root).toHaveAttribute('data-failure', s.failure?.code ?? '');
  expect(errors).toEqual([]);
});
