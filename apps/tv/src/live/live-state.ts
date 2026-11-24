import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey, ContentKind } from '@lablo/core';
import type { CategoryInfo, EpgNowNext, LoadedProfile, ShortEpgNowNext, ShortEpgSource, StoredSource } from '@lablo/data';
import type { FavouriteList, GroupRef, KeyItemsRequest, LockState, NumberRequest, NumberedChannel } from '@lablo/data/client';
import { channelEditsOf, favouriteListsOf, groupId, groupOrderOf, hiddenGroupsOf } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';
import type { Focus, FocusBinding, Navigator, Screen, ScreenSpec, ZoneSpec } from '@lablo/ui';
import { LAYOUT, SCREEN, bindFocus, createNavigator, fits } from '@lablo/ui';
import type { FocusedChannel } from '../data/engine';
import { mark } from '../marks';
import type { ZapList } from '../player/player-state';
import { storedSources } from '../onboarding/engine-loader';
import type { ChunkRef, ListPart } from './channel-index';
import { ChannelIndex, chunkId, storedOffset } from './channel-index';

/**
 * The live browse screen (RELAY step 14a, PLAN 4.5): a category rail at the inline start and a
 * virtual channel list, on the shared data engine.
 *
 *   rail      ("All channels", then each source's live categories; OK shows one)
 *   channels  (the category's channels: a virtual list; OK opens the player, step 20a)
 *   retry     (one button, only when the categories couldn't be read)
 *   header    ("Guide", "Movies", "Series", "Home", then the icons "Search" and "Settings" at
 *              the header's end, steps 23c, 26a, 27a, 28b1, 28a and 22b2: UP from the first row
 *              of the rail, the list or "Try again"; DOWN or Back goes back where it came from)
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
 * - **A channel the search found** (step 28a, `playFound`): the list shows its category, on its
 *   row, and the player opens it, so CH+/CH− zap through its group. **A channel played last**
 *   (step 28b2, `playKept`, Home's "Recent channels"): the same, from the category it played from
 *   by name ("All channels" when that is gone), its row then first.
 * - **Refreshes while it shows** (step 22a): after a guide swapped in (`guidesChanged`), now/next
 *   is asked again for the rows on show and the player's channels; each row keeps its answer
 *   until the new one comes. After a catalog swapped in (`catalogChanged`), the sources and
 *   categories are read again without the loading screen, on the same rail entry, and the focus
 *   finds its channel in the new list. `listChanging` tells the player first, while the old
 *   list can still be read.
 * - **Favourites lists and groups** (step 35c): the rail is "All channels", the profile's lists,
 *   then the groups (the user's order first, then the provider's), hidden ones left out of the
 *   rail and of "All channels". A list's rows are its items read by key (`itemsByKey`), each
 *   numbered by its place in the list; a group's channel keeps the number of the provider's whole
 *   list (`ListPart.first`). After a list edit, `listsChanged` reads the profile again.
 * - **A channel of a hidden group** (step 35d): a search hit or a recent channel there plays over
 *   the list on show (`playOver`: the player pins it at the list's focused row), numbered by its
 *   `chno`, else its place in the provider's whole list (a search hit) or the kept number.
 * - **Channels the user changed** (step 36b; the query worker serves them changed, step 36a2): a
 *   hidden channel is no row of "All channels" or its group (a group with every channel hidden
 *   isn't in the rail), but keeps its place, so no other channel's number moves (`ListPart.hidden`).
 *   Number entry asks the worker for the channel the user numbered first (`numbered`), then looks
 *   for the provider's number as before. A hidden channel from the search, Home or number entry
 *   plays over the list, as a hidden group's does. After an edit, `channelsChanged` reads
 *   everything again, as a catalog swap does.
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
  /**
   * `all`: every category of every source the rail shows, in its order; `list`: a favourites list
   * (step 35c); `locked`: the last entry while something is locked (step 38b: "Locked groups", or
   * "Lock again" once unlocked).
   */
  readonly kind: 'all' | 'category' | 'list' | 'locked';
  /** The provider's category name (`''`: the playlist gave none); a list's name (`''`: "Favourites"). Unused for `all`. */
  readonly name: string;
  /** Its channels; a list's size (its keys, found or not). */
  readonly count: number;
  /** The categories the entry lists (none for a list). */
  readonly parts: readonly ListPart[];
  /** Where a category's channels start in the provider's whole list: a channel without a number is numbered by it. */
  readonly allStart: number;
  /** The favourites list (`list` entries only). */
  readonly list?: FavouriteList;
  /** Its source's name, when another source has a group of the same name on the rail (step 36d; `category` entries only). */
  readonly source?: string;
  /** A locked group shown in an unlocked session (step 38b; `category` entries only): its chip has an open lock. */
  readonly opened?: true;
  /** The `locked` entry: the session is unlocked ("Lock again"). */
  readonly unlocked?: boolean;
}

