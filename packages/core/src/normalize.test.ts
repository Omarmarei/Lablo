import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matchName, normalizeName } from './normalize';

const ch = (...codes: number[]): string => String.fromCharCode(...codes);
const FATHA = ch(0x64e);
const KASRA = ch(0x650);
const SHADDA = ch(0x651);
const SUKUN = ch(0x652);
const TATWEEL = ch(0x640);
const RLM = ch(0x200f);
const ZWNJ = ch(0x200c);
const ACUTE = ch(0x301);

describe('normalizeName golden', () => {
  it.each([
    // Arabic: alef forms, taa marbuta, alef maqsura, diacritics, tatweel, hamza carriers.
    ['أخبار', 'اخبار'],
    ['إشراق', 'اشراق'],
    ['آمال', 'امال'],
    [`ٱلله`, 'الله'],
    ['رِياضة', 'رياضه'],
    ['قناة الجزيرة', 'قناه الجزيره'],
    ['موسيقى', 'موسيقي'],
    ['اقتـصاد', 'اقتصاد'],
    [`مُ${SHADDA}حَ${SUKUN}مد${TATWEEL}${TATWEEL}`, 'محمد'],
    [`ك${KASRA}ت${FATHA}اب`, 'كتاب'],
    ['مؤسسة', 'موسسه'],
    ['رئيس', 'رييس'],
    ['کتاب فارسی', 'كتاب فارسي'],
    // Digits: Arabic-Indic and extended Arabic-Indic.
    ['الحلقة ١٢', 'الحلقه 12'],
    ['قناة ۱۰۹', 'قناه 109'],
    ['٣٫٥', '35'],
    // Latin accents and letters NFKD keeps.
    ['Cinéma', 'cinema'],
    ['Économie', 'economie'],
    ['Niños', 'ninos'],
    [`Cafe${ACUTE}`, 'cafe'],
    ['Cœur', 'coeur'],
    ['Straße', 'strasse'],
    ['Øresund Æble', 'oresund aeble'],
    ['Łódź', 'lodz'],
    ['Þór', 'thor'],
    ['İstanbul', 'istanbul'],
    // Compatibility forms.
    ['beIN Sports 1 ᴴᴰ', 'bein sports 1 hd'],
    ['ＺＯＭＡ ＴＶ', 'zoma tv'],
    [`${ch(0xd835, 0xdc01, 0xd835, 0xdc01, 0xd835, 0xdc02)}`, 'bbc'], // mathematical bold B B C
    ['① Channel', '1 channel'],
    ['ﻻ', 'لا'],
    // Punctuation and symbols.
    ['AR: MBC 1 HD', 'ar mbc 1 hd'],
    ['|UK| BBC One', 'uk bbc one'],
    ['Al-Jazeera', 'al jazeera'],
    ['Canal+ & Co', 'canal+ & co'],
    ["Don't Look Up", 'dont look up'],
    ['S.W.A.T.', 'swat'],
    ['Zoma™ ®', 'zoma'],
    [`${ch(0x26bd, 0xfe0f)} Sport ★ 24/7 ${ch(0xd83d, 0xdd25)}`, 'sport 24 7'],
    ['«خبر» ، عاجل؟', 'خبر عاجل'],
    // Invisible characters and whitespace.
    [`${RLM}قناة${RLM} ${ZWNJ}واحد`, 'قناه واحد'],
    [`${ch(0xfeff)}News${ch(0xad)}room`, 'newsroom'],
    ['  many \t  spaces\n ', 'many spaces'],
    [`a${ch(0xa0)}b${ch(0x2009)}c`, 'a b c'],
    ['', ''],
    ['---', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe('matchName golden', () => {
  it.each([
    ['AR: MBC 1 HD', 'mbc1'],
    ['|UK| BBC One FHD', 'bbcone'],
    ['UK | BBC One', 'bbcone'],
    ['FR - TF1 4K', 'tf1'],
    ['[AR] Rotana Cinema', 'rotanacinema'],
    ['(US) CNN', 'cnn'],
    ['KSA: SBC HEVC', 'sbc'],
    ['VIP | AR: beIN Sports 1 ᴴᴰ', 'beinsports1'],
    ['MBC 1 (AR)', 'mbc1'],
    ['MBC 1 [UK]', 'mbc1'],
    ['MBC 1 |AR|', 'mbc1'],
    ['MBC1', 'mbc1'],
    ['Al-Jazeera', 'aljazeera'],
    ['beIN Sports', 'beinsports'],
    ['MBC 1', 'mbc1'],
    ['Canal+ 1080p', 'canal+'],
    ['قناة الجزيرة HD', 'قناهالجزيره'],
    ['AR: HD', 'hd'],
    ['HD', 'hd'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(matchName(input)).toBe(expected);
  });

  it('gives XMLTV display names and decorated playlist names the same form', () => {
    expect(matchName('AR: MBC Drama FHD')).toBe(matchName('MBC Drama'));
    expect(matchName('|AR| الجزيرة الوثائقية ᴴᴰ')).toBe(matchName('الجزيرة الوثائقيه'));
  });
});

/** Any UTF-16 string, lone surrogates included. */
const anyString = fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)), maxLength: 40 });
const anyText = fc.oneof(anyString, fc.string({ unit: 'binary', maxLength: 40 }), fc.string({ unit: 'grapheme', maxLength: 20 }));

describe('normalizeName properties', () => {
  it('never throws, is idempotent, and leaves only folded characters and single spaces', () => {
    fc.assert(
      fc.property(anyText, (input) => {
        const out = normalizeName(input);
        expect(normalizeName(out)).toBe(out);
        expect(out).toBe(out.trim());
        // Single spaces only: no other whitespace (JS \s), no runs, no capitals.
        expect(out).not.toMatch(/ {2}|[A-Z]|[^\S ]/);
        for (let i = 0; i < out.length; i++) {
          const c = out.charCodeAt(i);
          const folded =
            (c >= 0x300 && c <= 0x36f) || // combining accents
            (c >= 0x64b && c <= 0x65f) || // harakat
            (c >= 0x660 && c <= 0x669) || // Arabic-Indic digits
            (c >= 0x6f0 && c <= 0x6f9) ||
            (c >= 0xd800 && c <= 0xdfff) || // surrogates
            [0x622, 0x623, 0x625, 0x629, 0x640, 0x649, 0x670, 0x671, 0x200f, 0xfeff, 0xfe0f].indexOf(c) !== -1;
          expect(folded, `U+${c.toString(16)} in ${JSON.stringify(out)}`).toBe(false);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('folds decorated Arabic spellings to the plain one', () => {
    const LETTERS = 'بتثجحخدذرزسشصضطظعغفقكلمنوي';
    const MARKS = [0x64b, 0x64c, 0x64d, 0x64e, 0x64f, 0x650, 0x651, 0x652].map((c) => ch(c));
    const word = fc.array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 6 });
    const decorated = fc.tuple(word, fc.boolean(), fc.boolean(), fc.boolean(), fc.array(fc.nat(), { maxLength: 6 }));
    fc.assert(
      fc.property(decorated, fc.constantFrom('أ', 'إ', 'آ', 'ٱ'), ([letters, alef, taa, yaa, noise], alefForm) => {
        const plain = `${alef ? 'ا' : ''}${letters.join('')}${taa ? 'ه' : yaa ? 'ي' : ''}`;
        let fancy = alef ? alefForm : '';
        letters.forEach((l, i) => {
          const r = noise[i] ?? 0;
          fancy += l + (r % 3 === 0 ? MARKS[r % MARKS.length]! : '') + (r % 5 === 1 ? TATWEEL : '');
        });
        fancy += taa ? 'ة' : yaa ? 'ى' : '';
        expect(normalizeName(fancy)).toBe(normalizeName(plain));
      }),
      { numRuns: 1000 },
    );
  });

  it('folds Latin accents and Arabic-Indic digits', () => {
    const accents = fc.array(fc.integer({ min: 0x300, max: 0x36f }), { maxLength: 3 });
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), accents), { minLength: 1, maxLength: 12 }), (parts) => {
        const plain = parts.map(([c]) => c).join('');
        const arabicDigits = plain.replace(/[0-9]/g, (d) => ch(0x660 + Number(d)));
        const accented = parts.map(([c, marks]) => (/[a-z]/.test(c) ? c.toUpperCase() + ch(...marks) : c)).join('');
        expect(normalizeName(accented)).toBe(plain);
        expect(normalizeName(arabicDigits)).toBe(plain);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('matchName properties', () => {
  it('never throws and has no spaces', () => {
    fc.assert(
      fc.property(anyText, (input) => {
        expect(matchName(input)).not.toMatch(/\s/);
      }),
      { numRuns: 2000 },
    );
  });

  it('ignores quality tokens and country prefixes', () => {
    // Every quality token the word pattern can spell (a name of quality tokens only keeps them all).
    const word = fc
      .stringMatching(/^[a-z][a-z0-9]{1,6}$/)
      .filter((w) => !['hd', 'sd', 'fhd', 'uhd', 'hq', 'lq', 'avc', 'fps', 'sdr', 'hdr', 'hdr10', 'hevc', 'h264', 'h265', 'x264', 'x265'].includes(w));
    const tag = fc.constantFrom('HD', 'FHD', 'UHD', '4K', 'HEVC', '1080p', 'ᴴᴰ', 'H.265');
    const prefix = fc.constantFrom('', 'AR: ', '|UK| ', 'FR | ', 'US - ', '[DE] ', 'KSA: ');
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 4 }), tag, prefix, (words, q, p) => {
        const name = words.join(' ');
        expect(matchName(`${p}${name} ${q}`)).toBe(matchName(name));
        expect(matchName(name)).toBe(words.join(''));
      }),
      { numRuns: 500 },
    );
  });
});
