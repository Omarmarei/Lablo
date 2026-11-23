import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { stripIsolates } from '../packages/core/src/bidi';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { settled, startWatching, trackErrors, typeInto } from './onboard';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST, toSettingsRow } from './settings-rows';

/**
 * "Restore with a backup code" at the first start (RELAY step 32d3c), against the stand-in API on
 * the test's config server (`?api=`). The browser build reads no device ID without `?device=`,
 * so the backup goes under the backup code, as on a TV after "Not now":
 * - English: onboarding with "Not now" and a playlist, an upload (`sent`), the code read from
 *   Settings › Backup; the TV wiped, onboarding again (no look-up: no device ID), "Not now", the
 *   source screen's last row; a code that isn't one (its problem), one with no backup ("No backup
 *   was found"), then the real one typed in lower case with spaces: "Welcome back", the live list
 *   with the playlist's channels, Settings › Backup showing the same code, and the next upload
 *   `same` (the master kept: no `GET`).
 * - Arabic: the screen right to left with the code left to right, the problem and the answer in
 *   Arabic, and Back while restoring cancels it, back on the field with nothing written.
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const PLAYLIST = '#EXTM3U\n#EXTINF:-1 tvg-id="news" group-title="News",Family News\nhttp://127.0.0.1:9/live/1.ts\n#EXTINF:-1 tvg-id="films" group-title="Films",Film Night\nhttp://127.0.0.1:9/live/2.ts\n';
/** A code the TV could have made, under which the stand-in has no backup. */
const NO_BACKUP = '7ZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZ';

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

/** The stand-in's requests from `from` on: method and status. */
function asked(server: ConfigServer, from = 0): string[] {
  return server.backup.requests.slice(from).map((r) => `${r.method} ${r.status}`);
}

/** The current profile's sources' links (`null`: no profile). */
function storedUrls(page: Page): Promise<string[] | null> {
  return page.evaluate(
    () =>
      new Promise<string[] | null>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('profile').objectStore('profile').get('current');
          read.onsuccess = () => {
            db.close();
            const record = read.result as { doc: { sources?: { url?: string }[] } } | undefined;
            resolve(record === undefined ? null : (record.doc.sources ?? []).map((s) => s.url ?? ''));
          };
          read.onerror = () => reject(read.error);
        };
      }),
  );
}

/** Onboarding from its first screen in `rtl`'s language with "Not now", to the source screen's first row. */
async function toSources(remote: RemoteDriver, rtl: boolean): Promise<Locator> {
  const onboarding = remote.page.getByTestId('onboarding');
  await expect(onboarding).toHaveAttribute('data-ready', 'true');
  await remote.expectFocus(rtl ? 'language/languages/1' : 'language/languages/0');
  await remote.go('OK', 'disclaimer/actions/0');
  await remote.go('OK', 'consent/actions/0');
  // "Not now": the other way along the row (the left in Arabic).
  await remote.go(rtl ? 'LEFT' : 'RIGHT', 'consent/actions/1');
  await remote.go('OK', 'source/types/0');
  return onboarding;
}

/** From the source screen's first row to its last, "Use a backup code", then its screen on the field. */
async function toCodeScreen(remote: RemoteDriver, hint: string, label: string, shot: string): Promise<Locator> {
  for (let i = 1; i <= 3; i += 1) await remote.go('DOWN', `source/types/${i}`);
  await expect(remote.page.getByTestId('type-restore')).toHaveText(label);
  await expect(remote.page.getByTestId('type-hint')).toHaveText(hint);
  await shoot(remote.page, shot);
  await remote.go('OK', 'restore-code/field/0');
  const screen = remote.page.getByTestId('restore-code');
  await expect(screen).toHaveAttribute('data-phase', 'typing');
  return screen;
}

/** Types `text` over what the field holds, as a remote's keyboard would; Enter takes the focus to "Restore". */
async function retype(remote: RemoteDriver, root: Locator, text: string): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', 'onboarding-code');
  await remote.page.keyboard.press('Control+A');
  await remote.page.keyboard.press('Backspace');
  await remote.page.keyboard.type(text);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
  await remote.expectFocus('restore-code/actions/0');
}

