/**
 * Telemetry (architecture.md §3.4): `POST /v1/telemetry` takes a batch of events from one
 * install. Never a URL, a host, a channel or VOD name, a login or an IP address: counts go in
 * as buckets, codes as short tokens, free text only where a crash needs it (step 33 scrubs it
 * on the TV and again on the server). Step 33 builds the sending, the route and the scrubber.
 *
 * The server checks each event on its own (`readTelemetryEvents`): an event it can't read,
 * from a newer app say, is dropped without losing the rest of the batch, and fields it
 * doesn't know are dropped from the ones it keeps.
 */
import * as z from 'zod/mini';
import { COUNT_BUCKETS, RATE_BUCKETS, TELEMETRY_BATCH_MAX } from './telemetry-buckets';
import { appVersion, bytes16, epochMs, platform } from './wire';

// The limits, kinds and buckets are schema-free (step 33b1: the TV reads them without zod).
export { COUNT_BUCKETS, countBucket, RATE_BUCKETS, rateBucket, TELEMETRY_BATCH_MAX, TELEMETRY_BODY_MAX_BYTES, TELEMETRY_KINDS } from './telemetry-buckets';
export type { CountBucket, RateBucket, TelemetryKind } from './telemetry-buckets';

const countBucketSchema = z.enum(COUNT_BUCKETS);
const ms = z.int().check(z.gte(0), z.lte(3600000));
/** An engine's or the watchdog's own code (`MEDIA_ERR_NETWORK`, `FROZEN`): a token, never a URL. */
const errorCode = z.string().check(z.regex(/^[A-Za-z0-9_.-]{1,64}$/));
/** A TV's model or firmware as the platform names it: letters, digits and a few marks, no `:` or `/`. */
const deviceName = z.string().check(z.regex(/^[A-Za-z0-9 ._()+-]{1,64}$/));

export const telemetryEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('app_start'),
    at: epochMs,
    tier: z.enum(['low', 'full']),
    coldStartMs: ms,
    /** The items in the catalogs. */
    catalog: countBucketSchema,
  }),
  z.object({
    kind: z.literal('ingest_done'),
    at: epochMs,
    source: z.enum(['xtream', 'm3u', 'epg']),
    ms,
    bytes: countBucketSchema,
    items: countBucketSchema,
  }),
  z.object({
    kind: z.literal('play_result'),
    at: epochMs,
    engine: z.enum(['avplay', 'html5', 'mse']),
    container: z.enum(['ts', 'hls', 'mp4', 'mkv', 'other']),
    mode: z.enum(['live', 'vod', 'catchup']),
    /** Time to the first frame; null when nothing played. */
    ttffMs: z.nullable(ms),
    error: z.nullable(
      z.object({
        kind: z.enum(['network', 'http', 'timeout', 'stall', 'unsupported', 'decode', 'app']),
        code: errorCode,
        status: z.optional(z.int().check(z.gte(100), z.lte(599))),
      }),
    ),
  }),
  z.object({
    kind: z.literal('stall'),
    at: epochMs,
    recovered: z.boolean(),
    attempts: z.int().check(z.gte(0), z.lte(100)),
  }),
  z.object({
    kind: z.literal('epg_match'),
    at: epochMs,
    /** The share of channels with a guide. */
    rate: z.enum(RATE_BUCKETS),
  }),
  z.object({
    kind: z.literal('capability'),
    at: epochMs,
    model: deviceName,
    firmware: deviceName,
    /** The engine's Chromium major version; null when the user agent doesn't say. */
    chromium: z.nullable(z.int().check(z.gte(1), z.lte(999))),
    /** Feature probes as the spikes ran them: a name and a yes/no or a number. */
    probes: z.record(z.string().check(z.regex(/^[a-zA-Z0-9_.]{1,48}$/)), z.union([z.boolean(), z.number()])),
  }),
  z.object({
    kind: z.literal('crash'),
    at: epochMs,
    where: z.enum(['main', 'worker']),
    /** The scrubbed message and stack (step 33's scrubber removes URLs and logins first). */
    stack: z.string().check(z.maxLength(4000)),
  }),
]);
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/** The batch's envelope: who sent it; the events are read one by one (`readTelemetryEvents`). */
export const telemetryBatchSchema = z.object({
  /** A random id the app makes on first start: a wipe gives a new one. */
  installId: bytes16,
  platform,
  appVersion,
  events: z.array(z.unknown()).check(z.minLength(1), z.maxLength(TELEMETRY_BATCH_MAX)),
});
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;

/** The events the server can read, each stripped to its schema, and how many it dropped. */
export function readTelemetryEvents(events: readonly unknown[]): { readonly events: TelemetryEvent[]; readonly dropped: number } {
  const kept: TelemetryEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const parsed = telemetryEventSchema.safeParse(events[i]);
    if (parsed.success) kept.push(parsed.data);
  }
  return { events: kept, dropped: events.length - kept.length };
}
