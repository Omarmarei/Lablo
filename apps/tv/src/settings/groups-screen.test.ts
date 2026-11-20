import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import { stripIsolates } from '@lablo/core';
import type { CatalogItem } from '@lablo/core';
import type { EditorBinding, ItemBinding } from '@lablo/ui';
import { Button, Dialog, TextField } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { ChannelRow, GroupMenu, GroupRow, Groups } from './groups-state';
import { ChannelItem, DeleteView, GroupItem, GroupMenuView, RenameView, actionLabels, rowLine, rowName } from './GroupsPage';
import { itemText } from './SettingsScreen';

/**
 * Settings › "Channel groups" (RELAY step 35d) as drawn: the rows, a list's channels, the menus,
 * the rename form and the delete question, called as functions (their components are not
 * expanded). The e2e drives the screens in the app.
 */

type Props = Record<string, unknown> & { children?: unknown };

/** Every element under `node` (components not expanded), depth first. */
function walk(node: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return out;
  const v = node as VNode;
  out.push(v);
  walk((v.props as Props).children, out);
  return out;
}
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
/** The text under `node`, in order (components' own props not read). */
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const xa = appI18n('en-XA', { isolate: false });
const focused: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };
const memory: ItemBinding = { state: 'memory', onHover: () => undefined, onPress: () => undefined };

const LIST: GroupRow = { kind: 'list', list: { id: 'l1', name: 'Sport', keys: ['a', 'b'] } };
const UNNAMED: GroupRow = { kind: 'list', list: { id: 'l2', name: null, keys: ['a'] } };
const NEWS: GroupRow = { kind: 'group', group: { src: 's1', name: 'News' }, count: 12, hidden: false, source: '' };
const HIDDEN: GroupRow = { kind: 'group', group: { src: 's2', name: 'رياضة' }, count: 1, hidden: true, source: 'My panel' };
const NO_NAME: GroupRow = { kind: 'group', group: { src: 's1', name: '' }, count: 2, hidden: false, source: '' };

function channel(name: string): CatalogItem {
  return { key: 'a', src: 's1', kind: 'live', name, normName: '', group: '', url: 'http://x.test/a.ts', logo: null, epgId: null, tvgName: null, matchName: null, chno: null, tvgShift: 0, catchup: null, radio: false, hints: null };
}

describe('the settings row (RELAY step 35d)', () => {
  it('names "Channel groups", last', () => {
    expect(itemText(en.t, 'groups')).toEqual({ name: 'Channel groups', hint: 'Your favourites lists, and which groups show and in what order' });
    expect(itemText(ar.t, 'groups')).toEqual({ name: 'مجموعات القنوات', hint: 'قوائم مفضلتك، والمجموعات التي تظهر وترتيبها' });
  });
});

describe('a row’s words', () => {
  it('names a list by its name, else "Favourites"; a group by its name, else "Other channels"', () => {
    expect(rowName(en, LIST)).toEqual({ text: 'Sport', own: true });
    expect(rowName(en, UNNAMED)).toEqual({ text: 'Favourites', own: false });
    expect(rowName(ar, UNNAMED)).toEqual({ text: 'المفضلة', own: false });
    expect(rowName(en, NEWS)).toEqual({ text: 'News', own: true });
    expect(rowName(en, NO_NAME)).toEqual({ text: 'Other channels', own: false });
    expect(rowName(ar, NO_NAME)).toEqual({ text: 'قنوات أخرى', own: false });
  });

  it('says a list’s kind and size; a group’s size, and "Hidden" and its source when there are two', () => {
    expect(rowLine(en, LIST)).toBe('Favourites list · 2 channels');
    expect(rowLine(en, UNNAMED)).toBe('Favourites list · 1 channel');
    expect(rowLine(en, NEWS)).toBe('12 channels');
    expect(rowLine(en, HIDDEN)).toBe('Hidden · From My panel · 1 channel');
    expect(stripIsolates(rowLine(ar, HIDDEN))).toBe('مخفية · من My panel · قناة واحدة');
    expect(stripIsolates(rowLine(ar, LIST))).toBe('قائمة مفضلة · قناتان');
  });

  it('gives each action its words', () => {
    expect(actionLabels(en.t)).toEqual({ channels: 'Channels', move: 'Move', rename: 'Rename', delete: 'Delete', hide: 'Hide', show: 'Show', remove: 'Remove', cancel: 'Cancel' });
    expect(actionLabels(ar.t)).toEqual({ channels: 'القنوات', move: 'نقل', rename: 'إعادة التسمية', delete: 'حذف', hide: 'إخفاء', show: 'إظهار', remove: 'إزالة', cancel: 'إلغاء' });
  });
});

