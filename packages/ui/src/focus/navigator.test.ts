import type { Intent, RootBackPolicy } from '@zoma/platform-api';
import { describe, expect, it, vi } from 'vitest';
import type { Focus, Navigator, NavigatorOptions, ScreenSpec } from './navigator';
import { createNavigator } from './navigator';
import type { EpgZone, GridZone, ListZone, TextDirection, ZoneSpec } from './types';

/**
 * The home screen of these tests:
 *
 *        rail  (horizontal, 5)
 *   list (vertical, 10, 4 visible)   grid (3 columns, 8)
 *
 * In RTL the layout mirrors, so the grid sits at the list's left.
 */
const rail: ListZone = { kind: 'list', id: 'rail', axis: 'horizontal', count: 5, neighbours: { down: 'list' } };
const list: ListZone = {
  kind: 'list',
  id: 'list',
  axis: 'vertical',
  count: 10,
  visible: 4,
  neighbours: { up: 'rail', end: 'grid' },
};
const grid: GridZone = { kind: 'grid', id: 'grid', columns: 3, count: 8, neighbours: { up: 'rail', start: 'list' } };

function home(extra: Partial<ScreenSpec> = {}): ScreenSpec {
  return { id: 'home', zones: [rail, list, grid], initial: 'list', ...extra };
}

function dialog(id = 'dialog', extra: Partial<ScreenSpec> = {}): ScreenSpec {
  return { id, zones: [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }], ...extra };
}

interface Rig {
  readonly nav: Navigator;
  readonly exit: ReturnType<typeof vi.fn>;
  readonly exitDialog: ReturnType<typeof vi.fn>;
  readonly seen: Focus[];
  /** Presses the keys, returning each result. */
  press(...intents: Intent[]): string[];
  /** `zone index` of the focus. */
  at(): string;
}

function rig(options: Partial<NavigatorOptions> = {}): Rig {
  const exit = vi.fn();
  const exitDialog = vi.fn();
  const nav = createNavigator({ root: home(), rootBack: 'exit-dialog', exit, exitDialog, ...options });
  const seen: Focus[] = [];
  nav.subscribe((focus) => seen.push(focus));
  return {
    nav,
    exit,
    exitDialog,
    seen,
    press: (...intents) => intents.map((intent) => nav.handle(intent)),
    at: () => {
      const f = nav.snapshot();
      return `${f.zone} ${f.index}`;
    },
  };
}

describe.each<[TextDirection, Intent, Intent]>([
  // [direction, the key towards the inline end, the key towards the inline start]
  ['ltr', 'RIGHT', 'LEFT'],
  ['rtl', 'LEFT', 'RIGHT'],
])('navigation in %s', (dir, toEnd, toStart) => {
  it('moves a horizontal list with the key towards its end', () => {
    const r = rig({ dir });
    r.nav.top.focus('rail', 0);
    expect(r.press(toEnd, toEnd)).toEqual(['moved', 'moved']);
    expect(r.at()).toBe('rail 2');
    expect(r.press(toStart)).toEqual(['moved']);
    expect(r.at()).toBe('rail 1');
    expect(r.press(toStart, toStart)).toEqual(['moved', 'edge']);
    expect(r.at()).toBe('rail 0');
  });

  it('moves a vertical list with UP and DOWN, the same in both directions', () => {
    const r = rig({ dir });
    expect(r.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'UP')).toEqual(['moved', 'moved', 'moved', 'moved', 'moved']);
    expect(r.at()).toBe('list 3');
    expect(r.nav.top.position('list')).toMatchObject({ index: 3, top: 1 });
  });

  it('leaves a vertical list sideways to the neighbour on that side', () => {
    const r = rig({ dir });
    expect(r.press(toStart)).toEqual(['edge']);
    expect(r.press(toEnd)).toEqual(['zone']);
    expect(r.at()).toBe('grid 0');
    expect(r.press(toEnd, 'DOWN', toEnd, 'DOWN')).toEqual(['moved', 'moved', 'moved', 'moved']);
    expect(r.at()).toBe('grid 7');
    expect(r.press(toEnd)).toEqual(['edge']);
    expect(r.press(toStart, toStart)).toEqual(['moved', 'zone']);
    expect(r.at()).toBe('list 0');
  });

  it('remembers each zone’s position (per-zone memory)', () => {
    const r = rig({ dir });
    r.press('DOWN', 'DOWN', 'DOWN', toEnd, 'DOWN', toEnd);
    expect(r.at()).toBe('grid 4');
    r.press(toStart, toStart);
    expect(r.at()).toBe('list 3');
    r.press(toEnd);
    expect(r.at()).toBe('grid 3');
    r.press('UP', 'UP');
    expect(r.at()).toBe('rail 0');
    r.press(toEnd, toEnd, 'DOWN');
    expect(r.at()).toBe('list 3');
    expect(r.nav.top.position('list').top).toBe(0);
    r.press('UP', 'UP', 'UP', 'UP');
    expect(r.at()).toBe('rail 2');
    r.press('DOWN', toEnd);
    expect(r.at()).toBe('grid 0');
  });
});

