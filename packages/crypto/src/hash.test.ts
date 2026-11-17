// Known answers from the standards; test/vectors.json adds Node's own crypto (OpenSSL) as a
// second implementation for every function here.
import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes';
import { hkdfSha256, hmacSha256, scrypt, sha256 } from './hash';
import { fromHex, toHex } from './test-support';

describe('sha256', () => {
  it("gives FIPS 180-2's answers", () => {
    expect(toHex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('hmacSha256', () => {
  it("gives RFC 4231's test case 2", () => {
    expect(toHex(hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('depends on the key and on the data', () => {
    const base = toHex(hmacSha256(utf8('k'), utf8('d')));
    expect(toHex(hmacSha256(utf8('K'), utf8('d')))).not.toBe(base);
    expect(toHex(hmacSha256(utf8('k'), utf8('D')))).not.toBe(base);
  });
});

describe('hkdfSha256', () => {
  it("gives RFC 5869's test case 1", () => {
    const ikm = fromHex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
    const salt = fromHex('000102030405060708090a0b0c');
    const info = fromHex('f0f1f2f3f4f5f6f7f8f9');
    expect(toHex(hkdfSha256(ikm, info, 42, salt))).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });

  it('gives 32 bytes by default, and the zero salt when none is given', () => {
    const ikm = utf8('master');
    const out = hkdfSha256(ikm, utf8('enc'));
    expect(out).toHaveLength(32);
    expect(hkdfSha256(ikm, utf8('enc'), 32, new Uint8Array(32))).toEqual(out);
    expect(hkdfSha256(ikm, utf8('local'))).not.toEqual(out);
  });
});

describe('scrypt', () => {
  it("gives RFC 7914's first test vector", async () => {
    const out = await scrypt(new Uint8Array(0), new Uint8Array(0), { N: 16, r: 1, p: 1, dkLen: 64 });
    expect(toHex(out)).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    );
  });

  it('passes every parameter through', async () => {
    const pw = utf8('pw');
    const salt = utf8('salt');
    const base = await scrypt(pw, salt, { N: 16, r: 1, p: 1, dkLen: 32 });
    expect(base).toHaveLength(32);
    expect(await scrypt(pw, salt, { N: 32, r: 1, p: 1, dkLen: 32 })).not.toEqual(base);
    expect(await scrypt(pw, salt, { N: 16, r: 2, p: 1, dkLen: 32 })).not.toEqual(base);
    expect(await scrypt(pw, salt, { N: 16, r: 1, p: 2, dkLen: 32 })).not.toEqual(base);
    expect(await scrypt(pw, utf8('salt2'), { N: 16, r: 1, p: 1, dkLen: 32 })).not.toEqual(base);
    expect((await scrypt(pw, salt, { N: 16, r: 1, p: 1, dkLen: 16 })).length).toBe(16);
  });

  it('reports its progress up to 1', async () => {
    const seen: number[] = [];
    await scrypt(utf8('pw'), utf8('salt'), { N: 1024, r: 8, p: 1, dkLen: 32 }, (fraction) => seen.push(fraction));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });
});
