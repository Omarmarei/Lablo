import { effect, signal } from '@preact/signals';
import type { CatalogItem, ContentKind, DeviceTier } from '@lablo/core';
import type { CategoryInfo, LoadedProfile, RecentItem, RecentRequest, SourceRecord } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import { LAYOUT, createNavigator, fits } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { Timers } from '../live/live-state';
import { CHUNK_CACHE, LIVE, LIVE_BODY } from '../live/live-state';
import type { MoviesEngine, MoviesOptions, PosterKind } from './movies-state';
import {
  MOVIES,
  MOVIES_GRID,
  MOVIES_GRID_WIDTH,
  MOVIES_RAIL,
  MOVIES_RETRY,
  MOVIES_ROWS,
  MOVIES_SCREEN,
  POSTER_SCREENS,
  SERIES_SCREEN,
  createMovies,
  episodeLabel,
  selectSeries,
} from './movies-state';
import { POSTER_TIERS } from './posters';

function movie(src: string, catIdx: number, n: number, logo = true, label = ''): CatalogItem {
  return {
    key: `x:${src}:movie:${catIdx}-${n}`,
    src,
    kind: 'movie',
    name: `Movie ${label}${src} ${catIdx}-${n}`,
    normName: '',
    group: '',
    url: `http://panel.test/movie/u/p/${catIdx * 10_000 + n}.mp4`,
    logo: logo ? `http://img.test/${src}/${catIdx}/${n}.jpg` : null,
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

function info(catIdx: number, name: string, chunks: number[]): CategoryInfo {
  return { catIdx, name, count: chunks.reduce((a, b) => a + b, 0), chunks };
}

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
const S2: SourceRecord = { id: 's2', type: 'xtream', name: 'Panel', account: { base: 'http://panel.test', username: 'u', password: 'p' }, added: 2 };

/** s1: Action (40 in one chunk), an empty group, Drama (700 in two chunks); s2: Kids (4, the last without a poster). */
const CATEGORIES: Record<string, CategoryInfo[]> = {
  s1: [info(0, 'Action', [40]), info(1, '', []), info(2, 'Drama', [500, 200])],
  s2: [info(0, 'Kids', [4])],
};

interface Held<T> {
  readonly arg: string;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** A data engine that answers at once, or holds the answers of the kinds in `hold`. */
class FakeEngine implements MoviesEngine {
  profileDoc: LoadedProfile | null = { doc: { v: 2, sources: [S1, S2] }, newer: false, migratedFrom: null };
  failProfile = false;
  failChunks = false;
  hold = new Set<'profile' | 'chunk' | 'recent'>();
  readonly held: { profile: Held<LoadedProfile | null>[]; chunk: Held<CatalogItem[]>[]; recent: Held<RecentItem[]>[] } = { profile: [], chunk: [], recent: [] };
  readonly chunkCalls: string[] = [];
  /** The newest movies `recent` gives (step 26e; default none, as for playlists). */
  newest: RecentItem[] = [];
  failRecent = false;
  readonly recentCalls: RecentRequest[] = [];
  catalog: Record<string, CategoryInfo[]> = CATEGORIES;
  /** Put before each movie's name: a newer catalog's items differ from an older one's. */
  label = '';
  /** The kind every read must ask for (step 27a: the series screen asks `series`). */
  kind: ContentKind = 'movie';
  /** The kinds asked, in order (step 27a). */
  readonly kinds: ContentKind[] = [];

  /** The items of a chunk of the catalog as it is now. */
  items(src: string, catIdx: number, chunk: number): CatalogItem[] {
    const cat = this.catalog[src]?.find((c) => c.catIdx === catIdx);
    const out: CatalogItem[] = [];
    for (let slot = 0; slot < (cat?.chunks[chunk] ?? 0); slot += 1) out.push(movie(src, catIdx, chunk * 500 + slot, !(src === 's2' && slot === 3), this.label));
    return out;
  }

  profile(): Promise<LoadedProfile | null> {
    if (this.hold.has('profile')) return new Promise((resolve, reject) => this.held.profile.push({ arg: '', resolve, reject }));
    return this.failProfile ? Promise.reject(new Error('no IndexedDB')) : Promise.resolve(this.profileDoc);
  }

  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]> {
    this.kinds.push(kind);
    expect(kind).toBe(this.kind);
    return Promise.resolve(this.catalog[src] ?? []);
  }

  recent(req: RecentRequest): Promise<RecentItem[]> {
    this.recentCalls.push(req);
    if (this.hold.has('recent')) return new Promise((resolve, reject) => this.held.recent.push({ arg: '', resolve, reject }));
    return this.failRecent ? Promise.reject(new Error('read failed')) : Promise.resolve(this.newest.slice());
  }

  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]> {
    this.kinds.push(kind);
    expect(kind).toBe(this.kind);
    const id = `${src}|${catIdx}|${chunk}`;
    this.chunkCalls.push(id);
    if (this.hold.has('chunk')) return new Promise((resolve, reject) => this.held.chunk.push({ arg: id, resolve, reject }));
    return this.failChunks ? Promise.reject(new Error('read failed')) : Promise.resolve(this.items(src, catIdx, chunk));
  }
}

/** Timers run by hand, with a clock that `advance` moves. */
function manualTimers() {
  let now = 0;
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

async function setup(
  options: { engine?: FakeEngine; tier?: DeviceTier; select?: (item: CatalogItem) => void; open?: boolean; progress?: MoviesOptions['progress']; kind?: PosterKind } = {},
) {
  const engine = options.engine ?? new FakeEngine();
  const clock = manualTimers();
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  nav.top.focus('header', 1);
  const movies = createMovies({
    nav,
    engine,
    timers: clock.timers,
    ...(options.tier === undefined ? {} : { tier: () => options.tier! }),
    ...(options.select === undefined ? {} : { select: options.select }),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
  });
  if (options.open !== false) {
    movies.open();
    await flush();
  }
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  /** The tiles `[from, to)` as `catIdx-n`, `…` while their chunk loads. */
  const tiles = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let i = from; i < to; i += 1) out.push(movies.movie(i)?.name.replace(/^Movie /, '') ?? '…');
    return out;
  };
  /** The tiles of `[from, to)` that draw a poster. */
  const withPosters = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let i = from; i < to; i += 1) if (movies.poster(i) !== undefined) out.push(i);
    return out;
  };
  const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_v, i) => from + i);
  /** The view rests: its posters are asked. */
  const rest = async (): Promise<void> => {
    clock.advance(POSTER_TIERS[options.tier ?? 'full'].restMs);
    await flush();
  };
  /** Every poster of `[from, to)` that draws loads, and those it lets in after them, until none is left. */
  const loadAll = (from: number, to: number): void => {
    for (let round = 0; round < 10; round += 1) {
      for (let i = from; i < to; i += 1) {
        const url = movies.poster(i);
        if (url !== undefined) movies.posterLoaded(url);
      }
    }
  };
  return { engine, clock, nav, movies, at, press, tiles, withPosters, range, rest, loadAll };
}

