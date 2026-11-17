/**
 * The hash functions of the scheme (architecture.md §3.3), from @noble/hashes: pure
 * JavaScript, so they run on Chromium 53 and on `file://`, where WebCrypto `subtle` may be
 * missing.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import type { ScryptOpts } from '@noble/hashes/scrypt.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(nobleSha256, key, data);
}

/**
 * HKDF-SHA256 (RFC 5869). Without a salt, HKDF's zero salt (32 zero bytes): the backup's
 * `encKey` and `localKey` come from a master that is already uniformly random.
 */
export function hkdfSha256(ikm: Uint8Array, info: Uint8Array, length = 32, salt?: Uint8Array): Uint8Array {
  return hkdf(nobleSha256, ikm, salt, info, length);
}

export interface ScryptParams {
  /** CPU and memory cost, a power of two. */
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly dkLen: number;
}

/**
 * scrypt (RFC 7914), giving the event loop a turn every 10 ms: the backup's N = 2^15 takes
 * seconds on a 2018 TV (in a worker there). `onProgress` gets the fraction done, 0 to 1.
 */
export function scrypt(password: Uint8Array, salt: Uint8Array, params: ScryptParams, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  const opts: ScryptOpts = { N: params.N, r: params.r, p: params.p, dkLen: params.dkLen, asyncTick: 10 };
  if (onProgress !== undefined) opts.onProgress = onProgress;
  return scryptAsync(password, salt, opts);
}
