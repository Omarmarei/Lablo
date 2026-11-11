import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PSEUDO_ACCENTS, PSEUDO_EXPANSION, pseudoLocalize } from './pseudo';

const PLAIN: Record<string, string> = {};
for (const [plain, accented] of Object.entries(PSEUDO_ACCENTS)) PLAIN[accented] = plain;
const deaccent = (text: string): string =>
  text
    .split('')
    .map((c) => PLAIN[c] ?? c)
    .join('');

/** Printable ASCII, braces excluded: plain message text. */
const asciiText = fc.string({ unit: fc.integer({ min: 0x20, max: 0x7e }).map((n) => String.fromCharCode(n)) }).map((s) =>
  s.replace(/[{}]/g, ''),
);

describe('pseudoLocalize (en-XA)', () => {
  it.each([
    ['Settings', '[Šéţţîñĝš one]'],
    ['OK', '[ÖĶ one]'],
    ['', '[]'],
    // f, b, m, q, v and x have no accented form in U+0000–017F.
    ['Add to favourites', '[Åðð ţö fåvöûŕîţéš one two]'],
    ['{n} channels', '[{n} çĥåññéļš one]'],
    ['Hello {name}, {count} new', '[Ĥéļļö {name}, {count} ñéŵ one two]'],
    [
      '{n, plural, one {# channel} other {# channels}}',
      '[{n, plural, one {# çĥåññéļ} other {# çĥåññéļš}} one two]',
    ],
    // Unmatched braces: a stray `}` is text, an unclosed `{` keeps the rest as it is.
    ['a}b{c', '[å}b{c one]'],
  ])('%j -> %j', (message, expected) => {
    expect(pseudoLocalize(message)).toBe(expected);
  });

  it('only uses letters Lablo Sans has (Latin-1 and Latin Extended-A)', () => {
    for (const [plain, accented] of Object.entries(PSEUDO_ACCENTS)) {
      expect(plain).toMatch(/^[A-Za-z]$/);
      expect(accented.length).toBe(1);
      expect(accented.charCodeAt(0)).toBeGreaterThan(0x7f);
      expect(accented.charCodeAt(0)).toBeLessThanOrEqual(0x17f);
    }
    // Upper and lower case accent alike, so the text still reads.
    for (const [plain, accented] of Object.entries(PSEUDO_ACCENTS)) {
      if (plain === plain.toLowerCase()) expect(PSEUDO_ACCENTS[plain.toUpperCase()]).toBe(accented.toUpperCase());
    }
  });

  it('keeps the text readable: brackets around the accented text, then the padding words', () => {
    fc.assert(
      fc.property(asciiText, (text) => {
        const out = pseudoLocalize(text);
        expect(out.startsWith('[') && out.endsWith(']')).toBe(true);
        const plain = deaccent(out.slice(1, -1));
        expect(plain.startsWith(text)).toBe(true);
        expect(plain.slice(text.length)).toMatch(/^( (one|two|three|four|five|six|seven|eight|nine|ten))*$/);
        // Every letter that has an accent got it.
        for (const c of out.slice(1, 1 + text.length)) expect(PSEUDO_ACCENTS[c]).toBeUndefined();
      }),
    );
  });

  it('makes the text about 40% longer, and never much more', () => {
    fc.assert(
      fc.property(asciiText, (text) => {
        const padding = pseudoLocalize(text).length - 2 - text.length;
        expect(padding).toBeGreaterThanOrEqual(text.length * PSEUDO_EXPANSION);
        // At most one padding word (" three", 6 characters) past the target.
        expect(padding).toBeLessThan(Math.ceil(text.length * PSEUDO_EXPANSION) + 6);
      }),
    );
  });

  it('keeps every placeholder exactly, in order', () => {
    const name = fc.stringMatching(/^[a-z][a-zA-Z0-9_]{0,8}$/);
    fc.assert(
      fc.property(fc.array(fc.tuple(asciiText, name), { maxLength: 5 }), asciiText, (parts, tail) => {
        const message = parts.map(([text, n]) => `${text}{${n}}`).join('') + tail;
        const out = pseudoLocalize(message);
        const placeholders = out.match(/\{[^{}]*\}/g) ?? [];
        expect(placeholders).toEqual(parts.map(([, n]) => `{${n}}`));
      }),
    );
  });

  it('accents the message text inside ICU arguments, never their syntax', () => {
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    fc.assert(
      fc.property(word, word, word, (arg, one, other) => {
        const out = pseudoLocalize(`{${arg}, plural, one {# ${one}} other {# ${other}}}`);
        expect(out.startsWith(`[{${arg}, plural, one {# `)).toBe(true);
        const branches = /one \{# ([^}]*)\} other \{# ([^}]*)\}\}/.exec(out);
        expect(branches?.slice(1).map(deaccent)).toEqual([one, other]);
        expect(branches?.[1]).toBe(pseudoLocalize(one).slice(1, 1 + one.length));
      }),
    );
  });

  it('never throws, whatever the input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        expect(typeof pseudoLocalize(text)).toBe('string');
      }),
    );
  });
});
