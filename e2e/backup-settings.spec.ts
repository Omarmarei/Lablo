import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addM3uAndWatch, settled, startWatching, trackErrors, typeInto } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Settings' backup page in the app (RELAY step 32d2b), against the stand-in API on the test's
 * config server (`?api=`):
 * - English, "Not now" at the consent: the backup code shown in groups is `kv`'s; the last send
 *   after an upload; off asks first, then the stand-in's `DELETE` and its copy gone, and an upload
 *   answers `off` with no request; on again sends at once (`GET`, `PUT`);
 * - Arabic, a held backup (a backup made, the TV wiped, the look-up skipped, onboarding again, an
 *   upload `held`): "Replace it" asks, then `PUT` with no `GET`, and the next upload is `same`;
 * - "Restore it" (the backup made in Arabic, onboarding again in English with another playlist):
 *   "Welcome back" in Arabic after the app starts again, the old profile back, the replaced one in
 *   a snapshot, and the live list the old playlist's: the replaced profile's catalog under the
 *   same source id is gone.
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const DEVICE = 'e2e-tv-32d2b';
const PLAYLIST = '#EXTM3U\n#EXTINF:-1 tvg-id="news" group-title="News",Family News\nhttp://127.0.0.1:9/live/1.ts\n#EXTINF:-1 tvg-id="films" group-title="Films",Film Night\nhttp://127.0.0.1:9/live/2.ts\n';
const SECOND = '#EXTM3U\n#EXTINF:-1 tvg-id="second" group-title="Second",Second Channel\nhttp://127.0.0.1:9/live/3.ts\n';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function withServer(run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(devSignedAnswer(doc()));
  server.file('/list.m3u', PLAYLIST, 'audio/x-mpegurl');
  server.file('/second.m3u', SECOND, 'audio/x-mpegurl');
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

interface Stored {
  /** The current profile's language and sources' links. */
  readonly current: { language: string | null; urls: string[] } | null;
  /** The snapshots' reasons and their sources' links. */
  readonly snapshots: { reason: string; urls: string[] }[];
  /** `kv`'s backup code. */
  readonly code: unknown;
}

/** The profile store and `kv`'s backup code, read once the app has opened the database. */
function stored(page: Page): Promise<Stored> {
  return page.evaluate(
    () =>
      new Promise<Stored>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['profile', 'kv']);
          const all = tx.objectStore('profile').getAll();
          const code = tx.objectStore('kv').get('backup.code');
          tx.oncomplete = () => {
            db.close();
            type Doc = { onboarding?: { language?: string | null }; sources?: { url?: string }[] };
            const records = all.result as { id: string; doc: Doc; reason?: string }[];
            const urls = (d: Doc): string[] => (d.sources ?? []).map((s) => s.url ?? '');
            const current = records.find((r) => r.id === 'current');
            resolve({
              current: current === undefined ? null : { language: current.doc.onboarding?.language ?? null, urls: urls(current.doc) },
              snapshots: records.filter((r) => r.id !== 'current').map((r) => ({ reason: r.reason ?? '', urls: urls(r.doc) })),
              code: code.result,
            });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/** The stand-in's requests from `from` on: method and status, and whether a write token came. */
function asked(server: ConfigServer, from = 0): string[] {
  return server.backup.requests.slice(from).map((r) => `${r.method} ${r.status}`);
}

/** From the live list: the header's "Settings" (its end: the left in Arabic), then "Backup", the third row. */
async function openBackup(remote: RemoteDriver, rtl: boolean): Promise<Locator> {
  await remote.go('UP', 'live/header/0');
  for (let i = 1; i <= 5; i += 1) await remote.go(rtl ? 'LEFT' : 'RIGHT', `live/header/${i}`);
  await remote.go('OK', 'settings/items/0');
  await remote.go('DOWN', 'settings/items/1');
  await remote.go('DOWN', 'settings/items/2');
  await remote.go('OK', 'backup/switch/0');
  const page = remote.page.getByTestId('backup');
  await expect(page).toHaveAttribute('data-status', 'ready');
  await settled(remote.page.getByTestId('settings-screen'), 20_000);
  return page;
}

/** The confirm dialog: "Cancel" focused first; the confirm is the other way (left in English, right in Arabic). */
async function toConfirm(remote: RemoteDriver, rtl: boolean): Promise<void> {
  await remote.expectFocus('backup-confirm/actions/1');
  await remote.go(rtl ? 'RIGHT' : 'LEFT', 'backup-confirm/actions/0');
}

/** Onboarding again where it is (after "Skip"), in the TV's language, with "Allow" and an M3U link. */
async function onboardHere(remote: RemoteDriver, link: string, rtl: boolean): Promise<void> {
  const onboarding = remote.page.getByTestId('onboarding');
  await expect(onboarding).toHaveAttribute('data-ready', 'true');
  await remote.expectFocus(rtl ? 'language/languages/1' : 'language/languages/0');
  await remote.go('OK', 'disclaimer/actions/0');
  await remote.go('OK', 'consent/actions/0');
  await remote.go('OK', 'source/types/0');
  await remote.go('DOWN', 'source/types/1');
  await remote.go('OK', 'form/fields/0');
  await typeInto(remote, onboarding, 'playlist', link);
  await remote.expectFocus('form/fields/1');
  await remote.go('DOWN', 'form/fields/2');
  await remote.go('DOWN', 'form/actions/0');
  await startWatching(remote, onboarding, 20_000);
}

/**
 * A held backup: onboarding (Arabic, "Allow") with the first playlist and an upload; the TV wiped;
 * the next start's look-up skipped while its `GET` is held; onboarding again with `second` in
 * `locale`'s language; its upload finds the backup and holds.
 */
async function heldBackup(remote: RemoteDriver, server: ConfigServer, locale: 'ar-SA' | 'en-US', second: string): Promise<void> {
  const { page } = remote;
  const host = server.origin.replace(/^http:\/\//, '');
  await addM3uAndWatch(remote, `${host}/list.m3u`, `device=${DEVICE}&api=${server.origin}&locale=ar-SA`);
  expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('sent');
  await wipe(page);
  const release = server.backup.holdGets();
  await page.goto(`/?device=${DEVICE}&api=${server.origin}&locale=${locale}`);
  await expect(page.getByTestId('backup-start')).toHaveAttribute('data-screen', 'looking');
  await expect.poll(() => server.backup.held()).toBe(1);
  await remote.expectFocus('looking/actions/0');
  await remote.press('OK');
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
  release();
  await onboardHere(remote, `${host}/${second}`, locale === 'ar-SA');
  await appIdle(page);
  const before = server.backup.requests.length;
  expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('held');
  expect(asked(server, before)).toEqual(['GET 200']);
}

test('English, "Not now": the backup code is shown in groups; off deletes the copy and sends nothing; on sends again', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    const host = server.origin.replace(/^http:\/\//, '');
    // Onboarding with "Not now": no device ID is read, the backup code is the secret.
    await page.goto(`/?api=${server.origin}&locale=en-US`);
    const onboarding = page.getByTestId('onboarding');
    await expect(onboarding).toHaveAttribute('data-ready', 'true');
    await remote.expectFocus('language/languages/0');
    await remote.go('OK', 'disclaimer/actions/0');
    await remote.go('OK', 'consent/actions/0');
    await remote.go('RIGHT', 'consent/actions/1');
    await remote.go('OK', 'source/types/0');
    await remote.go('DOWN', 'source/types/1');
    await remote.go('OK', 'form/fields/0');
    await typeInto(remote, onboarding, 'playlist', `${host}/list.m3u`);
    await remote.go('DOWN', 'form/fields/2');
    await remote.go('DOWN', 'form/actions/0');
    await startWatching(remote, onboarding, 20_000);
    await appIdle(page);
    expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('sent');
    expect(asked(server)).toEqual(['GET 404', 'PUT 200']);
    const lookupId = server.backup.requests[0]!.lookupId;

    const backup = await openBackup(remote, false);
    await expect(backup).toHaveAttribute('data-on', 'true');
    await expect(backup).toHaveAttribute('data-source', 'code');
    await expect(backup).toHaveAttribute('data-held', 'false');
    await expect(page.getByTestId('backup-value')).toHaveText('On');
    await expect(page.getByTestId('backup-line')).toContainText('Last backed up ');
    const kept = (await stored(page)).code;
    expect(typeof kept).toBe('string');
    const code = page.getByTestId('backup-code');
    await expect(code).toHaveAttribute('data-code', kept as string);
    await expect(code).toHaveAttribute('dir', 'ltr');
    const text = (await code.textContent()) ?? '';
    expect(text.replace(/ /g, '')).toBe(kept);
    expect(text.split(' ').map((group) => group.length)).toEqual([4, 4, 4, 4, 4, 4, 2]);
    await shoot(page, 'backup-settings-code-en');

    // Off: asked first, then the copy deleted.
    await remote.press('OK');
    await expect(page.getByTestId('backup-confirm')).toContainText('Turn off backup?');
    await toConfirm(remote, false);
    await shoot(page, 'backup-settings-off-confirm-en');
    const beforeOff = server.backup.requests.length;
    await remote.go('OK', 'backup/switch/0');
    await expect(backup).toHaveAttribute('data-on', 'false');
    await expect(backup).toHaveAttribute('data-busy', '');
    expect(asked(server, beforeOff)).toEqual(['DELETE 200']);
    expect(server.backup.requests[beforeOff]!.lookupId).toBe(lookupId);
    expect(server.backup.blobs.size).toBe(0);
    await expect(page.getByTestId('backup-value')).toHaveText('Off');
    await expect(page.getByTestId('backup-line')).toHaveText('Nothing is sent while it is off.');
    await expect(page.getByTestId('backup-code-box')).toHaveCount(0);
    await shoot(page, 'backup-settings-off-en');
    await appIdle(page);
    expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('off');
    expect(server.backup.requests).toHaveLength(beforeOff + 1);

    // On: no question, a send at once, as a first send.
    await remote.press('OK');
    await expect(backup).toHaveAttribute('data-on', 'true');
    await expect(backup).toHaveAttribute('data-busy', '');
    await remote.expectFocus('backup/switch/0');
    expect(asked(server, beforeOff + 1)).toEqual(['GET 404', 'PUT 200']);
    expect(server.backup.blobs.has(lookupId)).toBe(true);
    await expect(page.getByTestId('backup-code')).toHaveAttribute('data-code', kept as string);
    await expect(page.getByTestId('backup-line')).toContainText('Last backed up ');
  });
  expect(errors).toEqual([]);
});

test('Arabic, a held backup: "Replace it" asks, then sends over it with no GET; the next upload is same', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    await heldBackup(remote, server, 'ar-SA', 'second.m3u');
    const backup = await openBackup(remote, true);
    await expect(backup).toHaveAttribute('data-held', 'true');
    await expect(backup).toHaveAttribute('data-source', 'device');
    await expect(page.getByTestId('backup-code-box')).toHaveCount(0);
    await expect(page.getByTestId('backup-held')).toContainText('توجد على الخادم نسخة احتياطية أخرى لهذا التلفاز');
    await shoot(page, 'backup-settings-held-ar');
    await remote.go('DOWN', 'backup/held/0');
    await remote.go('LEFT', 'backup/held/1');
    await remote.press('OK');
    await expect(page.getByTestId('backup-confirm')).toContainText('استبدال النسخة الاحتياطية على الخادم؟');
    await toConfirm(remote, true);
    await shoot(page, 'backup-settings-replace-confirm-ar');
    const before = server.backup.requests.length;
    await remote.press('OK');
    await expect(backup).toHaveAttribute('data-held', 'false');
    await expect(backup).toHaveAttribute('data-busy', '');
    await remote.expectFocus('backup/switch/0');
    expect(asked(server, before)).toEqual(['PUT 200']);
    await expect(page.getByTestId('backup-line')).toContainText('آخر نسخ احتياطي');
    await shoot(page, 'backup-settings-replaced-ar');
    await appIdle(page);
    expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('same');
    expect(server.backup.requests).toHaveLength(before + 1);
    // The TV's profile is the second playlist's, as sent.
    expect((await stored(page)).current?.urls).toEqual([`${server.origin}/second.m3u`]);
  });
  expect(errors).toEqual([]);
});

