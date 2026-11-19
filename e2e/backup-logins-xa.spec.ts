import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addM3uAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The screens 32d4b added, in the pseudo-locale (en-XA: every string of ours bracketed and
 * stretched), against the stand-in API on the test's config server: Settings › Backup's second
 * row; then a profile whose playlist lost its link (as a backup without logins brings it back,
 * written into the stored profile) started with `restored=1`: "Welcome back" with its line, the
 * sources screen it opens, the row's mark, and the login form with a problem shown; then (step
 * 32d4c) TV guides: a guide's mark, its menu, and its link form with a problem shown; and (step
 * 33b3) Settings' "Usage and crash reports" row, on and off. Each: no text
 * of ours unbracketed, no name, label or button cut. Screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const DEVICE = 'e2e-tv-32d4b-xa';
const PLAYLIST = '#EXTM3U\n#EXTINF:-1 tvg-id="news" group-title="News",Family News\nhttp://127.0.0.1:9/live/1.ts\n';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** No config run and no backup worker in the database. */
async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

/** The texts under `selector` that are neither bracketed (ours, en-XA) nor data, nor numbers. */
function unbracketed(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(text) || node.parentElement?.closest('[translate="no"]') != null) continue;
      // An input's value is data (the link typed); its label and note are ours.
      if (node.parentElement?.closest('input') != null) continue;
      if (!(text.startsWith('[') && text.endsWith(']'))) out.push(text);
    }
    return out;
  }, selector);
}

/** Names, labels and buttons under `selector` whose text is cut (the status lines may end in an ellipsis). */
function cut(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    return Array.from(root.querySelectorAll<HTMLElement>('.settings__name, .settings__title, .settings__value, .backup__value, .z-field__label, .z-field__note, .z-button, .z-dialog__title, .z-dialog__message, .onboarding__title, .onboarding__note, .sources__name'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent ?? '');
  }, selector);
}

