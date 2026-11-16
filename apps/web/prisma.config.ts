import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * The Prisma CLI's configuration (Prisma 7: the database URL lives here, not in the schema).
 * DATABASE_URL comes from the environment, or else from apps/web/.env (gitignored; copy
 * .env.example). `prisma generate` needs no database, so it runs without one (on install, in CI).
 */
const envFile = path.join(import.meta.dirname, '.env');
if (process.env.DATABASE_URL === undefined && existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url === undefined ? {} : { datasource: { url } }),
});