describe('a row as drawn', () => {
  it('draws a list with its star and its name as data, focused', () => {
    const root = GroupItem({ i18n: en, row: LIST, index: 0, moving: false, item: focused });
    const props = root.props as Props;
    expect(props).toMatchObject({ class: 'groups__row groups__row--list is-focused', 'data-testid': 'group-0', 'data-kind': 'list', 'data-id': 'l1', 'data-hidden': '', 'data-moving': 'false', 'data-state': 'focused', role: 'option', 'aria-selected': 'true' });
    expect(walk(root).some((v) => (v.props as Props).class === 'groups__star')).toBe(true);
    expect(walk(root).some((v) => (v.props as Props).class === 'groups__moving')).toBe(false);
    expect(textOf(byTestId(root, 'group-0-line'))).toBe('Favourites list · 2 channels');
  });

  it('marks a hidden group, a moving row, and the focus’s memory', () => {
    const root = GroupItem({ i18n: en, row: HIDDEN, index: 3, moving: true, item: memory });
    expect(root.props as Props).toMatchObject({ class: 'groups__row groups__row--group is-hidden is-memory is-moving', 'data-kind': 'group', 'data-id': 'رياضة', 'data-hidden': 'true', 'data-moving': 'true', 'aria-selected': 'false' });
    expect(walk(root).some((v) => (v.props as Props).class === 'groups__star')).toBe(false);
    // A moving row has the arrows at its end.
    expect(walk(root).some((v) => (v.props as Props).class === 'groups__moving')).toBe(true);
    const shown = GroupItem({ i18n: en, row: NEWS, index: 2, moving: false, item: idle });
    expect((shown.props as Props).class).toBe('groups__row groups__row--group');
    expect((shown.props as Props)['data-hidden']).toBe('false');
  });

  it('keeps the catalog’s names translatable and the user’s and provider’s as data', () => {
    // (`Name` is a component: its props carry the words and whether they are data.)
    const own = byTestId(GroupItem({ i18n: en, row: LIST, index: 0, moving: false, item: idle }), 'group-0-name')[0]!.props as Props;
    expect(own).toMatchObject({ text: 'Sport', own: true });
    const catalog = byTestId(GroupItem({ i18n: en, row: UNNAMED, index: 0, moving: false, item: idle }), 'group-0-name')[0]!.props as Props;
    expect(catalog).toMatchObject({ text: 'Favourites', own: false });
    const group = byTestId(GroupItem({ i18n: en, row: NO_NAME, index: 0, moving: false, item: idle }), 'group-0-name')[0]!.props as Props;
    expect(group).toMatchObject({ text: 'Other channels', own: false });
  });

  it('draws a list’s channel with its number, and a missing one with its line', () => {
    const found: ChannelRow = { key: 'a', item: channel('Alpha'), name: 'Alpha' };
    const root = ChannelItem({ i18n: en, row: found, index: 1, moving: false, item: focused });
    expect(root.props as Props).toMatchObject({ class: 'groups__row is-focused', 'data-testid': 'group-channel-1', 'data-key': 'a', 'data-found': 'true', 'data-moving': 'false' });
    expect(walk(root).filter((v) => (v.props as Props).class === 'groups__number').map(textOf)).toEqual(['2']);
    expect(byTestId(root, 'group-channel-1-missing')).toEqual([]);
    expect(walk(root).some((v) => (v.props as Props).class === 'groups__moving')).toBe(false);
    const gone = ChannelItem({ i18n: ar, row: { key: 'd', item: null, name: 'delta one' }, index: 0, moving: true, item: idle });
    expect(gone.props as Props).toMatchObject({ class: 'groups__row is-moving', 'data-found': 'false', 'data-moving': 'true' });
    expect(textOf(byTestId(gone, 'group-channel-0-missing'))).toBe('ليست في مصادرك الآن');
    expect(walk(gone).some((v) => (v.props as Props).class === 'groups__moving')).toBe(true);
    expect(walk(gone).filter((v) => (v.props as Props).class === 'groups__number').map(textOf)).toEqual([ar.number(1)]);
  });
});

