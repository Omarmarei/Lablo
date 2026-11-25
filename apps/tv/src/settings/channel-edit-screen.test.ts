import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type { CatalogItem } from '@lablo/core';
import { stripIsolates } from '@lablo/core';
import type { ChannelEdit } from '@lablo/data/client';
import type { Focus, FocusBinding, ItemBinding, Screen } from '@lablo/ui';
import { Button, Dialog, Spinner, TextField, VirtualList, createNavigator } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { ChannelEditor, EditAction, EditProblem, EditTarget } from './channel-edit';
import { CHANNEL_NAME_FIELD, CHANNEL_NUMBER_FIELD, EDIT_NUMBER, EDIT_RENAME, EDIT_SCREEN, NUMBER_DIGITS } from './channel-edit';
import { ChannelEditOver, EditFormView, EditMenuView, EditPanelView, EditedItem, EditedPage, editLabels, editedLine } from './ChannelEditPage';
import type { ChannelsStatus, EditedChannels } from './edited-channels';
import { CHANNELS_SCREEN } from './edited-channels';
import { loadSettings } from './settings';
import type { Settings } from './settings-state';
import { SettingsScreen, itemText } from './SettingsScreen';

/**
 * "Edit channel" and Settings › "Channels" (RELAY step 36c) as drawn: the panel over the player,
 * the menu from the page, the forms, the page's rows, called as functions (their components are
 * not expanded). The e2e (`channel-edit-screens.spec.ts`) drives them in the app.
 */

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
/** A component's element expanded once (the components under it not). */
const expand = (v: VNode): VNode => (v.type as (props: Props) => VNode)(v.props as Props);
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const focused: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };
const memory: ItemBinding = { state: 'memory', onHover: () => undefined, onPress: () => undefined };

function channel(name: string, chno: number | null = null): CatalogItem {
  return { key: 'a', src: 's1', kind: 'live', name, normName: '', group: '', url: 'http://x.test/a.ts', logo: null, epgId: null, tvgName: null, matchName: null, chno, tvgShift: 0, catchup: null, radio: false, hints: null };
}

function edit(change: Partial<Pick<ChannelEdit, 'hidden' | 'name' | 'number' | 'locked'>>): ChannelEdit {
  return { key: 'a', src: 's1', kind: 'live', normName: 'a', added: 1, missingSince: null, ...change };
}

/** An editor's signals as the views read them. */
function editorOf(state: { target?: EditTarget | null; actions?: EditAction[]; problem?: EditProblem | null; text?: string; over?: boolean; pending?: number; editing?: string | null; screen?: Screen | null }): ChannelEditor {
  return {
    screen: signal(state.screen === undefined ? ({ id: EDIT_SCREEN } as Screen) : state.screen),
    target: signal(state.target === undefined ? { key: 'a', item: channel('MBC 1'), edit: null, name: 'MBC 1' } : state.target),
    actions: signal(state.actions ?? ['rename', 'number', 'hide', 'cancel']),
    over: signal(state.over ?? true),
    pending: signal(state.pending ?? 0),
    problem: signal(state.problem ?? null),
    text: signal(state.text ?? ''),
    editor: { editing: signal(state.editing ?? null), field: () => ({}) },
  } as unknown as ChannelEditor;
}

