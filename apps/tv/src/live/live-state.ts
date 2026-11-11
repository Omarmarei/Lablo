import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey, ContentKind } from '@lablo/core';
import type { CategoryInfo, EpgNowNext, LoadedProfile, ShortEpgNowNext, ShortEpgSource, SourceRecord } from '@lablo/data';
import type { Platform } from '@lablo/platform-api';
import type { Focus, FocusBinding, Navigator, Screen, ScreenSpec, ZoneSpec } from '@lablo/ui';
import { LAYOUT, SCREEN, bindFocus, createNavigator, fits } from '@lablo/ui';
import type { FocusedChannel } from '../data/engine';
import { mark } from '../marks';
import type { ZapList } from '../player/player-state';
import { storedSources } from '../onboarding/engine-loader';
import type { ChunkRef, ListPart } from './channel-index';
import { ChannelIndex, chunkId } from './channel-index';

/**
 * The live browse screen (RELAY step 14a, PLAN 4.5): a category rail at the inline start and a
 * virtual channel list, on the shared data engine.
 *
 *   rail      ("All channels", then each source's live categories; OK shows one)
 *   channels  (the category's channels: a virtual list; OK opens the player, step 20a)
 *   retry     (one button, only when the categories couldn't be read)
 *   header    (the "Guide" and "Settings" buttons at the header's end, steps 23c and 22b2: UP
 *              from the first row of the rail, the list or "Try again"; DOWN or Back goes back
 *              where it came from)
 *
 * - **Data:** the profile gives the sources, the query worker each source's live categories. The
 *   list reads only the chunks the rows around the window need (`CHUNK_CACHE` kept), now/next for
 *   the rows on show (`GUIDE_DELAY_MS` after the window stops, and again each minute), and the
 *   focused channel's short EPG (`focusChannel`: asked after 600 ms of focus). Answers for a
 *   window, a category or a screen that moved on are dropped.
 * - **Keys:** LEFT/RIGHT between the rail and the list (mirrored in Arabic), CH+/CH− page the
 *   list, Back in the list goes to the rail, and Back on the rail follows the platform (an exit
 *   dialog on Tizen and in the browser, the launcher on webOS).
 * - `pending` counts the data requests in flight, the 600 ms focus wait included: 0 means the
 *   screen's workers are done with the database (the old-engine walk waits for it).
 * - **The player** (step 20a) zaps through the category on show: `list` reads its rows (whole
 *   chunks), finds a channel by number and asks now/next for channels the list never showed.
 * - **The start on the last channel** (step 20c1): the first load shows the category the last
 *   channel played from (`startCategory`), and `list.locate` finds the channel's row once the list
 *   is in, for the player that is already playing it.
 * - **Refreshes while it shows** (step 22a): after a guide swapped in (`guidesChanged`), now/next
 *   is asked again for the rows on show and the player's channels; each row keeps its answer
 *   until the new one comes. After a catalog swapped in (`catalogChanged`), the sources and
 *   categories are read again without the loading screen, on the same rail entry, and the focus
 *   finds its channel in the new list. `listChanging` tells the player first, while the old
 *   list can still be read.
 */

/** Sizes, all layout constants (no DOM measuring). live.css uses the same numbers. */
export const LIVE = {
  /** The content box inside the title-safe margins. */
  width: SCREEN.width - 2 * SCREEN.safeX,
  headerHeight: 56,
  headerGap: 24,
  railWidth: 440,
  railGap: 8,
  columnGap: 32,
  rowGap: 8,
} as const;

/** The rail's and the list's height: the safe area less the header. */
export const LIVE_BODY = SCREEN.height - 2 * SCREEN.safeY - LIVE.headerHeight - LIVE.headerGap;
export const RAIL_VISIBLE = fits(LIVE_BODY, LAYOUT.railHeight, LIVE.railGap);
export const CHANNELS_VISIBLE = fits(LIVE_BODY, LAYOUT.rowHeight, LIVE.rowGap);

