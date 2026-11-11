/**
 * The live screen in an old engine (RELAY step 14c). The onboarding walk (onboarding.ts) ends on
 * it after a relaunch; these are the parts it uses there:
 * - `LIVE_VIEW_FUNCTION`, plain ES5 for the walk's probe: the category on show, the list's window
 *   (`data-top`), the header's category, the rail's chips and the list's rows as drawn, which
 *   side of the list the rail is on, the exit dialog, and the page's clock.
 * - The keys the TVs don't share (`TV_KEYS`): CH+, CH− and Back, with each adapter's key codes.
 * - What the screen must show for the harness's fixture (`railFailures`, `rowFailures`): the
 *   rail's categories with their counts, each row's number and name, and now/next from the
 *   fixture's guide (every 8th live channel has hourly programmes), or the placeholder.
 * - `PLATFORM_BACK_STUB`: Back on the rail leaves a webOS app through `PalmSystem.platformBack()`.
 *   The desktop engine has no `PalmSystem`, and the adapter's fallback (`window.close()`) would
 *   end the run, so the walk puts a counting stand-in there first.
 *
 * The selectors and our own words are kept equal to e2e/live.spec.ts and the app's catalogs by
 * test/engines-onboarding.test.ts.
 */
import { stripIsolates } from '@lablo/core';
import type { ListedCategory, ListedChannel } from './fixture';
import { list } from './gallery';
import type { TvPlatform } from './scenario';

export type LiveLanguage = 'en' | 'ar';

/** The boxes and labels of `layout()` in e2e/live.spec.ts. */
export const LIVE_BOXES = '.z-chip, .z-row, .live__title, .live__meta, .live__clock, .z-button';
export const LIVE_LABELS = '.live__title, .live__clock, .z-chip__label:not([translate="no"]), .z-row__next-head';

/** Rows the channel list shows at 1080p (apps/tv live-state `CHANNELS_VISIBLE`): CH+/CH− page by it. */
export const CHANNELS_VISIBLE = 9;

/**
 * The rail entry the walk opens: the fixture's fifth category ("Group 5"). It starts deep in
 * "All channels", so its rows are numbered from there, and its first rows mix channels with and
 * without a guide (live.test.ts checks both).
 */
export const LIVE_CATEGORY = 5;

/** Our own words on the live screen, as the app's catalogs have them. */
export const LIVE_TEXT: Record<LiveLanguage, { readonly all: string; readonly noGuide: string }> = {
  en: { all: 'All channels', noGuide: 'No guide for this channel' },
  ar: { all: 'كل القنوات', noGuide: 'لا يوجد دليل لهذه القناة' },
};

export interface TvKey {
  readonly key: string;
  readonly keyCode: number;
}

/**
 * The remote keys whose codes differ between the TVs (packages/platform-tizen `keys.ts`,
 * packages/platform-webos): the app reads the key code, as on the TV.
 */
export const TV_KEYS: Record<TvPlatform, { readonly chUp: TvKey; readonly chDown: TvKey; readonly back: TvKey }> = {
  tizen: { chUp: { key: 'ChannelUp', keyCode: 427 }, chDown: { key: 'ChannelDown', keyCode: 428 }, back: { key: 'Back', keyCode: 10009 } },
  webos: { chUp: { key: 'PageUp', keyCode: 33 }, chDown: { key: 'PageDown', keyCode: 34 }, back: { key: 'GoBack', keyCode: 461 } },
};

/** A row of the channel list as drawn. */
export interface LiveRowView {
  /** `data-index`: its place in the category on show. */
  readonly i: number;
  readonly number: string | null;
  readonly name: string | null;
  /** The title of the programme on now (null: no guide, or not answered yet). */
  readonly now: string | null;
  /** The now line's whole text: the placeholder for a channel without a guide. */
  readonly nowText: string | null;
  readonly next: string | null;
}

/** A chip of the rail as drawn. */
export interface LiveChipView {
  readonly i: number;
  readonly label: string | null;
  readonly count: string | null;
  readonly selected: boolean;
}

/** The live screen as the walk's probe reads it (`LIVE_VIEW_FUNCTION`). */
export interface LiveView {
  /** The rail entry on show (`data-category`; null off the live screen). */
  readonly category: number | null;
  /** The first row the list draws (`data-top`). */
  readonly top: number | null;
  /** The header's category label. */
  readonly heading: string | null;
  readonly chips: readonly LiveChipView[];
  readonly rows: readonly LiveRowView[];
  /** Which side of the list the rail is on: `left`, `right`, or `overlap` (null: not both drawn). */
  readonly railSide: string | null;
  /** The exit dialog shows. */
  readonly dialog: boolean;
  /** Calls of the `PalmSystem.platformBack()` stand-in (`PLATFORM_BACK_STUB`). */
  readonly platformBack: number;
  /** The page's clock in ms: the guide's programmes are hourly by it. */
  readonly clock: number;
}

