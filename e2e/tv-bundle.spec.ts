import { cpSync, existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { ARABIC_FACE, LATIN_FACE, TITLE_FONTS, renderedFonts, renderedFontsUnder } from './fonts';
import { TV_KEYS } from '../tools/engines/src/live';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST } from './settings-rows';

/**
 * Boots the built TV bundles (pnpm build:tv) from file://, the way a packaged TV app loads,
 * in desktop Chromium: classic-script IIFE, core-js polyfills, the Blob-URL workers and the
 * platform adapter's feature checks when the TV APIs are absent. The data workers refresh the
 * in-process mock's playlist and search it (the old engines run the same in tools/engines).
 *
 * The hello screen and the component gallery are the builds' test copy's (dist/tv-dev, RELAY step
 * 35b): the store builds (dist/tv) have no developer screens, and start as a TV does whatever
 * `?screen=` says.
 */
const DIST = path.resolve(import.meta.dirname, '../dist/tv');
const DEV_DIST = path.resolve(import.meta.dirname, '../dist/tv-dev');

let app: MockServer;
let base: string;

/** The TV's own Back key (Tizen 10009, webOS 461): the TV builds read the key code, as on the TV. */
async function pressBack(page: Page, platform: 'tizen' | 'webos'): Promise<void> {
  const { key, keyCode } = TV_KEYS[platform].back;
  const cdp = await page.context().newCDPSession(page);
  for (const type of ['rawKeyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await cdp.detach();
}

test.beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
test.afterAll(async () => {
  await app.close();
});

for (const platform of ['tizen', 'webos'] as const) {
  test(`the ${platform} bundle boots from file://, answers remote keys and runs the data workers`, async ({ page }) => {
    const index = path.join(DEV_DIST, platform, 'index.html');
    expect(existsSync(index), `${index} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      // Tizen's $WEBAPIS/webapis/webapis.js only exists on a Samsung TV.
      if (message.type() === 'error' && !message.text().includes('ERR_FILE_NOT_FOUND')) {
        errors.push(`console: ${message.text()}`);
      }
    });

    const playlist = `${base}/get.php?username=${U}&password=${P}&type=m3u_plus`;
    await page.goto(`${pathToFileURL(index).href}?screen=hello&q=sports&source=${encodeURIComponent(playlist)}`);
    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('platform-id')).toHaveText(platform);
    await expect(page.getByTestId('info-platform')).toHaveText(platform);
    // No TV APIs on the desktop: the adapter falls back instead of crashing.
    await expect(page.getByTestId('info-model')).toHaveText('unknown');
    await expect(page.getByTestId('worker-status')).toHaveText(/^ok in \d+ ms/);
    // IndexedDB inside the Blob worker, from a file:// page (the TV's origin).
    await expect(page.getByTestId('idb-status')).toHaveText('ok');
    await expect(page.locator('#boot-error')).toBeHidden();
    // Both data workers as Blob workers from file://: refresh, swap, reload, search.
    await expect(page.getByTestId('ingest-status')).toHaveText(/^ok: committed gen 1, \d+ items/, { timeout: 20_000 });
    await expect(page.getByTestId('data-status')).toHaveText(/^ok: 1 source, \d+ items$/);
    await expect(page.getByTestId('search-status')).toHaveAttribute('data-total', '2');
    // The EPG worker too: the guide the playlist names, read and stored, then matched.
    await expect(page.getByTestId('epg-status')).toHaveText('ok: 11 of 12 live channels have a guide (91.7%), 1 guide', { timeout: 20_000 });
    // The one unmatched channel is the 18+ one, locked by default (RELAY step 38): the query worker
    // serves none of it, so the short-EPG fallback has no channel to ask about.
    await expect(page.getByTestId('shortepg-status')).toHaveText('none: every live channel here has a guide', { timeout: 20_000 });

    // Arrow keys share key codes with the TV remotes (37–40), so the TV key maps apply. The
    // focus engine moves from the list up to the rail, and OK opens a details screen.
    await expect(page.getByTestId('focus-status')).toHaveText('home · list 0');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('last-intent')).toHaveText('UP');
    await expect(page.getByTestId('focus-status')).toHaveText('home · rail 0');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('last-intent')).toHaveText('OK');
    await expect(page.getByTestId('focus-status')).toHaveText('details · buttons 0');

    // app.css from the CSS build: the bundled woff2 faces load from assets/ on file://.
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await renderedFonts(page, '[data-testid=title]')).toEqual(TITLE_FONTS);
    expect(await renderedFonts(page, '.hello__brand-ar')).toEqual([{ familyName: ARABIC_FACE, isCustomFont: true, glyphCount: 4 }]);
    expect(errors).toEqual([]);
  });
}

for (const platform of ['tizen', 'webos'] as const) {
  test(`the ${platform} bundle shows the component gallery from file:// (?screen=gallery)`, async ({ page }) => {
    const index = path.join(DEV_DIST, platform, 'index.html');
    expect(existsSync(index), `${index} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('ERR_FILE_NOT_FOUND')) errors.push(`console: ${message.text()}`);
    });

    await page.goto(`${pathToFileURL(index).href}?screen=gallery`);
    const gallery = page.getByTestId('gallery');
    await expect(gallery).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#boot-error')).toBeHidden();
    // app.css carries every component's CSS: a row is 88 px, the virtual list draws 7 of 240.
    await expect(page.locator('[data-testid=channels] .z-row')).toHaveCount(7);
    expect((await page.getByTestId('row-0').boundingBox())?.height).toBe(88);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('row-1')).toHaveAttribute('data-state', 'focused');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('play-dialog')).toBeVisible();
    // Both bundled faces, nothing from the system.
    expect((await renderedFontsUnder(page, '[data-testid=gallery]')).map((f) => [f.familyName, f.isCustomFont])).toEqual([
      [LATIN_FACE, true],
      [ARABIC_FACE, true],
    ]);
    expect(errors).toEqual([]);
  });

  test(`the ${platform} bundle switches the gallery to Arabic and back by remote keys`, async ({ page }) => {
    const index = path.join(DEV_DIST, platform, 'index.html');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('ERR_FILE_NOT_FOUND')) errors.push(`console: ${message.text()}`);
    });
    // The TV adapters take the locale from navigator.language (en-US here): the switch is the only way to Arabic.
    await page.goto(`${pathToFileURL(index).href}?screen=gallery`);
    const gallery = page.getByTestId('gallery');
    await expect(gallery).toHaveAttribute('data-language', 'en');
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(key);
    await expect(page.getByTestId('language')).toHaveAttribute('data-state', 'focused');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(gallery).toHaveAttribute('data-language', 'ar');
    await expect(gallery).toContainText('240 قناةً');
    await expect(page.getByTestId('language')).toHaveAttribute('data-state', 'focused');
    // app.css's RTL rules apply live: the channel list moved to the right.
    expect((await page.getByTestId('channels').boundingBox())?.x).toBeGreaterThan((await page.getByTestId('tile-0').boundingBox())?.x ?? 1920);
    // LEFT and RIGHT mirrored: RIGHT goes back to the actions.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('action-3')).toHaveAttribute('data-state', 'focused');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(gallery).toHaveAttribute('data-language', 'en');
    await expect(page.getByTestId('language')).toHaveAttribute('data-state', 'focused');
    expect(errors).toEqual([]);
  });
}

for (const platform of ['tizen', 'webos'] as const) {
  test(`the store ${platform} bundle has no developer screens: ?screen= starts it as a TV does (step 35b)`, async ({ page }) => {
    const index = path.join(DIST, platform, 'index.html');
    expect(existsSync(index), `${index} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    for (const screen of ['hello', 'gallery', 'gallery-guide']) {
      await page.goto(`${pathToFileURL(index).href}?screen=${screen}`);
      await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
      await expect(page.getByTestId('onboarding')).toHaveAttribute('data-screen', 'language');
      await expect(page.getByTestId('hello')).toHaveCount(0);
      await expect(page.getByTestId('gallery')).toHaveCount(0);
    }
    // Their styles are the test copy's only: the gallery's (gallery.css) and the hello screen's (dev-screens.css).
    for (const rule of ['.gallery {', '.hello {', '.focus__grid {']) {
      expect(readFileSync(path.join(DIST, platform, 'app.css'), 'utf8')).not.toContain(rule);
      expect(readFileSync(path.join(DEV_DIST, platform, 'app.css'), 'utf8')).toContain(rule);
    }
    expect(errors).toEqual([]);
  });

  test(`the ${platform} bundle starts on onboarding from file://, types into a field by remote keys, and loads settings.js on the first open of Settings (step 35e)`, async ({ page }) => {
    expect(existsSync(path.join(DIST, platform, 'index.html')), `${DIST} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
    // A copy of the store build: its settings.js is taken away for a while.
    const copy = test.info().outputPath(platform);
    cpSync(path.join(DIST, platform), copy, { recursive: true });
    const index = path.join(copy, 'index.html');
    const settingsJs = path.join(copy, 'settings.js');
    renameSync(settingsJs, `${settingsJs}.away`);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('ERR_FILE_NOT_FOUND')) errors.push(`console: ${message.text()}`);
    });

    // No parameters: what a TV opens (RELAY step 13a).
    await page.goto(pathToFileURL(index).href);
    const root = page.getByTestId('onboarding');
    await expect(root).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#boot-error')).toBeHidden();
    await expect(root).toHaveAttribute('data-screen', 'language');
    // English, I understand, Allow, M3U link: the form, by the remote's own key codes.
    for (const key of ['Enter', 'Enter', 'Enter', 'ArrowDown', 'Enter']) await page.keyboard.press(key);
    await expect(root).toHaveAttribute('data-screen', 'form');
    // OK gives the field DOM focus (the TV's keyboard), Enter (key 13) ends the edit and moves on.
    await page.keyboard.press('Enter');
    await expect(root).toHaveAttribute('data-editing', 'onboarding-playlist');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('onboarding-playlist');
    // The mock's playlist, typed without `http://` (the form adds it).
    const link = `${base.replace(/^http:\/\//, '')}/get.php?username=${U}&password=${P}&type=m3u_plus`;
    await page.keyboard.type(link);
    await page.keyboard.press('Enter');
    await expect(root).toHaveAttribute('data-editing', '');
    await expect(root).toHaveAttribute('data-index', '1');
    await expect(page.locator('#onboarding-playlist')).toHaveValue(link);
    // The Blob data workers load it from file:// (step 13b): done with the playlist's channels.
    for (const key of ['ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key);
    await expect(root).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
    await expect(page.getByTestId('done-live')).toHaveAttribute('data-n', String(app.mockState.catalog.live.length));
    // The mock's 18+ group is locked and no PIN is set (RELAY step 38c3): "Later", then the live
    // screen (step 14a) lists the playlist through the same workers.
    await expect(page.getByTestId('done-pin')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(root).toHaveAttribute('data-index', '1');
    await page.keyboard.press('Enter');
    const live = page.getByTestId('live');
    await expect(live).toHaveAttribute('data-status', 'ready');
    await expect(live).toHaveAttribute('data-pending', '0', { timeout: 10_000 });
    // (All but the 18+ channel, locked by default: RELAY step 38.)
    await expect(page.locator('[data-testid=rail] .z-chip').first().locator('.z-chip__count')).toHaveText(String(app.mockState.catalog.live.filter((c) => !c.adult).length));
    await expect(page.locator('[data-testid=channels] .z-row')).toHaveCount(Math.min(9, app.mockState.catalog.live.length));
    await expect(page.getByTestId('row-0').locator('.z-row__name')).not.toHaveText('');
    await page.keyboard.press('ArrowDown');
    await expect(live).toHaveAttribute('data-index', '1');
    // A relaunch with the source stored skips onboarding.
    await page.reload();
    await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    await expect(page.getByTestId('live')).toHaveAttribute('data-pending', '0', { timeout: 10_000 });

    // Settings (step 35e): main.js loads settings.js by a script tag the first time. Not there: the failure, "Try again" focused.
    const remote = new RemoteDriver(page);
    await remote.go('UP', 'live/header/0');
    for (let i = 1; i <= 5; i += 1) await remote.go('RIGHT', `live/header/${i}`);
    await remote.go('OK', 'lazy-loading/retry/0');
    const loading = page.getByTestId('lazy-loading');
    await expect(loading).toHaveAttribute('data-phase', 'failed');
    await expect(page.getByTestId('lazy-loading-failed')).toContainText("Couldn't open this screen.");
    await expect(page.getByTestId('lazy-loading-retry')).toHaveAttribute('data-state', 'focused');
    await page.screenshot({ path: path.resolve(import.meta.dirname, `../artifacts/screenshots/lazy-loading-failed-${platform}.png`) });
    // Back: the live screen; OK again tries again, and fails again.
    await pressBack(page, platform);
    await remote.expectFocus('live/header/5');
    await expect(page.getByTestId('live')).toBeVisible();
    await remote.go('OK', 'lazy-loading/retry/0');
    // The file is there now: "Try again" loads it and Settings opens, once, with no script tag left over.
    renameSync(`${settingsJs}.away`, settingsJs);
    await remote.go('OK', SETTINGS_FIRST);
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await expect(page.getByTestId('settings')).toBeVisible();
    await pressBack(page, platform);
    await remote.expectFocus('live/header/5');
    await remote.go('OK', SETTINGS_FIRST);
    expect(await page.evaluate(() => document.querySelectorAll('script[src="settings.js"]').length)).toBe(0);
    await expect(page.locator('#boot-error')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
