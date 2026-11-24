import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page, Worker } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { stripIsolates } from '../packages/core/src/bidi';
import { rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import { openSettings, settingsRow, toSettingsRow } from './settings-rows';

/**
 * A full store (RELAY step 39s1): every IndexedDB put and add in the app's workers throws
 * `QuotaExceededError`, as a full store refuses them (deletes go through). DevTools' own
 * `Storage.overrideQuotaForOrigin` changes nothing in Playwright's browser contexts (tried: the
 * quota stays, the write commits), so the test patches `IDBObjectStore.prototype` in each worker:
 * those running when the store fills, and each one that starts while it is full. The panel's
 * answers wait 1.5 s meanwhile, so a refresh's worker is patched before its first write.
 *
 * The 12-hour catalog refresh then fails even after deleting the guides, and the live screen says
 * so under its header; Settings › "Sources" says it on the source's row. With room again, the
 * refresh 2 h later goes through and the line goes. The page's clock is Playwright's
 * (`fastForward` fires each timer that fell due once); the mock and the workers keep the real clock.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

let app: MockServer;
let host: string;
/** The panel's answers wait while the store is full (a new worker is patched first). */
let holding = false;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  app.addHook('onRequest', async (request) => {
    if (holding && request.url.indexOf('player_api.php') !== -1) await new Promise((resolve) => setTimeout(resolve, 1_500));
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

async function text(locator: Locator): Promise<string> {
  return stripIsolates((await locator.textContent()) ?? '');
}

async function expectInSafeArea(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(SAFE.left);
  expect(box!.y).toBeGreaterThanOrEqual(SAFE.top);
  expect(box!.x + box!.width).toBeLessThanOrEqual(SAFE.right);
  expect(box!.y + box!.height).toBeLessThanOrEqual(SAFE.bottom);
}

/** Makes a worker's IndexedDB refuse every put and add as a full store does (`false`: lets them through again). */
function fill(worker: Worker, full: boolean): Promise<void> {
  return worker
    .evaluate((on) => {
      const proto = IDBObjectStore.prototype as IDBObjectStore & { realPut?: IDBObjectStore['put']; realAdd?: IDBObjectStore['add'] };
      if (proto.realPut === undefined) {
        proto.realPut = proto.put;
        proto.realAdd = proto.add;
      }
      const refuse = (): never => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
      proto.put = on ? refuse : proto.realPut;
      proto.add = on ? refuse : proto.realAdd!;
    }, full)
    .catch(() => undefined);
}

/** Fills the store in every worker running now, and in each one that starts until `room`. */
function fullStore(page: Page): { room(): Promise<void> } {
  holding = true;
  const onWorker = (worker: Worker): void => void fill(worker, true);
  page.on('worker', onWorker);
  const running = Promise.all(page.workers().map((w) => fill(w, true)));
  return {
    room: async () => {
      await running;
      page.off('worker', onWorker);
      holding = false;
      await Promise.all(page.workers().map((w) => fill(w, false)));
    },
  };
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';

  test(`a full store: the line under the live header, the source's row, and both gone after the next refresh (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await page.clock.install();
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    const line = page.getByTestId('live-storage');
    await expect(line).toHaveCount(0);
    const drawn = (await rows(page)).length;
    expect(drawn).toBe(9);

    let store: { room(): Promise<void> } | null = null;
    await test.step('the store is full: the 12-hour refresh fails, and the line says so', async () => {
      store = fullStore(page);
      await page.clock.fastForward('12:01:00');
      await expect(line).toBeVisible({ timeout: 30_000 });
      if (words !== null) expect(await text(line)).toBe(stripIsolates(words['live.storageFull']));
      await expect(line).toHaveAttribute('role', 'status');
      await expectInSafeArea(line);
      // One line, cut short with an ellipsis if it must be (en-XA): never a second line.
      expect((await line.boundingBox())!.height).toBe(32);
      // The rail and the list keep every row under it.
      expect((await rows(page)).length).toBe(drawn);
      await expectInSafeArea(page.getByTestId(`channels`).locator('.z-vlist__item').last());
      await page.screenshot({ path: path.join(SHOTS, `storage-full-${tag}.png`) });
    });

    await test.step("Settings › Sources: the source's row says why it wasn't updated", async () => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'sources');
      await remote.go('OK', 'sources/sources/0');
      await expect(page.getByTestId('sources')).toHaveAttribute('data-status', 'ready');
      const row = page.getByTestId('source-0');
      await expect(row).toHaveAttribute('data-storage', 'true');
      const status = page.getByTestId('source-0-status');
      await expect(status).toHaveClass('guides__failure');
      if (tag === 'en') expect(await text(status)).toMatch(/^Not updated since .+: Lablo's storage on this TV is full\.$/);
      if (tag === 'ar') expect(await text(status)).toMatch(/^لم يُحدَّث منذ .+: مساحة تخزين لابلو على هذا التلفزيون ممتلئة\.$/);
      await page.screenshot({ path: path.join(SHOTS, `storage-full-sources-${tag}.png`) });
      await remote.go('BACK', settingsRow('sources'));
      await remote.go('BACK', 'live/header/5');
    });

    await test.step('room again: the refresh 2 h later goes through, and the line goes', async () => {
      await store!.room();
      await page.clock.fastForward('02:01:00');
      await expect(line).toHaveCount(0, { timeout: 30_000 });
      await settled(live, 30_000);
    });
    expect(errors).toEqual([]);
  });
}