describe('RTL', () => {
  it('swaps LEFT and RIGHT exactly once', () => {
    const r = rig({ dir: 'rtl' });
    r.nav.top.focus('rail', 0);
    // Not swapped: LEFT would be an edge at item 0. Swapped twice: the same.
    expect(r.press('LEFT')).toEqual(['moved']);
    expect(r.at()).toBe('rail 1');
    expect(r.press('RIGHT', 'RIGHT')).toEqual(['moved', 'edge']);
    expect(r.at()).toBe('rail 0');
  });

  it('goes to the start neighbour with RIGHT', () => {
    const r = rig({ dir: 'rtl' });
    r.nav.top.focus('grid', 3);
    expect(r.press('RIGHT')).toEqual(['zone']);
    expect(r.at()).toBe('list 0');
    expect(r.press('LEFT')).toEqual(['zone']);
    expect(r.at()).toBe('grid 3');
  });

  it('follows a change of direction at run time', () => {
    const r = rig();
    r.nav.top.focus('rail', 2);
    r.press('RIGHT');
    expect(r.at()).toBe('rail 3');
    r.nav.setDir('rtl');
    expect(r.nav.snapshot().dir).toBe('rtl');
    r.press('RIGHT');
    expect(r.at()).toBe('rail 2');
    r.nav.setDir('ltr');
    r.press('RIGHT');
    expect(r.at()).toBe('rail 3');
  });

  it('moves a free zone by logical geometry', () => {
    const buttons: ZoneSpec = {
      kind: 'free',
      id: 'form',
      rects: [
        { x: 0, y: 0, width: 100, height: 40 },
        { x: 120, y: 0, width: 100, height: 40 },
        { x: 0, y: 60, width: 220, height: 40 },
      ],
    };
    for (const [dir, key] of [
      ['ltr', 'RIGHT'],
      ['rtl', 'LEFT'],
    ] as const) {
      const r = rig({ dir, root: { id: 'form', zones: [buttons] } });
      expect(r.press(key, 'DOWN')).toEqual(['moved', 'moved']);
      expect(r.at()).toBe('form 2');
      expect(r.press('UP')).toEqual(['moved']);
      expect(r.at()).toBe('form 0');
    }
  });

  it('moves the guide’s time cursor towards the end with LEFT', () => {
    const guide: EpgZone = {
      kind: 'epg',
      id: 'guide',
      rows: 2,
      from: 0,
      to: 240,
      span: 120,
      now: 10,
      cell: () => null,
    };
    const r = rig({ dir: 'rtl', root: { id: 'guide', zones: [guide] } });
    expect(r.nav.snapshot().time).toBe(10);
    r.press('LEFT');
    expect(r.nav.snapshot().time).toBe(30);
    r.press('DOWN', 'LEFT', 'RIGHT', 'RIGHT');
    expect(r.nav.snapshot()).toMatchObject({ index: 1, time: 0 });
    expect(r.press('RIGHT')).toEqual(['edge']);
  });
});

