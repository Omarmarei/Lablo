import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { readGrid } from './guide-grid';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST } from './settings-rows';

/**
 * Settings load on first open (RELAY step 35e), in pnpm dev: the `import()` of settings.ts, held
 * by a route. Its first moments paint nothing new (the screen it opened from stays: the live
 * screen, or the guide for its "Guide channel"), then the spinner; Back cancels the opening; once
 * the file is in, Settings opens. A start after a restore whose guide lost its link opens TV guides
 * through the same file. The built bundle's loading from file://, a failed load and "Try again"
 * are in tv-bundle.spec.ts.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/**
 * lazy-file.ts's SPINNER_AFTER_MS (pinned there by its unit test). Not imported: lazy-file.ts imports
 * @lablo/ui, whose .tsx files the root tsconfig (no `jsx`) can't type.
 */
const SPINNER_AFTER_MS = 300;

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

/** What the page drew after the key: when (ms after the keydown) the screen under went and the loading screen came. */
interface Seen {
  readonly underGoneAfter: number | null;
  readonly loadingAfter: number | null;
}

/** settings.ts's `import()` held until `release`; `asked` counts its requests. */
async function holdSettings(page: Page): Promise<{ release: () => void; asked: () => number }> {
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
  return { release: () => release(), asked: () => asked };
}

/** Watches the paints from the next key on: when `under` (a selector) left the page and the loading screen came. */
async function watchPaints(page: Page, under: string): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as unknown as { seen: Seen; keyAt: number | null };
    w.keyAt = null;
    w.seen = { underGoneAfter: null, loadingAfter: null };
    window.addEventListener('keydown', () => (w.keyAt ??= performance.now()), true);
    new MutationObserver(() => {
      if (w.keyAt === null) return;
      const after = performance.now() - w.keyAt;
      if (w.seen.underGoneAfter === null && document.querySelector(selector) === null) w.seen = { ...w.seen, underGoneAfter: after };
      if (w.seen.loadingAfter === null && document.querySelector('[data-testid=lazy-loading]') !== null) w.seen = { ...w.seen, loadingAfter: after };
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  }, under);
}

/** The screen under stayed until the spinner took its place, at least `SPINNER_AFTER_MS` after the key. */
async function expectQuietThenSpinner(page: Page): Promise<void> {
  const seen = await page.evaluate(() => (window as unknown as { seen: Seen }).seen);
  expect(seen.loadingAfter).not.toBeNull();
  expect(seen.loadingAfter!).toBeGreaterThanOrEqual(SPINNER_AFTER_MS - 5);
  expect(seen.underGoneAfter).toBe(seen.loadingAfter);
}

/** No config run and no backup worker in the database. */
async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

/** The stored profile with a guide of the user's that lost its link, as a backup made without logins brings it back. */
function dropGuideLink(page: Page, origin: string): Promise<void> {
  return page.evaluate(
    (kept) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('profile', 'readwrite');
          const store = tx.objectStore('profile');
          const req = store.get('current');
          req.onsuccess = () => {
            const record = req.result as { doc: Record<string, unknown> };
            record.doc['guides'] = [{ id: 's1', url: null, origin: kept }];
            store.put(record);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    origin,
  );
}

test('the first open of Settings: the live screen for a moment, then a spinner; Back cancels, and Settings opens once the file is in', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const hold = await holdSettings(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await settled(live);
  await remote.go('UP', 'live/header/0');
  for (let i = 1; i <= 5; i += 1) await remote.go('RIGHT', `live/header/${i}`);

  await watchPaints(page, '[data-testid=live]');
  await remote.go('OK', 'lazy-loading/retry/-1');
  const loading = page.getByTestId('lazy-loading');
  await expect(loading).toHaveAttribute('data-phase', 'spinner');
  await expect(page.getByTestId('lazy-loading-spinner')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'lazy-loading-spinner.png') });
  await expectQuietThenSpinner(page);
  expect(hold.asked()).toBe(1);

  // Back: the opening is cancelled, the live screen as it was.
  await remote.go('BACK', 'live/header/5');
  await expect(loading).toHaveCount(0);
  await expect(live).toBeVisible();

  // The file comes in: Settings opens (the file was asked for once).
  hold.release();
  await remote.go('OK', SETTINGS_FIRST);
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await remote.go('BACK', 'live/header/5');
  await remote.go('OK', SETTINGS_FIRST);
  expect(hold.asked()).toBe(1);
  expect(errors).toEqual([]);
});

test('the first open from the guide\'s "Guide channel": the guide for a moment, then a spinner, then the guide channel picker', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const hold = await holdSettings(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await settled(live);
  await remote.go('UP', 'live/header/0');
  await remote.go('OK', 'guide/grid/0');
  const guide = page.getByTestId('guide-screen');
  await settled(guide);
  // The first channel's next programme (no catch-up): its details' second action is "Guide channel".
  const onAir = (await readGrid(page, 'guide-screen', '.guide__header > *')).time;
  await remote.press('RIGHT');
  await expect.poll(async () => (await readGrid(page, 'guide-screen', '.guide__header > *')).time).toBeGreaterThan(onAir);
  await remote.go('OK', 'programme/actions/0');
  await remote.go('RIGHT', 'programme/actions/1');
  await expect(page.getByTestId('programme-map')).toHaveText('Guide channel');

  // The details close and the guide stays painted (not the live screen) until the spinner.
  await watchPaints(page, '[data-testid=guide-screen]');
  await remote.go('OK', 'lazy-loading/retry/-1');
  await expect(page.getByTestId('lazy-loading')).toHaveAttribute('data-phase', 'spinner');
  await expectQuietThenSpinner(page);

  hold.release();
  await remote.expectFocus('guide-map/search/0', 15_000);
  await expect(page.getByTestId('mapping')).toHaveAttribute('data-status', 'ready');
  expect(hold.asked()).toBe(1);
  expect(errors).toEqual([]);
});

test('a start after a restore whose guide lost its link: "Welcome back", then TV guides from settings.js', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await settled(live);
  await appIdle(page);
  await page.goto('/?screen=gallery');
  await expect(page.getByTestId('gallery')).toBeVisible();
  await dropGuideLink(page, `http://${host}`);

  await page.goto('/?restored=1&locale=en-US');
  const start = page.getByTestId('backup-start');
  await expect(start).toHaveAttribute('data-screen', 'welcome');
  await expect(start).toHaveAttribute('data-logins', '0');
  await expect(start).toHaveAttribute('data-guides', '1');
  await remote.press('OK');
  const guides = page.getByTestId('guides');
  await expect(guides).toHaveAttribute('data-status', 'ready');
  await remote.expectFocus('guides/guides/0');
  await expect(page.getByTestId('guide-0')).toHaveAttribute('data-needs', 'true');
  expect(errors).toEqual([]);
});
