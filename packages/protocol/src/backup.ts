/**
 * The encrypted backup (architecture.md §3.2, §3.3 B): `PUT/GET/DELETE /v1/backup/:lookupId`
 * carry the envelope `@lablo/crypto`'s `sealBackup` makes; `X-Write-Token` guards PUT and
 * DELETE. Step 32 builds the routes and the restore.
 */
import * as z from 'zod/mini';
import { base64UrlLength, base64UrlRange, bytes32, MAC_BYTES, nonce24 } from './wire';

/** The envelope's JSON body (§3.2: at most 512 KB). */
export const BACKUP_BODY_MAX_BYTES = 524288;
/** The ciphertext's bytes: the body less 1 KB for the envelope's other fields. */
export const BACKUP_CT_MAX_BYTES = Math.floor(((BACKUP_BODY_MAX_BYTES - 1024) * 3) / 4);

/** The KDF the master key came from: scrypt N = 2^15, r = 8, p = 1 (`BACKUP_KDF`). */
export const BACKUP_KDF_NAME = 'scrypt-15-8-1';

export const backupEnvelopeSchema = z.object({
  v: z.literal(1),
  kdf: z.literal(BACKUP_KDF_NAME),
  nonce: nonce24,
  ct: base64UrlRange(MAC_BYTES, BACKUP_CT_MAX_BYTES),
});
export type BackupEnvelopeWire = z.infer<typeof backupEnvelopeSchema>;

/** The path's `:lookupId`: b64url(HMAC-SHA256(master, "lookup")). */
export const lookupIdSchema = bytes32;
/** `X-Write-Token`: b64url(HMAC-SHA256(master, "write")). */
export const writeTokenSchema = bytes32;

/** The longest `ct` an envelope can carry, in characters. */
export const BACKUP_CT_MAX_CHARS = base64UrlLength(BACKUP_CT_MAX_BYTES);
