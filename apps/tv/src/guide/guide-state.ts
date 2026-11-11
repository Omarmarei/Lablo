import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKey, DeviceTier } from '@zoma/core';
import type { GuideRequest, GuideRow } from '@zoma/data';
import type { EpgZone, Focus, GuideChannel, GuideSchedule, Navigator, Screen } from '@zoma/ui';
import { SCREEN, guideCellAt, guideFits, guideZone } from '@zoma/ui';
import type { Timers } from '../live/live-state';
import type { ArchiveProgramme } from '../player/catchup';
import { archiveDays, archiveDaysLeft, archiveFrom, inArchive } from '../player/catchup';
import type { ZapList } from '../player/player-state';
import type { MappingTarget } from '../settings/mapping-state';
import type { Details, DetailsEngine, DetailsTarget } from './programme-details';
import { createDetails } from './programme-details';

/**
 * The guide screen (RELAY step 23c, PLAN 6.2): the grid guide over the live screen's category on
 * show, pushed on the live navigator by the header's "Guide" button.
 *
 *   grid  (an `epg` zone: a row per channel of the list, a time cursor; UP/DOWN change channel and
 *          keep the time, LEFT/RIGHT go a programme back or on, CH± page the rows)
 *
 * - **The first focus** is on the channel the list had focused, at now; the view starts at the
 *   slot that holds now.
 * - **The range:** from local midnight `past` days before today to the end of the day `future`
 *   days after it (`guideRange`: what the tier's EPG window keeps, the past days as far back as
 *   the stored guides keep, which is their channels' longest catch-up, step 25c), in 30-minute
 *   slots counted from that midnight, two hours in view. The stored guides' past days are read
 *   when the guide is made and after each guide swap; an open guide whose range they change
 *   gets the new range at once (the focus stays), and keeps the days it read.
 * - **The archive marks** (step 25c): `archive` gives each row's first archive minute, from the
 *   row's catch-up days (`archiveDays`, kept per row until the rows change), so the grid marks
 *   the programmes gone by that the details offer from the start.
 * - **The data** is kept per channel-day (a local day of the range): the rows in view and a page
 *   either side are asked for the days the view and a view either side cross (`askedDays`: the
 *   day past midnight is read before the cursor gets there, step 26q), the view's own days first,
 *   once the view has rested `GUIDE_ASK_MS` (when the screen opens, on a 0 ms timer: the key
 *   press that opens it draws its first frame without waiting for the ask, or for an answer).
 *   One query-worker call per day. The channels'
 *   rows come from the live list (a chunk it hasn't read is read first). `GUIDE_KEEP`
 *   channel-days are kept, the least recently wanted dropped first; all of it goes when the
 *   screen closes. After a guide swapped in (`guidesChanged`), every day is asked again, and a
 *   row keeps its programmes until the new answer comes. Answers for a screen that closed, or a
 *   list that changed, are dropped.
 * - **OK** on the cell that holds now (the programme on air, or a channel with no guide) plays
 *   the channel: the player opens over the guide, and Back from it comes back here, on the
 *   channel that played. OK on a programme gone by or to come opens its details (step 24a,
 *   `programme-details.ts`), whose "Watch the channel" plays the channel the guide has focused
 *   when it is still that programme's, and whose "Guide channel" opens the manual mapping's
 *   picker on its channel (step 24e); OK on a placeholder elsewhere does nothing (catch-up is
 *   step 25).
 * - **Back** closes the guide: the live list focuses the channel the guide had focused.
 * - **A catalog swap** (`listChanging`, before the live list is replaced): once the new list is
 *   in, the rows are its own and asked again, the focus on the same channel when the new list
 *   has it (else on the same row). The guide stays where it is in the stack (the player may be
 *   over it).
 * - `pending` counts the requests in flight and an ask waiting for the view to rest: 0 means
 *   the screen is settled (e2e).
 */

/** The screen's id on the navigator, and its one zone's. */
export const GUIDE_SCREEN = 'guide';
export const GUIDE_GRID = 'grid';

/** Sizes, all layout constants (no DOM measuring). guide.css uses the same numbers. */
export const GUIDE = {
  /** The header above the grid: a 56 px title line, a 16 px gap and a 38 px details line. */
  headerHeight: 110,
  /** Minutes in view: `guideWidth(120)` is the safe area's 1,728 px. */
  span: 120,
  slot: 30,
} as const;