/** Parental control as a rail reads it (step 38b): the session unlocked, and whether the screen's kind has anything locked. */
export interface RailLocks {
  readonly unlocked: boolean;
  /** The rail ends with the `locked` entry. */
  readonly entry: boolean;
}

/** The session as `lockState` says when it can't be read: locked, with no entry. */
export const NO_LOCKS: RailLocks = { unlocked: false, entry: false };

/** A source as the rail reads it: its id, its name (step 36d: the tag on a same-named group; none: no tag) and its categories. */
export interface RailSource {
  readonly src: string;
  readonly name?: string;
  readonly categories: readonly CategoryInfo[];
}

/** The user's lists and groups the rail follows (step 35c; the movies screen has none). */
export interface RailShape {
  readonly lists: readonly FavouriteList[];
  readonly hidden: readonly GroupRef[];
  readonly order: readonly GroupRef[];
}

export type LiveStatus = 'loading' | 'ready' | 'empty' | 'failed';

/** A row of the list on show. */
export interface LiveRow {
  readonly item: CatalogItem;
  /**
   * The provider's number (`tvg-chno`, Xtream `num`), else the channel's place in the provider's
   * whole list; in a favourites list, its place in the list (step 35c).
   */
  readonly number: number;
}

/** What the live screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface LiveEngine {
  profile(): Promise<LoadedProfile | null>;
  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]>;
  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]>;
  /** A favourites list's items (step 35c). */
  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]>;
  /** The channel the user numbered `req.number` (step 36b; `null`: none). */
  numbered(req: NumberRequest): Promise<NumberedChannel | null>;
  nowNext(keys: ContentKey[], at?: number): Promise<EpgNowNext[]>;
  focusChannel(channel: FocusedChannel | null): Promise<ShortEpgNowNext | null>;
  noteActivity(): void;
  /** Parental control as it stands (step 38b; absent: a locked session with nothing to unlock). */
  lockState?(): Promise<LockState>;
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
   * A channel of a hidden group (step 35d), from the search or Home: the player plays `row` over
   * the list on show, pinned at its row `guess` (the list's focused row).
   */
  readonly playOver?: (row: LiveRow, guess: number) => void;
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
   * OK on the header's "Guide" button (step 23c), or the Guide key anywhere on the screen (step
   * 39a), while the list has channels: the guide opens on the category on show, on `row`, the
   * list's focused row.
   */
  readonly openGuide?: (row: number) => void;
  /** OK on the header's "Movies" button (step 26a): the movies screen opens. */
  readonly openMovies?: () => void;
  /** OK on the header's "Series" button (step 27a): the series screen opens. */
  readonly openSeries?: () => void;
  /** OK on the header's "Search" button (step 28a): the search screen opens. */
  readonly openSearch?: () => void;
  /** OK on the header's "Home" button (step 28b1): Home opens. */
  readonly openHome?: () => void;
  /** OK on the rail's last entry (step 38b): "Locked groups" or "Lock again". */
  readonly lockEntry?: () => void;
}

/** Where the search found a channel (step 28a: a `SearchHit`'s place, and the item's key). */
export interface FoundChannel {
  readonly key: ContentKey;
  readonly src: string;
  readonly catIdx: number;
  readonly chunk: number;
  readonly slot: number;
  /** The item the search found: a channel of a hidden group plays over the list (step 35d). */
  readonly item?: CatalogItem;
}

/** The list on show as the player (`ZapList`) and the guide (step 23c) read it. */
export interface LiveList extends ZapList {
  /** Settles once the newest load (the first, or a catalog swap's) has its categories, or failed. */
  ready(): Promise<void>;
}

/**
 * A rail entry as the profile keeps it: a source's category by its name, a favourites list by its
 * id (step 35c); `null` is "All channels".
 */
export type RailRef = { readonly src: string; readonly name: string } | { readonly list: string } | null;

