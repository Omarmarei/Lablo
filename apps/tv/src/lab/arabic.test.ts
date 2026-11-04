import { stripIsolates } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import type { BidiAnswer, FaceState } from './arabic';
import type { IntlAnswer, IntlLocale } from './arabic';
import { BIDI_LINES, INTL_TAGS, apart, bidiFailures, digitsIn, faceName, fontFailures, intlNote, loadFaces, readIntl, shapingFailures, shapingVerdict } from './arabic';

const ZWNJ = String.fromCharCode(0x200c);
const ARABIC_ZERO = 0x0660;
const arabicDigits = (text: string): string => text.replace(/[0-9]/g, (d) => String.fromCharCode(ARABIC_ZERO + Number(d)));

describe("S9's fonts (RELAY step 15b2)", () => {
  it('names each face by its script and weight, however the engine writes them', () => {
    expect(faceName('U+600-6FF, U+200C-200F, U+FDF2', '400')).toBe('ar400');
    expect(faceName('U+0600-06FF', 'bold')).toBe('ar700');
    expect(faceName('U+0-17F, U+218-21B', 'normal')).toBe('la400');
    expect(faceName('U+0000-017F', '700')).toBe('la700');
    // A range that merely contains 600 later is not the Arabic one.
    expect(faceName('U+0-17F, U+600-6FF', '400')).toBe('la400');
  });

  it('needs all four faces declared and each one loaded', () => {
    const all: FaceState[] = ['la400', 'la700', 'ar400', 'ar700'].map((face) => ({ face, status: 'loaded' }));
    expect(fontFailures(all)).toEqual([]);
    expect(fontFailures(all.map((f) => (f.face === 'ar700' ? { ...f, status: 'error' } : f)))).toEqual(['ar700 is error']);
    expect(fontFailures(all.filter((f) => f.face !== 'la700'))).toEqual(['no la700 face declared']);
    // A second declaration of a face is fine when one of them loaded.
    expect(fontFailures([...all, { face: 'ar400', status: 'unloaded' }])).toEqual([]);
    expect(fontFailures([])).toHaveLength(4);
  });

  it('asks for both weights of both scripts, then reads only the Zoma Sans faces', async () => {
    const asked: string[] = [];
    const faces = [
      { family: '"Zoma Sans"', unicodeRange: 'U+0-17F', weight: '400', status: 'loaded' },
      { family: 'Zoma Sans', unicodeRange: 'U+600-6FF', weight: 'bold', status: 'loaded' },
      { family: 'Other', unicodeRange: 'U+600-6FF', weight: '400', status: 'loaded' },
    ];
    const set = {
      load: (font: string, text?: string) => {
        asked.push(`${font}|${text ?? ''}`);
        // A failed load is read as the face's status, not thrown.
        return font.indexOf('700') === 0 && text === 'Zoma' ? Promise.reject(new Error('x')) : Promise.resolve([]);
      },
      forEach: (run: (face: (typeof faces)[number]) => void) => faces.forEach(run),
      check: () => true,
    };
    expect(await loadFaces(set)).toEqual([
      { face: 'la400', status: 'loaded' },
      { face: 'ar700', status: 'loaded' },
    ]);
    expect(asked).toEqual(['400 32px "Zoma Sans"|Zoma', '400 32px "Zoma Sans"|قناة', '700 32px "Zoma Sans"|Zoma', '700 32px "Zoma Sans"|قناة']);
  });
});

