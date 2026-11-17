// @lablo/protocol against what the rest of the code makes (RELAY step 29b2a): the two packages
// import nothing internal, so this root test holds them together. The protocol's base64url
// accepts exactly what @lablo/crypto's strict decoder accepts; crypto's wire values (the shared
// vectors' envelopes, sealed payloads, ids, hashes, signatures) parse; the size limits hold for
// real ciphertexts; and the telemetry schema's lists are the app's own types.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceTier } from '@lablo/core';
import type { CryptoVectors } from '@lablo/crypto/check-vectors';
import {
  BACKUP_KDF,
  blocklistHash,
  fromBase64Url,
  newBoxKeyPair,
  randomBytes,
  sealBackup,
  sealPairPayload,
  signDetached,
  signKeyPairFromSeed,
  toBase64Url,
  tokenHash,
  utf8,
} from '@lablo/crypto';
import type { Container, PlaybackErrorKind, PlayerEngine, PlayMode } from '@lablo/player';
import type { TelemetryEvent } from '@lablo/protocol';
import {
  BACKUP_CT_MAX_BYTES,
  BACKUP_KDF_NAME,
  backupEnvelopeSchema,
  base64UrlRange,
  bytes16,
  bytes32,
  lookupIdSchema,
  nonce24,
  PAIR_PAYLOAD_MAX_BYTES,
  pairCreateRequestSchema,
  sealedPayloadSchema,
  signature64,
  writeTokenSchema,
} from '@lablo/protocol';
import { describe, expect, it } from 'vitest';

const VECTORS = JSON.parse(readFileSync(join(import.meta.dirname, '../packages/crypto/test/vectors.json'), 'utf8')) as CryptoVectors & {
  readonly ed25519: ReadonlyArray<{ readonly signature: string }>;
  readonly blocklist: ReadonlyArray<{ readonly hash: string }>;
};

const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const anyLength = base64UrlRange(0, 4096);

