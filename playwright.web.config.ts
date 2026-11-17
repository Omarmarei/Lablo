import { defineConfig, devices } from '@playwright/test';
import { E2E_DATABASE, serverUrl, withDatabase } from './apps/web/test/web-db';

/**
 * `pnpm e2e:web` (RELAY step 31b, docs/runbooks/web.md "The phone page"): the phone page in a
 * phone-sized Chromium against `next start` (needs `pnpm build:web`) and a fresh `lablo_e2e`
 * database (apps/web/e2e/global-setup.ts drops, creates and migrates it). The specs play the TV
 * themselves, over the API. Kept out of `pnpm e2e`, which serves the TV app and needs no database;
 * CI's `web` job runs it.
 */
const PORT = Number(process.env.LABLO_WEB_E2E_PORT ?? 3101);

export default defineConfig({
  testDir: 'apps/web/e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI !== undefined ? [['list'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-web-report' }]] : 'list',
  outputDir: 'artifacts/playwright-web-results',
  globalSetup: './apps/web/e2e/global-setup.ts',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'phone' }],
  webServer: {
    // The server starts before the global setup makes the database: `/p` answers without one.
    command: `pnpm --filter @lablo/web exec next start --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/p`,
    // Never attach to a server another session left running on the same port.
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_URL: withDatabase(serverUrl(), E2E_DATABASE), NEXT_TELEMETRY_DISABLED: '1' },
  },
});