/** The stored profile's playlist without its link, as a backup made without logins brings it back. */
function dropLink(page: Page, origin: string): Promise<void> {
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
            const record = req.result as { doc: { sources: Record<string, unknown>[] } & Record<string, unknown> };
            const source = record.doc.sources[0]!;
            source['url'] = null;
            source['origin'] = kept;
            // A guide of the user's without its link too (step 32d4c).
            record.doc['guides'] = [{ id: 's1', url: null, origin: kept }];
            record.doc['backupLogins'] = false;
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

test('shows the logins row, "Welcome back"’s line, the sources row and its form, bracketed and uncut, in the pseudo-locale (en-XA)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const server: ConfigServer = await startConfigServer(devSignedAnswer(doc()));
  server.file('/list.m3u', PLAYLIST, 'audio/x-mpegurl');
  try {
    const host = server.origin.replace(/^http:\/\//, '');
    const query = `device=${DEVICE}&api=${server.origin}&locale=en-XA`;
    await addM3uAndWatch(remote, `${host}/list.m3u`, query);
    await appIdle(page);

    // Settings › Backup: the second row, its line.
    await remote.go('UP', 'live/header/0');
    for (let i = 1; i <= 5; i += 1) await remote.go('RIGHT', `live/header/${i}`);
    await remote.go('OK', 'settings/items/0');
    const settings = page.getByTestId('settings-screen');
    await expect(settings).toHaveAttribute('data-language', 'pseudo');
    await remote.go('DOWN', 'settings/items/1');
    await remote.go('DOWN', 'settings/items/2');
    // Settings' fourth row (step 33b3): "Usage and crash reports" on, then off, then on again.
    await remote.go('DOWN', 'settings/items/3');
    const reports = page.getByTestId('settings-telemetry');
    await expect(reports).toHaveAttribute('data-value', 'true');
    await settled(settings, 20_000);
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=settings-screen]')).toEqual([]);
    await shoot(page, 'telemetry-row-en-XA');
    await remote.go('OK', 'settings/items/3');
    await expect(reports).toHaveAttribute('data-value', 'false');
    await settled(settings, 20_000);
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=settings-screen]')).toEqual([]);
    await shoot(page, 'telemetry-row-off-en-XA');
    await remote.go('OK', 'settings/items/3');
    await expect(reports).toHaveAttribute('data-value', 'true');
    await settled(settings, 20_000);
    // Settings' fifth row (step 33d2): "Send a report to support", then its code (data: not bracketed).
    await remote.go('DOWN', 'settings/items/4');
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=settings-screen]')).toEqual([]);
    await remote.go('OK', 'settings/items/4');
    await expect(page.getByTestId('settings-report')).toHaveAttribute('data-report', 'sent');
    await settled(settings, 20_000);
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=settings-screen]')).toEqual([]);
    await shoot(page, 'report-row-en-XA');
    await remote.go('UP', 'settings/items/3');
    await remote.go('UP', 'settings/items/2');
    await remote.go('OK', 'backup/switch/0');
    await expect(page.getByTestId('backup')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('backup-logins')).toBeVisible();
    await settled(settings, 20_000);
    await remote.go('DOWN', 'backup/switch/1');
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=settings-screen]')).toEqual([]);
    await shoot(page, 'backup-logins-row-en-XA');

    // A playlist without its link, then a start after a restore.
    await appIdle(page);
    await page.goto('/?screen=gallery');
    await expect(page.getByTestId('gallery')).toBeVisible();
    await dropLink(page, server.origin);
    await page.goto(`/?restored=1&${query}`);
    const start = page.getByTestId('backup-start');
    await expect(start).toHaveAttribute('data-screen', 'welcome');
    await expect(start).toHaveAttribute('data-logins', '1');
    await expect(start).toHaveAttribute('data-guides', '1');
    await expect(page.getByTestId('backup-guides')).toBeVisible();
    await expect(start).toHaveAttribute('data-language', 'pseudo');
    expect(await unbracketed(page, '[data-testid=backup-start]')).toEqual([]);
    expect(await cut(page, '[data-testid=backup-start]')).toEqual([]);
    await shoot(page, 'backup-logins-welcome-en-XA');
    await remote.press('OK');

    // The sources screen, opened by "Welcome back": the row's mark.
    const sources = page.getByTestId('sources');
    await expect(sources).toHaveAttribute('data-status', 'ready');
    await expect(sources).toHaveAttribute('data-needs', '1');
    await remote.expectFocus('sources/sources/0');
    await expect(page.getByTestId('source-0')).toHaveAttribute('data-needs', 'link');
    await settled(settings, 20_000);
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=settings-screen]')).toEqual([]);
    await shoot(page, 'backup-logins-sources-en-XA');

    // Its form, "Save" with the link empty: the problem under the field.
    await remote.go('OK', 'source-login/fields/0');
    await remote.go('DOWN', 'source-login/actions/0');
    await remote.go('OK', 'source-login/fields/0');
    await expect(page.getByTestId('source-login-playlist')).toHaveClass(/is-invalid/);
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=source-login]')).toEqual([]);
    await shoot(page, 'backup-logins-form-en-XA');
    await remote.go('BACK', 'sources/sources/0');

    // TV guides (step 32d4c): the guide's mark, its menu, its link form with a problem shown.
    await remote.go('BACK', 'settings/items/1');
    await remote.go('UP', 'settings/items/0');
    await remote.go('OK', 'guides/guides/0');
    await expect(page.getByTestId('guides')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('guide-0')).toHaveAttribute('data-needs', 'true');
    await settled(settings, 20_000);
    expect(await unbracketed(page, '[data-testid=settings-screen]')).toEqual([]);
    expect(await cut(page, '[data-testid=settings-screen]')).toEqual([]);
    await shoot(page, 'backup-logins-guide-en-XA');
    await remote.go('OK', 'guide-menu/actions/0');
    expect(await unbracketed(page, '[data-testid=guide-menu]')).toEqual([]);
    expect(await cut(page, '[data-testid=guide-menu]')).toEqual([]);
    await shoot(page, 'backup-logins-guide-menu-en-XA');
    await remote.go('OK', 'guide-add/field/0');
    await remote.go('DOWN', 'guide-add/actions/0');
    await remote.go('OK', 'guide-add/field/0');
    await expect(page.getByTestId('guide-add-link')).toHaveClass(/is-invalid/);
    expect(await unbracketed(page, '[data-testid=guide-add]')).toEqual([]);
    expect(await cut(page, '[data-testid=guide-add]')).toEqual([]);
    await shoot(page, 'backup-logins-guide-form-en-XA');
    await remote.go('BACK', 'guides/guides/0');
  } finally {
    await server.close();
  }
  expect(errors).toEqual([]);
});
