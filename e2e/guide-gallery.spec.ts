import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { stripIsolates } from '../packages/core/src/bidi';
import { GUIDE_LAYOUT, guideWidth } from '../packages/ui/src/components/guide-layout';
import { RemoteDriver } from './remote-driver';

/**
 * The grid guide's gallery page (`?screen=gallery-guide`, RELAY step 23b) in the dev app:
 * made-up rows on a fixed evening (20:17 in the browser's own time zone). It checks what the
 * unit tests can't: where the cells really are on screen, in English and mirrored in Arabic,
 * as the remote moves the focus. The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
const L = GUIDE_LAYOUT;
const SPAN = 120;
const ROWS = 9;

async function open(page: Page, locale: string): Promise<RemoteDriver> {
  await page.goto(`/?screen=gallery-guide&locale=${locale}`);
  await expect(page.getByTestId('guide-gallery')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return new RemoteDriver(page);
}

interface Cell {
  readonly row: number;
  readonly start: number;
  readonly end: number;
  readonly state: string;
  readonly cls: string;
  readonly title: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface Grid {
  readonly view: number;
  readonly top: number;
  readonly time: number;
  readonly index: number;
  readonly dir: string;
  readonly box: { left: number; right: number; top: number; bottom: number };
  /** Each drawn row's channel column and timeline. */
  readonly rows: Array<{ row: number; top: number; bottom: number; channel: { left: number; right: number }; line: { left: number; right: number; top: number; bottom: number }; name: string }>;
  readonly cells: Cell[];
  readonly slots: Array<{ minute: number; text: string; left: number; right: number }>;
  readonly now: { minute: number; centre: number } | null;
  readonly outside: string[];
  readonly scroll: readonly [number, number];
}

/** Everything the checks need, read in one evaluate (no row can vanish between two reads). */
function readGrid(page: Page): Promise<Grid> {
  return page.evaluate((safe) => {
    const root = document.querySelector('[data-testid=guide-gallery]')!;
    const grid = document.querySelector('[data-testid=guide]')!;
    const rect = (el: Element) => el.getBoundingClientRect();
    const num = (el: Element, name: string): number => Number(el.getAttribute(name));
    const rows = Array.from(grid.querySelectorAll('.z-guide__row')).map((row) => {
      const channel = rect(row.querySelector('.z-guide__channel')!);
      const line = rect(row.querySelector('.z-guide__line')!);
      return {
        row: num(row, 'data-row'),
        top: rect(row).top,
        bottom: rect(row).bottom,
        channel: { left: channel.left, right: channel.right },
        line: { left: line.left, right: line.right, top: line.top, bottom: line.bottom },
        name: row.querySelector('.z-guide__name')?.textContent ?? '',
      };
    });
    const cells = Array.from(grid.querySelectorAll('.z-guide__cell')).map((cell) => {
      const r = rect(cell);
      return {
        row: num(cell.closest('.z-guide__row')!, 'data-row'),
        start: num(cell, 'data-start'),
        end: num(cell, 'data-end'),
        state: cell.getAttribute('data-state') ?? '',
        cls: cell.className,
        title: cell.textContent ?? '',
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
    });
    const slots = Array.from(grid.querySelectorAll('.z-guide__slot')).map((slot) => ({
      minute: num(slot, 'data-minute'),
      text: slot.textContent ?? '',
      left: rect(slot).left,
      right: rect(slot).right,
    }));
    const line = grid.querySelector('.z-guide__now');
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-testid=guide], .z-guide__row, .z-guide__cell, .z-guide__slot, .z-guide__now, .guide-gallery__header > *'))) {
      const r = rect(el);
      if (r.left < safe.left - 0.5 || r.top < safe.top - 0.5 || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(`${el.className}: ${(el.textContent ?? '').slice(0, 30)}`);
    }
    const g = rect(grid);
    return {
      view: num(grid, 'data-view'),
      top: num(grid, 'data-top'),
      time: num(root, 'data-time'),
      index: num(root, 'data-index'),
      dir: document.documentElement.dir,
      box: { left: g.left, right: g.right, top: g.top, bottom: g.bottom },
      rows,
      cells,
      slots,
      now: line === null ? null : { minute: num(line, 'data-minute'), centre: (rect(line).left + rect(line).right) / 2 },
      outside,
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const,
    };
  }, SAFE);
}

