import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey } from '@lablo/core';
import type { LoadedProfile, ProfileEdit } from '@lablo/data';
import type { ChannelChange, ChannelEdit } from '@lablo/data/client';
import { CHANNEL_NUMBER_MAX, channelEditsOf } from '@lablo/data/client';
import type { Intent, Platform } from '@lablo/platform-api';
import { DIGIT_INTENTS } from '@lablo/platform-api';
import type { EditorBinding, Focus, Navigator, Screen, ScreenSpec, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { bindEditor, createTextEditor } from '@lablo/ui';
import { favouriteItem } from '../player/favourite-menu';

/**
 * "Edit channel" (RELAY step 36c, architecture.md §1.4 item 10 "Built in step 36c"): the menu for
 * one live channel, opened over the player by the info bar's pencil (`openOver`), or from
 * Settings › "Channels" (`open`, `edited-channels.ts`). One screen on the live navigator:
 *
 *   actions  (Rename, Channel number, Hide channel or Show channel, "Undo my changes" when the
 *            user changed anything, Cancel; a channel not in the sources now has only the last two)
 *
 * - **Rename** (`EDIT_RENAME`): onboarding's text editor in a field that starts with the name on
 *   show; empty is the provider's name again (`null`), the name on show makes no edit.
 * - **Channel number** (`EDIT_NUMBER`): the field starts with the user's number (empty with none);
 *   the remote's digits type into it (the first one, one after a wrong number and one after four
 *   digits start a new number), OK on it opens the TV's number keyboard. Empty is the channel's own number again; anything but a whole 1 to 9999 says so and
 *   saves nothing. A number another channel has moves here (the query worker's rule).
 * - **Hide** and **Show**, and "Undo my changes" (every change gone), are one edit each.
 * - **Each edit** goes through the query worker (`editProfile`, kind `channel`). Once it went
 *   through, the menu closes (the player's info bar, or the "Channels" page, shows again), the page
 *   reads its rows (`done`), and the live screen reads the channels (`changed`: the list, the
 *   rail and the player follow). Refused, the menu or the form stays and says so. OK waits while
 *   anything is read or saved.
 * - Opened over the player, it reads the channel's changes from the profile first; STOP in it
 *   closes the player too.
 *
 * Main-safe as the settings are (settings.js goes through main's Babel and checks): no `trim`,
 * `.sort(` or regex; blanks by char code.
 */

export const EDIT_SCREEN = 'channel-edit';
export const EDIT_RENAME = 'channel-rename';
export const EDIT_NUMBER = 'channel-number';
/** The menu and its two forms: painted over the player when the pencil opened them. */
export const EDIT_SCREENS: readonly string[] = [EDIT_SCREEN, EDIT_RENAME, EDIT_NUMBER];

/** The DOM ids of the forms' inputs (the text editor finds them by these). */
export const CHANNEL_NAME_FIELD = 'channel-name';
export const CHANNEL_NUMBER_FIELD = 'channel-number-input';
/** The forms' buttons. */
export const FORM_SAVE = 0;
export const FORM_CANCEL = 1;
/** The most digits a channel number has (number entry's four). */
export const NUMBER_DIGITS = 4;

export type EditAction = 'rename' | 'number' | 'hide' | 'show' | 'reset' | 'cancel';

/** The channel a menu is for. */
export interface EditTarget {
  readonly key: ContentKey;
  /** The catalog's item as the worker shows it (`null`: not in the sources now). */
  readonly item: CatalogItem | null;
  /** What the user changed (`null`: nothing). */
  readonly edit: ChannelEdit | null;
  /** The name on show: the item's, else the user's, else the stored normalized one. */
  readonly name: string;
}

/** Why the last save didn't go: the worker refused it, or the number typed isn't one. */
export type EditProblem = 'refused' | 'number';

/** What the menu needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface ChannelEditEngine {
  profile(): Promise<LoadedProfile | null>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

export interface ChannelEditOptions {
  readonly nav: Navigator;
  readonly engine: ChannelEditEngine;
  /** An edit went through: the live screen reads the channels again (`Live.channelsChanged`). */
  readonly changed?: () => unknown;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds a field's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The wall clock (epoch ms): a new entry's `added`, and the editor's click pairing. */
  readonly now?: () => number;
}

