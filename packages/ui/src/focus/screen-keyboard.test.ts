import type { Intent, KeyLike, TextKey } from '@lablo/platform-api';
import { describe, expect, it } from 'vitest';
import { layoutRows, offersArabic, startLayout } from './keyboard-layouts';
import type { KeyboardEnd, KeyboardInput } from './screen-keyboard';
import { KEY_ICONS, LIFT_GAP, createScreenKeyboard, keyFace, setScreenKeyboardLabels } from './screen-keyboard';

/** The few parts of the DOM the keyboard touches. */
class FakeElement {
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event: unknown) => void>>();
  className = '';
  textContent = '';
  type = '';
  tabIndex = 0;
  style: Record<string, string> = {};
  /** Where it is drawn before any lift (step 51). */
  top = 0;
  bottom = 0;
  getBoundingClientRect(): { top: number; bottom: number } {
    // The panel: 100 px a row of keys, along the bottom of the 1080 px canvas.
    if (this.className === 'z-kbd') return { top: 1080 - 100 * (this.children[1]?.children.length ?? 0), bottom: 1080 };
    // Anything else where it was put, moved by its own and its ancestors' translateY.
    const moved = (el: FakeElement): number => {
      const found = /^translateY\((-?\d+)px\)$/.exec(el.style.transform ?? '');
      return found === null ? 0 : Number(found[1]);
    };
    let shift = moved(this);
    for (let at = this.parentNode; at !== null; at = at.parentNode) shift += moved(at);
    return { top: this.top + shift, bottom: this.bottom + shift };
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): FakeElement {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  click(): void {
    for (const l of this.listeners.get('click') ?? []) l({});
  }
}

class FakeDocument extends FakeElement {
  body = new FakeElement();
  documentElement = { lang: 'en' };
  createElement(): FakeElement {
    return new FakeElement();
  }
  /** An SVG element (the icon keys, step 58b): its namespace and tag kept. */
  createElementNS(ns: string, tag: string): FakeElement {
    const el = new FakeElement();
    el.type = `${ns} ${tag}`;
    return el;
  }
}

class FakeInput implements KeyboardInput {
  value = '';
  inputs = 0;
  constructor(
    readonly type: string = 'text',
    readonly maxLength: number = -1,
  ) {}
  dispatchEvent(event: Event): boolean {
    if (event.type === 'input') this.inputs++;
    return true;
  }
}

const INTENTS: Record<number, Intent> = { 38: 'UP', 40: 'DOWN', 37: 'LEFT', 39: 'RIGHT', 13: 'OK', 27: 'BACK' };
const TEXT_KEYS: Record<number, TextKey> = { 65376: 'done', 65385: 'close' };
const platform = {
  keyToIntent: (event: KeyLike): Intent | null => INTENTS[event.keyCode] ?? null,
  textKey: (event: KeyLike): TextKey | null => TEXT_KEYS[event.keyCode] ?? null,
};

function setup(type = 'text', lang = 'en', maxLength = -1) {
  const doc = new FakeDocument();
  doc.documentElement.lang = lang;
  const keyboard = createScreenKeyboard(doc as unknown as Document);
  const input = new FakeInput(type, maxLength);
  const ends: KeyboardEnd[] = [];
  keyboard.open({ input, platform, onEnd: (how) => ends.push(how) });
  const root = doc.body.children[0]!;
  const grid = root.children[1]!;
  const keyAt = (row: number, col: number): FakeElement => grid.children[row]!.children[col]!;
  const focused = (): string => {
    for (const row of grid.children) for (const key of row.children) if (key.className.indexOf('is-focused') !== -1) return key.textContent;
    return '';
  };
  /** Sends a key to the document's capture listener, as the browser would. */
  const send = (keyCode: number, key?: string) => {
    const event = { keyCode, key, stopped: false, prevented: false, stopPropagation() { event.stopped = true; }, preventDefault() { event.prevented = true; } };
    for (const l of doc.listeners.get('keydown') ?? []) l(event);
    return event;
  };
  const line = root.children[0]!;
  return { doc, keyboard, input, ends, root, grid, keyAt, focused, send, line, preview: () => line.children[0]!.textContent };
}

