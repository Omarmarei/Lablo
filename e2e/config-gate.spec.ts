import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addXtreamAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The config's gate (RELAY step 30c2a) over the app, with a dev-signed config served by the test
 * (config-server.ts) and `?api=` pointing the app at it:
 * - a notice over onboarding, once: closing it keeps its id in the profile, and a reload with
 *   the same config shows nothing;
 * - `disable-app` arriving through `refreshConfig()` while a channel plays: the player closes,
 *   the keys go to the gate alone, Back asks to leave, and the next refresh, without the rule,
 *   gives the live screen back;
 * - the "update Lablo" screen, in the built webOS bundle from `file://` (the desktop dev app has
 *   no `minVersion`).
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const DIST = path.resolve(import.meta.dirname, '../dist/tv');
const VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../apps/tv/package.json'), 'utf8')) as { version: string }).version;

const NEWS = { en: 'Lablo 1.0.4 fixes playback on this TV. Update it from the store.', ar: 'يصلح لابلو 1.0.4 التشغيل على هذا التلفاز. حدّثه من المتجر.' };
const SECOND = { en: 'Our support page has moved.', ar: 'انتقلت صفحة الدعم.' };
const OFF = { en: 'Lablo is paused in your region.', ar: 'لابلو متوقف مؤقتًا في منطقتك.' };

const notices = [
  { id: 'silent', match: {}, mode: 'notice' },
  { id: 'news', match: {}, mode: 'notice', message: NEWS },
  { id: 'second', match: {}, mode: 'notice', message: SECOND },
];
const disableApp = { id: 'paused', match: {}, mode: 'disable-app', message: OFF };

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

/** The profile's notices shown (step 30c2a), read from IndexedDB once the app has opened it. */
function noticesShown(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: { noticesShown?: unknown } } | undefined;
            resolve(record === undefined ? null : (record.doc.noticesShown ?? null));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The config run has ended: its answer is in, and no run goes on. */
async function configSettled(page: Page, status = 'fresh'): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe(status);
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.configIdle() ?? false)).toBe(true);
}

