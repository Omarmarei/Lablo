import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKind, DeviceTier } from '@lablo/core';
import type { CategoryInfo, LoadedProfile, RecentItem, RecentRequest, SourceRecord } from '@lablo/data';
import type { Focus, Navigator, Screen, ZoneSpec } from '@lablo/ui';
import { LAYOUT, fits } from '@lablo/ui';
import type { ChunkRef, ListPart } from '../live/channel-index';
import { ChannelIndex, chunkId } from '../live/channel-index';
import type { RailEntry, RailRef, Timers } from '../live/live-state';
import { CHUNK_CACHE, LIVE, LIVE_BODY, RAIL_VISIBLE, railEntries } from '../live/live-state';
import { storedSources } from '../onboarding/engine-loader';
import type { MovieShares } from './movie-progress';
import { POSTER_TIERS, PosterLoader } from './posters';

/**
 * The movies screen (RELAY step 26a, PLAN 7.1): the stored sources' movies, pushed on the live
 * navigator by the header's "Movies" button, as the guide is.
 *
 *   rail   ("Recently added", "All movies", then each source's VOD categories; OK shows one,
 *          its grid focused)
 *   grid   (the category's movies as poster tiles, `MOVIES.columns` a row filled from the inline
 *          start; only the rows in view are drawn)
 *   retry  ("Try again" after a failed read)
 *
 * - **The first focus** is on the grid's first movie of the rail's first entry: "Recently added"
 *   when the sources have dated movies, else "All movies".
 * - **"Recently added"** (step 26e): the newest movies across the sources, newest first, at most
 *   `RECENT_MAX` (the query worker's `recent`, from the lists the ingest keeps). Its movies are read
 *   with the categories and held while the screen is open: it has no chunks. A playlist's movies
 *   have no date, so a screen of playlists alone has no such entry.
 * - **Keys:** LEFT from the grid's first column goes to the rail (RIGHT from the rail back),
 *   mirrored in Arabic; CH± page the grid; Back in the grid goes to the rail on the category on
 *   show, and Back on the rail (or on an empty or failed screen) closes it: the live screen's
 *   header keeps the focus on "Movies".
 * - **The data:** the sources, their movie categories and the newest movies are read on each
 *   open; a category's
 *   chunks are read for the rows in view and one row either side (`ChannelIndex`, kind `movie`),
 *   `CHUNK_CACHE` of them kept. Everything goes when the screen closes.
 * - **The posters** (`posters.ts`): asked once the view has rested, a few at a time, by tier.
 * - **A catalog swap** while it is open (`catalogChanged`): the sources are read again, the
 *   entry on show kept ("Recently added", "All movies", or a category by its name; the first entry
 *   when it is gone), the focus on the same place when the new grid has it.
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

/** The rail's "Recently added" (step 26e): the newest movies, held by the screen (no parts). */
export interface RecentEntry {
  readonly kind: 'recent';
  readonly name: '';
  readonly count: number;
  readonly parts: readonly ListPart[];
  readonly allStart: number;
}

/** An entry of the movies rail: "Recently added", or one of the live rail's kinds. */
export type MovieEntry = RecentEntry | RailEntry;

/** A rail entry as a catalog swap finds it again (`null`: none shown yet). */
type MovieRef = 'recent' | 'all' | NonNullable<RailRef> | null;

/** The entry of `entries` that `ref` names (`-1`: none). */
function findMovieEntry(entries: readonly MovieEntry[], ref: NonNullable<MovieRef>): number {
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    if (ref === 'recent' || ref === 'all' ? e.kind === ref : e.kind === 'category' && e.name === ref.name && e.parts[0]?.src === ref.src) return i;
  }
  return -1;
}

/** What the movies screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface MoviesEngine {
  profile(): Promise<LoadedProfile | null>;
  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]>;
  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]>;
  /** The newest movies across the sources, newest first (step 26e). */
  recent(req: RecentRequest): Promise<RecentItem[]>;
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
  /** Where each movie was left (step 26d): a tile's bar (default: none). */
  readonly progress?: Pick<MovieShares, 'share' | 'version'>;
}

export interface Movies {
  /** The screen while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<MoviesStatus>;
  readonly rail: ReadonlySignal<readonly MovieEntry[]>;
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
  /**
   * The share of tile `index`'s movie watched, 0–1, for its bar (step 26d; `undefined`: none). It
   * reads the positions' version, so a screen that draws it draws again when one changes.
   */
  progress(index: number): number | undefined;
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
  const rail = signal<readonly MovieEntry[]>([]);
  const category = signal(0);
  const version = signal(0);
  const pending = signal(0);

