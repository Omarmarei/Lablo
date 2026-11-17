/**
 * The blob store, the rate limiter and the rate-key secret the routes use (RELAY step 31a): one
 * of each per process, kept on `globalThis` like the database client (Next's dev reloads).
 *
 * Until step 34 only the in-memory fakes exist, so on Vercel (`VERCEL` set) this refuses rather
 * than run a deployment on them: a memory store can't serve more than one instance, and a memory
 * limiter limits nothing across instances. Step 34 adds the R2 and Upstash adapters.
 */
import { randomBytes } from 'node:crypto';
import type { BlobStore } from './blob-store';
import { MemoryBlobStore } from './blob-store';
import type { RateLimiter } from './rate-limit';
import { MemoryRateLimiter } from './rate-limit';

export interface Services {
  readonly blobs: BlobStore;
  readonly limiter: RateLimiter;
  /** The secret `rateKey` hashes addresses under. */
  readonly rateSecret: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Where the memory store's presigned URLs point by default (`next dev` / `next start` on 3100). */
export const DEV_BLOB_URL = 'http://127.0.0.1:3100/dev/blob';

/** `LABLO_RATE_SECRET` when set (at least 32 characters), else a random one for this process. */
export function rateSecretFrom(env: Env): string {
  const secret = env.LABLO_RATE_SECRET;
  if (secret === undefined || secret === '') return randomBytes(32).toString('base64url');
  if (secret.length < 32) throw new Error('LABLO_RATE_SECRET is shorter than 32 characters');
  return secret;
}

/** The services for `env`: refuses on Vercel, where the fakes must never run. */
export function createServices(env: Env): Services {
  if (env.VERCEL !== undefined && env.VERCEL !== '') {
    throw new Error('no production blob store or rate limiter yet (RELAY step 34)');
  }
  return {
    blobs: new MemoryBlobStore({ baseUrl: env.LABLO_DEV_BLOB_URL ?? DEV_BLOB_URL }),
    limiter: new MemoryRateLimiter(),
    rateSecret: rateSecretFrom(env),
  };
}

const kept = globalThis as typeof globalThis & { labloServices?: Services };

/** The process's services, made on first use. */
export function services(env: Env = process.env): Services {
  kept.labloServices ??= createServices(env);
  return kept.labloServices;
}

/** Forgets the process's services (tests). */
export function resetServices(): void {
  delete kept.labloServices;
}
