import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey, ContentKind } from '@zoma/core';
import type { CategoryInfo, EpgNowNext, LoadedProfile, ShortEpgNowNext, ShortEpgSource, SourceRecord } from '@zoma/data';
import type { Platform } from '@zoma/platform-api';
import type { Focus, FocusBinding, Navigator, Screen, ScreenSpec, ZoneSpec } from '@zoma/ui';
import { LAYOUT, SCREEN, bindFocus, createNavigator, fits } from '@zoma/ui';
import type { FocusedChannel } from '../data/engine';
import { storedSources } from '../onboarding/engine-loader';
import type { ChunkRef, ListPart } from './channel-index';
import { ChannelIndex, chunkId } from './channel-index';

/**
 * The live browse screen (RELAY step 14a, PLAN 4.5): a category rail at the inline start and a
 * virtual channel list, on the shared data engine.
 *
 *   rail      ("All channels", then each source's live categories; OK shows one)
 *   channels  (the category's channels: a virtual list; OK is where the player plugs in)
 *   retry     (one button, only when the categories couldn't be read)
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
}

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
  /** The channel OK last picked (the player opens it from step 20 on). */
  readonly selected: ReadonlySignal<ContentKey | null>;
  readonly exitRequested: ReadonlySignal<boolean>;
  /** Row `index` of the list on show, or `null` while its chunk loads. */
  row(index: number): LiveRow | null;
  /** A channel's now/next (`undefined`: not asked yet). */
  guide(key: ContentKey): EpgNowNext | undefined;
  /** A remote key was pressed (a running refresh pauses). */
  activity(): void;
  /** Reads the sources and categories again (the failure screen's "Try again"). */
  reload(): void;
  dispose(): void;
}

interface GuideEntry {
  readonly value: EpgNowNext;
  /** When it was asked (a field named `at` would pull core-js's Array/String `at` into main). */
  readonly asked: number;
}

const BUTTONS: ScreenSpec['zones'] = [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }];

function railZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'rail', axis: 'vertical', count, visible: RAIL_VISIBLE, neighbours: { end: 'channels' } };
}

function channelsZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'channels', axis: 'vertical', count, visible: CHANNELS_VISIBLE, neighbours: { start: 'rail' } };
}

function retryZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'retry', axis: 'horizontal', count };
}

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
  let sources = new Map<string, ShortEpgSource>();
  let index = new ChannelIndex([]);
  /** Loaded chunks, oldest use first (a Map keeps insertion order). */
  const chunks = new Map<string, CatalogItem[]>();
  const loadingChunks = new Map<string, number>();
  const guides = new Map<ContentKey, GuideEntry>();
  const askingGuides = new Map<ContentKey, number>();
  let guideTimer: unknown = null;
  let minuteTimer: unknown = null;
  /** The channel the short EPG was last asked for (`null`: none). */
  let focusedKey: ContentKey | null = null;

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

  const loadChunk = (ref: ChunkRef, seq: number): void => {
    const id = chunkId(ref);
    loadingChunks.set(id, seq);
    track(() => engine.chunk(ref.src, LIVE_KIND, ref.catIdx, ref.chunk)).then(
      (items) => {
        if (loadingChunks.get(id) !== seq) return;
        loadingChunks.delete(id);
        if (disposed || seq !== loadSeq) return;
        chunks.set(id, items);
        bump();
        afterChange();
      },
      (error: unknown) => {
        if (loadingChunks.get(id) === seq) loadingChunks.delete(id);
        // The next move of the window asks again.
        if (!disposed) console.warn('A channel chunk could not be read', error);
      },
    );
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
    if (known === undefined) return true;
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
    if (keys.length === 0) return;
    const seq = loadSeq;
    for (const key of keys) askingGuides.set(key, seq);
    track(() => engine.nowNext(keys, now)).then(
      (answers) => {
        for (const key of keys) if (askingGuides.get(key) === seq) askingGuides.delete(key);
        if (disposed || seq !== loadSeq) return;
        for (const answer of answers) guides.set(answer.key, { value: answer, asked: now });
        bump();
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
    track(() => engine.focusChannel({ key: item.key, url: item.url, source })).then(
      (answer) => {
        // A panel's answer for a channel no guide matches: the row shows it.
        if (answer === null || disposed || seq !== loadSeq || answer.from !== 'panel') return;
        guides.set(answer.key, { value: answer, asked: clockNow() });
        bump();
      },
      (error: unknown) => {
        if (!disposed) console.warn("The channel's short guide could not be read", error);
      },
    );
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
        if (!chunks.has(id) && loadingChunks.get(id) !== seq) loadChunk(ref, seq);
      }
      scheduleGuides();
    }
    followFocus(nav.snapshot());
  }

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

  const load = (): void => {
    loadSeq += 1;
    const seq = loadSeq;
    status.value = 'loading';
    chunks.clear();
    guides.clear();
    home.update(retryZone(0));
    track(async () => {
      const records = storedSources(await engine.profile());
      const lists = await Promise.all(records.map((r) => engine.categories(r.id, LIVE_KIND)));
      return { records, lists };
    }).then(
      ({ records, lists }) => {
        if (disposed || seq !== loadSeq) return;
        sources = new Map<string, ShortEpgSource>();
        for (const record of records) sources.set(record.id, epgSourceOf(record));
        const entries = railEntries(records.map((r, i) => ({ src: r.id, categories: lists[i] ?? [] })));
        rail.value = entries;
        home.update(railZone(entries.length));
        status.value = entries.length > 0 ? 'ready' : 'empty';
        if (entries.length > 0) showCategory(Math.min(category.value, entries.length - 1));
        else home.update(channelsZone(0));
        afterChange();
      },
      (error: unknown) => {
        if (disposed || seq !== loadSeq) return;
        console.warn('The live categories could not be read', error);
        status.value = 'failed';
        home.update(retryZone(1));
        home.focus('retry', 0);
      },
    );
  };

  const nav = createNavigator({
    root: {
      id: 'live',
      zones: [railZone(0), channelsZone(0), retryZone(0)],
      initial: 'channels',
      onIntent: (intent, focus) => {
        // Back in the list goes to the rail, on the category on show.
        if (intent === 'BACK' && focus.screen === 'live' && focus.zone === 'channels' && rail.value.length > 0) {
          home.focus('rail', category.value);
          return true;
        }
        return false;
      },
      onSelect: (focus) => {
        if (focus.zone === 'rail') showCategory(focus.index);
        else if (focus.zone === 'retry') load();
        else if (focus.zone === 'channels') {
          const row = rowAt(focus.index);
          if (row !== null) selected.value = row.item.key;
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
  const stopFollowing = nav.subscribe(() => afterChange());
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
    row: rowAt,
    guide: (key) => guides.get(key)?.value,
    activity: () => engine.noteActivity(),
    reload: load,
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
