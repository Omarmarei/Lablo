import { describe, expect, it } from 'vitest';
import { blocklistHash } from './blocklist';
import { toBase64Url, utf8 } from './bytes';
import { sha256 } from './hash';
import { randomBytes } from './random';
import { signDetached, signKeyPairFromSeed, verifySignature } from './sign';
import { flip, patternBytes } from './test-support';

describe('the config signature', () => {
  const current = signKeyPairFromSeed(patternBytes(32, 1));
  const next = signKeyPairFromSeed(patternBytes(32, 2));
  const message = utf8('{"issuedAt":"2026-11-16T00:00:00Z"}');

  it('derives the key pair from its seed', () => {
    expect(current.publicKey).toHaveLength(32);
    expect(current.secretKey).toHaveLength(64);
    expect(current.secretKey.subarray(0, 32)).toEqual(patternBytes(32, 1));
    expect(current.secretKey.subarray(32)).toEqual(current.publicKey);
    expect(signKeyPairFromSeed(patternBytes(32, 1))).toEqual(current);
  });

  it('verifies against any of the embedded keys', () => {
    const signature = signDetached(message, current.secretKey);
    expect(signature).toHaveLength(64);
    expect(verifySignature(message, signature, [current.publicKey])).toBe(true);
    expect(verifySignature(message, signature, [next.publicKey, current.publicKey])).toBe(true);
    expect(verifySignature(message, signDetached(message, next.secretKey), [current.publicKey, next.publicKey])).toBe(true);
  });

  it('rejects another key, another message, a changed signature or no keys', () => {
    const signature = signDetached(message, current.secretKey);
    expect(verifySignature(message, signature, [next.publicKey])).toBe(false);
    expect(verifySignature(utf8('{"issuedAt":"2026-11-17T00:00:00Z"}'), signature, [current.publicKey])).toBe(false);
    const changed = signature.slice();
    flip(changed, 10, 1);
    expect(verifySignature(message, changed, [current.publicKey])).toBe(false);
    expect(verifySignature(message, signature, [])).toBe(false);
  });

  it('answers false, without throwing, for a signature or key of the wrong length', () => {
    const signature = signDetached(message, current.secretKey);
    expect(verifySignature(message, signature.subarray(0, 63), [current.publicKey])).toBe(false);
    expect(verifySignature(message, new Uint8Array(65), [current.publicKey])).toBe(false);
    expect(verifySignature(message, signature, [current.publicKey.subarray(0, 31), current.publicKey])).toBe(true);
    expect(verifySignature(message, signature, [new Uint8Array(33)])).toBe(false);
  });
});

describe('blocklistHash', () => {
  it('is b64url(sha256(salt + host))', () => {
    expect(blocklistHash('s4lt', 'example.test')).toBe(toBase64Url(sha256(utf8('s4ltexample.test'))));
    expect(blocklistHash('s4lt', 'example.test')).toHaveLength(43);
    expect(blocklistHash('other', 'example.test')).not.toBe(blocklistHash('s4lt', 'example.test'));
    expect(blocklistHash('s4lt', 'sub.example.test')).not.toBe(blocklistHash('s4lt', 'example.test'));
  });
});

describe('randomBytes', () => {
  it('gives fresh bytes of the length asked', () => {
    expect(randomBytes(0)).toHaveLength(0);
    expect(randomBytes(24)).toHaveLength(24);
    expect(randomBytes(70000)).toHaveLength(70000);
    expect(randomBytes(32)).not.toEqual(randomBytes(32));
  });
});
