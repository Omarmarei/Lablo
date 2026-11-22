import { effect, signal } from '@preact/signals';
import type { CatalogItem, DeviceTier } from '@lablo/core';
import type { KeyItemsRequest, LastChannel, LoadedProfile, RecentItem, RecentRequest, SourceRecord } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import { LAYOUT, createNavigator, fits } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { Timers } from '../live/live-state';
import { LIVE, LIVE_BODY } from '../live/live-state';
import { CONTINUE_MAX } from '../movies/movies-state';
import { POSTER_TIERS } from '../movies/posters';
import type { HomeEngine, HomeOptions, ShelfId } from './home-state';
import {
  CHANNEL_SHELF_HEIGHT,
  CHANNEL_TILES,
  HOME,
  HOME_BODY,
  HOME_CHANNELS,
  HOME_CONTINUE,
  HOME_MOVIES,
  HOME_RETRY,
  HOME_SCREEN,
  HOME_SERIES,
  HOME_SHELF_MAX,
  HOME_SHELVES,
  HOME_TILES,
  SHELF_HEIGHT,
  SHELF_ORDER,
  createHome,
  mergeByKeys,
  tilesInView,
} from './home-state';

type Kind = 'movie' | 'series';

/** Item `n` of `kind` from source `src` (a show by default: no URL; `episode`: a playlist's, with one). */
function entry(src: string, kind: Kind, n: number, options: { logo?: boolean; label?: string; episode?: boolean } = {}): CatalogItem {
  const { logo = true, label = '', episode = false } = options;
  return {
    key: `x:${src}:${kind}:${n}`,
    src,
    kind,
    name: `${kind === 'movie' ? 'Movie' : 'Show'} ${label}${n}`,
    normName: '',
    group: '',
    url: kind === 'movie' || episode ? `http://panel.test/${kind}/u/p/${n}.mp4` : '',
    logo: logo ? `http://img.test/${src}/${kind}/${n}.jpg` : null,
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

/** Live channel `n` of `src` as the player memory keeps it, played from `category` at row `index`. */
function chan(src: string, n: number, category: LastChannel['category'] = { src, name: 'News' }, index = n): LastChannel {
  return {
    item: { ...entry(src, 'movie', n), key: `x:${src}:live:${n}`, kind: 'live', name: `Live ${src} ${n}`, url: `http://panel.test/live/u/p/${n}.ts`, logo: `http://img.test/${src}/live/${n}.png` },
    number: n,
    category,
    index,
    started: 100 + n,
  };
}

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
const S2: SourceRecord = { id: 's2', type: 'xtream', name: 'Panel', account: { base: 'http://panel.test', username: 'u', password: 'p' }, added: 2 };

interface Held<T> {
  readonly arg: string;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** A data engine that answers at once, or holds the answers of the kinds in `hold`. */
class FakeEngine implements HomeEngine {
  profileDoc: LoadedProfile | null = { doc: { v: 6, sources: [S1, S2] }, newer: false, migratedFrom: null };
  failProfile = false;
  failRecent = false;
  failKeys = false;
  hold = new Set<'profile' | 'recent' | 'keys' | 'live'>();
  readonly held: { profile: Held<LoadedProfile | null>[]; recent: Held<RecentItem[]>[]; keys: Held<CatalogItem[]>[]; live: Held<CatalogItem[]>[] } = { profile: [], recent: [], keys: [], live: [] };
  /** What `recent` gives for each kind (default: none). */
  newest: Record<Kind, RecentItem[]> = { movie: [], series: [] };
  /** The catalog's items by key, as `itemsByKey` finds them (default: none). */
  known: Record<string, CatalogItem> = {};
  readonly recentCalls: RecentRequest[] = [];
  readonly keyCalls: KeyItemsRequest[] = [];
  /** "Recent channels"' asks (step 38b). */
  readonly liveCalls: KeyItemsRequest[] = [];

  profile(): Promise<LoadedProfile | null> {
    if (this.hold.has('profile')) return new Promise((resolve, reject) => this.held.profile.push({ arg: '', resolve, reject }));
    return this.failProfile ? Promise.reject(new Error('no IndexedDB')) : Promise.resolve(this.profileDoc);
  }

  recent(req: RecentRequest): Promise<RecentItem[]> {
    this.recentCalls.push(req);
    const found = (this.newest[req.kind as Kind] ?? []).slice(0, req.limit ?? 100);
    if (this.hold.has('recent')) return new Promise((resolve, reject) => this.held.recent.push({ arg: req.kind, resolve, reject }));
    return this.failRecent ? Promise.reject(new Error('read failed')) : Promise.resolve(found);
  }

  /** Live keys the query worker keeps back ("Recent channels", step 38b: locked, or gone); it gives every other live key asked. */
  withheld = new Set<string>();

  /** As the query worker: the first `limit` keys known, of the kind and the sources asked, in the order asked. */
  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]> {
    if (req.kind === 'live') {
      this.liveCalls.push(req);
      const given: CatalogItem[] = [];
      for (const key of req.keys) if (!this.withheld.has(key) && given.length < req.limit) given.push({ key } as CatalogItem);
      if (this.hold.has('live')) return new Promise((resolve, reject) => this.held.live.push({ arg: 'live', resolve, reject }));
      return this.failKeys ? Promise.reject(new Error('read failed')) : Promise.resolve(given);
    }
    this.keyCalls.push(req);
    const found: CatalogItem[] = [];
    for (const key of req.keys) {
      const item = this.known[key];
      if (item !== undefined && item.kind === req.kind && req.sources.indexOf(item.src) !== -1 && found.length < req.limit) found.push(item);
    }
    if (this.hold.has('keys')) return new Promise((resolve, reject) => this.held.keys.push({ arg: req.kind, resolve, reject }));
    return this.failKeys ? Promise.reject(new Error('read failed')) : Promise.resolve(found);
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

/** The places as `unfinished` gives them; `set` changes them as a save does (the version bumps). */
function places(keys: string[]) {
  const version = signal(0);
  let list = keys;
  const shares: Record<string, number> = {};
  return {
    progress: { version, share: (k: string) => shares[k], unfinished: () => list.slice() },
    shares,
    set(next: string[]): void {
      list = next;
      version.value += 1;
    },
  };
}

/** `n` dated items of `kind` from s2, newest first. */
function dated(kind: Kind, n: number, label = ''): RecentItem[] {
  const out: RecentItem[] = [];
  for (let i = 0; i < n; i += 1) out.push({ added: 1000 - i, item: entry('s2', kind, i, { label }) });
  return out;
}

/** Movies 0–2 and shows 0–2 left part way (s1 and s2), all known to the catalog. */
const LEFT = [entry('s1', 'movie', 50), entry('s2', 'series', 60), entry('s2', 'movie', 51), entry('s1', 'series', 61, { episode: true }), entry('s2', 'series', 62)];
const keyOf = (i: number): string => LEFT[i]!.key;

async function setup(
  options: {
    engine?: FakeEngine;
    tier?: DeviceTier;
    select?: (item: CatalogItem) => void;
    open?: boolean;
    progress?: HomeOptions['progress'] | null;
    left?: string[];
    /** The channels played last (step 28b2); absent: no memory. */
    channels?: LastChannel[];
    play?: (channel: LastChannel) => void;
  } = {},
) {
  const engine = options.engine ?? new FakeEngine();
  if (options.engine === undefined) {
    engine.newest = { movie: dated('movie', 3), series: dated('series', 2) };
    for (const item of LEFT) engine.known[item.key] = item;
  }
  const clock = manualTimers();
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 6 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  nav.top.focus('header', 3);
  const kept = places(options.left ?? [keyOf(0), keyOf(1), keyOf(2)]);
  const select = options.select ?? vi.fn();
  const play = options.play ?? vi.fn();
  const progress = options.progress === null ? undefined : (options.progress ?? kept.progress);
  // The player memory's channels played last: a new list after each channel played, as `tuned` does.
  let recent: readonly LastChannel[] = options.channels ?? [];
  const memory = { recent: () => recent };
  const home = createHome({
    nav,
    engine,
    timers: clock.timers,
    select,
    play,
    ...(options.channels === undefined ? {} : { channels: memory }),
    ...(options.tier === undefined ? {} : { tier: () => options.tier! }),
    ...(progress === undefined ? {} : { progress }),
  });
  if (options.open !== false) {
    home.open();
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
  /** The names on a shelf, `…` for none, up to `n` tiles. */
  const shelf = (id: ShelfId, n = 25): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n && home.item(id, i) !== null; i += 1) out.push(home.item(id, i)!.name);
    return out;
  };
  /** The tiles of `id` in `[from, to)` that draw a poster. */
  const withPosters = (id: ShelfId, from: number, to: number): number[] => {
    const out: number[] = [];
    for (let i = from; i < to; i += 1) if (home.poster(id, i) !== undefined) out.push(i);
    return out;
  };
  /** The view rests: its posters are asked. */
  const rest = async (): Promise<void> => {
    clock.advance(POSTER_TIERS[options.tier ?? 'full'].restMs);
    await flush();
  };
  /** The details over Home, a save while they show (the places change), then closed onto it. */
  const away = async (next: string[] | null): Promise<void> => {
    nav.push({ id: 'movie', zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 2 }] });
    await flush();
    if (next !== null) kept.set(next);
    await flush();
    nav.pop();
    await flush();
  };
  /** The player over Home playing `channel` (the memory puts it first), then Back onto Home. */
  const played = async (channel: LastChannel): Promise<void> => {
    nav.push({ id: 'player', zones: [{ kind: 'list', id: 'seek', axis: 'horizontal', count: 1 }] });
    await flush();
    const next = [channel];
    for (const c of recent) if (c.item.key !== channel.item.key) next.push(c);
    recent = next;
    nav.pop();
    await flush();
  };
  /** The memory's list changes without a play (for the guards). */
  const setRecent = (next: LastChannel[]): void => {
    recent = next;
  };
  return { engine, clock, nav, home, kept, select, play, at, press, shelf, withPosters, rest, away, played, setRecent };
}

describe('Home (RELAY step 28b1): the layout', () => {
  it('fits two shelves of 8 posters under the header in the safe area', () => {
    expect(HOME_BODY).toBe(LIVE_BODY);
    expect(SHELF_HEIGHT).toBe(HOME.titleHeight + HOME.titleGap + LAYOUT.posterHeight);
    expect(SHELF_HEIGHT).toBe(332);
    expect(HOME_SHELVES).toBe(2);
    expect(HOME_SHELVES).toBe(fits(HOME_BODY, SHELF_HEIGHT, HOME.shelfGap));
    expect(HOME_BODY - (2 * SHELF_HEIGHT + HOME.shelfGap)).toBeGreaterThanOrEqual(0);
    expect(HOME_TILES).toBe(8);
    expect(8 * LAYOUT.posterWidth + 7 * HOME.tileGap).toBeLessThanOrEqual(LIVE.width);
    // home.css uses the same numbers.
    expect(HOME).toEqual({ headerHeight: 56, headerGap: 24, titleHeight: 44, titleGap: 12, tileGap: 24, shelfGap: 32 });
    expect(SHELF_ORDER).toEqual([HOME_CONTINUE, HOME_CHANNELS, HOME_MOVIES, HOME_SERIES]);
    expect(HOME_SHELF_MAX).toBe(20);
    expect(CONTINUE_MAX).toBe(HOME_SHELF_MAX);
  });

  it('fits a shelf of 6 channel tiles with any other shelf, and never three shelves (step 28b2)', () => {
    expect(CHANNEL_SHELF_HEIGHT).toBe(HOME.titleHeight + HOME.titleGap + LAYOUT.tileHeight);
    expect(CHANNEL_SHELF_HEIGHT).toBe(204);
    expect(CHANNEL_TILES).toBe(6);
    expect(CHANNEL_TILES).toBe(fits(LIVE.width, LAYOUT.tileWidth, HOME.tileGap));
    expect(6 * LAYOUT.tileWidth + 5 * HOME.tileGap).toBeLessThanOrEqual(LIVE.width);
    expect(SHELF_ORDER.map(tilesInView)).toEqual([8, 6, 8, 8]);
    // The poster shelves are the tallest: two of anything fit, three of the shortest don't.
    expect(CHANNEL_SHELF_HEIGHT).toBeLessThan(SHELF_HEIGHT);
    expect(HOME_BODY - (CHANNEL_SHELF_HEIGHT + 2 * SHELF_HEIGHT + 2 * HOME.shelfGap)).toBeLessThan(0);
  });
});

describe('mergeByKeys', () => {
  const a = [entry('s1', 'movie', 1), entry('s1', 'movie', 3)];
  const b = [entry('s1', 'series', 2), entry('s1', 'series', 4)];
  const keys = ['x:s1:movie:1', 'x:s1:series:2', 'x:s9:movie:9', 'x:s1:movie:3', 'x:s1:series:4'];

  it("merges two lists back into the keys' order, skipping the keys neither found", () => {
    expect(mergeByKeys(keys, a, b, 20).map((i) => i.key)).toEqual(['x:s1:movie:1', 'x:s1:series:2', 'x:s1:movie:3', 'x:s1:series:4']);
    expect(mergeByKeys(keys, b, a, 20).map((i) => i.key)).toEqual(['x:s1:movie:1', 'x:s1:series:2', 'x:s1:movie:3', 'x:s1:series:4']);
  });

  it('stops at `max`, and with either list empty', () => {
    expect(mergeByKeys(keys, a, b, 3).map((i) => i.key)).toEqual(['x:s1:movie:1', 'x:s1:series:2', 'x:s1:movie:3']);
    expect(mergeByKeys(keys, a, b, 0)).toEqual([]);
    expect(mergeByKeys(keys, [], b, 20).map((i) => i.key)).toEqual(['x:s1:series:2', 'x:s1:series:4']);
    expect(mergeByKeys(keys, a, [], 20).map((i) => i.key)).toEqual(['x:s1:movie:1', 'x:s1:movie:3']);
    expect(mergeByKeys([], a, b, 20)).toEqual([]);
  });
});

describe('Home (RELAY step 28b1): the shelves', () => {
  it('opens on "Continue watching", then the newest movies and the series updated last, read once each', async () => {
    const t = await setup();
    expect(t.home.screen.value).not.toBeNull();
    expect(t.home.status.value).toBe('ready');
    expect(t.home.shelves.value).toEqual([HOME_CONTINUE, HOME_MOVIES, HOME_SERIES]);
    expect(t.at()).toBe(`${HOME_SCREEN} · continue 0`);
    expect(t.shelf(HOME_CONTINUE)).toEqual(['Movie 50', 'Show 60', 'Movie 51']);
    expect(t.shelf(HOME_MOVIES)).toEqual(['Movie 0', 'Movie 1', 'Movie 2']);
    expect(t.shelf(HOME_SERIES)).toEqual(['Show 0', 'Show 1']);
    // Each shelf's zone holds its tiles, `HOME_TILES` in view.
    const screen = t.home.screen.value!;
    expect(screen.zone(HOME_CONTINUE)).toMatchObject({ kind: 'list', axis: 'horizontal', count: 3, visible: HOME_TILES });
    expect(screen.zone(HOME_MOVIES)).toMatchObject({ count: 3 });
    expect(screen.zone(HOME_SERIES)).toMatchObject({ count: 2 });
    expect(screen.zone(HOME_RETRY)).toMatchObject({ count: 0 });
    // One `itemsByKey` per kind with every key left part way, from the profile's sources; one `recent` per kind.
    const keys = [keyOf(0), keyOf(1), keyOf(2)];
    expect(t.engine.keyCalls).toEqual([
      { keys, kind: 'movie', sources: ['s1', 's2'], limit: CONTINUE_MAX },
      { keys, kind: 'series', sources: ['s1', 's2'], limit: CONTINUE_MAX },
    ]);
    expect(t.engine.recentCalls).toEqual([
      { sources: ['s1', 's2'], kind: 'movie', limit: HOME_SHELF_MAX },
      { sources: ['s1', 's2'], kind: 'series', limit: HOME_SHELF_MAX },
    ]);
    // The rest's wait, then the posters downloading.
    expect(t.home.pending.value).toBe(1);
    await t.rest();
    expect(t.home.pending.value).toBe(6);
  });

  it('shows "loading" until every read is in', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['recent']);
    const t = await setup({ engine });
    expect(t.home.status.value).toBe('loading');
    expect(t.home.shelves.value).toEqual([]);
    expect(t.home.pending.value).toBe(1);
    // Keys while the profile is still out: nothing else is read (no "Continue watching" alone), no poster asked.
    const slow = new FakeEngine();
    slow.hold = new Set(['profile']);
    const u = await setup({ engine: slow });
    await u.press('RIGHT', 'DOWN', 'LEFT');
    await u.rest();
    expect(slow.keyCalls).toEqual([]);
    expect(u.home.status.value).toBe('loading');
    expect(u.home.pending.value).toBe(1);
    // Back while it loads closes it.
    await t.press('BACK');
    expect(t.home.screen.value).toBeNull();
    expect(t.at()).toBe('live · header 3');
  });

  it('merges the movies and the shows left part way into the places\' order, at most 20', async () => {
    const engine = new FakeEngine();
    const keys: string[] = [];
    for (let n = 0; n < 30; n += 1) {
      const item = entry(n % 3 === 0 ? 's1' : 's2', n % 2 === 0 ? 'movie' : 'series', n);
      engine.known[item.key] = item;
      keys.push(item.key);
    }
    // A key no catalog lists (a removed source's, or a panel show's episode) drops out.
    keys.splice(1, 0, 'x:s9:movie:99', 'x:s1:episode:7');
    const t = await setup({ engine, left: keys });
    const want: string[] = [];
    for (let n = 0; n < 20; n += 1) want.push(`${n % 2 === 0 ? 'Movie' : 'Show'} ${n}`);
    expect(t.shelf(HOME_CONTINUE)).toEqual(want);
    expect(t.home.screen.value!.zone(HOME_CONTINUE)).toMatchObject({ count: 20 });
  });

  it('keeps 20 tiles a shelf at most', async () => {
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 30), series: dated('series', 25) };
    const t = await setup({ engine, left: [] });
    expect(t.shelf(HOME_MOVIES)).toHaveLength(20);
    expect(t.shelf(HOME_SERIES)).toHaveLength(20);
  });

  it('hides an empty shelf: nothing left part way opens on the newest movies', async () => {
    const t = await setup({ left: [] });
    expect(t.home.shelves.value).toEqual([HOME_MOVIES, HOME_SERIES]);
    expect(t.at()).toBe('home · movies 0');
    // Nothing to ask with no places.
    expect(t.engine.keyCalls).toEqual([]);
    // UP from the first shelf shown goes nowhere (the empty one is skipped).
    await t.press('UP');
    expect(t.at()).toBe('home · movies 0');
    const shows = new FakeEngine();
    shows.newest = { movie: [], series: dated('series', 2) };
    const only = await setup({ engine: shows, left: ['x:s1:movie:404'] });
    expect(only.home.shelves.value).toEqual([HOME_SERIES]);
    expect(only.at()).toBe('home · series 0');
    expect(only.home.top.value).toBe(0);
    // Asked, found nothing.
    expect(only.engine.keyCalls).toHaveLength(2);
  });

  it('says there is nothing yet when every shelf is empty; Back closes it', async () => {
    const engine = new FakeEngine();
    const t = await setup({ engine, left: [] });
    expect(t.home.status.value).toBe('empty');
    expect(t.home.shelves.value).toEqual([]);
    expect(t.at()).toBe('home · continue -1');
    await t.press('OK', 'RIGHT', 'DOWN');
    expect(t.select).not.toHaveBeenCalled();
    await t.press('BACK');
    expect(t.home.screen.value).toBeNull();
    expect(t.at()).toBe('live · header 3');
  });

  it('reads the shelves without the places: no "Continue watching", no bars', async () => {
    const t = await setup({ progress: null });
    expect(t.home.shelves.value).toEqual([HOME_MOVIES, HOME_SERIES]);
    expect(t.engine.keyCalls).toEqual([]);
    expect(t.home.progress(HOME_MOVIES, 0)).toBeUndefined();
  });

  it('reads the profile with no sources as no shelves', async () => {
    const engine = new FakeEngine();
    engine.profileDoc = null;
    const t = await setup({ engine, left: [keyOf(0)] });
    expect(t.home.status.value).toBe('empty');
    expect(t.engine.recentCalls[0]!.sources).toEqual([]);
  });

  it('says the read failed and tries again on OK', async () => {
    const engine = new FakeEngine();
    engine.failRecent = true;
    engine.newest = { movie: dated('movie', 2), series: [] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await setup({ engine, left: [] });
    expect(t.home.status.value).toBe('failed');
    expect(t.home.shelves.value).toEqual([]);
    expect(t.at()).toBe('home · retry 0');
    expect(t.home.screen.value!.zone(HOME_MOVIES)).toMatchObject({ count: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    await t.rest();
    expect(t.home.pending.value).toBe(0);
    engine.failRecent = false;
    await t.press('OK');
    expect(t.home.status.value).toBe('ready');
    expect(t.at()).toBe('home · movies 0');
    expect(t.home.screen.value!.zone(HOME_RETRY)).toMatchObject({ count: 0 });
    // A failed "Continue watching" fails the screen too.
    engine.failKeys = true;
    const keys = await setup({ engine, left: [keyOf(0)] });
    expect(keys.home.status.value).toBe('failed');
    // So does the profile.
    const profile = new FakeEngine();
    profile.failProfile = true;
    const none = await setup({ engine: profile });
    expect(none.home.status.value).toBe('failed');
    warn.mockRestore();
  });

  it("draws a tile's bar again when a place is saved", async () => {
    const t = await setup();
    let runs = 0;
    const stop = effect(() => {
      t.home.progress(HOME_CONTINUE, 0);
      runs += 1;
    });
    expect(runs).toBe(1);
    t.kept.set([keyOf(0), keyOf(1), keyOf(2)]);
    expect(runs).toBe(2);
    stop();
  });

  it('loads the posters by the tier of each opening', async () => {
    let tier: DeviceTier = 'full';
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 8), series: [] };
    const nav = createNavigator({ root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 6 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined, now: () => 0 });
    const clock = manualTimers();
    const home = createHome({ nav, engine, timers: clock.timers, tier: () => tier });
    home.open();
    await flush();
    clock.advance(POSTER_TIERS.full.restMs);
    expect(home.pending.value).toBe(6);
    nav.handle('BACK');
    tier = 'low';
    home.open();
    await flush();
    clock.advance(POSTER_TIERS.low.restMs);
    expect(home.pending.value).toBe(2);
  });

  it('draws the bars of what was left part way, on every shelf', async () => {
    const t = await setup();
    t.kept.shares[keyOf(1)] = 0.4;
    t.kept.shares['x:s2:movie:1'] = 0.7;
    expect(t.home.progress(HOME_CONTINUE, 1)).toBe(0.4);
    expect(t.home.progress(HOME_CONTINUE, 0)).toBeUndefined();
    expect(t.home.progress(HOME_MOVIES, 1)).toBe(0.7);
    expect(t.home.progress(HOME_MOVIES, 7)).toBeUndefined();
  });
});

