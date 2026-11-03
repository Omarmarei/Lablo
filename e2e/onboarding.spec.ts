import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { stripIsolates } from '../packages/core/src/bidi';
import { ARABIC_FACE, LATIN_FACE, renderedFontsUnder } from './fonts';

/**
 * Onboarding (RELAY step 13a), the start screen of the dev app, by keys only: the language, the
 * disclaimer, the device-ID consent, the source type, the form typed on the keyboard (OK opens a
 * field, Enter ends it), then loading and done. Step 13a loads through a fake loader (1,240
 * channels, 380 films, 45 series); step 13b puts the mock provider behind it.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function open(page: Page, locale: string): Promise<Locator> {
  await page.goto(`/?locale=${locale}`);
  const root = page.getByTestId('onboarding');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return root;
}

/** Where the remote's focus is: `screen · zone index`, and the field being edited. */
async function focus(root: Locator): Promise<string> {
  const [screen, zone, index, editing] = await Promise.all(['data-screen', 'data-zone', 'data-index', 'data-editing'].map((a) => root.getAttribute(a)));
  return `${screen ?? ''} · ${zone ?? ''} ${index ?? ''}${editing ? ` editing ${editing}` : ''}`;
}

async function keys(page: Page, ...names: string[]): Promise<void> {
  for (const name of names) await page.keyboard.press(name);
}

/** OK on the focused field, type, Enter: the remote's way, with the desktop keyboard. */
async function typeInto(page: Page, root: Locator, field: string, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-editing', `onboarding-${field}`);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(`onboarding-${field}`);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-editing', '');
}

interface Layout {
  readonly scroll: readonly [number, number];
  readonly outside: string[];
  readonly cut: string[];
}

/** Every box inside the safe area, no page scroll, no label of ours cut. */
function layout(page: Page): Promise<Layout> {
  return page.evaluate((safe) => {
    const name = (el: Element): string => `${el.className}: ${(el.textContent ?? '').slice(0, 40)}`;
    const boxes = '.z-button, .z-field, .z-progress, .z-spinner, .onboarding__title, .onboarding__text, .onboarding__note, .onboarding__counts';
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll(boxes))) {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left || r.top < safe.top || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(name(el));
    }
    const cut = Array.from(document.querySelectorAll('.z-button__label, .onboarding__title, .z-field__label, .z-field__note'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(name);
    return { scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const, outside, cut };
  }, SAFE);
}

/** In en-XA every string of ours is bracketed: any other text with letters is hard-coded. */
function untranslated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid=onboarding]');
    if (root === null) return ['no onboarding'];
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(text) || node.parentElement?.closest('[translate="no"]') != null) continue;
      if (!(text.startsWith('[') && text.endsWith(']'))) out.push(text);
    }
    return out;
  });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `onboarding-${name}.png`), animations: 'disabled' });
}

async function checkScreen(page: Page, name: string): Promise<void> {
  expect(await layout(page), name).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
  await shot(page, name);
}

