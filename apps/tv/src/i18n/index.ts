import type { Catalogs, I18n, I18nOptions, Language, LocaleSettings } from '@lablo/ui';
import { createI18n } from '@lablo/ui';
import { AR } from './ar';
import type { MessageKey } from './en';
import { EN } from './en';

export type { MessageKey } from './en';

/** Both catalogs ship in main.js (a few KB); there are only two languages. */
export const CATALOGS: Catalogs<MessageKey> = { en: EN, ar: AR };

export type AppI18n = I18n<MessageKey>;

/** The app's runtime for a locale tag (`ar-SA`, `en-XA`) or resolved settings. */
export function appI18n(locale: string | LocaleSettings, options?: I18nOptions): AppI18n {
  return createI18n(CATALOGS, locale, options);
}

/**
 * Each language's own name, for a language switch. Not in the catalogs: a language is offered
 * under its own name in every language (and in en-XA), and the label carries its `lang`.
 */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: 'English', ar: 'العربية' };

/** The other UI language (there are two). */
export function otherLanguage(language: Language): Language {
  return language === 'ar' ? 'en' : 'ar';
}

/**
 * The tag after a language switch: the other language in the same region, so the formats keep
 * the region's (ar-SA ↔ en-SA). The pseudo-locale and a locale with no region give the bare
 * language.
 */
export function switchedTag(locale: Pick<LocaleSettings, 'language' | 'region'>): string {
  const language = otherLanguage(locale.language);
  return locale.region === '' ? language : `${language}-${locale.region}`;
}
