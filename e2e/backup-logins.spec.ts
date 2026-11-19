import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { stripIsolates } from '@lablo/core';
import { backupKeys, deriveBackupMaster, openBackup } from '@lablo/crypto';
import { readBackupPlain, readEnvelope } from '@lablo/data';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { appIdFor } from '../tv-defines.config';
import type { ApiFront, Received } from './api-front';
import { startApiFront } from './api-front';
import { catalog } from './live-rows';
import { leaks } from './no-plaintext';
import { addM3uAndWatch, addXtreamAndWatch, settled, trackErrors } from './onboard';
import { SHOTS, shoot } from './pairing-steps';
import { RemoteDriver } from './remote-driver';

/**
 * "Include logins and links" off, and the way back (RELAY step 32d4b), against the real API: the
 * TV's dev app with a test device ID, `next start` with `lablo_e2e` through the test front, the
 * mock provider.
 * 1. Onboarding adds the source (English: an Xtream login; Arabic: an M3U link).
 * 2. Settings › Backup's second row, off: the edit, then a send at once (`GET 404`, `PUT 200`),
 *    no question asked. The envelope, opened here with keys derived from the same device ID,
 *    holds the source's server or origin and no login, no link, and `backupLogins: false`; the
 *    TV still has the login. The next upload is `same`.
 * 3. The wipe, a start with no key: "Welcome back" says one source needs its login again, then
 *    Settings › Sources opens by itself, the row marked "Needs its login" ("Needs its link").
 * 4. OK opens the form (English: a wrong password first, the row says the provider refused it,
 *    OK opens the form again); "Save": the row updates, Back twice, the live list has the
 *    channels again.
 * 5. A channel played (its stream URL, with the login, kept as the one played last), then an
 *    upload that sends: the envelope still holds no login, its last channel no URL.
 */

/** The real API (`next start`), as playwright.web.config.ts starts it. */
const API = `http://127.0.0.1:${Number(process.env.LABLO_WEB_E2E_PORT ?? 3101)}`;
/** The dev app's build is the browser platform; its app id is the webOS build's (`appIdFor`). */
const BUILD = { platform: 'browser', appId: appIdFor('webos') } as const;

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

let fronts = 0;

async function withFront(run: (front: ApiFront) => Promise<void>): Promise<void> {
  fronts += 1;
  const front = await startApiFront({ upstream: API, address: `10.252.${test.info().workerIndex % 250}.${fronts % 250}` });
  try {
    await run(front);
  } finally {
    await front.close();
  }
}

/** The backup requests the real API answered, as `<method> <status>` (no preflights). */
function backupCalls(front: ApiFront): string[] {
  return front.forwarded.filter((f) => f.path.startsWith('/v1/backup/') && f.method !== 'OPTIONS').map((f) => `${f.method} ${f.status}`);
}

/** No config run and no backup worker in the database. */
async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

type Doc = Record<string, unknown> & { sources: Array<Record<string, unknown>> };

