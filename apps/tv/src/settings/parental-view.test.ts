import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import { stripIsolates } from '@lablo/core';
import type { ItemBinding } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { LockRow, PageStatus, ParentalPage, ParentalRow } from './parental-page';
import { LockItem, ParentalView, lockLine, parentalText } from './ParentalPage';
import { SettingsView, itemText } from './SettingsScreen';
import type { SettingsItem } from './settings-state';
import { SETTINGS_ITEMS } from './settings-state';

/**
 * Settings' list window and "Parental control" as drawn (RELAY step 38c1): the seven rows in view
 * from the focus engine's top, the page's rows and their values, and "Locked groups"' rows.
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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};
const propsOf = (node: VNode | undefined): Props => (node === undefined ? {} : (node.props as Props));

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };
const focused: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };

function page(patch: { rows?: ParentalRow[]; status?: PageStatus; pin?: boolean | null; adult?: boolean | null; failed?: boolean; changedPin?: boolean }): ParentalPage {
  return {
    rows: signal(patch.rows ?? ['change', 'adult', 'groups']),
    status: signal(patch.status ?? 'ready'),
    pin: signal(patch.pin === undefined ? true : patch.pin),
    adult: signal(patch.adult === undefined ? true : patch.adult),
    failed: signal(patch.failed ?? false),
    changedPin: signal(patch.changedPin ?? false),
  } as unknown as ParentalPage;
}

describe("the settings list's window (RELAY step 38c1)", () => {
  const rowIds = (root: unknown): string[] =>
    walk(root)
      .map((v) => propsOf(v)['data-testid'])
      .filter((id): id is string => typeof id === 'string' && id.indexOf('settings-') === 0 && id.split('-').length === 2);

  it('draws the seven rows from the top the focus engine gives, each with its own binding', () => {
    const list: readonly SettingsItem[] = SETTINGS_ITEMS;
    const asked: number[] = [];
    const first = SettingsView({ i18n: en, list, item: (i) => (asked.push(i), i === 0 ? focused : idle), telemetry: null });
    expect(rowIds(first)).toEqual(['settings-sources', 'settings-guides', 'settings-groups', 'settings-channels', 'settings-parental', 'settings-player', 'settings-language']);
    expect(asked).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(propsOf(walk(first).find((v) => propsOf(v)['role'] === 'menu'))).toMatchObject({ 'data-top': 0, 'data-count': 10 });
    asked.length = 0;
    // The last window (step 38d3: ten rows).
    const last = SettingsView({ i18n: en, list, item: (i) => (asked.push(i), idle), telemetry: null, top: 3 });
    expect(rowIds(last)).toEqual(['settings-channels', 'settings-parental', 'settings-player', 'settings-language', 'settings-backup', 'settings-telemetry', 'settings-report']);
    expect(asked).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(textOf(byTestId(last, 'settings-player')[0])).toBe('PlayerAudio and subtitle languages, subtitle size and picture');
    expect(textOf(byTestId(last, 'settings-parental')[0])).toBe('Parental controlYour PIN, and the groups and channels it locks');
  });

  it('keeps a short list whole', () => {
    const root = SettingsView({ i18n: en, list: ['guides', 'parental'], item: () => idle, telemetry: null, top: 3 });
    expect(rowIds(root)).toEqual([]);
    const whole = SettingsView({ i18n: en, list: ['guides', 'parental'], item: () => idle, telemetry: null });
    expect(rowIds(whole)).toEqual(['settings-guides', 'settings-parental']);
  });

  it('names the row in Arabic', () => {
    expect(itemText(ar.t, 'parental')).toEqual({ name: 'الرقابة الأبوية', hint: 'رمزك السري، والمجموعات والقنوات التي يقفلها' });
    expect(itemText(ar.t, 'player')).toEqual({ name: 'المشغّل', hint: 'لغة الصوت والترجمة، وحجم الترجمة والصورة' });
  });
});

describe('"Parental control" as drawn (RELAY step 38c1)', () => {
  it('writes each row: the PIN, "Lock adult groups" with its value, "Locked groups"', () => {
    const state = { adult: true, failed: false, changedPin: false };
    expect(parentalText(en.t, 'change', state)).toEqual({ name: 'Change the PIN', value: '', hint: 'Your PIN opens locked groups and this page', warn: false });
    expect(parentalText(en.t, 'change', { ...state, changedPin: true }).hint).toBe('PIN changed.');
    expect(parentalText(en.t, 'adult', state)).toEqual({ name: 'Lock adult groups', value: 'On', hint: 'Groups with adult names, or that your provider marks as adult', warn: false });
    expect(parentalText(en.t, 'adult', { ...state, adult: false }).value).toBe('Off');
    expect(parentalText(en.t, 'adult', { ...state, adult: null }).value).toBe('');
    expect(parentalText(en.t, 'adult', { ...state, failed: true })).toMatchObject({ hint: "Couldn't change it. Try again.", warn: true });
    expect(parentalText(en.t, 'groups', state)).toEqual({ name: 'Locked groups', value: '', hint: 'Lock or open any group', warn: false });
    expect(parentalText(ar.t, 'adult', state)).toMatchObject({ name: 'إقفال مجموعات البالغين', value: 'مفعّل' });
    expect(parentalText(ar.t, 'adult', { ...state, adult: false }).value).toBe('متوقف');
  });

  it('writes "Set a PIN" and "Forgot your PIN?" (step 38c2), in both languages', () => {
    const state = { adult: true, failed: false, changedPin: false };
    expect(parentalText(en.t, 'set', state)).toEqual({ name: 'Set a PIN', value: '', hint: "Keeps locked groups out of sight. You'll need one of your sources' logins", warn: false });
    expect(parentalText(en.t, 'forgot', state)).toEqual({ name: 'Forgot your PIN?', value: '', hint: "Set a new one with one of your sources' logins", warn: false });
    expect(parentalText(ar.t, 'set', state)).toMatchObject({ name: 'تعيين رمز سري' });
    expect(parentalText(ar.t, 'forgot', state)).toMatchObject({ name: 'هل نسيت رمزك السري؟' });
  });

  it('draws the rows with their bindings, the value beside its name, the warning in its colour', () => {
    const bindings = [idle, focused, idle];
    const root = ParentalView({ i18n: en, page: page({ failed: true, adult: false }), item: (i) => bindings[i]! });
    expect(propsOf(byTestId(root, 'parental')[0])).toMatchObject({ 'data-status': 'ready', 'data-pin': 'true' });
    expect(textOf(byTestId(root, 'parental-change')[0])).toBe('Change the PINYour PIN opens locked groups and this page');
    const adult = byTestId(root, 'parental-adult')[0]!;
    expect(propsOf(adult)).toMatchObject({ 'data-state': 'focused', 'data-value': 'false', class: 'settings__row settings__switch is-focused' });
    expect(textOf(byTestId(root, 'parental-adult-value')[0])).toBe('Off');
    expect(propsOf(byTestId(root, 'parental-adult-hint')[0])['class']).toBe('settings__hint settings__warn');
    expect(byTestId(root, 'parental-change-value')).toHaveLength(0);
    expect(propsOf(byTestId(root, 'parental-change')[0])['data-value']).toBe('');
  });

  it('says why there are no rows: loading, a failed read; with no PIN, its one row', () => {
    expect(byTestId(ParentalView({ i18n: en, page: page({ rows: [], status: 'loading', pin: null }), item: () => idle }), 'parental-loading')).toHaveLength(1);
    const none = ParentalView({ i18n: en, page: page({ rows: ['set'], pin: false }), item: () => focused });
    expect(textOf(byTestId(none, 'parental-set')[0])).toBe("Set a PINKeeps locked groups out of sight. You'll need one of your sources' logins");
    expect(propsOf(byTestId(none, 'parental')[0])['data-pin']).toBe('false');
    expect(textOf(byTestId(ParentalView({ i18n: en, page: page({ rows: [], status: 'failed', pin: null }), item: () => idle }), 'parental-failed')[0])).toBe("Couldn't read parental control.");
    expect(propsOf(byTestId(ParentalView({ i18n: en, page: page({ rows: [], pin: null }), item: () => idle }), 'parental')[0])['data-pin']).toBe('');
  });
});

describe('"Locked groups" as drawn (RELAY step 38c1)', () => {
  const row = (patch: Partial<LockRow> & { name?: string; kind?: LockRow['group']['kind'] }): LockRow => ({
    group: { src: 's1', kind: patch.kind ?? 'live', name: patch.name ?? 'XXX Night' },
    adult: patch.adult ?? false,
    locked: patch.locked ?? false,
    source: patch.source ?? '',
  });

  it('writes the line: the kind, "Adult" when it is, the source with two or more', () => {
    expect(lockLine(en.t, row({}))).toBe('Live TV');
    expect(lockLine(en.t, row({ kind: 'movie', adult: true }))).toBe('Movies · Adult');
    expect(stripIsolates(lockLine(en.t, row({ kind: 'series', source: 'Panel' })))).toBe('Series · From Panel');
    expect(stripIsolates(lockLine(ar.t, row({ adult: true })))).toBe('البث المباشر · للبالغين');
  });

  it('draws a group: its name as data, its lock beside it, its line', () => {
    const locked = LockItem({ i18n: en, row: row({ locked: true, adult: true }), index: 3, item: focused });
    expect(propsOf(locked)).toMatchObject({ 'data-testid': 'locked-3', 'data-kind': 'live', 'data-name': 'XXX Night', 'data-locked': 'true', 'data-adult': 'true', 'aria-selected': 'true', class: 'groups__row is-focused' });
    expect(propsOf(byTestId(locked, 'locked-3-name')[0])).toMatchObject({ dir: 'auto', translate: false });
    expect(textOf(byTestId(locked, 'locked-3-name')[0])).toBe('XXX Night');
    expect(textOf(byTestId(locked, 'locked-3-value')[0])).toBe('Locked');
    expect(textOf(byTestId(locked, 'locked-3-line')[0])).toBe('Live TV · Adult');
    const open = LockItem({ i18n: ar, row: row({ name: '' }), index: 0, item: idle });
    expect(textOf(byTestId(open, 'locked-0-value')[0])).toBe('مفتوحة');
    // A group without a name: the catalog's words, not data.
    expect(propsOf(byTestId(open, 'locked-0-name')[0])).toMatchObject({ dir: undefined, translate: undefined });
    expect(textOf(byTestId(open, 'locked-0-name')[0])).toBe(ar.t('live.noGroup'));
    expect(textOf(byTestId(LockItem({ i18n: ar, row: row({ locked: true }), index: 0, item: idle }), 'locked-0-value')[0])).toBe('مقفلة');
  });
});