/** The keyboard over a page part (the app's root) holding a field whose box ends at `bottom` px. */
function lifting(bottom: number, type = 'text', lang = 'en') {
  const doc = new FakeDocument();
  doc.documentElement.lang = lang;
  const part = doc.body.appendChild(new FakeElement());
  const field = part.appendChild(new FakeElement()).appendChild(new FakeElement());
  field.className = 'z-field';
  field.top = bottom - 150;
  field.bottom = bottom;
  const asked: string[] = [];
  const input = Object.assign(new FakeInput(type), { closest: (selector: string) => (asked.push(selector), field as unknown as Element) });
  const keyboard = createScreenKeyboard(doc as unknown as Document);
  const ends: KeyboardEnd[] = [];
  keyboard.open({ input, platform, onEnd: (how) => ends.push(how) });
  const root = doc.body.children[1]!;
  const keyAt = (row: number, col: number): FakeElement => root.children[1]!.children[row]!.children[col]!;
  const send = (keyCode: number) => {
    for (const l of doc.listeners.get('keydown') ?? []) l({ keyCode, stopPropagation() {}, preventDefault() {} });
  };
  return { doc, part, field, keyboard, root, asked, ends, keyAt, send };
}

describe('layouts (step 40e)', () => {
  it('start on digits for a number, Arabic for an Arabic text field, Latin otherwise', () => {
    expect(startLayout('tel', 'ar')).toBe('digits');
    expect(startLayout('text', 'ar-SA')).toBe('arabic');
    expect(startLayout('text', 'en')).toBe('latin');
    expect(startLayout('url', 'ar')).toBe('latin');
    expect(startLayout('password', 'ar')).toBe('latin');
  });

  it('only a name and a password may switch to Arabic', () => {
    expect([offersArabic('text'), offersArabic('password'), offersArabic('url'), offersArabic('tel')]).toEqual([true, true, false, false]);
    const actions = (kind: 'text' | 'url'): string[] => layoutRows('latin', kind, false).flat().map((k) => k.action ?? '');
    expect(actions('text')).toContain('arabic');
    expect(actions('url')).not.toContain('arabic');
  });

  it('hold every Arabic letter, each once, and the alif forms under Shift', () => {
    const letters = (shifted: boolean): string[] => layoutRows('arabic', 'text', shifted).flat().map((k) => k.text ?? '').filter((t) => t !== '');
    const plain = letters(false);
    for (const c of 'ابتثجحخدذرزسشصضطظعغفقكلمنهوىيةءؤئ') {
      if ('ءؤئ'.includes(c)) continue;
      expect(plain).toContain(c);
    }
    expect(new Set(plain).size).toBe(plain.length);
    expect(letters(true)).toEqual(expect.arrayContaining(['أ', 'إ', 'آ', 'ء', 'ؤ', 'ئ']));
  });

  it('have a digit row and a Done key on every page', () => {
    for (const layout of ['latin', 'arabic', 'symbols', 'digits'] as const) {
      const keys = layoutRows(layout, 'text', false).flat();
      expect(keys.some((k) => k.action === 'done')).toBe(true);
      expect(keys.some((k) => k.action === 'delete')).toBe(true);
    }
  });
});