/** The rows in view under the header (9). */
export const GUIDE_VISIBLE = guideFits(SCREEN.height - 2 * SCREEN.safeY - GUIDE.headerHeight);

/** How long the view must rest before its programmes are asked (scrolling asks nothing). */
export const GUIDE_ASK_MS = 200;
/** Channel-days kept: about four pages of rows over two days, either side of the view. */
export const GUIDE_KEEP = 216;

const MINUTE_MS = 60_000;

/** Days the range shows before today and after it. */
export interface GuideDays {
  readonly past: number;
  readonly future: number;
}

/**
 * What each tier's EPG window keeps without catch-up (core's `EPG_WINDOWS`): one past day, and
 * the future days the refresh stores.
 */
export const GUIDE_DAYS: Readonly<Record<DeviceTier, GuideDays>> = {
  full: { past: 1, future: 7 },
  low: { past: 1, future: 3 },
};

/** The most past days each tier's EPG window keeps for catch-up (core's `EPG_WINDOWS[tier].maxPastDays`). */
export const GUIDE_REACH: Readonly<Record<DeviceTier, number>> = { full: 7, low: 2 };

/**
 * The range's days on `tier` when the stored guides keep `pastDays` back (step 25c): at least
 * the tier's one past day, at most its `GUIDE_REACH`, and all its future days.
 */
export function guideRange(tier: DeviceTier, pastDays: number): GuideDays {
  const floor = GUIDE_DAYS[tier];
  // (NaN, from a summary that has none, keeps the floor.)
  const past = pastDays > floor.past ? Math.min(GUIDE_REACH[tier], Math.floor(pastDays)) : floor.past;
  return { past, future: floor.future };
}

/**
 * The local midnights from `past` days before the day of `nowMs` to the one after the day
 * `future` days after it, in UTC minutes: `past + future + 2` boundaries of the range's days.
 * `new Date(y, m, d)` keeps each one at midnight across a change of daylight saving time.
 */
export function guideDays(nowMs: number, days: GuideDays): number[] {
  const today = new Date(nowMs);
  const out: number[] = [];
  for (let d = -days.past; d <= days.future + 1; d += 1) {
    out.push(Math.round(new Date(today.getFullYear(), today.getMonth(), today.getDate() + d).getTime() / MINUTE_MS));
  }
  return out;
}

/** The day of `bounds` (as `guideDays` gives them) that holds `minute`, clamped to the range. */
export function dayOf(bounds: readonly number[], minute: number): number {
  let day = 0;
  while (day < bounds.length - 2 && (bounds[day + 1] ?? Infinity) <= minute) day += 1;
  return day;
}

/**
 * The days of `bounds` to ask for a view of `span` minutes from `view` (step 26q): the ones the
 * view crosses, then the ones a view after it and a view before it reach, so a few keys along
 * the time find the next day (or the one before) read when they cross midnight. Each once,
 * clamped to the range; a window of three views crosses at most one midnight.
 */
export function askedDays(bounds: readonly number[], view: number, span: number): number[] {
  const first = dayOf(bounds, view);
  // (dayOf clamps a view that ends with the range.)
  const last = dayOf(bounds, view + span - 1);
  const days: number[] = [];
  for (let day = first; day <= last; day += 1) days.push(day);
  for (let day = last + 1; day <= dayOf(bounds, view + 2 * span - 1); day += 1) days.push(day);
  for (let day = first - 1; day >= dayOf(bounds, view - span); day -= 1) days.push(day);
  return days;
}

/**
 * One channel's days as one schedule, in order: a programme that crosses midnight is in both
 * days' answers (each holds what overlaps it), so one that starts at or before the last start
 * kept is left out. `null` when no day of it was read.
 */
export function mergeDays(days: readonly (GuideSchedule | undefined)[]): GuideSchedule | null {
  let read = false;
  const start: number[] = [];
  const end: number[] = [];
  const title: string[] = [];
  for (let d = 0; d < days.length; d += 1) {
    const day = days[d];
    if (day === undefined) continue;
    read = true;
    for (let i = 0; i < day.start.length; i += 1) {
      const begins = day.start[i]!;
      if (begins <= (start[start.length - 1] ?? -Infinity)) continue;
      start.push(begins);
      end.push(day.end[i] ?? begins);
      title.push(day.title[i] ?? '');
    }
  }
  return read ? { start, end, title } : null;
}

