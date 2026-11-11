import type { CatalogItem, ContentKind, DeviceTier } from '@lablo/core';
import type { CategoryInfo, LoadedProfile, SourceRecord } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import { LAYOUT, createNavigator, fits } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { Timers } from '../live/live-state';
import { CHUNK_CACHE, LIVE, LIVE_BODY } from '../live/live-state';
import type { MoviesEngine } from './movies-state';
import { MOVIES, MOVIES_GRID, MOVIES_GRID_WIDTH, MOVIES_RAIL, MOVIES_RETRY, MOVIES_ROWS, MOVIES_SCREEN, createMovies } from './movies-state';
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
  hold = new Set<'profile' | 'chunk'>();
  readonly held: { profile: Held<LoadedProfile | null>[]; chunk: Held<CatalogItem[]>[] } = { profile: [], chunk: [] };
  readonly chunkCalls: string[] = [];
  catalog: Record<string, CategoryInfo[]> = CATEGORIES;
  /** Put before each movie's name: a newer catalog's items differ from an older one's. */
  label = '';

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
    expect(kind).toBe('movie');
    return Promise.resolve(this.catalog[src] ?? []);
  }

  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]> {
    expect(kind).toBe('movie');
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

async function setup(options: { engine?: FakeEngine; tier?: DeviceTier; select?: (item: CatalogItem) => void; open?: boolean } = {}) {
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