describe('the movies screen (RELAY step 26a)', () => {
  it('fits 6 posters a row, 3 rows, beside the live rail in the safe area', () => {
    expect(MOVIES.columns).toBe(6);
    expect(MOVIES_ROWS).toBe(3);
    expect(MOVIES_ROWS).toBe(fits(LIVE_BODY, LAYOUT.posterHeight, MOVIES.rowGap));
    expect(LIVE_BODY - (3 * LAYOUT.posterHeight + 2 * MOVIES.rowGap)).toBeGreaterThanOrEqual(0);
    expect(MOVIES_GRID_WIDTH).toBe(6 * 184 + 5 * 24);
    expect(MOVIES_GRID_WIDTH).toBeLessThanOrEqual(LIVE.width - LIVE.railWidth - LIVE.columnGap);
    // 2:3 posters.
    expect(LAYOUT.posterWidth * 3).toBe(LAYOUT.posterHeight * 2);
  });

  it('opens on the first movie of "All movies", the rail every category with movies', async () => {
    const t = await setup();
    expect(t.movies.screen.value).not.toBeNull();
    expect(t.at()).toBe('movies · grid 0');
    expect(t.movies.status.value).toBe('ready');
    expect(t.movies.rail.value.map((e) => `${e.kind}:${e.name}:${e.count}`)).toEqual(['all::744', 'category:Action:40', 'category:Drama:700', 'category:Kids:4']);
    expect(t.movies.category.value).toBe(0);
    expect(t.movies.screen.value!.zone(MOVIES_GRID)).toMatchObject({ kind: 'grid', count: 744, columns: 6, visibleRows: 3 });
    // The rows in view and one below: Action's one chunk.
    expect(t.engine.chunkCalls).toEqual(['s1|0|0']);
    expect(t.tiles(0, 3)).toEqual(['s1 0-0', 's1 0-1', 's1 0-2']);
  });

  it('shows the loading state until the sources are read, then the grid', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['profile']);
    const t = await setup({ engine });
    expect(t.movies.status.value).toBe('loading');
    expect(t.movies.pending.value).toBe(1);
    expect(t.at()).toBe('movies · grid -1');
    engine.held.profile.shift()!.resolve(engine.profileDoc);
    await flush();
    expect(t.movies.status.value).toBe('ready');
    expect(t.at()).toBe('movies · grid 0');
  });

  it('reads the chunks of the rows in view and one row either side, and keeps CHUNK_CACHE of them', async () => {
    const t = await setup();
    // Drama: 700 in chunks of 500 and 200.
    await t.press('LEFT', 'DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe('movies · grid 0');
    expect(t.movies.category.value).toBe(2);
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|2|0']);
    // Down to row 83 (item 498): rows 81–83 in view, 80 and 84 read too, which reach chunk 1.
    t.movies.screen.value!.focus(MOVIES_GRID, 498);
    await flush();
    expect(t.movies.screen.value!.position(MOVIES_GRID).top).toBe(81);
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|2|0', 's1|2|1']);
    expect(t.tiles(498, 502)).toEqual(['s1 2-498', 's1 2-499', 's1 2-500', 's1 2-501']);
    // A chunk is read once while it is kept.
    await t.press('UP', 'DOWN');
    expect(t.engine.chunkCalls).toHaveLength(3);
    expect(CHUNK_CACHE).toBe(8);
  });

  it('reads the row below the view and the row above it, when they are in other chunks', async () => {
    const engine = new FakeEngine();
    // Chunks of 18: three rows each.
    engine.catalog = { s1: [info(0, 'Rows', [18, 18, 18])], s2: [] };
    const t = await setup({ engine });
    // Rows 0-2 in view (chunk 0); row 3 below it is chunk 1's.
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|0|1']);
    t.movies.screen.value!.focus(MOVIES_GRID, 53);
    await flush();
    expect(t.movies.screen.value!.position(MOVIES_GRID).top).toBe(6);
    // A swap reads the view again from nothing: rows 6-8 (chunk 2), and row 5 above them (chunk 1).
    t.movies.catalogChanged();
    await flush();
    expect(t.at()).toBe('movies · grid 53');
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|0|1', 's1|0|2', 's1|0|1', 's1|0|2']);
  });

  it('reads a chunk once while its read is out', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['chunk']);
    const t = await setup({ engine });
    await t.press('RIGHT', 'RIGHT', 'DOWN');
    expect(t.engine.chunkCalls).toEqual(['s1|0|0']);
  });

  it('keeps the chunks used last, not those read first', async () => {
    const engine = new FakeEngine();
    // Chunks of 30, five rows each: a view at tile 30k needs chunks k-1 and k.
    engine.catalog = { s1: [info(0, 'Big', Array.from({ length: 12 }, () => 30))], s2: [] };
    const t = await setup({ engine });
    for (let i = 30; i <= 210; i += 30) {
      t.movies.screen.value!.focus(MOVIES_GRID, i);
      await flush();
    }
    // Chunks 0-7 are kept: back at the top, nothing is read.
    let calls = t.engine.chunkCalls.length;
    t.movies.screen.value!.focus(MOVIES_GRID, 0);
    await flush();
    expect(t.engine.chunkCalls).toHaveLength(calls);
    // Chunk 0 is the one used last: two new chunks push out chunks 1 and 2, not 0.
    t.movies.screen.value!.focus(MOVIES_GRID, 270);
    await flush();
    await t.press('RIGHT');
    calls = t.engine.chunkCalls.length;
    t.movies.screen.value!.focus(MOVIES_GRID, 0);
    await flush();
    expect(t.engine.chunkCalls).toHaveLength(calls);
    t.movies.screen.value!.focus(MOVIES_GRID, 60);
    await flush();
    expect(t.engine.chunkCalls.slice(calls)).toEqual(['s1|0|1', 's1|0|2']);
  });

  it("never drops a chunk the view needs, even when it needs more than CHUNK_CACHE", async () => {
    const engine = new FakeEngine();
    // A movie a chunk (a provider's partial chunks): the view and its margins need 24.
    engine.catalog = { s1: [info(0, 'Tiny', Array.from({ length: 40 }, () => 1))], s2: [] };
    const t = await setup({ engine });
    expect(t.engine.chunkCalls).toHaveLength(24);
    await t.press('RIGHT', 'LEFT');
    expect(t.engine.chunkCalls).toHaveLength(24);
    expect(t.tiles(0, 2)).toEqual(['s1 0-0', 's1 0-500']);
  });

  it('drops the least recently used chunks beyond CHUNK_CACHE', async () => {
    const engine = new FakeEngine();
    engine.catalog = { s1: [info(0, 'Big', Array.from({ length: 12 }, () => 30))], s2: [] };
    const t = await setup({ engine });
    // Every chunk is 30 movies, 5 rows: walk the rows in view over all 12 chunks.
    for (let i = 0; i < 360; i += 30) {
      t.movies.screen.value!.focus(MOVIES_GRID, i);
      await flush();
    }
    expect(new Set(t.engine.chunkCalls).size).toBe(12);
    // Back at the top: the first chunks were dropped, so they are read again.
    const before = t.engine.chunkCalls.length;
    t.movies.screen.value!.focus(MOVIES_GRID, 0);
    await flush();
    expect(t.engine.chunkCalls.slice(before)).toContain('s1|0|0');
    expect(t.tiles(0, 1)).toEqual(['s1 0-0']);
  });

  it('draws no poster before the view rests, then the focused row first, `parallel` at a time', async () => {
    const t = await setup();
    expect(t.withPosters(0, 18)).toEqual([]);
    // A rest not over yet counts as pending.
    expect(t.movies.pending.value).toBe(1);
    t.clock.advance(POSTER_TIERS.full.restMs - 1);
    await flush();
    expect(t.withPosters(0, 18)).toEqual([]);
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 6));
    expect(t.movies.pending.value).toBe(6);
    for (let i = 0; i < 6; i += 1) t.movies.posterLoaded(t.movies.poster(i)!);
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 12));
    for (let i = 6; i < 12; i += 1) t.movies.posterLoaded(t.movies.poster(i)!);
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 18));
    for (let i = 12; i < 18; i += 1) t.movies.posterLoaded(t.movies.poster(i)!);
    expect(t.movies.pending.value).toBe(0);
    // Nothing outside the view.
    expect(t.withPosters(18, 40)).toEqual([]);
  });

  it('asks the focused row first when the focus is lower in the view', async () => {
    const t = await setup();
    await t.press('DOWN', 'DOWN');
    expect(t.at()).toBe('movies · grid 12');
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual(t.range(12, 18));
  });

  it('rests longer and downloads two at a time on the low tier', async () => {
    const t = await setup({ tier: 'low' });
    t.clock.advance(POSTER_TIERS.full.restMs);
    await flush();
    expect(t.withPosters(0, 18)).toEqual([]);
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual([0, 1]);
    expect(t.movies.pending.value).toBe(2);
  });

  it('starts no download while the view moves: a new row waits for the next rest, the rows that stay keep theirs', async () => {
    const t = await setup();
    await t.rest();
    t.loadAll(0, 18);
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 18));
    // Four rows down (a held key): rows 2–4 in view; 2 kept its posters, 3 and 4 wait.
    await t.press('DOWN', 'DOWN', 'DOWN', 'DOWN');
    expect(t.movies.screen.value!.position(MOVIES_GRID).top).toBe(2);
    t.clock.advance(POSTER_TIERS.full.restMs - 1);
    await flush();
    expect(t.withPosters(12, 30)).toEqual(t.range(12, 18));
    expect(t.movies.pending.value).toBe(1);
    await t.rest();
    // The focused row (4) first.
    expect(t.withPosters(12, 30)).toEqual(t.range(12, 18).concat(t.range(24, 30)));
  });

  it('starts no download after a key, though downloads under way end: the posters left wait for the next rest (RELAY step 26b)', async () => {
    const t = await setup();
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 6));
    // RIGHT keeps the view: the six under way end, and the twelve waiting wait for the rest.
    await t.press('RIGHT');
    for (let i = 0; i < 6; i += 1) t.movies.posterLoaded(t.movies.poster(i)!);
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 6));
    expect(t.movies.pending.value).toBe(1);
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 12));
    // A move to the next row while those six download: the rows left of the view wait too.
    await t.press('DOWN');
    for (let i = 6; i < 12; i += 1) t.movies.posterLoaded(t.movies.poster(i)!);
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 12));
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 18));
  });

  it('waits for the view to rest from the last key, not the first', async () => {
    const t = await setup();
    await t.rest();
    t.loadAll(0, 18);
    await t.press('DOWN', 'DOWN', 'DOWN');
    for (let i = 0; i < 3; i += 1) {
      t.clock.advance(POSTER_TIERS.full.restMs - 50);
      await t.press('DOWN');
    }
    // Row 6 in view since the last key, rows 4 and 5 before it: none asked yet.
    expect(t.movies.screen.value!.position(MOVIES_GRID).top).toBe(4);
    expect(t.withPosters(24, 42)).toEqual([]);
    await t.rest();
    expect(t.withPosters(24, 42)).toEqual(t.range(36, 42));
  });

  it('asks the posters of tiles whose chunk came after the rest', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['chunk']);
    const t = await setup({ engine });
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual([]);
    expect(t.movies.pending.value).toBe(1);
    const before = t.movies.version.value;
    engine.held.chunk.shift()!.resolve(engine.items('s1', 0, 0));
    await flush();
    expect(t.movies.version.value).toBeGreaterThan(before);
    expect(t.tiles(0, 1)).toEqual(['s1 0-0']);
    expect(t.withPosters(0, 18)).toEqual([]);
    await t.rest();
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 6));
  });

  it('draws the title of a movie whose poster failed, or that has none', async () => {
    const t = await setup();
    await t.press('LEFT', 'DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.movies.category.value).toBe(3);
    await t.rest();
    // Kids' fourth movie has no poster.
    expect(t.withPosters(0, 4)).toEqual([0, 1, 2]);
    const before = t.movies.version.value;
    t.movies.posterFailed(t.movies.poster(1)!);
    expect(t.withPosters(0, 4)).toEqual([0, 2]);
    expect(t.movies.version.value).toBe(before + 1);
    expect(t.movies.pending.value).toBe(2);
    t.movies.posterLoaded(t.movies.poster(0)!);
    expect(t.movies.version.value).toBe(before + 2);
    expect(t.movies.pending.value).toBe(1);
    await t.press('RIGHT');
    await t.rest();
    expect(t.withPosters(0, 4)).toEqual([0, 2]);
  });

  it('moves between the rail and the grid, and Back goes to the rail, then closes', async () => {
    const t = await setup();
    await t.press('RIGHT');
    expect(t.at()).toBe('movies · grid 1');
    // LEFT from a tile that isn't in the first column stays in the grid.
    await t.press('LEFT');
    expect(t.at()).toBe('movies · grid 0');
    await t.press('LEFT');
    expect(t.at()).toBe('movies · rail 0');
    await t.press('RIGHT');
    expect(t.at()).toBe('movies · grid 0');
    // UP from the first row goes nowhere.
    await t.press('UP');
    expect(t.at()).toBe('movies · grid 0');
    await t.press('DOWN', 'BACK');
    expect(t.at()).toBe('movies · rail 0');
    // Moving on the rail doesn't change the category; OK does.
    await t.press('DOWN');
    expect(t.movies.category.value).toBe(0);
    await t.press('OK');
    expect(t.at()).toBe('movies · grid 0');
    expect(t.movies.category.value).toBe(1);
    await t.press('BACK');
    expect(t.at()).toBe('movies · rail 1');
    await t.press('BACK');
    expect(t.movies.screen.value).toBeNull();
    expect(t.at()).toBe('live · header 1');
    expect(t.movies.pending.value).toBe(0);
  });

  it('opens again on "All movies", with nothing kept from before', async () => {
    const t = await setup();
    await t.press('LEFT', 'DOWN', 'DOWN', 'OK');
    await t.rest();
    expect(t.withPosters(0, 6)).toEqual(t.range(0, 6));
    await t.press('BACK', 'BACK');
    expect(t.movies.pending.value).toBe(0);
    t.movies.open();
    await flush();
    expect(t.at()).toBe('movies · grid 0');
    expect(t.movies.category.value).toBe(0);
    expect(t.withPosters(0, 6)).toEqual([]);
    // Open while open does nothing.
    t.movies.open();
    expect(t.nav.snapshot().depth).toBe(2);
  });

  it('pages the grid with CH±', async () => {
    const t = await setup();
    await t.press('CH_DOWN');
    expect(t.movies.screen.value!.position(MOVIES_GRID).top).toBeGreaterThan(0);
    await t.press('CH_UP');
    expect(t.movies.screen.value!.position(MOVIES_GRID).top).toBe(0);
  });

  it('says so when the sources have no movies, and Back closes it', async () => {
    const engine = new FakeEngine();
    engine.catalog = { s1: [info(0, 'Empty', [])] };
    const t = await setup({ engine });
    expect(t.movies.status.value).toBe('empty');
    expect(t.movies.rail.value).toEqual([]);
    await t.press('OK', 'DOWN', 'LEFT');
    await t.press('BACK');
    expect(t.movies.screen.value).toBeNull();
    expect(t.at()).toBe('live · header 1');
  });

  it('offers "Try again" when the sources could not be read', async () => {
    const engine = new FakeEngine();
    engine.failProfile = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await setup({ engine });
    expect(t.movies.status.value).toBe('failed');
    expect(t.at()).toBe('movies · retry 0');
    engine.failProfile = false;
    engine.hold = new Set(['profile']);
    await t.press('OK');
    expect(t.movies.status.value).toBe('loading');
    expect(t.movies.screen.value!.zone(MOVIES_RETRY)).toMatchObject({ count: 0 });
    engine.held.profile.shift()!.resolve(engine.profileDoc);
    await flush();
    expect(t.movies.status.value).toBe('ready');
    expect(t.at()).toBe('movies · grid 0');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('asks a chunk again at the next move after its read failed', async () => {
    const engine = new FakeEngine();
    engine.failChunks = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await setup({ engine });
    expect(t.tiles(0, 1)).toEqual(['…']);
    engine.failChunks = false;
    await t.press('RIGHT');
    expect(t.tiles(0, 1)).toEqual(['s1 0-0']);
    expect(t.engine.chunkCalls).toEqual(['s1|0|0', 's1|0|0']);
    warn.mockRestore();
  });

  it('gives OK on a movie to `select`, and nothing for a tile still loading', async () => {
    const select = vi.fn();
    const engine = new FakeEngine();
    engine.hold = new Set(['chunk']);
    const t = await setup({ engine, select });
    await t.press('OK');
    expect(select).not.toHaveBeenCalled();
    engine.held.chunk.shift()!.resolve(engine.items('s1', 0, 0));
    await flush();
    await t.press('RIGHT', 'OK');
    expect(select).toHaveBeenCalledTimes(1);
    expect((select.mock.calls[0]![0] as CatalogItem).name).toBe('Movie s1 0-1');
  });

  it('drops the answers of a screen that closed', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['profile']);
    const t = await setup({ engine });
    await t.press('BACK');
    expect(t.movies.screen.value).toBeNull();
    engine.held.profile.shift()!.resolve(engine.profileDoc);
    await flush();
    expect(t.movies.rail.value).toEqual([]);
    expect(t.movies.pending.value).toBe(0);
    expect(t.clock.pending()).toBe(0);
  });

  it("drops the answer of an earlier open's read", async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['profile']);
    const t = await setup({ engine });
    await t.press('BACK');
    t.movies.open();
    await flush();
    expect(engine.held.profile).toHaveLength(2);
    engine.held.profile.shift()!.resolve(engine.profileDoc);
    await flush();
    expect(t.movies.status.value).toBe('loading');
    engine.held.profile.shift()!.resolve(engine.profileDoc);
    await flush();
    expect(t.movies.status.value).toBe('ready');
  });

  it("drops the failure of an earlier open's read", async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['profile']);
    const t = await setup({ engine });
    await t.press('BACK');
    t.movies.open();
    await flush();
    engine.held.profile.shift()!.reject(new Error('no IndexedDB'));
    await flush();
    expect(t.movies.status.value).toBe('loading');
    expect(t.at()).toBe('movies · grid -1');
    engine.held.profile.shift()!.resolve(engine.profileDoc);
    await flush();
    expect(t.movies.status.value).toBe('ready');
  });

  it('closes on Back while it loads again, though an earlier open had a rail', async () => {
    const engine = new FakeEngine();
    const t = await setup({ engine });
    await t.press('LEFT', 'BACK');
    expect(t.movies.screen.value).toBeNull();
    engine.hold = new Set(['profile']);
    t.movies.open();
    await flush();
    expect(t.movies.rail.value).toEqual([]);
    await t.press('BACK');
    expect(t.movies.screen.value).toBeNull();
    expect(t.at()).toBe('live · header 1');
  });

  it('keeps the category on show and the focus through a catalog swap', async () => {
    const t = await setup();
    await t.press('LEFT', 'DOWN', 'DOWN', 'OK', 'RIGHT', 'RIGHT');
    expect(t.at()).toBe('movies · grid 2');
    expect(t.movies.category.value).toBe(2);
    // A refresh: Action is gone, Drama is now the first category.
    t.engine.catalog = { s1: [info(0, 'Drama', [500, 210])], s2: CATEGORIES['s2']! };
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.rail.value.map((e) => e.name)).toEqual(['', 'Drama', 'Kids']);
    expect(t.movies.category.value).toBe(1);
    expect(t.at()).toBe('movies · grid 2');
    expect(t.movies.screen.value!.zone(MOVIES_GRID)).toMatchObject({ count: 710 });
    // The new catalog's chunks are read, not the old ones' kept.
    expect(t.engine.chunkCalls.slice(-1)).toEqual(['s1|0|0']);
    expect(t.tiles(0, 1)).toEqual(['s1 0-0']);
    // The category gone: "All movies" from its first movie.
    t.engine.catalog = { s1: [info(0, 'Comedy', [10])], s2: [] };
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.category.value).toBe(0);
    expect(t.at()).toBe('movies · grid 0');
  });

  it("drops a chunk read before a catalog swap, and shows the new catalog's", async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['chunk']);
    const t = await setup({ engine });
    expect(engine.held.chunk.map((h) => h.arg)).toEqual(['s1|0|0']);
    const old = engine.items('s1', 0, 0);
    engine.label = 'new ';
    t.movies.catalogChanged();
    await flush();
    expect(engine.held.chunk.map((h) => h.arg)).toEqual(['s1|0|0', 's1|0|0']);
    engine.held.chunk.shift()!.resolve(old);
    await flush();
    expect(t.tiles(0, 1)).toEqual(['…']);
    engine.held.chunk.shift()!.resolve(engine.items('s1', 0, 0));
    await flush();
    expect(t.tiles(0, 1)).toEqual(['new s1 0-0']);
  });

  it('says so when a swap leaves no movies', async () => {
    const t = await setup();
    await t.press('RIGHT');
    t.engine.catalog = { s1: [], s2: [] };
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.status.value).toBe('empty');
    expect(t.movies.screen.value!.zone(MOVIES_GRID)).toMatchObject({ count: 0 });
    await t.press('BACK');
    expect(t.movies.screen.value).toBeNull();
  });

  it('keeps the focus on the rail through a catalog swap, and ignores a swap while closed', async () => {
    const t = await setup();
    await t.press('LEFT', 'DOWN', 'OK', 'BACK');
    expect(t.at()).toBe('movies · rail 1');
    t.movies.catalogChanged();
    await flush();
    expect(t.at()).toBe('movies · rail 1');
    expect(t.movies.category.value).toBe(1);
    await t.press('BACK');
    const calls = t.engine.chunkCalls.length;
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.screen.value).toBeNull();
    expect(t.engine.chunkCalls).toHaveLength(calls);
  });

  it('reads again from the loading screen when a swap comes while it failed', async () => {
    const engine = new FakeEngine();
    engine.failProfile = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await setup({ engine });
    expect(t.movies.status.value).toBe('failed');
    engine.failProfile = false;
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.status.value).toBe('ready');
    expect(t.at()).toBe('movies · grid 0');
    expect(t.movies.screen.value!.zone(MOVIES_RETRY)).toMatchObject({ count: 0 });
    warn.mockRestore();
  });

  it('stops on dispose', async () => {
    const t = await setup();
    t.movies.dispose();
    expect(t.clock.pending()).toBe(0);
    await t.press('DOWN');
    expect(t.clock.pending()).toBe(0);
    t.movies.dispose();
    expect(t.movies.pending.value).toBe(0);
  });

  it('is a screen of its own on the navigator', async () => {
    const t = await setup({ open: false });
    expect(t.movies.screen.value).toBeNull();
    t.movies.open();
    expect(t.nav.snapshot().screen).toBe(MOVIES_SCREEN);
    expect(t.movies.screen.value!.zone(MOVIES_RAIL)).toMatchObject({ kind: 'list', axis: 'vertical' });
  });
});

