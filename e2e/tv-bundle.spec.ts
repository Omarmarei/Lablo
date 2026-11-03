import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { ARABIC_FACE, LATIN_FACE, TITLE_FONTS, renderedFonts, renderedFontsUnder } from './fonts';

/**
 * Boots the built TV bundles (pnpm build:tv) from file://, the way a packaged TV app loads,
 * in desktop Chromium: classic-script IIFE, core-js polyfills, the Blob-URL workers and the
 * platform adapter's feature checks when the TV APIs are absent. The data workers refresh the
 * in-process mock's playlist and search it (the old engines run the same in tools/engines).
 */
const DIST = path.resolve(import.meta.dirname, '../dist/tv');

let app: MockServer;
let base: string;

test.beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
test.afterAll(async () => {
  await app.close();
});

for (const platform of ['tizen', 'webos'] as const) {
  test(`the ${platform} bundle boots from file://, answers remote keys and runs the data workers`, async ({ page }) => {
    const index = path.join(DIST, platform, 'index.html');
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
    // The short-EPG fallback: the query worker asks the panel for the one unmatched channel.
    await expect(page.getByTestId('shortepg-status')).toHaveText('none: 18+ Test Pattern: the panel has no programmes for it now', { timeout: 20_000 });
    await expect(page.getByTestId('shortepg-status')).toHaveAttribute('data-from', 'panel');

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
    const index = path.join(DIST, platform, 'index.html');
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
    const index = path.join(DIST, platform, 'index.html');
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
  test(`the ${platform} bundle starts on onboarding from file:// and types into a field by remote keys`, async ({ page }) => {
    const index = path.join(DIST, platform, 'index.html');
    expect(existsSync(index), `${index} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
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
    await page.keyboard.type('p.example/list.m3u');
    await page.keyboard.press('Enter');
    await expect(root).toHaveAttribute('data-editing', '');
    await expect(root).toHaveAttribute('data-index', '1');
    await expect(page.locator('#onboarding-playlist')).toHaveValue('p.example/list.m3u');
    // The fake loader (until step 13b) lands on the done screen.
    for (const key of ['ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key);
    await expect(root).toHaveAttribute('data-screen', 'done');
    expect(errors).toEqual([]);
  });
}