describe('Home (RELAY step 28b1): keys', () => {
  it('moves along a shelf and between shelves, each keeping its place; UP from the first and DOWN from the last go nowhere', async () => {
    const t = await setup();
    await t.press('UP');
    expect(t.at()).toBe('home · continue 0');
    await t.press('RIGHT', 'RIGHT');
    expect(t.at()).toBe('home · continue 2');
    await t.press('RIGHT');
    expect(t.at()).toBe('home · continue 2');
    await t.press('DOWN');
    expect(t.at()).toBe('home · movies 0');
    await t.press('RIGHT', 'DOWN', 'RIGHT');
    expect(t.at()).toBe('home · series 1');
    await t.press('DOWN');
    expect(t.at()).toBe('home · series 1');
    await t.press('UP');
    expect(t.at()).toBe('home · movies 1');
    await t.press('UP');
    expect(t.at()).toBe('home · continue 2');
    await t.press('LEFT');
    expect(t.at()).toBe('home · continue 1');
  });

  it('keeps the focused shelf in view, moving the shelves as little as it can', async () => {
    const t = await setup();
    expect(t.home.top.value).toBe(0);
    await t.press('DOWN');
    expect(t.home.top.value).toBe(0);
    await t.press('DOWN');
    expect(t.at()).toBe('home · series 0');
    expect(t.home.top.value).toBe(1);
    await t.press('UP');
    expect(t.home.top.value).toBe(1);
    await t.press('UP');
    expect(t.home.top.value).toBe(0);
    // Down to the series and up one: the series gone on a swap, the shelves come down (no gap under the last).
    await t.press('DOWN', 'DOWN', 'UP');
    expect(t.at()).toBe('home · movies 0');
    expect(t.home.top.value).toBe(1);
    t.engine.newest = { movie: dated('movie', 3), series: [] };
    t.home.catalogChanged();
    await flush();
    expect(t.home.shelves.value).toEqual([HOME_CONTINUE, HOME_MOVIES]);
    expect(t.at()).toBe('home · movies 0');
    expect(t.home.top.value).toBe(0);
  });

  it('opens a tile on OK: `select` with its item, whatever its kind; Back from it returns to the tile', async () => {
    const t = await setup();
    await t.press('RIGHT', 'OK');
    expect(t.select).toHaveBeenLastCalledWith(LEFT[1]);
    await t.press('DOWN', 'OK');
    expect(t.select).toHaveBeenLastCalledWith(t.home.item(HOME_MOVIES, 0));
    expect(t.home.item(HOME_MOVIES, 0)!.kind).toBe('movie');
    await t.press('DOWN', 'OK');
    expect(t.select).toHaveBeenLastCalledWith(t.home.item(HOME_SERIES, 0));
    expect(t.select).toHaveBeenCalledTimes(3);
    await t.away(null);
    expect(t.at()).toBe('home · series 0');
  });

  it('closes on Back, from any shelf, onto the header; nothing is held then', async () => {
    const t = await setup({ channels: [chan('s1', 1)] });
    await t.press('DOWN', 'DOWN', 'RIGHT', 'BACK');
    expect(t.home.screen.value).toBeNull();
    expect(t.at()).toBe('live · header 3');
    expect(t.home.item(HOME_MOVIES, 0)).toBeNull();
    expect(t.home.item(HOME_CHANNELS, 0)).toBeNull();
    expect(t.home.shelves.value).toEqual([]);
    expect(t.home.pending.value).toBe(0);
    // It opens again on the first shelf's first tile, read again.
    t.home.open();
    await flush();
    expect(t.at()).toBe('home · continue 0');
    expect(t.engine.recentCalls).toHaveLength(4);
    // Opening an open Home does nothing.
    t.home.open();
    await flush();
    expect(t.engine.recentCalls).toHaveLength(4);
    expect(t.nav.snapshot().depth).toBe(2);
  });
});

