import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url, utf8 } from './bytes';
import type { SealedPayload } from './pairing';
import {
  FILE_FRAME_BYTES,
  FILE_FRAME_OVERHEAD,
  boxKeyPairFromSecretKey,
  fileCipherLength,
  fileFrameCount,
  frameNonce,
  newBoxKeyPair,
  newFileKey,
  newFileNonceBase,
  openFile,
  openFileFrame,
  openPairPayload,
  sealFile,
  sealFileFrame,
  sealPairPayload,
} from './pairing';
import { flip, patternBytes, sameBytes, toHex } from './test-support';

describe('the pairing payload', () => {
  const plain = utf8('{"kind":"xtream","server":"http://example.test"}');

  it("seals to the TV's public key and opens with its secret key", () => {
    const tv = newBoxKeyPair();
    expect(tv.publicKey).toHaveLength(32);
    expect(tv.secretKey).toHaveLength(32);
    const sealed = sealPairPayload(plain, tv.publicKey);
    expect(Object.keys(sealed).sort()).toEqual(['ct', 'nonce', 'phonePk']);
    expect(fromBase64Url(sealed.phonePk)).toHaveLength(32);
    expect(fromBase64Url(sealed.nonce)).toHaveLength(24);
    expect(fromBase64Url(sealed.ct)).toHaveLength(plain.length + 16);
    expect(openPairPayload(sealed, tv.secretKey)).toEqual(plain);
  });

  it('uses a fresh phone key pair and nonce each time, or the ones given', () => {
    const tv = newBoxKeyPair();
    const one = sealPairPayload(plain, tv.publicKey);
    const two = sealPairPayload(plain, tv.publicKey);
    expect(one.phonePk).not.toBe(two.phonePk);
    expect(one.nonce).not.toBe(two.nonce);
    const phone = boxKeyPairFromSecretKey(patternBytes(32, 4));
    const nonce = patternBytes(24, 6);
    const fixed = sealPairPayload(plain, tv.publicKey, phone, nonce);
    expect(fixed.phonePk).toBe(toBase64Url(phone.publicKey));
    expect(fixed.nonce).toBe(toBase64Url(nonce));
    expect(sealPairPayload(plain, tv.publicKey, phone, nonce)).toEqual(fixed);
  });

  it("derives a key pair's public key from its secret key", () => {
    const pair = newBoxKeyPair();
    expect(boxKeyPairFromSecretKey(pair.secretKey)).toEqual(pair);
  });

  it('opens to null with another key, or when anything was changed', () => {
    const tv = newBoxKeyPair();
    const sealed = sealPairPayload(plain, tv.publicKey);
    expect(openPairPayload(sealed, newBoxKeyPair().secretKey)).toBeNull();
    const ct = fromBase64Url(sealed.ct)!;
    flip(ct, ct.length - 1, 0x80);
    expect(openPairPayload({ ...sealed, ct: toBase64Url(ct) }, tv.secretKey)).toBeNull();
    expect(openPairPayload({ ...sealed, phonePk: toBase64Url(newBoxKeyPair().publicKey) }, tv.secretKey)).toBeNull();
    const nonce = fromBase64Url(sealed.nonce)!;
    flip(nonce, 23, 1);
    expect(openPairPayload({ ...sealed, nonce: toBase64Url(nonce) }, tv.secretKey)).toBeNull();
  });

  it('opens to null when the post is malformed', () => {
    const tv = newBoxKeyPair();
    const sealed = sealPairPayload(plain, tv.publicKey);
    const variants: unknown[] = [
      { ...sealed, phonePk: toBase64Url(patternBytes(31)) },
      { ...sealed, nonce: toBase64Url(patternBytes(25)) },
      { ...sealed, ct: toBase64Url(patternBytes(15)) },
      { ...sealed, ct: `${sealed.ct}!` },
      { phonePk: sealed.phonePk, nonce: sealed.nonce },
    ];
    for (const variant of variants) expect(openPairPayload(variant as SealedPayload, tv.secretKey)).toBeNull();
  });

  it('refuses keys and nonces of the wrong size', () => {
    const tv = newBoxKeyPair();
    expect(() => sealPairPayload(plain, new Uint8Array(31))).toThrow(RangeError);
    expect(() => sealPairPayload(plain, tv.publicKey, newBoxKeyPair(), new Uint8Array(23))).toThrow(RangeError);
    expect(() => openPairPayload(sealPairPayload(plain, tv.publicKey), new Uint8Array(31))).toThrow(RangeError);
  });
});

