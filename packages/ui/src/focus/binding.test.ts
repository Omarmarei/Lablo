import { effect } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { bindFocus, useFocus, useZone } from './binding';
import type { ScreenSpec } from './navigator';
import { createNavigator } from './navigator';

const HOME: ScreenSpec = {
  id: 'home',
  zones: [
    { kind: 'list', id: 'rail', axis: 'horizontal', count: 4, neighbours: { down: 'list' } },
    { kind: 'list', id: 'list', axis: 'vertical', count: 20, visible: 5, neighbours: { up: 'rail' } },
  ],
  initial: 'list',
};

function setup(selected: string[] = []) {
  const nav = createNavigator({
    root: { ...HOME, onSelect: (f) => selected.push(`${f.zone} ${f.index}`) },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  return { nav, binding: bindFocus(nav), selected };
}

describe('bindFocus', () => {
  it('puts the focus in a signal that changes with every engine change, positions included', () => {
    const { nav, binding } = setup();
    const seen: string[] = [];
    const stop = effect(() => {
      const f = useFocus(binding);
      seen.push(`${f.zone} ${f.index} top ${nav.top.position('list').top}`);
    });
    nav.handle('DOWN');
    // The wheel moves the window without moving the focus: still a new value.
    nav.wheel(3);
    nav.handle('UP');
    expect(seen).toEqual(['list 0 top 0', 'list 1 top 0', 'list 3 top 3', 'list 2 top 2']);
    stop();
  });

  it('stops following the engine once disposed', () => {
    const { nav, binding } = setup();
    nav.handle('DOWN');
    expect(binding.focus.value.index).toBe(1);
    binding.dispose();
    nav.handle('DOWN');
    expect(binding.focus.value.index).toBe(1);
    expect(nav.snapshot().index).toBe(2);
  });
});

describe('useZone', () => {
  it('tells each item whether it is focused, remembered or idle', () => {
    const { nav, binding } = setup();
    const home = nav.top;
    nav.handle('DOWN');
    let list = useZone(binding, home, 'list');
    let rail = useZone(binding, home, 'rail');
    expect(list.active).toBe(true);
    expect(rail.active).toBe(false);
    expect([0, 1, 2].map((i) => list.state(i))).toEqual(['idle', 'focused', 'idle']);
    expect(rail.state(0)).toBe('memory');
    expect(list.spec).toMatchObject({ id: 'list', count: 20, visible: 5 });
    expect(list.position).toMatchObject({ index: 1, top: 0 });

    // Under a pushed screen, the focused item shows where Back returns to.
    nav.push({ id: 'dialog', zones: [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }] });
    list = useZone(binding, home, 'list');
    expect(list.active).toBe(false);
    expect(list.item(1).state).toBe('memory');
    expect(useZone(binding, nav.top, 'buttons').item(0).state).toBe('focused');
    nav.pop();
    rail = useZone(binding, home, 'rail');
    expect(rail.state(0)).toBe('memory');
    expect(useZone(binding, home, 'list').state(1)).toBe('focused');
  });

  it('hands the pointer events of an item to its screen', () => {
    const { nav, binding, selected } = setup();
    const home = nav.top;
    nav.pointer(true);
    useZone(binding, home, 'rail').item(2).onHover();
    expect(nav.snapshot()).toMatchObject({ zone: 'rail', index: 2 });
    useZone(binding, home, 'list').item(4).onPress();
    expect(nav.snapshot()).toMatchObject({ zone: 'list', index: 4 });
    expect(selected).toEqual(['list 4']);
  });

  it('throws for a zone the screen does not have', () => {
    const { nav, binding } = setup();
    expect(() => useZone(binding, nav.top, 'grid')).toThrow(/no zone grid/);
  });
});
