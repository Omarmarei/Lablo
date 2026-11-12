import type { VNode } from 'preact';
import type { CatalogItem, ContentKind, SearchHit, SearchResult } from '@lablo/core';
import type { ItemRef, LoadedProfile, SearchRequest } from '@lablo/data';
import { emptyProfile } from '@lablo/data';
import type { Focus, ItemBinding } from '@lablo/ui';
import { bindFocus, createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import { SEARCH, createSearch } from './search-state';
import { SearchRow, SearchScreen, countText, groupText, kindText, searchHint } from './SearchScreen';

/**
 * The search screen as drawn (RELAY step 28a): the page in each state and its rows, called as
 * functions over a real search (their components are not expanded). The e2e draws the mock's
 * catalog in English and Arabic; this covers what the mock has none of.
 */

type Props = Record<string, unknown> & { children?: unknown };

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
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function found(kind: ContentKind, name: string, group: string, url = 'http://panel.test/1.ts'): CatalogItem {
  return {
    key: `x:s1:${kind}:${name}`,
    src: 's1',
    kind,
    name,
    normName: name.toLowerCase(),
    group,
    url,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

/** The catalog: a channel without a group, a movie, a show and a playlist's episode. */
const ITEMS: CatalogItem[] = [
  found('live', 'قناة الاختبار', ''),
  found('movie', 'Sintel', 'Open Movies | أفلام مفتوحة'),
  found('series', 'Lablo Test Series', 'Test Series', ''),
  found('series', 'Lablo Show S01 E01', ''),
];

function hit(i: number): SearchHit {
  return { src: 's1', kind: ITEMS[i]!.kind, gen: 1, index: i, catIdx: 0, chunk: 0, slot: i, match: 'word', favourite: false };
}

interface Options {
  /** Hits per search (default: the catalog's 4); `total` matched in all. */
  readonly count?: number;
  readonly total?: number;
  readonly fail?: boolean;
  readonly hold?: boolean;
}

async function draw(options: Options = {}) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 5 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const count = options.count ?? ITEMS.length;
  const engine = {
    profile: (): Promise<LoadedProfile | null> => Promise.resolve({ doc: emptyProfile(), newer: false, migratedFrom: null }),
    find: (req: SearchRequest): Promise<SearchResult> => {
      if (options.fail === true) return Promise.reject(new Error('worker gone'));
      if (options.hold === true) return new Promise<SearchResult>(() => undefined);
      const hits: SearchHit[] = [];
      for (let i = 0; i < count; i += 1) hits.push(hit(i % ITEMS.length));
      return Promise.resolve({ query: req.query, hits, total: options.total ?? count });
    },
    items: (refs: ItemRef[]): Promise<(CatalogItem | null)[]> => Promise.resolve(refs.map((r) => ITEMS[r.slot] ?? null)),
  };
  const search = createSearch({ nav, engine, select: () => undefined, platform: { textKey: () => null, onSoftKeyboard: () => () => undefined } });
  search.open();
  await flush();
  const binding = bindFocus(nav);
  const focus = (): Focus => nav.snapshot();
  return {
    nav,
    search,
    page: (locale = 'en-US') => SearchScreen({ search, i18n: appI18n(locale, { isolate: false }), binding, focus: focus() }),
  };
}

const item = (state: ItemBinding['state']): ItemBinding => ({ state, onHover: () => undefined, onPress: () => undefined });
const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA', { isolate: false });

describe('the search screen as drawn (step 28a)', () => {
  it('draws nothing once closed', async () => {
    const t = await draw();
    t.nav.handle('BACK');
    expect(t.page()).toBeNull();
  });

  it('opens with the title, the field and its hint, and no count or list', async () => {
    const t = await draw();
    const page = t.page();
    expect(page!.props).toMatchObject({ 'data-testid': 'search-screen', 'data-status': 'idle', 'data-answered': '', 'data-count': 0, 'data-total': 0, 'data-pending': 0, 'data-editing': '', 'data-screen': 'search', 'data-zone': 'field', 'data-index': 0 });
    expect(textOf(byClass(page, 'search__title'))).toBe('Search');
    const [field] = byTestId(page, 'search-field');
    expect(field!.props).toMatchObject({ id: 'search-field', label: 'Channels, movies and series', value: '', hint: 'Part of a name, in any language', error: null });
    expect(byTestId(page, 'search-count')).toHaveLength(0);
    expect(byTestId(page, 'search-spinner')).toHaveLength(0);
    expect(byTestId(page, 'search-results')).toHaveLength(0);
  });

  it('spins while the first answer is on its way', async () => {
    const t = await draw({ hold: true });
    t.search.setQuery('lablo');
    await flush();
    const page = t.page();
    expect((page!.props as Props)['data-status']).toBe('searching');
    expect(byTestId(page, 'search-spinner')).toHaveLength(1);
    expect((byTestId(page, 'search-field')[0]!.props as Props).value).toBe('lablo');
  });

  it('counts the results in the header, and lists them', async () => {
    const t = await draw();
    t.search.setQuery('lablo');
    await flush();
    const page = t.page();
    expect(page!.props).toMatchObject({ 'data-status': 'ready', 'data-answered': 'lablo', 'data-count': 4, 'data-total': 4 });
    expect(textOf(byTestId(page, 'search-count'))).toBe('4 results');
    expect((byTestId(page, 'search-count')[0]!.props as Props)['data-n']).toBe(4);
    const [list] = byTestId(page, 'search-results');
    expect(list!.props).toMatchObject({ zone: 'results', itemSize: SEARCH.rowHeight, gap: SEARCH.rowGap, screen: t.search.screen.value });
    expect(textOf(byTestId(t.page('ar-SA'), 'search-count'))).toBe('4 نتائج');
  });

  it('says how many matched when the list is cut', async () => {
    const t = await draw({ count: 200, total: 5432 });
    t.search.setQuery('a');
    await flush();
    expect(textOf(byTestId(t.page(), 'search-count'))).toBe('The best 200 of 5,432');
    expect(countText(ar, t.search)).toBe('أفضل 200 من 5,432');
  });

  it('says when nothing has the words, and when the search failed', async () => {
    const none = await draw({ count: 0 });
    none.search.setQuery('zzz');
    await flush();
    expect(textOf(byTestId(none.page(), 'search-count'))).toBe('0 results');
    expect((byTestId(none.page(), 'search-field')[0]!.props as Props).hint).toBe('Nothing has these words.');
    expect(byTestId(none.page(), 'search-results')).toHaveLength(0);
    expect(searchHint(ar, none.search)).toBe('لا يوجد ما يحتوي هذه الكلمات.');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failed = await draw({ fail: true });
    failed.search.setQuery('zzz');
    await flush();
    const page = failed.page();
    expect((byTestId(page, 'search-field')[0]!.props as Props).error).toBe("Couldn't search your sources.");
    expect((byTestId(page, 'search-field')[0]!.props as Props).hint).toBe('Part of a name, in any language');
    expect(byTestId(page, 'search-count')).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('draws a row’s name as data, over its kind and its group', async () => {
    const t = await draw();
    t.search.setQuery('lablo');
    await flush();
    const channel = SearchRow({ i18n: en, search: t.search, index: 0, item: item('focused') });
    expect(channel.props).toMatchObject({ 'data-testid': 'result-0', 'data-state': 'focused', 'data-kind': 'live', 'data-key': 'x:s1:live:قناة الاختبار', role: 'option' });
    expect(String((channel.props as Props).class)).toBe('search__row is-focused');
    expect(byClass(channel, 'search__name')[0]!.props).toMatchObject({ dir: 'auto', translate: false });
    expect(textOf(byClass(channel, 'search__name'))).toBe('قناة الاختبار');
    // No group from the provider: our own words, not data.
    expect(textOf(byClass(channel, 'search__where'))).toBe('Channel · Other channels');
    expect(byClass(channel, 'search__group')[0]!.props).toMatchObject({ dir: undefined, translate: undefined });
    const movie = SearchRow({ i18n: en, search: t.search, index: 1, item: item('memory') });
    expect(String((movie.props as Props).class)).toBe('search__row is-memory');
    expect(textOf(byClass(movie, 'search__where'))).toBe('Movie · Open Movies | أفلام مفتوحة');
    expect(byClass(movie, 'search__group')[0]!.props).toMatchObject({ dir: 'auto', translate: false });
    const show = SearchRow({ i18n: en, search: t.search, index: 2, item: item('idle') });
    expect(String((show.props as Props).class)).toBe('search__row');
    expect(textOf(byClass(show, 'search__where'))).toBe('Series · Test Series');
    const episode = SearchRow({ i18n: ar, search: t.search, index: 3, item: item('idle') });
    expect(textOf(byClass(episode, 'search__where'))).toBe('حلقة · مسلسلات أخرى');
    // A row not read yet: the box alone.
    const unread = SearchRow({ i18n: en, search: t.search, index: 9, item: item('idle') });
    expect(unread.props).toMatchObject({ 'data-kind': '', 'data-key': '' });
    expect(byClass(unread, 'search__text')).toHaveLength(0);
  });

  it('names each kind and each group without a name', () => {
    expect(ITEMS.map((i) => kindText(en.t, i))).toEqual(['Channel', 'Movie', 'Series', 'Episode']);
    expect(ITEMS.map((i) => kindText(ar.t, i))).toEqual(['قناة', 'فيلم', 'مسلسل', 'حلقة']);
    expect(groupText(en.t, found('movie', 'M', ''))).toEqual({ text: 'Other movies', data: false });
    expect(groupText(en.t, found('series', 'S', '', ''))).toEqual({ text: 'Other series', data: false });
    expect(groupText(en.t, found('live', 'L', 'News'))).toEqual({ text: 'News', data: true });
  });
});
