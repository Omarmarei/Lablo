import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/** Fails the test on any uncaught page error or console error. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test.describe('hello app in the desktop browser (pnpm dev)', () => {
  test('shows device info and the worker round trip', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');

    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('platform-id')).toHaveText('browser');
    await expect(page.getByTestId('info-platform')).toHaveText('browser');
    await expect(page.getByTestId('info-model')).toHaveText('Desktop browser');
    await expect(page.getByTestId('info-tier')).toHaveText('full');
    await expect(page.getByTestId('info-chromiumVersion')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('worker-status')).toHaveText(/^ok in \d+ ms \(.*TextDecoder.*indexedDB.*\)$/);
    expect(errors).toEqual([]);
  });

  test('maps the keyboard to remote Intents', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    const lastIntent = page.getByTestId('last-intent');
    await expect(lastIntent).toHaveText('Press a key');

    const presses: Array<[key: string, intent: string]> = [
      ['ArrowDown', 'DOWN'],
      ['ArrowRight', 'RIGHT'],
      ['Enter', 'OK'],
      ['PageUp', 'CH_UP'],
      ['7', 'DIGIT_7'],
      ['F1', 'RED'],
      ['F4', 'BLUE'],
      [' ', 'PLAY_PAUSE'],
      ['i', 'INFO'],
      ['g', 'GUIDE'],
    ];
    for (const [key, intent] of presses) {
      await page.keyboard.press(key === ' ' ? 'Space' : key);
      await expect(lastIntent).toHaveText(intent);
    }
    await expect(page.getByTestId('key-count')).toHaveText(String(presses.length));

    // Unmapped keys change nothing.
    await page.keyboard.press('a');
    await expect(page.getByTestId('key-count')).toHaveText(String(presses.length));

    // Back at the root asks the platform to exit (a no-op in the browser).
    await expect(page.getByTestId('exit-requested')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(lastIntent).toHaveText('BACK');
    await expect(page.getByTestId('exit-requested')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('honours the forced low tier and locale overrides', async ({ page }) => {
    await page.goto('/?tier=low&locale=ar-SA&country=SA');
    await expect(page.getByTestId('info-tier')).toHaveText('low');
    await expect(page.getByTestId('info-locale')).toHaveText('ar-SA');
    await expect(page.getByTestId('info-country')).toHaveText('SA');
  });
});
