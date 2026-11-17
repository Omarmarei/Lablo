/**
 * Makes `vectors.json`, the shared test vectors of @lablo/crypto (RELAY step 29b1).
 *
 * Every answer comes from a second implementation, never from the package under test:
 * - Node's own crypto (OpenSSL): base64url, SHA-256, HMAC, HKDF, scrypt, the X25519 and
 *   Ed25519 public keys, the Ed25519 signatures;
 * - tweetnacl called directly (the package only wraps it): `box` and `secretbox`;
 * - BigInt arithmetic for the frame nonces (the package adds byte by byte).
 *
 * `pnpm exec tsx packages/crypto/test/make-vectors.ts --write` rewrites the file;
 * `vectors.test.ts` fails when the file and this generator disagree.
 */
import { createHash, createHmac, createPrivateKey, createPublicKey, hkdfSync, scryptSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import nacl from 'tweetnacl';
import type { CryptoVectors } from '../src/check-vectors';
import { patternBytes } from '../src/test-support';

export const VECTORS_FILE = path.join(import.meta.dirname, 'vectors.json');

const FRAME = 1048576;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const text = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'utf8'));
const bytesOf = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'));
const sha256 = (data: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(data).digest());
const hmac = (key: Uint8Array, data: Uint8Array): Uint8Array => new Uint8Array(createHmac('sha256', key).update(data).digest());
const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array => new Uint8Array(hkdfSync('sha256', ikm, salt, info, length));
const scrypt = (password: Uint8Array, salt: Uint8Array, N: number, r: number, p: number, dkLen: number): Uint8Array =>
  new Uint8Array(scryptSync(password, salt, dkLen, { N, r, p, maxmem: 256 * 1024 * 1024 }));

/** The last 32 bytes of a public key's SPKI DER: the raw X25519 or Ed25519 key. */
function publicKeyOf(pkcs8Prefix: string, secret: Uint8Array): Uint8Array {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from(pkcs8Prefix, 'hex'), Buffer.from(secret)]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return new Uint8Array(spki.subarray(spki.length - 32));
}
const X25519_PKCS8 = '302e020100300506032b656e04220420';
const ED25519_PKCS8 = '302e020100300506032b657004220420';

function ed25519Sign(seed: Uint8Array, message: Uint8Array): Uint8Array {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from(ED25519_PKCS8, 'hex'), Buffer.from(seed)]), format: 'der', type: 'pkcs8' });
  return new Uint8Array(sign(null, message, key));
}

/** `base` + `index` as 192-bit little-endian numbers, by BigInt. */
function addNonce(base: Uint8Array, index: number): Uint8Array {
  let n = 0n;
  for (let i = base.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(base[i]!);
  n = (n + BigInt(index)) % (1n << 192n);
  const out = new Uint8Array(24);
  for (let i = 0; i < 24; i++) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }
  return out;
}

const flipped = (bytes: Uint8Array, index: number): Uint8Array => {
  const copy = bytes.slice();
  copy[index] = copy[index]! ^ 1;
  return copy;
};

/** A nonce base whose low eight bytes are ff…fe: frame 2 carries through all eight. */
function carryBase(): Uint8Array {
  const base = patternBytes(24, 71);
  base.fill(0xff, 0, 8);
  base[0] = 0xfe;
  return base;
}

function fileVector(key: Uint8Array, base: Uint8Array, size: number, seed: number): CryptoVectors['file'][number] {
  const plain = patternBytes(size, seed);
  const frames: Array<{ length: number; sha256: string }> = [];
  for (let i = 0; i * FRAME < size; i++) {
    const ct = nacl.secretbox(plain.subarray(i * FRAME, Math.min((i + 1) * FRAME, size)), addNonce(base, i), key);
    frames.push({ length: ct.length, sha256: hex(sha256(ct)) });
  }
  return { key: hex(key), base: hex(base), size, seed, frames };
}

