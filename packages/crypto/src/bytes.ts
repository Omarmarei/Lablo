/**
 * Bytes and their wire form (architecture.md §3.3). Every key, nonce, token and ciphertext
 * crosses the wire as unpadded base64url (RFC 4648 §5). Decoding is strict, so each byte
 * string has exactly one spelling: a lookup id or a token hash compares as a string.
 *
 * Plain loops over char codes: this file runs on Chromium 53 (no `.split`, iterators or
 * spread, which would pull polyfills into the TV bundle).
 */
import { utf8ToBytes } from '@noble/hashes/utils.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The 6-bit value of a base64url character's code, or -1. */
function sextet(code: number): number {
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 71; // a-z: 26-51
  if (code >= 48 && code <= 57) return code + 4; // 0-9: 52-61
  if (code === 45) return 62; // -
  if (code === 95) return 63; // _
  return -1;
}

/** Unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET.charAt(v >>> 18) + ALPHABET.charAt((v >>> 12) & 63) + ALPHABET.charAt((v >>> 6) & 63) + ALPHABET.charAt(v & 63);
  }
  if (n - i === 1) {
    const v = bytes[i]! << 16;
    out += ALPHABET.charAt(v >>> 18) + ALPHABET.charAt((v >>> 12) & 63);
  } else if (n - i === 2) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET.charAt(v >>> 18) + ALPHABET.charAt((v >>> 12) & 63) + ALPHABET.charAt((v >>> 6) & 63);
  }
  return out;
}

/**
 * The bytes of an unpadded base64url string, or null when it isn't one: a character outside
 * the alphabet (padding `=` included), a length no byte string has (4k + 1), or unused bits
 * in the last character that aren't zero (a second spelling of the same bytes).
 */
export function fromBase64Url(text: string): Uint8Array | null {
  if (typeof text !== 'string') return null;
  const n = text.length;
  if (n % 4 === 1) return null;
  const out = new Uint8Array((n * 3) >> 2);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const v = sextet(text.charCodeAt(i));
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = acc >>> bits;
      acc &= (1 << bits) - 1;
    }
  }
  return acc === 0 ? out : null;
}

/** UTF-8 bytes of a string (the labels, salts and secrets the scheme names as text). */
export function utf8(text: string): Uint8Array {
  return utf8ToBytes(text);
}

/** `a` then `b`, as new bytes. */
export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
