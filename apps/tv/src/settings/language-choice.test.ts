import type { Intent } from '@lablo/platform-api';
import type { Language } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import { LANGUAGE_SCREEN, createLanguageChoice } from './language-choice';

/**
 * Settings › "Language" (RELAY step 38d2): the dialog over the settings, its focus on the language
 * on show, a switch only for another language, after the dialog has closed.
 */

const ROW = 5;

function setup(shown: Language) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const settings = nav.push({ id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 9, visible: 7 }] });
  settings.focus('items', ROW);
  /** Where the focus was when `set` ran. */
  const setAt: string[] = [];
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const set = vi.fn((_language: Language) => {
    setAt.push(at());
  });
  const current = vi.fn(() => shown);
  const choice = createLanguageChoice(nav, { current, set });
  const press = (...keys: Intent[]): void => {
    for (const key of keys) nav.handle(key);
  };
  return { nav, settings, choice, set, setAt, current, at, press };
}

describe('Settings › "Language" (RELAY step 38d2)', () => {
  it('opens a dialog of the languages, in onboarding’s order, over the settings, its focus on the language on show', () => {
    for (const [shown, index] of [
      ['en', 0],
      ['ar', 1],
    ] as const) {
      const t = setup(shown);
      expect(t.choice.languages).toEqual(['en', 'ar']);
      expect(t.choice.under.value).toBeNull();
      t.choice.open();
      expect(t.current).toHaveBeenCalledTimes(1);
      expect(t.nav.top.id).toBe(LANGUAGE_SCREEN);
      expect(t.nav.top.zone('languages')).toMatchObject({ kind: 'list', axis: 'horizontal', count: 2 });
      expect(t.at()).toBe(`language · languages ${index}`);
      // The settings' list paints under it, on its row.
      expect(t.choice.under.value).toBe(t.settings);
      expect(t.settings.position('items').index).toBe(ROW);
    }
  });

  it('switches on OK on the other language, once the dialog has closed on the row', () => {
    const t = setup('en');
    t.choice.open();
    // A horizontal row of buttons: RIGHT moves (left to right here), DOWN doesn't.
    t.press('DOWN');
    expect(t.at()).toBe('language · languages 0');
    t.press('RIGHT');
    expect(t.at()).toBe('language · languages 1');
    t.press('OK');
    expect(t.set).toHaveBeenCalledTimes(1);
    expect(t.set).toHaveBeenCalledWith('ar');
    expect(t.setAt).toEqual([`settings · items ${ROW}`]);
    expect(t.at()).toBe(`settings · items ${ROW}`);
    expect(t.choice.under.value).toBeNull();
  });

  it('switches back from Arabic, LEFT and RIGHT as the screen’s direction has them', () => {
    const t = setup('ar');
    t.nav.setDir('rtl');
    t.choice.open();
    expect(t.at()).toBe('language · languages 1');
    // Right to left: "English", the first, is to the right.
    t.press('LEFT');
    expect(t.at()).toBe('language · languages 1');
    t.press('RIGHT');
    expect(t.at()).toBe('language · languages 0');
    t.press('OK');
    expect(t.set).toHaveBeenCalledWith('en');
    expect(t.setAt).toEqual([`settings · items ${ROW}`]);
  });

  it('only closes on OK on the language on show, and on Back', () => {
    const t = setup('ar');
    t.choice.open();
    t.press('OK');
    expect(t.at()).toBe(`settings · items ${ROW}`);
    expect(t.choice.under.value).toBeNull();
    t.choice.open();
    t.press('LEFT', 'BACK');
    expect(t.at()).toBe(`settings · items ${ROW}`);
    expect(t.choice.under.value).toBeNull();
    expect(t.set).not.toHaveBeenCalled();
    // Each opening asks which language shows.
    expect(t.current).toHaveBeenCalledTimes(2);
  });

  it('focuses the first language when the one on show isn’t listed', () => {
    const t = setup('fr' as Language);
    t.choice.open();
    expect(t.at()).toBe('language · languages 0');
    t.press('OK');
    expect(t.set).toHaveBeenCalledWith('en');
  });
});