/** From the live list: the header's "Settings" (its end), then the "Backup" row. */
async function openBackup(remote: RemoteDriver): Promise<Locator> {
  await remote.go('UP', 'live/header/0');
  for (let i = 1; i <= 5; i += 1) await remote.go('RIGHT', `live/header/${i}`);
  await remote.go('OK', SETTINGS_FIRST);
  await toSettingsRow(remote, 'backup');
  await remote.go('OK', 'backup/switch/0');
  const page = remote.page.getByTestId('backup');
  await expect(page).toHaveAttribute('data-status', 'ready');
  await settled(remote.page.getByTestId('settings-screen'), 20_000);
  return page;
}

test('English: the code from Settings typed after a wipe brings the sources back; a wrong code and one with no backup say so', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    const host = server.origin.replace(/^http:\/\//, '');
    // Onboarding with "Not now" and a playlist; an upload under the backup code.
    await page.goto(`/?api=${server.origin}&locale=en-US`);
    const first = await toSources(remote, false);
    await remote.go('DOWN', 'source/types/1');
    await remote.go('OK', 'form/fields/0');
    await typeInto(remote, first, 'playlist', `${host}/list.m3u`);
    await remote.go('DOWN', 'form/fields/2');
    await remote.go('DOWN', 'form/actions/0');
    await startWatching(remote, first, 20_000);
    await appIdle(page);
    expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('sent');
    expect(asked(server)).toEqual(['GET 404', 'PUT 200']);
    const backup = await openBackup(remote);
    await expect(backup).toHaveAttribute('data-source', 'code');
    const code = (await page.getByTestId('backup-code').getAttribute('data-code')) ?? '';
    expect(code).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);

    // The TV wiped: onboarding again, with no look-up (no device ID).
    await wipe(page);
    const before = server.backup.requests.length;
    await page.goto(`/?api=${server.origin}&locale=en-US`);
    const onboarding = await toSources(remote, false);
    expect(server.backup.requests).toHaveLength(before);
    const screen = await toCodeScreen(remote, 'If Lablo backed up your sources before, type the code it showed', 'Use a backup code', 'backup-code-sources-en');
    await expect(page.getByTestId('onboarding-title')).toHaveText('Restore with a backup code');
    // Settings' and Backup's names are isolated arguments.
    expect(stripIsolates((await screen.textContent()) ?? '')).toContain('Type the code you noted down from Backup in Settings. It has 26 letters and digits.');
    await expect(page.locator('#onboarding-code')).toHaveAttribute('dir', 'ltr');

    // Too short: its problem under the field, the focus back on it, nothing asked.
    await typeInto(remote, onboarding, 'code', code.slice(0, 20).toLowerCase());
    await expect(page.locator('#onboarding-code')).toHaveValue(code.slice(0, 20).replace(/(.{4})(?=.)/g, '$1 '));
    await remote.go('OK', 'restore-code/field/0');
    await expect(screen).toHaveAttribute('data-problem', 'length');
    await expect(screen).toContainText('A backup code has 26 letters and digits. Check that none is missing or extra.');
    expect(server.backup.requests).toHaveLength(before);
    await shoot(page, 'backup-code-problem-en');

    // A code with no backup: the stand-in's 404, said under the field, the focus on it again.
    await retype(remote, onboarding, NO_BACKUP.toLowerCase());
    await expect(screen).toHaveAttribute('data-problem', '');
    await remote.press('OK');
    await expect(screen).toHaveAttribute('data-notice', 'none', { timeout: 20_000 });
    await expect(page.getByTestId('restore-notice')).toHaveText('No backup was found for this code. Check it and try again.');
    await remote.expectFocus('restore-code/field/0');
    expect(asked(server, before)).toEqual(['GET 404']);
    await shoot(page, 'backup-code-none-en');

    // The real code in lower case with spaces: "Opening your backup", then the app starts again.
    const typed = code.toLowerCase().replace(/(.{4})/g, '$1 ');
    await retype(remote, onboarding, typed);
    await expect(page.locator('#onboarding-code')).toHaveValue(code.replace(/(.{4})(?=.)/g, '$1 '));
    const release = server.backup.holdGets();
    await remote.press('OK');
    await expect(screen).toHaveAttribute('data-phase', 'restoring');
    await remote.expectFocus('restore-code/actions/0');
    await expect(page.getByTestId('onboarding-title')).toHaveText('Opening your backup…');
    await expect.poll(() => server.backup.held()).toBe(1);
    await shoot(page, 'backup-code-restoring-en');
    release();

    const start = page.getByTestId('backup-start');
    await expect(start).toHaveAttribute('data-screen', 'welcome', { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('restored')).toBe('1');
    await expect(page.getByTestId('backup-title')).toHaveText('Welcome back');
    expect(asked(server, before)).toEqual(['GET 404', 'GET 200']);
    const live = page.getByTestId('live');
    await expect(live).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
    await expect(live).toContainText('Family News');
    await remote.expectFocus('live/channels/0');
    expect(await storedUrls(page)).toEqual([`${server.origin}/list.m3u`]);

    // The same code is the TV's own again, and its master is kept: the next upload sends nothing.
    const again = await openBackup(remote);
    await expect(again).toHaveAttribute('data-source', 'code');
    await expect(page.getByTestId('backup-code')).toHaveAttribute('data-code', code);
    await appIdle(page);
    const settledAt = server.backup.requests.length;
    expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('same');
    expect(server.backup.requests).toHaveLength(settledAt);
  });
  expect(errors).toEqual([]);
});

