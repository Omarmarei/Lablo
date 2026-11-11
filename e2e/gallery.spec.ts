import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { isolateText } from '../packages/core/src/bidi';
import type { BidiState } from '../tools/engines/src/gallery';
import { BIDI_EXPRESSION, bidiFailures } from '../tools/engines/src/gallery';
import { ARABIC_FACE, LATIN_FACE, renderedFontsUnder } from './fonts';

/**
 * The component gallery (`?screen=gallery`, RELAY step 11b) in the dev app: every base
 * component in English, Arabic and the en-XA pseudo-locale. Each run writes the screenshots
 * to artifacts/screenshots (CI uploads them as `gallery-screenshots`); docs/design keeps the
 * step-11b ones.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

/** How the i18n runtime puts text into an English sentence: FSI/PDI plus marks (core's isolateText). */
function isolated(text: string): string {
  return isolateText(text, 'ltr');
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openGallery(page: Page, locale: string): Promise<Locator> {
  await page.goto(`/?screen=gallery&locale=${locale}`);
  const gallery = page.getByTestId('gallery');
  await expect(gallery).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return gallery;
}

interface Layout {
  readonly scroll: readonly [number, number];
  /** Boxes outside the title-safe area. */
  readonly outside: string[];
  /** Labels whose text is cut (scrollWidth over clientWidth). */
  readonly cut: string[];
  /** Channel names squeezed by their badges: cut while narrower than half their line. */
  readonly squeezed: string[];
}

/** Every component's box and every label that must never be cut. */
function layout(page: Page): Promise<Layout> {
  return page.evaluate((safe) => {
    const name = (el: Element): string => `${el.className}: ${(el.textContent ?? '').slice(0, 40)}`;
    const boxes = '.z-button, .z-chip, .z-row, .z-tile, .z-progress, .z-spinner, .gallery__badges > .z-badge, .gallery__header > *, .gallery__section';
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll(boxes))) {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left || r.top < safe.top || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(name(el));
    }
    // Badges that wrapped past their two lines are hidden by the container: as bad as outside.
    const badges = document.querySelector('.gallery__badges')?.getBoundingClientRect();
    for (const el of Array.from(document.querySelectorAll('.gallery__badges > .z-badge'))) {
      if (badges !== undefined && el.getBoundingClientRect().bottom > badges.bottom + 0.5) outside.push(name(el));
    }
    const labels = '.z-button__label, .z-dialog__title, .gallery__title, .gallery__section, .gallery__meter-head > span, .z-badge, .z-row__next-head, .gallery__meta';
    const cut = Array.from(document.querySelectorAll(labels))
      .filter((el) => !el.closest('.z-row__badges') && el.scrollWidth > el.clientWidth + 1)
      .map(name);
    const squeezed = Array.from(document.querySelectorAll('.z-row__name'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth < (el.parentElement?.clientWidth ?? 0) / 2)
      .map(name);
    return { scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const, outside, cut, squeezed };
  }, SAFE);
}

/**
 * Text that doesn't come through the i18n catalogs: in en-XA every string of ours is
 * bracketed, so any other text with letters, outside `translate="no"` (the provider's names
 * and technical marks), is hard-coded.
 */
function untranslated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid=gallery]');
    if (root === null) return ['no gallery'];
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

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (b === null) throw new Error('no box');
  return b;
}

