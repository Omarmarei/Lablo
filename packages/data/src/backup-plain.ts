/**
 * The backup's plaintext (architecture.md §3.3 B, RELAY step 32c1): the stored profile document's
 * JSON as UTF-8, gzipped (fflate, pure JS; `mtime` 0, so one document gives one byte string). The
 * whole document goes: the sources with their logins, the guides, the favourites, the places and
 * the settings. Everything else on the TV is derived from the providers and read again. A
 * phone-sent file source goes as its record is: by name, with no bytes.
 *
 * Sealing it is `@lablo/crypto`'s `sealBackup`; the backup worker (backup-service.ts) checks the
 * size before it seals.
 */
import { sha256, toBase64Url, utf8 } from '@lablo/crypto';
import { gunzipSync, gzipSync } from 'fflate';
import type { AnyProfile } from './profile';

/** The most a restored plaintext may inflate to (a profile is tens of KB; the gzip's trailer is read first). */
export const BACKUP_PLAIN_MAX_BYTES = 8 * 1024 * 1024;

/** The plaintext of a profile document's JSON text. */
export function backupPlain(json: string): Uint8Array {
  return gzipSync(utf8(json), { mtime: 0 });
}

/**
 * What tells one sent document from another (`kv` `backup.sent`): b64url(SHA-256(UTF-8 of its
 * JSON)). The same document, stored and read back, gives the same text and so the same hash.
 */
export function profileHash(json: string): string {
  return toBase64Url(sha256(utf8(json)));
}

/**
 * The document in an opened plaintext, or `null` when it isn't gzip, inflates past
 * `BACKUP_PLAIN_MAX_BYTES` (its trailer says how far, read before inflating), isn't UTF-8 or
 * JSON, or isn't an object with a whole version of 1 or more.
 */
export function readBackupPlain(bytes: Uint8Array): AnyProfile | null {
  const n = bytes.length;
  // The trailer's last four bytes: the plain length, little-endian (mod 2^32). (Too short a stream
  // reads as a small length here, and fflate refuses it.)
  const size = (bytes[n - 4]! | (bytes[n - 3]! << 8) | (bytes[n - 2]! << 16) | (bytes[n - 1]! << 24)) >>> 0;
  if (size > BACKUP_PLAIN_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    // fflate sizes its output by the trailer: never more than the cap.
    const plain = gunzipSync(bytes);
    if (plain.length !== size) return null;
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as unknown;
  } catch {
    return null;
  }
  // (A number, a string or an array has no `v` of its own.)
  const v = parsed === null ? undefined : (parsed as { v?: unknown }).v;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? (parsed as AnyProfile) : null;
}
