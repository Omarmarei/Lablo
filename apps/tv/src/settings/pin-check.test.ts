import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import type { LoadedProfile, SourceRecord, StoredSource } from '@lablo/data';
import { emptyProfile } from '@lablo/data';
import type { KeyLike, TextKey } from '@lablo/platform-api';
import type { EditableLike, ItemBinding } from '@lablo/ui';
import { Button, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import { GROUPS_VISIBLE } from './groups-state';
import { PickItem, pickLine } from './ParentalPage';
import type { PinCheckEngine } from './pin-check';
import { CHECK_SCREEN, NONE_BUTTONS, NONE_SCREEN, PICK_SCREEN, PIN_CHECK_SCREENS, createPinCheck } from './pin-check';
import { LoginFormView, loginWords } from './SettingsScreen';
import type { CheckSource, LoginSource } from './source-login';
import { LOGIN_SCREEN, checkLogin, checkSources, checkValues, createLoginForm, matchesLogin } from './source-login';

/**
 * The PIN's login check (RELAY step 38c2): which sources can be used, the comparison of a login
 * typed again with the stored one, the form's check mode, the pick of a source and the dialog when
 * none can be used, and their words as drawn (called as functions).
 */

const PANEL: CheckSource = { id: 's1', type: 'xtream', name: 'My panel', account: { base: 'http://panel.test:8080', username: 'ann', password: 'pw' }, added: 11 };
const LIST: CheckSource = { id: 's2', type: 'm3u', name: 'قائمتي', url: 'https://lists.test:8443/get.m3u?k=1', added: 22 };
const PANEL2: CheckSource = { id: 's6', type: 'xtream', name: 'My panel', account: { base: 'http://other.test', username: 'bo', password: 'x' }, added: 66 };
const FILE: StoredSource = { id: 's3', type: 'm3u-file', name: 'Phone', added: 33 };
const BARE_PANEL: StoredSource = { id: 's4', type: 'xtream', name: 'Bare', account: null, base: 'http://bare.test', added: 44 };
const BARE_LIST: StoredSource = { id: 's5', type: 'm3u', name: 'Bare list', url: null, origin: 'http://bare-list.test', added: 55 };

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** The TV's keyboard and the fields' inputs, as the login form's tests fake them. */
function keyboard() {
  const inputs: Record<string, EditableLike> = {};
  const find = vi.fn((id: string) => {
    inputs[id] ??= { focus: () => undefined, blur: () => undefined };
    return inputs[id]!;
  });
  const platform = {
    textKey: (event: KeyLike): TextKey | null => (event.key === 'Enter' ? 'done' : event.key === 'Escape' ? 'close' : null),
    onSoftKeyboard: () => () => undefined,
  };
  return { find, platform };
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

/** Focus on the form's first button and press it. */
function pressCheck(nav: ReturnType<typeof navigator>['nav']): void {
  nav.top.focus('actions', 0);
  nav.handle('OK');
}

describe('the sources the check can use, and the comparison (RELAY step 38c2)', () => {
  it('uses the sources that keep their login, in their order: not a phone file, nor one restored without it', () => {
    expect(checkSources([FILE, PANEL, BARE_PANEL, LIST, BARE_LIST, PANEL2])).toEqual([PANEL, LIST, PANEL2]);
    expect(checkSources([FILE, BARE_PANEL, BARE_LIST])).toEqual([]);
    expect(checkSources([])).toEqual([]);
  });

  it('opens with an Xtream source’s server alone, and a playlist’s link empty', () => {
    expect(checkValues(PANEL)).toEqual({ server: 'http://panel.test:8080', username: '', password: '' });
    expect(checkValues(LIST)).toEqual({ playlist: '' });
  });

  it('matches an Xtream login only with the same server, user name and password, after onboarding’s normalising', () => {
    const typed = (server: string, username: string, password: string): SourceRecord => checkLogin(PANEL, { server, username, password }).record!;
    expect(matchesLogin(PANEL, typed('http://panel.test:8080', 'ann', 'pw'))).toBe(true);
    // Trimmed, the host lower-cased and the scheme added, as onboarding stores it.
    expect(matchesLogin(PANEL, typed('Panel.Test:8080/', ' ann ', 'pw '))).toBe(true);
    expect(matchesLogin(PANEL, typed('http://panel.test:8081', 'ann', 'pw'))).toBe(false);
    expect(matchesLogin(PANEL, typed('http://panel.test:8080', 'Ann', 'pw'))).toBe(false);
    expect(matchesLogin(PANEL, typed('http://panel.test:8080', 'ann', 'PW'))).toBe(false);
    // Another kind of source never matches.
    expect(matchesLogin(PANEL, { id: 's1', type: 'm3u', name: 'x', url: 'http://panel.test:8080', added: 1 })).toBe(false);
  });

  it('matches a playlist only with the same link', () => {
    const typed = (playlist: string): SourceRecord => checkLogin(LIST, { playlist }).record!;
    expect(matchesLogin(LIST, typed('https://lists.test:8443/get.m3u?k=1'))).toBe(true);
    expect(matchesLogin(LIST, typed(' https://Lists.Test:8443/get.m3u?k=1 '))).toBe(true);
    expect(matchesLogin(LIST, typed('https://lists.test:8443/get.m3u?k=2'))).toBe(false);
    expect(matchesLogin(LIST, typed('https://lists.test:8443/get.m3u'))).toBe(false);
    expect(matchesLogin(LIST, { id: 's2', type: 'xtream', name: 'x', account: { base: 'https://lists.test:8443', username: 'a', password: 'b' }, added: 1 })).toBe(false);
  });
});

describe('the login form’s check mode (RELAY step 38c2)', () => {
  function setup() {
    const { nav, at } = navigator();
    const keys = keyboard();
    const saved: SourceRecord[] = [];
    const form = createLoginForm({ nav, platform: keys.platform, find: keys.find, id: CHECK_SCREEN, save: (record) => saved.push(record) });
    const matched = vi.fn();
    return { nav, at, form, saved, matched };
  }

  it('opens under its own id on the first field to type, the server filled in and nothing else', () => {
    const t = setup();
    t.form.check(PANEL, t.matched);
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 1`);
    expect(t.form.checking.value).toBe(true);
    expect(t.form.values.value).toEqual({ server: 'http://panel.test:8080', username: '', password: '' });
    t.nav.handle('BACK');
    t.form.check(LIST, t.matched);
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 0`);
    expect(t.form.values.value).toEqual({ playlist: '' });
  });

  it('says so when the login isn’t the stored one: the form stays, the focus back on the first field typed; a change clears it', () => {
    const t = setup();
    t.form.check(PANEL, t.matched);
    t.form.setValue('username', 'ann');
    t.form.setValue('password', 'nope');
    pressCheck(t.nav);
    expect(t.form.mismatch.value).toBe(true);
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 1`);
    expect(t.form.source.value).toBe(PANEL);
    expect(t.matched).not.toHaveBeenCalled();
    t.form.setValue('password', 'pw');
    expect(t.form.mismatch.value).toBe(false);
    pressCheck(t.nav);
    expect(t.at()).toBe('settings · items 0');
    expect(t.matched).toHaveBeenCalledTimes(1);
    expect(t.form.source.value).toBeNull();
    expect(t.saved).toEqual([]);
  });

  it('refuses what onboarding refuses before comparing anything', () => {
    const t = setup();
    t.form.check(PANEL, t.matched);
    t.form.setValue('password', 'pw');
    pressCheck(t.nav);
    expect(t.form.problems.value).toEqual({ username: 'required' });
    expect(t.form.mismatch.value).toBe(false);
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 1`);
    expect(t.matched).not.toHaveBeenCalled();
  });

  it('opens again with nothing left: no mismatch, no values typed', () => {
    const t = setup();
    t.form.check(LIST, t.matched);
    t.form.setValue('playlist', 'http://wrong.test/a.m3u');
    pressCheck(t.nav);
    expect(t.form.mismatch.value).toBe(true);
    t.nav.handle('BACK');
    t.form.check(LIST, t.matched);
    expect(t.form.mismatch.value).toBe(false);
    expect(t.form.values.value).toEqual({ playlist: '' });
  });

  it('gives a login again as before once opened that way: saved, never compared', () => {
    const t = setup();
    t.form.check(PANEL, t.matched);
    t.nav.handle('BACK');
    t.form.open(PANEL);
    expect(t.form.checking.value).toBe(false);
    expect(t.form.values.value).toEqual({ server: 'http://panel.test:8080', username: 'ann', password: 'pw' });
    t.form.setValue('password', 'new');
    pressCheck(t.nav);
    expect(t.matched).not.toHaveBeenCalled();
    expect(t.saved).toEqual([{ id: 's1', type: 'xtream', name: 'My panel', account: { base: 'http://panel.test:8080', username: 'ann', password: 'new' }, added: 11 }]);
  });

  it('keeps the default id for a login given again', () => {
    const { nav, at } = navigator();
    const keys = keyboard();
    const form = createLoginForm({ nav, platform: keys.platform, find: keys.find });
    form.open(PANEL);
    expect(at()).toBe(`${LOGIN_SCREEN} · fields 0`);
    // No `save`: "Save" closes it, nothing else.
    pressCheck(nav);
    expect(at()).toBe('settings · items 0');
  });
});