test.describe('the component gallery (pnpm dev, ?screen=gallery)', () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
    ['en-XA', 'pseudo', 'ltr'],
  ] as const) {
    test(`shows every component inside the safe area, in Lablo Sans (${locale})`, async ({ page }) => {
      const errors = trackErrors(page);
      const gallery = await openGallery(page, locale);
      await expect(gallery).toHaveAttribute('data-language', language);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(gallery).toHaveAttribute('data-dir', dir);

      // Every kind of component is on the screen.
      for (const selector of ['.z-button', '.z-chip', '.z-row', '.z-tile', '.z-progress', '.z-spinner', '.z-badge']) {
        await expect(page.locator(selector).first(), selector).toBeVisible();
      }
      // The four actions and the language switch, which offers the other language by its own name.
      await expect(page.locator('.z-button')).toHaveCount(5);
      await expect(page.locator('.z-button.is-disabled')).toHaveCount(1);
      await expect(page.getByTestId('language')).toHaveText(language === 'ar' ? 'English' : 'العربية');
      await expect(page.locator('.z-tile')).toHaveCount(6);
      // The virtual lists draw only their windows: 7 of 240 channels, 6 of 9 categories.
      await expect(page.locator('[data-testid=channels] .z-row')).toHaveCount(7);
      await expect(page.locator('[data-testid=rail] .z-chip')).toHaveCount(6);
      await expect(page.getByTestId('channels')).toHaveAttribute('data-count', '240');
      // The catalogs' plurals and the locale's formats (Western digits in Arabic, ADR-011).
      const formatted = {
        'en-US': ['240 channels', '35%', '1:13:12 / 2:00:00', 'Expires in 3 days'],
        'ar-SA': ['240 قناةً', '35%', '1:13:12 / 2:00:00', 'ينتهي خلال 3 أيام'],
        'en-XA': ['240 çĥåññéļš', '35%', '1:13:12 / 2:00:00', 'Éxþîŕéš îñ 3 ðåýš'],
      }[locale];
      for (const text of formatted) await expect(gallery, text).toContainText(text);

      // Nothing scrolls, nothing leaves the safe area, no label of ours is cut.
      const facts = await layout(page);
      expect(facts).toEqual({ scroll: [1920, 1080], outside: [], cut: [], squeezed: [] });
      // Every glyph comes from the bundled faces: no system fallback for any accent or letter.
      expect((await renderedFontsUnder(page, '[data-testid=gallery]')).map((f) => [f.familyName, f.isCustomFont])).toEqual([
        [LATIN_FACE, true],
        [ARABIC_FACE, true],
      ]);

      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('row-1')).toHaveAttribute('data-state', 'focused');
      // Transitions finished, so a screenshot never catches a ring fading out.
      await page.screenshot({ path: path.join(SHOTS, `gallery-${locale}.png`), animations: 'disabled' });

      // The dialog over it, with the row it came from as the remembered item.
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('play-dialog')).toBeVisible();
      await expect(page.getByTestId('dialog-0')).toHaveAttribute('data-state', 'focused');
      await expect(page.getByTestId('row-1')).toHaveAttribute('data-state', 'memory');
      expect((await layout(page)).cut).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `gallery-${locale}-dialog.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('play-dialog')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('marks every string of ours in en-XA, which catches hard-coded text', async ({ page }) => {
    await openGallery(page, 'en-XA');
    expect(await untranslated(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('play-dialog')).toBeVisible();
    expect(await untranslated(page)).toEqual([]);
    // The same check in English finds our strings, so it can fail.
    await openGallery(page, 'en-US');
    expect(await untranslated(page)).toEqual(expect.arrayContaining(['Components', 'Play', 'Continue watching']));
  });

  test('mirrors the layout in Arabic, and keeps the media timeline left to right', async ({ page }) => {
    for (const dir of ['ltr', 'rtl'] as const) {
      await openGallery(page, dir === 'ltr' ? 'en-US' : 'ar-SA');
      const before = (a: { x: number }, b: { x: number }): boolean => (dir === 'ltr' ? a.x < b.x : a.x > b.x);
      // Columns, rows of buttons and chips, and the parts of a channel row run from the inline start.
      expect(before(await box(page.getByTestId('channels')), await box(page.getByTestId('tile-0')))).toBe(true);
      expect(before(await box(page.getByTestId('action-0')), await box(page.getByTestId('action-1')))).toBe(true);
      expect(before(await box(page.getByTestId('chip-0')), await box(page.getByTestId('chip-1')))).toBe(true);
      expect(before(await box(page.getByTestId('tile-0')), await box(page.getByTestId('tile-1')))).toBe(true);
      const row = page.getByTestId('row-0');
      expect(before(await box(row.locator('.z-row__number')), await box(row.locator('.z-row__name')))).toBe(true);
      expect(before(await box(row.locator('.z-row__name')), await box(row.locator('.z-row__next')))).toBe(true);
      // The header reads "<locale> · 240 channels" from the inline start: the count must not join
      // the Latin locale tag's run in Arabic (bidi rule W7 without the tag's dir isolation).
      const meta = await page.locator('.gallery__meta').evaluate((p) => {
        const tag = p.querySelector('[translate=no]');
        const text = [...p.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? '').includes('240'));
        if (tag === null || text === undefined) return null;
        const range = document.createRange();
        const at = (text.nodeValue ?? '').indexOf('240');
        range.setStart(text, at);
        range.setEnd(text, at + 3);
        return { tag: tag.getBoundingClientRect().x, count: range.getBoundingClientRect().x };
      });
      expect(meta).not.toBeNull();
      if (meta !== null) expect(before({ x: meta.tag }, { x: meta.count })).toBe(true);
      // A progress bar fills from the inline start; the media timeline always from the left.
      const loading = await box(page.getByTestId('progress-loading'));
      const loadingFill = await box(page.getByTestId('progress-loading').locator('.z-progress__fill'));
      const media = await box(page.getByTestId('progress-media'));
      const mediaFill = await box(page.getByTestId('progress-media').locator('.z-progress__fill'));
      if (dir === 'ltr') expect(loadingFill.x).toBeCloseTo(loading.x, 0);
      else expect(loadingFill.x + loadingFill.width).toBeCloseTo(loading.x + loading.width, 0);
      expect(mediaFill.x).toBeCloseTo(media.x, 0);
      expect(mediaFill.width).toBeCloseTo(media.width * 0.61, 0);
      // Back on the root asks first in the browser; the dialog's buttons mirror too.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('exit-dialog')).toBeVisible();
      expect(before(await box(page.getByTestId('dialog-0')), await box(page.getByTestId('dialog-1')))).toBe(true);
    }
  });

  test('switches the language live by keys, with no reload, and keeps the focus on the switch', async ({ page }) => {
    const errors = trackErrors(page);
    const gallery = await openGallery(page, 'en-US');
    const html = page.locator('html');
    const button = page.getByTestId('language');
    // A reload would drop this.
    await page.evaluate(() => Object.assign(window, { labloSamePage: true }));
    // From the first channel: UP to the rail, UP to the actions, RIGHT past Record to the switch.
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(key);
    await expect(gallery).toHaveAttribute('data-zone', 'language');
    await expect(button).toHaveAttribute('data-state', 'focused');
    await expect(button.locator('.z-button__label')).toHaveAttribute('lang', 'ar');
    await expect(button.locator('.z-button__label')).toHaveAttribute('translate', 'no');

    await page.keyboard.press('Enter');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar-US');
    await expect(gallery).toHaveAttribute('data-language', 'ar');
    await expect(gallery).toHaveAttribute('data-dir', 'rtl');
    await expect(page.locator('.gallery__title')).toHaveText('المكوّنات');
    await expect(gallery).toContainText('240 قناةً');
    await expect(button).toHaveText('English');
    // The focus stayed put, and the layout mirrored around it: the switch is now at the left end.
    await expect(gallery).toHaveAttribute('data-zone', 'language');
    await expect(gallery).toHaveAttribute('data-index', '0');
    await expect(button).toHaveAttribute('data-state', 'focused');
    expect((await box(page.getByTestId('channels'))).x).toBeGreaterThan((await box(page.getByTestId('tile-0'))).x);
    expect((await box(page.getByTestId('action-0'))).x).toBeGreaterThan((await box(page.getByTestId('action-3'))).x);
    expect((await box(button)).x).toBeLessThan((await box(page.getByTestId('action-3'))).x);
    expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [], squeezed: [] });
    await page.screenshot({ path: path.join(SHOTS, 'gallery-switched-ar.png'), animations: 'disabled' });

    // The remote's LEFT and RIGHT mirrored with it: RIGHT now goes back towards the actions.
    await page.keyboard.press('ArrowRight');
    await expect(gallery).toHaveAttribute('data-zone', 'actions');
    await expect(page.getByTestId('action-3')).toHaveAttribute('data-state', 'focused');
    await page.keyboard.press('ArrowLeft');
    await expect(button).toHaveAttribute('data-state', 'focused');

    // And back to English, the TV's own locale.
    await page.keyboard.press('Enter');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(html).toHaveAttribute('lang', 'en-US');
    await expect(gallery).toHaveAttribute('data-language', 'en');
    await expect(gallery).toContainText('240 channels');
    await expect(button).toHaveText('العربية');
    await expect(button).toHaveAttribute('data-state', 'focused');
    expect((await box(page.getByTestId('channels'))).x).toBeLessThan((await box(page.getByTestId('tile-0'))).x);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('action-3')).toHaveAttribute('data-state', 'focused');
    expect(await page.evaluate(() => (window as { labloSamePage?: boolean }).labloSamePage)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('switches from Arabic to English in the TV’s region, and from en-XA to Arabic', async ({ page }) => {
    for (const [locale, tag, language] of [
      ['ar-SA', 'en-SA', 'en'],
      ['en-XA', 'ar', 'ar'],
    ] as const) {
      const gallery = await openGallery(page, locale);
      await page.getByTestId('language').click();
      await expect(page.locator('html')).toHaveAttribute('lang', tag);
      await expect(gallery).toHaveAttribute('data-language', language);
      await expect(gallery).toHaveAttribute('data-zone', 'language');
      await expect(page.locator('.gallery__meta')).toContainText(tag);
    }
  });

  test('isolates text arguments in current Chromium too (the old-engine harness’s bidi probe)', async ({ page }) => {
    await openGallery(page, 'ar-SA');
    const children = (): Promise<number> => page.locator('.gallery > *').count();
    const before = await children();
    const bidi = JSON.parse(await page.evaluate<string>(BIDI_EXPRESSION)) as BidiState;
    expect(bidiFailures(bidi)).toEqual([]);
    // The probe cleaned up after itself.
    expect(await children()).toBe(before);
  });

  test('scrolls the virtual lists with the keys and the wheel', async ({ page }) => {
    const errors = trackErrors(page);
    const gallery = await openGallery(page, 'en-US');
    const channels = page.getByTestId('channels');
    for (let i = 0; i < 9; i += 1) await page.keyboard.press('ArrowDown');
    await expect(gallery).toHaveAttribute('data-index', '9');
    await expect(channels).toHaveAttribute('data-top', '3');
    await expect(page.getByTestId('row-2')).toHaveCount(0);
    await expect(page.getByTestId('row-9')).toHaveAttribute('data-state', 'focused');
    // CH_DOWN pages by a window, the window following.
    await page.keyboard.press('PageDown');
    await expect(gallery).toHaveAttribute('data-index', '16');
    await expect(channels).toHaveAttribute('data-top', '10');
    await expect(page.locator('[data-testid=channels] .z-row')).toHaveCount(7);
    // The wheel moves the window and keeps the focus inside it (the pointer rests off the items).
    await page.mouse.move(1900, 1070);
    await page.mouse.wheel(0, -120);
    await expect(channels).toHaveAttribute('data-top', '9');
    await expect(gallery).toHaveAttribute('data-index', '15');
    // The rail scrolls its window of chips towards the end.
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('PageUp');
    await expect(gallery).toHaveAttribute('data-index', '0');
    await page.keyboard.press('ArrowUp');
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
    await expect(gallery).toHaveAttribute('data-zone', 'rail');
    await expect(page.getByTestId('rail')).toHaveAttribute('data-top', '3');
    await expect(page.getByTestId('chip-8')).toHaveAttribute('data-state', 'focused');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('chip-8')).toHaveClass(/is-selected/);
    await expect(page.getByTestId('gallery-status')).toHaveText(`Selected: ${isolated('Radio')}`);
    expect(errors).toEqual([]);
  });

  test('selects with the pointer, once per press when webOS also sends the OK key', async ({ page }) => {
    const errors = trackErrors(page);
    const gallery = await openGallery(page, 'en-US');
    const status = page.getByTestId('gallery-status');
    await page.getByTestId('tile-4').hover();
    await expect(gallery).toHaveAttribute('data-zone', 'tiles');
    await expect(gallery).toHaveAttribute('data-index', '4');
    await expect(gallery).toHaveAttribute('data-pointer', 'true');

    // A click focuses and selects.
    await page.getByTestId('tile-2').click();
    await expect(status).toHaveAttribute('data-selects', '1');
    await expect(status).toHaveText(`Selected: ${isolated('Ocean Deep')}`);
    // The Magic Remote's OK: a click and key 13 for one press, in either order. One select each.
    await page.keyboard.press('Enter');
    await expect(status).toHaveAttribute('data-selects', '1');
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    await page.getByTestId('tile-1').click();
    await expect(status).toHaveAttribute('data-selects', '2');
    await expect(status).toHaveText(`Selected: ${isolated('Ocean Deep')}`);
    await expect(gallery).toHaveAttribute('data-index', '1');
    // Two clicks are two presses.
    await page.waitForTimeout(600);
    await page.getByTestId('tile-1').click();
    await expect(status).toHaveAttribute('data-selects', '3');

    // The disabled button doesn't select; a channel row opens its dialog, whose buttons click too.
    await page.waitForTimeout(600);
    // Playwright won't click an aria-disabled element unless forced; the pointer still can.
    await page.getByTestId('action-3').click({ force: true });
    await expect(gallery).toHaveAttribute('data-zone', 'actions');
    await expect(status).toHaveAttribute('data-selects', '3');
    await page.getByTestId('row-4').click();
    await expect(page.getByTestId('play-dialog')).toContainText(`Play ${isolated('Lablo Documentary Channel International Extra Long Name')}?`);
    await page.getByTestId('dialog-1').click();
    await expect(page.getByTestId('play-dialog')).toHaveCount(0);
    await expect(status).toHaveAttribute('data-selects', '5');
    // Arrow keys take over from the pointer where it was.
    await page.keyboard.press('ArrowDown');
    await expect(gallery).toHaveAttribute('data-pointer', 'false');
    await expect(gallery).toHaveAttribute('data-index', '5');
    expect(errors).toEqual([]);
  });
});
