/**
 * The shared test vectors' checks (RELAY step 29b1): one function that the Node tests
 * (`test/vectors.test.ts`) and the old engines (the vectors page in `dist/tv-vectors`, in a
 * page and in a Blob worker) both run over `test/vectors.json`, so every engine is held to
 * the same answers. `test/make-vectors.ts` computes those answers with Node's own crypto
 * (OpenSSL) and tweetnacl, never through this package.
 *
 * Its own entry point (`@lablo/crypto/check-vectors`): the app never imports it. Plain ES2017
 * loops; it runs on Chromium 53.
 */
import type { BackupEnvelope, SealedPayload } from './index';
import {
  backupKeys,
  boxKeyPairFromSecretKey,
  blocklistHash,
  deriveBackupMaster,
  fileCipherLength,
  frameNonce,
  fromBase64Url,
  hkdfSha256,
  hmacSha256,
  openBackup,
  openFile,
  openPairPayload,
  randomBytes,
  scrypt,
  sealBackup,
  sealFile,
  sealPairPayload,
  sha256,
  signDetached,
  signKeyPairFromSeed,
  toBase64Url,
  tokenHash,
  utf8,
  verifySignature,
  FILE_FRAME_BYTES,
  FILE_FRAME_OVERHEAD,
} from './index';
import { fromHex, patternBytes, toHex } from './test-support';

/** Bytes are lowercase hex in the file; wire values (base64url) are as they go on the wire. */
export interface CryptoVectors {
  readonly version: 1;
  readonly base64url: ReadonlyArray<{ readonly hex: string; readonly b64url: string }>;
  /** Strings `fromBase64Url` must refuse. */
  readonly base64urlInvalid: readonly string[];
  readonly sha256: ReadonlyArray<{ readonly data: string; readonly digest: string }>;
  readonly hmacSha256: ReadonlyArray<{ readonly key: string; readonly data: string; readonly mac: string }>;
  readonly hkdfSha256: ReadonlyArray<{ readonly ikm: string; readonly salt: string | null; readonly info: string; readonly length: number; readonly okm: string }>;
  readonly scrypt: ReadonlyArray<{ readonly password: string; readonly salt: string; readonly N: number; readonly r: number; readonly p: number; readonly dkLen: number; readonly key: string }>;
  readonly backup: ReadonlyArray<{
    readonly deviceSecret: string;
    readonly platform: string;
    readonly appId: string;
    readonly master: string;
    readonly lookupId: string;
    readonly writeToken: string;
    readonly writeTokenHash: string;
    readonly encKey: string;
    readonly localKey: string;
    readonly plain: string;
    readonly nonce: string;
    readonly envelope: BackupEnvelope;
  }>;
  readonly pairing: ReadonlyArray<{
    readonly tvSecretKey: string;
    readonly tvPublicKey: string;
    readonly phoneSecretKey: string;
    readonly phonePublicKey: string;
    readonly nonce: string;
    readonly plain: string;
    readonly sealed: SealedPayload;
  }>;
  readonly frameNonces: ReadonlyArray<{ readonly base: string; readonly index: number; readonly nonce: string }>;
  /** A file of `patternBytes(size, seed)`: each frame's length and SHA-256 (together, the whole file). */
  readonly file: ReadonlyArray<{
    readonly key: string;
    readonly base: string;
    readonly size: number;
    readonly seed: number;
    readonly frames: ReadonlyArray<{ readonly length: number; readonly sha256: string }>;
  }>;
  readonly ed25519: ReadonlyArray<{ readonly seed: string; readonly publicKey: string; readonly message: string; readonly signature: string }>;
  readonly verify: ReadonlyArray<{ readonly message: string; readonly signature: string; readonly publicKeys: readonly string[]; readonly valid: boolean }>;
  readonly blocklist: ReadonlyArray<{ readonly salt: string; readonly host: string; readonly hash: string }>;
}

export interface VectorResult {
  /** `section[i].what`, the same on every engine. */
  readonly name: string;
  readonly ok: boolean;
  /** What differed, or the error. Empty when ok. */
  readonly detail: string;
  /** The check's time, ms (the backup's scrypt is the one that matters on a TV). */
  readonly ms: number;
}

