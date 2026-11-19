import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type { DiagSendResult } from '@lablo/data';
import type { ItemBinding } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import type { ReportRow, ReportState } from './diag-report';
import { createReportRow } from './diag-report';
import { ReportItem, SettingsView, itemText, reportText } from './SettingsScreen';

/**
 * Settings' "Send a report to support" row (RELAY step 33d2): its state (`diag-report.ts`) and as
 * drawn, called as functions (components not expanded); the e2e drives it in the app.
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

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const focused: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };

const HINT = "Your TV's model, the app's state and recent errors, never your links or logins";
const SENT = 'Your support code: give it to support with your question';
const FAILED = "Couldn't send it. Check your internet connection and try again.";

afterEach(() => vi.restoreAllMocks());

/** A send the test settles. */
function heldSend() {
  const calls: { resolve: (r: DiagSendResult) => void; reject: (e: unknown) => void }[] = [];
  const send = (): Promise<DiagSendResult> =>
    new Promise<DiagSendResult>((resolve, reject) => {
      calls.push({ resolve, reject });
    });
  return { send, calls };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('the report row’s state (RELAY step 33d2)', () => {
  it('sends on OK, shows the code it answered, and does nothing on OK while it sends', async () => {
    const held = heldSend();
    const row = createReportRow({ send: held.send });
    expect(row.state.value).toEqual({ state: 'idle' });
    row.press();
    expect([row.state.value, row.pending.value, held.calls.length]).toEqual([{ state: 'sending' }, 1, 1]);
    row.press();
    expect(held.calls).toHaveLength(1);
    held.calls[0]!.resolve({ state: 'sent', code: 'K7M2Q9' });
    await flush();
    expect([row.state.value, row.pending.value]).toEqual([{ state: 'sent', code: 'K7M2Q9' }, 0]);
    // OK again sends a new report.
    row.press();
    expect(held.calls).toHaveLength(2);
  });

  it('says it failed, warning why, for a failed answer, a send that throws or rejects; OK tries again', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const held = heldSend();
    const row = createReportRow({ send: held.send });
    row.press();
    held.calls[0]!.resolve({ state: 'failed', failure: 'status', status: 503 });
    await flush();
    expect([row.state.value, row.pending.value]).toEqual([{ state: 'failed' }, 0]);
    row.press();
    held.calls[1]!.resolve({ state: 'failed', failure: 'timeout', status: null });
    await flush();
    row.press();
    held.calls[2]!.reject(new Error('worker died'));
    await flush();
    expect(row.state.value).toEqual({ state: 'failed' });
    expect(warned.mock.calls.map((c) => c[1] instanceof Error ? 'error' : c[1])).toEqual([503, 'timeout', 'error']);
    expect(warned.mock.calls.every((c) => c[0] === 'The report was not sent')).toBe(true);
    const throwing = createReportRow({
      send: () => {
        throw new Error('no engine');
      },
    });
    throwing.press();
    await flush();
    expect([throwing.state.value, throwing.pending.value]).toEqual([{ state: 'failed' }, 0]);
  });

  it('clears a code or a failure at each opening, never a send in progress', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const held = heldSend();
    const row = createReportRow({ send: held.send });
    row.press();
    held.calls[0]!.resolve({ state: 'sent', code: 'AB12CD' });
    await flush();
    row.opened();
    expect(row.state.value).toEqual({ state: 'idle' });
    row.press();
    held.calls[1]!.resolve({ state: 'failed', failure: 'network', status: null });
    await flush();
    row.opened();
    expect(row.state.value).toEqual({ state: 'idle' });
    row.press();
    row.opened();
    expect(row.state.value).toEqual({ state: 'sending' });
    held.calls[2]!.resolve({ state: 'sent', code: 'ZZ0011' });
    await flush();
    expect(row.state.value).toEqual({ state: 'sent', code: 'ZZ0011' });
  });

  it('once disposed, sends nothing more and leaves its state, counting a send in progress out', async () => {
    const held = heldSend();
    const row = createReportRow({ send: held.send });
    row.press();
    row.dispose();
    held.calls[0]!.resolve({ state: 'sent', code: 'K7M2Q9' });
    await flush();
    expect([row.state.value, row.pending.value]).toEqual([{ state: 'sending' }, 0]);
    row.opened();
    row.press();
    expect(held.calls).toHaveLength(1);
    // An idle row disposed sends nothing either.
    const idle = createReportRow({ send: held.send });
    idle.dispose();
    idle.press();
    expect([held.calls.length, idle.state.value, idle.pending.value]).toEqual([1, { state: 'idle' }, 0]);
  });
});

