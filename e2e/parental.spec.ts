import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { catalog, ordered, rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { chips, pad, setHidden, toLastEntry, typePin, untranslated } from './parental-steps';
import { pinFields, restartWith } from './profile-edit';
import { RemoteDriver } from './remote-driver';

/**
 * Parental control's unlocking (RELAY step 38b) on the mock's panel, whose "18+ Test (lock check)"
 * (channel 109, the panel's `is_adult`) is locked by default and out of sight until the PIN.
 *
 * Checked, in en-US and ar-SA: the rail without the group and ending with "Locked groups"; the
 * search finding nothing of it; a PIN written to the profile; "Locked groups" opens the pad; a
 * wrong PIN by the number keys; the PIN by the arrows and OK (left to right in Arabic too); the
 * group back in its place with an open lock and "Lock again"; channel 109 plays; the app hidden
 * and shown: the pad over everything with the stream held, the PIN carries on; "Lock again";
 * Home's "Recent channels" without 109; unlocked again, hidden and shown, Back on the pad starts
 * the app again, locked, and the channel watched last (109) doesn't play. In en-XA: the rail's
 * entries and the pad show only our strings.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const PIN = '2468';
const ADULT = catalog.live.find((c) => c.adult)!;
const ADULT_GROUP = catalog.liveCategories.find((c) => c.id === ADULT.categoryId)!.name;
/** The rail's groups by default: every one with channels but the adult one, which is the last. */
const GROUPS = catalog.liveCategories.filter((c) => catalog.live.some((ch) => ch.categoryId === c.id && !ch.adult)).map((c) => c.name);

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

let app: MockServer;
let host: string;
/** Every URL the mock was asked for. */
const requests: string[] = [];
/** How many times the 18+ channel's stream was asked for. */
const streamAsks = (): number => requests.filter((url) => url.indexOf(`/${ADULT.id}.`) !== -1).length;

test.beforeAll(async () => {
  app = await mock({ now: () => Date.now() });
  app.addHook('onRequest', async (request) => {
    requests.push(request.url);
  });
  host = (await listen(app)).replace('http://', '');
});

test.afterAll(async () => {
  await app.close();
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
] as const) {
  const ar = tag === 'ar';
  const words = ar ? AR : EN;

  test(`keeps the adult group out of sight until the PIN, and locks again when the app hides (${locale})`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);

    await test.step('locked by default: the rail without the group, ending with "Locked groups"', async () => {
      expect(await chips(page)).toEqual([words['category.all'], ...GROUPS, `locked ${words['parental.lockedGroups']}`]);
      await expect(page.locator('[data-testid=live-meta] [data-n]')).toHaveAttribute('data-n', String(ordered.length));
      expect((await rows(page)).map((r) => stripIsolates(r.name))).not.toContain(ADULT.name);
      await shoot(page, `parental-rail-${tag}`);
    });

    await test.step('the search finds nothing of it', async () => {
      await remote.go('UP', 'live/header/0');
      for (let i = 1; i <= 4; i += 1) await remote.go(ar ? 'LEFT' : 'RIGHT', `live/header/${i}`);
      await remote.go('OK', 'search/field/0');
      const search = page.getByTestId('search-screen');
      await remote.go('OK', 'search/field/0');
      await expect(search).toHaveAttribute('data-editing', 'search-field');
      // "Test Pattern": the 18+ channel's name, and a movie's ("Lablo Test Pattern 4K HEVC"), which is found alone.
      await page.keyboard.type('Test Pattern');
      await expect(search).toHaveAttribute('data-answered', 'Test Pattern');
      await expect(search).toHaveAttribute('data-count', '1');
      await settled(search);
      expect(stripIsolates((await page.getByTestId('result-0').textContent()) ?? '')).not.toContain(ADULT.name);
      expect(stripIsolates((await page.getByTestId('result-0').textContent()) ?? '')).toContain('Lablo Test Pattern 4K HEVC');
      await remote.go('OK', 'search/results/0');
      await remote.go('BACK', 'search/field/0');
      await remote.go('BACK', 'live/header/4');
      await remote.go('DOWN', 'live/channels/0');
    });

    await test.step('a PIN written to the profile; "Locked groups" opens the pad', async () => {
      await restartWith(page, { parental: pinFields(PIN) }, `/?locale=${locale}`);
      await expect(live).toHaveAttribute('data-status', 'ready');
      await remote.expectFocus('live/channels/0');
      await settled(live);
      await toLastEntry(remote, ar, GROUPS.length + 2);
      await remote.go('OK', 'pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'rail', typed: '0', problem: '' });
      await expect(page.getByTestId('pin-dialog').locator('.z-dialog__title')).toHaveText(words['parental.padTitle']);
      // Left to right in every language: 1 2 3 on the first row.
      const one = (await page.getByTestId('pin-0').boundingBox())!;
      const two = (await page.getByTestId('pin-1').boundingBox())!;
      expect(one.x).toBeLessThan(two.x);
      await shoot(page, `parental-pad-${tag}`);
    });

    await test.step('a wrong PIN by the number keys clears the boxes and says so', async () => {
      await remote.press('DIGIT_1', 'DIGIT_1');
      await expect(page.getByTestId('pin-boxes')).toHaveAttribute('data-typed', '2');
      await remote.press('DIGIT_1', 'DIGIT_1');
      await expect(page.getByTestId('pin-problem')).toHaveAttribute('data-problem', 'wrong');
      await expect(page.getByTestId('pin-problem')).toHaveText(words['parental.wrong']);
      await expect(page.getByTestId('pin-boxes')).toHaveAttribute('data-typed', '0');
      await shoot(page, `parental-wrong-${tag}`);
    });

    await test.step('the PIN by the arrows and OK (RIGHT is to the right in Arabic too): the group back, open', async () => {
      // 2 (RIGHT), 4 (LEFT, DOWN), 6 (RIGHT, RIGHT), 8 (DOWN, LEFT).
      await remote.go('RIGHT', 'pin/pad/1');
      await remote.press('OK');
      await remote.go('LEFT', 'pin/pad/0');
      await remote.go('DOWN', 'pin/pad/3');
      await remote.press('OK');
      await remote.go('RIGHT', 'pin/pad/4');
      await remote.go('RIGHT', 'pin/pad/5');
      await remote.press('OK');
      await remote.go('DOWN', 'pin/pad/8');
      await remote.go('LEFT', 'pin/pad/7');
      await remote.press('OK');
      // The focus on the group that came back, in its place; the last entry reads "Lock again".
      await remote.expectFocus(`live/rail/${GROUPS.length + 1}`);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS, `open ${ADULT_GROUP}`, `locked ${words['parental.lockAgain']}`]);
      await expect(page.locator('[data-testid=rail] .z-chip').first().locator('.z-chip__count')).toHaveText(String(catalog.live.length));
      await shoot(page, `parental-unlocked-${tag}`);
    });

    await test.step('its channel plays; hidden and shown, the pad covers it all and the PIN carries on', async () => {
      await remote.go('OK', 'live/channels/0');
      await settled(live);
      expect((await rows(page)).map((r) => stripIsolates(r.name))).toEqual([ADULT.name]);
      await remote.go('OK', 'player/actions/0');
      await expect.poll(streamAsks).toBeGreaterThan(0);
      // (The dev server's mock streams don't play in this browser: the player keeps opening, and a
      // hidden app's opening stream is opened again when it shows, unless the pad holds it.)
      await setHidden(page, true);
      const held = streamAsks();
      await setHidden(page, false);
      await remote.expectFocus('pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'return', typed: '0', problem: '' });
      await expect(page.getByTestId('pin-dialog').locator('.z-dialog__title')).toHaveText(words['parental.returnTitle']);
      await shoot(page, `parental-return-${tag}`);
      await page.waitForTimeout(1_500);
      expect(streamAsks()).toBe(held);
      await typePin(remote, PIN);
      await remote.expectFocus('player/actions/0');
      await expect.poll(streamAsks).toBeGreaterThan(held);
      await remote.go('BACK', 'live/channels/0');
    });

    await test.step('"Lock again": the group out of sight, the focus on "Locked groups"; Home lists no 109', async () => {
      await toLastEntry(remote, ar, GROUPS.length + 3);
      await remote.go('OK', `live/rail/${GROUPS.length + 1}`);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS, `locked ${words['parental.lockedGroups']}`]);
      await expect(live).toHaveAttribute('data-category', '0');
      // To the list, then UP to the header (its first button since the start), then "Home".
      await remote.go(ar ? 'LEFT' : 'RIGHT', 'live/channels/0');
      await remote.go('UP', 'live/header/0');
      for (let i = 1; i <= 3; i += 1) await remote.go(ar ? 'LEFT' : 'RIGHT', `live/header/${i}`);
      await remote.press('OK');
      const home = page.getByTestId('home-screen');
      await expect(home).toHaveAttribute('data-status', 'ready');
      await settled(home);
      await expect(page.getByTestId('home-channels')).toHaveCount(0);
      await remote.go('BACK', 'live/header/3');
    });

    await test.step('unlocked again, hidden and shown: Back on the pad starts the app again, locked, and 109 doesn’t play', async () => {
      await remote.go('DOWN', 'live/channels/0');
      await toLastEntry(remote, ar, GROUPS.length + 2);
      await remote.go('OK', 'pin/pad/0');
      await typePin(remote, PIN);
      await remote.expectFocus(`live/rail/${GROUPS.length + 1}`);
      await setHidden(page, true);
      await setHidden(page, false);
      await remote.expectFocus('pin/pad/0');
      await remote.press('BACK');
      await expect(live).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
      await settled(live);
      await remote.expectFocus('live/channels/0');
      await expect(page.getByTestId('player')).toHaveCount(0);
      expect(await chips(page)).toEqual([words['category.all'], ...GROUPS, `locked ${words['parental.lockedGroups']}`]);
    });

    expect(errors).toEqual([]);
  });
}

