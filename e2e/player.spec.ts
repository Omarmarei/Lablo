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
 * error card. The stream info (step 20c2a) waits for a picture here; its figures are in
 * player-media.spec.ts. The mock's `hls` account allows HLS only (`allowed_output_formats`).
 * The picture's modes (step 20c2b) are read off the `<video>`'s fit and box.
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
    Array.from(document.querySelectorAll('[data-testid=player-bar], [data-testid=player-card], [data-testid=player-entry], [data-testid=player-reconnecting], [data-testid=player-stream-info]')).map((el) => {
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

/** The track menu's panel box. */
function panel(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid=tracks]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

for (const locale of ['en-US', 'ar-SA'] as const) {
  test(`the audio and subtitles menu: from the info bar and the remote's keys, "Not supported" without a track API, in ${locale}`, async ({ page }) => {
    const errors = trackErrors(page);
    const catalog = locale === 'ar-SA' ? AR : EN;
    const remote = new RemoteDriver(page);
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await remote.go('DOWN', 'live/channels/1');
    await remote.press('OK');
    const player = page.getByTestId('player');
    await remote.expectFocus('player/actions/0');
    // The info bar's second button; the buttons run from the inline start.
    await remote.go(locale === 'ar-SA' ? 'LEFT' : 'RIGHT', 'player/actions/1');
    expect(await text(page, 'player-tracks')).toBe(catalog['player.tracks']);
    await remote.press('OK');
    // Desktop Chromium has no audioTracks without its Blink flag: no audio list, so the
    // subtitles' "Off" takes the focus.
    await remote.expectFocus('tracks/text/0');
    await expect(player).toHaveAttribute('data-menu', 'true');
    const menu = page.getByTestId('tracks');
    await expect(menu).toHaveAttribute('data-switching', 'none');
    await expect(page.getByTestId('player-bar')).toHaveCount(0);
    expect(await text(page, 'tracks-audio-note')).toBe(catalog['tracks.unsupported']);
    expect(await text(page, 'tracks-text-note')).toBe(catalog['tracks.none']);
    await expect(page.getByTestId('tracks-text-off')).toHaveAttribute('data-selected', 'true');
    expect(stripIsolates((await menu.locator('h2').textContent()) ?? '')).toBe(catalog['player.tracks']);
    // The panel sits in the safe area at the inline end: the right in English, the left in Arabic.
    const box = await panel(page);
    expect(box).not.toBeNull();
    expect(box!.top).toBeGreaterThanOrEqual(SAFE.top);
    expect(box!.bottom).toBeLessThanOrEqual(SAFE.bottom);
    if (locale === 'ar-SA') expect(box!.left).toBe(SAFE.left);
    else expect(box!.right).toBe(SAFE.right);
    await page.screenshot({ path: path.join(SHOTS, `player-tracks-${locale === 'ar-SA' ? 'ar' : 'en'}.png`), animations: 'disabled' });

    // OK on "Off" with nothing showing does nothing; Back closes only the menu, and the bar is back.
    await remote.press('OK');
    await expect(menu).toHaveAttribute('data-pending', '0');
    await remote.press('BACK');
    await remote.expectFocus('player/actions/1');
    await expect(page.getByTestId('player-bar')).toBeVisible();
    await expect(player).toHaveAttribute('data-menu', 'false');

    // The remote's subtitle key opens it; the audio key, with no audio list, closes it.
    await remote.press('SUBTITLES');
    await remote.expectFocus('tracks/text/0');
    await remote.press('AUDIO');
    await expect(player).toHaveAttribute('data-menu', 'false');
    // STOP in the menu closes the player.
    await remote.press('AUDIO');
    await remote.expectFocus('tracks/text/0');
    await remote.press('STOP');
    await remote.expectFocus('live/channels/1');
    expect(errors).toEqual([]);
  });
}

test("an account that allows HLS only: the player never asks it for .ts (allowed_output_formats)", async ({ page }) => {
  const errors = trackErrors(page);
  /** The live stream URLs the page asked the mock for (Vite's own /src/live/ files are on another host). */
  const live: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.host === host && url.pathname.indexOf('/live/') === 0) live.push(url.pathname);
  });
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: 'hls', password: 'hls-test' }, 'locale=en-US');
  await remote.go('DOWN', 'live/channels/1');
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-plays', '1');
  await expect(player).toHaveAttribute('data-container', 'hls');
  await remote.press('CH_UP');
  await expect(player).toHaveAttribute('data-plays', '2');
  await expect(player).toHaveAttribute('data-container', 'hls');
  await expect.poll(() => live.filter((p) => p === '/live/hls/hls-test/110.m3u8').length).toBeGreaterThan(0);
  expect(live).toContain('/live/hls/hls-test/102.m3u8');
  // The mock refuses .ts to this account (403): the player never tried it.
  expect(live.filter((p) => p.slice(-5) !== '.m3u8')).toEqual([]);
  await remote.press('BACK');
  await remote.expectFocus('live/channels/2');
  expect(errors).toEqual([]);
});

