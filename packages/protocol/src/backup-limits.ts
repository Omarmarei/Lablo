/**
 * The backup API's limits and header (architecture.md §3.2, RELAY steps 32a and 32c1), in a
 * module of their own: no schema, so the TV's backup worker reads them without zod
 * (`@lablo/protocol/backup-limits`). backup.ts re-exports them for the server.
 */

/** The envelope's JSON body (§3.2: at most 512 KB). */
export const BACKUP_BODY_MAX_BYTES = 524288;
/** The ciphertext's bytes: the body less 1 KB for the envelope's other fields. */
export const BACKUP_CT_MAX_BYTES = Math.floor(((BACKUP_BODY_MAX_BYTES - 1024) * 3) / 4);

/** The KDF the master key came from: scrypt N = 2^15, r = 8, p = 1 (`BACKUP_KDF`). */
export const BACKUP_KDF_NAME = 'scrypt-15-8-1';

/** The request header that carries the write token on a PUT or a DELETE. */
export const BACKUP_WRITE_HEADER = 'x-write-token';