/** Chunks (of up to 500 channels) the screen keeps; the query worker keeps its own 16. */
export const CHUNK_CACHE = 8;
/** How long the window must rest before now/next is asked for its rows (scrolling asks nothing). */
export const GUIDE_DELAY_MS = 200;
/** A row's now/next is asked again after this long, or once its programme has ended. */
export const GUIDE_TTL_MS = 5 * 60_000;
const MINUTE_MS = 60_000;
const LIVE_KIND: ContentKind = 'live';

/** One entry of the rail. */
export interface RailEntry {
  /** `all`: every category of every source, in order. */
  readonly kind: 'all' | 'category';
  /** The provider's category name (`''`: the playlist gave none). Unused for `all`. */
  readonly name: string;
  readonly count: number;
  /** The categories the entry lists. */
  readonly parts: readonly ListPart[];
  /** Where its channels start in "All channels": a channel without a number is numbered by it. */
  readonly allStart: number;
}

export type LiveStatus = 'loading' | 'ready' | 'empty' | 'failed';

/** A row of the list on show. */
export interface LiveRow {
  readonly item: CatalogItem;
  /** The provider's number (`tvg-chno`, Xtream `num`), else the channel's place in "All channels". */
  readonly number: number;
}

/** What the live screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface LiveEngine {
  profile(): Promise<LoadedProfile | null>;
  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]>;
  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]>;
  nowNext(keys: ContentKey[], at?: number): Promise<EpgNowNext[]>;
  focusChannel(channel: FocusedChannel | null): Promise<ShortEpgNowNext | null>;
  noteActivity(): void;
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LiveOptions {
  readonly platform: Pick<Platform, 'rootBackPolicy' | 'exitApp'>;
  readonly engine: LiveEngine;
  /** The wall clock in ms (now/next, the minute tick). */
  readonly now?: () => number;
  readonly timers?: Timers;
  /** The navigator's clock (the click pairing). */
  readonly navNow?: () => number;
  /** OK on row `index` of the list on show: the player opens it (step 20a). */
  readonly play?: (index: number) => void;
  /**
   * The category the first load shows: a source's by its name (the last channel's, step 20c1);
   * `null`, absent or gone: "All channels".
   */
  readonly startCategory?: RailRef;
  /**
   * A catalog swap is about to replace the list (step 22a): the player reads its rows from the
   * old list now, then finds them with `list.locate` (which waits for the new list).
   */
  readonly listChanging?: () => void;
  /** OK on the header's "Settings" button (step 22b2): the settings screen opens. */
  readonly openSettings?: () => void;
  /**
   * OK on the header's "Guide" button (step 23c), while the list has channels: the guide opens
   * on the category on show, on `row`, the list's focused row.
   */
  readonly openGuide?: (row: number) => void;
  /** OK on the header's "Movies" button (step 26a): the movies screen opens. */
  readonly openMovies?: () => void;
}

/** The list on show as the player (`ZapList`) and the guide (step 23c) read it. */
export interface LiveList extends ZapList {
  /** Settles once the newest load (the first, or a catalog swap's) has its categories, or failed. */
  ready(): Promise<void>;
}

/** A rail entry as the profile keeps it: a source's category by its name; `null` is "All channels". */
export type RailRef = { readonly src: string; readonly name: string } | null;

export interface Live {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly home: Screen;
  readonly status: ReadonlySignal<LiveStatus>;
  readonly rail: ReadonlySignal<readonly RailEntry[]>;
  /** The rail entry on show. */
  readonly category: ReadonlySignal<number>;
  /** Bumps when chunks or now/next arrive: rows are read again through `row` and `guide`. */
  readonly version: ReadonlySignal<number>;
  /** The clock at the last minute tick (programme bars, the header's time). */
  readonly clock: ReadonlySignal<number>;
  /** Data requests in flight (the focus wait included). */
  readonly pending: ReadonlySignal<number>;
  /** The channel OK last picked (the player opens it). */
  readonly selected: ReadonlySignal<ContentKey | null>;
  /** The list on show, for the player's zapping and number entry, and the guide's rows. */
  readonly list: LiveList;
  readonly exitRequested: ReadonlySignal<boolean>;
  /** Row `index` of the list on show, or `null` while its chunk loads. */
  row(index: number): LiveRow | null;
  /** A channel's now/next (`undefined`: not asked yet). */
  guide(key: ContentKey): EpgNowNext | undefined;
  /** Focuses row `index` of the list (the channel the player played last). */
  focusRow(index: number): void;
  /** The rail entry on show as the profile keeps it (`null`: "All channels", or nothing yet). */
  shownCategory(): RailRef;
  /** A remote key was pressed (a running refresh pauses). */
  activity(): void;
  /** Reads the sources and categories again (the failure screen's "Try again"). */
  reload(): void;
  /** A guide swapped in (step 22a): now/next is asked again. */
  guidesChanged(): void;
  /** A catalog swapped in (step 22a): the list is read again where it stands. */
  catalogChanged(): void;
  dispose(): void;
}