describe("the movies screen: the tiles' bars (RELAY step 26d)", () => {
  it('draws the share watched of each movie left part way, and draws again when one changes', async () => {
    const shares: Record<string, number> = { 'x:s1:movie:0-1': 0.25, 'x:s1:movie:0-3': 1 };
    const version = signal(0);
    const asked: string[] = [];
    const t = await setup({
      progress: {
        version,
        share: (key) => {
          asked.push(key);
          return shares[key];
        },
      },
    });
    expect(t.movies.progress(0)).toBeUndefined();
    expect(t.movies.progress(1)).toBe(0.25);
    expect(t.movies.progress(3)).toBe(1);
    expect(asked).toEqual(['x:s1:movie:0-0', 'x:s1:movie:0-1', 'x:s1:movie:0-3']);
    // A tile whose chunk isn't in asks nothing.
    asked.length = 0;
    expect(t.movies.progress(999_999)).toBeUndefined();
    expect(asked).toEqual([]);
    // Whoever reads it hears of a new position.
    const seen: (number | undefined)[] = [];
    const stop = effect(() => {
      seen.push(t.movies.progress(0));
    });
    shares['x:s1:movie:0-0'] = 0.5;
    version.value += 1;
    stop();
    expect(seen).toEqual([undefined, 0.5]);
    // Without positions (no `progress`): no bars.
    const u = await setup();
    expect(u.movies.progress(1)).toBeUndefined();
  });
});

