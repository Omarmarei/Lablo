import type { CatalogItem, ContentKey, EpgProgramme } from '@lablo/core';
import { EPG_WINDOWS } from '@lablo/core';
import type { GuideRequest, GuideRow, ProgrammeRequest } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import type { EpgZone } from '@lablo/ui';
import { SCREEN, createNavigator, guideCellAt, guideHeight, guideWidth } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveRow, Timers } from '../live/live-state';
import type { GuideEngine, GuideList } from './guide-state';
import { GUIDE, GUIDE_ASK_MS, GUIDE_DAYS, GUIDE_GRID, GUIDE_KEEP, GUIDE_REACH, GUIDE_SCREEN, GUIDE_VISIBLE, askedDays, createGuide, dayOf, guideDays, guideRange, mergeDays } from './guide-state';
import { DETAILS_SCREEN } from './programme-details';

const MINUTE = 60_000;

/** Local midnight `d` days after 2026-11-05, in UTC minutes (the tests run in any time zone). */
const midnight = (d: number): number => Math.round(new Date(2026, 10, 5 + d).getTime() / MINUTE);
/** 20:17:30 on 2026-11-05 in the TV's own time. */
const T0 = new Date(2026, 10, 5, 20, 17, 30).getTime();
const NOW = Math.floor(T0 / MINUTE);

function item(n: number): CatalogItem {
  return {
    key: `x:s1:live:0-${n}`,
    src: 's1',
    kind: 'live',
    name: `Channel ${n}`,
    normName: '',
    group: '',
    url: `http://panel.test/live/u/p/${n}.ts`,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

const keyOf = (n: number): ContentKey => `x:s1:live:0-${n}`;
const numberOf = (key: ContentKey): number => Number(key.slice(key.lastIndexOf('-') + 1));

/** Channel `n`'s programme length from the epoch: 50 and 70 minutes don't divide a day, so some cross midnight. */
const lengthOf = (n: number): number => [30, 45, 50, 70][n % 4]!;
/** Every tenth channel (9, 19…) has no guide. */
const guided = (n: number): boolean => n % 10 !== 9;

/** Channel `n`'s programmes overlapping `[from, to)`, as the query worker gives them. */
function rowFor(key: ContentKey, from: number, to: number): GuideRow {
  const n = numberOf(key);
  if (!guided(n)) return { key, epgSrc: null, start: [], end: [], title: [] };
  const length = lengthOf(n);
  const start: number[] = [];
  const end: number[] = [];
  const title: string[] = [];
  for (let k = Math.floor(from / length); k * length < to; k += 1) {
    start.push(k * length);
    end.push((k + 1) * length);
    title.push(`P${n}-${k}`);
  }
  return { key, epgSrc: 'g1', start, end, title };
}

/** A channel's programme on air at `minute`: its index from the epoch. */
const onAir = (n: number, minute: number): number => Math.floor(minute / lengthOf(n));

/** Channel `n`'s programme that starts at `start`, whole, as the query worker gives it (`null`: none starts then). */
function programmeFor(key: ContentKey, start: number): EpgProgramme | null {
  const n = numberOf(key);
  const length = lengthOf(n);
  if (!guided(n) || start % length !== 0) return null;
  const title = `P${n}-${start / length}`;
  return { start, end: start + length, title, sub: '', desc: `About ${title}`, category: 'Test', episode: '', flags: 0 };
}

interface Held {
  readonly req: GuideRequest;
  resolve(rows: GuideRow[]): void;
  reject(error: unknown): void;
}

class FakeEngine implements GuideEngine {
  hold = false;
  fail = false;
  readonly calls: GuideRequest[] = [];
  readonly held: Held[] = [];
  /** The details' reads, and those held while `holdProgramme`. */
  readonly programmes: ProgrammeRequest[] = [];
  holdProgramme = false;
  readonly heldProgrammes: { resolve(p: EpgProgramme | null): void; req: ProgrammeRequest }[] = [];
  /** The stored guides' past days (step 25c); a test sets it (without it, the guide keeps the tier's one day). */
  guidePastDays?: () => Promise<number>;

  programme(req: ProgrammeRequest): Promise<EpgProgramme | null> {
    this.programmes.push({ key: req.key, start: req.start });
    if (!this.holdProgramme) return Promise.resolve(programmeFor(req.key, req.start));
    return new Promise((resolve) => this.heldProgrammes.push({ resolve, req }));
  }

  guide(req: GuideRequest): Promise<GuideRow[]> {
    this.calls.push({ keys: req.keys.slice(), from: req.from, to: req.to });
    const answer = (): GuideRow[] => req.keys.map((key) => rowFor(key, req.from, req.to));
    if (this.fail) return Promise.reject(new Error('read failed'));
    if (!this.hold) return Promise.resolve(answer());
    return new Promise<GuideRow[]>((resolve, reject) => {
      this.held.push({ req, resolve, reject });
    });
  }

  /** Answers every held call (as asked). */
  answerAll(): void {
    for (const h of this.held.splice(0)) h.resolve(h.req.keys.map((key) => rowFor(key, h.req.from, h.req.to)));
  }

  /** The channels asked, per call, as numbers, with the call's day. */
  asked(): string[] {
    return this.calls.map((c) => `${dayName(c.from)}:${c.keys.map(numberOf).join(',')}`);
  }
}

/** A call's day by its start: `d0` is 2026-11-05. */
function dayName(from: number): string {
  for (let d = -8; d < 10; d += 1) if (midnight(d) === from) return `d${d}`;
  return `?${from}`;
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_v, i) => from + i);
const asked = (from: number, to: number): string => range(from, to).join(',');

/** The live list: `count` channels in chunks of 100 rows, read at once unless `hold`. */
class FakeList implements GuideList {
  readonly loaded = new Set<number>();
  hold = false;
  readonly loads: number[] = [];
  private readonly waiting: (() => void)[] = [];
  located: { key: ContentKey; guess: number }[] = [];
  /** Where `locate` finds a channel after a catalog swap (default: its row in `rows`). */
  findAt: (key: ContentKey) => number = (key) => numberOf(key) - this.shift;
  /** The new list's rows start `shift` channels later (a swap). */
  shift = 0;
  /** Channels with a day of Xtream catch-up (step 25a). */
  readonly catchup = new Set<number>();
  /** Channels with Xtream catch-up of other days (step 25c; `null`: none stated). */
  readonly catchupDays = new Map<number, number | null>();

  constructor(
    public total: number,
    chunks: readonly number[] = [],
  ) {
    for (const c of chunks) this.loaded.add(c);
  }

  count(): number {
    return this.total;
  }

  row(index: number): LiveRow | null {
    if (!(index >= 0 && index < this.total) || !this.loaded.has(Math.floor(index / 100))) return null;
    const n = index + this.shift;
    const own = item(n);
    if (this.catchupDays.has(n)) return { item: { ...own, catchup: { mode: 'xc', days: this.catchupDays.get(n)!, source: null } }, number: n + 1 };
    return { item: this.catchup.has(n) ? { ...own, catchup: { mode: 'xc', days: 1, source: null } } : own, number: n + 1 };
  }

  load(index: number): Promise<LiveRow | null> {
    this.loads.push(index);
    const chunk = Math.floor(index / 100);
    const done = (): LiveRow | null => {
      this.loaded.add(chunk);
      return this.row(index);
    };
    if (!this.hold) return Promise.resolve(done());
    return new Promise((resolve) => this.waiting.push(() => resolve(done())));
  }

  release(): void {
    for (const run of this.waiting.splice(0)) run();
  }

  readies = 0;

  /** The new list is in at once (a test changes the list right after `listChanging`). */
  ready(): Promise<void> {
    this.readies += 1;
    return Promise.resolve();
  }

  /** Finds the channel once the new list is in (a test changes the list right after `listChanging`). */
  locate(key: ContentKey, guess: number): Promise<number> {
    this.located.push({ key, guess });
    return Promise.resolve().then(() => this.findAt(key));
  }
}

/** Timers run by hand, with a clock that `advance` moves. */
function manualTimers(start: number) {
  let now = start;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      seq += 1;
      queue.push({ id: seq, at: now + ms, run });
      return seq;
    },
    clear: (handle) => {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  return {
    timers,
    now: () => now,
    pending: () => queue.length,
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function setupGuide(options: { count?: number; chunks?: number[]; start?: number; engine?: FakeEngine; list?: FakeList; tier?: 'full' | 'low' } = {}) {
  const engine = options.engine ?? new FakeEngine();
  const count = options.count ?? 1000;
  const list = options.list ?? new FakeList(count, options.chunks ?? range(0, Math.ceil(count / 100)));
  const clock = manualTimers(options.start ?? T0);
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  const play = vi.fn();
  const closed = vi.fn();
  const map = vi.fn();
  const catchup = vi.fn();
  const guide = createGuide({ nav, engine, list, play, closed, map, catchup, now: clock.now, timers: clock.timers, tier: () => options.tier ?? 'full' });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}${f.time === null ? '' : ` @${f.time - midnight(0)}`}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  /** Lets the view rest, then the answers come. */
  const rest = async (): Promise<void> => {
    clock.advance(GUIDE_ASK_MS);
    await flush();
  };
  const position = () => guide.screen.value!.position(GUIDE_GRID);
  /** Opens the guide on `row`, and lets its first ask go (a 0 ms timer, after the opening frame). */
  const open = (row: number): void => {
    guide.open(row);
    clock.advance(0);
  };
  return { guide, engine, list, clock, nav, play, closed, map, catchup, at, press, rest, position, open };
}

const setup = setupGuide;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the guide screen’s layout numbers', () => {
  it('fits 9 rows of two hours under its header in the 1920x1080 safe area', () => {
    expect(GUIDE_VISIBLE).toBe(9);
    expect(guideWidth(GUIDE.span)).toBe(SCREEN.width - 2 * SCREEN.safeX);
    const body = SCREEN.height - 2 * SCREEN.safeY - GUIDE.headerHeight;
    expect(guideHeight(GUIDE_VISIBLE)).toBeLessThanOrEqual(body);
    expect(guideHeight(GUIDE_VISIBLE + 1)).toBeGreaterThan(body);
  });
});

