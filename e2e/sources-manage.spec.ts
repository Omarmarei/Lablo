import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { stripIsolates } from '../packages/core/src/bidi';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { openSources } from './pairing-steps';
import { restartWith } from './profile-edit';
import { RemoteDriver } from './remote-driver';

/**
 * Sources on the TV (RELAY step 40f), in English, Arabic and the pseudo-locale: a source's menu,
 * its removal (the confirm names the favourites that go, "Cancel" has the focus, Back removes
 * nothing; "Remove" takes the catalog, the favourites, the lists' keys and the record), and "Add a
 * source" typed on the TV (the form's checks, a refused login with "Edit details", a good one
 * with the counts), against the mock panel. Every dialog sits inside the safe area. Screenshots
 * go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

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

interface Stored {
  readonly sources: Array<{ id: string }>;
  readonly favourites: Array<{ key: string; src: string }>;
  readonly favouriteLists?: Array<{ id: string; keys: string[] }>;
}

/** The stored profile and how many catalog chunks each source has. */
function stored(page: Page): Promise<{ doc: Stored; chunks: Record<string, number> }> {
  return page.evaluate(
    () =>
      new Promise<{ doc: Stored; chunks: Record<string, number> }>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['profile', 'catalog_chunks'], 'readonly');
          const profile = tx.objectStore('profile').get('current');
          const keys = tx.objectStore('catalog_chunks').getAllKeys();
          tx.oncomplete = () => {
            db.close();
            const chunks: Record<string, number> = {};
            for (const key of keys.result as unknown[][]) chunks[String(key[0])] = (chunks[String(key[0])] ?? 0) + 1;
            resolve({ doc: (profile.result as { doc: Stored }).doc, chunks });
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function text(locator: Locator): Promise<string> {
  return stripIsolates((await locator.textContent()) ?? '');
}

async function inSafeArea(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(SAFE.left);
  expect(box!.y).toBeGreaterThanOrEqual(SAFE.top);
  expect(box!.x + box!.width).toBeLessThanOrEqual(SAFE.right);
  expect(box!.y + box!.height).toBeLessThanOrEqual(SAFE.bottom);
}

/** OK on the focused field of the add form, `value` typed, OK again. */
async function typeIn(remote: RemoteDriver, root: Locator, field: string, value: string): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', `source-add-${field}`);
  await remote.page.keyboard.press('Control+A');
  await remote.page.keyboard.type(value);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
}

for (const { locale, language } of [
  { locale: 'en-US', language: 'en' },
  { locale: 'ar-SA', language: 'ar' },
  { locale: 'en-XA', language: 'en' },
] as const) {
  const words = locale === 'ar-SA' ? AR : locale === 'en-US' ? EN : null;
  const next = language === 'ar' ? 'LEFT' : 'RIGHT';
  const previous = language === 'ar' ? 'RIGHT' : 'LEFT';

  test(`removes a source after a confirm that names its favourites, and takes everything with it (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    // Two favourites of the source, both in one list, written into the profile; the app starts again on it.
    const key = (n: number): string => `x:s1:live:${n}`;
    const ref = (n: number): Record<string, unknown> => ({ key: key(n), src: 's1', kind: 'live', normName: `channel ${n}`, added: n, missingSince: null });
    await restartWith(page, { favourites: [ref(1), ref(2)], favouriteLists: [{ id: 'f1', name: null, keys: [key(1), key(2)] }] }, `/?locale=${locale}`);
    await settled(page.getByTestId('live'));
    const before = await stored(page);
    expect(before.doc.sources.map((s) => s.id)).toEqual(['s1']);
    expect(before.chunks['s1']).toBeGreaterThan(0);

    const root = await openSources(remote, language);
    await expect(page.getByTestId('sources')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '1');

    await test.step("OK on the row: its menu, \"Change server and login\" first, \"Remove\" in red", async () => {
      await remote.go('OK', 'source-menu/actions/0');
      const menu = page.getByTestId('source-menu');
      await expect(menu).toBeVisible();
      await expect(page.getByTestId('source-menu-edit')).toBeVisible();
      await expect(page.getByTestId('source-menu-remove')).toBeVisible();
      await expect(page.getByTestId('source-menu-cancel')).toBeVisible();
      if (words !== null) {
        expect(await text(page.getByTestId('source-menu-edit'))).toBe(stripIsolates(words['sources.editLogin']));
        expect(await text(page.getByTestId('source-menu-remove'))).toBe(stripIsolates(words['sources.remove']));
      }
      // (The dialog's own box is the whole screen: its buttons are what must sit in the safe area.)
      for (const id of ['edit', 'remove', 'cancel']) await inSafeArea(page.getByTestId(`source-menu-${id}`));
      await shoot(page, `sources-menu-${locale}`);
      // Back closes it, nothing changed.
      await remote.go('BACK', 'sources/sources/0');
    });

    await test.step('the confirm: the favourites that go are named, "Cancel" has the focus, Back removes nothing', async () => {
      await remote.go('OK', 'source-menu/actions/0');
      await remote.go('DOWN', 'source-menu/actions/1');
      await remote.go('OK', 'source-remove/actions/1');
      const dialog = page.getByTestId('source-remove');
      await expect(dialog).toBeVisible();
      if (locale === 'en-US') {
        expect(await text(dialog)).toContain('Remove ');
        expect(await text(dialog)).toContain('and 2 favourites with them');
      }
      if (locale === 'ar-SA') expect(await text(dialog)).toContain('مفضلتان');
      for (const id of ['confirm', 'cancel']) await inSafeArea(page.getByTestId(`source-remove-${id}`));
      await shoot(page, `sources-remove-${locale}`);
      await remote.go('BACK', 'sources/sources/0');
      expect((await stored(page)).doc.sources).toHaveLength(1);
    });

    await test.step('"Remove": the row says so, then the source, its catalog, favourites and list keys are gone', async () => {
      await remote.go('OK', 'source-menu/actions/0');
      await remote.go('DOWN', 'source-menu/actions/1');
      await remote.go('OK', 'source-remove/actions/1');
      await remote.go(previous, 'source-remove/actions/0');
      await remote.press('OK');
      await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '0', { timeout: 30_000 });
      await settled(root, 20_000);
      const after = await stored(page);
      expect(after.doc.sources).toEqual([]);
      expect(after.doc.favourites).toEqual([]);
      expect(after.doc.favouriteLists!.map((l) => l.keys)).toEqual([[]]);
      expect(after.chunks['s1']).toBeUndefined();
      await shoot(page, `sources-removed-${locale}`);
    });
    expect(errors).toEqual([]);
  });

  test(`adds a source typed on the TV: the checks, a refused login, then the counts, the other source untouched (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    const root = await openSources(remote, language);
    await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '1');

    await test.step('the header has "Add a source" after "Add from your phone"', async () => {
      await remote.go('UP', 'sources/header/0');
      await expect(page.getByTestId('sources-add-phone')).toBeVisible();
      await remote.go(next, 'sources/header/1');
      const button = page.getByTestId('sources-add');
      await expect(button).toBeVisible();
      if (words !== null) expect(await text(button)).toBe(stripIsolates(words['sources.add']));
      await inSafeArea(button);
      await remote.go('OK', 'source-add/fields/0');
    });

    await test.step('the form: its kind, its fields, "Add" with nothing typed shows the problems', async () => {
      const add = page.getByTestId('source-add');
      await expect(add).toHaveAttribute('data-view', 'form');
      await expect(add).toHaveAttribute('data-type', 'xtream');
      for (const field of ['server', 'username', 'password', 'epg', 'name']) await expect(page.getByTestId(`source-add-${field}`)).toBeVisible();
      await shoot(page, `sources-add-form-${locale}`);
      await inSafeArea(add.locator('.z-button').last());
      // The kind: M3U has its own fields; back to Xtream.
      await remote.go('UP', 'source-add/type/0');
      await remote.go(next, 'source-add/type/1');
      await remote.press('OK');
      await expect(add).toHaveAttribute('data-type', 'm3u');
      await expect(page.getByTestId('source-add-playlist')).toBeVisible();
      await expect(page.getByTestId('source-add-server')).toHaveCount(0);
      await remote.go(previous, 'source-add/type/0');
      await remote.press('OK');
      await expect(add).toHaveAttribute('data-type', 'xtream');
      await remote.go('DOWN', 'source-add/fields/0');
      for (let i = 1; i <= 4; i += 1) await remote.go('DOWN', `source-add/fields/${i}`);
      await remote.go('DOWN', 'source-add/actions/0');
      await remote.press('OK');
      await remote.expectFocus('source-add/fields/0');
      await expect(page.getByTestId('source-add-server')).toHaveClass(/is-invalid/);
      await expect(page.getByTestId('source-add-username')).toHaveClass(/is-invalid/);
      await shoot(page, `sources-add-problems-${locale}`);
    });

    await test.step('a login the panel refuses: the reason, then "Edit details" returns to the form with what was typed', async () => {
      // (Typing a field's last key moves the focus to the next field.)
      await typeIn(remote, root, 'server', host);
      await remote.expectFocus('source-add/fields/1');
      await typeIn(remote, root, 'username', U);
      await remote.expectFocus('source-add/fields/2');
      await typeIn(remote, root, 'password', 'not-the-password');
      await remote.expectFocus('source-add/fields/3');
      await remote.go('DOWN', 'source-add/fields/4');
      await remote.go('DOWN', 'source-add/actions/0');
      await remote.press('OK');
      const add = page.getByTestId('source-add');
      await expect(add).toHaveAttribute('data-view', 'failed', { timeout: 30_000 });
      await expect(page.getByTestId('source-add-failed')).toHaveAttribute('data-code', 'auth');
      if (words !== null) expect(await text(page.getByTestId('source-add-failed'))).toContain(stripIsolates(words['error.auth']));
      await shoot(page, `sources-add-failed-${locale}`);
      await remote.expectFocus('source-add/actions/0');
      await remote.press('OK');
      await expect(add).toHaveAttribute('data-view', 'form');
      await expect(page.getByTestId('source-add-username').locator('input')).toHaveValue(U);
    });

    await test.step('the right password: the load, then the counts; the source is the second, the first is untouched', async () => {
      await remote.go('DOWN', 'source-add/fields/1');
      await remote.go('DOWN', 'source-add/fields/2');
      await typeIn(remote, root, 'password', P);
      await remote.expectFocus('source-add/fields/3');
      await remote.go('DOWN', 'source-add/fields/4');
      await remote.go('DOWN', 'source-add/actions/0');
      await remote.press('OK');
      const add = page.getByTestId('source-add');
      await expect(add).toHaveAttribute('data-view', 'done', { timeout: 30_000 });
      expect(Number(await page.getByTestId('source-add-live').getAttribute('data-n'))).toBeGreaterThan(0);
      await inSafeArea(page.getByTestId('source-add-done'));
      await shoot(page, `sources-add-done-${locale}`);
      // The mock's 18+ group is locked and no PIN is set: "Set a PIN" or "Later".
      await remote.expectFocus('source-add/actions/0');
      await expect(page.getByTestId('source-add-pin-note')).toBeVisible();
      await remote.go(next, 'source-add/actions/1');
      await remote.press('OK');
      // Back on the sources screen, on the button that opened the form; the list is a key down.
      await remote.expectFocus('sources/header/1');
      await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '2', { timeout: 30_000 });
      const profile = await stored(page);
      expect(profile.doc.sources.map((s) => s.id)).toEqual(['s1', 's2']);
      expect(profile.chunks['s1']).toBeGreaterThan(0);
      expect(profile.chunks['s2']).toBeGreaterThan(0);
      await shoot(page, `sources-added-${locale}`);
    });

    await test.step('removing the first leaves the second, its catalog and record', async () => {
      await remote.go('DOWN', 'sources/sources/0');
      await remote.go('OK', 'source-menu/actions/0');
      await remote.go('DOWN', 'source-menu/actions/1');
      await remote.go('OK', 'source-remove/actions/1');
      await remote.go(previous, 'source-remove/actions/0');
      await remote.press('OK');
      await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '1', { timeout: 30_000 });
      await expect(page.getByTestId('source-0')).toHaveAttribute('data-src', 's2');
      const profile = await stored(page);
      expect(profile.doc.sources.map((s) => s.id)).toEqual(['s2']);
      expect(profile.chunks['s1']).toBeUndefined();
      expect(profile.chunks['s2']).toBeGreaterThan(0);
    });
    expect(errors).toEqual([]);
  });
}
