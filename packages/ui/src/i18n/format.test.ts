import { describe, expect, it } from 'vitest';
import type { LocaleSettings } from './format';
import {
  DEFAULT_DIGITS,
  formatDate,
  formatDuration,
  formatMonth,
  formatNumber,
  formatPercent,
  formatTime,
  formatWeekday,
  resolveLocale,
  shapeDigits,
  tagRegion,
} from './format';

// Hand-pinned cases. test/i18n-cldr.test.ts compares the same functions with Node's full ICU.
const EN_US = resolveLocale('en-US');
const EN_GB = resolveLocale('en-GB');
const AR_SA = resolveLocale('ar-SA');
const AR_SA_ARAB: LocaleSettings = resolveLocale('ar-SA', { digits: 'arab' });

/** Tuesday 3 November 2026, in the local time zone (formatting reads the local fields). */
const at = (hours: number, minutes: number): Date => new Date(2026, 10, 3, hours, minutes);

describe('resolveLocale', () => {
  it('picks the catalog, direction, region and formats from the tag', () => {
    expect(resolveLocale('ar-SA')).toEqual({
      tag: 'ar-SA',
      language: 'ar',
      region: 'SA',
      dir: 'rtl',
      pseudo: false,
      digits: 'latn',
      hourCycle: 'h12',
      dateOrder: 'dm',
    });
    expect(resolveLocale('en-US')).toMatchObject({ language: 'en', region: 'US', dir: 'ltr', digits: 'latn', hourCycle: 'h12', dateOrder: 'md' });
    expect(resolveLocale('en-GB')).toMatchObject({ hourCycle: 'h23', dateOrder: 'dm' });
    expect(resolveLocale('en-AE')).toMatchObject({ hourCycle: 'h12', dateOrder: 'dm' });
    expect(resolveLocale('en-CA')).toMatchObject({ hourCycle: 'h12', dateOrder: 'md' });
  });

  it('reads Western digits for Arabic by default (ADR-011), and Arabic-Indic on request', () => {
    expect(DEFAULT_DIGITS).toBe('latn');
    expect(['ar', 'ar-SA', 'ar-AE', 'ar-KW', 'ar-EG'].map((tag) => resolveLocale(tag).digits)).toEqual(Array(5).fill('latn'));
    expect(resolveLocale('ar-SA', { digits: 'arab' }).digits).toBe('arab');
    // English always writes Western digits.
    expect(resolveLocale('en-US', { digits: 'arab' }).digits).toBe('latn');
  });

  it('takes the TV’s country when the tag has no region, and keeps the tag’s otherwise', () => {
    expect(resolveLocale('en', { country: 'gb' })).toMatchObject({ region: 'GB', hourCycle: 'h23' });
    expect(resolveLocale('en-US', { country: 'GB' })).toMatchObject({ region: 'US', hourCycle: 'h12' });
    expect(resolveLocale('ar', { country: null }).region).toBe('');
    expect(resolveLocale('en-US', { hourCycle: 'h23' }).hourCycle).toBe('h23');
    // The 24-hour regions are English ones: Arabic keeps ص/م wherever the TV is.
    expect(resolveLocale('ar', { country: 'GB' })).toMatchObject({ region: 'GB', hourCycle: 'h12', dateOrder: 'dm' });
  });

  it('reads en-XA as pseudo English, and other languages as English left to right', () => {
    expect(resolveLocale('en-XA')).toMatchObject({ language: 'en', pseudo: true, region: '', dir: 'ltr' });
    expect(resolveLocale('he-IL')).toMatchObject({ language: 'en', dir: 'ltr', pseudo: false });
    expect(resolveLocale('fr-CA')).toMatchObject({ language: 'en', region: 'CA' });
  });

  it('finds the region subtag after a script and before an extension', () => {
    expect(['ar-SA', 'zh-Hant-TW', 'es-419', 'en', 'en_us', 'en-u-ca-gregory', 'sr-Latn', 'ar-x-SA', ''].map(tagRegion)).toEqual([
      'SA',
      'TW',
      '419',
      '',
      'US',
      '',
      '',
      '',
      '',
    ]);
  });
});

