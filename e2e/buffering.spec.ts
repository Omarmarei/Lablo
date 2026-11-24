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
import { untranslated } from './parental-steps';
import { appIdle } from './profile-edit';
import { RemoteDriver } from './remote-driver';
import { openSettings, settingsRow, toSettingsRow } from './settings-rows';

/**
 * RELAY step 39d on the mock's panel, in English, Arabic and the pseudo-locale:
 * - Settings › "Player"'s eighth row, "Buffering": the page scrolls to it (the first row out of
 *   view, the row in the safe area); Fast start at the start, its line saying what it does,
 *   nothing kept;
 * - the reading end's arrow to Stable and no further, its own line, kept in the profile's
 *   `player.options` as `buffer: 'stable'`; back to Fast start (nothing kept); OK round to Stable;
 * - the player reads it at the next play (English: the words change nothing there). The desktop
 *   never plays the mock's placeholder streams (player.spec.ts), so the stream opens until its
 *   open timeout and the player opens it again: after 20 s under Stable, after 10 s under Fast
 *   start (the `<video>`'s `src` set again);
 * - a restart keeps the value.
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

/** From now on, each time the stage's `<video>` is given a stream: its path and when (ms from now). */
async function watchLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const loads: { at: number; path: string }[] = [];
    (window as unknown as { __loads: typeof loads }).__loads = loads;
    const start = performance.now();
    new MutationObserver((records) => {
      for (const record of records) {
        const src = record.target instanceof HTMLVideoElement ? record.target.getAttribute('src') : null;
        if (src !== null && src !== '') loads.push({ at: performance.now() - start, path: new URL(src, location.href).pathname });
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['src'] });
  });
}

function loads(page: Page): Promise<{ at: number; path: string }[]> {
  return page.evaluate(() => (window as unknown as { __loads: { at: number; path: string }[] }).__loads.slice());
}

/**
 * OK on the live list's first channel, then how long the player waited on the `.m3u8` before it
 * opened it again (the `.ts` first, refused at once on the desktop, then the `.m3u8`), and back.
 */
async function reopenAfter(page: Page, remote: RemoteDriver): Promise<number> {
  await watchLoads(page);
  await remote.press('OK');
  await remote.expectFocus('player/actions/0');
  await expect.poll(async () => (await loads(page)).length, { timeout: 40_000 }).toBeGreaterThanOrEqual(3);
  const seen = await loads(page);
  expect(seen.slice(0, 3).map((l) => l.path)).toEqual(['/live/lablo/lablo-test/101.ts', '/live/lablo/lablo-test/101.m3u8', '/live/lablo/lablo-test/101.m3u8']);
  await remote.go('BACK', 'live/channels/0');
  return seen[2]!.at - seen[1]!.at;
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';
  const back = tag === 'ar' ? 'RIGHT' : 'LEFT';

  test(`"Buffering": the eighth row scrolled to, Fast start and Stable kept in the profile, read at the next play, through a restart (${locale})`, async ({ page }) => {
    test.setTimeout(tag === 'en' ? 180_000 : 90_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    const row = page.getByTestId('player-settings-buffer');

    /** From the live list to Settings › "Player"'s eighth row. */
    const toBufferRow = async (): Promise<void> => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'player');
      await remote.go('OK', 'player-settings/rows/0');
      for (let i = 1; i <= 7; i += 1) await remote.go('DOWN', `player-settings/rows/${i}`);
    };
    /** From Settings › "Player" back to the live list's first channel. */
    const backToList = async (): Promise<void> => {
      await remote.go('BACK', settingsRow('player'));
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
    };

    await test.step('Settings › "Player": the eighth row scrolled into view, Fast start, nothing kept', async () => {
      await toBufferRow();
      await expect(row).toHaveAttribute('data-value', 'fast');
      // The window moved one row: the first is out, the eighth in the safe area.
      await expect(page.getByTestId('player-settings-audio')).toHaveCount(0);
      await expect(page.getByTestId('player-settings-subtitles')).toHaveCount(1);
      await expectInSafeArea(row);
      await expectInSafeArea(page.getByTestId('player-settings-subtitles'));
      if (words !== null) {
        expect(await text(page, '[data-testid=player-settings-buffer] .settings__name')).toBe(words['playerSettings.buffer']);
        expect(await text(page, '[data-testid=player-settings-buffer-value]')).toBe(words['playerSettings.fast']);
        expect(await text(page, '[data-testid=player-settings-buffer] .settings__hint')).toBe(words['playerSettings.fastHint']);
      }
      await expect.poll(() => storedOptions(page)).toBeNull();
      // Up to the first row: the window follows.
      for (let i = 6; i >= 0; i -= 1) await remote.go('UP', `player-settings/rows/${i}`);
      await expect(page.getByTestId('player-settings-audio')).toHaveCount(1);
      await expect(row).toHaveCount(0);
      for (let i = 1; i <= 7; i += 1) await remote.go('DOWN', `player-settings/rows/${i}`);
    });

    await test.step('Stable by the reading end\'s arrow and no further, kept; back to Fast start, nothing kept; OK round to Stable', async () => {
      await remote.press(back);
      await expect(row).toHaveAttribute('data-value', 'fast');
      await remote.press(next);
      await expect(row).toHaveAttribute('data-value', 'stable');
      if (words !== null) {
        expect(await text(page, '[data-testid=player-settings-buffer-value]')).toBe(words['playerSettings.stable']);
        expect(await text(page, '[data-testid=player-settings-buffer] .settings__hint')).toBe(words['playerSettings.stableHint']);
      }
      await expect.poll(() => storedOptions(page)).toEqual({ buffer: 'stable' });
      await remote.press(next);
      await remote.expectFocus('player-settings/rows/7');
      await expect(row).toHaveAttribute('data-value', 'stable');
      await remote.press(back);
      await expect(row).toHaveAttribute('data-value', 'fast');
      await expect.poll(() => storedOptions(page)).toEqual({});
      await remote.press('OK');
      await expect(row).toHaveAttribute('data-value', 'stable');
      await expect.poll(() => storedOptions(page)).toEqual({ buffer: 'stable' });
      if (words === null) expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `settings-player-buffer-${tag}.png`), animations: 'disabled' });
    });

    if (tag === 'en') {
      await test.step('the next play reads it: a stream that never shows a frame is opened again after 20 s under Stable, after 10 s under Fast start', async () => {
        await backToList();
        const stable = await reopenAfter(page, remote);
        expect(stable).toBeGreaterThanOrEqual(19_000);
        expect(stable).toBeLessThan(26_000);
        await toBufferRow();
        await remote.press('OK');
        await expect(row).toHaveAttribute('data-value', 'fast');
        await expect.poll(() => storedOptions(page)).toEqual({});
        await backToList();
        const fast = await reopenAfter(page, remote);
        expect(fast).toBeGreaterThanOrEqual(9000);
        expect(fast).toBeLessThan(16_000);
      });
    }

    await test.step('a restart keeps it', async () => {
      const kept = tag === 'en' ? 'fast' : 'stable';
      await appIdle(page);
      await page.goto(`/?locale=${locale}`);
      if (tag === 'en') {
        // The last channel plays by itself.
        await remote.expectFocus('player/actions/0');
        await remote.go('BACK', 'live/channels/0');
      } else {
        await remote.expectFocus('live/channels/0');
      }
      await toBufferRow();
      await expect(row).toHaveAttribute('data-value', kept);
      await expect.poll(() => storedOptions(page)).toEqual(kept === 'stable' ? { buffer: 'stable' } : {});
    });

    expect(errors).toEqual([]);
  });
}