test('shows only our strings, bracketed, on the rail’s entries and the pad, in the pseudo-locale (en-XA)', async ({ page }) => {
  test.setTimeout(120_000);
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-XA');
  await settled(live);
  await restartWith(page, { parental: pinFields(PIN) }, '/?locale=en-XA');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await remote.expectFocus('live/channels/0');
  await settled(live);
  expect(await untranslated(page, '[data-testid=rail]')).toEqual([]);
  await toLastEntry(remote, false, GROUPS.length + 2);
  await remote.go('OK', 'pin/pad/0');
  await remote.press('DIGIT_1', 'DIGIT_1', 'DIGIT_1', 'DIGIT_1');
  await expect(page.getByTestId('pin-problem')).toHaveAttribute('data-problem', 'wrong');
  expect(await untranslated(page, '[data-testid=pin]')).toEqual([]);
  await shoot(page, 'parental-pad-en-XA');
  await typePin(remote, PIN);
  await remote.expectFocus(`live/rail/${GROUPS.length + 1}`);
  expect(await untranslated(page, '[data-testid=rail]')).toEqual([]);
  await shoot(page, 'parental-unlocked-en-XA');
  // With no PIN (one written away): the dialog says locked groups need one.
  await remote.go('DOWN', `live/rail/${GROUPS.length + 2}`);
  await remote.go('OK', `live/rail/${GROUPS.length + 1}`);
  await restartWith(page, { parental: { groups: [] } }, '/?locale=en-XA');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await settled(live);
  await toLastEntry(remote, false, GROUPS.length + 2);
  await remote.go('OK', 'no-pin/buttons/0');
  expect(await untranslated(page, '[data-testid=no-pin]')).toEqual([]);
  await shoot(page, 'parental-no-pin-en-XA');
  // Its "Cancel" (step 38c2: "Set a PIN" first).
  await remote.go('RIGHT', 'no-pin/buttons/1');
  await remote.go('OK', `live/rail/${GROUPS.length + 1}`);
});