describe('guideDays and dayOf', () => {
  it('shows the days each tier’s EPG window keeps: its least past days, all its future ones', () => {
    for (const tier of ['full', 'low'] as const) {
      expect(GUIDE_DAYS[tier]).toEqual({ past: EPG_WINDOWS[tier].minPastDays, future: EPG_WINDOWS[tier].futureDays });
    }
  });

  it('gives the local midnights from the past days to the end of the last future day', () => {
    expect(guideDays(T0, { past: 1, future: 7 })).toEqual(range(-1, 9).map(midnight));
    expect(guideDays(T0, { past: 1, future: 3 })).toEqual(range(-1, 5).map(midnight));
    // Just after midnight and just before it: the same days.
    expect(guideDays(new Date(2026, 10, 5, 0, 0, 0).getTime(), { past: 0, future: 0 })).toEqual([midnight(0), midnight(1)]);
    expect(guideDays(new Date(2026, 10, 5, 23, 59, 59).getTime(), { past: 0, future: 0 })).toEqual([midnight(0), midnight(1)]);
  });

  it('keeps every boundary at local midnight across a change of daylight saving time', () => {
    for (const month of [2, 9]) {
      for (const b of guideDays(new Date(2026, month, 20, 12).getTime(), { past: 7, future: 14 })) {
        const d = new Date(b * MINUTE);
        expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
      }
    }
  });

  it('finds the day that holds a minute, clamped to the range', () => {
    const bounds = guideDays(T0, { past: 1, future: 2 });
    expect(dayOf(bounds, midnight(-1))).toBe(0);
    expect(dayOf(bounds, midnight(0) - 1)).toBe(0);
    expect(dayOf(bounds, midnight(0))).toBe(1);
    expect(dayOf(bounds, midnight(3) - 1)).toBe(3);
    expect(dayOf(bounds, midnight(3))).toBe(3);
    expect(dayOf(bounds, midnight(-5))).toBe(0);
  });

  it('asks the days the view crosses, then those a view after it and a view before it reach (step 26q)', () => {
    const bounds = guideDays(T0, { past: 1, future: 2 });
    const at = (d: number, h: number, m = 0): number => midnight(d) + h * 60 + m;
    const days = (view: number): number[] => askedDays(bounds, view, GUIDE.span);
    // Day 1 is the 5th. Two hours from midnight either side: the view's own day.
    expect(days(at(0, 20))).toEqual([1]);
    expect(days(at(0, 2))).toEqual([1]);
    // Within a view of midnight: the next day after the view's.
    expect(days(at(0, 20, 1))).toEqual([1, 2]);
    expect(days(at(0, 22))).toEqual([1, 2]);
    // Across it: both, in order.
    expect(days(at(0, 23, 30))).toEqual([1, 2]);
    // Just past it: the day before after the view's.
    expect(days(at(1, 0))).toEqual([2, 1]);
    expect(days(at(1, 1, 59))).toEqual([2, 1]);
    expect(days(at(1, 2))).toEqual([2]);
    // Clamped at the range's ends: each day once.
    expect(days(midnight(-1))).toEqual([0]);
    expect(days(midnight(-1) - 300)).toEqual([0]);
    expect(days(midnight(3) - GUIDE.span)).toEqual([3]);
    expect(days(midnight(3) - GUIDE.span - 1)).toEqual([3]);
  });
});

describe('mergeDays', () => {
  const day = (start: number[], titles: string[]) => ({ start, end: start.map((s) => s + 60), title: titles });

  it('is null with no day read, and empty with only empty days', () => {
    expect(mergeDays([undefined, undefined])).toBeNull();
    expect(mergeDays([undefined, { start: [], end: [], title: [] }])).toEqual({ start: [], end: [], title: [] });
  });

  it('joins the days in order, a programme across midnight once', () => {
    const merged = mergeDays([day([100, 160, 220], ['a', 'b', 'c']), undefined, day([220, 280], ['c', 'd']), day([400], ['e'])]);
    expect(merged).toEqual({ start: [100, 160, 220, 280, 400], end: [160, 220, 280, 340, 460], title: ['a', 'b', 'c', 'd', 'e'] });
    // A day's programme that starts before the last one kept is left out too.
    expect(mergeDays([day([100, 200], ['a', 'b']), day([150, 260], ['x', 'c'])])?.title).toEqual(['a', 'b', 'c']);
  });
});