export interface Live {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly home: Screen;
  readonly status: ReadonlySignal<LiveStatus>;
  readonly rail: ReadonlySignal<readonly RailEntry[]>;
  /** The profile's favourites lists as last read (step 35c: the player's star and its panel). */
  readonly lists: ReadonlySignal<readonly FavouriteList[]>;
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
  /**
   * Plays a channel the search found (step 28a): the list shows its category, focused on it, and
   * the player opens it. `false` (nothing played) when the list isn't ready, the category is gone,
   * or the channel isn't in it any more.
   */
  playFound(found: FoundChannel): Promise<boolean>;
  /**
   * Plays a channel played before (step 28b2: Home's "Recent channels"), as `playFound` does: the
   * list shows rail entry `ref` (by name; "All channels" when it is gone), focused on channel
   * `key`, found from row `guess` (its row then), and the player opens it. `false` (nothing played)
   * when the list isn't ready or the channel isn't in that entry any more. `kept` (the channel as
   * kept): when its group is hidden, it plays over the list instead (step 35d).
   */
  playKept(ref: RailRef, key: ContentKey, guess: number, kept?: LiveRow): Promise<boolean>;
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
  /**
   * A favourites list changed (step 35c): the profile is read again, as for a catalog swap but
   * with the chunks kept. Settles once the new rail is in.
   */
  listsChanged(): Promise<void>;
  /**
   * A channel was changed (hidden, renamed or renumbered), or "Clean channel names" switched
   * (step 36b): everything is read again, as for a catalog swap. Settles once the new rail is in.
   */
  channelsChanged(): Promise<void>;
  /**
   * The session unlocked or locked again (step 38b): everything is read again, as for a catalog
   * swap; a focus on the rail moves to the first group that came back, or to "Locked groups".
   */
  lockChanged(unlocked: boolean): Promise<void>;
  dispose(): void;
}

