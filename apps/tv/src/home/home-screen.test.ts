import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type { CatalogItem } from '@lablo/core';
import type { KeyItemsRequest, LastChannel, LoadedProfile, RecentItem, RecentRequest, SourceRecord } from '@lablo/data';
import type { Focus, ItemBinding } from '@lablo/ui';
import { LAYOUT, bindFocus, createNavigator } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { Timers } from '../live/live-state';
import type { ShelfId } from './home-state';
import { HOME, HOME_CHANNELS, HOME_CONTINUE, HOME_MOVIES, HOME_SERIES, SHELF_ORDER, createHome } from './home-state';
import { HomeScreen, SHELF_TITLES } from './HomeScreen';

/**
 * Home as drawn (RELAY step 28b1): the page in each state and its tiles, called as functions over
 * a real Home (its components are not expanded). The e2e draws the mock's catalog in English and
 * Arabic; this covers what the mock has none of.
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
const props = (v: VNode): Props => v.props as Props;
const byClass = (root: unknown, cls: string): VNode[] => walk(root).filter((v) => String(props(v).class ?? '').split(' ').indexOf(cls) !== -1);
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => props(v)['data-testid'] === id || props(v).testId === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(props(node as VNode).children);
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function made(kind: 'movie' | 'series', n: number, name: string, url = ''): CatalogItem {
  return {
    key: `x:s1:${kind}:${n}`,
    src: 's1',
    kind,
    name,
    normName: '',
    group: '',
    url,
    logo: `http://img.test/${n}.jpg`,
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

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
/** Left part way: a playlist's episode (its mark under its name) and a movie. */
const LEFT = [made('series', 1, 'Lablo Show S01 E02', 'http://lists.test/e.mp4'), made('movie', 2, 'Sintel')];

/** Timers that run when `rest` says (the view rested). */
function heldTimers() {
  let waiting: (() => void)[] = [];
  const timers: Timers = {
    set: (run) => {
      waiting.push(run);
      return waiting.length;
    },
    clear: () => {
      waiting = [];
    },
  };
  return {
    timers,
    rest(): void {
      const run = waiting;
      waiting = [];
      for (const r of run) r();
    },
  };
}

/** A channel played last (step 28b2): its name ends like an episode's, which a channel tile keeps whole. */
const CHANNEL: LastChannel = {
  item: { ...made('movie', 7, 'Lablo News S01 E02'), key: 'x:s1:live:7', kind: 'live', logo: 'http://img.test/live/7.png' },
  number: 7,
  category: { src: 's1', name: 'News' },
  index: 6,
  started: 1,
};

async function draw(options: { movies?: number; series?: number; left?: boolean; fail?: boolean; hold?: boolean; channels?: LastChannel[] } = {}) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 6 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const recent = (kind: 'movie' | 'series', n: number): RecentItem[] => {
    const out: RecentItem[] = [];
    for (let i = 0; i < n; i += 1) out.push({ added: 100 - i, item: made(kind, 10 + i, `${kind} ${i}`) });
    return out;
  };
  const engine = {
    profile: (): Promise<LoadedProfile | null> => {
      if (options.hold === true) return new Promise<LoadedProfile | null>(() => undefined);
      return options.fail === true ? Promise.reject(new Error('worker gone')) : Promise.resolve({ doc: { v: 6, sources: [S1] }, newer: false, migratedFrom: null });
    },
    recent: (req: RecentRequest): Promise<RecentItem[]> => Promise.resolve(req.kind === 'movie' ? recent('movie', options.movies ?? 3) : recent('series', options.series ?? 2)),
    itemsByKey: (req: KeyItemsRequest): Promise<CatalogItem[]> => Promise.resolve(LEFT.filter((i) => i.kind === req.kind)),
  };
  const shares: Record<string, number> = { [LEFT[0]!.key]: 0.25 };
  const progress = { version: signal(0), share: (k: string) => shares[k], unfinished: () => (options.left === false ? [] : LEFT.map((i) => i.key)) };
  const warn = console.warn;
  console.warn = () => undefined;
  const clock = heldTimers();
  const channels = options.channels;
  const home = createHome({ nav, engine, timers: clock.timers, progress, ...(channels === undefined ? {} : { channels: { recent: () => channels } }) });
  home.open();
  await flush();
  console.warn = warn;
  const binding = bindFocus(nav);
  const focus = (): Focus => nav.snapshot();
  return {
    nav,
    home,
    rest: clock.rest,
    page: (locale = 'en-US') => HomeScreen({ home, i18n: appI18n(locale, { isolate: false }), binding, focus: focus(), clock: Date.UTC(2026, 10, 16, 18, 5) }),
  };
}

