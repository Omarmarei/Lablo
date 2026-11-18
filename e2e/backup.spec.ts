import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addM3uAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The backup's look-up and upload in the app (RELAY step 32c2), against the stand-in API on the
 * test's config server (`?api=`), with a test device ID (`?device=`, the browser platform's):
 * - a first start finds no backup and shows onboarding; a source added, an upload sends the
 *   profile (`PUT`, after the first send's `GET`);
 * - the TV wiped (the `lablo` database deleted from the gallery page, which starts no data
 *   worker), the next start shows "Looking for your backup" (its `GET` held), then "Welcome back"
 *   in the profile's language, then the live screen fills, with no key pressed;
 * - "Skip" ends the look-up: onboarding, nothing kept;
 * - without `?device=` there is nothing to look for: onboarding at once, no request.
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const DEVICE = 'e2e-tv-32c2';
const PLAYLIST = '#EXTM3U\n#EXTINF:-1 tvg-id="news" group-title="News",Family News\nhttp://127.0.0.1:9/live/1.ts\n#EXTINF:-1 tvg-id="films" group-title="Films",Film Night\nhttp://127.0.0.1:9/live/2.ts\n';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function withServer(run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(devSignedAnswer(doc()));
  server.file('/list.m3u', PLAYLIST, 'audio/x-mpegurl');
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** No config run and no backup worker in the database. */
async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

/** The TV's app data wiped: the database deleted from a page that opens none. */
async function wipe(page: Page): Promise<void> {
  await appIdle(page);
  await page.goto('/?screen=gallery');
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const request = indexedDB.deleteDatabase('lablo');
        request.onsuccess = () => resolve('ok');
        request.onerror = () => resolve('error');
        request.onblocked = () => resolve('blocked');
      }),
  );
  expect(result).toBe('ok');
}

/** The profile's sources (their names), read from IndexedDB once the app has opened it. */
function storedNames(page: Page): Promise<string[] | null> {
  return page.evaluate(
    () =>
      new Promise<string[] | null>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('profile')) {
            db.close();
            resolve(null);
            return;
          }
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: { sources?: { name: string }[] } } | undefined;
            resolve(record === undefined ? null : (record.doc.sources ?? []).map((s) => s.name));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

const SAYS = {
  en: { looking: 'Looking for your backup', welcome: 'Welcome back', locale: 'en-US' },
  ar: { looking: 'جارٍ البحث عن نسختك الاحتياطية', welcome: 'مرحبًا بعودتك', locale: 'ar-SA' },
} as const;

for (const language of ['en', 'ar'] as const) {
  test(`restores the profile after a wipe with no key pressed, "Welcome back" in its language (${language})`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    await withServer(async (server) => {
      const query = `device=${DEVICE}&api=${server.origin}&locale=${SAYS[language].locale}`;
      const link = `${server.origin.replace(/^http:\/\//, '')}/list.m3u`;

      // A fresh install: the look-up finds nothing, then onboarding.
      await addM3uAndWatch(remote, link, query);
      expect(server.backup.requests.map((r) => `${r.method} ${r.status}`)).toEqual(['GET 404']);
      const lookupId = server.backup.requests[0]!.lookupId;

      // An upload now (the schedule's would come 60 s on): the first send asks GET, then PUT.
      expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('sent');
      expect(server.backup.requests.map((r) => `${r.method} ${r.status} ${r.token}`)).toEqual(['GET 404 false', 'GET 404 false', 'PUT 200 true']);
      // The look-up and the upload use the same lookup ID: the device ID after "Allow".
      for (const r of server.backup.requests) expect(r.lookupId).toBe(lookupId);
      expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('same');
      expect(server.backup.requests).toHaveLength(3);

      await wipe(page);
      const release = server.backup.holdGets();
      await page.goto(`/?${query}`);
      const start = page.getByTestId('backup-start');
      await expect(start).toHaveAttribute('data-screen', 'looking');
      await expect(start).toHaveAttribute('data-language', language);
      await expect(page.getByTestId('backup-title')).toHaveText(SAYS[language].looking);
      // scrypt done, the GET held: the screen waits.
      await expect(start).toHaveAttribute('data-progress', '1');
      await expect.poll(() => server.backup.held()).toBe(1);
      expect(await page.evaluate(() => window.__LABLO_TEST__!.backupIdle())).toBe(false);
      await remote.expectFocus('looking/actions/0');
      await shoot(page, `backup-looking-${language}`);
      release();

      await expect(start).toHaveAttribute('data-screen', 'welcome');
      await expect(start).toHaveAttribute('data-language', language);
      await expect(start).toHaveAttribute('data-sources', '1');
      await expect(page.getByTestId('backup-title')).toHaveText(SAYS[language].welcome);
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
      await shoot(page, `backup-welcome-${language}`);

      // No key: the live screen after 5 s, its catalog read at once.
      const live = page.getByTestId('live');
      await expect(live).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
      await expect(live).toContainText('Family News');
      await remote.expectFocus('live/channels/0');
      // The restored last channel doesn't play by itself.
      await expect(page.locator('#stage video')).toHaveCount(0);
      expect(await storedNames(page)).toEqual(['127.0.0.1']);
      expect(server.backup.requests.slice(3).map((r) => `${r.method} ${r.status}`)).toEqual(['GET 200']);
      await shoot(page, `backup-restored-live-${language}`);
      // Restored: the next upload sends nothing new (the send record came with it).
      await appIdle(page);
      expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toMatch(/^(same|sent)$/);
    });
    expect(errors).toEqual([]);
  });
}

test('"Skip" ends the look-up: onboarding, nothing kept', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    const release = server.backup.holdGets();
    await page.goto(`/?device=${DEVICE}&api=${server.origin}&locale=en-US`);
    const start = page.getByTestId('backup-start');
    await expect(start).toHaveAttribute('data-screen', 'looking');
    await expect.poll(() => server.backup.held()).toBe(1);
    await remote.expectFocus('looking/actions/0');
    await remote.press('OK');
    const onboarding = page.getByTestId('onboarding');
    await expect(onboarding).toHaveAttribute('data-ready', 'true');
    await remote.expectFocus('language/languages/0');
    release();
    await appIdle(page);
    expect(await storedNames(page)).toBeNull();
  });
  expect(errors).toEqual([]);
});

test('without a device ID there is nothing to look for: onboarding at once, no request', async ({ page }) => {
  const errors = trackErrors(page);
  await withServer(async (server) => {
    await page.goto(`/?api=${server.origin}&locale=en-US`);
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('backup-start')).toHaveCount(0);
    await appIdle(page);
    expect(server.backup.requests).toEqual([]);
  });
  expect(errors).toEqual([]);
});
