/**
 * The backup's keys and envelope (architecture.md §3.3 B):
 *
 *   master     = scrypt(deviceSecret, "lablo.backup.v1|" + platform + "|" + appId, N=2^15, r=8, p=1, 32)
 *   lookupId   = b64url(HMAC-SHA256(master, "lookup"))
 *   writeToken = b64url(HMAC-SHA256(master, "write")); the server keeps tokenHash(writeToken)
 *   encKey     = HKDF-SHA256(master, info "enc");  localKey = HKDF-SHA256(master, info "local")
 *   envelope   = {v: 1, kdf: "scrypt-15-8-1", nonce, ct: secretbox(plain, nonce, encKey)}
 *
 * The envelope's plaintext is the gzipped profile JSON; the gzip is the caller's (step 32),
 * so these functions take and give bytes.
 */
import nacl from 'tweetnacl';
import { fromBase64Url, toBase64Url, utf8 } from './bytes';
import type { ScryptParams } from './hash';
import { hkdfSha256, hmacSha256, scrypt, sha256 } from './hash';
import { randomBytes } from './random';

export const BACKUP_KDF = 'scrypt-15-8-1';
export const BACKUP_SCRYPT: ScryptParams = { N: 32768, r: 8, p: 1, dkLen: 32 };

const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;

/** The scrypt salt: one per platform and app id, so a DUID reused across apps gives other keys. */
export function backupSalt(platform: string, appId: string): string {
  return 'lablo.backup.v1|' + platform + '|' + appId;
}

/** The backup master key from the device secret (DUID, LGUDID or the backup code). */
export function deriveBackupMaster(deviceSecret: string, platform: string, appId: string, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  return scrypt(utf8(deviceSecret), utf8(backupSalt(platform, appId)), BACKUP_SCRYPT, onProgress);
}

export interface BackupKeys {
  /** Where the envelope lives (`/v1/backup/:lookupId`). */
  readonly lookupId: string;
  /** Sent as `X-Write-Token` to put or delete the envelope. */
  readonly writeToken: string;
  readonly encKey: Uint8Array;
  /** Derived and unused: ADR-013 keeps the credentials on the TV unencrypted at rest. */
  readonly localKey: Uint8Array;
}

export function backupKeys(master: Uint8Array): BackupKeys {
  if (master.length !== KEY_BYTES) throw new RangeError('the backup master is 32 bytes');
  return {
    lookupId: toBase64Url(hmacSha256(master, utf8('lookup'))),
    writeToken: toBase64Url(hmacSha256(master, utf8('write'))),
    encKey: hkdfSha256(master, utf8('enc')),
    localKey: hkdfSha256(master, utf8('local')),
  };
}

/**
 * What the server keeps of a 32-byte token (the backup's write token, pairing's poll token):
 * b64url(SHA-256(the token's bytes)). Null when `token` isn't 32 bytes in base64url.
 */
export function tokenHash(token: string): string | null {
  const bytes = fromBase64Url(token);
  if (bytes === null || bytes.length !== KEY_BYTES) return null;
  return toBase64Url(sha256(bytes));
}

export interface BackupEnvelope {
  readonly v: 1;
  readonly kdf: typeof BACKUP_KDF;
  /** 24 bytes, base64url. */
  readonly nonce: string;
  /** secretbox(plain, nonce, encKey), base64url. */
  readonly ct: string;
}

function checkKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new RangeError('a secretbox key is 32 bytes');
}

/** Seals `plain` with a fresh random nonce. `nonce` is for test vectors only: never reuse one. */
export function sealBackup(plain: Uint8Array, encKey: Uint8Array, nonce: Uint8Array = randomBytes(NONCE_BYTES)): BackupEnvelope {
  checkKey(encKey);
  if (nonce.length !== NONCE_BYTES) throw new RangeError('a secretbox nonce is 24 bytes');
  return { v: 1, kdf: BACKUP_KDF, nonce: toBase64Url(nonce), ct: toBase64Url(nacl.secretbox(plain, nonce, encKey)) };
}

/** The plaintext, or null when the envelope isn't one of ours or doesn't open with `encKey`. */
export function openBackup(envelope: BackupEnvelope, encKey: Uint8Array): Uint8Array | null {
  checkKey(encKey);
  if (envelope.v !== 1 || envelope.kdf !== BACKUP_KDF) return null;
  const nonce = fromBase64Url(envelope.nonce);
  const ct = fromBase64Url(envelope.ct);
  if (nonce === null || nonce.length !== NONCE_BYTES || ct === null || ct.length < TAG_BYTES) return null;
  return nacl.secretbox.open(ct, nonce, encKey);
}
