/**
 * Telemetry (architecture.md §3.2 and §3.4; RELAY step 33a): `POST /v1/telemetry` takes a batch
 * of events from one install and keeps each event the protocol can read as one row.
 *
 * **It keeps only what the schema keeps.** Never a URL, a host, a channel or VOD name, a login or
 * an IP address:
 * - each event is read on its own (`readTelemetryEvents`): one the server can't read, from a newer
 *   app say, is dropped and counted, and fields it doesn't know are stripped from the rest;
 * - a crash's stack, the one free text, is scrubbed again here (`scrubText`; the TV scrubbed it
 *   first, with the user's own logins, which the server never knows);
 * - the caller's address is used only for the rate limit, through `rateKey`.
 *
 * Rows live `TELEMETRY_TTL_MS` (90 days, §3.2 "Retention"); each post sweeps a bounded number of
 * older ones first. Every answer carries the TV's CORS and `no-store`.
 */
import type { TelemetryEvent } from '@lablo/protocol';
import { readTelemetryEvents, scrubText, TELEMETRY_BODY_MAX_BYTES, telemetryBatchSchema } from '@lablo/protocol';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { db } from './db';
import { errorKind } from './health';
import { apiError, clientIp, json, readBody, TV_CORS } from './http';
import type { RateLimiter, RateRule } from './rate-limit';
import { rateKey, retryAfterSeconds } from './rate-limit';
import { services } from './services';

/** How long an event is kept after it was received: 90 days. */
export const TELEMETRY_TTL_MS = 90 * 86_400_000;
/** How many old events one post may sweep. */
export const TELEMETRY_SWEEP_MAX = 1000;

/**
 * The rate limit per caller. A TV sends at most every 15 minutes and when it is hidden; several
 * TVs may share one address.
 */
export const TELEMETRY_LIMIT: { readonly scope: string; readonly rule: RateRule } = { scope: 'telemetry', rule: { limit: 60, windowMs: 600_000 } };

export interface TelemetryDeps {
  readonly db: () => PrismaClient;
  readonly limiter: RateLimiter;
  readonly rateSecret: string;
  readonly now: () => number;
}

/** What a row's `data` keeps of an event: its fields but `kind` and `at`, a crash's stack scrubbed. */
export function eventData(event: TelemetryEvent): Prisma.InputJsonObject {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(event)) {
    if (key !== 'kind' && key !== 'at') data[key] = (event as unknown as Record<string, unknown>)[key];
  }
  if (event.kind === 'crash') data.stack = scrubText(event.stack);
  return data as Prisma.InputJsonObject;
}

/**
 * Deletes at most `max` events received `TELEMETRY_TTL_MS` or more ago, the oldest first. How many
 * went.
 */
export async function sweepTelemetry(deps: TelemetryDeps, now: number, max: number = TELEMETRY_SWEEP_MAX): Promise<number> {
  const cutoff = new Date(now - TELEMETRY_TTL_MS);
  return deps.db().$executeRaw`
    DELETE FROM "TelemetryEvent" WHERE "id" IN (
      SELECT "id" FROM "TelemetryEvent" WHERE "receivedAt" <= ${cutoff} ORDER BY "receivedAt", "id" LIMIT ${max}
    )`;
}

/** `POST /v1/telemetry`: the batch's readable events, one row each. */
export async function postTelemetry(deps: TelemetryDeps, request: Request): Promise<Response> {
  const decision = await deps.limiter.limit(rateKey(TELEMETRY_LIMIT.scope, clientIp(request.headers), deps.rateSecret), TELEMETRY_LIMIT.rule);
  if (!decision.ok) return apiError(429, 'rate_limited', { ...TV_CORS, 'retry-after': retryAfterSeconds(decision) });
  const body = await readBody(request, TELEMETRY_BODY_MAX_BYTES, telemetryBatchSchema, TV_CORS);
  if (!body.ok) return body.response;
  const { installId, platform, appVersion } = body.value;
  const { events, dropped } = readTelemetryEvents(body.value.events);
  const now = deps.now();
  await sweepTelemetry(deps, now);
  if (events.length > 0) {
    const receivedAt = new Date(now);
    await deps.db().telemetryEvent.createMany({
      data: events.map((event) => ({ installId, kind: event.kind, platform, appVersion, data: eventData(event), at: new Date(event.at), receivedAt })),
    });
  }
  return json({ state: 'stored', stored: events.length, dropped }, 200, TV_CORS);
}

/** The process's dependencies: the database when asked, the services and the clock. */
export function telemetryDeps(): TelemetryDeps {
  const { limiter, rateSecret } = services();
  return { db, limiter, rateSecret, now: Date.now };
}

/**
 * Runs the route's operation: 503 when the database or a service is missing or fails. Only the
 * error's kind reaches the log (no body is ever logged).
 */
export async function telemetryRoute(operation: (deps: TelemetryDeps) => Promise<Response>, deps: () => TelemetryDeps = telemetryDeps): Promise<Response> {
  try {
    return await operation(deps());
  } catch (error) {
    console.error(`telemetry: post failed (${errorKind(error)})`);
    return apiError(503, 'unavailable', TV_CORS);
  }
}
