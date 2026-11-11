import { PLURAL_CATEGORIES, stripIsolates } from '@lablo/core';
import { messageArguments, parseMessage, pluralBranches, pseudoLocalize, resolveLocale } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { AR } from './ar';
import type { MessageKey } from './en';
import { EN } from './en';
import { CATALOGS, LANGUAGE_NAMES, appI18n, otherLanguage, switchedTag } from './index';

const KEYS = Object.keys(EN) as MessageKey[];
const ARABIC_LETTER = /[\u0621-\u064a]/;
const LATIN_LETTER = /[A-Za-z]/;

/** Sample arguments: every name a message uses, as text or a number by its kind. */
function sampleArgs(key: MessageKey): Record<string, string | number> {
  const args: Record<string, string | number> = {};
  for (const entry of messageArguments(parseMessage(EN[key]))) {
    const [name = '', kind] = entry.split(':');
    args[name] = kind === 'argument' ? 'Lablo' : 7;
  }
  return args;
}

describe('the catalogs', () => {
  it('have the same keys in English and Arabic', () => {
    expect(Object.keys(AR).sort()).toEqual([...KEYS].sort());
    expect(CATALOGS.en).toBe(EN);
    expect(CATALOGS.ar).toBe(AR);
  });

  it.each(KEYS)('%s parses in both languages and in en-XA, with the same arguments', (key) => {
    const english = messageArguments(parseMessage(EN[key])).sort();
    expect(messageArguments(parseMessage(AR[key])).sort()).toEqual(english);
    expect(messageArguments(parseMessage(pseudoLocalize(EN[key]))).sort()).toEqual(english);
  });

  it.each(KEYS)('%s gives every plural category its language uses', (key) => {
    const categories = (language: 'en' | 'ar', source: string): string[] =>
      pluralBranches(parseMessage(source)).map((line) => {
        const [name = '', keys = ''] = line.split(': ');
        const branches = keys.split(' ');
        const missing = PLURAL_CATEGORIES[language].filter((c) => branches.indexOf(c) < 0);
        return `${name}: ${missing.length === 0 ? 'complete' : `missing ${missing.join(' ')}`}`;
      });
    const english = categories('en', EN[key]);
    expect(english.every((line) => line.endsWith('complete')), english.join('; ')).toBe(true);
    const arabic = categories('ar', AR[key]);
    expect(arabic.every((line) => line.endsWith('complete')), arabic.join('; ')).toBe(true);
    expect(arabic.length).toBe(english.length);
  });

  it.each(KEYS)('%s reads as Arabic in Arabic and has no Latin words of its own', (key) => {
    const text = stripIsolates(appI18n('ar-SA').t(key, sampleArgs(key))).replace(/Lablo/g, '');
    expect(ARABIC_LETTER.test(text), text).toBe(true);
    expect(LATIN_LETTER.test(text), text).toBe(false);
  });

  it.each(KEYS)('%s leaves no placeholder unfilled in any locale', (key) => {
    for (const locale of ['en-US', 'ar-SA', 'en-XA']) {
      const text = appI18n(locale).t(key, sampleArgs(key));
      expect(text, `${locale}: ${text}`).not.toMatch(/[{}#]/);
    }
  });

  it('keeps bidi controls out of the catalogs (the runtime adds the isolates)', () => {
    for (const key of KEYS) {
      expect(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(EN[key] + AR[key]), key).toBe(false);
    }
  });
});

describe('the language switch', () => {
  it('names each language in its own script', () => {
    expect(LANGUAGE_NAMES.en).toBe('English');
    expect(ARABIC_LETTER.test(LANGUAGE_NAMES.ar) && !LATIN_LETTER.test(LANGUAGE_NAMES.ar)).toBe(true);
  });

  it.each([
    ['ar-SA', null, 'en-SA'],
    ['en-SA', null, 'ar-SA'],
    ['en-US', null, 'ar-US'],
    ['ar', 'AE', 'en-AE'],
    ['ar', null, 'en'],
    ['en-XA', 'SA', 'ar'],
  ])('switches %s (TV country %s) to %s, keeping the region', (tag, country, expected) => {
    const locale = appI18n(resolveLocale(tag, { country })).locale;
    expect(switchedTag(locale)).toBe(expected);
    expect(otherLanguage(locale.language)).toBe(expected.slice(0, 2));
  });
});