/** What `readSources` reads. */
interface SourcesRead {
  readonly records: StoredSource[];
  /** Each source's live categories. */
  readonly lists: CategoryInfo[][];
  /** The profile's document (`null`: none). */
  readonly doc: unknown;
  /** Parental control as the rail reads it (step 38b). */
  readonly locks: RailLocks;
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

/** The most keys one `itemsByKey` takes (the query worker's `KEY_ITEMS_MAX`, not imported: its module isn't main's). */
export const KEY_BATCH = 100;

/** A favourites list on show (step 35c): its items the catalog has, in the list's order, each with its place in the list. */
interface KeyedRows {
  readonly items: CatalogItem[];
  readonly places: number[];
  /** Settles once its items are in (or couldn't be read: none). */
  done: Promise<void>;
}

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

/**
 * The header's buttons: "Guide" (step 23c), "Movies" (step 26a), "Series" (step 27a), "Home"
 * (step 28b1), then two icons: "Search" (step 28a) and "Settings" (step 22b2). DOWN is the
 * screen's (back where it came from).
 */
const HEADER_ZONE: ZoneSpec = { kind: 'list', id: 'header', axis: 'horizontal', count: 6 };
/** The header's "Guide" button. */
export const HEADER_GUIDE = 0;
/** The header's "Movies" button. */
export const HEADER_MOVIES = 1;
/** The header's "Series" button. */
export const HEADER_SERIES = 2;
/** The header's "Home" button (step 28b1). */
export const HEADER_HOME = 3;
/** The header's "Search" button (an icon since step 28b1). */
export const HEADER_SEARCH = 4;
/** The header's "Settings" button (an icon since step 28b1). */
export const HEADER_SETTINGS = 5;

/** `groups` by their `groupId`, each with its place in `groups`. */
function placesOf(groups: readonly GroupRef[]): Record<string, number> {
  const out: Record<string, number> = {};
  // (An id starts with its source's, never empty: no name an object inherits. A repeat keeps its first place.)
  for (let i = groups.length - 1; i >= 0; i -= 1) out[groupId(groups[i]!)] = i;
  return out;
}

/**
 * The rail: "All channels", the favourites lists (step 35c), then every category with channels:
 * the user's ordered groups first, in that order, then the others source by source in the
 * provider's order. Hidden groups are left out, of "All channels" too, which lists the groups in
 * the rail's order. Each part's `first` counts every category, hidden ones too, in the provider's
 * order. No channels at all: no rail (whatever the lists hold).
 *
 * Channels the user hid (step 36b, `CategoryInfo.hidden`) count in the places but not in an
 * entry's `count`; a group with every channel hidden is left out, as an empty one is.
 *
 * A group whose name another source's group on the rail has too (`groupNameKey`) carries its
 * source's name (step 36d, `source`).
 *
 * Parental control (step 38b, `locks`; absent: a locked session with no entry): while the session
 * is locked, a category the query worker marks `locked` is left out as a hidden group is (places
 * kept). Unlocked, it is in its place, `opened`. The rail ends with the `locked` entry when
 * `locks.entry` says the kind has something locked.
 */
export function railEntries(sources: readonly RailSource[], shape?: RailShape, locks: RailLocks = NO_LOCKS): RailEntry[] {
  const hidden = placesOf(shape === undefined ? [] : shape.hidden);
  const order = placesOf(shape === undefined ? [] : shape.order);
  /** The shown groups in the provider's order, and those the user ordered, by their place in `order`. */
  const rest: RailEntry[] = [];
  const ordered: RailEntry[] = [];
  const names = Object.create(null) as Record<string, string>;
  let at = 0;
  for (const source of sources) {
    if (source.name !== undefined) names[source.src] = source.name;
    for (const info of source.categories) {
      if (info.count <= 0) continue;
      const part = partOf(source.src, info, at);
      at += info.count;
      const count = info.count - (part.hidden === undefined ? 0 : part.hidden.length);
      const id = groupId({ src: source.src, name: info.name });
      const locked = info.locked === true;
      if (hidden[id] !== undefined || count <= 0 || (locked && !locks.unlocked)) continue;
      const entry: RailEntry = locked
        ? { kind: 'category', name: info.name, count, parts: [part], allStart: part.first, opened: true }
        : { kind: 'category', name: info.name, count, parts: [part], allStart: part.first };
      const place = order[id];
      // (A second category of a source with the same name, as an Xtream panel may have, keeps the provider's order.)
      if (place === undefined || ordered[place] !== undefined) rest.push(entry);
      else ordered[place] = entry;
    }
  }
  if (at === 0) return [];
  const groups: RailEntry[] = [];
  // (`ordered` has holes where an ordered group is gone or hidden.)
  for (let i = 0; i < ordered.length; i += 1) if (ordered[i] !== undefined) groups.push(ordered[i]!);
  for (let i = 0; i < rest.length; i += 1) groups.push(rest[i]!);
  tagSources(groups, names);
  const all: ListPart[] = [];
  let count = 0;
  for (let i = 0; i < groups.length; i += 1) {
    all.push(groups[i]!.parts[0]!);
    count += groups[i]!.count;
  }
  const out: RailEntry[] = [{ kind: 'all', name: '', count, parts: all, allStart: 0 }];
  const lists = shape === undefined ? [] : shape.lists;
  for (let i = 0; i < lists.length; i += 1) {
    const list = lists[i]!;
    out.push({ kind: 'list', name: list.name === null ? '' : list.name, count: list.keys.length, parts: [], allStart: 0, list });
  }
  const rail = out.concat(groups);
  if (locks.entry) rail.push({ kind: 'locked', name: '', count: 0, parts: [], allStart: 0, unlocked: locks.unlocked });
  return rail;
}

/**
 * Where a rail's focus goes after the session unlocked or locked (step 38b): unlocked, the first
 * group that came back (`opened`); locked, the `locked` entry. `-1`: neither is on the rail.
 */
export function lockFocus(entries: readonly { readonly kind: string; readonly opened?: true }[], unlocked: boolean): number {
  for (let i = 0; i < entries.length; i += 1) if (unlocked ? entries[i]!.opened === true : entries[i]!.kind === 'locked') return i;
  return unlocked ? lockFocus(entries, false) : -1;
}

/**
 * A group's name as the rail compares two (step 36d): in lower case, each run of blanks one space,
 * none at the ends ("SPORTS " is "Sports"). Blanks by char code: `trim` pulls a polyfill into main.
 */
export function groupNameKey(name: string): string {
  let out = '';
  let gap = false;
  for (let i = 0; i < name.length; i += 1) {
    const c = name.charCodeAt(i);
    if (c <= 32 || c === 160 || c === 0x3000) gap = true;
    else {
      if (gap && out !== '') out += ' ';
      gap = false;
      out += name.charAt(i);
    }
  }
  return out.toLowerCase();
}

/**
 * Tags each of `groups` whose name another source's group in `groups` has too with its source's
 * name from `names` (step 36d): the entry is replaced by a copy with `source`. A source's own two
 * groups of one name get no tag (it would be the same on both), nor does a source without a name.
 */
function tagSources(groups: RailEntry[], names: Record<string, string>): void {
  // Each name's first source, or '' once another source has it too (a source's id is never empty).
  const firstSrc = Object.create(null) as Record<string, string>;
  const keys: string[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const key = groupNameKey(groups[i]!.name);
    const src = groups[i]!.parts[0]!.src;
    const seen = firstSrc[key];
    if (seen === undefined) firstSrc[key] = src;
    else if (seen !== src) firstSrc[key] = '';
    keys.push(key);
  }
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i]!;
    const source = names[g.parts[0]!.src];
    if (firstSrc[keys[i]!] !== '' || source === undefined || source === '') continue;
    groups[i] = g.opened === true ? { kind: g.kind, name: g.name, count: g.count, parts: g.parts, allStart: g.allStart, source, opened: true } : { kind: g.kind, name: g.name, count: g.count, parts: g.parts, allStart: g.allStart, source };
  }
}

/** Category `info` of source `src` as a list reads it, its first channel at place `first`; its hidden places only when it has some. */
function partOf(src: string, info: CategoryInfo, first: number): ListPart {
  const part: { src: string; catIdx: number; chunks: number[]; first: number; hidden?: number[] } = { src, catIdx: info.catIdx, chunks: info.chunks.slice(), first };
  if (info.hidden !== undefined && info.hidden.length > 0) part.hidden = info.hidden.slice();
  return part;
}

