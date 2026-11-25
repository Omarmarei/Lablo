import { firstStrongDirection } from '@lablo/core';
import type { Intent, Platform } from '@lablo/platform-api';
import '../components/ScreenKeyboard.css';
import type { KeyDef, KeyboardKind, LayoutName } from './keyboard-layouts';
import { layoutRows, offersArabic, startLayout } from './keyboard-layouts';

/**
 * The app's own on-screen keyboard (RELAY step 40e, docs/architecture.md §1.2 "Own keyboard").
 *
 * Why: the Samsung's IME offered no Arabic and its language setting is greyed out (spike S10), so
 * a TV that cannot type Arabic cannot search or log in with it. This keyboard types Arabic and
 * English on any TV. It is plain DOM, mounted on the body while a field is being edited (the
 * eight text editors share one), so no screen draws it.
 *
 * How a press reaches the field: nothing has DOM focus. A press sets the input's `value` and
 * sends it an `input` event, which the field's `onInput` reads like a typed key. The text is
 * added at the end (a TV field is short), where the field draws a caret (step 51). Keys are
 * heard on the document in the capture phase and stopped, so the remote wiring on the window
 * never sees them.
 *
 * Drawn left to right in both languages (a physical keyboard does not mirror): LEFT moves
 * toward the left edge, so the focus engine's RTL swap does not apply here.
 *
 * A field low on the screen would sit under the panel (step 51): while the keyboard is up, the
 * part of the page that holds the field (the body's child it is in) is moved up until the field,
 * its note line included, is above the panel; it goes back when the keyboard closes.
 */

/** The room between a lifted field and the panel, in px. */
export const LIFT_GAP = 24;

/** The parts of the field's `<input>` the keyboard uses. */
export interface KeyboardInput {
  value: string;
  readonly maxLength: number;
  readonly type: string;
  dispatchEvent(event: Event): boolean;
  /** Finds the field around the input (`TextField`'s `.z-field`), to keep it above the panel. */
  closest?(selector: string): Element | null;
}

export type KeyboardEnd = 'done' | 'close' | 'native';

export interface KeyboardSession {
  readonly input: KeyboardInput;
  readonly platform: Pick<Platform, 'keyToIntent' | 'textKey'>;
  /** The keyboard ended: Done (the field's next step) or Close (Back, Cancel). The text stays. */
  readonly onEnd: (how: KeyboardEnd) => void;
}

export interface ScreenKeyboard {
  readonly isOpen: boolean;
  open(session: KeyboardSession): void;
  /** Closes without telling the session (its owner ended the edit). */
  close(): void;
}

/** The words on the keys, from the catalogs (`setScreenKeyboardLabels`). */
export interface KeyboardLabels {
  readonly title: string;
  readonly done: string;
  readonly native: string;
  readonly space: string;
  readonly delete: string;
  readonly shift: string;
  readonly symbols: string;
  readonly letters: string;
  readonly arabic: string;
  readonly latin: string;
}

const DEFAULT_LABELS: KeyboardLabels = {
  title: 'Keyboard',
  done: 'Done',
  native: 'TV keyboard',
  space: 'Space',
  delete: 'Delete',
  shift: 'Shift',
  symbols: 'Numbers and symbols',
  letters: 'Letters',
  arabic: 'Arabic letters',
  latin: 'English letters',
};

let labelSource: () => KeyboardLabels = () => DEFAULT_LABELS;

/** The app gives the words in the page's language; read each time the keyboard opens. */
export function setScreenKeyboardLabels(source: () => KeyboardLabels): void {
  labelSource = source;
}

/** What a password shows: a dot for each character (the keyboard's line and the field, step 51). */
export function maskText(value: string): string {
  let shown = '';
  for (let i = 0; i < value.length; i++) shown += '•';
  return shown;
}

/** The glyph on a key that has no word (the word is its `aria-label`). */
function actionGlyph(key: KeyDef, labels: KeyboardLabels): string {
  switch (key.action) {
    case 'shift':
      return '⇧';
    case 'delete':
      return '⌫';
    case 'space':
      return labels.space;
    case 'done':
      return labels.done;
    case 'symbols':
      return '123';
    case 'letters':
      return 'abc';
    case 'native':
      return '⌨';
    case 'arabic':
      return 'ع';
    default:
      return 'EN';
  }
}

function actionName(key: KeyDef, labels: KeyboardLabels): string {
  switch (key.action) {
    case 'shift':
      return labels.shift;
    case 'delete':
      return labels.delete;
    case 'symbols':
      return labels.symbols;
    case 'letters':
      return labels.letters;
    case 'arabic':
      return labels.arabic;
    case 'latin':
      return labels.latin;
    case 'native':
      return labels.native;
    case 'space':
      return labels.space;
    default:
      return labels.done;
  }
}

function weightOf(key: KeyDef): number {
  return key.weight === undefined ? 1 : key.weight;
}

