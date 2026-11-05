import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Platform } from '@zoma/platform-api';
import type { EpgZone, FocusBinding, GuideChannel, GuideSchedule, Navigator, Screen } from '@zoma/ui';
import { SCREEN, bindFocus, createNavigator, guideCellAt, guideFits, guideZone } from '@zoma/ui';

/**
 * The grid guide's gallery page (`?screen=gallery-guide`, RELAY step 23b): the `GuideGrid`
 * over made-up rows, driven by the remote, as the component gallery shows the other
 * components. One zone, `guide`: UP/DOWN change channel and keep the time, LEFT/RIGHT go a
 * programme back or on (mirrored in Arabic), CH± page the rows; OK selects a programme. Back
 * follows the platform at this root (webOS: the launcher); there is no exit dialog here.
 *
 * The rows exercise what the grid must get right: a programme from before the view and one
 * past it, gaps (one short enough to join the programme before it), a channel with no guide,
 * short programmes, Arabic and long titles, and a long channel name. No real channel or
 * programme names (CLAUDE.md legal guardrails).
 */

const DAY = 1440;

/**
 * Midnight of a fixed day in the TV's own time zone, in UTC minutes: the demo's times then read
 * the same in every zone (8:17 PM in New York and in Riyadh), so screenshots don't change.
 */
export const GUIDE_DAY = Math.round(new Date(2026, 10, 5).getTime() / 60_000);
/** The demo's "now": 20:17 on that day. */
export const GUIDE_NOW = GUIDE_DAY + 20 * 60 + 17;
/** From midnight to 06:00 the day after, in 30-minute slots, two hours in view. */
export const GUIDE_RANGE = { from: GUIDE_DAY, to: GUIDE_DAY + DAY + 6 * 60, span: 120, slot: 30 } as const;

/** The page's header above the grid (a title line and a details line); the grid has the rest. */
export const GUIDE_GALLERY = { headerHeight: 110 } as const;
export const GUIDE_ROWS_VISIBLE = guideFits(SCREEN.height - 2 * SCREEN.safeY - GUIDE_GALLERY.headerHeight);

export interface GuideDemoRow {
  readonly channel: GuideChannel;
  readonly schedule: GuideSchedule | null;
}

/** `[start, end, title]` with times as hours and minutes on the demo day (24:30 is the next day's 00:30). */
type Show = readonly [number, number, string];

const at = (hours: number, minutes = 0): number => GUIDE_DAY + hours * 60 + minutes;

function rowOf(shows: readonly Show[]): GuideSchedule {
  const start: number[] = [];
  const end: number[] = [];
  const title: string[] = [];
  for (let i = 0; i < shows.length; i += 1) {
    const show = shows[i]!;
    start.push(show[0]);
    end.push(show[1]);
    title.push(show[2]);
  }
  return { start, end, title };
}

const FIRST: readonly GuideDemoRow[] = [
  {
    channel: { number: 101, name: 'Zoma News' },
    schedule: rowOf([
      [at(18), at(19), 'World Report'],
      [at(19), at(20), 'Business Today'],
      // Two minutes empty after it: its cell takes them.
      [at(20), at(20, 28), 'Evening Bulletin'],
      [at(20, 30), at(21), 'Weather and Traffic'],
      [at(21), at(22), 'The Debate'],
      [at(22), at(23), 'Late News'],
    ]),
  },
  {
    channel: { number: 102, name: 'قناة زوما' },
    schedule: rowOf([
      [at(19), at(20, 10), 'برنامج المساء'],
      [at(20, 10), at(21, 25), 'نشرة الأخبار الرئيسية'],
      [at(21, 25), at(22, 40), 'مسلسل السهرة'],
    ]),
  },
  {
    channel: { number: 103, name: 'Zoma Sports 1' },
    schedule: rowOf([
      [at(19, 30), at(22, 15), 'Football: Cup Final, live from the national stadium'],
      [at(22, 15), at(22, 45), 'Match Highlights'],
    ]),
  },
  {
    channel: { number: 104, name: 'Zoma Kids' },
    schedule: rowOf([
      [at(20), at(20, 15), 'Puppet Theatre'],
      [at(20, 15), at(20, 20), 'Song'],
      [at(20, 20), at(20, 35), 'Cartoon Hour'],
      [at(20, 35), at(20, 40), 'Bedtime Story'],
      [at(20, 40), at(21, 30), 'Family Film'],
    ]),
  },
  {
    channel: { number: 105, name: 'Zoma Documentary Channel International Extra Long Name' },
    schedule: rowOf([
      [at(19, 45), at(20, 50), 'Nature: The Desert at Night'],
      // The guide has nothing from 20:50 to 23:00: placeholders by the slot.
      [at(23), at(24), 'Oceans'],
    ]),
  },
  {
    channel: { number: 106, name: 'زوما للأفلام' },
    schedule: rowOf([
      [at(19), at(21, 40), 'فيلم السهرة: رحلة إلى الجنوب'],
      [at(21, 40), at(22), 'أخبار السينما'],
    ]),
  },
  { channel: { number: 107, name: 'Zoma Test Pattern' }, schedule: null },
];

