import { pluralLanguage } from '@lablo/core';
import type { TextDirection } from '../focus/types';
import { PSEUDO_LOCALE } from './pseudo';

/**
 * Numbers, digits, times and dates for the two UI languages (RELAY step 12, ADR-011). Written
 * out instead of `Intl`: the TV engines' ICU data is old and may be cut down (Chromium 53's
 * CLDR gave ar-SA the Hijri calendar by default), `Intl.PluralRules` is missing there, and the
 * output must be the same on every TV and in the tests. `test/i18n-cldr.test.ts` compares it
 * with Node's full ICU.
 *
 * Times and dates use the TV's own time zone (the `Date`'s local fields) and the Gregorian
 * calendar.
 */

/** The catalog a locale reads: Arabic, or English for everything else (and en-XA). */
export type Language = 'en' | 'ar';

/**
 * `latn` is 0123456789, `arab` is the Arabic-Indic ٠١٢٣٤٥٦٧٨٩. Arabic uses `latn` by default
 * (ADR-011: the provider's channel numbers, the remote's digits and most titles are Western,
 * and so are the GCC's big streaming apps); `arab` is supported for a later setting.
 */
export type Digits = 'latn' | 'arab';
export type HourCycle = 'h12' | 'h23';
/** `md`: "Tue, Nov 3"; `dm`: "Tue 3 Nov". */
export type DateOrder = 'md' | 'dm';

export const DEFAULT_DIGITS: Digits = 'latn';

export interface LocaleSettings {
  /** The tag asked for, e.g. `ar-SA`. */
  readonly tag: string;
  readonly language: Language;
  /** Upper-case ISO region from the tag, else the TV's country, else ''. */
  readonly region: string;
  /** From the catalog's language, so a Hebrew TV gets the English catalog left to right. */
  readonly dir: TextDirection;
  /** en-XA: the English catalog through `pseudoLocalize`. */
  readonly pseudo: boolean;
  readonly digits: Digits;
  readonly hourCycle: HourCycle;
  readonly dateOrder: DateOrder;
}

export interface LocaleOverrides {
  /** The TV's country, used when the tag has no region. */
  readonly country?: string | null;
  readonly digits?: Digits;
  readonly hourCycle?: HourCycle;
}

/** English regions that write 20:05 (CLDR); the rest of English and all Arabic use 8:05 PM. */
const H23_REGIONS: readonly string[] = ['GB', 'IE'];
/** English regions that put the day first (CLDR). Arabic always does. */
const DAY_FIRST_REGIONS: readonly string[] = ['GB', 'IE', 'AE', 'AU', 'NZ', 'IN', 'ZA'];

/**
 * `ar-SA` → `SA`, `zh-Hant-TW` → `TW`, `es-419` → `419`, `en` → ''. (A regex instead of
 * `split`, whose core-js polyfill would cost main about 2 KB.)
 */
export function tagRegion(tag: string): string {
  // The language, then an optional script, then the region; an extension (-u-…) ends the search.
  const match = /^[A-Za-z]{2,8}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2}|\d{3})(?:[-_]|$)/.exec(tag);
  return match === null ? '' : (match[1] ?? '').toUpperCase();
}

export function resolveLocale(tag: string, overrides: LocaleOverrides = {}): LocaleSettings {
  const pseudo = tag === PSEUDO_LOCALE;
  const language: Language = pluralLanguage(tag) === 'ar' ? 'ar' : 'en';
  const region = pseudo ? '' : tagRegion(tag) || (overrides.country ?? '').toUpperCase();
  return {
    tag,
    language,
    region,
    dir: language === 'ar' ? 'rtl' : 'ltr',
    pseudo,
    digits: language === 'ar' ? (overrides.digits ?? DEFAULT_DIGITS) : 'latn',
    hourCycle: overrides.hourCycle ?? (language === 'en' && H23_REGIONS.indexOf(region) >= 0 ? 'h23' : 'h12'),
    dateOrder: language === 'ar' || DAY_FIRST_REGIONS.indexOf(region) >= 0 ? 'dm' : 'md',
  };
}

const ARABIC_ZERO = 0x0660;
const ARABIC_GROUP = String.fromCharCode(0x066c);
const ARABIC_DECIMAL = String.fromCharCode(0x066b);
const ARABIC_PERCENT = String.fromCharCode(0x066a);
const ARABIC_COMMA = String.fromCharCode(0x060c);

/** Writes the ASCII digits of `text` in `digits`. */
export function shapeDigits(text: string, digits: Digits): string {
  if (digits === 'latn') return text;
  return text.replace(/[0-9]/g, (d) => String.fromCharCode(ARABIC_ZERO + d.charCodeAt(0) - 48));
}

function group(integer: string, separator: string): string {
  let out = '';
  for (let i = 0; i < integer.length; i += 1) {
    if (i > 0 && (integer.length - i) % 3 === 0) out += separator;
    out += integer.charAt(i);
  }
  return out;
}

