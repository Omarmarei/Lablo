import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey, DeviceTier } from '@lablo/core';
import type { KeyItemsRequest, LastChannel, LoadedProfile, RecentItem, RecentRequest } from '@lablo/data';
import type { Focus, Navigator, Screen, ZoneSpec } from '@lablo/ui';
import { LAYOUT, SCREEN, fits } from '@lablo/ui';
import type { Timers } from '../live/live-state';
import { LIVE } from '../live/live-state';
import type { MovieShares } from '../movies/movie-progress';
import { CONTINUE_MAX } from '../movies/movies-state';
import { POSTER_TIERS, PosterLoader } from '../movies/posters';
import { storedSources } from '../onboarding/engine-loader';

/**
 * Home (RELAY step 28b1, architecture.md §1.2 "Built in step 28b1"): shelves of poster tiles,
 * pushed on the live navigator by the header's "Home" and painted instead of the live screen.
 * The app still opens on the live screen.
 *
 *   continue  ("Continue watching": movies and shows left part way, newest first)
 *   channels  ("Recent channels": the channels played last, newest first; step 28b2)
 *   movies    ("Recently added movies": the newest movies across the sources)
 *   series    ("Recently updated series": the shows the panels changed last)
 *   retry     ("Try again" after a failed read)
 *
 * - **The shelves:** at most `HOME_SHELF_MAX` tiles each, read on each opening. "Continue
 *   watching" is `progress.unfinished()`'s order: one `itemsByKey` per kind (movies; shows and a
 *   playlist's episodes), merged back into that order (`mergeByKeys`). The other two are the
 *   query worker's `recent` of each kind (a playlist's items have no date: none from one). A shelf
 *   with nothing isn't shown; with nothing at all the screen says so in one line.
 * - **Recent channels** (step 28b2): the player memory's channels played last (`channels`, the
 *   profile's version 7 list, kept up to date as channels play) from the stored sources, as
 *   landscape channel tiles (the logo, else the name). OK plays one from its group on the live
 *   list (`play`: `Live.playKept`), the player over Home; Back from it returns to Home, where
 *   the channel now leads the shelf, the focus on it.
 * - **Keys:** LEFT/RIGHT along a shelf (mirrored in Arabic), UP/DOWN between the shelves shown,
 *   each keeping its place; UP from the first shelf goes nowhere. OK on a tile: `select` (a
 *   movie's details, a show's details, as on their own screens); Back from them returns to the
 *   tile. Back on Home closes it: the live screen's header keeps the focus on "Home".
 * - **The shelves in view:** `HOME_SHELVES` at a time from `top`, which moves as little as it
 *   can to keep the focused shelf in view.
 * - **Read again:** "Continue watching" alone when Home is back on top after a save changed the
 *   places (`progress.version`, as the poster screens' `refreshContinued`), "Recent channels"
 *   alone when the channels played last changed (a new list from `channels.recent()`); every shelf on a
 *   catalog swap (`catalogChanged`). Either way the focus stays on its item when its shelf still
 *   has it, else on its place (clamped); its shelf gone, on the first shelf's first tile.
 * - **The posters** (`posters.ts`): asked once the view has rested, a few at a time, by tier: the
 *   focused shelf's tiles in view first, then the other shelf's.
 * - `pending` counts the reads in flight, a rest not over yet and the posters downloading: 0
 *   means the screen is settled (e2e).
 */

export const HOME_SCREEN = 'home';
export const HOME_CONTINUE = 'continue';
export const HOME_CHANNELS = 'channels';
export const HOME_MOVIES = 'movies';
export const HOME_SERIES = 'series';
export const HOME_RETRY = 'retry';

/** A shelf: its zone's id. */
export type ShelfId = typeof HOME_CONTINUE | typeof HOME_CHANNELS | typeof HOME_MOVIES | typeof HOME_SERIES;

/** The shelves, top to bottom. */
export const SHELF_ORDER: readonly ShelfId[] = [HOME_CONTINUE, HOME_CHANNELS, HOME_MOVIES, HOME_SERIES];

/** A shelf lists this many tiles at most ("Continue watching": `CONTINUE_MAX`, the same 20). */
export const HOME_SHELF_MAX = 20;

/** Sizes, all layout constants (no DOM measuring). home.css uses the same numbers. */
export const HOME = {
  /** The header (as the movies screen's): 56 px and a 24 px gap. */
  headerHeight: 56,
  headerGap: 24,
  /** A shelf's title (a heading line), and its gap to the tiles. */
  titleHeight: 44,
  titleGap: 12,
  /** Between a shelf's tiles. */
  tileGap: 24,
  /** Between two shelves. */
  shelfGap: 32,
} as const;

