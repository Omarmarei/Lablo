import { describe, expect, it } from 'vitest';
import { PLURAL_CATEGORIES, pluralCategory, pluralLanguage } from './plural';

// The full sweep against ICU's own rules is in test/i18n-cldr.test.ts (Node's Intl.PluralRules
// is not in core's ES2017 lib). These pin the edges by hand.
describe('pluralCategory', () => {
  it('gives Arabic its six forms, with the edges of few and many', () => {
    const cases: Array<[number, string]> = [
      [0, 'zero'],
      [1, 'one'],
      [2, 'two'],
      [3, 'few'],
      [10, 'few'],
      [11, 'many'],
      [99, 'many'],
      [100, 'other'],
      [101, 'other'],
      [102, 'other'],
      [103, 'few'],
      [110, 'few'],
      [111, 'many'],
      [199, 'many'],
      [200, 'other'],
      [1000, 'other'],
      [1003, 'few'],
      [1011, 'many'],
    ];
    expect(cases.map(([n]) => [n, pluralCategory('ar-SA', n)])).toEqual(cases);
  });

  it('puts every Arabic fraction in other, even between 3 and 99', () => {
    expect([0.5, 1.5, 2.5, 3.5, 10.5, 11.5, 50.25].map((n) => pluralCategory('ar', n))).toEqual(Array(7).fill('other'));
  });

  it('gives English one for exactly 1 only', () => {
    expect([0, 1, 2, 1.5, 11, 21, 101].map((n) => pluralCategory('en-US', n))).toEqual(['other', 'one', 'other', 'other', 'other', 'other', 'other']);
  });

  it('reads negative numbers by their size, and NaN and infinities as other', () => {
    expect(pluralCategory('ar', -2)).toBe('two');
    expect(pluralCategory('ar', -11)).toBe('many');
    expect(pluralCategory('en', -1)).toBe('one');
    expect([NaN, Infinity, -Infinity].map((n) => pluralCategory('ar', n))).toEqual(['other', 'other', 'other']);
  });

  it('uses the Arabic rules for any Arabic tag and the English ones for everything else', () => {
    expect(['ar', 'ar-SA', 'AR-ae', 'ar_EG', 'en', 'en-XA', 'fr-CA', 'arn', ''].map(pluralLanguage)).toEqual([
      'ar',
      'ar',
      'ar',
      'ar',
      'en',
      'en',
      'en',
      'en',
      'en',
    ]);
  });

  it('lists exactly the categories each rule can return', () => {
    for (const language of ['en', 'ar'] as const) {
      const seen = new Set<string>();
      for (let n = 0; n <= 1000; n += 0.5) seen.add(pluralCategory(language, n));
      expect([...seen].sort()).toEqual([...PLURAL_CATEGORIES[language]].sort());
    }
  });
});
