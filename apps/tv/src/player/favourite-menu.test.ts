import { signal } from '@preact/signals';
import type { CatalogItem } from '@lablo/core';
import type { ProfileDoc, ProfileEdit } from '@lablo/data';
import { applyProfileEdit, emptyProfile } from '@lablo/data';
import type { FavouriteList } from '@lablo/data/client';
import { MAX_FAVOURITE_LISTS, favouriteListsOf } from '@lablo/data/client';
import type { Intent } from '@lablo/platform-api';
import type { EditableLike } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAVOURITES_SCREEN, LIST_NAME_FIELD, NEW_CANCEL, NEW_CREATE, NEW_LIST_SCREEN, createFavouriteMenu, favouriteItem, newListId } from './favourite-menu';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

function channel(n: number): CatalogItem {
  return {
    key: `x:s1:live:${n}`,
    src: 's1',
    kind: 'live',
    name: `Channel ${n}`,
    normName: `channel ${n}`,
    group: 'News',
    url: `http://panel.test/live/u/p/${n}.ts`,
    logo: null,
    epgId: n % 2 === 0 ? `ch${n}.tv` : null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A panel over a player screen, its edits applied to a real profile document (`applyProfileEdit`),
 * and the live screen's read after each one (`changed`) giving the lists the panel shows.
 */
function setup(options: { lists?: FavouriteList[]; answer?: (edit: ProfileEdit) => Promise<boolean> | null } = {}) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  nav.push({ id: 'player', zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 5 }] });
  let doc: ProfileDoc = { ...emptyProfile(), favouriteLists: options.lists ?? [] } as ProfileDoc;
  // (The lists' pool: every key of the given lists, as an edit keeps it.)
  for (const list of options.lists ?? []) for (const key of list.keys) doc.favourites.push({ key, src: 's1', kind: 'live', normName: '', added: 1, missingSince: null });
  const lists = signal<readonly FavouriteList[]>(favouriteListsOf(doc));
  const edits: ProfileEdit[] = [];
  const edit = vi.fn((e: ProfileEdit): Promise<boolean> => {
    edits.push(e);
    const own = options.answer?.(e);
    if (own !== undefined && own !== null) return own;
    const next = applyProfileEdit(doc, e);
    if (next === null) return Promise.resolve(false);
    doc = next;
    return Promise.resolve(true);
  });
  const changed = vi.fn(() => {
    lists.value = favouriteListsOf(doc);
    return Promise.resolve();
  });
  const input: EditableLike & { focused: number } = {
    focused: 0,
    focus() {
      this.focused += 1;
    },
    blur: () => undefined,
  };
  const closed = vi.fn();
  const stop = vi.fn();
  const menu = createFavouriteMenu({
    nav,
    edit,
    lists,
    changed,
    platform: { textKey: () => null, onSoftKeyboard: () => () => undefined },
    find: (id) => (id === LIST_NAME_FIELD ? input : null),
    now: () => NOW,
    closed,
    stop,
  });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const zoneCount = (): number => (menu.screen.value!.zone('lists') as { count: number }).count;
  return { nav, menu, lists, edits, edit, changed, input, closed, stop, at, press, zoneCount, doc: () => doc };
}

