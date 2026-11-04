import type { CatalogItem, ContentKey, ContentKind, EpgProgramme } from '@zoma/core';
import type { CategoryInfo, EpgNowNext, LoadedProfile, ShortEpgNowNext, SourceRecord } from '@zoma/data';
import type { Intent, RootBackPolicy } from '@zoma/platform-api';
import { LAYOUT, SCREEN, listHeight } from '@zoma/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusedChannel } from '../data/engine';
import type { LiveEngine, RailRef, Timers } from './live-state';
import {
  CHANNELS_VISIBLE,
  CHUNK_CACHE,
  GUIDE_DELAY_MS,
  GUIDE_TTL_MS,
  LIVE,
  LIVE_BODY,
  RAIL_VISIBLE,
  createLive,
  findEntry,
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

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
const S2: SourceRecord = {
  id: 's2',
  type: 'xtream',
  name: 'Panel',
  account: { base: 'http://panel.test', username: 'u', password: 'p' },
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
  /** The stored categories and their chunks (a test swaps in a refreshed catalog, step 22a). */
  catalog: Record<string, CategoryInfo[]> = CATEGORIES;
  items: (src: string, catIdx: number, chunk: number) => CatalogItem[] = chunkItems;
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
    return Promise.resolve(this.catalog[src] ?? []);
  }

  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]> {
    expect(kind).toBe('live');
    this.chunkCalls.push(`${src}|${catIdx}|${chunk}`);
    return this.answer('chunk', `${src}|${catIdx}|${chunk}`, () => {
      if (this.failChunks) throw new Error('read failed');
      return this.items(src, catIdx, chunk);
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

async function setup(
  options: { rootBack?: RootBackPolicy; engine?: FakeEngine; settle?: boolean; play?: (index: number) => void; startCategory?: RailRef; listChanging?: () => void } = {},
) {
  const engine = options.engine ?? new FakeEngine();
  const clock = manualTimers(T0);
  const exitApp = vi.fn();
  const live = createLive({
    platform: { rootBackPolicy: () => options.rootBack ?? 'exit-dialog', exitApp },
    engine,
    now: clock.now,
    timers: clock.timers,
    ...(options.play === undefined ? {} : { play: options.play }),
    ...(options.startCategory === undefined ? {} : { startCategory: options.startCategory }),
    ...(options.listChanging === undefined ? {} : { listChanging: options.listChanging }),
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

  it('marks the channel OK picks', async () => {
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

/** Answers every chunk read the engine holds. */
function answerChunks(engine: FakeEngine): void {
  for (const held of engine.held.chunk!.splice(0)) {
    const [src, catIdx, chunk] = String(held.arg).split('|');
    held.resolve(chunkItems(src!, Number(catIdx), Number(chunk)));
  }
}

describe("the player's list (RELAY step 20a)", () => {
  it('opens the player on the row OK picks, loaded or not', async () => {
    const opened: number[] = [];
    const t = await setup({ play: (index) => opened.push(index) });
    await t.press('DOWN', 'OK');
    expect(opened).toEqual([1]);
    expect(t.live.selected.value).toBe('x:s1:live:0-1');
    t.engine.hold.add('chunk');
    t.live.focusRow(1100);
    await t.press('OK');
    // Its chunk is still on its way: the player reads the row itself.
    expect(t.live.row(1100)).toBeNull();
    expect(opened).toEqual([1, 1100]);
    expect(t.at()).toBe('live · channels 1100');
  });

  it("reads a row the window never showed, sharing a read that's on its way", async () => {
    const t = await setup();
    expect(t.live.list.count()).toBe(1205);
    t.engine.hold.add('chunk');
    const first = t.live.list.load(1100);
    const second = t.live.list.load(1100);
    await flush();
    expect(t.engine.chunkCalls.filter((c) => c === 's1|2|2')).toEqual(['s1|2|2']);
    answerChunks(t.engine);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ item: expect.objectContaining({ name: 'Channel s1 2-1097' }), number: 1101 });
    expect(b).toEqual(a);
    expect(t.live.list.row(1100)).toEqual(a);
    expect(await t.live.list.load(1100)).toEqual(a);
    expect(await t.live.list.load(-1)).toBeNull();
    expect(await t.live.list.load(1205)).toBeNull();
  });

  it("finds a channel by its number: the provider's, else its place, from the guessed chunk outwards", async () => {
    const t = await setup();
    // News is numbered 7–9 by the provider, every other row by its place in "All channels": rows
    // 1 and 7 both say 8, and the guessed row's chunk is read first.
    expect(await t.live.list.find(8)).toBe(7);
    expect(await t.live.list.find(4)).toBe(3);
    const before = t.engine.chunkCalls.length;
    expect(await t.live.list.find(1101)).toBe(1100);
    expect(t.engine.chunkCalls.slice(before)).toEqual(['s1|2|2']);
    // No row is numbered 1: every chunk is read, the guessed one first, then outwards.
    const from = t.engine.chunkCalls.length;
    expect(await t.live.list.find(1)).toBe(-1);
    expect(t.engine.chunkCalls.slice(from)).toEqual(['s1|2|1', 's1|2|2', 's2|0|0']);
    expect(await t.live.list.find(0)).toBe(-1);
    expect(await t.live.list.find(9999)).toBe(-1);
    expect(await t.live.list.find(1205)).toBe(1204);
    // In News, the provider's numbers.
    await t.press('LEFT', 'DOWN', 'OK');
    expect(t.live.category.value).toBe(1);
    expect(await t.live.list.find(8)).toBe(1);
    expect(await t.live.list.find(1)).toBe(-1);
    // In a category, a row without a provider number keeps its place in "All channels".
    await t.press('LEFT', 'DOWN', 'OK');
    expect(t.live.category.value).toBe(2);
    expect(await t.live.list.find(4)).toBe(0);
    expect(await t.live.list.find(1203)).toBe(1199);
    expect(await t.live.list.find(1204)).toBe(-1);
  });

  it('drops a search when the list reloads under it', async () => {
    const t = await setup();
    t.engine.hold.add('chunk');
    const found = t.live.list.find(1);
    await flush();
    t.live.reload();
    for (const held of t.engine.held.chunk!.splice(0)) held.resolve([]);
    expect(await found).toBe(-1);
  });

  it('asks now/next for one channel, once while it is on its way, and again when it is old', async () => {
    const t = await setup();
    const key = 'x:s1:live:2-1097';
    t.engine.hold.add('nowNext');
    t.live.list.askGuide(key);
    t.live.list.askGuide(key);
    expect(t.engine.nowNextCalls.filter((keys) => keys.indexOf(key) !== -1)).toEqual([[key]]);
    t.engine.held.nowNext!.splice(0).forEach((held) => held.resolve([{ key, epgSrc: 'g1', channel: key, method: 'id', now: null, next: null }]));
    await flush();
    expect(t.live.list.guide(key)).toMatchObject({ key, epgSrc: 'g1' });
    t.live.list.askGuide(key);
    expect(t.engine.nowNextCalls.filter((keys) => keys.indexOf(key) !== -1)).toHaveLength(1);
    t.clock.advance(GUIDE_TTL_MS);
    t.live.list.askGuide(key);
    expect(t.engine.nowNextCalls.filter((keys) => keys.indexOf(key) !== -1)).toHaveLength(2);
  });

  it('has no rows to zap through until the list is ready', async () => {
    const engine = new FakeEngine();
    engine.hold.add('profile');
    const t = await setup({ engine });
    expect(t.live.list.count()).toBe(0);
    expect(await t.live.list.load(0)).toBeNull();
    expect(await t.live.list.find(1)).toBe(-1);
  });
});

describe('the start on the last channel (RELAY step 20c1)', () => {
  const SPORTS_KEY = 'x:s1:live:2-1097';

  it('shows the category the last channel played from, by its source and name, and names the one on show', async () => {
    const sports = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    expect(sports.live.category.value).toBe(2);
    expect(sports.live.shownCategory()).toEqual({ src: 's1', name: 'Sports' });
    expect(sports.at()).toBe('live · channels 0');
    expect(sports.rows()[0]).toBe('4 Channel s1 2-0');
    expect((await setup({ startCategory: { src: 's2', name: 'Kids' } })).live.shownCategory()).toEqual({ src: 's2', name: 'Kids' });
    // Gone, another source's, or none: "All channels".
    for (const ref of [{ src: 's1', name: 'Movies' }, { src: 's2', name: 'News' }, null]) {
      const t = await setup({ startCategory: ref });
      expect(t.live.category.value).toBe(0);
      expect(t.live.shownCategory()).toBeNull();
    }
    // Only the first load: a reload keeps the category picked since.
    sports.live.home.focus('rail', 1);
    await sports.press('OK');
    expect(sports.live.shownCategory()).toEqual({ src: 's1', name: 'News' });
    sports.live.reload();
    await flush();
    expect(sports.live.shownCategory()).toEqual({ src: 's1', name: 'News' });
  });

  it('keeps the wish for the load that succeeds, after one that failed', async () => {
    const engine = new FakeEngine();
    engine.failProfile = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await setup({ engine, startCategory: { src: 's1', name: 'Sports' } });
    expect(t.live.status.value).toBe('failed');
    expect(t.live.shownCategory()).toBeNull();
    engine.failProfile = false;
    t.live.reload();
    await flush();
    expect(t.live.shownCategory()).toEqual({ src: 's1', name: 'Sports' });
  });

  it('names the categories by source and name', () => {
    const entries = railEntries([
      { src: 's1', categories: CATEGORIES['s1']! },
      { src: 's2', categories: [info(0, 'News', [1]), info(1, '', [1])] },
    ]);
    expect(findEntry(entries, { src: 's2', name: 'News' })).toBe(3);
    expect(findEntry(entries, { src: 's1', name: 'News' })).toBe(1);
    expect(findEntry(entries, { src: 's2', name: '' })).toBe(4);
    expect(findEntry(entries, { src: 's1', name: '' })).toBe(-1);
    expect(findEntry(entries, { src: 's3', name: 'News' })).toBe(-1);
  });

  it("finds the channel's row once the list is in, from its last row outwards", async () => {
    const engine = new FakeEngine();
    engine.hold.add('profile');
    const t = await setup({ engine });
    // Asked before the list is in: it waits for it.
    const early = t.live.list.locate(SPORTS_KEY, 1100);
    await flush();
    engine.held.profile!.splice(0).forEach((held) => held.resolve(engine.profileDoc));
    await flush();
    expect(await early).toBe(1100);
    // The guess's chunk is read first: the chunk between it and the window's never is.
    expect(engine.chunkCalls).toContain('s1|2|2');
    expect(engine.chunkCalls).not.toContain('s1|2|1');
    // It moved: found from the guess outwards (the guess's chunk is the window's, already read).
    const from = engine.chunkCalls.length;
    expect(await t.live.list.locate(SPORTS_KEY, 5)).toBe(1100);
    expect(engine.chunkCalls.slice(from)).toEqual(['s1|2|1', 's1|2|2']);
    // A row past the end: from the last chunk inwards (the window's two chunks are the screen's own).
    const past = engine.chunkCalls.length;
    expect(await t.live.list.locate('x:s1:live:0-2', 9999)).toBe(2);
    expect(engine.chunkCalls.slice(past)).toEqual(['s2|0|0', 's1|2|2', 's1|2|1']);
    expect(await t.live.list.locate('x:s1:live:9-9', 0)).toBe(-1);
    expect(await t.live.list.locate('x:s2:live:0-1', -5)).toBe(1204);
  });

  it('finds it in the category on show', async () => {
    const t = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    expect(await t.live.list.locate(SPORTS_KEY, 0)).toBe(1097);
    expect(await t.live.list.locate('x:s2:live:0-1', 0)).toBe(-1);
  });

  it("gives -1 for a list that couldn't load, reloaded under it, or was disposed", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = new FakeEngine();
    failing.failProfile = true;
    const failed = await setup({ engine: failing });
    expect(await failed.live.list.locate('x:s1:live:0-2', 2)).toBe(-1);
    const t = await setup();
    t.engine.hold.add('chunk');
    const found = t.live.list.locate(SPORTS_KEY, 1100);
    await flush();
    t.live.reload();
    for (const held of t.engine.held.chunk!.splice(0)) held.resolve(chunkItems('s1', 2, 2));
    expect(await found).toBe(-1);
    const engine = new FakeEngine();
    engine.hold.add('profile');
    const gone = await setup({ engine });
    const asked = gone.live.list.locate('x:s1:live:0-2', 2);
    gone.live.dispose();
    engine.held.profile!.splice(0).forEach((held) => held.resolve(engine.profileDoc));
    expect(await asked).toBe(-1);
  });

  it('marks the moment its categories are in, once per load that succeeds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    performance.clearMarks('zoma:live-ready');
    const t = await setup();
    expect(performance.getEntriesByName('zoma:live-ready')).toHaveLength(1);
    t.engine.failProfile = true;
    t.live.reload();
    await flush();
    expect(performance.getEntriesByName('zoma:live-ready')).toHaveLength(1);
    t.engine.failProfile = false;
    t.live.reload();
    await flush();
    expect(performance.getEntriesByName('zoma:live-ready')).toHaveLength(2);
  });
});

/**
 * A refreshed catalog (step 22a): s1's empty group is gone, so its Sports group is now catIdx 1
 * (named `sports`), with a new channel first; every other channel keeps its key. s2 is unchanged,
 * or gone with `withKids: false`.
 */
function refreshedCatalog(sports = 'Sports', withKids = true): { catalog: Record<string, CategoryInfo[]>; items: (src: string, catIdx: number, chunk: number) => CatalogItem[] } {
  return {
    catalog: { s1: [info(0, 'News', [3]), info(1, sports, [500, 500, 201])], ...(withKids ? { s2: [info(0, 'Kids', [2])] } : {}) },
    items: (src, catIdx, chunk) => {
      if (src !== 's1' || catIdx !== 1) return chunkItems(src, catIdx, chunk);
      const size = [500, 500, 201][chunk] ?? 0;
      const out: CatalogItem[] = [];
      for (let slot = 0; slot < size; slot += 1) {
        const n = chunk * 500 + slot;
        out.push(n === 0 ? { ...item('s1', 1, 0), key: 'x:s1:live:new', name: 'New channel' } : item('s1', 2, n - 1));
      }
      return out;
    },
  };
}

function swapCatalog(engine: FakeEngine, refreshed: ReturnType<typeof refreshedCatalog>): void {
  engine.catalog = refreshed.catalog;
  engine.items = refreshed.items;
}

const settleAll = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await flush();
};

describe('a catalog refresh while the screen shows (RELAY step 22a)', () => {
  it('reads it again without the loading screen, on the same category, and finds the focused channel', async () => {
    const t = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    expect(t.live.category.value).toBe(2);
    t.live.focusRow(600);
    await flush();
    expect(t.live.row(600)?.item.key).toBe('x:s1:live:2-600');
    const version = t.live.version.value;
    swapCatalog(t.engine, refreshedCatalog());
    const reads = t.engine.chunkCalls.length;
    t.live.catalogChanged();
    // No spinner: the old rows show while the new categories are read.
    expect(t.live.status.value).toBe('ready');
    expect(t.live.pending.value).toBeGreaterThan(0);
    await settleAll();
    expect(t.live.status.value).toBe('ready');
    expect(t.live.rail.value.map((e) => `${e.name}:${e.count}`)).toEqual([':1206', 'News:3', 'Sports:1201', 'Kids:2']);
    expect(t.live.category.value).toBe(2);
    expect(t.at()).toBe('live · channels 601');
    expect(t.live.row(601)?.item.key).toBe('x:s1:live:2-600');
    expect(t.live.row(600)?.item.key).toBe('x:s1:live:2-599');
    // Chunks of the new catalog only.
    expect(t.engine.chunkCalls.slice(reads).every((c) => c.startsWith('s1|1|'))).toBe(true);
    expect(t.live.version.value).toBeGreaterThan(version);
    await t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.live.pending.value).toBe(0);
  });

  it('shows every channel when its category is gone, and finds the focused channel there', async () => {
    const t = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    t.live.focusRow(600);
    await flush();
    swapCatalog(t.engine, refreshedCatalog('Sport'));
    t.live.catalogChanged();
    await settleAll();
    expect(t.live.category.value).toBe(0);
    // News (3), then Sport: the new channel, then the old 600 at 3 + 1 + 600.
    expect(t.at()).toBe('live · channels 604');
    expect(t.live.row(604)?.item.key).toBe('x:s1:live:2-600');
  });

  it('keeps every channel on show as it was', async () => {
    const t = await setup();
    t.live.focusRow(1203);
    await flush();
    expect(t.live.row(1203)?.item.key).toBe('x:s2:live:0-0');
    swapCatalog(t.engine, refreshedCatalog());
    t.live.catalogChanged();
    await settleAll();
    expect(t.live.category.value).toBe(0);
    expect(t.at()).toBe('live · channels 1204');
    expect(t.live.row(1204)?.item.key).toBe('x:s2:live:0-0');
  });

  it('leaves the focus on its row when its channel is gone', async () => {
    const t = await setup();
    t.live.focusRow(1);
    await flush();
    const refreshed = refreshedCatalog();
    swapCatalog(t.engine, {
      catalog: refreshed.catalog,
      items: (src, catIdx, chunk) => refreshed.items(src, catIdx, chunk).map((i) => (i.key === 'x:s1:live:0-1' ? { ...i, key: 'x:s1:live:0-9' } : i)),
    });
    t.live.catalogChanged();
    await settleAll();
    expect(t.at()).toBe('live · channels 1');
    expect(t.live.row(1)?.item.key).toBe('x:s1:live:0-9');
  });

  it('leaves the focus on its row when its channel is gone, inside the shorter list', async () => {
    const t = await setup();
    t.live.focusRow(1204);
    await flush();
    swapCatalog(t.engine, refreshedCatalog('Sports', false));
    t.live.catalogChanged();
    await settleAll();
    expect(t.live.rail.value[0]!.count).toBe(1204);
    expect(t.at()).toBe('live · channels 1203');
  });

  it('follows the channel the focus is on when the new list comes, unless the focus moves while its row is found', async () => {
    const answerChunks = (engine: FakeEngine): void => {
      engine.hold.delete('chunk');
      for (const held of engine.held.chunk!.splice(0)) {
        const [src, catIdx, chunk] = String(held.arg).split('|');
        held.resolve(engine.items(src!, Number(catIdx), Number(chunk)));
      }
    };
    const t = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    t.live.focusRow(600);
    await flush();
    swapCatalog(t.engine, refreshedCatalog());
    t.engine.hold.add('profile');
    t.live.catalogChanged();
    // Moved while the categories are read: the channel it is on when they come is followed.
    await t.press('DOWN');
    t.engine.hold.delete('profile');
    t.engine.held.profile!.splice(0).forEach((held) => held.resolve(t.engine.profileDoc));
    await settleAll();
    expect(t.at()).toBe('live · channels 602');
    expect(t.live.row(602)?.item.key).toBe('x:s1:live:2-601');

    const u = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    u.live.focusRow(600);
    await flush();
    swapCatalog(u.engine, refreshedCatalog());
    u.engine.hold.add('chunk');
    u.live.catalogChanged();
    await settleAll();
    // The new list is in and its row is being found: a move now wins.
    await u.press('UP');
    expect(u.at()).toBe('live · channels 599');
    answerChunks(u.engine);
    await settleAll();
    expect(u.at()).toBe('live · channels 599');
  });

  it('leaves a focus on the rail alone', async () => {
    const t = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    t.live.focusRow(600);
    await t.press('BACK');
    expect(t.at()).toBe('live · rail 2');
    swapCatalog(t.engine, refreshedCatalog());
    t.live.catalogChanged();
    await settleAll();
    expect(t.at()).toBe('live · rail 2');
    expect(t.live.category.value).toBe(2);
  });

  it('tells the player first, while the old rows can still be read, and once per refresh', async () => {
    const seen: (string | undefined)[] = [];
    let live: ReturnType<typeof createLive> | null = null;
    const t = await setup({ startCategory: { src: 's1', name: 'Sports' }, listChanging: () => seen.push(live?.row(600)?.item.key) });
    live = t.live;
    t.live.focusRow(600);
    await flush();
    swapCatalog(t.engine, refreshedCatalog());
    t.engine.hold.add('profile');
    t.live.catalogChanged();
    t.live.catalogChanged();
    t.engine.hold.delete('profile');
    t.engine.held.profile!.splice(0).forEach((held) => held.resolve(t.engine.profileDoc));
    await settleAll();
    expect(seen).toEqual(['x:s1:live:2-600']);
    // The player's search waits for the new list.
    expect(await t.live.list.locate('x:s1:live:2-600', 600)).toBe(601);
  });

  it("makes the player's search wait for the new list", async () => {
    const t = await setup({ startCategory: { src: 's1', name: 'Sports' } });
    swapCatalog(t.engine, refreshedCatalog());
    t.engine.hold.add('profile');
    t.live.catalogChanged();
    const found = t.live.list.locate('x:s1:live:2-10', 10);
    await flush();
    t.engine.hold.delete('profile');
    t.engine.held.profile!.splice(0).forEach((held) => held.resolve(t.engine.profileDoc));
    expect(await found).toBe(11);
  });

  it('is empty when the refresh left no live channel', async () => {
    const t = await setup();
    t.engine.catalog = {};
    t.live.catalogChanged();
    await settleAll();
    expect(t.live.status.value).toBe('empty');
    expect(t.live.rail.value).toEqual([]);
    expect(t.live.list.count()).toBe(0);
    expect(t.live.home.zone('channels')).toMatchObject({ count: 0 });
  });

  it('loads a screen that is still loading, or failed, the usual way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.hold.add('profile');
    const t = await setup({ engine, settle: false, startCategory: { src: 's1', name: 'Sports' } });
    t.live.catalogChanged();
    expect(t.live.status.value).toBe('loading');
    expect(engine.held.profile).toHaveLength(2);
    engine.hold.delete('profile');
    engine.held.profile!.splice(0).forEach((held) => held.resolve(engine.profileDoc));
    await settleAll();
    expect(t.live.status.value).toBe('ready');
    // The start's wish holds for the load that succeeds.
    expect(t.live.category.value).toBe(2);

    const failing = new FakeEngine();
    failing.failProfile = true;
    const f = await setup({ engine: failing });
    expect(f.live.status.value).toBe('failed');
    failing.failProfile = false;
    f.live.catalogChanged();
    expect(f.live.status.value).toBe('loading');
    await settleAll();
    expect(f.live.status.value).toBe('ready');
  });

  it('shows "Try again" when the new categories cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await setup();
    t.engine.failProfile = true;
    t.live.catalogChanged();
    await settleAll();
    expect(t.live.status.value).toBe('failed');
    expect(t.at()).toBe('live · retry 0');
    expect(warn).toHaveBeenCalledWith('The live categories could not be read', expect.any(Error));
    // The player's search doesn't wait for ever.
    expect(await t.live.list.locate('x:s1:live:0-0', 0)).toBe(-1);
  });

  it('reads the rows on show again from the new catalog', async () => {
    const t = await setup();
    expect(t.live.row(0)?.item.name).toBe('Channel s1 0-0');
    const refreshed = refreshedCatalog();
    swapCatalog(t.engine, {
      catalog: refreshed.catalog,
      items: (src, catIdx, chunk) => refreshed.items(src, catIdx, chunk).map((i) => (src === 's1' && catIdx === 0 ? { ...i, name: `${i.name} (new)` } : i)),
    });
    t.live.catalogChanged();
    await settleAll();
    expect(t.at()).toBe('live · channels 0');
    expect(t.live.row(0)?.item.name).toBe('Channel s1 0-0 (new)');
  });

  it('reads only the window of a list that was empty', async () => {
    const engine = new FakeEngine();
    engine.catalog = {};
    const t = await setup({ engine });
    expect(t.live.status.value).toBe('empty');
    engine.catalog = CATEGORIES;
    t.live.catalogChanged();
    await settleAll();
    expect(t.live.status.value).toBe('ready');
    expect(t.at()).toBe('live · channels 0');
    expect(engine.chunkCalls).toEqual(['s1|0|0', 's1|2|0']);
  });

  it('drops the failure of a refresh that a reload replaced', async () => {
    const t = await setup();
    t.engine.hold.add('profile');
    t.live.catalogChanged();
    t.live.reload();
    t.engine.hold.delete('profile');
    const [first, second] = t.engine.held.profile!.splice(0);
    second!.resolve(t.engine.profileDoc);
    await settleAll();
    first!.reject(new Error('no IndexedDB'));
    await settleAll();
    expect(t.live.status.value).toBe('ready');
  });

  it('drops the answer of a refresh that a reload or dispose replaced', async () => {
    const t = await setup();
    t.engine.hold.add('profile');
    t.live.catalogChanged();
    t.live.reload();
    expect(t.live.status.value).toBe('loading');
    t.engine.hold.delete('profile');
    const [first, second] = t.engine.held.profile!.splice(0);
    second!.resolve(t.engine.profileDoc);
    await settleAll();
    expect(t.live.status.value).toBe('ready');
    swapCatalog(t.engine, refreshedCatalog());
    first!.resolve(t.engine.profileDoc);
    await settleAll();
    // The old catalog's rail.
    expect(t.live.rail.value.map((e) => e.count)).toEqual([1205, 3, 1200, 2]);

    const d = await setup();
    d.engine.hold.add('profile');
    d.live.catalogChanged();
    d.live.dispose();
    swapCatalog(d.engine, refreshedCatalog());
    d.engine.held.profile!.splice(0).forEach((held) => held.resolve(d.engine.profileDoc));
    await settleAll();
    expect(d.live.rail.value.map((e) => e.count)).toEqual([1205, 3, 1200, 2]);
    d.live.catalogChanged();
    expect(d.engine.held.profile).toHaveLength(0);
  });

  it('keeps now/next it has (the channels keep their keys)', async () => {
    const t = await setup();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.live.guide('x:s1:live:0-0')?.now?.title).toBe('Now on x:s1:live:0-0');
    swapCatalog(t.engine, refreshedCatalog());
    t.live.catalogChanged();
    await settleAll();
    expect(t.live.guide('x:s1:live:0-0')?.now?.title).toBe('Now on x:s1:live:0-0');
  });
});

