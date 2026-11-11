import type { KeyLike, Platform, TextKey } from '@lablo/platform-api';
import type { Navigator } from './navigator';
import { OK_CLICK_WINDOW_MS } from './navigator';

/**
 * Text input on a TV (RELAY step 13a, docs/architecture.md §1.2 "Text input"). The focus engine
 * never uses DOM focus, but a native `<input>` needs it: DOM focus is what opens the TV's
 * on-screen keyboard (the Tizen IME, the webOS virtual keyboard, Arabic included). So:
 *
 * - the field is an item of a zone like any other: the engine focuses it with a class;
 * - OK (or a pointer click) on it calls `open(id)`, which gives its input DOM focus: the keys
 *   now go to the input, and `connectRemote` leaves them alone (`isEditable`);
 * - the input's own key handler ends the edit on the platform's text keys (`Platform.textKey`):
 *   `done` and `down` move the engine's focus down (to the next field or the buttons), `up` up,
 *   `close` keeps it on the field; the input is blurred, and the typed text is always kept;
 * - the edit also ends when the input loses DOM focus another way, or when the platform says
 *   its on-screen keyboard hid (webOS `keyboardStateChange`).
 *
 * A Magic Remote OK sends a click and key 13 for one press (step 11b). When the click opens the
 * field, its twin key 13 then reaches the input as `done`; one that comes within
 * `OK_CLICK_WINDOW_MS` of the open, before anything was typed, is the same press and is ignored.
 */

/** The parts of an `<input>` the editor uses (a real one, or a test double). */
export interface EditableLike {
  focus(): void;
  blur(): void;
}

/** The parts of a key event the field's handler uses. */
export interface EditKeyEvent extends KeyLike {
  preventDefault(): void;
  stopPropagation(): void;
}

export interface TextEditorOptions {
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Moves the focus after `done`, `up` and `down`. */
  readonly nav: Pick<Navigator, 'handle'>;
  /** Finds a field's input by its id. Default `document.getElementById`. */
  readonly find?: (id: string) => EditableLike | null;
  /** The clock for the click-and-key pairing. Default `performance.now`. */
  readonly now?: () => number;
  /** Told after each edit ends, with the key (or `close` for a blur or a hidden keyboard). */
  readonly onEnd?: (id: string, how: TextKey) => void;
}

/** What a `TextField` spreads onto its input: `editor.field(id)`. */
export interface FieldEditing {
  readonly editing: boolean;
  readonly onEditKey: (event: EditKeyEvent) => void;
  readonly onEditInput: () => void;
  readonly onEditFocus: () => void;
  readonly onEditBlur: () => void;
}

export interface TextEditor {
  /** The id of the field being edited, or `null`. */
  readonly editing: string | null;
  /** Gives the field's input DOM focus, ending any other edit first. False when it isn't there. */
  open(id: string): boolean;
  /** Ends the edit, if any, keeping the text and the engine's focus. */
  close(): void;
  /** The handlers for one field's input. */
  field(id: string): FieldEditing;
  /** Called on each change of `editing`. Returns an unsubscribe function. */
  subscribe(listener: (editing: string | null) => void): () => void;
  /** Stops listening to the platform's keyboard. */
  dispose(): void;
}

function defaultFind(id: string): EditableLike | null {
  return document.getElementById(id) as EditableLike | null;
}

function defaultNow(): number {
  return performance.now();
}

export function createTextEditor(options: TextEditorOptions): TextEditor {
  const find = options.find ?? defaultFind;
  const now = options.now ?? defaultNow;
  const listeners: Array<(editing: string | null) => void> = [];
  let editing: string | null = null;
  let openedAt = 0;
  let typed = false;

  const notify = (): void => {
    for (const listener of listeners.slice()) listener(editing);
  };

  const start = (id: string): void => {
    editing = id;
    openedAt = now();
    typed = false;
    notify();
  };

  /** Ends the edit of `id`: `editing` is cleared before the blur, so its blur event finds no edit. */
  const finish = (id: string, how: TextKey, blur: boolean): void => {
    if (editing !== id) return;
    editing = null;
    if (blur) find(id)?.blur();
    notify();
    if (how === 'done' || how === 'down') options.nav.handle('DOWN');
    else if (how === 'up') options.nav.handle('UP');
    options.onEnd?.(id, how);
  };

  const stopKeyboard = options.platform.onSoftKeyboard((visible) => {
    if (!visible && editing !== null) finish(editing, 'close', true);
  });

  const editor: TextEditor = {
    get editing() {
      return editing;
    },
    open(id: string): boolean {
      if (editing === id) return true;
      const input = find(id);
      if (input === null) return false;
      if (editing !== null) finish(editing, 'close', true);
      start(id);
      input.focus();
      return true;
    },
    close(): void {
      if (editing !== null) finish(editing, 'close', true);
    },
    field(id: string): FieldEditing {
      return {
        editing: editing === id,
        onEditKey(event: EditKeyEvent): void {
          // Typing is the field's: nothing behind it (the remote wiring, a screen) sees it.
          event.stopPropagation();
          if (editing !== id) return;
          const how = options.platform.textKey(event);
          if (how === null) return;
          event.preventDefault();
          if (how === 'done' && !typed && now() - openedAt < OK_CLICK_WINDOW_MS) return;
          finish(id, how, true);
        },
        onEditInput(): void {
          if (editing === id) typed = true;
        },
        onEditFocus(): void {
          // A pointer click right on the input focuses it natively, before any open().
          if (editing === id) return;
          if (editing !== null) finish(editing, 'close', true);
          start(id);
        },
        onEditBlur(): void {
          finish(id, 'close', false);
        },
      };
    },
    subscribe(listener: (editing: string | null) => void): () => void {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    dispose(): void {
      stopKeyboard();
    },
  };
  return editor;
}
