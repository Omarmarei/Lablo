import type { VNode } from 'preact';
import type { EpgNowNext, EpgStatus, GuideChannel, GuideChannelsPage, GuideChannelsRequest, LoadedProfile, ProfileEdit, SourceRecord } from '@lablo/data';
import { emptyProfile } from '@lablo/data';
import type { ItemBinding } from '@lablo/ui';
import { bindFocus, createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import type { MappingCurrent } from './mapping-state';
import { MAPPING, createMapping } from './mapping-state';
import { MappingItem, MappingPage, MappingReading, currentText, searchHint } from './MappingPage';

/**
 * The manual mapping's picker as drawn (RELAY step 24e): the page in each state, its rows and the
 * reading line, called as functions over a real picker (their components are not expanded). The
 * e2e draws the mock's guide in English and Arabic; this covers what the mock has none of.
 */

const PANEL: SourceRecord = { id: 's1', type: 'm3u', name: 'My list', url: 'http://lists.test/a.m3u', added: 1 };
const KEY = 'x:s1:live:9';

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

interface Options {
  readonly total?: number;
  readonly pin?: { epgSrc: string; channel: string | null };
  readonly match?: string;
  readonly fail?: boolean;
  readonly hold?: boolean;
}

/** A picker over a guide (`s1:tvg0`, the playlist's) of `total` channels, opened on channel `KEY`. */
async function draw(options: Options = {}) {
  const nav = createNavigator({
    root: { id: 'unmatched', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 1 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const total = options.total ?? 3;
  const channel = (i: number): GuideChannel => ({ epgSrc: 's1:tvg0', id: `id.${i}`, name: `Guide ${i}` });
  const engine = {
    profile: (): Promise<LoadedProfile | null> =>
      Promise.resolve({
        doc: { ...emptyProfile(), sources: [{ ...PANEL }], ...(options.pin === undefined ? {} : { epgOverrides: { [KEY]: options.pin } }) } as LoadedProfile['doc'],
        newer: false,
        migratedFrom: null,
      }),
    epgStatus: (): Promise<EpgStatus> =>
      Promise.resolve({ guides: [], matched: 0, sources: [{ src: 's1', gen: 1, building: null, nextGen: 2, updatedAt: 1, counts: { live: 1 }, epgUrls: ['http://lists.test/guide.xml'] }], mapping: '-' }),
    nowNext: (keys: string[]): Promise<EpgNowNext[]> =>
      Promise.resolve(keys.map((key) => ({ key, epgSrc: options.match === undefined ? null : 's1:tvg0', channel: options.match ?? null, method: null, now: null, next: null }))),
    guideChannels: (req: GuideChannelsRequest): Promise<GuideChannelsPage> => {
      if (options.fail === true) return Promise.reject(new Error('worker gone'));
      const rows: GuideChannel[] = [];
      for (let i = req.offset; i < Math.min(total, req.offset + req.limit); i += 1) rows.push(channel(i));
      const page = { version: 1, count: total, offset: req.offset, rows };
      return options.hold === true && req.epgSrc === undefined ? new Promise<GuideChannelsPage>(() => undefined) : Promise.resolve(page);
    },
    editProfile: (_edit: ProfileEdit): Promise<boolean> => Promise.resolve(true),
  };
  const mapping = createMapping({ nav, engine, refreshNow: () => Promise.resolve(), mapped: () => undefined, platform: { textKey: () => null, onSoftKeyboard: () => () => undefined } });
  mapping.open({ key: KEY, name: 'Test Pattern' });
  await flush();
  const binding = bindFocus(nav);
  return { nav, mapping, binding, page: (locale = 'en-US') => MappingPage({ i18n: appI18n(locale, { isolate: false }), binding, mapping }) };
}

const item = (state: ItemBinding['state']): ItemBinding => ({ state, onHover: () => undefined, onPress: () => undefined });
const en = appI18n('en-US', { isolate: false });

describe('the picker as drawn (step 24e)', () => {
  it('draws nothing once closed', async () => {
    const t = await draw();
    t.nav.handle('BACK');
    expect(t.page()).toBeNull();
  });

  it('spins while the guides’ channels are read, with the title, the channel and its match, the search field and "No guide"', async () => {
    const t = await draw({ hold: true });
    const page = t.page();
    expect((page!.props as Props)['data-status']).toBe('loading');
    expect((page!.props as Props)['data-current']).toBe('none');
    expect(textOf(byClass(page, 'settings__title'))).toBe('Guide channel');
    expect(byTestId(page, 'mapping-spinner')).toHaveLength(1);
    expect(byTestId(page, 'mapping-count')).toHaveLength(0);
    expect(textOf(byTestId(page, 'mapping-intro'))).toBe('Channel: Test Pattern · no guide has it yet');
    const [field] = byTestId(page, 'mapping-search');
    expect(field!.props).toMatchObject({ id: 'mapping-search', label: "Search the guides' channels", value: '', hint: 'Part of a name or an ID', error: null });
    const [list] = byTestId(page, 'mapping-list');
    expect(list!.props).toMatchObject({ zone: 'channels', itemSize: MAPPING.rowHeight, gap: MAPPING.rowGap, screen: t.mapping.screen.value });
  });

  it('draws no list and no match before the channel’s match is read', () => {
    // The reads held: the line names the channel alone.
    const nav = createNavigator({ root: { id: 'r', zones: [{ kind: 'list', id: 'z', axis: 'vertical', count: 1 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined });
    const never = new Promise<never>(() => undefined);
    const mapping = createMapping({
      nav,
      engine: { profile: () => never, epgStatus: () => never, nowNext: () => never, guideChannels: () => never, editProfile: () => never },
      refreshNow: () => Promise.resolve(),
      mapped: () => undefined,
      platform: { textKey: () => null, onSoftKeyboard: () => () => undefined },
    });
    mapping.open({ key: KEY, name: 'Test Pattern' });
    const page = MappingPage({ i18n: en, binding: bindFocus(nav), mapping });
    expect(textOf(byTestId(page, 'mapping-intro'))).toBe('Channel: Test Pattern');
    expect(byTestId(page, 'mapping-now')).toHaveLength(0);
    expect(byTestId(page, 'mapping-list')).toHaveLength(0);
    expect((page!.props as Props)['data-current']).toBe('');
  });

  it('counts the channels found in the header once read', async () => {
    const t = await draw({ total: 3 });
    const page = t.page();
    expect((page!.props as Props)['data-count']).toBe(3);
    expect(textOf(byTestId(page, 'mapping-count'))).toBe('3 channels');
    expect(byTestId(page, 'mapping-spinner')).toHaveLength(0);
    expect((byTestId(page, 'mapping-search')[0]!.props as Props).hint).toBe('Part of a name or an ID');
  });

  it('says why nothing is listed in the field’s line, and when the channels couldn’t be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const empty = await draw({ total: 0 });
    expect((byTestId(empty.page(), 'mapping-search')[0]!.props as Props).hint).toBe('Your guides have no channels yet.');
    empty.mapping.setQuery('  ');
    await flush();
    expect(searchHint(en, empty.mapping)).toBe('Your guides have no channels yet.');
    empty.mapping.setQuery('bbc');
    await flush();
    expect(searchHint(en, empty.mapping)).toBe('No guide channel has these words.');
    const failed = await draw({ fail: true });
    const page = failed.page();
    expect((byTestId(page, 'mapping-search')[0]!.props as Props).error).toBe("Couldn't read the guides' channels.");
    expect(searchHint(en, failed.mapping)).toBe('Part of a name or an ID');
    vi.restoreAllMocks();
  });

  it('draws "No guide", "Match automatically" and a guide channel: its name as data, its id and its guide’s link left to right', async () => {
    const t = await draw({ pin: { epgSrc: 's1:tvg0', channel: 'id.1' } });
    const offRow = MappingItem({ i18n: en, mapping: t.mapping, index: 0, item: item('focused') });
    expect(offRow.props).toMatchObject({ 'data-testid': 'mapping-0', 'data-kind': 'off', 'data-src': '', 'data-id': '', 'data-state': 'focused', 'data-selected': 'false', 'aria-selected': 'false' });
    expect(String((offRow.props as Props).class)).toBe('mapping__row is-focused');
    const offText = walk(offRow).find((v) => typeof v.type === 'function')!;
    const autoRow = MappingItem({ i18n: en, mapping: t.mapping, index: 1, item: item('memory') });
    expect(String((autoRow.props as Props).class)).toBe('mapping__row is-memory');
    const autoText = walk(autoRow).find((v) => typeof v.type === 'function')!;
    // (The row's text is a component: called here.)
    const call = (v: VNode): VNode => (v.type as (p: unknown) => VNode)(v.props);
    expect(textOf(call(offText))).toBe('No guideShow no programmes for this channel');
    expect(textOf(call(autoText))).toBe('Match automaticallyLet the guides find its channel again');
    // The mapped channel: checked.
    const marked = MappingItem({ i18n: en, mapping: t.mapping, index: 3, item: item('idle') });
    expect(marked.props).toMatchObject({ 'data-kind': 'channel', 'data-src': 's1:tvg0', 'data-id': 'id.1', 'data-selected': 'true', 'aria-selected': 'true' });
    expect(String((marked.props as Props).class)).toBe('mapping__row is-selected');
    expect(byClass(marked, 'mapping__check')[0]!.props.children).not.toBe(false);
    const text = call(walk(marked).find((v) => typeof v.type === 'function')!);
    expect(byClass(text, 'mapping__name')[0]!.props).toMatchObject({ dir: 'auto', translate: false });
    expect(textOf(byClass(text, 'mapping__name'))).toBe('Guide 1');
    expect(byClass(text, 'mapping__id')[0]!.props).toMatchObject({ dir: 'ltr', translate: false });
    expect(byClass(text, 'mapping__link')[0]!.props).toMatchObject({ dir: 'ltr', translate: false });
    expect(textOf(byClass(text, 'mapping__where'))).toBe('id.1 · lists.test/guide.xml');
    // Another: no check.
    const other = MappingItem({ i18n: en, mapping: t.mapping, index: 2, item: item('idle') });
    expect((other.props as Props)['data-selected']).toBe('false');
    expect(byClass(other, 'mapping__check')[0]!.props.children).toBe(false);
    // A row not read yet: the box alone.
    const unread = MappingItem({ i18n: en, mapping: t.mapping, index: 2 + 3, item: item('idle') });
    expect(unread.props).toMatchObject({ 'data-kind': '', 'data-selected': 'false' });
    expect(walk(unread).filter((v) => typeof v.type === 'function')).toHaveLength(0);
  });

  it('leaves the link out for a guide the guides screen doesn’t list', async () => {
    const t = await draw();
    // The playlist's guide is listed; a channel of another guide is drawn without a link.
    const row = { kind: 'channel' as const, channel: { epgSrc: 's9:xmltv', id: 'x', name: 'X' } };
    vi.spyOn(t.mapping, 'row').mockReturnValue(row);
    const drawn = MappingItem({ i18n: en, mapping: t.mapping, index: 1, item: item('idle') });
    const text = (walk(drawn).find((v) => typeof v.type === 'function')!.type as (p: unknown) => VNode)(walk(drawn).find((v) => typeof v.type === 'function')!.props);
    expect(textOf(byClass(text, 'mapping__where'))).toBe('x');
    expect(byClass(text, 'mapping__link')).toHaveLength(0);
  });

  it('names the current match: none, no guide, the guides’ or yours, by name or by id', () => {
    const cases: [MappingCurrent | null, string, string][] = [
      [null, '', ''],
      [{ kind: 'none' }, '', 'no guide has it yet'],
      [{ kind: 'off' }, '', 'now no guide, set by you'],
      [{ kind: 'auto', epgSrc: 's1:tvg0', channel: 'id.1' }, 'Guide 1', 'now Guide 1, found by the guides'],
      [{ kind: 'auto', epgSrc: 's1:tvg0', channel: 'id.1' }, '', 'now id.1, found by the guides'],
      [{ kind: 'pin', epgSrc: 's1:tvg0', channel: 'id.1' }, 'Guide 1', 'now Guide 1, set by you'],
      [{ kind: 'pin', epgSrc: 's1:tvg0', channel: 'id.1' }, '', 'now id.1, set by you'],
    ];
    for (const [current, name, text] of cases) expect(currentText(en, current, name)).toBe(text);
    expect(currentText(appI18n('ar-SA', { isolate: false }), { kind: 'off' }, '')).toBe('الآن بلا دليل، حدّدته أنت');
  });

  it('draws the reading line only while a mapping’s refresh runs', () => {
    expect(MappingReading({ i18n: en, reading: 0, testId: 'x' })).toBeNull();
    const line = MappingReading({ i18n: en, reading: 2, testId: 'guide-reading' })!;
    expect(line.props).toMatchObject({ class: 'mapping__reading', 'data-testid': 'guide-reading' });
    expect(textOf(line)).toBe('Reading the guides…');
  });

  it('draws the Arabic page', async () => {
    const t = await draw({ match: 'id.2' });
    const page = t.page('ar-SA');
    expect(textOf(byClass(page, 'settings__title'))).toBe('قناة الدليل');
    expect(textOf(byTestId(page, 'mapping-intro'))).toBe('القناة: Test Pattern · الآن Guide 2، وجدتها الأدلة');
  });
});