describe('createScreenKeyboard (step 40e)', () => {
  it('mounts on the body, left to right, and unmounts on close', () => {
    const r = setup();
    expect(r.keyboard.isOpen).toBe(true);
    expect(r.doc.body.children).toHaveLength(1);
    expect(r.root.attributes.get('dir')).toBe('ltr');
    expect(r.root.attributes.get('role')).toBe('dialog');
    r.keyboard.close();
    expect(r.keyboard.isOpen).toBe(false);
    expect(r.doc.body.children).toHaveLength(0);
    expect(r.doc.listeners.get('keydown')).toHaveLength(0);
    expect(r.ends).toEqual([]);
  });

  it('types the focused key on OK and tells the input each time', () => {
    const r = setup();
    expect(r.focused()).toBe('1');
    r.send(13);
    r.send(39);
    r.send(13);
    expect(r.input.value).toBe('12');
    expect(r.input.inputs).toBe(2);
    expect(r.preview()).toBe('12');
  });

  it('moves with the arrows by position and stops at the edges', () => {
    const r = setup();
    r.send(40);
    expect(r.focused()).toBe('q');
    r.send(37);
    expect(r.focused()).toBe('q');
    r.send(38);
    r.send(38);
    expect(r.focused()).toBe('1');
    for (let i = 0; i < 12; i++) r.send(39);
    expect(r.focused()).toBe('0');
    // Down from the last digit lands on the last of the next row.
    r.send(40);
    expect(r.focused()).toBe('p');
    r.send(40);
    expect(r.focused()).toBe('l');
    // The bottom row is the last: DOWN stops there, on the key under the position.
    for (let i = 0; i < 6; i++) r.send(40);
    expect(r.keyboard.isOpen).toBe(true);
    expect(r.focused()).not.toBe('');
    expect(r.focused()).toBe(r.keyAt(4, 5).textContent);
  });

  it('draws the space key four times as wide as a letter', () => {
    const r = setup();
    expect(r.keyAt(1, 0).style.flexGrow).toBe('1');
    expect(r.keyAt(4, 2).style.flexGrow).toBe('4');
    expect(r.keyAt(4, 0).style.flexGrow).toBe('1.5');
  });

  it('LEFT goes left in Arabic too (the keyboard is not mirrored)', () => {
    const r = setup('text', 'ar');
    expect(r.keyAt(0, 0).textContent).toBe('ض');
    r.send(39);
    expect(r.focused()).toBe('ص');
    r.send(37);
    expect(r.focused()).toBe('ض');
  });

  it('types Arabic text in logical order', () => {
    const r = setup('text', 'ar-SA');
    // ض ص then OK on each.
    r.send(13);
    r.send(39);
    r.send(13);
    expect(r.input.value).toBe('ضص');
  });

  it('Shift upper-cases one letter, then goes off', () => {
    const r = setup();
    r.keyAt(3, 0).click();
    expect(r.keyAt(1, 0).textContent).toBe('Q');
    expect(r.keyAt(3, 0).attributes.get('aria-pressed')).toBe('true');
    r.keyAt(1, 0).click();
    expect(r.input.value).toBe('Q');
    expect(r.keyAt(1, 0).textContent).toBe('q');
    r.keyAt(1, 0).click();
    expect(r.input.value).toBe('Qq');
  });

  it('Shift turns off again when pressed twice', () => {
    const r = setup();
    r.keyAt(3, 0).click();
    r.keyAt(3, 0).click();
    expect(r.keyAt(1, 0).textContent).toBe('q');
    expect(r.keyAt(3, 0).attributes.get('aria-pressed')).toBe('false');
  });

  it('the TV-keyboard key ends the session as native, keeping the text', () => {
    const r = setup();
    r.keyAt(1, 0).click();
    expect(r.keyAt(4, 4).attributes.get('aria-label')).toBe('TV keyboard');
    r.keyAt(4, 4).click();
    expect(r.ends).toEqual(['native']);
    expect(r.input.value).toBe('q');
    expect(r.keyboard.isOpen).toBe(false);
  });

  it('deletes, spaces, and keeps within the input maxLength', () => {
    const r = setup('text', 'en', 3);
    r.keyAt(1, 0).click();
    r.keyAt(1, 1).click();
    r.keyAt(4, 2).click();
    expect(r.input.value).toBe('qw ');
    r.keyAt(1, 2).click();
    expect(r.input.value).toBe('qw ');
    r.keyAt(3, 8).click();
    expect(r.input.value).toBe('qw');
    r.keyAt(3, 8).click();
    r.keyAt(3, 8).click();
    r.keyAt(3, 8).click();
    expect(r.input.value).toBe('');
    expect(r.input.inputs).toBe(6);
  });

  it('types a character from a keyboard and deletes with Backspace', () => {
    const r = setup();
    const a = r.send(65, 'a');
    r.send(66, 'b');
    expect(r.input.value).toBe('ab');
    expect(a.stopped && a.prevented).toBe(true);
    r.send(8, 'Backspace');
    expect(r.input.value).toBe('a');
    // A shortcut is not typing.
    const ctrl = { keyCode: 67, key: 'c', ctrlKey: true, stopPropagation() {}, preventDefault() {} };
    for (const l of r.doc.listeners.get('keydown') ?? []) l(ctrl);
    expect(r.input.value).toBe('a');
  });

  it('keeps every key from the screens behind it', () => {
    const r = setup();
    for (const code of [37, 38, 39, 40, 13, 27, 10009, 403]) {
      const event = r.send(code);
      expect(event.stopped).toBe(true);
      expect(event.prevented).toBe(true);
      if (!r.keyboard.isOpen) break;
    }
  });

  it('ends with Done on the Done key and on the IME code 65376, with close on Back and 65385', () => {
    const done = setup();
    done.keyAt(4, 5).click();
    expect(done.ends).toEqual(['done']);
    expect(done.keyboard.isOpen).toBe(false);
    expect(done.doc.body.children).toHaveLength(0);
    const ime = setup();
    ime.send(65376);
    expect(ime.ends).toEqual(['done']);
    const cancel = setup();
    cancel.send(65385);
    expect(cancel.ends).toEqual(['close']);
    const back = setup();
    back.send(27);
    expect(back.ends).toEqual(['close']);
    expect(back.input.value).toBe('');
  });

  it('switches pages: symbols, back to letters, Arabic and back', () => {
    const r = setup();
    r.keyAt(4, 0).click();
    expect(r.grid.children[2]!.children[0]!.textContent).toBe(',');
    r.keyAt(4, 0).click();
    expect(r.keyAt(1, 0).textContent).toBe('q');
    r.keyAt(4, 1).click();
    expect(r.keyAt(0, 0).textContent).toBe('ض');
    expect(r.keyAt(2, 1).textContent).toBe('ذ');
    // Arabic Shift swaps the top row.
    r.keyAt(2, 0).click();
    expect(r.keyAt(0, 0).textContent).toBe('أ');
    r.keyAt(3, 1).click();
    expect(r.keyAt(1, 0).textContent).toBe('q');
  });

  it('a number field has digits only', () => {
    const r = setup('tel');
    expect(r.grid.children).toHaveLength(4);
    r.keyAt(0, 0).click();
    r.keyAt(3, 1).click();
    expect(r.input.value).toBe('10');
  });

  it('a link has no Arabic key, a password shows dots', () => {
    const url = setup('url', 'ar');
    const labels: string[] = [];
    for (const key of url.grid.children[4]!.children) labels.push(key.textContent);
    expect(labels).not.toContain('ع');
    const secret = setup('password');
    secret.keyAt(1, 0).click();
    secret.keyAt(1, 1).click();
    expect(secret.input.value).toBe('qw');
    expect(secret.preview()).toBe('••');
  });

  it('says its words in the language the app gave', () => {
    setScreenKeyboardLabels(() => ({ title: 'T', done: 'D', native: 'N', space: 'S', delete: 'X', shift: 'H', symbols: 'Y', letters: 'L', arabic: 'A', latin: 'E' }));
    try {
      const r = setup();
      expect(r.root.attributes.get('aria-label')).toBe('T');
      expect(r.keyAt(4, 5).textContent).toBe('D');
      expect(r.keyAt(4, 2).textContent).toBe('S');
      expect(r.keyAt(3, 8).attributes.get('aria-label')).toBe('X');
    } finally {
      setScreenKeyboardLabels(() => ({ title: 'Keyboard', done: 'Done', native: 'TV keyboard', space: 'Space', delete: 'Delete', shift: 'Shift', symbols: 'Numbers and symbols', letters: 'Letters', arabic: 'Arabic letters', latin: 'English letters' }));
    }
  });

  it('its text line shows the end of a long text: the line runs opposite to the text (step 51)', () => {
    const r = setup();
    // Empty: a Latin line, on the left.
    expect([r.line.attributes.get('dir'), r.line.style.textAlign, r.line.children[0]!.attributes.get('dir')]).toEqual(['rtl', 'left', 'ltr']);
    r.send(0, 'a');
    expect([r.line.attributes.get('dir'), r.line.style.textAlign, r.line.children[0]!.attributes.get('dir')]).toEqual(['rtl', 'left', 'ltr']);
    // Arabic first: the text runs right to left and sits on the right.
    r.send(0, 'Backspace');
    r.keyAt(4, 1).click();
    r.keyAt(0, 0).click();
    r.send(0, '1');
    expect(r.preview()).toBe('ض1');
    expect([r.line.attributes.get('dir'), r.line.style.textAlign, r.line.children[0]!.attributes.get('dir')]).toEqual(['ltr', 'right', 'rtl']);
  });

  it('opening again replaces the first session without ending it', () => {
    const r = setup();
    const second = new FakeInput();
    const ends: KeyboardEnd[] = [];
    r.keyboard.open({ input: second, platform, onEnd: (how) => ends.push(how) });
    expect(r.doc.body.children).toHaveLength(1);
    expect(r.doc.listeners.get('keydown')).toHaveLength(1);
    r.send(13);
    expect(second.value).toBe('1');
    expect(r.input.value).toBe('');
    expect(r.ends).toEqual([]);
  });
});