describe('opening the guide', () => {
  it('shows the list’s rows, focused on the row given at now, the view on the slot of now', async () => {
    const t = setup();
    t.open(42);
    expect(t.at()).toBe(`guide · grid 42 @${20 * 60 + 17}`);
    const zone = t.guide.zone();
    expect([zone.rows, zone.visibleRows, zone.span, zone.slot, zone.now]).toEqual([1000, 9, 120, 30, NOW]);
    expect([zone.from, zone.to]).toEqual([midnight(-1), midnight(8)]);
    expect(t.position()).toEqual({ index: 42, top: 34, time: NOW, view: midnight(0) + 20 * 60 });
    expect(t.guide.screen.value?.id).toBe(GUIDE_SCREEN);
    // The low tier keeps three days ahead.
    const low = setup({ tier: 'low' });
    low.open(0);
    expect([low.guide.zone().from, low.guide.zone().to]).toEqual([midnight(-1), midnight(4)]);
    // A second open while it shows does nothing.
    t.open(7);
    expect(t.at()).toBe(`guide · grid 42 @${20 * 60 + 17}`);
  });

  it('asks the day in view for the rows in view and a page either side, after the opening frame', async () => {
    const t = setup();
    t.guide.open(42);
    // The press that opens it draws its frame first: the ask waits on a 0 ms timer, counted as pending.
    expect(t.engine.calls).toEqual([]);
    expect(t.guide.pending.value).toBe(1);
    t.clock.advance(0);
    expect(t.guide.pending.value).toBe(1);
    // Rows 34–42 in view: 25 to 51.
    expect(t.engine.asked()).toEqual([`d0:${asked(25, 52)}`]);
    expect(t.engine.calls[0]).toMatchObject({ from: midnight(0), to: midnight(1) });
    expect(t.guide.schedule(42)).toBeNull();
    await flush();
    const row = t.guide.schedule(42)!;
    expect(row.title).toContain(`P42-${onAir(42, NOW)}`);
    expect(t.guide.version.value).toBeGreaterThan(0);
    // The zone's cell is the grid's: the programme on air holds the cursor.
    const cell = guideCellAt(row, t.guide.zone(), NOW)!;
    expect(row.title[cell.programme]).toBe(`P42-${onAir(42, NOW)}`);
    expect(t.guide.channel(42)).toEqual({ number: 43, name: 'Channel 42' });
    // Rows out of the list are never asked: near its top and its end.
    const top = setup();
    top.open(0);
    expect(top.engine.asked()).toEqual([`d0:${asked(0, 18)}`]);
    const end = setup();
    end.open(999);
    expect(end.engine.asked()).toEqual([`d0:${asked(982, 1000)}`]);
    await flush();
    expect([top.list.loads, end.list.loads]).toEqual([[], []]);
  });

  it('waits for the view to rest when a key comes before the first ask, and asks nothing once closed', async () => {
    const t = setup();
    t.guide.open(42);
    await t.press('DOWN');
    t.clock.advance(0);
    expect(t.engine.calls).toEqual([]);
    expect(t.guide.pending.value).toBe(1);
    t.clock.advance(GUIDE_ASK_MS - 1);
    expect(t.engine.calls).toEqual([]);
    t.clock.advance(1);
    // Row 43 in view under rows 35–43: 26 to 52.
    expect(t.engine.asked()).toEqual([`d0:${asked(26, 53)}`]);
    // Back before the first ask: nothing asked, nothing pending.
    const back = setup();
    back.guide.open(42);
    await back.press('BACK');
    expect(back.guide.pending.value).toBe(0);
    back.clock.advance(GUIDE_ASK_MS);
    expect([back.engine.calls, back.clock.pending()]).toEqual([[], 0]);
  });

  it('asks both days when the view crosses midnight, one call each', async () => {
    // A view that ends at midnight asks the next day too (step 26q), after its own.
    const ten = setup({ start: new Date(2026, 10, 5, 22, 10).getTime() });
    ten.open(0);
    expect(ten.position().view + GUIDE.span).toBe(midnight(1));
    expect(ten.engine.asked()).toEqual([`d0:${asked(0, 18)}`, `d1:${asked(0, 18)}`]);
    const t = setup({ start: new Date(2026, 10, 5, 23, 40).getTime() });
    t.open(0);
    expect(t.position().view).toBe(midnight(0) + 23 * 60 + 30);
    expect(t.engine.asked()).toEqual([`d0:${asked(0, 18)}`, `d1:${asked(0, 18)}`]);
    expect(t.engine.calls[1]).toMatchObject({ from: midnight(1), to: midnight(2) });
    await flush();
    // Channel 3's 70-minute programmes: one runs across midnight and is kept once.
    const row = t.guide.schedule(3)!;
    const across = row.start.filter((s, i) => s < midnight(1) && row.end[i]! > midnight(1));
    expect(across).toHaveLength(1);
    expect(new Set(row.start).size).toBe(row.start.length);
    expect(row.start.slice().sort((a, b) => a - b)).toEqual(row.start);
    // The cursor past midnight in the same view: a swap asks both days again (the view's, not the cursor's).
    const view = t.position().view;
    for (let i = 0; i < 4 && t.position().time < midnight(1); i += 1) await t.press('RIGHT');
    expect(t.position()).toMatchObject({ view });
    expect(t.position().time).toBeGreaterThanOrEqual(midnight(1));
    t.guide.guidesChanged();
    await t.rest();
    expect(t.engine.asked().slice(2)).toEqual([`d0:${asked(0, 18)}`, `d1:${asked(0, 18)}`]);
  });

  it('reads the day past midnight before the cursor gets there: quick keys on land on its programmes (step 26q)', async () => {
    // 21:15: the view 21:00–23:00 ends a view short of midnight; the one after it reaches the next day.
    const t = setup({ start: new Date(2026, 10, 5, 21, 15).getTime() });
    t.open(3);
    expect(t.position().view).toBe(midnight(0) + 21 * 60);
    expect(t.engine.asked()).toEqual([`d0:${asked(0, 18)}`, `d1:${asked(0, 18)}`]);
    await flush();
    // Channel 3's 70-minute programmes, four keys without a rest: each lands on a programme's start.
    for (let i = 0; i < 4; i += 1) await t.press('RIGHT');
    const time = t.position().time;
    expect(time).toBeGreaterThan(midnight(1));
    expect(time % lengthOf(3)).toBe(0);
    expect(guideCellAt(t.guide.schedule(3), t.guide.zone(), time)!.programme).toBeGreaterThanOrEqual(0);
    await t.rest();
    expect(t.engine.calls).toHaveLength(2);
  });

  it('reads the day before midnight just after it, after the view’s own day: quick keys back land on its programmes', async () => {
    // 00:40: the view 00:30–02:30; the one before it reaches back into the day before.
    const t = setup({ start: new Date(2026, 10, 5, 0, 40).getTime() });
    t.open(3);
    expect(t.engine.asked()).toEqual([`d0:${asked(0, 18)}`, `d-1:${asked(0, 18)}`]);
    await flush();
    await t.press('LEFT', 'LEFT');
    const time = t.position().time;
    expect(time).toBeLessThan(midnight(0));
    expect(time % lengthOf(3)).toBe(0);
    expect(guideCellAt(t.guide.schedule(3), t.guide.zone(), time)!.programme).toBeGreaterThanOrEqual(0);
    // Two hours from midnight either side, a view asks only its own day (as at 20:17).
    const two = setup({ start: new Date(2026, 10, 5, 2, 0).getTime() });
    two.open(3);
    expect(two.engine.asked()).toEqual([`d0:${asked(0, 18)}`]);
  });
});

