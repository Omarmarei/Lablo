import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { parseScenario } from '../apps/mock-provider/src/faults';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { stripIsolates } from '../packages/core/src/bidi';
import { addXtreamAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The player in the app (RELAY step 20a) by keys, without generated media (`pnpm e2e`): OK on a
 * channel of the live screen opens the player over the stage, CH+ zaps with the 350 ms debounce,
 * digits find a channel by its number, PRE-CH goes back, and Back returns to the list. The
 * placeholder streams never play on the desktop (no TS, and placeholder HLS never errors), so
 * these tests read what the player asked for (`data-plays`, `data-playing`); the plays
 * themselves are in player-media.spec.ts. Channel 104 is gone from the panel (a 404), for the
 * error card.
 *
 * "All channels" lists the mock's channels category by category: 101, 102, 110, 111 (Test News),
 * 103, 104, 112, 105, 106, 107, 108, 109, numbered by the panel (`num`).
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
/** Row 5 of "All channels" is stream 104. */
const GONE = 5;

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const scenario = parseScenario({ description: 'Stream 104 is gone', rules: [{ match: { path: '/live/**', stream_id: 104 }, faults: [{ type: 'status', status: 404 }] }] }, 'player-e2e');
  app = await mock({ now: () => Date.now(), scenario });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).textContent()) ?? '');
}

/** The page under the player: transparent, with the stage and its <video> shown. */
function chrome(page: Page) {
  return page.evaluate(() => {
    const stage = document.getElementById('stage');
    return {
      route: document.documentElement.getAttribute('data-player'),
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      stage: stage === null ? null : getComputedStyle(stage).visibility,
      videos: document.querySelectorAll('#stage video').length,
    };
  });
}

/** Every box of the player's parts on show, to check they sit in the safe area. */
function boxes(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid=player-bar], [data-testid=player-card], [data-testid=player-entry], [data-testid=player-reconnecting]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-testid'), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }),
  );
}

async function expectInSafeArea(page: Page): Promise<void> {
  for (const box of await boxes(page)) {
    expect(box.left, `${box.id} left`).toBeGreaterThanOrEqual(SAFE.left);
    expect(box.top, `${box.id} top`).toBeGreaterThanOrEqual(SAFE.top);
    expect(box.right, `${box.id} right`).toBeLessThanOrEqual(SAFE.right);
    expect(box.bottom, `${box.id} bottom`).toBeLessThanOrEqual(SAFE.bottom);
  }
}

test('opens a channel, zaps with the debounce, finds a number, goes back to the previous channel and closes', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  expect(await chrome(page)).toMatchObject({ stage: null, videos: 0 });

  await remote.go('DOWN', 'live/channels/1');
  await remote.press('OK');
  const player = page.getByTestId('player');
  await remote.expectFocus('player/actions/0');
  await expect(player).toHaveAttribute('data-plays', '1');
  await expect(player).toHaveAttribute('data-playing', '1');
  await expect(player).toHaveAttribute('data-info', 'true');
  expect(await text(page, 'player-number')).toBe('2');
  expect(await text(page, 'player-name')).toBe('Zoma Test 2 Clock');
  // The guide's programme on now and the next one.
  await expect(page.getByTestId('player-now')).toBeVisible();
  await expect(page.getByTestId('player-next')).toBeVisible();
  expect(await chrome(page)).toEqual({ route: 'on', html: 'rgba(0, 0, 0, 0)', body: 'rgba(0, 0, 0, 0)', stage: 'visible', videos: 1 });
  // Nothing to go back to yet.
  await expect(page.getByTestId('player-previous')).toHaveAttribute('aria-disabled', 'true');
  await expectInSafeArea(page);
  await page.screenshot({ path: path.join(SHOTS, 'player-bar-en.png'), animations: 'disabled' });

  // Three quick CH+: the bar moves at once, one stream opens 350 ms after the last.
  await remote.press('CH_UP', 'CH_UP', 'CH_UP');
  await expect(player).toHaveAttribute('data-target', '4');
  expect(await text(page, 'player-name')).toBe('زوما تجريبي ٣');
  expect(await text(page, 'player-number')).toBe('3');
  await expect(player).toHaveAttribute('data-playing', '4');
  await expect(player).toHaveAttribute('data-plays', '2');
  await expect(player).toHaveAttribute('data-previous', '1');
  await expect(page.getByTestId('player-previous')).not.toHaveAttribute('aria-disabled', 'true');

  // The number 5: the panel's Zoma Kids Test, row 7.
  await remote.press('DIGIT_5');
  await expect(player).toHaveAttribute('data-entry', 'typing');
  expect(await text(page, 'player-entry')).toBe('5');
  await expect(player).toHaveAttribute('data-playing', '7', { timeout: 5_000 });
  await expect(player).toHaveAttribute('data-entry', '');
  expect(await text(page, 'player-name')).toBe('Zoma Kids Test');
  await expect(player).toHaveAttribute('data-previous', '4');

  // PRE-CH goes back to the channel watched before, and back again.
  await remote.press('PREV_CH');
  await expect(player).toHaveAttribute('data-playing', '4');
  await remote.press('PREV_CH');
  await expect(player).toHaveAttribute('data-playing', '7');
  await expect(player).toHaveAttribute('data-plays', '5');

  // A number no channel has, ended early with OK.
  await remote.press('DIGIT_9', 'DIGIT_9', 'OK');
  await expect(player).toHaveAttribute('data-entry', 'missing');
  expect(await text(page, 'player-entry')).toBe(`99${EN['player.noChannel'].replace('{number}', '99')}`);
  await expectInSafeArea(page);
  // Back first ends the note, then closes the player.
  await remote.press('BACK');
  await expect(player).toHaveAttribute('data-entry', '');
  await remote.press('BACK');
  await remote.expectFocus('live/channels/7');
  await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
  expect(await chrome(page)).toMatchObject({ route: 'off', stage: 'hidden' });
  expect(errors).toEqual([]);
});