describe('the settings row and the menu’s words (RELAY step 36c)', () => {
  it('names "Channels", after "Channel groups"', () => {
    expect(itemText(en.t, 'channels')).toEqual({ name: 'Channels', hint: 'Clean names, and the channels you renamed, renumbered, hid or locked' });
    expect(itemText(ar.t, 'channels')).toEqual({ name: 'القنوات', hint: 'تنظيف الأسماء، والقنوات التي أعدت تسميتها أو ترقيمها أو أخفيتها أو أقفلتها' });
  });

  it('labels each action', () => {
    expect(editLabels(en.t)).toEqual({
      rename: 'Rename',
      number: 'Channel number',
      hide: 'Hide channel',
      show: 'Show channel',
      lock: 'Lock channel',
      unlock: 'Unlock channel',
      reset: 'Undo my changes',
      cancel: 'Cancel',
    });
    expect(editLabels(ar.t).hide).toBe('إخفاء القناة');
    expect(editLabels(ar.t).show).toBe('إظهار القناة');
    expect(editLabels(ar.t).lock).toBe('إقفال القناة');
    expect(editLabels(ar.t).unlock).toBe('إلغاء إقفال القناة');
  });

  it('says what was changed under a channel’s name, and when it isn’t in the sources now', () => {
    const row = (e: ChannelEdit | null, found = true): EditTarget => ({ key: 'a', item: found ? channel('X') : null, edit: e, name: 'X' });
    expect(editedLine(en.t, row(edit({ hidden: true, name: 'X', number: 4 })))).toBe('Hidden · Renamed · Renumbered');
    expect(editedLine(en.t, row(edit({ number: 4 })))).toBe('Renumbered');
    expect(editedLine(en.t, row(edit({ name: 'X' }), false))).toBe('Renamed · Not in your sources now');
    expect(editedLine(en.t, row(null))).toBe('');
    // A locked one (step 38c1).
    expect(editedLine(en.t, row(edit({ hidden: true, locked: true })))).toBe('Hidden · Locked');
    expect(editedLine(ar.t, row(edit({ locked: true })))).toBe('مقفلة');
    expect(editedLine(ar.t, row(edit({ hidden: true, name: 'X' })))).toBe('مخفية · أُعيدت تسميتها');
  });
});

describe('the panel over the player', () => {
  it('draws "Edit channel", the channel’s name as data, and each action as a row', () => {
    const editor = editorOf({});
    const root = EditPanelView({ i18n: en, editor, item: (i) => (i === 0 ? focused : i === 1 ? memory : idle) });
    const props = root.props as Props;
    expect(props['data-testid']).toBe('channel-edit');
    expect(props['data-over']).toBe('true');
    expect(props['data-key']).toBe('a');
    expect(props['data-pending']).toBe(0);
    expect(props['data-problem']).toBe('');
    expect(textOf(walk(root).find((v) => v.type === 'h2'))).toBe('Edit channel');
    const name = byTestId(root, 'channel-edit-name')[0]!;
    expect(textOf(name)).toBe('MBC 1');
    expect((name.props as Props).dir).toBe('auto');
    expect((name.props as Props).translate).toBe(false);
    const rows = ['rename', 'number', 'hide', 'cancel'].map((a) => byTestId(root, `channel-edit-${a}`)[0]!);
    expect(rows.map((r) => textOf(r))).toEqual(['Rename', 'Channel number', 'Hide channel', 'Cancel']);
    expect(rows.map((r) => (r.props as Props).class)).toEqual(['tracks__row is-focused', 'tracks__row is-memory', 'tracks__row', 'tracks__row']);
    expect((rows[0]!.props as Props).role).toBe('menuitem');
    expect(byTestId(root, 'channel-edit-problem')).toEqual([]);
  });

  it('says a refused edit, and nothing for a wrong number (the form says it)', () => {
    const shown = (problem: EditProblem | null): string =>
      walk(EditPanelView({ i18n: en, editor: editorOf({ problem }), item: () => idle }))
        .filter((v) => typeof v.type === 'function' && (v.props as Props).editor !== undefined)
        .map((v) => textOf(expand(v)))
        .join('');
    expect(shown('refused')).toBe("Couldn't change the channel.");
    expect(shown('number')).toBe('');
    expect(shown(null)).toBe('');
    expect((EditPanelView({ i18n: en, editor: editorOf({ problem: 'refused', pending: 1 }), item: () => idle }).props as Props)['data-problem']).toBe('refused');
  });

  it('paints nothing while the menu is closed, else the panel and the form on top', () => {
    const settings = (editor: ChannelEditor) => ({ channel: editor }) as unknown as Settings;
    const focus = (screen: string): Focus => ({ screen, zone: 'actions', index: 0, pointer: false, dir: 'ltr', depth: 3 }) as Focus;
    const binding = { nav: { top: { id: EDIT_RENAME } } } as unknown as FocusBinding;
    expect(ChannelEditOver({ settings: settings(editorOf({ screen: null })), i18n: en, binding, focus: focus('player') })).toBeNull();
    const menu = ChannelEditOver({ settings: settings(editorOf({ editing: CHANNEL_NAME_FIELD })), i18n: en, binding, focus: focus(EDIT_SCREEN) })!;
    expect((menu.props as Props)['data-testid']).toBe('channel-edit-over');
    expect((menu.props as Props)['data-editing']).toBe(CHANNEL_NAME_FIELD);
    const kids = walk(menu).filter((v) => typeof v.type === 'function');
    expect(kids).toHaveLength(1);
    const form = ChannelEditOver({ settings: settings(editorOf({})), i18n: en, binding, focus: focus(EDIT_NUMBER) })!;
    const parts = walk(form).filter((v) => typeof v.type === 'function');
    expect(parts).toHaveLength(2);
    expect((parts[1]!.props as Props).number).toBe(true);
    const rename = ChannelEditOver({ settings: settings(editorOf({})), i18n: en, binding, focus: focus(EDIT_RENAME) })!;
    expect((walk(rename).filter((v) => typeof v.type === 'function')[1]!.props as Props).number).toBe(false);
    expect((ChannelEditOver({ settings: settings(editorOf({})), i18n: en, binding, focus: focus(EDIT_SCREEN) })!.props as Props)['data-editing']).toBe('');
  });
});

