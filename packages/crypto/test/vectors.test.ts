// The shared test vectors in Node (RELAY step 29b1). The same file and the same checks run in
// Chromium 53, 56 and 68 through `pnpm verify:engines` (tools/engines/src/vectors.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CryptoVectors } from '../src/check-vectors';
import { checkVectors } from '../src/check-vectors';
import { VECTORS_FILE, makeVectors, vectorsJson } from './make-vectors';

const committed = readFileSync(VECTORS_FILE, 'utf8');
const vectors = JSON.parse(committed) as CryptoVectors;

type DeepMutable<T> = { -readonly [K in keyof T]: DeepMutable<T[K]> };
type Editable = DeepMutable<CryptoVectors>;

/** A deep copy with one value changed by `edit`. */
function changed(edit: (copy: Editable) => void): CryptoVectors {
  const copy = JSON.parse(committed) as Editable;
  edit(copy);
  return copy;
}

/** Tab, newline and printable ASCII only. */
function isPlainAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code !== 9 && code !== 10 && (code < 32 || code > 126)) return false;
  }
  return true;
}

/** The last hex digit turned into another one. */
const otherHex = (value: string): string => value.slice(0, -1) + (value.endsWith('0') ? '1' : '0');
/** The first base64url character turned into another one (the unused bits stay zero). */
const otherB64 = (value: string): string => (value.startsWith('A') ? 'B' : 'A') + value.slice(1);

describe('the shared vectors', () => {
  it("are exactly what Node's crypto and tweetnacl give (make-vectors.ts), ASCII only", () => {
    const made = vectorsJson(makeVectors());
    expect(committed).toBe(made);
    expect(isPlainAscii(committed)).toBe(true);
  });

  it('cover every function of the package', () => {
    expect(vectors.version).toBe(1);
    for (const section of ['base64url', 'base64urlInvalid', 'sha256', 'hmacSha256', 'hkdfSha256', 'scrypt', 'backup', 'pairing', 'frameNonces', 'file', 'ed25519', 'verify', 'blocklist'] as const) {
      expect(vectors[section].length, section).toBeGreaterThan(0);
    }
    // The backup as the TV derives it, a file of three frames whose nonces carry, both answers of verify.
    expect(vectors.backup[0]!.envelope.kdf).toBe('scrypt-15-8-1');
    expect(vectors.file.some((file) => file.frames.length === 3)).toBe(true);
    expect(vectors.verify.some((v) => v.valid) && vectors.verify.some((v) => !v.valid)).toBe(true);
  });

  it('all pass in Node', async () => {
    const results = await checkVectors(vectors);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.length).toBe(
      2 * vectors.base64url.length +
        vectors.base64urlInvalid.length +
        vectors.sha256.length +
        vectors.hmacSha256.length +
        vectors.hkdfSha256.length +
        vectors.scrypt.length +
        5 * vectors.backup.length +
        3 * vectors.pairing.length +
        vectors.frameNonces.length +
        vectors.file.length +
        vectors.ed25519.length +
        vectors.verify.length +
        vectors.blocklist.length +
        2,
    );
    expect(new Set(results.map((r) => r.name)).size).toBe(results.length);
  });

  // Each section's check can fail: one expected value changed fails exactly the checks that read it.
  it.each<[string, (v: Editable) => void, string[]]>([
    ['base64url encode', (v) => void (v.base64url[1]!.b64url = otherB64(v.base64url[1]!.b64url)), ['base64url[1].encode', 'base64url[1].decode']],
    ['base64url decode', (v) => void (v.base64url[2]!.hex = otherHex(v.base64url[2]!.hex)), ['base64url[2].encode', 'base64url[2].decode']],
    ['base64urlInvalid', (v) => void (v.base64urlInvalid[0] = 'Zg'), ['base64urlInvalid[0]']],
    ['sha256', (v) => void (v.sha256[1]!.digest = otherHex(v.sha256[1]!.digest)), ['sha256[1]']],
    ['hmacSha256', (v) => void (v.hmacSha256[0]!.mac = otherHex(v.hmacSha256[0]!.mac)), ['hmacSha256[0]']],
    ['hkdfSha256 salt', (v) => void (v.hkdfSha256[0]!.salt = null), ['hkdfSha256[0]']],
    ['hkdfSha256 info', (v) => void (v.hkdfSha256[1]!.info = otherHex(v.hkdfSha256[1]!.info)), ['hkdfSha256[1]']],
    ['scrypt', (v) => void (v.scrypt[2]!.p = 2), ['scrypt[2]']],
    ['backup master', (v) => void (v.backup[0]!.appId = 'com.lablo.iptv2'), ['backup[0].master']],
    ['backup lookupId', (v) => void (v.backup[0]!.lookupId = otherB64(v.backup[0]!.lookupId)), ['backup[0].keys']],
    ['backup localKey', (v) => void (v.backup[0]!.localKey = otherHex(v.backup[0]!.localKey)), ['backup[0].keys']],
    ['backup localKey = encKey', (v) => void (v.backup[0]!.localKey = v.backup[0]!.encKey), ['backup[0].keys', 'backup[0].open']],
    ['backup writeTokenHash', (v) => void (v.backup[0]!.writeTokenHash = otherB64(v.backup[0]!.writeTokenHash)), ['backup[0].writeTokenHash']],
    ['backup envelope', (v) => void (v.backup[0]!.envelope.ct = otherB64(v.backup[0]!.envelope.ct)), ['backup[0].seal', 'backup[0].open']],
    ['pairing public key', (v) => void (v.pairing[0]!.phonePublicKey = otherHex(v.pairing[0]!.phonePublicKey)), ['pairing[0].keys']],
    ['pairing box', (v) => void (v.pairing[0]!.sealed.ct = otherB64(v.pairing[0]!.sealed.ct)), ['pairing[0].seal', 'pairing[0].open']],
    ['frame nonce', (v) => void (v.frameNonces[9]!.nonce = otherHex(v.frameNonces[9]!.nonce)), ['frameNonces[9]']],
    ['file frame', (v) => void (v.file[0]!.frames[2]!.sha256 = otherHex(v.file[0]!.frames[2]!.sha256)), ['file[0]']],
    ['file base', (v) => void (v.file[0]!.base = otherHex(v.file[0]!.base)), ['file[0]']],
    ['ed25519', (v) => void (v.ed25519[0]!.signature = otherHex(v.ed25519[0]!.signature)), ['ed25519[0]']],
    ['verify', (v) => void (v.verify[3]!.valid = true), ['verify[3]']],
    ['blocklist', (v) => void (v.blocklist[1]!.host = 'example.test'), ['blocklist[1]']],
  ])('catch a changed vector: %s', async (_label, edit, failing) => {
    const results = await checkVectors(changed(edit));
    expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual(failing);
    for (const result of results.filter((r) => !r.ok)) expect(result.detail).not.toBe('');
  });

  it("reports a check's error as that check's failure only", async () => {
    const results = await checkVectors(changed((v) => void (v.sha256[0]!.data = 'zz')));
    expect(results.filter((r) => !r.ok).map((r) => [r.name, r.detail])).toEqual([['sha256[0]', 'Error: not lowercase hex: zz']]);
  });
});
