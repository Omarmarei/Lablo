import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { collapseSpace, cutText, decodeBase64Utf8 } from './text';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

describe('decodeBase64Utf8', () => {
  it('decodes UTF-8 text, with or without padding and whitespace', () => {
    expect(decodeBase64Utf8('TmV3cw==')).toBe('News');
    expect(decodeBase64Utf8('TmV3cw')).toBe('News');
    expect(decodeBase64Utf8(` ${b64('نشرة الأخبار 😀')}\n`)).toBe('نشرة الأخبار 😀');
    expect(decodeBase64Utf8('')).toBe('');
  });

  it('is null for text that is not base64 UTF-8', () => {
    expect(decodeBase64Utf8('Evening News!')).toBeNull();
    expect(decodeBase64Utf8('abcde')).toBeNull();
    // Bytes that are not UTF-8 (Latin-1 é, an overlong '/', a lone surrogate).
    for (const bytes of [[0x63, 0x61, 0x66, 0xe9], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
      expect(decodeBase64Utf8(Buffer.from(bytes).toString('base64'))).toBeNull();
    }
    // Control characters mean it was really plain text.
    expect(decodeBase64Utf8(b64('a\u0001b'))).toBeNull();
  });

  it('round-trips any well-formed text without control characters', () => {
    const isControl = (c: number): boolean => c < 0x20 && c !== 9 && c !== 10 && c !== 13;
    const text = fc.string({ unit: 'grapheme', maxLength: 40 }).filter((s) => !s.split('').some((ch) => isControl(ch.charCodeAt(0))));
    fc.assert(
      fc.property(text, (s) => {
        expect(decodeBase64Utf8(b64(s))).toBe(s);
      }),
    );
  });
});

describe('cutText and collapseSpace', () => {
  it('trims and caps without splitting a surrogate pair', () => {
    expect(cutText('  abc  ', 2)).toBe('ab');
    expect(cutText('a😀b', 2)).toBe('a');
    expect(cutText('ab ', 3)).toBe('ab');
  });

  it('collapses whitespace runs', () => {
    expect(collapseSpace(' a \n\t b  ')).toBe('a b');
  });
});