interface GuideEntry {
  readonly value: EpgNowNext;
  /** When it was asked (a field named `at` would pull core-js's Array/String `at` into main). */
  readonly asked: number;
  /** The guides' epoch it was asked in: an older one is asked again (step 22a). */
  readonly epoch: number;
}

/** The player's channels kept fresh beside the rows on show (the info bar's, the previous one…). */
const EXTRA_GUIDES = 4;

const BUTTONS: ScreenSpec['zones'] = [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }];

function railZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'rail', axis: 'vertical', count, visible: RAIL_VISIBLE, neighbours: { end: 'channels', up: 'header' } };
}

function channelsZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'channels', axis: 'vertical', count, visible: CHANNELS_VISIBLE, neighbours: { start: 'rail', up: 'header' } };
}

function retryZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'retry', axis: 'horizontal', count, neighbours: { up: 'header' } };
}

/** The header's buttons: "Guide" (step 23c), "Movies" (step 26a), then "Settings" (step 22b2). DOWN is the screen's (back where it came from). */
const HEADER_ZONE: ZoneSpec = { kind: 'list', id: 'header', axis: 'horizontal', count: 3 };
/** The header's "Guide" button. */
export const HEADER_GUIDE = 0;
/** The header's "Movies" button. */
export const HEADER_MOVIES = 1;
/** The header's "Settings" button. */
export const HEADER_SETTINGS = 2;

/** The rail: "All channels", then every category with channels, source by source. */
export function railEntries(sources: readonly { src: string; categories: readonly CategoryInfo[] }[]): RailEntry[] {
  const categories: RailEntry[] = [];
  const all: ListPart[] = [];
  let at = 0;
  for (const source of sources) {
    for (const info of source.categories) {
      if (info.count <= 0) continue;
      const part: ListPart = { src: source.src, catIdx: info.catIdx, chunks: info.chunks.slice() };
      all.push(part);
      categories.push({ kind: 'category', name: info.name, count: info.count, parts: [part], allStart: at });
      at += info.count;
    }
  }
  if (at === 0) return [];
  const every: RailEntry = { kind: 'all', name: '', count: at, parts: all, allStart: 0 };
  return [every].concat(categories);
}

/** The entry of `entries` that `ref` names: a category of that source with that name (`-1`: none). */
export function findEntry(entries: readonly RailEntry[], ref: NonNullable<RailRef>): number {
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    if (e.kind === 'category' && e.name === ref.name && e.parts[0]?.src === ref.src) return i;
  }
  return -1;
}

