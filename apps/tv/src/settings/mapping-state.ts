import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKey } from '@zoma/core';
import type { EpgNowNext, EpgPin, EpgStatus, GuideChannel, GuideChannelsPage, GuideChannelsRequest, LoadedProfile, ProfileEdit } from '@zoma/data';
import type { Platform } from '@zoma/platform-api';
import type { EditorBinding, Navigator, Screen, TextEditorOptions, ZoneSpec } from '@zoma/ui';
import { SCREEN, bindEditor, createTextEditor, fits } from '@zoma/ui';
import { GUIDES, guideList } from './guides-state';

/**
 * The manual mapping's picker (RELAY step 24e, architecture.md §1.2 "Built in step 24e"): which
 * of the guides' XMLTV channels a live channel takes its programmes from. Pushed on the live
 * navigator by OK on a channel of "Channels without a guide" (step 24c), or by "Guide channel" in
 * the programme details (step 24a) for a channel the guides matched wrongly.
 *
 *   search    (the search field: OK opens the TV's keyboard; each change searches again)
 *   channels  ("No guide" first, then "Match automatically" for a channel with a mapping, then
 *              the guides' channels whose names or ids hold each word typed, guide by guide in
 *              their order)
 *
 * - **The current match** is marked: the mapping the profile holds for the channel (a guide's
 *   channel, or no guide), else the channel the guides matched (now/next's), else none. The line
 *   under the header names it (the guide channel's name, looked up by its id).
 * - **Reads:** the profile, the channel's now/next and the guides' status (their links) first,
 *   then pages of `MAPPING.page` channels from the query worker (`guideChannels`), only around the
 *   window (`MAPPING.pages` kept). A new version (a guide swapped in the worker) drops every page
 *   held; an answer for an older query, an older opening or a closed picker is dropped.
 * - **OK on a row** closes the picker. The current match, or the channel the guides found, changes
 *   nothing. Another saves the mapping (`epgOverride`: `{ epgSrc, channel }`, no guide, or `null`
 *   for "Match automatically"), then reads the guides again (`refreshNow`: every guide is due, its
 *   mappings changed): "Reading…" (`reading`) until that pass settles, then `mapped` (the lists
 *   read their matches again; the live screen and the guide hear from the scheduler's `onGuides`).
 * - Back closes it, changing nothing.
 */

/** The picker's id on the navigator, and its zones'. */
export const MAPPING_SCREEN = 'guide-map';
export const MAPPING_SEARCH = 'search';
export const MAPPING_CHANNELS = 'channels';
/** The DOM id of the search field's input (the text editor finds it by this). */
export const SEARCH_FIELD_ID = 'mapping-search';

/** Sizes, all layout constants (no DOM measuring). mapping.css uses the same numbers. */
export const MAPPING = {
  /** The search field: its 32 px label and 8 px gap, its 72 px box, an 8 px gap and its 30 px note (TextField.css). */
  fieldHeight: 150,
  fieldGap: 16,
  /** A row: a guide channel's name, then its id and its guide's link. */
  rowHeight: 88,
  rowGap: 8,
  /** Rows per ask. */
  page: 50,
  /** Pages kept (the window and one window either side fit in three). */
  pages: 6,
  /** Rows the current guide channel's name is looked for in (its id searched in its guide). */
  lookup: 50,
} as const;

/** Under the header, the line naming the channel and the search field. */
export const MAPPING_BODY =
  SCREEN.height - 2 * SCREEN.safeY - GUIDES.headerHeight - GUIDES.headerGap - GUIDES.introHeight - MAPPING.fieldHeight - MAPPING.fieldGap;
export const MAPPING_VISIBLE = fits(MAPPING_BODY, MAPPING.rowHeight, MAPPING.rowGap);

/** The live channel the picker maps. */
export interface MappingTarget {
  readonly key: ContentKey;
  /** Its name, as the provider gives it. */
  readonly name: string;
}

/**
 * Where the channel's programmes come from now: `pin` (a mapping to a guide's channel), `off` (a
 * mapping to no guide), `auto` (the guides matched it) or `none`.
 */
export type MappingCurrent =
  | { readonly kind: 'none' }
  | { readonly kind: 'off' }
  | { readonly kind: 'auto' | 'pin'; readonly epgSrc: string; readonly channel: string };

/** A row of the picker: "No guide", "Match automatically", or one of the guides' channels. */
export type MappingRow = { readonly kind: 'off' } | { readonly kind: 'auto' } | { readonly kind: 'channel'; readonly channel: GuideChannel };

export type MappingStatus = 'loading' | 'ready' | 'failed';

