/**
 * Telemetry's limits, kinds and buckets (architecture.md §3.4, RELAY step 33b1), in a module of
 * their own: no schema, so the TV's main bundle and its telemetry worker read them without zod
 * (`@lablo/protocol/telemetry-buckets`). telemetry.ts re-exports them for the server.
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
