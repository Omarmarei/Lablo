/**
 * The phone page's two languages (RELAY step 31b): `?lang=en|ar` when given, else the browser's
 * `Accept-Language` in its order of preference, else English.
 */
export const LANGS = ['en', 'ar'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ar';
}

export function dirOf(lang: Lang): 'ltr' | 'rtl' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** The first of our languages in an `Accept-Language` header, by its weights (`q`), or null. */
export function fromAcceptLanguage(header: string | null): Lang | null {
  if (header === null) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { primary: tag.trim().toLowerCase().split('-')[0], weight: q === undefined ? 1 : Number(q.slice(2)) };
    })
    // A weight of 0 (or one that isn't a number) means "not this one".
    .filter((entry) => entry.weight > 0)
    // Stable: equal weights keep the header's order.
    .sort((a, b) => b.weight - a.weight);
  return ranked.map((entry) => entry.primary).find(isLang) ?? null;
}

/** The page's language: the `lang` query parameter, the browser's preference, or English. */
export function pickLang(param: string | string[] | undefined, acceptLanguage: string | null): Lang {
  const asked = Array.isArray(param) ? param[0] : param;
  return isLang(asked) ? asked : (fromAcceptLanguage(acceptLanguage) ?? 'en');
}