/** A shelf's height: its title over a row of poster tiles (the tallest shelf). */
export const SHELF_HEIGHT = HOME.titleHeight + HOME.titleGap + LAYOUT.posterHeight;
/** "Recent channels"' height (step 28b2): its title over a row of channel tiles. */
export const CHANNEL_SHELF_HEIGHT = HOME.titleHeight + HOME.titleGap + LAYOUT.tileHeight;
/** Under the header: the shelves. */
export const HOME_BODY = SCREEN.height - 2 * SCREEN.safeY - HOME.headerHeight - HOME.headerGap;
/** The shelves in view at once. */
export const HOME_SHELVES = fits(HOME_BODY, SHELF_HEIGHT, HOME.shelfGap);
/** A shelf's tiles in view at once, across the content box. */
export const HOME_TILES = fits(LIVE.width, LAYOUT.posterWidth, HOME.tileGap);
/** "Recent channels"' tiles in view at once (landscape channel tiles, step 28b2). */
export const CHANNEL_TILES = fits(LIVE.width, LAYOUT.tileWidth, HOME.tileGap);

/** Shelf `id`'s tiles in view at once. */
export function tilesInView(id: ShelfId): number {
  return id === HOME_CHANNELS ? CHANNEL_TILES : HOME_TILES;
}

export type HomeStatus = 'loading' | 'ready' | 'empty' | 'failed';

/** What Home needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface HomeEngine {
  profile(): Promise<LoadedProfile | null>;
  /** The newest items of one kind across the sources, newest first (step 26e). */
  recent(req: RecentRequest): Promise<RecentItem[]>;
  /** The catalog items of some keys, of one kind, in the order asked (step 27d). */
  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]>;
}

export interface HomeOptions {
  /** The live screen's navigator: Home is a screen on it. */
  readonly nav: Navigator;
  readonly engine: HomeEngine;
  /** The device's tier (default: full): how the posters load (`POSTER_TIERS`). */
  readonly tier?: () => DeviceTier;
  readonly timers?: Timers;
  /** OK on a tile: a movie's details, or a show's (or a playlist's episode's). */
  readonly select?: (item: CatalogItem) => void;
  /** Where each movie and show was left: "Continue watching", and the tiles' bars. */
  readonly progress?: Pick<MovieShares, 'share' | 'version' | 'unfinished'>;
  /** The channels played last, newest first (the player memory, step 28b2): "Recent channels". */
  readonly channels?: { recent(): readonly LastChannel[] };
  /** OK on a channel's tile (step 28b2): it plays from its group on the live list. */
  readonly play?: (channel: LastChannel) => void;
}

export interface Home {
  /** The screen while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<HomeStatus>;
  /** The shelves shown (each with tiles), top to bottom. */
  readonly shelves: ReadonlySignal<readonly ShelfId[]>;
  /** The first shelf in view (an index into `shelves`). */
  readonly top: ReadonlySignal<number>;
  /** Bumps when the shelves or the posters change: tiles are read again. */
  readonly version: ReadonlySignal<number>;
  /** Reads in flight, a rest not over yet, and posters downloading. */
  readonly pending: ReadonlySignal<number>;
  /** Tile `index` of `shelf` (`null`: none). */
  item(shelf: ShelfId, index: number): CatalogItem | null;
  /** The poster tile `index` of `shelf` draws (`undefined`: none, its title on the tile's background). */
  poster(shelf: ShelfId, index: number): string | undefined;
  /**
   * The share of tile `index`'s item watched, 0–1, for its bar (`undefined`: none). It reads the
   * places' version, so a screen that draws it draws again when one changes.
   */
  progress(shelf: ShelfId, index: number): number | undefined;
  /** Poster `url`'s image arrived. */
  posterLoaded(url: string): void;
  /** Poster `url`'s image failed: its tiles show their titles. */
  posterFailed(url: string): void;
  /** Opens Home (nothing when it is open). */
  open(): void;
  /** A catalog swapped in: an open Home reads its shelves again. */
  catalogChanged(): void;
  dispose(): void;
}

/**
 * `a` and `b`, each in the order of `keys` (as `itemsByKey` gives them), merged into that order:
 * at most `max` items. An item whose key isn't in `keys` is never reached.
 */
