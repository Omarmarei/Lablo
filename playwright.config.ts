import { defineConfig, devices } from '@playwright/test';

/**
 * Desktop end-to-end tests (e2e/). The TV canvas is 1920x1080.
 * - hello.spec.ts drives the Vite dev app (platform-browser) with the keyboard as remote.
 * - tv-bundle.spec.ts loads the built TV bundles (dist/tv, from pnpm build:tv) in desktop
 *   Chromium. Old engines (Chromium 53/56/68) are covered by the step-2b harness instead.
 */
const PORT = Number(process.env.ZOMA_E2E_PORT ?? 5391);
/** S6 at scale (RELAY step 15b) only on request: `pnpm lab:scale`, or `ZOMA_LAB_SCALE=1`. */
const LAB_SCALE = process.env.npm_lifecycle_event === 'lab:scale' || process.env.ZOMA_LAB_SCALE === '1';
/** S5 on the generated media (RELAY step 15c) only on request: `pnpm lab:media` (in `pnpm verify:media`), or `ZOMA_LAB_MEDIA=1`. */
const LAB_MEDIA = process.env.npm_lifecycle_event === 'lab:media' || process.env.ZOMA_LAB_MEDIA === '1';
/** Playback on the generated media (RELAY step 18) only on request: `pnpm e2e:media` (in `pnpm verify:media`), or `ZOMA_E2E_MEDIA=1`. */
const E2E_MEDIA = process.env.npm_lifecycle_event === 'e2e:media' || process.env.ZOMA_E2E_MEDIA === '1';

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
  projects: [
    { name: 'chromium', testIgnore: /(throttled|lab-scale|lab-media|playback-media|player-media)\.spec\.ts$/ },
    // The CPU-throttled timings (RELAY step 14b) run after every other test, one test at a
    // time, so no other browser competes for the CPU while they measure.
    { name: 'throttled', testMatch: /throttled\.spec\.ts$/, dependencies: ['chromium'], fullyParallel: false },
    // S6 on the scale fixtures (needs `pnpm fixtures`; minutes, so never part of `pnpm e2e`).
    ...(LAB_SCALE ? [{ name: 'lab-scale', testMatch: /lab-scale\.spec\.ts$/, fullyParallel: false }] : []),
    // S5 on the generated media (needs `pnpm mock:media`, which pnpm test:media runs first; about 2 min).
    ...(LAB_MEDIA ? [{ name: 'lab-media', testMatch: /lab-media\.spec\.ts$/, fullyParallel: false }] : []),
    // Live, VOD and catch-up through Html5Engine and the PlayerController, and the player in the
    // app (RELAY step 20a) (needs `pnpm mock:media`).
    ...(E2E_MEDIA ? [{ name: 'playback-media', testMatch: /(playback|player)-media\.spec\.ts$/, fullyParallel: false }] : []),
  ],
  webServer: {
    command: `pnpm --filter @zoma/app-tv exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never attach to a server another session left running on the same port.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