/** The map key of category `catIdx` of source `src` (`categoryParts`). */
export function categoryKey(src: string, catIdx: number): string {
  return `${src}|${catIdx}`;
}

/**
 * Every category with channels by `categoryKey`, each with its `first` as `railEntries` counts it
 * and its hidden places (steps 35d and 36b: a channel of a group out of the rail, or one the user
 * hid, plays over the list with its number).
 */
export function categoryParts(sources: readonly RailSource[]): Map<string, ListPart> {
  const out = new Map<string, ListPart>();
  let at = 0;
  for (let s = 0; s < sources.length; s += 1) {
    const source = sources[s]!;
    for (let c = 0; c < source.categories.length; c += 1) {
      const info = source.categories[c]!;
      if (info.count <= 0) continue;
      out.set(categoryKey(source.src, info.catIdx), partOf(source.src, info, at));
      at += info.count;
    }
  }
  return out;
}

/**
 * Parental control as a rail of `kind` reads it (step 38b): the session, and whether `kind` has
 * anything locked. An engine without `lockState`, or a read that failed: a locked session with no
 * entry (locked groups stay out of sight).
 */
export function readLocks(engine: { lockState?(): Promise<LockState> }, kind: ContentKind): Promise<RailLocks> {
  if (engine.lockState === undefined) return Promise.resolve(NO_LOCKS);
  return engine.lockState().then(
    (state) => ({ unlocked: state.unlocked, entry: state.kinds.indexOf(kind) !== -1 }),
    (error: unknown) => {
      console.warn('The locks could not be read', error);
      return NO_LOCKS;
    },
  );
}

/** The entry of `entries` that `ref` names: a category of that source with that name, or a list by its id (`-1`: none). */
export function findEntry(entries: readonly RailEntry[], ref: NonNullable<RailRef>): number {
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    if ('list' in ref) {
      if (e.list !== undefined && e.list.id === ref.list) return i;
    } else if (e.kind === 'category' && e.name === ref.name && e.parts[0]!.src === ref.src) return i;
  }
  return -1;
}

/**
 * The source a focused channel's short EPG is asked through (its panel's login, or its link);
 * `null` for a file from the phone, which has neither, and for a source without its login (step
 * 32d4a).
 */