/** In-page helper (plain ES5, inside the walk's probe): `liveView(liveRoot)` reads a `LiveView`. */
export const LIVE_VIEW_FUNCTION = `function liveView(live) {
    function text(root, selector) {
      var el = root.querySelector(selector);
      return el ? el.textContent : null;
    }
    function items(root) {
      return root ? Array.prototype.slice.call(root.querySelectorAll('.z-vlist__item')) : [];
    }
    var channels = live ? live.querySelector('[data-testid="channels"]') : null;
    var rail = live ? live.querySelector('[data-testid="rail"]') : null;
    var side = null;
    if (channels && rail) {
      var r = rail.getBoundingClientRect();
      var c = channels.getBoundingClientRect();
      side = r.right <= c.left ? 'left' : r.left >= c.right ? 'right' : 'overlap';
    }
    return {
      category: live && live.hasAttribute('data-category') ? Number(live.getAttribute('data-category')) : null,
      top: channels ? Number(channels.getAttribute('data-top')) : null,
      heading: live ? text(live, '.live__category') : null,
      chips: items(rail).map(function (item) {
        var chip = item.querySelector('.z-chip');
        return {
          i: Number(item.getAttribute('data-index')),
          label: text(item, '.z-chip__label'),
          count: text(item, '.z-chip__count'),
          selected: chip !== null && (' ' + chip.className + ' ').indexOf(' is-selected ') !== -1
        };
      }),
      rows: items(channels).map(function (item) {
        return {
          i: Number(item.getAttribute('data-index')),
          number: text(item, '.z-row__number'),
          name: text(item, '.z-row__name'),
          now: text(item, '.z-row__now .z-row__title'),
          nowText: text(item, '.z-row__now'),
          next: text(item, '.z-row__next .z-row__title')
        };
      }),
      railSide: side,
      dialog: document.querySelector('[data-testid="exit-dialog"]') !== null,
      platformBack: window.__labloPlatformBack || 0,
      clock: Date.now()
    };
  }`;

/** Puts a counting `PalmSystem.platformBack()` on the page (webOS's way out of an app). */
export const PLATFORM_BACK_STUB = `(function () {
  window.__labloPlatformBack = 0;
  window.PalmSystem = { platformBack: function () { window.__labloPlatformBack += 1; } };
  return JSON.stringify(true);
})()`;

/** A rail entry: "All channels" (entry 0, every category in turn) or one category. */
export interface ListedEntry {
  /** The category's name (null: "All channels"). */
  readonly name: string | null;
  readonly allStart: number;
  readonly channels: readonly ListedChannel[];
}

/** Rail entry `index` for the fixture's categories (null: no such entry). */
export function listedEntry(categories: readonly ListedCategory[], index: number): ListedEntry | null {
  if (index === 0) return { name: null, allStart: 0, channels: categories.flatMap((c) => c.channels) };
  return categories[index - 1] ?? null;
}

const plain = (text: string | null): string | null => (text === null ? null : stripIsolates(text).trim());

/**
 * The programme hours that may be on now at the page's `clock`: the screen asks again at the
 * minute tick after a programme ends, so for a minute or two the last hour's can still show.
 */
export function nowHours(clock: number): number[] {
  const hours = [new Date(clock - 2 * 60_000).getUTCHours(), new Date(clock).getUTCHours()];
  return hours[0] === hours[1] ? [hours[1]!] : hours;
}

/** The fixture guide's title of a channel's programme at UTC hour `hour` (fixture.ts `fixtureXmltv`). */
export const programmeTitle = (channel: Pick<ListedChannel, 'tvgId'>, hour: number): string => `${channel.tvgId} ${hour % 24}h`;

/** What is wrong with one drawn row (null: nothing). */
function rowProblem(row: LiveRowView, channel: ListedChannel, number: number, language: LiveLanguage, clock: number): string | null {
  const problems: string[] = [];
  if (plain(row.number) !== String(number)) problems.push(`number ${row.number === null ? 'missing' : `"${row.number}"`}, expected ${number}`);
  if (plain(row.name) !== channel.name) problems.push(`name ${row.name === null ? 'missing' : `"${plain(row.name)}"`}`);
  const now = plain(row.now);
  const next = plain(row.next);
  if (channel.guide) {
    const hour = nowHours(clock).find((h) => now === programmeTitle(channel, h));
    if (hour === undefined) problems.push(`now ${now === null ? 'missing' : `"${now}"`}, expected "${nowHours(clock).map((h) => programmeTitle(channel, h)).join('" or "')}"`);
    else if (next !== programmeTitle(channel, hour + 1)) problems.push(`next ${next === null ? 'missing' : `"${next}"`}, expected "${programmeTitle(channel, hour + 1)}"`);
  } else {
    const shown = plain(row.nowText);
    if (now !== null) problems.push(`a programme "${now}" on a channel without a guide`);
    else if (shown !== LIVE_TEXT[language].noGuide) problems.push(`now line ${shown === null || shown === '' ? 'empty' : `"${shown}"`}, expected the placeholder "${LIVE_TEXT[language].noGuide}"`);
    if (next !== null) problems.push(`a next programme "${next}" on a channel without a guide`);
  }
  return problems.length === 0 ? null : problems.join(', ');
}