/** What the guide needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface GuideEngine extends DetailsEngine {
  guide(req: GuideRequest): Promise<GuideRow[]>;
  /** The past days the stored guides keep: their longest (0 without one). Without it, the tier's one day. */
  guidePastDays?(): Promise<number>;
}

/** The live list on show: its rows, and the channel's row after a catalog swap (`locate`, `ready`). */
export interface GuideList extends Pick<ZapList, 'count' | 'row' | 'load' | 'locate'> {
  /** Settles once the list's newest load is in (or failed). */
  ready(): Promise<void>;
}

export interface GuideOptions {
  /** The live screen's navigator: the guide is a screen on it. */
  readonly nav: Navigator;
  readonly engine: GuideEngine;
  readonly list: GuideList;
  /** The device's tier (default: full): the days the range can show (`guideRange`). */
  readonly tier?: () => DeviceTier;
  /** OK on the programme on air: the player opens row `index` of the list. */
  readonly play: (index: number) => void;
  /** The guide closed with the focus on row `index` (the live list focuses it). */
  readonly closed: (index: number) => void;
  /** "Guide channel" in the programme details (step 24e): the manual mapping's picker over the guide. */
  readonly map?: (target: MappingTarget) => void;
  /**
   * "Watch from the start" in the programme details (step 25a): the player opens row `index` of the
   * list and plays `programme` from the channel's archive.
   */
  readonly catchup?: (index: number, programme: ArchiveProgramme) => void;
  /** The wall clock in ms (the range, the cursor's start, what is on air). */
  readonly now?: () => number;
  readonly timers?: Timers;
}

