import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type { ItemBinding } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { SettingsView, TelemetryRow, itemText, telemetryText } from './SettingsScreen';
import type { TelemetrySwitch } from './telemetry-switch';

/**
 * Settings' "Usage and crash reports" row (RELAY step 33b3) as drawn, called as functions (their
 * components are not expanded); the e2e drives it in the app.
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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id);
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

const ON_HINT = 'Anonymous: never your links, logins or channel names';
const OFF_HINT = 'Nothing is sent while they are off';
const FAILED = "Couldn't change it. Try again.";

function fakeSwitch(value: boolean | null, failed = false, busy = false): TelemetrySwitch {
  return {
    value: signal(value),
    busy: signal(busy),
    failed: signal(failed),
    pending: signal(0),
    read: () => undefined,
    press: () => undefined,
    dispose: () => undefined,
  };
}

describe('the usage reports’ row’s words (RELAY step 33b3)', () => {
  it('names the row, with the "on" line as its plain hint', () => {
    expect(itemText(en.t, 'telemetry')).toEqual({ name: 'Usage and crash reports', hint: ON_HINT });
    expect(itemText(ar.t, 'telemetry').name).toBe('تقارير الاستخدام والأعطال');
  });

  it('gives the value and the line under it: on, off, not read yet, and a change that didn’t take', () => {
    expect(telemetryText(en.t, true, false)).toEqual({ value: 'On', hint: ON_HINT });
    expect(telemetryText(en.t, false, false)).toEqual({ value: 'Off', hint: OFF_HINT });
    expect(telemetryText(en.t, null, false)).toEqual({ value: '', hint: ON_HINT });
    expect(telemetryText(en.t, true, true)).toEqual({ value: 'On', hint: FAILED });
    expect(telemetryText(en.t, false, true)).toEqual({ value: 'Off', hint: FAILED });
    expect(telemetryText(en.t, null, true)).toEqual({ value: '', hint: FAILED });
    // In Arabic, the value agrees with the reports (feminine).
    expect(telemetryText(ar.t, true, false)).toEqual({ value: 'مفعّلة', hint: 'مجهولة الهوية: لا تتضمن أبدًا روابطك أو بيانات دخولك أو أسماء قنواتك' });
    expect(telemetryText(ar.t, false, false)).toEqual({ value: 'متوقفة', hint: 'لا يُرسل شيء ما دامت متوقفة' });
    expect(telemetryText(ar.t, false, true).hint).toBe('تعذّر تغييره. حاول مرة أخرى.');
  });
});

describe('the usage reports’ row as drawn (RELAY step 33b3)', () => {
  it('is a checkbox in the menu with its value beside its name and the line under it', () => {
    const root = TelemetryRow({ i18n: en, item: focused, telemetry: fakeSwitch(true) });
    expect(root.props as Props).toMatchObject({
      class: 'settings__row settings__switch is-focused',
      role: 'menuitemcheckbox',
      'aria-checked': 'true',
      'data-testid': 'settings-telemetry',
      'data-state': 'focused',
      'data-value': 'true',
      'data-busy': 'false',
      'data-failed': 'false',
    });
    expect((root.props as Props)['onClick']).toBe(focused.onPress);
    expect((root.props as Props)['onMouseMove']).toBe(focused.onHover);
    expect(textOf(walk(root).filter((v) => (v.props as Props)['class'] === 'settings__name')[0])).toBe('Usage and crash reports');
    expect(textOf(byTestId(root, 'settings-telemetry-value')[0])).toBe('On');
    const hint = byTestId(root, 'settings-telemetry-hint')[0]!;
    expect((hint.props as Props)['class']).toBe('settings__hint');
    expect(textOf(hint)).toBe(ON_HINT);
  });

  it('shows off, busy, no value before it is read, and a change that didn’t take in the warning colour', () => {
    let root = TelemetryRow({ i18n: en, item: idle, telemetry: fakeSwitch(false, false, true) });
    expect(root.props as Props).toMatchObject({ class: 'settings__row settings__switch', 'aria-checked': 'false', 'data-value': 'false', 'data-busy': 'true', 'data-state': 'idle' });
    expect(textOf(byTestId(root, 'settings-telemetry-value')[0])).toBe('Off');
    expect(textOf(byTestId(root, 'settings-telemetry-hint')[0])).toBe(OFF_HINT);

    root = TelemetryRow({ i18n: en, item: idle, telemetry: fakeSwitch(null) });
    expect((root.props as Props)['aria-checked']).toBeUndefined();
    expect((root.props as Props)['data-value']).toBe('');
    expect(byTestId(root, 'settings-telemetry-value')).toHaveLength(0);
    expect(textOf(byTestId(root, 'settings-telemetry-hint')[0])).toBe(ON_HINT);

    root = TelemetryRow({ i18n: en, item: idle, telemetry: fakeSwitch(true, true) });
    expect((root.props as Props)['data-failed']).toBe('true');
    const hint = byTestId(root, 'settings-telemetry-hint')[0]!;
    expect((hint.props as Props)['class']).toBe('settings__hint settings__warn');
    expect(textOf(hint)).toBe(FAILED);
    expect(textOf(byTestId(root, 'settings-telemetry-value')[0])).toBe('On');

    // In Arabic.
    root = TelemetryRow({ i18n: ar, item: idle, telemetry: fakeSwitch(false) });
    expect(textOf(byTestId(root, 'settings-telemetry-value')[0])).toBe('متوقفة');
  });

  it('draws it fourth in the settings list with its own binding, the other rows as menu items', () => {
    const telemetry = fakeSwitch(true);
    const bindings: ItemBinding[] = [idle, idle, idle, focused];
    const root = SettingsView({ i18n: en, list: ['guides', 'sources', 'backup', 'telemetry'], item: (i) => bindings[i]!, telemetry });
    expect(textOf(walk(root).filter((v) => v.type === 'h1')[0])).toBe('Settings');
    const rows = walk(root).filter((v) => (v.props as Props)['role'] === 'menuitem');
    expect(rows.map((v) => (v.props as Props)['data-testid'])).toEqual(['settings-guides', 'settings-sources', 'settings-backup']);
    expect(textOf(rows[2])).toBe('BackupAn encrypted copy of your sources and settings, and its code');
    const row = walk(root).filter((v) => v.type === TelemetryRow);
    expect(row).toHaveLength(1);
    expect(row[0]!.props as Props).toMatchObject({ i18n: en, item: focused, telemetry });
    expect(row[0]!.key).toBe('telemetry');
    // Without its switch (never listed then), the row would be a plain one.
    const plain = SettingsView({ i18n: en, list: ['guides', 'telemetry'], item: () => idle, telemetry: null });
    expect(walk(plain).filter((v) => v.type === TelemetryRow)).toHaveLength(0);
    expect(textOf(byTestId(plain, 'settings-telemetry')[0])).toBe(`Usage and crash reports${ON_HINT}`);
  });
});
