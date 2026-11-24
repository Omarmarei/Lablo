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

/**
 * The remote's colour keys (RELAY step 39b) on the mock's panel, in English, Arabic and the
 * pseudo-locale (the dev app maps F1–F4 to red, green, yellow and blue):
 * - the dots: green on the header's "Guide", blue on its "Search", yellow on the info bar's
 *   "Previous channel", red on its "Favourites", each in its button's top-end corner;
 * - the live list: red opens the favourites panel for the focused channel over the list (the
 *   list still painted under it, the panel opaque), and its "Favourites" takes the channel;
 *   green opens the guide on the row and closes it again; blue opens the search;
 * - the player: red opens the star's panel, yellow goes back to the channel before, green closes
 *   the player and opens the guide on its row.
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

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).first().textContent()) ?? '');
}

/** The colour-key dot in `button`: its key, its colour, and whether it sits in the button's top-end corner. */
async function dot(button: Locator, rtl: boolean): Promise<{ key: string | null; colour: string; corner: boolean }> {
  const mark = button.locator('.z-button__key');
  await expect(mark).toHaveCount(1);
  const box = (await button.boundingBox())!;
  const at = (await mark.boundingBox())!;
  const colour = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
  // The top third: a dot in the flow would sit in the middle.
  const top = at.y - box.y < box.height / 3;
  const end = rtl ? at.x - box.x < box.width / 2 : at.x - box.x > box.width / 2;
  return { key: await mark.getAttribute('data-key'), colour, corner: top && end };
}

const RED = 'rgb(255, 90, 95)';
const GREEN = 'rgb(76, 198, 106)';
const YELLOW = 'rgb(242, 201, 76)';
const BLUE = 'rgb(76, 154, 255)';

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : EN;
  const rtl = tag === 'ar';
  const next = rtl ? 'LEFT' : 'RIGHT';

  test(`the colour keys: the dots, red, green and blue on the list, red, yellow and green in the player (${locale})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    const player = page.getByTestId('player');
    const panel = page.getByTestId('favourites');

    await test.step("the header's dots: green on \"Guide\", blue on \"Search\"", async () => {
      expect(await dot(page.getByTestId('live-guide'), rtl)).toEqual({ key: 'green', colour: GREEN, corner: true });
      expect(await dot(page.getByTestId('live-search'), rtl)).toEqual({ key: 'blue', colour: BLUE, corner: true });
      // None on the others.
      await expect(page.locator('[data-testid=live-movies] .z-button__key, [data-testid=live-settings] .z-button__key')).toHaveCount(0);
    });

    await test.step('red on the list: the favourites panel for the focused channel over the list; "Favourites" takes it', async () => {
      await remote.go('DOWN', 'live/channels/1');
      await remote.press('RED');
      await remote.expectFocus('favourites/lists/0');
      await expect(panel).toHaveClass('tracks tracks--solid');
      // Under the header, where the list starts.
      const head = (await page.locator('.live__header').boundingBox())!;
      expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(head.y + head.height);
      await expect(page.getByTestId('live')).toBeVisible();
      await expect(player).toHaveCount(0);
      if (tag !== 'en-XA') {
        expect(await text(page, 'favourites-list-0')).toBe(words['category.favourites']);
        expect(stripIsolates((await panel.locator('h2').textContent()) ?? '')).toBe(words['favourites.title']);
      }
      await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'false');
      await page.screenshot({ path: path.join(SHOTS, `colour-red-list-${tag}.png`), animations: 'disabled' });
      await remote.press('OK');
      await expect(panel).toHaveAttribute('data-pending', '0');
      await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'true');
      await remote.press('BACK');
      await remote.expectFocus('live/channels/1');
      await expect(panel).toHaveCount(0);
      await settled(live);
      // "New list" opens its form over the list; Back closes the form, then STOP the panel.
      await remote.press('RED');
      await remote.expectFocus('favourites/lists/0');
      await remote.go('DOWN', 'favourites/lists/1');
      await remote.press('OK');
      await remote.expectFocus('favourite-new/field/0');
      await expect(page.getByTestId('favourite-new')).toBeVisible();
      await expect(page.getByTestId('live')).toBeVisible();
      await remote.go('BACK', 'favourites/lists/1');
      await remote.press('STOP');
      await remote.expectFocus('live/channels/1');
      await expect(panel).toHaveCount(0);
      // The rail has the list after "All channels".
      if (tag !== 'en-XA') expect(await text(page, 'chip-1')).toContain(words['category.favourites']);
      // Red in the rail: nothing.
      await remote.go(rtl ? 'RIGHT' : 'LEFT', 'live/rail/0');
      await remote.press('RED');
      await remote.expectFocus('live/rail/0');
      await expect(panel).toHaveCount(0);
      await remote.go(next, 'live/channels/1');
    });

    await test.step('green on the list: the guide on the row, closed by green again; blue: the search', async () => {
      await remote.go('GREEN', 'guide/grid/1');
      await remote.go('GREEN', 'live/channels/1');
      await remote.go('BLUE', 'search/field/0');
      await remote.go('BACK', 'live/channels/1');
    });

    await test.step("the player: the info bar's dots, red the star's panel, yellow the channel before, green the guide", async () => {
      await remote.press('OK');
      await remote.expectFocus('player/actions/0');
      expect(await dot(page.getByTestId('player-previous'), rtl)).toEqual({ key: 'yellow', colour: YELLOW, corner: true });
      expect(await dot(page.getByTestId('player-favourite'), rtl)).toEqual({ key: 'red', colour: RED, corner: true });
      await page.screenshot({ path: path.join(SHOTS, `colour-player-bar-${tag}.png`), animations: 'disabled' });
      // Red: the panel over the player, the channel already in "Favourites".
      await remote.press('RED');
      await remote.expectFocus('favourites/lists/0');
      await expect(player).toHaveAttribute('data-favourites', 'true');
      await expect(panel).toHaveClass('tracks');
      await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'true');
      await remote.go('BACK', 'player/actions/0');
      // Yellow: as PRE-CH.
      await remote.press('CH_UP');
      await expect(player).toHaveAttribute('data-playing', '2');
      await remote.press('YELLOW');
      await expect(player).toHaveAttribute('data-playing', '1');
      // Green: the player closes, the guide shows the channel's row.
      await remote.go('GREEN', 'guide/grid/1');
      await expect(player).toHaveCount(0);
      await remote.go('BACK', 'live/channels/1');
    });

    expect(errors).toEqual([]);
  });
}
