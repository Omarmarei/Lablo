/**
 * The signed config (architecture.md §3.3 C): `tools/sign-config` signs the doc's exact text
 * with the offline Ed25519 key, `GET /v1/config` serves the text, its signature and the
 * request's country, and the app checks the signature (against either embedded key) before it
 * parses the text with `configDocSchema`. Step 30 builds the signing and the enforcement.
 *
 * Unknown fields are dropped, so a newer doc can add fields old apps ignore. A change an old
 * app must not misread (a new kill mode, a field with a new meaning) needs a new `v`, which
 * old apps refuse, keeping their cached copy.
 */
import * as z from 'zod/mini';
import { appVersion, bytes32, country, epochMs, platform, signature64, text } from './wire';

/** The doc's text: the config is small (the blocklist is hashes, about 45 bytes each). */
export const CONFIG_DOC_MAX_CHARS = 1048576;
/** Blocklist entries. */
export const BLOCKLIST_MAX = 20000;

export const KILL_MODES = ['notice', 'block-new-sources', 'disable-playback', 'disable-app'] as const;
export type KillMode = (typeof KILL_MODES)[number];

/** Versions from `min` to `max`, both included; a missing end is open. */
export const versionRange = z.object({
  min: z.optional(appVersion),
  max: z.optional(appVersion),
});

/** What the user reads: both languages, from the doc (no catalog key can name new text). */
export const configMessage = z.object({
  en: text(400),
  ar: text(400),
});

/** A rule matches when every condition it has holds; one with no conditions matches everyone. */
export const killRule = z.object({
  /** A stable name, so the app shows a notice once. */
  id: z.string().check(z.regex(/^[a-z0-9-]{1,40}$/)),
  match: z.object({
    platform: z.optional(platform),
    versions: z.optional(versionRange),
    countries: z.optional(z.array(country).check(z.minLength(1), z.maxLength(250))),
  }),
  mode: z.enum(KILL_MODES),
  message: z.optional(configMessage),
});

/** Feature flags and tuning (the app's own defaults apply to whatever is missing). */
export const tunables = z.object({
  liveBufferSeconds: z.optional(z.number().check(z.gte(0), z.lte(60))),
  vodBufferSeconds: z.optional(z.number().check(z.gte(0), z.lte(120))),
  openTimeoutMs: z.optional(z.int().check(z.gte(1000), z.lte(120000))),
  stallTimeoutMs: z.optional(z.int().check(z.gte(1000), z.lte(120000))),
  epgDaysBack: z.optional(z.int().check(z.gte(0), z.lte(14))),
  epgDaysAhead: z.optional(z.int().check(z.gte(0), z.lte(14))),
  /** Per telemetry event kind, the share of installs that send it (0 to 1). */
  telemetrySampling: z.optional(z.record(z.string().check(z.regex(/^[a-z_]{1,32}$/)), z.number().check(z.gte(0), z.lte(1)))),
});

export const configDocSchema = z
  .object({
    v: z.literal(1),
    issuedAt: epochMs,
    expiresAt: epochMs,
    minVersion: z.object({ tizen: z.optional(appVersion), webos: z.optional(appVersion) }),
    kill: z.array(killRule).check(z.maxLength(100)),
    blocklist: z.object({
      salt: z.string().check(z.regex(/^[A-Za-z0-9_-]{16,64}$/)),
      /** `blocklistHash(salt, host)` of each blocked host: 32 bytes, base64url. */
      hashes: z.array(bytes32).check(z.maxLength(BLOCKLIST_MAX)),
    }),
    flags: z.record(z.string().check(z.regex(/^[a-z][A-Za-z0-9]{0,39}$/)), z.boolean()),
    tunables,
  })
  .check(
    z.refine((doc) => doc.expiresAt > doc.issuedAt, { message: 'expiresAt must be after issuedAt', path: ['expiresAt'] }),
  );
export type ConfigDoc = z.infer<typeof configDocSchema>;

/** The doc's exact signed text and its Ed25519 signature. */
export const signedConfigSchema = z.object({
  doc: z.string().check(z.minLength(2), z.maxLength(CONFIG_DOC_MAX_CHARS)),
  sig: signature64,
});
export type SignedConfig = z.infer<typeof signedConfigSchema>;

/** `GET /v1/config`: the signed doc and the country from the request's geo header (unsigned). */
export const configResponseSchema = z.extend(signedConfigSchema, {
  country: z.nullable(country),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
