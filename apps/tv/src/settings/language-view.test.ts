import type { VNode } from 'preact';
import type { ItemBinding } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { LanguageDialogView, languageLine } from './LanguageDialog';
import { SettingsView, itemText } from './SettingsScreen';

/**
 * Settings › "Language" as drawn (RELAY step 38d2): the row's name in the screen's language, its
 * line and the dialog's buttons in each language's own name, never translated.
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
const xa = appI18n('en-XA');
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };
const focused: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };

describe('Settings › "Language" as drawn (RELAY step 38d2)', () => {
  it('names the row in the screen’s language, its line the languages’ own names in both', () => {
    expect(languageLine()).toBe('English · العربية');
    expect(itemText(en.t, 'language')).toEqual({ name: 'Language', hint: 'English · العربية' });
    expect(itemText(ar.t, 'language')).toEqual({ name: 'اللغة', hint: 'English · العربية' });
    // Our word in the pseudo-locale; the names never.
    expect(itemText(xa.t, 'language').name).toMatch(/^\[.*\]$/);
    expect(itemText(xa.t, 'language').hint).toBe('English · العربية');
  });

  it('draws the row’s line as each language’s name in its language and direction, never translated', () => {
    for (const i18n of [en, ar]) {
      const root = SettingsView({ i18n, list: ['parental', 'language', 'backup'], item: (i) => (i === 1 ? focused : idle), telemetry: null });
      const row = byTestId(root, 'settings-language')[0];
      expect(propsOf(row)).toMatchObject({ role: 'menuitem', 'data-state': 'focused', class: 'settings__row is-focused' });
      expect(textOf(row)).toBe(`${i18n.t('settings.language')}English · العربية`);
      expect(propsOf(byTestId(row, 'settings-language-en')[0])).toMatchObject({ lang: 'en', dir: 'ltr', translate: false });
      expect(propsOf(byTestId(row, 'settings-language-ar')[0])).toMatchObject({ lang: 'ar', dir: 'rtl', translate: false });
      expect(textOf(byTestId(row, 'settings-language-ar')[0])).toBe('العربية');
      // The other rows keep their plain line.
      expect(textOf(byTestId(root, 'settings-parental')[0])).toBe(i18n.t('settings.parental') + i18n.t('settings.parentalHint'));
    }
  });

  it('draws the dialog: its title and line in the screen’s language, a button per language under its own name', () => {
    const bindings = [idle, focused];
    for (const i18n of [en, ar]) {
      const dialog = LanguageDialogView({ i18n, languages: ['en', 'ar'], item: (i) => bindings[i]! });
      expect(propsOf(dialog)).toMatchObject({ title: i18n.t('settings.language'), message: i18n.t('settings.languageBody'), testId: 'language-dialog' });
      const buttons = walk(propsOf(dialog).children).filter((v) => typeof propsOf(v)['testId'] === 'string');
      expect(buttons.map((b) => [propsOf(b)['testId'], propsOf(b)['label'], propsOf(b)['lang'], propsOf(b)['state']])).toEqual([
        ['language-dialog-en', 'English', 'en', 'idle'],
        ['language-dialog-ar', 'العربية', 'ar', 'focused'],
      ]);
    }
    expect(en.t('settings.languageBody')).toBe('Menus and buttons change at once. Channel and programme names stay as your provider sends them.');
    expect(ar.t('settings.language')).toBe('اللغة');
  });
});
