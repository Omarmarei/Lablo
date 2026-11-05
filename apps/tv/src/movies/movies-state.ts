import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKind, DeviceTier } from '@zoma/core';
import type { CategoryInfo, LoadedProfile, SourceRecord } from '@zoma/data';
import type { Focus, Navigator, Screen, ZoneSpec } from '@zoma/ui';
import { LAYOUT, fits } from '@zoma/ui';
import type { ChunkRef } from '../live/channel-index';
import { ChannelIndex, chunkId } from '../live/channel-index';
import type { RailEntry, RailRef, Timers } from '../live/live-state';
import { CHUNK_CACHE, LIVE, LIVE_BODY, RAIL_VISIBLE, findEntry, railEntries } from '../live/live-state';
import { storedSources } from '../onboarding/engine-loader';
import { POSTER_TIERS, PosterLoader } from './posters';

/**
 * The movies screen (RELAY step 26a, PLAN 7.1): the stored sources' movies, pushed on the live
 * navigator by the header's "Movies" button, as the guide is.
 *
 *   rail   ("All movies", then each source's VOD categories; OK shows one, its grid focused)
 *   grid   (the category's movies as poster tiles, `MOVIES.columns` a row filled from the inline
 *          start; only the rows in view are drawn)
 *   retry  ("Try again" after a failed read)
 *
 * - **The first focus** is on the grid's first movie of "All movies".
 * - **Keys:** LEFT from the grid's first column goes to the rail (RIGHT from the rail back),
 *   mirrored in Arabic; CH± page the grid; Back in the grid goes to the rail on the category on
 *   show, and Back on the rail (or on an empty or failed screen) closes it: the live screen's
 *   header keeps the focus on "Movies".
 * - **The data:** the sources and their movie categories are read on each open; a category's
 *   chunks are read for the rows in view and one row either side (`ChannelIndex`, kind `movie`),
 *   `CHUNK_CACHE` of them kept. Everything goes when the screen closes.
 * - **The posters** (`posters.ts`): asked once the view has rested, a few at a time, by tier.
 * - **A catalog swap** while it is open (`catalogChanged`): the sources are read again, the
 *   category on show kept by name ("All movies" when it is gone), the focus on the same place
 *   when the new grid has it.
 * - `pending` counts the reads in flight, a rest not over yet and the posters downloading: 0
 *   means the screen is settled (e2e).
 */

export const MOVIES_SCREEN = 'movies';
export const MOVIES_RAIL = 'rail';
export const MOVIES_GRID = 'grid';
export const MOVIES_RETRY = 'retry';

const MOVIE_KIND: ContentKind = 'movie';

/** The screen's layout: the live screen's header and rail, then the grid. */
export const MOVIES = {
  columns: 6,
  /** Between the tiles of a row, and between rows. */
  tileGap: 24,
  rowGap: 24,
} as const;

/** The grid's rows in view: the live screen's body over the poster rows. */
export const MOVIES_ROWS = fits(LIVE_BODY, LAYOUT.posterHeight, MOVIES.rowGap);
/** The grid's width: it must fit beside the rail. */
export const MOVIES_GRID_WIDTH = MOVIES.columns * LAYOUT.posterWidth + (MOVIES.columns - 1) * MOVIES.tileGap;
if (MOVIES_GRID_WIDTH > LIVE.width - LIVE.railWidth - LIVE.columnGap) throw new Error('The movies grid does not fit beside the rail');

export type MoviesStatus = 'loading' | 'ready' | 'empty' | 'failed';

/** What the movies screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface MoviesEngine {
  profile(): Promise<LoadedProfile | null>;
  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]>;
  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]>;
}

export interface MoviesOptions {
  /** The live screen's navigator: the movies screen is a screen on it. */
  readonly nav: Navigator;
  readonly engine: MoviesEngine;
  /** The device's tier (default: full): how the posters load (`POSTER_TIERS`). */
  readonly tier?: () => DeviceTier;
  readonly timers?: Timers;
  /** OK on a movie (its details come with step 26c). */
  readonly select?: (item: CatalogItem) => void;
}