for (const locale of ['en-US', 'ar-SA'] as const) {
  test(`a channel the panel lost: the provider's error card with the account, in ${locale}`, async ({ page }) => {
    const errors = trackErrors(page);
    const catalog = locale === 'ar-SA' ? AR : EN;
    // The lost channel's requests: the browser logs each 404.
    const unexpected = (): string[] => errors.filter((e) => e.indexOf('status of 404') === -1);
    const remote = new RemoteDriver(page);
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    for (let i = 0; i < GONE; i += 1) await remote.press('DOWN');
    await remote.expectFocus(`live/channels/${GONE}`);
    await remote.press('OK');
    const player = page.getByTestId('player');
    await expect(player).toHaveAttribute('data-playing', String(GONE));
    // TS refused by the desktop, then the HLS 404s with the backoff: a few seconds.
    await expect(player).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
    await remote.expectFocus('player/card/0');
    const card = page.getByTestId('player-card');
    await expect(card).toHaveAttribute('data-category', 'provider');
    const code = await player.getAttribute('data-failure');
    expect(code).toMatch(/^PRV-/);
    expect(await text(page, 'player-code')).toBe(catalog['player.code'].replace('{code}', code ?? ''));
    expect(stripIsolates((await card.locator('h2').textContent()) ?? '')).toBe(catalog['player.provider.title']);
    // The account re-check: the mock's account runs for a year and allows two connections.
    await expect(page.getByTestId('player-expiry')).toBeVisible();
    expect(await text(page, 'player-connections')).toBe(catalog['player.account.connections'].replace('{active, number}', '0').replace('{max, number}', '2'));
    // The info bar stays up over the card, both in the safe area.
    await expect(page.getByTestId('player-bar')).toBeVisible();
    await expectInSafeArea(page);
    await page.screenshot({ path: path.join(SHOTS, `player-card-${locale === 'ar-SA' ? 'ar' : 'en'}.png`), animations: 'disabled' });

    // "Try again" opens it again; the card comes back when it gives up again.
    const plays = Number(await player.getAttribute('data-plays'));
    await remote.press('OK');
    await expect(player).toHaveAttribute('data-plays', String(plays + 1));
    await expect(player).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
    // A zap hides the card at once; the bar shows the next channel.
    await remote.press('CH_UP');
    await expect(card).toHaveCount(0);
    expect(await text(page, 'player-name')).toBe('Zoma Test 1 SMPTE');
    await expect(player).toHaveAttribute('data-playing', String(GONE + 1));
    await remote.expectFocus('player/actions/0');
    // "Channels" on the card of the lost channel again closes the player.
    await remote.press('CH_DOWN');
    await expect(player).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
    // The buttons run from the inline start: LEFT goes to the second one in Arabic.
    await remote.go(locale === 'ar-SA' ? 'LEFT' : 'RIGHT', 'player/card/1');
    await remote.press('OK');
    await remote.expectFocus(`live/channels/${GONE}`);
    expect(unexpected()).toEqual([]);
  });
}