describe("S9's shaping", () => {
  it('keeps letters apart with zero-width non-joiners', () => {
    expect(apart('لا')).toBe(`ل${ZWNJ}ا`);
    expect(apart('مسلسلات')).toHaveLength(13);
    expect(apart('a')).toBe('a');
  });

  it('passes when the word joins narrower and lam-alef draws as one glyph', () => {
    // Desktop Chromium, 2026-11-04.
    const desktop = { word: 197.6, wordApart: 268.9, ligature: 28.8, ligatureApart: 44.8 };
    expect(shapingFailures(desktop)).toEqual([]);
    expect(shapingFailures({ ...desktop, word: 268.9 })).toEqual(['the letters did not join (268.9 px joined, 268.9 px apart)']);
    // At the edges of the ratios: 95 % still counts as not joined, 90 % as no ligature.
    expect(shapingFailures({ ...desktop, word: 255.5 })).toEqual(['the letters did not join (255.5 px joined, 268.9 px apart)']);
    expect(shapingFailures({ ...desktop, word: 255.4 })).toEqual([]);
    expect(shapingFailures({ ...desktop, ligature: 40.4 })).toEqual(['no lam-alef ligature (40.4 px, 44.8 px apart)']);
    expect(shapingFailures({ ...desktop, ligature: 40.3 })).toEqual([]);
    // Exactly at the ratios is still narrow enough (200 × 0.95 and 50 × 0.9 are exact).
    expect(shapingFailures({ word: 190, wordApart: 200, ligature: 45, ligatureApart: 50 })).toEqual([]);
    expect(shapingFailures({ word: 0, wordApart: 0, ligature: 0, ligatureApart: 0 })).toEqual(['nothing was drawn']);
    expect(shapingFailures({ ...desktop, ligatureApart: 0 })).toEqual(['nothing was drawn']);
  });

  it('fails a measurement made in a fallback font, and shows the words in the note', () => {
    const desktop = { word: 197.6, wordApart: 268.9, ligature: 28.8, ligatureApart: 44.8 };
    expect(shapingVerdict(desktop, false)).toEqual({ status: 'fail', note: 'the Arabic face is not loaded: this measured a fallback font' });
    const pass = shapingVerdict(desktop, true);
    expect(pass.status).toBe('pass');
    expect(stripIsolates(pass.note)).toBe('مسلسلات 197.6 px (268.9 apart), لا 28.8 px (44.8 apart)');
    // Isolated, so the numbers stay after the Arabic words in the English note.
    expect(pass.note).not.toBe(stripIsolates(pass.note));
    // Without the Font Loading API the widths still decide.
    expect(shapingVerdict(desktop, null).status).toBe('pass');
    expect(shapingVerdict({ ...desktop, word: 268.9 }, true)).toEqual({ status: 'fail', note: 'the letters did not join (268.9 px joined, 268.9 px apart)' });
  });
});

describe("S9's bidi probe", () => {
  const good: BidiAnswer = {
    plain: 168.3,
    isolated: 168.3,
    trailing: { first: 204, second: 83.8 },
    trailingControl: { first: 83.8, second: 266.7 },
    leading: { first: 180.8, second: 220.7 },
    leadingControl: { first: 321.6, second: 180.8 },
  };

  it("draws the harness's lines: isolated through core, and their controls", () => {
    expect(stripIsolates(BIDI_LINES.isolated)).toBe(BIDI_LINES.plain);
    expect(BIDI_LINES.isolated).not.toBe(BIDI_LINES.plain);
    expect(stripIsolates(BIDI_LINES.trailing)).toBe(BIDI_LINES.trailingControl);
    expect(stripIsolates(BIDI_LINES.leading)).toBe(BIDI_LINES.leadingControl);
    expect(BIDI_LINES.trailing).not.toBe(BIDI_LINES.trailingControl);
    expect(BIDI_LINES.leading).not.toBe(BIDI_LINES.leadingControl);
    expect(BIDI_LINES.trailingControl).toBe('MBC 1 · 240 قناة');
    expect(BIDI_LINES.leadingControl).toBe('1 Zoma قناة');
  });

  it('checks that the isolation draws nothing and isolates both lines, against controls that show the problem', () => {
    expect(bidiFailures(good)).toEqual([]);
    expect(bidiFailures({ ...good, isolated: 168.8 })).toEqual([]);
    expect(bidiFailures({ ...good, isolated: 168.9 })).toEqual(['the isolation is drawn: 0.6 px wider (168.3 to 168.9), expected no width']);
    // Narrower is drawn too (a mark that takes space back), not only wider.
    expect(bidiFailures({ ...good, isolated: 167.7 })).toEqual(['the isolation is drawn: -0.6 px wider (168.3 to 167.7), expected no width']);
    // What Chromium 53, 56 and 68 measured with FSI/PDI alone: the isolated lines as the controls.
    expect(bidiFailures({ ...good, trailing: { first: 83.8, second: 266.7 }, leading: { first: 321.6, second: 180.8 } })).toEqual([
      'a name ending in a digit: the count joined it (the name at x=83.8, left of the count at 266.7)',
      'a name starting with a digit: the digit split off (at x=321.6, right of the name at 180.8)',
    ]);
    // A line that looks the same either way proves nothing.
    expect(bidiFailures({ ...good, trailingControl: { first: 204, second: 83.8 }, leadingControl: { first: 180.8, second: 220.7 } })).toEqual([
      'the control for a name ending in a digit did not join (x=204 vs 83.8): the line proves nothing',
      'the control for a name starting with a digit did not split (x=180.8 vs 220.7): the line proves nothing',
    ]);
    // Equal positions are no answer either way.
    expect(bidiFailures({ ...good, trailing: { first: 90, second: 90 }, leading: { first: 90, second: 90 } })).toHaveLength(2);
    expect(bidiFailures({ ...good, trailingControl: { first: 90, second: 90 }, leadingControl: { first: 90, second: 90 } })).toHaveLength(2);
  });
});