/** A small deterministic generator: the cases are the same on every run. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('base64url: protocol and crypto agree', () => {
  it("accepts crypto's encoding of every length, and the fixed sizes only at their length", () => {
    for (let length = 0; length <= 100; length++) {
      const text = toBase64Url(randomBytes(length));
      expect([length, anyLength.safeParse(text).success]).toEqual([length, true]);
      expect([length, bytes16.safeParse(text).success]).toEqual([length, length === 16]);
      expect([length, nonce24.safeParse(text).success]).toEqual([length, length === 24]);
      expect([length, bytes32.safeParse(text).success]).toEqual([length, length === 32]);
      expect([length, signature64.safeParse(text).success]).toEqual([length, length === 64]);
    }
  });

  it("takes at each fixed size exactly the last characters crypto's decoder takes", () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const [schema, bytes] of [
      [bytes16, 16],
      [nonce24, 24],
      [bytes32, 32],
      [signature64, 64],
    ] as const) {
      const chars = Math.ceil((bytes * 4) / 3);
      let taken = 0;
      for (const last of alphabet) {
        const text = 'A'.repeat(chars - 1) + last;
        const decoded = fromBase64Url(text);
        expect([bytes, last, schema.safeParse(text).success]).toEqual([bytes, last, decoded !== null && decoded.length === bytes]);
        if (decoded !== null) taken++;
      }
      // 64 when no bits are unused, 16 with 2 unused bits, 4 with 4.
      expect([bytes, taken]).toEqual([bytes, { 16: 4, 24: 64, 32: 16, 64: 4 }[bytes]]);
    }
  });

  it("refuses every string crypto's vectors refuse", () => {
    expect(VECTORS.base64urlInvalid.length).toBeGreaterThan(10);
    for (const text of VECTORS.base64urlInvalid) expect([text, anyLength.safeParse(text).success]).toEqual([text, false]);
  });

  it('gives the same verdict as fromBase64Url on 20,000 short strings', () => {
    const alphabet = 'AQgwBEcd09-_+/= ';
    const random = generator(29);
    let accepted = 0;
    for (let i = 0; i < 20000; i++) {
      let text = '';
      const length = Math.floor(random() * 10);
      for (let j = 0; j < length; j++) text += alphabet[Math.floor(random() * alphabet.length)];
      const crypto = fromBase64Url(text) !== null;
      expect([text, anyLength.safeParse(text).success]).toEqual([text, crypto]);
      if (crypto) accepted++;
    }
    // Both verdicts came up often enough to mean something.
    expect(accepted).toBeGreaterThan(1000);
    expect(accepted).toBeLessThan(19000);
  });
});

describe("crypto's wire values parse", () => {
  it('the backup chain: lookup id, write token and its hash, the envelope', () => {
    expect(BACKUP_KDF).toBe(BACKUP_KDF_NAME);
    for (const backup of VECTORS.backup) {
      expect(lookupIdSchema.safeParse(backup.lookupId).success).toBe(true);
      expect(writeTokenSchema.safeParse(backup.writeToken).success).toBe(true);
      expect(bytes32.safeParse(backup.writeTokenHash).success).toBe(true);
      expect(backupEnvelopeSchema.parse(backup.envelope)).toEqual(backup.envelope);
    }
  });

  it("the pairing payload and the TV's key", () => {
    for (const pairing of VECTORS.pairing) {
      expect(sealedPayloadSchema.parse(pairing.sealed)).toEqual(pairing.sealed);
      expect(pairCreateRequestSchema.safeParse({ tvPk: toBase64Url(fromHex(pairing.tvPublicKey)) }).success).toBe(true);
    }
  });

  it('signatures, blocklist hashes and token hashes', () => {
    for (const { signature } of VECTORS.ed25519) expect(signature64.safeParse(toBase64Url(fromHex(signature))).success).toBe(true);
    for (const { hash } of VECTORS.blocklist) expect(bytes32.safeParse(hash).success).toBe(true);
    const keys = signKeyPairFromSeed(randomBytes(32));
    expect(signature64.safeParse(toBase64Url(signDetached(utf8('{"v":1}'), keys.secretKey))).success).toBe(true);
    expect(bytes32.safeParse(blocklistHash('salt-of-sixteen-', 'example.test')).success).toBe(true);
    expect(bytes32.safeParse(tokenHash(toBase64Url(randomBytes(32)))).success).toBe(true);
  });
});

describe('the size limits hold for real ciphertexts', () => {
  it('the largest pairing payload seals into an accepted body; one byte more does not', () => {
    const tv = newBoxKeyPair();
    const largest = sealPairPayload(new Uint8Array(PAIR_PAYLOAD_MAX_BYTES), tv.publicKey);
    expect(sealedPayloadSchema.safeParse(largest).success).toBe(true);
    const over = sealPairPayload(new Uint8Array(PAIR_PAYLOAD_MAX_BYTES + 1), tv.publicKey);
    expect(sealedPayloadSchema.safeParse(over).error?.issues.map((i) => `${i.code}@${i.path.join('.')}`)).toEqual(['too_big@ct']);
  });

  it('the largest backup seals into an accepted envelope; one byte more does not', () => {
    const encKey = randomBytes(32);
    const plainMax = BACKUP_CT_MAX_BYTES - 16;
    expect(backupEnvelopeSchema.safeParse(sealBackup(new Uint8Array(plainMax), encKey)).success).toBe(true);
    const over = backupEnvelopeSchema.safeParse(sealBackup(new Uint8Array(plainMax + 1), encKey));
    expect(over.error?.issues.map((i) => `${i.code}@${i.path.join('.')}`)).toEqual(['too_big@ct']);
    // And the whole envelope fits the route's 512 KB body.
    expect(JSON.stringify(sealBackup(new Uint8Array(plainMax), encKey)).length).toBeLessThanOrEqual(524288);
  });
});

/** True only when A and B are the same set of values. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Play = Extract<TelemetryEvent, { kind: 'play_result' }>;
type AppStart = Extract<TelemetryEvent, { kind: 'app_start' }>;

describe("telemetry speaks the app's own vocabulary", () => {
  it('engines, containers, modes, error kinds and tiers are the app types (checked by tsc)', () => {
    const same: [
      Same<Play['engine'], PlayerEngine['kind']>,
      Same<Play['container'], Container>,
      Same<Play['mode'], PlayMode>,
      Same<NonNullable<Play['error']>['kind'], PlaybackErrorKind>,
      Same<AppStart['tier'], DeviceTier>,
    ] = [true, true, true, true, true];
    expect(same).toEqual([true, true, true, true, true]);
  });
});