const SHOWS = ['Weather', 'World Report', 'Studio Live', 'Classic Film', 'Travel Diaries', 'Late News', 'Quiz Night', 'Cooking at Home'];
const LENGTHS = [30, 60, 45, 90, 25, 35, 120, 15];

/** 40 rows: the seven above, then numbered channels with shows of varied lengths, every ninth with no guide. */
export const GUIDE_DEMO: readonly GuideDemoRow[] = (() => {
  const out: GuideDemoRow[] = FIRST.slice();
  for (let row = FIRST.length; row < 40; row += 1) {
    const channel = { number: 101 + row, name: `Zoma Channel ${row + 1}` };
    if (row % 9 === 4) {
      out.push({ channel, schedule: null });
      continue;
    }
    const shows: Show[] = [];
    // Each row starts a little before the guide, so its first programme is cut at the guide's start.
    let start = GUIDE_RANGE.from - ((row * 7) % 60);
    for (let i = 0; start < GUIDE_RANGE.to; i += 1) {
      const length = LENGTHS[(row + i) % LENGTHS.length] ?? 30;
      shows.push([start, start + length, SHOWS[(row + i) % SHOWS.length] ?? 'Studio Live']);
      start += length;
    }
    out.push({ channel, schedule: rowOf(shows) });
  }
  return out;
})();

/** What OK last selected, and how many selects there were. */
export interface GuideSelection {
  readonly row: number;
  readonly start: number;
  readonly count: number;
}

export interface GuideGallery {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly screen: Screen;
  readonly zone: EpgZone;
  readonly rows: readonly GuideDemoRow[];
  readonly schedule: (row: number) => GuideSchedule | null;
  readonly selection: ReadonlySignal<GuideSelection | null>;
}

export function createGuideGallery(platform: Pick<Platform, 'rootBackPolicy' | 'exitApp'>, rows: readonly GuideDemoRow[] = GUIDE_DEMO): GuideGallery {
  const selection = signal<GuideSelection | null>(null);
  const schedule = (row: number): GuideSchedule | null => rows[row]?.schedule ?? null;
  const zone = guideZone({ id: 'guide', rows: rows.length, visibleRows: GUIDE_ROWS_VISIBLE, ...GUIDE_RANGE, now: GUIDE_NOW }, schedule);
  const nav = createNavigator({
    root: {
      id: 'gallery-guide',
      zones: [zone],
      onSelect: (focus) => {
        const cell = guideCellAt(schedule(focus.index), zone, focus.time ?? GUIDE_NOW);
        if (cell === null) return;
        selection.value = { row: focus.index, start: cell.start, count: (selection.value?.count ?? 0) + 1 };
      },
    },
    rootBack: platform.rootBackPolicy(),
    exit: () => platform.exitApp(),
    exitDialog: () => undefined,
  });
  return { nav, binding: bindFocus(nav), screen: nav.top, zone, rows, schedule, selection };
}