for (const locale of ['en-US', 'ar-SA'] as const) {
  test(`the stream info: the info bar's third button, the format while the stream opens, kept through a zap, gone with the player, in ${locale}`, async ({ page }) => {
    const errors = trackErrors(page);
    const catalog = locale === 'ar-SA' ? AR : EN;
    const next = locale === 'ar-SA' ? 'LEFT' : 'RIGHT';
    const remote = new RemoteDriver(page);
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await remote.go('DOWN', 'live/channels/1');
    await remote.press('OK');
    const player = page.getByTestId('player');
    await remote.expectFocus('player/actions/0');
    // The info bar's third button.
    await remote.go(next, 'player/actions/1');
    await remote.go(next, 'player/actions/2');
    expect(await text(page, 'player-stats')).toBe(catalog['player.streamInfo']);
    await expect(player).toHaveAttribute('data-stats', 'false');
    await remote.press('OK');
    await expect(player).toHaveAttribute('data-stats', 'true');
    await remote.expectFocus('player/actions/2');
    const info = page.getByTestId('player-stream-info');
    // The placeholder streams never show a picture: the panel waits, with the format the player tries.
    await expect(info).toHaveAttribute('data-picture', 'false');
    expect(stripIsolates((await info.locator('h2').textContent()) ?? '')).toBe(catalog['player.streamInfo']);
    expect(stripIsolates((await info.locator('.stream-info__note').textContent()) ?? '')).toBe(catalog['player.info.waiting']);
    // Desktop Chromium refuses the .ts form: the .m3u8 is tried next.
    const format = page.getByTestId('stream-info-format');
    await expect(format.locator('.stream-info__value')).toHaveText('HLS', { timeout: 10_000 });
    await expect(format.locator('.stream-info__value')).toHaveAttribute('dir', 'ltr');
    expect(stripIsolates((await format.locator('.stream-info__label').textContent()) ?? '')).toBe(catalog['player.info.format']);
    // The top-start corner of the safe area: the left in English, the right in Arabic.
    const box = await info.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBe(SAFE.top);
    if (locale === 'ar-SA') expect(box!.x + box!.width).toBe(SAFE.right);
    else expect(box!.x).toBe(SAFE.left);
    await expectInSafeArea(page);
    await page.screenshot({ path: path.join(SHOTS, `player-stream-info-${locale === 'ar-SA' ? 'ar' : 'en'}.png`), animations: 'disabled' });

    // A zap: the panel stays.
    await remote.press('CH_UP');
    await expect(player).toHaveAttribute('data-playing', '2');
    await expect(player).toHaveAttribute('data-stats', 'true');
    // The button again: off.
    await remote.expectFocus('player/actions/2');
    await remote.press('OK');
    await expect(player).toHaveAttribute('data-stats', 'false');
    await expect(info).toHaveCount(0);
    // On again, then Back: the player closes, and the next play starts without the panel.
    await remote.press('OK');
    await expect(player).toHaveAttribute('data-stats', 'true');
    await remote.press('BACK');
    await remote.expectFocus('live/channels/2');
    await remote.press('OK');
    await expect(player).toHaveAttribute('data-plays', '3');
    await expect(player).toHaveAttribute('data-stats', 'false');
    expect(errors).toEqual([]);
  });
}

/** The `<video>`'s fit and box on the stage (`null`: no video yet). */
function picture(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector('#stage video');
    if (video === null) return null;
    const r = video.getBoundingClientRect();
    return { fit: getComputedStyle(video).objectFit, left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/** The picture's mode the profile keeps (`null`: none yet), read from IndexedDB. */
function storedPicture(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('zoma');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('profile', 'readonly').objectStore('profile').get('current');
          get.onerror = () => {
            db.close();
            resolve(null);
          };
          get.onsuccess = () => {
            db.close();
            resolve((get.result as { doc?: { player?: { picture?: string } } } | undefined)?.doc?.player?.picture ?? null);
          };
        };
      }),
  );
}

const SCREEN = { left: 0, top: 0, width: 1920, height: 1080 };