describe('zones and neighbours', () => {
  it('skips empty neighbours in the same direction', () => {
    const nav = createNavigator({
      root: {
        id: 's',
        zones: [
          { kind: 'list', id: 'a', axis: 'vertical', count: 2, neighbours: { end: 'b' } },
          { kind: 'list', id: 'b', axis: 'vertical', count: 0, neighbours: { end: 'c', start: 'a' } },
          { kind: 'list', id: 'c', axis: 'vertical', count: 2, neighbours: { start: 'b' } },
        ],
      },
      rootBack: 'exit-dialog',
      exit: () => undefined,
      exitDialog: () => undefined,
    });
    expect(nav.handle('RIGHT')).toBe('zone');
    expect(nav.snapshot().zone).toBe('c');
    expect(nav.handle('LEFT')).toBe('zone');
    expect(nav.snapshot().zone).toBe('a');
  });

  it('stops at a loop of empty zones', () => {
    const nav = createNavigator({
      root: {
        id: 's',
        zones: [
          { kind: 'list', id: 'a', axis: 'vertical', count: 1, neighbours: { end: 'b' } },
          { kind: 'list', id: 'b', axis: 'vertical', count: 0, neighbours: { end: 'c' } },
          { kind: 'list', id: 'c', axis: 'vertical', count: 0, neighbours: { end: 'b' } },
        ],
      },
      rootBack: 'exit-dialog',
      exit: () => undefined,
      exitDialog: () => undefined,
    });
    expect(nav.handle('RIGHT')).toBe('edge');
    expect(nav.snapshot().zone).toBe('a');
  });

  it('keeps the focus inside a zone whose items change', () => {
    const r = rig();
    r.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    expect(r.nav.top.position('list')).toMatchObject({ index: 7, top: 4 });
    r.nav.top.update({ ...list, count: 5 });
    expect(r.nav.top.position('list')).toMatchObject({ index: 4, top: 1 });
    r.nav.top.update({ ...list, count: 0 });
    expect(r.nav.snapshot()).toMatchObject({ zone: 'list', index: -1 });
    expect(r.press('DOWN', 'OK')).toEqual(['edge', 'ignored']);
    r.nav.top.update(list);
    expect(r.nav.snapshot()).toMatchObject({ zone: 'list', index: 0 });
  });

  it('forgets a zone’s position on reset', () => {
    const r = rig();
    r.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    r.nav.top.reset('list');
    expect(r.nav.top.position('list')).toEqual({ index: 0, top: 0, time: 0, view: 0 });
  });

  it('focuses an item from code, in any zone', () => {
    const r = rig();
    r.nav.top.focus('list', 9);
    expect(r.at()).toBe('list 9');
    expect(r.nav.top.position('list').top).toBe(6);
    r.nav.top.focus('grid', 20);
    expect(r.at()).toBe('grid 7');
    expect(r.nav.top.active).toBe('grid');
  });

  it('refuses malformed screens', () => {
    const make = (root: ScreenSpec) => () =>
      createNavigator({ root, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined });
    expect(make({ id: 'x', zones: [] })).toThrow('no zones');
    expect(make({ id: 'x', zones: [rail, rail] })).toThrow('zone rail twice');
    expect(make({ id: 'x', zones: [rail] })).toThrow('unknown down neighbour list');
    expect(make({ id: 'x', zones: [rail, list, grid], initial: 'nope' })).toThrow('no zone nope');
    const r = rig();
    expect(() => r.nav.top.update({ ...grid, id: 'nope' })).toThrow('no zone nope');
    expect(() => r.nav.top.update({ ...grid, neighbours: { down: 'nope' } })).toThrow('unknown down neighbour');
    expect(() => r.nav.top.position('nope')).toThrow('no zone nope');
  });
});