test('"Restore it": the app starts again on the held backup, "Welcome back" in its language, the replaced profile in a snapshot and its catalog gone', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    await heldBackup(remote, server, 'en-US', 'second.m3u');
    await expect(page.getByTestId('live')).toContainText('Second Channel');
    const backup = await openBackup(remote, false);
    await expect(backup).toHaveAttribute('data-held', 'true');
    await remote.go('DOWN', 'backup/held/0');
    await remote.press('OK');
    await expect(page.getByTestId('backup-confirm')).toContainText('Restore this backup?');
    await toConfirm(remote, false);
    await shoot(page, 'backup-settings-restore-confirm-en');
    const before = server.backup.requests.length;
    await remote.press('OK');

    // The app starts again: "Welcome back" in the backup's Arabic, then the live list with no key.
    const start = page.getByTestId('backup-start');
    await expect(start).toHaveAttribute('data-screen', 'welcome', { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('restored')).toBe('1');
    await expect(start).toHaveAttribute('data-language', 'ar');
    await expect(page.getByTestId('backup-title')).toHaveText('مرحبًا بعودتك');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await shoot(page, 'backup-settings-welcome-ar');
    expect(asked(server, before)).toEqual(['GET 200']);
    const live = page.getByTestId('live');
    await expect(live).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
    await expect(live).toContainText('Family News');
    await expect(live).not.toContainText('Second Channel');
    await remote.expectFocus('live/channels/0');
    await expect(page.locator('#stage video')).toHaveCount(0);

    const after = await stored(page);
    expect(after.current).toEqual({ language: 'ar', urls: [`${server.origin}/list.m3u`] });
    expect(after.snapshots.filter((s) => s.reason === 'restore')).toEqual([{ reason: 'restore', urls: [`${server.origin}/second.m3u`] }]);
    await appIdle(page);
    expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('same');
  });
  expect(errors).toEqual([]);
});