describe('moving in the guide', () => {
  it('asks nothing for moves inside what it read, and new rows only once the view rests', async () => {
    const t = setup();
    t.open(42);
    await flush();
    // One programme on stays in a view short of midnight; row 42 is the view's last, so UP first.
    await t.press('RIGHT', 'UP', 'DOWN', 'LEFT');
    await t.rest();
    expect(t.position().top).toBe(34);
    expect(t.engine.calls).toHaveLength(1);
    // A page down, then another, quickly: only the rest asks, and only the rows it lacks.
    await t.press('CH_DOWN', 'CH_DOWN');
    expect(t.engine.calls).toHaveLength(1);
    t.clock.advance(GUIDE_ASK_MS - 1);
    await flush();
    expect(t.engine.calls).toHaveLength(1);
    t.clock.advance(1);
    await flush();
    expect(t.position().top).toBe(52);
    expect(t.engine.asked()[1]).toBe(`d0:${asked(52, 70)}`);
    // Back up a page: its rows are kept.
    await t.press('CH_UP');
    await t.rest();
    expect(t.engine.calls).toHaveLength(2);
  });

  it('asks the next day once the view goes past midnight, for the same rows', async () => {
    const t = setup();
    t.open(0);
    await flush();
    // Each RIGHT goes a programme on: channel 0's are 30 minutes, the view moves by slots.
    for (let i = 0; i < 12; i += 1) await t.press('RIGHT');
    await t.rest();
    expect(t.position().view + GUIDE.span).toBeGreaterThan(midnight(1));
    // The view is on the next day only now.
    expect(t.position().view).toBeGreaterThanOrEqual(midnight(1));
    expect(t.engine.asked()).toEqual([`d0:${asked(0, 18)}`, `d1:${asked(0, 18)}`]);
    const row = t.guide.schedule(0)!;
    expect(row.start.some((s) => s >= midnight(1))).toBe(true);
  });

  it('draws the programmes asked before a guide swapped in until the new ones come, then asks again', async () => {
    const t = setup();
    t.engine.hold = true;
    t.open(0);
    t.guide.guidesChanged();
    // The rest comes while the days are still being asked: nothing more is asked yet.
    await t.rest();
    expect(t.engine.calls).toHaveLength(1);
    t.engine.answerAll();
    await flush();
    // The old answer shows, and is asked again after the next rest.
    expect(t.guide.schedule(0)).not.toBeNull();
    expect(t.engine.calls).toHaveLength(1);
    await t.rest();
    expect(t.engine.asked()).toEqual([`d0:${asked(0, 18)}`, `d0:${asked(0, 18)}`]);
    const before = t.guide.schedule(0);
    t.engine.answerAll();
    await flush();
    expect(t.guide.schedule(0)).not.toBe(before);
    // Fresh now: nothing more is asked.
    await t.rest();
    expect(t.engine.calls).toHaveLength(2);
    // A swap while everything is read: the days in view are asked again after the rest.
    t.guide.guidesChanged();
    expect(t.engine.calls).toHaveLength(2);
    await t.rest();
    expect(t.engine.asked()[2]).toBe(`d0:${asked(0, 18)}`);
  });

  it('keeps the newest channel-days and asks again for rows it dropped', async () => {
    const t = setup({ count: 3000 });
    t.open(0);
    await flush();
    expect(t.guide.schedule(0)).not.toBeNull();
    // The open asks 18 rows, each page 9 it lacks; an ask drops the oldest past GUIDE_KEEP, so the
    // first 18 have gone once 18 + 9 (pages - 1) reaches GUIDE_KEEP + 18.
    const pages = GUIDE_KEEP / GUIDE_VISIBLE + 1;
    for (let i = 0; i < pages; i += 1) {
      await t.press('CH_DOWN');
      await t.rest();
    }
    expect(t.guide.schedule(0)).toBeNull();
    // The rows in view are kept.
    const top = t.position().top;
    for (let r = top - GUIDE_VISIBLE; r < top + 2 * GUIDE_VISIBLE; r += 1) expect(t.guide.schedule(r), `row ${r}`).not.toBeNull();
    const calls = t.engine.calls.length;
    for (let i = 0; i < pages + 2; i += 1) await t.press('CH_UP');
    await t.rest();
    expect(t.position().top).toBe(0);
    expect(t.engine.calls).toHaveLength(calls + 1);
    expect(t.engine.asked()[calls]).toBe(`d0:${asked(0, 18)}`);
  });

  it('keeps each row’s merged programmes until one of its days changes', async () => {
    const t = setup();
    t.open(0);
    await flush();
    const first = t.guide.schedule(0);
    expect(first).not.toBeNull();
    expect(t.guide.schedule(0)).toBe(first);
    expect(t.guide.schedule(18)).toBeNull();
    // A page down reads rows 18–26: their schedules are new, row 0's is the same.
    await t.press('CH_DOWN');
    await t.rest();
    expect(t.guide.schedule(18)).not.toBeNull();
    expect(t.guide.schedule(0)).toBe(first);
  });

  it('drops the least recently wanted days first', async () => {
    const t = setup({ count: 3000 });
    t.open(0);
    await flush();
    // Down to rows 0–125, then back to the top: rows 0–17 are wanted again.
    for (let i = 0; i < 12; i += 1) {
      await t.press('CH_DOWN');
      await t.rest();
    }
    for (let i = 0; i < 12; i += 1) await t.press('CH_UP');
    await t.rest();
    expect(t.position().top).toBe(0);
    // Far jumps of 27 rows each: the fifth ask finds 234 kept and drops the 18 least recently wanted.
    for (let i = 0; i < 5; i += 1) {
      t.guide.follow(1000 + 100 * i);
      await t.rest();
    }
    expect(t.guide.schedule(0)).not.toBeNull();
    expect(t.guide.schedule(17)).not.toBeNull();
    expect(t.guide.schedule(18)).toBeNull();
    expect(t.guide.schedule(35)).toBeNull();
    expect(t.guide.schedule(36)).not.toBeNull();
  });

  it('reads the list’s chunks for rows it hasn’t read, then asks their days', async () => {
    const list = new FakeList(1000, [0]);
    list.hold = true;
    const t = setup({ list });
    t.open(95);
    // Rows 87–95 in view: 78–99 are in chunk 0, 100–104 not yet.
    expect(t.engine.asked()).toEqual([`d0:${asked(78, 100)}`]);
    expect(list.loads).toEqual(range(100, 105));
    expect(t.guide.channel(100)).toEqual({ name: '' });
    expect(t.guide.pending.value).toBe(2);
    await flush();
    expect(t.guide.pending.value).toBe(1);
    list.release();
    await flush();
    expect(t.guide.channel(100)).toEqual({ number: 101, name: 'Channel 100' });
    expect(t.engine.asked()[1]).toBe(`d0:${asked(100, 105)}`);
    expect(t.guide.pending.value).toBe(0);
    // Over two days, each row's chunk is read once.
    const late = new FakeList(1000, [0]);
    const two = setup({ list: late, start: new Date(2026, 10, 5, 23, 40).getTime() });
    two.open(95);
    expect(late.loads).toEqual(range(100, 105));
  });

  it('reads the range’s last day', async () => {
    const t = setup({ tier: 'low' });
    t.open(0);
    await flush();
    // To the guide's end: the view is its last two hours.
    t.guide.screen.value!.focus(GUIDE_GRID, 0, midnight(4) - 1);
    await t.rest();
    expect(t.position().view).toBe(midnight(4) - GUIDE.span);
    expect(t.engine.asked()[1]).toBe(`d3:${asked(0, 18)}`);
    const row = t.guide.schedule(0)!;
    expect(row.start[row.start.length - 1]).toBeGreaterThanOrEqual(midnight(4) - 30);
  });

  it('asks again after a failed read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    t.engine.fail = true;
    t.open(0);
    await flush();
    expect(console.warn).toHaveBeenCalled();
    expect(t.guide.pending.value).toBe(0);
    t.engine.fail = false;
    await t.press('RIGHT');
    await t.rest();
    expect(t.engine.asked()).toEqual([`d0:${asked(0, 18)}`, `d0:${asked(0, 18)}`]);
    expect(t.guide.schedule(0)).not.toBeNull();
  });

  it('asks a day being asked only once', async () => {
    const t = setup();
    t.engine.hold = true;
    t.open(0);
    await t.press('DOWN', 'UP');
    await t.rest();
    expect(t.engine.calls).toHaveLength(1);
    // The rest waits in `pending` with the call.
    await t.press('DOWN');
    expect(t.guide.pending.value).toBe(2);
    await t.rest();
    expect(t.guide.pending.value).toBe(1);
    t.engine.answerAll();
    await flush();
    expect(t.guide.pending.value).toBe(0);
  });
});