describe('frameNonce', () => {
  const zero = new Uint8Array(24);

  it('is the base for frame 0 and adds the index little-endian', () => {
    const base = patternBytes(24, 11);
    expect(frameNonce(base, 0)).toEqual(base);
    expect(toHex(frameNonce(zero, 1))).toBe(`01${'00'.repeat(23)}`);
    expect(toHex(frameNonce(zero, 256))).toBe(`0001${'00'.repeat(22)}`);
    expect(toHex(frameNonce(zero, 0x01020304))).toBe(`04030201${'00'.repeat(20)}`);
    expect(toHex(frameNonce(zero, 0xffffffff))).toBe(`ffffffff${'00'.repeat(20)}`);
  });

  it('carries across bytes', () => {
    const base = new Uint8Array(24);
    base[0] = 0xff;
    base[1] = 0xff;
    base[2] = 0xfe;
    expect(toHex(frameNonce(base, 1))).toBe(`0000ff${'00'.repeat(21)}`);
    expect(toHex(frameNonce(base, 2))).toBe(`0100ff${'00'.repeat(21)}`);
    const high = new Uint8Array(24).fill(0xff);
    high[23] = 0x00;
    expect(toHex(frameNonce(high, 1))).toBe(`${'00'.repeat(23)}01`);
    expect(toHex(frameNonce(new Uint8Array(24).fill(0xff), 1))).toBe('00'.repeat(24));
  });

  it('leaves the base as it was', () => {
    const base = patternBytes(24);
    const copy = base.slice();
    frameNonce(base, 77);
    expect(base).toEqual(copy);
  });

  it('refuses a bad base or index', () => {
    expect(() => frameNonce(new Uint8Array(23), 0)).toThrow(RangeError);
    for (const index of [-1, 1.5, 2 ** 32, Number.NaN]) expect(() => frameNonce(zero, index), String(index)).toThrow(RangeError);
  });
});

describe('the encrypted file', () => {
  const key = patternBytes(32, 21);
  const base = patternBytes(24, 22);
  const frame = FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD;

  it('counts 1 MiB frames of 16 bytes overhead each', () => {
    expect(FILE_FRAME_BYTES).toBe(1048576);
    expect(FILE_FRAME_OVERHEAD).toBe(16);
    expect([0, 1, FILE_FRAME_BYTES, FILE_FRAME_BYTES + 1, 40 * FILE_FRAME_BYTES].map(fileFrameCount)).toEqual([0, 1, 1, 2, 40]);
    expect([0, 1, FILE_FRAME_BYTES, FILE_FRAME_BYTES + 1].map(fileCipherLength)).toEqual([0, 17, frame, FILE_FRAME_BYTES + 33]);
  });

  it('round-trips files of 0, 1, one frame, one frame and a byte, and two frames and a bit', () => {
    for (const size of [0, 1, FILE_FRAME_BYTES, FILE_FRAME_BYTES + 1, 2 * FILE_FRAME_BYTES + 1000]) {
      const plain = patternBytes(size, size & 255);
      const ct = sealFile(plain, key, base);
      expect(ct.length).toBe(fileCipherLength(size));
      const opened = openFile(ct, key, base, size);
      expect(opened).not.toBeNull();
      expect(sameBytes(opened!, plain)).toBe(true);
    }
  });

  it('is its frames one after the other, each under base + its index', () => {
    const plain = patternBytes(FILE_FRAME_BYTES + 5);
    const ct = sealFile(plain, key, base);
    expect(sameBytes(ct.subarray(0, frame), sealFileFrame(plain.subarray(0, FILE_FRAME_BYTES), key, base, 0))).toBe(true);
    expect(sameBytes(ct.subarray(frame), sealFileFrame(plain.subarray(FILE_FRAME_BYTES), key, base, 1))).toBe(true);
    expect(openFileFrame(ct.subarray(frame), key, base, 1)).toEqual(plain.subarray(FILE_FRAME_BYTES));
    expect(openFileFrame(ct.subarray(frame), key, base, 0)).toBeNull();
  });

  it('opens to null when frames are swapped, dropped, cut or changed, or the size is wrong', () => {
    const size = 2 * FILE_FRAME_BYTES;
    const plain = patternBytes(size);
    const ct = sealFile(plain, key, base);
    const swapped = new Uint8Array(ct.length);
    swapped.set(ct.subarray(frame), 0);
    swapped.set(ct.subarray(0, frame), frame);
    expect(openFile(swapped, key, base, size)).toBeNull();
    expect(openFile(ct.subarray(0, frame), key, base, size)).toBeNull();
    expect(openFile(ct.subarray(0, frame), key, base, FILE_FRAME_BYTES)).not.toBeNull();
    expect(openFile(ct.subarray(0, ct.length - 1), key, base, size)).toBeNull();
    const changed = ct.slice();
    flip(changed, frame + 100, 1);
    expect(openFile(changed, key, base, size)).toBeNull();
    expect(openFile(ct, key, base, size - 1)).toBeNull();
    expect(openFile(ct, patternBytes(32, 99), base, size)).toBeNull();
    expect(openFile(ct, key, patternBytes(24, 99), size)).toBeNull();
    expect(openFile(new Uint8Array(0), key, base, -1)).toBeNull();
    expect(openFile(new Uint8Array(17), key, base, 0.5)).toBeNull();
  });

  it('refuses a frame over 1 MiB, and opens no frame of an impossible length', () => {
    expect(() => sealFileFrame(new Uint8Array(FILE_FRAME_BYTES + 1), key, base, 0)).toThrow(RangeError);
    expect(() => sealFileFrame(new Uint8Array(1), new Uint8Array(31), base, 0)).toThrow(RangeError);
    expect(openFileFrame(new Uint8Array(15), key, base, 0)).toBeNull();
    expect(openFileFrame(new Uint8Array(frame + 1), key, base, 0)).toBeNull();
    expect(() => openFileFrame(new Uint8Array(16), new Uint8Array(31), base, 0)).toThrow(RangeError);
  });

  it('makes a random key and nonce base', () => {
    expect(newFileKey()).toHaveLength(32);
    expect(newFileNonceBase()).toHaveLength(24);
    expect(newFileKey()).not.toEqual(newFileKey());
    expect(newFileNonceBase()).not.toEqual(newFileNonceBase());
  });
});
