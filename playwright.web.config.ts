import { defineConfig, devices } from '@playwright/test';
import { E2E_DATABASE, serverUrl, withDatabase } from './apps/web/test/web-db';

/**
 * `pnpm e2e:web` (docs/runbooks/web.md), against `next start` (needs `pnpm build:web`) and a fresh
 * `lablo_e2e` database (apps/web/e2e/global-setup.ts drops, creates and migrates it). Kept out of
 * `pnpm e2e`, which needs no database; CI's `web` job runs it. Two projects:
 * - `phone` (RELAY step 31b, docs/runbooks/web.md "The phone page"): the phone page in a
 *   phone-sized Chromium; the specs (apps/web/e2e) play the TV themselves, over the API;
 * - `tv` (step 31c3): the TV's pairing screen in its dev app (the second web server) against the
 *   real API, through a test front (e2e/api-front.ts), with the mock provider and a scripted phone
 *   (e2e/pairing-api.spec.ts); the backup's wipe and restore (e2e/backup-api.spec.ts, step 32d1).
 */
const PORT = Number(process.env.LABLO_WEB_E2E_PORT ?? 3101);
/** The TV's dev app; `pnpm e2e` uses 5391. */
const TV_PORT = Number(process.env.LABLO_WEB_E2E_TV_PORT ?? 5393);

export default defineConfig({
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI !== undefined ? [['list'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-web-report' }]] : 'list',
  outputDir: 'artifacts/playwright-web-results',
  globalSetup: './apps/web/e2e/global-setup.ts',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', testDir: 'apps/web/e2e', use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${PORT}` } },
    {
      name: 'tv',
      testDir: 'e2e',
      // The TV's pairing against the real API (step 31c3), the "no plaintext" run with the real phone page (step 31e),
      // and step 32's wipe restored from the real backup routes (step 32d1).
      testMatch: /(pairing-api|no-plaintext|backup-api)\.spec\.ts$/,
      // The TV canvas is 1920x1080, as in `pnpm e2e`.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, baseURL: `http://localhost:${TV_PORT}` },
    },
  ],
  webServer: [
    {
      // The server starts before the global setup makes the database: `/p` answers without one.
      command: `pnpm --filter @lablo/web exec next start --port ${PORT} --hostname 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}/p`,
      // Never attach to a server another session left running on the same port.
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: withDatabase(serverUrl(), E2E_DATABASE), NEXT_TELEMETRY_DISABLED: '1' },
    },
    {
      command: `pnpm --filter @lablo/app-tv exec vite --port ${TV_PORT} --strictPort`,
      url: `http://localhost:${TV_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
