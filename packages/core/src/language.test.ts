import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeLang } from './language';

describe('normalizeLang', () => {
  it('folds every way streams and playlists write Arabic to ar', () => {
    for (const text of ['ar', 'AR', 'ara', 'Ara', 'arb', 'arz', 'apc', 'afb', 'ary', 'Arabic', 'ARABIC', 'arabe', 'Árabe', 'عربي', 'عربى', 'العربية', 'العربيه', 'ar-SA', 'ar_AE', 'ar-u-nu-latn']) {
      expect(normalizeLang(text), text).toBe('ar');
    }
  });

  it('takes the primary subtag of a tag or locale', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('en_GB')).toBe('en');
    expect(normalizeLang('zh-Hant-TW')).toBe('zh');
    expect(normalizeLang('pt-BR')).toBe('pt');
    expect(normalizeLang('fil-PH')).toBe('tl');
  });

  it('maps 639-2/T and /B codes to 639-1, and keeps three-letter codes with none', () => {
    expect(normalizeLang('eng')).toBe('en');
    expect(normalizeLang('fre')).toBe('fr');
    expect(normalizeLang('fra')).toBe('fr');
    expect(normalizeLang('ger')).toBe('de');
    expect(normalizeLang('deu')).toBe('de');
    expect(normalizeLang('per')).toBe('fa');
    expect(normalizeLang('chi')).toBe('zh');
    expect(normalizeLang('cmn')).toBe('zh');
    expect(normalizeLang('yue')).toBe('zh');
    expect(normalizeLang('urd')).toBe('ur');
    // No 639-1 code: the three letters, lower-case.
    expect(normalizeLang('KOK')).toBe('kok');
    expect(normalizeLang('fil')).toBe('tl');
  });

  it('keeps two-letter codes, with the renamed ones renamed', () => {
    expect(normalizeLang('fr')).toBe('fr');
    expect(normalizeLang('xh')).toBe('xh');
    expect(normalizeLang('iw')).toBe('he');
    expect(normalizeLang('in')).toBe('id');
  });

  it('reads names in English and in the language itself, around labels and marks', () => {
    expect(normalizeLang('English')).toBe('en');
    expect(normalizeLang('الإنجليزية')).toBe('en');
    expect(normalizeLang('Français')).toBe('fr');
    expect(normalizeLang('Deutsch')).toBe('de');
    expect(normalizeLang('Türkçe')).toBe('tr');
    expect(normalizeLang('فارسی')).toBe('fa');
    expect(normalizeLang('اردو')).toBe('ur');
    expect(normalizeLang('हिन्दी')).toBe('hi');
    expect(normalizeLang('日本語')).toBe('ja');
    expect(normalizeLang('Arabic (Egypt)')).toBe('ar');
    expect(normalizeLang('English 5.1')).toBe('en');
    expect(normalizeLang('  english  ')).toBe('en');
    expect(normalizeLang('\u200fعربي\u200f')).toBe('ar');
    expect(normalizeLang('عربي، مدبلج')).toBe('ar');
    expect(normalizeLang('Arabic\u00a0dub')).toBe('ar');
    expect(normalizeLang('\u2068English\u2069')).toBe('en');
  });

  it("is '' for nothing, undetermined codes, local-use codes and unknown names", () => {
    for (const text of ['', ' ', '-', '123', 'und', 'UND', 'unk', 'mis', 'mul', 'zxx', 'qaa', 'qtz', 'x', 'Klingonese', 'Audio Track', 'track1', 'a']) {
      expect(normalizeLang(text), JSON.stringify(text)).toBe('');
    }
    // Just outside the local-use range.
    expect(normalizeLang('qua')).toBe('qua');
    expect(normalizeLang('pzz')).toBe('pzz');
  });

  it('never throws, gives a code or nothing, and gives its own result back', () => {
    const text = fc.oneof(
      fc.string({ unit: 'grapheme', maxLength: 24 }),
      fc.constantFrom('ar', 'ara', 'Arabic', 'عربي', 'en-US', 'und', 'qaa', 'eng', 'iw', 'ger', 'Français'),
      fc.stringMatching(/^[A-Za-z]{1,4}([-_ ][A-Za-z0-9]{1,8})?$/),
    );
    fc.assert(
      fc.property(text, (s) => {
        const code = normalizeLang(s);
        expect(code).toMatch(/^([a-z]{2,3})?$/);
        expect(normalizeLang(code)).toBe(code);
      }),
      { numRuns: 2000 },
    );
  });
});
