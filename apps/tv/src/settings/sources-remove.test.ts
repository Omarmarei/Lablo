import type { LoadedProfile, ProfileDoc, ProfileEdit, SourceMeta, StoredSource } from '@lablo/data';
import { emptyProfile } from '@lablo/data';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripIsolates } from '@lablo/core';
import { appI18n } from '../i18n';
import { createFakeLoader } from '../onboarding/loader';
import { statusText } from './SettingsScreen';
import { ADD_SCREEN } from './source-add';
import type { SourcesEngine, SourcesOptions } from './sources-state';
import { REMOVE_CANCEL, REMOVE_CONFIRM, SOURCE_MENU, SOURCE_REMOVE, SOURCES_SCREEN, createSourcesList, menuActions } from './sources-state';

/**
 * A source's menu, its removal and the header's two add buttons (RELAY step 40f), over a fake
 * engine. The data side (what a removal takes) is `source-removal.test.ts`; the add form is
 * `source-add.test.ts`.
 */

const sources: StoredSource[] = [
  { id: 's1', type: 'xtream', name: 'My panel', account: { base: 'http://panel.test', username: 'u', password: 'p' }, added: 1 },
  { id: 's2', type: 'm3u', name: 'List', url: 'http://lists.test/a.m3u', added: 2 },
  { id: 's3', type: 'm3u-file', name: 'Phone', added: 3 },
];
const fav = (src: string, n: number): ProfileDoc['favourites'][number] => ({ key: `x:${src}:live:${n}`, src, kind: 'live', normName: `ch ${n}`, added: n, missingSince: null });

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

class FakeEngine implements SourcesEngine {
  sources: StoredSource[] = sources.slice();
  favourites = [fav('s1', 1), fav('s1', 2), fav('s2', 3)];
  readonly removed: string[] = [];
  readonly edits: ProfileEdit[] = [];
  fail = false;
  /** Holds each removal until `release()`. */
  hold = false;
  private held: (() => void)[] = [];

