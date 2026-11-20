import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey } from '@lablo/core';
import type { CategoryInfo, LoadedProfile, ProfileEdit } from '@lablo/data';
import type { FavouriteList, GroupRef, KeyItemsRequest } from '@lablo/data/client';
import { favouriteListsOf, groupId, groupOrderOf, hiddenGroupsOf } from '@lablo/data/client';
import type { Intent, Platform } from '@lablo/platform-api';
import type { EditorBinding, Focus, Navigator, Screen, ScreenSpec, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { SCREEN, bindEditor, createTextEditor, fits } from '@lablo/ui';
import { KEY_BATCH, railEntries } from '../live/live-state';
import { storedSources } from '../onboarding/engine-loader';
import { blank } from '../player/favourite-menu';

/**
 * Settings › "Channel groups" (RELAY step 35d, architecture.md §1.4 item 10 "Built in step 35d"):
 * the favourites lists and the live groups, pushed on the live navigator from the settings screen.
 *
 *   rows  (the lists in the user's order, then every source's live groups in the rail's order,
 *          the hidden ones marked; OK on one opens its menu)
 *
 * - **The rows** are read here: the profile, then each stored source's live categories. The
 *   groups come from the live screen's `railEntries` with nothing left out, so their order is the
 *   rail's by construction.
 * - **The menus** (`GROUP_MENU`): a list's Channels (when it has any), Move (with two lists or
 *   more), Rename, Delete, Cancel; a group's Move (with two groups or more), Hide or Show, Cancel.
 * - **Move** picks the row up: UP and DOWN move it a place, CH+ and CH− a page, among the rows of
 *   its kind only; OK puts it there with one edit, Back puts it back with none. A moved group
 *   stores the order of every group as the screen then shows them, hidden ones included.
 * - **Rename** (`GROUP_RENAME`): the name field (onboarding's text editor) starts with the list's
 *   name; blank is "Favourites" (`null`). **Delete** asks first (`GROUP_DELETE`), "Cancel" focused.
 * - **A list's channels** (`GROUP_CHANNELS`): every key in the list's order, numbered by its
 *   place, read by key (`itemsByKey`, `KEY_BATCH` a call); a key the catalog doesn't have now
 *   shows the pool's normalized name. OK opens a channel's menu (`CHANNEL_MENU`): Move, Remove,
 *   Cancel.
 * - **Each edit** goes through the query worker (`editProfile`), one after another; then the live
 *   screen reads the profile again (`changed`) and the rows are read again, the focus on the row
 *   the edit was about. OK waits while anything is read or saved.
 */

export const GROUPS_SCREEN = 'groups';
export const GROUP_MENU = 'group-menu';
export const GROUP_RENAME = 'group-rename';
export const GROUP_DELETE = 'group-delete';
export const GROUP_CHANNELS = 'group-channels';
export const CHANNEL_MENU = 'group-channel-menu';

/** Every screen of "Channel groups", for the settings' list of screens. */
export const GROUP_SCREENS: readonly string[] = [GROUPS_SCREEN, GROUP_MENU, GROUP_RENAME, GROUP_DELETE, GROUP_CHANNELS, CHANNEL_MENU];

/** Sizes, all layout constants (no DOM measuring). settings.css uses the same numbers. */
export const GROUPS = {
  /** A row: its name, then a line under it. */
  rowHeight: 88,
  rowGap: 8,
} as const;

/** The safe area less the header (56 px and a 24 px gap) and the line under it (56 px). */
export const GROUPS_VISIBLE = fits(SCREEN.height - 2 * SCREEN.safeY - 56 - 24 - 56, GROUPS.rowHeight, GROUPS.rowGap);

/** The DOM id of the rename form's name input. */
export const GROUP_NAME_FIELD = 'group-name';
/** The rename form's buttons, and the delete question's. */
export const RENAME_SAVE = 0;
export const RENAME_CANCEL = 1;
export const DELETE_YES = 0;
export const DELETE_NO = 1;

/** A row of the screen: a favourites list, or a source's live group. */
export type GroupRow =
  | { readonly kind: 'list'; readonly list: FavouriteList }
  | {
      readonly kind: 'group';
      readonly group: GroupRef;
      /** Its live channels. */
      readonly count: number;
      readonly hidden: boolean;
      /** Its source's name when there are two sources or more (`''`: one source). */
      readonly source: string;
    };

/** A row of a list's channels: its key, the catalog's item (`null`: not in the sources now) and the name it shows. */
export interface ChannelRow {
  readonly key: ContentKey;
  readonly item: CatalogItem | null;
  readonly name: string;
}

export type GroupAction = 'channels' | 'move' | 'rename' | 'delete' | 'hide' | 'show' | 'remove' | 'cancel';

export type GroupsStatus = 'loading' | 'ready' | 'failed';

/** A row being moved: its zone, where it was and where it is now. */
export interface Moving {
  readonly zone: 'rows' | 'channels';
  readonly from: number;
  readonly at: number;
}

export interface GroupMenu {
  readonly actions: readonly GroupAction[];
  /** The row it is for: a list or a group (the groups screen), or a list's channel. */
  readonly row: GroupRow | null;
  readonly channel: ChannelRow | null;
}

/** What the screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface GroupsEngine {
  profile(): Promise<LoadedProfile | null>;
  categories(src: string, kind: 'live'): Promise<CategoryInfo[]>;
  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

export interface GroupsOptions {
  readonly nav: Navigator;
  readonly engine: GroupsEngine;
  /** An edit went through: the live screen reads the profile again (step 35c's `listsChanged`). */
  readonly changed?: () => void;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds the name's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing in the editor). */
  readonly now?: () => number;
}

