// RELAY step 12: the plural rules (core) and the formats (ui's format.ts) are written out,
// because Chromium 53 has no Intl.PluralRules and the TVs' ICU data is old. Node ships full
// ICU, so here they are compared with it. The root test/ folder has an ES2023 lib (core's
// ES2017 one has no Intl.PluralRules) and imports ui's plain .ts files by path (the root has no
// @lablo/ui dependency).

import { pluralCategory } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import type { LocaleSettings } from '../packages/ui/src/i18n/format';
import { formatDate, formatMonth, formatNumber, formatPercent, formatTime, formatWeekday, resolveLocale } from '../packages/ui/src/i18n/format';

/** ICU puts bidi marks around signs and percent, and narrow spaces before AM/PM in some versions. */
function plain(text: string): string {
  return text.replace(/[\u200e\u200f\u061c]/g, '').replace(/[\u00a0\u202f]/g, ' ');
}

/** The Intl tag that gives the same settings: Arabic-Indic digits through the `nu` extension. */
function intlTag(settings: LocaleSettings): string {
  return settings.digits === 'arab' ? `${settings.tag}-u-nu-arab` : `${settings.tag}-u-nu-latn`;
}

const LOCALES: readonly LocaleSettings[] = [
  resolveLocale('en-US'),
  resolveLocale('en-CA'),
  resolveLocale('en-GB'),
  resolveLocale('ar-AE'),
  resolveLocale('ar-SA'),
  resolveLocale('ar-SA', { digits: 'arab' }),
];

describe('plural rules against ICU', () => {
  it.each(['en', 'ar'])('%s agrees with Intl.PluralRules on 0–10000, fractions and negatives', (language) => {
    const icu = new Intl.PluralRules(language);
    const numbers: number[] = [];
    for (let n = 0; n <= 10_000; n += 1) numbers.push(n, -n);
    for (let n = 0; n <= 300; n += 0.25) numbers.push(n);
    numbers.push(0.1, 1.01, 2.999, 103.5, 1e6, 1e6 + 3, 1e6 + 11);
    const differ = numbers.filter((n) => pluralCategory(language, n) !== icu.select(n));
    expect(differ).toEqual([]);
  });
});

describe('formats against ICU', () => {
  const numbers = [0, 7, 42, 999, 1000, 1234.5, 20_000, 1_234_567, 0.125, 99.9, -1500];
  it.each(LOCALES.map((l) => [`${l.tag} ${l.digits}`, l] as const))('%s numbers and percents', (_name, settings) => {
    const icu = new Intl.NumberFormat(intlTag(settings));
    expect(numbers.map((n) => formatNumber(n, settings))).toEqual(numbers.map((n) => plain(icu.format(n))));
    // ICU gives ar-SA's Western digits the Arabic percent sign; Lablo keeps the Latin one with
    // Western digits, as ICU does for ar-AE.
    const percentTag = settings.language === 'ar' && settings.digits === 'latn' ? 'ar-AE-u-nu-latn' : intlTag(settings);
    const percent = new Intl.NumberFormat(percentTag, { style: 'percent' });
    expect([0, 0.35, 0.999, 1].map((r) => formatPercent(r, settings))).toEqual([0, 0.35, 0.999, 1].map((r) => plain(percent.format(r))));
  });

  const times = [0, 1, 8, 11, 12, 13, 20, 23].map((h) => new Date(2026, 10, 3, h, h === 8 ? 5 : 30));
  it.each(LOCALES.map((l) => [`${l.tag} ${l.digits}`, l] as const))('%s times', (_name, settings) => {
    // 24-hour times keep two-digit hours on purpose (a guide's column lines up), as `2-digit` does.
    const icu = new Intl.DateTimeFormat(intlTag(settings), {
      hour: settings.hourCycle === 'h23' ? '2-digit' : 'numeric',
      minute: '2-digit',
      hourCycle: settings.hourCycle,
    });
    expect(times.map((d) => formatTime(d, settings))).toEqual(times.map((d) => plain(icu.format(d))));
  });

  it.each(['en', 'ar'] as const)('%s weekday and month names', (language) => {
    const settings = resolveLocale(language);
    for (const width of ['short', 'long'] as const) {
      const days = new Intl.DateTimeFormat(language, { weekday: width });
      const months = new Intl.DateTimeFormat(language, { month: width });
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(2026, 10, 1 + i);
        expect(formatWeekday(d, settings, width)).toBe(days.format(d));
      }
      for (let m = 0; m < 12; m += 1) {
        const d = new Date(2026, m, 1);
        expect(formatMonth(d, settings, width)).toBe(months.format(d));
      }
    }
  });

  const dates = [new Date(2026, 10, 3, 20, 5), new Date(2027, 0, 1), new Date(2026, 4, 31)];
  it.each(['en-US', 'en-CA', 'en-GB', 'ar-AE', 'ar-SA'])('%s guide days and full dates', (tag) => {
    for (const digits of tag.startsWith('ar') ? (['latn', 'arab'] as const) : (['latn'] as const)) {
      const settings = resolveLocale(tag, { digits });
      const day = new Intl.DateTimeFormat(intlTag(settings), { weekday: 'short', day: 'numeric', month: 'short' });
      const full = new Intl.DateTimeFormat(intlTag(settings), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      expect(dates.map((d) => formatDate(d, settings))).toEqual(dates.map((d) => plain(day.format(d))));
      expect(dates.map((d) => formatDate(d, settings, 'full'))).toEqual(dates.map((d) => plain(full.format(d))));
    }
  });
});