  profile(): Promise<LoadedProfile | null> {
    return Promise.resolve({ doc: { ...emptyProfile(), sources: this.sources, favourites: this.favourites } as LoadedProfile['doc'], newer: false, migratedFrom: null });
  }
  sourceStatus(): Promise<SourceMeta[]> {
    return Promise.resolve([]);
  }
  blocked(urls: string[]): Promise<boolean[]> {
    return Promise.resolve(urls.map(() => false));
  }
  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.edits.push(edit);
    return Promise.resolve(true);
  }
  removeSource(src: string): Promise<boolean> {
    this.removed.push(src);
    const run = (): boolean => {
      if (this.fail) throw new Error('A catalog refresh is already running');
      this.sources = this.sources.filter((s) => s.id !== src);
      return true;
    };
    if (!this.hold) {
      try {
        return Promise.resolve(run());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise<boolean>((resolve, reject) => {
      this.held.push(() => {
        try {
          resolve(run());
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  release(): void {
    for (const run of this.held.splice(0)) run();
  }
}

const keys = { platform: { textKey: () => null, onSoftKeyboard: () => () => undefined }, find: () => null } as unknown as NonNullable<SourcesOptions['login']>;

function setup(extra: Partial<SourcesOptions> = {}, engine = new FakeEngine()) {
  const nav = createNavigator({
    root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 2 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const list = createSourcesList({ nav, engine, ...extra });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { nav, engine, list, at };
}

async function opened(extra: Partial<SourcesOptions> = {}, engine = new FakeEngine()) {
  const t = setup(extra, engine);
  t.list.open();
  await flush();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a source’s menu', () => {
  it('offers "Change server and login" only when the screen has the login form, and never for a phone’s file', async () => {
    const row = (type: StoredSource['type']) => ({ type }) as never;
    expect(menuActions(row('xtream'), true)).toEqual(['edit', 'remove', 'cancel']);
    expect(menuActions(row('m3u'), true)).toEqual(['edit', 'remove', 'cancel']);
    expect(menuActions(row('m3u-file'), true)).toEqual(['remove', 'cancel']);
    expect(menuActions(row('xtream'), false)).toEqual(['remove', 'cancel']);
    const withForm = await opened({ login: keys });
    withForm.nav.handle('OK');
    expect(withForm.list.menu.value!.row.id).toBe('s1');
    expect(withForm.list.menu.value!.actions).toEqual(['edit', 'remove', 'cancel']);
    expect(withForm.at()).toBe(`${SOURCE_MENU} · actions 0`);
  });

  it('closes on Back and on "Cancel", changing nothing; "Change server and login" opens the form for that source', async () => {
    const t = await opened({ login: keys });
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    t.nav.handle('BACK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 1`);
    expect(t.list.menu.value).toBeNull();
    t.nav.handle('OK');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 1`);
    expect(t.engine.removed).toEqual([]);
    t.nav.handle('OK');
    t.nav.handle('OK');
    expect(t.list.form!.source.value!.id).toBe('s2');
  });
});

describe('a source’s removal', () => {
  it('asks first, names the favourites that go, and has "Cancel" focused; Back and "Cancel" remove nothing', async () => {
    const t = await opened();
    t.nav.handle('OK');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCE_REMOVE} · actions ${REMOVE_CANCEL}`);
    expect(t.list.removing.value).toMatchObject({ row: { id: 's1' }, favourites: 2 });
    t.nav.handle('BACK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 0`);
    expect(t.list.removing.value).toBeNull();
    t.nav.handle('OK');
    t.nav.handle('OK');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 0`);
    expect(t.engine.removed).toEqual([]);
    expect(t.list.rows.value.map((r) => r.id)).toEqual(['s1', 's2', 's3']);
    // A source with no favourites says none; a phone's file is asked the same way.
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    t.nav.handle('OK');
    expect(t.list.removing.value).toMatchObject({ row: { id: 's3' }, favourites: 0 });
  });

  it('removes on "Remove": "Removing…" on the row until the engine is done, the rows then read again, the screens told once', async () => {
    const changed = vi.fn();
    const engine = new FakeEngine();
    engine.hold = true;
    const t = await opened({ changed }, engine);
    t.nav.handle('OK');
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    expect(t.at()).toBe(`${SOURCE_REMOVE} · actions ${REMOVE_CONFIRM}`);
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 0`);
    expect(engine.removed).toEqual(['s1']);
    expect(t.list.rows.value[0]!.answer).toEqual({ state: 'removing' });
    expect(t.list.pending.value).toBeGreaterThan(0);
    // A row being removed has no menu.
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 0`);
    expect(changed).not.toHaveBeenCalled();
    engine.release();
    await flush();
    expect(t.list.rows.value.map((r) => [r.id, r.answer])).toEqual([
      ['s2', null],
      ['s3', null],
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(t.list.pending.value).toBe(0);
  });

  it('runs inside `quiet` when the app gives one', async () => {
    const order: string[] = [];
    const calls: number[] = [];
    const quiet = <T>(job: () => Promise<T>): Promise<T> => {
      calls.push(1);
      order.push('held');
      return job().then((value) => {
        order.push('done');
        return value;
      });
    };
    const t = await opened({ quiet });
    t.nav.handle('OK');
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    await flush();
    expect(calls).toHaveLength(1);
    expect(order).toEqual(['held', 'done']);
    expect(t.engine.removed).toEqual(['s1']);
  });

  it('keeps the row with its failure line when the engine refuses (a refresh running), and the screens are not told', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const changed = vi.fn();
    const engine = new FakeEngine();
    engine.fail = true;
    const t = await opened({ changed }, engine);
    t.nav.handle('OK');
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    expect(t.list.rows.value.map((r) => r.id)).toEqual(['s1', 's2', 's3']);
    expect(t.list.rows.value[0]!.answer).toMatchObject({ state: 'failed' });
    // OK on it opens the menu again: it can be tried again.
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCE_MENU} · actions 0`);
  });
});

describe('the header’s add buttons (step 40f)', () => {
  const add = { loader: createFakeLoader() };

  it('has "Add a source" after "Add from your phone", each its own header button', async () => {
    const opens: string[] = [];
    const t = await opened({ addFromPhone: () => opens.push('phone'), add, login: keys });
    expect(t.list.canAdd).toBe(true);
    expect(t.list.phone).toBe(true);
    expect(t.list.add).not.toBeNull();
    t.nav.handle('UP');
    expect(t.at()).toBe('sources · header 0');
    t.nav.handle('OK');
    expect(opens).toEqual(['phone']);
    t.nav.handle('RIGHT');
    expect(t.at()).toBe('sources · header 1');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${ADD_SCREEN} · fields 0`);
    expect(t.list.add!.shown.value).toBe(true);
  });

  it('has "Add a source" alone as the first button when the app cannot pair', async () => {
    const t = await opened({ add, login: keys });
    expect(t.list.phone).toBe(false);
    t.nav.handle('UP');
    expect(t.at()).toBe('sources · header 0');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${ADD_SCREEN} · fields 0`);
  });

  it('has no such button without the keyboard (the login options), and no header at all without either add', async () => {
    const none = await opened({ add });
    expect(none.list.add).toBeNull();
    expect(none.list.canAdd).toBe(false);
    const plain = await opened();
    expect(plain.list.canAdd).toBe(false);
  });

  it('reads the rows again and tells the screens once a source is added', async () => {
    const changed = vi.fn();
    const t = await opened({ add: { loader: createFakeLoader({ stepMs: 0, setTimeout: (run: () => void) => void run() }) }, login: keys, changed });
    t.nav.handle('UP');
    t.nav.handle('OK');
    const form = t.list.add!;
    form.setValue('server', 'panel.test');
    form.setValue('username', 'u');
    form.setValue('password', 'p');
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    await flush();
    expect(form.view.value).toBe('done');
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('the words of the removal (step 40f)', () => {
  const en = appI18n('en-US', { isolate: false });
  const ar = appI18n('ar-SA');

  it('says "Removing…" on the row while the engine works', () => {
    const row = { id: 's1', name: 'A', type: 'xtream', host: 'a.test', checkedAt: null, blocked: false, storage: false, needs: null, answer: { state: 'removing' } } as const;
    expect(statusText(en, row)).toBe('Removing…');
    expect(statusText(ar, row)).toBe('جارٍ الإزالة…');
  });

  it('counts the favourites that go in English: none are not mentioned, one, many', () => {
    expect(en.t('sources.removeBody', { n: 0 })).toBe('Its channels, places and settings go from this TV. Adding it again starts fresh.');
    expect(en.t('sources.removeBody', { n: 1 })).toContain('and one favourite with them');
    expect(en.t('sources.removeBody', { n: 12 })).toContain('and 12 favourites with them');
    expect(en.t('sources.removeTitle', { name: 'My panel' })).toBe('Remove My panel?');
  });

  it('has the six Arabic forms of the count', () => {
    const body = (n: number): string => stripIsolates(ar.t('sources.removeBody', { n }));
    expect(body(0)).not.toContain('مفضل');
    expect(body(1)).toContain('مفضلة واحدة');
    expect(body(2)).toContain('مفضلتان');
    expect(body(3)).toContain('3 مفضلات');
    expect(body(11)).toContain('11 مفضلةً');
    expect(body(100)).toContain('100 مفضلة.');
  });
});
