import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { catalog } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { chips, pad, toLastEntry, typePin, untranslated } from './parental-steps';
import { appIdle, restartWith } from './profile-edit';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST, settingsRow, toSettingsRow } from './settings-rows';

/**
 * A PIN set, or set again after it was forgotten, with one source's login typed again (RELAY step
 * 38c2), on the mock's panel with no PIN at first.
 *
 * Checked, in en-US and ar-SA: the rails' "Locked groups" with no PIN, its dialog's "Set a PIN"
 * (settings.js loading on the way), the check's form with the panel's server filled in, a wrong
 * password said so, then the right login, the new PIN typed twice and the session unlocked with it
 * (the 18+ group back); "Lock again"; Settings › "Parental control" with its four rows, "Forgot
 * your PIN?" asking no PIN, the login again, a new PIN; the old PIN then wrong and the new one
 * right. In en-XA: with a second source, the pick, the form, its mismatch, the dialog and the page
 * show only our strings; with the panel kept without its login (a backup made without logins),
 * the dialog that no source can be checked.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const FIRST_PIN = '2468';
const SECOND_PIN = '1357';
const ADULT = catalog.live.find((c) => c.adult)!;
const ADULT_GROUP = catalog.liveCategories.find((c) => c.id === ADULT.categoryId)!.name;
/** The rail's groups by default: every one with channels but the adult one, which is the last. */
const GROUPS = catalog.liveCategories.filter((c) => catalog.live.some((ch) => ch.categoryId === c.id && !ch.adult)).map((c) => c.name);

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace('http://', '');
});

test.afterAll(async () => {
  await app.close();
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).first().textContent()) ?? '');
}

/** OK on the focused field of the check's form, `value` typed over what it held, OK again. */
async function typeIn(remote: RemoteDriver, root: Locator, field: string, value: string): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', `source-login-${field}`);
  await remote.page.keyboard.press('Control+A');
  await remote.page.keyboard.type(value);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
}

/** The check's form for the panel, on its user name: types `password` after the user name, then "Check". */
async function login(remote: RemoteDriver, root: Locator, password: string): Promise<void> {
  await remote.expectFocus('pin-check/fields/1');
  await typeIn(remote, root, 'username', U);
  await remote.expectFocus('pin-check/fields/2');
  await typeIn(remote, root, 'password', password);
  await remote.expectFocus('pin-check/actions/0');
  await remote.press('OK');
}

/** From the list's first row: the header's "Settings", down to the "Parental control" row, then OK. */
async function openParental(remote: RemoteDriver, next: 'LEFT' | 'RIGHT'): Promise<void> {
  const focus = (): Promise<string> => remote.page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? '');
  await remote.press('UP');
  await expect.poll(focus).toMatch(/^live\/header\/\d+$/);
  for (let i = Number((await focus()).split('/')[2]) + 1; i <= 5; i += 1) await remote.go(next, `live/header/${i}`);
  await remote.go('OK', SETTINGS_FIRST);
  await toSettingsRow(remote, 'parental');
  await remote.go('OK', 'parental/rows/0');
  await expect(remote.page.getByTestId('parental')).toHaveAttribute('data-status', 'ready');
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
] as const) {
  const ar = tag === 'ar';
  const words = ar ? AR : EN;
  const next = ar ? 'LEFT' : 'RIGHT';

  test(`sets a PIN from the rail with the panel's login, then a new one in place of a forgotten PIN (${locale})`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    const screen = page.getByTestId('settings-screen');

    await test.step('"Locked groups" with no PIN: its dialog\'s "Set a PIN" opens the check, the server filled in', async () => {
      await toLastEntry(remote, ar, GROUPS.length + 2);
      await remote.go('OK', 'no-pin/buttons/0');
      expect(await text(page, 'no-pin-set')).toBe(words['parental.set']);
      expect(await text(page, 'no-pin-cancel')).toBe(words['action.cancel']);
      await remote.press('OK');
      await remote.expectFocus('pin-check/fields/1');
      await expect(page.getByTestId('source-login-server').locator('input')).toHaveValue(`http://${host}`);
      await expect(page.getByTestId('source-login-username').locator('input')).toHaveValue('');
      expect(await text(page, 'source-login-save')).toBe(words['pinCheck.check']);
    });

    await test.step('a wrong password is said so; the right login opens the new PIN, which unlocks the session', async () => {
      await login(remote, screen, 'not-the-password');
      await remote.expectFocus('pin-check/fields/1');
      expect(await text(page, 'source-login-mismatch')).toBe(words['pinCheck.mismatch']);
      await shoot(page, `parental-login-mismatch-${tag}`);
      await remote.go('DOWN', 'pin-check/fields/2');
      await typeIn(remote, screen, 'password', P);
      await remote.go('DOWN', 'pin-check/actions/0');
      await remote.go('OK', 'pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'set', typed: '0', problem: '' });
      await typePin(remote, FIRST_PIN);
      await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'again');
      await typePin(remote, FIRST_PIN);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS, `open ${ADULT_GROUP}`, `locked ${words['parental.lockAgain']}`]);
      await remote.expectFocus(`live/rail/${GROUPS.length + 1}`);
      await settled(live);
      await shoot(page, `parental-login-unlocked-${tag}`);
    });

    await test.step('"Lock again", then "Forgot your PIN?" asks no PIN: the login, then a new PIN', async () => {
      await remote.go('DOWN', `live/rail/${GROUPS.length + 2}`);
      await remote.go('OK', `live/rail/${GROUPS.length + 1}`);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS, `locked ${words['parental.lockedGroups']}`]);
      await settled(live);
      await expect(live).toHaveAttribute('data-status', 'ready');
      await remote.go(next, 'live/channels/0');
      await openParental(remote, next);
      await expect(page.getByTestId('parental')).toHaveAttribute('data-pin', 'true');
      for (let i = 1; i <= 3; i += 1) await remote.go('DOWN', `parental/rows/${i}`);
      expect(await text(page, 'parental-forgot')).toBe(`${words['parental.forgot']}${words['parental.forgotHint']}`);
      await shoot(page, `parental-login-page-${tag}`);
      await remote.press('OK');
      await login(remote, screen, P);
      await remote.expectFocus('pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'set', typed: '0', problem: '' });
      await typePin(remote, SECOND_PIN);
      await typePin(remote, SECOND_PIN);
      await remote.expectFocus('parental/rows/3');
      await settled(screen);
      expect(await text(page, 'parental-change-hint')).toBe(words['parental.changed']);
      // Granted by the login: "Lock adult groups" switches with no PIN asked.
      await remote.go('UP', 'parental/rows/2');
      await remote.go('UP', 'parental/rows/1');
      await remote.press('OK');
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'false');
      await settled(screen);
      await remote.press('OK');
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'true');
      await settled(screen);
      await remote.go('BACK', settingsRow('parental'));
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
    });

    await test.step('the forgotten PIN is wrong now; the new one opens the locked groups', async () => {
      await toLastEntry(remote, ar, GROUPS.length + 2);
      await remote.go('OK', 'pin/pad/0');
      await typePin(remote, FIRST_PIN);
      await expect(page.getByTestId('pin-problem')).toHaveAttribute('data-problem', 'wrong');
      await typePin(remote, SECOND_PIN);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS, `open ${ADULT_GROUP}`, `locked ${words['parental.lockAgain']}`]);
    });

    expect(errors).toEqual([]);
  });
}

