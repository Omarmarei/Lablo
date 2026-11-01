import { defineConfig, devices } from '@playwright/test';

/**
 * Desktop end-to-end tests (e2e/). The TV canvas is 1920x1080.
 * - hello.spec.ts drives the Vite dev app (platform-browser) with the keyboard as remote.
 * - tv-bundle.spec.ts loads the built TV bundles (dist/tv, from pnpm build:tv) in desktop
 *   Chromium. Old engines (Chromium 53/56/68) are covered by the step-2b harness instead.
 */
const PORT = Number(process.env.ZOMA_E2E_PORT ?? 5391);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI !== undefined ? [['list'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-report' }]] : 'list',
  outputDir: 'artifacts/playwright-results',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1920, height: 1080 },
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm --filter @zoma/app-tv exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never attach to a server another session left running on the same port.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
