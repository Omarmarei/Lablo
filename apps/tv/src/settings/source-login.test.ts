import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import type { IngestResult, LinkSource, LoadedProfile, ProfileEdit, SourceMeta, SourceRecord, StoredSource } from '@lablo/data';
import { emptyProfile } from '@lablo/data';
import type { KeyLike, TextKey } from '@lablo/platform-api';
import type { EditableLike, ItemBinding } from '@lablo/ui';
import { Button, Dialog, TextField, bindFocus, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import { LoadError } from '../onboarding/loader';
import { LoginFormView, SourceItem, SourcesPage, loginHint, loginLabel, statusText, warns } from './SettingsScreen';
import type { LoginSource } from './source-login';
import { LOGIN_CANCEL, LOGIN_FIELDS, LOGIN_SAVE, LOGIN_SCREEN, checkLogin, createLoginForm, loginFieldId, loginValues } from './source-login';
import type { SourceRow, SourcesEngine } from './sources-state';
import { SOURCES_SCREEN, SOURCE_MENU, createSourcesList } from './sources-state';

/**
 * A source's login given again (RELAY step 32d4b): the form's checks and keys, the sources list's
 * rows without a login, its save and the refresh's answer, over a fake engine, and the rows and
 * the form as drawn, called as functions. The e2e drives it in the app against the real API.
 */

const BARE_PANEL: StoredSource = { id: 's1', type: 'xtream', name: 'My panel', account: null, base: 'http://panel.test:8080', added: 11 };
const BARE_LIST: StoredSource = { id: 's2', type: 'm3u', name: 'قائمتي', url: null, origin: 'https://lists.test:8443', added: 22 };
const FILE: StoredSource = { id: 's3', type: 'm3u-file', name: 'Phone', added: 33 };
const KEPT: StoredSource = { id: 's4', type: 'm3u', name: 'Kept', url: 'http://kept.test/a.m3u', added: 44 };
const BARE_NO_ORIGIN: StoredSource = { id: 's5', type: 'm3u', name: 'Odd', url: null, origin: '', added: 55 };

/** 2026-11-19 10:00 UTC. */
const T = Date.UTC(2026, 10, 19, 10);

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the login form’s pure parts', () => {
  it('asks an Xtream source its server, user name and password, a playlist its link', () => {
    expect(LOGIN_FIELDS).toEqual({ xtream: ['server', 'username', 'password'], m3u: ['playlist'] });
    expect(loginFieldId('password')).toBe('source-login-password');
    expect(LOGIN_SCREEN).toBe('source-login');
    expect([LOGIN_SAVE, LOGIN_CANCEL]).toEqual([0, 1]);
  });

  it('fills in the server a source kept, or the login it was given last', () => {
    expect(loginValues(BARE_PANEL as LoginSource)).toEqual({ server: 'http://panel.test:8080', username: '', password: '' });
    expect(loginValues({ id: 's1', type: 'xtream', name: 'P', account: { base: 'http://b.test', username: 'ann', password: 'pw' }, added: 1 })).toEqual({
      server: 'http://b.test',
      username: 'ann',
      password: 'pw',
    });
    expect(loginValues(BARE_LIST as LoginSource)).toEqual({ playlist: '' });
    expect(loginValues(KEPT as LoginSource)).toEqual({ playlist: 'http://kept.test/a.m3u' });
  });

  it('checks as onboarding does: every field required, a server and a link that are http(s) addresses', () => {
    expect(checkLogin(BARE_PANEL as LoginSource, { server: '', username: ' ', password: '' })).toEqual({
      problems: { server: 'required', username: 'required', password: 'required' },
      record: null,
    });
    expect(checkLogin(BARE_PANEL as LoginSource, { server: 'ftp://panel.test', username: 'u', password: 'p' }).problems).toEqual({ server: 'url' });
    expect(checkLogin(BARE_PANEL as LoginSource, { server: 'panel test', username: 'u', password: 'p' }).problems).toEqual({ server: 'spaces' });
    expect(checkLogin(BARE_LIST as LoginSource, { playlist: '' })).toEqual({ problems: { playlist: 'required' }, record: null });
    expect(checkLogin(BARE_LIST as LoginSource, { playlist: 'lists.test/a b.m3u' }).problems).toEqual({ playlist: 'spaces' });
    expect(checkLogin(BARE_LIST as LoginSource, { playlist: 'ftp://lists.test/a.m3u' }).problems).toEqual({ playlist: 'url' });
    // Only its own fields: what another kind's fields hold is never read.
    expect(checkLogin(BARE_LIST as LoginSource, { playlist: 'lists.test/a.m3u', server: '', epg: 'not a link' }).problems).toEqual({});
  });

  it('gives the source with its login under its own id, name and time added, the login trimmed and the links as onboarding writes them', () => {
    expect(checkLogin(BARE_PANEL as LoginSource, { server: 'Panel.Test:8080/', username: ' ann ', password: 'pw ' })).toEqual({
      problems: {},
      record: { id: 's1', type: 'xtream', name: 'My panel', account: { base: 'http://panel.test:8080', username: 'ann', password: 'pw' }, added: 11 },
    });
    expect(checkLogin(BARE_LIST as LoginSource, { playlist: ' Lists.Test:8443/get.php?username=U&password=P ' }).record).toEqual({
      id: 's2',
      type: 'm3u',
      name: 'قائمتي',
      url: 'http://lists.test:8443/get.php?username=U&password=P',
      added: 22,
    });
  });
});