describe('OK and Back in the guide', () => {
  it('plays the channel on OK on the programme on air, and not on one to come or gone by', async () => {
    const t = setup();
    t.open(2);
    await flush();
    await t.press('OK');
    expect(t.play).toHaveBeenCalledWith(2);
    await t.press('RIGHT', 'OK', 'BACK');
    expect(t.play).toHaveBeenCalledTimes(1);
    await t.press('LEFT', 'LEFT', 'OK', 'BACK');
    expect(t.at()).toMatch(/^guide · grid 2 @/);
    expect(t.position().time).toBeLessThan(NOW);
    expect(t.play).toHaveBeenCalledTimes(1);
    // A channel with no guide plays from the placeholder that holds now, and opens nothing elsewhere.
    const none = setup();
    none.open(9);
    await flush();
    expect(none.guide.schedule(9)).toEqual({ start: [], end: [], title: [] });
    await none.press('OK');
    expect(none.play).toHaveBeenCalledWith(9);
    await none.press('RIGHT', 'OK');
    expect(none.play).toHaveBeenCalledTimes(1);
    expect(none.at()).toMatch(/^guide · grid 9 @/);
    expect(none.engine.programmes).toEqual([]);
  });

  it('opens the details on OK on a programme to come or gone by, with the grid’s channel, title and times', async () => {
    const t = setup();
    t.open(2);
    await flush();
    const length = lengthOf(2);
    const next = (onAir(2, NOW) + 1) * length;
    await t.press('RIGHT', 'OK');
    expect(t.at()).toBe('programme · actions 0');
    expect(t.guide.details.shown.value).toEqual({
      target: { key: keyOf(2), channel: { number: 3, name: 'Channel 2' }, start: next, end: next + length, title: `P2-${next / length}`, archive: false },
      status: 'read',
      programme: programmeFor(keyOf(2), next),
    });
    expect(t.engine.programmes).toEqual([{ key: keyOf(2), start: next }]);
    expect(t.play).not.toHaveBeenCalled();
    // Back: the guide on the same cell.
    await t.press('BACK');
    expect(t.at()).toBe(`guide · grid 2 @${next - midnight(0)}`);
    expect(t.guide.details.shown.value).toBeNull();
    // One gone by.
    const before = (onAir(2, NOW) - 1) * length;
    await t.press('LEFT', 'LEFT', 'OK');
    expect(t.guide.details.shown.value?.target).toMatchObject({ start: before, title: `P2-${before / length}` });
    expect(t.engine.programmes[1]).toEqual({ key: keyOf(2), start: before });
  });

  it('gives the details the programme’s own times where the range cuts its cell', async () => {
    const t = setup({ tier: 'low' });
    t.open(0);
    await flush();
    const { from, to } = t.guide.zone();
    // A channel whose programmes cross both ends of the range (50 and 70 minutes don't divide a day).
    const n = [2, 3, 6, 7].find((c) => from % lengthOf(c) !== 0 && to % lengthOf(c) !== 0)!;
    const length = lengthOf(n);
    t.guide.follow(n);
    // Back to the range's start (over placeholders until the days are read), then the first cell.
    for (let i = 0; i < 400 && t.position().time! > from; i += 1) await t.press('LEFT');
    await t.rest();
    await t.press('LEFT');
    expect(t.position().time).toBe(from);
    await t.press('OK');
    const first = Math.floor(from / length) * length;
    expect(first).toBeLessThan(from);
    expect(t.guide.details.shown.value?.target).toMatchObject({ start: first, end: first + length, title: `P${n}-${first / length}` });
    await t.press('BACK');
    // On to the range's end, then the last cell.
    for (let i = 0; i < 800 && t.position().time! < to - GUIDE.slot; i += 1) await t.press('RIGHT');
    await t.rest();
    await t.press('RIGHT', 'RIGHT', 'RIGHT');
    await t.press('OK');
    const last = Math.floor((to - 1) / length) * length;
    expect(last + length).toBeGreaterThan(to);
    expect(t.guide.details.shown.value?.target).toMatchObject({ start: last, end: last + length });
  });

  it('opens nothing on a programme whose days are not read yet, and on a placeholder', async () => {
    const t = setup();
    t.engine.hold = true;
    t.open(2);
    await t.press('RIGHT', 'OK');
    expect(t.at()).toMatch(/^guide · grid 2 @/);
    expect(t.engine.programmes).toEqual([]);
  });

  it('plays the channel from the details’ "Watch the channel", the dialog closed first', async () => {
    const t = setup();
    t.open(4);
    await flush();
    let top = '';
    t.play.mockImplementation(() => {
      top = t.nav.top.id;
    });
    await t.press('RIGHT', 'OK', 'OK');
    expect(t.play).toHaveBeenCalledWith(4);
    expect(top).toBe(GUIDE_SCREEN);
    expect(t.guide.details.shown.value).toBeNull();
    // "Close" closes it, and plays nothing.
    await t.press('OK', 'RIGHT', 'RIGHT', 'OK');
    expect(t.at()).toMatch(/^guide · grid 4 @/);
    expect(t.play).toHaveBeenCalledTimes(1);
    expect(t.map).not.toHaveBeenCalled();
  });

  it('opens the manual mapping on the details’ channel from "Guide channel" (step 24e), the dialog closed first', async () => {
    const t = setup();
    t.open(4);
    await flush();
    let top = '';
    t.map.mockImplementation(() => {
      top = t.nav.top.id;
    });
    await t.press('RIGHT', 'OK', 'RIGHT', 'OK');
    expect(t.map).toHaveBeenCalledTimes(1);
    expect(t.map).toHaveBeenCalledWith({ key: keyOf(4), name: 'Channel 4' });
    expect(top).toBe(GUIDE_SCREEN);
    expect(t.guide.details.shown.value).toBeNull();
    expect(t.play).not.toHaveBeenCalled();
    // A guide with no `map`: the button closes the dialog, nothing else.
    const nav = createNavigator({ root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 10 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined, now: () => 0 });
    const clock = manualTimers(T0);
    const bare = createGuide({ nav, engine: new FakeEngine(), list: new FakeList(10, [0]), play: vi.fn(), closed: vi.fn(), now: clock.now, timers: clock.timers });
    bare.open(4);
    clock.advance(0);
    await flush();
    for (const key of ['RIGHT', 'OK', 'RIGHT', 'OK'] as const) nav.handle(key);
    await flush();
    expect(nav.top.id).toBe(GUIDE_SCREEN);
    expect(bare.details.shown.value).toBeNull();
  });

  it('offers "Watch from the start" for a programme gone by on a channel with catch-up, and plays it from the archive (step 25a)', async () => {
    const t = setup();
    t.list.catchup.add(4);
    t.open(4);
    await flush();
    const length = lengthOf(4);
    await t.press('LEFT', 'LEFT');
    // The cell under the focus: a programme gone by.
    const before = Math.floor(t.position().time! / length) * length;
    expect(before + length).toBeLessThanOrEqual(NOW);
    await t.press('OK');
    expect(t.guide.details.shown.value?.target).toMatchObject({ key: keyOf(4), start: before, end: before + length, archive: true });
    expect(t.nav.top.zone('actions')).toMatchObject({ count: 4 });
    let top = '';
    t.catchup.mockImplementation(() => {
      top = t.nav.top.id;
    });
    await t.press('OK');
    expect(t.catchup).toHaveBeenCalledTimes(1);
    expect(t.catchup).toHaveBeenCalledWith(4, { start: before, end: before + length, title: `P4-${before / length}` });
    expect(top).toBe(GUIDE_SCREEN);
    expect(t.guide.details.shown.value).toBeNull();
    expect(t.play).not.toHaveBeenCalled();
    // "Watch the channel" is the second button now.
    await t.press('OK', 'RIGHT', 'OK');
    expect(t.play).toHaveBeenCalledWith(4);
    expect(t.catchup).toHaveBeenCalledTimes(1);
  });

  it('has no "Watch from the start" for a programme to come, on a channel without catch-up, or in a guide that has no catch-up', async () => {
    const t = setup();
    t.list.catchup.add(4);
    t.open(4);
    await flush();
    await t.press('RIGHT', 'OK');
    expect(t.guide.details.shown.value?.target.archive).toBe(false);
    await t.press('BACK');
    t.guide.follow(2);
    await t.rest();
    await t.press('LEFT', 'LEFT', 'LEFT', 'OK');
    expect(t.guide.details.shown.value?.target).toMatchObject({ key: keyOf(2), archive: false });
    // A guide the app gave no `catchup`.
    const nav = createNavigator({ root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 10 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined, now: () => 0 });
    const clock = manualTimers(T0);
    const list = new FakeList(10, [0]);
    list.catchup.add(4);
    const bare = createGuide({ nav, engine: new FakeEngine(), list, play: vi.fn(), closed: vi.fn(), now: clock.now, timers: clock.timers });
    bare.open(4);
    clock.advance(0);
    await flush();
    for (const key of ['LEFT', 'LEFT', 'OK'] as const) nav.handle(key);
    await flush();
    expect(bare.details.shown.value?.target.archive).toBe(false);
  });

  it('plays from the start only the channel the details are about, after a catalog swap under them', async () => {
    const t = setup();
    t.list.catchup.add(4);
    t.open(4);
    await flush();
    await t.press('LEFT', 'LEFT', 'OK');
    expect(t.guide.details.shown.value?.target.archive).toBe(true);
    // The channel moved a row up in the new list: the guide's focus follows it.
    t.guide.listChanging();
    t.list.shift = 1;
    await flush();
    expect(t.position().index).toBe(3);
    await t.press('OK');
    expect(t.catchup).toHaveBeenCalledTimes(1);
    expect(t.catchup.mock.calls[0]![0]).toBe(3);
    // The channel gone: its row holds another channel now, which doesn't play.
    await t.press('OK');
    expect(t.guide.details.shown.value?.target.archive).toBe(true);
    t.list.findAt = () => -1;
    t.guide.listChanging();
    t.list.shift = 2;
    await flush();
    await t.press('OK');
    expect(t.nav.top.id).toBe(GUIDE_SCREEN);
    expect(t.catchup).toHaveBeenCalledTimes(1);
  });

  it('plays from the details only the channel they are about, after a catalog swap under them', async () => {
    const t = setup();
    t.open(4);
    await flush();
    await t.press('RIGHT', 'OK');
    // The channel moved a row up in the new list: the guide's focus follows it.
    t.guide.listChanging();
    t.list.shift = 1;
    await flush();
    expect(t.position().index).toBe(3);
    expect(t.nav.top.id).toBe(DETAILS_SCREEN);
    await t.press('OK');
    expect(t.play).toHaveBeenCalledWith(3);
    // The channel gone: the focus stays on its row, which another channel holds now.
    await t.press('RIGHT', 'OK');
    expect(t.nav.top.id).toBe(DETAILS_SCREEN);
    t.list.findAt = () => -1;
    t.guide.listChanging();
    t.list.shift = 2;
    await flush();
    expect(t.position().index).toBe(3);
    await t.press('OK');
    expect(t.nav.top.id).toBe(GUIDE_SCREEN);
    expect(t.play).toHaveBeenCalledTimes(1);
  });

  it('counts the details’ read as pending, and drops its answer once the guide is disposed', async () => {
    const t = setup();
    t.open(2);
    await flush();
    t.engine.holdProgramme = true;
    // (The move waits for the view to rest: that counts too.)
    await t.press('RIGHT');
    const before = t.guide.pending.value;
    await t.press('OK');
    expect(t.guide.pending.value).toBe(before + 1);
    t.guide.dispose();
    t.engine.heldProgrammes[0]!.resolve(null);
    await flush();
    expect(t.guide.pending.value).toBe(0);
    expect(t.guide.details.shown.value?.status).toBe('reading');
  });

  it('counts a programme on air from its first minute to the one before its end', async () => {
    const start = onAir(0, NOW) * 30;
    const t = setup({ start: start * MINUTE });
    t.open(0);
    await flush();
    expect(guideCellAt(t.guide.schedule(0), t.guide.zone(), t.position().time)).toMatchObject({ start, end: start + 30 });
    await t.press('OK');
    expect(t.play).toHaveBeenCalledTimes(1);
    // Its end: the next one is on air, the cursor still on this one.
    t.clock.advance(30 * MINUTE);
    await t.press('OK');
    expect(t.play).toHaveBeenCalledTimes(1);
  });

  it('plays from the programme on air even before its programmes are read, by its slot', async () => {
    const t = setup();
    t.engine.hold = true;
    t.open(5);
    await t.press('OK');
    expect(t.play).toHaveBeenCalledWith(5);
  });

  it('goes back to the list on the row it had focused, and forgets what it read', async () => {
    const t = setup();
    t.open(42);
    await flush();
    await t.press('DOWN', 'DOWN', 'RIGHT', 'BACK');
    expect(t.at()).toBe('live · channels 0');
    expect(t.closed).toHaveBeenCalledWith(44);
    expect(t.guide.screen.value).toBeNull();
    expect(t.guide.schedule(44)).toBeNull();
    // The next open asks afresh, at now.
    t.open(44);
    expect(t.guide.schedule(44)).toBeNull();
    expect(t.position().time).toBe(NOW);
    expect(t.engine.calls).toHaveLength(2);
  });

  it('drops the answers of a guide that closed, and asks nothing after', async () => {
    const t = setup();
    t.engine.hold = true;
    t.open(0);
    await t.press('CH_DOWN', 'BACK');
    expect(t.clock.pending()).toBe(0);
    t.engine.answerAll();
    await t.rest();
    expect(t.engine.calls).toHaveLength(1);
    expect(t.guide.schedule(0)).toBeNull();
    expect(t.guide.pending.value).toBe(0);
    expect(t.clock.pending()).toBe(0);
    t.guide.guidesChanged();
    expect(t.clock.pending()).toBe(0);
    t.open(0);
    expect(t.guide.schedule(0)).toBeNull();
  });

  it('asks afresh when it opens again while the closed one’s asks are out, and their late answers free nothing', async () => {
    const t = setup();
    t.engine.hold = true;
    t.open(0);
    await t.press('BACK');
    t.open(0);
    expect(t.engine.calls).toHaveLength(2);
    // The closed one's answer: dropped, and the new ask still counts as out.
    t.engine.held.shift()!.resolve([]);
    await t.press('RIGHT');
    await t.rest();
    expect(t.engine.calls).toHaveLength(2);
    t.engine.answerAll();
    await flush();
    expect(t.guide.schedule(0)).not.toBeNull();
  });

  it('follows the channel the player played last, at the same time', async () => {
    const t = setup();
    t.open(3);
    await t.press('RIGHT');
    const time = t.position().time;
    t.guide.follow(8);
    expect(t.position()).toMatchObject({ index: 8, time });
    // While the player covers it, its keys ask nothing here.
    await t.rest();
    t.nav.push({ id: 'player', zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 4 }] });
    await t.press('RIGHT');
    expect(t.clock.pending()).toBe(0);
    t.nav.pop();
    // Closed: nothing to follow.
    await t.press('BACK');
    t.guide.follow(1);
    expect(t.at()).toBe('live · channels 0');
  });
});