describe('the keyboard keeps the field above its panel (step 51)', () => {
  it('moves the page up until a field low on the screen is above the panel, and back when it closes', () => {
    // The Latin page has five rows: the panel's top is at 580.
    const r = lifting(900);
    expect(r.asked).toEqual(['.z-field']);
    expect(r.part.style.transform).toBe('translateY(-344px)');
    expect(r.field.getBoundingClientRect().bottom).toBe(580 - LIFT_GAP);
    // The Arabic page has four rows: less to move.
    r.keyAt(4, 1).click();
    expect(r.root.children[1]!.children).toHaveLength(4);
    expect(r.part.style.transform).toBe('translateY(-244px)');
    expect(r.field.getBoundingClientRect().bottom).toBe(680 - LIFT_GAP);
    // Back closes it, and the page goes back down.
    r.send(27);
    expect(r.ends).toEqual(['close']);
    expect(r.part.style.transform).toBe('');
  });

  it('leaves a field above the panel where it is', () => {
    expect(lifting(400).part.style.transform).toBe('');
    expect(lifting(580 - LIFT_GAP).part.style.transform).toBe('');
    expect(lifting(581 - LIFT_GAP).part.style.transform).toBe('translateY(-1px)');
    // A field's edge between pixels: lifted the whole pixel, never short of the gap.
    expect(lifting(581.5 - LIFT_GAP).part.style.transform).toBe('translateY(-2px)');
  });

  it('a page of keys that makes the panel taller lifts a field that was clear of it', () => {
    // Arabic first: four rows, the panel's top at 680; the field is clear of it.
    const r = lifting(600, 'text', 'ar');
    expect(r.root.children[1]!.children).toHaveLength(4);
    expect(r.part.style.transform).toBe('');
    // The Latin page has five rows: the panel's top at 580.
    r.keyAt(3, 1).click();
    expect(r.root.children[1]!.children).toHaveLength(5);
    expect(r.part.style.transform).toBe('translateY(-44px)');
  });

  it('closing from the app puts the page back too', () => {
    const r = lifting(900);
    r.keyboard.close();
    expect(r.part.style.transform).toBe('');
    expect(r.ends).toEqual([]);
  });

  it('opening on another field puts the first page part back before moving the new one', () => {
    const r = lifting(900);
    const other = r.doc.body.appendChild(new FakeElement());
    const field = other.appendChild(new FakeElement());
    field.bottom = 1000;
    r.keyboard.open({ input: Object.assign(new FakeInput(), { closest: () => field as unknown as Element }), platform, onEnd: () => undefined });
    expect(r.part.style.transform).toBe('');
    expect(other.style.transform).toBe('translateY(-444px)');
  });

  it('moves nothing for an input outside a field, or a field outside the page', () => {
    const doc = new FakeDocument();
    const part = doc.body.appendChild(new FakeElement());
    const keyboard = createScreenKeyboard(doc as unknown as Document);
    keyboard.open({ input: Object.assign(new FakeInput(), { closest: () => null }), platform, onEnd: () => undefined });
    expect(part.style.transform).toBeUndefined();
    const away = new FakeElement();
    const field = away.appendChild(new FakeElement());
    field.bottom = 1000;
    keyboard.open({ input: Object.assign(new FakeInput(), { closest: () => field as unknown as Element }), platform, onEnd: () => undefined });
    expect(away.style.transform).toBeUndefined();
    expect(field.style.transform).toBeUndefined();
  });
});