test('Arabic: the screen right to left with the code left to right; Back while restoring cancels it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    await page.goto(`/?api=${server.origin}&locale=ar-SA`);
    const onboarding = await toSources(remote, true);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const screen = await toCodeScreen(remote, 'إن سبق أن نسخ لابلو مصادرك احتياطيًا، فاكتب الرمز الذي عرضه', 'استخدم رمزًا احتياطيًا', 'backup-code-sources-ar');
    await expect(page.getByTestId('onboarding-title')).toHaveText('الاستعادة برمز احتياطي');
    const input = page.locator('#onboarding-code');
    await expect(input).toHaveAttribute('dir', 'ltr');

    // A character no code has: its problem in Arabic.
    await typeInto(remote, onboarding, 'code', 'u'.repeat(26));
    await remote.go('OK', 'restore-code/field/0');
    await expect(screen).toHaveAttribute('data-problem', 'invalid');
    await expect(screen).toContainText('هذا ليس رمزًا احتياطيًا. قارنه بالرمز الذي دوّنته.');

    // A code with no backup: the answer in Arabic; the code itself drawn left to right.
    await retype(remote, onboarding, NO_BACKUP);
    await remote.press('OK');
    await expect(screen).toHaveAttribute('data-notice', 'none', { timeout: 20_000 });
    await expect(page.getByTestId('restore-notice')).toHaveText('لم يُعثر على نسخة احتياطية لهذا الرمز. تحقّق منه وحاول مرة أخرى.');
    await expect(input).toHaveValue(NO_BACKUP);
    const box = await input.boundingBox();
    const label = await page.locator('.z-field__label').first().boundingBox();
    // Right to left: the label at the right, the box to its left; the code inside it left to right.
    expect(label!.x).toBeGreaterThan(box!.x);
    expect(await input.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
    await shoot(page, 'backup-code-none-ar');

    // Back while restoring: the worker cancelled, the field again, nothing written.
    await remote.go('DOWN', 'restore-code/actions/0');
    const release = server.backup.holdGets();
    await remote.press('OK');
    await expect(screen).toHaveAttribute('data-phase', 'restoring');
    await expect(page.getByTestId('onboarding-title')).toHaveText('جارٍ فتح نسختك الاحتياطية…');
    await expect.poll(() => server.backup.held()).toBe(1);
    await shoot(page, 'backup-code-restoring-ar');
    await remote.press('BACK');
    await expect(screen).toHaveAttribute('data-phase', 'typing');
    await remote.expectFocus('restore-code/actions/0');
    await expect(screen).toHaveAttribute('data-notice', '');
    release();
    await appIdle(page);
    await expect(screen).toHaveAttribute('data-phase', 'typing');
    expect(await storedUrls(page)).toEqual([]);
    // Back again: the source screen on the row.
    await remote.go('BACK', 'source/types/3');
  });
  expect(errors).toEqual([]);
});
