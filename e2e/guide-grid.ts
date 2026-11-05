import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { GUIDE_LAYOUT, guideWidth } from '../packages/ui/src/components/guide-layout';

/**
 * Reading the grid guide (`GuideGrid`) off the page, and checking where it draws everything
 * against GUIDE_LAYOUT: the gallery page (guide-gallery.spec.ts, RELAY step 23b) and the guide
 * screen (guide.spec.ts, step 23c).
 */

/** The 1920x1080 canvas less its 5% title-safe margins. */
export const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
const L = GUIDE_LAYOUT;
/** Minutes in view, and the rows a full view draws. */
export const SPAN = 120;
export const ROWS = 9;

export interface Cell {
  readonly row: number;
  readonly start: number;
  readonly end: number;
  /** The programme's index in its row's schedule, -1 for a placeholder. */
  readonly programme: number;
  readonly state: string;
  readonly cls: string;
  readonly title: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Grid {
  readonly view: number;
  readonly top: number;
  /** The grid's rows (`data-count`). */
  readonly count: number;
  readonly time: number;
  readonly index: number;
  readonly dir: string;
  readonly box: { left: number; right: number; top: number; bottom: number };
  /** Each drawn row's channel column and timeline. */
  readonly rows: Array<{ row: number; top: number; bottom: number; channel: { left: number; right: number }; line: { left: number; right: number; top: number; bottom: number }; name: string; number: string }>;
  readonly cells: Cell[];
  readonly slots: Array<{ minute: number; text: string; left: number; right: number }>;
  readonly now: { minute: number; centre: number } | null;
  readonly outside: string[];
  readonly scroll: readonly [number, number];
}

/**
 * Everything the checks need, read in one evaluate (no row can vanish between two reads): the
 * grid `[data-testid=guide]` under the screen `[data-testid=<root>]` (its `data-time` and
 * `data-index` are the focus), and whether the grid and the `header` boxes are in the safe area.
 */
export function readGrid(page: Page, root: string, header: string): Promise<Grid> {
  return page.evaluate(
    ({ safe, root, header }) => {
      const screen = document.querySelector(`[data-testid=${root}]`)!;
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
          number: row.querySelector('.z-guide__number')?.textContent ?? '',
        };
      });
      const cells = Array.from(grid.querySelectorAll('.z-guide__cell')).map((cell) => {
        const r = rect(cell);
        return {
          row: num(cell.closest('.z-guide__row')!, 'data-row'),
          start: num(cell, 'data-start'),
          end: num(cell, 'data-end'),
          programme: num(cell, 'data-programme'),
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
      for (const el of Array.from(document.querySelectorAll(`[data-testid=guide], .z-guide__row, .z-guide__cell, .z-guide__slot, .z-guide__now, ${header}`))) {
        const r = rect(el);
        if (r.left < safe.left - 0.5 || r.top < safe.top - 0.5 || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(`${el.className}: ${(el.textContent ?? '').slice(0, 30)}`);
      }
      const g = rect(grid);
      return {
        view: num(grid, 'data-view'),
        top: num(grid, 'data-top'),
        count: num(grid, 'data-count'),
        time: num(screen, 'data-time'),
        index: num(screen, 'data-index'),
        dir: document.documentElement.dir,
        box: { left: g.left, right: g.right, top: g.top, bottom: g.bottom },
        rows,
        cells,
        slots,
        now: line === null ? null : { minute: num(line, 'data-minute'), centre: (rect(line).left + rect(line).right) / 2 },
        outside,
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const,
      };
    },
    { safe: SAFE, root, header },
  );
}

/** The px from the timeline's inline start of `minute` (the left edge in LTR, the right in RTL). */
function offset(g: Grid, minute: number): number {
  return (minute - g.view) * L.minuteWidth;
}

/**
 * Every drawn thing where GUIDE_LAYOUT says: the rows from `top` (a full view, or to the last
 * row), the cells from the view's start, cut at its edges, the slot labels at their boundaries,
 * the now line, the channels at the inline start.
 */
export function checkGeometry(g: Grid): void {
  const rtl = g.dir === 'rtl';
  expect(g.scroll).toEqual([1920, 1080]);
  expect(g.outside).toEqual([]);
  expect(g.box.right - g.box.left).toBeCloseTo(guideWidth(SPAN), 0);
  expect(g.rows.map((r) => r.row)).toEqual(Array.from({ length: Math.min(ROWS, g.count - g.top) }, (_, i) => g.top + i));
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

/** The one focused cell. */
export function focused(g: Grid): Cell {
  const found = g.cells.filter((c) => c.state === 'focused');
  expect(found).toHaveLength(1);
  return found[0]!;
}
