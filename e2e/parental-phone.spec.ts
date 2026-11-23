import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import type { PairPayload } from '../packages/protocol/src/pairing';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { devSignedAnswer } from '../tools/engines/src/config';
import { phonePurpose, phoneSees, phoneSends } from '../tools/engines/src/pair-phone';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { catalog } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { SHOTS, shoot, shownCode } from './pairing-steps';
import { chips, pad, toLastEntry, typePin, untranslated } from './parental-steps';
import { appIdle, restartWith } from './profile-edit';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST, toSettingsRow } from './settings-rows';

/**
 * The PIN's login check by phone (RELAY step 38c4), on the mock's panel with no PIN at first,
 * against the stand-in pairing API on the test's config origin (`?api=`) and a scripted phone in
 * this process (tools/engines/src/pair-phone.ts).
 *
 * Checked: in en-US, the rail's "Locked groups" dialog, "Set a PIN", the check's form with "Use
 * your phone": the pairing screen in its check mode (its title, a check's session on the API),
 * a wrong password from the phone (`no_match` to the phone, the mismatch on the TV), "Show a new
 * code", the right login (`match`), then the pad's new PIN typed twice and the session unlocked.
 * In ar-SA, with a playlist as a second source: Settings › "Parental control" › "Set a PIN", the
 * pick's "Use your phone", the playlist's link from the phone, the new PIN, the page with a PIN.
 * In en-XA: the pick with its header, the pairing screen's check and its mismatch show only our
 * strings.
 */

const PIN = '2468';
const ADULT = catalog.live.find((c) => c.adult)!;
const ADULT_GROUP = catalog.liveCategories.find((c) => c.id === ADULT.categoryId)!.name;
/** The rail's groups by default: every one with channels but the adult one. */
const GROUPS = catalog.liveCategories.filter((c) => catalog.live.some((ch) => ch.categoryId === c.id && !ch.adult)).map((c) => c.name);

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace('http://', '');
});

test.afterAll(async () => {
  await app.close();
});

async function withServer(run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(devSignedAnswer(doc()));
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).first().textContent()) ?? '');
}

/** The panel's login as the phone page sends it (with its scheme), `password` given. */
const panelLogin = (password: string): PairPayload => ({ v: 1, source: { type: 'xtream', server: `http://${host}`, username: U, password } });
/** The playlist the second source keeps. */
const playlist = (): string => `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`;

