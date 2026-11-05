import type { CatalogItem, ContentKey } from '@zoma/core';
import { EPG_WINDOWS } from '@zoma/core';
import type { GuideRequest, GuideRow } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import type { EpgZone } from '@zoma/ui';
import { SCREEN, createNavigator, guideCellAt, guideHeight, guideWidth } from '@zoma/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveRow, Timers } from '../live/live-state';
import type { GuideEngine, GuideList } from './guide-state';
import { GUIDE, GUIDE_ASK_MS, GUIDE_DAYS, GUIDE_GRID, GUIDE_KEEP, GUIDE_SCREEN, GUIDE_VISIBLE, createGuide, dayOf, guideDays, mergeDays } from './guide-state';

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
  for (let d = -2; d < 10; d += 1) if (midnight(d) === from) return `d${d}`;
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
    return { item: item(n), number: n + 1 };
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

function setup(options: { count?: number; chunks?: number[]; start?: number; engine?: FakeEngine; list?: FakeList; tier?: 'full' | 'low' } = {}) {
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
  const guide = createGuide({ nav, engine, list, play, closed, now: clock.now, timers: clock.timers, days: () => GUIDE_DAYS[options.tier ?? 'full'] });
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
  return { guide, engine, list, clock, nav, play, closed, at, press, rest, position };
}

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
    t.guide.open(42);
    expect(t.at()).toBe(`guide · grid 42 @${20 * 60 + 17}`);
    const zone = t.guide.zone();
    expect([zone.rows, zone.visibleRows, zone.span, zone.slot, zone.now]).toEqual([1000, 9, 120, 30, NOW]);
    expect([zone.from, zone.to]).toEqual([midnight(-1), midnight(8)]);
    expect(t.position()).toEqual({ index: 42, top: 34, time: NOW, view: midnight(0) + 20 * 60 });
    expect(t.guide.screen.value?.id).toBe(GUIDE_SCREEN);
    // The low tier keeps three days ahead.
    const low = setup({ tier: 'low' });
    low.guide.open(0);
    expect([low.guide.zone().from, low.guide.zone().to]).toEqual([midnight(-1), midnight(4)]);
    // A second open while it shows does nothing.
    t.guide.open(7);
    expect(t.at()).toBe(`guide · grid 42 @${20 * 60 + 17}`);
  });

  it('asks the day in view for the rows in view and a page either side, at once', async () => {
    const t = setup();
    t.guide.open(42);
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
    top.guide.open(0);
    expect(top.engine.asked()).toEqual([`d0:${asked(0, 18)}`]);
    const end = setup();
    end.guide.open(999);
    expect(end.engine.asked()).toEqual([`d0:${asked(982, 1000)}`]);
    await flush();
    expect([top.list.loads, end.list.loads]).toEqual([[], []]);
  });

  it('asks both days when the view crosses midnight, one call each', async () => {
    // A view that ends at midnight asks one day.
    const ten = setup({ start: new Date(2026, 10, 5, 22, 10).getTime() });
    ten.guide.open(0);
    expect(ten.position().view + GUIDE.span).toBe(midnight(1));
    expect(ten.engine.asked()).toEqual([`d0:${asked(0, 18)}`]);
    const t = setup({ start: new Date(2026, 10, 5, 23, 40).getTime() });
    t.guide.open(0);
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
});