/** The 4:3 side bars the player draws: their boxes and colours. */
function pillars(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.player__pillar')).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, width: r.width, height: r.height, color: getComputedStyle(el).backgroundColor };
    }),
  );
}

const BARS = [
  { left: 0, width: 240, height: 1080, color: 'rgb(0, 0, 0)' },
  { left: 1680, width: 240, height: 1080, color: 'rgb(0, 0, 0)' },
];

for (const locale of ['en-US', 'ar-SA'] as const) {
  test(`the picture: the info bar's fourth button goes round fit, zoom, stretch and 4:3, kept through a zap and a relaunch, in ${locale}`, async ({ page }) => {
    const errors = trackErrors(page);
    const catalog = locale === 'ar-SA' ? AR : EN;
    const next = locale === 'ar-SA' ? 'LEFT' : 'RIGHT';
    const label = (mode: 'fit' | 'zoom' | 'stretch' | '43'): string => catalog['player.picture'].replace('{mode}', catalog[`player.picture.${mode}`]);
    const remote = new RemoteDriver(page);
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await remote.go('DOWN', 'live/channels/1');
    await remote.press('OK');
    const player = page.getByTestId('player');
    await remote.expectFocus('player/actions/0');
    await remote.go(next, 'player/actions/1');
    await remote.go(next, 'player/actions/2');
    await remote.go(next, 'player/actions/3');
    // Fit: the whole picture in its own shape, on the whole screen.
    expect(await text(page, 'player-picture')).toBe(label('fit'));
    await expect(player).toHaveAttribute('data-picture', 'fit');
    expect(await picture(page)).toEqual({ fit: 'contain', ...SCREEN });
    await expectInSafeArea(page);
    await page.screenshot({ path: path.join(SHOTS, `player-picture-${locale === 'ar-SA' ? 'ar' : 'en'}.png`), animations: 'disabled' });
    const round = [
      { mode: 'zoom', name: 'zoom', fit: 'cover', box: SCREEN },
      { mode: 'stretch', name: 'stretch', fit: 'fill', box: SCREEN },
      { mode: '4:3', name: '43', fit: 'fill', box: { left: 240, top: 0, width: 1440, height: 1080 } },
      { mode: 'fit', name: 'fit', fit: 'contain', box: SCREEN },
    ] as const;
    for (const step of round) {
      await remote.press('OK');
      await expect(player).toHaveAttribute('data-picture', step.mode);
      expect(await text(page, 'player-picture')).toBe(label(step.name));
      expect(await picture(page)).toEqual({ fit: step.fit, ...step.box });
      // Black side bars beside the 4:3 window only.
      const bars = await pillars(page);
      expect(bars.sort((a, b) => a.left - b.left)).toEqual(step.mode === '4:3' ? BARS : []);
      // The stream isn't touched, and the focus stays on the button.
      await expect(player).toHaveAttribute('data-plays', '1');
      await remote.expectFocus('player/actions/3');
    }

    // 4:3, then a zap: the next channel in 4:3 too.
    await remote.press('OK');
    await remote.press('OK');
    await remote.press('OK');
    await expect(player).toHaveAttribute('data-picture', '4:3');
    await expectInSafeArea(page);
    await page.screenshot({ path: path.join(SHOTS, `player-picture-43-${locale === 'ar-SA' ? 'ar' : 'en'}.png`), animations: 'disabled' });
    await remote.press('CH_UP');
    await expect(player).toHaveAttribute('data-playing', '2');
    expect(await picture(page)).toEqual({ fit: 'fill', left: 240, top: 0, width: 1440, height: 1080 });
    await expect.poll(() => storedPicture(page)).toBe('4:3');

    // A relaunch: the last channel plays at once, in 4:3.
    await page.reload();
    await remote.expectFocus('player/actions/0');
    await expect(player).toHaveAttribute('data-picture', '4:3');
    expect(await picture(page)).toEqual({ fit: 'fill', left: 240, top: 0, width: 1440, height: 1080 });
    expect((await pillars(page)).sort((a, b) => a.left - b.left)).toEqual(BARS);
    await remote.go(next, 'player/actions/1');
    await remote.go(next, 'player/actions/2');
    await remote.go(next, 'player/actions/3');
    expect(await text(page, 'player-picture')).toBe(label('43'));
    await remote.press('OK');
    await expect(player).toHaveAttribute('data-picture', 'fit');
    await expect.poll(() => storedPicture(page)).toBe('fit');
    expect(errors).toEqual([]);
  });
}
