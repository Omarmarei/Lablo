import type { VNode } from 'preact';
import type { LoadedProfile, SourceRecord, UnmatchedPage, UnmatchedRequest } from '@zoma/data';
import { emptyProfile } from '@zoma/data';
import type { ItemBinding } from '@zoma/ui';
import { bindFocus, createNavigator } from '@zoma/ui';
import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import { SettingsScreen, UnmatchedItem, UnmatchedPage as Page } from './SettingsScreen';
import type { Settings } from './settings-state';
import { UNMATCHED, createUnmatchedList } from './unmatched-state';

/**
 * "Channels without a guide" as drawn (RELAY step 24c): the page in each state and a row, called
 * as functions over a real list (their components are not expanded). The e2e draws the mock's
 * one channel in English and Arabic; this covers the states and rows the mock has none of.
 */

const PANEL: SourceRecord = { id: 's1', type: 'm3u', name: 'My list', url: 'http://lists.test/a.m3u', added: 1 };

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
const byClass = (root: unknown, cls: string): VNode[] => walk(root).filter((v) => String((v.props as Props).class ?? '').split(' ').indexOf(cls) !== -1);
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
/** The text under `node`, in order. */
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/** A list over a worker that has `total` channels (`category` for each), or fails; `overrides`: the profile's mappings. */
async function draw(total: number, options: { fail?: boolean; hold?: boolean; category?: string; overrides?: Record<string, unknown> } = {}) {
  const nav = createNavigator({
    root: { id: 'guides', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 2 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  let release: () => void = () => undefined;
  const engine = {
    profile: (): Promise<LoadedProfile | null> =>
      Promise.resolve({ doc: { ...emptyProfile(), sources: [PANEL], ...(options.overrides === undefined ? {} : { epgOverrides: options.overrides }) } as LoadedProfile['doc'], newer: false, migratedFrom: null }),
    unmatched: (req: UnmatchedRequest): Promise<UnmatchedPage> => {
      if (options.fail === true) return Promise.reject(new Error('worker gone'));
      const rows = [];
      for (let i = req.offset; i < Math.min(total, req.offset + req.limit); i += 1) rows.push({ key: `k${i}`, name: `Channel ${i}`, src: 's1', category: options.category ?? 'News' });
      const page = { version: 1, count: total, offset: req.offset, rows };
      return options.hold === true ? new Promise((resolve) => (release = () => resolve(page))) : Promise.resolve(page);
    },
  };
  const list = createUnmatchedList({ nav, engine });
  list.open();
  await flush();
  const i18n = appI18n('en-US', { isolate: false });
  const binding = bindFocus(nav);
  return { nav, list, i18n, binding, release, page: (reading = 0) => Page({ i18n, binding, list, reading }) };
}

const item = (state: ItemBinding['state']): ItemBinding => ({ state, onHover: () => undefined, onPress: () => undefined });

describe('"Channels without a guide" as drawn (step 24c)', () => {
  it('draws nothing while the list is closed', async () => {
    const t = await draw(3);
    t.nav.handle('BACK');
    expect(t.page()).toBeNull();
  });

  it('spins while loading, with the title and the line on the order but no count', async () => {
    const t = await draw(3, { hold: true });
    const page = t.page();
    expect((page!.props as Props)['data-status']).toBe('loading');
    expect(textOf(byClass(page, 'settings__title'))).toBe('Channels without a guide');
    expect(textOf(byClass(page, 'guides__intro'))).toBe('No guide in your list has programmes for these live channels.');
    expect(byTestId(page, 'unmatched-spinner')).toHaveLength(1);
    expect(byTestId(page, 'unmatched-count')).toHaveLength(0);
    expect(byTestId(page, 'unmatched-list')).toHaveLength(0);
  });

  it('says when the list could not be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await draw(3, { fail: true });
    const page = t.page();
    expect(textOf(byTestId(page, 'unmatched-failed'))).toBe("Couldn't read the channels.");
    expect(byTestId(page, 'unmatched-spinner')).toHaveLength(0);
    expect(byTestId(page, 'unmatched-list')).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('says every channel has a guide when none is listed', async () => {
    const t = await draw(0);
    const page = t.page();
    expect(textOf(byTestId(page, 'unmatched-none'))).toBe('Every live channel has a guide.');
    expect(textOf(byTestId(page, 'unmatched-count'))).toBe('0 channels');
    expect(byTestId(page, 'unmatched-list')).toHaveLength(0);
  });

  it('lists the channels in a virtual list of 88 px rows, and counts them in the header', async () => {
    const t = await draw(3);
    const page = t.page();
    expect((page!.props as Props)['data-count']).toBe(3);
    expect(textOf(byTestId(page, 'unmatched-count'))).toBe('3 channels');
    const [vlist] = byTestId(page, 'unmatched-list');
    expect(vlist!.props).toMatchObject({ zone: 'channels', itemSize: UNMATCHED.rowHeight, gap: UNMATCHED.rowGap, screen: t.list.screen.value });
    expect(byTestId(page, 'unmatched-none')).toHaveLength(0);
    expect(byTestId(page, 'unmatched-spinner')).toHaveLength(0);
    // (The reading line is a component, not expanded here: it draws nothing at 0.)
    expect(byTestId(page, 'unmatched-reading').map((v) => (v.props as Props).reading)).toEqual([0]);
  });

  it('says "Reading the guides…" after the title while a mapping\'s refresh runs (step 24e)', async () => {
    const t = await draw(3);
    const page = t.page(1);
    expect((page!.props as Props)['data-reading']).toBe(1);
    const header = byClass(page, 'settings__header')[0]!;
    const children = (header.props as Props).children as unknown[];
    // The title, then the reading line (a component, not expanded here), then the count.
    expect((children[1] as VNode).props).toMatchObject({ reading: 1, testId: 'unmatched-reading' });
    expect(textOf(byTestId(page, 'unmatched-count'))).toBe('3 channels');
  });

  it('draws a row: the name and category as data, the source by its name; "Other channels" for none; empty until read', async () => {
    const t = await draw(UNMATCHED.page + 1);
    const row = UnmatchedItem({ i18n: t.i18n, list: t.list, index: 0, item: item('focused') });
    expect(row.props).toMatchObject({ 'data-testid': 'unmatched-0', 'data-key': 'k0', 'data-src': 's1', 'data-state': 'focused', 'aria-selected': 'true' });
    expect(String((row.props as Props).class).split(' ')).toEqual(['unmatched__row', 'is-focused']);
    const [name] = byClass(row, 'unmatched__name');
    expect([textOf(name), (name!.props as Props).dir, (name!.props as Props).translate]).toEqual(['Channel 0', 'auto', false]);
    expect(textOf(byClass(row, 'unmatched__where'))).toBe('From My list · News');
    expect(byClass(row, 'unmatched__category')[0]!.props).toMatchObject({ dir: 'auto', translate: false });
    // A row whose page isn't read: the box alone.
    const unread = UnmatchedItem({ i18n: t.i18n, list: t.list, index: UNMATCHED.page, item: item('idle') });
    expect(unread.props).toMatchObject({ 'data-key': '', 'data-src': '', 'aria-selected': 'false' });
    expect(byClass(unread, 'unmatched__name')).toHaveLength(0);
    expect(byClass(unread, 'unmatched__where')).toHaveLength(0);
    expect(String((UnmatchedItem({ i18n: t.i18n, list: t.list, index: 1, item: item('memory') }).props as Props).class)).toBe('unmatched__row is-memory');

    const none = await draw(2, { category: '' });
    const other = UnmatchedItem({ i18n: none.i18n, list: none.list, index: 0, item: item('idle') });
    expect(textOf(byClass(other, 'unmatched__where'))).toBe('From My list · Other channels');
    expect((byClass(other, 'unmatched__category')[0]!.props as Props).translate).toBeUndefined();
    expect((row.props as Props)['data-off']).toBe('false');
    expect(byClass(row, 'unmatched__off')).toHaveLength(0);
  });

  it('marks a channel the profile maps to no guide, and only that one (step 24e)', async () => {
    const t = await draw(3, { overrides: { k1: { epgSrc: '', channel: null }, k2: { epgSrc: 's1:xmltv', channel: 'zoma.kids' } } });
    const off = UnmatchedItem({ i18n: t.i18n, list: t.list, index: 1, item: item('idle') });
    expect((off.props as Props)['data-off']).toBe('true');
    expect(textOf(byClass(off, 'unmatched__where'))).toBe('From My list · News · No guide, set by you');
    expect(byTestId(off, 'unmatched-1-off')).toHaveLength(1);
    for (const index of [0, 2]) {
      const other = UnmatchedItem({ i18n: t.i18n, list: t.list, index, item: item('idle') });
      expect((other.props as Props)['data-off'], String(index)).toBe('false');
      expect(textOf(byClass(other, 'unmatched__where'))).toBe('From My list · News');
    }
  });

  it("counts the list's reads in the settings screens' data-pending, with the guides screen's and the mapping's", async () => {
    const t = await draw(3, { hold: true });
    expect(t.list.pending.value).toBe(1);
    const mapping = { pending: signal(4), reading: signal(1), editor: { editing: signal<string | null>(null) } };
    const settings = { guides: { pending: signal(2), editor: { editing: signal<string | null>(null) } }, unmatched: t.list, mapping } as unknown as Settings;
    const draw2 = () => SettingsScreen({ settings, i18n: t.i18n, binding: t.binding, focus: t.nav.snapshot() });
    let root = draw2();
    expect((root.props as Props)['data-pending']).toBe(7);
    expect((root.props as Props)['data-screen']).toBe('unmatched');
    expect((root.props as Props)['data-editing']).toBe('');
    // The list's page gets the mapping's reading count.
    const [page] = walk(root).filter((v) => v.type === Page);
    expect((page!.props as Props).reading).toBe(1);
    // The picker's search field being edited shows as the guides' link does.
    mapping.editor.editing.value = 'mapping-search';
    root = draw2();
    expect((root.props as Props)['data-editing']).toBe('mapping-search');
  });
});
