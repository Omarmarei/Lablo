import { isolateText, pluralCategory } from '@lablo/core';
import type { DateStyle, LocaleOverrides, LocaleSettings, NameWidth } from './format';
import { formatDate, formatDuration, formatNumber, formatPercent, formatTime, formatWeekday, resolveLocale } from './format';
import type { MessageArgs, MessageEnv, MessagePart } from './message';
import { formatMessage, parseMessage } from './message';
import { pseudoLocalize } from './pseudo';

/**
 * The i18n runtime (RELAY step 12, PLAN 4.3, ADR-011). The app owns the catalogs; the runtime
 * picks one by the locale, parses each message once (message.ts), and formats numbers, times
 * and dates the locale's way (format.ts). One `I18n` per locale: switching the language makes
 * a new one, so the screens re-render from it.
 */
export type Catalog<K extends string> = Readonly<Record<K, string>>;

/** English is the source and the fallback; Arabic must have every key (tsc checks it). */
export interface Catalogs<K extends string> {
  readonly en: Catalog<K>;
  readonly ar: Catalog<K>;
}

export interface I18n<K extends string> {
  readonly locale: LocaleSettings;
  /** A catalog message with its arguments filled in. */
  t(key: K, args?: MessageArgs): string;
  /** `1,234` (at most 3 fraction digits by default). */
  number(n: number, maximumFractionDigits?: number): string;
  /** `0.35` → `35%`. */
  percent(ratio: number): string;
  /** `8:05 PM` / `20:05` / `8:05 م`, in the TV's time zone. */
  time(date: Date): string;
  weekday(date: Date, width?: NameWidth): string;
  /** `Tue, Nov 3` (`day`) or `Tuesday, November 3, 2026` (`full`). */
  date(date: Date, style?: DateStyle): string;
  /** A playback position or length in seconds: `1:12:30`. */
  duration(seconds: number): string;
}

export interface I18nOptions extends LocaleOverrides {
  /**
   * Off only for tests that compare plain text. The app always isolates each text argument
   * (core's `isolateText`: FSI/PDI plus the marks the TVs' old engines need, ADR-011).
   */
  readonly isolate?: boolean;
}

export function createI18n<K extends string>(catalogs: Catalogs<K>, locale: string | LocaleSettings, options: I18nOptions = {}): I18n<K> {
  const settings = typeof locale === 'string' ? resolveLocale(locale, options) : locale;
  const catalog: Catalog<K> = catalogs[settings.language];
  const parsed: Partial<Record<K, readonly MessagePart[]>> = {};
  const env: MessageEnv = {
    plural: (n) => pluralCategory(settings.language, n),
    number: (n) => formatNumber(n, settings),
    text: options.isolate === false ? (value) => value : (value) => isolateText(value, settings.dir),
  };

  const message = (key: K): readonly MessagePart[] => {
    const cached = parsed[key];
    if (cached !== undefined) return cached;
    const source = catalog[key] ?? catalogs.en[key] ?? key;
    const text = settings.pseudo ? pseudoLocalize(source) : source;
    let parts: readonly MessagePart[];
    try {
      parts = parseMessage(text);
    } catch {
      // The catalog tests parse every message, so this is a safety net: show the raw text.
      parts = [text];
    }
    parsed[key] = parts;
    return parts;
  };

  return {
    locale: settings,
    t: (key, args) => formatMessage(message(key), args, env),
    number: (n, maximumFractionDigits) => formatNumber(n, settings, maximumFractionDigits),
    percent: (ratio) => formatPercent(ratio, settings),
    time: (date) => formatTime(date, settings),
    weekday: (date, width) => formatWeekday(date, settings, width),
    date: (date, style) => formatDate(date, settings, style),
    duration: (seconds) => formatDuration(seconds, settings),
  };
}