describe('a catalog swap while the guide shows', () => {
  it('reads the new list, on the same channel, and asks its rows again', async () => {
    const list = new FakeList(1000, range(0, 10));
    const t = setup({ list });
    t.open(42);
    await flush();
    await t.press('RIGHT');
    const time = t.position().time;
    t.guide.listChanging();
    // The rest the move started is off: no ask of the old list's rows.
    t.clock.advance(GUIDE_ASK_MS);
    // The new list: 10 channels fewer, each 10 rows up.
    list.total = 990;
    list.shift = 10;
    await flush();
    expect(list.located).toEqual([{ key: keyOf(42), guess: 42 }]);
    expect(t.guide.zone().rows).toBe(990);
    expect((t.guide.screen.value!.zone(GUIDE_GRID) as EpgZone).rows).toBe(990);
    expect(t.position()).toMatchObject({ index: 32, time });
    expect(t.engine.calls).toHaveLength(2);
    expect(t.engine.calls[1]!.keys).toContain(keyOf(42));
    expect(t.guide.schedule(32)?.title).toContain(`P42-${onAir(42, time)}`);
  });

  it('keeps the place when the new list lacks the channel, and drops answers from the old list', async () => {
    const list = new FakeList(1000, range(0, 10));
    const t = setup({ list });
    t.engine.hold = true;
    t.open(42);
    const version = t.guide.version.value;
    list.findAt = () => -1;
    t.guide.listChanging();
    t.engine.answerAll();
    await flush();
    // Drawn again for the new list, before its programmes come.
    expect(t.guide.version.value).toBe(version + 1);
    expect(t.guide.schedule(42)).toBeNull();
    expect(t.position().index).toBe(42);
    expect(t.engine.calls).toHaveLength(2);
    t.engine.answerAll();
    await flush();
    expect(t.guide.schedule(42)).not.toBeNull();
  });

  it('keeps the place while the focused channel’s row isn’t read yet, once the new list is in', async () => {
    const list = new FakeList(1000, []);
    list.hold = true;
    const t = setup({ list });
    t.open(42);
    t.guide.listChanging();
    list.total = 500;
    await flush();
    expect(list.readies).toBe(1);
    expect(list.located).toEqual([]);
    expect(t.guide.zone().rows).toBe(500);
    expect(t.at()).toMatch(/^guide · grid 42 @/);
    expect(t.closed).not.toHaveBeenCalled();
    // Nothing happens to a guide that isn't open.
    await t.press('BACK');
    t.guide.listChanging();
    await flush();
    expect(list.readies).toBe(1);
  });
});

