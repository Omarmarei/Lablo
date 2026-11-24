import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
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
 * RELAY step 39a on the mock's panel, in English, Arabic and the pseudo-locale:
 * - Settings › "Player"'s fifth row, "Clock while watching": Off at the start, On by the reading
 *   end's arrow (no further), kept in the profile's `player.options`;
 * - the player: no corner clock while the info bar shows (the bar has the time); with the bar
 *   hidden, the time in the top-end corner (the bar's time, at the right in English and the left
 *   in Arabic); gone while a number is typed, back after Back;
 * - the Guide key: from the player, the player closes and the guide opens on the channel's row;
 *   on the guide, it closes it; from the list, the guide opens on the focused row;
 * - a restart: the last channel plays with the clock still on.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

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

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';
  const back = tag === 'ar' ? 'RIGHT' : 'LEFT';

  test(`"Clock while watching" and the Guide key: the corner clock with the bar hidden, the guide from the list and the player, through a restart (${locale})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    const player = page.getByTestId('player');
    const corner = page.getByTestId('player-clock');
    const clockRow = page.getByTestId('player-settings-clock');

    await test.step('Settings › "Player": the clock row Off, then On by the reading end\'s arrow and no further', async () => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'player');
      await remote.go('OK', 'player-settings/rows/0');
      for (let i = 1; i <= 4; i += 1) await remote.go('DOWN', `player-settings/rows/${i}`);
      await expect(clockRow).toHaveAttribute('data-value', 'off');
      if (words !== null) {
        expect(await text(page, '[data-testid=player-settings-clock] .settings__name')).toBe(words['playerSettings.clock']);
        expect(await text(page, '[data-testid=player-settings-clock-value]')).toBe(words['playerSettings.off']);
        expect(await text(page, '[data-testid=player-settings-clock] .settings__hint')).toBe(words['playerSettings.clockHint']);
      }
      await remote.press(back);
      await expect(clockRow).toHaveAttribute('data-value', 'off');
      await remote.press(next);
      await expect(clockRow).toHaveAttribute('data-value', 'on');
      await remote.press(next);
      await remote.expectFocus('player-settings/rows/4');
      await expect(clockRow).toHaveAttribute('data-value', 'on');
      if (words !== null) expect(await text(page, '[data-testid=player-settings-clock-value]')).toBe(words['playerSettings.on']);
      else expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `settings-player-clock-${tag}.png`), animations: 'disabled' });
      await expect.poll(() => storedOptions(page)).toEqual({ clock: 'on' });
    });

    /** With the bar up, its time; then INFO hides it and the corner shows the same (once more if the minute turned). */
    const cornerShowsBarTime = async (): Promise<void> => {
      await expect
        .poll(async () => {
          if ((await player.getAttribute('data-info')) !== 'true') await remote.press('INFO');
          await expect(player).toHaveAttribute('data-info', 'true');
          await expect(corner).toHaveCount(0);
          const barTime = await text(page, '[data-testid=player-bar] .player__clock');
          await remote.press('INFO');
          await expect(player).toHaveAttribute('data-info', 'false');
          await expect(corner).toBeVisible();
          return (await text(page, '[data-testid=player-clock]')) === barTime && barTime !== '';
        })
        .toBe(true);
    };

    await test.step('the player: the corner clock only with the bar hidden, in the top-end corner, gone while a number is typed', async () => {
      await remote.go('BACK', settingsRow('player'));
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
      await remote.press('OK');
      await remote.expectFocus('player/actions/0');
      await expect(player).toHaveAttribute('data-clock', 'true');
      await expect(player).toHaveAttribute('data-info', 'true');
      await expect(corner).toHaveCount(0);
      await cornerShowsBarTime();
      const box = (await corner.boundingBox())!;
      // The top-end corner of the safe area: the right in English, the left in Arabic.
      expect(box.y).toBeLessThan(120);
      if (tag === 'ar') expect(box.x).toBeLessThan(200);
      else expect(box.x + box.width).toBeGreaterThan(1720);
      await page.screenshot({ path: path.join(SHOTS, `player-clock-${tag}.png`), animations: 'disabled' });
      // A number typed takes the corner; Back cancels it and the clock is back.
      await remote.press('DIGIT_9');
      await expect(page.getByTestId('player-entry')).toBeVisible();
      await expect(corner).toHaveCount(0);
      await remote.press('BACK');
      await expect(player).toHaveAttribute('data-entry', '');
      await expect(corner).toBeVisible();
    });

    await test.step("the Guide key: from the player to the guide on its channel's row, closed by the key again, then from the list", async () => {
      await remote.go('GUIDE', 'guide/grid/0');
      await expect(player).toHaveCount(0);
      await remote.go('GUIDE', 'live/channels/0');
      await remote.go('DOWN', 'live/channels/1');
      await remote.go('GUIDE', 'guide/grid/1');
      await remote.go('BACK', 'live/channels/1');
      // From the header too (its last button, "Settings"): the list's focused row; the guide closes onto the list, as from the header's "Guide".
      await remote.go('UP', 'live/channels/0');
      await remote.go('UP', 'live/header/5');
      await remote.go('GUIDE', 'guide/grid/0');
      await remote.go('GUIDE', 'live/channels/0');
    });

    await test.step('a restart: the last channel plays, the clock still on', async () => {
      await appIdle(page);
      await page.goto(`/?locale=${locale}`);
      await remote.expectFocus('player/actions/0');
      await expect(player).toHaveAttribute('data-clock', 'true');
      await cornerShowsBarTime();
      await remote.go('BACK', 'live/channels/0');
    });

    expect(errors).toEqual([]);
  });
}