/** The stored profile's sources (the app's database). */
function storedSources(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile', 'readonly').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { doc: { sources: Record<string, unknown>[] } }).doc.sources);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

test('shows only our strings, bracketed, on the check\'s pick, form, mismatch and dialogs (en-XA)', async ({ page }) => {
  test.setTimeout(200_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await settled(live);
  // A second source, a playlist with its link, for the pick (its catalog is read at the start).
  await appIdle(page);
  const sources = await storedSources(page);
  const list = { id: 'e2e-list', type: 'm3u', name: 'E2E list', url: `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`, added: 1 };
  await restartWith(page, { sources: sources.concat([list]) }, '/?locale=en-XA');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await settled(live);
  const screen = page.getByTestId('settings-screen');

  // The rail's dialog with its two buttons (the rail ends with "Locked groups", both sources' groups before it).
  const focus = (): Promise<string> => page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? '');
  await expect.poll(async () => (await chips(page)).filter((c) => c.startsWith('locked ')).length).toBe(1);
  await toLastEntry(remote, false, (await chips(page)).length);
  await remote.go('OK', 'no-pin/buttons/0');
  expect(await untranslated(page, '[data-testid=no-pin]')).toEqual([]);
  await remote.press('OK');

  // The pick, then the playlist's form and its mismatch.
  await remote.expectFocus('pin-pick/rows/0');
  await expect(page.getByTestId('pin-pick')).toHaveAttribute('data-count', '2');
  expect(await untranslated(page, '[data-testid=pin-pick]')).toEqual([]);
  await shoot(page, 'parental-login-pick-en-XA');
  await remote.go('DOWN', 'pin-pick/rows/1');
  await remote.go('OK', 'pin-check/fields/0');
  await typeIn(remote, screen, 'playlist', `http://${host}/other.m3u`);
  await remote.go('DOWN', 'pin-check/actions/0');
  await remote.press('OK');
  await expect(page.getByTestId('source-login-mismatch')).toHaveCount(1);
  expect(await untranslated(page, '[data-testid=source-login]')).toEqual([]);
  await shoot(page, 'parental-login-form-en-XA');
  // Back to the pick, Back out; then the page with no PIN: its one row.
  await remote.go('BACK', 'pin-pick/rows/1');
  await remote.press('BACK');
  await expect.poll(focus).toMatch(/^live\/rail\/\d+$/);
  await remote.press('RIGHT');
  await remote.expectFocus('live/channels/0');
  await openParental(remote, 'RIGHT');
  await expect(page.getByTestId('parental')).toHaveAttribute('data-pin', 'false');
  await expect(page.getByTestId('parental-set')).toHaveCount(1);
  expect(await untranslated(page, '[data-testid=parental]')).toEqual([]);
  await shoot(page, 'parental-login-set-en-XA');

  // The panel alone, kept without its login: no source can be checked.
  const panel = sources[0]!;
  const bare = { id: panel['id'], type: 'xtream', name: panel['name'], account: null, base: `http://${host}`, added: panel['added'] };
  await restartWith(page, { sources: [bare] }, '/?locale=en-XA');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await settled(live);
  await expect.poll(async () => (await chips(page)).filter((c) => c.startsWith('locked ')).length).toBe(1);
  await toLastEntry(remote, false, (await chips(page)).length);
  await remote.go('OK', 'no-pin/buttons/0');
  await remote.go('OK', 'pin-none/buttons/0');
  await expect(page.getByTestId('pin-none')).toHaveCount(1);
  expect(await untranslated(page, '[data-testid=pin-none]')).toEqual([]);
  await shoot(page, 'parental-login-none-en-XA');
  await remote.press('OK');
  await expect.poll(focus).toMatch(/^live\/rail\/\d+$/);
  await expect(page.getByTestId('pin-none')).toHaveCount(0);
  expect(errors).toEqual([]);
});
