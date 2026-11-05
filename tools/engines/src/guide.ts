/**
 * The grid guide in an old engine (RELAY step 23e). The guide screen (apps/tv/src/guide, step
 * 23c) is the first screen placed by absolute positions from CSS variables: each cell, slot
 * label and the now line sits at `left: var(--x)`, which postcss-rtlcss turns into
 * `right: var(--x)` in Arabic. The onboarding walk (onboarding.ts) opens it from the live
 * screen's header by keys; these are the parts it uses there:
 * - `GRID_VIEW_FUNCTION`, plain ES5 for the walk's probe: the grid's rows, each one's channel
 *   column, timeline and cells, the slot labels and the now line, with their boxes.
 * - `gridFailures`: everything drawn where `GUIDE_LAYOUT` says, measured from the timeline's
 *   inline start (the left edge in English, the right in Arabic), as `checkGeometry` in
 *   e2e/guide-grid.ts does; the channels at the inline start.
 * - `scheduleFailures`: each row's channel and its cells against the fixture's guide (every
 *   8th live channel has hourly programmes), or "No information" placeholders.
 * - `cursorFailures`: one focused cell, on the focused row, holding the time cursor.
 *
 * The layout constants, the selectors and our own words are kept equal to packages/ui's
 * guide-layout.ts, the e2e tests and the app's catalogs by test/engines-onboarding.test.ts
 * (tools/* may not import @zoma/ui).
 */
import { stripIsolates } from '@zoma/core';
import type { ListedChannel } from './fixture';
import { SAFE_AREA, list } from './gallery';
import type { ListedEntry, LiveLanguage } from './live';
import { programmeTitle } from './live';

/** packages/ui `GUIDE_LAYOUT` (px): the grid's sizes, layout constants the drawing must follow. */
export const GUIDE_LAYOUT = {
  headerHeight: 56,
  rowHeight: 80,
  rowGap: 8,
  channelWidth: 400,
  channelGap: 8,
  minuteWidth: 11,
  cellGap: 4,
} as const;

/** The guide screen's view (apps/tv guide-state `GUIDE`): two hours across, 30-minute slots, 9 rows under a 110 px header. */
export const GUIDE_SPAN = 120;
export const GUIDE_SLOT = 30;
export const GUIDE_ROWS = 9;
export const GUIDE_HEADER = 110;

/** packages/ui `guideWidth`: the channel column, then the timeline. */
export const guideWidth = (span: number): number => GUIDE_LAYOUT.channelWidth + GUIDE_LAYOUT.channelGap + span * GUIDE_LAYOUT.minuteWidth;

/** The narrowest cell GuideGrid draws: its border on both sides (a cell a few minutes long). */
export const MIN_CELL = 8;

/** The boxes and labels the e2e test measures on the guide screen (e2e/guide-grid.ts `readGrid`, guide.spec.ts `cutLabels`). */
export const GUIDE_BOXES = '[data-testid=guide], .z-guide__row, .z-guide__cell, .z-guide__slot, .z-guide__now, .guide__header > *';
export const GUIDE_LABELS = '.guide__title, .guide__clock, .guide__when';

/** Our own words in the grid, as the app's catalogs have them. */
export const GUIDE_TEXT: Record<LiveLanguage, { readonly open: string; readonly noInfo: string }> = {
  en: { open: 'Guide', noInfo: 'No information' },
  ar: { open: 'الدليل', noInfo: 'لا توجد معلومات' },
};

export interface GridBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A cell as drawn: its own times (UTC minutes), its programme's index (-1: a placeholder), its focus state and title. */
export interface GridCell extends GridBox {
  readonly start: number;
  readonly end: number;
  readonly programme: number;
  readonly state: string | null;
  readonly title: string | null;
}

export interface GridRow {
  /** `data-row`: its place in the category on show. */
  readonly row: number;
  readonly top: number;
  readonly bottom: number;
  readonly channel: GridBox | null;
  readonly line: GridBox | null;
  readonly number: string | null;
  readonly name: string | null;
  readonly cells: readonly GridCell[];
}

/** The grid as the walk's probe reads it (`GRID_VIEW_FUNCTION`). */
export interface GridView {
  /** The view's first minute (UTC minutes), its first row, the rows in all, the minutes across. */
  readonly view: number;
  readonly top: number;
  readonly count: number;
  readonly span: number;
  readonly box: GridBox;
  readonly rows: readonly GridRow[];
  readonly slots: ReadonlyArray<{ readonly minute: number; readonly text: string | null; readonly left: number; readonly right: number }>;
  /** The now line: its minute and the middle of its box (null: not in view). */
  readonly now: { readonly minute: number; readonly centre: number } | null;
}