function fakeRow(state: ReportState): ReportRow {
  return { state: signal(state), pending: signal(0), opened: () => undefined, press: () => undefined, dispose: () => undefined };
}

describe('the report row’s words and drawing (RELAY step 33d2)', () => {
  it('names the row, with what the report holds as its line, in English and Arabic', () => {
    expect(itemText(en.t, 'report')).toEqual({ name: 'Send a report to support', hint: HINT });
    expect(itemText(ar.t, 'report')).toEqual({ name: 'إرسال تقرير إلى الدعم', hint: 'طراز التلفزيون وحالة التطبيق والأعطال الأخيرة، دون روابطك أو بيانات دخولك أبدًا' });
    expect(reportText(en.t, { state: 'idle' })).toEqual({ hint: HINT, code: null, warn: false });
    expect(reportText(en.t, { state: 'sending' })).toEqual({ hint: 'Sending…', code: null, warn: false });
    expect(reportText(en.t, { state: 'sent', code: 'K7M2Q9' })).toEqual({ hint: SENT, code: 'K7M2Q9', warn: false });
    expect(reportText(en.t, { state: 'failed' })).toEqual({ hint: FAILED, code: null, warn: true });
    expect(reportText(ar.t, { state: 'sending' }).hint).toBe('جارٍ الإرسال…');
    expect(reportText(ar.t, { state: 'sent', code: 'K7M2Q9' }).hint).toBe('رمز الدعم الخاص بك: أعطه لفريق الدعم مع سؤالك');
    expect(reportText(ar.t, { state: 'failed' }).hint).toBe('تعذّر إرساله. تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.');
  });

  it('is a menu item; once sent, the code beside its name in large type, left to right', () => {
    let root = ReportItem({ i18n: en, item: focused, report: fakeRow({ state: 'idle' }) });
    expect(root.props as Props).toMatchObject({
      class: 'settings__row settings__switch is-focused',
      role: 'menuitem',
      'aria-busy': undefined,
      'data-testid': 'settings-report',
      'data-state': 'focused',
      'data-report': 'idle',
    });
    expect((root.props as Props)['onClick']).toBe(focused.onPress);
    expect((root.props as Props)['onMouseMove']).toBe(focused.onHover);
    expect(textOf(walk(root).filter((v) => (v.props as Props)['class'] === 'settings__name')[0])).toBe('Send a report to support');
    expect(byTestId(root, 'settings-report-code')).toHaveLength(0);
    expect(textOf(byTestId(root, 'settings-report-hint')[0])).toBe(HINT);

    root = ReportItem({ i18n: ar, item: idle, report: fakeRow({ state: 'sent', code: 'K7M2Q9' }) });
    const code = byTestId(root, 'settings-report-code')[0]!;
    expect(code.props as Props).toMatchObject({ class: 'settings__value settings__code', dir: 'ltr', translate: false });
    expect(textOf(code)).toBe('K7M2Q9');
    expect((root.props as Props)['data-report']).toBe('sent');

    root = ReportItem({ i18n: en, item: idle, report: fakeRow({ state: 'sending' }) });
    expect((root.props as Props)['aria-busy']).toBe('true');
    expect(textOf(byTestId(root, 'settings-report-hint')[0])).toBe('Sending…');

    root = ReportItem({ i18n: en, item: idle, report: fakeRow({ state: 'failed' }) });
    const hint = byTestId(root, 'settings-report-hint')[0]!;
    expect((hint.props as Props)['class']).toBe('settings__hint settings__warn');
    expect(textOf(hint)).toBe(FAILED);
  });

  it('draws it fifth in the settings list with its own binding', () => {
    const report = fakeRow({ state: 'idle' });
    const bindings: ItemBinding[] = [idle, idle, idle, idle, focused];
    const root = SettingsView({ i18n: en, list: ['guides', 'sources', 'backup', 'telemetry', 'report'], item: (i) => bindings[i]!, telemetry: null, report });
    const row = walk(root).filter((v) => v.type === ReportItem);
    expect(row).toHaveLength(1);
    expect(row[0]!.props as Props).toMatchObject({ i18n: en, item: focused, report });
    expect(row[0]!.key).toBe('report');
    // Without its row state (never listed then), it would be a plain row.
    const plain = SettingsView({ i18n: en, list: ['report'], item: () => idle, telemetry: null });
    expect(walk(plain).filter((v) => v.type === ReportItem)).toHaveLength(0);
    expect(textOf(byTestId(plain, 'settings-report')[0])).toBe(`Send a report to support${HINT}`);
  });
});