describe('the menu from "Channels"', () => {
  it('is a dialog titled with the channel’s name (data), "Undo my changes" in the danger colour', () => {
    const editor = editorOf({ actions: ['rename', 'number', 'show', 'reset', 'cancel'], target: { key: 'a', item: channel('قناتي'), edit: edit({ hidden: true }), name: 'قناتي' }, over: false });
    const root = EditMenuView({ i18n: ar, editor, item: () => idle });
    expect(root.type).toBe(Dialog);
    expect((root.props as Props).title).toBe('قناتي');
    expect((root.props as Props).data).toBe(true);
    expect((root.props as Props).testId).toBe('channel-edit');
    const buttons = walk(root).filter((v) => v.type === Button);
    expect(buttons.map((b) => [(b.props as Props).testId, (b.props as Props).variant])).toEqual([
      ['channel-edit-rename', 'secondary'],
      ['channel-edit-number', 'secondary'],
      ['channel-edit-show', 'secondary'],
      ['channel-edit-reset', 'danger'],
      ['channel-edit-cancel', 'secondary'],
    ]);
    expect((buttons[2]!.props as Props).label).toBe('إظهار القناة');
    expect(EditMenuView({ i18n: en, editor: editorOf({ target: null }), item: () => idle }).props).toMatchObject({ title: '' });
  });
});