export interface Groups {
  /** The groups screen while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<GroupsStatus>;
  readonly rows: ReadonlySignal<readonly GroupRow[]>;
  /** A list's channels' screen while it is on the stack. */
  readonly channelsScreen: ReadonlySignal<Screen | null>;
  /** The list whose channels show, while they do. */
  readonly list: ReadonlySignal<FavouriteList | null>;
  /** That list's channels (`null`: not read yet). */
  readonly channels: ReadonlySignal<readonly ChannelRow[] | null>;
  /** The row being moved, while one is. */
  readonly moving: ReadonlySignal<Moving | null>;
  /** The menu while it shows. */
  readonly menu: ReadonlySignal<GroupMenu | null>;
  /** The list the rename form or the delete question is for, while one shows. */
  readonly target: ReadonlySignal<FavouriteList | null>;
  /** The rename form's name as typed. */
  readonly text: ReadonlySignal<string>;
  readonly editor: EditorBinding;
  /** Reads and edits in flight: 0 means settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  /** Opens the screen and reads the rows. */
  open(): void;
  setText(value: string): void;
  dispose(): void;
}

/** A list or a group as one string, for the focus to follow it across reads. */
function rowId(row: GroupRow): string {
  return row.kind === 'list' ? `l${row.list.id}` : `g${groupId(row.group)}`;
}

/**
 * The rows: the lists in their order, then every live group with channels in the rail's order
 * (the user's ordered groups first), hidden ones too and marked. A source's name shows only when
 * there are two sources or more.
 */
export function groupRows(doc: unknown, sources: readonly { readonly id: string; readonly name: string; readonly categories: readonly CategoryInfo[] }[]): GroupRow[] {
  const rows: GroupRow[] = [];
  const lists = favouriteListsOf(doc);
  for (let i = 0; i < lists.length; i += 1) rows.push({ kind: 'list', list: lists[i]! });
  const hidden = hiddenGroupsOf(doc).map(groupId);
  const entries = railEntries(
    sources.map((s) => ({ src: s.id, categories: s.categories })),
    { lists: [], hidden: [], order: groupOrderOf(doc) },
  );
  // (Entry 0 is "All channels".)
  for (let i = 1; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const group: GroupRef = { src: entry.parts[0]!.src, name: entry.name };
    let source = '';
    if (sources.length > 1) for (let s = 0; s < sources.length; s += 1) if (sources[s]!.id === group.src) source = sources[s]!.name;
    rows.push({ kind: 'group', group, count: entry.count, hidden: hidden.indexOf(groupId(group)) !== -1, source });
  }
  return rows;
}