/**
 * `1234.5` → `1,234.5` (or `١٬٢٣٤٫٥` in `arab`), rounded to at most `maximumFractionDigits`
 * (3, as `Intl.NumberFormat`), without trailing zeros.
 */
export function formatNumber(n: number, settings: Pick<LocaleSettings, 'digits'>, maximumFractionDigits = 3): string {
  if (!isFinite(n)) return String(n);
  const fixed = Math.abs(n).toFixed(maximumFractionDigits);
  const point = fixed.indexOf('.');
  const integer = point < 0 ? fixed : fixed.slice(0, point);
  const fraction = point < 0 ? '' : fixed.slice(point + 1).replace(/0+$/, '');
  const arab = settings.digits === 'arab';
  const body = group(integer, arab ? ARABIC_GROUP : ',') + (fraction === '' ? '' : (arab ? ARABIC_DECIMAL : '.') + fraction);
  const negative = n < 0 && /[1-9]/.test(body);
  return shapeDigits((negative ? '-' : '') + body, settings.digits);
}

/** `0.35` → `35%` (`٣٥٪` in `arab`; Western digits take the Latin sign, as ar-AE does). */
export function formatPercent(ratio: number, settings: Pick<LocaleSettings, 'digits'>): string {
  return formatNumber(Math.round(ratio * 100), settings, 0) + (settings.digits === 'arab' ? ARABIC_PERCENT : '%');
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const DAY_PERIODS: Readonly<Record<Language, readonly [string, string]>> = {
  en: ['AM', 'PM'],
  ar: ['ص', 'م'],
};
/** Canadian English writes a.m. and p.m. (CLDR). */
const CANADA_DAY_PERIODS: readonly [string, string] = ['a.m.', 'p.m.'];

/** `8:05 PM`, `٨:٠٥ م` or `20:05` (`08:05` in the morning, so a guide's times line up). */
export function formatTime(date: Date, settings: LocaleSettings): string {
  const hours = date.getHours();
  const minutes = two(date.getMinutes());
  if (settings.hourCycle === 'h23') return shapeDigits(`${two(hours)}:${minutes}`, settings.digits);
  const periods = settings.language === 'en' && settings.region === 'CA' ? CANADA_DAY_PERIODS : DAY_PERIODS[settings.language];
  const period = periods[hours < 12 ? 0 : 1];
  return `${shapeDigits(`${hours % 12 === 0 ? 12 : hours % 12}:${minutes}`, settings.digits)} ${period}`;
}

/**
 * Playback position or length: `1:12:30`, or `12:30` under an hour (as players show it).
 * Negative or non-finite values show `0:00`.
 */
export function formatDuration(seconds: number, settings: Pick<LocaleSettings, 'digits'>): string {
  const total = isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = two(total % 60);
  return shapeDigits(h > 0 ? `${h}:${two(m)}:${s}` : `${m}:${s}`, settings.digits);
}

// CLDR's Arabic months (the Gulf's usage) and weekdays. Arabic has no short forms: CLDR's
// abbreviated names are the full ones, so both widths share one list.
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const MONTHS: Readonly<Record<Language, { readonly long: readonly string[]; readonly short: readonly string[] }>> = {
  en: {
    long: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  ar: { long: AR_MONTHS, short: AR_MONTHS },
};

const WEEKDAYS: Readonly<Record<Language, { readonly long: readonly string[]; readonly short: readonly string[] }>> = {
  en: {
    long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  ar: { long: AR_WEEKDAYS, short: AR_WEEKDAYS },
};

export type NameWidth = 'short' | 'long';

export function formatWeekday(date: Date, settings: Pick<LocaleSettings, 'language'>, width: NameWidth = 'long'): string {
  return WEEKDAYS[settings.language][width][date.getDay()] ?? '';
}

export function formatMonth(date: Date, settings: Pick<LocaleSettings, 'language'>, width: NameWidth = 'long'): string {
  return MONTHS[settings.language][width][date.getMonth()] ?? '';
}

/**
 * `day`, for a guide's day strip: `Tue, Nov 3`, `Tue 3 Nov`, `الثلاثاء، 3 نوفمبر`.
 * `full`: `Tuesday, November 3, 2026`, `Tuesday, 3 November 2026`, `الثلاثاء، 3 نوفمبر 2026`.
 */
export type DateStyle = 'day' | 'full';

export function formatDate(date: Date, settings: LocaleSettings, style: DateStyle = 'day'): string {
  const width: NameWidth = style === 'day' ? 'short' : 'long';
  const weekday = formatWeekday(date, settings, width);
  const month = formatMonth(date, settings, width);
  const day = shapeDigits(String(date.getDate()), settings.digits);
  const year = style === 'full' ? ` ${shapeDigits(String(date.getFullYear()), settings.digits)}` : '';
  if (settings.language === 'ar') return `${weekday}${ARABIC_COMMA} ${day} ${month}${year}`;
  if (settings.dateOrder === 'dm') return style === 'day' ? `${weekday} ${day} ${month}` : `${weekday}, ${day} ${month}${year}`;
  return `${weekday}, ${month} ${day}${style === 'full' ? `,${year}` : ''}`;
}
