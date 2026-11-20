import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem } from '@lablo/core';
import type { ProfileEdit } from '@lablo/data';
import type { FavouriteChange, FavouriteItem, FavouriteList } from '@lablo/data/client';
import { MAX_FAVOURITE_LISTS } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';
import type { EditorBinding, Focus, Navigator, Screen, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { bindEditor, createTextEditor } from '@lablo/ui';

/**
 * The favourites panel (RELAY step 35c): the info bar's star opens it over the player, for the
 * channel on the bar. A screen on the live navigator, as the track menu is:
 *
 *   lists  (each favourites list, checked when it holds the channel: OK adds it or takes it out;
 *          then "New list", while there is room. With no list yet, the first row is
 *          "Favourites": OK makes that list with the channel in it.)
 *
 * "New list" opens a form over it (`NEW_LIST_SCREEN`): the name (optional: empty is
 * "Favourites"; the input stops at `LIST_NAME_MAX`), "Create list" and "Cancel". The new list
 * takes the channel, and the panel shows it focused.
 *
 * Each edit goes through the query worker (`editProfile`, kind `favourite`). An add it refuses (a
 * full list, a full pool) says "This list is full"; a list it refuses to make says "Couldn't make
 * the list". OK waits while an edit runs. After each edit the live screen reads the profile again
 * (`changed`), and the panel's rows follow its lists. Back closes the form, then the panel; STOP
 * closes the player too.
 */

export const FAVOURITES_SCREEN = 'favourites';
export const NEW_LIST_SCREEN = 'favourite-new';
/** The DOM id of the new list's name input (the text editor finds it by this). */
export const LIST_NAME_FIELD = 'favourite-name';
/** The form's buttons. */
export const NEW_CREATE = 0;
export const NEW_CANCEL = 1;
/** Rows the panel shows; more scroll. */
export const PANEL_ROWS = 6;

/** Why the last edit changed nothing. */
export type FavouriteProblem = 'full' | 'refused';

/** What the panel needs from the app. */
export interface FavouriteHost {
  /** Applies a profile edit (the query worker's `editProfile`). */
  readonly edit: (edit: ProfileEdit) => Promise<boolean>;
  /** The lists as the live screen read them last. */
  readonly lists: ReadonlySignal<readonly FavouriteList[]>;
  /** An edit went through: the live screen reads the profile again (settles once its lists are in). */
  readonly changed: () => Promise<void>;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds the name's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The wall clock (epoch ms): a favourite's `added`, a new list's id. */
  readonly now?: () => number;
}

export interface FavouriteMenuOptions extends FavouriteHost {
  readonly nav: Navigator;
  /** The panel closed (the player shows its info bar again). */
  readonly closed: () => void;
  /** STOP in the panel: the player closes. */
  readonly stop: () => void;
}

export interface FavouriteMenu {
  /** The panel's screen while it shows. */
  readonly screen: ReadonlySignal<Screen | null>;
  /** The channel it is for. */
  readonly item: ReadonlySignal<CatalogItem | null>;
  /** Edits running (each with the live screen's read after it): 0 means settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  readonly problem: ReadonlySignal<FavouriteProblem | null>;
  /** The new list's name as typed. */
  readonly text: ReadonlySignal<string>;
  readonly editor: EditorBinding;
  /** Rows of the panel: the lists (or the one to make, "Favourites"), then "New list" while there is room. */
  rows(): number;
  /** Opens the panel for `item`. */
  show(item: CatalogItem): void;
  setText(value: string): void;
  close(): void;
  dispose(): void;
}

/** Whether `text` is empty or only spaces (no `trim`: it pulls a polyfill into main; the worker trims). Settings' rename form uses it too (step 35d). */
export function blank(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c > 32 && c !== 160 && c !== 0x3000) return false;
  }
  return true;
}

/** A favourite as the query worker stores it: the catalog item's facts re-matching needs. */
export function favouriteItem(item: CatalogItem, added: number): FavouriteItem {
  return { key: item.key, src: item.src, kind: item.kind, normName: item.normName, group: item.group, epgId: item.epgId, added };
}

/** A list id none of `lists` has: `l` and the clock in base 36, then a count if taken. */
export function newListId(lists: readonly FavouriteList[], now: number): string {
  const base = `l${now.toString(36)}`;
  let id = base;
  for (let n = 1; lists.some((l) => l.id === id); n += 1) id = `${base}-${n}`;
  return id;
}

