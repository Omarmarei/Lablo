import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { blocklistHash } from '../packages/crypto/src/blocklist';
import { HARNESS_SALT, devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addXtreamAndWatch, fillXtream, settled, startWatching, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The signed config's blocklist at add and on refresh (RELAY step 30c3a), with a dev-signed
 * config served by the test (config-server.ts) and `?api=` pointing the app at it. The mock
 * provider runs on 127.0.0.1, and the served doc blocks that host:
 * - at add: onboarding's "Add source" refused ("This server can't be used with Lablo."),
 *   nothing in the profile; lifted by a refresh, "Try again" adds the source;
 * - on refresh: a source added before the block, blocked by a refresh: Settings → Sources says
 *   it isn't updated, and Settings → TV guides that its panel's guide isn't read; lifted, both
 *   lines go;
 * - both in Arabic.
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

/** The mock's host (127.0.0.1) on the doc's blocklist; the lifted doc lists only the harness's hosts. */
const BLOCKS_MOCK = { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] };

const SAYS = {
  en: {
    add: "This server can't be used with Lablo.",
    source: ["Not updated since ", ": this server can't be used with Lablo."],
    guide: "Not read: this server can't be used with Lablo.",
    kind: 'Xtream login',
    updated: 'Updated ',
    sources: 'Sources',
  },
  ar: {
    add: 'لا يمكن استخدام هذا الخادم مع لابلو.',
    source: ['لم يُحدَّث منذ ', ': لا يمكن استخدام هذا الخادم مع لابلو.'],
    guide: 'لا يُقرأ: لا يمكن استخدام هذا الخادم مع لابلو.',
    kind: 'تسجيل دخول Xtream',
    updated: 'حُدّث ',
    sources: 'المصادر',
  },
} as const;

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

async function withServer(answer: string, run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(answer);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

/** The config's answer is in, fresh, and no run goes on (the query worker has read its blocklist). */
async function configFresh(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe('fresh');
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.configIdle() ?? false)).toBe(true);
}

/** Serves `blocklist` from now on, and brings it in with a refresh (no restart). */
async function serveBlocklist(page: Page, server: ConfigServer, blocklist: unknown, later: number): Promise<void> {
  server.serve(devSignedAnswer(doc(blocklist === null ? {} : { blocklist }, Date.now() + later)));
  expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh' });
}

/** The profile's sources (their ids), read from IndexedDB once the app has opened it. */
function storedSources(page: Page): Promise<unknown> {
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
            const record = req.result as { doc: { sources?: { id: string }[] } } | undefined;
            resolve(record === undefined ? null : (record.doc.sources ?? []).map((s) => s.id));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** Onboarding's "Add source" refused for the blocked server, in `language`, with nothing kept. */
async function refusedAtAdd(remote: RemoteDriver, language: 'en' | 'ar'): Promise<void> {
  const { page } = remote;
  await remote.press('OK');
  await remote.expectFocus('loading/actions/0');
  const error = page.getByTestId('load-error');
  await expect(error).toHaveAttribute('data-code', 'blocklisted');
  await expect(error).toHaveText(SAYS[language].add);
  const name = host.replace(/:\d+$/, '');
  expect(stripIsolates((await page.getByTestId('onboarding-title').textContent()) ?? '')).toBe(language === 'en' ? `Couldn't add ${name}` : `تعذّرت إضافة ${name}`);
  await shoot(page, `config-blocked-add-${language}`);
  expect(await storedSources(page)).toEqual([]);
}

/** From the live list: the header's "Settings" (its end: the left in Arabic), then the settings row `item`. */
async function openSettingsRow(remote: RemoteDriver, language: 'en' | 'ar', item: number): Promise<Locator> {
  const side = language === 'ar' ? 'LEFT' : 'RIGHT';
  await remote.go('UP', 'live/header/0');
  for (let i = 1; i <= 5; i += 1) await remote.go(side, `live/header/${i}`);
  await remote.go('OK', 'settings/items/0');
  await expect(remote.page.getByTestId('settings-sources')).toContainText(SAYS[language].sources);
  if (item === 1) await remote.go('DOWN', 'settings/items/1');
  await remote.press('OK');
  const root = remote.page.getByTestId('settings-screen');
  await settled(root, 20_000);
  return root;
}

/** The sources screen on the mock's source: blocked (`blocked`) or not, in `language`. */
async function sourceShows(page: Page, language: 'en' | 'ar', blocked: boolean): Promise<void> {
  await expect(page.getByTestId('sources')).toHaveAttribute('data-status', 'ready');
  const row = page.getByTestId('source-0');
  await expect(row).toHaveAttribute('data-src', 's1');
  await expect(row).toHaveAttribute('data-blocked', String(blocked));
  expect(stripIsolates((await page.getByTestId('source-0-kind').textContent()) ?? '')).toBe(`${SAYS[language].kind} · ${host}`);
  // One line under the name: when it was updated, or that it no longer is (since then).
  const status = stripIsolates((await page.getByTestId('source-0-status').textContent()) ?? '');
  if (blocked) {
    expect(status.startsWith(SAYS[language].source[0])).toBe(true);
    expect(status.endsWith(SAYS[language].source[1])).toBe(true);
  } else {
    expect(status.startsWith(SAYS[language].updated)).toBe(true);
  }
  await expect(page.getByTestId('source-0-status')).toHaveClass(blocked ? 'guides__failure' : 'guides__status');
}

test('at add: a blocked server is refused, nothing is kept; lifted, Try again adds the source', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc({ blocklist: BLOCKS_MOCK })), async (server) => {
    const onboarding = await fillXtream(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await configFresh(page);
    await refusedAtAdd(remote, 'en');
    await expect(page.getByTestId('action-0')).toHaveText('Edit details');
    await expect(page.getByTestId('action-1')).toHaveText('Try again');
    // Still refused on Try again.
    await remote.go('RIGHT', 'loading/actions/1');
    await remote.press('OK');
    await remote.expectFocus('loading/actions/0');
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'blocklisted');
    expect(await storedSources(page)).toEqual([]);

    // Lifted by the next refresh: Try again adds it.
    await serveBlocklist(page, server, null, 1_000);
    await remote.go('RIGHT', 'loading/actions/1');
    await startWatching(remote, onboarding, 20_000);
    expect(await storedSources(page)).toEqual(['s1']);
    expect(errors).toEqual([]);
  });
});

