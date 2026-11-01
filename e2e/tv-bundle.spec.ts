import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Boots the built TV bundles (pnpm build:tv) from file://, the way a packaged TV app loads,
 * in desktop Chromium: classic-script IIFE, core-js polyfills, the Blob-URL worker and the
 * platform adapter's feature checks when the TV APIs are absent.
 */
const DIST = path.resolve(import.meta.dirname, '../dist/tv');

for (const platform of ['tizen', 'webos'] as const) {
  test(`the ${platform} bundle boots from file:// and answers remote keys`, async ({ page }) => {
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

    await page.goto(pathToFileURL(index).href);
    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('platform-id')).toHaveText(platform);
    await expect(page.getByTestId('info-platform')).toHaveText(platform);
    // No TV APIs on the desktop: the adapter falls back instead of crashing.
    await expect(page.getByTestId('info-model')).toHaveText('unknown');
    await expect(page.getByTestId('worker-status')).toHaveText(/^ok in \d+ ms/);
    await expect(page.locator('#boot-error')).toBeHidden();

    // Arrow keys share key codes with the TV remotes (37–40), so the TV key maps apply.
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('last-intent')).toHaveText('UP');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('last-intent')).toHaveText('OK');
    expect(errors).toEqual([]);
  });
}