describe('keys drawn as icons (RELAY step 58b)', () => {
  const SVG = 'http://www.w3.org/2000/svg';

  it('Shift, Delete and the TV keyboard draw an SVG path and no text; their word is the label', () => {
    const r = setup();
    const keys: Array<[number, number, string, string]> = [
      [3, 0, 'shift', 'Shift'],
      [3, 8, 'delete', 'Delete'],
      [4, 4, 'native', 'TV keyboard'],
    ];
    for (const [row, col, action, word] of keys) {
      const key = r.keyAt(row, col);
      expect(key.textContent).toBe('');
      expect(key.attributes.get('aria-label')).toBe(word);
      expect(key.children).toHaveLength(1);
      const svg = key.children[0]!;
      expect(svg.type).toBe(`${SVG} svg`);
      expect(Object.fromEntries(svg.attributes)).toEqual({ class: 'z-kbd__icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
      expect(svg.children.map((c) => [c.type, c.attributes.get('d')])).toEqual([[`${SVG} path`, KEY_ICONS[action]]]);
    }
  });

  it('keeps its icon through a page change and Shift, and other keys have no child', () => {
    const r = setup();
    r.keyAt(3, 0).click();
    expect(r.keyAt(3, 0).children).toHaveLength(1);
    expect(r.keyAt(3, 0).attributes.get('aria-pressed')).toBe('true');
    expect(r.keyAt(1, 0).textContent).toBe('Q');
    expect(r.keyAt(1, 0).children).toHaveLength(0);
    expect(r.keyAt(4, 5).children).toHaveLength(0);
    expect(r.keyAt(4, 5).textContent).toBe('Done');
  });

  it('keyFace: a letter (upper-case under Shift on the Latin page), a word, or nothing for an icon', () => {
    const labels = { title: 'T', done: 'D', native: 'N', space: 'S', delete: 'X', shift: 'H', symbols: 'Y', letters: 'L', arabic: 'A', latin: 'E' };
    expect(keyFace({ text: 'q' }, labels, 'latin', true)).toBe('Q');
    expect(keyFace({ text: 'q' }, labels, 'latin', false)).toBe('q');
    expect(keyFace({ text: 'ب' }, labels, 'arabic', true)).toBe('ب');
    expect(keyFace({ action: 'space' }, labels, 'latin', false)).toBe('S');
    expect(keyFace({ action: 'done' }, labels, 'latin', false)).toBe('D');
    expect(keyFace({ action: 'symbols' }, labels, 'latin', false)).toBe('123');
    for (const action of ['shift', 'delete', 'native'] as const) expect(keyFace({ action }, labels, 'latin', false)).toBe('');
  });
});