/** The pairing screen in its check mode, its code on show and polled; the API's session is a check's. */
async function checkCode(page: Page, server: ConfigServer, words: typeof EN | typeof AR): Promise<string> {
  const pair = page.getByTestId('pair');
  await expect(pair).toHaveAttribute('data-purpose', 'check');
  const code = await shownCode(page);
  expect(await text(page, 'pair-title')).toBe(words['pair.checkTitle']);
  expect(server.pair.latest()?.code).toBe(code);
  expect(server.pair.latest()?.purpose).toBe('check');
  expect(await phonePurpose(server.origin, code)).toBe('check');
  await expect.poll(() => server.pair.latest()?.polls ?? 0).toBeGreaterThan(0);
  return code;
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

/**
 * The panel added by onboarding with the stand-in as the API, then a playlist as a second source;
 * the app started again in `locale`. (Onboarding keeps its language in the profile: Arabic is
 * onboarded in Arabic; en-XA, a test locale, in English.)
 */
async function twoSources(remote: RemoteDriver, server: ConfigServer, locale: string): Promise<void> {
  const api = `api=${encodeURIComponent(server.origin)}`;
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale === 'en-XA' ? 'en-US' : locale}&${api}`);
  await settled(live);
  await appIdle(remote.page);
  const sources = await storedSources(remote.page);
  const list = { id: 'e2e-list', type: 'm3u', name: 'E2E list', url: playlist(), added: 1 };
  await restartWith(remote.page, { sources: sources.concat([list]) }, `/?locale=${locale}&${api}`);
  await expect(live).toHaveAttribute('data-status', 'ready');
  await settled(live);
}

test('sets a PIN from the rail with the panel\'s login sent from the phone, after a wrong one (en-US)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await settled(live);

    await test.step('"Set a PIN" from the rail\'s dialog: the check\'s form offers "Use your phone"', async () => {
      await toLastEntry(remote, false, GROUPS.length + 2);
      await remote.go('OK', 'no-pin/buttons/0');
      await remote.go('OK', 'pin-check/fields/1');
      await remote.go('DOWN', 'pin-check/fields/2');
      await remote.go('DOWN', 'pin-check/actions/0');
      await remote.go('RIGHT', 'pin-check/actions/1');
      expect(await text(page, 'source-login-phone')).toBe(EN['pinCheck.usePhone']);
      expect(await text(page, 'source-login-cancel')).toBe(EN['action.cancel']);
      await remote.go('OK', 'pair/actions/0');
    });

    const code = await checkCode(page, server, EN);
    await shoot(page, 'parental-phone-code-en');

    await test.step('a wrong password from the phone: no_match there, the mismatch here; then a new code', async () => {
      await phoneSends(server.origin, code, panelLogin('not-the-password'));
      await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'mismatch', { timeout: 10_000 });
      await expect(page.getByTestId('pair')).toHaveAttribute('data-sent', 'no_match');
      expect(await text(page, 'pair-mismatch')).toBe(EN['pair.mismatch']);
      await expect.poll(() => phoneSees(server.origin, code)).toEqual({ state: 'done', status: 'no_match' });
      await remote.expectFocus('pair/actions/0');
      await shoot(page, 'parental-phone-mismatch-en');
      await remote.press('OK');
    });

    await test.step('the right login: match there, the new PIN here, which unlocks the session', async () => {
      const again = await checkCode(page, server, EN);
      expect(again).not.toBe(code);
      await phoneSends(server.origin, again, panelLogin(P));
      await remote.expectFocus('pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'set', typed: '0', problem: '' });
      await expect.poll(() => phoneSees(server.origin, again)).toEqual({ state: 'done', status: 'match' });
      // Nothing was added: the panel is still the one source.
      expect((await storedSources(page)).length).toBe(1);
      await typePin(remote, PIN);
      await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'again');
      await typePin(remote, PIN);
      await expect.poll(() => chips(page)).toEqual([EN['category.all'], ...GROUPS, `open ${ADULT_GROUP}`, `locked ${EN['parental.lockAgain']}`]);
      await settled(live);
    });
  });
  expect(errors).toEqual([]);
});

test('sets a PIN from Settings with the playlist\'s link sent from the phone, from the pick\'s header (ar-SA)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    await twoSources(remote, server, 'ar-SA');
    const focus = (): Promise<string> => page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? '');
    await expect.poll(focus).toMatch(/^live\/channels\/\d+$/);
    await openParental(remote, 'LEFT');
    await expect(page.getByTestId('parental')).toHaveAttribute('data-pin', 'false');
    await remote.go('OK', 'pin-pick/rows/0');
    await expect(page.getByTestId('pin-pick')).toHaveAttribute('data-count', '2');
    await remote.go('UP', 'pin-pick/header/0');
    expect(await text(page, 'pin-pick-phone')).toBe(AR['pinCheck.usePhone']);
    await shoot(page, 'parental-phone-pick-ar');
    await remote.go('OK', 'pair/actions/0');

    const code = await checkCode(page, server, AR);
    await shoot(page, 'parental-phone-code-ar');
    // The playlist's link: any usable source's login will do, with no pick.
    await phoneSends(server.origin, code, { v: 1, source: { type: 'm3u', url: playlist() } });
    await remote.expectFocus('pin/pad/0');
    await expect.poll(() => phoneSees(server.origin, code)).toEqual({ state: 'done', status: 'match' });
    expect(await pad(page)).toEqual({ purpose: 'set', typed: '0', problem: '' });
    await typePin(remote, PIN);
    await typePin(remote, PIN);
    // The pick and the form gone: the page again, now with its PIN's rows.
    await expect(page.getByTestId('parental')).toHaveAttribute('data-pin', 'true');
    await remote.expectFocus('parental/rows/0');
    expect(await text(page, 'parental-change-hint')).toBe(AR['parental.changed']);
  });
  expect(errors).toEqual([]);
});

test('shows only our strings, bracketed, on the pick\'s header, the check\'s code and its mismatch (en-XA)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    await twoSources(remote, server, 'en-XA');
    await expect.poll(async () => (await chips(page)).filter((c) => c.startsWith('locked ')).length).toBe(1);
    await toLastEntry(remote, false, (await chips(page)).length);
    await remote.go('OK', 'no-pin/buttons/0');
    await remote.go('OK', 'pin-pick/rows/0');
    await remote.go('UP', 'pin-pick/header/0');
    expect(await untranslated(page, '[data-testid=pin-pick]')).toEqual([]);
    await shoot(page, 'parental-phone-pick-en-XA');
    await remote.go('OK', 'pair/actions/0');
    await expect(page.getByTestId('pair')).toHaveAttribute('data-purpose', 'check');
    const code = await shownCode(page);
    expect(await untranslated(page, '[data-testid=pair]')).toEqual([]);
    await phoneSends(server.origin, code, { v: 1, source: { type: 'm3u', url: `http://${host}/other.m3u` } });
    await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'mismatch', { timeout: 10_000 });
    expect(await untranslated(page, '[data-testid=pair]')).toEqual([]);
    await shoot(page, 'parental-phone-mismatch-en-XA');
    // Back: the pick again, its header where it was.
    await remote.go('BACK', 'pin-pick/header/0');
  });
  expect(errors).toEqual([]);
});
