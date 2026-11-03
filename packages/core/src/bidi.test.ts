import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { firstStrongDirection, isolateText, stripIsolates } from './bidi';

const LRM = String.fromCharCode(0x200e);
const RLM = String.fromCharCode(0x200f);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

describe('firstStrongDirection', () => {
  it.each([
    ['Zoma Sports 1', 'ltr'],
    ['قناة زوما', 'rtl'],
    ['1 Zoma', 'ltr'],
    ['24 قناة', 'rtl'],
    ['(HD) MBC', 'ltr'],
    ['שלום', 'rtl'],
    ['Привет', 'ltr'],
    ['Ελλάδα', 'ltr'],
    ['東京', 'ltr'],
    ['हिन्दी', 'ltr'],
    ['ﻗﻨﺎﺓ', 'rtl'],
    ['ªb', 'ltr'],
  ])('%s starts %s', (text, dir) => {
    expect(firstStrongDirection(text)).toBe(dir);
  });

  it('skips digits, punctuation, marks and emoji to the first letter', () => {
    // Arabic-Indic (AN) and Extended Arabic-Indic (EN) digits are weak: the Latin letter decides.
    expect(firstStrongDirection(`${String.fromCharCode(0x661, 0x662)} News`)).toBe('ltr');
    expect(firstStrongDirection(`${String.fromCharCode(0x6f1, 0x6f2)} News`)).toBe('ltr');
    // A haraka (NSM) before a Latin letter, the Arabic comma and percent sign (CS, ET), emoji.
    expect(firstStrongDirection(`${String.fromCharCode(0x64b, 0x60c, 0x66a)}a`)).toBe('ltr');
    expect(firstStrongDirection('📺 أخبار')).toBe('rtl');
    expect(firstStrongDirection('× ÷ 4K')).toBe('ltr');
  });

  it('has no direction for text without a letter', () => {
    for (const text of ['', '24/7', '+1 (5)', '📺', '…', String.fromCharCode(0x661, 0x662, 0x66a)]) expect(firstStrongDirection(text), text).toBeNull();
  });

  it('counts the marks themselves as strong, as UAX #9 does', () => {
    expect(firstStrongDirection(`${RLM}Zoma`)).toBe('rtl');
    expect(firstStrongDirection(`${LRM}قناة`)).toBe('ltr');
  });

  it('gives every letter of the BMP its script’s direction, but for the approximations it names', () => {
    // Script_Extensions: the tatweel (U+0640) is Common by script, AL by bidi class.
    const rtlScript = /\p{scx=Arabic}|\p{scx=Hebrew}|\p{scx=Syriac}|\p{scx=Thaana}|\p{scx=Nko}|\p{scx=Samaritan}|\p{scx=Mandaic}/u;
    // Letters in the punctuation and symbol blocks (letterlike ℂ, ⁿ, Roman numerals, circled
    // letters, 々) count as neutral here: a channel name doesn't start with them.
    const approximated = (c: number): boolean => (c >= 0x2000 && c <= 0x2bff) || (c >= 0x3000 && c <= 0x303f);
    const wrong: string[] = [];
    for (let c = 0; c < 0x10000; c += 1) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCharCode(c);
      if (!/\p{L}/u.test(ch) || approximated(c)) continue;
      const expected = rtlScript.test(ch) ? 'rtl' : 'ltr';
      if (firstStrongDirection(ch) !== expected) wrong.push(`U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
    }
    expect(wrong).toEqual([]);
  });

  it('reads the RTL planes by their high surrogates', () => {
    expect(firstStrongDirection(String.fromCodePoint(0x1ee00))).toBe('rtl'); // Arabic mathematical alef
    expect(firstStrongDirection(String.fromCodePoint(0x10900))).toBe('rtl'); // Phoenician
    expect(firstStrongDirection(String.fromCodePoint(0x1d400))).toBe('ltr'); // mathematical bold A
    expect(firstStrongDirection(String.fromCodePoint(0x1f4fa))).toBeNull(); // 📺
  });
});

describe('isolateText', () => {
  it('wraps FSI…PDI in the text’s own mark, then the sentence’s', () => {
    expect(isolateText('MBC 1', 'rtl')).toBe(`${RLM}${LRM}${FSI}MBC 1${PDI}${LRM}${RLM}`);
    expect(isolateText('قناة 1', 'ltr')).toBe(`${LRM}${RLM}${FSI}قناة 1${PDI}${RLM}${LRM}`);
    expect(isolateText('قناة', 'rtl')).toBe(`${RLM}${RLM}${FSI}قناة${PDI}${RLM}${RLM}`);
    // No letter: left to right, as FSI decides.
    expect(isolateText('24/7', 'rtl')).toBe(`${RLM}${LRM}${FSI}24/7${PDI}${LRM}${RLM}`);
    expect(isolateText('', 'ltr')).toBe(`${LRM}${LRM}${FSI}${PDI}${LRM}${LRM}`);
  });

  it('round-trips through stripIsolates, six code units longer', () => {
    const plain = fc.string({ unit: 'binary' }).map(stripIsolates);
    fc.assert(
      fc.property(plain, fc.constantFrom('ltr' as const, 'rtl' as const), (text, around) => {
        const isolated = isolateText(text, around);
        expect(isolated.length).toBe(text.length + 6);
        expect(stripIsolates(isolated)).toBe(text);
      }),
    );
  });
});

describe('stripIsolates', () => {
  it('removes the isolates and the marks, the text’s own too, and nothing else', () => {
    expect(stripIsolates(`a ${isolateText('b', 'ltr')} ${isolateText('ج', 'rtl')}`)).toBe('a b ج');
    expect(stripIsolates(`${LRM}x${RLM}`)).toBe('x');
    const others = String.fromCharCode(0x200b, 0x200c, 0x200d, 0x202a, 0x202c, 0x2066, 0x2067);
    expect(stripIsolates(others)).toBe(others);
  });
});