/** In-page helper (plain ES5, inside the walk's probe): `gridView(guideScreen)` reads a `GridView`, or null. */
export const GRID_VIEW_FUNCTION = `function gridView(screen) {
    var grid = screen ? screen.querySelector('[data-testid="guide"]') : null;
    if (!grid) return null;
    function box(el) {
      var r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }
    function num(el, name) {
      return Number(el.getAttribute(name));
    }
    function text(root, selector) {
      var el = root.querySelector(selector);
      return el ? el.textContent : null;
    }
    function all(root, selector) {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    }
    var now = grid.querySelector('.z-guide__now');
    var line = now ? box(now) : null;
    return {
      view: num(grid, 'data-view'),
      top: num(grid, 'data-top'),
      count: num(grid, 'data-count'),
      span: num(grid, 'data-span'),
      box: box(grid),
      rows: all(grid, '.z-guide__row').map(function (row) {
        var channel = row.querySelector('.z-guide__channel');
        var timeline = row.querySelector('.z-guide__line');
        var r = box(row);
        return {
          row: num(row, 'data-row'),
          top: r.top,
          bottom: r.bottom,
          channel: channel ? box(channel) : null,
          line: timeline ? box(timeline) : null,
          number: text(row, '.z-guide__number'),
          name: text(row, '.z-guide__name'),
          cells: all(row, '.z-guide__cell').map(function (cell) {
            var c = box(cell);
            return {
              start: num(cell, 'data-start'),
              end: num(cell, 'data-end'),
              programme: num(cell, 'data-programme'),
              state: cell.getAttribute('data-state'),
              title: cell.textContent,
              left: c.left,
              right: c.right,
              top: c.top,
              bottom: c.bottom
            };
          })
        };
      }),
      slots: all(grid, '.z-guide__slot').map(function (slot) {
        var s = box(slot);
        return { minute: num(slot, 'data-minute'), text: slot.textContent, left: s.left, right: s.right };
      }),
      now: line ? { minute: num(now, 'data-minute'), centre: (line.left + line.right) / 2 } : null
    };
  }`;

const plain = (text: string | null): string | null => (text === null ? null : stripIsolates(text).trim());