describe('dispose', () => {
  it('stops asking', async () => {
    const t = setup();
    t.open(0);
    await flush();
    await t.press('CH_DOWN');
    t.guide.dispose();
    await t.rest();
    expect(t.engine.calls).toHaveLength(1);
    expect(t.clock.pending()).toBe(0);
    // Neither a swap nor a key asks, nor does a dispose twice harm.
    t.guide.guidesChanged();
    await t.press('CH_UP');
    expect(t.clock.pending()).toBe(0);
    t.guide.dispose();
  });

  it('drops what comes after, and opens nothing', async () => {
    const list = new FakeList(1000, [0]);
    list.hold = true;
    const t = setup({ list });
    t.engine.hold = true;
    t.open(95);
    const version = t.guide.version.value;
    t.guide.dispose();
    t.engine.answerAll();
    list.release();
    await flush();
    expect(t.guide.version.value).toBe(version);
    expect(t.engine.calls).toHaveLength(1);
    // A swap's new list that comes after it.
    const s = setup();
    s.open(0);
    s.guide.listChanging();
    s.guide.dispose();
    await flush();
    expect(s.engine.calls).toHaveLength(1);
    // Closed, then disposed: no more opens.
    const c = setup();
    c.open(0);
    await c.press('BACK');
    c.guide.dispose();
    c.open(0);
    expect(c.guide.screen.value).toBeNull();
  });
});

describe('the rows’ days', () => {
  it('cover a whole day each, for the channel’s programmes that overlap it', async () => {
    const t = setup();
    t.open(1);
    await flush();
    const row = t.guide.schedule(1)!;
    // Channel 1's 45-minute programmes over the day: the first starts before midnight or at it.
    expect(row.start[0]).toBeLessThanOrEqual(midnight(0));
    expect(row.end[row.end.length - 1]).toBeGreaterThanOrEqual(midnight(1));
    expect(row.start.length).toBe(Math.ceil(midnight(1) / 45) - Math.floor(midnight(0) / 45));
    expect(t.guide.schedule(9)).toEqual({ start: [], end: [], title: [] });
  });
});