export function mergeByKeys(keys: readonly ContentKey[], a: readonly CatalogItem[], b: readonly CatalogItem[], max: number): CatalogItem[] {
  const out: CatalogItem[] = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < keys.length && out.length < max; k += 1) {
    const key = keys[k];
    if (i < a.length && a[i]!.key === key) out.push(a[i++]!);
    else if (j < b.length && b[j]!.key === key) out.push(b[j++]!);
  }
  return out;
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function shelfZone(id: ShelfId, count: number): ZoneSpec {
  const at = SHELF_ORDER.indexOf(id);
  const up = SHELF_ORDER[at - 1];
  const down = SHELF_ORDER[at + 1];
  const neighbours: { up?: string; down?: string } = {};
  if (up !== undefined) neighbours.up = up;
  if (down !== undefined) neighbours.down = down;
  return { kind: 'list', id, axis: 'horizontal', count, visible: tilesInView(id), neighbours };
}

function retryZone(count: number): ZoneSpec {
  return { kind: 'list', id: HOME_RETRY, axis: 'horizontal', count };
}

/** Every shelf's items: what a read gives ("Recent channels": the channels as kept). */
type Lists = Record<Exclude<ShelfId, typeof HOME_CHANNELS>, CatalogItem[]> & { channels: LastChannel[] };

function noLists(): Lists {
  return { continue: [], channels: [], movies: [], series: [] };
}

/** The focused tile before a shelf changed: its shelf, its place and its item's key. */
interface Kept {
  readonly zone: ShelfId;
  readonly index: number;
  readonly key: ContentKey;
}

