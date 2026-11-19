/**
 * The diagnostics report (architecture.md §3.2 and §3.4; RELAY step 33d1): `POST /v1/diag` keeps
 * a report the user sent from the TV's Settings and answers a 6-character code to give support.
 *
 * **It keeps only what the schema keeps.** Never a URL, a host, a channel or VOD name, a login, an
 * IP address or an ID:
 * - the report is read whole by `diagRequestSchema`, which strips the fields it doesn't know;
 * - a crash's stack, its one free text, is scrubbed again here (`scrubText`; the TV scrubbed it
 *   first with the user's own logins, which the server never knows);
 * - the caller's address is used only for the rate limit, through `rateKey`.
 *
 * There is no route that reads a report back: support reads it by its code in the database, so
 * a guessed code shows nothing. Rows live `DIAG_TTL_MS` (30 days: support needs a report only
 * while its ticket is open); each post sweeps a bounded number of older ones first. Every answer
 * carries the TV's CORS and `no-store`.
 */
import { randomBytes } from 'node:crypto';
import type { DiagReport, DiagResponse } from '@lablo/protocol';
import { DIAG_BODY_MAX_BYTES, diagRequestSchema, scrubText } from '@lablo/protocol';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { db } from './db';
import { errorKind } from './health';
import { apiError, clientIp, json, readBody, TV_CORS } from './http';
import { CROCKFORD } from './pair';
import type { RateLimiter, RateRule } from './rate-limit';
import { rateKey, retryAfterSeconds } from './rate-limit';
import { services } from './services';

/** How long a report is kept after it was received: 30 days. */
export const DIAG_TTL_MS = 30 * 86_400_000;
/** How many old reports one post may sweep. */
export const DIAG_SWEEP_MAX = 1000;
/** How many codes a post tries when one is taken. */
export const DIAG_CODE_ATTEMPTS = 5;
/** The code's characters, each from one random byte. */
export const DIAG_CODE_CHARS = 6;

/** The rate limit per caller: a person asks for a report. Several TVs may share one address. */
export const DIAG_LIMIT: { readonly scope: string; readonly rule: RateRule } = { scope: 'diag', rule: { limit: 5, windowMs: 3_600_000 } };

export interface DiagDeps {
  readonly db: () => PrismaClient;
  readonly limiter: RateLimiter;
  readonly rateSecret: string;
  readonly now: () => number;
  readonly random: (bytes: number) => Uint8Array;
}

/**
 * The 6-character code of 6 random bytes: each byte's low 5 bits pick a character of Crockford's
 * base32 (256 is a multiple of 32, so each character is uniform): 30 bits.
 */
export function newDiagCode(bytes: Uint8Array): string {
  if (bytes.length !== DIAG_CODE_CHARS) throw new RangeError('a support code takes 6 random bytes');
  let code = '';
  for (const byte of bytes) code += CROCKFORD[byte & 31];
  return code;
}

/** What a row's `report` keeps: the report as the schema read it, each crash's stack scrubbed. */
export function reportData(report: DiagReport): Prisma.InputJsonObject {
  const events = report.events.map((event) => (event.kind === 'crash' ? { ...event, stack: scrubText(event.stack) } : event));
  return { ...report, events } as Prisma.InputJsonObject;
}

function isUniqueClash(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** Deletes at most `max` reports received `DIAG_TTL_MS` or more ago, the oldest first. How many went. */
export async function sweepDiag(deps: DiagDeps, now: number, max: number = DIAG_SWEEP_MAX): Promise<number> {
  const cutoff = new Date(now - DIAG_TTL_MS);
  return deps.db().$executeRaw`
    DELETE FROM "DiagReport" WHERE "id" IN (
      SELECT "id" FROM "DiagReport" WHERE "createdAt" <= ${cutoff} ORDER BY "createdAt", "id" LIMIT ${max}
    )`;
}

/** `POST /v1/diag`: the report kept under a new code, which the answer gives. */
export async function postDiag(deps: DiagDeps, request: Request): Promise<Response> {
  const decision = await deps.limiter.limit(rateKey(DIAG_LIMIT.scope, clientIp(request.headers), deps.rateSecret), DIAG_LIMIT.rule);
  if (!decision.ok) return apiError(429, 'rate_limited', { ...TV_CORS, 'retry-after': retryAfterSeconds(decision) });
  const body = await readBody(request, DIAG_BODY_MAX_BYTES, diagRequestSchema, TV_CORS);
  if (!body.ok) return body.response;
  const { platform, appVersion, report } = body.value;
  const now = deps.now();
  await sweepDiag(deps, now);
  const data = reportData(report);
  for (let attempt = 1; ; attempt++) {
    const code = newDiagCode(deps.random(DIAG_CODE_CHARS));
    try {
      await deps.db().diagReport.create({ data: { code, platform, appVersion, report: data, createdAt: new Date(now) } });
    } catch (error) {
      // Another report has this code: make another.
      if (attempt < DIAG_CODE_ATTEMPTS && isUniqueClash(error)) continue;
      throw error;
    }
    const answer: DiagResponse = { code };
    return json(answer, 201, TV_CORS);
  }
}

/** The process's dependencies: the database when asked, the services, the clock and the random bytes. */
export function diagDeps(): DiagDeps {
  const { limiter, rateSecret } = services();
  return { db, limiter, rateSecret, now: Date.now, random: (bytes) => new Uint8Array(randomBytes(bytes)) };
}

/**
 * Runs the route's operation: 503 when the database or a service is missing or fails, or no free
 * code was found. Only the error's kind reaches the log (no body is ever logged).
 */
export async function diagRoute(operation: (deps: DiagDeps) => Promise<Response>, deps: () => DiagDeps = diagDeps): Promise<Response> {
  try {
    return await operation(deps());
  } catch (error) {
    console.error(`diag: post failed (${errorKind(error)})`);
    return apiError(503, 'unavailable', TV_CORS);
  }
}
