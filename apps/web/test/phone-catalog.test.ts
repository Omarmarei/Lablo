import { describe, expect, it } from 'vitest';
import config, { PHONE_CSP, pageHeaders } from '../next.config';
import type { Message, MessageKey } from '../src/phone/catalog';
import { AR, CATALOGS, EN, FSI, PDI, t } from '../src/phone/catalog';
import { dirOf, fromAcceptLanguage, isLang, LANGS, pickLang } from '../src/phone/lang';

/** The phone page's languages, catalog and headers (RELAY step 31b). */

const placeholders = (message: Message): string[] => {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  return [...new Set(texts.flatMap((text) => text.match(/\{\w+\}/g) ?? []))].sort();
};

describe('the catalog', () => {
  const keys = Object.keys(EN) as MessageKey[];

  it('has the same keys in English and Arabic', () => {
    expect(Object.keys(AR).sort()).toEqual([...keys].sort());
    expect(CATALOGS).toEqual({ en: EN, ar: AR });
  });

  it.each(keys)('%s: the same placeholders, plural forms where the language has them', (key) => {
    const en = EN[key];
    const ar = AR[key];
    expect(placeholders(ar)).toEqual(placeholders(en));
    expect(typeof ar).toBe(typeof en);
    if (typeof en !== 'string' && typeof ar !== 'string') {
      expect(Object.keys(en).sort()).toEqual([...new Intl.PluralRules('en').resolvedOptions().pluralCategories].sort());
      expect(Object.keys(ar).sort()).toEqual([...new Intl.PluralRules('ar').resolvedOptions().pluralCategories].sort());
      for (const form of Object.values(ar)) expect(form.trim()).not.toBe('');
    }
  });

  it('writes Arabic in Arabic and English in English', () => {
    const arabic = /[\u0600-\u06ff]/;
    for (const key of keys.filter((k) => k !== 'lang.other')) {
      expect(JSON.stringify(EN[key]), key).not.toMatch(arabic);
      expect(JSON.stringify(AR[key]), key).toMatch(arabic);
    }
    expect(EN['lang.other']).toMatch(arabic);
    expect(AR['lang.other']).toBe('English');
  });

  it('fills placeholders, each between FSI and PDI', () => {
    expect(FSI).toBe(String.fromCharCode(0x2068));
    expect(PDI).toBe(String.fromCharCode(0x2069));
    expect(t('en', 'form.for', { code: 'ABCD EFGH' })).toBe(`For the TV showing ${FSI}ABCD EFGH${PDI}`);
    expect(t('ar', 'type.xtream', { name: 'Xtream' })).toBe(`تسجيل دخول ${FSI}Xtream${PDI}`);
    expect(t('en', 'field.url', { http: 'http://', https: 'https://' })).toBe(`Enter a link that starts with ${FSI}http://${PDI} or ${FSI}https://${PDI}`);
    // A placeholder without a value stays as written; a value without a placeholder is unused.
    expect(t('en', 'form.for')).toBe('For the TV showing {code}');
    expect(t('en', 'done.ok', { code: 'x' })).toBe(EN['done.ok']);
  });

  it.each([
    ['en', 1, 'Too many tries. Try again in 1 minute.'],
    ['en', 10, 'Too many tries. Try again in 10 minutes.'],
    ['ar', 1, 'محاولات كثيرة جدًا. حاول مرة أخرى بعد دقيقة واحدة.'],
    ['ar', 2, 'محاولات كثيرة جدًا. حاول مرة أخرى بعد دقيقتين.'],
    ['ar', 3, 'محاولات كثيرة جدًا. حاول مرة أخرى بعد 3 دقائق.'],
    ['ar', 10, 'محاولات كثيرة جدًا. حاول مرة أخرى بعد 10 دقائق.'],
    ['ar', 11, 'محاولات كثيرة جدًا. حاول مرة أخرى بعد 11 دقيقة.'],
    ['ar', 0, 'محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل.'],
  ] as const)('%s, %i minutes: the plural form', (lang, n, text) => {
    expect(t(lang, 'error.limited', { n })).toBe(text);
  });
});

describe('the language', () => {
  it.each([
    [null, null],
    ['', null],
    ['ar', 'ar'],
    ['ar-SA,ar;q=0.9,en;q=0.8', 'ar'],
    ['en-US,en;q=0.9', 'en'],
    ['fr-FR,fr;q=0.9,ar;q=0.8,en;q=0.7', 'ar'],
    ['fr, en;q=0.5, ar;q=0.6', 'ar'],
    ['en;q=0.5, ar;q=0.5', 'en'],
    ['ar;q=0, en;q=0.1', 'en'],
    ['ar;q=0', null],
    ['en;q=0.1, ar;q=1.0', 'ar'],
    ['ar;q=oops, en;q=0.1', 'en'],
    ['AR-ae', 'ar'],
    ['de, fr', null],
    ['*', null],
    ['arabic', null],
  ])('Accept-Language %j gives %j', (header, lang) => {
    expect(fromAcceptLanguage(header)).toBe(lang);
  });

  it('takes ?lang first, then Accept-Language, then English', () => {
    expect(pickLang('ar', 'en')).toBe('ar');
    expect(pickLang(['en', 'ar'], 'ar')).toBe('en');
    expect(pickLang('fr', 'ar')).toBe('ar');
    expect(pickLang(undefined, 'ar-EG')).toBe('ar');
    expect(pickLang(undefined, null)).toBe('en');
    expect(pickLang([], 'de')).toBe('en');
  });

  it('knows its two languages and their directions', () => {
    expect(LANGS).toEqual(['en', 'ar']);
    expect([isLang('en'), isLang('ar'), isLang('fr'), isLang(undefined)]).toEqual([true, true, false, false]);
    expect([dirOf('en'), dirOf('ar')]).toEqual(['ltr', 'rtl']);
  });
});

describe('the phone page’s headers', () => {
  it('hold the page to its own origin in a production build', async () => {
    expect(PHONE_CSP.split('; ')).toEqual([
      "default-src 'self'",
      "connect-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ]);
    expect(pageHeaders(true)).toEqual([
      {
        source: '/p',
        headers: [
          { key: 'Content-Security-Policy', value: PHONE_CSP },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]);
    expect(pageHeaders(false)).toEqual([]);
    // The config's own: none under Vitest (NODE_ENV=test), the policy under NODE_ENV=production.
    expect(await config.headers!()).toEqual([]);
    const before = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      expect(await config.headers!()).toEqual(pageHeaders(true));
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = before;
    }
  });
});