/** The menu's actions for `row` among `rows`: a move only with another row of its kind. */
export function rowActions(row: GroupRow, rows: readonly GroupRow[]): GroupAction[] {
  let same = 0;
  for (let i = 0; i < rows.length; i += 1) if (rows[i]!.kind === row.kind) same += 1;
  const actions: GroupAction[] = [];
  if (row.kind === 'list' && row.list.keys.length > 0) actions.push('channels');
  if (same > 1) actions.push('move');
  if (row.kind === 'list') actions.push('rename', 'delete');
  else actions.push(row.hidden ? 'show' : 'hide');
  actions.push('cancel');
  return actions;
}

/** A list's channel's actions among `count`. */
export function channelActions(count: number): GroupAction[] {
  return count > 1 ? ['move', 'remove', 'cancel'] : ['remove', 'cancel'];
}

/** The pool's normalized names by key (a channel the catalog doesn't have now shows its own). */
export function poolNames(doc: unknown): Map<ContentKey, string> {
  const names = new Map<ContentKey, string>();
  const pool = typeof doc === 'object' && doc !== null ? (doc as { favourites?: unknown }).favourites : undefined;
  if (!Array.isArray(pool)) return names;
  for (let i = 0; i < pool.length; i += 1) {
    const ref = pool[i] as { key?: unknown; normName?: unknown } | null;
    if (typeof ref === 'object' && ref !== null && typeof ref.key === 'string' && typeof ref.normName === 'string') names.set(ref.key, ref.normName);
  }
  return names;
}

/** `list`'s channels: every key in its order, with the item found for it, else the pool's name. */
export function channelRows(list: FavouriteList, found: readonly CatalogItem[], names: Map<ContentKey, string>): ChannelRow[] {
  const byKey = new Map<ContentKey, CatalogItem>();
  for (let i = 0; i < found.length; i += 1) byKey.set(found[i]!.key, found[i]!);
  return list.keys.map((key) => {
    const item = byKey.get(key) ?? null;
    return { key, item, name: item !== null ? item.name : (names.get(key) ?? '') };
  });
}

/** `list` with its entry at `from` moved to `to`. */
function shifted<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  const entry = next.splice(from, 1)[0]!;
  next.splice(to, 0, entry);
  return next;
}

const FORM_ZONES: ScreenSpec['zones'] = [
  { kind: 'list', id: 'field', axis: 'vertical', count: 1, neighbours: { down: 'actions' } },
  { kind: 'list', id: 'actions', axis: 'horizontal', count: 2, neighbours: { up: 'field' } },
];

function listZone(id: string, count: number): ZoneSpec {
  return { kind: 'list', id, axis: 'vertical', count, visible: GROUPS_VISIBLE };
}

/** The read: the profile's document, the stored sources' ids and names, and each one's live categories. */
interface Read {
  readonly doc: unknown;
  readonly sources: { readonly id: string; readonly name: string; readonly categories: CategoryInfo[] }[];
}

