import { defineConfig } from 'vitest/config';

/**
 * `pnpm test:web` (RELAY step 29a, docs/runbooks/web.md): the backend's tests against a real
 * Postgres (`pnpm web:db` locally, a service container in CI's `web` job). The global setup
 * migrates a fresh `lablo_test` database first. Kept out of `pnpm test`, which needs no database.
 */
export default defineConfig({
  test: {
    include: ['apps/web/test/**/*.web.test.ts'],
    globalSetup: ['apps/web/test/global-setup.web.ts'],
    // One database: the files run one after another.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
