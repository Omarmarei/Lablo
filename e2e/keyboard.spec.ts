import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { toSourceTypes } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The app's own on-screen keyboard (RELAY step 40e) in onboarding's Xtream form, asked for with
 * `?keyboard=own` (a Tizen TV always has it): OK on a field opens it over the screen; the keys
 * are pressed with the remote's arrows and OK, or typed on a desktop keyboard; Arabic and English
 * pages, Shift, symbols, Delete; Done moves to the next field, Back closes and keeps the text.
 * In English, Arabic and the pseudo-locale: the panel and every key stay on the canvas, no key's
 * label is clipped, and the panel reads left to right in both languages.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const arabicUi = tag === 'ar';

  test(`the app's keyboard types a link and a login in both scripts (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const remote = new RemoteDriver(page);
    const onboarding = await toSourceTypes(remote, `locale=${locale}&keyboard=own`);
    const keyboard = page.locator('.z-kbd');
    const preview = page.locator('.z-kbd__text');
    const input = (n: number) => page.locator('[data-testid=onboarding] .z-field__input').nth(n);
    const key = (label: string) => keyboard.locator('.z-kbd__key', { hasText: new RegExp(`^${label}$`) });

    await test.step('OK on the link field opens the keyboard: no Arabic key, left to right, read-only input', async () => {
      await remote.go('OK', 'form/fields/0');
      await remote.press('OK');
      await expect(keyboard).toBeVisible();
      await expect(onboarding).toHaveAttribute('data-editing', 'onboarding-server');
      await expect(keyboard).toHaveAttribute('dir', 'ltr');
      await expect(input(0)).toHaveAttribute('readonly', '');
      await expect(key('ع')).toHaveCount(0);
      if (words !== null) await expect(keyboard).toHaveAttribute('aria-label', words['keyboard.title']);
    });

    await test.step('the panel and every key are on the canvas and not clipped', async () => {
      const panel = await keyboard.boundingBox();
      expect(panel).not.toBeNull();
      expect(panel!.x).toBe(0);
      expect(panel!.width).toBe(1920);
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(1080);
      const keys = await keyboard.locator('.z-kbd__key').evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          return { text: el.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom, clipped: el.scrollWidth > el.clientWidth };
        }),
      );
      expect(keys.length).toBeGreaterThan(30);
      for (const k of keys) {
        expect(k.left, k.text ?? '').toBeGreaterThanOrEqual(96);
        expect(k.right, k.text ?? '').toBeLessThanOrEqual(1824);
        expect(k.top, k.text ?? '').toBeGreaterThanOrEqual(panel!.y);
        expect(k.bottom, k.text ?? '').toBeLessThanOrEqual(1080);
        expect(k.clipped, k.text ?? '').toBe(false);
      }
      await page.screenshot({ path: path.join(SHOTS, `keyboard-url-${tag}.png`) });
    });

    await test.step('the remote moves over the keys and OK types; a desktop keyboard types and deletes too', async () => {
      // The first key is "1": OK types it; RIGHT, OK types "2".
      await remote.press('OK', 'RIGHT', 'OK');
      await expect(input(0)).toHaveValue('12');
      await expect(preview).toHaveText('12');
      await page.keyboard.type('tv.x');
      await expect(input(0)).toHaveValue('12tv.x');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await expect(input(0)).toHaveValue('12');
      // Nothing under the keyboard moved: the focus is still on the field.
      await remote.expectFocus('form/fields/0');
    });

    await test.step('Shift upper-cases one letter; symbols and back', async () => {
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await key('⇧').click();
      await key('Q').click();
      await key('q').click();
      await expect(input(0)).toHaveValue('Qq');
      await key('123').click();
      await key('abc').click();
      await expect(key('q')).toBeVisible();
    });

    await test.step('Done ends the edit and moves to the next field', async () => {
      await page.locator('.z-kbd__row:last-child .z-kbd__key').last().click();
      await expect(keyboard).toHaveCount(0);
      await expect(onboarding).toHaveAttribute('data-editing', '');
      await remote.expectFocus('form/fields/1');
      await expect(input(0)).toHaveValue('Qq');
    });

    await test.step('the login field starts on the UI language and switches pages', async () => {
      await remote.press('OK');
      await expect(keyboard).toBeVisible();
      await expect(onboarding).toHaveAttribute('data-editing', 'onboarding-username');
      const first = arabicUi ? 'ض' : '1';
      await expect(keyboard.locator('.z-kbd__key').first()).toHaveText(first);
      await remote.press('OK', 'RIGHT', 'OK');
      await expect(input(1)).toHaveValue(arabicUi ? 'ضص' : '12');
      // The other script, by its key.
      await key(arabicUi ? 'EN' : 'ع').click();
      if (arabicUi) {
        await expect(key('Q')).toHaveCount(0);
        await expect(key('q')).toBeVisible();
      } else {
        await expect(key('ض')).toBeVisible();
        await key('ض').click();
        await expect(input(1)).toHaveValue('12ض');
        await expect(preview).toHaveText('12ض');
        // Shift on the Arabic page shows the alif forms.
        await keyboard.locator('.z-kbd__row').nth(2).locator('.z-kbd__key').first().click();
        await expect(key('أ')).toBeVisible();
      }
      await page.screenshot({ path: path.join(SHOTS, `keyboard-login-${tag}.png`) });
    });

    await test.step('Back closes the keyboard, keeps the text and leaves the focus on the field', async () => {
      const before = await input(1).inputValue();
      await remote.press('BACK');
      await expect(keyboard).toHaveCount(0);
      await expect(onboarding).toHaveAttribute('data-editing', '');
      await remote.expectFocus('form/fields/1');
      await expect(input(1)).toHaveValue(before);
      await expect(page.locator('.z-kbd')).toHaveCount(0);
    });

    await test.step('a pointer click on a field opens the keyboard, and a click on a key types without ending the edit', async () => {
      await input(0).click();
      await expect(keyboard).toBeVisible();
      await expect(onboarding).toHaveAttribute('data-editing', 'onboarding-server');
      await key('1').click();
      await key('2').click();
      await expect(input(0)).toHaveValue('Qq12');
      await expect(keyboard).toBeVisible();
      await expect(onboarding).toHaveAttribute('data-editing', 'onboarding-server');
      await remote.press('BACK');
      await expect(keyboard).toHaveCount(0);
    });

    await test.step('a password shows dots on the keyboard', async () => {
      await remote.go('DOWN', 'form/fields/1');
      await remote.go('DOWN', 'form/fields/2');
      // A press of OK within the click window after a pointer click is that click's twin (step 11b): let it pass.
      await page.waitForTimeout(600);
      await expect(onboarding).toHaveAttribute('data-editing', '');
      await remote.press('OK');
      await expect(keyboard).toBeVisible();
      await page.keyboard.type('s3cret');
      await expect(input(2)).toHaveValue('s3cret');
      await expect(preview).toHaveText('••••••');
      await remote.press('BACK');
      await expect(keyboard).toHaveCount(0);
    });
  });
}
