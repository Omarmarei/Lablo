import type { Catalogs, I18n, I18nOptions, LocaleSettings } from '@zoma/ui';
import { createI18n } from '@zoma/ui';
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