describe('moving in the guide', () => {
  it('asks nothing for moves inside what it read, and new rows only once the view rests', async () => {
    const t = setup();
    t.guide.open(42);
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
    t.guide.open(0);
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
    t.guide.open(0);
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
    t.guide.open(0);
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
    t.guide.open(0);
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
    t.guide.open(0);
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
    t.guide.open(95);
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
    two.guide.open(95);
    expect(late.loads).toEqual(range(100, 105));
  });

  it('reads the range’s last day', async () => {
    const t = setup({ tier: 'low' });
    t.guide.open(0);
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
    t.guide.open(0);
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
    t.guide.open(0);
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
  it('plays the channel on OK on the programme on air, and nothing on one to come or gone by', async () => {
    const t = setup();
    t.guide.open(2);
    await flush();
    await t.press('OK');
    expect(t.play).toHaveBeenCalledWith(2);
    await t.press('RIGHT', 'OK');
    expect(t.play).toHaveBeenCalledTimes(1);
    await t.press('LEFT', 'LEFT', 'OK');
    expect(t.at()).toMatch(/^guide · grid 2 @/);
    expect(t.position().time).toBeLessThan(NOW);
    expect(t.play).toHaveBeenCalledTimes(1);
    // A channel with no guide plays from the placeholder that holds now.
    const none = setup();
    none.guide.open(9);
    await flush();
    expect(none.guide.schedule(9)).toEqual({ start: [], end: [], title: [] });
    await none.press('OK');
    expect(none.play).toHaveBeenCalledWith(9);
    await none.press('RIGHT', 'OK');
    expect(none.play).toHaveBeenCalledTimes(1);
  });

  it('counts a programme on air from its first minute to the one before its end', async () => {
    const start = onAir(0, NOW) * 30;
    const t = setup({ start: start * MINUTE });
    t.guide.open(0);
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
    t.guide.open(5);
    await t.press('OK');
    expect(t.play).toHaveBeenCalledWith(5);
  });

  it('goes back to the list on the row it had focused, and forgets what it read', async () => {
    const t = setup();
    t.guide.open(42);
    await flush();
    await t.press('DOWN', 'DOWN', 'RIGHT', 'BACK');
    expect(t.at()).toBe('live · channels 0');
    expect(t.closed).toHaveBeenCalledWith(44);
    expect(t.guide.screen.value).toBeNull();
    expect(t.guide.schedule(44)).toBeNull();
    // The next open asks afresh, at now.
    t.guide.open(44);
    expect(t.guide.schedule(44)).toBeNull();
    expect(t.position().time).toBe(NOW);
    expect(t.engine.calls).toHaveLength(2);
  });

  it('drops the answers of a guide that closed, and asks nothing after', async () => {
    const t = setup();
    t.engine.hold = true;
    t.guide.open(0);
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
    t.guide.open(0);
    expect(t.guide.schedule(0)).toBeNull();
  });

  it('asks afresh when it opens again while the closed one’s asks are out, and their late answers free nothing', async () => {
    const t = setup();
    t.engine.hold = true;
    t.guide.open(0);
    await t.press('BACK');
    t.guide.open(0);
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
    t.guide.open(3);
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
    t.guide.open(42);
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
    t.guide.open(42);
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
    t.guide.open(42);
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
    t.guide.open(0);
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
    t.guide.open(95);
    const version = t.guide.version.value;
    t.guide.dispose();
    t.engine.answerAll();
    list.release();
    await flush();
    expect(t.guide.version.value).toBe(version);
    expect(t.engine.calls).toHaveLength(1);
    // A swap's new list that comes after it.
    const s = setup();
    s.guide.open(0);
    s.guide.listChanging();
    s.guide.dispose();
    await flush();
    expect(s.engine.calls).toHaveLength(1);
    // Closed, then disposed: no more opens.
    const c = setup();
    c.guide.open(0);
    await c.press('BACK');
    c.guide.dispose();
    c.guide.open(0);
    expect(c.guide.screen.value).toBeNull();
  });
});

describe('the rows’ days', () => {
  it('cover a whole day each, for the channel’s programmes that overlap it', async () => {
    const t = setup();
    t.guide.open(1);
    await flush();
    const row = t.guide.schedule(1)!;
    // Channel 1's 45-minute programmes over the day: the first starts before midnight or at it.
    expect(row.start[0]).toBeLessThanOrEqual(midnight(0));
    expect(row.end[row.end.length - 1]).toBeGreaterThanOrEqual(midnight(1));
    expect(row.start.length).toBe(Math.ceil(midnight(1) / 45) - Math.floor(midnight(0) / 45));
    expect(t.guide.schedule(9)).toEqual({ start: [], end: [], title: [] });
  });
});