describe('keys other than arrows', () => {
  it('pages a list with CH_UP and CH_DOWN', () => {
    const r = rig();
    expect(r.press('CH_DOWN', 'CH_DOWN')).toEqual(['moved', 'moved']);
    expect(r.nav.top.position('list')).toMatchObject({ index: 8, top: 6 });
    expect(r.press('CH_DOWN', 'CH_DOWN')).toEqual(['moved', 'edge']);
    expect(r.nav.top.position('list')).toMatchObject({ index: 9, top: 6 });
    expect(r.press('CH_UP')).toEqual(['moved']);
    expect(r.nav.top.position('list')).toMatchObject({ index: 5, top: 2 });
    r.nav.top.focus('rail', 1);
    expect(r.press('CH_DOWN')).toEqual(['ignored']);
  });

  it('gives OK on an item to the screen', () => {
    const onSelect = vi.fn();
    const r = rig({ root: home({ onSelect }) });
    r.press('DOWN', 'DOWN');
    expect(r.press('OK')).toEqual(['select']);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ screen: 'home', zone: 'list', index: 2, time: null }));
    expect(rig().press('OK')).toEqual(['ignored']);
    // Nothing to select in an empty zone.
    r.nav.top.update({ ...list, count: 0 });
    expect(r.press('OK')).toEqual(['ignored']);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('lets the screen see every key first', () => {
    const seen: string[] = [];
    const onIntent = (intent: Intent, focus: Focus): boolean => {
      seen.push(`${intent} ${focus.zone} ${focus.index}`);
      return intent === 'RED' || intent === 'DOWN';
    };
    const r = rig({ root: home({ onIntent }) });
    expect(r.press('RED', 'DOWN', 'BLUE', 'RIGHT')).toEqual(['screen', 'screen', 'ignored', 'zone']);
    expect(seen).toEqual(['RED list 0', 'DOWN list 0', 'BLUE list 0', 'RIGHT list 0']);
    expect(r.at()).toBe('grid 0');
  });
});

describe('router and back stack', () => {
  it('pushes and pops screens, each keeping its focus', () => {
    const r = rig();
    r.press('DOWN', 'DOWN', 'RIGHT');
    const details = r.nav.push(dialog('details'));
    expect(r.nav.snapshot()).toMatchObject({ screen: 'details', zone: 'buttons', index: 0, depth: 2 });
    r.press('RIGHT');
    const deeper = r.nav.push(dialog('deeper'));
    expect(r.nav.snapshot().depth).toBe(3);
    expect(r.press('BACK')).toEqual(['popped']);
    expect(deeper.open).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'details', index: 1, depth: 2 });
    expect(r.press('BACK')).toEqual(['popped']);
    expect(details.open).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'home', zone: 'grid', index: 0, depth: 1 });
    expect(r.nav.top.position('list').index).toBe(2);
    expect(r.exit).not.toHaveBeenCalled();
    expect(r.exitDialog).not.toHaveBeenCalled();
  });

  it('shows the exit dialog on Back at the root under exit-dialog (Tizen)', () => {
    const r = rig({ rootBack: 'exit-dialog' });
    r.exitDialog.mockImplementation(() => r.nav.push(dialog('exit')));
    expect(r.press('BACK')).toEqual(['exit-dialog']);
    expect(r.exitDialog).toHaveBeenCalledTimes(1);
    expect(r.exit).not.toHaveBeenCalled();
    expect(r.nav.snapshot()).toMatchObject({ screen: 'exit', depth: 2 });
    // Back on the dialog closes it.
    expect(r.press('BACK')).toEqual(['popped']);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'home', depth: 1 });
    expect(r.exitDialog).toHaveBeenCalledTimes(1);
  });

  it('leaves the app on Back at the root under platform-back (webOS)', () => {
    const r = rig({ rootBack: 'platform-back' });
    expect(r.press('BACK')).toEqual(['exit']);
    expect(r.exit).toHaveBeenCalledTimes(1);
    expect(r.exitDialog).not.toHaveBeenCalled();
    // Back on a pushed screen still pops it.
    r.nav.push(dialog());
    expect(r.press('BACK')).toEqual(['popped']);
    expect(r.exit).toHaveBeenCalledTimes(1);
  });

  it.each<RootBackPolicy>(['exit-dialog', 'platform-back'])('lets a screen keep Back (%s)', (rootBack) => {
    let menuOpen = true;
    const onIntent = (intent: Intent): boolean => {
      if (intent !== 'BACK' || !menuOpen) return false;
      menuOpen = false;
      return true;
    };
    const r = rig({ rootBack, root: home({ onIntent }) });
    expect(r.press('BACK')).toEqual(['screen']);
    expect(r.exit).not.toHaveBeenCalled();
    expect(r.exitDialog).not.toHaveBeenCalled();
    expect(r.press('BACK')).toEqual([rootBack === 'exit-dialog' ? 'exit-dialog' : 'exit']);
  });

  it('never pops the root', () => {
    const r = rig();
    expect(r.nav.pop()).toBe(false);
    expect(r.nav.snapshot().depth).toBe(1);
  });

  it('replaces the top screen and resets the stack', () => {
    const r = rig();
    const first = r.nav.push(dialog('a'));
    const second = r.nav.replace(dialog('b'));
    expect(first.open).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'b', depth: 2 });
    const root = r.nav.reset(dialog('browse'));
    expect(second.open).toBe(false);
    expect(root.open).toBe(true);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'browse', depth: 1 });
    expect(r.nav.pop()).toBe(false);
  });

  it('ignores updates to a screen that left the stack', () => {
    const r = rig();
    const details = r.nav.push(dialog('details'));
    r.nav.pop();
    const before = r.seen.length;
    details.update({ kind: 'list', id: 'buttons', axis: 'horizontal', count: 0 });
    details.focus('buttons', 1);
    details.reset('buttons');
    expect(details.position('buttons').index).toBe(0);
    expect(r.seen).toHaveLength(before);
  });

  it('keeps a covered screen updatable', () => {
    const r = rig();
    const root = r.nav.top;
    r.nav.push(dialog());
    root.update({ ...list, count: 3 });
    root.focus('list', 2);
    expect(r.nav.snapshot().screen).toBe('dialog');
    r.nav.pop();
    expect(r.at()).toBe('list 2');
  });
});

