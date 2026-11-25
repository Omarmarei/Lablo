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
 * added at the end (a TV field is short; there is no caret). Keys are heard on the document in
 * the capture phase and stopped, so the remote wiring on the window never sees them.
 *
 * Drawn left to right in both languages (a physical keyboard does not mirror): LEFT moves
 * toward the left edge, so the focus engine's RTL swap does not apply here.
 */

/** The parts of the field's `<input>` the keyboard uses. */
export interface KeyboardInput {
  value: string;
  readonly maxLength: number;
  readonly type: string;
  dispatchEvent(event: Event): boolean;
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
  let grid: HTMLElement | null = null;
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
    if (preview === null || session === null) return;
    const value = session.input.value;
    let shown = value;
    if (kind === 'password') {
      shown = '';
      for (let i = 0; i < value.length; i++) shown += '•';
    }
    preview.textContent = shown;
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
    root = null;
    preview = null;
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
      preview.setAttribute('dir', 'auto');
      preview.setAttribute('aria-live', 'polite');
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