describe('the forms', () => {
  const field = (root: VNode): Props => walk(root).find((v) => v.type === TextField)!.props as Props;

  it('renames in a text field of up to 60 characters, empty for the provider’s name', () => {
    const root = EditFormView({ i18n: en, editor: editorOf({ text: 'MBC 1' }), number: false, field: focused, action: () => idle });
    expect(root.type).toBe(Dialog);
    expect(root.props).toMatchObject({ title: 'Rename the channel', message: undefined, testId: 'channel-rename' });
    expect(field(root)).toMatchObject({ id: CHANNEL_NAME_FIELD, kind: 'text', value: 'MBC 1', maxLength: 60, label: 'Name (optional)', hint: "Leave it empty for the provider's name", error: null, testId: 'channel-rename-field', state: 'focused' });
    const buttons = walk(root).filter((v) => v.type === Button);
    expect(buttons.map((b) => [(b.props as Props).label, (b.props as Props).testId])).toEqual([
      ['Save', 'channel-rename-save'],
      ['Cancel', 'channel-rename-cancel'],
    ]);
  });

  it('numbers in a field of four digits on the TV’s number keyboard, with its rule and the wrong number said', () => {
    const root = EditFormView({ i18n: en, editor: editorOf({ text: '0', problem: 'number' }), number: true, field: idle, action: () => idle });
    expect(root.props).toMatchObject({ title: 'Channel number', message: 'A channel that has this number goes back to its own.', testId: 'channel-number' });
    expect(field(root)).toMatchObject({ id: CHANNEL_NUMBER_FIELD, kind: 'tel', value: '0', maxLength: NUMBER_DIGITS, label: 'Number', hint: 'Leave it empty for its own number', error: 'Type a number from 1 to 9,999.', testId: 'channel-number-field' });
    expect(field(EditFormView({ i18n: en, editor: editorOf({ problem: 'refused' }), number: true, field: idle, action: () => idle })).error).toBeNull();
    expect(field(EditFormView({ i18n: en, editor: editorOf({ problem: 'number' }), number: false, field: idle, action: () => idle })).error).toBeNull();
    expect(stripIsolates(field(EditFormView({ i18n: ar, editor: editorOf({ problem: 'number' }), number: true, field: idle, action: () => idle })).error as string)).toBe('اكتب رقمًا من 1 إلى 9,999.');
  });
});

