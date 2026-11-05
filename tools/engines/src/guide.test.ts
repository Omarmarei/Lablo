import { runInNewContext } from 'node:vm';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { fixtureEntries, liveCategories } from './fixture';
import type { GridCell, GridRow, GridView } from './guide';
import { GRID_VIEW_FUNCTION, GUIDE_LAYOUT, GUIDE_TEXT, cursorFailures, fixtureCells, gridFailures, programmeStart, scheduleFailures, utcTime } from './guide';
import type { Drawing } from './guide-drawn';
import { drawnGrid } from './guide-drawn';
import type { LiveLanguage } from './live';
import { LIVE_CATEGORY, listedEntry } from './live';

const CATEGORIES = liveCategories(fixtureEntries());
/** Group 5, the category the walk opens the guide on: rows 1, 3, 5, 6, 8 and 10 have a guide. */
const ENTRY = listedEntry(CATEGORIES, LIVE_CATEGORY)!;
/** 14:30 UTC on 2026-11-04, in minutes. */
const NOW = Date.UTC(2026, 10, 4, 14, 30) / 60_000;

const draw = (language: LiveLanguage, more: Partial<Drawing> = {}): GridView => drawnGrid({ language, entry: ENTRY, top: 0, index: 0, time: NOW, view: NOW, now: NOW, ...more });
const dirOf = (language: LiveLanguage): string => (language === 'ar' ? 'rtl' : 'ltr');

/** The grid with each row's cells changed by `cell`. */
function withCells(g: GridView, cell: (c: GridCell, row: GridRow) => GridCell): GridView {
  return { ...g, rows: g.rows.map((row) => ({ ...row, cells: row.cells.map((c) => cell(c, row)) })) };
}