export function makeVectors(): CryptoVectors {
  // Backup: one device, as the TV derives it (N = 2^15).
  const deviceSecret = 'LGUDID-0123456789abcdef0123456789abcdef';
  const platform = 'webos';
  const appId = 'com.lablo.iptv';
  const master = scrypt(text(deviceSecret), text(`lablo.backup.v1|${platform}|${appId}`), 32768, 8, 1, 32);
  const writeToken = hmac(master, text('write'));
  const encKey = hkdf(master, new Uint8Array(0), text('enc'), 32);
  const localKey = hkdf(master, new Uint8Array(0), text('local'), 32);
  const backupPlain = text('{"v":7,"sources":[{"kind":"m3u"}],"settings":{"language":"ar"}}');
  const backupNonce = patternBytes(24, 31);

  // Pairing: fixed TV and phone keys.
  const tvSecretKey = patternBytes(32, 41);
  const phoneSecretKey = patternBytes(32, 42);
  const tvPublicKey = publicKeyOf(X25519_PKCS8, tvSecretKey);
  const phonePublicKey = publicKeyOf(X25519_PKCS8, phoneSecretKey);
  const pairNonce = patternBytes(24, 43);
  const pairPlain = text('{"kind":"xtream","server":"http://provider.test:8080","username":"u","password":"p","fileKey":null}');

  // Config signing: the current key and the next one (rotation).
  const seedA = patternBytes(32, 61);
  const seedB = patternBytes(32, 62);
  const publicA = publicKeyOf(ED25519_PKCS8, seedA);
  const publicB = publicKeyOf(ED25519_PKCS8, seedB);
  const config = text('{"issuedAt":"2026-11-16T00:00:00Z","expiresAt":"2026-12-16T00:00:00Z","kill":[]}');
  const signatureA = ed25519Sign(seedA, config);
  const signatureB = ed25519Sign(seedB, config);

  const zero = new Uint8Array(24);
  const allFf = new Uint8Array(24).fill(0xff);

  return {
    version: 1,
    base64url: [0, 1, 2, 3, 4, 5, 6, 32, 33]
      .map((n) => patternBytes(n, n + 1))
      .concat([new Uint8Array([0xfb, 0xff, 0xbf]), new Uint8Array([0xff])])
      .map((bytes) => ({ hex: hex(bytes), b64url: b64url(bytes) })),
    base64urlInvalid: ['Zg==', 'Zm8=', 'Zm9vY', 'Z', 'A', 'Zm9vA', 'Zh', 'Zm9', 'ab+c', 'ab/c', 'ab c', 'abc\n', 'Zm9v\u0660'],
    sha256: [new Uint8Array(0), text('abc'), text('lablo'), patternBytes(1000, 9)].map((data) => ({ data: hex(data), digest: hex(sha256(data)) })),
    hmacSha256: [
      [text('Jefe'), text('what do ya want for nothing?')],
      [patternBytes(32, 3), text('lookup')],
      [patternBytes(100, 4), patternBytes(200, 5)],
    ].map(([key, data]) => ({ key: hex(key!), data: hex(data!), mac: hex(hmac(key!, data!)) })),
    hkdfSha256: [
      { ikm: bytesOf('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'), salt: bytesOf('000102030405060708090a0b0c'), info: bytesOf('f0f1f2f3f4f5f6f7f8f9'), length: 42 },
      { ikm: patternBytes(32, 6), salt: null, info: text('enc'), length: 32 },
      { ikm: patternBytes(32, 6), salt: null, info: text('local'), length: 32 },
      { ikm: patternBytes(80, 7), salt: patternBytes(80, 8), info: patternBytes(80, 9), length: 82 },
    ].map((v) => ({
      ikm: hex(v.ikm),
      salt: v.salt === null ? null : hex(v.salt),
      info: hex(v.info),
      length: v.length,
      okm: hex(hkdf(v.ikm, v.salt ?? new Uint8Array(0), v.info, v.length)),
    })),
    scrypt: [
      { password: new Uint8Array(0), salt: new Uint8Array(0), N: 16, r: 1, p: 1, dkLen: 64 },
      { password: text('password'), salt: text('NaCl'), N: 1024, r: 8, p: 16, dkLen: 64 },
      { password: patternBytes(20, 10), salt: patternBytes(12, 11), N: 256, r: 2, p: 3, dkLen: 20 },
    ].map((v) => ({ password: hex(v.password), salt: hex(v.salt), N: v.N, r: v.r, p: v.p, dkLen: v.dkLen, key: hex(scrypt(v.password, v.salt, v.N, v.r, v.p, v.dkLen)) })),
    backup: [
      {
        deviceSecret,
        platform,
        appId,
        master: hex(master),
        lookupId: b64url(hmac(master, text('lookup'))),
        writeToken: b64url(writeToken),
        writeTokenHash: b64url(sha256(writeToken)),
        encKey: hex(encKey),
        localKey: hex(localKey),
        plain: hex(backupPlain),
        nonce: hex(backupNonce),
        envelope: { v: 1, kdf: 'scrypt-15-8-1', nonce: b64url(backupNonce), ct: b64url(nacl.secretbox(backupPlain, backupNonce, encKey)) },
      },
    ],
    pairing: [
      {
        tvSecretKey: hex(tvSecretKey),
        tvPublicKey: hex(tvPublicKey),
        phoneSecretKey: hex(phoneSecretKey),
        phonePublicKey: hex(phonePublicKey),
        nonce: hex(pairNonce),
        plain: hex(pairPlain),
        sealed: { phonePk: b64url(phonePublicKey), nonce: b64url(pairNonce), ct: b64url(nacl.box(pairPlain, pairNonce, tvPublicKey, phoneSecretKey)) },
      },
    ],
    frameNonces: [
      [zero, 0],
      [zero, 1],
      [zero, 255],
      [zero, 256],
      [zero, 65535],
      [zero, 0xffffffff],
      [patternBytes(24, 12), 0],
      [patternBytes(24, 12), 5],
      [carryBase(), 1],
      [carryBase(), 2],
      [carryBase(), 3],
      [allFf, 1],
    ].map(([base, index]) => ({ base: hex(base as Uint8Array), index: index as number, nonce: hex(addNonce(base as Uint8Array, index as number)) })),
    file: [
      fileVector(patternBytes(32, 51), carryBase(), 2 * FRAME + 1000, 3),
      fileVector(patternBytes(32, 52), patternBytes(24, 53), 1000, 4),
      fileVector(patternBytes(32, 54), patternBytes(24, 55), 0, 5),
    ],
    ed25519: [
      { seed: hex(seedA), publicKey: hex(publicA), message: hex(config), signature: hex(signatureA) },
      { seed: hex(seedB), publicKey: hex(publicB), message: '', signature: hex(ed25519Sign(seedB, new Uint8Array(0))) },
    ],
    verify: [
      { message: hex(config), signature: hex(signatureA), publicKeys: [hex(publicA)], valid: true },
      { message: hex(config), signature: hex(signatureA), publicKeys: [hex(publicB), hex(publicA)], valid: true },
      { message: hex(config), signature: hex(signatureB), publicKeys: [hex(publicA), hex(publicB)], valid: true },
      { message: hex(config), signature: hex(signatureA), publicKeys: [hex(publicB)], valid: false },
      { message: hex(flipped(config, 5)), signature: hex(signatureA), publicKeys: [hex(publicA)], valid: false },
      { message: hex(config), signature: hex(flipped(signatureA, 3)), publicKeys: [hex(publicA)], valid: false },
      { message: hex(config), signature: hex(flipped(signatureA, 40)), publicKeys: [hex(publicA)], valid: false },
      { message: hex(config), signature: hex(signatureA.subarray(0, 63)), publicKeys: [hex(publicA)], valid: false },
      { message: hex(config), signature: hex(signatureA), publicKeys: [], valid: false },
    ],
    blocklist: ['example.test', 'cdn.example.test', 'xn--mgbh0fb.xn--kgbechtv'].map((host) => ({
      salt: 'kL9x-2026',
      host,
      hash: b64url(sha256(text(`kL9x-2026${host}`))),
    })),
  };
}

/** The file as written: two-space JSON, ASCII only (`\u` escapes), a final newline. */
export function vectorsJson(vectors: CryptoVectors): string {
  const json = JSON.stringify(vectors, null, 2).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `${json}\n`;
}

if (process.argv.includes('--write')) {
  writeFileSync(VECTORS_FILE, vectorsJson(makeVectors()));
  console.log(`wrote ${path.relative(process.cwd(), VECTORS_FILE)}`);
}
