/**
 * The encrypted backup (architecture.md §3.2 and §3.3 B; RELAY step 32a). A TV seals its profile
 * under a key derived from its device secret and puts the envelope here; after a wipe it derives
 * the same keys, gets the envelope back and opens it.
 *
 * **The server only ever holds ciphertext and a hash:** the envelope (`{v, kdf, nonce, ct}`) in
 * the blob store at `backup/<lookupId>`, and a row with the lookup ID, the write token's SHA-256,
 * the envelope's size and two dates. It can't open an envelope: the key never leaves the TV.
 *
 * - **Reading needs only the lookup ID**, itself a 256-bit secret from the TV's master key, and
 *   only the blob store: a restore right after a wipe doesn't wait for Postgres.
 * - **The first put claims a lookup ID for its write token.** Every later put and every delete
 *   needs that token. The row is written before the blob, so a caller with another token never
 *   changes the stored envelope.
 * - A backup nobody updated for `BACKUP_TTL_MS` goes at a later put (`sweepBackups`).
 * - Every route is rate-limited per caller address, through `rateKey` (never the address), and
 *   answers any origin (the TV's page is `file://` or the platform's own scheme).
 */
import { timingSafeEqual } from 'node:crypto';
import { tokenHash, utf8 } from '@lablo/crypto';
import type { BackupEnvelopeWire } from '@lablo/protocol';
import { BACKUP_BODY_MAX_BYTES, BACKUP_WRITE_HEADER, backupEnvelopeSchema, lookupIdSchema } from '@lablo/protocol';
import type { PrismaClient } from '../generated/prisma/client';
import type { BlobStore } from './blob-store';
import { db } from './db';
import { errorKind } from './health';
import { apiError, clientIp, json, readBody, TV_CORS } from './http';
import type { RateLimiter, RateRule } from './rate-limit';
import { rateKey, retryAfterSeconds } from './rate-limit';
import { services } from './services';

/** How long a backup lives after its last update (architecture.md §3.2 "Retention"): 180 days. */
export const BACKUP_TTL_MS = 180 * 86_400_000;
/** How many old backups one put may sweep. */
export const BACKUP_SWEEP_MAX = 20;

const WINDOW_MS = 600_000;

/**
 * Each kind of call's rate limit per caller. A TV reads once, at a start with no profile, and
 * writes at most every 5 minutes; several TVs may share one address.
 */
export const BACKUP_LIMITS: Readonly<Record<'read' | 'write', { readonly scope: string; readonly rule: RateRule }>> = {
  read: { scope: 'backup-read', rule: { limit: 30, windowMs: WINDOW_MS } },
  /** Puts and deletes. */
  write: { scope: 'backup-write', rule: { limit: 30, windowMs: WINDOW_MS } },
};

export interface BackupDeps {
  /** Asked for only by the calls that write: a read never opens the database. */
  readonly db: () => PrismaClient;
  readonly blobs: BlobStore;
  readonly limiter: RateLimiter;
  readonly rateSecret: string;
  readonly now: () => number;
}

/** The blob of a lookup ID's envelope. */
export function backupBlobKey(lookupId: string): string {
  return `backup/${lookupId}`;
}

/** Two stored hashes compared in constant time. */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Counts the request against the caller's limit: null to go ahead, else the 429 answer. */
async function limited(deps: BackupDeps, request: Request, which: keyof typeof BACKUP_LIMITS): Promise<Response | null> {
  const { scope, rule } = BACKUP_LIMITS[which];
  const decision = await deps.limiter.limit(rateKey(scope, clientIp(request.headers), deps.rateSecret), rule);
  return decision.ok ? null : apiError(429, 'rate_limited', { ...TV_CORS, 'retry-after': retryAfterSeconds(decision) });
}

function knownId(lookupId: string): boolean {
  return lookupIdSchema.safeParse(lookupId).success;
}

/** What the row keeps of the request's `X-Write-Token`, or null when it has none of the right shape. */
function writeHash(request: Request): string | null {
  const token = request.headers.get(BACKUP_WRITE_HEADER);
  return token === null ? null : tokenHash(token);
}

/**
 * Deletes at most `max` backups last updated `BACKUP_TTL_MS` or more ago, the oldest first: each
 * blob, then the rows (a blob that fails to go leaves its row for the next sweep). How many went.
 */