describe('the "Channels" page', () => {
  const binding = {} as FocusBinding;
  const focus: Focus = { screen: CHANNELS_SCREEN, zone: 'rows', index: 0, pointer: false, dir: 'ltr', depth: 3 } as Focus;
  const rows: EditTarget[] = [
    { key: 'a', item: channel('MBC 1', 42), edit: edit({ hidden: true, number: 42 }), name: 'MBC 1' },
    { key: 'z', item: null, edit: edit({ name: 'Old' }), name: 'Old' },
  ];
  const settingsOf = (state: { status?: ChannelsStatus; rows?: EditTarget[]; clean?: boolean | null; failed?: boolean; editor?: ChannelEditor; screen?: Screen | null }): Settings =>
    ({
      channel: state.editor ?? editorOf({ over: false, screen: null }),
      channels: {
        screen: signal(state.screen === undefined ? ({ id: CHANNELS_SCREEN } as Screen) : state.screen),
        status: signal(state.status ?? 'ready'),
        rows: signal(state.rows ?? rows),
        clean: signal(state.clean === undefined ? false : state.clean),
        failed: signal(state.failed ?? false),
        pending: signal(0),
      } as unknown as EditedChannels,
    }) as unknown as Settings;
  const draw = (settings: Settings, at: Focus = focus): VNode => EditedPage({ i18n: en, binding, focus: at, settings })!;
  const list = (root: VNode): Props => walk(root).find((v) => v.type === VirtualList)!.props as Props;

  it('says why there are no rows while reading or after a failed read, and nothing without its screen', () => {
    expect(walk(draw(settingsOf({ status: 'loading' }))).some((v) => v.type === Spinner)).toBe(true);
    expect(textOf(byTestId(draw(settingsOf({ status: 'failed' })), 'channels-failed'))).toBe("Couldn't read your channels.");
    expect(walk(draw(settingsOf({ status: 'loading' }))).some((v) => v.type === VirtualList)).toBe(false);
    expect(EditedPage({ i18n: en, binding, focus, settings: settingsOf({ screen: null }) })).toBeNull();
  });

  it('lists the switch first, then the changed channels; with none, the line says how to change one', () => {
    const root = draw(settingsOf({}));
    expect((root.props as Props)['data-count']).toBe(2);
    expect(textOf(walk(root).find((v) => v.type === 'h1'))).toBe('Channels');
    expect(textOf(byTestId(root, 'channels-intro'))).toBe('The channels you renamed, renumbered, hid or locked. Press OK on one to change it again.');
    const props = list(root);
    expect(props.zone).toBe('rows');
    expect(props.testId).toBe('channels-list');
    const render = props.renderItem as (i: number, item: ItemBinding) => VNode | null;
    expect((render(0, focused)!.props as Props).channels).toBeDefined();
    expect((render(1, idle)!.props as Props).row).toBe(rows[0]);
    expect((render(1, idle)!.props as Props).index).toBe(0);
    expect((render(2, idle)!.props as Props).row).toBe(rows[1]);
    expect(render(3, idle)).toBeNull();
    const none = draw(settingsOf({ rows: [] }));
    // The switch shows with no changed channel.
    expect(walk(none).some((v) => v.type === VirtualList)).toBe(true);
    expect(byTestId(none, 'channels-ready')).toEqual([]);
    expect(textOf(byTestId(none, 'channels-intro'))).toBe("You haven't changed any channel. The info bar's pencil changes the one you watch.");
    expect(textOf(byTestId(draw(settingsOf({ status: 'loading', rows: [] })), 'channels-intro'))).toBe('The channels you renamed, renumbered, hid or locked. Press OK on one to change it again.');
  });

  it('draws the switch with its value beside its name, and the word when it didn’t take', () => {
    const render = list(draw(settingsOf({ clean: true }))).renderItem as (i: number, item: ItemBinding) => VNode;
    const on = expand(render(0, focused));
    expect((on.props as Props)['data-value']).toBe('true');
    expect((on.props as Props)['aria-checked']).toBe('true');
    expect((on.props as Props).class).toBe('groups__row is-focused');
    expect(textOf(byTestId(on, 'channels-clean-value'))).toBe('On');
    expect(textOf(byTestId(on, 'channels-clean-hint'))).toBe('Leaves out tags like AR | or UK: at the start of names');
    const off = expand((list(draw(settingsOf({ clean: false, failed: true }))).renderItem as (i: number, item: ItemBinding) => VNode)(0, idle));
    expect(textOf(byTestId(off, 'channels-clean-value'))).toBe('Off');
    expect((off.props as Props)['data-failed']).toBe('true');
    expect(textOf(byTestId(off, 'channels-clean-hint'))).toBe("Couldn't change it. Try again.");
    expect((byTestId(off, 'channels-clean-hint')[0]!.props as Props).class).toBe('groups__line settings__warn');
    const unread = expand((list(draw(settingsOf({ clean: null }))).renderItem as (i: number, item: ItemBinding) => VNode)(0, idle));
    expect(byTestId(unread, 'channels-clean-value')).toEqual([]);
    expect((unread.props as Props)['aria-checked']).toBeUndefined();
  });

  it('draws a channel: the number it shows, its name as data, what was changed; a hidden one dimmed', () => {
    const hidden = EditedItem({ i18n: en, row: rows[0]!, index: 0, item: memory });
    expect((hidden.props as Props).class).toBe('groups__row is-hidden is-memory');
    expect((hidden.props as Props)['data-hidden']).toBe('true');
    expect((hidden.props as Props)['data-found']).toBe('true');
    expect(textOf(byTestId(hidden, 'channels-row-0-number'))).toBe('42');
    const name = byTestId(hidden, 'channels-row-0-name')[0]!;
    expect(textOf(name)).toBe('MBC 1');
    expect((name.props as Props).translate).toBe(false);
    expect(textOf(byTestId(hidden, 'channels-row-0-line'))).toBe('Hidden · Renumbered');
    const missing = EditedItem({ i18n: en, row: rows[1]!, index: 1, item: idle });
    expect((missing.props as Props).class).toBe('groups__row');
    expect((missing.props as Props)['data-found']).toBe('false');
    expect(textOf(byTestId(missing, 'channels-row-1-number'))).toBe('');
    expect(textOf(byTestId(missing, 'channels-row-1-line'))).toBe('Renamed · Not in your sources now');
  });

  it('puts the menu and its forms over the page, opened from it', () => {
    const editor = editorOf({ over: false });
    const binding2 = { nav: { top: { id: EDIT_NUMBER } } } as unknown as FocusBinding;
    const withMenu = EditedPage({ i18n: en, binding: binding2, focus: { ...focus, screen: EDIT_SCREEN }, settings: settingsOf({ editor }) })!;
    expect(walk(withMenu).filter((v) => typeof v.type === 'function' && (v.props as Props).editor === editor && (v.props as Props).screen !== undefined)).toHaveLength(1);
    const withForm = EditedPage({ i18n: en, binding: binding2, focus: { ...focus, screen: EDIT_NUMBER }, settings: settingsOf({ editor }) })!;
    const parts = walk(withForm).filter((v) => typeof v.type === 'function' && (v.props as Props).editor === editor);
    expect(parts).toHaveLength(1);
    expect((parts[0]!.props as Props).number).toBe(true);
    // The menu's screen gone: no menu.
    expect(walk(EditedPage({ i18n: en, binding: binding2, focus: { ...focus, screen: EDIT_SCREEN }, settings: settingsOf({ editor: editorOf({ over: false, screen: null }) }) })!).filter((v) => typeof v.type === 'function' && (v.props as Props).screen !== undefined && (v.props as Props).editor !== undefined)).toHaveLength(0);
  });
});