/** The TV's keyboard and the fields' inputs, as the guides' tests fake them. */
function keyboard() {
  const inputs: Record<string, EditableLike & { focused: number }> = {};
  const find = vi.fn((id: string) => {
    inputs[id] ??= {
      focused: 0,
      focus() {
        this.focused += 1;
      },
      blur: () => undefined,
    };
    return inputs[id]!;
  });
  const platform = {
    textKey: (event: KeyLike): TextKey | null => (event.key === 'Enter' ? 'done' : event.key === 'Escape' ? 'close' : null),
    onSoftKeyboard: () => () => undefined,
  };
  return { find, platform, inputs };
}

function navigator() {
  const nav = createNavigator({
    root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 2 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { nav, at };
}

describe('createLoginForm', () => {
  function setup() {
    const { nav, at } = navigator();
    const keys = keyboard();
    const saved: SourceRecord[] = [];
    const form = createLoginForm({ nav, platform: keys.platform, find: keys.find, now: () => 10_000, save: (record) => saved.push(record) });
    return { nav, at, form, saved, ...keys };
  }

  it('opens over the screen on the first empty field: the user name for a panel whose server it kept', () => {
    const t = setup();
    t.form.open(BARE_PANEL as LoginSource);
    expect(t.at()).toBe(`${LOGIN_SCREEN} · fields 1`);
    expect(t.form.source.value).toBe(BARE_PANEL);
    expect(t.form.values.value).toEqual({ server: 'http://panel.test:8080', username: '', password: '' });
    expect(t.nav.top.zone('fields')).toMatchObject({ count: 3, axis: 'vertical', neighbours: { down: 'actions' } });
    expect(t.nav.top.zone('actions')).toMatchObject({ count: 2, axis: 'horizontal', neighbours: { up: 'fields' } });
  });

  it('opens a playlist on its link, and a source with every field filled on the first', () => {
    const t = setup();
    t.form.open(BARE_LIST as LoginSource);
    expect(t.at()).toBe(`${LOGIN_SCREEN} · fields 0`);
    expect((t.nav.top.zone('fields') as { count: number }).count).toBe(1);
    t.nav.handle('BACK');
    t.form.open({ id: 's1', type: 'xtream', name: 'P', account: { base: 'http://b.test', username: 'ann', password: 'pw' }, added: 1 });
    expect(t.at()).toBe(`${LOGIN_SCREEN} · fields 0`);
  });

  it('edits a field on OK, its own input', () => {
    const t = setup();
    t.form.open(BARE_PANEL as LoginSource);
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.find).toHaveBeenCalledWith('source-login-password');
    expect(t.form.editor.editing.value).toBe('source-login-password');
  });

  it('refuses what onboarding refuses: the problems shown, the focus on the first, nothing saved; a change clears its own problem', () => {
    const t = setup();
    t.form.open(BARE_PANEL as LoginSource);
    t.form.setValue('server', 'panel test');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    expect(t.at()).toBe(`${LOGIN_SCREEN} · actions 0`);
    t.nav.handle('OK');
    expect(t.form.problems.value).toEqual({ server: 'spaces', username: 'required', password: 'required' });
    expect(t.at()).toBe(`${LOGIN_SCREEN} · fields 0`);
    expect(t.saved).toEqual([]);
    t.form.setValue('username', 'ann');
    expect(t.form.problems.value).toEqual({ server: 'spaces', password: 'required' });
    // A field with no problem changes nothing else.
    t.form.setValue('username', 'ann2');
    expect(t.form.problems.value).toEqual({ server: 'spaces', password: 'required' });
    expect(t.form.values.value).toEqual({ server: 'panel test', username: 'ann2', password: '' });
    t.form.setValue('server', 'panel.test:8080');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${LOGIN_SCREEN} · fields 2`);
  });

  it('saves: the form closes, then the source with its login is given to `save`', () => {
    const t = setup();
    t.form.open(BARE_PANEL as LoginSource);
    t.form.setValue('username', 'ann');
    t.form.setValue('password', 'pw');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.form.source.value).toBeNull();
    expect(t.saved).toEqual([{ id: 's1', type: 'xtream', name: 'My panel', account: { base: 'http://panel.test:8080', username: 'ann', password: 'pw' }, added: 11 }]);
  });

  it('closes on Cancel and on Back, saving nothing', () => {
    const t = setup();
    t.form.open(BARE_LIST as LoginSource);
    t.form.setValue('playlist', 'lists.test/a.m3u');
    t.nav.handle('DOWN');
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.form.source.value).toBeNull();
    t.form.open(BARE_LIST as LoginSource);
    // Opened again: what was typed before is gone.
    expect(t.form.values.value).toEqual({ playlist: '' });
    t.nav.handle('BACK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.form.source.value).toBeNull();
    expect(t.saved).toEqual([]);
  });

  it('opens with no problems left from the last time', () => {
    const t = setup();
    t.form.open(BARE_LIST as LoginSource);
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.form.problems.value).toEqual({ playlist: 'required' });
    t.nav.handle('BACK');
    t.form.open(BARE_LIST as LoginSource);
    expect(t.form.problems.value).toEqual({});
  });
});

const profileOf = (sources: StoredSource[]): LoadedProfile => ({ doc: { ...emptyProfile(), sources } as LoadedProfile['doc'], newer: false, migratedFrom: null });

/** The data engine: the profile's sources, edited as the query worker does. */
class FakeEngine implements SourcesEngine {
  sources: StoredSource[] = [BARE_PANEL, BARE_LIST, FILE, KEPT];
  metas: SourceMeta[] = [];
  readonly edits: ProfileEdit[] = [];
  editFails = false;
  profileReads = 0;

  profile(): Promise<LoadedProfile | null> {
    this.profileReads += 1;
    return Promise.resolve(profileOf(this.sources));
  }
  sourceStatus(): Promise<SourceMeta[]> {
    return Promise.resolve(this.metas);
  }
  blocked(urls: string[]): Promise<boolean[]> {
    return Promise.resolve(urls.map(() => false));
  }
  removeSource(): Promise<boolean> {
    return Promise.resolve(false);
  }
  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.edits.push(edit);
    if (this.editFails) return Promise.reject(new Error('no query worker'));
    if (edit.kind === 'source') this.sources = this.sources.map((s) => (s.id === edit.source.id ? edit.source : s));
    return Promise.resolve(true);
  }
}

/** The save's refresh, each call held until the test settles it. */
function refresher() {
  const calls: { src: string; source: LinkSource; resolve: (result: IngestResult) => void; reject: (error: unknown) => void }[] = [];
  const refresh = vi.fn(
    (src: string, source: LinkSource) =>
      new Promise<IngestResult>((resolve, reject) => {
        calls.push({ src, source, resolve, reject });
      }),
  );
  return { refresh, calls };
}

const COMMITTED = { status: 'committed' } as unknown as IngestResult;

describe('the sources list’s rows without a login and their save (RELAY step 32d4b)', () => {
  async function opened(engine = new FakeEngine(), withRefresh = true) {
    const { nav, at } = navigator();
    const keys = keyboard();
    const refresh = refresher();
    const list = createSourcesList({ nav, engine, login: withRefresh ? { platform: keys.platform, find: keys.find, refresh: refresh.refresh } : { platform: keys.platform, find: keys.find } });
    list.open();
    await flush();
    return { nav, at, engine, list, refresh, form: list.form! };
  }

  it('marks the rows: a panel needs its login, a playlist its link', async () => {
    const t = await opened();
    expect(t.list.rows.value.map((r) => [r.id, r.needs, r.answer])).toEqual([
      ['s1', 'login', null],
      ['s2', 'link', null],
      ['s3', null, null],
      ['s4', null, null],
    ]);
    expect(t.list.screen.value).toBe(t.nav.top);
    expect(t.list.screen.value?.id).toBe(SOURCES_SCREEN);
  });

  it('opens the form from the row’s menu, for that source: the first button, whichever row (step 40f)', async () => {
    const t = await opened();
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    expect(t.at()).toBe(`${LOGIN_SCREEN} · fields 1`);
    expect(t.form.source.value).toEqual(BARE_PANEL);
    t.nav.handle('BACK');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    expect(t.form.source.value).toEqual(BARE_LIST);
    t.nav.handle('BACK');
    // A phone's file has no login to change: its menu has "Remove" and "Cancel" only.
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.list.menu.value!.actions).toEqual(['remove', 'cancel']);
    t.nav.handle('BACK');
    // A source that has its login has the same first button: its form shows what it holds.
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCE_MENU} · actions 0`);
    t.nav.handle('OK');
    expect(t.form.source.value).toEqual(KEPT);
    t.nav.handle('BACK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 3`);
  });

  it('opens the form from the header’s screen too (with "Add from your phone")', async () => {
    const { nav, at } = navigator();
    const keys = keyboard();
    let adds = 0;
    const list = createSourcesList({
      nav,
      engine: new FakeEngine(),
      addFromPhone: () => {
        adds += 1;
      },
      login: { platform: keys.platform, find: keys.find },
    });
    list.open();
    await flush();
    nav.handle('OK');
    nav.handle('OK'); // (the row's menu, then its first button)
    expect(at()).toBe(`${LOGIN_SCREEN} · fields 1`);
    nav.handle('BACK');
    nav.handle('UP');
    nav.handle('OK');
    expect(adds).toBe(1);
  });

  it('has no form without its options: the row’s menu has no "Change server and login"', async () => {
    const { nav, at } = navigator();
    const list = createSourcesList({ nav, engine: new FakeEngine() });
    expect(list.form).toBeNull();
    list.open();
    await flush();
    nav.handle('OK');
    expect(at()).toBe(`${SOURCE_MENU} · actions 0`);
    expect(list.menu.value!.actions).toEqual(['remove', 'cancel']);
  });

  it('saves: the login written, the mark gone, "Updating…" while it is read, then the rows read again', async () => {
    const t = await opened();
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    t.form.setValue('username', 'ann');
    t.form.setValue('password', 'pw');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 0`);
    expect(t.list.rows.value[0]!.answer).toEqual({ state: 'updating' });
    expect(t.list.pending.value).toBeGreaterThan(0);
    await flush();
    const record: SourceRecord = { id: 's1', type: 'xtream', name: 'My panel', account: { base: 'http://panel.test:8080', username: 'ann', password: 'pw' }, added: 11 };
    expect(t.engine.edits).toEqual([{ kind: 'source', source: record }]);
    expect(t.refresh.calls.map((c) => [c.src, c.source])).toEqual([['s1', { type: 'xtream', account: record.account }]]);
    // The rows were read again after the write: the mark is gone, the answer still running.
    expect(t.list.rows.value[0]).toMatchObject({ needs: null, answer: { state: 'updating' } });
    expect(t.list.pending.value).toBe(1);
    t.engine.metas = [{ src: 's1', gen: 1, building: null, nextGen: 2, updatedAt: T, checkedAt: T, counts: { live: 3 } }];
    const reads = t.engine.profileReads;
    t.refresh.calls[0]!.resolve(COMMITTED);
    await flush();
    expect(t.engine.profileReads).toBe(reads + 1);
    expect(t.list.rows.value[0]).toMatchObject({ needs: null, answer: null, checkedAt: T });
    expect(t.list.pending.value).toBe(0);
  });

  it('says so when the server refuses the login: the login stays written, and OK opens the form again with it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await opened();
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    t.form.setValue('playlist', 'lists.test:8443/get.php?u=1');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    await flush();
    t.refresh.calls[0]!.reject({ code: 'auth' });
    await flush();
    expect(t.list.rows.value[1]).toMatchObject({ needs: null, answer: { state: 'failed', code: 'auth', status: null } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 1`);
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    expect(t.at()).toBe(`${LOGIN_SCREEN} · fields 0`);
    expect(t.form.values.value).toEqual({ playlist: 'http://lists.test:8443/get.php?u=1' });
    // Saved again: the answer this time.
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.list.rows.value[1]!.answer).toEqual({ state: 'updating' });
    await flush();
    t.refresh.calls[1]!.reject(new LoadError('http', 404));
    await flush();
    expect(t.list.rows.value[1]!.answer).toEqual({ state: 'failed', code: 'http', status: 404 });
    expect(t.engine.edits).toHaveLength(2);
  });

  it('says so when the login could not be written, and reads nothing from the server', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.editFails = true;
    const t = await opened(engine);
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    t.form.setValue('username', 'ann');
    t.form.setValue('password', 'pw');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    await flush();
    expect(t.refresh.calls).toEqual([]);
    expect(t.list.rows.value[0]).toMatchObject({ needs: 'login', answer: { state: 'failed', code: 'other', status: null } });
    expect(t.list.pending.value).toBe(0);
  });

  it('only writes the login without a refresh to ask', async () => {
    const t = await opened(new FakeEngine(), false);
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    t.form.setValue('username', 'ann');
    t.form.setValue('password', 'pw');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    await flush();
    expect(t.engine.edits).toHaveLength(1);
    expect(t.list.rows.value[0]).toMatchObject({ needs: null, answer: null });
  });

  it('keeps the answers while the settings live: the screen opened again still shows them', async () => {
    const t = await opened();
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    t.form.setValue('username', 'ann');
    t.form.setValue('password', 'pw');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    await flush();
    t.nav.handle('BACK');
    expect(t.at()).toBe('settings · items 0');
    t.refresh.calls[0]!.reject({ code: 'network' });
    await flush();
    t.list.open();
    await flush();
    expect(t.list.rows.value[0]!.answer).toEqual({ state: 'failed', code: 'network', status: null });
    // OK on a row still updating does nothing.
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    t.form.setValue('playlist', 'lists.test/a.m3u');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    await flush();
    expect(t.list.rows.value[1]!.answer).toEqual({ state: 'updating' });
    t.nav.handle('OK');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 1`);
  });

  it('disposes the form with the list, and saves nothing once disposed', async () => {
    const t = await opened();
    t.nav.handle('OK');
    t.nav.handle('OK'); // (the row's menu, then its first button)
    t.list.dispose();
    t.form.setValue('username', 'ann');
    t.form.setValue('password', 'pw');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    await flush();
    expect(t.engine.edits).toEqual([]);
  });
});

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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const item: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };
const row = (patch: Partial<SourceRow> = {}): SourceRow => ({ id: 's1', name: 'My panel', type: 'xtream', host: 'panel.test:8080', checkedAt: T, blocked: false, storage: false, needs: null, answer: null, ...patch });

describe('a row without its login, and its save’s answer, as drawn', () => {
  it('says it needs its login or link, the answer first: updating, or why it failed', () => {
    expect(statusText(en, row({ needs: 'login', checkedAt: null }))).toBe('Needs its login again');
    expect(statusText(en, row({ type: 'm3u', needs: 'link', checkedAt: null }))).toBe('Needs its link again');
    expect(statusText(ar, row({ needs: 'login' }))).toBe('يحتاج إلى بيانات الدخول مرة أخرى');
    expect(statusText(ar, row({ needs: 'link' }))).toBe('يحتاج إلى رابطه مرة أخرى');
    expect(statusText(en, row({ answer: { state: 'updating' } }))).toBe('Updating…');
    expect(statusText(en, row({ needs: 'login', answer: { state: 'updating' } }))).toBe('Updating…');
    expect(statusText(en, row({ answer: { state: 'failed', code: 'auth', status: null } }))).toBe("The provider didn't accept this username and password.");
    expect(statusText(en, row({ needs: 'login', answer: { state: 'failed', code: 'other', status: null } }))).toBe('Something went wrong. Try again.');
    expect(statusText(en, row({ answer: { state: 'failed', code: 'http', status: 404 } }))).toBe('The server answered with error 404.');
    expect(statusText(ar, row({ answer: { state: 'updating' } }))).toBe('جارٍ التحديث…');
  });

  it('draws those lines in the warning colour, with its marks; updating in the plain one', () => {
    expect(warns(row())).toBe(false);
    expect(warns(row({ blocked: true }))).toBe(true);
    expect(warns(row({ needs: 'link' }))).toBe(true);
    expect(warns(row({ answer: { state: 'failed', code: 'auth', status: null } }))).toBe(true);
    expect(warns(row({ answer: { state: 'updating' } }))).toBe(false);
    const bare = SourceItem({ i18n: en, row: row({ needs: 'login', checkedAt: null }), index: 0, item });
    expect(bare.props as Props).toMatchObject({ 'data-needs': 'login', 'data-answer': '', 'data-code': '' });
    expect((byTestId(bare, 'source-0-status')[0]!.props as Props).class).toBe('guides__failure');
    const failed = SourceItem({ i18n: en, row: row({ answer: { state: 'failed', code: 'auth', status: null } }), index: 1, item });
    expect(failed.props as Props).toMatchObject({ 'data-needs': '', 'data-answer': 'failed', 'data-code': 'auth' });
    const updating = SourceItem({ i18n: en, row: row({ answer: { state: 'updating' } }), index: 2, item });
    expect(updating.props as Props).toMatchObject({ 'data-answer': 'updating', 'data-code': '' });
    expect((byTestId(updating, 'source-2-status')[0]!.props as Props).class).toBe('guides__status');
    expect(textOf(byTestId(updating, 'source-2-status')[0])).toBe('Updating…');
    // The server it kept still shows after the kind.
    expect(stripIsolates(textOf(byTestId(bare, 'source-0-kind')[0]))).toBe('Xtream login · panel.test:8080');
  });
});

describe('the login form as drawn', () => {
  function drawn(source: LoginSource) {
    const { nav } = navigator();
    const keys = keyboard();
    const form = createLoginForm({ nav, platform: keys.platform, find: keys.find, save: () => undefined });
    form.open(source);
    return { form, nav, draw: (i18n = en, field: (i: number) => ItemBinding = (i) => (i === 0 ? item : idle)) => LoginFormView({ i18n, form, source, field, action: () => idle }) };
  }

  it('names the panel, its three fields with onboarding’s labels, the server filled in, then Save and Cancel', () => {
    const t = drawn(BARE_PANEL as LoginSource);
    const root = t.draw();
    expect(root.type).toBe(Dialog);
    expect(root.props as Props).toMatchObject({ title: 'Login for My panel', message: 'Its channels come back once you save; your favourites stay.', testId: 'source-login' });
    const fields = walk(root).filter((v) => v.type === TextField);
    expect(fields.map((f) => [(f.props as Props).id, (f.props as Props).label, (f.props as Props).value, (f.props as Props).kind, (f.props as Props).testId, (f.props as Props).state])).toEqual([
      ['source-login-server', 'Server address', 'http://panel.test:8080', 'url', 'source-login-server', 'focused'],
      ['source-login-username', 'Username', '', 'text', 'source-login-username', 'idle'],
      ['source-login-password', 'Password', '', 'password', 'source-login-password', 'idle'],
    ]);
    expect(fields.map((f) => (f.props as Props).hint)).toEqual(['As your provider sent it. http:// is added if you leave it out.', undefined, undefined]);
    expect(fields.map((f) => (f.props as Props).error)).toEqual([null, null, null]);
    const buttons = walk(root).filter((v) => v.type === Button);
    expect(buttons.map((b) => [(b.props as Props).label, (b.props as Props).variant, (b.props as Props).testId])).toEqual([
      ['Save', 'primary', 'source-login-save'],
      ['Cancel', undefined, 'source-login-cancel'],
    ]);
    expect(String((walk(root).filter((v) => v.type === 'div')[0]!.props as Props).class)).toBe('guides__form sources__form');
    // Typing goes to the form; each field is edited by its own id.
    (fields[1]!.props as unknown as { onValue: (value: string) => void }).onValue('ann');
    expect(t.form.values.value.username).toBe('ann');
    // From the user name (the first empty field) to the password.
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.form.editor.editing.value).toBe('source-login-password');
    const editing = walk(t.draw()).filter((v) => v.type === TextField);
    expect(editing.map((f) => (f.props as unknown as { edit: { editing: boolean } }).edit.editing)).toEqual([false, false, true]);
  });

  it('shows the problems under their fields, and the Arabic words', () => {
    const t = drawn(BARE_PANEL as LoginSource);
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    const fields = walk(t.draw()).filter((v) => v.type === TextField);
    expect(fields.map((f) => (f.props as Props).error)).toEqual([null, 'Fill this in', 'Fill this in']);
    const arabic = t.draw(ar);
    expect(stripIsolates(String((arabic.props as Props).title))).toBe('بيانات الدخول إلى My panel');
    expect(walk(arabic).filter((v) => v.type === Button).map((b) => (b.props as Props).label)).toEqual(['حفظ', 'إلغاء']);
  });

  it('asks a playlist its link, with the host it was on as the hint', () => {
    const t = drawn(BARE_LIST as LoginSource);
    const root = t.draw();
    expect(stripIsolates(String((root.props as Props).title))).toBe('Link for قائمتي');
    const fields = walk(root).filter((v) => v.type === TextField);
    expect(fields.map((f) => [(f.props as Props).id, (f.props as Props).label, (f.props as Props).kind, (f.props as Props).hint])).toEqual([
      ['source-login-playlist', 'Playlist link', 'url', 'It was on lists.test:8443'],
    ]);
    expect(stripIsolates(String((t.draw(ar).props as Props).title))).toBe('رابط قائمتي');
  });

  it('gives the plain link hint when there is no host to give; a kept link’s host for the PIN’s check (step 38c2)', () => {
    expect(loginHint(en.t, 'playlist', BARE_NO_ORIGIN as LoginSource)).toBe('Starts with http:// or https://');
    expect(stripIsolates(loginHint(en.t, 'playlist', KEPT as LoginSource)!)).toBe('It was on kept.test');
    expect(stripIsolates(loginHint(ar.t, 'playlist', BARE_LIST as LoginSource)!)).toBe('كان على lists.test:8443');
    expect(loginHint(en.t, 'username', BARE_PANEL as LoginSource)).toBeUndefined();
    expect(loginHint(en.t, 'password', BARE_PANEL as LoginSource)).toBeUndefined();
    expect([loginLabel(en.t, 'server'), loginLabel(en.t, 'username'), loginLabel(en.t, 'password'), loginLabel(en.t, 'playlist')]).toEqual([
      'Server address',
      'Username',
      'Password',
      'Playlist link',
    ]);
  });
});

describe('the sources page with its form', () => {
  it('draws the form over the list only while it is on top', async () => {
    const { nav } = navigator();
    const keys = keyboard();
    const list = createSourcesList({ nav, engine: new FakeEngine(), login: { platform: keys.platform, find: keys.find } });
    list.open();
    await flush();
    const binding = bindFocus(nav);
    const named = (root: unknown): VNode[] => walk(root).filter((v) => typeof v.type === 'function' && (v.type as { name?: string }).name === 'LoginDialog');
    let root = SourcesPage({ i18n: en, binding, focus: nav.snapshot(), list })!;
    expect(root.props as Props).toMatchObject({ 'data-count': 4, 'data-needs': 2 });
    expect(named(root)).toEqual([]);
    nav.handle('OK');
    nav.handle('OK'); // (the row's menu, then its first button)
    root = SourcesPage({ i18n: en, binding, focus: nav.snapshot(), list })!;
    const dialog = named(root);
    expect(dialog).toHaveLength(1);
    expect((dialog[0]!.props as Props).source).toEqual(BARE_PANEL);
    // The list stays on its own screen under the form.
    const virtual = walk(root).filter((v) => (v.props as Props).zone === 'sources')[0]!;
    expect((virtual.props as Props).screen).toBe(list.screen.value);
    expect(list.screen.value).not.toBe(nav.top);
  });

  it('draws nothing once its screen is gone', () => {
    const { nav } = navigator();
    const list = createSourcesList({ nav, engine: new FakeEngine() });
    expect(SourcesPage({ i18n: en, binding: bindFocus(nav), focus: nav.snapshot(), list })).toBeNull();
  });
});
