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
      // The field draws the dots too, with its caret (step 51).
      await expect(page.locator('[data-testid=onboarding] .z-field__typed')).toHaveText('••••••');
      await remote.press('BACK');
      await expect(keyboard).toHaveCount(0);
    });

    // Step 51: a field low on the screen, and the caret.
    const app = page.locator('#app');
    const field = (n: number) => page.locator('[data-testid=onboarding] .z-field').nth(n);
    const lift = () => app.evaluate((el) => (el as HTMLElement).style.transform);
    const width = (n: number) => input(n).evaluate((el) => el.getBoundingClientRect().width);
    const long = 'http://a-very-long-provider-name.example.com:8080/get.php?username=someone&password=secret&type=m3u_plus&output=ts&extra=parameters-for-a-longer-link';
    const box = async (locator: ReturnType<typeof page.locator>) => {
      const b = await locator.boundingBox();
      expect(b).not.toBeNull();
      return { left: b!.x, right: b!.x + b!.width, top: b!.y, bottom: b!.y + b!.height };
    };

    await test.step('a field the panel would cover moves above it, and back when the keyboard closes', async () => {
      await remote.expectFocus('form/fields/2');
      const before = await box(field(2));
      await remote.press('OK');
      await expect(keyboard).toBeVisible();
      const panel = await box(keyboard);
      // Without the lift the password field and its note would be under the panel.
      expect(before.bottom).toBeGreaterThan(panel.top);
      const lifted = await box(field(2));
      expect(lifted.bottom).toBeLessThanOrEqual(panel.top - 24 + 1);
      expect(lifted.bottom).toBeGreaterThan(panel.top - 24 - 2);
      expect(await lift()).toMatch(/^translateY\(-\d+px\)$/);
      await page.screenshot({ path: path.join(SHOTS, `keyboard-lift-${tag}.png`), animations: 'disabled' });
      await remote.press('BACK');
      await expect(keyboard).toHaveCount(0);
      expect(await lift()).toBe('');
      expect(await box(field(2))).toEqual(before);
      // A field high on the screen stays where it is.
      await remote.go('UP', 'form/fields/1');
      await remote.go('UP', 'form/fields/0');
      const top = await box(field(0));
      await remote.press('OK');
      await expect(keyboard).toBeVisible();
      expect(await lift()).toBe('');
      expect(await box(field(0))).toEqual(top);
    });

    await test.step('the field draws what is typed with a caret at its end; a long link shows its end', async () => {
      const typed = field(0).locator('.z-field__typed');
      const line = typed.locator('span').first();
      const caret = typed.locator('.z-field__caret');
      await expect(typed).toBeVisible();
      await expect(caret).toBeVisible();
      // The input is still there (the keyboard writes into it), drawn by the field instead.
      expect(await width(0)).toBe(0);
      for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
      await expect(input(0)).toHaveValue('');
      await page.keyboard.type('tv.x');
      await expect(typed).toHaveText('tv.x');
      const area = await box(typed);
      const text = await box(line);
      const at = await box(caret);
      // The caret ends the text: a link reads left to right, so on its right.
      expect(Math.abs(at.right - text.right)).toBeLessThanOrEqual(1);
      expect(at.left).toBeGreaterThan(text.left + 20);
      // Short, the text sits on the label's side: the left in English, the right in Arabic.
      if (arabicUi) expect(Math.abs(text.right - area.right)).toBeLessThanOrEqual(1);
      else expect(Math.abs(text.left - area.left)).toBeLessThanOrEqual(1);
      await page.keyboard.type(long.slice(4));
      await expect(input(0)).toHaveValue(`tv.x${long.slice(4)}`);
      const far = await box(caret);
      // Longer than the box: its end and the caret stay in sight at the box's right edge.
      expect((await box(line)).right - (await box(line)).left).toBeGreaterThan(area.right - area.left);
      expect(far.right).toBeLessThanOrEqual(area.right + 1);
      expect(far.right).toBeGreaterThan(area.right - 4);
      // The keyboard's own line shows the end too.
      const strip = await box(page.locator('.z-kbd__text'));
      const shown = await box(page.locator('.z-kbd__text > span'));
      expect(shown.right).toBeLessThanOrEqual(strip.right);
      expect(shown.right).toBeGreaterThan(strip.right - 24 - 2);
      expect(shown.left).toBeLessThan(strip.left - 100);
      // What spills is cut inside the box's padding (the field) and inside the line's side margin (the panel).
      const drawnAt = (x: number, y: number, selector: string) =>
        page.evaluate(({ x, y, selector }) => document.elementFromPoint(x, y)?.closest(selector) != null, { x, y, selector });
      const middle = (b: { top: number; bottom: number }) => (b.top + b.bottom) / 2;
      expect(await drawnAt(area.left + 10, middle(area), '.z-field__typed')).toBe(true);
      expect(await drawnAt(area.left - 10, middle(area), '.z-field__typed')).toBe(false);
      expect(await drawnAt(strip.left + 40, middle(strip), '.z-kbd__text > span')).toBe(true);
      expect(await drawnAt(strip.left + 10, middle(strip), '.z-kbd__text > span')).toBe(false);
      await page.screenshot({ path: path.join(SHOTS, `keyboard-caret-${tag}.png`), animations: 'disabled' });
    });

    await test.step('the key that hands over to the TV keyboard shows the input again, focused and typable', async () => {
      await keyboard.locator('.z-kbd__key', { hasText: /^⌨$/ }).click();
      await expect(keyboard).toHaveCount(0);
      await expect(onboarding).toHaveAttribute('data-editing', 'onboarding-server');
      await expect(field(0).locator('.z-field__typed')).toHaveCount(0);
      await expect(input(0)).toBeFocused();
      await expect(input(0)).not.toHaveAttribute('readonly', '');
      expect(await width(0)).toBeGreaterThan(400);
      await page.keyboard.press('End');
      await page.keyboard.type('z');
      await expect(input(0)).toHaveValue(`tv.x${long.slice(4)}z`);
      await page.keyboard.press('Enter');
      await expect(onboarding).toHaveAttribute('data-editing', '');
      await expect(input(0)).toHaveAttribute('readonly', '');
    });
  });
}
