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
import { RemoteDriver } from './remote-driver';
import { openSettings, settingsRow, toSettingsRow } from './settings-rows';

/**
 * RELAY step 43 on the mock's panel, in English and Arabic, on "Accessibility"'s page since step 55
 * (Settings › "Player"'s last row opens it; the arrows move nothing on that row; Back comes back
 * to it):
 * - "Caption background" (Dark, None, Solid) and "Caption colour" (White, Yellow, Cyan, Green):
 *   the words, the value as stored, kept in the profile's `player.options` (nothing for the
 *   defaults);
 * - "Larger text": `<html data-large-text="on">`, kept as `largeText: 'on'`, still on after a
 *   restart; with it on the page, the live screen and Settings' list stay inside the safe area and
 *   no row's text spills out of its box.
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

async function text(page: Page, selector: string): Promise<string> {
  return stripIsolates((await page.locator(selector).first().textContent()) ?? '');
}

async function expectInSafeArea(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(SAFE.left);
  expect(box!.y).toBeGreaterThanOrEqual(SAFE.top);
  expect(box!.x + box!.width).toBeLessThanOrEqual(SAFE.right);
  expect(box!.y + box!.height).toBeLessThanOrEqual(SAFE.bottom);
}

/** The profile's `player.options` (absent: `null`), read from IndexedDB. */
function storedOptions(page: Page): Promise<unknown> {
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
            const player = (req.result as { doc?: { player?: { options?: unknown } } } | undefined)?.doc?.player;
            resolve(player?.options ?? null);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** Every element inside `selector` whose text is wider than its box (a row that spills out; a title cut with an ellipsis on purpose is not one). */
function spilled(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    document.querySelectorAll(`${sel} *`).forEach((el) => {
      const box = el as HTMLElement;
      if (box.children.length === 0 && box.scrollWidth > box.clientWidth + 1 && box.clientWidth > 0 && getComputedStyle(box).textOverflow !== 'ellipsis') out.push(`${box.className}: ${box.textContent ?? ''}`);
    });
    return out;
  }, selector);
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
] as const) {
  const words = tag === 'ar' ? AR : EN;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';

  test(`"Accessibility" page: caption box and colour, "Larger text" kept, fitted, through a restart (${locale})`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);

    const toPlayer = async (): Promise<void> => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'player');
      await remote.go('OK', 'player-settings/rows/0');
    };
    const row = (name: string): Locator => page.getByTestId(`player-settings-${name}`);

    await test.step('"Accessibility" last in Settings › "Player"; its page holds the three rows: defaults, nothing kept', async () => {
      await toPlayer();
      for (let i = 1; i <= 8; i += 1) await remote.go('DOWN', `player-settings/rows/${i}`);
      await expect(page.locator('[data-testid=player-settings] [role=menu]')).toHaveAttribute('data-count', '9');
      expect(await text(page, '[data-testid=player-settings-access] .settings__name')).toBe(words['playerSettings.access']);
      expect(await text(page, '[data-testid=player-settings-access] .settings__hint')).toBe(words['playerSettings.accessHint']);
      await expectInSafeArea(row('access'));
      for (const name of ['captionBg', 'captionColor', 'largeText']) await expect(row(name)).toHaveCount(0);
      // The arrows move nothing on it.
      await remote.press(next);
      await remote.expectFocus('player-settings/rows/8');
      await page.screenshot({ path: path.join(SHOTS, `access-row-${tag}.png`), animations: 'disabled' });
      await remote.go('OK', 'player-access/rows/0');
      await expect(page.getByTestId('player-settings')).toHaveCount(0);
      expect(await text(page, '[data-testid=player-access] .settings__title')).toBe(words['playerSettings.access']);
      await expect(row('captionBg')).toHaveAttribute('data-value', 'dark');
      expect(await text(page, '[data-testid=player-settings-captionBg] .settings__name')).toBe(words['playerSettings.captionBg']);
      expect(await text(page, '[data-testid=player-settings-captionBg-value]')).toBe(words['playerSettings.bg.dark']);
      await expectInSafeArea(row('captionBg'));
      await remote.go('DOWN', 'player-access/rows/1');
      await expect(row('captionColor')).toHaveAttribute('data-value', 'white');
      await remote.go('DOWN', 'player-access/rows/2');
      await expect(row('largeText')).toHaveAttribute('data-value', 'off');
      expect(await text(page, '[data-testid=player-settings-largeText-value]')).toBe(words['playerSettings.off']);
      await expectInSafeArea(row('largeText'));
      expect(await spilled(page, '[data-testid=player-access]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `access-page-${tag}.png`), animations: 'disabled' });
      await expect.poll(() => storedOptions(page)).toBeNull();
      await expect(page.locator('html')).not.toHaveAttribute('data-large-text', 'on');
      // Back comes back to its row, and OK opens the page again at its first row.
      await remote.go('BACK', 'player-settings/rows/8');
      await remote.go('OK', 'player-access/rows/0');
    });

    await test.step('the caption box and colour go round and are kept, the defaults leave nothing', async () => {
      await remote.go('DOWN', 'player-access/rows/1');
      await remote.press('OK');
      await expect(row('captionColor')).toHaveAttribute('data-value', 'yellow');
      expect(await text(page, '[data-testid=player-settings-captionColor-value]')).toBe(words['playerSettings.color.yellow']);
      await remote.go('UP', 'player-access/rows/0');
      await remote.press('OK');
      await expect(row('captionBg')).toHaveAttribute('data-value', 'none');
      await remote.press(next);
      await expect(row('captionBg')).toHaveAttribute('data-value', 'solid');
      expect(await text(page, '[data-testid=player-settings-captionBg-value]')).toBe(words['playerSettings.bg.solid']);
      await expect.poll(() => storedOptions(page)).toEqual({ captionColor: 'yellow', captionBg: 'solid' });
      await remote.press('OK');
      await expect(row('captionBg')).toHaveAttribute('data-value', 'dark');
      await expect.poll(() => storedOptions(page)).toEqual({ captionColor: 'yellow' });
      await remote.press('OK');
      await expect(row('captionBg')).toHaveAttribute('data-value', 'none');
      await expect.poll(() => storedOptions(page)).toEqual({ captionColor: 'yellow', captionBg: 'none' });
    });

    await test.step('"Larger text": the root marked, kept, and its page, Player, Settings and the live screen still fit', async () => {
      await remote.go('DOWN', 'player-access/rows/1');
      await remote.go('DOWN', 'player-access/rows/2');
      await remote.press('OK');
      await expect(row('largeText')).toHaveAttribute('data-value', 'on');
      await expect(page.locator('html')).toHaveAttribute('data-large-text', 'on');
      await expect.poll(() => storedOptions(page)).toEqual({ captionColor: 'yellow', captionBg: 'none', largeText: 'on' });
      for (const name of ['captionBg', 'captionColor', 'largeText']) await expectInSafeArea(row(name));
      expect(await spilled(page, '[data-testid=player-access]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `large-text-access-page-${tag}.png`), animations: 'disabled' });
      await remote.go('BACK', 'player-settings/rows/8');
      await expectInSafeArea(row('access'));
      expect(await spilled(page, '[data-testid=player-settings]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `large-text-access-row-${tag}.png`), animations: 'disabled' });
      for (let i = 7; i >= 0; i -= 1) await remote.go('UP', `player-settings/rows/${i}`);
      for (const name of ['audio', 'subtitles', 'size']) await expectInSafeArea(row(name));
      expect(await spilled(page, '[data-testid=player-settings]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `large-text-player-settings-${tag}.png`), animations: 'disabled' });
      await remote.go('BACK', settingsRow('player'));
      expect(await spilled(page, '[data-testid=settings-screen]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `large-text-settings-${tag}.png`), animations: 'disabled' });
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
      expect(await spilled(page, '#app')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `large-text-live-${tag}.png`), animations: 'disabled' });
    });

    await test.step('the player draws captions with the chosen box and colour', async () => {
      await remote.press('OK');
      await remote.expectFocus('player/actions/0');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-caption-bg', 'none');
      await expect(player).toHaveAttribute('data-caption-color', 'yellow');
    });

    await test.step('a restart keeps all three', async () => {
      await page.goto(`/?locale=${locale}`);
      await expect(page.locator('html')).toHaveAttribute('data-large-text', 'on');
      await expect.poll(() => storedOptions(page)).toEqual({ captionColor: 'yellow', captionBg: 'none', largeText: 'on' });
    });

    expect(errors).toEqual([]);
  });
}