function epgSourceOf(record: StoredSource): ShortEpgSource | null {
  if (record.type === 'm3u-file') return null;
  if (record.type === 'xtream') return record.account === null ? null : { type: 'xtream', account: record.account };
  return record.url === null ? null : { type: 'm3u', url: record.url };
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
  const lists = signal<readonly FavouriteList[]>([]);
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
  /** The stored sources' ids (a list's items are looked up in them). */
  let srcIds: string[] = [];
  let index = new ChannelIndex([]);
  /** Every category with channels (steps 35d and 36b), by `categoryKey`. */
  let parts = new Map<string, ListPart>();
  /** The hidden groups (step 35d), by `groupId`. */
  let hiddenGroups: Record<string, number> = {};
  /** The channels the user hid (step 36b), by key. */
  let hiddenKeys: Record<string, true> = {};
  /** The favourites list on show (`null`: a category or "All channels", read by chunk through `index`). */
  let keyed: KeyedRows | null = null;
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
    if (keyed !== null) {
      const item = keyed.items[i];
      return item === undefined ? null : { item, number: keyed.places[i]! + 1 };
    }
    const at = index.locate(i);
    if (at === null) return null;
    const item = chunks.get(chunkId(at))?.[at.slot];
    if (item === undefined) return null;
    return { item, number: item.chno !== null ? item.chno : index.place(i) + 1 };
  };

  /** Rows in the list on show (a list's: its items found so far). */
  const rowCount = (): number => (keyed !== null ? keyed.items.length : index.count);

  /** Reads the items of a favourites list's `keys` for load `seq`, `KEY_BATCH` keys a call; the list's zone follows once they are in. */
  const readKeys = (keys: readonly ContentKey[], seq: number): KeyedRows => {
    const rows: KeyedRows = { items: [], places: [], done: Promise.resolve() };
    const asks: Promise<CatalogItem[]>[] = [];
    for (let i = 0; i < keys.length; i += KEY_BATCH) {
      const req: KeyItemsRequest = { keys: keys.slice(i, i + KEY_BATCH), kind: LIVE_KIND, sources: srcIds, limit: Math.min(KEY_BATCH, keys.length - i) };
      asks.push(track(() => engine.itemsByKey(req)));
    }
    rows.done = Promise.all(asks).then(
      (found) => {
        if (disposed || seq !== loadSeq || keyed !== rows) return;
        for (let b = 0; b < found.length; b += 1) {
          for (let i = 0; i < found[b]!.length; i += 1) {
            rows.items.push(found[b]![i]!);
            rows.places.push(keys.indexOf(found[b]![i]!.key));
          }
        }
        home.update(channelsZone(rows.items.length));
        bump();
        afterChange();
      },
      (error: unknown) => {
        // The next load reads it again.
        if (!disposed) console.warn("A favourites list's channels could not be read", error);
      },
    );
    return rows;
  };

  /** The list rail entry `picked` lists, from its first row: its chunks' index, or its items read by key. */
  const setList = (picked: RailEntry): void => {
    index = new ChannelIndex(picked.parts);
    keyed = picked.list === undefined ? null : readKeys(picked.list.keys, loadSeq);
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
    if (keyed !== null) return keyed.done.then(() => rowAt(i));
    const at = index.locate(i);
    if (at === null || disposed || status.value !== 'ready') return Promise.resolve(null);
    return loadChunk(at, loadSeq).then(() => rowAt(i));
  };

  /**
   * The first row of the list on show that `test` takes (`-1`: none), with the row's number,
   * reading the chunk of row `from` first, then every chunk from that one outwards: a cached chunk
   * costs nothing, any other one read. A favourites list's rows once its items are in. `-1` too
   * when the list changed meanwhile.
   */
  const findRow = async (from: number, test: (item: CatalogItem, number: number) => boolean): Promise<number> => {
    const shown = entry();
    if (shown === undefined || status.value !== 'ready') return -1;
    const seq = loadSeq;
    const mine = keyed;
    if (mine !== null) {
      await mine.done;
      if (disposed || seq !== loadSeq || mine !== keyed) return -1;
      for (let i = 0; i < mine.items.length; i += 1) if (test(mine.items[i]!, mine.places[i]! + 1)) return i;
      return -1;
    }
    if (index.count === 0) return -1;
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
      for (let slot = 0; slot < items.length; slot += 1) {
        const item = items[slot]!;
        if (test(item, item.chno !== null ? item.chno : list.place(start + slot) + 1)) return start + slot;
      }
    }
    return -1;
  };

  /**
   * The row of the channel numbered `n` in the list on show (`-1`: none), for the player's number
   * entry. A favourites list's rows are numbered by their places (all in already). Elsewhere the
   * channel the user numbered `n` comes first (step 36b: the query worker knows it): its row, or,
   * hidden, the channel itself (it plays over the list). Then a row's number is its provider's
   * (`chno`), else its place in the provider's whole list, so the search starts at the row that
   * place gives.
   */
  const findNumber = async (n: number): Promise<number | LiveRow> => {
    if (!(n > 0)) return -1;
    if (keyed !== null) return findRow(0, (_item, number) => number === n);
    if (status.value !== 'ready') return -1;
    const list = index;
    const seq = loadSeq;
    const mine = await track(() => engine.numbered({ number: n, sources: srcIds })).catch((error: unknown) => {
      // The provider's numbers still find their channels.
      console.warn('A channel number could not be looked up', error);
      return null;
    });
    if (disposed || seq !== loadSeq || list !== index) return -1;
    if (mine !== null) {
      if (mine.hidden) return { item: mine.item, number: n };
      const row = list.rowOfStored(mine);
      // (Found by its key from there: the address may be an older catalog's.)
      const found = row === -1 ? -1 : await findRow(row, (item) => item.key === mine.item.key);
      if (found !== -1) return found;
    }
    return findRow(list.rowOfPlace(n - 1), (_item, number) => number === n);
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

  /**
   * Under another screen (the search, step 28a), the live screen keeps the zone it had, `zone` on
   * `place`, when the list's focus moved: Back from the search lands on the header's "Search".
   */
  const keepZone = (zone: string, place: number): void => {
    if (nav.top !== home && zone !== 'channels') home.focus(zone, place);
  };

  /** Focuses row `i` of the list (the channel the player played last; under the search, the live screen's zone stays). */
  const focusRow = (i: number): void => {
    const zone = home.active;
    const place = home.position(zone).index;
    home.focus('channels', i);
    keepZone(zone, place);
  };

  /**
   * Plays a channel the search found (step 28a), once the load running now is done: the rail entry
   * of its source's category is shown, its row found from where the hit
   * says (the search reads on through the category for a hit of an older generation), focused,
   * and played. Under the search, the screen's active zone stays (`keepZone`).
   */
  const playFound = async (found: FoundChannel): Promise<boolean> => {
    await loaded;
    // (A list that failed or is empty has no rail; `findRow` reads nothing then, nor once disposed.)
    const entries = rail.value;
    let at = -1;
    // Each category alone (a hidden one isn't in the rail: its channel plays over the list, step 35d).
    for (let i = 1; i < entries.length && at === -1; i += 1) {
      const part = entries[i]!.kind === 'category' ? entries[i]!.parts[0]! : null;
      if (part !== null && part.src === found.src && part.catIdx === found.catIdx) at = i;
    }
    // A channel the user hid (step 36b), or one of a group out of the rail (hidden, step 35d, or with
    // every channel hidden): it plays over the list, numbered by its place in the provider's whole list.
    if (at === -1 || hiddenKeys[found.key] === true) {
      const part = parts.get(categoryKey(found.src, found.catIdx));
      return part !== undefined && playOver(found.item, () => part.first + storedOffset(part, found.chunk, found.slot) + 1);
    }
    // (-1, an address of an older catalog: the search then starts at the top.)
    return playIn(at, found.key, () => index.rowOfStored(found));
  };

  /**
   * Shows rail entry `at`, then finds channel `key` from row `guess()` (read once the entry is on
   * show), focuses it and plays it. Under another screen, the live screen's zone stays.
   */
  const playIn = async (at: number, key: ContentKey, guess: () => number): Promise<boolean> => {
    const zone = home.active;
    const place = home.position(zone).index;
    showCategory(at);
    const row = await findRow(guess(), (item) => item.key === key);
    // (-1, the channel gone: the list's top, where the category opened.)
    home.focus('channels', row);
    keepZone(zone, place);
    if (row === -1) return false;
    selected.value = key;
    options.play?.(row);
    return true;
  };

  /**
   * Plays a channel played before (step 28b2), once the load running now is done: its rail entry
   * by name, "All channels" when it is gone (or `ref` is `null`), then as `playFound`.
   */
  const playKept = async (ref: RailRef, key: ContentKey, guess: number, kept?: LiveRow): Promise<boolean> => {
    await loaded;
    // (A list that failed or is empty has no rail.)
    if (rail.value.length === 0) return false;
    // A channel kept from a group the user hid since, or one the user hid (step 36b), unless the list
    // it was kept with holds it (it plays there). One played over a list keeps that list, which doesn't hold it.
    if (kept !== undefined && !listHolds(ref, key) && (hiddenGroups[groupId({ src: kept.item.src, name: kept.item.group })] !== undefined || hiddenKeys[key] === true)) {
      return playOver(kept.item, () => kept.number);
    }
    return playIn(ref === null ? 0 : Math.max(0, findEntry(rail.value, ref)), key, () => guess);
  };

  /** Whether `ref` names a list that holds `key` (as last read). */
  const listHolds = (ref: RailRef, key: ContentKey): boolean => {
    if (ref === null || !('list' in ref)) return false;
    const all = lists.value;
    for (let i = 0; i < all.length; i += 1) if (all[i]!.id === ref.list) return all[i]!.keys.indexOf(key) !== -1;
    return false;
  };

  /**
   * Plays `item` over the list on show (a channel no row holds: its group is hidden, step 35d, or
   * the user hid it, step 36b): the player pins it at the list's focused row. Its number is its
   * `chno`, else `number()`. `false` (nothing played) without the item or the app's `playOver`.
   */
  const playOver = (item: CatalogItem | undefined, number: () => number): boolean => {
    if (item === undefined || options.playOver === undefined) return false;
    options.playOver({ item, number: item.chno !== null ? item.chno : number() }, Math.max(0, home.position('channels').index));
    return true;
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
    count: () => (status.value === 'ready' ? rowCount() : 0),
    row: rowAt,
    load: loadRow,
    find: findNumber,
    locate,
    guide: (key) => guides.get(key)?.value,
    askGuide,
  };

  const showCategory = (i: number): void => {
    // ("Locked groups" lists nothing: "All channels" instead.)
    const at = rail.value[i] !== undefined && rail.value[i]!.kind === 'locked' ? 0 : i;
    const picked = rail.value[at];
    if (picked === undefined) return;
    category.value = at;
    setList(picked);
    // Back to the top first, so no step reads chunks for the old window in the new list.
    home.reset('channels');
    home.update(channelsZone(rowCount()));
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

  /** The stored sources, each one's live categories, the profile's document (its lists and groups, step 35c) and the locks (step 38b). */
  const readSources = async (): Promise<SourcesRead> => {
    const profile = await engine.profile();
    const records = storedSources(profile);
    const read = await Promise.all([Promise.all(records.map((r) => engine.categories(r.id, LIVE_KIND))), readLocks(engine, LIVE_KIND)] as const);
    return { records, lists: read[0], doc: profile === null ? null : profile.doc, locks: read[1] };
  };

  /** Takes the sources read: their short-EPG logins, the favourites lists and the rail (the list isn't touched). */
  const takeSources = (read: SourcesRead): RailEntry[] => {
    sources = new Map<string, ShortEpgSource>();
    srcIds = [];
    for (const record of read.records) {
      srcIds.push(record.id);
      const source = epgSourceOf(record);
      if (source !== null) sources.set(record.id, source);
    }
    const doc = read.doc;
    lists.value = favouriteListsOf(doc);
    const shape: RailShape = { lists: lists.value, hidden: hiddenGroupsOf(doc), order: groupOrderOf(doc) };
    const all: RailSource[] = read.records.map((r, i) => ({ src: r.id, name: r.name, categories: read.lists[i] ?? [] }));
    const entries = railEntries(all, shape, read.locks);
    parts = categoryParts(all);
    hiddenGroups = placesOf(shape.hidden);
    hiddenKeys = Object.create(null) as Record<string, true>;
    const edits = channelEditsOf(doc);
    for (let i = 0; i < edits.length; i += 1) if (edits[i]!.hidden === true) hiddenKeys[edits[i]!.key] = true;
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
      (read) => {
        if (disposed || seq !== loadSeq) {
          settle();
          return;
        }
        const entries = takeSources(read);
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
    if (shown === undefined || shown.kind === 'all') return null;
    return shown.list !== undefined ? { list: shown.list.id } : { src: shown.parts[0]!.src, name: shown.name };
  };

  /**
   * A catalog swapped in (step 22a): the sources and categories are read again without the
   * loading screen. The rail entry on show stays (by name; "All channels" when it is gone), and
   * the focused channel's row is found in the new list, unless the focus moved meanwhile. A
   * screen still loading, or failed, loads again. `catalog` false (a list changed, step 35c): the
   * chunks read stay. Settles once the new rail is in.
   */
  const reread = (catalog: boolean): Promise<void> => {
    if (disposed) return loaded;
    if (status.value === 'loading' || status.value === 'failed') {
      load();
      return loaded;
    }
    const settle = nextLoad();
    const seq = loadSeq;
    const keep = shownCategory();
    track(readSources).then(
      (read) => {
        // (dispose bumps `loadSeq` too.)
        if (seq !== loadSeq) {
          settle();
          return;
        }
        // Where the focus stands, read from the old list before it goes.
        const place = home.position('channels').index;
        const key = rowAt(place)?.item.key ?? null;
        options.listChanging?.();
        const entries = takeSources(read);
        if (catalog) chunks.clear();
        if (entries.length === 0) {
          // The old index stays, unread: nothing reads an index while the screen is empty.
          status.value = 'empty';
          home.update(channelsZone(0));
        } else {
          status.value = 'ready';
          const pick = keep === null ? 0 : Math.max(0, findEntry(entries, keep));
          category.value = pick;
          setList(entries[pick]!);
          home.update(channelsZone(rowCount()));
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
    return loaded;
  };

  /**
   * A guide swapped in (step 22a): every answer is stale; the rows on show keep theirs until
   * asked again (`askGuides` asks nothing while the screen isn't ready, or once disposed).
   */
  const guidesChanged = (): void => {
    guideEpoch += 1;
    scheduleGuides();
  };

  /** The guide on the list's focused row (step 23c; the header's "Guide", and the Guide key: step 39a): none while the list loads, failed or is empty. */
  const toGuide = (): void => {
    if (status.value === 'ready') options.openGuide?.(home.position('channels').index);
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
        if (intent !== 'GUIDE') return false;
        toGuide();
        return true;
      },
      onSelect: (focus) => {
        if (focus.zone === 'header') {
          if (focus.index === HEADER_SETTINGS) options.openSettings?.();
          // The search reads its own data, as the movies screen does; Home too.
          else if (focus.index === HEADER_SEARCH) options.openSearch?.();
          else if (focus.index === HEADER_HOME) options.openHome?.();
          // The movies and series screens read their own data: they open in every state of the list.
          else if (focus.index === HEADER_MOVIES) options.openMovies?.();
          else if (focus.index === HEADER_SERIES) options.openSeries?.();
          else toGuide();
        } else if (focus.zone === 'rail') {
          const at = rail.value[focus.index];
          if (at !== undefined && at.kind === 'locked') options.lockEntry?.();
          else showCategory(focus.index);
        }
        else if (focus.zone === 'retry') load();
        else if (focus.zone === 'channels') {
          const row = rowAt(focus.index);
          if (row !== null) selected.value = row.item.key;
          if (options.play !== undefined && focus.index >= 0 && focus.index < rowCount()) options.play(focus.index);
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
    lists,
    category,
    version,
    clock,
    pending,
    selected,
    exitRequested,
    list,
    row: rowAt,
    guide: (key) => guides.get(key)?.value,
    focusRow,
    playFound,
    playKept,
    shownCategory,
    activity: () => engine.noteActivity(),
    reload: load,
    guidesChanged,
    catalogChanged: () => void reread(true),
    listsChanged: () => reread(false),
    channelsChanged: () => reread(true),
    lockChanged: (unlocked) =>
      reread(true).then(() => {
        if (disposed || nav.top !== home || home.active !== 'rail') return;
        const at = lockFocus(rail.value, unlocked);
        if (at !== -1) home.focus('rail', at);
      }),
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