test.describe('onboarding by keys (pnpm dev, the start screen)', () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`walks the whole flow in ${language}, typing the login on the keyboard (${locale})`, async ({ page }) => {
      const errors = trackErrors(page);
      const root = await open(page, locale);
      const ar = language === 'ar';
      // The TV's language is focused first; both languages offer themselves in their own words.
      expect(await focus(root)).toBe(`language · languages ${ar ? 1 : 0}`);
      await expect(page.getByTestId('choose-en')).toHaveText('Choose your language');
      await expect(page.getByTestId('choose-ar')).toHaveText('اختر لغتك');
      await expect(page.getByTestId('language-en')).toHaveText('English');
      await expect(page.getByTestId('language-ar')).toHaveText('العربية');
      await checkScreen(page, `${locale}-language`);

      await keys(page, 'Enter');
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(root).toHaveAttribute('data-language', language);
      expect(await focus(root)).toBe('disclaimer · actions 0');
      await expect(page.getByTestId('onboarding-title')).toHaveText(ar ? 'زوما مشغّل وسائط' : 'Zoma is a player');
      await expect(root).toContainText(ar ? 'لا يقدّم زوما أي قنوات' : 'Zoma provides no channels');
      await checkScreen(page, `${locale}-disclaimer`);

      await keys(page, 'Enter');
      expect(await focus(root)).toBe('consent · actions 0');
      await expect(root).toContainText(ar ? 'النسخ الاحتياطي مفعّل افتراضيًا' : 'The backup is on by default');
      // The buttons' row mirrors in Arabic: "Not now" is to the left of "Allow" there.
      await keys(page, ar ? 'ArrowLeft' : 'ArrowRight');
      expect(await focus(root)).toBe('consent · actions 1');
      await keys(page, ar ? 'ArrowRight' : 'ArrowLeft');
      await checkScreen(page, `${locale}-consent`);
      await keys(page, 'Enter');

      expect(await focus(root)).toBe('source · types 0');
      await expect(page.getByTestId('type-hint')).toHaveText(ar ? 'عنوان خادم واسم مستخدم وكلمة مرور' : 'A server address, a username and a password');
      await keys(page, 'ArrowDown');
      await expect(page.getByTestId('type-hint')).toHaveText(ar ? 'رابط إلى ملف قائمة تشغيل' : 'A link to a playlist file');
      await keys(page, 'ArrowUp', 'Enter');

      // The Xtream form: OK opens a field (DOM focus: the TV's keyboard), Enter ends it and moves on.
      expect(await focus(root)).toBe('form · fields 0');
      await expect(page.locator('.z-field')).toHaveCount(5);
      await typeInto(page, root, 'server', 'provider.example:8080');
      expect(await focus(root)).toBe('form · fields 1');
      await typeInto(page, root, 'username', 'user1');
      await typeInto(page, root, 'password', 'pw-123');
      expect(await focus(root)).toBe('form · fields 3');
      await expect(page.locator('#onboarding-password')).toHaveAttribute('type', 'password');
      // A guide link with a space: refused on the TV, before anything is fetched.
      await typeInto(page, root, 'epg', 'provider.example/xml tv.php');
      await keys(page, 'ArrowDown', 'Enter');
      expect(await focus(root)).toBe('form · fields 3');
      await expect(page.getByTestId('field-epg')).toHaveClass(/is-invalid/);
      await expect(page.getByTestId('field-epg').locator('.z-field__note')).toHaveText(ar ? 'لا يمكن أن يحتوي الرابط على مسافات' : "A link can't contain spaces");
      await checkScreen(page, `${locale}-form-error`);

      // Backspace deletes inside the field (it is Back elsewhere): the form stays.
      await keys(page, 'Enter');
      for (let i = 0; i < 'xml tv.php'.length; i++) await page.keyboard.press('Backspace');
      await page.keyboard.type('xmltv.php');
      await keys(page, 'Enter');
      expect(await focus(root)).toBe('form · fields 4');
      await expect(page.locator('#onboarding-epg')).toHaveValue('provider.example/xmltv.php');
      await expect(page.getByTestId('field-epg')).not.toHaveClass(/is-invalid/);
      // A name in Arabic reads right to left in its own field.
      await typeInto(page, root, 'name', 'البيت');
      await expect(page.locator('#onboarding-name')).toHaveAttribute('dir', 'auto');
      await expect(page.locator('#onboarding-server')).toHaveAttribute('dir', 'ltr');
      expect(await focus(root)).toBe('form · actions 0');
      await keys(page, 'Enter');

      // Loading through the fake loader, then the counts. The source's name is isolated.
      await expect(root).toHaveAttribute('data-screen', /loading|done/);
      await expect(root).toHaveAttribute('data-screen', 'done');
      expect(await focus(root)).toBe('done · actions 0');
      const title = stripIsolates((await page.locator('.onboarding__text').first().textContent()) ?? '');
      expect(title).toBe(ar ? 'البيت جاهز.' : 'البيت is ready.');
      await expect(page.getByTestId('done-live')).toHaveText(ar ? '1,240 قناةً' : '1,240 channels');
      await expect(page.getByTestId('done-movies')).toHaveText(ar ? '380 فيلمًا' : '380 films');
      await expect(page.getByTestId('done-series')).toHaveText(ar ? '45 مسلسلًا' : '45 series');
      await checkScreen(page, `${locale}-done`);
      // Every glyph from the bundled faces.
      const faces = (await renderedFontsUnder(page, '[data-testid=onboarding]')).map((f) => [f.familyName, f.isCustomFont]);
      expect(faces).toContainEqual([LATIN_FACE, true]);
      expect(faces).toContainEqual([ARABIC_FACE, true]);
      expect(faces.every(([, custom]) => custom)).toBe(true);

      // Done is the new root: Back offers to exit instead of going back into onboarding.
      await keys(page, 'Escape');
      expect(await focus(root)).toBe('exit · actions 0');
      await keys(page, 'Enter');
      expect(await focus(root)).toBe('done · actions 0');
      // Start watching: until step 14's live screen, the hello screen.
      await keys(page, 'Enter');
      await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
      expect(errors).toEqual([]);
    });
  }

  test('picking the other language switches the app live, and Back keeps the choice', async ({ page }) => {
    const root = await open(page, 'en-US');
    await keys(page, 'ArrowRight', 'Enter');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-US');
    await expect(root).toHaveAttribute('data-language', 'ar');
    await expect(page.getByTestId('onboarding-title')).toHaveText('زوما مشغّل وسائط');
    await keys(page, 'Escape');
    expect(await focus(root)).toBe('language · languages 1');
    // Back on the language screen keeps Arabic until another language is picked.
    await expect(root).toHaveAttribute('data-language', 'ar');
    // In Arabic RIGHT goes back to the start of the row: English.
    await keys(page, 'ArrowRight', 'Enter');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(page.getByTestId('onboarding-title')).toHaveText('Zoma is a player');
  });

  test('Back goes one screen back, through every screen to the exit dialog', async ({ page }) => {
    const root = await open(page, 'en-US');
    await keys(page, 'Enter', 'Enter', 'Enter', 'ArrowDown', 'Enter');
    expect(await focus(root)).toBe('form · fields 0');
    await expect(page.locator('.z-field')).toHaveCount(3);
    for (const screen of ['source · types 1', 'consent · actions 0', 'disclaimer · actions 0', 'language · languages 0', 'exit · actions 0']) {
      await keys(page, 'Escape');
      expect(await focus(root)).toBe(screen);
    }
    await expect(page.getByTestId('exit-dialog')).toBeVisible();
  });

  test('a field holds the keys while it is edited: Escape ends the edit and keeps the text', async ({ page }) => {
    const root = await open(page, 'en-US');
    await keys(page, 'Enter', 'Enter', 'Enter', 'ArrowDown', 'Enter');
    await keys(page, 'Enter');
    await page.keyboard.type('p.example/a');
    // Arrows left and right move the caret, not the focus; Backspace deletes.
    await keys(page, 'ArrowLeft', 'ArrowLeft', 'Backspace', 'ArrowRight');
    await expect(page.locator('#onboarding-playlist')).toHaveValue('p.exampl/a');
    expect(await focus(root)).toBe('form · fields 0 editing onboarding-playlist');
    await keys(page, 'Escape');
    expect(await focus(root)).toBe('form · fields 0');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    await expect(page.locator('#onboarding-playlist')).toHaveValue('p.exampl/a');
    // ArrowDown ends an edit too, and moves on.
    await keys(page, 'Enter', 'ArrowDown');
    expect(await focus(root)).toBe('form · fields 1');
  });

  test('a pointer click opens a field, and its twin OK key is the same press', async ({ page }) => {
    const root = await open(page, 'en-US');
    await keys(page, 'Enter', 'Enter', 'Enter', 'Enter');
    // A click within 500 ms of the last OK key would be that key's twin (step 11b).
    await page.waitForTimeout(600);
    await page.getByTestId('field-username').click();
    expect(await focus(root)).toBe('form · fields 1 editing onboarding-username');
    // webOS sends key 13 with the Magic Remote's click: it must not end the edit just opened.
    await keys(page, 'Enter');
    expect(await focus(root)).toBe('form · fields 1 editing onboarding-username');
    await page.keyboard.type('u');
    await keys(page, 'Enter');
    expect(await focus(root)).toBe('form · fields 2');
  });

  test('marks every string of ours in en-XA, on every screen, which catches hard-coded text', async ({ page }) => {
    const root = await open(page, 'en-XA');
    const check = async (name: string): Promise<void> => {
      expect(await untranslated(page), name).toEqual([]);
      expect(await layout(page), name).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
    };
    await check('language');
    await shot(page, 'en-XA-language');
    await keys(page, 'Enter');
    await check('disclaimer');
    await keys(page, 'Enter');
    await check('consent');
    await shot(page, 'en-XA-consent');
    await keys(page, 'Enter');
    await check('source');
    await keys(page, 'Enter');
    await keys(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
    await expect(page.getByTestId('field-server')).toHaveClass(/is-invalid/);
    await check('form');
    await shot(page, 'en-XA-form-error');
    // The same check in English finds our strings, so it can fail.
    await open(page, 'en-US');
    await keys(page, 'Enter');
    expect(await untranslated(page)).toEqual(expect.arrayContaining(['Zoma is a player', 'I understand']));
    await expect(root).toHaveAttribute('data-language', 'en');
  });
});