describe('a guide refresh while the screen shows (RELAY step 22a)', () => {
  const WINDOW = Array.from({ length: CHANNELS_VISIBLE }, (_, i) => (i < 3 ? `x:s1:live:0-${i}` : `x:s1:live:2-${i - 3}`));

  it("asks now/next again for the rows on show once the window rests; each row keeps its answer until then", async () => {
    const t = await setup();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.engine.nowNextCalls).toEqual([WINDOW]);
    t.engine.hold.add('nowNext');
    t.live.guidesChanged();
    t.clock.advance(GUIDE_DELAY_MS - 1);
    await flush();
    expect(t.engine.nowNextCalls).toHaveLength(1);
    t.clock.advance(1);
    await flush();
    expect(t.engine.nowNextCalls).toEqual([WINDOW, WINDOW]);
    expect(t.live.guide('x:s1:live:0-0')?.now?.title).toBe('Now on x:s1:live:0-0');
    const held = t.engine.held.nowNext!.splice(0)[0]!;
    held.resolve(WINDOW.map((key) => ({ key, epgSrc: 'g2', channel: key, method: 'id', now: programme(`New on ${key}`, 0, 1e9), next: null })));
    await flush();
    expect(t.live.guide('x:s1:live:0-0')?.now?.title).toBe('New on x:s1:live:0-0');
    // Fresh again: the next rest asks nothing.
    t.engine.hold.delete('nowNext');
    await t.press('DOWN');
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.engine.nowNextCalls).toHaveLength(2);
  });

  it('shows an answer asked before the swap, then asks again', async () => {
    const engine = new FakeEngine();
    engine.hold.add('nowNext');
    const t = await setup({ engine });
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(engine.nowNextCalls).toEqual([WINDOW]);
    t.live.guidesChanged();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    // Still on its way: not asked twice.
    expect(engine.nowNextCalls).toEqual([WINDOW]);
    engine.hold.delete('nowNext');
    engine.held.nowNext!.splice(0)[0]!.resolve(WINDOW.map((key) => ({ key, epgSrc: null, channel: null, method: null, now: programme('Old', 0, 1e9), next: null })));
    await flush();
    expect(t.live.guide(WINDOW[0]!)?.now?.title).toBe('Old');
    t.clock.advance(GUIDE_DELAY_MS - 1);
    await flush();
    expect(engine.nowNextCalls).toHaveLength(1);
    t.clock.advance(1);
    await flush();
    expect(engine.nowNextCalls).toEqual([WINDOW, WINDOW]);
    expect(t.live.guide(WINDOW[0]!)?.now?.title).toBe(`Now on ${WINDOW[0]!}`);
  });

  it("asks again for the player's channels too: the newest four", async () => {
    const t = await setup();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    const extra = ['x:s1:live:2-500', 'x:s1:live:2-501', 'x:s1:live:2-502', 'x:s1:live:2-503', 'x:s1:live:2-504'];
    for (const key of extra) t.live.list.askGuide(key);
    await flush();
    expect(t.engine.nowNextCalls.slice(1)).toEqual(extra.map((key) => [key]));
    // Asked again: the newest, not a fifth.
    t.live.list.askGuide(extra[3]!);
    t.live.guidesChanged();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.engine.nowNextCalls.at(-1)).toEqual([...WINDOW, extra[1], extra[2], extra[4], extra[3]]);
  });

  it("asks a channel of the player's once: not while on its way, not when fresh, not twice when on show", async () => {
    const t = await setup();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    t.engine.hold.add('nowNext');
    t.live.list.askGuide('x:s1:live:2-500');
    await t.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    // Row 9 came into the window; the player's channel is still on its way.
    expect(t.engine.nowNextCalls.slice(1)).toEqual([['x:s1:live:2-500'], ['x:s1:live:2-6']]);
    t.engine.hold.delete('nowNext');
    for (const held of t.engine.held.nowNext!.splice(0)) held.resolve((held.arg as ContentKey[]).map((key) => ({ key, epgSrc: null, channel: null, method: null, now: programme('On', 0, 1e9), next: null })));
    await flush();
    await t.press('DOWN');
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.engine.nowNextCalls.slice(3)).toEqual([['x:s1:live:2-7']]);
    // A channel on show the player asked for (fresh, so not asked now) is asked once after a swap.
    const shown = t.live.row(10)!.item.key;
    t.live.list.askGuide(shown);
    t.live.guidesChanged();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    const last = t.engine.nowNextCalls.at(-1)!;
    expect(last.filter((key) => key === shown)).toEqual([shown]);
    expect(last.filter((key) => key === 'x:s1:live:2-500')).toEqual(['x:s1:live:2-500']);
  });

  it("keeps the player's channels fresh at the minute tick once their programme ended", async () => {
    const t = await setup();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    t.live.list.askGuide('x:s1:live:2-500');
    await flush();
    const calls = t.engine.nowNextCalls.length;
    // The fake's programmes end 5 minutes after the minute they were asked in.
    t.clock.advance(6 * MINUTE);
    await flush();
    expect(t.engine.nowNextCalls.slice(calls).some((keys) => keys.indexOf('x:s1:live:2-500') !== -1)).toBe(true);
  });

  it("asks again for a panel's answer that came from before the swap", async () => {
    const engine = new FakeEngine();
    engine.hold.add('focus');
    const key = 'x:s1:live:0-0';
    engine.focusAnswer = (channel) => ({ key: channel.key, epgSrc: null, channel: null, method: null, now: programme('Panel now', 0, 1e9), next: null, from: 'panel', cached: false });
    const t = await setup({ engine });
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    t.live.guidesChanged();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(engine.nowNextCalls).toEqual([WINDOW, WINDOW]);
    const focus = engine.held.focus!.splice(0)[0]!;
    focus.resolve(engine.focusAnswer(focus.arg as FocusedChannel));
    await flush();
    expect(t.live.guide(key)?.now?.title).toBe('Panel now');
    // The next minute tick asks for it again (it predates the new guide), and for nothing else.
    t.clock.advance(MINUTE);
    await flush();
    expect(engine.nowNextCalls.slice(2)).toEqual([[key]]);
  });

  it('asks nothing while the screen loads, failed, or after dispose', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = new FakeEngine();
    failing.failProfile = true;
    const f = await setup({ engine: failing });
    f.live.guidesChanged();
    f.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(failing.nowNextCalls).toEqual([]);
    const t = await setup();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    t.live.dispose();
    t.live.guidesChanged();
    t.clock.advance(GUIDE_DELAY_MS);
    await flush();
    expect(t.engine.nowNextCalls).toHaveLength(1);
  });
});