describe('Home (RELAY step 28b1): read again', () => {
  it('reads "Continue watching" again when back on top after a save: the focus follows its item', async () => {
    const t = await setup();
    await t.press('RIGHT', 'RIGHT', 'OK');
    expect(t.select).toHaveBeenLastCalledWith(LEFT[2]);
    // Played: it is the newest now.
    await t.away([keyOf(2), keyOf(0), keyOf(1)]);
    expect(t.shelf(HOME_CONTINUE)).toEqual(['Movie 51', 'Movie 50', 'Show 60']);
    expect(t.at()).toBe('home · continue 0');
    // The other shelves are not read again.
    expect(t.engine.recentCalls).toHaveLength(2);
    expect(t.engine.keyCalls).toHaveLength(4);
    // Back on top with nothing saved: nothing is read.
    await t.away(null);
    expect(t.engine.keyCalls).toHaveLength(4);
  });

  it('keeps the place of an item gone, clamped; with the shelf gone, the first shelf\'s first tile', async () => {
    const t = await setup();
    await t.press('RIGHT', 'RIGHT');
    // Watched to its end: gone.
    await t.away([keyOf(0), keyOf(1)]);
    expect(t.shelf(HOME_CONTINUE)).toEqual(['Movie 50', 'Show 60']);
    expect(t.at()).toBe('home · continue 1');
    await t.away([]);
    expect(t.home.shelves.value).toEqual([HOME_MOVIES, HOME_SERIES]);
    expect(t.at()).toBe('home · movies 0');
    expect(t.home.top.value).toBe(0);
  });

  it('adds the shelf when something is left part way from another shelf: the focus stays on its tile, in view', async () => {
    const t = await setup({ left: [] });
    await t.press('DOWN', 'RIGHT');
    expect(t.at()).toBe('home · series 1');
    expect(t.home.top.value).toBe(0);
    // Its key not in the catalogs (yet): still no shelf.
    await t.away(['x:s2:series:1']);
    expect(t.home.shelves.value).toEqual([HOME_MOVIES, HOME_SERIES]);
    expect(t.engine.keyCalls).toHaveLength(2);
    t.engine.known['x:s2:series:1'] = entry('s2', 'series', 1);
    // (Known after the read: read again on the next save.)
    await t.away(['x:s2:series:1', 'x:s2:movie:404']);
    expect(t.home.shelves.value).toEqual([HOME_CONTINUE, HOME_MOVIES, HOME_SERIES]);
    expect(t.shelf(HOME_CONTINUE)).toEqual(['Show 1']);
    expect(t.at()).toBe('home · series 1');
    expect(t.home.top.value).toBe(1);
  });

  it('reads every shelf again on a catalog swap, the focus on its item', async () => {
    const t = await setup();
    await t.press('DOWN', 'RIGHT', 'RIGHT');
    expect(t.at()).toBe('home · movies 2');
    // A newer movie came first.
    t.engine.newest = { movie: [{ added: 2000, item: entry('s2', 'movie', 9) }].concat(dated('movie', 3)), series: dated('series', 2) };
    t.home.catalogChanged();
    expect(t.home.status.value).toBe('ready');
    await flush();
    expect(t.shelf(HOME_MOVIES)).toEqual(['Movie 9', 'Movie 0', 'Movie 1', 'Movie 2']);
    expect(t.at()).toBe('home · movies 3');
    expect(t.engine.recentCalls).toHaveLength(4);
    expect(t.engine.keyCalls).toHaveLength(4);
    // Its item gone: the same place (clamped).
    t.engine.newest = { movie: dated('movie', 2, 'new '), series: dated('series', 2) };
    t.home.catalogChanged();
    await flush();
    expect(t.shelf(HOME_MOVIES)).toEqual(['Movie new 0', 'Movie new 1']);
    expect(t.at()).toBe('home · movies 1');
    // Its shelf gone: the first shelf's first tile.
    t.engine.newest = { movie: [], series: dated('series', 2) };
    t.home.catalogChanged();
    await flush();
    expect(t.home.shelves.value).toEqual([HOME_CONTINUE, HOME_SERIES]);
    expect(t.at()).toBe('home · continue 0');
  });

  it('reads again from the loading screen on a swap while it loads or after a failure, and not at all once closed', async () => {
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 2), series: [] };
    engine.hold = new Set(['recent']);
    const t = await setup({ engine, left: [] });
    t.home.catalogChanged();
    expect(t.home.status.value).toBe('loading');
    // The first load's answers are dropped; the swap's are taken.
    for (const held of engine.held.recent.splice(0, 2)) held.resolve([]);
    await flush();
    expect(t.home.status.value).toBe('loading');
    for (const held of engine.held.recent.splice(0)) held.resolve(engine.newest[held.arg as Kind]);
    await flush();
    expect(t.home.status.value).toBe('ready');
    expect(t.at()).toBe('home · movies 0');
    // A failure, then a swap: read again.
    engine.hold = new Set();
    engine.failRecent = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.home.catalogChanged();
    await flush();
    expect(t.home.status.value).toBe('failed');
    // Nothing of the shelves before is held: "Try again" alone.
    expect(t.home.shelves.value).toEqual([]);
    expect(t.home.item(HOME_MOVIES, 0)).toBeNull();
    expect(t.home.screen.value!.zone(HOME_MOVIES)).toMatchObject({ count: 0 });
    expect(t.at()).toBe('home · retry 0');
    engine.failRecent = false;
    t.home.catalogChanged();
    await flush();
    expect(t.home.status.value).toBe('ready');
    warn.mockRestore();
    // Empty, then a swap brings movies: from the loading screen, on the first.
    engine.newest = { movie: [], series: [] };
    t.home.catalogChanged();
    await flush();
    expect(t.home.status.value).toBe('empty');
    engine.newest = { movie: dated('movie', 1), series: [] };
    engine.hold = new Set(['recent']);
    t.home.catalogChanged();
    expect(t.home.status.value).toBe('loading');
    await flush();
    for (const held of engine.held.recent.splice(0)) held.resolve(engine.newest[held.arg as Kind]);
    await flush();
    expect(t.at()).toBe('home · movies 0');
    engine.hold = new Set();
    // Closed: nothing is read.
    await t.press('BACK');
    const calls = engine.recentCalls.length;
    t.home.catalogChanged();
    await flush();
    expect(engine.recentCalls).toHaveLength(calls);
  });

  it('drops an answer for a closed screen, a disposed one, or a read a swap overtook', async () => {
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 2), series: [] };
    engine.hold = new Set(['profile']);
    const t = await setup({ engine, left: [] });
    await t.press('BACK');
    engine.held.profile[0]!.resolve(engine.profileDoc);
    await flush();
    expect(t.home.screen.value).toBeNull();
    expect(t.home.item(HOME_MOVIES, 0)).toBeNull();
    // Open again, then disposed while it reads.
    t.home.open();
    t.home.dispose();
    engine.held.profile[1]!.resolve(engine.profileDoc);
    await flush();
    expect(t.home.item(HOME_MOVIES, 0)).toBeNull();
    expect(t.home.status.value).toBe('loading');
    // A failure after a close: dropped too.
    const failing = new FakeEngine();
    failing.hold = new Set(['profile']);
    const f = await setup({ engine: failing });
    await f.press('BACK');
    failing.held.profile[0]!.reject(new Error('gone'));
    await flush();
    expect(f.home.status.value).toBe('loading');
    // A "Continue watching" read that a swap overtook.
    const keys = new FakeEngine();
    keys.newest = { movie: dated('movie', 2), series: [] };
    for (const item of LEFT) keys.known[item.key] = item;
    const k = await setup({ engine: keys });
    keys.hold = new Set(['keys']);
    await k.away([keyOf(1)]);
    expect(keys.held.keys).toHaveLength(2);
    keys.hold = new Set();
    k.home.catalogChanged();
    await flush();
    expect(k.shelf(HOME_CONTINUE)).toEqual(['Show 60']);
    for (const held of keys.held.keys.splice(0)) held.resolve([]);
    await flush();
    expect(k.shelf(HOME_CONTINUE)).toEqual(['Show 60']);
  });

  it('drops a failed read that a swap overtook, or that came after a dispose', async () => {
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 2), series: [] };
    engine.hold = new Set(['profile']);
    const t = await setup({ engine, left: [] });
    t.home.catalogChanged();
    engine.held.profile[0]!.reject(new Error('old'));
    await flush();
    expect(t.home.status.value).toBe('loading');
    engine.held.profile[1]!.resolve(engine.profileDoc);
    await flush();
    expect(t.home.status.value).toBe('ready');
    const u = await setup({ engine, left: [] });
    u.home.dispose();
    engine.held.profile[2]!.reject(new Error('late'));
    await flush();
    expect(u.home.status.value).toBe('loading');
    expect(u.home.screen.value!.zone(HOME_RETRY)).toMatchObject({ count: 0 });
  });

  it('takes the newest of two "Continue watching" reads', async () => {
    const t = await setup();
    t.engine.hold = new Set(['keys']);
    await t.away([keyOf(1)]);
    await t.away([keyOf(2)]);
    expect(t.engine.held.keys).toHaveLength(4);
    const older = t.engine.held.keys.splice(0, 2);
    for (const held of t.engine.held.keys.splice(0)) held.resolve(held.arg === 'movie' ? [LEFT[2]!] : []);
    await flush();
    expect(t.shelf(HOME_CONTINUE)).toEqual(['Movie 51']);
    for (const held of older) held.resolve(held.arg === 'movie' ? [] : [LEFT[1]!]);
    await flush();
    expect(t.shelf(HOME_CONTINUE)).toEqual(['Movie 51']);
  });

  it('reads nothing on a swap once disposed', async () => {
    const t = await setup();
    t.home.dispose();
    t.home.catalogChanged();
    await flush();
    expect(t.engine.recentCalls).toHaveLength(2);
    expect(t.home.pending.value).toBe(0);
  });

  it("drops a refresh's answer once disposed", async () => {
    const t = await setup();
    t.engine.hold = new Set(['keys']);
    await t.away([keyOf(1)]);
    t.home.dispose();
    for (const held of t.engine.held.keys.splice(0)) held.resolve([LEFT[1]!]);
    await flush();
    expect(t.home.item(HOME_CONTINUE, 0)).toBeNull();
    expect(t.home.shelves.value).toEqual([HOME_CONTINUE, HOME_MOVIES, HOME_SERIES]);
  });

  it("drops a refresh's answer once closed, and logs a refresh that failed", async () => {
    const t = await setup();
    t.engine.hold = new Set(['keys']);
    await t.away([keyOf(1)]);
    await t.press('BACK');
    for (const held of t.engine.held.keys.splice(0)) held.resolve([LEFT[1]!]);
    await flush();
    expect(t.home.item(HOME_CONTINUE, 0)).toBeNull();
    const u = await setup();
    u.engine.failKeys = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await u.away([keyOf(1)]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(u.shelf(HOME_CONTINUE)).toEqual(['Movie 50', 'Show 60', 'Movie 51']);
    warn.mockRestore();
  });
});