describe('the grid probe', () => {
  it('is plain ES5, so it runs on every engine', () => {
    expect(() => parse(`(${GRID_VIEW_FUNCTION})`, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  it('reads the marks GuideGrid draws: rows, channel columns, timelines, cells, slot labels and the now line', () => {
    /** A stand-in element: attributes, a box, text, and children found by class. */
    interface Fake {
      attrs: Record<string, string>;
      rect: { left: number; right: number; top: number; bottom: number };
      text: string;
      kids: Array<[string, Fake]>;
    }
    const el = (attrs: Record<string, string>, left: number, right: number, text = '', kids: Array<[string, Fake]> = []): Fake => ({ attrs, rect: { left, right, top: 10, bottom: 20 }, text, kids });
    const api = (f: Fake): unknown => ({
      getAttribute: (name: string) => f.attrs[name] ?? null,
      getBoundingClientRect: () => f.rect,
      textContent: f.text,
      querySelector: (selector: string) => {
        const found = f.kids.find(([s]) => s === selector);
        return found === undefined ? null : api(found[1]);
      },
      querySelectorAll: (selector: string) => f.kids.filter(([s]) => s === selector).map(([, k]) => api(k)),
    });
    const cell = el({ 'data-start': '870', 'data-end': '900', 'data-programme': '-1', 'data-state': 'focused' }, 508, 834, 'No information');
    const row = el({ 'data-row': '3' }, 96, 1824, '', [
      ['.z-guide__channel', el({}, 96, 496)],
      ['.z-guide__line', el({}, 504, 1824)],
      ['.z-guide__number', el({}, 0, 0, '622')],
      ['.z-guide__name', el({}, 0, 0, 'Zoma Channel 41')],
      ['.z-guide__cell', cell],
    ]);
    const grid = el({ 'data-view': '870', 'data-top': '3', 'data-count': '183', 'data-span': '120' }, 96, 1824, '', [
      ['.z-guide__row', row],
      ['.z-guide__slot', el({ 'data-minute': '870' }, 504, 570, '2:30 PM')],
      ['.z-guide__now', el({ 'data-minute': '875' }, 557, 561)],
    ]);
    const screen = api(el({}, 0, 0, '', [['[data-testid="guide"]', grid]]));
    const read = runInNewContext(`(${GRID_VIEW_FUNCTION})`, { Array, Number }) as (screen: unknown) => GridView | null;
    expect(read(null)).toBeNull();
    expect(read(screen)).toEqual({
      view: 870,
      top: 3,
      count: 183,
      span: 120,
      box: { left: 96, right: 1824, top: 10, bottom: 20 },
      rows: [
        {
          row: 3,
          top: 10,
          bottom: 20,
          channel: { left: 96, right: 496, top: 10, bottom: 20 },
          line: { left: 504, right: 1824, top: 10, bottom: 20 },
          number: '622',
          name: 'Zoma Channel 41',
          cells: [{ start: 870, end: 900, programme: -1, state: 'focused', title: 'No information', left: 508, right: 834, top: 10, bottom: 20 }],
        },
      ],
      slots: [{ minute: 870, text: '2:30 PM', left: 504, right: 570 }],
      now: { minute: 875, centre: 559 },
    });
  });
});

describe('the fixture guide in the grid', () => {
  it("has hourly programmes on the UTC hour, titled by the channel's tvg-id and hour", () => {
    expect(programmeStart(NOW)).toBe(NOW - 30);
    expect(programmeStart(NOW - 30)).toBe(NOW - 30);
    expect(fixtureCells({ tvgId: 'fixture.17' }, NOW, 120)).toEqual([
      [NOW - 30, NOW + 30, 'fixture.17 14h'],
      [NOW + 30, NOW + 90, 'fixture.17 15h'],
      [NOW + 90, NOW + 150, 'fixture.17 16h'],
    ]);
    // Across midnight the hour starts again.
    const late = Date.UTC(2026, 10, 4, 23, 0) / 60_000;
    expect(fixtureCells({ tvgId: 'fixture.17' }, late, 120).map((c) => c[2])).toEqual(['fixture.17 23h', 'fixture.17 0h']);
    expect(utcTime(NOW)).toBe('14:30');
    expect(utcTime(late + 65)).toBe('00:05');
  });

  it('opens on Group 5, whose first rows mix channels with and without a guide', () => {
    expect(ENTRY.name).toBe('Group 5');
    expect(ENTRY.channels.slice(0, 11).map((c) => c.guide)).toEqual([false, true, false, true, false, true, true, false, true, false, true]);
  });
});

describe('gridFailures', () => {
  it.each(['en', 'ar'] as const)('passes the grid as GuideGrid draws it (%s), the view on now or moved on', (language) => {
    expect(gridFailures(draw(language), dirOf(language))).toEqual([]);
    expect(gridFailures(draw(language, { top: 9, index: 10, time: NOW + 210, view: NOW + 150 }), dirOf(language))).toEqual([]);
    // The last rows: fewer than a full view.
    const last = ENTRY.channels.length - 4;
    expect(gridFailures(draw(language, { top: last, index: last }), dirOf(language))).toEqual([]);
  });

  it.each(['en', 'ar'] as const)("catches every cell at its timeline's start, as without left: var(--x) (%s)", (language) => {
    const g = draw(language);
    const rtl = language === 'ar';
    const stacked = { ...g, rows: g.rows.map((row) => ({ ...row, cells: row.cells.map((c) => {
      const width = c.right - c.left;
      return rtl ? { ...c, right: row.line!.right, left: row.line!.right - width } : { ...c, left: row.line!.left, right: row.line!.left + width };
    }) })) };
    const failures = gridFailures(stacked, dirOf(language));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\d+ misplaced: row 0 cell 15:00 starts 0 px from the timeline's inline start, expected 330/);
  });

  it('measures from the inline start: an English drawing fails in Arabic, the channels on the wrong side', () => {
    const failures = gridFailures(draw('en'), 'rtl');
    expect(failures.join('; ')).toContain('row 0: the channel column is not at the inline start (the right) of its timeline');
    expect(failures.join('; ')).toContain("row 0: the timeline starts 0 px from the grid's inline start, expected 408");
  });

  it('catches a cell too wide, one not as tall as its timeline, and a row that does not reach the view’s end', () => {
    const wide = withCells(draw('en'), (c, row) => (row.row === 2 && c.start === NOW ? { ...c, right: c.right + 4 } : c));
    expect(gridFailures(wide, 'ltr')[0]).toContain('row 2 cell 14:30 is 330 px wide, expected 326');
    const short = withCells(draw('ar'), (c, row) => (row.row === 1 ? { ...c, bottom: c.bottom - 6 } : c));
    expect(gridFailures(short, 'rtl')[0]).toContain('row 1 cell 14:00 is not as tall as its timeline');
    const g = draw('en');
    const cut = { ...g, rows: g.rows.map((row) => (row.row === 3 ? { ...row, cells: row.cells.slice(0, -1) } : row)) };
    expect(gridFailures(cut, 'ltr')[0]).toContain("row 3: the last cell ends at 16:00, before the view's end 16:30");
  });

  it('catches a row without its timeline, without its channel column or without cells, and a grid without rows', () => {
    const g = draw('en');
    const parts = { ...g, rows: g.rows.map((row) => (row.row === 2 ? { ...row, line: null } : row.row === 4 ? { ...row, channel: null } : row.row === 3 ? { ...row, cells: [] } : row)) };
    expect(gridFailures(parts, 'ltr')).toEqual(['3 misplaced: row 2 has no timeline; row 3 draws no cells; row 4 has no channel column']);
    expect(gridFailures({ ...g, rows: [] }, 'ltr')).toEqual(['the grid draws rows none, expected 0, 1, 2, 3, 4, 5, 6, 7, 8']);
  });

  it("catches a channel column or a timeline of the wrong width, and a row's first cell missing", () => {
    const g = draw('ar');
    const narrow = { ...g, rows: g.rows.map((row) => (row.row === 7 ? { ...row, channel: { ...row.channel!, left: row.channel!.left + 10 } } : row)) };
    expect(gridFailures(narrow, 'rtl')).toEqual(['1 misplaced: row 7: the channel column is 390 px wide, expected 400']);
    const short = { ...g, rows: g.rows.map((row) => (row.row === 8 ? { ...row, line: { ...row.line!, left: row.line!.left + 11 } } : row)) };
    expect(gridFailures(short, 'rtl')[0]).toMatch(/^\d+ misplaced: row 8: the timeline is 1309 px wide, expected 1320/);
    const late = { ...g, rows: g.rows.map((row) => (row.row === 1 ? { ...row, cells: row.cells.slice(1) } : row)) };
    expect(gridFailures(late, 'rtl')).toEqual(["1 misplaced: row 1: the first cell starts at 15:00, after the view's start 14:30"]);
  });

  it('measures the grid from the safe area in Arabic from its right edge', () => {
    const g = draw('ar');
    const narrow = { ...g, box: { ...g.box, right: g.box.right - 11 } };
    expect(gridFailures(narrow, 'rtl').slice(0, 2)).toEqual(['the grid is 1717 px wide, expected 1728', "the grid starts 11 px from the safe area's inline start, expected 0"]);
  });

  it('catches rows out of place: a gap, a height, a missing row, the timeline after the channels', () => {
    const g = draw('en');
    const moved = { ...g, rows: g.rows.map((row, i) => (i === 4 ? { ...row, top: row.top + 10, bottom: row.bottom + 10 } : row)) };
    expect(gridFailures(moved, 'ltr')[0]).toContain('row 4 is 426 px below the grid\'s top, expected 416');
    const low = { ...g, rows: g.rows.map((row) => (row.row === 2 ? { ...row, bottom: row.bottom - 6 } : row)) };
    expect(gridFailures(low, 'ltr')).toEqual(['1 misplaced: row 2 is 74 px tall, expected 80']);
    const missing = { ...g, rows: g.rows.filter((row) => row.row !== 5) };
    expect(gridFailures(missing, 'ltr')).toContain('the grid draws rows 0, 1, 2, 3, 4, 6, 7, 8, expected 0, 1, 2, 3, 4, 5, 6, 7, 8');
    const shifted = { ...g, rows: g.rows.map((row) => ({ ...row, line: { ...row.line!, left: row.line!.left + 8, right: row.line!.right + 8 } })) };
    expect(gridFailures(shifted, 'ltr')[0]).toContain("row 0: the timeline starts 416 px from the grid's inline start, expected 408");
  });

  it('catches the grid sized or placed wrong: its width, its span, the header above it', () => {
    const g = draw('en');
    expect(gridFailures({ ...g, box: { ...g.box, right: g.box.right - 11 } }, 'ltr')).toContain('the grid is 1717 px wide, expected 1728');
    expect(gridFailures({ ...g, span: 90 }, 'ltr')).toContain('the grid shows 90 minutes, expected 120');
    const high = { ...g, box: { ...g.box, top: g.box.top - 20 } };
    expect(gridFailures(high, 'ltr')).toContain("the grid starts 90 px below the safe area's top, expected 110 (the header)");
  });

  it('catches the slot labels and the now line out of place, and an empty label', () => {
    const g = draw('ar');
    const slots = { ...g, slots: g.slots.map((s, i) => (i === 2 ? { ...s, left: s.left - 5, right: s.right - 5 } : s)) };
    expect(gridFailures(slots, 'rtl')[0]).toContain('the 15:30 label starts 665 px from the timeline\'s inline start, expected 660');
    const missing = { ...g, slots: g.slots.slice(1) };
    expect(gridFailures(missing, 'rtl')[0]).toContain('the time header labels 15:00, 15:30, 16:00, expected 14:30, 15:00, 15:30, 16:00');
    const empty = { ...g, slots: g.slots.map((s, i) => (i === 0 ? { ...s, text: ' ' } : s)) };
    expect(gridFailures(empty, 'rtl')[0]).toContain('the 14:30 label is empty');
    const now = drawnGrid({ language: 'ar', entry: ENTRY, top: 0, index: 0, time: NOW + 7, view: NOW, now: NOW + 7 });
    expect(gridFailures(now, 'rtl')).toEqual([]);
    expect(gridFailures({ ...now, now: { minute: NOW + 7, centre: now.now!.centre + 11 } }, 'rtl')[0]).toContain('the now line (14:37) is 66 px from the timeline\'s inline start, expected 77');
  });

  it('draws a cell cut to a minute by the view as its border, 8 px wide, and catches one a pixel off', () => {
    // The view one minute before 15:00: the 14:00 programme shows for a minute.
    const edge = draw('en', { view: NOW + 29, time: NOW + 29 });
    const short = edge.rows[1]!.cells[0]!;
    expect([short.start, short.right - short.left]).toEqual([NOW - 30, 8]);
    expect(gridFailures(edge, 'ltr')).toEqual([]);
    const narrow = withCells(edge, (c, row) => (row.row === 1 && c === row.cells[0] ? { ...c, right: c.left + 7 } : c));
    expect(gridFailures(narrow, 'ltr')[0]).toContain('row 1 cell 14:00 is 7 px wide, expected 8');
    const nudged = withCells(draw('ar'), (c, row) => (row.row === 6 && c.start === NOW + 30 ? { ...c, left: c.left - 1, right: c.right - 1 } : c));
    expect(gridFailures(nudged, 'rtl')).toEqual(["1 misplaced: row 6 cell 15:00 starts 331 px from the timeline's inline start, expected 330"]);
  });

  it('lists the first five problems, then a count', () => {
    const stacked = withCells(draw('en'), (c, row) => ({ ...c, left: row.line!.left, right: row.line!.left + c.right - c.left }));
    expect(gridFailures(stacked, 'ltr')[0]).toMatch(/^\d+ misplaced: (?:[^;]+; ){4}[^;]+ and \d+ more$/);
  });
});

describe('scheduleFailures', () => {
  it.each(['en', 'ar'] as const)("passes the fixture's programmes and placeholders (%s)", (language) => {
    expect(scheduleFailures(draw(language), ENTRY, language)).toEqual([]);
    expect(scheduleFailures(draw(language, { top: 9, index: 10, view: NOW + 150 }), ENTRY, language)).toEqual([]);
  });

  it('catches a wrong title, a programme missing, and the placeholder in the wrong language', () => {
    const title = withCells(draw('en'), (c, row) => (row.row === 1 && c.start === NOW + 30 ? { ...c, title: 'fixture.17 16h' } : c));
    expect(scheduleFailures(title, ENTRY, 'en')[0]).toContain('row 1 (Zoma Channel 17): draws 14:00–15:00 "fixture.17 14h", 15:00–16:00 "fixture.17 16h", 16:00–17:00 "fixture.17 16h", expected');
    const g = draw('en');
    const gone = { ...g, rows: g.rows.map((row) => (row.row === 3 ? { ...row, cells: row.cells.map((c) => ({ ...c, programme: -1, title: GUIDE_TEXT.en.noInfo })) } : row)) };
    expect(scheduleFailures(gone, ENTRY, 'en')[0]).toMatch(/^1 of 9 rows wrong: row 3 \(Zoma Channel 41\): draws 14:00–15:00 \(No information\)/);
    expect(scheduleFailures(draw('en'), ENTRY, 'ar')[0]).toContain(`row 0 (Zoma Channel 5): no guide, but draws 14:30–15:00 (No information)`);
  });

  it('catches a programme on a channel without a guide, a wrong number and a wrong name', () => {
    const extra = withCells(draw('ar'), (c, row) => (row.row === 2 && c.start === NOW ? { ...c, programme: 0, title: 'fixture.29 14h' } : c));
    expect(scheduleFailures(extra, ENTRY, 'ar')[0]).toContain('row 2 (Zoma Channel 29): no guide, but draws 14:30–15:00 "fixture.29 14h"');
    const g = draw('en');
    const renamed = { ...g, rows: g.rows.map((row) => (row.row === 4 ? { ...row, number: '1', name: 'Zoma Channel 1' } : row)) };
    expect(scheduleFailures(renamed, ENTRY, 'en')[0]).toContain(`row 4 (Zoma Channel 53): number "1", expected ${ENTRY.allStart + 5}; row 4 (Zoma Channel 53): name "Zoma Channel 1"`);
    // A placeholder that claims a programme on a channel without a guide.
    const claimed = withCells(draw('en'), (c, row) => (row.row === 0 && c.start === NOW ? { ...c, programme: 3 } : c));
    expect(scheduleFailures(claimed, ENTRY, 'en')[0]).toContain('row 0 (Zoma Channel 5): no guide, but draws 14:30–15:00 "No information"');
  });

  it('catches a row past the end of the category', () => {
    const g = draw('en');
    const past = { ...g, rows: [...g.rows, { ...g.rows[8]!, row: ENTRY.channels.length }] };
    expect(scheduleFailures(past, ENTRY, 'en')).toEqual([`1 of 10 rows wrong: row ${ENTRY.channels.length}: not in the fixture`]);
  });
});

describe('cursorFailures', () => {
  it('passes one focused cell on the focused row holding the cursor', () => {
    expect(cursorFailures(draw('en'), 0, NOW)).toEqual([]);
    expect(cursorFailures(draw('ar', { index: 1, time: NOW + 30 }), 1, NOW + 30)).toEqual([]);
  });

  it('catches no focused cell, two, one on another row, and one that does not hold the cursor', () => {
    expect(cursorFailures(withCells(draw('en'), (c) => ({ ...c, state: 'idle' })), 0, NOW)).toEqual(['0 cells drawn focused, expected 1']);
    expect(cursorFailures(withCells(draw('en'), (c, row) => (row.row === 1 && c.start === NOW - 30 ? { ...c, state: 'focused' } : c)), 0, NOW)).toEqual(['2 cells drawn focused, expected 1']);
    expect(cursorFailures(draw('en', { index: 2 }), 0, NOW)).toEqual(['the focused cell is on row 2, expected 0 (the focus)']);
    expect(cursorFailures(draw('en'), 0, NOW + 30)).toEqual(['the focused cell (14:30–15:00) does not hold the cursor 15:00']);
    expect(cursorFailures(draw('en'), 0, NOW - 1)).toEqual(['the focused cell (14:30–15:00) does not hold the cursor 14:29']);
    expect(cursorFailures(draw('en'), 0, null)).toEqual(['the focused cell (14:30–15:00) does not hold the cursor (none)']);
  });
});

describe('GUIDE_LAYOUT', () => {
  it('fits nine rows and two hours in the safe area under the 110 px header', () => {
    const L = GUIDE_LAYOUT;
    expect(L.channelWidth + L.channelGap + 120 * L.minuteWidth).toBe(1728);
    expect(110 + L.headerHeight + 9 * (L.rowHeight + L.rowGap)).toBeLessThanOrEqual(972);
  });
});