export function createGroups(options: GroupsOptions): Groups {
  const { nav, engine } = options;
  const screen = signal<Screen | null>(null);
  const status = signal<GroupsStatus>('loading');
  const rows = signal<readonly GroupRow[]>([]);
  const list = signal<FavouriteList | null>(null);
  const channels = signal<readonly ChannelRow[] | null>(null);
  const moving = signal<Moving | null>(null);
  const menu = signal<GroupMenu | null>(null);
  const target = signal<FavouriteList | null>(null);
  const text = signal('');
  const pending = signal(0);
  /** The channels' screen while it is on the stack. */
  const channelsScreen = signal<Screen | null>(null);

  let disposed = false;
  /** The stored sources' ids at the last read (a list's items are looked up in them). */
  let srcIds: string[] = [];
  /** The pool's names at the last read. */
  let names = new Map<ContentKey, string>();
  /** Bumps on each read: an older read's answer is dropped. */
  let readSeq = 0;
  /** The row the focus goes to when the next read lands (`rowId`, or a channel's key). */
  let follow: string | null = null;
  /** The rows (or the channels) before a move: Back puts them back. */
  let before: readonly (GroupRow | ChannelRow)[] = [];
  /** The edits, one after another. */
  let chain: Promise<void> = Promise.resolve();

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

  /** The groups screen's zone for the rows read, the focus on `follow`'s row. */
  const place = (wanted: string | null): void => {
    const shown = screen.value;
    if (shown === null) return;
    const all = rows.value;
    shown.update(listZone('rows', all.length));
    for (let i = 0; i < all.length; i += 1) if (wanted !== null && rowId(all[i]!) === wanted) shown.focus('rows', i);
  };

  /** Reads `shown`'s channels by key for read `seq`; the channels' zone follows once they are in. */
  const readChannels = (shown: FavouriteList, seq: number, wanted: string | null): Promise<void> => {
    const asks: Promise<CatalogItem[]>[] = [];
    for (let i = 0; i < shown.keys.length; i += KEY_BATCH) {
      const req: KeyItemsRequest = { keys: shown.keys.slice(i, i + KEY_BATCH), kind: 'live', sources: srcIds, limit: Math.min(KEY_BATCH, shown.keys.length - i) };
      asks.push(track(() => engine.itemsByKey(req)));
    }
    return Promise.all(asks).then(
      (found) => {
        if (disposed || seq !== readSeq || list.value === null || list.value.id !== shown.id) return;
        let items: CatalogItem[] = [];
        for (let b = 0; b < found.length; b += 1) items = items.concat(found[b]!);
        const next = channelRows(shown, items, names);
        list.value = shown;
        channels.value = next;
        const on = channelsScreen.value;
        if (on === null) return;
        on.update(listZone('channels', next.length));
        for (let i = 0; i < next.length; i += 1) if (wanted !== null && next[i]!.key === wanted) on.focus('channels', i);
      },
      (error: unknown) => {
        if (!disposed) console.warn("A list's channels could not be read", error);
      },
    );
  };

  /** Reads the rows again (and the channels on show); settles once they are in, either way. */
  const read = (): Promise<void> => {
    readSeq += 1;
    const seq = readSeq;
    const wanted = follow;
    follow = null;
    return track(async (): Promise<Read> => {
      const profile = await engine.profile();
      const records = storedSources(profile);
      const lists = await Promise.all(records.map((r) => engine.categories(r.id, 'live')));
      return { doc: profile === null ? null : profile.doc, sources: records.map((r, i) => ({ id: r.id, name: r.name, categories: lists[i]! })) };
    }).then(
      (got) => {
        if (disposed || seq !== readSeq) return;
        srcIds = got.sources.map((s) => s.id);
        names = poolNames(got.doc);
        rows.value = groupRows(got.doc, got.sources);
        status.value = 'ready';
        place(wanted);
        const shown = list.value;
        if (shown === null) return;
        // The list on show as now stored (gone: its screen shows no channel).
        let now: FavouriteList = { id: shown.id, name: shown.name, keys: [] };
        const lists = favouriteListsOf(got.doc);
        for (let i = 0; i < lists.length; i += 1) if (lists[i]!.id === shown.id) now = lists[i]!;
        return readChannels(now, seq, wanted);
      },
      (error: unknown) => {
        if (disposed || seq !== readSeq) return;
        console.warn('The channel groups could not be read', error);
        if (status.value === 'loading') status.value = 'failed';
      },
    );
  };

  /** Saves `edit` after the edits before it; then the live screen and the rows read again, the focus on `then`. */
  const save = (edit: ProfileEdit, then: string | null): void => {
    chain = chain.then(async () => {
      let saved = false;
      try {
        saved = await track(() => engine.editProfile(edit));
      } catch (error) {
        console.warn('The channel groups were not saved', error);
      }
      // Even when the screen went meanwhile: the live screen's rail changed.
      if (saved) options.changed?.();
      if (disposed) return;
      follow = then;
      await read();
    });
  };

  /** Closes the screen on top (a menu, a form, a question: only their own keys call this). */
  const closeTop = (): void => {
    menu.value = null;
    target.value = null;
    nav.pop();
  };

  /** A screen's `onIntent` where Back runs `close` (and other keys go on). */
  const backTo =
    (close: () => void) =>
    (intent: Intent): boolean => {
      if (intent !== 'BACK') return false;
      close();
      return true;
    };

  /** The rows a move works on: the groups screen's, or the channels'. */
  const movingRows = (zone: Moving['zone']): readonly (GroupRow | ChannelRow)[] => (zone === 'rows' ? rows.value : (channels.value ?? []));

  /** Picks row `at` of `zone` up. */
  const startMove = (zone: Moving['zone'], at: number): void => {
    before = movingRows(zone);
    moving.value = { zone, from: at, at };
  };

  /** Moves the row being moved by `by` places, among the rows of its kind. */
  const shift = (by: number): void => {
    const m = moving.value;
    if (m === null) return;
    const all = movingRows(m.zone);
    let lo = 0;
    let hi = all.length - 1;
    if (m.zone === 'rows') {
      const kind = (all[m.at] as GroupRow).kind;
      while ((all[lo] as GroupRow).kind !== kind) lo += 1;
      while ((all[hi] as GroupRow).kind !== kind) hi -= 1;
    }
    const to = Math.max(lo, Math.min(hi, m.at + by));
    if (to === m.at) return;
    if (m.zone === 'rows') rows.value = shifted(rows.value, m.at, to);
    else channels.value = shifted(channels.value ?? [], m.at, to);
    moving.value = { zone: m.zone, from: m.from, at: to };
    (m.zone === 'rows' ? screen.value : channelsScreen.value)?.focus(m.zone, to);
  };

  /** Puts the row being moved down where it is now: one edit, unless it is where it was. */
  const endMove = (): void => {
    const m = moving.value;
    if (m === null) return;
    moving.value = null;
    if (m.at === m.from) return;
    if (m.zone === 'channels') {
      const shown = list.value;
      const moved = (channels.value ?? [])[m.at];
      if (shown !== null && moved !== undefined) save({ kind: 'favourite', change: { op: 'move', list: shown.id, key: moved.key, to: m.at } }, moved.key);
      return;
    }
    const all = rows.value;
    const row = all[m.at]!;
    if (row.kind === 'list') {
      save({ kind: 'favourite', change: { op: 'moveList', list: row.list.id, to: m.at } }, rowId(row));
      return;
    }
    const groups: GroupRef[] = [];
    for (let i = 0; i < all.length; i += 1) {
      const r = all[i]!;
      if (r.kind === 'group') groups.push(r.group);
    }
    save({ kind: 'group', change: { op: 'order', groups } }, rowId(row));
  };

  /** Back while moving: the rows as they were, the focus on the row where it was. */
  const cancelMove = (): void => {
    const m = moving.value;
    if (m === null) return;
    moving.value = null;
    if (m.zone === 'rows') {
      rows.value = before as readonly GroupRow[];
      screen.value?.focus('rows', m.from);
    } else {
      channels.value = before as readonly ChannelRow[];
      channelsScreen.value?.focus('channels', m.from);
    }
  };

  /** A move's keys: UP and DOWN a place, CH+ and CH− a page, OK puts it down, Back puts it back. */
  const moveKeys = (zone: Moving['zone'], intent: Intent): boolean => {
    const m = moving.value;
    if (m === null || m.zone !== zone) return false;
    if (intent === 'UP' || intent === 'DOWN') shift(intent === 'UP' ? -1 : 1);
    else if (intent === 'CH_UP' || intent === 'CH_DOWN') shift(intent === 'CH_UP' ? -GROUPS_VISIBLE : GROUPS_VISIBLE);
    else if (intent === 'OK') endMove();
    else if (intent === 'BACK') cancelMove();
    else return false;
    return true;
  };

  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);

  /** Closes the rename form (it is on top), ending the edit first. */
  const closeRename = (): void => {
    textEditor.close();
    closeTop();
  };

  const openRename = (shown: FavouriteList): void => {
    target.value = shown;
    text.value = shown.name ?? '';
    nav.push({
      id: GROUP_RENAME,
      zones: FORM_ZONES,
      onIntent: backTo(closeRename),
      onSelect: (focus: Focus) => {
        if (focus.zone === 'field') {
          textEditor.open(GROUP_NAME_FIELD);
          return;
        }
        const typed = text.value;
        closeRename();
        if (focus.index !== RENAME_SAVE) return;
        const name = blank(typed) ? null : typed;
        if (name !== shown.name) save({ kind: 'favourite', change: { op: 'rename', list: shown.id, name } }, `l${shown.id}`);
      },
    });
  };

  const openDelete = (shown: FavouriteList): void => {
    target.value = shown;
    const asked = nav.push({
      id: GROUP_DELETE,
      zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 2 }],
      onIntent: backTo(closeTop),
      onSelect: (focus) => {
        closeTop();
        if (focus.index === DELETE_YES) save({ kind: 'favourite', change: { op: 'removeList', list: shown.id } }, null);
      },
    });
    // The safe answer first, as the backup's questions.
    asked.focus('actions', DELETE_NO);
  };

  /** Closes the channels' screen (it is on top: only its own keys call this). */
  const closeChannels = (): void => {
    channelsScreen.value = null;
    list.value = null;
    channels.value = null;
    nav.pop();
  };

  const openChannels = (shown: FavouriteList): void => {
    list.value = shown;
    channels.value = null;
    channelsScreen.value = nav.push({
      id: GROUP_CHANNELS,
      zones: [listZone('channels', 0)],
      onIntent: (intent) => moveKeys('channels', intent) || backTo(closeChannels)(intent),
      onSelect: (focus) => {
        // (A click while moving puts the row down where it is now.)
        if (moving.value !== null) endMove();
        else if (pending.value === 0) openChannelMenu(focus.index);
      },
    });
    void readChannels(shown, readSeq, null);
  };

  /** A row's menu (`id`: the groups' or a list's channel's): OK closes it, then `act` runs the action picked. */
  const showMenu = (id: string, shown: GroupMenu, act: (action: GroupAction | undefined) => void): void => {
    menu.value = shown;
    nav.push({
      id,
      zones: [{ kind: 'list', id: 'actions', axis: 'vertical', count: shown.actions.length }],
      onIntent: backTo(closeTop),
      onSelect: (focus) => {
        closeTop();
        act(shown.actions[focus.index]);
      },
    });
  };

  const openMenu = (index: number): void => {
    const all = rows.value;
    const row = all[index];
    if (row === undefined) return;
    showMenu(GROUP_MENU, { actions: rowActions(row, all), row, channel: null }, (action) => {
      if (action === 'move') startMove('rows', index);
      else if (row.kind === 'group') {
        if (action === 'hide' || action === 'show') save({ kind: 'group', change: { op: action, group: row.group } }, rowId(row));
      } else if (action === 'channels') openChannels(row.list);
      else if (action === 'rename') openRename(row.list);
      else if (action === 'delete') openDelete(row.list);
    });
  };

  const openChannelMenu = (index: number): void => {
    const shown = list.value;
    const all = channels.value;
    const channel = all === null ? undefined : all[index];
    if (shown === null || all === null || channel === undefined) return;
    showMenu(CHANNEL_MENU, { actions: channelActions(all.length), row: null, channel }, (action) => {
      if (action === 'move') startMove('channels', index);
      // The focus stays on the place: the next channel takes it (or the channel, when the remove failed).
      else if (action === 'remove') save({ kind: 'favourite', change: { op: 'remove', list: shown.id, key: channel.key } }, null);
    });
  };

  return {
    screen,
    channelsScreen,
    status,
    rows,
    list,
    channels,
    moving,
    menu,
    target,
    text,
    editor,
    pending,
    open(): void {
      if (disposed) return;
      moving.value = null;
      screen.value = nav.push({
        id: GROUPS_SCREEN,
        zones: [listZone('rows', rows.value.length)],
        onIntent: (intent) => moveKeys('rows', intent),
        onSelect: (focus) => {
          if (moving.value !== null) endMove();
          else if (pending.value === 0) openMenu(focus.index);
        },
      });
      void read();
    },
    setText(value: string): void {
      text.value = value;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      editor.dispose();
      textEditor.dispose();
    },
  };
}
