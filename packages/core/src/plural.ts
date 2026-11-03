/**
 * CLDR plural rules for the languages Zoma ships (RELAY step 12, PLAN 4.3). `Intl.PluralRules`
 * is missing on Chromium 53 (2018 webOS 4), so the rules are written out here, and
 * `test/i18n-cldr.test.ts` checks them against Node's full-ICU `Intl.PluralRules`.
 *
 * - English: `one` (exactly 1, no fraction) and `other`.
 * - Arabic: `zero` (0), `one` (1), `two` (2), `few` (n % 100 in 3..10), `many` (n % 100 in
 *   11..99) and `other` (100–102, 200…, and every fraction).
 *
 * A third language adds its rule to `RULES` and its categories to `PLURAL_CATEGORIES`.
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export type PluralLanguage = 'en' | 'ar';

/** The categories each language uses, in CLDR order. A catalog's plural messages give each one. */
export const PLURAL_CATEGORIES: Readonly<Record<PluralLanguage, readonly PluralCategory[]>> = {
  en: ['one', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
};

/** Whether `n` is an integer from `from` to `to`, as CLDR's `n = from..to` reads. */
function inRange(n: number, from: number, to: number): boolean {
  return n % 1 === 0 && n >= from && n <= to;
}

const RULES: Readonly<Record<PluralLanguage, (n: number) => PluralCategory>> = {
  en: (n) => (n === 1 ? 'one' : 'other'),
  ar: (n) => {
    if (n === 0) return 'zero';
    if (n === 1) return 'one';
    if (n === 2) return 'two';
    const rest = n % 100;
    if (inRange(rest, 3, 10)) return 'few';
    if (inRange(rest, 11, 99)) return 'many';
    return 'other';
  },
};

/** `ar` for any Arabic tag (`ar-SA`), `en` for everything else (the fallback catalog). */
export function pluralLanguage(locale: string): PluralLanguage {
  return /^ar(-|_|$)/i.test(locale) ? 'ar' : 'en';
}

/**
 * The plural category of `n` in `language` (a BCP 47 tag; see `pluralLanguage`). Negative
 * numbers use their absolute value, as CLDR's `n` operand does. NaN and infinities fall through
 * every rule to `other` (`Infinity % 100` is NaN).
 */
export function pluralCategory(language: string, n: number): PluralCategory {
  return RULES[pluralLanguage(language)](Math.abs(n));
}