export function createFavouriteMenu(options: FavouriteMenuOptions): FavouriteMenu {
  const { nav } = options;
  const now = options.now ?? (() => Date.now());
  const screen = signal<Screen | null>(null);
  const item = signal<CatalogItem | null>(null);
  const pending = signal(0);
  const problem = signal<FavouriteProblem | null>(null);
  const text = signal('');
  /** Bumps when the panel opens or closes: an edit's answer from before only settles `pending`. */
  let seq = 0;

  const lists = (): readonly FavouriteList[] => options.lists.value;
  const room = (): boolean => lists().length < MAX_FAVOURITE_LISTS;
  const rows = (): number => Math.max(1, lists().length) + (room() ? 1 : 0);
  const zone = (): ZoneSpec => ({ kind: 'list', id: 'lists', axis: 'vertical', count: rows(), visible: PANEL_ROWS });

  /** The form closes (it is on top while it shows), ending the edit first. */
  const closeForm = (): void => {
    textEditor.close();
    if (nav.top.id === NEW_LIST_SCREEN) nav.pop();
  };

  const close = (): void => {
    const shown = screen.value;
    if (shown === null) return;
    seq += 1;
    closeForm();
    screen.value = null;
    item.value = null;
    if (shown.open && nav.top === shown) nav.pop();
    options.closed();
  };

  /**
   * Applies `change`; once the live screen has read the lists again, the panel's rows follow and
   * `then` runs (the panel still open). Refused: `refusal` says why (`null`: a take-out of a
   * channel the list no longer holds, which needs no word).
   */
  const run = (change: FavouriteChange, refusal: FavouriteProblem | null, then?: () => void): void => {
    const mine = seq;
    pending.value += 1;
    problem.value = null;
    const done = (): void => {
      pending.value -= 1;
    };
    options
      .edit({ kind: 'favourite', change })
      .then((ok) => {
        if (!ok) {
          if (mine === seq) problem.value = refusal;
          return;
        }
        return options.changed().then(() => {
          const shown = screen.value;
          if (mine !== seq || shown === null) return;
          shown.update(zone());
          if (then !== undefined) then();
        });
      })
      .then(done, (error: unknown) => {
        done();
        console.warn('The favourites were not saved', error);
      });
  };

  /** The form's "Create list": a new list at the end, named as typed (blank: "Favourites"), holding the channel. */
  const create = (): void => {
    const channel = item.value;
    if (channel === null || pending.value > 0) return;
    const typed = text.value;
    closeForm();
    const at = lists().length;
    run({ op: 'newList', id: newListId(lists(), now()), name: blank(typed) ? null : typed, item: favouriteItem(channel, now()) }, 'refused', () => screen.value?.focus('lists', at));
  };

  const openForm = (): void => {
    text.value = '';
    problem.value = null;
    nav.push({
      id: NEW_LIST_SCREEN,
      zones: [
        { kind: 'list', id: 'field', axis: 'vertical', count: 1, neighbours: { down: 'actions' } },
        { kind: 'list', id: 'actions', axis: 'horizontal', count: 2, neighbours: { up: 'field' } },
      ],
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        closeForm();
        return true;
      },
      onSelect: (focus: Focus) => {
        if (focus.zone === 'field') textEditor.open(LIST_NAME_FIELD);
        else if (focus.index === NEW_CREATE) create();
        else closeForm();
      },
    });
  };

  const onSelect = (focus: Focus): void => {
    const channel = item.value;
    if (channel === null || pending.value > 0) return;
    const shown = lists();
    const list = shown[focus.index];
    if (list !== undefined) {
      if (list.keys.indexOf(channel.key) !== -1) run({ op: 'remove', list: list.id, key: channel.key }, null);
      else run({ op: 'add', list: list.id, item: favouriteItem(channel, now()) }, 'full');
    } else if (shown.length === 0 && focus.index === 0) {
      // No list yet: "Favourites" is made with the channel in it.
      run({ op: 'newList', id: newListId(shown, now()), name: null, item: favouriteItem(channel, now()) }, 'refused');
    } else openForm();
  };

  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);

  return {
    screen,
    item,
    pending,
    problem,
    text,
    editor,
    rows,
    show(channel: CatalogItem): void {
      if (screen.value !== null) return;
      seq += 1;
      item.value = channel;
      problem.value = null;
      screen.value = nav.push({
        id: FAVOURITES_SCREEN,
        zones: [zone()],
        onIntent: (intent) => {
          if (intent === 'BACK') close();
          else if (intent === 'STOP') {
            close();
            options.stop();
          } else return false;
          return true;
        },
        onSelect,
      });
    },
    setText(value: string): void {
      text.value = value;
    },
    close,
    dispose(): void {
      editor.dispose();
      textEditor.dispose();
    },
  };
}
