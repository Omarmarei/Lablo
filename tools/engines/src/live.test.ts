import { runInNewContext } from 'node:vm';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { fixtureEntries, liveCategories } from './fixture';
import type { LiveView } from './live';
import {
  CHANNELS_VISIBLE,
  LIVE_CATEGORY,
  LIVE_TEXT,
  LIVE_VIEW_FUNCTION,
  PLATFORM_BACK_STUB,
  TV_KEYS,
  listedEntry,
  nowHours,
  programmeTitle,
  railFailures,
  rowFailures,
  rowsFilled,
  unfilledRows,
} from './live';

const CATEGORIES = liveCategories(fixtureEntries());
const CLOCK = Date.UTC(2026, 10, 4, 14, 30);

/** The live screen as the app draws it for rail entry `category` from row `top`, at `clock` (programmes of `hour`). */
function view(category: number, top: number, { language = 'en', hour = 14, clock = CLOCK }: { language?: 'en' | 'ar'; hour?: number; clock?: number } = {}): LiveView {
  const entry = listedEntry(CATEGORIES, category)!;
  return {
    category,
    top,
    heading: entry.name ?? LIVE_TEXT[language].all,
    chips: Array.from({ length: 12 }, (_v, i) => {
      const at = listedEntry(CATEGORIES, i)!;
      return { i, label: at.name ?? LIVE_TEXT[language].all, count: at.channels.length.toLocaleString('en-US'), selected: i === category };
    }),
    rows: entry.channels.slice(top, top + CHANNELS_VISIBLE).map((channel, n) => ({
      i: top + n,
      number: String(entry.allStart + top + n + 1),
      name: channel.name,
      now: channel.guide ? programmeTitle(channel, hour) : null,
      nowText: channel.guide ? `2:00 PM${programmeTitle(channel, hour)}` : LIVE_TEXT[language].noGuide,
      next: channel.guide ? programmeTitle(channel, hour + 1) : null,
    })),
    railSide: language === 'ar' ? 'right' : 'left',
    dialog: false,
    platformBack: 0,
    clock,
  };
}