/** What the picker needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface MappingEngine {
  profile(): Promise<LoadedProfile | null>;
  epgStatus(): Promise<EpgStatus>;
  nowNext(keys: ContentKey[]): Promise<EpgNowNext[]>;
  guideChannels(req: GuideChannelsRequest): Promise<GuideChannelsPage>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

export interface MappingOptions {
  /** The live screen's navigator: the picker is a screen on it. */
  readonly nav: Navigator;
  readonly engine: MappingEngine;
  /** Reads the guides now (`RefreshScheduler.refreshNow`): settles when that pass has ended. */
  readonly refreshNow: () => Promise<void>;
  /** A mapping's refresh settled: the screens that list matches read them again. */
  readonly mapped: () => void;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds the search field's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing in the editor). */
  readonly now?: () => number;
}

export interface Mapping {
  /** The picker while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly editor: EditorBinding;
  /** The channel mapped, while the picker shows. */
  readonly target: ReadonlySignal<MappingTarget | null>;
  readonly status: ReadonlySignal<MappingStatus>;
  /** The channel's match as the picker opened (`null` until read). */
  readonly current: ReadonlySignal<MappingCurrent | null>;
  /** The current guide channel's name (`''` until found, or when its guide doesn't list it). */
  readonly currentName: ReadonlySignal<string>;
  /** What is typed in the search field. */
  readonly query: ReadonlySignal<string>;
  /** The guides' channels the last answer found for the query. */
  readonly count: ReadonlySignal<number>;
  /** Bumps when rows come in or go: the list draws again. */
  readonly drawn: ReadonlySignal<number>;
  /** Requests in flight (reads, the edit, the refresh): 0 means the screens are settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  /** Mappings whose refresh hasn't settled yet ("Reading…"). */
  readonly reading: ReadonlySignal<number>;
  /** The rows before the guides' channels: 1, or 2 for a channel with a mapping (0 until read). */
  fixed(): number;
  /** Row `index`, or `null` while its page isn't read. */
  row(index: number): MappingRow | null;
  /** Whether `row` is the channel's current match. */
  marked(row: MappingRow): boolean;
  /** A guide's link as the guides screen shows it (`''`: not listed). */
  link(epgSrc: string): string;
  /** Opens the picker on `target` and reads its match and the guides' channels. */
  open(target: MappingTarget): void;
  setQuery(value: string): void;
  dispose(): void;
}

/**
 * The live channel `key`'s mapping in a profile document (`epgOverrides`, step 24d), or `null`.
 * Read here: `@zoma/data`'s own helper would bring its module's polyfills into main.
 */
export function pinOf(doc: unknown, key: string): EpgPin | null {
  // (Any other value has no such field.)
  const stored = doc === null || doc === undefined ? undefined : (doc as { epgOverrides?: unknown }).epgOverrides;
  if (stored === null || stored === undefined) return null;
  // (ContentKeys hold `:`: never a name an object inherits.)
  const pin = (stored as Record<string, unknown>)[key];
  if (pin === null || pin === undefined) return null;
  const { epgSrc, channel } = pin as { epgSrc?: unknown; channel?: unknown };
  if (channel === null) return epgSrc === '' ? { epgSrc: '', channel: null } : null;
  return typeof epgSrc === 'string' && epgSrc !== '' && typeof channel === 'string' ? { epgSrc, channel } : null;
}

/** The channel's match: its mapping when it has one, else what the guides matched (`match`: its now/next). */
export function currentOf(pin: EpgPin | null, match: Pick<EpgNowNext, 'epgSrc' | 'channel'> | null): MappingCurrent {
  if (pin !== null) return pin.channel === null ? { kind: 'off' } : { kind: 'pin', epgSrc: pin.epgSrc, channel: pin.channel };
  if (match !== null && match.epgSrc !== null) return { kind: 'auto', epgSrc: match.epgSrc, channel: match.channel ?? '' };
  return { kind: 'none' };
}

/** The rows before the guides' channels: "No guide", and "Match automatically" for a channel with a mapping. */
export function fixedRows(current: MappingCurrent): number {
  return current.kind === 'pin' || current.kind === 'off' ? 2 : 1;
}

/** Whether `row` is `current`: "No guide" for a mapping to none, a channel for its mapping or the guides' match. */
export function isCurrent(row: MappingRow, current: MappingCurrent): boolean {
  if (row.kind === 'off') return current.kind === 'off';
  if (row.kind === 'auto') return false;
  return (current.kind === 'pin' || current.kind === 'auto') && current.epgSrc === row.channel.epgSrc && current.channel === row.channel.id;
}