/** The px from the timeline's inline start of `minute` (the left edge in LTR, the right in RTL). */
function offset(g: Grid, minute: number): number {
  return (minute - g.view) * L.minuteWidth;
}

/**
 * Every drawn thing where GUIDE_LAYOUT says: the cells from the view's start, cut at its edges,
 * the slot labels at their boundaries, the now line, the channels at the inline start.
 */
function checkGeometry(g: Grid): void {
  const rtl = g.dir === 'rtl';
  expect(g.scroll).toEqual([1920, 1080]);
  expect(g.outside).toEqual([]);
  expect(g.box.right - g.box.left).toBeCloseTo(guideWidth(SPAN), 0);
  expect(g.rows.map((r) => r.row)).toEqual(Array.from({ length: ROWS }, (_, i) => g.top + i));
  for (let i = 0; i < g.rows.length; i += 1) {
    const row = g.rows[i]!;
    // Below the header, each row after its gap; the timeline after the channel column.
    expect(row.top - g.box.top, `row ${row.row}`).toBeCloseTo(L.headerHeight + L.rowGap + i * (L.rowHeight + L.rowGap), 0);
    expect(row.bottom - row.top).toBeCloseTo(L.rowHeight, 0);
    expect(row.channel.right - row.channel.left).toBeCloseTo(L.channelWidth, 0);
    expect(rtl ? g.box.right - row.line.right : row.line.left - g.box.left).toBeCloseTo(L.channelWidth + L.channelGap, 0);
    expect(row.line.right - row.line.left).toBeCloseTo(SPAN * L.minuteWidth, 0);
    // The channels at the inline start: on the left in English, on the right in Arabic.
    if (rtl) expect(row.channel.left).toBeGreaterThanOrEqual(row.line.right + L.channelGap - 0.5);
    else expect(row.channel.right).toBeLessThanOrEqual(row.line.left - L.channelGap + 0.5);
    const cells = g.cells.filter((c) => c.row === row.row);
    expect(cells.length).toBeGreaterThan(0);
    // The cells cover the view, in time order from the inline start.
    expect(Math.max(cells[0]!.start, g.view)).toBe(g.view);
    expect(cells[cells.length - 1]!.end).toBeGreaterThanOrEqual(g.view + SPAN);
    for (const cell of cells) {
      const from = offset(g, Math.max(cell.start, g.view));
      const width = (Math.min(cell.end, g.view + SPAN) - Math.max(cell.start, g.view)) * L.minuteWidth - L.cellGap;
      const start = rtl ? row.line.right - cell.right : cell.left - row.line.left;
      expect(start, `row ${row.row} cell ${cell.start}`).toBeCloseTo(from, 0);
      expect(cell.right - cell.left, `row ${row.row} cell ${cell.start}`).toBeCloseTo(Math.max(width, 2 * 4), 0);
      expect(cell.top).toBeCloseTo(row.line.top, 0);
      expect(cell.bottom).toBeCloseTo(row.line.bottom, 0);
    }
  }
  const line = g.rows[0]!.line;
  expect(g.slots.map((s) => s.minute)).toEqual([0, 30, 60, 90].map((m) => g.view + m));
  for (const slot of g.slots) {
    const start = rtl ? line.right - slot.right : slot.left - line.left;
    expect(start, `slot ${slot.minute}`).toBeCloseTo(offset(g, slot.minute), 0);
  }
  if (g.now !== null) {
    const centre = rtl ? line.right - g.now.centre : g.now.centre - line.left;
    expect(centre).toBeCloseTo(offset(g, g.now.minute), 0);
  }
}

function focused(g: Grid): Cell {
  const found = g.cells.filter((c) => c.state === 'focused');
  expect(found).toHaveLength(1);
  return found[0]!;
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
