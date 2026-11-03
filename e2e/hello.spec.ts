import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { ARABIC_FACE, TITLE_FONTS, renderedFonts } from './fonts';

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
    await page.goto('/?screen=hello');

    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('platform-id')).toHaveText('browser');
    await expect(page.getByTestId('info-platform')).toHaveText('browser');
    await expect(page.getByTestId('info-model')).toHaveText('Desktop browser');
    await expect(page.getByTestId('info-tier')).toHaveText('full');
    await expect(page.getByTestId('info-chromiumVersion')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('worker-status')).toHaveText(/^ok in \d+ ms \(.*TextDecoder.*indexedDB.*\)$/);
    await expect(page.getByTestId('idb-status')).toHaveText('ok');
    // The data workers started: the query worker answers, and the start-up prune ran.
    await expect(page.getByTestId('data-status')).toHaveText('ok: 0 sources, 0 items');
    await expect(page.getByTestId('ingest-status')).toHaveText(/^none: /);
    await expect(page.getByTestId('search-status')).toHaveText(/^none: /);
    expect(errors).toEqual([]);
  });

  test('maps the keyboard to remote Intents', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?screen=hello');
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

    // Enter opened a details screen; Back closes it. Back on the root then follows the
    // platform: the browser, like Tizen, asks first, and the dialog's Exit asks the platform
    // to exit (a no-op in the browser).
    const focus = page.getByTestId('focus-status');
    await expect(focus).toHaveAttribute('data-screen', 'details');
    await page.keyboard.press('Escape');
    await expect(lastIntent).toHaveText('BACK');
    await expect(focus).toHaveAttribute('data-screen', 'home');
    await expect(page.getByTestId('exit-dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('exit-dialog')).toBeVisible();
    await expect(focus).toHaveText('exit · buttons 0');
    // Stay closes the dialog.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('exit-dialog')).toHaveCount(0);
    await expect(page.getByTestId('exit-requested')).toHaveCount(0);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowRight');
    await expect(focus).toHaveText('exit · buttons 1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('exit-requested')).toBeVisible();
    await expect(focus).toHaveText('home · grid 0');
    expect(errors).toEqual([]);
  });

  test('moves the focus with the keys, the pointer and the wheel', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?screen=hello');
    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    const focus = page.getByTestId('focus-status');
    await expect(focus).toHaveText('home · list 0');
    await expect(focus).toHaveAttribute('data-dir', 'ltr');

    // Keys: the list scrolls a window of 4 rows; each zone remembers its item.
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
    await expect(focus).toHaveText('home · list 5');
    await expect(page.getByTestId('list-5')).toHaveClass(/is-focused/);
    await expect(page.getByTestId('list-1')).toHaveCount(0);
    await expect(page.getByTestId('list-2')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(focus).toHaveText('home · grid 1');
    await expect(page.getByTestId('list-5')).toHaveClass(/is-memory/);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(focus).toHaveText('home · list 5');
    await page.keyboard.press('PageDown');
    await expect(focus).toHaveText('home · list 9');

    // OK opens a screen over this one; Back returns to the same item.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('details')).toContainText('Opened list 10');
    await expect(focus).toHaveText('details · buttons 0');
    await expect(focus).toHaveAttribute('data-depth', '2');
    await page.keyboard.press('Escape');
    await expect(focus).toHaveText('home · list 9');

    // Magic Remote: hovering focuses (the pointer counts once it moves); keys hide it and
    // carry on from the hovered item.
    await page.getByTestId('rail-3').hover();
    await expect(focus).toHaveText('home · rail 3');
    await expect(focus).toHaveAttribute('data-pointer', 'true');
    await page.getByTestId('grid-4').hover();
    await expect(focus).toHaveText('home · grid 4');
    await page.keyboard.press('ArrowLeft');
    await expect(focus).toHaveText('home · grid 3');
    await expect(focus).toHaveAttribute('data-pointer', 'false');

    // The wheel scrolls the focused list and keeps the focus in view.
    await page.keyboard.press('ArrowLeft');
    await expect(focus).toHaveText('home · list 9');
    await page.mouse.wheel(0, -120);
    await expect(focus).toHaveText('home · list 8');
    await expect(page.getByTestId('list-5')).toBeVisible();
    await expect(page.getByTestId('list-9')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('swaps LEFT and RIGHT once in Arabic (RTL)', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?screen=hello&locale=ar-SA');
    const focus = page.getByTestId('focus-status');
    await expect(focus).toHaveAttribute('data-dir', 'rtl');
    await expect(page.getByTestId('focus-panel')).toHaveAttribute('dir', 'rtl');
    // The rail runs from the right: LEFT goes towards its end, RIGHT back to its start.
    await page.keyboard.press('ArrowUp');
    await expect(focus).toHaveText('home · rail 0');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(focus).toHaveText('home · rail 2');
    const r1 = await page.getByTestId('rail-1').boundingBox();
    const r2 = await page.getByTestId('rail-2').boundingBox();
    expect(r2!.x).toBeLessThan(r1!.x);
    await page.keyboard.press('ArrowRight');
    await expect(focus).toHaveText('home · rail 1');
    // The grid sits on the list's left: LEFT enters it, RIGHT comes back. UP and DOWN don't swap.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(focus).toHaveText('home · list 1');
    await page.keyboard.press('ArrowLeft');
    await expect(focus).toHaveText('home · grid 0');
    const list = await page.getByTestId('list-1').boundingBox();
    const grid = await page.getByTestId('grid-0').boundingBox();
    expect(grid!.x).toBeLessThan(list!.x);
    await page.keyboard.press('ArrowRight');
    await expect(focus).toHaveText('home · list 1');
    expect(errors).toEqual([]);
  });

  for (const [locale, dir] of [
    ['en-US', 'ltr'],
    ['ar-SA', 'rtl'],
  ] as const) {
    test(`draws text in the bundled Zoma Sans faces and mirrors the layout by dir (${locale})`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto(`/?screen=hello&locale=${locale}`);
      await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
      // The app puts the locale on <html>; postcss-rtlcss's rules key on that dir.
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);

      // Latin in Noto Sans and Arabic in Noto Sans Arabic UI, both web fonts (no system fallback).
      expect(await renderedFonts(page, '[data-testid=title]')).toEqual(TITLE_FONTS);
      expect(await renderedFonts(page, '.hello__brand-ar')).toEqual([{ familyName: ARABIC_FACE, isCustomFont: true, glyphCount: 4 }]);

      // A mirrored rule: the panels' 48 px gap is on the inline end (right in LTR, left in RTL),
      // and the first panel sits on the inline start.
      const gaps = await page.locator('.hello__panel').first().evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.marginLeft, style.marginRight];
      });
      expect(gaps).toEqual(dir === 'ltr' ? ['0px', '48px'] : ['48px', '0px']);
      const first = await page.locator('.hello__panel').first().boundingBox();
      const last = await page.locator('.hello__panel').last().boundingBox();
      expect(dir === 'ltr' ? first!.x < last!.x : first!.x > last!.x).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test('honours the forced low tier and locale overrides', async ({ page }) => {
    await page.goto('/?screen=hello&tier=low&locale=ar-SA&country=SA');
    await expect(page.getByTestId('info-tier')).toHaveText('low');
    await expect(page.getByTestId('info-locale')).toHaveText('ar-SA');
    await expect(page.getByTestId('info-country')).toHaveText('SA');
  });
});