/** What OK on `row` saves: a mapping, `null` to take it away, or `undefined` when nothing changes. */
export function pinFor(row: MappingRow, current: MappingCurrent): EpgPin | null | undefined {
  if (isCurrent(row, current)) return undefined;
  if (row.kind === 'off') return { epgSrc: '', channel: null };
  if (row.kind === 'auto') return null;
  return { epgSrc: row.channel.epgSrc, channel: row.channel.id };
}

const OFF_ROW: MappingRow = { kind: 'off' };
const AUTO_ROW: MappingRow = { kind: 'auto' };

const SEARCH_ZONE: ZoneSpec = { kind: 'list', id: MAPPING_SEARCH, axis: 'vertical', count: 1, neighbours: { down: MAPPING_CHANNELS } };

function channelsZone(count: number): ZoneSpec {
  return { kind: 'list', id: MAPPING_CHANNELS, axis: 'vertical', count, visible: MAPPING_VISIBLE, neighbours: { up: MAPPING_SEARCH } };
}

export function createMapping(options: MappingOptions): Mapping {
  const { nav, engine } = options;
  const screen = signal<Screen | null>(null);
  const target = signal<MappingTarget | null>(null);
  const status = signal<MappingStatus>('loading');
  const current = signal<MappingCurrent | null>(null);
  const currentName = signal('');
  const query = signal('');
  const count = signal(0);
  const drawn = signal(0);
  const pending = signal(0);
  const reading = signal(0);
  let disposed = false;
  /** Bumps at each opening and closing: answers for another one are dropped. */
  let openSeq = 0;
  /** Bumps at each change of the query: pages for another one are dropped. */
  let querySeq = 0;
  /** The worker's version the pages are from (-1: none yet). */
  let version = -1;
  /** The pages held, by page number, least recently wanted first (a Map keeps insertion order). */
  let pages = new Map<number, GuideChannel[]>();
  /** Pages asked for and not answered yet, for this opening, query and version. */
  let asking = new Set<number>();
  /** Each guide's link as the guides screen shows it, by guide id. */
  let links = new Map<string, string>();

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

  const fixed = (): number => {
    const known = current.value;
    return known === null ? 0 : fixedRows(known);
  };

  /** The pages the window needs: its channels and one window either side. */
  const wanted = (shown: Screen): number[] => {
    const top = shown.position(MAPPING_CHANNELS).top - fixed();
    const first = Math.max(0, top - MAPPING_VISIBLE);
    const last = Math.min(count.value, top + 2 * MAPPING_VISIBLE) - 1;
    const out: number[] = [];
    for (let p = Math.floor(first / MAPPING.page); p * MAPPING.page <= last; p += 1) out.push(p);
    return out;
  };

  /**
   * Asks the pages the window needs that aren't held or asked for, and drops the least recently
   * wanted beyond `MAPPING.pages` (never one the window needs: those were just moved last).
   */
  const fill = (): void => {
    const shown = screen.value;
    // (Closed. Before the match is read the count is 0: no page is wanted, its read asks the first.)
    if (shown === null) return;
    wanted(shown).forEach((p) => {
      const held = pages.get(p);
      if (held !== undefined) {
        // Wanted again: last in the order.
        pages.delete(p);
        pages.set(p, held);
      } else if (!asking.has(p)) ask(p);
    });
    let excess = pages.size - MAPPING.pages;
    pages.forEach((_rows, p) => {
      if (excess <= 0) return;
      pages.delete(p);
      excess -= 1;
    });
  };

  /** Takes page `page`'s answer: a newer version first drops every page held. */
  const take = (page: number, answer: GuideChannelsPage): void => {
    // (Open: `ask` drops the answers of an opening that closed.)
    const shown = screen.value!;
    if (answer.version !== version) {
      pages = new Map();
      asking = new Set();
      version = answer.version;
    }
    pages.set(page, answer.rows);
    count.value = answer.count;
    status.value = 'ready';
    shown.update(channelsZone(fixed() + answer.count));
    drawn.value += 1;
    fill();
  };

  function ask(page: number): void {
    const seq = openSeq;
    const asked = querySeq;
    const from = version;
    asking.add(page);
    track(() => engine.guideChannels({ query: query.value, offset: page * MAPPING.page, limit: MAPPING.page })).then(
      (answer) => {
        if (disposed || seq !== openSeq || asked !== querySeq) return;
        if (from === version) asking.delete(page);
        // An answer older than the pages held is dropped (the window asks again).
        if (answer.version < version) return;
        take(page, answer);
      },
      (error: unknown) => {
        if (disposed || seq !== openSeq || asked !== querySeq) return;
        if (from === version) asking.delete(page);
        console.warn("The guides' channels could not be read", error);
        if (status.value === 'loading') status.value = 'failed';
      },
    );
  }

  /** Looks up the current guide channel's name: its id searched in its own guide. */
  const lookUp = (match: MappingCurrent, seq: number): void => {
    if (match.kind !== 'pin' && match.kind !== 'auto') return;
    track(() => engine.guideChannels({ epgSrc: match.epgSrc, query: match.channel, offset: 0, limit: MAPPING.lookup })).then(
      (answer) => {
        if (disposed || seq !== openSeq) return;
        answer.rows.forEach((row) => {
          if (row.id === match.channel) currentName.value = row.name;
        });
      },
      (error: unknown) => {
        if (!disposed) console.warn("The guide channel's name could not be read", error);
      },
    );
  };

  const close = (): void => {
    textEditor.close();
    openSeq += 1;
    screen.value = null;
    target.value = null;
    nav.pop();
  };

  /** Saves `pin` for `key`, then reads the guides again: "Reading…" until that settles. */
  const save = (key: ContentKey, pin: EpgPin | null): void => {
    track(() => engine.editProfile({ kind: 'epgOverride', key, pin })).then(
      (saved) => {
        if (!saved || disposed) return;
        reading.value += 1;
        const settled = (): void => {
          reading.value -= 1;
          if (!disposed) options.mapped();
        };
        track(() => options.refreshNow()).then(settled, (error: unknown) => {
          console.warn('The guides were not read again', error);
          settled();
        });
      },
      (error: unknown) => console.warn('The guide channel was not saved', error),
    );
  };

  const choose = (index: number): void => {
    const row = api.row(index);
    // A channel's page may still be on its way.
    if (row === null) return;
    // (Only the open picker takes OK, and a row shows only once the match is read.)
    const mapped = target.value!;
    const pin = pinFor(row, current.value!);
    close();
    if (pin !== undefined) save(mapped.key, pin);
  };

  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);

  // (A focus move elsewhere finds the picker closed: fill does nothing then.)
  const stopFollowing = nav.subscribe(() => fill());

  const api: Mapping = {
    screen,
    editor,
    target,
    status,
    current,
    currentName,
    query,
    count,
    drawn,
    pending,
    reading,
    fixed,
    row(index: number): MappingRow | null {
      const known = current.value;
      if (known === null) return null;
      if (index === 0) return OFF_ROW;
      const before = fixedRows(known);
      if (index < before) return AUTO_ROW;
      const at = index - before;
      const channel = pages.get(Math.floor(at / MAPPING.page))?.[at % MAPPING.page];
      return channel === undefined ? null : { kind: 'channel', channel };
    },
    marked(row: MappingRow): boolean {
      // (A row shows only once the match is read.)
      return isCurrent(row, current.value!);
    },
    link(epgSrc: string): string {
      return links.get(epgSrc) ?? '';
    },
    open(next: MappingTarget): void {
      if (disposed) return;
      openSeq += 1;
      const seq = openSeq;
      target.value = next;
      status.value = 'loading';
      current.value = null;
      currentName.value = '';
      query.value = '';
      count.value = 0;
      pages = new Map();
      asking = new Set();
      screen.value = nav.push({
        id: MAPPING_SCREEN,
        zones: [SEARCH_ZONE, channelsZone(0)],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
        onSelect: (focus) => {
          if (focus.zone === MAPPING_SEARCH) textEditor.open(SEARCH_FIELD_ID);
          else choose(focus.index);
        },
      });
      track(() => Promise.all([engine.profile(), engine.nowNext([next.key]), engine.epgStatus()])).then(
        ([profile, nowNext, epg]) => {
          if (disposed || seq !== openSeq) return;
          const match = currentOf(pinOf(profile === null ? null : profile.doc, next.key), nowNext[0] ?? null);
          current.value = match;
          const read = new Map<string, string>();
          guideList(profile, epg).rows.forEach((row) => read.set(row.epgSrc, row.link));
          links = read;
          screen.value!.update(channelsZone(fixedRows(match)));
          lookUp(match, seq);
          ask(0);
        },
        (error: unknown) => {
          if (disposed || seq !== openSeq) return;
          console.warn("The channel's match could not be read", error);
          status.value = 'failed';
        },
      );
    },
    setQuery(value: string): void {
      query.value = value;
      querySeq += 1;
      pages = new Map();
      asking = new Set();
      const shown = screen.value;
      // (The field shows only with the picker.)
      if (shown === null) return;
      // The list from its top for the new words; before the match is read, its read asks the
      // first page with them (`fill` waits for it).
      shown.reset(MAPPING_CHANNELS);
      drawn.value += 1;
      fill();
    },
    dispose(): void {
      disposed = true;
      stopFollowing();
      editor.dispose();
      textEditor.dispose();
    },
  };
  return api;
}
