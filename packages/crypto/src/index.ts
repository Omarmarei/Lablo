/**
 * @lablo/crypto: tweetnacl and @noble/hashes wrappers: envelopes, KDFs, Ed25519 verify.
 * Shared by the TV app, the phone page and the backend (architecture.md §3.3).
 *
 * Bytes in, bytes out; base64url on the wire. Both libraries are pure JavaScript, so this runs
 * on Chromium 53 and on `file://` (RELAY step 29b1: the shared vectors in
 * `test/vectors.json` pass in Node and in the old engines, in a page and in a Blob worker).
 * It imports nothing internal (CLAUDE.md, "Package boundaries").
 */
export { concatBytes, fromBase64Url, toBase64Url, utf8 } from './bytes';
export type { ScryptParams } from './hash';
export { hkdfSha256, hmacSha256, scrypt, sha256 } from './hash';
export { randomBytes } from './random';
export type { BackupEnvelope, BackupKeys } from './backup';
export { BACKUP_KDF, BACKUP_SCRYPT, backupKeys, backupSalt, deriveBackupMaster, openBackup, sealBackup, tokenHash } from './backup';
export { BACKUP_CODE_BYTES, BACKUP_CODE_LENGTH, backupCodeText, readBackupCode } from './backup-code';
export type { BoxKeyPair, SealedPayload } from './pairing';
export {
  FILE_FRAME_BYTES,
  FILE_FRAME_OVERHEAD,
  boxKeyPairFromSecretKey,
  fileCipherLength,
  fileFrameCount,
  frameNonce,
  newBoxKeyPair,
  newFileKey,
  newFileNonceBase,
  openFile,
  openFileFrame,
  openPairPayload,
  sealFile,
  sealFileFrame,
  sealPairPayload,
} from './pairing';
export type { SignKeyPair } from './sign';
export { signDetached, signKeyPairFromSeed, verifySignature } from './sign';
export { blocklistHash } from './blocklist';
export { pinHash } from './pin';
