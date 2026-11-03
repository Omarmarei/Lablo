import { isolateText, stripIsolates } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import { resolveLocale } from './format';
import { pseudoLocalize } from './pseudo';
import type { Catalogs } from './runtime';
import { createI18n } from './runtime';

const LRM = String.fromCharCode(0x200e);
const RLM = String.fromCharCode(0x200f);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

type Key = 'play' | 'count' | 'expires' | 'broken' | 'onlyEnglish';

const CATALOGS: Catalogs<Key> = {
  en: {
    play: 'Play {name}?',
    count: '{n, plural, one {# channel} other {# channels}}',
    expires: '{days, plural, =0 {Expires today} one {Expires in # day} other {Expires in # days}}',
    broken: 'Play {name',
    onlyEnglish: 'English',
  },
  ar: {
    play: 'تشغيل {name}؟',
    count: '{n, plural, zero {لا توجد قنوات} one {قناة واحدة} two {قناتان} few {# قنوات} many {# قناةً} other {# قناة}}',
    expires: '{days, plural, zero {ينتهي اليوم} one {يوم} two {يومان} few {# أيام} many {# يومًا} other {# يوم}}',
    broken: 'تشغيل',
    // A gap in a hand-edited catalog falls back to English (tsc normally prevents it).
    onlyEnglish: undefined as unknown as string,
  },
};

describe('createI18n', () => {
  it('formats English messages with plurals and isolated text', () => {
    const i18n = createI18n(CATALOGS, 'en-US');
    expect(i18n.t('play', { name: 'Zoma News' })).toBe(`Play ${LRM}${LRM}${FSI}Zoma News${PDI}${LRM}${LRM}?`);
    expect([0, 1, 2, 1000].map((n) => i18n.t('count', { n }))).toEqual(['0 channels', '1 channel', '2 channels', '1,000 channels']);
    expect([0, 1, 3].map((days) => i18n.t('expires', { days }))).toEqual(['Expires today', 'Expires in 1 day', 'Expires in 3 days']);
  });

  it('gives Arabic its six plural forms, in Western digits by default', () => {
    const i18n = createI18n(CATALOGS, 'ar-SA');
    // 240 ends in 40, so it is `many` (the accusative singular), like 11.
    expect([0, 1, 2, 3, 11, 100, 240].map((n) => i18n.t('count', { n }))).toEqual([
      'لا توجد قنوات',
      'قناة واحدة',
      'قناتان',
      '3 قنوات',
      '11 قناةً',
      '100 قناة',
      '240 قناةً',
    ]);
    expect(createI18n(CATALOGS, 'ar-SA', { digits: 'arab' }).t('count', { n: 200 })).toBe('٢٠٠ قناة');
  });

  it('isolates a Latin name inside an Arabic sentence, with the marks old engines need', () => {
    const i18n = createI18n(CATALOGS, 'ar-SA');
    // The name's own mark around the isolate, then the sentence's (core's isolateText).
    expect(i18n.t('play', { name: 'Zoma Sports 1' })).toBe(`تشغيل ${RLM}${LRM}${FSI}Zoma Sports 1${PDI}${LRM}${RLM}؟`);
    expect(createI18n(CATALOGS, 'en-US').t('play', { name: 'قناة 1' })).toBe(`Play ${LRM}${RLM}${FSI}قناة 1${PDI}${RLM}${LRM}?`);
    // In en-XA, the sentence is English.
    expect(createI18n(CATALOGS, 'en-XA').t('play', { name: 'x' })).toContain(isolateText('x', 'ltr'));
    expect(createI18n(CATALOGS, 'ar-SA', { isolate: false }).t('play', { name: 'Zoma' })).toBe('تشغيل Zoma؟');
  });

  it('runs en-XA through pseudoLocalize, keeping the arguments and plural syntax', () => {
    const i18n = createI18n(CATALOGS, 'en-XA');
    expect(i18n.locale.pseudo).toBe(true);
    expect(i18n.t('play', { name: 'Zoma' })).toBe(pseudoLocalize('Play {name}?').replace('{name}', isolateText('Zoma', 'ltr')));
    const many = i18n.t('count', { n: 240 });
    expect(many.startsWith('[') && many.endsWith(']')).toBe(true);
    expect(many).toContain('240 çĥåññéļš');
    expect(i18n.t('count', { n: 1 })).toContain('1 çĥåññéļ');
  });

  it('falls back to English for a missing translation, and shows a broken message as written', () => {
    const ar = createI18n(CATALOGS, 'ar-SA');
    expect(ar.t('onlyEnglish')).toBe('English');
    expect(createI18n(CATALOGS, 'en-US').t('broken', { name: 'x' })).toBe('Play {name');
    expect(ar.t('broken')).toBe('تشغيل');
  });

  it('parses each message once', () => {
    const counting = { ...CATALOGS.en };
    let reads = 0;
    const catalogs: Catalogs<Key> = {
      en: new Proxy(counting, {
        get(target, key: string) {
          reads += 1;
          return target[key as Key];
        },
      }),
      ar: CATALOGS.ar,
    };
    const i18n = createI18n(catalogs, 'en-US');
    i18n.t('play', { name: 'a' });
    i18n.t('play', { name: 'b' });
    expect(i18n.t('play', { name: 'c' })).toBe(`Play ${isolateText('c', 'ltr')}?`);
    expect(reads).toBe(1);
  });

  it('takes resolved settings, and formats numbers, times and dates the locale’s way', () => {
    const i18n = createI18n(CATALOGS, resolveLocale('ar-SA', { digits: 'arab' }));
    const d = new Date(2026, 10, 3, 20, 5);
    expect(i18n.locale.tag).toBe('ar-SA');
    expect(i18n.number(1234.5)).toBe('١٬٢٣٤٫٥');
    expect(i18n.percent(0.35)).toBe('٣٥٪');
    expect(i18n.time(d)).toBe('٨:٠٥ م');
    expect(i18n.weekday(d)).toBe('الثلاثاء');
    expect(i18n.date(d, 'full')).toBe('الثلاثاء، ٣ نوفمبر ٢٠٢٦');
    expect(i18n.duration(65)).toBe('١:٠٥');
    const en = createI18n(CATALOGS, 'en-GB');
    expect([en.number(3.14159, 2), en.time(d), en.weekday(d, 'short'), en.date(d)]).toEqual(['3.14', '20:05', 'Tue', 'Tue 3 Nov']);
  });

  it('strips the isolation marks again', () => {
    const i18n = createI18n(CATALOGS, 'ar-SA');
    expect(stripIsolates(i18n.t('play', { name: 'Zoma 1' }))).toBe('تشغيل Zoma 1؟');
  });
});