describe("S9's Intl", () => {
  it('tells the digits of a text', () => {
    expect(digitsIn('1,234.5')).toBe('latn');
    expect(digitsIn(arabicDigits('1234'))).toBe('arab');
    expect(digitsIn(arabicDigits('0'))).toBe('arab');
    expect(digitsIn(arabicDigits('9'))).toBe('arab');
    expect(digitsIn(`${arabicDigits('12')} 3`)).toBe('mixed');
    expect(digitsIn('ص')).toBe('none');
  });

  /** An engine whose ar-SA is Hijri with Arabic-Indic digits (as Chromium 53's CLDR had it). */
  function fakeIntl(options: { readonly throws?: string; readonly plural?: boolean } = {}) {
    class DateTimeFormat {
      static supportedLocalesOf(tags: string[]): string[] {
        return tags.filter((t) => t !== 'ar');
      }
      constructor(
        private readonly tag?: string,
        private readonly options?: Intl.DateTimeFormatOptions,
      ) {
        if (tag !== undefined && tag === fake.throws) throw new RangeError(`Incorrect locale information provided`);
      }
      resolvedOptions() {
        const sa = this.tag === 'ar-SA';
        return { locale: this.tag ?? 'en-US', calendar: sa ? 'islamic-umalqura' : 'gregory', numberingSystem: this.tag?.indexOf('ar') === 0 ? 'arab' : 'latn', timeZone: 'Asia/Riyadh' };
      }
      format(): string {
        return this.options?.hour === undefined ? `date ${this.tag ?? ''}` : this.tag === 'en-US' ? '8:05 PM' : 'time';
      }
    }
    class NumberFormat {
      constructor(private readonly tag: string) {}
      format(n: number): string {
        return this.tag.indexOf('ar') === 0 ? arabicDigits(String(n)) : '1,234.5';
      }
    }
    const fake = { DateTimeFormat, NumberFormat, throws: options.throws, ...(options.plural === true ? { PluralRules: class {} } : {}) };
    return fake as unknown as typeof Intl;
  }

  it("records each locale's calendar, digits and output beside the app's own", () => {
    const answer = readIntl(fakeIntl({ plural: true }), new Date(2026, 10, 4, 20, 5));
    expect(answer).toMatchObject({ hasIntl: true, pluralRules: true, timeZone: 'Asia/Riyadh' });
    expect(answer.locales.map((l) => l.tag)).toEqual(INTL_TAGS);
    const sa = answer.locales[0];
    expect(sa).toEqual({
      tag: 'ar-SA',
      supported: true,
      intl: { locale: 'ar-SA', calendar: 'islamic-umalqura', numberingSystem: 'arab', date: 'date ar-SA', time: 'time', number: arabicDigits('1234.5'), digits: 'arab' },
      // The app: Gregorian, Western digits in Arabic too (ADR-011).
      app: { date: 'الأربعاء، 4 نوفمبر 2026', time: '8:05 م', number: '1,234.5', digits: 'latn' },
      sameAsIntl: false,
    });
    expect(answer.locales[2]?.supported).toBe(false);
    expect(answer.locales[3]?.app).toEqual({ date: 'Wednesday, November 4, 2026', time: '8:05 PM', number: '1,234.5', digits: 'latn' });
    expect(intlNote(answer)).toBe('Intl: ar-SA islamic-umalqura·arab, ar-AE gregory·arab, ar gregory·arab, en-US gregory·latn; the app: Gregorian, latn digits in Arabic (ADR-011)');
  });

  it('says when the app writes exactly what Intl does', () => {
    // An engine that writes en-US as the app does, and every other tag differently.
    class DateTimeFormat {
      static supportedLocalesOf = (tags: string[]): string[] => tags;
      constructor(
        private readonly tag?: string,
        private readonly options?: Intl.DateTimeFormatOptions,
      ) {}
      resolvedOptions = () => ({ locale: this.tag ?? 'en-US', calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC' });
      format = (): string => (this.tag !== 'en-US' ? 'other' : this.options?.hour === undefined ? 'Wednesday, November 4, 2026' : '8:05 PM');
    }
    class NumberFormat {
      format = (): string => '1,234.5';
    }
    const answer = readIntl({ DateTimeFormat, NumberFormat } as unknown as typeof Intl, new Date(2026, 10, 4, 20, 5));
    expect(answer.locales.map((l) => [l.tag, l.sameAsIntl])).toEqual([
      ['ar-SA', false],
      ['ar-AE', false],
      ['ar', false],
      ['en-US', true],
    ]);
    expect(answer.pluralRules).toBe(false);
  });

  it('needs the time to match too', () => {
    // As above, but the engine writes en-US times on a 24-hour clock.
    class DateTimeFormat {
      static supportedLocalesOf = (tags: string[]): string[] => tags;
      constructor(
        private readonly tag?: string,
        private readonly options?: Intl.DateTimeFormatOptions,
      ) {}
      resolvedOptions = () => ({ locale: this.tag ?? 'en-US', calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC' });
      format = (): string => (this.options?.hour === undefined ? 'Wednesday, November 4, 2026' : '20:05');
    }
    class NumberFormat {
      format = (): string => '1,234.5';
    }
    const answer = readIntl({ DateTimeFormat, NumberFormat } as unknown as typeof Intl, new Date(2026, 10, 4, 20, 5));
    expect(answer.locales[3]).toMatchObject({ tag: 'en-US', app: { time: '8:05 PM' }, intl: { time: '20:05' }, sameAsIntl: false });
  });

  it("names the app's digits in Arabic only, from its Arabic locales", () => {
    const locale = (tag: string, digits: string): IntlLocale => ({
      tag,
      supported: true,
      intl: { locale: tag, calendar: 'gregory', numberingSystem: 'latn', date: '', time: '', number: '', digits: 'latn' },
      app: { date: '', time: '', number: '', digits },
      sameAsIntl: false,
    });
    const answer: IntlAnswer = { hasIntl: true, pluralRules: true, timeZone: null, locales: [locale('ar-SA', 'arab'), locale('ar-AE', 'latn'), locale('en-US', 'latn')] };
    expect(intlNote(answer)).toBe('Intl: ar-SA gregory·latn, ar-AE gregory·latn, en-US gregory·latn; the app: Gregorian, arab/latn digits in Arabic (ADR-011)');
    expect(intlNote({ ...answer, locales: [locale('ar-SA', 'arab'), locale('en-US', 'latn')] })).toMatch(/the app: Gregorian, arab digits in Arabic/);
  });

  it("reports an engine's refusal per locale, and an engine without Intl", () => {
    const answer = readIntl(fakeIntl({ throws: 'ar-AE' }), new Date(2026, 10, 4, 20, 5));
    expect(answer.locales[1]).toMatchObject({ tag: 'ar-AE', intl: { error: 'RangeError: Incorrect locale information provided' }, sameAsIntl: false });
    expect(intlNote(answer)).toMatch(/^Intl: ar-SA islamic-umalqura·arab, ar-AE error, /);
    const none = readIntl(undefined, new Date(2026, 10, 4, 20, 5));
    expect(none).toMatchObject({ hasIntl: false, pluralRules: false, timeZone: null });
    expect(none.locales.every((l) => 'error' in l.intl && !l.sameAsIntl)).toBe(true);
    expect(none.locales[0]?.app.date).toBe('الأربعاء، 4 نوفمبر 2026');
    expect(intlNote(none)).toBe('no Intl; the app formats without it (ADR-011)');
  });
});
