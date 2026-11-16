import { createRequire } from 'node:module';
import path from 'node:path';
import type * as Pg from 'pg';
import type { TestProject } from 'vitest/node';
import { prisma, serverUrl, TEST_DATABASE, WEB, withDatabase } from './web-db';

// Vitest resolves a global setup's bare imports from the root, which has no `pg`: load apps/web's.
const pg = createRequire(path.join(WEB, 'package.json'))('pg') as typeof Pg;

declare module 'vitest' {
  export interface ProvidedContext {
    /** The fresh test database, migrated from prisma/migrations. */
    databaseUrl: string;
  }
}

/**
 * `pnpm test:web` (RELAY step 29a): drops and creates `lablo_test` on the DATABASE_URL server,
 * then applies every migration in prisma/migrations to it. A failure here fails the run.
 */
export default async function setup(project: TestProject): Promise<void> {
  const server = serverUrl();
  const admin = new pg.Client({ connectionString: server, connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(`pnpm test:web: no database answers at DATABASE_URL; start it with \`pnpm web:db\` (${String(error)})`);
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(server, TEST_DATABASE);
  const deploy = prisma(['migrate', 'deploy'], url);
  if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed (${deploy.status}):\n${deploy.output}`);
  project.provide('databaseUrl', url);
}
