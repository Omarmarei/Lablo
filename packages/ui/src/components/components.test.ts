import fc from 'fast-check';
import { h } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { LAYOUT, fits } from '../design/tokens';
import type { ItemBinding } from '../focus/binding';
import { bindFocus } from '../focus/binding';
import type { ScreenSpec } from '../focus/navigator';
import { createNavigator } from '../focus/navigator';
import { Badge } from './Badge';
import { Button } from './Button';
import { Chip } from './Chip';
import { Dialog } from './Dialog';
import { ListRow } from './ListRow';
import { ProgressBar } from './ProgressBar';
import { Spinner } from './Spinner';
import { TextField } from './TextField';
import { Tile } from './Tile';
import { VirtualList, listHeight, listWindow } from './VirtualList';
import { focusClass, percent } from './focusable';
import type { El } from './vnode.test-helpers';
import { all, byClass, expand, one, text } from './vnode.test-helpers';

describe('focusClass and percent', () => {
  it('adds the focus classes', () => {
    expect(focusClass('z-x', 'focused')).toBe('z-x is-focused');
    expect(focusClass('z-x', 'memory')).toBe('z-x is-memory');
    expect(focusClass('z-x', 'idle')).toBe('z-x');
    expect(focusClass('z-x', undefined)).toBe('z-x');
  });

  it.each([
    [0.4, 40],
    [0.12345, 12.3],
    [1, 100],
    [1.5, 100],
    [-0.2, 0],
    [Number.NaN, 0],
    [0, 0],
  ])('%s -> %s%%', (fraction, pct) => {
    expect(percent(fraction)).toBe(pct);
  });
});

describe('Button', () => {
  it('shows its label, variant and focus, and hands the pointer over', () => {
    const onHover = vi.fn();
    const onPress = vi.fn();
    const el = expand(Button({ label: 'Play', variant: 'primary', state: 'focused', onHover, onPress, testId: 'b' }));
    expect(el.props).toMatchObject({ class: 'z-button z-button--primary is-focused', role: 'button', 'data-testid': 'b', 'data-state': 'focused' });
    expect(text(el)).toBe('Play');
    expect(el.props.onMouseMove).toBe(onHover);
    expect(el.props.onClick).toBe(onPress);
    expect(byClass(el, 'z-button__icon')).toHaveLength(0);
    expect(one(el, 'z-button__label').props).toMatchObject({ lang: undefined, translate: undefined });
  });

  it('marks a label in another language: its lang, never translated', () => {
    const el = expand(Button({ label: 'English', lang: 'en' }));
    expect(text(el)).toBe('English');
    expect(one(el, 'z-button__label').props).toMatchObject({ lang: 'en', translate: false });
  });

  it('defaults to secondary and idle, and draws an icon before the label', () => {
    const el = expand(Button({ label: 'More', icon: h('svg', null) }));
    expect(el.props.class).toBe('z-button z-button--secondary');
    expect(el.props['data-state']).toBe('idle');
    expect(el.children.map((c) => (typeof c === 'string' ? c : c.props.class))).toEqual(['z-button__icon', 'z-button__label']);
  });

  it('can be disabled: dimmed, focusable, not clickable', () => {
    const el = expand(Button({ label: 'Delete', variant: 'danger', disabled: true, state: 'memory', onPress: vi.fn(), onHover: vi.fn() }));
    expect(el.props.class).toBe('z-button z-button--danger is-disabled is-memory');
    expect(el.props['aria-disabled']).toBe('true');
    expect(el.props.onClick).toBeUndefined();
    expect(el.props.onMouseMove).toBeDefined();
  });
});