describe('the catch-up days and the archive marks (RELAY step 25c)', () => {
  /** An engine whose stored guides keep `days` back, its reads counted (and held while `hold`). */
  function pastEngine(days: number) {
    const engine = new FakeEngine();
    const reads = { count: 0, days, hold: false, held: [] as Array<(n: number) => void> };
    engine.guidePastDays = () => {
      reads.count += 1;
      if (!reads.hold) return Promise.resolve(reads.days);
      return new Promise<number>((resolve) => reads.held.push(resolve));
    };
    return { engine, reads };
  }

  function setup(options: ReturnType<typeof pastEngine> & { tier?: 'full' | 'low' }) {
    const t = setupGuide({ engine: options.engine, ...(options.tier === undefined ? {} : { tier: options.tier }) });
    return { ...t, reads: options.reads };
  }

  it('reaches back as far as the stored guides keep, within each tier’s limit (the EPG window’s)', () => {
    for (const tier of ['full', 'low'] as const) expect(GUIDE_REACH[tier]).toBe(EPG_WINDOWS[tier].maxPastDays);
    expect([0, 1, 2, 2.9, 3, 7, 8, 30, Number.NaN, -1].map((d) => guideRange('full', d).past)).toEqual([1, 1, 2, 2, 3, 7, 7, 7, 1, 1]);
    expect([0, 1, 2, 3, 7, Number.NaN].map((d) => guideRange('low', d).past)).toEqual([1, 1, 2, 2, 2, 1]);
    expect(guideRange('full', 7).future).toBe(GUIDE_DAYS.full.future);
    expect(guideRange('low', 7).future).toBe(GUIDE_DAYS.low.future);
  });

  it('opens on the range the stored guides keep: seven days back in the full tier, two in the low one', async () => {
    const full = setup(pastEngine(7));
    await flush();
    full.open(4);
    expect([full.guide.zone().from, full.guide.zone().to]).toEqual([midnight(-7), midnight(8)]);
    const low = setup({ ...pastEngine(7), tier: 'low' });
    await flush();
    low.open(4);
    expect([low.guide.zone().from, low.guide.zone().to]).toEqual([midnight(-2), midnight(4)]);
    // Guides kept for three days.
    const three = setup(pastEngine(3));
    await flush();
    three.open(4);
    expect(three.guide.zone().from).toBe(midnight(-3));
    // The focus opens at now all the same, the view on its slot.
    expect(full.position()).toEqual({ index: 4, top: 0, time: NOW, view: midnight(0) + 20 * 60 });
  });

  it('widens an open guide once the read comes, the focus where it was and the days read kept', async () => {
    const p = pastEngine(7);
    p.reads.hold = true;
    const t = setup(p);
    // The read went out when the guide was made, and counts as pending until it answers.
    expect(t.reads.count).toBe(1);
    expect(t.guide.pending.value).toBe(1);
    t.open(4);
    await flush();
    expect(t.guide.zone().from).toBe(midnight(-1));
    await t.press('LEFT', 'LEFT');
    const before = t.position();
    const read = t.engine.calls.length;
    const row = t.guide.schedule(4);
    expect(row).not.toBeNull();
    const version = t.guide.version.value;
    t.reads.held.shift()!(7);
    await flush();
    expect([t.guide.zone().from, t.guide.zone().to]).toEqual([midnight(-7), midnight(8)]);
    expect(t.position()).toEqual(before);
    // The row's programmes stay (the days are kept by their midnight), and the grid draws again.
    expect(t.guide.schedule(4)).toEqual(row);
    expect(t.guide.version.value).toBeGreaterThan(version);
    // The view rested after the frame: only the days not read yet are asked (none here).
    t.clock.advance(0);
    await flush();
    expect(t.engine.calls.length).toBe(read);
    // Now the cursor can go back past yesterday: 120 programmes of half an hour, 60 hours back.
    for (let i = 0; i < 120; i += 1) t.nav.handle('LEFT');
    await flush();
    expect(t.position().time!).toBeLessThan(midnight(-1));
    await t.rest();
    expect(t.engine.asked().some((a) => a.startsWith('d-2:'))).toBe(true);
    expect(t.guide.schedule(4)!.start[0]).toBeLessThanOrEqual(midnight(-2));
  });

  it('reads the past days again after a guide swap, and drops an older answer', async () => {
    const t = setup(pastEngine(2));
    await flush();
    t.open(4);
    expect(t.guide.zone().from).toBe(midnight(-2));
    // Two swaps: the first read answers last, and is dropped.
    t.reads.hold = true;
    t.guide.guidesChanged();
    t.guide.guidesChanged();
    expect(t.reads.count).toBe(3);
    const [first, second] = t.reads.held.splice(0);
    second!(5);
    await flush();
    expect(t.guide.zone().from).toBe(midnight(-5));
    first!(1);
    await flush();
    expect(t.guide.zone().from).toBe(midnight(-5));
    // A closed guide takes the new days at its next open, and an unchanged range keeps the zone.
    await t.press('BACK');
    t.guide.guidesChanged();
    t.reads.held.shift()!(3);
    await flush();
    t.open(4);
    expect(t.guide.zone().from).toBe(midnight(-3));
    const zone = t.guide.zone();
    t.guide.guidesChanged();
    t.reads.held.shift()!(3);
    await flush();
    expect(t.guide.zone()).toBe(zone);
  });

  it('draws the days it kept when the range narrows and widens again, before any answer', async () => {
    const t = setup(pastEngine(5));
    await flush();
    t.open(4);
    // Into the fourth day back: its programmes are read.
    while (t.position().time! >= midnight(-3)) t.nav.handle('LEFT');
    await t.rest();
    expect(t.guide.schedule(4)!.start[0]).toBeLessThan(midnight(-3));
    // The stored guides keep three days: the range narrows (the cursor into it) and the row's days are merged over it.
    t.engine.hold = true;
    t.reads.days = 3;
    t.guide.guidesChanged();
    await flush();
    expect(t.guide.zone().from).toBe(midnight(-3));
    expect(t.guide.schedule(4)!.start[0]).toBeGreaterThanOrEqual(midnight(-3) - lengthOf(4));
    // Five again: the fourth day's programmes, still kept, are drawn at once.
    t.reads.days = 5;
    t.guide.guidesChanged();
    await flush();
    expect(t.guide.zone().from).toBe(midnight(-5));
    expect(t.guide.schedule(4)!.start[0]).toBeLessThan(midnight(-3) - lengthOf(4));
  });

  it('keeps one day back when the read fails, or the engine has none', async () => {
    const p = pastEngine(7);
    p.engine.guidePastDays = () => Promise.reject(new Error('no status'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup(p);
    await flush();
    t.open(4);
    expect(t.guide.zone().from).toBe(midnight(-1));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t.guide.pending.value).toBe(1);
    const plain = setupGuide();
    plain.open(4);
    expect(plain.guide.zone().from).toBe(midnight(-1));
  });

  it('gives each row’s archive: from the first minute its days keep, or none', () => {
    const t = setupGuide({ count: 300, chunks: [0, 1] });
    t.list.catchupDays.set(4, 7);
    t.list.catchupDays.set(5, null);
    t.list.catchup.add(6);
    expect(t.guide.archive(4)).toBe(Math.ceil((T0 - 7 * 86_400_000) / MINUTE));
    expect(t.guide.archive(5)).toBe(-Infinity);
    expect(t.guide.archive(6)).toBe(Math.ceil((T0 - 86_400_000) / MINUTE));
    // No catch-up, and a row the list hasn't read.
    expect(t.guide.archive(7)).toBeNull();
    expect(t.guide.archive(250)).toBeNull();
    // It moves with the clock.
    t.clock.advance(30_000);
    expect(t.guide.archive(4)).toBe(Math.ceil((T0 + 30_000 - 7 * 86_400_000) / MINUTE));
    // A guide the app gave no `catchup` marks nothing.
    const nav = createNavigator({ root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 10 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined, now: () => 0 });
    const list = new FakeList(10, [0]);
    list.catchupDays.set(4, 7);
    const bare = createGuide({ nav, engine: new FakeEngine(), list, play: vi.fn(), closed: vi.fn() });
    expect(bare.archive(4)).toBeNull();
  });

  it('keeps a row’s archive until the rows change', async () => {
    const t = setupGuide();
    t.list.catchupDays.set(4, 7);
    t.open(4);
    await flush();
    const from = t.guide.archive(4);
    t.list.catchupDays.set(4, 2);
    // Read once per row: the list's later answer isn't asked.
    expect(t.guide.archive(4)).toBe(from);
    // A catalog swap: asked again (the channel is a row up in the new list).
    t.guide.listChanging();
    t.list.shift = 1;
    t.list.catchupDays.set(5, 3);
    await flush();
    expect(t.guide.archive(4)).toBe(Math.ceil((T0 - 3 * 86_400_000) / MINUTE));
    expect(t.guide.archive(3)).toBe(Math.ceil((T0 - 2 * 86_400_000) / MINUTE));
    // A close forgets them too.
    await t.press('BACK');
    t.list.catchupDays.set(4, 1);
    t.open(3);
    expect(t.guide.archive(3)).toBe(Math.ceil((T0 - 86_400_000) / MINUTE));
  });

  it('says in the details how many days a programme in the archive has left, and nothing when the channel states none', async () => {
    const t = setupGuide();
    t.list.catchupDays.set(4, 7);
    t.list.catchupDays.set(5, null);
    t.list.catchupDays.set(6, 1);
    t.open(4);
    await flush();
    // Channel 4's programme before the one on air: it ended today, so it leaves in seven days.
    await t.press('LEFT', 'LEFT', 'OK');
    expect(t.guide.details.shown.value?.target).toMatchObject({ key: keyOf(4), archive: true, daysLeft: 7 });
    await t.press('BACK', 'DOWN');
    await t.rest();
    await t.press('LEFT', 'OK');
    expect(t.guide.details.shown.value?.target.archive).toBe(true);
    expect(t.guide.details.shown.value?.target).not.toHaveProperty('daysLeft');
    await t.press('BACK', 'DOWN');
    await t.rest();
    // Channel 6 (a day): yesterday evening's programme after 20:17 leaves today; this morning's tomorrow.
    while (t.position().time! > NOW - 23 * 60) t.nav.handle('LEFT');
    await t.rest();
    await t.press('OK');
    const shown = t.guide.details.shown.value!.target;
    expect(shown.start).toBeGreaterThanOrEqual(NOW - 24 * 60);
    expect(shown).toMatchObject({ archive: true, daysLeft: 0 });
    await t.press('BACK');
    while (t.position().time! < midnight(0) + 6 * 60) t.nav.handle('RIGHT');
    await t.rest();
    await t.press('OK');
    expect(t.guide.details.shown.value!.target).toMatchObject({ archive: true, daysLeft: 1 });
    // A programme older than the day: no "From the start", no days.
    await t.press('BACK');
    while (t.position().time! > NOW - 25 * 60) t.nav.handle('LEFT');
    await t.rest();
    await t.press('OK');
    expect(t.guide.details.shown.value!.target.archive).toBe(false);
    expect(t.guide.details.shown.value!.target).not.toHaveProperty('daysLeft');
  });
});