  let disposed = false;
  /** Bumps on each (re)load: answers from before are dropped. */
  let seq = 0;
  let index = new ChannelIndex([]);
  /** "Recently added"'s movies, newest first, as the last load read them. */
  let recent: CatalogItem[] = [];
  /** The movies of the entry on show when it has no chunks ("Recently added"), else `null`. */
  let held: CatalogItem[] | null = null;
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
    if (held !== null) return held[i] ?? null;
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
    // (The focused row comes again among the others: the loader asks a poster once.)
    const rows = [focusRow];
    for (let r = top; r < top + MOVIES_ROWS; r += 1) rows.push(r);
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

  /**
   * Shows rail entry `i` with movie `place` focused (the focus engine clamps it to the new grid and
   * scrolls the view as little as it can: to the top for the first movie, and where it was for a
   * swap's kept place, so no step reads the top's chunks).
   */
  const showCategory = (i: number, place = 0): void => {
    const shown = screen.value;
    const picked = rail.value[i];
    if (shown === null || picked === undefined) return;
    category.value = i;
    held = picked.kind === 'recent' ? recent : null;
    index = new ChannelIndex(picked.parts);
    shown.update(gridZone(held === null ? index.count : held.length));
    shown.focus(MOVIES_GRID, place);
  };

  /** The stored sources, each one's movie categories, and the newest movies across them. */
  const readSources = async (): Promise<{ records: SourceRecord[]; lists: CategoryInfo[][]; newest: RecentItem[] }> => {
    const records = storedSources(await engine.profile());
    const ids: string[] = [];
    for (const r of records) ids.push(r.id);
    const read = await Promise.all([Promise.all(records.map((r) => engine.categories(r.id, MOVIE_KIND))), engine.recent({ sources: ids, kind: MOVIE_KIND })] as const);
    return { records, lists: read[0], newest: read[1] };
  };

  /** The rail entry on show, as a catalog swap finds it again (`null`: nothing yet). */
  const shownRef = (): MovieRef => {
    const shown = rail.value[category.value];
    if (shown === undefined) return null;
    if (shown.kind !== 'category') return shown.kind;
    const part = shown.parts[0];
    return part === undefined ? null : { src: part.src, name: shown.name };
  };

  /**
   * Reads the sources and their categories. `keep`: the category to show again (a catalog swap),
   * and the grid's place to focus there; without it, the loading screen first.
   */
  const load = (keep?: { readonly ref: MovieRef; readonly place: number }): void => {
    seq += 1;
    const mine = seq;
    loadingChunks.clear();
    if (keep === undefined) {
      status.value = 'loading';
      screen.value?.update(retryZone(0));
    }
    track(readSources).then(
      ({ records, lists, newest }) => {
        const shown = screen.value;
        if (disposed || mine !== seq || shown === null) return;
        const entries: MovieEntry[] = [];
        if (newest.length > 0) entries.push({ kind: 'recent', name: '', count: newest.length, parts: [], allStart: 0 });
        for (const entry of railEntries(records.map((r, i) => ({ src: r.id, categories: lists[i] ?? [] })))) entries.push(entry);
        // (A swap's old tiles show until here.)
        chunks.clear();
        recent = [];
        for (const r of newest) recent.push(r.item);
        held = null;
        rail.value = entries;
        shown.update(railZone(entries.length));
        if (entries.length === 0) {
          status.value = 'empty';
          shown.update(gridZone(0));
          bump();
          return;
        }
        status.value = 'ready';
        const ref = keep === undefined ? null : keep.ref;
        const found = ref === null ? 0 : findMovieEntry(entries, ref);
        const pick = Math.max(0, found);
        // The same category: the same place in it (the grid clamps it); another one: its first movie.
        const place = keep !== undefined && found !== -1 ? keep.place : 0;
        // A swap keeps the focus where it was: on the rail it stays there.
        const onRail = keep !== undefined && shown.active === MOVIES_RAIL;
        showCategory(pick, place);
        if (onRail) shown.focus(MOVIES_RAIL, pick);
        bump();
        // (Its chunks' arrival asks the posters: the load cleared them all. "Recently added" has
        // none to wait for: its posters come at the rest.)
        readView();
        if (held !== null) scheduleRest();
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
    stopRest();
    screen.value = null;
    chunks.clear();
    recent = [];
    held = null;
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
    // No poster starts while the keys go down: the ones still waiting wait for the next rest.
    posters.hold();
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
    progress(i: number): number | undefined {
      const kept = options.progress;
      if (kept === undefined) return undefined;
      // Read for the screen: a position saved since draws the tiles again.
      void kept.version.value;
      const item = movieAt(i);
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
      posters = new PosterLoader(POSTER_TIERS[tier()].parallel);
      // Back while it loads closes it (an old rail would send the focus there).
      rail.value = [];
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
      load({ ref: shownRef(), place: shown.position(MOVIES_GRID).index });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      seq += 1;
      stopRest();
      stopFollowing();
      chunks.clear();
      recent = [];
      held = null;
      posters.clear();
      syncPending();
    },
  };
}