export interface ChannelEditor {
  /** The menu's screen while it is on the navigator. */
  readonly screen: ReadonlySignal<Screen | null>;
  /** The channel it is for. */
  readonly target: ReadonlySignal<EditTarget | null>;
  /** The menu's actions (none while the pencil's read of the channel's changes is out). */
  readonly actions: ReadonlySignal<readonly EditAction[]>;
  /** Opened by the info bar's pencil: it paints over the player. */
  readonly over: ReadonlySignal<boolean>;
  /** Reads and edits in flight: 0 means settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  readonly problem: ReadonlySignal<EditProblem | null>;
  /** A form's text as typed. */
  readonly text: ReadonlySignal<string>;
  readonly editor: EditorBinding;
  /** The pencil: the menu over the player for `item`; `closed` runs when it closes, `stop` on STOP (the player closes). */
  openOver(item: CatalogItem, closed: () => void, stop: () => void): void;
  /** Settings › "Channels": the menu for `target`; `done` runs after each edit that went through. */
  open(target: EditTarget, done: () => void): void;
  setText(value: string): void;
  /** Closes the menu and its form (the player closing, or a card over it). */
  close(): void;
  dispose(): void;
}

/** The menu's actions for `target`. */
export function editActions(target: EditTarget): EditAction[] {
  const actions: EditAction[] = [];
  if (target.item !== null) actions.push('rename', 'number', target.edit !== null && target.edit.hidden === true ? 'show' : 'hide');
  if (target.edit !== null) actions.push('reset');
  actions.push('cancel');
  return actions;
}

function isSpace(c: number): boolean {
  return c <= 32 || c === 160 || c === 0x3000;
}

