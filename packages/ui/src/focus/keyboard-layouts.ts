/**
 * The tables of the app's own on-screen keyboard (RELAY step 40e): what each page of keys holds,
 * in the order they are drawn, left to right. The keyboard is drawn left to right in both
 * languages (a physical keyboard does not mirror: LEFT moves toward the left edge), so Arabic
 * is laid out in its usual visual order. Plain data: main-safe code, no polyfills.
 */

/** What a key does besides typing. */
export type KeyAction = 'shift' | 'delete' | 'space' | 'done' | 'native' | 'symbols' | 'letters' | 'arabic' | 'latin';

export interface KeyDef {
  /** The text a press types (absent for an action key). */
  readonly text?: string;
  readonly action?: KeyAction;
  /** How wide the key is, in units of a letter key (default 1). */
  readonly weight?: number;
}

export type LayoutName = 'latin' | 'arabic' | 'symbols' | 'digits';

/** The field kinds a keyboard serves (`TextFieldKind`). */
export type KeyboardKind = 'text' | 'url' | 'password' | 'tel';

function letters(row: string, from: number = 0): KeyDef[] {
  const keys: KeyDef[] = [];
  for (let i = from; i < row.length; i++) keys.push({ text: row.charAt(i) });
  return keys;
}

function list(row: string): KeyDef[] {
  // (No `.split(`: the TV bundle would pull a polyfill for it.) The keys are separated by spaces.
  const keys: KeyDef[] = [];
  let word = '';
  for (let i = 0; i <= row.length; i++) {
    const c = i < row.length ? row.charAt(i) : ' ';
    if (c === ' ') {
      if (word !== '') keys.push({ text: word });
      word = '';
    } else word += c;
  }
  return keys;
}

const SHIFT: KeyDef = { action: 'shift', weight: 1.5 };
const DELETE: KeyDef = { action: 'delete', weight: 1.5 };
const SPACE: KeyDef = { action: 'space', weight: 4 };
const DONE: KeyDef = { action: 'done', weight: 2 };
/** Hands the field over to the TV's own keyboard (its voice and phone typing, where it has them). */
const NATIVE: KeyDef = { action: 'native' };

/** The Latin page: lower case, or upper case while Shift is on (the keyboard changes the case). */
function latinRows(kind: KeyboardKind): KeyDef[][] {
  const bottom: KeyDef[] = [{ action: 'symbols', weight: 1.5 }];
  if (kind !== 'url') bottom.push({ action: 'arabic' });
  if (kind === 'url') bottom.push({ text: '/' }, { text: ':' });
  bottom.push(SPACE, { text: '.' }, NATIVE, DONE);
  return [
    letters('1234567890'),
    letters('qwertyuiop'),
    letters('asdfghjkl'),
    [SHIFT].concat(letters('zxcvbnm'), [DELETE]),
    bottom,
  ];
}

/** The Arabic page; Shift gives the alif forms and the Arabic marks in place of the top row. */
function arabicRows(shifted: boolean): KeyDef[][] {
  return [
    shifted ? list('أ إ آ ء ؤ ئ ـ ، ؛ ؟ !') : list('ض ص ث ق ف غ ع ه خ ح ج'),
    list('ش س ي ب ل ا ت ن م ك'),
    [SHIFT].concat(list('ذ د ز ر و ة ى ظ ط'), [DELETE]),
    [{ action: 'symbols', weight: 1.5 }, { action: 'latin' }, SPACE, { text: '.' }, NATIVE, DONE],
  ];
}

function symbolRows(kind: KeyboardKind): KeyDef[][] {
  const bottom: KeyDef[] = [{ action: 'letters', weight: 1.5 }, SPACE, { text: '.' }, NATIVE, DONE];
  return [
    letters('1234567890'),
    list(kind === 'url' ? '- _ ~ ? & = % # + @' : '@ # & % * + = - _ ~'),
    list(', : ; / ? ! ( ) " \''),
    [{ text: '.', weight: 1 }, DELETE],
    bottom,
  ];
}

const DIGITS: KeyDef[][] = [letters('123'), letters('456'), letters('789'), [DELETE, { text: '0' }, DONE]];

/** The rows of `layout` for a field of `kind` (`shifted`: Shift is on). */
export function layoutRows(layout: LayoutName, kind: KeyboardKind, shifted: boolean): KeyDef[][] {
  if (layout === 'digits') return DIGITS;
  if (layout === 'arabic') return arabicRows(shifted);
  if (layout === 'symbols') return symbolRows(kind);
  return latinRows(kind);
}

/** The layout a field opens on: digits for a number, else the page's language (Arabic where the UI is). */
export function startLayout(kind: KeyboardKind, uiLanguage: string): LayoutName {
  if (kind === 'tel') return 'digits';
  if (kind === 'text' && uiLanguage.slice(0, 2) === 'ar') return 'arabic';
  return 'latin';
}

/** Whether the field may switch to the Arabic page (a link and a number are Latin). */
export function offersArabic(kind: KeyboardKind): boolean {
  return kind === 'text' || kind === 'password';
}

/**
 * The keys drawn as an icon (RELAY step 58b): Lablo Sans has no ⇧, ⌫ or ⌨, so they came from the
 * TV's own fonts, and the LG had no ⌫ (an empty box). Each is an SVG path on a 24 px grid, drawn
 * in the key's text colour; the key's word is its `aria-label`. Here, import-free, for e2e too.
 */
export const KEY_ICONS: { readonly [action: string]: string } = {
  // An arrow up, hollow.
  shift: 'M12 4 4 12h4.5v7h7v-7H20z',
  // A key with a point on the left and a cross in it.
  delete: 'M9 6h11v12H9l-6-6zM12 9l5 6M17 9l-5 6',
  // A keyboard: its outline and three rows of keys.
  native: 'M3 6h18v12H3zM6 9h2M10 9h2M14 9h2M18 9h0M6 12h2M10 12h2M14 12h2M8 15h8',
};