describe('the menus, the rename form and the delete question as drawn', () => {
  it('titles a row’s menu with its name, data when it is the user’s or the provider’s; Delete and Remove in the danger colour', () => {
    const menu: GroupMenu = { actions: ['channels', 'move', 'rename', 'delete', 'cancel'], row: LIST, channel: null };
    const states = [idle, focused, idle, idle, idle];
    const root = GroupMenuView({ i18n: en, menu, item: (i) => states[i]! });
    expect(root.type).toBe(Dialog);
    expect(root.props as Props).toMatchObject({ title: 'Sport', data: true, testId: 'group-menu' });
    const buttons = walk(root).filter((v) => v.type === Button);
    expect(buttons.map((b) => [(b.props as Props).label, (b.props as Props).variant, (b.props as Props).testId, (b.props as Props).state])).toEqual([
      ['Channels', 'secondary', 'group-menu-channels', 'idle'],
      ['Move', 'secondary', 'group-menu-move', 'focused'],
      ['Rename', 'secondary', 'group-menu-rename', 'idle'],
      ['Delete', 'danger', 'group-menu-delete', 'idle'],
      ['Cancel', 'secondary', 'group-menu-cancel', 'idle'],
    ]);
    expect((GroupMenuView({ i18n: en, menu: { actions: ['hide', 'cancel'], row: NO_NAME, channel: null }, item: () => idle }).props as Props)).toMatchObject({ title: 'Other channels', data: false });
    const channelMenu = GroupMenuView({ i18n: en, menu: { actions: ['move', 'remove', 'cancel'], row: null, channel: { key: 'a', item: null, name: 'delta one' } }, item: () => idle });
    expect(channelMenu.props as Props).toMatchObject({ title: 'delta one', data: true });
    expect(walk(channelMenu).filter((v) => v.type === Button).map((b) => (b.props as Props).variant)).toEqual(['secondary', 'danger', 'secondary']);
  });

  it('draws the rename form: the name with "Favourites" for empty, at most 40 characters, then Save and Cancel', () => {
    const typed: string[] = [];
    const groups = { text: signal('Sport'), editor: { field: () => ({ editing: false }) } as unknown as EditorBinding, setText: (v: string) => typed.push(v) } as unknown as Groups;
    const states = [idle, focused];
    const root = RenameView({ i18n: en, groups, field: idle, action: (i) => states[i]! });
    expect(root.props as Props).toMatchObject({ title: 'Rename the list', testId: 'group-rename' });
    const field = walk(root).find((v) => v.type === TextField)!;
    expect(field.props as Props).toMatchObject({ id: 'group-name', label: 'Name (optional)', value: 'Sport', hint: 'Leave it empty to call it Favourites', maxLength: 40, testId: 'group-rename-name' });
    ((field.props as Props).onValue as (v: string) => void)('News');
    expect(typed).toEqual(['News']);
    expect(walk(root).filter((v) => v.type === Button).map((b) => [(b.props as Props).label, (b.props as Props).variant, (b.props as Props).state])).toEqual([
      ['Save', 'primary', 'idle'],
      ['Cancel', undefined, 'focused'],
    ]);
  });

  it('asks before deleting, naming the list: Delete first, Cancel second', () => {
    const states = [idle, focused];
    const root = DeleteView({ i18n: en, name: 'Sport', item: (i) => states[i]! });
    expect(root.props as Props).toMatchObject({ title: 'Delete this list?', message: 'Sport is deleted. Its channels stay in their groups and in your other lists.', testId: 'group-delete' });
    expect(walk(root).filter((v) => v.type === Button).map((b) => [(b.props as Props).label, (b.props as Props).variant, (b.props as Props).testId, (b.props as Props).state])).toEqual([
      ['Delete', 'danger', 'group-delete-yes', 'idle'],
      ['Cancel', undefined, 'group-delete-no', 'focused'],
    ]);
    expect(stripIsolates((DeleteView({ i18n: ar, name: 'رياضة', item: () => idle }).props as Props).message as string)).toBe('تُحذف قائمة رياضة. تبقى قنواتها في مجموعاتها وفي قوائمك الأخرى.');
  });

  it('has every word in the pseudo-locale, the data untouched', () => {
    expect(rowName(xa, UNNAMED).text).not.toBe('Favourites');
    expect(rowName(xa, LIST).text).toBe('Sport');
    expect(rowLine(xa, NEWS)).not.toBe('12 channels');
  });
});
