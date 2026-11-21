import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import { bindFocus, createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import { createLazyFile } from './lazy-file';
import { LoadingScreen } from './LoadingScreen';

/** The loading screen as drawn (RELAY step 35e), called as a function (its components are not expanded). */

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

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

/** The loading screen on a navigator, its load failed (`fail`) or still on its way. */
async function draw(fail: boolean) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 6 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const file = createLazyFile<string>({
    nav,
    timers: { set: () => 0, clear: () => undefined },
    load: () => (fail ? Promise.reject(new Error('no')) : new Promise<string>(() => undefined)),
  });
  file.use(() => undefined);
  await flush();
  const binding = bindFocus(nav);
  return (language: string) => LoadingScreen({ phase: fail ? 'failed' : 'spinner', i18n: appI18n(language), binding, focus: nav.snapshot() });
}

describe('the loading screen of a lazy file (RELAY step 35e)', () => {
  it('shows a spinner while the file is on its way', async () => {
    const page = (await draw(false))('en-US');
    expect(page.props).toMatchObject({ class: 'lazy-loading', 'data-testid': 'lazy-loading', 'data-phase': 'spinner', 'data-screen': 'lazy-loading', 'data-index': -1, 'data-language': 'en' });
    expect(byTestId(page, 'lazy-loading-spinner')).toHaveLength(1);
    expect(byTestId(page, 'lazy-loading-failed')).toHaveLength(0);
  });

  it('says a failed load with "Try again" focused, in English and Arabic', async () => {
    const draw2 = await draw(true);
    const en = draw2('en-US');
    expect(en.props).toMatchObject({ 'data-phase': 'failed', 'data-zone': 'retry', 'data-index': 0 });
    expect(byTestId(en, 'lazy-loading-spinner')).toHaveLength(0);
    const failed = byTestId(en, 'lazy-loading-failed')[0]!;
    expect(textOf(failed)).toBe("Couldn't open this screen.");
    const retry = byTestId(en, 'lazy-loading-retry')[0]!;
    expect(retry.props).toMatchObject({ label: 'Try again', variant: 'primary', state: 'focused' });
    const ar = draw2('ar-SA');
    expect(ar.props).toMatchObject({ 'data-language': 'ar', 'data-dir': 'ltr' });
    expect(stripIsolates(textOf(byTestId(ar, 'lazy-loading-failed')[0]))).toBe('تعذّر فتح هذه الشاشة.');
    expect((byTestId(ar, 'lazy-loading-retry')[0]!.props as { label: string }).label).toBe('إعادة المحاولة');
  });
});