/** A UTC minute as `14:30`, for messages (the fixture's guide is in UTC). */
export function utcTime(minute: number): string {
  const d = new Date(minute * 60_000);
  const two = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** `Math.round` to a tenth, for messages. */
const px = (n: number): string => String(Math.round(n * 10) / 10);

/** Within half a pixel, as the e2e's `toBeCloseTo(…, 0)`. */
const near = (got: number, want: number): boolean => Math.abs(got - want) < 0.5;

/**
 * Everything drawn where GUIDE_LAYOUT says, as e2e/guide-grid.ts `checkGeometry`: the grid two
 * hours wide under the screen's header, the rows from `top` (a full view, or to the last row),
 * each row's channel column at the inline start and its timeline after it, the cells from the
 * view's start (cut at its edges), the slot labels at their boundaries, and the now line. Every
 * position is measured from the inline start: the left edge in English, the right in Arabic.
 */
export function gridFailures(g: GridView, dir: string): string[] {
  const L = GUIDE_LAYOUT;
  const rtl = dir === 'rtl';
  const failures: string[] = [];
  if (g.span !== GUIDE_SPAN) failures.push(`the grid shows ${g.span} minutes, expected ${GUIDE_SPAN}`);
  const width = g.box.right - g.box.left;
  if (!near(width, guideWidth(GUIDE_SPAN))) failures.push(`the grid is ${px(width)} px wide, expected ${guideWidth(GUIDE_SPAN)}`);
  const start = rtl ? SAFE_AREA.right - g.box.right : g.box.left - SAFE_AREA.left;
  if (!near(start, 0)) failures.push(`the grid starts ${px(start)} px from the safe area's inline start, expected 0`);
  if (!near(g.box.top - SAFE_AREA.top, GUIDE_HEADER)) failures.push(`the grid starts ${px(g.box.top - SAFE_AREA.top)} px below the safe area's top, expected ${GUIDE_HEADER} (the header)`);

  const want: number[] = [];
  for (let row = g.top; row < Math.min(g.top + GUIDE_ROWS, g.count); row += 1) want.push(row);
  const got = g.rows.map((r) => r.row);
  if (got.join() !== want.join()) failures.push(`the grid draws rows ${got.join(', ') || 'none'}, expected ${want.join(', ')}`);

  /** px from the timeline's inline start of `minute`. */
  const offset = (minute: number): number => (minute - g.view) * L.minuteWidth;
  const wrong: string[] = [];
  g.rows.forEach((row, i) => {
    const at = `row ${row.row}`;
    const top = row.top - g.box.top;
    const wantTop = L.headerHeight + L.rowGap + i * (L.rowHeight + L.rowGap);
    if (!near(top, wantTop)) wrong.push(`${at} is ${px(top)} px below the grid's top, expected ${wantTop}`);
    if (!near(row.bottom - row.top, L.rowHeight)) wrong.push(`${at} is ${px(row.bottom - row.top)} px tall, expected ${L.rowHeight}`);
    if (row.channel === null || row.line === null) {
      wrong.push(`${at} has no ${row.channel === null ? 'channel column' : 'timeline'}`);
      return;
    }
    const channel = row.channel;
    const line = row.line;
    if (!near(channel.right - channel.left, L.channelWidth)) wrong.push(`${at}: the channel column is ${px(channel.right - channel.left)} px wide, expected ${L.channelWidth}`);
    const lineStart = rtl ? g.box.right - line.right : line.left - g.box.left;
    if (!near(lineStart, L.channelWidth + L.channelGap)) wrong.push(`${at}: the timeline starts ${px(lineStart)} px from the grid's inline start, expected ${L.channelWidth + L.channelGap}`);
    if (!near(line.right - line.left, GUIDE_SPAN * L.minuteWidth)) wrong.push(`${at}: the timeline is ${px(line.right - line.left)} px wide, expected ${GUIDE_SPAN * L.minuteWidth}`);
    // The channels at the inline start: left of the timeline in English, right of it in Arabic.
    const beside = rtl ? channel.left >= line.right + L.channelGap - 0.5 : channel.right <= line.left - L.channelGap + 0.5;
    if (!beside) wrong.push(`${at}: the channel column is not at the inline start (the ${rtl ? 'right' : 'left'}) of its timeline`);

    const cells = row.cells;
    if (cells.length === 0) {
      wrong.push(`${at} draws no cells`);
      return;
    }
    // The cells cover the view, in time order from the inline start.
    if (cells[0]!.start > g.view) wrong.push(`${at}: the first cell starts at ${utcTime(cells[0]!.start)}, after the view's start ${utcTime(g.view)}`);
    if (cells[cells.length - 1]!.end < g.view + GUIDE_SPAN) wrong.push(`${at}: the last cell ends at ${utcTime(cells[cells.length - 1]!.end)}, before the view's end ${utcTime(g.view + GUIDE_SPAN)}`);
    for (const cell of cells) {
      const from = Math.max(cell.start, g.view);
      const to = Math.min(cell.end, g.view + GUIDE_SPAN);
      const cellAt = `${at} cell ${utcTime(cell.start)}`;
      const begins = rtl ? line.right - cell.right : cell.left - line.left;
      if (!near(begins, offset(from))) wrong.push(`${cellAt} starts ${px(begins)} px from the timeline's inline start, expected ${offset(from)}`);
      const wide = Math.max((to - from) * L.minuteWidth - L.cellGap, MIN_CELL);
      if (!near(cell.right - cell.left, wide)) wrong.push(`${cellAt} is ${px(cell.right - cell.left)} px wide, expected ${wide}`);
      if (!near(cell.top, line.top) || !near(cell.bottom, line.bottom)) wrong.push(`${cellAt} is not as tall as its timeline`);
    }
  });

  const line = g.rows[0]?.line ?? null;
  const slots = g.slots.map((s) => s.minute);
  const wantSlots: number[] = [];
  for (let m = 0; m < GUIDE_SPAN; m += GUIDE_SLOT) wantSlots.push(g.view + m);
  if (slots.join() !== wantSlots.join()) wrong.push(`the time header labels ${slots.map(utcTime).join(', ') || 'nothing'}, expected ${wantSlots.map(utcTime).join(', ')}`);
  if (line !== null) {
    for (const slot of g.slots) {
      const begins = rtl ? line.right - slot.right : slot.left - line.left;
      if (!near(begins, offset(slot.minute))) wrong.push(`the ${utcTime(slot.minute)} label starts ${px(begins)} px from the timeline's inline start, expected ${offset(slot.minute)}`);
      if ((plain(slot.text) ?? '') === '') wrong.push(`the ${utcTime(slot.minute)} label is empty`);
    }
    if (g.now !== null) {
      const centre = rtl ? line.right - g.now.centre : g.now.centre - line.left;
      if (!near(centre, offset(g.now.minute))) wrong.push(`the now line (${utcTime(g.now.minute)}) is ${px(centre)} px from the timeline's inline start, expected ${offset(g.now.minute)}`);
    }
  }
  if (wrong.length > 0) failures.push(`${wrong.length} misplaced: ${list(wrong)}`);
  return failures;
}

/** The fixture guide's programmes are hourly, on the UTC hour (fixture.ts `fixtureXmltv`): the one holding `minute` starts at its hour. */
export const programmeStart = (minute: number): number => Math.floor(minute / 60) * 60;

/** The fixture's programmes of `channel` over the view, as `[start, end, title]` (UTC minutes). */
export function fixtureCells(channel: Pick<ListedChannel, 'tvgId'>, view: number, span: number): Array<[number, number, string]> {
  const cells: Array<[number, number, string]> = [];
  for (let start = programmeStart(view); start < view + span; start += 60) cells.push([start, start + 60, programmeTitle(channel, new Date(start * 60_000).getUTCHours())]);
  return cells;
}

/**
 * Each drawn row against the fixture, as `checkSchedule` in e2e/guide.spec.ts: its number (its
 * place in "All channels") and name, and in its timeline the guide's programmes over the view
 * with their own times and titles, or only "No information" placeholders on a channel without a
 * guide.
 */
export function scheduleFailures(g: GridView, entry: ListedEntry, language: LiveLanguage): string[] {
  const noInfo = GUIDE_TEXT[language].noInfo;
  const wrong: string[] = [];
  for (const row of g.rows) {
    const channel = entry.channels[row.row];
    if (channel === undefined) {
      wrong.push(`row ${row.row}: not in the fixture`);
      continue;
    }
    const at = `row ${row.row} (${channel.name})`;
    const number = entry.allStart + row.row + 1;
    if (plain(row.number) !== String(number)) wrong.push(`${at}: number ${row.number === null ? 'missing' : `"${row.number}"`}, expected ${number}`);
    if (plain(row.name) !== channel.name) wrong.push(`${at}: name ${row.name === null ? 'missing' : `"${plain(row.name)}"`}`);
    const drawn = row.cells.map((c) => `${utcTime(c.start)}–${utcTime(c.end)} ${c.programme < 0 ? `(${plain(c.title) ?? ''})` : `"${plain(c.title) ?? ''}"`}`);
    if (!channel.guide) {
      if (!row.cells.every((c) => c.programme === -1 && plain(c.title) === noInfo)) wrong.push(`${at}: no guide, but draws ${drawn.join(', ')}; expected only "${noInfo}" placeholders`);
      continue;
    }
    const want = fixtureCells(channel, g.view, g.span);
    const got = row.cells.map((c): [number, number, string] => [c.start, c.end, plain(c.title) ?? '']);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      wrong.push(`${at}: draws ${drawn.join(', ') || 'nothing'}, expected ${want.map(([s, e, t]) => `${utcTime(s)}–${utcTime(e)} "${t}"`).join(', ')}`);
    }
  }
  return wrong.length === 0 ? [] : [`${wrong.length} of ${g.rows.length} rows wrong: ${list(wrong)}`];
}

/** One focused cell, on the focused row (`index`), holding the time cursor (`time`, UTC minutes). */
export function cursorFailures(g: GridView, index: number | null, time: number | null): string[] {
  const focused = g.rows.flatMap((row) => row.cells.filter((c) => c.state === 'focused').map((c) => ({ row: row.row, cell: c })));
  if (focused.length !== 1) return [`${focused.length} cells drawn focused, expected 1`];
  const { row, cell } = focused[0]!;
  const failures: string[] = [];
  if (row !== index) failures.push(`the focused cell is on row ${row}, expected ${index ?? '-'} (the focus)`);
  if (time === null || !(cell.start <= time && time < cell.end)) {
    failures.push(`the focused cell (${utcTime(cell.start)}–${utcTime(cell.end)}) does not hold the cursor ${time === null ? '(none)' : utcTime(time)}`);
  }
  return failures;
}
