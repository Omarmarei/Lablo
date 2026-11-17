/**
 * The values every message is built from (architecture.md §3.2-3.4): base64url byte strings
 * (keys, nonces, tokens, ids, ciphertexts), epoch-millisecond times, the platforms, the app's
 * version, country codes.
 *
 * base64url here is exactly what `@lablo/crypto` writes and accepts: unpadded, `-` and `_`,
 * never a length of 4k + 1, and the last character's unused bits zero, so one byte string has
 * one spelling and ids compare as strings (test/protocol-crypto.test.ts holds the two packages
 * together). The patterns are regex literals (a `new RegExp` would pull core-js's RegExp
 * polyfill into a TV bundle), anchored, over fixed-width groups: linear time, no backtracking
 * blow-up on a 700 KB ciphertext.
 */
import * as z from 'zod/mini';

/** 16 bytes: 22 characters, the last carrying 2 bits (its low 4 bits zero). */
const BYTES_16 = /^[A-Za-z0-9_-]{21}[AQgw]$/;
/** 24 bytes: 32 characters, no unused bits. */
const BYTES_24 = /^[A-Za-z0-9_-]{32}$/;
/** 32 bytes: 43 characters, the last carrying 4 bits (its low 2 bits zero). */
const BYTES_32 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** 64 bytes: 86 characters, the last carrying 2 bits. */
const BYTES_64 = /^[A-Za-z0-9_-]{85}[AQgw]$/;
/** Any number of bytes: whole groups of 4 characters, then an optional strict tail of 3 or 2. */
const ANY_BYTES = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048]|[A-Za-z0-9_-][AQgw])?$/;

/** The characters of `bytes` bytes in unpadded base64url. */
export function base64UrlLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

/** Between `min` and `max` bytes as base64url (a ciphertext). */
export function base64UrlRange(min: number, max: number): z.ZodMiniString<string> {
  return z.string().check(z.minLength(base64UrlLength(min)), z.maxLength(base64UrlLength(max)), z.regex(ANY_BYTES));
}

/** A random 128-bit id (a pairing session, an install, an object key). */
export const bytes16 = z.string().check(z.regex(BYTES_16));
/** A box or secretbox nonce. */
export const nonce24 = z.string().check(z.regex(BYTES_24));
/** An X25519 or Ed25519 public key, a 32-byte token, a hash or a 32-byte id. */
export const bytes32 = z.string().check(z.regex(BYTES_32));
/** An Ed25519 signature. */
export const signature64 = z.string().check(z.regex(BYTES_64));

/** Poly1305's tag: the shortest `box` or `secretbox` ciphertext. */
export const MAC_BYTES = 16;

/** Milliseconds since 1970 (UTC), as `Date.now()` gives them. */
export const epochMs = z.int().check(z.gte(0));

export const PLATFORMS = ['tizen', 'webos'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const platform = z.enum(PLATFORMS);

/** The app's version: `major.minor.patch`, each at most three digits. */
export const appVersion = z.string().check(z.regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/));

/** An ISO 3166-1 alpha-2 country, upper case (`AE`, `SA`, `US`). */
export const country = z.string().check(z.regex(/^[A-Z]{2}$/));

/** An http(s) link as a person typed it: no whitespace; the TV normalises it (`normalizeLink`). */
export const link = z.string().check(z.maxLength(2048), z.regex(/^https?:\/\/\S+$/i));

/** Text a person typed: a name, a login. Never empty, never only spaces. */
export function text(max: number): z.ZodMiniString<string> {
  return z.string().check(z.maxLength(max), z.regex(/\S/));
}