async function withServer(answer: string, run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(answer);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

test('a notice shows over onboarding once: its id is kept, and a reload shows nothing', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc({ kill: notices })), async (server) => {
    await page.goto(`/?locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
    const gate = page.getByTestId('gate');
    // The notice without a message never shows: the first one with a message does.
    await expect(gate).toHaveAttribute('data-kind', 'notice');
    await expect(gate).toHaveAttribute('data-id', 'news');
    await expect(gate).toHaveAttribute('data-language', 'en');
    const dialog = page.getByTestId('gate-notice');
    await expect(dialog.locator('.z-dialog__title')).toHaveText('A message from Lablo');
    await expect(dialog.locator('.z-dialog__message')).toHaveText(NEWS.en);
    await expect(page.getByTestId('gate-ok')).toHaveAttribute('data-state', 'focused');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: path.join(SHOTS, 'gate-notice-en.png'), animations: 'disabled' });

    // The keys are the gate's: onboarding's focus doesn't move.
    await remote.press('DOWN', 'RIGHT');
    await remote.expectFocus('language/languages/0');
    // OK closes it, and the next notice follows; Back closes that one.
    await remote.press('OK');
    await expect(gate).toHaveAttribute('data-id', 'second');
    await expect(dialog.locator('.z-dialog__message')).toHaveText(SECOND.en);
    await remote.press('BACK');
    await expect(gate).toHaveCount(0);
    // The keys are onboarding's again.
    await remote.go('RIGHT', 'language/languages/1');
    await expect.poll(() => noticesShown(page)).toEqual(['news', 'second']);

    // The same config after a reload: both were shown, nothing shows.
    await page.reload();
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
    await configSettled(page);
    expect(server.requests()).toBe(2);
    await expect(gate).toHaveCount(0);
    await remote.go('RIGHT', 'language/languages/1');
    expect(errors).toEqual([]);
  });
});

test('in Arabic: the notice and disable-app over onboarding, in the doc\'s Arabic text', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc({ kill: [notices[1]] })), async (server) => {
    await page.goto(`/?locale=ar-SA&api=${encodeURIComponent(server.origin)}`);
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
    const gate = page.getByTestId('gate');
    await expect(gate).toHaveAttribute('data-kind', 'notice');
    await expect(gate).toHaveAttribute('data-language', 'ar');
    const dialog = page.getByTestId('gate-notice');
    await expect(dialog.locator('.z-dialog__title')).toHaveText('رسالة من لابلو');
    await expect(dialog.locator('.z-dialog__message')).toHaveText(NEWS.ar);
    await expect(page.getByTestId('gate-ok')).toHaveText('حسنًا');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: path.join(SHOTS, 'gate-notice-ar.png'), animations: 'disabled' });
    await remote.press('OK');
    await expect(gate).toHaveCount(0);

    // disable-app arrives with a refresh: the whole screen, in Arabic, the keys the gate's.
    server.serve(devSignedAnswer(doc({ kill: [notices[1], disableApp] }, Date.now() + 1_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: { id: 'paused', mode: 'disable-app' } });
    await expect(gate).toHaveAttribute('data-kind', 'disabled');
    await expect(gate.locator('.gate__title')).toHaveText('لابلو غير متاح');
    await expect(page.getByTestId('gate-message')).toHaveText(OFF.ar);
    await expect(page.getByTestId('gate-close')).toHaveText('إغلاق لابلو');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await remote.press('LEFT', 'RIGHT', 'DOWN');
    await remote.expectFocus('language/languages/1');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: path.join(SHOTS, 'gate-disabled-ar.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
  });
});

test('disable-app arriving while a channel plays: the player closes, the keys are the gate\'s, and a refresh without it gives the app back', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await configSettled(page);
    await expect(page.getByTestId('gate')).toHaveCount(0);
    await remote.go('DOWN', 'live/channels/1');
    await remote.press('OK');
    await remote.expectFocus('player/actions/0');
    await expect(page.getByTestId('player')).toHaveAttribute('data-plays', '1');

    // The operator turns the app off: it arrives with the next refresh, no restart.
    server.serve(devSignedAnswer(doc({ kill: [disableApp] }, Date.now() + 1_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: { id: 'paused', mode: 'disable-app' } });
    const gate = page.getByTestId('gate');
    await expect(gate).toHaveAttribute('data-kind', 'disabled');
    await expect(gate.locator('.gate__title')).toHaveText('Lablo is unavailable');
    await expect(page.getByTestId('gate-message')).toHaveText(OFF.en);
    await expect(page.getByTestId('gate-close')).toHaveAttribute('data-state', 'focused');
    // The player closed under it: the live list has its row.
    await expect(page.getByTestId('player')).toHaveCount(0);
    await remote.expectFocus('live/channels/1');
    // No key reaches the live screen, not even Back; Back and OK ask to leave (the desktop tab stays).
    await remote.press('DOWN', 'DOWN', 'CH_UP', 'LEFT');
    await remote.expectFocus('live/channels/1');
    await expect(gate).toHaveAttribute('data-exit', 'false');
    await remote.press('BACK');
    await expect(gate).toHaveAttribute('data-exit', 'true');
    await remote.expectFocus('live/channels/1');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: path.join(SHOTS, 'gate-disabled-en.png'), animations: 'disabled' });
    // The page shows the gate alone: nothing of the live screen is hit at its centre.
    expect(await page.evaluate(() => document.elementFromPoint(960, 540)?.closest('[data-testid=gate]') !== null)).toBe(true);

    // The rule is lifted: the next refresh gives the app back where it was.
    server.serve(devSignedAnswer(doc({}, Date.now() + 2_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: null });
    await expect(gate).toHaveCount(0);
    await remote.go('DOWN', 'live/channels/2');
    await expect(live).toHaveAttribute('data-screen', 'live');
    expect(errors).toEqual([]);
  });
});

for (const locale of ['en-US', 'ar-SA'] as const) {
  test(`the webOS bundle below its minVersion asks for an update (${locale})`, async ({ browser }) => {
    const index = path.join(DIST, 'webos', 'index.html');
    expect(existsSync(index), `${index} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
    // The webOS adapter takes the TV's language from the browser's.
    const context = await browser.newContext({ locale, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    try {
      await withServer(devSignedAnswer(doc({ minVersion: { webos: '99.0.0' }, kill: [notices[1]] })), async (server) => {
        await page.goto(`${pathToFileURL(index).href}?api=${encodeURIComponent(server.origin)}`);
        await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
        const gate = page.getByTestId('gate');
        // Before the notice: the update.
        await expect(gate).toHaveAttribute('data-kind', 'update', { timeout: 10_000 });
        expect(await page.evaluate(() => window.__LABLO_TEST__?.config()?.updateRequired ?? null)).toBe(true);
        const ar = locale === 'ar-SA';
        await expect(gate.locator('.gate__title')).toHaveText(ar ? 'حدّث لابلو' : 'Update Lablo');
        const versions = stripIsolates((await page.getByTestId('gate-versions').textContent()) ?? '');
        expect(versions).toBe(ar ? `هذا الإصدار: ${VERSION}. المطلوب: 99.0.0 أو أحدث.` : `This version: ${VERSION}. Needed: 99.0.0 or later.`);
        await page.keyboard.press('ArrowDown');
        await expect(gate).toHaveAttribute('data-kind', 'update');
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.screenshot({ path: path.join(SHOTS, `gate-update-${ar ? 'ar' : 'en'}.png`), animations: 'disabled' });
        expect(errors).toEqual([]);
      });
    } finally {
      await context.close();
    }
  });
}