describe('Home (RELAY step 28b2): recent channels', () => {
  it('lists the channels played last from the stored sources after "Continue watching", newest first', async () => {
    const t = await setup({ channels: [chan('s2', 1), chan('s3', 2), chan('s1', 3)] });
    expect(t.home.shelves.value).toEqual([HOME_CONTINUE, HOME_CHANNELS, HOME_MOVIES, HOME_SERIES]);
    // s3 isn't stored (a removed source): its channel is left out.
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s2 1', 'Live s1 3']);
    expect(t.home.item(HOME_CHANNELS, 0)).toEqual(chan('s2', 1).item);
    expect(t.home.item(HOME_CHANNELS, 2)).toBeNull();
    expect(t.at()).toBe('home · continue 0');
    await t.press('DOWN');
    expect(t.at()).toBe('home · channels 0');
    await t.press('DOWN');
    expect(t.at()).toBe('home · movies 0');
    await t.press('UP', 'UP');
    expect(t.at()).toBe('home · continue 0');
  });

  it('lists 20 channels at most, counting only the stored sources\' ones', async () => {
    const many = [chan('s3', 90), chan('s3', 91), chan('s3', 92)];
    for (let n = 0; n < 25; n += 1) many.push(chan('s1', n));
    const t = await setup({ channels: many });
    const names = t.shelf(HOME_CHANNELS);
    expect(names).toHaveLength(HOME_SHELF_MAX);
    expect(names[0]).toBe('Live s1 0');
    expect(names[19]).toBe('Live s1 19');
  });

  it("leaves out the channels the query worker keeps back (step 38b: locked, or gone), asking once for the stored sources' keys", async () => {
    const engine = new FakeEngine();
    engine.withheld.add('x:s1:live:2');
    const t = await setup({ engine, channels: [chan('s1', 1), chan('s3', 9), chan('s1', 2), chan('s2', 3)] });
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 1', 'Live s2 3']);
    expect(engine.liveCalls).toEqual([{ keys: ['x:s1:live:1', 'x:s1:live:2', 'x:s2:live:3'], kind: 'live', sources: ['s1', 's2'], limit: 3 }]);
    // Every one kept back: no shelf. None from a stored source: nothing asked.
    const all = new FakeEngine();
    all.withheld.add('x:s1:live:1');
    expect((await setup({ engine: all, channels: [chan('s1', 1)] })).home.shelves.value).not.toContain(HOME_CHANNELS);
    const none = new FakeEngine();
    await setup({ engine: none, channels: [chan('s3', 1)] });
    expect(none.liveCalls).toEqual([]);
  });

  it('fills its 20 tiles past the channels kept back (step 38b)', async () => {
    const engine = new FakeEngine();
    engine.withheld.add('x:s1:live:0');
    engine.withheld.add('x:s1:live:5');
    const many: LastChannel[] = [];
    for (let n = 0; n < 25; n += 1) many.push(chan('s1', n));
    const t = await setup({ engine, channels: many });
    const names = t.shelf(HOME_CHANNELS);
    expect(names).toHaveLength(HOME_SHELF_MAX);
    expect(names[0]).toBe('Live s1 1');
    expect(names[4]).toBe('Live s1 6');
    expect(names[19]).toBe('Live s1 21');
  });

  it('reads them again through the query worker back on top (step 38b), dropping a read a load came after', async () => {
    const engine = new FakeEngine();
    const t = await setup({ engine, channels: [chan('s1', 1)], left: [] });
    // A channel played, locked since (an unlock is over): back on top it isn't listed.
    engine.withheld.add('x:s1:live:2');
    await t.played(chan('s1', 2));
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 1']);
    // A read held, then a load (a catalog swap) reads them too: the older answer is dropped.
    engine.withheld.clear();
    engine.hold.add('live');
    await t.played(chan('s1', 3));
    engine.hold.delete('live');
    t.home.catalogChanged();
    await flush();
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 3', 'Live s1 2', 'Live s1 1']);
    engine.held.live[0]!.resolve([{ key: 'x:s1:live:1' } as CatalogItem]);
    await flush();
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 3', 'Live s1 2', 'Live s1 1']);
  });

  it("fails like its other reads when the query worker can't give the channels (step 38b)", async () => {
    const engine = new FakeEngine();
    engine.failKeys = true;
    const t = await setup({ engine, channels: [chan('s1', 1)], left: [] });
    expect(t.home.status.value).toBe('failed');
  });

  it('hides the shelf with no channel played, or without the memory; opens on it with nothing left part way', async () => {
    expect((await setup({ channels: [] })).home.shelves.value).toEqual([HOME_CONTINUE, HOME_MOVIES, HOME_SERIES]);
    expect((await setup()).home.shelves.value).toEqual([HOME_CONTINUE, HOME_MOVIES, HOME_SERIES]);
    const t = await setup({ channels: [chan('s1', 1)], left: [] });
    expect(t.home.shelves.value).toEqual([HOME_CHANNELS, HOME_MOVIES, HOME_SERIES]);
    expect(t.at()).toBe('home · channels 0');
    // Only channels: Home isn't empty.
    const engine = new FakeEngine();
    const only = await setup({ engine, channels: [chan('s2', 4)], left: [] });
    expect(only.home.status.value).toBe('ready');
    expect(only.home.shelves.value).toEqual([HOME_CHANNELS]);
  });

  it('plays a channel on OK: `play` with it as kept; back on top, it leads the shelf with the focus on it', async () => {
    const channels = [chan('s1', 1), chan('s2', 2, null, 40), chan('s1', 3)];
    const t = await setup({ channels });
    await t.press('DOWN', 'RIGHT', 'RIGHT');
    expect(t.at()).toBe('home · channels 2');
    await t.press('OK');
    expect(t.play).toHaveBeenCalledWith(channels[2]);
    expect(t.select).not.toHaveBeenCalled();
    await t.played(channels[2]!);
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 3', 'Live s1 1', 'Live s2 2']);
    expect(t.at()).toBe('home · channels 0');
    // Another, from the middle: the same.
    await t.press('RIGHT', 'OK');
    expect(t.play).toHaveBeenLastCalledWith(channels[0]);
    await t.played(channels[0]!);
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 1', 'Live s1 3', 'Live s2 2']);
    expect(t.at()).toBe('home · channels 0');
    // OK on a movie still opens its details.
    await t.press('DOWN', 'OK');
    expect(t.select).toHaveBeenCalledTimes(1);
    expect(t.play).toHaveBeenCalledTimes(2);
  });

  it('adds the shelf when the first channel is played from elsewhere on Home, keeping the focus on its tile', async () => {
    const t = await setup({ channels: [] });
    await t.press('DOWN', 'RIGHT');
    expect(t.at()).toBe('home · movies 1');
    await t.played(chan('s1', 7));
    expect(t.home.shelves.value).toEqual([HOME_CONTINUE, HOME_CHANNELS, HOME_MOVIES, HOME_SERIES]);
    expect(t.at()).toBe('home · movies 1');
    expect(t.home.top.value).toBe(1);
  });

  it('reads the channels again only when they changed, and only with shelves on show', async () => {
    const t = await setup({ channels: [chan('s1', 1)] });
    const shown = t.home.shelves.value;
    await t.away(null);
    await t.press('RIGHT');
    expect(t.home.shelves.value).toBe(shown);
    // A save: "Continue watching" alone is read again; the channels stay.
    await t.away([keyOf(1)]);
    expect(t.shelf(HOME_CONTINUE)).toEqual([LEFT[1]!.name]);
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 1']);
    // Nothing on Home: nothing is read on top again (no tile to keep).
    const engine = new FakeEngine();
    const empty = await setup({ engine, channels: [], left: [] });
    expect(empty.home.status.value).toBe('empty');
    empty.setRecent([chan('s1', 2)]);
    await empty.away(null);
    expect(empty.home.status.value).toBe('empty');
    expect(empty.home.shelves.value).toEqual([]);
    // It is read at the next opening.
    await empty.press('BACK');
    empty.home.open();
    await flush();
    expect(empty.home.shelves.value).toEqual([HOME_CHANNELS]);
  });

  it('reads the channels again on a catalog swap: a removed source\'s go, the focus kept in place', async () => {
    const t = await setup({ channels: [chan('s1', 1), chan('s2', 2), chan('s1', 3)] });
    await t.press('DOWN', 'RIGHT');
    expect(t.at()).toBe('home · channels 1');
    t.engine.profileDoc = { doc: { v: 7, sources: [S1] }, newer: false, migratedFrom: null };
    t.home.catalogChanged();
    await flush();
    expect(t.shelf(HOME_CHANNELS)).toEqual(['Live s1 1', 'Live s1 3']);
    expect(t.at()).toBe('home · channels 1');
  });

  it("asks the channels' logos for the 6 tiles in view, the focused shelf first", async () => {
    const many: LastChannel[] = [];
    for (let n = 0; n < 10; n += 1) many.push(chan('s1', n));
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 12), series: [] };
    const t = await setup({ engine, channels: many, left: [] });
    expect(t.at()).toBe('home · channels 0');
    await t.rest();
    expect(t.withPosters(HOME_CHANNELS, 0, 10)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([]);
    for (let round = 0; round < 5; round += 1) {
      for (const id of [HOME_CHANNELS, HOME_MOVIES] as const) for (let i = 0; i < 12; i += 1) {
        const url = t.home.poster(id, i);
        if (url !== undefined) t.home.posterLoaded(url);
      }
    }
    expect(t.withPosters(HOME_CHANNELS, 0, 10)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t.home.poster(HOME_CHANNELS, 0)).toBe('http://img.test/s1/live/0.png');
    // Along the shelf: 6 in view, so the view moves at the seventh.
    await t.press('RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT');
    expect(t.home.screen.value!.position(HOME_CHANNELS).top).toBe(0);
    await t.press('RIGHT');
    expect(t.home.screen.value!.position(HOME_CHANNELS)).toMatchObject({ index: 6, top: 1 });
  });
});

