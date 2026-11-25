import type { Intent, KeyLike, TextKey } from '@lablo/platform-api';
import { describe, expect, it } from 'vitest';
import { bindEditor } from './binding';
import { createNavigator } from './navigator';
import type { KeyboardEnd, KeyboardSession, ScreenKeyboard } from './screen-keyboard';
import type { EditableLike } from './text-editor';
import { createTextEditor } from './text-editor';

/** The app's own keyboard through the editor (RELAY step 40e): the editor opens it instead of giving DOM focus. */
class FakeKeyboard implements ScreenKeyboard {
  session: KeyboardSession | null = null;
  opened = 0;
  closed = 0;
  get isOpen(): boolean {
    return this.session !== null;
  }
  open(session: KeyboardSession): void {
    this.opened++;
    this.session = session;
  }
  close(): void {
    this.closed++;
    this.session = null;
  }
  end(how: KeyboardEnd): void {
    const session = this.session;
    this.session = null;
    session?.onEnd(how);
  }
}

class FakeInput implements EditableLike {
  focusCalls = 0;
  blurCalls = 0;
  focus(): void {
    this.focusCalls++;
  }
  blur(): void {
    this.blurCalls++;
  }
}

function setup(ownKeyboard: boolean) {
  const nav = createNavigator({
    root: {
      id: 'form',
      zones: [
        { kind: 'list', id: 'fields', axis: 'vertical', count: 2, neighbours: { down: 'actions' } },
        { kind: 'list', id: 'actions', axis: 'horizontal', count: 1, neighbours: { up: 'fields' } },
      ],
    },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const inputs = new Map([['a', new FakeInput()], ['b', new FakeInput()]]);
  const keyboard = new FakeKeyboard();
  const moves: Intent[] = [];
  const ends: Array<[string, TextKey]> = [];
  const editor = createTextEditor({
    platform: {
      ownKeyboard,
      keyToIntent: (): Intent | null => null,
      textKey: (event: KeyLike): TextKey | null => (event.keyCode === 13 ? 'done' : null),
      onSoftKeyboard: () => () => undefined,
    },
    nav: { handle: (intent) => (moves.push(intent), nav.handle(intent)) },
    find: (id) => inputs.get(id) ?? null,
    keyboard,
    onEnd: (id, how) => ends.push([id, how]),
  });
  return { editor, inputs, keyboard, moves, ends };
}

describe('createTextEditor with the app\'s own keyboard (step 40e)', () => {
  it('opens the keyboard on the input and gives nothing DOM focus', () => {
    const r = setup(true);
    expect(r.editor.open('a')).toBe(true);
    expect(r.keyboard.opened).toBe(1);
    expect(r.keyboard.session?.input).toBe(r.inputs.get('a'));
    expect(r.inputs.get('a')!.focusCalls).toBe(0);
    expect(r.editor.editing).toBe('a');
    expect(r.editor.field('a').editing).toBe(true);
  });

  it('keeps the TV\'s own keyboard when the platform has none of ours', () => {
    const r = setup(false);
    r.editor.open('a');
    expect(r.keyboard.opened).toBe(0);
    expect(r.inputs.get('a')!.focusCalls).toBe(1);
    expect(r.editor.field('a').readOnly).toBe(false);
  });

  it('makes the input read-only, so focusing it opens no TV keyboard', () => {
    const r = setup(true);
    expect(r.editor.field('a').readOnly).toBe(true);
    expect(bindEditor(r.editor).field('b').readOnly).toBe(true);
  });

  it('Done on the keyboard ends the edit and moves down, the text kept', () => {
    const r = setup(true);
    r.editor.open('a');
    r.keyboard.end('done');
    expect(r.editor.editing).toBeNull();
    expect(r.moves).toEqual(['DOWN']);
    expect(r.ends).toEqual([['a', 'done']]);
    // It was the keyboard that ended: the editor does not close it again.
    expect(r.keyboard.closed).toBe(0);
  });

  it('Back or Cancel ends the edit and keeps the focus on the field', () => {
    const r = setup(true);
    r.editor.open('a');
    r.keyboard.end('close');
    expect(r.moves).toEqual([]);
    expect(r.ends).toEqual([['a', 'close']]);
  });

  it('the hand-over key gives the input to the TV keyboard: typable and focused, the edit goes on, read-only again after', () => {
    const r = setup(true);
    const input = r.inputs.get('a') as FakeInput & { readOnly?: boolean };
    input.readOnly = true;
    r.editor.open('a');
    r.keyboard.end('native');
    expect(input.readOnly).toBe(false);
    expect(input.focusCalls).toBe(1);
    expect(r.editor.editing).toBe('a');
    expect(r.ends).toEqual([]);
    r.editor.close();
    expect(input.readOnly).toBe(true);
    expect(r.ends).toEqual([['a', 'close']]);
  });

  it('close() closes the keyboard', () => {
    const r = setup(true);
    r.editor.open('a');
    r.editor.close();
    expect(r.keyboard.closed).toBe(1);
    expect(r.keyboard.isOpen).toBe(false);
    expect(r.ends).toEqual([['a', 'close']]);
  });

  it('opening a second field moves the keyboard to it', () => {
    const r = setup(true);
    r.editor.open('a');
    r.editor.open('b');
    expect(r.keyboard.session?.input).toBe(r.inputs.get('b'));
    expect(r.ends).toEqual([['a', 'close']]);
  });

  it('a pointer focusing the read-only input opens the keyboard like OK', () => {
    const r = setup(true);
    r.editor.field('a').onEditFocus();
    expect(r.editor.editing).toBe('a');
    expect(r.keyboard.opened).toBe(1);
    // The click that follows the focus finds the edit open.
    expect(r.editor.open('a')).toBe(true);
    expect(r.keyboard.opened).toBe(1);
  });

  it('dispose() closes an open keyboard', () => {
    const r = setup(true);
    r.editor.open('a');
    r.editor.dispose();
    expect(r.keyboard.closed).toBe(1);
  });
});
