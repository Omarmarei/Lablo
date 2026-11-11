import type { Intent, KeyLike, TextKey } from '@lablo/platform-api';
import { describe, expect, it } from 'vitest';
import { bindEditor } from './binding';
import { OK_CLICK_WINDOW_MS, createNavigator } from './navigator';
import type { EditKeyEvent, EditableLike } from './text-editor';
import { createTextEditor } from './text-editor';

/** Desktop-like text keys: Enter done, Escape close, the vertical arrows. */
const TEXT_KEYS: Record<number, TextKey> = { 13: 'done', 27: 'close', 38: 'up', 40: 'down' };

/** An input stand-in: records focus and blur, and calls the field's handlers as the DOM would. */
class FakeInput implements EditableLike {
  focused = false;
  calls: string[] = [];
  onFocus: (() => void) | null = null;
  onBlur: (() => void) | null = null;
  focus(): void {
    this.calls.push('focus');
    if (this.focused) return;
    this.focused = true;
    this.onFocus?.();
  }
  blur(): void {
    this.calls.push('blur');
    if (!this.focused) return;
    this.focused = false;
    this.onBlur?.();
  }
}

interface KeyEvent extends EditKeyEvent {
  prevented: boolean;
  stopped: boolean;
}

const key = (keyCode: number): KeyEvent => {
  const event = {
    keyCode,
    prevented: false,
    stopped: false,
    preventDefault() {
      event.prevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
  };
  return event;
};

function setup(ids: string[] = ['server', 'user', 'pass']) {
  const nav = createNavigator({
    root: {
      id: 'form',
      zones: [
        { kind: 'list', id: 'fields', axis: 'vertical', count: ids.length, neighbours: { down: 'actions' } },
        { kind: 'list', id: 'actions', axis: 'horizontal', count: 1, neighbours: { up: 'fields' } },
      ],
    },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const inputs = new Map(ids.map((id) => [id, new FakeInput()]));
  let clock = 1000;
  const keyboard: Array<(visible: boolean) => void> = [];
  const ends: Array<[string, TextKey]> = [];
  const moves: Intent[] = [];
  const editor = createTextEditor({
    platform: {
      textKey: (event: KeyLike) => TEXT_KEYS[event.keyCode] ?? null,
      onSoftKeyboard: (listener) => {
        keyboard.push(listener);
        return () => keyboard.splice(keyboard.indexOf(listener), 1);
      },
    },
    nav: {
      handle: (intent) => {
        moves.push(intent);
        return nav.handle(intent);
      },
    },
    find: (id) => inputs.get(id) ?? null,
    now: () => clock,
    onEnd: (id, how) => ends.push([id, how]),
  });
  // Wire each fake input's DOM events to its field's handlers.
  for (const [id, input] of inputs) {
    input.onFocus = () => editor.field(id).onEditFocus();
    input.onBlur = () => editor.field(id).onEditBlur();
  }
  const later = (ms: number): void => {
    clock += ms;
  };
  const type = (id: string): void => editor.field(id).onEditInput();
  const press = (id: string, keyCode: number): KeyEvent => {
    const event = key(keyCode);
    editor.field(id).onEditKey(event);
    return event;
  };
  return { nav, editor, inputs, keyboard, ends, moves, later, type, press };
}

describe('createTextEditor (TV text input, RELAY step 13a)', () => {
  it('open gives the input DOM focus and marks the field as being edited', () => {
    const r = setup();
    const seen: Array<string | null> = [];
    r.editor.subscribe((editing) => seen.push(editing));
    expect(r.editor.open('user')).toBe(true);
    expect(r.inputs.get('user')!.focused).toBe(true);
    expect(r.editor.editing).toBe('user');
    expect(r.editor.field('user').editing).toBe(true);
    expect(r.editor.field('server').editing).toBe(false);
    // Opening it again changes nothing.
    expect(r.editor.open('user')).toBe(true);
    expect(seen).toEqual(['user']);
  });

  it('open fails for a field that is not on screen', () => {
    const r = setup();
    expect(r.editor.open('missing')).toBe(false);
    expect(r.editor.editing).toBeNull();
  });

  it('typing keys stay in the field: stopped, not prevented, the edit goes on', () => {
    const r = setup();
    r.editor.open('user');
    for (const code of [65, 8, 37, 39, 461]) {
      const event = r.press('user', code);
      expect(event.stopped).toBe(true);
      expect(event.prevented).toBe(false);
    }
    expect(r.editor.editing).toBe('user');
    expect(r.ends).toEqual([]);
  });

  it('done blurs the input, keeps the text and moves the focus down', () => {
    const r = setup();
    r.editor.open('server');
    r.type('server');
    const event = r.press('server', 13);
    expect(event.prevented).toBe(true);
    expect(r.editor.editing).toBeNull();
    expect(r.inputs.get('server')!.focused).toBe(false);
    expect(r.ends).toEqual([['server', 'done']]);
    expect(r.moves).toEqual(['DOWN']);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'fields', index: 1 });
  });

  it('done on the last field moves to the buttons; up and down move the same way', () => {
    const r = setup();
    r.nav.top.focus('fields', 2);
    r.editor.open('pass');
    r.later(OK_CLICK_WINDOW_MS);
    r.press('pass', 13);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'actions', index: 0 });

    r.nav.top.focus('fields', 1);
    r.editor.open('user');
    r.press('user', 38);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'fields', index: 0 });
    r.editor.open('server');
    r.press('server', 40);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'fields', index: 1 });
    expect(r.ends).toEqual([
      ['pass', 'done'],
      ['user', 'up'],
      ['server', 'down'],
    ]);
  });

  it('close ends the edit where it is: the focus stays and nothing moves', () => {
    const r = setup();
    r.nav.top.focus('fields', 1);
    r.editor.open('user');
    r.press('user', 27);
    expect(r.editor.editing).toBeNull();
    expect(r.moves).toEqual([]);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'fields', index: 1 });
    expect(r.ends).toEqual([['user', 'close']]);
  });

  it('ignores the twin key 13 of the click that opened the field (one Magic Remote press)', () => {
    const r = setup();
    r.editor.open('user');
    r.later(OK_CLICK_WINDOW_MS - 1);
    const twin = r.press('user', 13);
    expect(twin.prevented).toBe(true);
    expect(r.editor.editing).toBe('user');
    expect(r.ends).toEqual([]);
    // A later Enter is a real one.
    r.later(1);
    r.press('user', 13);
    expect(r.ends).toEqual([['user', 'done']]);
  });

  it('a quick Enter after typing is a real one (a fast typist, or the e2e keyboard)', () => {
    const r = setup();
    r.editor.open('user');
    r.later(10);
    r.type('user');
    r.press('user', 13);
    expect(r.ends).toEqual([['user', 'done']]);
  });

  it('only done is paired: a quick up, down or close still ends the edit', () => {
    for (const [code, how] of [
      [38, 'up'],
      [40, 'down'],
      [27, 'close'],
    ] as const) {
      const r = setup();
      r.nav.top.focus('fields', 1);
      r.editor.open('user');
      r.press('user', code);
      expect(r.ends).toEqual([['user', how]]);
    }
  });

  it('a blur from elsewhere ends the edit without moving the focus', () => {
    const r = setup();
    r.editor.open('user');
    r.inputs.get('user')!.blur();
    expect(r.editor.editing).toBeNull();
    expect(r.ends).toEqual([['user', 'close']]);
    expect(r.moves).toEqual([]);
    // Its own end blurs once: the blur event finds no edit left.
    r.editor.open('server');
    r.later(OK_CLICK_WINDOW_MS);
    r.press('server', 13);
    expect(r.ends).toEqual([
      ['user', 'close'],
      ['server', 'done'],
    ]);
  });

  it('the keyboard hiding ends the edit (webOS keyboardStateChange); showing it changes nothing', () => {
    const r = setup();
    r.editor.open('user');
    r.keyboard[0]!(true);
    expect(r.editor.editing).toBe('user');
    r.keyboard[0]!(false);
    expect(r.editor.editing).toBeNull();
    expect(r.inputs.get('user')!.focused).toBe(false);
    expect(r.ends).toEqual([['user', 'close']]);
    // Hiding with no edit open is nothing.
    r.keyboard[0]!(false);
    expect(r.ends).toHaveLength(1);
  });

  it('a click right on another input moves the edit there (native focus first)', () => {
    const r = setup();
    r.editor.open('server');
    r.inputs.get('server')!.blur();
    r.inputs.get('user')!.focus();
    expect(r.editor.editing).toBe('user');
    expect(r.ends).toEqual([['server', 'close']]);
  });

  it('another input taking the focus with no blur first ends the first edit (Chromium sends no blur for a removed input)', () => {
    const r = setup();
    r.editor.open('server');
    r.inputs.get('user')!.focus();
    expect(r.editor.editing).toBe('user');
    expect(r.ends).toEqual([['server', 'close']]);
    expect(r.inputs.get('server')!.focused).toBe(false);
  });

  it('opening another field ends the first edit', () => {
    const r = setup();
    r.editor.open('server');
    r.editor.open('user');
    expect(r.inputs.get('server')!.focused).toBe(false);
    expect(r.inputs.get('user')!.focused).toBe(true);
    expect(r.ends).toEqual([['server', 'close']]);
    expect(r.editor.editing).toBe('user');
  });

  it('keys reaching a field that is not being edited do nothing but stay there', () => {
    const r = setup();
    const event = r.press('user', 13);
    expect(event.stopped).toBe(true);
    expect(event.prevented).toBe(false);
    expect(r.moves).toEqual([]);
  });

  it('close() ends any edit; dispose() stops listening to the keyboard', () => {
    const r = setup();
    r.editor.open('pass');
    r.editor.close();
    expect(r.editor.editing).toBeNull();
    expect(r.ends).toEqual([['pass', 'close']]);
    r.editor.close();
    expect(r.ends).toHaveLength(1);
    r.editor.dispose();
    expect(r.keyboard).toHaveLength(0);
  });

  it('bindEditor follows the editor as a signal', () => {
    const r = setup();
    const binding = bindEditor(r.editor);
    expect(binding.editing.value).toBeNull();
    r.editor.open('user');
    expect(binding.editing.value).toBe('user');
    expect(binding.field('user').editing).toBe(true);
    expect(binding.field('pass').editing).toBe(false);
    binding.dispose();
    r.editor.close();
    expect(binding.editing.value).toBe('user');
  });
});