/** `text` without the spaces at its ends (no `trim`: it pulls a polyfill in; the worker trims too). */
export function trimmed(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isSpace(text.charCodeAt(start))) start += 1;
  while (end > start && isSpace(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

/** The number typed: `null` for none (empty), a whole 1 to `CHANNEL_NUMBER_MAX` from digits alone, else `undefined`. */
export function typedNumber(text: string): number | null | undefined {
  const typed = trimmed(text);
  if (typed === '') return null;
  let n = 0;
  for (let i = 0; i < typed.length; i += 1) {
    const c = typed.charCodeAt(i);
    if (c < 48 || c > 57) return undefined;
    n = n * 10 + (c - 48);
  }
  return n >= 1 && n <= CHANNEL_NUMBER_MAX ? n : undefined;
}

/** The stored changes of channel `key` (`null`: none). */
export function editOf(doc: unknown, key: ContentKey): ChannelEdit | null {
  const edits = channelEditsOf(doc);
  for (let i = 0; i < edits.length; i += 1) if (edits[i]!.key === key) return edits[i]!;
  return null;
}

const FORM_ZONES: ScreenSpec['zones'] = [
  { kind: 'list', id: 'field', axis: 'vertical', count: 1, neighbours: { down: 'actions' } },
  { kind: 'list', id: 'actions', axis: 'horizontal', count: 2, neighbours: { up: 'field' } },
];

export function createChannelEditor(options: ChannelEditOptions): ChannelEditor {
  const { nav, engine } = options;
  const now = options.now ?? (() => Date.now());
  const screen = signal<Screen | null>(null);
  const target = signal<EditTarget | null>(null);
  const actions = signal<readonly EditAction[]>([]);
  const over = signal(false);
  const pending = signal(0);
  const problem = signal<EditProblem | null>(null);
  const text = signal('');
  /** Bumps when the menu opens or closes: an answer for an earlier one only settles `pending`. */
  let seq = 0;
  /** The pencil's ends: the player's (`null` from Settings). */
  let ends: { readonly closed: () => void; readonly stop: () => void } | null = null;
  /** Settings' "read the rows again" (`null` over the player). */
  let done: (() => void) | null = null;
  /** The number form's text is the stored number until the first digit replaces it. */
  let typed = false;

  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);

  /** Runs `request`, counting it in `pending` until it settles either way. */
  function track<T>(request: Promise<T>): Promise<T> {
    pending.value += 1;
    const settle = (): void => {
      pending.value -= 1;
    };
    request.then(settle, settle);
    return request;
  }

  const zone = (): ZoneSpec => ({ kind: 'list', id: 'actions', axis: 'vertical', count: actions.value.length });

  const show = (next: EditTarget): void => {
    target.value = next;
    actions.value = editActions(next);
    screen.value?.update(zone());
  };

  /** Closes the form on top, if one shows, ending the edit first. */
  const closeForm = (): void => {
    textEditor.close();
    problem.value = null;
    const top = nav.top.id;
    if (top === EDIT_RENAME || top === EDIT_NUMBER) nav.pop();
  };

  const close = (): void => {
    const shown = screen.value;
    if (shown === null) return;
    seq += 1;
    closeForm();
    screen.value = null;
    target.value = null;
    actions.value = [];
    if (shown.open && nav.top === shown) nav.pop();
    const was = ends;
    ends = null;
    done = null;
    if (was !== null) was.closed();
  };

  /**
   * Applies `change`. Once it went through, the menu closes, then Settings' page and the live
   * screen read again; refused, the menu (or the form) stays and says so.
   */
  const run = (change: ChannelChange): void => {
    const mine = seq;
    const after = done;
    problem.value = null;
    track(
      engine.editProfile({ kind: 'channel', change }).then((ok) => {
        if (!ok) {
          if (mine === seq) problem.value = 'refused';
          return;
        }
        if (mine === seq) close();
        if (after !== null) after();
        return options.changed?.();
      }),
    ).then(undefined, (error: unknown) => {
      if (mine === seq) problem.value = 'refused';
      console.warn('The channel was not changed', error);
    });
  };

  /** A form's Save: the rename or the number, unless it changes nothing (then the menu just closes). */
  const save = (id: string): void => {
    const shown = target.value;
    if (shown === null || shown.item === null || pending.value > 0) return;
    const item = favouriteItem(shown.item, now());
    const edit = shown.edit;
    if (id === EDIT_RENAME) {
      const name = trimmed(text.value);
      // Empty with no name of the user's, or the name on show: nothing to change.
      if (name === '' ? edit === null || edit.name === undefined : name === shown.name) close();
      else run({ op: 'rename', item, name: name === '' ? null : name });
      return;
    }
    const number = typedNumber(text.value);
    if (number === undefined) {
      problem.value = 'number';
      return;
    }
    if (number === (edit === null || edit.number === undefined ? null : edit.number)) close();
    else run({ op: 'number', item, number });
  };

  const openForm = (id: string, start: string): void => {
    text.value = start;
    typed = false;
    problem.value = null;
    nav.push({
      id,
      zones: FORM_ZONES,
      initial: 'field',
      onIntent: (intent: Intent) => {
        if (intent === 'BACK') {
          closeForm();
          return true;
        }
        // The number form: the remote's digits type into it. The first one, one after a wrong
        // number or after four digits starts a new number (the remote has no key to take one out).
        const d = DIGIT_INTENTS.indexOf(intent as (typeof DIGIT_INTENTS)[number]);
        if (id !== EDIT_NUMBER || d === -1) return false;
        const before = typed && problem.value === null && text.value.length < NUMBER_DIGITS ? text.value : '';
        typed = true;
        text.value = before + d;
        problem.value = null;
        return true;
      },
      onSelect: (focus: Focus) => {
        if (focus.zone === 'field') textEditor.open(id === EDIT_RENAME ? CHANNEL_NAME_FIELD : CHANNEL_NUMBER_FIELD);
        else if (focus.index === FORM_SAVE) save(id);
        else closeForm();
      },
    });
  };

  const select = (action: EditAction | undefined): void => {
    const shown = target.value;
    if (shown === null || pending.value > 0) return;
    const item = shown.item;
    if (action === 'cancel') close();
    else if (action === 'reset') run({ op: 'reset', key: shown.key });
    else if (action === 'show') run({ op: 'show', key: shown.key });
    else if (item === null) return;
    else if (action === 'hide') run({ op: 'hide', item: favouriteItem(item, now()) });
    else if (action === 'rename') openForm(EDIT_RENAME, shown.name);
    else if (action === 'number') openForm(EDIT_NUMBER, shown.edit === null || shown.edit.number === undefined ? '' : String(shown.edit.number));
  };

  const push = (next: EditTarget): void => {
    seq += 1;
    problem.value = null;
    target.value = next;
    actions.value = [];
    screen.value = nav.push({
      id: EDIT_SCREEN,
      zones: [zone()],
      onIntent: (intent: Intent) => {
        if (intent === 'BACK') close();
        else if (intent === 'STOP' && ends !== null) {
          const stop = ends.stop;
          close();
          stop();
        } else return false;
        return true;
      },
      onSelect: (focus: Focus) => select(actions.value[focus.index]),
    });
  };

  return {
    screen,
    target,
    actions,
    over,
    pending,
    problem,
    text,
    editor,
    openOver(item: CatalogItem, closed: () => void, stop: () => void): void {
      if (screen.value !== null) return;
      ends = { closed, stop };
      done = null;
      over.value = true;
      const unread: EditTarget = { key: item.key, item, edit: null, name: item.name };
      push(unread);
      const mine = seq;
      track(engine.profile()).then(
        (profile) => {
          if (mine === seq) show({ key: item.key, item, edit: editOf(profile === null ? null : profile.doc, item.key), name: item.name });
        },
        (error: unknown) => {
          // Unread, the menu offers what a channel with no changes has.
          if (mine === seq) show(unread);
          console.warn("The channel's changes could not be read", error);
        },
      );
    },
    open(next: EditTarget, after: () => void): void {
      if (screen.value !== null) return;
      ends = null;
      done = after;
      over.value = false;
      push(next);
      show(next);
    },
    setText(value: string): void {
      text.value = value;
      typed = true;
    },
    close,
    dispose(): void {
      editor.dispose();
      textEditor.dispose();
    },
  };
}
