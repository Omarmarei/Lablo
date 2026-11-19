/**
 * Telemetry's limits, kinds and buckets (architecture.md §3.4, RELAY step 33b1), and the
 * diagnostics report's (step 33d1), in a module of their own: no schema, so the TV's main bundle
 * and its telemetry worker read them without zod (`@lablo/protocol/telemetry-buckets`).
 * telemetry.ts and diag.ts re-export them for the server.
 */

/** The request body (§3.2). */
export const TELEMETRY_BODY_MAX_BYTES = 65536;
export const TELEMETRY_BATCH_MAX = 200;

export const TELEMETRY_KINDS = ['app_start', 'ingest_done', 'play_result', 'stall', 'epg_match', 'capability', 'crash'] as const;
export type TelemetryKind = (typeof TELEMETRY_KINDS)[number];

/** A count's order of magnitude: `'0'`, `'1+'`, `'10+'` up to `'1M+'`. */
export const COUNT_BUCKETS = ['0', '1+', '10+', '100+', '1k+', '10k+', '100k+', '1M+'] as const;
export type CountBucket = (typeof COUNT_BUCKETS)[number];

/** The bucket of a count of items or bytes (negative and non-numbers count as 0). */
export function countBucket(count: number): CountBucket {
  let bucket = 0;
  for (let limit = 1; bucket < COUNT_BUCKETS.length - 1 && count >= limit; limit *= 10) bucket++;
  return COUNT_BUCKETS[bucket]!;
}

/** A share in percent: none, four quarters (the last stopping short of all), all. */
export const RATE_BUCKETS = ['0', '1-24', '25-49', '50-74', '75-99', '100'] as const;
export type RateBucket = (typeof RATE_BUCKETS)[number];

/** The bucket of `part` out of `whole` (0 when `whole` is 0). */
export function rateBucket(part: number, whole: number): RateBucket {
  if (!(whole > 0) || !(part > 0)) return '0';
  if (part >= whole) return '100';
  const percent = (part * 100) / whole;
  if (percent < 25) return '1-24';
  if (percent < 50) return '25-49';
  if (percent < 75) return '50-74';
  return '75-99';
}

/** A time since something, coarse: under an hour, then hours and days. */
export const AGE_BUCKETS = ['<1h', '1h+', '6h+', '1d+', '3d+', '7d+', '30d+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

const HOUR_MS = 3_600_000;
/** Where each bucket after `<1h` starts, in hours. */
const AGE_STARTS_H = [1, 6, 24, 72, 168, 720];

/** The bucket of an age in milliseconds (a negative age, a clock moved back, and a non-number read `<1h`). */
export function ageBucket(ms: number): AgeBucket {
  let bucket = 0;
  while (bucket < AGE_STARTS_H.length && ms >= AGE_STARTS_H[bucket]! * HOUR_MS) bucket++;
  return AGE_BUCKETS[bucket]!;
}

/** The diagnostics report's request body (RELAY step 33d1), and its lists' lengths. */
export const DIAG_BODY_MAX_BYTES = 32768;
export const DIAG_SOURCES_MAX = 10;
export const DIAG_GUIDES_MAX = 10;
export const DIAG_EVENTS_MAX = 10;