describe('Chip', () => {
  it('marks the selected category apart from the focus', () => {
    const el = expand(Chip({ label: 'Sports', selected: true, count: 42, state: 'memory' }));
    expect(el.props).toMatchObject({ class: 'z-chip is-selected is-memory', 'aria-selected': 'true' });
    expect(text(one(el, 'z-chip__count'))).toBe('42');
    // Our own label: no direction of its own, translatable.
    expect(one(el, 'z-chip__label').props).toMatchObject({ dir: undefined, translate: undefined });
  });

  it('gives a provider’s category name its own direction and keeps it out of translation', () => {
    const el = expand(Chip({ label: 'رياضة', data: true }));
    expect(el.props).toMatchObject({ class: 'z-chip', 'aria-selected': 'false' });
    expect(one(el, 'z-chip__label').props).toMatchObject({ dir: 'auto', translate: false });
    expect(byClass(el, 'z-chip__count')).toHaveLength(0);
  });
});

describe('ListRow', () => {
  const now = { title: 'Morning News', time: '08:00', progress: 0.25 };
  const next = { title: 'Weather', time: '09:00' };

  it('shows number, name, badges, now with its progress and next', () => {
    const el = expand(
      ListRow({ number: 101, name: 'Zoma News', now, next, nextLabel: 'Next', badges: Badge({ label: 'HD' }), state: 'focused' }),
    );
    expect(el.props).toMatchObject({ class: 'z-row is-focused', 'aria-selected': 'true' });
    expect(text(one(el, 'z-row__number'))).toBe('101');
    expect(text(one(el, 'z-row__name'))).toBe('Zoma News');
    expect(text(one(el, 'z-row__badges'))).toBe('HD');
    expect(text(one(el, 'z-row__time'))).toBe('08:00');
    expect(one(one(el, 'z-row__progress'), 'z-progress__fill').props.style).toEqual({ width: '25%' });
    expect(text(one(el, 'z-row__next'))).toBe('Next · 09:00Weather');
    expect(byClass(el, 'z-row__title').map(text)).toEqual(['Morning News', 'Weather']);
  });

  it('keeps the provider’s text in its own direction and out of translation', () => {
    const el = expand(ListRow({ name: 'قناة زوما', now, next, nextLabel: 'Next' }));
    for (const cls of ['z-row__name', 'z-row__title']) {
      for (const e of byClass(el, cls)) expect(e.props).toMatchObject({ dir: 'auto', translate: false });
    }
    // Our own words are translatable.
    expect(one(el, 'z-row__next-head').props.translate).toBeUndefined();
  });

  it('leaves out what it isn’t given, and shows the placeholder without a guide', () => {
    const el = expand(ListRow({ name: 'Zoma 1', next, placeholder: 'No guide' }));
    expect(el.props).toMatchObject({ class: 'z-row', 'aria-selected': 'false', 'data-state': 'idle' });
    for (const cls of ['z-row__number', 'z-row__badges', 'z-row__progress', 'z-row__time', 'z-row__next']) {
      expect(byClass(el, cls), cls).toHaveLength(0);
    }
    expect(text(one(el, 'z-row__now'))).toBe('No guide');
    const bare = expand(ListRow({ name: 'Zoma 2', now: { title: 'Film' } }));
    expect(text(one(bare, 'z-row__now'))).toBe('Film');
    expect(byClass(expand(ListRow({ name: 'Zoma 3' })), 'z-row__now')).toHaveLength(0);
  });
});

describe('Tile', () => {
  it('shows title, subtitle, badge, image and progress', () => {
    const el = expand(
      Tile({ title: 'Film', subtitle: '2024', image: 'poster.jpg', progress: 0.5, badge: Badge({ label: 'NEW', tone: 'accent' }), class: 'tone-2', state: 'focused' }),
    );
    expect(el.props.class).toBe('z-tile tone-2 is-focused');
    expect(one(el, 'z-tile__image').props).toMatchObject({ src: 'poster.jpg', alt: '' });
    expect(text(one(el, 'z-tile__badge'))).toBe('NEW');
    expect(one(el, 'z-tile__title').props).toMatchObject({ dir: 'auto', translate: false });
    expect(text(one(el, 'z-tile__subtitle'))).toBe('2024');
    expect(one(one(el, 'z-tile__progress'), 'z-progress__fill').props.style).toEqual({ width: '50%' });
  });

  it('is only a caption without the extras', () => {
    const el = expand(Tile({ title: 'Channel' }));
    expect(el.props.class).toBe('z-tile');
    expect(all(el).map((e) => e.props.class)).toEqual(['z-tile', 'z-tile__caption', 'z-tile__title']);
  });
});