describe('the live probes', () => {
  it('are plain ES5, so they run on every engine', () => {
    expect(() => parse(`(${LIVE_VIEW_FUNCTION})`, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
    expect(() => parse(PLATFORM_BACK_STUB, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  it('read the rows and chips the virtual lists draw, and the exit dialog', () => {
    for (const mark of ['[data-testid="channels"]', '[data-testid="rail"]', '.z-vlist__item', "getAttribute('data-top')", "getAttribute('data-category')", '[data-testid="exit-dialog"]', ' is-selected ']) {
      expect(LIVE_VIEW_FUNCTION).toContain(mark);
    }
  });

  it("puts a counting stand-in for webOS's PalmSystem.platformBack() on the page", () => {
    const page: { PalmSystem?: { platformBack(): void }; __zomaPlatformBack?: number } = {};
    runInNewContext(PLATFORM_BACK_STUB, { window: page, JSON });
    page.PalmSystem!.platformBack();
    page.PalmSystem!.platformBack();
    expect(page.__zomaPlatformBack).toBe(2);
  });
});

describe('TV_KEYS', () => {
  it('has a distinct code for each key on each TV (test/engines-onboarding.test.ts pins them to the adapters)', () => {
    for (const keys of Object.values(TV_KEYS)) {
      const codes = [keys.chUp.keyCode, keys.chDown.keyCode, keys.back.keyCode];
      expect(new Set(codes).size).toBe(3);
      // None of them is an arrow or OK, which every remote shares.
      expect(codes.some((code) => [13, 37, 38, 39, 40].includes(code))).toBe(false);
    }
  });
});

describe('the fixture as the live screen lists it', () => {
  it('lists "All channels" first: every category in turn, numbered from 1', () => {
    const all = listedEntry(CATEGORIES, 0)!;
    expect(all.name).toBeNull();
    expect(all.allStart).toBe(0);
    expect(all.channels).toHaveLength(2400);
    expect(all.channels.slice(0, 2).map((c) => c.name)).toEqual(['Zoma Channel 1', 'Zoma Channel 13']);
    expect(listedEntry(CATEGORIES, CATEGORIES.length + 1)).toBeNull();
  });

  it('opens a category deep in "All channels" whose first rows mix channels with and without a guide', () => {
    const shown = listedEntry(CATEGORIES, LIVE_CATEGORY)!;
    expect(shown.name).toBe('Group 5');
    expect(shown.allStart).toBeGreaterThan(CHANNELS_VISIBLE);
    const first = shown.channels.slice(0, CHANNELS_VISIBLE);
    expect(first.some((c) => c.guide)).toBe(true);
    expect(first.some((c) => !c.guide)).toBe(true);
    // As do the first window and the one CH− pages to.
    const all = listedEntry(CATEGORIES, 0)!.channels;
    for (const top of [0, CHANNELS_VISIBLE]) {
      const window = all.slice(top, top + CHANNELS_VISIBLE);
      expect([window.some((c) => c.guide), window.some((c) => !c.guide)]).toEqual([true, true]);
    }
  });

  it('fits the rail: the category the walk opens is among the chips drawn from the top', () => {
    expect(LIVE_CATEGORY).toBeLessThan(12);
    expect(CATEGORIES.length + 1).toBeGreaterThan(LIVE_CATEGORY);
  });
});

describe('nowHours and programmeTitle', () => {
  it('give the hour on now, and the last one too for two minutes after the hour', () => {
    expect(nowHours(CLOCK)).toEqual([14]);
    expect(nowHours(Date.UTC(2026, 10, 4, 15, 1))).toEqual([14, 15]);
    expect(nowHours(Date.UTC(2026, 10, 4, 15, 3))).toEqual([15]);
    expect(nowHours(Date.UTC(2026, 10, 5, 0, 1))).toEqual([23, 0]);
  });

  it('title the fixture guide\'s programmes by their channel and UTC hour, past midnight too', () => {
    expect(programmeTitle({ tvgId: 'fixture.9' }, 14)).toBe('fixture.9 14h');
    expect(programmeTitle({ tvgId: 'fixture.9' }, 24)).toBe('fixture.9 0h');
  });
});

describe('rowFailures', () => {
  it('passes the rows the app draws, in "All channels", after CH−, and in a category, in both languages', () => {
    expect(rowFailures(view(0, 0), CATEGORIES, 'en')).toEqual([]);
    expect(rowFailures(view(0, 9), CATEGORIES, 'en')).toEqual([]);
    expect(rowFailures(view(LIVE_CATEGORY, 0, { language: 'ar' }), CATEGORIES, 'ar')).toEqual([]);
    // The last hour's programme, a minute after the hour (the screen asks again at the next minute tick).
    expect(rowFailures(view(0, 0, { hour: 14, clock: Date.UTC(2026, 10, 4, 15, 1) }), CATEGORIES, 'en')).toEqual([]);
  });

  it('ignores the isolation marks around provider text', () => {
    const marked = view(0, 0);
    const rows = marked.rows.map((row) => ({ ...row, name: `${String.fromCharCode(0x2068)}${row.name ?? ''}${String.fromCharCode(0x2069)}` }));
    expect(rowFailures({ ...marked, rows }, CATEGORIES, 'en')).toEqual([]);
  });

  it('reports the wrong window, and an entry the fixture lacks', () => {
    expect(rowFailures({ ...view(0, 0), top: 9 }, CATEGORIES, 'en')).toEqual(['the list draws rows 0–8, expected 9–17']);
    expect(rowFailures({ ...view(0, 0), rows: view(0, 0).rows.slice(0, 3) }, CATEGORIES, 'en')).toEqual(['the list draws rows 0–2, expected 0–8']);
    expect(rowFailures({ ...view(0, 0), rows: [] }, CATEGORIES, 'en')).toEqual(['the list draws rows none, expected 0–8']);
    expect(rowFailures({ ...view(0, 0), category: 40 }, CATEGORIES, 'en')).toEqual(['the list shows rail entry 40, which the fixture does not have']);
  });

  it("numbers a category's rows by their place in \"All channels\"", () => {
    const shown = listedEntry(CATEGORIES, LIVE_CATEGORY)!;
    const drawn = view(LIVE_CATEGORY, 0);
    const own = { ...drawn, rows: drawn.rows.map((row) => (row.i === 0 ? { ...row, number: '1' } : row)) };
    expect(rowFailures(own, CATEGORIES, 'en')).toEqual([`1 of 9 rows wrong: row 0 (${shown.channels[0]!.name}): number "1", expected ${shown.allStart + 1}`]);
  });

  it("reports another channel's programme, a missing next one, and the next hour's as now", () => {
    const drawn = view(0, 0);
    const rows = drawn.rows.map((row) => {
      if (row.i === 0) return { ...row, now: 'fixture.13 14h' };
      if (row.i === 2) return { ...row, next: null };
      if (row.i === 5) return { ...row, now: 'fixture.73 15h', next: 'fixture.73 16h' };
      return row;
    });
    expect(rowFailures({ ...drawn, rows }, CATEGORIES, 'en')).toEqual([
      '3 of 9 rows wrong: row 0 (Zoma Channel 1): now "fixture.13 14h", expected "fixture.1 14h"; row 2 (Zoma Channel 25): next missing, expected "fixture.25 15h"; row 5 (Zoma Channel 73): now "fixture.73 15h", expected "fixture.73 14h"',
    ]);
  });

  it('reports a guide row with nothing on now, and lists both hours a minute after the hour', () => {
    const drawn = view(0, 0, { clock: Date.UTC(2026, 10, 4, 15, 1) });
    const rows = drawn.rows.map((row) => (row.i === 0 ? { ...row, now: null } : row));
    expect(rowFailures({ ...drawn, rows }, CATEGORIES, 'en')).toEqual(['1 of 9 rows wrong: row 0 (Zoma Channel 1): now missing, expected "fixture.1 14h" or "fixture.1 15h"']);
  });

  it('wants the placeholder, in the language on show, on a channel without a guide, and nothing next', () => {
    const drawn = view(0, 0, { language: 'ar' });
    const rows = drawn.rows.map((row) => {
      if (row.i === 1) return { ...row, nowText: LIVE_TEXT.en.noGuide };
      if (row.i === 3) return { ...row, nowText: '' };
      if (row.i === 4) return { ...row, next: 'fixture.61 15h' };
      return row;
    });
    expect(rowFailures({ ...drawn, rows }, CATEGORIES, 'ar')).toEqual([
      `3 of 9 rows wrong: row 1 (Zoma Channel 13): now line "No guide for this channel", expected the placeholder "${LIVE_TEXT.ar.noGuide}"; row 3 (Zoma Channel 37): now line empty, expected the placeholder "${LIVE_TEXT.ar.noGuide}"; row 4 (Zoma Channel 61): a next programme "fixture.61 15h" on a channel without a guide`,
    ]);
  });

  it('reports missing numbers and names', () => {
    const drawn = view(0, 0);
    const rows = drawn.rows.map((row) => (row.i === 1 ? { ...row, number: null, name: null } : row));
    expect(rowFailures({ ...drawn, rows }, CATEGORIES, 'en')).toEqual(['1 of 9 rows wrong: row 1 (Zoma Channel 13): number missing, expected 2, name missing']);
  });
});

describe('rowsFilled', () => {
  it('waits for each row to show a programme or the placeholder', () => {
    const drawn = view(0, 0);
    expect(rowsFilled(drawn)).toBe(true);
    const waiting = drawn.rows.map((row) => (row.i === 0 || row.i === 1 || row.i === 4 ? { ...row, now: null, nowText: null } : row));
    expect(rowsFilled({ rows: waiting })).toBe(false);
    expect(unfilledRows({ rows: waiting })).toBe('rows 0, 1, 4 show neither a programme nor the placeholder');
    expect(rowsFilled({ rows: drawn.rows.map((row) => (row.i === 2 ? { ...row, name: '' } : row)) })).toBe(false);
    expect(rowsFilled({ rows: [] })).toBe(false);
  });
});

describe('railFailures', () => {
  it('passes the rail the app draws in both languages', () => {
    expect(railFailures(view(0, 0), CATEGORIES, 'en')).toEqual([]);
    expect(railFailures(view(LIVE_CATEGORY, 0, { language: 'ar' }), CATEGORIES, 'ar')).toEqual([]);
  });

  it('wants the rail at the inline start: on the left in English, on the right in Arabic', () => {
    expect(railFailures({ ...view(0, 0, { language: 'ar' }), railSide: 'left' }, CATEGORIES, 'ar')).toEqual(['the rail is on the left, expected on the right (the inline start)']);
    expect(railFailures({ ...view(0, 0), railSide: null }, CATEGORIES, 'en')).toEqual(['the rail is missing, expected on the left (the inline start)']);
  });

  it('reads counts as the locale writes them, digits only', () => {
    const drawn = view(0, 0);
    const chips = drawn.chips.map((chip) => (chip.i === 0 ? { ...chip, count: '2٬400' } : chip));
    expect(railFailures({ ...drawn, chips }, CATEGORIES, 'en')).toEqual([]);
    // Arabic-Indic digits are not what ADR-011 ships.
    const indic = drawn.chips.map((chip) => (chip.i === 0 ? { ...chip, count: '٢٬٤٠٠' } : chip));
    expect(railFailures({ ...drawn, chips: indic }, CATEGORIES, 'en')).toEqual(['rail: chip 0: count "٢٬٤٠٠", expected 2400']);
  });

  it("reports our own word for every channel in the wrong language, and a provider's name changed", () => {
    const drawn = view(0, 0, { language: 'ar' });
    const chips = drawn.chips.map((chip) => (chip.i === 0 ? { ...chip, label: LIVE_TEXT.en.all } : chip.i === 1 ? { ...chip, label: 'Group 1x' } : chip));
    expect(railFailures({ ...drawn, chips, heading: LIVE_TEXT.en.all }, CATEGORIES, 'ar')).toEqual([
      `rail: chip 0: "All channels", expected "${LIVE_TEXT.ar.all}"; chip 1: "Group 1x", expected "Group 1"`,
      `the header names "All channels", expected "${LIVE_TEXT.ar.all}"`,
    ]);
  });

  it('reports chips that are not drawn from the top, and a chip the fixture lacks', () => {
    const drawn = view(0, 0);
    expect(railFailures({ ...drawn, chips: drawn.chips.slice(0, 1) }, CATEGORIES, 'en')).toEqual(['the rail draws chips 0, expected 0 onwards']);
    expect(railFailures({ ...drawn, chips: [...drawn.chips, { i: 40, label: 'x', count: '1', selected: false }] }, CATEGORIES, 'en')).toEqual([
      'the rail draws chips 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 40, expected 0 onwards',
      'rail: chip 40: not in the fixture',
    ]);
  });

  it('wants only the category on show selected', () => {
    const drawn = view(LIVE_CATEGORY, 0);
    expect(railFailures({ ...drawn, chips: drawn.chips.map((chip) => ({ ...chip, selected: false })) }, CATEGORIES, 'en')).toEqual(['rail: chips none selected, expected 5']);
  });
});