type Check = () => Promise<string> | string;

const same = (what: string, got: string, want: string): string => (got === want ? '' : `${what}: got ${got}, expected ${want}`);

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Runs every check in order; one check's error is its own failure, never the others'. */
export async function checkVectors(vectors: CryptoVectors): Promise<VectorResult[]> {
  const checks: Array<{ name: string; run: Check }> = [];
  const add = (name: string, run: Check): void => {
    checks.push({ name, run });
  };

  for (let i = 0; i < vectors.base64url.length; i++) {
    const v = vectors.base64url[i]!;
    add(`base64url[${i}].encode`, () => same('b64url', toBase64Url(fromHex(v.hex)), v.b64url));
    add(`base64url[${i}].decode`, () => {
      const bytes = fromBase64Url(v.b64url);
      return bytes === null ? 'refused' : same('hex', toHex(bytes), v.hex);
    });
  }
  for (let i = 0; i < vectors.base64urlInvalid.length; i++) {
    const text = vectors.base64urlInvalid[i]!;
    add(`base64urlInvalid[${i}]`, () => (fromBase64Url(text) === null ? '' : `accepted ${text}`));
  }
  for (let i = 0; i < vectors.sha256.length; i++) {
    const v = vectors.sha256[i]!;
    add(`sha256[${i}]`, () => same('digest', toHex(sha256(fromHex(v.data))), v.digest));
  }
  for (let i = 0; i < vectors.hmacSha256.length; i++) {
    const v = vectors.hmacSha256[i]!;
    add(`hmacSha256[${i}]`, () => same('mac', toHex(hmacSha256(fromHex(v.key), fromHex(v.data))), v.mac));
  }
  for (let i = 0; i < vectors.hkdfSha256.length; i++) {
    const v = vectors.hkdfSha256[i]!;
    add(`hkdfSha256[${i}]`, () => same('okm', toHex(hkdfSha256(fromHex(v.ikm), fromHex(v.info), v.length, v.salt === null ? undefined : fromHex(v.salt))), v.okm));
  }
  for (let i = 0; i < vectors.scrypt.length; i++) {
    const v = vectors.scrypt[i]!;
    add(`scrypt[${i}]`, async () => same('key', toHex(await scrypt(fromHex(v.password), fromHex(v.salt), { N: v.N, r: v.r, p: v.p, dkLen: v.dkLen })), v.key));
  }
  for (let i = 0; i < vectors.backup.length; i++) {
    const v = vectors.backup[i]!;
    add(`backup[${i}].master`, async () => same('master', toHex(await deriveBackupMaster(v.deviceSecret, v.platform, v.appId)), v.master));
    add(`backup[${i}].keys`, () => {
      const keys = backupKeys(fromHex(v.master));
      return (
        same('lookupId', keys.lookupId, v.lookupId) +
        same('writeToken', keys.writeToken, v.writeToken) +
        same('encKey', toHex(keys.encKey), v.encKey) +
        same('localKey', toHex(keys.localKey), v.localKey)
      );
    });
    add(`backup[${i}].writeTokenHash`, () => same('hash', tokenHash(v.writeToken) ?? 'null', v.writeTokenHash));
    add(`backup[${i}].seal`, () => {
      const sealed = sealBackup(fromHex(v.plain), fromHex(v.encKey), fromHex(v.nonce));
      return same('v', String(sealed.v), String(v.envelope.v)) + same('kdf', sealed.kdf, v.envelope.kdf) + same('nonce', sealed.nonce, v.envelope.nonce) + same('ct', sealed.ct, v.envelope.ct);
    });
    add(`backup[${i}].open`, () => {
      const plain = openBackup(v.envelope, fromHex(v.encKey));
      if (plain === null) return 'refused';
      const wrong = openBackup(v.envelope, fromHex(v.localKey));
      return same('plain', toHex(plain), v.plain) + (wrong === null ? '' : 'opened under localKey');
    });
  }
  for (let i = 0; i < vectors.pairing.length; i++) {
    const v = vectors.pairing[i]!;
    add(`pairing[${i}].keys`, () => {
      const tv = boxKeyPairFromSecretKey(fromHex(v.tvSecretKey));
      const phone = boxKeyPairFromSecretKey(fromHex(v.phoneSecretKey));
      return same('tvPublicKey', toHex(tv.publicKey), v.tvPublicKey) + same('phonePublicKey', toHex(phone.publicKey), v.phonePublicKey);
    });
    add(`pairing[${i}].seal`, () => {
      const phone = boxKeyPairFromSecretKey(fromHex(v.phoneSecretKey));
      const sealed = sealPairPayload(fromHex(v.plain), fromHex(v.tvPublicKey), phone, fromHex(v.nonce));
      return same('phonePk', sealed.phonePk, v.sealed.phonePk) + same('nonce', sealed.nonce, v.sealed.nonce) + same('ct', sealed.ct, v.sealed.ct);
    });
    add(`pairing[${i}].open`, () => {
      const plain = openPairPayload(v.sealed, fromHex(v.tvSecretKey));
      return plain === null ? 'refused' : same('plain', toHex(plain), v.plain);
    });
  }
  for (let i = 0; i < vectors.frameNonces.length; i++) {
    const v = vectors.frameNonces[i]!;
    add(`frameNonces[${i}]`, () => same('nonce', toHex(frameNonce(fromHex(v.base), v.index)), v.nonce));
  }
  for (let i = 0; i < vectors.file.length; i++) {
    const v = vectors.file[i]!;
    add(`file[${i}]`, () => {
      const plain = patternBytes(v.size, v.seed);
      const key = fromHex(v.key);
      const base = fromHex(v.base);
      const ct = sealFile(plain, key, base);
      let out = same('length', String(ct.length), String(fileCipherLength(v.size)));
      out += same('frames', String(Math.ceil(ct.length / (FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD))), String(v.frames.length));
      for (let f = 0; f < v.frames.length; f++) {
        const start = f * (FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD);
        const frame = ct.subarray(start, Math.min(start + FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD, ct.length));
        out += same(`frame ${f} length`, String(frame.length), String(v.frames[f]!.length)) + same(`frame ${f}`, toHex(sha256(frame)), v.frames[f]!.sha256);
      }
      const opened = openFile(ct, key, base, v.size);
      return out + (opened === null ? 'did not open' : same('opened', toHex(sha256(opened)), toHex(sha256(plain))));
    });
  }
  for (let i = 0; i < vectors.ed25519.length; i++) {
    const v = vectors.ed25519[i]!;
    add(`ed25519[${i}]`, () => {
      const pair = signKeyPairFromSeed(fromHex(v.seed));
      const signature = signDetached(fromHex(v.message), pair.secretKey);
      return same('publicKey', toHex(pair.publicKey), v.publicKey) + same('signature', toHex(signature), v.signature);
    });
  }
  for (let i = 0; i < vectors.verify.length; i++) {
    const v = vectors.verify[i]!;
    add(`verify[${i}]`, () => {
      const keys: Uint8Array[] = [];
      for (let k = 0; k < v.publicKeys.length; k++) keys.push(fromHex(v.publicKeys[k]!));
      return same('valid', String(verifySignature(fromHex(v.message), fromHex(v.signature), keys)), String(v.valid));
    });
  }
  for (let i = 0; i < vectors.blocklist.length; i++) {
    const v = vectors.blocklist[i]!;
    add(`blocklist[${i}]`, () => same('hash', blocklistHash(v.salt, v.host), v.hash));
  }
  // The engine's CSPRNG reaches tweetnacl (in a worker too); nothing to compare across engines.
  add('random', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    return same('length', String(a.length), '32') + (toHex(a) === toHex(b) ? 'the same bytes twice' : '');
  });
  // The labels are UTF-8 (an Arabic device secret or salt would be).
  add('utf8', () => same('hex', toHex(utf8('لابلو')), 'd984d8a7d8a8d984d988'));

  const results: VectorResult[] = [];
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i]!;
    const started = Date.now();
    try {
      const detail = await check.run();
      results.push({ name: check.name, ok: detail === '', detail, ms: Date.now() - started });
    } catch (error) {
      results.push({ name: check.name, ok: false, detail: errorText(error), ms: Date.now() - started });
    }
  }
  return results;
}