/** The stored profile document, whole (`null`: none). */
function storedDoc(page: Page): Promise<Doc | null> {
  return page.evaluate(
    () =>
      new Promise<Doc | null>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: Doc } | undefined;
            resolve(record === undefined ? null : record.doc);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The TV's app data wiped: the database deleted from the gallery page, which opens none. */
async function wipe(page: Page): Promise<void> {
  await appIdle(page);
  await page.goto('/?screen=gallery');
  await expect(page.getByTestId('gallery')).toBeVisible();
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

/** The `PUT`s the TV sent under `lookupId`. */
function puts(front: ApiFront, lookupId: string): Received[] {
  return front.received.filter((r) => r.method === 'PUT' && r.path === `/v1/backup/${lookupId}`);
}

/** A `PUT`'s envelope, opened with the TV's key. */
function opened(put: Received, encKey: Uint8Array): Doc {
  const envelope = readEnvelope(put.body.toString('utf8'));
  expect(envelope).not.toBeNull();
  const plain = openBackup(envelope!, encKey);
  expect(plain).not.toBeNull();
  return readBackupPlain(plain!) as Doc;
}

/** What a login looks like in a document: the password, the user name as a value, and a link's login parts. */
const LOGIN_NEEDLES = [P, `"${U}"`, `username=${U}`, `password=${P}`, `/${U}/${P}/`];

const SAYS = {
  en: {
    locale: 'en-US',
    welcome: 'Welcome back',
    welcomeLine: 'One source needs its login or link again: Sources in Settings opens next.',
    rowName: 'Include logins and links',
    out: 'Logins and links stay on this TV: after a restore, you type them again.',
    needs: 'Needs its login again',
    refused: "The provider didn't accept this username and password.",
  },
  ar: {
    locale: 'ar-SA',
    welcome: 'مرحبًا بعودتك',
    welcomeLine: 'يحتاج مصدر واحد إلى بيانات الدخول أو الرابط مرة أخرى: تُفتح المصادر في الإعدادات بعد ذلك.',
    rowName: 'تضمين بيانات الدخول والروابط',
    out: 'تبقى بيانات الدخول والروابط على هذا التلفاز: بعد الاستعادة، تكتبها مرة أخرى.',
    needs: 'يحتاج إلى رابطه مرة أخرى',
    refused: '',
  },
} as const;

const m3uLink = (): string => `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`;

/** OK on the focused field of the login form, `text` typed over what it held, OK again. */
async function typeIn(remote: RemoteDriver, root: Locator, field: string, text: string): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', `source-login-${field}`);
  await remote.page.keyboard.press('Control+A');
  await remote.page.keyboard.type(text);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
}

/** From the live list: the header's "Settings" (its end: the left in Arabic), then "Backup", the third row. */
async function openBackupPage(remote: RemoteDriver, rtl: boolean): Promise<Locator> {
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

/** A source row's status line, as read (isolates out). */
async function statusOf(page: Page, index: number): Promise<string> {
  return stripIsolates((await page.getByTestId(`source-${index}-status`).textContent()) ?? '');
}

for (const language of ['en', 'ar'] as const) {
  test(`a backup without logins: off sends at once, the envelope holds none, "Welcome back" says so and the sources screen gives them back (${language})`, async ({ page }) => {
    test.setTimeout(240_000);
    const says = SAYS[language];
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const device = `e2e-api-32d4b-${language}`;
    await withFront(async (front) => {
      const query = `device=${device}&api=${encodeURIComponent(front.origin)}&locale=${says.locale}`;
      const keys = backupKeys(await deriveBackupMaster(device, BUILD.platform, BUILD.appId));
      if (language === 'en') await addXtreamAndWatch(remote, { host, username: U, password: P }, query);
      else await addM3uAndWatch(remote, m3uLink().replace(/^http:\/\//, ''), query, 30_000);
      expect(backupCalls(front)).toEqual(['GET 404']);
      await appIdle(page);

      // Settings › Backup: the second row, on; off with no question, and a send at once.
      const backup = await openBackupPage(remote, language === 'ar');
      await expect(backup).toHaveAttribute('data-logins', 'true');
      await expect(page.getByTestId('backup-logins')).toContainText(says.rowName);
      await remote.go('DOWN', 'backup/switch/1');
      await remote.press('OK');
      await expect(backup).toHaveAttribute('data-logins', 'false', { timeout: 20_000 });
      await expect(backup).toHaveAttribute('data-busy', '');
      await remote.expectFocus('backup/switch/1');
      await expect(page.getByTestId('backup-logins-line')).toHaveText(says.out);
      await shoot(page, `backup-logins-off-${language}`);
      await appIdle(page);
      expect(backupCalls(front)).toEqual(['GET 404', 'GET 404', 'PUT 200']);

      // The envelope: the source's server or origin, no login, no link, the choice; the TV keeps them.
      const sent = puts(front, keys.lookupId);
      expect(sent).toHaveLength(1);
      const first = opened(sent[0]!, keys.encKey);
      expect(first.backupLogins).toBe(false);
      expect(first.sources).toHaveLength(1);
      if (language === 'en') expect(first.sources[0]).toMatchObject({ id: 's1', type: 'xtream', account: null, base: `http://${host}` });
      else expect(first.sources[0]).toMatchObject({ id: 's1', type: 'm3u', url: null, origin: `http://${host}` });
      expect(leaks(JSON.stringify(first), LOGIN_NEEDLES)).toEqual([]);
      const kept = (await storedDoc(page))!;
      expect(kept.backupLogins).toBe(false);
      expect(leaks(JSON.stringify(kept), [P])).toEqual([P]);
      // Nothing changed since: the next upload sends nothing.
      expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('same');
      expect(backupCalls(front)).toHaveLength(3);

      // The wipe, then a start with no key: "Welcome back" with its line, then the sources screen.
      await wipe(page);
      await page.goto(`/?${query}`);
      const start = page.getByTestId('backup-start');
      await expect(start).toHaveAttribute('data-screen', 'welcome', { timeout: 30_000 });
      await expect(start).toHaveAttribute('data-logins', '1');
      await expect(page.getByTestId('backup-title')).toHaveText(says.welcome);
      expect(stripIsolates((await page.getByTestId('backup-logins').textContent()) ?? '')).toBe(says.welcomeLine);
      await shoot(page, `backup-logins-welcome-${language}`);
      const sources = page.getByTestId('sources');
      await expect(sources).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      await expect(sources).toHaveAttribute('data-needs', '1');
      await remote.expectFocus('sources/sources/0');
      const row = page.getByTestId('source-0');
      await expect(row).toHaveAttribute('data-needs', language === 'en' ? 'login' : 'link');
      expect(await statusOf(page, 0)).toBe(says.needs);
      await expect(page.getByTestId('source-0-status')).toHaveClass('guides__failure');
      await shoot(page, `backup-logins-sources-${language}`);
      expect(backupCalls(front)).toEqual(['GET 404', 'GET 404', 'PUT 200', 'GET 200']);
      const restored = (await storedDoc(page))!;
      expect(restored.backupLogins).toBe(false);
      expect(restored.sources).toEqual(first.sources);

      // The form, its login given back.
      const root = page.getByTestId('settings-screen');
      if (language === 'en') {
        await remote.go('OK', 'source-login/fields/1');
        await expect(page.getByTestId('source-login-server').locator('input')).toHaveValue(`http://${host}`);
        await shoot(page, 'backup-logins-form-en');
        await typeIn(remote, root, 'username', U);
        await remote.expectFocus('source-login/fields/2');
        await typeIn(remote, root, 'password', 'not-the-password');
        await remote.expectFocus('source-login/actions/0');
        await remote.press('OK');
        await remote.expectFocus('sources/sources/0');
        await expect(row).toHaveAttribute('data-answer', 'failed', { timeout: 30_000 });
        await expect(row).toHaveAttribute('data-code', 'auth');
        await expect(row).toHaveAttribute('data-needs', '');
        expect(await statusOf(page, 0)).toBe(says.refused);
        await shoot(page, 'backup-logins-refused-en');
        // OK opens the form again, with what was typed.
        await remote.go('OK', 'source-login/fields/0');
        await expect(page.getByTestId('source-login-username').locator('input')).toHaveValue(U);
        await remote.go('DOWN', 'source-login/fields/1');
        await remote.go('DOWN', 'source-login/fields/2');
        await typeIn(remote, root, 'password', P);
      } else {
        await remote.go('OK', 'source-login/fields/0');
        expect(stripIsolates((await page.getByTestId('source-login-playlist').locator('.z-field__note').textContent()) ?? '')).toBe(`كان على ${host}`);
        await shoot(page, 'backup-logins-form-ar');
        await typeIn(remote, root, 'playlist', m3uLink().replace(/^http:\/\//, ''));
      }
      await remote.expectFocus('source-login/actions/0');
      await remote.press('OK');
      await remote.expectFocus('sources/sources/0');
      await expect(row).toHaveAttribute('data-answer', '', { timeout: 30_000 });
      await expect(row).not.toHaveAttribute('data-checked', '');
      await expect(page.getByTestId('source-0-status')).toHaveClass('guides__status');
      await settled(root, 30_000);
      await shoot(page, `backup-logins-updated-${language}`);
      const given = (await storedDoc(page))!;
      expect(given.backupLogins).toBe(false);
      expect(leaks(JSON.stringify(given.sources), [P])).toEqual([P]);

      // Back to the live list: the channels are back.
      await remote.go('BACK', 'settings/items/1');
      await remote.press('BACK');
      const live = page.getByTestId('live');
      await expect(live).toBeVisible();
      await expect(live).toContainText(catalog.live[0]!.name, { timeout: 30_000 });
      await remote.expectFocus('live/channels/0');

      // A channel played: its stream URL (with the login) is kept with it; the next send still holds no login.
      await remote.press('OK');
      await expect.poll(async () => ((await storedDoc(page))?.player as { last?: unknown } | undefined)?.last ?? null, { timeout: 20_000 }).not.toBeNull();
      await remote.press('BACK');
      await appIdle(page);
      expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('sent');
      const next = puts(front, keys.lookupId);
      expect(next).toHaveLength(2);
      const second = opened(next[1]!, keys.encKey);
      expect(second.backupLogins).toBe(false);
      expect(leaks(JSON.stringify(second), LOGIN_NEEDLES)).toEqual([]);
      expect(((second.player as { last: { item: { url: string } } }).last.item.url)).toBe('');
      expect(second.sources).toEqual(first.sources);
      await appIdle(page);
    });
    expect(errors).toEqual([]);
  });
}