/** The source a focused channel's short EPG is asked through (its panel's login, or its link). */
function epgSourceOf(record: SourceRecord): ShortEpgSource {
  return record.type === 'xtream' ? { type: 'xtream', account: record.account } : { type: 'm3u', url: record.url };
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createLive(options: LiveOptions): Live {
  const { platform, engine } = options;
  const clockNow = options.now ?? (() => Date.now());
  const timers = options.timers ?? defaultTimers;

  const status = signal<LiveStatus>('loading');
  const rail = signal<readonly RailEntry[]>([]);
  const category = signal(0);
  const version = signal(0);
  const clock = signal(clockNow());
  const pending = signal(0);
  const selected = signal<ContentKey | null>(null);
  const exitRequested = signal(false);

  let disposed = false;
  /** Bumps on each (re)load: answers of an older load are dropped. */
  let loadSeq = 0;
  /** Settles when the newest load has its categories, or failed. */
  let loaded: Promise<void> = Promise.resolve();
  /** The category the first load that succeeds shows. */
  let wantCategory: RailRef = options.startCategory ?? null;
  let sources = new Map<string, ShortEpgSource>();
  let index = new ChannelIndex([]);
  /** Loaded chunks, oldest use first (a Map keeps insertion order). */
  const chunks = new Map<string, CatalogItem[]>();
  /** Chunk reads running, with the load they belong to. */
  const loadingChunks = new Map<string, { readonly seq: number; readonly done: Promise<void> }>();
  const guides = new Map<ContentKey, GuideEntry>();
  const askingGuides = new Map<ContentKey, number>();
  /** Bumps when a guide swaps in: every answer from before is stale. */
  let guideEpoch = 0;
  /** Channels the player asked for (`askGuide`), newest last: kept fresh with the rows on show. */
  const extraGuides: ContentKey[] = [];
  let guideTimer: unknown = null;
  let minuteTimer: unknown = null;
  /** The channel the short EPG was last asked for (`null`: none). */
  let focusedKey: ContentKey | null = null;
  /** The zone under the header the focus was in last: DOWN from the header goes back to it. */
  let lastBody = 'channels';

  const bump = (): void => {
    version.value += 1;
  };

  /** Runs `request`, counting it in `pending` until it settles either way. */
  function track<T>(request: () => Promise<T>): Promise<T> {
    pending.value += 1;
    let running: Promise<T>;
    try {
      running = request();
    } catch (error) {
      running = Promise.reject(error);
    }
    const done = (): void => {
      pending.value -= 1;
    };
    running.then(done, done);
    return running;
  }

  const entry = (): RailEntry | undefined => rail.value[category.value];

  const rowAt = (i: number): LiveRow | null => {
    const at = index.locate(i);
    if (at === null) return null;
    const item = chunks.get(chunkId(at))?.[at.slot];
    if (item === undefined) return null;
    const start = entry()?.allStart ?? 0;
    return { item, number: item.chno !== null ? item.chno : start + i + 1 };
  };

  /** The rows the window shows, and one window either side of it (read ahead). */
  const wanted = (): { from: number; to: number; showFrom: number; showTo: number } => {
    const top = Math.max(0, home.position('channels').top);
    return { from: top - CHANNELS_VISIBLE, to: top + 2 * CHANNELS_VISIBLE, showFrom: top, showTo: top + CHANNELS_VISIBLE };
  };

  /** Reads chunk `ref` for load `seq`, or joins its read already running; settles once it is in. */
  const loadChunk = (ref: ChunkRef, seq: number): Promise<void> => {
    const id = chunkId(ref);
    const running = loadingChunks.get(id);
    if (running !== undefined && running.seq === seq) return running.done;
    let done: Promise<void> | null = null;
    const mine = (): boolean => loadingChunks.get(id)?.done === done;
    done = track(() => engine.chunk(ref.src, LIVE_KIND, ref.catIdx, ref.chunk)).then(
      (items) => {
        if (!mine()) return;
        loadingChunks.delete(id);
        if (disposed || seq !== loadSeq) return;
        chunks.set(id, items);
        bump();
        afterChange();
      },
      (error: unknown) => {
        if (mine()) loadingChunks.delete(id);
        // The next move of the window asks again.
        if (!disposed) console.warn('A channel chunk could not be read', error);
      },
    );
    loadingChunks.set(id, { seq, done });
    return done;
  };

  /** Keeps the chunks the window needs and drops the least recently used beyond `CHUNK_CACHE`. */
  const keepChunks = (needed: readonly ChunkRef[]): void => {
    const keep = needed.map(chunkId);
    for (const id of keep) {
      const items = chunks.get(id);
      if (items !== undefined) {
        // Refresh its place in the use order.
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

  const guideStale = (key: ContentKey, now: number): boolean => {
    const known = guides.get(key);
    if (known === undefined || known.epoch !== guideEpoch) return true;
    if (now - known.asked >= GUIDE_TTL_MS) return true;
    const on = known.value.now;
    return on !== null && on.end * MINUTE_MS <= now;
  };

  /** Asks now/next for the rows on show whose answer is missing or old. */
  const askGuides = (): void => {
    guideTimer = null;
    if (disposed || status.value !== 'ready') return;
    const now = clockNow();
    const { showFrom, showTo } = wanted();
    const keys: ContentKey[] = [];
    for (let i = showFrom; i < showTo; i += 1) {
      const row = rowAt(i);
      if (row === null || row.item.kind !== LIVE_KIND) continue;
      const key = row.item.key;
      if (askingGuides.has(key) || keys.indexOf(key) !== -1 || !guideStale(key, now)) continue;
      keys.push(key);
    }
    for (const key of extraGuides) if (!askingGuides.has(key) && keys.indexOf(key) === -1 && guideStale(key, now)) keys.push(key);
    requestGuides(keys, now);
  };

  /** Asks now/next for `keys` (none of them asked already). */
  const requestGuides = (keys: ContentKey[], now: number): void => {
    if (keys.length === 0) return;
    const seq = loadSeq;
    const epoch = guideEpoch;
    for (const key of keys) askingGuides.set(key, seq);
    track(() => engine.nowNext(keys, now)).then(
      (answers) => {
        for (const key of keys) if (askingGuides.get(key) === seq) askingGuides.delete(key);
        if (disposed || seq !== loadSeq) return;
        for (const answer of answers) guides.set(answer.key, { value: answer, asked: now, epoch });
        bump();
        // Asked before a guide swapped in: shown until the newer answer comes.
        if (epoch !== guideEpoch) scheduleGuides();
      },
      (error: unknown) => {
        for (const key of keys) if (askingGuides.get(key) === seq) askingGuides.delete(key);
        if (!disposed) console.warn('Now and next could not be read', error);
      },
    );
  };

  const scheduleGuides = (): void => {
    if (guideTimer !== null) timers.clear(guideTimer);
    guideTimer = timers.set(askGuides, GUIDE_DELAY_MS);
  };

  /** The focused channel's short EPG (the data engine waits 600 ms and drops what moved on). */
  const followFocus = (focus: Focus): void => {
    const row = focus.screen === 'live' && focus.zone === 'channels' && status.value === 'ready' ? rowAt(focus.index) : null;
    const item = row !== null && row.item.kind === LIVE_KIND ? row.item : null;
    const source = item === null ? undefined : sources.get(item.src);
    const key = item !== null && source !== undefined ? item.key : null;
    if (key === focusedKey) return;
    focusedKey = key;
    if (item === null || source === undefined) {
      void engine.focusChannel(null);
      return;
    }
    const seq = loadSeq;
    const epoch = guideEpoch;
    track(() => engine.focusChannel({ key: item.key, url: item.url, source })).then(
      (answer) => {
        // A panel's answer for a channel no guide matches: the row shows it.
        if (answer === null || disposed || seq !== loadSeq || answer.from !== 'panel') return;
        guides.set(answer.key, { value: answer, asked: clockNow(), epoch });
        bump();
      },
      (error: unknown) => {
        if (!disposed) console.warn("The channel's short guide could not be read", error);
      },
    );
  };

  /**
   * Leaves the header for the zone it came from, on its item (the pointer may have taken the
   * focus there from any row); `false` while that zone is empty (the screen is loading: a load
   * that ends puts the focus on the list or on "Try again" by itself).
   */
  const leaveHeader = (): boolean => {
    if ((home.zone(lastBody) as { count: number }).count === 0) return false;
    home.focus(lastBody, home.position(lastBody).index);
    return true;
  };

  /** After a key, a click or new data: read what the window needs, follow the focus. */
  function afterChange(): void {
    if (disposed) return;
    if (status.value === 'ready') {
      const { from, to } = wanted();
      const needed = index.chunksFor(from, to);
      keepChunks(needed);
      const seq = loadSeq;
      for (const ref of needed) {
        const id = chunkId(ref);
        if (!chunks.has(id) && loadingChunks.get(id)?.seq !== seq) void loadChunk(ref, seq);
      }
      scheduleGuides();
    }
    followFocus(nav.snapshot());
  }

  /** Row `i` of the list on show, reading its chunk when needed (the player's zapping). */
  const loadRow = (i: number): Promise<LiveRow | null> => {
    const known = rowAt(i);
    if (known !== null) return Promise.resolve(known);
    const at = index.locate(i);
    if (at === null || disposed || status.value !== 'ready') return Promise.resolve(null);
    return loadChunk(at, loadSeq).then(() => rowAt(i));
  };

  /**
   * The first row of the list on show that `test` takes (`-1`: none), reading the chunk of row
   * `from` first, then every chunk from that one outwards: a cached chunk costs nothing, any
   * other one read. `-1` too when the list changed meanwhile.
   */
  const findRow = async (from: number, test: (item: CatalogItem, row: number, shown: RailEntry) => boolean): Promise<number> => {
    const shown = entry();
    if (shown === undefined || status.value !== 'ready' || index.count === 0) return -1;
    const seq = loadSeq;
    const list = index;
    // A row before the first has no chunk: the search then starts at the first.
    const guess = Math.min(from, list.count - 1);
    const refs = list.chunksFor(0, list.count);
    const home = list.locate(guess);
    let first = 0;
    for (let i = 0; i < refs.length; i += 1) if (home !== null && chunkId(refs[i]!) === chunkId(home)) first = i;
    const order: ChunkRef[] = [];
    for (let d = 0; d < refs.length; d += 1) {
      if (first + d < refs.length) order.push(refs[first + d]!);
      if (d > 0 && first - d >= 0) order.push(refs[first - d]!);
    }
    for (const ref of order) {
      const items = chunks.get(chunkId(ref)) ?? (await track(() => engine.chunk(ref.src, LIVE_KIND, ref.catIdx, ref.chunk)));
      if (disposed || seq !== loadSeq || list !== index) return -1;
      const start = list.firstRow(ref);
      for (let slot = 0; slot < items.length; slot += 1) if (test(items[slot]!, start + slot, shown)) return start + slot;
    }
    return -1;
  };

  /**
   * The row of the channel numbered `n` in the list on show (`-1`: none), for the player's number
   * entry. A row's number is its provider's (`chno`), else its place in "All channels", so the
   * search starts at the row that place gives.
   */
  const findNumber = (n: number): Promise<number> => {
    const shown = entry();
    if (shown === undefined || !(n > 0)) return Promise.resolve(-1);
    return findRow(n - 1 - shown.allStart, (item, row, on) => (item.chno !== null ? item.chno : on.allStart + row + 1) === n);
  };

  /**
   * The row of the channel `key` in the list on show (`-1`: not in it), once the load running now
   * is done: the start's player is already playing it (step 20c1). The search starts at `guess`,
   * its row when it last played.
   */
  const locate = async (key: ContentKey, guess: number): Promise<number> => {
    await loaded;
    return findRow(guess, (item) => item.key === key);
  };

  /** Now/next for one channel the list didn't ask (the player's info bar); kept fresh from then on. */
  const askGuide = (key: ContentKey): void => {
    const known = extraGuides.indexOf(key);
    if (known !== -1) extraGuides.splice(known, 1);
    extraGuides.push(key);
    if (extraGuides.length > EXTRA_GUIDES) extraGuides.shift();
    if (disposed || askingGuides.has(key) || !guideStale(key, clockNow())) return;
    requestGuides([key], clockNow());
  };

  const list: LiveList = {
    ready: () => loaded,
    count: () => (status.value === 'ready' ? index.count : 0),
    row: rowAt,
    load: loadRow,
    find: findNumber,
    locate,
    guide: (key) => guides.get(key)?.value,
    askGuide,
  };

  const showCategory = (i: number): void => {
    const picked = rail.value[i];
    if (picked === undefined) return;
    category.value = i;
    index = new ChannelIndex(picked.parts);
    // Back to the top first, so no step reads chunks for the old window in the new list.
    home.reset('channels');
    home.update(channelsZone(index.count));
    home.focus('channels', 0);
  };

  const tick = (): void => {
    const now = clockNow();
    clock.value = now;
    minuteTimer = timers.set(tick, MINUTE_MS - (now % MINUTE_MS));
    if (status.value === 'ready') askGuides();
  };

  /** A new load starts: `loaded` waits for it; call the result once its categories are in (or failed). */
  const nextLoad = (): (() => void) => {
    loadSeq += 1;
    let settle: () => void = () => undefined;
    loaded = new Promise<void>((resolve) => {
      settle = resolve;
    });
    return settle;
  };

  /** The stored sources and each one's live categories. */
  const readSources = async (): Promise<{ records: SourceRecord[]; lists: CategoryInfo[][] }> => {
    const records = storedSources(await engine.profile());
    const lists = await Promise.all(records.map((r) => engine.categories(r.id, LIVE_KIND)));
    return { records, lists };
  };

  /** Takes the sources read: their short-EPG logins and the rail (the list isn't touched). */
  const takeSources = (records: readonly SourceRecord[], lists: readonly CategoryInfo[][]): RailEntry[] => {
    sources = new Map<string, ShortEpgSource>();
    for (const record of records) sources.set(record.id, epgSourceOf(record));
    const entries = railEntries(records.map((r, i) => ({ src: r.id, categories: lists[i] ?? [] })));
    rail.value = entries;
    home.update(railZone(entries.length));
    return entries;
  };

  const loadFailed = (error: unknown): void => {
    console.warn('The live categories could not be read', error);
    status.value = 'failed';
    home.update(retryZone(1));
    home.focus('retry', 0);
  };

  const load = (): void => {
    const settle = nextLoad();
    const seq = loadSeq;
    status.value = 'loading';
    chunks.clear();
    guides.clear();
    home.update(retryZone(0));
    track(readSources).then(
      ({ records, lists }) => {
        if (disposed || seq !== loadSeq) {
          settle();
          return;
        }
        const entries = takeSources(records, lists);
        status.value = entries.length > 0 ? 'ready' : 'empty';
        if (wantCategory !== null) category.value = Math.max(0, findEntry(entries, wantCategory));
        wantCategory = null;
        if (entries.length > 0) showCategory(Math.min(category.value, entries.length - 1));
        else home.update(channelsZone(0));
        mark('lablo:live-ready');
        settle();
        afterChange();
      },
      (error: unknown) => {
        settle();
        if (disposed || seq !== loadSeq) return;
        loadFailed(error);
      },
    );
  };

  /** The rail entry on show as the profile keeps it (`null`: "All channels", or nothing yet). */
  const shownCategory = (): RailRef => {
    const shown = entry();
    const part = shown === undefined || shown.kind === 'all' ? undefined : shown.parts[0];
    return part === undefined || shown === undefined ? null : { src: part.src, name: shown.name };
  };

  /**
   * A catalog swapped in (step 22a): the sources and categories are read again without the
   * loading screen. The rail entry on show stays (by name; "All channels" when it is gone), and
   * the focused channel's row is found in the new list, unless the focus moved meanwhile. A
   * screen still loading, or failed, loads again.
   */
  const catalogChanged = (): void => {
    if (disposed) return;
    if (status.value === 'loading' || status.value === 'failed') {
      load();
      return;
    }
    const settle = nextLoad();
    const seq = loadSeq;
    const keep = shownCategory();
    track(readSources).then(
      ({ records, lists }) => {
        // (dispose bumps `loadSeq` too.)
        if (seq !== loadSeq) {
          settle();
          return;
        }
        // Where the focus stands, read from the old list before it goes.
        const place = home.position('channels').index;
        const key = rowAt(place)?.item.key ?? null;
        options.listChanging?.();
        const entries = takeSources(records, lists);
        chunks.clear();
        if (entries.length === 0) {
          // The old index stays, unread: nothing reads an index while the screen is empty.
          status.value = 'empty';
          home.update(channelsZone(0));
        } else {
          status.value = 'ready';
          const pick = keep === null ? 0 : Math.max(0, findEntry(entries, keep));
          category.value = pick;
          index = new ChannelIndex(entries[pick]!.parts);
          home.update(channelsZone(index.count));
        }
        // (No bump: the new rail redraws the screen, and each chunk read bumps.)
        settle();
        afterChange();
        // No channel there (a list that was empty): nothing to look for in every chunk.
        if (key === null) return;
        findRow(place, (item) => item.key === key).then(
          (found) => {
            // Gone from the list (or a newer load came), or the focus is elsewhere now: it stays.
            if (found === -1 || home.active !== 'channels' || home.position('channels').index !== place) return;
            home.focus('channels', found);
          },
          () => undefined,
        );
      },
      (error: unknown) => {
        settle();
        if (seq !== loadSeq) return;
        loadFailed(error);
      },
    );
  };

  /**
   * A guide swapped in (step 22a): every answer is stale; the rows on show keep theirs until
   * asked again (`askGuides` asks nothing while the screen isn't ready, or once disposed).
   */
  const guidesChanged = (): void => {
    guideEpoch += 1;
    scheduleGuides();
  };

  const nav = createNavigator({
    root: {
      id: 'live',
      zones: [railZone(0), channelsZone(0), retryZone(0), HEADER_ZONE],
      initial: 'channels',
      onIntent: (intent, focus) => {
        // Back in the list goes to the rail, on the category on show.
        if (intent === 'BACK' && focus.zone === 'channels' && rail.value.length > 0) {
          home.focus('rail', category.value);
          return true;
        }
        // DOWN or Back in the header: back to the zone the focus came from.
        if ((intent === 'DOWN' || intent === 'BACK') && focus.zone === 'header') return leaveHeader();
        return false;
      },
      onSelect: (focus) => {
        if (focus.zone === 'header') {
          if (focus.index === HEADER_SETTINGS) options.openSettings?.();
          // The movies screen reads its own data: it opens in every state of the list.
          else if (focus.index === HEADER_MOVIES) options.openMovies?.();
          // The guide shows the list's channels: none while it loads, failed or is empty.
          else if (status.value === 'ready') options.openGuide?.(home.position('channels').index);
        } else if (focus.zone === 'rail') showCategory(focus.index);
        else if (focus.zone === 'retry') load();
        else if (focus.zone === 'channels') {
          const row = rowAt(focus.index);
          if (row !== null) selected.value = row.item.key;
          if (options.play !== undefined && focus.index >= 0 && focus.index < index.count) options.play(focus.index);
        }
      },
    },
    rootBack: platform.rootBackPolicy(),
    now: options.navNow,
    exit: () => {
      exitRequested.value = true;
      platform.exitApp();
    },
    exitDialog: () => {
      nav.push({
        id: 'exit',
        zones: BUTTONS,
        onSelect: (focus) => {
          // The browser can't close its tab, so the dialog closes either way.
          if (focus.index === 1) {
            exitRequested.value = true;
            platform.exitApp();
          }
          nav.pop();
        },
      });
    },
  });
  const home = nav.top;
  const stopFollowing = nav.subscribe((focus) => {
    if (focus.screen === 'live' && focus.zone !== 'header') lastBody = focus.zone;
    afterChange();
  });
  const binding = bindFocus(nav);

  load();
  minuteTimer = timers.set(tick, MINUTE_MS - (clockNow() % MINUTE_MS));

  return {
    nav,
    binding,
    home,
    status,
    rail,
    category,
    version,
    clock,
    pending,
    selected,
    exitRequested,
    list,
    row: rowAt,
    guide: (key) => guides.get(key)?.value,
    focusRow: (i) => home.focus('channels', i),
    shownCategory,
    activity: () => engine.noteActivity(),
    reload: load,
    guidesChanged,
    catalogChanged,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loadSeq += 1;
      if (guideTimer !== null) timers.clear(guideTimer);
      if (minuteTimer !== null) timers.clear(minuteTimer);
      guideTimer = null;
      minuteTimer = null;
      stopFollowing();
      binding.dispose();
      if (focusedKey !== null) void engine.focusChannel(null);
      focusedKey = null;
    },
  };
}