export function createHome(options: HomeOptions): Home {
  const { nav, engine } = options;
  const timers = options.timers ?? defaultTimers;
  const tier = (): DeviceTier => options.tier?.() ?? 'full';

  const screen = signal<Screen | null>(null);
  const status = signal<HomeStatus>('loading');
  const shelves = signal<readonly ShelfId[]>([]);
  const top = signal(0);
  const version = signal(0);
  const pending = signal(0);

  let disposed = false;
  /** Bumps on each load: answers from before are dropped. */
  let seq = 0;
  /** Bumps on each read of "Continue watching" alone (and with each load): answers from before are dropped. */
  let continueSeq = 0;
  /** The places' version "Continue watching" was last read at (-1: never). */
  let readAt = -1;
  /** The stored sources' ids as the last load read them: "Continue watching" reads them again. */
  let sourceIds: string[] = [];
  /** The channels played last as "Recent channels" was last read from them (`null`: never). */
  let channelsRead: readonly LastChannel[] | null = null;
  let lists: Lists = noLists();
  let requests = 0;
  let restTimer: unknown = null;
  let posters = new PosterLoader(POSTER_TIERS[tier()].parallel);

  const syncPending = (): void => {
    pending.value = requests + (restTimer === null ? 0 : 1) + posters.inFlight();
  };

  const bump = (): void => {
    version.value += 1;
  };

  /** Counts `running` in `pending` until it settles either way. */
  function track<T>(running: Promise<T>): Promise<T> {
    requests += 1;
    syncPending();
    const done = (): void => {
      requests -= 1;
      syncPending();
    };
    running.then(done, done);
    return running;
  }

  const itemAt = (shelf: ShelfId, i: number): CatalogItem | null => (shelf === HOME_CHANNELS ? (lists.channels[i]?.item ?? null) : (lists[shelf][i] ?? null));

  /**
   * Moves `top` as little as it can to show the focused shelf, within the shelves shown (none
   * shown: 0). A ready Home's focus is always on a shelf shown.
   */
  const syncTop = (shown: Screen): void => {
    const order = shelves.value;
    const at = order.indexOf(shown.active as ShelfId);
    let first = top.value;
    if (at < first) first = at;
    else if (at >= first + HOME_SHELVES) first = at - HOME_SHELVES + 1;
    top.value = Math.max(0, Math.min(first, order.length - HOME_SHELVES));
  };

  /**
   * The view rested: the posters of the tiles in view, the focused shelf's first. (A close and a
   * dispose stop the wait; with no shelf shown nothing is asked.)
   */
  const rest = (): void => {
    restTimer = null;
    const shown = screen.value!;
    const inView = shelves.value.slice(top.value, top.value + HOME_SHELVES);
    const active = shown.active as ShelfId;
    const first = inView.indexOf(active) !== -1 ? [active] : [];
    const urls: (string | null)[] = [];
    // (The focused shelf comes again among the others: the loader asks a poster once.)
    for (const shelf of first.concat(inView)) {
      const from = Math.max(0, shown.position(shelf).top);
      for (let i = from; i < from + tilesInView(shelf); i += 1) urls.push(itemAt(shelf, i)?.logo ?? null);
    }
    posters.rest(urls);
    syncPending();
    bump();
  };

  /** (Only an open Home waits for a rest.) */
  const scheduleRest = (): void => {
    timers.clear(restTimer);
    restTimer = timers.set(rest, POSTER_TIERS[tier()].restMs);
    syncPending();
  };

  const stopRest = (): void => {
    timers.clear(restTimer);
    restTimer = null;
  };

  /** The focused tile as it is now (a ready Home's focus is on a tile). */
  const keep = (shown: Screen): Kept => {
    const zone = shown.active as ShelfId;
    const index = shown.position(zone).index;
    return { zone, index, key: itemAt(zone, index)!.key };
  };

  /**
   * Shows `next` (every shelf, or the ones a refresh read again). `kept`: the focused tile to find
   * again (`null`: a first read, the first shelf's first tile).
   */
  const apply = (shown: Screen, next: Lists, kept: Kept | null): void => {
    lists = next;
    const order: ShelfId[] = [];
    for (const id of SHELF_ORDER) {
      if (next[id].length > 0) order.push(id);
      shown.update(shelfZone(id, next[id].length));
    }
    // (A new list: the screen draws again.)
    shelves.value = order;
    status.value = order.length === 0 ? 'empty' : 'ready';
    if (kept !== null && next[kept.zone].length > 0) {
      let place = kept.index;
      for (let i = 0; i < next[kept.zone].length; i += 1) if (itemAt(kept.zone, i)!.key === kept.key) place = i;
      shown.focus(kept.zone, place);
    } else if (order.length > 0) {
      // A first read, or the focused shelf gone: the first shelf's first tile.
      shown.focus(order[0]!, 0);
    }
    syncTop(shown);
    // (Held lists: no chunks to wait for. A focus that kept its place told nobody.)
    scheduleRest();
  };

  /** "Continue watching"'s items from sources `ids` (none without the places), the places' version first taken. */
  const readContinued = (ids: string[]): Promise<CatalogItem[]> => {
    const kept = options.progress;
    if (kept === undefined) return Promise.resolve([]);
    readAt = kept.version.peek();
    const keys = kept.unfinished();
    // (Nothing left part way: nothing to ask.)
    if (keys.length === 0) return Promise.resolve([]);
    return Promise.all([
      engine.itemsByKey({ keys, kind: 'movie', sources: ids, limit: CONTINUE_MAX }),
      engine.itemsByKey({ keys, kind: 'series', sources: ids, limit: CONTINUE_MAX }),
    ] as const).then((found) => mergeByKeys(keys, found[0], found[1], CONTINUE_MAX));
  };

  const items = (found: RecentItem[]): CatalogItem[] => found.map((r) => r.item);

  /** "Recent channels": the channels played last from sources `ids`, at most `HOME_SHELF_MAX` (none without the memory). */
  const readChannels = (ids: readonly string[]): LastChannel[] => {
    const memory = options.channels;
    if (memory === undefined) return [];
    const all = memory.recent();
    channelsRead = all;
    const out: LastChannel[] = [];
    // A removed source's channels are left out.
    for (let i = 0; i < all.length && out.length < HOME_SHELF_MAX; i += 1) if (ids.indexOf(all[i]!.item.src) !== -1) out.push(all[i]!);
    return out;
  };

  /** The stored sources, then every shelf. */
  const readShelves = async (): Promise<{ ids: string[]; lists: Lists }> => {
    const records = storedSources(await engine.profile());
    const ids: string[] = [];
    for (const r of records) ids.push(r.id);
    const read = await Promise.all([
      readContinued(ids),
      engine.recent({ sources: ids, kind: 'movie', limit: HOME_SHELF_MAX }),
      engine.recent({ sources: ids, kind: 'series', limit: HOME_SHELF_MAX }),
    ] as const);
    return { ids, lists: { continue: read[0], channels: readChannels(ids), movies: items(read[1]), series: items(read[2]) } };
  };

  /** Reads every shelf. `kept`: a catalog swap's focused tile; without it, the loading screen first. */
  const load = (kept?: Kept): void => {
    seq += 1;
    // (A read of "Continue watching" alone still out is dropped: this load reads it too.)
    continueSeq += 1;
    const mine = seq;
    if (kept === undefined) {
      status.value = 'loading';
      screen.value!.update(retryZone(0));
    }
    track(readShelves()).then(
      (read) => {
        const shown = screen.value;
        if (disposed || mine !== seq || shown === null) return;
        sourceIds = read.ids;
        apply(shown, read.lists, kept ?? null);
      },
      (error: unknown) => {
        const shown = screen.value;
        if (disposed || mine !== seq || shown === null) return;
        console.warn("Home's shelves could not be read", error);
        status.value = 'failed';
        lists = noLists();
        shelves.value = [];
        for (const id of SHELF_ORDER) shown.update(shelfZone(id, 0));
        shown.update(retryZone(1));
        shown.focus(HOME_RETRY, 0);
      },
    );
  };

  /** Reads "Continue watching" again when the places changed since its last read. */
  const refreshContinued = (): void => {
    const kept = options.progress;
    if (kept === undefined || status.value !== 'ready' || kept.version.peek() === readAt) return;
    continueSeq += 1;
    const mine = continueSeq;
    track(readContinued(sourceIds)).then(
      (found) => {
        // (A load since bumped the number.)
        const shown = screen.value;
        if (disposed || mine !== continueSeq || shown === null) return;
        apply(shown, { continue: found, channels: lists.channels, movies: lists.movies, series: lists.series }, keep(shown));
      },
      // (The next opening reads it again.)
      (error: unknown) => console.warn('"Continue watching" could not be read', error),
    );
  };

  /** Reads "Recent channels" again when the channels played last changed since its last read (a channel played from it). */
  const refreshChannels = (shown: Screen): void => {
    const memory = options.channels;
    if (memory === undefined || status.value !== 'ready' || memory.recent() === channelsRead) return;
    apply(shown, { continue: lists.continue, channels: readChannels(sourceIds), movies: lists.movies, series: lists.series }, keep(shown));
  };

  const close = (): void => {
    stopRest();
    screen.value = null;
    lists = noLists();
    shelves.value = [];
    posters.clear();
    syncPending();
    // Only Back closes it: it is on top.
    nav.pop();
  };

  const onIntent = (intent: string): boolean => {
    if (intent !== 'BACK') return false;
    close();
    return true;
  };

  /** OK on a tile (one is always there: the navigator selects only an item) or on "Try again". */
  const onSelect = (focus: Focus): void => {
    if (focus.zone === HOME_RETRY) load();
    else if (focus.zone === HOME_CHANNELS) options.play?.(lists.channels[focus.index]!);
    else options.select?.(itemAt(focus.zone as ShelfId, focus.index)!);
  };

  const stopFollowing = nav.subscribe((focus) => {
    const shown = screen.value;
    if (focus.screen !== HOME_SCREEN || shown === null) return;
    syncTop(shown);
    // No poster starts while the keys go down: the ones still waiting wait for the next rest.
    posters.hold();
    scheduleRest();
    // Back on top after a play: "Continue watching" again, then "Recent channels" (its focus
    // moving with its channel notifies again, and finds the places already asked for).
    refreshContinued();
    refreshChannels(shown);
  });

  return {
    screen,
    status,
    shelves,
    top,
    version,
    pending,
    item: itemAt,
    poster(shelf: ShelfId, i: number): string | undefined {
      const item = itemAt(shelf, i);
      return item === null ? undefined : posters.src(item.logo);
    },
    progress(shelf: ShelfId, i: number): number | undefined {
      const kept = options.progress;
      if (kept === undefined) return undefined;
      // Read for the screen: a place saved since draws the tiles again.
      void kept.version.value;
      const item = itemAt(shelf, i);
      return item === null ? undefined : kept.share(item.key);
    },
    posterLoaded(url: string): void {
      posters.loaded(url);
      syncPending();
      bump();
    },
    posterFailed(url: string): void {
      posters.failed(url);
      syncPending();
      bump();
    },
    open(): void {
      if (disposed || screen.value !== null) return;
      // (The tier can change from one opening to the next.)
      posters = new PosterLoader(POSTER_TIERS[tier()].parallel);
      const zones: ZoneSpec[] = [];
      for (const id of SHELF_ORDER) zones.push(shelfZone(id, 0));
      zones.push(retryZone(0));
      screen.value = nav.push({ id: HOME_SCREEN, zones, initial: HOME_CONTINUE, onIntent, onSelect });
      load();
    },
    catalogChanged(): void {
      const shown = screen.value;
      if (disposed || shown === null) return;
      // Shelves on show: read again around the focused tile; loading, empty or failed: from the loading screen.
      if (status.value === 'ready') load(keep(shown));
      else load();
    },
    dispose(): void {
      // (A second dispose does the same again: nothing.)
      disposed = true;
      stopRest();
      stopFollowing();
      lists = noLists();
      posters.clear();
      syncPending();
    },
  };
}
