import type { Intent, KeyLike } from '@zoma/platform-api';
import { describe, expect, it } from 'vitest';
import { createNavigator } from './navigator';
import { connectRemote, isEditable } from './remote';

const KEYS: Record<number, Intent> = { 13: 'OK', 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN' };

function setup(target: EventTarget = new EventTarget()) {
  const nav = createNavigator({
    root: {
      id: 'home',
      zones: [
        { kind: 'list', id: 'rail', axis: 'horizontal', count: 3, neighbours: { down: 'list' } },
        { kind: 'list', id: 'list', axis: 'vertical', count: 10, visible: 3, neighbours: { up: 'rail' } },
      ],
      initial: 'list',
    },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const pointerListeners: Array<(visible: boolean) => void> = [];
  const seen: Intent[] = [];
  const disconnect = connectRemote({
    platform: {
      keyToIntent: (event: KeyLike) => KEYS[event.keyCode] ?? null,
      onPointer: (listener) => {
        pointerListeners.push(listener);
        return () => pointerListeners.splice(pointerListeners.indexOf(listener), 1);
      },
    },
    nav,
    target,
    onIntent: (intent) => seen.push(intent),
  });
  const fire = (type: string, props: Record<string, number>): Event => {
    const event = Object.assign(new Event(type, { cancelable: true }), props);
    target.dispatchEvent(event);
    return event;
  };
  return { nav, seen, pointerListeners, disconnect, fire };
}

/** A stand-in for a text field's element: keys dispatched on it have it as their target. */
class FakeElement extends EventTarget {
  constructor(
    readonly tagName: string,
    readonly isContentEditable = false,
  ) {
    super();
  }
}

describe('isEditable (keys typed into a text field, RELAY step 13a)', () => {
  it.each([
    ['INPUT', false, true],
    ['input', false, true],
    ['TEXTAREA', false, true],
    ['DIV', true, true],
    ['DIV', false, false],
    ['BUTTON', false, false],
    ['BODY', false, false],
  ] as const)('%s (contenteditable %s) -> %s', (tag, editable, expected) => {
    expect(isEditable(new FakeElement(tag, editable))).toBe(expected);
  });

  it('is false for the window, null and targets without a tag', () => {
    expect(isEditable(null)).toBe(false);
    expect(isEditable(new EventTarget())).toBe(false);
  });
});

describe('connectRemote', () => {
  it('leaves keys aimed at a text field to it (Backspace deletes there)', () => {
    const r = setup(new FakeElement('INPUT'));
    const down = r.fire('keydown', { keyCode: 40 });
    expect(down.defaultPrevented).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'list', index: 0 });
    expect(r.seen).toEqual([]);
  });

  it('still takes keys aimed at other elements', () => {
    const r = setup(new FakeElement('DIV'));
    r.fire('keydown', { keyCode: 40 });
    expect(r.nav.snapshot()).toMatchObject({ zone: 'list', index: 1 });
    expect(r.seen).toEqual(['DOWN']);
  });

  it('turns mapped keys into Intents for the navigator and cancels their browser action', () => {
    const r = setup();
    const down = r.fire('keydown', { keyCode: 40 });
    expect(down.defaultPrevented).toBe(true);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'list', index: 1 });
    r.fire('keydown', { keyCode: 38 });
    r.fire('keydown', { keyCode: 38 });
    expect(r.nav.snapshot()).toMatchObject({ zone: 'rail', index: 0 });
    // Unmapped keys keep their browser action and reach nobody.
    const other = r.fire('keydown', { keyCode: 65 });
    expect(other.defaultPrevented).toBe(false);
    expect(r.seen).toEqual(['DOWN', 'UP', 'UP']);
  });

  it('scrolls the focused zone one row per wheel event and never the page', () => {
    const r = setup();
    const wheel = r.fire('wheel', { deltaY: 240 });
    expect(wheel.defaultPrevented).toBe(true);
    expect(r.nav.top.position('list')).toMatchObject({ index: 1, top: 1 });
    r.fire('wheel', { deltaY: -3 });
    expect(r.nav.top.position('list')).toMatchObject({ index: 1, top: 0 });
    expect(r.fire('wheel', { deltaY: 0 }).defaultPrevented).toBe(true);
    expect(r.nav.top.position('list')).toMatchObject({ top: 0 });
  });

  it('shows the pointer on real moves and on the platform’s own events', () => {
    const r = setup();
    r.fire('mousemove', { screenX: 10, screenY: 10 });
    expect(r.nav.snapshot().pointer).toBe(true);
    r.fire('keydown', { keyCode: 40 });
    expect(r.nav.snapshot().pointer).toBe(false);
    // The same coordinates again: Chromium's still-pointer mousemove, ignored.
    r.fire('mousemove', { screenX: 10, screenY: 10 });
    expect(r.nav.snapshot().pointer).toBe(false);
    r.pointerListeners[0]!(true);
    expect(r.nav.snapshot().pointer).toBe(true);
    r.pointerListeners[0]!(false);
    expect(r.nav.snapshot().pointer).toBe(false);
  });

  it('disconnects everything', () => {
    const r = setup();
    r.disconnect();
    r.fire('keydown', { keyCode: 40 });
    r.fire('wheel', { deltaY: 100 });
    r.fire('mousemove', { screenX: 1, screenY: 2 });
    expect(r.nav.snapshot()).toMatchObject({ zone: 'list', index: 0, pointer: false });
    expect(r.nav.top.position('list').top).toBe(0);
    expect(r.pointerListeners).toHaveLength(0);
    expect(r.seen).toEqual([]);
  });
});
