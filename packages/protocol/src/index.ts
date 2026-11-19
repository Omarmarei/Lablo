/**
 * @lablo/protocol: the zod schemas and types the TV app and the backend share (architecture.md
 * §3.2-3.4). Built on `zod/mini`, whose functions tree-shake, so a TV bundle carries only the
 * schemas it uses; RELAY step 29b2a proved them on Chromium 53, 56 and 68 (the samples run by
 * the vectors page, `@lablo/protocol/check-samples`).
 *
 * Imports nothing internal (CLAUDE.md "Package boundaries").
 */
export {
  appVersion,
  base64UrlLength,
  base64UrlRange,
  bytes16,
  bytes32,
  country,
  epochMs,
  link,
  MAC_BYTES,
  nonce24,
  platform,
  PLATFORMS,
  signature64,
  text,
} from './wire';
export type { Platform } from './wire';

export {
  BLOCKLIST_MAX,
  CONFIG_DOC_MAX_CHARS,
  configDocSchema,
  configMessage,
  configResponseSchema,
  KILL_MODES,
  killRule,
  signedConfigSchema,
  tunables,
  versionRange,
} from './config';
export type { ConfigDoc, ConfigResponse, KillMode, SignedConfig } from './config';

export {
  pairCode,
  pairCreateRequestSchema,
  pairCreateResponseSchema,
  PAIR_BODY_MAX_BYTES,
  PAIR_CT_MAX_CHARS,
  PAIR_EPG_MAX,
  PAIR_FILE_MAX_BYTES,
  PAIR_PAYLOAD_MAX_BYTES,
  PAIR_STATUSES,
  pairFileSchema,
  pairFileUrlResponseSchema,
  pairPayloadSchema,
  pairPollResponseSchema,
  pairProgressResponseSchema,
  pairSourceSchema,
  pairStatusRequestSchema,
  pairTvKeyResponseSchema,
  pairUploadRequestSchema,
  pairUploadResponseSchema,
  presignedUrlSchema,
  sealedPayloadSchema,
} from './pairing';
export type {
  PairCreateRequest,
  PairCreateResponse,
  PairFile,
  PairFileUrlResponse,
  PairPayload,
  PairPollResponse,
  PairProgressResponse,
  PairSource,
  PairStatus,
  PairStatusRequest,
  PairTvKeyResponse,
  PairUploadRequest,
  PairUploadResponse,
  SealedPayloadWire,
} from './pairing';

export { BACKUP_BODY_MAX_BYTES, BACKUP_CT_MAX_BYTES, BACKUP_CT_MAX_CHARS, BACKUP_KDF_NAME, BACKUP_WRITE_HEADER, backupEnvelopeSchema, lookupIdSchema, writeTokenSchema } from './backup';
export type { BackupEnvelopeWire } from './backup';

export {
  COUNT_BUCKETS,
  countBucket,
  RATE_BUCKETS,
  rateBucket,
  readTelemetryEvents,
  TELEMETRY_BATCH_MAX,
  TELEMETRY_BODY_MAX_BYTES,
  TELEMETRY_KINDS,
  telemetryBatchSchema,
  telemetryEventSchema,
} from './telemetry';
export type { CountBucket, RateBucket, TelemetryBatch, TelemetryEvent, TelemetryKind } from './telemetry';

export { isTld, KNOWN_MIN_CHARS, SCRUB_INPUT_MAX_CHARS, SCRUB_MAX_CHARS, scrubText, TLDS } from './scrub';
