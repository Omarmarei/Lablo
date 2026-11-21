import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { SPINNER_AFTER_MS } from '../apps/tv/src/lazy/lazy-file';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Settings load on first open (RELAY step 35e), in pnpm dev: the `import()` of settings.ts, held
 * by a route. Its first moments paint nothing new (the live screen stays), then the spinner; Back
 * cancels the opening; once the file is in, Settings opens. The built bundle's loading from
 * file://, a failed load and "Try again" are in tv-bundle.spec.ts.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

/** What the page drew after the key: when (ms after the keydown) the live screen went and the loading screen came. */
interface Seen {
  readonly liveGoneAfter: number | null;
  readonly loadingAfter: number | null;
}

test('the first open of Settings: the live screen for a moment, then a spinner; Back cancels, and Settings opens once the file is in', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  await page.route(/\/src\/settings\/settings\.ts(\?.*)?$/, async (route) => {
    asked += 1;
    await held;
    await route.continue();
  });
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await settled(live);
  await remote.go('UP', 'live/header/0');
  for (let i = 1; i <= 5; i += 1) await remote.go('RIGHT', `live/header/${i}`);

  // Watch the paints from the key on.
  await page.evaluate(() => {
    const w = window as unknown as { seen: Seen; keyAt: number | null };
    w.keyAt = null;
    w.seen = { liveGoneAfter: null, loadingAfter: null };
    window.addEventListener('keydown', () => (w.keyAt ??= performance.now()), true);
    new MutationObserver(() => {
      if (w.keyAt === null) return;
      const after = performance.now() - w.keyAt;
      if (w.seen.liveGoneAfter === null && document.querySelector('[data-testid=live]') === null) w.seen = { ...w.seen, liveGoneAfter: after };
      if (w.seen.loadingAfter === null && document.querySelector('[data-testid=lazy-loading]') !== null) w.seen = { ...w.seen, loadingAfter: after };
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await remote.go('OK', 'lazy-loading/retry/-1');
  const loading = page.getByTestId('lazy-loading');
  await expect(loading).toHaveAttribute('data-phase', 'spinner');
  await expect(page.getByTestId('lazy-loading-spinner')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'lazy-loading-spinner.png') });
  const seen = await page.evaluate(() => (window as unknown as { seen: Seen }).seen);
  // The live screen stayed until the spinner took its place.
  expect(seen.loadingAfter).not.toBeNull();
  expect(seen.loadingAfter!).toBeGreaterThanOrEqual(SPINNER_AFTER_MS - 5);
  expect(seen.liveGoneAfter).toBe(seen.loadingAfter);
  expect(asked).toBe(1);

  // Back: the opening is cancelled, the live screen as it was.
  await remote.go('BACK', 'live/header/5');
  await expect(loading).toHaveCount(0);
  await expect(live).toBeVisible();

  // The file comes in: Settings opens (the file was asked for once).
  release();
  await remote.go('OK', 'settings/items/0');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await remote.go('BACK', 'live/header/5');
  await remote.go('OK', 'settings/items/0');
  expect(asked).toBe(1);
  expect(errors).toEqual([]);
});
