/**
 * Pairing (architecture.md §3.2, §3.3 A): the TV registers its ephemeral X25519 key, the phone
 * boxes the source for it, the server keeps only ciphertext and hashes. Step 31 builds the
 * routes, the phone page and the TV's screen.
 *
 * `pairPayloadSchema` is the plain JSON inside the box: only the TV ever sees it.
 */
import * as z from 'zod/mini';
import { base64UrlLength, base64UrlRange, bytes16, bytes32, epochMs, link, MAC_BYTES, nonce24, text } from './wire';

/** The code a person types: 8 Crockford base32 characters (no I, L, O, U), about 40 bits. */
export const pairCode = z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{8}$/));

/** The boxed payload's plain JSON. A source is a few hundred bytes; links are at most 2 KB. */
export const PAIR_PAYLOAD_MAX_BYTES = 32768;
/** `POST /v1/pair/:code/payload`'s body. */
export const PAIR_BODY_MAX_BYTES = 65536;
/** An uploaded M3U file, encrypted (its 1 MiB frames each add a 16-byte tag). */
export const PAIR_FILE_MAX_BYTES = 41943040;
/** EPG links a payload may carry. */
export const PAIR_EPG_MAX = 4;

/**
 * Why the TV shows a code (RELAY step 38c4): to `add` a source, or to `check` a login against the
 * sources it has (the PIN's check). The phone page words its form and its result by it.
 */
export const PAIR_PURPOSES = ['add', 'check'] as const;
export type PairPurpose = (typeof PAIR_PURPOSES)[number];

/** `POST /v1/pair`; no `purpose` is an add (the TV writes it only for a check). */
export const pairCreateRequestSchema = z.object({ tvPk: bytes32, purpose: z.optional(z.enum(PAIR_PURPOSES)) });
export type PairCreateRequest = z.infer<typeof pairCreateRequestSchema>;

export const pairCreateResponseSchema = z.object({
  sid: bytes16,
  code: pairCode,
  pollToken: bytes32,
  exp: epochMs,
});
export type PairCreateResponse = z.infer<typeof pairCreateResponseSchema>;

/** `GET /v1/pair/:code` (the typed-code path: the QR code carries `tvPk` and a check's purpose itself). */
export const pairTvKeyResponseSchema = z.object({ tvPk: bytes32, exp: epochMs, purpose: z.enum(PAIR_PURPOSES) });
export type PairTvKeyResponse = z.infer<typeof pairTvKeyResponseSchema>;

/** `POST /v1/pair/:code/payload`, and what the TV's poll returns: `@lablo/crypto`'s `SealedPayload`. */
export const sealedPayloadSchema = z.object({
  phonePk: bytes32,
  nonce: nonce24,
  ct: base64UrlRange(MAC_BYTES, PAIR_PAYLOAD_MAX_BYTES + MAC_BYTES),
});
export type SealedPayloadWire = z.infer<typeof sealedPayloadSchema>;

/** `POST /v1/pair/:code/upload-url`: the encrypted file's exact length. */
export const pairUploadRequestSchema = z.object({
  size: z.int().check(z.gte(MAC_BYTES), z.lte(PAIR_FILE_MAX_BYTES)),
});
export type PairUploadRequest = z.infer<typeof pairUploadRequestSchema>;

/**
 * A presigned URL for the session's file: R2's own, always https; or, in development and tests,
 * the memory store's path on the API's own origin (RELAY step 31d1), which the phone page and the
 * TV resolve against the API's address. The path's characters are the blob key's and the query's
 * only: no dots, nothing to unescape, and it can't start like `//host`. The route answers 404 on
 * Vercel.
 */
export const presignedUrlSchema = z.string().check(z.maxLength(4096), z.regex(/^(?:https:\/\/\S+|\/dev\/blob\/[A-Za-z0-9_-][A-Za-z0-9_/-]*\?[A-Za-z0-9_=&-]+)$/));

const presignedFile = {
  url: presignedUrlSchema,
  key: bytes16,
  exp: epochMs,
};