test.describe('catalog panel in the desktop browser (pnpm dev)', () => {
  let app: MockServer;
  let base: string;

  test.beforeAll(async () => {
    app = await mock();
    base = await listen(app);
  });
  test.afterAll(async () => {
    await app.close();
  });

  test('refreshes the playlist given with ?source= in the data workers and searches it', async ({ page }) => {
    const errors = trackErrors(page);
    const playlist = `${base}/get.php?username=${U}&password=${P}&type=m3u_plus`;
    const body = await (await fetch(playlist)).text();
    const entries = body.split(/\r?\n/).filter((line) => line.startsWith('#EXTINF')).length;
    expect(entries).toBeGreaterThan(10);

    // The playlist URL is pasted as it is: `source` is the last parameter.
    await page.goto(`/?screen=hello&q=sports&source=${playlist}`);
    const ingest = page.getByTestId('ingest-status');
    await expect(ingest).toHaveText(new RegExp(`^ok: committed gen 1, ${entries} items [(]live [0-9]+`), { timeout: 20_000 });
    await expect(ingest).toHaveAttribute('data-items', String(entries));
    await expect(page.getByTestId('data-status')).toHaveText(`ok: 1 source, ${entries} items`);
    const search = page.getByTestId('search-status');
    await expect(search).toHaveText(/^ok: 2 for "sports": Zoma Sports Test F?HD, Zoma Sports Test F?HD$/);
    await expect(search).toHaveAttribute('data-total', '2');
    // Then the guide the playlist header names, in an EPG worker. The match rate doesn't depend
    // on the clock (the mock's schedule is pinned to its own day, the browser's isn't).
    const guide = page.getByTestId('epg-status');
    await expect(guide).toHaveText('ok: 11 of 12 live channels have a guide (91.7%), 1 guide', { timeout: 20_000 });
    await expect(guide).toHaveAttribute('data-matched', '11');
    await expect(page.getByTestId('nownext-status')).toHaveText(/^(ok: Zoma Sports Test F?HD: |none: )/);
    // The one live channel no guide matches, focused for 600 ms: its panel's short EPG is asked,
    // and has nothing for it either (it has no EPG id).
    const panelEpg = page.getByTestId('shortepg-status');
    await expect(panelEpg).toHaveText('none: 18+ Test Pattern: the panel has no programmes for it now', { timeout: 20_000 });
    await expect(panelEpg).toHaveAttribute('data-from', 'panel');

    // A remote key marks the UI busy (a running refresh would pause), then idle again.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('busy-status')).toHaveText('busy (refresh paused)');
    await expect(page.getByTestId('busy-status')).toHaveText('idle');

    // Without a source, the stored catalog is searched; the same playlist again is a 304.
    await page.goto('/?screen=hello&q=sports');
    await expect(page.getByTestId('data-status')).toHaveText(`ok: 1 source, ${entries} items`);
    await expect(search).toHaveAttribute('data-total', '2');
    await expect(guide).toHaveAttribute('data-matched', '11');
    await expect(panelEpg).toHaveText("none: needs ?source=<an Xtream panel's get.php URL>");
    await page.goto(`/?screen=hello&source=${encodeURIComponent(playlist)}`);
    await expect(ingest).toHaveText(new RegExp(`^ok: unchanged gen 1, ${entries} items`), { timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test('falls back to the short EPG of a panel whose guide is off', async ({ page }) => {
    const errors = trackErrors(page);
    const noGuide = await mock({ scenario: 'no-xmltv' });
    try {
      const playlist = `${await listen(noGuide)}/get.php?username=${U}&password=${P}&type=m3u_plus`;
      await page.goto(`/?screen=hello&source=${playlist}`);
      await expect(page.getByTestId('epg-status')).toHaveText('failed: debug:tvg0 http', { timeout: 20_000 });
      const panelEpg = page.getByTestId('shortepg-status');
      await expect(panelEpg).toHaveAttribute('data-from', 'panel', { timeout: 20_000 });
      // The mock's schedule is pinned to its own day and the browser's clock isn't, so the text
      // depends on the clock (packages/data and test/short-epg-mock.test.ts check it exactly).
      await expect(panelEpg).toHaveText(/^(ok: Zoma Test 1 SMPTE: .+ [(]panel[)]|none: Zoma Test 1 SMPTE: the panel has no programmes for it now)$/);
      expect(errors).toEqual([]);
    } finally {
      await noGuide.close();
    }
  });
});