/** The key of `row` under the horizontal position `at` (0..1 of the row's width). */
function keyAt(row: readonly KeyDef[], at: number): number {
  let total = 0;
  for (let i = 0; i < row.length; i++) total += weightOf(row[i]!);
  let from = 0;
  for (let i = 0; i < row.length; i++) {
    from += weightOf(row[i]!);
    if (at * total <= from) return i;
  }
  return row.length - 1;
}

function centreOf(row: readonly KeyDef[], index: number): number {
  let total = 0;
  let before = 0;
  for (let i = 0; i < row.length; i++) {
    if (i < index) before += weightOf(row[i]!);
    total += weightOf(row[i]!);
  }
  return (before + weightOf(row[index]!) / 2) / total;
}

export function createScreenKeyboard(doc: Document): ScreenKeyboard {
  let session: KeyboardSession | null = null;
  let root: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  /** The text inside the preview line (it runs in the text's direction, the line opposite). */
  let typed: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  /** The part of the page moved up (`lift` px) to keep the field above the panel. */
  let lifted: HTMLElement | null = null;
  let lift = 0;
  let labels = DEFAULT_LABELS;
  let kind: KeyboardKind = 'text';
  let layout: LayoutName = 'latin';
  let shifted = false;
  let rows: KeyDef[][] = [];
  let row = 0;
  let col = 0;
  let buttons: HTMLElement[][] = [];

  const kindOf = (input: KeyboardInput): KeyboardKind =>
    input.type === 'url' || input.type === 'password' || input.type === 'tel' ? input.type : 'text';

  const showText = (): void => {
    if (preview === null || typed === null || session === null) return;
    const value = session.input.value;
    // As in the field (TextField.tsx): a long line spills out at the line's end edge, so the line
    // runs opposite to the text and the text's end stays in sight; short, it sits on its own start.
    const runs = firstStrongDirection(value) ?? 'ltr';
    preview.setAttribute('dir', runs === 'ltr' ? 'rtl' : 'ltr');
    preview.style.textAlign = runs === 'ltr' ? 'left' : 'right';
    typed.setAttribute('dir', runs);
    typed.textContent = kind === 'password' ? maskText(value) : value;
  };

  /** Moves the page's part that holds the field up until the field is above the panel (or back down). */
  const raise = (): void => {
    if (root === null || session === null || session.input.closest === undefined) return;
    const field = session.input.closest('.z-field');
    if (field === null) return;
    let part = field as HTMLElement;
    while (part.parentNode !== null && part.parentNode !== doc.body) part = part.parentNode as HTMLElement;
    if (part.parentNode === null) return;
    // The field's bottom as drawn with no lift (its box includes the lift so far).
    const bottom = field.getBoundingClientRect().bottom + lift;
    const need = Math.ceil(bottom + LIFT_GAP - root.getBoundingClientRect().top);
    lift = need > 0 ? need : 0;
    lifted = part;
    part.style.transform = lift > 0 ? 'translateY(-' + lift + 'px)' : '';
  };

  const paintFocus = (): void => {
    for (let r = 0; r < buttons.length; r++) {
      for (let c = 0; c < buttons[r]!.length; c++) {
        const on = r === row && c === col;
        buttons[r]![c]!.className = (on ? 'z-kbd__key is-focused ' : 'z-kbd__key ') + keyClass(rows[r]![c]!);
      }
    }
  };

  const keyClass = (key: KeyDef): string => (key.action === undefined ? '' : 'is-action' + (key.action === 'shift' && shifted ? ' is-on' : ''));

  const send = (): void => {
    if (session !== null) session.input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const type = (text: string): void => {
    if (session === null) return;
    const input = session.input;
    if (input.maxLength >= 0 && input.value.length + text.length > input.maxLength) return;
    input.value = input.value + text;
    send();
    showText();
  };

  const remove = (): void => {
    if (session === null || session.input.value === '') return;
    session.input.value = session.input.value.slice(0, -1);
    send();
    showText();
  };

  const build = (): void => {
    if (grid === null) return;
    rows = layoutRows(layout, kind, shifted);
    if (row >= rows.length) row = rows.length - 1;
    if (col >= rows[row]!.length) col = rows[row]!.length - 1;
    while (grid.firstChild !== null) grid.removeChild(grid.firstChild);
    buttons = [];
    for (let r = 0; r < rows.length; r++) {
      const line = doc.createElement('div');
      line.className = 'z-kbd__row';
      const lineButtons: HTMLElement[] = [];
      for (let c = 0; c < rows[r]!.length; c++) {
        const key = rows[r]![c]!;
        const button = doc.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.setAttribute('translate', 'no');
        button.style.flexGrow = String(weightOf(key));
        if (key.action !== undefined) {
          button.textContent = actionGlyph(key, labels);
          button.setAttribute('aria-label', actionName(key, labels));
          if (key.action === 'shift') button.setAttribute('aria-pressed', shifted ? 'true' : 'false');
        } else {
          const text = key.text ?? '';
          button.textContent = shifted && layout === 'latin' ? text.toUpperCase() : text;
        }
        button.addEventListener('click', () => {
          row = r;
          col = c;
          press(key);
        });
        line.appendChild(button);
        lineButtons.push(button);
      }
      grid.appendChild(line);
      buttons.push(lineButtons);
    }
    paintFocus();
    // A page of keys with another number of rows changes the panel's height.
    raise();
  };

  const switchTo = (next: LayoutName): void => {
    layout = next;
    shifted = false;
    // Keep the focus where it was as far as the new page goes.
    build();
  };

  const finish = (how: KeyboardEnd): void => {
    const ended = session;
    if (ended === null) return;
    teardown();
    ended.onEnd(how);
  };

  const press = (key: KeyDef): void => {
    switch (key.action) {
      case undefined:
        type(shifted && layout === 'latin' ? (key.text ?? '').toUpperCase() : (key.text ?? ''));
        // Shift is for one letter.
        if (shifted && layout === 'latin') {
          shifted = false;
          build();
        }
        return;
      case 'space':
        type(' ');
        return;
      case 'delete':
        remove();
        return;
      case 'shift':
        shifted = !shifted;
        build();
        return;
      case 'symbols':
        switchTo('symbols');
        return;
      case 'letters':
      case 'latin':
        switchTo('latin');
        return;
      case 'arabic':
        switchTo('arabic');
        return;
      case 'done':
        finish('done');
        return;
      case 'native':
        finish('native');
        return;
    }
  };

  const move = (dRow: number, dCol: number): void => {
    if (dRow !== 0) {
      const next = row + dRow;
      if (next < 0 || next >= rows.length) return;
      col = keyAt(rows[next]!, centreOf(rows[row]!, col));
      row = next;
    } else {
      const next = col + dCol;
      if (next < 0 || next >= rows[row]!.length) return;
      col = next;
    }
    paintFocus();
  };

  const onKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    const active = session;
    if (active === null) return;
    // Nothing behind the keyboard hears a key.
    key.stopPropagation();
    key.preventDefault();
    const plain = key.ctrlKey !== true && key.altKey !== true && key.metaKey !== true;
    if (plain && key.key === 'Backspace') {
      remove();
      return;
    }
    // A typed character (a desktop keyboard, the remote's digit keys).
    if (plain && typeof key.key === 'string' && key.key.length === 1) {
      type(key.key);
      return;
    }
    const intent: Intent | null = active.platform.keyToIntent(key);
    if (intent === 'UP') move(-1, 0);
    else if (intent === 'DOWN') move(1, 0);
    else if (intent === 'LEFT') move(0, -1);
    else if (intent === 'RIGHT') move(0, 1);
    else if (intent === 'OK') press(rows[row]![col]!);
    else if (intent === 'BACK') finish('close');
    else if (intent === null) {
      // The IME's own Done and Cancel codes (Tizen 65376, 65385) have no intent.
      const how = active.platform.textKey(key);
      if (how === 'done') finish('done');
      else if (how === 'close') finish('close');
    }
  };

  const teardown = (): void => {
    doc.removeEventListener('keydown', onKey, true);
    if (root !== null && root.parentNode !== null) root.parentNode.removeChild(root);
    if (lifted !== null) lifted.style.transform = '';
    lifted = null;
    lift = 0;
    root = null;
    preview = null;
    typed = null;
    grid = null;
    buttons = [];
    session = null;
  };

  return {
    get isOpen(): boolean {
      return session !== null;
    },
    open(next: KeyboardSession): void {
      if (session !== null) teardown();
      session = next;
      labels = labelSource();
      kind = kindOf(next.input);
      layout = startLayout(kind, doc.documentElement.lang);
      if (layout === 'arabic' && !offersArabic(kind)) layout = 'latin';
      shifted = false;
      row = 0;
      col = 0;
      root = doc.createElement('div');
      root.className = 'z-kbd';
      root.setAttribute('dir', 'ltr');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', labels.title);
      root.setAttribute('translate', 'no');
      // A pointer press on the keyboard must not take DOM focus from anything.
      root.addEventListener('mousedown', (event) => event.preventDefault());
      preview = doc.createElement('div');
      preview.className = 'z-kbd__text';
      preview.setAttribute('aria-live', 'polite');
      typed = doc.createElement('span');
      preview.appendChild(typed);
      grid = doc.createElement('div');
      grid.className = 'z-kbd__grid';
      root.appendChild(preview);
      root.appendChild(grid);
      doc.body.appendChild(root);
      build();
      // Start on Done: the usual next move once the text is in is OK.
      showText();
      doc.addEventListener('keydown', onKey, true);
    },
    close(): void {
      if (session !== null) teardown();
    },
  };
}

let shared: ScreenKeyboard | null = null;

/** The one keyboard the editors share (made on first use, on the page's document). */
export function sharedScreenKeyboard(): ScreenKeyboard {
  if (shared === null) shared = createScreenKeyboard(document);
  return shared;
}
