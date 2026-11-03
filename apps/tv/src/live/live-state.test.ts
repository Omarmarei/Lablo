import type { CatalogItem, ContentKey, ContentKind, EpgProgramme } from '@zoma/core';
import type { CategoryInfo, EpgNowNext, LoadedProfile, ShortEpgNowNext, SourceRecord } from '@zoma/data';
import type { Intent, RootBackPolicy } from '@zoma/platform-api';
import { LAYOUT, SCREEN, listHeight } from '@zoma/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusedChannel } from '../data/engine';
import type { LiveEngine, Timers } from './live-state';
import {
  CHANNELS_VISIBLE,
  CHUNK_CACHE,
  GUIDE_DELAY_MS,
  GUIDE_TTL_MS,
  LIVE,
  LIVE_BODY,
  RAIL_VISIBLE,
  createLive,
  railEntries,
} from './live-state';

const MINUTE = 60_000;
/** 2026-11-03 20:00:30 UTC: half a minute past a minute boundary. */
const T0 = Date.UTC(2026, 10, 3, 20, 0, 30);

function item(src: string, catIdx: number, n: number, chno: number | null = null): CatalogItem {
  return {
    key: `x:${src}:live:${catIdx}-${n}`,
    src,
    kind: 'live',
    name: `Channel ${src} ${catIdx}-${n}`,
    normName: '',
    group: '',
    url: `http://panel.test/live/u/p/${catIdx * 10_000 + n}.ts`,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

function info(catIdx: number, name: string, chunks: number[]): CategoryInfo {
  return { catIdx, name, count: chunks.reduce((a, b) => a + b, 0), chunks };
}

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', epgUrl: null, added: 1 };
const S2: SourceRecord = {
  id: 's2',
  type: 'xtream',
  name: 'Panel',
  account: { base: 'http://panel.test', username: 'u', password: 'p' },
  epgUrl: null,
  added: 2,
};

/** s1: News (3, numbered 7–9 by the provider), an empty group, Sports (1,200); s2: Kids (2). */
const CATEGORIES: Record<string, CategoryInfo[]> = {
  s1: [info(0, 'News', [3]), info(1, '', []), info(2, 'Sports', [500, 500, 200])],
  s2: [info(0, 'Kids', [2])],
};

function chunkItems(src: string, catIdx: number, chunk: number): CatalogItem[] {
  const cat = CATEGORIES[src]?.find((c) => c.catIdx === catIdx);
  const size = cat?.chunks[chunk] ?? 0;
  const out: CatalogItem[] = [];
  for (let slot = 0; slot < size; slot += 1) {
    const n = chunk * 500 + slot;
    out.push(item(src, catIdx, n, src === 's1' && catIdx === 0 ? 7 + n : null));
  }
  return out;
}

const programme = (title: string, start: number, end: number): EpgProgramme => ({
  start,
  end,
  title,
  sub: '',
  desc: '',
  category: '',
  episode: '',
  flags: 0,
});

interface Held<T> {
  readonly arg: unknown;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** A data engine that answers at once, or holds the answers of the kinds in `hold`. */
class FakeEngine implements LiveEngine {
  profileDoc: LoadedProfile | null = { doc: { v: 2, sources: [S1, S2] }, newer: false, migratedFrom: null };
  failProfile = false;
  hold = new Set<'profile' | 'chunk' | 'nowNext' | 'focus'>();
  readonly held: Record<string, Held<unknown>[]> = { profile: [], chunk: [], nowNext: [], focus: [] };
  readonly chunkCalls: string[] = [];
  readonly nowNextCalls: ContentKey[][] = [];
  readonly focusCalls: (FocusedChannel | null)[] = [];
  activity = 0;
  failChunks = false;
  /** The answer a focused channel gets (default: no guide, no panel). */
  focusAnswer: (channel: FocusedChannel) => ShortEpgNowNext = (channel) => ({
    key: channel.key,
    epgSrc: null,
    channel: null,
    method: null,
    now: null,
    next: null,
    from: 'none',
    cached: false,
  });

  private answer<T>(kind: 'profile' | 'chunk' | 'nowNext' | 'focus', arg: unknown, value: () => T): Promise<T> {
    if (!this.hold.has(kind)) {
      try {
        return Promise.resolve(value());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise<T>((resolve, reject) => {
      this.held[kind]!.push({ arg, resolve: resolve as (v: unknown) => void, reject });
    });
  }

  profile(): Promise<LoadedProfile | null> {
    return this.answer('profile', null, () => {
      if (this.failProfile) throw new Error('no IndexedDB');
      return this.profileDoc;
    });
  }

  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]> {
    expect(kind).toBe('live');
    return Promise.resolve(CATEGORIES[src] ?? []);
  }

  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]> {
    expect(kind).toBe('live');
    this.chunkCalls.push(`${src}|${catIdx}|${chunk}`);
    return this.answer('chunk', `${src}|${catIdx}|${chunk}`, () => {
      if (this.failChunks) throw new Error('read failed');
      return chunkItems(src, catIdx, chunk);
    });
  }

  nowNext(keys: ContentKey[], at?: number): Promise<EpgNowNext[]> {
    this.nowNextCalls.push(keys.slice());
    return this.answer('nowNext', keys, () =>
      keys.map((key, i) => {
        const minute = Math.floor((at ?? 0) / MINUTE);
        const guided = i % 2 === 0;
        return {
          key,
          epgSrc: guided ? 'g1' : null,
          channel: guided ? key : null,
          method: guided ? 'id' : null,
          now: guided ? programme(`Now on ${key}`, minute - 10, minute + 5) : null,
          next: guided ? programme(`Next on ${key}`, minute + 5, minute + 65) : null,
        } as EpgNowNext;
      }),
    );
  }

  focusChannel(channel: FocusedChannel | null): Promise<ShortEpgNowNext | null> {
    this.focusCalls.push(channel);
    // The real engine settles the focus before with null.
    for (const waiting of this.held.focus!.splice(0)) waiting.resolve(null);
    if (channel === null) return Promise.resolve(null);
    return this.answer('focus', channel, () => this.focusAnswer(channel));
  }

  noteActivity(): void {
    this.activity += 1;
  }
}

/** Timers run by hand, with a clock that `advance` moves; each fires `late` ms after its time. */
function manualTimers(start: number, late = 0) {
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
        now = Math.min(end, next.at + late);
        next.run();
      }
      now = end;
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

async function setup(options: { rootBack?: RootBackPolicy; engine?: FakeEngine; settle?: boolean } = {}) {
  const engine = options.engine ?? new FakeEngine();
  const clock = manualTimers(T0);
  const exitApp = vi.fn();
  const live = createLive({
    platform: { rootBackPolicy: () => options.rootBack ?? 'exit-dialog', exitApp },
    engine,
    now: clock.now,
    timers: clock.timers,
  });
  if (options.settle !== false) await flush();
  const at = (): string => {
    const f = live.nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) live.nav.handle(key);
    await flush();
  };
  /** The window's rows as `number name`, `…` while loading. */
  const rows = (): string[] => {
    const top = live.home.position('channels').top;
    const out: string[] = [];
    for (let i = top; i < top + CHANNELS_VISIBLE; i += 1) {
      const row = live.row(i);
      if (live.row(i) === null && i >= (live.home.zone('channels') as { count: number }).count) break;
      out.push(row === null ? '…' : `${row.number} ${row.item.name}`);
    }
    return out;
  };
  return { live, engine, clock, exitApp, at, press, rows };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the live screen’s layout numbers', () => {
  it('fits 12 categories and 9 channel rows under the header in the 1920x1080 safe area', () => {
    expect(LIVE.width).toBe(1728);
    expect(LIVE_BODY).toBe(SCREEN.height - 2 * SCREEN.safeY - 80);
    expect(RAIL_VISIBLE).toBe(12);
    expect(CHANNELS_VISIBLE).toBe(9);
    expect(listHeight(RAIL_VISIBLE, LAYOUT.railHeight, LIVE.railGap)).toBeLessThanOrEqual(LIVE_BODY);
    expect(listHeight(RAIL_VISIBLE + 1, LAYOUT.railHeight, LIVE.railGap)).toBeGreaterThan(LIVE_BODY);
    expect(listHeight(CHANNELS_VISIBLE, LAYOUT.rowHeight, LIVE.rowGap)).toBeLessThanOrEqual(LIVE_BODY);
    expect(listHeight(CHANNELS_VISIBLE + 1, LAYOUT.rowHeight, LIVE.rowGap)).toBeGreaterThan(LIVE_BODY);
    expect(LIVE.railWidth + LIVE.columnGap).toBeLessThan(LIVE.width / 2);
  });
});

describe('railEntries', () => {
  it('starts with every channel, then lists each category with channels, source by source', () => {
    const entries = railEntries([
      { src: 's1', categories: CATEGORIES.s1! },
      { src: 's2', categories: CATEGORIES.s2! },
    ]);
    expect(entries.map((e) => [e.kind, e.name, e.count, e.allStart])).toEqual([
      ['all', '', 1205, 0],
      ['category', 'News', 3, 0],
      ['category', 'Sports', 1200, 3],
      ['category', 'Kids', 2, 1203],
    ]);
    expect(entries[0]!.parts.map((p) => `${p.src}|${p.catIdx}`)).toEqual(['s1|0', 's1|2', 's2|0']);
    expect(entries[2]!.parts).toEqual([{ src: 's1', catIdx: 2, chunks: [500, 500, 200] }]);
  });

  it('is empty when no source has a live channel', () => {
    expect(railEntries([])).toEqual([]);
    expect(railEntries([{ src: 's1', categories: [info(0, 'Empty', [])] }])).toEqual([]);
  });
});

describe('the live screen', () => {
  it('starts on the first channel of every channel, reading only the chunks around the window', async () => {
    const t = await setup({ settle: false });
    expect(t.live.status.value).toBe('loading');
    expect(t.at()).toBe('live · channels -1');
    await flush();
    expect(t.live.status.value).toBe('ready');
    expect(t.live.rail.value.map((e) => e.name)).toEqual(['', 'News', 'Sports', 'Kids']);
    expect(t.live.category.value).toBe(0);
    expect(t.at()).toBe('live · channels 0');
    // Rows -9 to 18: News's chunk and Sports's first.
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|2|0']);
    expect(t.rows()).toEqual([
      '7 Channel s1 0-0',
      '8 Channel s1 0-1',
      '9 Channel s1 0-2',
      '4 Channel s1 2-0',
      '5 Channel s1 2-1',
      '6 Channel s1 2-2',
      '7 Channel s1 2-3',
      '8 Channel s1 2-4',
      '9 Channel s1 2-5',
    ]);
    // The fake engine answers the focus at once (the real one waits 600 ms: see the pending test).
    expect(t.live.pending.value).toBe(0);
  });

  it('reads the next chunks as the list pages down, and keeps at most CHUNK_CACHE of them', async () => {
    const t = await setup();
    for (let i = 0; i < 60; i += 1) await t.press('CH_DOWN');
    expect(t.live.home.position('channels').index).toBe(540);
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|2|0', 's1|2|1']);
    expect(t.rows()[0]).toBe('541 Channel s1 2-537');
    await t.press('CH_DOWN', 'CH_DOWN', 'CH_DOWN', 'CH_DOWN', 'CH_DOWN', 'CH_DOWN', 'CH_DOWN');
    for (let i = 0; i < 80; i += 1) await t.press('CH_DOWN');
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|2|0', 's1|2|1', 's1|2|2', 's2|0|0']);
    expect(t.rows()).toEqual(['1197 Channel s1 2-1193'].concat(t.rows().slice(1)));
    expect(t.rows()[t.rows().length - 1]).toBe('1205 Channel s2 0-1');
    // Back to the top: the first chunks are still kept (5 of at most 8).
    for (let i = 0; i < 140; i += 1) await t.press('CH_UP');
    expect(t.at()).toBe('live · channels 0');
    expect(t.engine.chunkCalls).toHaveLength(5);
    expect(CHUNK_CACHE).toBe(8);
  });

  it('drops the least recently used chunks beyond CHUNK_CACHE', async () => {
    const engine = new FakeEngine();
    // Twelve categories of one chunk each, 20 channels apart from each other.
    CATEGORIES.s3 = Array.from({ length: 12 }, (_v, i) => info(i, `C${i}`, [20]));
    engine.profileDoc = { doc: { v: 2, sources: [{ ...S1, id: 's3' }] }, newer: false, migratedFrom: null };
    try {
      const t = await setup({ engine });
      for (let i = 0; i < 230; i += 1) await t.press('DOWN');
      expect(t.engine.chunkCalls.length).toBe(12);
      // Going back to the top reads the first chunks again: they were dropped on the way down.
      for (let i = 0; i < 230; i += 1) await t.press('UP');
      expect(t.engine.chunkCalls.length).toBeGreaterThan(12);
      expect(t.engine.chunkCalls.slice(12)).toContain('s3|0|0');
      expect(t.rows()[0]).toBe('1 Channel s3 0-0');
    } finally {
      delete CATEGORIES.s3;
    }
  });

  it('reads one window ahead either way, across category boundaries', async () => {
    const engine = new FakeEngine();
    // Three categories of 10: rows 0-9, 10-19, 20-29.
    CATEGORIES.s3 = [info(0, 'A', [10]), info(1, 'B', [10]), info(2, 'C', [10])];
    engine.profileDoc = { doc: { v: 2, sources: [{ ...S1, id: 's3' }] }, newer: false, migratedFrom: null };
    try {
      const t = await setup({ engine });
      // Rows 0-8 on show, 9-17 read ahead: A and B, not C.
      expect(engine.chunkCalls).toEqual(['s3|0|0', 's3|1|0']);
      // At the bottom (rows 21-29 on show), rows 12-20 above are read too: B is still kept, C is read.
      await t.press('CH_DOWN', 'CH_DOWN', 'CH_DOWN', 'CH_DOWN');
      expect(t.live.home.position('channels').top).toBe(21);
      expect(engine.chunkCalls).toEqual(['s3|0|0', 's3|1|0', 's3|2|0']);
      expect(t.rows()[0]).toBe('22 Channel s3 2-1');
    } finally {
      delete CATEGORIES.s3;
    }
  });

  it('reads the window above too after a jump (the focus set from code)', async () => {
    const engine = new FakeEngine();
    // Five categories of 10: rows 0-49.
    CATEGORIES.s3 = Array.from({ length: 5 }, (_v, i) => info(i, `C${i}`, [10]));
    engine.profileDoc = { doc: { v: 2, sources: [{ ...S1, id: 's3' }] }, newer: false, migratedFrom: null };
    try {
      const t = await setup({ engine });
      t.live.home.focus('channels', 45);
      await flush();
      // Rows 37-45 on show: 28-36 above (C and D) and 46-49 below (E).
      expect(t.live.home.position('channels').top).toBe(37);
      expect(engine.chunkCalls.slice(2).sort()).toEqual(['s3|2|0', 's3|3|0', 's3|4|0']);
    } finally {
      delete CATEGORIES.s3;
    }
  });

  it('keeps every chunk the window needs, even more than CHUNK_CACHE, and reads each once', async () => {
    const engine = new FakeEngine();
    // Thirty categories of one channel: the window and its read-ahead need 18 chunks.
    CATEGORIES.s3 = Array.from({ length: 30 }, (_v, i) => info(i, `C${i}`, [1]));
    engine.profileDoc = { doc: { v: 2, sources: [{ ...S1, id: 's3' }] }, newer: false, migratedFrom: null };
    try {
      const t = await setup({ engine });
      await flush();
      expect(engine.chunkCalls).toHaveLength(18);
      expect(new Set(engine.chunkCalls).size).toBe(18);
      expect(t.rows()).toHaveLength(CHANNELS_VISIBLE);
      expect(t.rows().every((r) => r !== '…')).toBe(true);
    } finally {
      delete CATEGORIES.s3;
    }
  });

  it('keeps the clock on the minute although timers fire late', async () => {
    const engine = new FakeEngine();
    const clock = manualTimers(T0, 7);
    const live = createLive({ platform: { rootBackPolicy: () => 'exit-dialog', exitApp: () => undefined }, engine, now: clock.now, timers: clock.timers });
    await flush();
    clock.advance(60 * MINUTE);
    // Each tick is 7 ms late, and the next one is aimed at the next minute again.
    expect(live.clock.value % MINUTE).toBe(7);
    expect(live.clock.value - (live.clock.value % MINUTE)).toBe(Date.UTC(2026, 10, 3, 21, 0, 0));
  });

  it('drops a chunk that arrives for the load before a reload, while the reload still reads the profile', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['chunk']);
    const t = await setup({ engine });
    const old = engine.held.chunk!.splice(0);
    expect(old).toHaveLength(2);
    engine.hold = new Set(['profile']);
    t.live.reload();
    for (const held of old) held.resolve([item('s9', 0, 0)]);
    await flush();
    engine.hold = new Set();
    engine.held.profile![0]!.resolve(engine.profileDoc);
    await flush();
    // The reload read the chunks again: the old answer was not kept.
    expect(t.rows()[0]).toBe('7 Channel s1 0-0');
  });

  it('does not ask again for rows whose now/next is still on its way', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['nowNext']);
    const t = await setup({ engine });
    t.clock.advance(GUIDE_DELAY_MS);
    expect(engine.nowNextCalls).toHaveLength(1);
    // The minute ticks while the answer is still out: nothing new to ask.
    t.clock.advance(MINUTE);
    expect(engine.nowNextCalls).toHaveLength(1);
    expect(t.live.pending.value).toBe(1);
    engine.held.nowNext![0]!.resolve([]);
    await flush();
    expect(t.live.pending.value).toBe(0);
  });

  it('asks now/next for the rows on show once the window rests, and shows the answers', async () => {
    const t = await setup();
    expect(t.engine.nowNextCalls).toEqual([]);
    t.clock.advance(GUIDE_DELAY_MS - 1);
    expect(t.engine.nowNextCalls).toEqual([]);
    t.clock.advance(1);
    await flush();
    expect(t.engine.nowNextCalls).toHaveLength(1);
    expect(t.engine.nowNextCalls[0]).toHaveLength(CHANNELS_VISIBLE);
    expect(t.engine.nowNextCalls[0]![0]).toBe('x:s1:live:0-0');
    const first = t.live.row(0)!.item.key;
    expect(t.live.guide(first)?.now?.title).toBe(`Now on ${first}`);
    expect(t.live.guide(t.live.row(1)!.item.key)?.now).toBeNull();
    const before = t.live.version.value;

    // Scrolling: one request, for where the window stops.
    await t.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    t.clock.advance(GUIDE_DELAY_MS / 2);
    await t.press('DOWN', 'DOWN');
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.engine.nowNextCalls).toHaveLength(2);
    // The window moved 4 rows: only the 4 new rows are asked.
    expect(t.engine.nowNextCalls[1]).toEqual(['x:s1:live:2-6', 'x:s1:live:2-7', 'x:s1:live:2-8', 'x:s1:live:2-9']);
    expect(t.live.version.value).toBeGreaterThan(before);
  });

  it('asks again when a programme has ended (on the minute tick) or the answer is old', async () => {
    const t = await setup();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.engine.nowNextCalls).toHaveLength(1);
    // The minute ticks 30 s in: nothing has ended yet.
    t.clock.advance(MINUTE / 2);
    await flush();
    expect(t.live.clock.value).toBe(Date.UTC(2026, 10, 3, 20, 1, 0));
    expect(t.engine.nowNextCalls).toHaveLength(1);
    // The guided programmes end at 20:05: those 5 rows are asked again then.
    t.clock.advance(4 * MINUTE);
    await flush();
    expect(t.engine.nowNextCalls).toHaveLength(2);
    expect(t.engine.nowNextCalls[1]).toEqual(['x:s1:live:0-0', 'x:s1:live:0-2', 'x:s1:live:2-1', 'x:s1:live:2-3', 'x:s1:live:2-5']);
    // Rows without a guide are asked again once GUIDE_TTL_MS has passed, at the next tick (20:06).
    expect(GUIDE_TTL_MS).toBe(5 * MINUTE);
    t.clock.advance(MINUTE);
    await flush();
    expect(t.engine.nowNextCalls[2]).toEqual(['x:s1:live:0-1', 'x:s1:live:2-0', 'x:s1:live:2-2', 'x:s1:live:2-4']);
  });

  it('shows a category on OK, numbered by its place in every channel, and goes back to the rail', async () => {
    const t = await setup();
    await t.press('LEFT');
    expect(t.at()).toBe('live · rail 0');
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.live.category.value).toBe(2);
    expect(t.at()).toBe('live · channels 0');
    expect(t.rows()[0]).toBe('4 Channel s1 2-0');
    expect((t.live.home.zone('channels') as { count: number }).count).toBe(1200);
    await t.press('DOWN', 'DOWN');
    // Back from the list: the rail, on the category on show.
    await t.press('UP', 'BACK');
    expect(t.at()).toBe('live · rail 2');
    await t.press('DOWN', 'OK');
    expect(t.live.category.value).toBe(3);
    expect(t.rows()).toEqual(['1204 Channel s2 0-0', '1205 Channel s2 0-1']);
    // The list starts at its top again.
    expect(t.live.home.position('channels').top).toBe(0);
    await t.press('LEFT', 'UP', 'UP', 'UP', 'OK');
    expect(t.live.category.value).toBe(0);
    expect(t.rows()[0]).toBe('7 Channel s1 0-0');
  });

  it('mirrors LEFT and RIGHT in Arabic: the rail is at the inline start', async () => {
    const t = await setup();
    t.live.nav.setDir('rtl');
    await t.press('LEFT');
    expect(t.at()).toBe('live · channels 0');
    await t.press('RIGHT');
    expect(t.at()).toBe('live · rail 0');
    await t.press('LEFT');
    expect(t.at()).toBe('live · channels 0');
  });

  it('follows the platform from the rail: an exit dialog, or the launcher', async () => {
    const t = await setup();
    await t.press('BACK');
    expect(t.at()).toBe('live · rail 0');
    await t.press('BACK');
    expect(t.at()).toBe('exit · buttons 0');
    await t.press('OK');
    expect(t.at()).toBe('live · rail 0');
    expect(t.exitApp).not.toHaveBeenCalled();
    await t.press('BACK', 'RIGHT', 'OK');
    expect(t.exitApp).toHaveBeenCalledTimes(1);
    expect(t.live.exitRequested.value).toBe(true);

    const webos = await setup({ rootBack: 'platform-back' });
    await webos.press('BACK', 'BACK');
    expect(webos.exitApp).toHaveBeenCalledTimes(1);
    expect(webos.at()).toBe('live · rail 0');
  });

  it('marks the channel OK picks (the player plugs in here)', async () => {
    const t = await setup();
    await t.press('DOWN', 'OK');
    expect(t.live.selected.value).toBe('x:s1:live:0-1');
    expect(t.at()).toBe('live · channels 1');
  });

  it("asks the focused channel's short EPG through its source, and shows a panel's answer", async () => {
    const engine = new FakeEngine();
    engine.focusAnswer = (channel) => ({
      key: channel.key,
      epgSrc: null,
      channel: null,
      method: null,
      now: programme('From the panel', 0, 1),
      next: null,
      from: channel.key.indexOf('s2') !== -1 ? 'panel' : 'guide',
      cached: false,
    });
    const t = await setup({ engine });
    expect(engine.focusCalls).toEqual([{ key: 'x:s1:live:0-0', url: 'http://panel.test/live/u/p/0.ts', source: { type: 'm3u', url: S1.url } }]);
    // A guide's answer is the same as now/next's: not taken from here.
    expect(t.live.guide('x:s1:live:0-0')).toBeUndefined();
    await t.press('DOWN');
    expect(engine.focusCalls.map((c) => c?.key)).toEqual(['x:s1:live:0-0', 'x:s1:live:0-1']);
    await t.press('LEFT');
    expect(engine.focusCalls[2]).toBeNull();
    // A pointer-free OK on Kids: the panel's channel.
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    const kid = engine.focusCalls[3]!;
    expect(kid.key).toBe('x:s2:live:0-0');
    expect(kid.source).toEqual({ type: 'xtream', account: { base: 'http://panel.test', username: 'u', password: 'p' } });
    expect(t.live.guide(kid.key)?.now?.title).toBe('From the panel');
    // The same channel again (a re-render, a click on it): not asked twice.
    t.live.home.focus('channels', 0);
    await flush();
    expect(engine.focusCalls).toHaveLength(4);
  });

  it('counts every request in flight, the focus wait included, back to 0', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['focus']);
    const t = await setup({ engine });
    expect(t.live.pending.value).toBe(1);
    t.clock.advance(GUIDE_DELAY_MS);
    expect(t.live.pending.value).toBe(2);
    await flush();
    expect(t.live.pending.value).toBe(1);
    engine.held.focus![0]!.resolve(null);
    await flush();
    expect(t.live.pending.value).toBe(0);
    // Moving settles the old focus (the engine answers it with null) and starts a new wait.
    await t.press('DOWN');
    expect(t.live.pending.value).toBe(1);
    await t.press('LEFT');
    expect(t.live.pending.value).toBe(0);
  });

  it('drops answers that arrive after a reload or after it is disposed', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['profile']);
    const t = await setup({ engine });
    t.live.reload();
    expect(engine.held.profile).toHaveLength(2);
    // The second load answers first; the first one's late answer changes nothing.
    engine.held.profile![1]!.resolve(engine.profileDoc);
    await flush();
    expect(t.live.status.value).toBe('ready');
    const version = t.live.version.value;
    engine.held.profile![0]!.resolve({ doc: { v: 2, sources: [] }, newer: false, migratedFrom: null });
    await flush();
    expect(t.live.status.value).toBe('ready');
    expect(t.live.rail.value).toHaveLength(4);

    engine.hold = new Set(['nowNext', 'chunk']);
    await t.press('CH_DOWN', 'CH_DOWN', 'CH_DOWN');
    t.clock.advance(GUIDE_DELAY_MS);
    expect(engine.held.nowNext).toHaveLength(1);
    t.live.dispose();
    expect(t.clock.pending()).toBe(0);
    expect(engine.focusCalls[engine.focusCalls.length - 1]).toBeNull();
    for (const held of engine.held.nowNext!) held.resolve([]);
    for (const held of engine.held.chunk!) held.resolve([]);
    await flush();
    expect(t.live.version.value).toBe(version);
  });

  it('drops a chunk answer for a load that was replaced', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['chunk']);
    const t = await setup({ engine });
    expect(engine.held.chunk).toHaveLength(2);
    engine.hold = new Set();
    t.live.reload();
    await flush();
    // The reload read both chunks again, and they arrived.
    expect(t.rows()[0]).toBe('7 Channel s1 0-0');
    const version = t.live.version.value;
    for (const held of engine.held.chunk!) held.resolve([item('s9', 0, 0)]);
    await flush();
    expect(t.live.version.value).toBe(version);
    expect(t.rows()[0]).toBe('7 Channel s1 0-0');
  });

  it('shows "Try again" when the categories cannot be read, and loads on OK', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.failProfile = true;
    const t = await setup({ engine });
    expect(t.live.status.value).toBe('failed');
    expect(t.at()).toBe('live · retry 0');
    expect(warn).toHaveBeenCalled();
    // A failed request counts as answered too.
    expect(t.live.pending.value).toBe(0);
    engine.failProfile = false;
    await t.press('OK');
    expect(t.live.status.value).toBe('ready');
    expect((t.live.home.zone('retry') as { count: number }).count).toBe(0);
    expect(t.at()).toBe('live · channels 0');
  });

  it('keeps a row empty when its chunk cannot be read, and asks again when the window moves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.failChunks = true;
    const t = await setup({ engine });
    expect(t.live.row(0)).toBeNull();
    expect(warn).toHaveBeenCalled();
    engine.failChunks = false;
    await t.press('DOWN');
    expect(t.rows()[0]).toBe('7 Channel s1 0-0');
  });

  it('is empty, with Back still leaving, when no source has a live channel', async () => {
    const engine = new FakeEngine();
    engine.profileDoc = { doc: { v: 2, sources: [] }, newer: false, migratedFrom: null };
    const t = await setup({ engine });
    expect(t.live.status.value).toBe('empty');
    expect(t.at()).toBe('live · channels -1');
    await t.press('OK', 'BACK');
    expect(t.at()).toBe('exit · buttons 0');
  });

  it('passes remote activity to the engine (a running refresh pauses)', async () => {
    const t = await setup();
    t.live.activity();
    t.live.activity();
    expect(t.engine.activity).toBe(2);
  });
});
