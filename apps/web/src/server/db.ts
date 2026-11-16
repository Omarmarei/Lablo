import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { HealthProbe } from './health';

/**
 * The database (RELAY step 29a): Prisma 7's Rust-free client over node-postgres
 * (`@prisma/adapter-pg`). One client per URL per process, kept on `globalThis` so that Next's
 * dev reloads don't open a new pool each time.
 */

/** How long a new connection may take before the query fails (pg waits forever by default). */
export const CONNECT_TIMEOUT_MS = 2000;

export function databaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const url = env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set: copy apps/web/.env.example to apps/web/.env (docs/runbooks/web.md)');
  }
  return url;
}

export function createDb(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS }) });
}

const kept = globalThis as typeof globalThis & { labloDb?: { url: string; client: PrismaClient } };

/** The process's client for DATABASE_URL (a new one if the URL changed). */
export function db(): PrismaClient {
  const url = databaseUrl();
  if (kept.labloDb?.url !== url) {
    const old = kept.labloDb?.client;
    kept.labloDb = { url, client: createDb(url) };
    void old?.$disconnect();
  }
  return kept.labloDb.client;
}

/** The health check's probe: the database answers `SELECT 1`. */
export function databaseProbe(client: PrismaClient = db()): HealthProbe {
  return {
    async ping() {
      await client.$queryRaw`SELECT 1`;
    },
  };
}