describe('digits and numbers', () => {
  it('writes Arabic-Indic digits only in arab', () => {
    expect(shapeDigits('Ch 101, 08:05', 'arab')).toBe('Ch ١٠١, ٠٨:٠٥');
    expect(shapeDigits('0123456789', 'arab')).toBe('٠١٢٣٤٥٦٧٨٩');
    expect(shapeDigits('0123456789', 'latn')).toBe('0123456789');
  });

  it('groups thousands and rounds fractions, without trailing zeros', () => {
    expect([0, 7, 999, 1000, 20000, 1234567, 1234.5, 0.125, 2.0004, -1500, -0.0001].map((n) => formatNumber(n, EN_US))).toEqual([
      '0',
      '7',
      '999',
      '1,000',
      '20,000',
      '1,234,567',
      '1,234.5',
      '0.125',
      '2',
      '-1,500',
      '0',
    ]);
    expect(formatNumber(3.14159, EN_US, 2)).toBe('3.14');
    expect(formatNumber(2.5, EN_US, 0)).toBe('3');
    expect(formatNumber(NaN, EN_US)).toBe('NaN');
  });

  it('uses the Arabic separators with Arabic-Indic digits', () => {
    expect(formatNumber(1234.5, AR_SA)).toBe('1,234.5');
    expect(formatNumber(1234.5, AR_SA_ARAB)).toBe('١٬٢٣٤٫٥');
    expect(formatPercent(0.35, AR_SA_ARAB)).toBe('٣٥٪');
    expect(formatPercent(0.35, AR_SA)).toBe('35%');
    expect(formatPercent(0.999, EN_US)).toBe('100%');
  });
});

describe('times and durations', () => {
  it('writes 12-hour times with the language’s day period', () => {
    expect([at(0, 0), at(8, 5), at(12, 0), at(12, 30), at(20, 5), at(23, 59)].map((d) => formatTime(d, EN_US))).toEqual([
      '12:00 AM',
      '8:05 AM',
      '12:00 PM',
      '12:30 PM',
      '8:05 PM',
      '11:59 PM',
    ]);
    expect(formatTime(at(20, 5), resolveLocale('en-CA'))).toBe('8:05 p.m.');
    expect(formatTime(at(20, 5), AR_SA)).toBe('8:05 م');
    expect(formatTime(at(8, 5), AR_SA)).toBe('8:05 ص');
    expect(formatTime(at(20, 5), AR_SA_ARAB)).toBe('٨:٠٥ م');
  });

  it('writes 24-hour times with two-digit hours, so a guide’s column lines up', () => {
    expect([at(0, 0), at(8, 5), at(20, 5)].map((d) => formatTime(d, EN_GB))).toEqual(['00:00', '08:05', '20:05']);
  });

  it('writes playback times as h:mm:ss, or m:ss under an hour', () => {
    expect([0, 5, 65, 599, 3600, 4392.9, 7200, 36000 + 61].map((s) => formatDuration(s, EN_US))).toEqual([
      '0:00',
      '0:05',
      '1:05',
      '9:59',
      '1:00:00',
      '1:13:12',
      '2:00:00',
      '10:01:01',
    ]);
    expect([-5, NaN, Infinity].map((s) => formatDuration(s, EN_US))).toEqual(['0:00', '0:00', '0:00']);
    expect(formatDuration(4392, AR_SA_ARAB)).toBe('١:١٣:١٢');
  });
});

describe('dates', () => {
  it('names the weekdays and months in both languages', () => {
    const sunday = new Date(2026, 10, 1);
    expect(formatWeekday(sunday, EN_US)).toBe('Sunday');
    expect(formatWeekday(sunday, EN_US, 'short')).toBe('Sun');
    expect(formatWeekday(sunday, AR_SA)).toBe('الأحد');
    expect(formatMonth(sunday, EN_US, 'short')).toBe('Nov');
    expect(formatMonth(new Date(2026, 0, 1), AR_SA)).toBe('يناير');
    expect(formatMonth(new Date(2026, 11, 1), EN_US)).toBe('December');
  });

  it('writes a guide day and a full date in each order', () => {
    const d = at(20, 5);
    expect(formatDate(d, EN_US)).toBe('Tue, Nov 3');
    expect(formatDate(d, EN_US, 'full')).toBe('Tuesday, November 3, 2026');
    expect(formatDate(d, EN_GB)).toBe('Tue 3 Nov');
    expect(formatDate(d, EN_GB, 'full')).toBe('Tuesday, 3 November 2026');
    expect(formatDate(d, AR_SA)).toBe('الثلاثاء، 3 نوفمبر');
    expect(formatDate(d, AR_SA, 'full')).toBe('الثلاثاء، 3 نوفمبر 2026');
    expect(formatDate(d, AR_SA_ARAB, 'full')).toBe('الثلاثاء، ٣ نوفمبر ٢٠٢٦');
  });
});