/** `3–11`, or `none`. */
function span(indices: readonly number[]): string {
  if (indices.length === 0) return 'none';
  const consecutive = indices.every((n, i) => n === indices[0]! + i);
  return consecutive && indices.length > 1 ? `${indices[0]}–${indices[indices.length - 1]}` : indices.join(', ');
}

/**
 * Has every drawn row answered? A name, and either a programme or the placeholder: the rows'
 * now/next arrive after their chunk, 200 ms after the window rests.
 */
export function rowsFilled(view: Pick<LiveView, 'rows'>): boolean {
  return view.rows.length > 0 && view.rows.every((row) => plain(row.name) !== '' && row.name !== null && (row.now !== null || (plain(row.nowText) ?? '') !== ''));
}

/** The rows that have not answered yet, for a step that never saw them all. */
export function unfilledRows(view: Pick<LiveView, 'rows'>): string {
  if (view.rows.length === 0) return 'the list draws no rows';
  const waiting = view.rows.filter((row) => !rowsFilled({ rows: [row] })).map((row) => row.i);
  return `rows ${span(waiting)} show neither a programme nor the placeholder`;
}

/**
 * The list's rows against the fixture: the window from `data-top` of the category on show, each
 * row's number (its place in "All channels") and name, and now/next from the fixture's guide at
 * the page's clock, or the placeholder.
 */
export function rowFailures(view: LiveView, categories: readonly ListedCategory[], language: LiveLanguage): string[] {
  const entry = view.category === null ? null : listedEntry(categories, view.category);
  if (entry === null) return [`the list shows rail entry ${view.category ?? '-'}, which the fixture does not have`];
  const top = view.top ?? 0;
  const want: number[] = [];
  for (let i = top; i < Math.min(top + CHANNELS_VISIBLE, entry.channels.length); i += 1) want.push(i);
  const got = view.rows.map((row) => row.i);
  if (got.join() !== want.join()) return [`the list draws rows ${span(got)}, expected ${span(want)}`];
  const wrong: string[] = [];
  for (const row of view.rows) {
    const channel = entry.channels[row.i]!;
    const problem = rowProblem(row, channel, entry.allStart + row.i + 1, language, view.clock);
    if (problem !== null) wrong.push(`row ${row.i} (${channel.name}): ${problem}`);
  }
  return wrong.length === 0 ? [] : [`${wrong.length} of ${view.rows.length} rows wrong: ${list(wrong)}`];
}

/** Digits only: a count as the locale writes it (`2,400`). */
const digits = (text: string | null): string => (text === null ? '' : text.replace(/[^0-9]/g, ''));

/**
 * The rail against the fixture: at the inline start (left in English, right in Arabic), its
 * chips from the top ("All channels", then each category with its count), only the category on
 * show selected, and the header naming it.
 */
export function railFailures(view: LiveView, categories: readonly ListedCategory[], language: LiveLanguage): string[] {
  const failures: string[] = [];
  const side = language === 'ar' ? 'right' : 'left';
  if (view.railSide !== side) failures.push(`the rail is ${view.railSide === null ? 'missing' : view.railSide === 'overlap' ? 'over the list' : `on the ${view.railSide}`}, expected on the ${side} (the inline start)`);
  const got = view.chips.map((chip) => chip.i);
  const want = got.map((_i, n) => n);
  if (got.length < 2 || got.join() !== want.join()) failures.push(`the rail draws chips ${span(got)}, expected 0 onwards`);
  const wrong: string[] = [];
  for (const chip of view.chips) {
    const entry = listedEntry(categories, chip.i);
    if (entry === null) {
      wrong.push(`chip ${chip.i}: not in the fixture`);
      continue;
    }
    const label = entry.name ?? LIVE_TEXT[language].all;
    if (plain(chip.label) !== label) wrong.push(`chip ${chip.i}: "${plain(chip.label) ?? ''}", expected "${label}"`);
    if (digits(chip.count) !== String(entry.channels.length)) wrong.push(`chip ${chip.i}: count "${chip.count ?? ''}", expected ${entry.channels.length}`);
  }
  if (wrong.length > 0) failures.push(`rail: ${list(wrong)}`);
  const selected = view.chips.filter((chip) => chip.selected).map((chip) => chip.i);
  if (selected.join() !== String(view.category)) failures.push(`rail: chips ${span(selected)} selected, expected ${view.category ?? '-'}`);
  const shown = view.category === null ? null : listedEntry(categories, view.category);
  const heading = shown === null ? null : (shown.name ?? LIVE_TEXT[language].all);
  if (heading !== null && plain(view.heading) !== heading) failures.push(`the header names "${plain(view.heading) ?? ''}", expected "${heading}"`);
  return failures;
}
