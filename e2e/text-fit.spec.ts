import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { SETTINGS_ITEMS } from '../apps/tv/src/settings/settings-items';
import { settled, startWatching, toSourceTypes, typeInto } from './onboard';
import { RemoteDriver } from './remote-driver';
import { openSettings, toSettingsRow } from './settings-rows';
import type { Misfit } from './text-fit';
import { misfits } from './text-fit';

/**
 * RELAY step 58a: every screen's text inside its box, in English and Arabic, at both text sizes
 * (`e2e/text-fit.ts`). Found on the LG in leg 168: Settings' "Player" hint wrapped out of its
 * 120 px row, and with "Larger text" Settings, the search results and the groups' rows drew or cut
 * their second line. With larger text a vertical list now shows fewer, taller rows (`shownRows`).
 *
 * One walk per language and size: onboarding (checked at the normal size: larger text is a
 * setting, so a first start is never large), then Larger text on as a viewer turns it on, then
 * each screen from a fresh start: live and its header, the guide, movies and a
 * film, series and a show, home, search (empty, with results, and the app's own keyboard), every
 * Settings row's page (Player's lower rows and its Accessibility page too, Sources' row menu and
 * add form), Back on the live screen, and the player. Screenshots: artifacts/screenshots/text-fit/.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots/text-fit');

type Key = Parameters<RemoteDriver['press']>[0];

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

function focus(page: Page): Promise<string> {
  return page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? '');
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
] as const) {
  for (const size of ['normal', 'large'] as const) {
    test(`every screen's text fits its box (${locale}, ${size} text)`, async ({ page }) => {
      test.setTimeout(400_000);
      const next: Key = tag === 'ar' ? 'LEFT' : 'RIGHT';
      const back: Key = tag === 'ar' ? 'RIGHT' : 'LEFT';
      const remote = new RemoteDriver(page);
      const found: Record<string, Misfit[]> = {};
      const look = async (name: string): Promise<void> => {
        // Past the focus ring's and the rows' short transitions.
        await page.waitForTimeout(300);
        const list = await misfits(page);
        if (list.length > 0) found[name] = list;
        await page.screenshot({ path: path.join(SHOTS, `${tag}-${size}-${name}.png`), animations: 'disabled' });
      };
      const moved = async (key: Key, prefix: RegExp): Promise<void> => {
        await remote.press(key);
        await expect.poll(() => focus(page), { timeout: 10_000 }).toMatch(prefix);
      };
      /** A start on the live screen (`query` added), the profile's text size on. */
      const fresh = async (query = ''): Promise<void> => {
        await page.goto(`/?locale=${locale}${query}`);
        await expect.poll(() => focus(page), { timeout: 20_000 }).toMatch(/^live\//);
        if (size === 'large') await expect(page.locator('html')).toHaveAttribute('data-large-text', 'on');
        await settled(page.getByTestId('live'));
      };
      /** From the live list to the header's button `index`. */
      const header = async (index: number): Promise<void> => {
        await moved('UP', /^live\/header\//);
        for (let i = Number((await focus(page)).split('/')[2]); i < index; i += 1) await remote.go(next, `live/header/${i + 1}`);
        for (let i = Number((await focus(page)).split('/')[2]); i > index; i -= 1) await remote.go(back, `live/header/${i - 1}`);
      };

      await test.step('onboarding', async () => {
        const onboarding = await toSourceTypes(remote, `locale=${locale}`);
        if (size === 'normal') await look('onboarding-types');
        await remote.go('OK', 'form/fields/0');
        if (size === 'normal') await look('onboarding-form');
        await typeInto(remote, onboarding, 'server', host);
        await typeInto(remote, onboarding, 'username', U);
        await typeInto(remote, onboarding, 'password', P);
        await remote.go('DOWN', 'form/fields/4');
        await remote.go('DOWN', 'form/actions/0');
        await settled(await startWatching(remote, onboarding, 20_000));
      });

      if (size === 'large') {
        await test.step('"Larger text" on (Settings › Player › Accessibility), kept from here on', async () => {
          await openSettings(remote, next);
          await toSettingsRow(remote, 'player');
          await remote.go('OK', 'player-settings/rows/0');
          for (let i = 1; i <= 8; i += 1) await remote.go('DOWN', `player-settings/rows/${i}`);
          await remote.go('OK', 'player-access/rows/0');
          await remote.go('DOWN', 'player-access/rows/1');
          await remote.go('DOWN', 'player-access/rows/2');
          await remote.press('OK');
          await expect(page.locator('html')).toHaveAttribute('data-large-text', 'on');
        });
      }

      await test.step('live, its header and the guide', async () => {
        await fresh();
        await look('live');
        await header(0);
        await look('live-header');
        await moved('OK', /^guide\//);
        await look('guide');
      });

      await test.step('movies and a film, series and a show, home', async () => {
        await fresh();
        await header(1);
        await moved('OK', /^movies\//);
        await look('movies');
        await moved('OK', /^movie\//);
        await look('movie-details');
        await fresh();
        await header(2);
        await moved('OK', /^series\//);
        await look('series');
        await moved('OK', /^show\//);
        await look('show-details');
        await fresh();
        await header(3);
        await moved('OK', /^home\//);
        await look('home');
      });

      await test.step('search: empty, with results, and the own keyboard', async () => {
        await fresh();
        await header(4);
        await moved('OK', /^search\//);
        await look('search-empty');
        const root = page.getByTestId('search-screen');
        await remote.press('OK');
        await expect(root).toHaveAttribute('data-editing', 'search-field');
        await page.keyboard.type(tag === 'ar' ? 'اختبار' : 'test');
        await expect(root).toHaveAttribute('data-answered', /.+/);
        await settled(root);
        await remote.press('OK');
        await look('search-results');
        await fresh('&keyboard=own');
        await header(4);
        await moved('OK', /^search\//);
        await remote.press('OK');
        await expect(page.locator('.z-kbd')).toBeVisible();
        await look('keyboard');
      });

      await test.step('every Settings row, Player and Accessibility, Sources\' row menu and add form', async () => {
        await fresh();
        await openSettings(remote, next);
        await look('settings-top');
        await toSettingsRow(remote, SETTINGS_ITEMS[SETTINGS_ITEMS.length - 1]!);
        await look('settings-bottom');
        for (const item of SETTINGS_ITEMS) {
          // "Send a report to support" sends one: nothing to see past its row.
          if (item === 'report') continue;
          await fresh();
          await openSettings(remote, next);
          await toSettingsRow(remote, item);
          const before = await focus(page);
          await remote.press('OK');
          // A switch row ("Usage and crash reports") stays on its row.
          await expect
            .poll(() => focus(page), { timeout: 3_000 })
            .not.toBe(before)
            .catch(() => undefined);
          await look(`settings-${item}`);
          if (item === 'player') {
            for (let i = 1; i <= 8; i += 1) await remote.go('DOWN', `player-settings/rows/${i}`);
            await look('settings-player-bottom');
            await remote.go('OK', 'player-access/rows/0');
            await look('settings-player-access');
          }
          if (item === 'sources') {
            await moved('OK', /^(?!sources\/sources\/0$)/);
            await look('settings-sources-menu');
            await remote.go('BACK', 'sources/sources/0');
            await remote.go('UP', 'sources/header/0');
            await remote.go(next, 'sources/header/1');
            await remote.go('OK', 'source-add/fields/0');
            await look('settings-sources-add');
          }
        }
      });

      await test.step('Back on the live screen, then the player (a start after it plays reopens it: last)', async () => {
        await fresh();
        await remote.press('BACK');
        await look('live-back');
        await fresh();
        await moved('OK', /^player\//);
        await look('player');
      });

      expect(found).toEqual({});
    });
  }
}