describe('ProgressBar', () => {
  it('fills from the inline start, and runs left to right when it is a media timeline', () => {
    const plain = expand(ProgressBar({ value: 0.333, label: 'Loaded' }));
    expect(plain.props).toMatchObject({ class: 'z-progress z-progress--m', dir: undefined, 'aria-valuenow': 33.3, 'aria-label': 'Loaded' });
    expect(plain.children).toHaveLength(1);
    const media = expand(ProgressBar({ value: 2, media: true, size: 's', class: 'x' }));
    expect(media.props).toMatchObject({ class: 'z-progress z-progress--s x', dir: 'ltr', 'aria-valuenow': 100 });
    expect((media.children[0] as El).props.style).toEqual({ width: '100%' });
  });
});

describe('Dialog, Spinner and Badge', () => {
  it('renders a dialog with its actions', () => {
    const el = expand(Dialog({ title: 'Exit Zoma?', message: 'See you soon', children: [Button({ label: 'Stay' }), Button({ label: 'Exit' })] }));
    expect(el.props).toMatchObject({ role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Exit Zoma?' });
    expect(text(one(el, 'z-dialog__title'))).toBe('Exit Zoma?');
    expect(text(one(el, 'z-dialog__message'))).toBe('See you soon');
    expect(byClass(one(el, 'z-dialog__actions'), 'z-button').map(text)).toEqual(['Stay', 'Exit']);
    expect(byClass(expand(Dialog({ title: 'T', children: null })), 'z-dialog__message')).toHaveLength(0);
  });

  it('sizes the spinner and tones the badge', () => {
    expect(expand(Spinner({ size: 'l', label: 'Loading' })).props).toMatchObject({ class: 'z-spinner z-spinner--l', role: 'status', 'aria-label': 'Loading' });
    expect(expand(Spinner({})).props.class).toBe('z-spinner z-spinner--m');
    expect(expand(Badge({ label: 'LIVE', tone: 'live' })).props.class).toBe('z-badge z-badge--live');
    expect(expand(Badge({ label: 'HD' })).props).toMatchObject({ class: 'z-badge z-badge--neutral', translate: undefined });
    // A technical mark is the same in every language.
    expect(expand(Badge({ label: '4K', tone: 'outline', data: true })).props.translate).toBe(false);
  });
});

describe('listWindow and listHeight', () => {
  it.each([
    [0, 100, 7, 0, 7],
    [93, 100, 7, 93, 100],
    [98, 100, 7, 98, 100],
    [0, 3, 7, 0, 3],
    [0, 0, 7, 0, 0],
    [-2, 10, 4, 0, 4],
    [12, 10, 4, 10, 10],
    [2.7, 10, 4.9, 2, 6],
  ])('top %s of %s, %s visible -> [%s, %s)', (top, count, visible, from, to) => {
    expect(listWindow(top, count, visible)).toEqual({ from, to });
  });

  it('gives the height that fits() turns back into the same window', () => {
    expect(listHeight(7, 88, 8)).toBe(664);
    expect(listHeight(0, 88, 8)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 200 }), fc.integer({ min: 0, max: 32 }), (visible, row, gap) => {
        expect(fits(listHeight(visible, row, gap), row, gap)).toBe(visible);
      }),
    );
  });
});