export interface Guide {
  /** The guide's screen while it is on the stack (the player can cover it). */
  readonly screen: ReadonlySignal<Screen | null>;
  /** Bumps when programmes arrive, or a new list is in: rows are read again through `schedule` and `channel`. */
  readonly version: ReadonlySignal<number>;
  /** Requests in flight (the details' read too), and an ask waiting for the view to rest. */
  readonly pending: ReadonlySignal<number>;
  /** The programme details dialog over the guide. */
  readonly details: Details;
  /** The grid's zone as it is now (its range, rows and cell). */
  zone(): EpgZone;
  /** Row `row`'s programmes over the days read (`null`: none read yet: placeholders). */
  schedule(row: number): GuideSchedule | null;
  /** Row `row`'s channel (an empty name while the list reads its chunk). */
  channel(row: number): GuideChannel;
  /**
   * Row `row`'s archive now (step 25c): the first minute (UTC) a programme gone by may have
   * started at to be in it (`-Infinity`: the channel states no days), or `null` when the row has
   * no catch-up (or isn't read yet, or catch-up isn't wired). The grid marks those programmes.
   */
  archive(row: number): number | null;
  /** Opens the guide on row `row` of the live list, at now. */
  open(row: number): void;
  /** Focuses row `row` (the channel the player played last), keeping the time. */
  follow(row: number): void;
  /** A guide swapped in: every day is asked again. */
  guidesChanged(): void;
  /** The live list is about to be replaced by a refreshed catalog. */
  listChanging(): void;
  dispose(): void;
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A day read for a row, and the guides' epoch it was asked in (an older one is asked again). */
interface DayEntry {
  readonly value: GuideRow;
  readonly epoch: number;
}

/** A row's day, by the day's first minute (its local midnight): a wider range keeps the days read. */
const cellId = (row: number, midnight: number): string => `${row}:${midnight}`;

const EMPTY_RANGE: EpgZone = guideZone({ id: GUIDE_GRID, rows: 0, visibleRows: GUIDE_VISIBLE, from: 0, to: GUIDE.span, span: GUIDE.span, slot: GUIDE.slot, now: 0 }, () => null);

export function createGuide(options: GuideOptions): Guide {
  const { nav, engine, list } = options;
  const clockNow = options.now ?? (() => Date.now());
  const timers = options.timers ?? defaultTimers;
  const tier = options.tier ?? ((): DeviceTier => 'full');
  /** The past days the stored guides keep, as last read (`guidePastDays`). */
  let pastDays = 0;
  /** Bumps on each read of them: an older answer is dropped. */
  let pastRead = 0;
  const range = (): GuideDays => guideRange(tier(), pastDays);

  const screen = signal<Screen | null>(null);
  const version = signal(0);
  const pending = signal(0);

  let disposed = false;
  /** Bumps on each open, close and list change: answers from before are dropped. */
  let seq = 0;
  /** Bumps when a guide swaps in: every day read before is stale. */
  let epoch = 0;
  let zone = EMPTY_RANGE;
  /** The range's day boundaries (`guideDays`). */
  let bounds: number[] = [];
  /** Days read, by `row:day`, least recently wanted first (a Map keeps insertion order). */
  const data = new Map<string, DayEntry>();
  /** Days being asked, with the `seq` they were asked in. */
  const asking = new Map<string, number>();
  /** Each row's days merged into one schedule (dropped when one of its days changes). */
  const merged = new Map<number, GuideSchedule | null>();
  /** Each read row's archive days (`archiveDays`), until the rows change. */
  const archives = new Map<number, number | null>();
  let askTimer: unknown = null;

  const bump = (): void => {
    version.value += 1;
  };

  /** Runs `request`, counting it in `pending` until it settles either way. */
  function track<T>(request: () => Promise<T>): Promise<T> {
    pending.value += 1;
    let running: Promise<T>;
    try {
      running = request();
    } catch (error) {
      running = Promise.reject(error);
    }
    const done = (): void => {
      pending.value -= 1;
    };
    running.then(done, done);
    return running;
  }

  const schedule = (row: number): GuideSchedule | null => {
    const known = merged.get(row);
    if (known !== undefined) return known;
    const parts: (GuideSchedule | undefined)[] = [];
    for (let d = 0; d < bounds.length - 1; d += 1) parts.push(data.get(cellId(row, bounds[d]!))?.value);
    const value = mergeDays(parts);
    merged.set(row, value);
    return value;
  };

  const channel = (row: number): GuideChannel => {
    const known = list.row(row);
    return known === null ? { name: '' } : { number: known.number, name: known.item.name };
  };

  /** Row `row`'s archive days (`archiveDays`; `null` while its row isn't read, or without catch-up wired). */
  const daysOf = (row: number): number | null => {
    if (options.catchup === undefined) return null;
    const known = archives.get(row);
    if (known !== undefined) return known;
    const item = list.row(row);
    if (item === null) return null;
    const days = archiveDays(item);
    archives.set(row, days);
    return days;
  };

  /** Forgets every day read and asked, and the rows' archives (a close, or a new list). */
  const forget = (): void => {
    data.clear();
    asking.clear();
    merged.clear();
    archives.clear();
  };

  const stopTimer = (): void => {
    if (askTimer === null) return;
    timers.clear(askTimer);
    askTimer = null;
    pending.value -= 1;
  };

  /** Asks day `day` for `rows` (keys in the same order) in one call. */
  const request = (day: number, rows: readonly number[], keys: ContentKey[]): void => {
    if (keys.length === 0) return;
    const mine = seq;
    const asked = epoch;
    const ids: string[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const id = cellId(rows[i]!, bounds[day]!);
      ids.push(id);
      asking.set(id, mine);
    }
    const settle = (): void => {
      for (let i = 0; i < ids.length; i += 1) if (asking.get(ids[i]!) === mine) asking.delete(ids[i]!);
    };
    track(() => engine.guide({ keys, from: bounds[day]!, to: bounds[day + 1]! })).then(
      (answers) => {
        settle();
        // A close, a new list or a dispose came meanwhile.
        if (mine !== seq) return;
        // (The query worker answers each key in its place.)
        for (let i = 0; i < rows.length; i += 1) {
          const answer = answers[i];
          if (answer === undefined) continue;
          data.set(ids[i]!, { value: answer, epoch: asked });
          merged.delete(rows[i]!);
        }
        bump();
        // Asked before a guide swapped in: shown until the newer answer comes.
        if (asked !== epoch) scheduleAsk();
      },
      (error: unknown) => {
        settle();
        // The next rest of the view asks again.
        if (!disposed) console.warn('The guide could not be read', error);
      },
    );
  };

  /**
   * Keeps the days `wanted` names (as the most recently wanted) and drops the oldest past
   * `GUIDE_KEEP`. (An ask adds at most 54 days, so the trim never reaches the wanted ones.)
   */
  const keep = (wanted: readonly string[]): void => {
    for (let i = 0; i < wanted.length; i += 1) {
      const known = data.get(wanted[i]!);
      if (known === undefined) continue;
      data.delete(wanted[i]!);
      data.set(wanted[i]!, known);
    }
    let excess = data.size - GUIDE_KEEP;
    const drop: string[] = [];
    data.forEach((_entry, id) => {
      if (excess > 0) {
        drop.push(id);
        excess -= 1;
      }
    });
    for (let i = 0; i < drop.length; i += 1) {
      const id = drop[i]!;
      data.delete(id);
      merged.delete(Number(id.slice(0, id.indexOf(':'))));
    }
  };

  /** Asks the days the view and a view either side cross (`askedDays`) for the rows in view and a page either side, where missing or stale. */
  function ask(): void {
    stopTimer();
    const shown = screen.value;
    if (shown === null) return;
    const pos = shown.position(GUIDE_GRID);
    const count = zone.rows;
    const from = Math.max(0, pos.top - GUIDE_VISIBLE);
    const to = Math.min(count, pos.top + 2 * GUIDE_VISIBLE);
    const days = askedDays(bounds, pos.view, zone.span);
    const wanted: string[] = [];
    const unread: number[] = [];
    for (let d = 0; d < days.length; d += 1) {
      const day = days[d]!;
      const rows: number[] = [];
      const keys: ContentKey[] = [];
      for (let r = from; r < to; r += 1) {
        const id = cellId(r, bounds[day]!);
        wanted.push(id);
        const known = data.get(id);
        if (asking.has(id) || (known !== undefined && known.epoch === epoch)) continue;
        const row = list.row(r);
        if (row === null) {
          if (unread.indexOf(r) === -1) unread.push(r);
          continue;
        }
        rows.push(r);
        keys.push(row.item.key);
      }
      request(day, rows, keys);
    }
    keep(wanted);
    readRows(unread);
  }

  /**
   * Reads the list's chunks for `rows`, then asks their days. (The live list's version draws their
   * channels: `GuideScreen` gets it.)
   */
  const readRows = (rows: readonly number[]): void => {
    if (rows.length === 0) return;
    const reads: Promise<unknown>[] = [];
    for (let i = 0; i < rows.length; i += 1) reads.push(list.load(rows[i]!));
    track(() => Promise.all(reads)).then(
      () => {
        // (After a close, `ask` asks nothing; after a new list, it asks the new rows.)
        if (disposed) return;
        ask();
      },
      (error: unknown) => {
        if (!disposed) console.warn("The guide's channels could not be read", error);
      },
    );
  };

  /** Asks once the view has rested `ms` (a newer call starts the wait again). */
  const scheduleAsk = (ms: number = GUIDE_ASK_MS): void => {
    if (screen.value === null) return;
    if (askTimer !== null) timers.clear(askTimer);
    else pending.value += 1;
    askTimer = timers.set(() => {
      askTimer = null;
      pending.value -= 1;
      ask();
    }, ms);
  };

  const close = (): void => {
    const shown = screen.value;
    if (shown === null) return;
    const row = shown.position(GUIDE_GRID).index;
    seq += 1;
    stopTimer();
    screen.value = null;
    forget();
    // Only Back closes it: it is on top.
    nav.pop();
    options.closed(row);
  };

  const details = createDetails({
    nav,
    engine,
    track,
    // The guide is on top again; a catalog swap may have moved its focus to another channel.
    watch: (target) => {
      const index = screen.value?.position(GUIDE_GRID).index ?? -1;
      if (list.row(index)?.item.key === target.key) options.play(index);
    },
    map: (target) => options.map?.({ key: target.key, name: target.channel.name }),
    // "Watch from the start" (step 25a): the programme from the archive, while the focus is still on its channel.
    fromStart: (target) => {
      const index = screen.value?.position(GUIDE_GRID).index ?? -1;
      if (list.row(index)?.item.key === target.key) options.catchup?.(index, { start: target.start, end: target.end, title: target.title });
    },
  });

  const onSelect = (focus: Focus): void => {
    const now = Math.floor(clockNow() / MINUTE_MS);
    const programmes = schedule(focus.index);
    const cell = guideCellAt(programmes, zone, focus.time ?? now);
    if (cell === null) return;
    if (cell.start <= now && now < cell.end) {
      options.play(focus.index);
      return;
    }
    const p = cell.programme;
    const row = list.row(focus.index);
    if (p < 0 || programmes === null || row === null) return;
    const start = programmes.start[p]!;
    const end = programmes.end[p]!;
    const target: DetailsTarget = { key: row.item.key, channel: channel(focus.index), start, end, title: programmes.title[p] ?? '', archive: false };
    // A programme gone by in the channel's archive can be watched from the start (step 25a), for as many days as are left (25c).
    const days = daysOf(focus.index);
    const nowMs = clockNow();
    if (days !== null && inArchive(archiveFrom(days, nowMs), { start, end }, nowMs)) {
      const left = archiveDaysLeft(days, { start }, nowMs);
      details.open(left === null ? { ...target, archive: true } : { ...target, archive: true, daysLeft: left });
      return;
    }
    details.open(target);
  };

  /** Widens (or narrows) the open guide's range to the stored guides' past days: the focus stays, and the days read are kept. */
  const setPastDays = (days: number): void => {
    pastDays = days;
    const shown = screen.value;
    const want = range();
    if (shown === null || bounds[0] === guideDays(clockNow(), want)[0]) return;
    bounds = guideDays(clockNow(), want);
    zone = guideZone({ ...zone, from: bounds[0]!, to: bounds[bounds.length - 1]! }, schedule);
    merged.clear();
    // (A cursor the new range moves is a focus change: the view's days are asked once it rests.)
    shown.update(zone);
    bump();
  };

  /** Reads the stored guides' past days (when the guide is made, and after a guide swap). */
  const readPastDays = (): void => {
    if (engine.guidePastDays === undefined) return;
    pastRead += 1;
    const mine = pastRead;
    track(() => engine.guidePastDays!()).then(
      (days) => {
        if (!disposed && mine === pastRead) setPastDays(days);
      },
      (error: unknown) => {
        if (!disposed) console.warn("The guides' past days could not be read", error);
      },
    );
  };
  readPastDays();

  const stopFollowing = nav.subscribe((focus) => {
    if (focus.screen === GUIDE_SCREEN) scheduleAsk();
  });

  return {
    screen,
    version,
    pending,
    details,
    zone: () => zone,
    schedule,
    channel,
    archive(row: number): number | null {
      const days = daysOf(row);
      return days === null ? null : archiveFrom(days, clockNow());
    },
    open(row: number): void {
      if (disposed || screen.value !== null) return;
      const nowMs = clockNow();
      bounds = guideDays(nowMs, range());
      zone = guideZone(
        { id: GUIDE_GRID, rows: list.count(), visibleRows: GUIDE_VISIBLE, from: bounds[0]!, to: bounds[bounds.length - 1]!, span: GUIDE.span, slot: GUIDE.slot, now: Math.floor(nowMs / MINUTE_MS) },
        schedule,
      );
      const shown = nav.push({
        id: GUIDE_SCREEN,
        zones: [zone],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
        onSelect,
      });
      screen.value = shown;
      shown.focus(GUIDE_GRID, row);
      // After the press's frame (a key pressed before it waits for the view to rest instead).
      scheduleAsk(0);
    },
    follow(row: number): void {
      screen.value?.focus(GUIDE_GRID, row);
    },
    guidesChanged(): void {
      if (disposed) return;
      epoch += 1;
      // A new guide may keep more days back (or fewer).
      readPastDays();
      scheduleAsk();
    },
    listChanging(): void {
      const shown = screen.value;
      if (shown === null) return;
      const place = shown.position(GUIDE_GRID).index;
      // The channel there, when its row was read (else the place is kept).
      const key = list.row(place)?.item.key ?? null;
      seq += 1;
      const mine = seq;
      stopTimer();
      forget();
      track(() => (key === null ? list.ready().then(() => -1) : list.locate(key, place))).then(
        (found) => {
          // A close, another new list or a dispose came meanwhile.
          if (mine !== seq) return;
          zone = guideZone({ ...zone, rows: list.count() }, schedule);
          shown.update(zone);
          if (found !== -1) shown.focus(GUIDE_GRID, found);
          bump();
          ask();
        },
        () => undefined,
      );
    },
    dispose(): void {
      disposed = true;
      seq += 1;
      stopTimer();
      stopFollowing();
      details.dispose();
    },
  };
}
