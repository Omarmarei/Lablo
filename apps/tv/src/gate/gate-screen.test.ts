import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type { ConfigPolicy } from '@lablo/data';
import { noPolicy } from '@lablo/data';
import { stripIsolates } from '@lablo/core';
import { describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import { GateScreen } from './GateApp';
import { createGate } from './gate-state';

/**
 * The gate as drawn (RELAY step 30c2a), called as a function over a real gate (its components are
 * not expanded): each view's texts in English, Arabic and the pseudo-locale. The e2e draws them
 * in the dev app and the built webOS bundle.
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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};
const props = (node: VNode | undefined): Props => (node?.props ?? {}) as Props;

const MESSAGE = { en: 'Lablo 1.0.4 fixes playback.', ar: 'يصلح لابلو 1.0.4 التشغيل.' };

function gateFor(fields: Partial<ConfigPolicy>) {
  const gate = createGate({
    policy: signal({ ...noPolicy(), ...fields }),
    version: '1.0.0',
    platform: { keyToIntent: () => null, onPointer: () => () => undefined, exitApp: vi.fn() },
    target: { addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as EventTarget,
    shown: vi.fn(),
    stopped: vi.fn(),
    release: () => undefined,
  });
  gate.start([]);
  return gate;
}

describe('GateScreen', () => {
  it('draws nothing while the gate is closed', () => {
    expect(GateScreen({ gate: gateFor({}), i18n: appI18n('en-US') })).toBeNull();
  });

  it("draws disable-app full screen with the doc's message in the UI's language", () => {
    const gate = gateFor({ kill: { id: 'court-order', mode: 'disable-app', message: MESSAGE } });
    const en = GateScreen({ gate, i18n: appI18n('en-US') });
    const root = props(byTestId(en, 'gate')[0]);
    expect(root.class).toBe('gate');
    expect(root['data-kind']).toBe('disabled');
    expect(root['data-id']).toBe('court-order');
    expect(root['data-exit']).toBe('false');
    expect(root['data-language']).toBe('en');
    expect(root['aria-label']).toBe('Lablo is unavailable');
    expect(textOf(byTestId(en, 'gate-message'))).toBe(MESSAGE.en);
    expect(byTestId(en, 'gate-versions')).toEqual([]);
    expect(props(byTestId(en, 'gate-close')[0])).toMatchObject({ label: 'Close Lablo', variant: 'primary', state: 'focused' });

    const ar = GateScreen({ gate, i18n: appI18n('ar-SA') });
    expect(props(byTestId(ar, 'gate')[0])['data-language']).toBe('ar');
    expect(textOf(byTestId(ar, 'gate-message'))).toBe(MESSAGE.ar);
    expect(props(byTestId(ar, 'gate-close')[0]).label).toBe('إغلاق لابلو');
  });

  it("says the catalog's text for disable-app without a message, and the doc's English in the pseudo-locale", () => {
    const silent = gateFor({ kill: { id: 'off', mode: 'disable-app', message: null } });
    expect(textOf(byTestId(GateScreen({ gate: silent, i18n: appI18n('en-US') }), 'gate-message'))).toBe("Lablo can't be used on this TV right now.");
    expect(textOf(byTestId(GateScreen({ gate: silent, i18n: appI18n('ar-SA') }), 'gate-message'))).toBe('لا يمكن استخدام لابلو على هذا التلفاز حاليًا.');
    const pseudo = GateScreen({ gate: gateFor({ kill: { id: 'off', mode: 'disable-app', message: MESSAGE } }), i18n: appI18n('en-XA') });
    expect(props(byTestId(pseudo, 'gate')[0])['data-language']).toBe('pseudo');
    expect(textOf(byTestId(pseudo, 'gate-message'))).toBe(MESSAGE.en);
  });

  it('asks for an update with this version and the one needed', () => {
    const gate = gateFor({ updateRequired: true, minVersion: '1.2.0' });
    const en = GateScreen({ gate, i18n: appI18n('en-US') });
    const root = props(byTestId(en, 'gate')[0]);
    expect(root['data-kind']).toBe('update');
    expect(root['data-id']).toBe('');
    expect(root['aria-label']).toBe('Update Lablo');
    expect(textOf(byTestId(en, 'gate-message'))).toBe("This version of Lablo can't be used any more. Update Lablo from your TV's app store, then open it again.");
    // The versions are isolated text arguments (FSI and PDI with their marks): compare without them.
    expect(stripIsolates(textOf(byTestId(en, 'gate-versions')))).toBe('This version: 1.0.0. Needed: 1.2.0 or later.');
    const ar = GateScreen({ gate, i18n: appI18n('ar-SA') });
    expect(stripIsolates(textOf(byTestId(ar, 'gate-versions')))).toBe('هذا الإصدار: 1.0.0. المطلوب: 1.2.0 أو أحدث.');
    expect(walk(ar).some((v) => textOf((v.props as Props).children) === 'حدّث لابلو')).toBe(true);
  });

  it('draws a notice as a dialog with "OK"', () => {
    const gate = gateFor({ notices: [{ id: 'news', mode: 'notice', message: MESSAGE }] });
    const en = GateScreen({ gate, i18n: appI18n('en-US') });
    const root = props(byTestId(en, 'gate')[0]);
    expect(root.class).toBe('gate-notice');
    expect(root['data-kind']).toBe('notice');
    expect(root['data-id']).toBe('news');
    expect(props(byTestId(en, 'gate-notice')[0])).toMatchObject({ title: 'A message from Lablo', message: MESSAGE.en });
    expect(props(byTestId(en, 'gate-ok')[0])).toMatchObject({ label: 'OK', state: 'focused' });
    const ar = GateScreen({ gate, i18n: appI18n('ar-SA') });
    expect(props(byTestId(ar, 'gate-notice')[0])).toMatchObject({ title: 'رسالة من لابلو', message: MESSAGE.ar });
    expect(props(byTestId(ar, 'gate-ok')[0]).label).toBe('حسنًا');
  });

  it('says when Close Lablo was asked for', () => {
    let press: ((event: object) => void) | null = null;
    const gate = createGate({
      policy: signal({ ...noPolicy(), kill: { id: 'off', mode: 'disable-app', message: null } }),
      version: '1.0.0',
      platform: { keyToIntent: () => 'OK', onPointer: () => () => undefined, exitApp: vi.fn() },
      target: {
        addEventListener: (type: string, fn: (event: object) => void) => {
          if (type === 'keydown') press = fn;
        },
        removeEventListener: () => undefined,
      } as unknown as EventTarget,
      shown: vi.fn(),
      stopped: vi.fn(),
      release: () => undefined,
    });
    gate.start([]);
    press!({ stopImmediatePropagation: () => undefined, preventDefault: () => undefined });
    expect(props(byTestId(GateScreen({ gate, i18n: appI18n('en-US') }), 'gate')[0])['data-exit']).toBe('true');
  });
});
