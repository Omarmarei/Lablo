/**
 * The encrypted backup (architecture.md §3.2, §3.3 B): `PUT/GET/DELETE /v1/backup/:lookupId`
 * carry the envelope `@lablo/crypto`'s `sealBackup` makes; `X-Write-Token` guards PUT and
 * DELETE. Step 32 builds the routes and the restore.
 */
import * as z from 'zod/mini';
import { BACKUP_CT_MAX_BYTES, BACKUP_KDF_NAME } from './backup-limits';
import { base64UrlLength, base64UrlRange, bytes32, MAC_BYTES, nonce24 } from './wire';

// The limits and the header live in a schema-free module the TV's backup worker reads (step 32c1).
export { BACKUP_BODY_MAX_BYTES, BACKUP_CT_MAX_BYTES, BACKUP_KDF_NAME, BACKUP_WRITE_HEADER } from './backup-limits';

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