describe('the movies screen: "Recently added" (RELAY step 26e)', () => {
  /** `count` films, newest first: s2's and s1's in turn (`new 0`, `new 1`, …), one a day back from day 1000. */
  function newest(count: number, label = 'new'): RecentItem[] {
    const out: RecentItem[] = [];
    for (let n = 0; n < count; n += 1) {
      const src = n % 2 === 0 ? 's2' : 's1';
      out.push({ added: 1000 - n, item: { ...movie(src, 9, n, n !== 4), key: `x:${src}:movie:${label}-${n}`, name: `Movie ${label} ${n}` } });
    }
    return out;
  }

  async function withNewest(count: number, options: { tier?: DeviceTier; select?: (item: CatalogItem) => void; progress?: MoviesOptions['progress'] } = {}) {
    const engine = new FakeEngine();
    engine.newest = newest(count);
    return setup({ engine, ...options });
  }

  it('opens on "Recently added": the newest movies first, then "All movies" and the categories', async () => {
    const t = await withNewest(20);
    expect(t.movies.rail.value.map((e) => `${e.kind}:${e.name}:${e.count}`)).toEqual(['recent::20', 'all::744', 'category:Action:40', 'category:Drama:700', 'category:Kids:4']);
    expect(t.movies.rail.value[0]!.parts).toEqual([]);
    expect(t.movies.category.value).toBe(0);
    expect(t.at()).toBe('movies · grid 0');
    expect(t.movies.screen.value!.zone(MOVIES_GRID)).toMatchObject({ kind: 'grid', count: 20 });
    expect(t.tiles(0, 4)).toEqual(['new 0', 'new 1', 'new 2', 'new 3']);
    expect(t.tiles(19, 21)).toEqual(['new 19', '…']);
    // Asked once for every source in the profile's order; no chunk read for it.
    expect(t.engine.recentCalls).toEqual([{ sources: ['s1', 's2'], kind: 'movie' }]);
    expect(t.engine.chunkCalls).toEqual([]);
    expect(t.movies.pending.value).toBe(1);
    // Nothing held once disposed.
    t.movies.dispose();
    expect(t.movies.movie(0)).toBeNull();
  });

  it('has no such entry when no movie has a date (playlists alone): "All movies" comes first', async () => {
    const t = await setup();
    expect(t.movies.rail.value[0]!.kind).toBe('all');
    expect(t.engine.recentCalls).toEqual([{ sources: ['s1', 's2'], kind: 'movie' }]);
    const engine = new FakeEngine();
    engine.profileDoc = { doc: { v: 2, sources: [] }, newer: false, migratedFrom: null };
    const none = await setup({ engine });
    expect(none.movies.status.value).toBe('empty');
    expect(engine.recentCalls).toEqual([{ sources: [], kind: 'movie' }]);
  });

  it('asks its posters once the view rests, with no key pressed, and none beyond the view', async () => {
    const t = await withNewest(30);
    expect(t.withPosters(0, 30)).toEqual([]);
    t.clock.advance(POSTER_TIERS.full.restMs - 1);
    await flush();
    expect(t.withPosters(0, 30)).toEqual([]);
    await t.rest();
    // Six at a time; film 4 has no poster (its title shows), so the sixth is film 6's.
    expect(t.withPosters(0, 30)).toEqual([0, 1, 2, 3, 5, 6]);
    t.loadAll(0, 30);
    expect(t.withPosters(0, 30)).toEqual(t.range(0, 18).filter((i) => i !== 4));
    expect(t.movies.poster(0)).toBe('http://img.test/s2/9/0.jpg');
    expect(t.movies.pending.value).toBe(0);
    // Down a row: the new row's posters at the next rest.
    await t.press('DOWN', 'DOWN', 'DOWN');
    expect(t.movies.screen.value!.position(MOVIES_GRID).top).toBe(1);
    expect(t.withPosters(18, 24)).toEqual([]);
    await t.rest();
    t.loadAll(0, 30);
    expect(t.withPosters(0, 30)).toEqual(t.range(6, 24));
    expect(t.engine.chunkCalls).toEqual([]);
  });

  it('goes to "All movies" and back: chunks for one, the held movies for the other', async () => {
    const t = await withNewest(20);
    await t.press('LEFT', 'DOWN', 'OK');
    expect(t.movies.category.value).toBe(1);
    expect(t.at()).toBe('movies · grid 0');
    expect(t.movies.screen.value!.zone(MOVIES_GRID)).toMatchObject({ count: 744 });
    expect(t.engine.chunkCalls).toEqual(['s1|0|0']);
    expect(t.tiles(0, 2)).toEqual(['s1 0-0', 's1 0-1']);
    await t.press('LEFT', 'UP', 'OK');
    expect(t.movies.category.value).toBe(0);
    expect(t.movies.screen.value!.zone(MOVIES_GRID)).toMatchObject({ count: 20 });
    expect(t.tiles(0, 2)).toEqual(['new 0', 'new 1']);
    expect(t.engine.chunkCalls).toEqual(['s1|0|0']);
    // Back in its grid: the rail on "Recently added", then the screen closes.
    await t.press('RIGHT', 'BACK');
    expect(t.at()).toBe('movies · rail 0');
    await t.press('BACK');
    expect(t.movies.screen.value).toBeNull();
    // Nothing held once closed; the next open reads them again.
    expect(t.movies.movie(0)).toBeNull();
    t.engine.newest = newest(3, 'newer');
    t.movies.open();
    await flush();
    expect(t.engine.recentCalls).toHaveLength(2);
    expect(t.tiles(0, 4)).toEqual(['newer 0', 'newer 1', 'newer 2', '…']);
  });

  it("gives OK on one of its movies to `select`, and draws that movie's bar", async () => {
    const select = vi.fn();
    const version = signal(0);
    const t = await withNewest(20, { select, progress: { version, share: (key) => (key === 'x:s1:movie:new-1' ? 0.5 : undefined) } });
    await t.press('RIGHT', 'OK');
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0]![0]).toMatchObject({ key: 'x:s1:movie:new-1', name: 'Movie new 1' });
    expect(t.movies.progress(0)).toBeUndefined();
    expect(t.movies.progress(1)).toBe(0.5);
    expect(t.movies.progress(20)).toBeUndefined();
  });

  it('waits for its read like the categories\', and offers "Try again" when it fails', async () => {
    const engine = new FakeEngine();
    engine.newest = newest(2);
    engine.hold = new Set(['recent']);
    const t = await setup({ engine });
    expect(t.movies.status.value).toBe('loading');
    engine.held.recent.shift()!.resolve(engine.newest);
    await flush();
    expect(t.movies.status.value).toBe('ready');
    expect(t.movies.rail.value[0]!.kind).toBe('recent');

    const failing = new FakeEngine();
    failing.failRecent = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const u = await setup({ engine: failing });
    expect(u.movies.status.value).toBe('failed');
    expect(u.at()).toBe('movies · retry 0');
    failing.failRecent = false;
    await u.press('OK');
    expect(u.movies.status.value).toBe('ready');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('asks the new films\' posters after a swap that leaves the focus where it was', async () => {
    const t = await withNewest(20);
    await t.rest();
    t.loadAll(0, 20);
    expect(t.movies.poster(0)).toBe('http://img.test/s2/9/0.jpg');
    // The same count and place, other films: the focus doesn't move, yet their posters come at the rest.
    t.engine.newest = newest(20, 'newer').map((r) => ({ ...r, item: { ...r.item, logo: r.item.logo === null ? null : `${r.item.logo}?newer` } }));
    t.movies.catalogChanged();
    await flush();
    expect(t.at()).toBe('movies · grid 0');
    expect(t.tiles(0, 1)).toEqual(['newer 0']);
    expect(t.movies.poster(0)).toBeUndefined();
    await t.rest();
    expect(t.movies.poster(0)).toBe('http://img.test/s2/9/0.jpg?newer');
  });

  it('holds no movie once a swap leaves none', async () => {
    const t = await withNewest(3);
    expect(t.tiles(0, 1)).toEqual(['new 0']);
    t.engine.newest = [];
    t.engine.catalog = { s1: [], s2: [] };
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.status.value).toBe('empty');
    expect(t.movies.movie(0)).toBeNull();
  });

  it("keeps a category through a swap by its source and name: not another source's of that name, nor a nameless entry", async () => {
    const engine = new FakeEngine();
    engine.newest = newest(2);
    engine.catalog = { s1: [info(0, 'Drama', [5]), info(1, '', [3])], s2: [info(0, 'Drama', [4])] };
    const t = await setup({ engine });
    expect(t.movies.rail.value.map((e) => `${e.kind}:${e.name}:${e.parts[0]?.src ?? '-'}`)).toEqual(['recent::-', 'all::s1', 'category:Drama:s1', 'category::s1', 'category:Drama:s2']);
    for (const entry of [4, 3]) {
      t.movies.screen.value!.focus(MOVIES_RAIL, entry);
      await t.press('OK');
      expect(t.movies.category.value).toBe(entry);
      t.movies.catalogChanged();
      await flush();
      expect(t.movies.category.value).toBe(entry);
    }
  });

  it('keeps "Recently added", "All movies" or a category through a catalog swap, as the entries move', async () => {
    // No dated movies yet: "All movies" first; its 8th movie focused.
    const t = await setup();
    t.movies.screen.value!.focus(MOVIES_GRID, 7);
    await flush();
    // A refresh brings dates: "Recently added" comes first, "All movies" stays on show where it was.
    t.engine.newest = newest(20);
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.rail.value.map((e) => e.kind)).toEqual(['recent', 'all', 'category', 'category', 'category']);
    expect(t.movies.category.value).toBe(1);
    expect(t.at()).toBe('movies · grid 7');
    expect(t.tiles(7, 8)).toEqual(['s1 0-7']);
    // On "Recently added", its 3rd: a refresh with newer films keeps the place, the new films there.
    t.movies.screen.value!.focus(MOVIES_RAIL, 0);
    await t.press('OK', 'RIGHT', 'RIGHT');
    expect(t.at()).toBe('movies · grid 2');
    expect(t.movies.category.value).toBe(0);
    t.engine.newest = newest(5, 'newer');
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.category.value).toBe(0);
    expect(t.at()).toBe('movies · grid 2');
    expect(t.tiles(0, 6)).toEqual(['newer 0', 'newer 1', 'newer 2', 'newer 3', 'newer 4', '…']);
    // A category on show keeps its name though its entry moves when "Recently added" goes.
    t.movies.screen.value!.focus(MOVIES_RAIL, 3);
    await t.press('OK');
    expect(t.movies.rail.value[t.movies.category.value]!.name).toBe('Drama');
    expect(t.movies.category.value).toBe(3);
    t.engine.newest = [];
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.rail.value[0]!.kind).toBe('all');
    expect(t.movies.category.value).toBe(2);
    expect(t.movies.rail.value[2]!.name).toBe('Drama');
    // "Recently added" gone while on show: the first entry, from its first movie.
    t.engine.newest = newest(4);
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.category.value).toBe(3);
    t.movies.screen.value!.focus(MOVIES_RAIL, 0);
    await t.press('OK', 'RIGHT');
    expect(t.movies.category.value).toBe(0);
    expect(t.at()).toBe('movies · grid 1');
    t.engine.newest = [];
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.rail.value[0]!.kind).toBe('all');
    expect(t.movies.category.value).toBe(0);
    expect(t.at()).toBe('movies · grid 0');
    expect(t.tiles(0, 1)).toEqual(['s1 0-0']);
  });
});