describe('Home (RELAY step 28b1): the posters', () => {
  it('asks the posters of the tiles in view once the view rests, the focused shelf first, a few at a time', async () => {
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 12), series: dated('series', 12) };
    for (const item of LEFT) engine.known[item.key] = item;
    const t = await setup({ engine });
    expect(t.withPosters(HOME_CONTINUE, 0, 3)).toEqual([]);
    expect(t.home.pending.value).toBe(1);
    // Each change of the posters draws the tiles again.
    let drawn = t.home.version.value;
    await t.rest();
    expect(t.home.version.value).toBe(drawn + 1);
    drawn = t.home.version.value;
    t.home.posterLoaded(t.home.poster(HOME_CONTINUE, 0)!);
    expect(t.home.version.value).toBe(drawn + 1);
    t.home.posterFailed(t.home.poster(HOME_CONTINUE, 1)!);
    expect(t.home.version.value).toBe(drawn + 2);
    // (Two settled: two more start.)
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([0, 1, 2, 3, 4]);
    expect(t.withPosters(HOME_CONTINUE, 0, 3)).toEqual([0, 2]);
    expect(t.home.pending.value).toBe(6);
    for (let round = 0; round < 5; round += 1) {
      for (const id of SHELF_ORDER) for (let i = 0; i < 12; i += 1) {
        const url = t.home.poster(id, i);
        if (url !== undefined) t.home.posterLoaded(url);
      }
    }
    // The tiles in view only: 8 of the movies, none of the shelf out of view.
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t.withPosters(HOME_SERIES, 0, 12)).toEqual([]);
    expect(t.home.pending.value).toBe(0);
    // Down to the series: the shelves move, its posters first.
    await t.press('DOWN', 'DOWN');
    expect(t.home.pending.value).toBe(1);
    await t.rest();
    expect(t.withPosters(HOME_SERIES, 0, 12)).toEqual([0, 1, 2, 3, 4, 5]);
    // The movies' posters loaded before draw at once.
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(t.withPosters(HOME_CONTINUE, 0, 3)).toEqual([]);
    // Along the shelf: the view moves, the posters in view.
    await t.press('RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT');
    expect(t.home.screen.value!.position(HOME_SERIES).top).toBe(2);
    await t.rest();
    for (let round = 0; round < 5; round += 1) for (let i = 0; i < 12; i += 1) {
      const url = t.home.poster(HOME_SERIES, i);
      if (url !== undefined) t.home.posterLoaded(url);
    }
    expect(t.withPosters(HOME_SERIES, 0, 12)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('draws the title of a poster that failed; the low tier rests longer and asks two at a time', async () => {
    const t = await setup({ tier: 'low' });
    t.clock.advance(POSTER_TIERS.full.restMs);
    await flush();
    expect(t.withPosters(HOME_CONTINUE, 0, 3)).toEqual([]);
    t.clock.advance(POSTER_TIERS.low.restMs - POSTER_TIERS.full.restMs);
    await flush();
    expect(t.withPosters(HOME_CONTINUE, 0, 3)).toEqual([0, 1]);
    const url = t.home.poster(HOME_CONTINUE, 0)!;
    t.home.posterFailed(url);
    expect(t.home.poster(HOME_CONTINUE, 0)).toBeUndefined();
    expect(t.withPosters(HOME_CONTINUE, 0, 3)).toEqual([1, 2]);
    expect(POSTER_TIERS.low).toEqual({ restMs: 300, parallel: 2 });
  });

  it("asks the focused shelf's posters first when it is the lower one in view", async () => {
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 12), series: [] };
    for (const item of LEFT) engine.known[item.key] = item;
    const t = await setup({ engine });
    await t.press('DOWN');
    await t.rest();
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.withPosters(HOME_CONTINUE, 0, 3)).toEqual([]);
  });

  it('rests again after a "Continue watching" read that came after the rest', async () => {
    const t = await setup();
    await t.rest();
    t.engine.hold = new Set(['keys']);
    t.engine.known['x:s2:movie:70'] = entry('s2', 'movie', 70);
    await t.away(['x:s2:movie:70', keyOf(1), keyOf(2)]);
    await t.rest();
    expect(t.clock.pending()).toBe(0);
    for (const held of t.engine.held.keys.splice(0)) held.resolve(held.arg === 'movie' ? [t.engine.known['x:s2:movie:70']!, LEFT[2]!] : [LEFT[1]!]);
    await flush();
    expect(t.shelf(HOME_CONTINUE)).toEqual(['Movie 70', 'Show 60', 'Movie 51']);
    expect(t.clock.pending()).toBe(1);
    await t.rest();
    expect(t.home.poster(HOME_CONTINUE, 0)).toBe('http://img.test/s2/movie/70.jpg');
  });

  it('asks no poster for keys on a screen over it', async () => {
    const t = await setup();
    await t.rest();
    t.nav.push({ id: 'movie', zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 2 }] });
    await t.press('RIGHT');
    expect(t.clock.pending()).toBe(0);
  });

  it('starts no poster while keys go down: the ones waiting wait for the next rest', async () => {
    const engine = new FakeEngine();
    engine.newest = { movie: dated('movie', 12), series: dated('series', 2) };
    for (const item of LEFT) engine.known[item.key] = item;
    const t = await setup({ engine });
    await t.rest();
    // Six under way, five of the movies waiting.
    expect(t.home.pending.value).toBe(6);
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([0, 1, 2]);
    await t.press('DOWN');
    // The six under way go on; the rest timer runs again.
    expect(t.home.pending.value).toBe(7);
    t.home.posterLoaded(t.home.poster(HOME_CONTINUE, 0)!);
    // (Held: no movie starts in its place until the rest.)
    expect(t.home.pending.value).toBe(6);
    expect(t.withPosters(HOME_MOVIES, 0, 12)).toEqual([0, 1, 2]);
    expect(t.withPosters(HOME_SERIES, 0, 2)).toEqual([]);
  });

  it('counts a poster that failed out of the downloads', async () => {
    const t = await setup();
    await t.rest();
    // Every poster in view under way, none waiting.
    expect(t.home.pending.value).toBe(6);
    t.home.posterFailed(t.home.poster(HOME_MOVIES, 2)!);
    expect(t.home.pending.value).toBe(5);
    t.home.posterLoaded(t.home.poster(HOME_MOVIES, 1)!);
    expect(t.home.pending.value).toBe(4);
  });

  it('forgets the posters and the rest on a close and a dispose', async () => {
    const t = await setup();
    expect(t.clock.pending()).toBe(1);
    await t.press('BACK');
    expect(t.clock.pending()).toBe(0);
    expect(t.home.pending.value).toBe(0);
    // Posters downloading, then a close: none counted.
    const r = await setup();
    await r.rest();
    expect(r.home.pending.value).toBe(6);
    await r.press('BACK');
    expect(r.home.pending.value).toBe(0);
    const d = await setup();
    await d.rest();
    d.home.dispose();
    expect(d.home.pending.value).toBe(0);
    const u = await setup();
    u.home.dispose();
    expect(u.clock.pending()).toBe(0);
    expect(u.home.item(HOME_CONTINUE, 0)).toBeNull();
    // Disposed: it opens no more, follows no focus, and a second dispose does nothing.
    u.home.open();
    u.home.dispose();
    expect(u.home.screen.value).not.toBeNull();
    await u.press('RIGHT');
    expect(u.clock.pending()).toBe(0);
    // Disposed while closed: it opens no more.
    const c = await setup({ open: false });
    c.home.dispose();
    c.home.open();
    await flush();
    expect(c.home.screen.value).toBeNull();
    expect(c.nav.snapshot().depth).toBe(1);
    expect(c.engine.recentCalls).toEqual([]);
  });
});