describe('listeners', () => {
  it('hears once per change, and not when nothing changed', () => {
    const r = rig();
    r.press('DOWN');
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toMatchObject({ zone: 'list', index: 1 });
    r.press('LEFT', 'BLUE');
    expect(r.seen).toHaveLength(1);
    r.press('RIGHT');
    expect(r.seen).toHaveLength(2);
    // Back at the root pushing the dialog is one change.
    r.exitDialog.mockImplementation(() => r.nav.push(dialog('exit')));
    r.press('BACK');
    expect(r.seen).toHaveLength(3);
    expect(r.seen[2]).toMatchObject({ screen: 'exit', depth: 2 });
  });

  it('stops hearing after unsubscribing', () => {
    const r = rig();
    const more: Focus[] = [];
    const stop = r.nav.subscribe((f) => more.push(f));
    r.press('DOWN');
    stop();
    stop();
    r.press('DOWN');
    expect(more).toHaveLength(1);
    expect(r.seen).toHaveLength(2);
  });
});

describe('Magic Remote', () => {
  it('focuses the item under the pointer, in any zone', () => {
    const r = rig();
    expect(r.nav.top.hover('grid', 5)).toBe(false);
    expect(r.at()).toBe('list 0');
    r.nav.pointer(true);
    expect(r.nav.snapshot().pointer).toBe(true);
    expect(r.nav.top.hover('grid', 5)).toBe(true);
    expect(r.at()).toBe('grid 5');
    expect(r.nav.top.hover('list', 3)).toBe(true);
    expect(r.at()).toBe('list 3');
    // The pointer moving inside the focused item changes nothing, so nobody is told.
    const told = r.seen.length;
    expect(r.nav.top.hover('list', 3)).toBe(true);
    expect(r.seen).toHaveLength(told);
  });

  it('keeps the focus when the pointer hides, and ignores hovers while hidden', () => {
    const r = rig();
    r.nav.pointer(true);
    r.nav.top.hover('grid', 5);
    r.nav.pointer(false);
    expect(r.at()).toBe('grid 5');
    expect(r.nav.snapshot().pointer).toBe(false);
    // A list scrolling under a hidden pointer sends hovers; they don't move the focus.
    expect(r.nav.top.hover('grid', 1)).toBe(false);
    expect(r.at()).toBe('grid 5');
  });

  it('hands over to the keys from the hovered item, hiding the pointer', () => {
    const r = rig();
    r.nav.pointer(true);
    r.nav.top.hover('grid', 4);
    const told = r.seen.length;
    expect(r.press('RIGHT')).toEqual(['moved']);
    // Hiding the pointer and moving are one change: one notification, with both.
    expect(r.seen).toHaveLength(told + 1);
    expect(r.seen[told]).toMatchObject({ zone: 'grid', index: 5, pointer: false });
    expect(r.at()).toBe('grid 5');
    expect(r.nav.snapshot().pointer).toBe(false);
    expect(r.nav.top.hover('grid', 0)).toBe(false);
  });

  it('ignores hovers outside the items or on a covered screen', () => {
    const r = rig();
    r.nav.pointer(true);
    expect(r.nav.top.hover('grid', 8)).toBe(false);
    expect(r.nav.top.hover('grid', -1)).toBe(false);
    expect(r.nav.top.hover('grid', Number.NaN)).toBe(false);
    expect(r.nav.top.hover('nope', 0)).toBe(false);
    const root = r.nav.top;
    r.nav.push(dialog());
    expect(root.hover('grid', 2)).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'dialog', index: 0 });
    expect(r.nav.top.hover('buttons', 1)).toBe(true);
    expect(r.nav.snapshot().index).toBe(1);
  });

  it('scrolls the focused list with the wheel, keeping the focus in view', () => {
    const r = rig();
    r.press('DOWN');
    expect(r.nav.wheel(1)).toBe(true);
    expect(r.nav.top.position('list')).toMatchObject({ index: 1, top: 1 });
    expect(r.nav.wheel(3)).toBe(true);
    expect(r.nav.top.position('list')).toMatchObject({ index: 4, top: 4 });
    expect(r.nav.wheel(2.9)).toBe(true);
    expect(r.nav.top.position('list')).toMatchObject({ index: 6, top: 6 });
    expect(r.nav.wheel(1)).toBe(false);
    expect(r.nav.wheel(-0.5)).toBe(false);
    expect(r.nav.wheel(-6)).toBe(true);
    expect(r.nav.top.position('list')).toMatchObject({ index: 3, top: 0 });
    // The rail shows all its items: nothing to scroll.
    r.nav.top.focus('rail', 0);
    expect(r.nav.wheel(1)).toBe(false);
  });

  it('reports pointer changes to the listeners', () => {
    const r = rig();
    r.nav.pointer(true);
    r.nav.pointer(true);
    r.nav.pointer(false);
    expect(r.seen.map((f) => f.pointer)).toEqual([true, false]);
  });

  it('hides the pointer only on the keys that move the focus', () => {
    const onSelect = vi.fn();
    const r = rig({ root: home({ onSelect }) });
    r.nav.pointer(true);
    // The Magic Remote's OK sends key 13 while pointing; digits, colours and Back leave it too.
    r.press('OK', 'DIGIT_4', 'RED', 'INFO', 'PLAY_PAUSE');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(r.nav.snapshot().pointer).toBe(true);
    r.nav.push(dialog());
    expect(r.press('BACK')).toEqual(['popped']);
    expect(r.nav.snapshot().pointer).toBe(true);
    for (const key of ['UP', 'DOWN', 'LEFT', 'RIGHT', 'CH_UP', 'CH_DOWN'] as const) {
      r.nav.pointer(true);
      r.press(key);
      expect(r.nav.snapshot().pointer, key).toBe(false);
    }
  });
});

