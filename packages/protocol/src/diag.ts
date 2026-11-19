/**
 * The diagnostics report (architecture.md §3.4, RELAY step 33d): what the TV sends when the user
 * asks for it in Settings ("Send a report to support"), and the 6-character code the API answers,
 * which the user gives to support.
 *
 * **Nothing in it names anything.** No URL, host, address, channel or VOD name, login, and no ID:
 * counts and ages go in as buckets, states and codes as short tokens, the device as telemetry's
 * `capability` names it, and the session's last plays, stalls and crashes as telemetry's own
 * events (a crash's stack is scrubbed on the TV and again on the server). Without an ID a report
 * can't be tied to telemetry rows or to the same TV's other reports: support finds it by its code.
 */
import * as z from 'zod/mini';
import { AGE_BUCKETS, DIAG_EVENTS_MAX, DIAG_GUIDES_MAX, DIAG_SOURCES_MAX } from './telemetry-buckets';
import { chromium, countBucketSchema, deviceName, errorCode, httpStatus, probes, rateBucketSchema, telemetryEventSchema, tier } from './telemetry';
import { appVersion, epochMs, platform } from './wire';

// The limits and the age buckets are schema-free (the TV's telemetry worker builds a report without zod).
export { AGE_BUCKETS, ageBucket, DIAG_BODY_MAX_BYTES, DIAG_EVENTS_MAX, DIAG_GUIDES_MAX, DIAG_SOURCES_MAX } from './telemetry-buckets';
export type { AgeBucket } from './telemetry-buckets';

/** The support code: 6 characters of Crockford's base32 (no I, L, O, U), 30 bits. */
export const diagCode = z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{6}$/));

const ageBucketSchema = z.enum(AGE_BUCKETS);

/** A source, in the user's order: never its name, link, server or login. */
export const diagSourceSchema = z.object({
  type: z.enum(['xtream', 'm3u', 'm3u-file']),
  /** Its catalog's items, every kind. */
  items: countBucketSchema,
  /** Since its catalog was last checked; null: never. */
  checked: z.nullable(ageBucketSchema),
  /** A backup without logins brought it back without its login (Xtream) or link (M3U). */
  needs: z.nullable(z.enum(['login', 'link'])),
});
export type DiagSource = z.infer<typeof diagSourceSchema>;

/** A guide, in rank order: never its link or its channels. */
export const diagGuideSchema = z.object({
  /** The programmes it read for the channels it feeds. */
  programmes: countBucketSchema,
  /** The share of the live channels it may match that it does. */
  matched: rateBucketSchema,
  /** Since it was last checked; null: never. */
  checked: z.nullable(ageBucketSchema),
  /** Why its last refresh failed (the ingest's code, its HTTP status); null: it didn't. */
  failure: z.nullable(z.object({ code: errorCode, status: z.nullable(httpStatus) })),
});
export type DiagGuide = z.infer<typeof diagGuideSchema>;

export const diagReportSchema = z.object({
  v: z.literal(1),
  /** The TV's clock: against the row's `createdAt`, how far off it is. */
  at: epochMs,
  /** The TV's offset from UTC in minutes (east positive). */
  zoneMin: z.int().check(z.gte(-840), z.lte(840)),
  locale: z.enum(['en', 'ar']),
  tier,
  model: deviceName,
  firmware: deviceName,
  chromium,
  probes,
  /** Telemetry's switch. */
  telemetry: z.boolean(),
  /** Where the config's policy came from: fetched this session, the cached copy, or none (the defaults). */
  config: z.enum(['fresh', 'cached', 'none']),
  sources: z.array(diagSourceSchema).check(z.maxLength(DIAG_SOURCES_MAX)),
  guides: z.array(diagGuideSchema).check(z.maxLength(DIAG_GUIDES_MAX)),
  /** The session's last plays, stalls and crashes, oldest first. */
  events: z.array(telemetryEventSchema).check(z.maxLength(DIAG_EVENTS_MAX)),
});
export type DiagReport = z.infer<typeof diagReportSchema>;

/** `POST /v1/diag`'s body. */
export const diagRequestSchema = z.object({
  platform,
  appVersion,
  report: diagReportSchema,
});
export type DiagRequest = z.infer<typeof diagRequestSchema>;

/** `POST /v1/diag`'s answer (201). */
export const diagResponseSchema = z.object({ code: diagCode });
export type DiagResponse = z.infer<typeof diagResponseSchema>;