export interface Movies {
  /** The screen while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<MoviesStatus>;
  readonly rail: ReadonlySignal<readonly RailEntry[]>;
  /** The rail entry on show. */
  readonly category: ReadonlySignal<number>;
  /** Bumps when chunks or posters arrive: tiles are read again through `movie` and `poster`. */
  readonly version: ReadonlySignal<number>;
  /** Reads in flight, a rest not over yet, and posters downloading. */
  readonly pending: ReadonlySignal<number>;
  /** Tile `index` of the grid on show, or `null` while its chunk loads. */
  movie(index: number): CatalogItem | null;
  /** The poster tile `index` draws (`undefined`: none, its title on the tile's background). */
  poster(index: number): string | undefined;
  /** Poster `url`'s image arrived. */
  posterLoaded(url: string): void;
  /** Poster `url`'s image failed: its tiles show their titles. */
  posterFailed(url: string): void;
  /** Opens the screen on "All movies" (nothing when it is open). */
  open(): void;
  /** A catalog swapped in: an open screen reads its sources again. */
  catalogChanged(): void;
  dispose(): void;
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function railZone(count: number): ZoneSpec {
  return { kind: 'list', id: MOVIES_RAIL, axis: 'vertical', count, visible: RAIL_VISIBLE, neighbours: { end: MOVIES_GRID } };
}

function gridZone(count: number): ZoneSpec {
  return { kind: 'grid', id: MOVIES_GRID, columns: MOVIES.columns, count, visibleRows: MOVIES_ROWS, neighbours: { start: MOVIES_RAIL } };
}

function retryZone(count: number): ZoneSpec {
  return { kind: 'list', id: MOVIES_RETRY, axis: 'horizontal', count };
}

export function createMovies(options: MoviesOptions): Movies {
  const { nav, engine } = options;
  const timers = options.timers ?? defaultTimers;
  const tier = (): DeviceTier => options.tier?.() ?? 'full';

  const screen = signal<Screen | null>(null);
  const status = signal<MoviesStatus>('loading');
  const rail = signal<readonly RailEntry[]>([]);
  const category = signal(0);
  const version = signal(0);
  const pending = signal(0);

  let disposed = false;
  /** Bumps on each open, close and (re)load: answers from before are dropped. */
  let seq = 0;
  let index = new ChannelIndex([]);
  /** Loaded chunks, oldest use first (a Map keeps insertion order). */
  const chunks = new Map<string, CatalogItem[]>();
  const loadingChunks = new Map<string, number>();
  let requests = 0;
  let restTimer: unknown = null;
  let posters = new PosterLoader(POSTER_TIERS[tier()].parallel);

  const syncPending = (): void => {
    pending.value = requests + (restTimer === null ? 0 : 1) + posters.inFlight();
  };

  const bump = (): void => {
    version.value += 1;
  };

  /** Runs `request`, counting it in `pending` until it settles either way. */
  function track<T>(request: () => Promise<T>): Promise<T> {
    requests += 1;
    syncPending();
    let running: Promise<T>;
    try {
      running = request();
    } catch (error) {
      running = Promise.reject(error);
    }
    const done = (): void => {
      requests -= 1;
      syncPending();
    };
    running.then(done, done);
    return running;
  }

  const movieAt = (i: number): CatalogItem | null => {
    const at = index.locate(i);
    if (at === null) return null;
    return chunks.get(chunkId(at))?.[at.slot] ?? null;
  };

  /** The grid's first row in view. */
  const topRow = (): number => {
    const shown = screen.value;
    return shown === null ? 0 : Math.max(0, shown.position(MOVIES_GRID).top);
  };

  /** Keeps the chunks `needed` and drops the least recently used beyond `CHUNK_CACHE`. */
  const keepChunks = (needed: readonly ChunkRef[]): void => {
    const keep = needed.map(chunkId);
    for (const id of keep) {
      const items = chunks.get(id);
      if (items !== undefined) {
        chunks.delete(id);
        chunks.set(id, items);
      }
    }
    const ids: string[] = [];
    chunks.forEach((_items, id) => ids.push(id));
    let excess = ids.length - CHUNK_CACHE;
    for (const id of ids) {
      if (excess <= 0) break;
      if (keep.indexOf(id) !== -1) continue;
      chunks.delete(id);
      excess -= 1;
    }
  };

  const loadChunk = (ref: ChunkRef): void => {
    const id = chunkId(ref);
    const mine = seq;
    loadingChunks.set(id, mine);
    track(() => engine.chunk(ref.src, MOVIE_KIND, ref.catIdx, ref.chunk)).then(
      (items) => {
        if (loadingChunks.get(id) === mine) loadingChunks.delete(id);
        if (disposed || mine !== seq) return;
        chunks.set(id, items);
        bump();
        // The rows' posters can be asked now: the view has rested meanwhile, or rests soon.
        scheduleRest();
      },
      (error: unknown) => {
        if (loadingChunks.get(id) === mine) loadingChunks.delete(id);
        // The next move of the view asks again.
        if (!disposed) console.warn('A movie chunk could not be read', error);
      },
    );
  };

  /** Reads the chunks of the rows in view and one row either side. */
  const readView = (): void => {
    if (status.value !== 'ready' || screen.value === null) return;
    const top = topRow();
    const needed = index.chunksFor((top - 1) * MOVIES.columns, (top + MOVIES_ROWS + 1) * MOVIES.columns);
    keepChunks(needed);
    for (const ref of needed) {
      const id = chunkId(ref);
      if (!chunks.has(id) && loadingChunks.get(id) !== seq) loadChunk(ref);
    }
  };

  /** The view rested: its posters, the focused tile's row first, then the rows from the top. */
  const rest = (): void => {
    restTimer = null;
    if (disposed || screen.value === null || status.value !== 'ready') {
      syncPending();
      return;
    }
    const top = topRow();
    const focused = screen.value.position(MOVIES_GRID).index;
    const focusRow = focused < 0 ? top : Math.floor(focused / MOVIES.columns);
    const rows = [focusRow];
    for (let r = top; r < top + MOVIES_ROWS; r += 1) if (r !== focusRow) rows.push(r);
    const urls: (string | null)[] = [];
    for (const r of rows) for (let i = r * MOVIES.columns; i < (r + 1) * MOVIES.columns; i += 1) urls.push(movieAt(i)?.logo ?? null);
    posters.rest(urls);
    syncPending();
    bump();
  };

  const scheduleRest = (): void => {
    if (screen.value === null) return;
    if (restTimer !== null) timers.clear(restTimer);
    restTimer = timers.set(rest, POSTER_TIERS[tier()].restMs);
    syncPending();
  };

  const stopRest = (): void => {
    if (restTimer !== null) timers.clear(restTimer);
    restTimer = null;
  };

  const showCategory = (i: number, at = 0): void => {
    const shown = screen.value;
    const picked = rail.value[i];
    if (shown === null || picked === undefined) return;
    category.value = i;
    index = new ChannelIndex(picked.parts);
    // Back to the top first, so no step reads chunks for the old view in the new grid.
    shown.reset(MOVIES_GRID);
    shown.update(gridZone(index.count));
    shown.focus(MOVIES_GRID, Math.min(Math.max(0, at), index.count - 1));
  };

  /** The stored sources and each one's movie categories. */
  const readSources = async (): Promise<{ records: SourceRecord[]; lists: CategoryInfo[][] }> => {
    const records = storedSources(await engine.profile());
    const lists = await Promise.all(records.map((r) => engine.categories(r.id, MOVIE_KIND)));
    return { records, lists };
  };

  /** The rail entry on show as a source's category by its name (`null`: "All movies", or nothing yet). */
  const shownRef = (): RailRef => {
    const shown = rail.value[category.value];
    const part = shown === undefined || shown.kind === 'all' ? undefined : shown.parts[0];
    return part === undefined || shown === undefined ? null : { src: part.src, name: shown.name };
  };

  /**
   * Reads the sources and their categories. `keep`: the category to show again (a catalog swap),
   * and the grid's place to focus there; without it, the loading screen first.
   */
  const load = (keep?: { readonly ref: RailRef; readonly at: number }): void => {
    seq += 1;
    const mine = seq;
    loadingChunks.clear();
    if (keep === undefined) {
      chunks.clear();
      status.value = 'loading';
      screen.value?.update(retryZone(0));
    }
    track(readSources).then(
      ({ records, lists }) => {
        const shown = screen.value;
        if (disposed || mine !== seq || shown === null) return;
        const entries = railEntries(records.map((r, i) => ({ src: r.id, categories: lists[i] ?? [] })));
        // (A swap's old tiles show until here.)
        chunks.clear();
        rail.value = entries;
        shown.update(retryZone(0));
        shown.update(railZone(entries.length));
        if (entries.length === 0) {
          status.value = 'empty';
          shown.update(gridZone(0));
          bump();
          return;
        }
        status.value = 'ready';
        const ref = keep === undefined ? null : keep.ref;
        const found = ref === null ? 0 : findEntry(entries, ref);
        const pick = Math.max(0, found);
        // The same category: the same place in it (the grid clamps it); another one: its first movie.
        const at = keep !== undefined && found !== -1 ? keep.at : 0;
        // A swap keeps the focus where it was: on the rail it stays there.
        const onRail = keep !== undefined && shown.active === MOVIES_RAIL;
        showCategory(pick, at);
        if (onRail) shown.focus(MOVIES_RAIL, pick);
        bump();
        readView();
        scheduleRest();
      },
      (error: unknown) => {
        const shown = screen.value;
        if (disposed || mine !== seq || shown === null) return;
        console.warn('The movie categories could not be read', error);
        status.value = 'failed';
        shown.update(retryZone(1));
        shown.focus(MOVIES_RETRY, 0);
        bump();
      },
    );
  };

  const close = (): void => {
    const shown = screen.value;
    if (shown === null) return;
    seq += 1;
    stopRest();
    screen.value = null;
    chunks.clear();
    loadingChunks.clear();
    posters.clear();
    syncPending();
    // Only Back closes it: it is on top.
    nav.pop();
  };

  const onIntent = (intent: string, focus: Focus): boolean => {
    if (intent !== 'BACK') return false;
    // Back in the grid goes to the rail, on the category on show.
    if (focus.zone === MOVIES_GRID && rail.value.length > 0) {
      screen.value?.focus(MOVIES_RAIL, category.value);
      return true;
    }
    close();
    return true;
  };

  const onSelect = (focus: Focus): void => {
    if (focus.zone === MOVIES_RAIL) showCategory(focus.index);
    else if (focus.zone === MOVIES_RETRY) load();
    else if (focus.zone === MOVIES_GRID) {
      const item = movieAt(focus.index);
      if (item !== null) options.select?.(item);
    }
  };

  const stopFollowing = nav.subscribe((focus) => {
    if (focus.screen !== MOVIES_SCREEN || screen.value === null) return;
    readView();
    scheduleRest();
  });

  return {
    screen,
    status,
    rail,
    category,
    version,
    pending,
    movie: movieAt,
    poster(i: number): string | undefined {
      const item = movieAt(i);
      return item === null ? undefined : posters.src(item.logo);
    },
    posterLoaded(url: string): void {
      if (screen.value === null) return;
      posters.loaded(url);
      syncPending();
      bump();
    },
    posterFailed(url: string): void {
      if (screen.value === null) return;
      posters.failed(url);
      syncPending();
      bump();
    },
    open(): void {
      if (disposed || screen.value !== null) return;
      posters = new PosterLoader(POSTER_TIERS[tier()].parallel);
      category.value = 0;
      rail.value = [];
      index = new ChannelIndex([]);
      const shown = nav.push({
        id: MOVIES_SCREEN,
        zones: [railZone(0), gridZone(0), retryZone(0)],
        initial: MOVIES_GRID,
        onIntent,
        onSelect,
      });
      screen.value = shown;
      load();
    },
    catalogChanged(): void {
      const shown = screen.value;
      if (disposed || shown === null) return;
      if (status.value !== 'ready') {
        load();
        return;
      }
      load({ ref: shownRef(), at: shown.position(MOVIES_GRID).index });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      seq += 1;
      stopRest();
      stopFollowing();
      chunks.clear();
      posters.clear();
      syncPending();
    },
  };
}