describe('VirtualList', () => {
  const VISIBLE = fits(664, LAYOUT.rowHeight, 8);
  const spec: ScreenSpec = {
    id: 'browse',
    zones: [
      { kind: 'list', id: 'rail', axis: 'horizontal', count: 3, neighbours: { down: 'channels' } },
      { kind: 'list', id: 'channels', axis: 'vertical', count: 240, visible: VISIBLE, neighbours: { up: 'rail' } },
    ],
    initial: 'channels',
  };

  function setup(selected: string[] = []) {
    const nav = createNavigator({
      root: { ...spec, onSelect: (f) => selected.push(`${f.zone} ${f.index}`) },
      rootBack: 'exit-dialog',
      exit: () => undefined,
      exitDialog: () => undefined,
    });
    const binding = bindFocus(nav);
    const seen: Array<[number, ItemBinding]> = [];
    const render = (gap = 8): El =>
      expand(
        VirtualList({
          binding,
          screen: nav.top,
          zone: 'channels',
          gap,
          testId: 'list',
          renderItem: (i, item) => {
            seen.push([i, item]);
            return h('div', { class: 'row', 'data-state': item.state }, `Channel ${i + 1}`);
          },
        }),
      );
    return { nav, binding, render, seen, selected };
  }

  it('draws only the window, in rows of the layout height', () => {
    expect(VISIBLE).toBe(7);
    const { render } = setup();
    const el = render();
    expect(el.props).toMatchObject({ class: 'z-vlist z-vlist--vertical', role: 'listbox', 'aria-orientation': 'vertical', 'data-top': 0, 'data-count': 240, 'data-testid': 'list' });
    expect(el.props.style).toEqual({ height: '664px', '--z-vlist-gap': '8px' });
    const rows = byClass(el, 'z-vlist__item');
    expect(rows.map((r) => r.key)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows.map((r) => r.props.style)).toEqual(Array.from({ length: 7 }, () => ({ height: '88px' })));
    expect(byClass(el, 'row').map((r) => r.props['data-state'])).toEqual(['focused', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle']);
  });

  it('follows ZonePosition.top as the focus moves, keyed by index', () => {
    const { nav, render } = setup();
    for (let i = 0; i < 9; i += 1) nav.handle('DOWN');
    let el = render();
    expect(el.props['data-top']).toBe(3);
    expect(byClass(el, 'z-vlist__item').map((r) => r.key)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(byClass(el, 'row').map(text)).toEqual(['Channel 4', 'Channel 5', 'Channel 6', 'Channel 7', 'Channel 8', 'Channel 9', 'Channel 10']);
    expect(byClass(el, 'z-vlist__item').map((r) => r.props['data-index'])).toEqual([3, 4, 5, 6, 7, 8, 9]);
    // Paging to the end: the last window is full.
    for (let i = 0; i < 40; i += 1) nav.handle('CH_DOWN');
    el = render();
    expect(byClass(el, 'z-vlist__item').map((r) => r.key)).toEqual([233, 234, 235, 236, 237, 238, 239]);
    expect(byClass(el, 'row').map((r) => r.props['data-state'])).toEqual(['idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'focused']);
    // Leaving the list for the rail: the remembered row shows as memory, the window stays.
    nav.top.focus('rail', 1);
    el = render();
    expect(nav.snapshot().zone).toBe('rail');
    expect(el.props['data-top']).toBe(233);
    expect(byClass(el, 'row').map((r) => r.props['data-state'])).toEqual(['idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'memory']);
  });

  it('hands each row its item binding: hover and click go to the zone', () => {
    const selected: string[] = [];
    const { nav, render, seen } = setup(selected);
    render();
    nav.pointer(true);
    seen[4]![1].onHover();
    expect(nav.snapshot()).toMatchObject({ zone: 'channels', index: 4 });
    seen[5]![1].onPress();
    expect(selected).toEqual(['channels 5']);
    expect(seen.map(([i]) => i)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps the height of a full window when the list is shorter, and draws nothing when empty', () => {
    const { nav, render } = setup();
    nav.top.update({ kind: 'list', id: 'channels', axis: 'vertical', count: 3, visible: VISIBLE, neighbours: { up: 'rail' } });
    let el = render(0);
    expect(byClass(el, 'z-vlist__item')).toHaveLength(3);
    expect(el.props.style).toEqual({ height: `${7 * LAYOUT.rowHeight}px`, '--z-vlist-gap': '0px' });
    nav.top.update({ kind: 'list', id: 'channels', axis: 'vertical', count: 0, visible: VISIBLE });
    el = render();
    expect(el.props['data-count']).toBe(0);
    expect(byClass(el, 'z-vlist__item')).toHaveLength(0);
  });

  it('draws every row of a zone without a window', () => {
    const { nav, binding } = setup();
    nav.top.update({ kind: 'list', id: 'channels', axis: 'vertical', count: 3 });
    const el = expand(VirtualList({ binding, screen: nav.top, zone: 'channels', renderItem: (i) => h('div', null, String(i)) }));
    expect(byClass(el, 'z-vlist__item')).toHaveLength(3);
    expect(el.props.style).toEqual({ height: `${3 * LAYOUT.rowHeight}px`, '--z-vlist-gap': '0px' });
  });

  it('draws a horizontal window (a rail) of fixed-width items', () => {
    const { nav, binding } = setup();
    nav.top.update({ kind: 'list', id: 'rail', axis: 'horizontal', count: 12, visible: 5, neighbours: { down: 'channels' } });
    nav.top.focus('rail', 7);
    const el = expand(
      VirtualList({ binding, screen: nav.top, zone: 'rail', itemSize: 240, gap: 8, renderItem: (i, item) => h('div', { class: 'chip', 'data-state': item.state }, String(i)) }),
    );
    expect(el.props).toMatchObject({ class: 'z-vlist z-vlist--horizontal', 'aria-orientation': 'horizontal', 'data-top': 3 });
    expect(el.props.style).toEqual({ width: `${5 * 240 + 4 * 8}px`, '--z-vlist-gap': '8px' });
    expect(byClass(el, 'z-vlist__item').map((i) => [i.key, i.props.style])).toEqual([3, 4, 5, 6, 7].map((i) => [i, { width: '240px' }]));
    expect(byClass(el, 'chip').map((c) => c.props['data-state'])).toEqual(['idle', 'idle', 'idle', 'idle', 'focused']);
  });

  it('refuses a zone that is not a list, and a horizontal list without an item size', () => {
    const { nav, binding } = setup();
    expect(() => VirtualList({ binding, screen: nav.top, zone: 'rail', renderItem: () => h('div', null) })).toThrow(/needs an itemSize/);
    const grid = createNavigator({
      root: { id: 'g', zones: [{ kind: 'grid', id: 'tiles', columns: 3, count: 6 }] },
      rootBack: 'exit-dialog',
      exit: () => undefined,
      exitDialog: () => undefined,
    });
    expect(() => VirtualList({ binding: bindFocus(grid), screen: grid.top, zone: 'tiles', renderItem: () => h('div', null) })).toThrow(/not a list/);
  });
});

describe('TextField (RELAY step 13a)', () => {
  const edit = (editing: boolean) => ({
    editing,
    onEditKey: vi.fn(),
    onEditInput: vi.fn(),
    onEditFocus: vi.fn(),
    onEditBlur: vi.fn(),
  });

  it('shows the label, the value in a native input, the hint, and the focus', () => {
    const onHover = vi.fn();
    const onPress = vi.fn();
    const el = expand(TextField({ id: 'f-user', label: 'Username', value: 'omar', hint: 'From your provider', state: 'focused', onHover, onPress, testId: 'field-user' }));
    expect(el.props).toMatchObject({ class: 'z-field is-focused', 'data-testid': 'field-user', 'data-state': 'focused', 'data-editing': 'false' });
    expect(el.props.onMouseMove).toBe(onHover);
    expect(el.props.onClick).toBe(onPress);
    expect(one(el, 'z-field__label').props).toMatchObject({ for: 'f-user' });
    expect(text(one(el, 'z-field__label'))).toBe('Username');
    const input = one(el, 'z-field__input');
    expect(input.tag).toBe('input');
    // Out of Tab, no browser help with the text: the focus engine and the TV keyboard decide.
    expect(input.props).toMatchObject({ id: 'f-user', type: 'text', value: 'omar', dir: 'auto', tabIndex: -1, spellcheck: false, autocomplete: 'off', autocapitalize: 'off', 'aria-describedby': 'f-user-note' });
    expect(input.props['aria-invalid']).toBeUndefined();
    expect(text(one(el, 'z-field__note'))).toBe('From your provider');
    expect(one(el, 'z-field__note').props).toMatchObject({ id: 'f-user-note', role: undefined });
  });

  it('links and passwords read left to right; a name follows its own text', () => {
    const at = (kind: 'text' | 'url' | 'password', dir?: 'ltr' | 'auto') => one(expand(TextField({ id: 'f', label: 'L', value: '', kind, dir })), 'z-field__input').props;
    expect(at('url')).toMatchObject({ type: 'url', dir: 'ltr' });
    expect(at('password')).toMatchObject({ type: 'password', dir: 'ltr' });
    expect(at('text')).toMatchObject({ type: 'text', dir: 'auto' });
    expect(at('text', 'ltr')).toMatchObject({ dir: 'ltr' });
  });

  it('an error replaces the hint, marks the field and is announced', () => {
    const el = expand(TextField({ id: 'f', label: 'Server', value: 'x y', hint: 'Starts with http://', error: 'No spaces' }));
    expect(el.props.class).toBe('z-field is-invalid');
    expect(text(one(el, 'z-field__note'))).toBe('No spaces');
    expect(one(el, 'z-field__note').props.role).toBe('alert');
    expect(one(el, 'z-field__input').props['aria-invalid']).toBe('true');
    // An empty or null error is no error.
    for (const error of ['', null]) {
      const ok = expand(TextField({ id: 'f', label: 'Server', value: '', hint: 'Hint', error }));
      expect(ok.props.class).toBe('z-field');
      expect(text(one(ok, 'z-field__note'))).toBe('Hint');
    }
  });

  it('keeps the note line when there is nothing to say (an error appearing moves nothing)', () => {
    const el = expand(TextField({ id: 'f', label: 'Name', value: '' }));
    expect(one(el, 'z-field__note').children).toEqual([]);
  });

  it("hands the input's events to the editor, and each change to onValue", () => {
    const handlers = edit(true);
    const onValue = vi.fn();
    const el = expand(TextField({ id: 'f', label: 'L', value: 'a', edit: handlers, onValue }));
    expect(el.props.class).toBe('z-field is-editing');
    expect(el.props['data-editing']).toBe('true');
    const input = one(el, 'z-field__input').props;
    expect(input.onKeyDown).toBe(handlers.onEditKey);
    expect(input.onFocus).toBe(handlers.onEditFocus);
    expect(input.onBlur).toBe(handlers.onEditBlur);
    (input.onInput as (e: { currentTarget: { value: string } }) => void)({ currentTarget: { value: 'ab' } });
    expect(handlers.onEditInput).toHaveBeenCalledOnce();
    expect(onValue).toHaveBeenCalledWith('ab');
  });

  it('works without an editor (no handlers, never editing)', () => {
    const el = expand(TextField({ id: 'f', label: 'L', value: '', edit: edit(false) }));
    expect(el.props['data-editing']).toBe('false');
    const bare = one(expand(TextField({ id: 'f', label: 'L', value: '' })), 'z-field__input').props;
    expect(bare.onKeyDown).toBeUndefined();
    expect(() => (bare.onInput as (e: { currentTarget: { value: string } }) => void)({ currentTarget: { value: 'x' } })).not.toThrow();
  });
});
