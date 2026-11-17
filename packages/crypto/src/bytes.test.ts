import { describe, expect, it } from 'vitest';
import { concatBytes, fromBase64Url, toBase64Url, utf8 } from './bytes';
import { patternBytes, toHex } from './test-support';

const ascii = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
};

describe('base64url', () => {
  it("encodes RFC 4648's test vectors without padding", () => {
    const cases: Array<[string, string]> = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, encoded] of cases) {
      expect(toBase64Url(ascii(plain))).toBe(encoded);
      expect(fromBase64Url(encoded)).toEqual(ascii(plain));
    }
  });

  it('uses - and _ for 62 and 63', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(toBase64Url(new Uint8Array([0xff]))).toBe('_w');
    expect(fromBase64Url('-_-_')).toEqual(new Uint8Array([0xfb, 0xff, 0xbf]));
  });

  it('round-trips every length from 0 to 70 and the whole alphabet', () => {
    for (let n = 0; n <= 70; n++) {
      const bytes = patternBytes(n, n);
      const text = toBase64Url(bytes);
      expect(text).toHaveLength(Math.ceil((n * 4) / 3));
      expect(fromBase64Url(text)).toEqual(bytes);
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const decoded = fromBase64Url(alphabet);
    expect(decoded).toHaveLength(48);
    expect(toBase64Url(decoded!)).toBe(alphabet);
  });

  it('rejects padding, the standard alphabet, other characters and impossible lengths', () => {
    // 'A' and 'Zm9vA': a length of 4k + 1 whose last character carries only zero bits.
    for (const bad of ['Zg==', 'Zm8=', 'ab+c', 'ab/c', 'ab c', 'abc\n', 'Zm9vY', 'Z', 'A', 'Zm9vA', 'Zm9v\u0660']) {
      expect(fromBase64Url(bad), bad).toBeNull();
    }
  });

  it('rejects a second spelling: unused bits that are not zero', () => {
    expect(fromBase64Url('Zg')).toEqual(ascii('f'));
    expect(fromBase64Url('Zh')).toBeNull();
    expect(fromBase64Url('Zm8')).toEqual(ascii('fo'));
    expect(fromBase64Url('Zm9')).toBeNull();
  });

  it('answers null for a value that is not a string', () => {
    expect(fromBase64Url(undefined as unknown as string)).toBeNull();
    expect(fromBase64Url(42 as unknown as string)).toBeNull();
  });
});

describe('utf8 and concatBytes', () => {
  it('encodes text as UTF-8', () => {
    expect(toHex(utf8('lookup'))).toBe('6c6f6f6b7570');
    expect(toHex(utf8('é'))).toBe('c3a9');
    expect(toHex(utf8('لابلو'))).toBe('d984d8a7d8a8d984d988');
  });

  it('joins two byte strings', () => {
    expect(concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(concatBytes(new Uint8Array(0), new Uint8Array(0))).toEqual(new Uint8Array(0));
  });
});