/** The presigned PUT and the object's key (the key goes into the boxed payload). */
export const pairUploadResponseSchema = z.object(presignedFile);
export type PairUploadResponse = z.infer<typeof pairUploadResponseSchema>;

/** `GET /v1/pair/s/:sid/file` (RELAY step 31a): the presigned GET of the file the phone uploaded. */
export const pairFileUrlResponseSchema = z.object(presignedFile);
export type PairFileUrlResponse = z.infer<typeof pairFileUrlResponseSchema>;

/** `GET /v1/pair/s/:sid`, every 2 s: nothing yet, or the payload (deleted on this read). */
export const pairPollResponseSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('waiting'), exp: epochMs }),
  z.object({ state: z.literal('ready'), payload: sealedPayloadSchema }),
]);
export type PairPollResponse = z.infer<typeof pairPollResponseSchema>;

/**
 * What the TV found when it tried the source: only the category reaches the phone. A check's two
 * (step 38c4): the login is one of the TV's sources' (`match`), or not (`no_match`).
 */
export const PAIR_STATUSES = ['ok', 'auth_failed', 'expired', 'unreachable', 'blocked', 'match', 'no_match'] as const;
export type PairStatus = (typeof PAIR_STATUSES)[number];

/** A check's statuses (step 38c4); every other status is an add's. */
export const PAIR_CHECK_STATUSES: readonly PairStatus[] = ['match', 'no_match'];

/** Whether `status` answers a session of `purpose`: a check's two for a check, the others for an add. */
export function pairStatusFits(purpose: PairPurpose, status: PairStatus): boolean {
  return (PAIR_CHECK_STATUSES.indexOf(status) !== -1) === (purpose === 'check');
}

/** `POST /v1/pair/s/:sid/status`. */
export const pairStatusRequestSchema = z.object({ status: z.enum(PAIR_STATUSES) });
export type PairStatusRequest = z.infer<typeof pairStatusRequestSchema>;

/**
 * `GET /v1/pair/:code/status` and `POST /v1/pair/:code/payload`'s answer (RELAY step 31a): how
 * far the phone's payload got. `open` until it is sent (the code works until `exp`), `sent` until
 * the TV reads it, `received` until the TV reports, then `done` with the TV's category.
 */
export const pairProgressResponseSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('open'), exp: epochMs }),
  z.object({ state: z.literal('sent') }),
  z.object({ state: z.literal('received') }),
  z.object({ state: z.literal('done'), status: z.enum(PAIR_STATUSES) }),
]);
export type PairProgressResponse = z.infer<typeof pairProgressResponseSchema>;

/** The M3U file the phone encrypted and uploaded: what the TV needs to fetch and open it. */
export const pairFileSchema = z.object({
  /** The R2 object's key (`pairUploadResponseSchema.key`). */
  key: bytes16,
  /** The `secretbox` key of the file's frames. */
  fileKey: bytes32,
  /** Frame i's nonce is this plus i (`@lablo/crypto`'s `frameNonce`). */
  base: nonce24,
  /** The plain file's length: `openFile` checks the whole ciphertext against it. */
  size: z.int().check(z.gte(1), z.lte(PAIR_FILE_MAX_BYTES)),
});
export type PairFile = z.infer<typeof pairFileSchema>;

/** The source, as the phone page's forms give it (the TV form's fields, architecture.md §3.3 A). */
export const pairSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('xtream'), server: link, username: text(256), password: text(256) }),
  z.object({ type: z.literal('m3u'), url: link }),
  z.object({ type: z.literal('m3u-file'), file: pairFileSchema }),
]);
export type PairSource = z.infer<typeof pairSourceSchema>;

export const pairPayloadSchema = z.object({
  v: z.literal(1),
  source: pairSourceSchema,
  name: z.optional(text(80)),
  epg: z.optional(z.array(link).check(z.maxLength(PAIR_EPG_MAX))),
});
export type PairPayload = z.infer<typeof pairPayloadSchema>;

/** The longest `ct` a payload's body can carry, in characters. */
export const PAIR_CT_MAX_CHARS = base64UrlLength(PAIR_PAYLOAD_MAX_BYTES + MAC_BYTES);