describe('pointer clicks and the webOS OK key', () => {
  /** A rig with a clock the test moves, and a log of what was selected. */
  function clicks(window?: number) {
    let time = 1000;
    const selected: string[] = [];
    const onSelect = (focus: Focus): void => {
      selected.push(`${focus.screen} ${focus.zone} ${focus.index}`);
    };
    const r = rig({ root: home({ onSelect }), now: () => time, ...(window === undefined ? {} : { okClickWindowMs: window }) });
    return {
      ...r,
      selected,
      onSelect,
      later: (ms: number) => {
        time += ms;
      },
    };
  }

  it('focuses and selects the clicked item, showing the pointer', () => {
    const r = clicks();
    expect(r.nav.top.click('grid', 4)).toBe(true);
    expect(r.at()).toBe('grid 4');
    expect(r.selected).toEqual(['home grid 4']);
    expect(r.nav.snapshot().pointer).toBe(true);
    // Focusing, showing the pointer and selecting are one change.
    expect(r.seen).toHaveLength(1);
    r.later(2000);
    expect(r.nav.top.click('rail', 1)).toBe(true);
    expect(r.selected).toEqual(['home grid 4', 'home rail 1']);
  });

  it('ignores clicks outside the items, on a covered or closed screen, and without onSelect', () => {
    const r = clicks();
    expect(r.nav.top.click('grid', 8)).toBe(false);
    expect(r.nav.top.click('grid', -1)).toBe(false);
    expect(r.nav.top.click('nope', 0)).toBe(false);
    expect(r.selected).toEqual([]);
    expect(r.at()).toBe('list 0');
    const root = r.nav.top;
    const top = r.nav.push(dialog());
    r.later(1000);
    expect(root.click('grid', 2)).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'dialog', index: 0 });
    // The dialog has no onSelect: the click focuses but selects nothing.
    r.later(1000);
    expect(top.click('buttons', 1)).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'dialog', index: 1 });
    r.nav.pop();
    expect(top.click('buttons', 0)).toBe(false);
    expect(r.selected).toEqual([]);
  });

  it('selects once when the OK key comes first and the click follows (one Magic Remote press)', () => {
    const r = clicks();
    r.nav.pointer(true);
    r.nav.top.hover('grid', 2);
    expect(r.press('OK')).toEqual(['select']);
    r.later(120);
    expect(r.nav.top.click('grid', 2)).toBe(false);
    expect(r.selected).toEqual(['home grid 2']);
    // The next press is a new one.
    r.later(600);
    expect(r.press('OK')).toEqual(['select']);
    expect(r.selected).toHaveLength(2);
  });

  it('selects once when the click comes first and the OK key follows', () => {
    const r = clicks();
    expect(r.nav.top.click('grid', 2)).toBe(true);
    r.later(40);
    expect(r.press('OK')).toEqual(['duplicate']);
    expect(r.selected).toEqual(['home grid 2']);
    r.later(499);
    expect(r.press('OK')).toEqual(['select']);
    expect(r.selected).toEqual(['home grid 2', 'home grid 2']);
  });

  it('pairs within the window only, and each key with at most one click', () => {
    const r = clicks(300);
    r.press('OK');
    r.later(300);
    expect(r.nav.top.click('grid', 1)).toBe(true);
    r.later(10);
    // Two clicks in a row are two presses (the second isn't a twin of the first).
    expect(r.nav.top.click('grid', 1)).toBe(true);
    // Two OK keys in a row too.
    r.later(1000);
    expect(r.press('OK', 'OK')).toEqual(['select', 'select']);
    r.later(1);
    expect(r.nav.top.click('grid', 0)).toBe(false);
    r.later(1);
    expect(r.nav.top.click('grid', 0)).toBe(true);
    expect(r.selected).toEqual(['home list 0', 'home grid 1', 'home grid 1', 'home grid 1', 'home grid 1', 'home grid 0']);
  });

  it('drops the twin of an OK key that opened a screen, wherever it lands', () => {
    let time = 0;
    const onDialog = vi.fn();
    const r = rig({
      root: home({ onSelect: () => r.nav.push(dialog('dialog', { onSelect: onDialog })) }),
      now: () => time,
    });
    const root = r.nav.top;
    // OK opens a dialog. The click of the same press lands on the covered screen (under the
    // dialog's scrim) and selects nothing.
    expect(r.press('OK')).toEqual(['select']);
    time += 50;
    expect(root.click('list', 0)).toBe(false);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'dialog', index: 0 });
    // The twin was used up: the next click is a press of its own.
    time += 50;
    expect(r.nav.top.click('buttons', 1)).toBe(true);
    expect(onDialog).toHaveBeenCalledTimes(1);
    // Or it lands on the new screen's item, and selects nothing there either.
    r.nav.pop();
    time += 1000;
    expect(r.press('OK')).toEqual(['select']);
    time += 50;
    expect(r.nav.top.click('buttons', 1)).toBe(false);
    expect(onDialog).toHaveBeenCalledTimes(1);
    expect(r.nav.snapshot()).toMatchObject({ screen: 'dialog', index: 1, depth: 2 });
  });

  it('does not pair across a clock that went backwards', () => {
    const r = clicks();
    r.press('OK');
    r.later(-100);
    expect(r.nav.top.click('grid', 3)).toBe(true);
  });
});