describe('where the screens paint', () => {
  const base = {
    guides: { pending: signal(0), editor: { editing: signal(null) } },
    unmatched: { pending: signal(0) },
    mapping: { pending: signal(0), reading: signal(0), editor: { editing: signal(null) } },
    sources: { pending: signal(0) },
    backup: null,
    telemetry: null,
    report: null,
    connection: null,
    groups: { pending: signal(0), editor: { editing: signal(null) } },
    channels: { pending: signal(0), screen: signal(null) },
    parental: null,
  };
  const paints = (screen: string, over: boolean): boolean => {
    const settings = { ...base, channel: { pending: signal(0), over: signal(over), editor: { editing: signal(null) } } } as unknown as Settings;
    const focus = { screen, zone: 'actions', index: 0, pointer: false, dir: 'ltr', depth: 3 } as Focus;
    const root = SettingsScreen({ settings, i18n: en, binding: {} as FocusBinding, focus });
    return walk(root).some((v) => v.type === EditedPage);
  };

  it('paints "Channels" and the menu opened from it in the settings, not the pencil’s menu (main paints that over the player)', () => {
    expect(paints(CHANNELS_SCREEN, false)).toBe(true);
    expect(paints(EDIT_SCREEN, false)).toBe(true);
    expect(paints(EDIT_RENAME, false)).toBe(true);
    expect(paints(EDIT_NUMBER, false)).toBe(true);
    expect(paints(EDIT_SCREEN, true)).toBe(false);
    expect(paints(EDIT_NUMBER, true)).toBe(false);
    // ("Channels" is never under the pencil's menu, but would paint all the same.)
    expect(paints(CHANNELS_SCREEN, true)).toBe(true);
    expect(paints('groups', false)).toBe(false);
  });

  it('tells main which screens paint over the player: the menu and its forms, opened by the pencil', () => {
    const platform = { textKey: () => null, onSoftKeyboard: () => () => undefined };
    const engine = { profile: () => Promise.resolve(null) } as never;
    const nav = createNavigator({ root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined });
    const loaded = loadSettings({ nav, engine, refreshNow: () => Promise.resolve(), offsetChanged: () => undefined, platform } as never);
    expect(loaded.Over).toBe(ChannelEditOver);
    expect([EDIT_SCREEN, EDIT_RENAME, EDIT_NUMBER, CHANNELS_SCREEN].map((s) => loaded.over(s))).toEqual([false, false, false, false]);
    (loaded.settings.channel.over as unknown as { value: boolean }).value = true;
    expect([EDIT_SCREEN, EDIT_RENAME, EDIT_NUMBER, CHANNELS_SCREEN, 'player'].map((s) => loaded.over(s))).toEqual([true, true, true, false, false]);
    expect(loaded.screens).toContain(CHANNELS_SCREEN);
    expect(loaded.screens).toContain(EDIT_SCREEN);
  });
});
