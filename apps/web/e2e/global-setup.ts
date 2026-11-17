import { createRequire } from 'node:module';
import path from 'node:path';
import type * as Pg from 'pg';
import { E2E_DATABASE, prisma, serverUrl, WEB, withDatabase } from '../test/web-db';

// The root has no `pg`: load apps/web's.
const pg = createRequire(path.join(WEB, 'package.json'))('pg') as typeof Pg;

/**
 * `pnpm e2e:web` (RELAY step 31b): drops and creates `lablo_e2e` on the DATABASE_URL server, then
 * applies every migration to it. `next start` is already up (it connects on its first query).
 */
export default async function setup(): Promise<void> {
  const server = serverUrl();
  const admin = new pg.Client({ connectionString: server, connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(`pnpm e2e:web: no database answers at DATABASE_URL; start it with \`pnpm web:db\` (${String(error)})`);
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${E2E_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${E2E_DATABASE}`);
  } finally {
    await admin.end();
  }
  const deploy = prisma(['migrate', 'deploy'], withDatabase(server, E2E_DATABASE));
  if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed (${deploy.status}):\n${deploy.output}`);
}