describe('the series screen: the movies screen for series (RELAY step 27a)', () => {
  /** A series engine: every read asks for kind `series`. */
  function seriesEngine(): FakeEngine {
    const engine = new FakeEngine();
    engine.kind = 'series';
    return engine;
  }

  it('is its own screen, and asks every read for series', async () => {
    expect(POSTER_SCREENS).toEqual({ movie: MOVIES_SCREEN, series: SERIES_SCREEN });
    expect([MOVIES_SCREEN, SERIES_SCREEN]).toEqual(['movies', 'series']);
    const engine = seriesEngine();
    engine.newest = [{ added: 9, item: { ...movie('s2', 0, 7), kind: 'series', url: '', name: 'Show new' } }];
    const t = await setup({ engine, kind: 'series' });
    expect(t.movies.kind).toBe('series');
    expect(t.movies.id).toBe(SERIES_SCREEN);
    expect(t.at()).toBe('series · grid 0');
    expect(t.movies.rail.value.map((e) => `${e.kind}:${e.name}:${e.count}`)).toEqual(['recent::1', 'all::744', 'category:Action:40', 'category:Drama:700', 'category:Kids:4']);
    expect(t.engine.recentCalls).toEqual([{ sources: ['s1', 's2'], kind: 'series' }]);
    expect(t.tiles(0, 1)).toEqual(['Show new']);
    await t.press('LEFT', 'DOWN', 'OK');
    expect(t.at()).toBe('series · grid 0');
    expect(t.tiles(0, 2)).toEqual(['s1 0-0', 's1 0-1']);
    expect(engine.kinds).toEqual(['series', 'series', 'series']);
    // A movies screen asks for movies, as it always did.
    const movies = await setup();
    expect(movies.movies.kind).toBe('movie');
    expect(movies.movies.id).toBe(MOVIES_SCREEN);
    expect(movies.engine.kinds).toEqual(['movie', 'movie', 'movie']);
    expect(movies.engine.recentCalls).toEqual([{ sources: ['s1', 's2'], kind: 'movie' }]);
  });

  it('follows its own screen: the view rests and asks its posters after a key', async () => {
    const t = await setup({ engine: seriesEngine(), kind: 'series' });
    await t.rest();
    t.loadAll(0, 18);
    expect(t.withPosters(0, 18)).toEqual(t.range(0, 18));
    await t.press('DOWN', 'DOWN', 'DOWN');
    expect(t.at()).toBe('series · grid 18');
    expect(t.withPosters(18, 24)).toEqual([]);
    await t.rest();
    expect(t.withPosters(18, 24).length).toBeGreaterThan(0);
  });

  it("counts a playlist's entry in episodes: its lines are episodes, not shows", async () => {
    // s1 is a playlist, s2 a panel.
    const t = await setup({ engine: seriesEngine(), kind: 'series' });
    expect(t.movies.rail.value.map((e) => e.name)).toEqual(['', 'Action', 'Drama', 'Kids']);
    expect([0, 1, 2, 3, 4, -1].map((i) => t.movies.episodes(i))).toEqual([false, true, true, false, false, false]);
    // "All series" of playlists alone.
    const engine = seriesEngine();
    engine.profileDoc = { doc: { v: 2, sources: [S1] }, newer: false, migratedFrom: null };
    const alone = await setup({ engine, kind: 'series' });
    expect(alone.movies.rail.value.map((e) => e.kind)).toEqual(['all', 'category', 'category']);
    expect(alone.movies.episodes(0)).toBe(true);
    // "Recently updated" (no parts) and every entry of a panel alone: shows.
    const panel = seriesEngine();
    panel.profileDoc = { doc: { v: 2, sources: [S2] }, newer: false, migratedFrom: null };
    panel.newest = [{ added: 9, item: { ...movie('s2', 0, 7), kind: 'series', url: '' } }];
    const shows = await setup({ engine: panel, kind: 'series' });
    expect(shows.movies.rail.value.map((e) => e.kind)).toEqual(['recent', 'all', 'category']);
    expect([0, 1, 2].map((i) => shows.movies.episodes(i))).toEqual([false, false, false]);
    // A movies screen never counts episodes, even of a playlist.
    const films = await setup();
    expect([0, 1, 2].map((i) => films.movies.episodes(i))).toEqual([false, false, false]);
  });

  it("reads the playlists again on a catalog swap: a source's type decides, as stored now", async () => {
    const engine = seriesEngine();
    const t = await setup({ engine, kind: 'series' });
    expect(t.movies.episodes(1)).toBe(true);
    engine.profileDoc = { doc: { v: 2, sources: [{ ...S2, id: 's1' }, S2] }, newer: false, migratedFrom: null };
    t.movies.catalogChanged();
    await flush();
    expect(t.movies.rail.value[1]!.name).toBe('Action');
    expect(t.movies.episodes(1)).toBe(false);
  });

  it('gives OK on a tile to `select`', async () => {
    const select = vi.fn();
    const t = await setup({ engine: seriesEngine(), kind: 'series', select });
    await t.press('OK');
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ name: 'Movie s1 0-0' }));
  });

  it("opens a playlist's episode (it has a URL) as a movie, and an Xtream show (none) as a show", () => {
    const episode = vi.fn();
    const show = vi.fn();
    const line = movie('s1', 0, 1);
    const panel: CatalogItem = { ...movie('s2', 0, 2), kind: 'series', url: '' };
    selectSeries(line, { episode, show });
    expect(episode).toHaveBeenCalledWith(line);
    expect(show).not.toHaveBeenCalled();
    selectSeries(panel, { episode, show });
    expect(show).toHaveBeenCalledWith(panel);
    expect(episode).toHaveBeenCalledTimes(1);
    // Until a show's details exist (step 27b), OK on a show does nothing.
    expect(() => selectSeries(panel, { episode })).not.toThrow();
    expect(episode).toHaveBeenCalledTimes(1);
  });

  it("puts a playlist episode's trailing season and episode under its name", () => {
    const label = (name: string): string => {
      const l = episodeLabel(name);
      return l.mark === null ? l.title : `${l.title} | ${l.mark}`;
    };
    expect(label('Lablo Test Series S01 E01')).toBe('Lablo Test Series | S01 E01');
    expect(label('مسلسل الاختبار S01 E02')).toBe('مسلسل الاختبار | S01 E02');
    // Other spellings: no space, lower case, separators, one digit, long numbers.
    expect(label('Show S01E01')).toBe('Show | S01 E01');
    expect(label('show s1e2')).toBe('show | S1 E2');
    expect(label('Show - S02.E10')).toBe('Show | S02 E10');
    expect(label('Show: S2_E3 ')).toBe('Show | S2 E3');
    expect(label('Show | S100 E1000')).toBe('Show | S100 E1000');
    // Whole: no mark, a mark not at the end, a mark with nothing before it, a mark inside a word.
    expect(label('Lablo Test Series')).toBe('Lablo Test Series');
    expect(label('Show S01 E01 Pilot')).toBe('Show S01 E01 Pilot');
    expect(label('S01 E01')).toBe('S01 E01');
    expect(label('ShowS01E01')).toBe('ShowS01E01');
    expect(label('Show S01')).toBe('Show S01');
    expect(label('Show E01')).toBe('Show E01');
    expect(label('Show S1234 E1')).toBe('Show S1234 E1');
    expect(label('Show S1 E12345')).toBe('Show S1 E12345');
    expect(label('')).toBe('');
  });
});