const item = (state: ItemBinding['state']): ItemBinding => ({ state, onHover: () => undefined, onPress: () => undefined });
const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA', { isolate: false });

/** A shelf's tile `i` as its VirtualList draws it. */
function tile(page: unknown, shelf: ShelfId, i: number, state: ItemBinding['state'] = 'idle'): VNode {
  const list = byTestId(page, `home-${shelf}`)[0]!;
  return (props(list).renderItem as (i: number, item: ItemBinding) => VNode)(i, item(state));
}

describe('Home as drawn (step 28b1)', () => {
  it('titles every shelf in both catalogs', () => {
    expect(Object.keys(SHELF_TITLES)).toEqual(SHELF_ORDER.slice());
    expect(SHELF_ORDER.map((s) => en.t(SHELF_TITLES[s]))).toEqual(['Continue watching', 'Recent channels', 'Recently added movies', 'Recently updated series']);
    expect(SHELF_ORDER.map((s) => ar.t(SHELF_TITLES[s]))).toEqual(['متابعة المشاهدة', 'القنوات الأخيرة', 'أفلام أضيفت حديثًا', 'مسلسلات حُدّثت مؤخرًا']);
    expect([en.t('home.open'), ar.t('home.open'), en.t('home.title'), ar.t('home.title')]).toEqual(['Home', 'الرئيسية', 'Home', 'الرئيسية']);
  });

  it('draws the header, then the two shelves in view, each its title over its tiles', async () => {
    const t = await draw();
    const page = t.page();
    expect(props(page as VNode)).toMatchObject({
      class: 'home',
      'data-testid': 'home-screen',
      'data-ready': 'true',
      'data-status': 'ready',
      'data-shelves': 'continue movies series',
      'data-top': 0,
      'data-language': 'en',
      'data-screen': 'home',
      'data-zone': 'continue',
      'data-index': 0,
    });
    expect(textOf(byClass(page, 'home__title'))).toBe('Home');
    expect(textOf(byTestId(page, 'home-clock'))).not.toBe('');
    const shelves = byClass(page, 'home__shelf');
    expect(shelves.map((s) => props(s)['data-testid'])).toEqual(['home-shelf-continue', 'home-shelf-movies']);
    expect(shelves.map((s) => s.key)).toEqual([HOME_CONTINUE, HOME_MOVIES]);
    expect(byClass(page, 'home__shelf-title').map(textOf)).toEqual(['Continue watching', 'Recently added movies']);
    const list = byTestId(page, 'home-continue')[0]!;
    expect(props(list)).toMatchObject({ zone: HOME_CONTINUE, itemSize: LAYOUT.posterWidth, gap: HOME.tileGap, class: 'home__tiles' });
    // In Arabic: its words.
    expect(byClass(t.page('ar-SA'), 'home__shelf-title').map(textOf)).toEqual(['متابعة المشاهدة', 'أفلام أضيفت حديثًا']);
    expect(props(t.page('ar-SA') as VNode)['data-language']).toBe('ar');
    // Down to the series: the shelves move.
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    const moved = t.page();
    expect(props(moved as VNode)).toMatchObject({ 'data-top': 1, 'data-zone': HOME_SERIES });
    expect(byClass(moved, 'home__shelf-title').map(textOf)).toEqual(['Recently added movies', 'Recently updated series']);
  });

  it("draws a tile's poster tile: the name (an episode's mark under it), its bar, its state", async () => {
    const t = await draw();
    const page = t.page();
    const episode = tile(page, HOME_CONTINUE, 0, 'focused');
    expect(props(episode)).toMatchObject({ poster: true, title: 'Lablo Show', subtitle: 'S01 E02', progress: 0.25, state: 'focused', testId: 'home-continue-0' });
    // No poster yet (asked at the rest): its title on its background.
    expect(props(episode).image).toBeUndefined();
    expect(props(episode).onImageLoad).toBeUndefined();
    const film = tile(page, HOME_CONTINUE, 1);
    expect(props(film)).toMatchObject({ title: 'Sintel', subtitle: undefined, progress: undefined, testId: 'home-continue-1' });
    // Past the shelf's end: an empty tile.
    expect(props(tile(page, HOME_CONTINUE, 5))).toMatchObject({ title: '', subtitle: undefined });
    expect(props(tile(page, HOME_MOVIES, 2))).toMatchObject({ title: 'movie 2', testId: 'home-movies-2' });
  });

  it("draws \"Recent channels\" as a row of channel tiles: the logo whole, the name whole, no bar (step 28b2)", async () => {
    const t = await draw({ left: false, channels: [CHANNEL] });
    const page = t.page();
    expect(props(page as VNode)['data-shelves']).toBe('channels movies series');
    const shelf = byTestId(page, 'home-shelf-channels')[0]!;
    expect(props(shelf).class).toBe('home__shelf home__shelf--channels');
    expect(byClass(page, 'home__shelf-title').map(textOf)).toEqual(['Recent channels', 'Recently added movies']);
    expect(byClass(t.page('ar-SA'), 'home__shelf-title').map(textOf)).toEqual(['القنوات الأخيرة', 'أفلام أضيفت حديثًا']);
    const list = byTestId(page, 'home-channels')[0]!;
    expect(props(list)).toMatchObject({ zone: HOME_CHANNELS, itemSize: LAYOUT.tileWidth, gap: HOME.tileGap, class: 'home__tiles home__tiles--channels' });
    const channel = tile(page, HOME_CHANNELS, 0, 'focused');
    expect(props(channel)).toMatchObject({ class: 'home__channel', title: 'Lablo News S01 E02', state: 'focused', testId: 'home-channels-0' });
    expect(props(channel).poster).toBeUndefined();
    expect(props(channel).subtitle).toBeUndefined();
    expect(props(channel).progress).toBeUndefined();
    expect(props(channel).image).toBeUndefined();
    // Past the shelf's end: an empty tile.
    expect(props(tile(page, HOME_CHANNELS, 3))).toMatchObject({ title: '' });
    // The other shelves keep their poster tiles.
    expect(props(byTestId(page, 'home-movies')[0]!)).toMatchObject({ itemSize: LAYOUT.posterWidth, class: 'home__tiles' });
    expect(props(byTestId(page, 'home-shelf-movies')[0]!).class).toBe('home__shelf');
    // Its logo once the view rested; the screen tells Home when it loads or fails.
    t.rest();
    const rested = tile(t.page(), HOME_CHANNELS, 0);
    expect(props(rested).image).toBe('http://img.test/live/7.png');
    // (The movies' posters download too.)
    const downloading = t.home.pending.value;
    (props(rested).onImageLoad as () => void)();
    expect(t.home.pending.value).toBe(downloading - 1);
    const failing = await draw({ left: false, channels: [CHANNEL] });
    failing.rest();
    (props(tile(failing.page(), HOME_CHANNELS, 0)).onImageError as () => void)();
    expect(props(tile(failing.page(), HOME_CHANNELS, 0)).image).toBeUndefined();
  });

  it('draws a poster once the view rested, and tells Home when it loads or fails', async () => {
    const t = await draw();
    t.rest();
    const page = t.page();
    const first = props(tile(page, HOME_CONTINUE, 0));
    expect(first.image).toBe('http://img.test/1.jpg');
    expect(props(page as VNode)['data-pending']).toBe(5);
    (first.onImageLoad as () => void)();
    expect(t.home.pending.value).toBe(4);
    const second = props(tile(t.page(), HOME_CONTINUE, 1));
    (second.onImageError as () => void)();
    // Failed: its title on its background from now on.
    expect(props(tile(t.page(), HOME_CONTINUE, 1)).image).toBeUndefined();
    expect(props(tile(t.page(), HOME_CONTINUE, 0)).image).toBe('http://img.test/1.jpg');
  });

  it('says it loads, that there is nothing yet, or that the read failed with "Try again"', async () => {
    const loading = await draw({ hold: true });
    const wait = loading.page();
    expect(props(wait as VNode)).toMatchObject({ 'data-ready': 'false', 'data-status': 'loading' });
    expect(props(byTestId(wait, 'home-spinner')[0]!).label).toBe('Loading Home');
    expect(byClass(wait, 'home__shelf')).toEqual([]);
    const empty = await draw({ movies: 0, series: 0, left: false });
    const none = empty.page();
    expect(props(none as VNode)['data-status']).toBe('empty');
    expect(textOf(byTestId(none, 'home-empty'))).toBe('What you watch and what your sources add shows up here.');
    expect(textOf(byTestId(empty.page('ar-SA'), 'home-empty'))).toBe('يظهر هنا ما تشاهده وما تضيفه مصادرك.');
    const failed = await draw({ fail: true });
    const page = failed.page();
    expect(textOf(byTestId(page, 'home-failed'))).toContain("Couldn't read your sources.");
    expect(props(byTestId(page, 'home-retry')[0]!)).toMatchObject({ label: 'Try again', variant: 'primary', state: 'focused' });
  });

  it('draws nothing once closed', async () => {
    const t = await draw();
    t.nav.handle('BACK');
    expect(t.page()).toBeNull();
  });
});