class FakeEngine implements PinCheckEngine {
  sources: StoredSource[] = [PANEL];
  fail = false;
  readonly held: (() => void)[] = [];
  hold = false;
  reads = 0;
  profile(): Promise<LoadedProfile | null> {
    this.reads += 1;
    if (this.fail) return Promise.reject(new Error('no IndexedDB'));
    const loaded = { doc: { ...emptyProfile(), sources: this.sources } as LoadedProfile['doc'], newer: false, migratedFrom: null };
    if (this.hold) return new Promise((resolve) => this.held.push(() => resolve(loaded)));
    return Promise.resolve(loaded);
  }
}

describe('the check’s way in: the pick, the form or the dialog (RELAY step 38c2)', () => {
  function setup(sources: StoredSource[]) {
    const { nav, at } = navigator();
    const keys = keyboard();
    const engine = new FakeEngine();
    engine.sources = sources;
    const check = createPinCheck({ nav, engine, platform: keys.platform, find: keys.find });
    const matched = vi.fn();
    const run = async (): Promise<void> => {
      check.run(matched);
      await flush();
    };
    return { nav, at, engine, check, matched, run };
  }

  it('names its screens', () => {
    expect(PIN_CHECK_SCREENS).toEqual([PICK_SCREEN, CHECK_SCREEN, NONE_SCREEN]);
  });

  it('opens the form at once with one source that keeps its login', async () => {
    const t = setup([FILE, PANEL, BARE_LIST]);
    await t.run();
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 1`);
    expect(t.check.form.source.value).toBe(PANEL);
    expect(t.check.pickScreen.value).toBeNull();
    t.check.form.setValue('username', 'ann');
    t.check.form.setValue('password', 'pw');
    pressCheck(t.nav);
    expect(t.at()).toBe('settings · items 0');
    expect(t.matched).toHaveBeenCalledTimes(1);
  });

  it('lists the sources first with two or more; OK opens one’s form, Back goes back to the list', async () => {
    const t = setup([PANEL, FILE, LIST]);
    await t.run();
    expect(t.at()).toBe(`${PICK_SCREEN} · rows 0`);
    // (The view draws the pick, under the form too, from this screen.)
    expect(t.check.pickScreen.value).toBe(t.nav.top);
    expect(t.check.sources.value).toEqual([PANEL, LIST]);
    expect(t.nav.top.zone('rows')).toMatchObject({ kind: 'list', axis: 'vertical', count: 2, visible: GROUPS_VISIBLE });
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 0`);
    expect(t.check.form.source.value).toBe(LIST);
    t.nav.handle('BACK');
    expect(t.at()).toBe(`${PICK_SCREEN} · rows 1`);
    t.nav.handle('UP');
    t.nav.handle('OK');
    t.check.form.setValue('username', 'ann');
    t.check.form.setValue('password', 'pw');
    pressCheck(t.nav);
    // The form and the list both gone, then what was asked goes on.
    expect(t.at()).toBe('settings · items 0');
    expect(t.check.pickScreen.value).toBeNull();
    expect(t.matched).toHaveBeenCalledTimes(1);
  });

  it('goes out from the list on Back, nothing going on', async () => {
    const t = setup([PANEL, LIST]);
    await t.run();
    t.nav.handle('BACK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.check.pickScreen.value).toBeNull();
    expect(t.matched).not.toHaveBeenCalled();
  });

  it('says so when no source keeps a login; OK closes it', async () => {
    const t = setup([FILE, BARE_PANEL, BARE_LIST]);
    await t.run();
    expect(t.at()).toBe(`${NONE_SCREEN} · ${NONE_BUTTONS} 0`);
    expect(t.nav.top.zone(NONE_BUTTONS)).toMatchObject({ count: 1 });
    t.nav.handle('OK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.matched).not.toHaveBeenCalled();
  });

  it('opens nothing when the user went Back while the sources were read, or when they can’t be read', async () => {
    const t = setup([PANEL]);
    t.nav.push({ id: 'page', zones: [{ kind: 'list', id: 'rows', axis: 'vertical', count: 1 }] });
    t.engine.hold = true;
    t.check.run(t.matched);
    expect(t.check.pending.value).toBe(1);
    // A second ask while the first reads is dropped.
    t.check.run(t.matched);
    expect(t.engine.reads).toBe(1);
    t.nav.handle('BACK');
    t.engine.held[0]!();
    await flush();
    expect(t.at()).toBe('settings · items 0');
    expect(t.check.pending.value).toBe(0);
    t.engine.hold = false;
    t.engine.fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await t.run();
    expect(t.at()).toBe('settings · items 0');
    expect(t.check.pending.value).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('opens nothing once disposed', async () => {
    const t = setup([PANEL]);
    t.engine.hold = true;
    t.check.run(t.matched);
    t.check.dispose();
    t.engine.held[0]!();
    await flush();
    expect(t.at()).toBe('settings · items 0');
    t.check.run(t.matched);
    expect(t.engine.reads).toBe(1);
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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };

describe('the check as drawn (RELAY step 38c2)', () => {
  it('words the form for the check: its title, its line and "Check"; a login given again as before', () => {
    expect(loginWords(en.t, PANEL, true)).toEqual({ title: "Type My panel's login", body: "Lablo compares it with the one on this TV. It isn't sent anywhere.", save: 'Check' });
    expect(stripIsolates(loginWords(en.t, LIST, true).title)).toBe("Type قائمتي's link");
    expect(loginWords(en.t, PANEL, false)).toEqual({ title: 'Login for My panel', body: 'Its channels come back once you save; your favourites stay.', save: 'Save' });
    const arabic = loginWords(ar.t, PANEL, true);
    expect(stripIsolates(arabic.title)).toBe('اكتب بيانات الدخول إلى My panel');
    expect(arabic.save).toBe('تحقّق');
  });

  it('draws "Check" and the mismatch’s line in the warning colour', () => {
    const { nav } = navigator();
    const keys = keyboard();
    const form = createLoginForm({ nav, platform: keys.platform, find: keys.find, id: CHECK_SCREEN });
    form.check(PANEL, () => undefined);
    const draw = (): VNode => LoginFormView({ i18n: en, form, source: PANEL as LoginSource, field: () => idle, action: () => idle });
    expect(byTestId(draw(), 'source-login-mismatch')).toEqual([]);
    expect(walk(draw()).filter((v) => v.type === Button).map((b) => (b.props as Props).label)).toEqual(['Check', 'Cancel']);
    form.setValue('username', 'x');
    form.setValue('password', 'y');
    nav.top.focus('actions', 0);
    nav.handle('OK');
    const line = byTestId(draw(), 'source-login-mismatch');
    expect(line).toHaveLength(1);
    expect((line[0]!.props as Props).class).toBe('settings__hint settings__warn');
    expect(textOf(line[0])).toBe("That isn't this source's login. Check it and try again.");
  });

  it('draws a source on the pick: its name as data, its server’s host under it', () => {
    expect(pickLine(PANEL)).toBe('panel.test:8080');
    expect(pickLine(LIST)).toBe('lists.test:8443');
    const row = PickItem({ source: LIST, index: 1, item: idle });
    expect(row.props as Props).toMatchObject({ 'data-testid': 'pin-pick-1', 'data-src': 's2', 'data-state': 'idle' });
    const name = byTestId(row, 'pin-pick-1-name')[0]!;
    expect(name.props as Props).toMatchObject({ dir: 'auto', translate: false });
    expect(textOf(name)).toBe('قائمتي');
    const line = byTestId(row, 'pin-pick-1-line')[0]!;
    expect(line.props as Props).toMatchObject({ dir: 'ltr', translate: false });
    expect(textOf(line)).toBe('lists.test:8443');
  });
});
