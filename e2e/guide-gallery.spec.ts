import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { stripIsolates } from '../packages/core/src/bidi';
import type { Grid } from './guide-grid';
import { checkGeometry, focused, readGrid as readAny } from './guide-grid';
import { RemoteDriver } from './remote-driver';

/**
 * The grid guide's gallery page (`?screen=gallery-guide`, RELAY step 23b) in the dev app:
 * made-up rows on a fixed evening (20:17 in the browser's own time zone). It checks what the
 * unit tests can't: where the cells really are on screen, in English and mirrored in Arabic,
 * as the remote moves the focus. The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

async function open(page: Page, locale: string): Promise<RemoteDriver> {
  await page.goto(`/?screen=gallery-guide&locale=${locale}`);
  await expect(page.getByTestId('guide-gallery')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return new RemoteDriver(page);
}

/** The gallery page's grid (e2e/guide-grid.ts reads it, and checks it against GUIDE_LAYOUT). */
function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-gallery', '.guide-gallery__header > *');
}

test.describe('the grid guide’s gallery page (pnpm dev, ?screen=gallery-guide)', () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const [locale, dir, forward, back, placeholder] of [
    ['en-US', 'ltr', 'RIGHT', 'LEFT', 'No information'],
    ['ar-SA', 'rtl', 'LEFT', 'RIGHT', 'لا توجد معلومات'],
  ] as const) {
    test(`draws the rows and cells in view, moved by the remote (${locale})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const remote = await open(page, locale);
      await remote.expectFocus('gallery-guide/guide/0');
      let g = await readGrid(page);
      expect(g.dir).toBe(dir);
      // At now, 20:17: the view from 20:00, the now line 17 minutes in, the focus on air.
      expect(g.time - g.view).toBe(17);
      expect(g.now?.minute).toBe(g.time);
      checkGeometry(g);
      let cell = focused(g);
      expect(cell).toMatchObject({ row: 0, title: 'Evening Bulletin' });
      expect(cell.start).toBeLessThanOrEqual(g.time);
      expect(cell.end).toBeGreaterThan(g.time);
      // Zoma News leaves two minutes empty after the bulletin: its cell takes them.
      expect(g.cells.filter((c) => c.row === 0).map((c) => [c.start - g.view, c.end - g.view, c.title])).toEqual([
        [0, 30, 'Evening Bulletin'],
        [30, 60, 'Weather and Traffic'],
        [60, 120, 'The Debate'],
      ]);
      expect(g.cells.filter((c) => c.row === 0).map((c) => c.cls)).toEqual([
        'z-guide__cell is-focused is-now',
        'z-guide__cell',
        'z-guide__cell',
      ]);
      // The documentary channel has nothing from 20:50 to 23:00, and the test pattern no guide.
      expect(g.cells.filter((c) => c.row === 4).map((c) => [c.start - g.view, c.end - g.view, c.title])).toEqual([
        [-15, 50, 'Nature: The Desert at Night'],
        [50, 60, placeholder],
        [60, 90, placeholder],
        [90, 120, placeholder],
      ]);
      expect(g.cells.filter((c) => c.row === 6).map((c) => c.title)).toEqual([placeholder, placeholder, placeholder, placeholder]);
      expect(g.rows[1]!.name).toBe('قناة زوما');
      await page.screenshot({ path: path.join(SHOTS, `guide-gallery-${locale}.png`), animations: 'disabled' });

      // On a programme: the next cell, then back.
      await remote.press(forward);
      await expect.poll(async () => (await readGrid(page)).time).toBe(cell.end);
      g = await readGrid(page);
      expect(focused(g)).toMatchObject({ row: 0, start: cell.end, title: 'Weather and Traffic' });
      await expect(page.getByTestId('guide-details')).toContainText('Weather and Traffic');
      await remote.press(back);
      await expect.poll(async () => (await readGrid(page)).time).toBe(cell.start);

      // Down keeps the cursor: the cell of the next row that holds it.
      await remote.go('DOWN', 'gallery-guide/guide/1');
      g = await readGrid(page);
      cell = focused(g);
      expect(cell.row).toBe(1);
      expect(cell.start).toBeLessThanOrEqual(g.time);
      expect(cell.end).toBeGreaterThan(g.time);
      expect(cell.title).toBe('برنامج المساء');

      // Past the view's end, the view moves on by slots and the header with it.
      const view = g.view;
      for (let i = 0; i < 3; i += 1) await remote.press(forward);
      await expect.poll(async () => (await readGrid(page)).view).toBeGreaterThan(view);
      g = await readGrid(page);
      checkGeometry(g);
      expect((g.view - view) % 30).toBe(0);
      expect(g.now).toBeNull();
      cell = focused(g);
      expect(cell.start).toBe(g.time);

      // CH- pages the rows: the next nine, the cursor kept.
      await remote.go('CH_DOWN', 'gallery-guide/guide/10');
      g = await readGrid(page);
      expect(g.top).toBe(9);
      checkGeometry(g);
      expect(focused(g).row).toBe(10);

      // OK selects the programme.
      await remote.press('OK');
      await expect(page.getByTestId('guide-status')).toHaveAttribute('data-selects', '1');
      const title = focused(await readGrid(page)).title;
      expect(stripIsolates((await page.getByTestId('guide-status').textContent()) ?? '')).toContain(title);
      expect(errors).toEqual([]);
    });
  }

  test('focuses a cell under the pointer where it is drawn, and keeps the view', async ({ page }) => {
    const remote = await open(page, 'en-US');
    await remote.expectFocus('gallery-guide/guide/0');
    const before = await readGrid(page);
    // Row 2's first cell began before the view (a match from 19:30).
    const cell = page.locator('[data-row="2"] .z-guide__cell').first();
    await cell.hover();
    await page.mouse.move(400, 600);
    await cell.hover();
    await remote.expectFocus('gallery-guide/guide/2');
    const g = await readGrid(page);
    expect(g.view).toBe(before.view);
    expect(g.time).toBe(g.view);
    expect(focused(g)).toMatchObject({ row: 2, title: 'Football: Cup Final, live from the national stadium' });
    expect(focused(g).cls).toContain('is-cut-start');
    expect(focused(g).cls).toContain('is-cut-end');
  });

  test('shows only our strings, bracketed, in the pseudo-locale (en-XA)', async ({ page }) => {
    await open(page, 'en-XA');
    const found = await page.evaluate(() => {
      const root = document.querySelector('[data-testid=guide-gallery]')!;
      const out: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.nodeValue ?? '').trim();
        if (!/\p{L}/u.test(text) || node.parentElement?.closest('[translate="no"]') != null) continue;
        // The locale's own formats: times and the day, not catalog text.
        if (/^\d{1,2}:\d{2} [AP]M( – \d{1,2}:\d{2} [AP]M)?$/.test(text) || /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/.test(text)) continue;
        if (!(text.startsWith('[') && text.endsWith(']'))) out.push(text);
      }
      return out;
    });
    expect(found).toEqual([]);
  });
});