describe('the favourites panel (RELAY step 35c)', () => {
  it('stores the facts re-matching needs, and picks a list id none of the lists has', () => {
    expect(favouriteItem(channel(4), 7)).toEqual({ key: 'x:s1:live:4', src: 's1', kind: 'live', normName: 'channel 4', group: 'News', epgId: 'ch4.tv', added: 7 });
    expect(favouriteItem(channel(3), 7).epgId).toBeNull();
    const id = `l${NOW.toString(36)}`;
    expect(newListId([], NOW)).toBe(id);
    expect(newListId([{ id: 'other', name: null, keys: [] }], NOW)).toBe(id);
    expect(newListId([{ id, name: null, keys: [] }], NOW)).toBe(`${id}-1`);
    expect(newListId([{ id, name: null, keys: [] }, { id: `${id}-1`, name: null, keys: [] }], NOW)).toBe(`${id}-2`);
    expect(id.length).toBeLessThanOrEqual(32);
  });

  it('makes "Favourites" with the channel in it on the first OK, when there is no list yet', async () => {
    const t = setup();
    t.menu.show(channel(4));
    expect(t.at()).toBe(`${FAVOURITES_SCREEN} · lists 0`);
    expect(t.menu.item.value?.key).toBe('x:s1:live:4');
    // "Favourites" (to make), then "New list".
    expect(t.menu.rows()).toBe(2);
    expect(t.zoneCount()).toBe(2);
    await t.press('OK');
    expect(t.edits).toEqual([{ kind: 'favourite', change: { op: 'newList', id: `l${NOW.toString(36)}`, name: null, item: favouriteItem(channel(4), NOW) } }]);
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(t.lists.value).toEqual([{ id: `l${NOW.toString(36)}`, name: null, keys: ['x:s1:live:4'] }]);
    expect(t.menu.rows()).toBe(2);
    expect(t.menu.pending.value).toBe(0);
    expect(t.menu.problem.value).toBeNull();
    // OK again on it: the channel comes out (the list stays, empty).
    await t.press('OK');
    expect(t.edits[1]).toEqual({ kind: 'favourite', change: { op: 'remove', list: `l${NOW.toString(36)}`, key: 'x:s1:live:4' } });
    expect(t.lists.value[0]!.keys).toEqual([]);
  });

  it('adds the channel to a list without it and takes it out of one with it', async () => {
    const t = setup({ lists: [{ id: 'a', name: 'Sport', keys: ['x:s1:live:1'] }, { id: 'b', name: null, keys: ['x:s1:live:4'] }] });
    t.menu.show(channel(4));
    expect(t.menu.rows()).toBe(3);
    await t.press('OK');
    expect(t.edits[0]).toEqual({ kind: 'favourite', change: { op: 'add', list: 'a', item: favouriteItem(channel(4), NOW) } });
    expect(t.lists.value[0]!.keys).toEqual(['x:s1:live:1', 'x:s1:live:4']);
    await t.press('DOWN', 'OK');
    expect(t.edits[1]).toEqual({ kind: 'favourite', change: { op: 'remove', list: 'b', key: 'x:s1:live:4' } });
    expect(t.lists.value[1]!.keys).toEqual([]);
    expect(t.doc().favourites.map((f) => f.key)).toEqual(['x:s1:live:1', 'x:s1:live:4']);
  });

  it('waits while an edit runs: a second OK does nothing', async () => {
    let release: (ok: boolean) => void = () => undefined;
    const t = setup({ answer: () => new Promise<boolean>((resolve) => (release = resolve)) });
    t.menu.show(channel(4));
    await t.press('OK');
    expect(t.menu.pending.value).toBe(1);
    await t.press('OK', 'DOWN', 'OK');
    expect(t.edits.length).toBe(1);
    expect(t.nav.top.id).toBe(FAVOURITES_SCREEN);
    release(false);
    await flush();
    expect(t.menu.pending.value).toBe(0);
  });

  it('says why an edit changed nothing: a full list, a list not made; a take-out needs no word', async () => {
    const t = setup({ lists: [{ id: 'a', name: 'Sport', keys: [] }], answer: () => Promise.resolve(false) });
    t.menu.show(channel(4));
    await t.press('OK');
    expect(t.menu.problem.value).toBe('full');
    expect(t.changed).not.toHaveBeenCalled();
    t.menu.close();
    const u = setup({ answer: () => Promise.resolve(false) });
    u.menu.show(channel(4));
    await u.press('OK');
    expect(u.menu.problem.value).toBe('refused');
    // The next edit clears the word.
    await u.press('OK');
    expect(u.menu.problem.value).toBe('refused');
    const v = setup({ lists: [{ id: 'a', name: 'Sport', keys: ['x:s1:live:4'] }], answer: () => Promise.resolve(false) });
    v.menu.show(channel(4));
    await v.press('OK');
    expect(v.edits[0]!).toMatchObject({ change: { op: 'remove' } });
    expect(v.menu.problem.value).toBeNull();
  });

  it("logs an edit that failed, and drops an answer that comes after the panel closed", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup({ answer: () => Promise.reject(new Error('no IndexedDB')) });
    t.menu.show(channel(4));
    await t.press('OK');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t.menu.pending.value).toBe(0);
    let release: (ok: boolean) => void = () => undefined;
    const u = setup({ answer: () => new Promise<boolean>((resolve) => (release = resolve)) });
    u.menu.show(channel(4));
    await u.press('OK');
    u.menu.close();
    release(false);
    await flush();
    expect(u.menu.problem.value).toBeNull();
    expect(u.menu.pending.value).toBe(0);
  });

  it('makes a named list with the channel from the form, and focuses it', async () => {
    const t = setup({ lists: [{ id: 'a', name: 'Sport', keys: [] }] });
    t.menu.show(channel(4));
    await t.press('DOWN', 'OK');
    expect(t.at()).toBe(`${NEW_LIST_SCREEN} · field 0`);
    expect(t.menu.text.value).toBe('');
    await t.press('OK');
    expect(t.input.focused).toBe(1);
    t.menu.setText('  Kids ');
    t.nav.top.focus('actions', NEW_CREATE);
    await t.press('OK');
    // The worker trims the name.
    expect(t.edits).toEqual([{ kind: 'favourite', change: { op: 'newList', id: `l${NOW.toString(36)}`, name: '  Kids ', item: favouriteItem(channel(4), NOW) } }]);
    expect(t.lists.value.map((l) => [l.name, l.keys])).toEqual([
      ['Sport', []],
      ['Kids', ['x:s1:live:4']],
    ]);
    expect(t.at()).toBe(`${FAVOURITES_SCREEN} · lists 1`);
    expect(t.zoneCount()).toBe(3);
  });

  it('names a list made with a blank name "Favourites"; Cancel and Back leave the form', async () => {
    const t = setup({ lists: [{ id: 'a', name: 'Sport', keys: [] }] });
    t.menu.show(channel(4));
    await t.press('DOWN', 'OK');
    t.menu.setText('  　 ');
    t.nav.top.focus('actions', NEW_CREATE);
    await t.press('OK');
    expect(t.edits[0]).toMatchObject({ change: { op: 'newList', name: null } });
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.nav.top.id).toBe(NEW_LIST_SCREEN);
    t.menu.setText('x');
    await t.press('OK');
    expect(t.menu.text.value).toBe('x');
    t.nav.top.focus('actions', NEW_CANCEL);
    await t.press('OK');
    expect(t.at()).toBe(`${FAVOURITES_SCREEN} · lists 2`);
    await t.press('OK');
    expect(t.menu.text.value).toBe('');
    await t.press('BACK');
    expect(t.nav.top.id).toBe(FAVOURITES_SCREEN);
    expect(t.edits.length).toBe(1);
  });

  it('offers no "New list" at the most lists', async () => {
    const full: FavouriteList[] = [];
    for (let i = 0; i < MAX_FAVOURITE_LISTS; i += 1) full.push({ id: `l${i}`, name: `List ${i}`, keys: [] });
    const t = setup({ lists: full });
    t.menu.show(channel(4));
    expect(t.menu.rows()).toBe(MAX_FAVOURITE_LISTS);
    t.menu.screen.value!.focus('lists', MAX_FAVOURITE_LISTS - 1);
    await t.press('OK');
    expect(t.edits[0]).toMatchObject({ change: { op: 'add', list: `l${MAX_FAVOURITE_LISTS - 1}` } });
  });

  it('closes on Back (and the form first), and closes the player too on STOP', async () => {
    const t = setup();
    t.menu.show(channel(4));
    // Shown once: a second show changes nothing.
    t.menu.show(channel(5));
    expect(t.menu.item.value?.key).toBe('x:s1:live:4');
    await t.press('DOWN', 'OK');
    expect(t.nav.top.id).toBe(NEW_LIST_SCREEN);
    await t.press('BACK');
    expect(t.nav.top.id).toBe(FAVOURITES_SCREEN);
    await t.press('BACK');
    expect(t.nav.top.id).toBe('player');
    expect(t.menu.screen.value).toBeNull();
    expect(t.menu.item.value).toBeNull();
    expect(t.closed).toHaveBeenCalledTimes(1);
    t.menu.close();
    expect(t.closed).toHaveBeenCalledTimes(1);
    t.menu.show(channel(4));
    await t.press('DOWN', 'OK');
    // Closed from outside with the form open (the player closes): both go.
    t.menu.close();
    expect(t.nav.top.id).toBe('player');
    t.menu.show(channel(4));
    await t.press('STOP');
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.nav.top.id).toBe('player');
    // Other keys are the navigator's.
    t.menu.show(channel(4));
    await t.press('PLAY_PAUSE');
    expect(t.nav.top.id).toBe(FAVOURITES_SCREEN);
    t.menu.dispose();
  });
});
