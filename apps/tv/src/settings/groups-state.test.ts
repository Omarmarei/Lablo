import type { CatalogItem, ContentKey } from '@lablo/core';
import type { CategoryInfo, FavouriteRef, LoadedProfile, ProfileDoc, ProfileEdit, SourceRecord } from '@lablo/data';
import { applyProfileEdit, emptyProfile } from '@lablo/data';
import type { FavouriteList, GroupRef, KeyItemsRequest } from '@lablo/data/client';
import type { Intent, KeyLike, TextKey } from '@lablo/platform-api';
import type { EditableLike } from '@lablo/ui';
import { SCREEN, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupRow, GroupsEngine } from './groups-state';
import {
  CHANNEL_MENU,
  DELETE_NO,
  GROUPS,
  GROUPS_VISIBLE,
  GROUP_CHANNELS,
  GROUP_DELETE,
  GROUP_MENU,
  GROUP_NAME_FIELD,
  GROUP_RENAME,
  GROUP_SCREENS,
  GROUPS_SCREEN,
  channelActions,
  channelRows,
  createGroups,
  groupRows,
  poolNames,
  rowActions,
} from './groups-state';

function item(key: string, name: string): CatalogItem {
  return {
    key,
    src: 's1',
    kind: 'live',
    name,
    normName: name.toLowerCase(),
    group: 'News',
    url: `http://panel.test/${key}.ts`,
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

function info(catIdx: number, name: string, count: number): CategoryInfo {
  return { catIdx, name, count, chunks: count === 0 ? [] : [count] };
}

function ref(key: string, normName: string): FavouriteRef {
  return { key, src: 's1', kind: 'live', normName, added: 1, missingSince: null };
}

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
const S2: SourceRecord = { id: 's2', type: 'xtream', name: 'Panel', account: { base: 'http://panel.test', username: 'u', password: 'p' }, added: 2 };

/** s1: News (3), an empty group, Sports (5), a group without a name (2); s2: Kids (4). */
const CATEGORIES: Record<string, CategoryInfo[]> = {
  s1: [info(0, 'News', 3), info(1, 'Empty', 0), info(2, 'Sports', 5), info(3, '', 2)],
  s2: [info(0, 'Kids', 4)],
};

/** The catalog's live items by key: a, b, c (d is a key the catalog doesn't have now). */
const ITEMS: Record<string, CatalogItem> = { a: item('a', 'Alpha'), b: item('b', 'Beta'), c: item('c', 'Gamma') };

function profileDoc(patch: Record<string, unknown> = {}): ProfileDoc {
  return {
    ...emptyProfile(),
    sources: [S1, S2],
    favourites: [ref('a', 'alpha'), ref('b', 'beta'), ref('c', 'gamma'), ref('d', 'delta one')],
    favouriteLists: [
      { id: 'l1', name: 'Mine', keys: ['a', 'd', 'b'] },
      { id: 'l2', name: null, keys: ['c'] },
    ],
    ...patch,
  } as ProfileDoc;
}

interface Held {
  readonly go: () => void;
}

/** The data engine: the profile's edits applied for real (the query worker's `applyProfileEdit`), answers held on request. */
class FakeEngine implements GroupsEngine {
  doc: ProfileDoc = profileDoc();
  catalog: Record<string, CategoryInfo[]> = CATEGORIES;
  readonly edits: ProfileEdit[] = [];
  readonly keyCalls: KeyItemsRequest[] = [];
  profileCalls = 0;
  failRead = false;
  failEdit = false;
  failKeys = false;
  hold = new Set<'read' | 'edit' | 'keys'>();
  readonly held: Record<'read' | 'edit' | 'keys', Held[]> = { read: [], edit: [], keys: [] };

  private answer<T>(kind: 'read' | 'edit' | 'keys', value: () => T): Promise<T> {
    const run = (): Promise<T> => {
      try {
        return Promise.resolve(value());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    if (!this.hold.has(kind)) return run();
    return new Promise<T>((resolve, reject) => {
      this.held[kind].push({ go: () => run().then(resolve, reject) });
    });
  }

  profile(): Promise<LoadedProfile | null> {
    this.profileCalls += 1;
    // (The document as it is now, even for an answer held.)
    return this.answer('read', () => {
      if (this.failRead) throw new Error('no IndexedDB');
      return { doc: this.doc, newer: false, migratedFrom: null };
    });
  }

  categories(src: string, kind: 'live'): Promise<CategoryInfo[]> {
    expect(kind).toBe('live');
    return Promise.resolve(this.catalog[src] ?? []);
  }

  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]> {
    this.keyCalls.push(req);
    return this.answer('keys', () => {
      if (this.failKeys) throw new Error('read failed');
      const out: CatalogItem[] = [];
      for (const key of req.keys) if (ITEMS[key] !== undefined) out.push(ITEMS[key]!);
      return out;
    });
  }

  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.edits.push(edit);
    return this.answer('edit', () => {
      if (this.failEdit) throw new Error('worker gone');
      const next = applyProfileEdit(this.doc, edit);
      if (next === null) return false;
      this.doc = next;
      return true;
    });
  }

  release(kind: 'read' | 'edit' | 'keys'): void {
    const all = this.held[kind].splice(0);
    for (const h of all) h.go();
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

function setup(engine = new FakeEngine()) {
  const clock = { now: 0 };
  const nav = createNavigator({
    root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 6 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    // (A click within 300 ms of an OK key is its twin: tests move the clock first.)
    now: () => clock.now,
  });
  const input: EditableLike & { focused: number } = {
    focused: 0,
    focus() {
      this.focused += 1;
    },
    blur: () => undefined,
  };
  const find = vi.fn((id: string) => (id === GROUP_NAME_FIELD ? input : null));
  const platform = {
    textKey: (event: KeyLike): TextKey | null => (event.key === 'Enter' ? 'done' : null),
    onSoftKeyboard: () => () => undefined,
  };
  const changed = vi.fn();
  const groups = createGroups({ nav, engine, changed, platform, find, now: () => 10_000 });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  /** The rows as short names: `l:<id>` for a list, `g:<name>` (`!` when hidden) for a group. */
  const names = (): string[] => groups.rows.value.map((r) => (r.kind === 'list' ? `l:${r.list.id}` : `g:${r.group.name}${r.hidden ? '!' : ''}`));
  const keys = (): string[] => (groups.channels.value ?? []).map((c) => c.key);
  /** A click on row `index` of `zone`, a second after the last key. */
  const click = async (zone: string, index: number): Promise<boolean> => {
    clock.now += 1_000;
    const taken = nav.top.click(zone, index);
    await flush();
    return taken;
  };
  return { nav, engine, groups, input, find, changed, at, press, names, keys, click };
}

/** Opens the screen and lets its first read land. */
async function opened(engine = new FakeEngine()) {
  const t = setup(engine);
  t.groups.open();
  await flush();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('"Channel groups"’ layout (RELAY step 35d)', () => {
  it('fits 8 rows of 88 px under the header and the line under it', () => {
    const body = SCREEN.height - 2 * SCREEN.safeY - 56 - 24 - 56;
    expect(GROUPS_VISIBLE).toBe(8);
    expect(GROUPS_VISIBLE * (GROUPS.rowHeight + GROUPS.rowGap) - GROUPS.rowGap).toBeLessThanOrEqual(body);
    expect((GROUPS_VISIBLE + 1) * (GROUPS.rowHeight + GROUPS.rowGap) - GROUPS.rowGap).toBeGreaterThan(body);
    expect(GROUP_SCREENS).toEqual([GROUPS_SCREEN, GROUP_MENU, GROUP_RENAME, GROUP_DELETE, GROUP_CHANNELS, CHANNEL_MENU]);
  });
});

describe('groupRows', () => {
  const sources = [
    { id: 's1', name: 'Home', categories: CATEGORIES.s1! },
    { id: 's2', name: 'Panel', categories: CATEGORIES.s2! },
  ];

  it('lists the lists, then every group with channels in the provider’s order, each source’s name with two sources', () => {
    const rows = groupRows(profileDoc(), sources);
    expect(rows.map((r) => r.kind)).toEqual(['list', 'list', 'group', 'group', 'group', 'group']);
    expect(rows[0]).toEqual({ kind: 'list', list: { id: 'l1', name: 'Mine', keys: ['a', 'd', 'b'] } });
    expect(rows.slice(2)).toEqual([
      { kind: 'group', group: { src: 's1', name: 'News' }, count: 3, hidden: false, source: 'Home' },
      { kind: 'group', group: { src: 's1', name: 'Sports' }, count: 5, hidden: false, source: 'Home' },
      { kind: 'group', group: { src: 's1', name: '' }, count: 2, hidden: false, source: 'Home' },
      { kind: 'group', group: { src: 's2', name: 'Kids' }, count: 4, hidden: false, source: 'Panel' },
    ]);
  });

  it('puts the user’s ordered groups first and marks the hidden ones, which keep their place', () => {
    const doc = profileDoc({
      groupOrder: [
        { src: 's2', name: 'Kids' },
        { src: 's1', name: 'Sports' },
      ],
      hiddenGroups: [{ src: 's1', name: 'Sports' }],
    });
    const rows = groupRows(doc, sources);
    expect(rows.slice(2).map((r) => (r.kind === 'group' ? `${r.group.name}${r.hidden ? '!' : ''}` : ''))).toEqual(['Kids', 'Sports!', 'News', '']);
  });

  it('names no source with one source, and has no group without channels', () => {
    const rows = groupRows(profileDoc({ favouriteLists: [] }), [sources[0]!]);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.kind === 'group' && r.source).toBe('');
    // Nothing at all: no rows.
    expect(groupRows(null, [])).toEqual([]);
    expect(groupRows(profileDoc(), [{ id: 's1', name: 'Home', categories: [info(0, 'Empty', 0)] }]).map((r) => r.kind)).toEqual(['list', 'list']);
  });
});

describe('the menus’ actions', () => {
  const list = (keys: string[], id = 'l1'): GroupRow => ({ kind: 'list', list: { id, name: null, keys } });
  const group = (hidden: boolean, name = 'News'): GroupRow => ({ kind: 'group', group: { src: 's1', name }, count: 1, hidden, source: '' });

  it('gives a list Channels when it has any, Move with another list, Rename, Delete and Cancel', () => {
    const one = list(['a']);
    expect(rowActions(one, [one, list([], 'l2'), group(false)])).toEqual(['channels', 'move', 'rename', 'delete', 'cancel']);
    expect(rowActions(one, [one, group(false), group(false, 'Sports')])).toEqual(['channels', 'rename', 'delete', 'cancel']);
    const empty = list([]);
    expect(rowActions(empty, [empty, list(['a'], 'l2')])).toEqual(['move', 'rename', 'delete', 'cancel']);
  });

  it('gives a group Move with another group, Hide or Show and Cancel', () => {
    const shown = group(false);
    const hidden = group(true, 'Sports');
    expect(rowActions(shown, [list(['a']), shown, hidden])).toEqual(['move', 'hide', 'cancel']);
    expect(rowActions(hidden, [list(['a']), shown, hidden])).toEqual(['move', 'show', 'cancel']);
    expect(rowActions(shown, [list(['a']), list(['b'], 'l2'), shown])).toEqual(['hide', 'cancel']);
  });

  it('gives a list’s channel Move with another channel, Remove and Cancel', () => {
    expect(channelActions(2)).toEqual(['move', 'remove', 'cancel']);
    expect(channelActions(1)).toEqual(['remove', 'cancel']);
  });
});

describe('a list’s channel rows', () => {
  it('reads the pool’s normalized names, leaving out what isn’t a ref', () => {
    const names = poolNames({ favourites: [ref('a', 'alpha'), null, 'x', { key: 'b' }, { key: 3, normName: 'n' }, ref('d', 'delta one')] });
    expect([...names.entries()]).toEqual([
      ['a', 'alpha'],
      ['d', 'delta one'],
    ]);
    expect(poolNames(null).size).toBe(0);
    expect(poolNames({ favourites: 'no' }).size).toBe(0);
  });

  it('shows every key in the list’s order: the item found, else the pool’s name, else nothing', () => {
    const list: FavouriteList = { id: 'l1', name: null, keys: ['b', 'd', 'a', 'e'] };
    const rows = channelRows(list, [ITEMS.a!, ITEMS.b!], new Map<ContentKey, string>([['d', 'delta one']]));
    expect(rows).toEqual([
      { key: 'b', item: ITEMS.b, name: 'Beta' },
      { key: 'd', item: null, name: 'delta one' },
      { key: 'a', item: ITEMS.a, name: 'Alpha' },
      { key: 'e', item: null, name: '' },
    ]);
  });
});

describe('the "Channel groups" screen (RELAY step 35d)', () => {
  it('opens on its first row once read, the lists then the groups; Back goes back to the settings', async () => {
    const engine = new FakeEngine();
    engine.hold.add('read');
    const t = setup(engine);
    t.groups.open();
    expect(t.groups.status.value).toBe('loading');
    expect(t.at()).toBe('groups · rows -1');
    engine.release('read');
    await flush();
    expect(t.groups.status.value).toBe('ready');
    expect(t.at()).toBe('groups · rows 0');
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:News', 'g:Sports', 'g:', 'g:Kids']);
    expect((t.nav.top.zone('rows') as { count: number; visible: number }).count).toBe(6);
    expect((t.nav.top.zone('rows') as { visible: number }).visible).toBe(GROUPS_VISIBLE);
    expect(t.groups.screen.value).toBe(t.nav.top);
    expect(t.groups.pending.value).toBe(0);
    await t.press('BACK');
    expect(t.at()).toBe('settings · items 0');
  });

  it('says a read failed only when nothing was read', async () => {
    const engine = new FakeEngine();
    engine.failRead = true;
    const t = await opened(engine);
    expect(t.groups.status.value).toBe('failed');
    expect(t.groups.rows.value).toEqual([]);
    // A later read that fails keeps what the screen shows.
    engine.failRead = false;
    await t.press('BACK');
    t.groups.open();
    await flush();
    expect(t.groups.status.value).toBe('ready');
    engine.failRead = true;
    await t.press('BACK');
    t.groups.open();
    await flush();
    expect(t.groups.status.value).toBe('ready');
    expect(t.names()).toHaveLength(6);
  });

  it('opens a group’s menu with OK; Cancel and Back close it, changing nothing', async () => {
    const t = await opened();
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe(`${GROUP_MENU} · actions 0`);
    expect(t.groups.menu.value).toEqual({ actions: ['move', 'hide', 'cancel'], row: t.groups.rows.value[2], channel: null });
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe('groups · rows 2');
    expect(t.groups.menu.value).toBeNull();
    await t.press('OK', 'BACK');
    expect(t.at()).toBe('groups · rows 2');
    expect(t.groups.menu.value).toBeNull();
    expect(t.engine.edits).toEqual([]);
  });

  it('hides a group and shows it again, the focus staying on it; the live screen reads each change', async () => {
    const t = await opened();
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.groups.menu.value?.actions).toEqual(['move', 'hide', 'cancel']);
    await t.press('DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'group', change: { op: 'hide', group: { src: 's1', name: 'Sports' } } }]);
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:News', 'g:Sports!', 'g:', 'g:Kids']);
    expect(t.at()).toBe('groups · rows 3');
    await t.press('OK');
    expect(t.groups.menu.value?.actions).toEqual(['move', 'show', 'cancel']);
    await t.press('DOWN', 'OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'group', change: { op: 'show', group: { src: 's1', name: 'Sports' } } });
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:News', 'g:Sports', 'g:', 'g:Kids']);
    expect(t.changed).toHaveBeenCalledTimes(2);
  });

  it('follows the group it hid when the read puts it elsewhere', async () => {
    const t = await opened();
    await t.press('DOWN', 'DOWN', 'OK', 'DOWN');
    // Another app's order lands with the edit: News last.
    t.engine.doc = { ...t.engine.doc, groupOrder: [{ src: 's1', name: 'Sports' }, { src: 's1', name: '' }, { src: 's2', name: 'Kids' }] } as ProfileDoc;
    await t.press('OK');
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:Sports', 'g:', 'g:Kids', 'g:News!']);
    expect(t.at()).toBe('groups · rows 5');
  });

  it('moves a group among the groups only: UP and DOWN a place, then OK stores every group’s order, hidden ones too', async () => {
    const engine = new FakeEngine();
    engine.doc = profileDoc({ hiddenGroups: [{ src: 's2', name: 'Kids' }] });
    const t = await opened(engine);
    // "Sports", then Move.
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK', 'OK');
    expect(t.groups.moving.value).toEqual({ zone: 'rows', from: 3, at: 3 });
    expect(t.at()).toBe('groups · rows 3');
    await t.press('UP');
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:Sports', 'g:News', 'g:', 'g:Kids!']);
    expect(t.groups.moving.value).toEqual({ zone: 'rows', from: 3, at: 2 });
    expect(t.at()).toBe('groups · rows 2');
    // Not among the lists.
    await t.press('UP');
    expect(t.groups.moving.value?.at).toBe(2);
    expect(t.at()).toBe('groups · rows 2');
    await t.press('DOWN', 'DOWN');
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:News', 'g:', 'g:Sports', 'g:Kids!']);
    expect(t.engine.edits).toEqual([]);
    await t.press('OK');
    expect(t.groups.moving.value).toBeNull();
    expect(t.engine.edits).toEqual([
      {
        kind: 'group',
        change: {
          op: 'order',
          groups: [
            { src: 's1', name: 'News' },
            { src: 's1', name: '' },
            { src: 's1', name: 'Sports' },
            { src: 's2', name: 'Kids' },
          ],
        },
      },
    ]);
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:News', 'g:', 'g:Sports', 'g:Kids!']);
    expect(t.at()).toBe('groups · rows 4');
  });

  it('pages a moving row with CH+ and CH−, as far as its kind goes', async () => {
    const engine = new FakeEngine();
    const many: CategoryInfo[] = [];
    for (let i = 0; i < 20; i += 1) many.push(info(i, `G${i}`, 1));
    engine.catalog = { s1: many };
    const t = await opened(engine);
    // "G0" is row 2: Move it, then a page down.
    await t.press('DOWN', 'DOWN', 'OK', 'OK', 'CH_DOWN');
    expect(t.groups.moving.value?.at).toBe(2 + GROUPS_VISIBLE);
    await t.press('CH_DOWN', 'CH_DOWN');
    expect(t.groups.moving.value?.at).toBe(21);
    await t.press('CH_UP');
    expect(t.groups.moving.value?.at).toBe(21 - GROUPS_VISIBLE);
    await t.press('CH_UP', 'CH_UP');
    expect(t.groups.moving.value?.at).toBe(2);
    expect(t.at()).toBe('groups · rows 2');
  });

  it('puts a moving row back with Back, with no edit; OK where it was makes none either', async () => {
    const t = await opened();
    await t.press('DOWN', 'DOWN', 'OK', 'OK', 'DOWN', 'DOWN');
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:Sports', 'g:', 'g:News', 'g:Kids']);
    await t.press('BACK');
    expect(t.groups.moving.value).toBeNull();
    expect(t.names()).toEqual(['l:l1', 'l:l2', 'g:News', 'g:Sports', 'g:', 'g:Kids']);
    expect(t.at()).toBe('groups · rows 2');
    // Still on the groups screen: Back went to the move only.
    expect(t.groups.screen.value).toBe(t.nav.top);
    await t.press('OK', 'OK', 'DOWN', 'UP', 'OK');
    expect(t.groups.moving.value).toBeNull();
    expect(t.engine.edits).toEqual([]);
    expect(t.changed).not.toHaveBeenCalled();
    // Other keys go on as usual while moving (LEFT: nothing that way).
    await t.press('OK', 'OK', 'LEFT');
    expect(t.groups.moving.value).not.toBeNull();
  });

  it('puts the row down where it is when a click lands while moving', async () => {
    const t = await opened();
    await t.press('DOWN', 'DOWN', 'OK', 'OK', 'DOWN');
    expect(await t.click('rows', 5)).toBe(true);
    expect(t.groups.moving.value).toBeNull();
    expect(t.engine.edits).toHaveLength(1);
    expect(t.names().slice(2)).toEqual(['g:Sports', 'g:News', 'g:', 'g:Kids']);
  });

  it('moves a list among the lists only', async () => {
    const t = await opened();
    await t.press('OK');
    expect(t.groups.menu.value?.actions).toEqual(['channels', 'move', 'rename', 'delete', 'cancel']);
    await t.press('DOWN', 'OK', 'DOWN', 'DOWN');
    expect(t.groups.moving.value).toEqual({ zone: 'rows', from: 0, at: 1 });
    expect(t.names().slice(0, 2)).toEqual(['l:l2', 'l:l1']);
    await t.press('OK');
    expect(t.engine.edits).toEqual([{ kind: 'favourite', change: { op: 'moveList', list: 'l1', to: 1 } }]);
    expect(t.names()).toEqual(['l:l2', 'l:l1', 'g:News', 'g:Sports', 'g:', 'g:Kids']);
    expect(t.at()).toBe('groups · rows 1');
  });

  it('renames a list from a form that starts with its name; blank is "Favourites" again', async () => {
    const t = await opened();
    await t.press('OK', 'DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe(`${GROUP_RENAME} · field 0`);
    expect(t.groups.target.value?.id).toBe('l1');
    expect(t.groups.text.value).toBe('Mine');
    // OK on the field opens the text editor on the name's input.
    await t.press('OK');
    expect(t.find).toHaveBeenCalledWith(GROUP_NAME_FIELD);
    expect(t.input.focused).toBe(1);
    t.groups.setText('Sport');
    await t.press('DOWN', 'OK');
    expect(t.groups.target.value).toBeNull();
    expect(t.engine.edits).toEqual([{ kind: 'favourite', change: { op: 'rename', list: 'l1', name: 'Sport' } }]);
    expect(t.groups.rows.value[0]).toEqual({ kind: 'list', list: { id: 'l1', name: 'Sport', keys: ['a', 'd', 'b'] } });
    expect(t.at()).toBe('groups · rows 0');
    await t.press('OK', 'DOWN', 'DOWN', 'OK');
    t.groups.setText('  ');
    await t.press('DOWN', 'OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'favourite', change: { op: 'rename', list: 'l1', name: null } });
    // An unnamed list's form starts empty.
    await t.press('OK', 'DOWN', 'DOWN', 'OK');
    expect(t.groups.text.value).toBe('');
  });

  it('makes no edit for the same name, nor on Cancel or Back', async () => {
    const t = await opened();
    await t.press('OK', 'DOWN', 'DOWN', 'OK', 'DOWN', 'OK');
    await t.press('OK', 'DOWN', 'DOWN', 'OK');
    t.groups.setText('Other');
    await t.press('DOWN', 'RIGHT', 'OK');
    expect(t.at()).toBe('groups · rows 0');
    await t.press('OK', 'DOWN', 'DOWN', 'OK');
    t.groups.setText('Other');
    await t.press('BACK');
    expect(t.at()).toBe('groups · rows 0');
    expect(t.groups.target.value).toBeNull();
    expect(t.engine.edits).toEqual([]);
  });

  it('asks before deleting a list, "Cancel" focused; Delete removes it and the channels only it held', async () => {
    const t = await opened();
    await t.press('OK', 'DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe(`${GROUP_DELETE} · actions ${DELETE_NO}`);
    expect(t.groups.target.value?.id).toBe('l1');
    await t.press('OK');
    expect(t.at()).toBe('groups · rows 0');
    expect(t.groups.target.value).toBeNull();
    await t.press('OK', 'DOWN', 'DOWN', 'DOWN', 'OK', 'BACK');
    expect(t.at()).toBe('groups · rows 0');
    expect(t.engine.edits).toEqual([]);
    await t.press('OK', 'DOWN', 'DOWN', 'DOWN', 'OK', 'LEFT', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'favourite', change: { op: 'removeList', list: 'l1' } }]);
    expect(t.names()).toEqual(['l:l2', 'g:News', 'g:Sports', 'g:', 'g:Kids']);
    expect((t.engine.doc.favourites ?? []).map((f) => f.key)).toEqual(['c']);
    expect(t.changed).toHaveBeenCalledTimes(1);
  });

  it('shows a list’s channels by key, a missing one by the pool’s name; Back returns to the list’s row', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 0`);
    expect(t.groups.list.value?.id).toBe('l1');
    expect(t.groups.channelsScreen.value).toBe(t.nav.top);
    expect(t.engine.keyCalls).toEqual([{ keys: ['a', 'd', 'b'], kind: 'live', sources: ['s1', 's2'], limit: 3 }]);
    expect(t.groups.channels.value).toEqual([
      { key: 'a', item: ITEMS.a, name: 'Alpha' },
      { key: 'd', item: null, name: 'delta one' },
      { key: 'b', item: ITEMS.b, name: 'Beta' },
    ]);
    expect((t.nav.top.zone('channels') as { count: number }).count).toBe(3);
    await t.press('BACK');
    expect(t.at()).toBe('groups · rows 0');
    expect(t.groups.list.value).toBeNull();
    expect(t.groups.channels.value).toBeNull();
    expect(t.groups.channelsScreen.value).toBeNull();
  });

  it('reads a long list’s channels a hundred keys a call', async () => {
    const engine = new FakeEngine();
    const keys: string[] = [];
    for (let i = 0; i < 250; i += 1) keys.push(`k${i}`);
    engine.doc = profileDoc({ favouriteLists: [{ id: 'l1', name: null, keys }] });
    const t = await opened(engine);
    await t.press('OK', 'OK');
    expect(t.engine.keyCalls.map((c) => [c.keys.length, c.limit, c.keys[0]])).toEqual([
      [100, 100, 'k0'],
      [100, 100, 'k100'],
      [50, 50, 'k200'],
    ]);
    expect(t.groups.channels.value).toHaveLength(250);
    expect(t.groups.channels.value![249]).toEqual({ key: 'k249', item: null, name: '' });
  });

  it('moves a list’s channel: one edit with its new place, the focus on it', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    await t.press('OK');
    expect(t.at()).toBe(`${CHANNEL_MENU} · actions 0`);
    expect(t.groups.menu.value).toEqual({ actions: ['move', 'remove', 'cancel'], row: null, channel: t.groups.channels.value![0] });
    await t.press('OK');
    expect(t.groups.moving.value).toEqual({ zone: 'channels', from: 0, at: 0 });
    await t.press('UP', 'DOWN', 'DOWN', 'DOWN');
    expect(t.keys()).toEqual(['d', 'b', 'a']);
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 2`);
    await t.press('OK');
    expect(t.engine.edits).toEqual([{ kind: 'favourite', change: { op: 'move', list: 'l1', key: 'a', to: 2 } }]);
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(t.keys()).toEqual(['d', 'b', 'a']);
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 2`);
    // The groups screen's list row read again under it.
    expect(t.groups.rows.value[0]).toEqual({ kind: 'list', list: { id: 'l1', name: 'Mine', keys: ['d', 'b', 'a'] } });
  });

  it('puts a moving channel back with Back, and a click puts it down', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    await t.press('DOWN', 'OK', 'OK', 'DOWN');
    expect(t.keys()).toEqual(['a', 'b', 'd']);
    await t.press('BACK');
    expect(t.keys()).toEqual(['a', 'd', 'b']);
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 1`);
    expect(t.engine.edits).toEqual([]);
    await t.press('OK', 'OK', 'UP');
    expect(await t.click('channels', 2)).toBe(true);
    expect(t.engine.edits).toEqual([{ kind: 'favourite', change: { op: 'move', list: 'l1', key: 'd', to: 0 } }]);
    expect(t.keys()).toEqual(['d', 'a', 'b']);
  });

  it('removes a list’s channel, the next one taking the focus; the last one leaves the list empty', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    await t.press('DOWN', 'OK', 'DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'favourite', change: { op: 'remove', list: 'l1', key: 'd' } }]);
    expect(t.keys()).toEqual(['a', 'b']);
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 1`);
    expect(t.groups.channels.value![1]!.key).toBe('b');
    await t.press('OK', 'DOWN', 'OK');
    expect(t.keys()).toEqual(['a']);
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 0`);
    // One channel: no Move.
    await t.press('OK');
    expect(t.groups.menu.value?.actions).toEqual(['remove', 'cancel']);
    await t.press('OK');
    expect(t.keys()).toEqual([]);
    expect((t.nav.top.zone('channels') as { count: number }).count).toBe(0);
    await t.press('BACK');
    expect(t.groups.rows.value[0]).toEqual({ kind: 'list', list: { id: 'l1', name: 'Mine', keys: [] } });
    // An empty list has no "Channels".
    await t.press('OK');
    expect(t.groups.menu.value?.actions).toEqual(['move', 'rename', 'delete', 'cancel']);
  });

  it('closes a channel’s menu with Cancel or Back, changing nothing', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    await t.press('OK', 'DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 0`);
    expect(t.groups.menu.value).toBeNull();
    await t.press('OK', 'BACK');
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels 0`);
    expect(t.engine.edits).toEqual([]);
  });

  it('waits with OK while anything is read or saved', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold.add('edit');
    await t.press('DOWN', 'DOWN', 'OK', 'DOWN', 'OK');
    expect(t.groups.pending.value).toBe(1);
    await t.press('OK');
    expect(t.at()).toBe('groups · rows 2');
    engine.release('edit');
    await flush();
    expect(t.groups.pending.value).toBe(0);
    await t.press('OK');
    expect(t.at()).toBe(`${GROUP_MENU} · actions 0`);
    // A list's channels: OK waits for their read too.
    await t.press('BACK', 'UP', 'UP');
    engine.hold.add('keys');
    await t.press('OK', 'OK', 'OK');
    expect(t.at()).toBe(`${GROUP_CHANNELS} · channels -1`);
    expect(t.groups.channels.value).toBeNull();
    engine.release('keys');
    await flush();
    await t.press('OK');
    expect(t.at()).toBe(`${CHANNEL_MENU} · actions 0`);
  });

  it('saves the edits one after another, each read after it; a read that a newer one replaced is dropped', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold.add('edit');
    // Hide "News", then (the menu is OK's once the edit is in) nothing else can start: hide it from the next read.
    await t.press('DOWN', 'DOWN', 'OK', 'DOWN', 'OK');
    engine.hold.delete('edit');
    engine.hold.add('read');
    engine.release('edit');
    await flush();
    // The edit's read is held; the screen still shows the old rows.
    expect(t.names()[2]).toBe('g:News');
    engine.release('read');
    await flush();
    expect(t.names()[2]).toBe('g:News!');
    // Two reads: the older answer is dropped.
    await t.press('BACK');
    t.groups.open();
    await t.press('BACK');
    t.groups.open();
    expect(engine.held.read).toHaveLength(2);
    t.engine.doc = { ...t.engine.doc, favouriteLists: [] } as ProfileDoc;
    engine.held.read[1]!.go();
    await flush();
    expect(t.names()[0]).toBe('g:News!');
    // The older read answers last, with the lists back: dropped.
    t.engine.doc = profileDoc();
    engine.held.read[0]!.go();
    await flush();
    expect(t.names()[0]).toBe('g:News!');
  });

  it('saves an edit made before the screen went, telling the live screen; nothing reads after dispose', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold.add('edit');
    await t.press('DOWN', 'DOWN', 'OK', 'DOWN', 'OK', 'BACK');
    t.groups.dispose();
    const reads = engine.profileCalls;
    engine.release('edit');
    await flush();
    expect(engine.doc.hiddenGroups).toEqual([{ src: 's1', name: 'News' }]);
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(engine.profileCalls).toBe(reads);
    // Disposed: opening does nothing, and a second dispose neither.
    t.groups.open();
    t.groups.dispose();
    expect(t.at()).toBe('settings · items 0');
  });

  it('tells the live screen nothing when an edit is refused or fails, and reads the rows again all the same', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.failEdit = true;
    const reads = engine.profileCalls;
    await t.press('DOWN', 'DOWN', 'OK', 'DOWN', 'OK');
    expect(warn).toHaveBeenCalledWith('The channel groups were not saved', expect.any(Error));
    expect(t.changed).not.toHaveBeenCalled();
    expect(engine.profileCalls).toBe(reads + 1);
    engine.failEdit = false;
    // A group the provider renamed meanwhile: "show" changes nothing (false).
    engine.doc = profileDoc({ hiddenGroups: [{ src: 's1', name: 'Kids' }] });
    await t.press('OK', 'DOWN', 'OK');
    expect(engine.edits[1]).toEqual({ kind: 'group', change: { op: 'hide', group: { src: 's1', name: 'News' } } });
    expect(t.changed).toHaveBeenCalledTimes(1);
  });

  it('keeps a list’s channels when their read fails', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.failKeys = true;
    await t.press('OK', 'OK');
    expect(warn).toHaveBeenCalledWith("A list's channels could not be read", expect.any(Error));
    expect(t.groups.channels.value).toBeNull();
  });

  it('shows a list no longer stored with no channel', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    await t.press('OK', 'OK');
    // The list goes elsewhere (another screen's edit), then a channel edit here reads it again.
    engine.doc = profileDoc({ favouriteLists: [{ id: 'l2', name: null, keys: ['c'] }], favourites: [ref('a', 'alpha'), ref('c', 'gamma')] });
    await t.press('OK', 'DOWN', 'OK');
    expect(t.groups.list.value).toEqual({ id: 'l1', name: 'Mine', keys: [] });
    expect(t.groups.channels.value).toEqual([]);
  });
});

describe('the profile edits the screen makes (the query worker’s, step 35a)', () => {
  it('stores a group order that names the hidden groups too', () => {
    const order: GroupRef[] = [
      { src: 's1', name: 'Sports' },
      { src: 's2', name: 'Kids' },
    ];
    const next = applyProfileEdit(profileDoc({ hiddenGroups: [order[1]] }), { kind: 'group', change: { op: 'order', groups: order } });
    expect(next?.groupOrder).toEqual(order);
  });
});