test('on refresh: a source blocked after it was added says so in Sources and in TV guides; lifted, the lines go', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await configFresh(page);
    await serveBlocklist(page, server, BLOCKS_MOCK, 1_000);

    // Settings → Sources: the source, its server, when it was updated, and that it no longer is.
    await openSettingsRow(remote, 'en', 1);
    await remote.expectFocus('sources/sources/0');
    await expect(page.getByTestId('sources')).toHaveAttribute('data-blocked', '1');
    await sourceShows(page, 'en', true);
    await expect(page.getByTestId('source-0-name')).toHaveText(host.replace(/:\d+$/, ''));
    await shoot(page, 'sources-blocked-en');

    // Settings → TV guides: the panel's guide (on the same server) isn't read.
    await remote.go('BACK', 'settings/items/1');
    await remote.go('UP', 'settings/items/0');
    await remote.press('OK');
    await remote.expectFocus('guides/guides/0');
    await settled(page.getByTestId('settings-screen'), 20_000);
    await expect(page.getByTestId('guide-0')).toHaveAttribute('data-src', 's1:xmltv');
    await expect(page.getByTestId('guide-0-blocked')).toHaveText(SAYS.en.guide);
    await expect(page.getByTestId('guide-0-status')).toHaveCount(0);
    await shoot(page, 'guides-blocked-en');

    // Lifted: both lines go when the screens open again.
    await serveBlocklist(page, server, null, 2_000);
    await remote.go('BACK', 'settings/items/0');
    await remote.go('DOWN', 'settings/items/1');
    await remote.press('OK');
    await remote.expectFocus('sources/sources/0');
    await settled(page.getByTestId('settings-screen'), 20_000);
    await sourceShows(page, 'en', false);
    await remote.go('BACK', 'settings/items/1');
    await remote.go('UP', 'settings/items/0');
    await remote.press('OK');
    await remote.expectFocus('guides/guides/0');
    await settled(page.getByTestId('settings-screen'), 20_000);
    await expect(page.getByTestId('guide-0-blocked')).toHaveCount(0);
    await expect(page.getByTestId('guide-0-status')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('in Arabic: the refused add, and the blocked source in Sources', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc({ blocklist: BLOCKS_MOCK })), async (server) => {
    const onboarding = await fillXtream(remote, { host, username: U, password: P }, `locale=ar-SA&api=${encodeURIComponent(server.origin)}`);
    await configFresh(page);
    await refusedAtAdd(remote, 'ar');
    await expect(page.getByTestId('action-0')).toHaveText('تعديل البيانات');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // Lifted, "Try again" (to the left in Arabic) adds it; blocked again, Sources says so.
    await serveBlocklist(page, server, null, 1_000);
    await remote.go('LEFT', 'loading/actions/1');
    await startWatching(remote, onboarding, 20_000);
    await serveBlocklist(page, server, BLOCKS_MOCK, 2_000);
    await openSettingsRow(remote, 'ar', 1);
    await remote.expectFocus('sources/sources/0');
    await sourceShows(page, 'ar', true);
    await expect(page.locator('.settings__title')).toHaveText(SAYS.ar.sources);
    await shoot(page, 'sources-blocked-ar');
    expect(errors).toEqual([]);
  });
});