export async function sweepBackups(deps: BackupDeps, now: number, max: number = BACKUP_SWEEP_MAX): Promise<number> {
  const cutoff = new Date(now - BACKUP_TTL_MS);
  const old = await deps.db().backup.findMany({ where: { updatedAt: { lte: cutoff } }, orderBy: { updatedAt: 'asc' }, take: max, select: { lookupId: true } });
  if (old.length === 0) return 0;
  for (const row of old) await deps.blobs.delete(backupBlobKey(row.lookupId));
  // Only while still old: a put since the read has made its row, and its blob, new again.
  const { count } = await deps.db().backup.deleteMany({ where: { lookupId: { in: old.map((row) => row.lookupId) }, updatedAt: { lte: cutoff } } });
  return count;
}

/** `PUT /v1/backup/:lookupId`: stores the envelope, for the token that first wrote there. */
export async function putBackup(deps: BackupDeps, request: Request, lookupId: string): Promise<Response> {
  const refused = await limited(deps, request, 'write');
  if (refused !== null) return refused;
  if (!knownId(lookupId)) return apiError(404, 'not_found', TV_CORS);
  const hash = writeHash(request);
  if (hash === null) return apiError(401, 'unauthorized', TV_CORS);
  const body = await readBody(request, BACKUP_BODY_MAX_BYTES, backupEnvelopeSchema, TV_CORS);
  if (!body.ok) return body.response;
  // Only what the schema read.
  const envelope: BackupEnvelopeWire = { v: body.value.v, kdf: body.value.kdf, nonce: body.value.nonce, ct: body.value.ct };
  const bytes = utf8(JSON.stringify(envelope));
  const now = deps.now();
  await sweepBackups(deps, now);
  const at = new Date(now);
  // One statement: a new row claims the ID for this token; an existing one changes only for its own.
  const stored = await deps.db().$queryRaw<{ lookupId: string }[]>`
    INSERT INTO "Backup" ("lookupId", "writeTokenHash", "size", "createdAt", "updatedAt")
    VALUES (${lookupId}, ${hash}, ${bytes.length}, ${at}, ${at})
    ON CONFLICT ("lookupId") DO UPDATE SET "size" = EXCLUDED."size", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "Backup"."writeTokenHash" = EXCLUDED."writeTokenHash"
    RETURNING "lookupId"`;
  if (stored.length !== 1) return apiError(401, 'unauthorized', TV_CORS);
  await deps.blobs.put(backupBlobKey(lookupId), bytes);
  return json({ state: 'stored' }, 200, TV_CORS);
}

/** `GET /v1/backup/:lookupId`: the envelope as it was put, or 404. */
export async function getBackup(deps: BackupDeps, request: Request, lookupId: string): Promise<Response> {
  const refused = await limited(deps, request, 'read');
  if (refused !== null) return refused;
  if (!knownId(lookupId)) return apiError(404, 'not_found', TV_CORS);
  const bytes = await deps.blobs.get(backupBlobKey(lookupId));
  if (bytes === null) return apiError(404, 'not_found', TV_CORS);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { ...TV_CORS, 'cache-control': 'no-store', 'content-type': 'application/json' } });
}

/** `DELETE /v1/backup/:lookupId`: the envelope and its row go, for the token that wrote them. */
export async function deleteBackup(deps: BackupDeps, request: Request, lookupId: string): Promise<Response> {
  const refused = await limited(deps, request, 'write');
  if (refused !== null) return refused;
  if (!knownId(lookupId)) return apiError(404, 'not_found', TV_CORS);
  const hash = writeHash(request);
  if (hash === null) return apiError(401, 'unauthorized', TV_CORS);
  const row = await deps.db().backup.findUnique({ where: { lookupId } });
  if (row === null) return apiError(404, 'not_found', TV_CORS);
  if (!sameHash(hash, row.writeTokenHash)) return apiError(401, 'unauthorized', TV_CORS);
  // The blob first: a row without its blob could be claimed anew while the old envelope still read.
  await deps.blobs.delete(backupBlobKey(lookupId));
  await deps.db().backup.deleteMany({ where: { lookupId, writeTokenHash: row.writeTokenHash } });
  return json({ state: 'deleted' }, 200, TV_CORS);
}

/** The process's dependencies: the database when asked, the services and the clock. */
export function backupDeps(): BackupDeps {
  const { blobs, limiter, rateSecret } = services();
  return { db, blobs, limiter, rateSecret, now: Date.now };
}

/**
 * Runs a route's operation: 503 when the database or a service is missing or fails. Only the
 * error's kind reaches the log (a driver's message can name the host; no body is ever logged).
 */
export async function backupRoute(name: string, operation: (deps: BackupDeps) => Promise<Response>, deps: () => BackupDeps = backupDeps): Promise<Response> {
  try {
    return await operation(deps());
  } catch (error) {
    console.error(`backup: ${name} failed (${errorKind(error)})`);
    return apiError(503, 'unavailable', TV_CORS);
  }
}
