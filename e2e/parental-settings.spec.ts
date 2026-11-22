import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { catalog, rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { chips, pad, setHidden, toLastEntry, typePin, untranslated } from './parental-steps';
import { pinFields, restartWith } from './profile-edit';
import { RemoteDriver } from './remote-driver';

/**
 * Settings › "Parental control" (RELAY step 38c1) on the mock's panel, a PIN written to the
 * profile first ("Set a PIN" with a source's login is step 38c2).
 *
 * Checked, in en-US and ar-SA: the settings list scrolled to its eighth row; "Lock adult groups"
 * asking the PIN (a wrong one, then the right one) and switching off, the 18+ group then in the
 * rail with no "Locked groups"; on again in a new visit, the PIN asked again; "Locked groups"
 * listing the groups with their locks, one locked by hand and out of the rail; "Change the PIN"
 * typed differently, then twice alike, and the new PIN opening the locked groups; a channel locked
 * from the info bar's pencil in a locked session (the player closes, the channel out of sight);
 * Settings › "Channels" leaving it out while locked, listing it as locked once unlocked, and
 * "Unlock channel" asking the PIN. In en-XA: the pages, the pad's modes and the menu show only
 * our strings.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const PIN = '2468';
const NEW_PIN = '1357';
const ADULT = catalog.live.find((c) => c.adult)!;
const ADULT_GROUP = catalog.liveCategories.find((c) => c.id === ADULT.categoryId)!.name;
/** The rail's groups by default: every one with channels but the adult one, which is the last. */
const GROUPS = catalog.liveCategories.filter((c) => catalog.live.some((ch) => ch.categoryId === c.id && !ch.adult)).map((c) => c.name);

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace('http://', '');
});

test.afterAll(async () => {
  await app.close();
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).first().textContent()) ?? '');
}

/** From the list's first row: the header's "Settings" (UP lands on the header's last button), opening on its first row. */
async function openSettings(remote: RemoteDriver, next: 'LEFT' | 'RIGHT'): Promise<void> {
  const focus = (): Promise<string> => remote.page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? '');
  await remote.press('UP');
  await expect.poll(focus).toMatch(/^live\/header\/\d+$/);
  for (let i = Number((await focus()).split('/')[2]) + 1; i <= 5; i += 1) await remote.go(next, `live/header/${i}`);
  await remote.expectFocus('live/header/5');
  await remote.go('OK', 'settings/items/0');
}

/** From the list's first row: Settings, down the list to "Parental control" (the eighth), then OK. */
async function openParental(remote: RemoteDriver, next: 'LEFT' | 'RIGHT'): Promise<void> {
  await openSettings(remote, next);
  for (let i = 1; i <= 7; i += 1) await remote.go('DOWN', `settings/items/${i}`);
  await remote.go('OK', 'parental/rows/0');
  await expect(remote.page.getByTestId('parental')).toHaveAttribute('data-status', 'ready');
}

/** From the page back to the list's first row. */
async function backToList(remote: RemoteDriver): Promise<void> {
  await remote.go('BACK', 'settings/items/7');
  await remote.go('BACK', 'live/header/5');
  await remote.go('DOWN', 'live/channels/0');
}

/** The channel menu's actions on show, by their test ids. */
async function menuActions(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid=channel-edit] [data-testid^="channel-edit-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
  return ids.filter((id) => id !== 'channel-edit-name' && id !== 'channel-edit-problem').map((id) => id.slice('channel-edit-'.length));
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
] as const) {
  const ar = tag === 'ar';
  const words = ar ? AR : EN;
  const next = ar ? 'LEFT' : 'RIGHT';

  test(`changes the locks and the PIN in Settings › "Parental control", and locks a channel from the pencil (${locale})`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    await restartWith(page, { parental: pinFields(PIN) }, `/?locale=${locale}`);
    await expect(live).toHaveAttribute('data-status', 'ready');
    await remote.expectFocus('live/channels/0');
    await settled(live);
    const screen = page.getByTestId('settings-screen');

    await test.step('the settings list scrolls to its eighth row, "Parental control"', async () => {
      await openSettings(remote, next);
      await expect(page.locator('[data-testid=settings] [role=menu]')).toHaveAttribute('data-top', '0');
      await expect(page.getByTestId('settings-parental')).toHaveCount(0);
      for (let i = 1; i <= 7; i += 1) await remote.go('DOWN', `settings/items/${i}`);
      await expect(page.locator('[data-testid=settings] [role=menu]')).toHaveAttribute('data-top', '1');
      await expect(page.getByTestId('settings-guides')).toHaveCount(0);
      expect(await text(page, 'settings-parental')).toBe(`${words['settings.parental']}${words['settings.parentalHint']}`);
      await shoot(page, `parental-settings-list-${tag}`);
      await remote.go('OK', 'parental/rows/0');
      await expect(page.getByTestId('parental')).toHaveAttribute('data-status', 'ready');
      expect(await text(page, 'parental-adult-value')).toBe(words['parental.on']);
      await shoot(page, `parental-page-${tag}`);
    });

    await test.step('"Lock adult groups" asks the PIN: a wrong one, then the right one switches it off', async () => {
      await remote.go('DOWN', 'parental/rows/1');
      await remote.go('OK', 'pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'check', typed: '0', problem: '' });
      await expect(page.getByTestId('pin-dialog').locator('.z-dialog__title')).toHaveText(words['parental.padTitle']);
      await typePin(remote, '1111');
      await expect(page.getByTestId('pin-problem')).toHaveAttribute('data-problem', 'wrong');
      await typePin(remote, PIN);
      await remote.expectFocus('parental/rows/1');
      await settled(screen);
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'false');
      expect(await text(page, 'parental-adult-value')).toBe(words['parental.off']);
      // Once a visit: OK again switches it at once, then back.
      await remote.press('OK');
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'true');
      await settled(screen);
      await remote.press('OK');
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'false');
      await settled(screen);
      await remote.expectFocus('parental/rows/1');
    });

    await test.step('the 18+ group in the rail, with no "Locked groups"', async () => {
      await backToList(remote);
      await settled(live);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS, ADULT_GROUP]);
    });

    await test.step('on again in a new visit: the PIN asked again', async () => {
      await openParental(remote, next);
      await remote.go('DOWN', 'parental/rows/1');
      await remote.go('OK', 'pin/pad/0');
      await typePin(remote, PIN);
      await remote.expectFocus('parental/rows/1');
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'true');
      await settled(screen);
      // Hidden and shown, the page still open: the PIN asked again.
      await setHidden(page, true);
      await setHidden(page, false);
      await remote.go('OK', 'pin/pad/0');
      await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'check');
      await typePin(remote, PIN);
      await remote.expectFocus('parental/rows/1');
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'false');
      await settled(screen);
      await remote.press('OK');
      await expect(page.getByTestId('parental-adult')).toHaveAttribute('data-value', 'true');
      await settled(screen);
    });

    await test.step('"Locked groups": every group with its lock; one locked by hand leaves the rail', async () => {
      // (The PIN was given in this visit: no pad.)
      await remote.go('DOWN', 'parental/rows/2');
      await remote.go('OK', 'locked-groups/rows/0');
      const page2 = page.getByTestId('locked-groups');
      await expect(page2).toHaveAttribute('data-status', 'ready');
      const listed = await page.locator('[data-testid=locked-groups] [data-kind]').evaluateAll((els) =>
        els.map((el) => `${el.getAttribute('data-kind')}:${el.getAttribute('data-name')}:${el.getAttribute('data-locked')}:${el.getAttribute('data-adult')}`),
      );
      // The live groups first, in the panel's order; the 18+ one adult and locked.
      expect(listed[0]).toBe(`live:${GROUPS[0]}:false:false`);
      expect(listed).toContain(`live:${ADULT_GROUP}:true:true`);
      expect(await text(page, 'locked-0-value')).toBe(words['parental.open']);
      await remote.press('OK');
      await settled(screen);
      await expect(page.getByTestId('locked-0')).toHaveAttribute('data-locked', 'true');
      expect(await text(page, 'locked-0-value')).toBe(words['parental.locked']);
      await remote.expectFocus('locked-groups/rows/0');
      await shoot(page, `parental-locked-groups-${tag}`);
      await remote.go('BACK', 'parental/rows/2');
      await backToList(remote);
      await settled(live);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS.slice(1), `locked ${words['parental.lockedGroups']}`]);
    });

    await test.step('"Change the PIN": two different ones say so; the same twice keeps it', async () => {
      await openParental(remote, next);
      await remote.go('OK', 'pin/pad/0');
      await typePin(remote, PIN);
      // (The check's pad gives way to the new PIN's, both on the pad's first cell.)
      await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'set');
      await remote.expectFocus('pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'set', typed: '0', problem: '' });
      await expect(page.getByTestId('pin-dialog').locator('.z-dialog__title')).toHaveText(words['parental.setTitle']);
      await typePin(remote, NEW_PIN);
      await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'again');
      await expect(page.getByTestId('pin-dialog').locator('.z-dialog__title')).toHaveText(words['parental.againTitle']);
      await typePin(remote, '1358');
      await expect(page.getByTestId('pin-problem')).toHaveAttribute('data-problem', 'mismatch');
      await expect(page.getByTestId('pin-problem')).toHaveText(words['parental.mismatch']);
      await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'set');
      await shoot(page, `parental-pin-mismatch-${tag}`);
      await typePin(remote, NEW_PIN);
      await typePin(remote, NEW_PIN);
      await remote.expectFocus('parental/rows/0');
      expect(await text(page, 'parental-change-hint')).toBe(words['parental.changed']);
      await backToList(remote);
    });

    await test.step('the new PIN opens the locked groups; the old one is wrong', async () => {
      await toLastEntry(remote, ar, GROUPS.length + 1);
      await remote.go('OK', 'pin/pad/0');
      await typePin(remote, PIN);
      await expect(page.getByTestId('pin-problem')).toHaveAttribute('data-problem', 'wrong');
      await typePin(remote, NEW_PIN);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], `open ${GROUPS[0]}`, ...GROUPS.slice(1), `open ${ADULT_GROUP}`, `locked ${words['parental.lockAgain']}`]);
      // The focus on the first group that came back; down to "Lock again", OK, then to the list.
      await remote.expectFocus('live/rail/1');
      for (let i = 2; i <= GROUPS.length + 2; i += 1) await remote.go('DOWN', `live/rail/${i}`);
      await remote.go('OK', `live/rail/${GROUPS.length}`);
      await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS.slice(1), `locked ${words['parental.lockedGroups']}`]);
      await remote.go(ar ? 'LEFT' : 'RIGHT', 'live/channels/0');
    });

    const first = stripIsolates((await rows(page))[0]!.name);

    await test.step('a channel locked from the pencil in a locked session: the player closes, the channel out of sight', async () => {
      await remote.go('OK', 'player/actions/0');
      for (let i = 1; i <= 5; i += 1) await remote.go(next, `player/actions/${i}`);
      await remote.go('OK', 'channel-edit/actions/0');
      await expect(page.getByTestId('channel-edit')).toHaveAttribute('data-pending', '0');
      expect(await menuActions(page)).toEqual(['rename', 'number', 'hide', 'lock', 'cancel']);
      expect(await text(page, 'channel-edit-lock')).toBe(words['channels.lock']);
      await shoot(page, `parental-channel-lock-${tag}`);
      for (let i = 1; i <= 3; i += 1) await remote.go('DOWN', `channel-edit/actions/${i}`);
      await remote.press('OK');
      await expect(page.getByTestId('player')).toHaveCount(0);
      await expect.poll(async () => (await rows(page)).map((r) => stripIsolates(r.name))).not.toContain(first);
      await remote.expectFocus('live/channels/0');
    });

    await test.step('Settings › "Channels" leaves it out while locked; unlocked, "Unlock channel" asks the PIN', async () => {
      await openSettings(remote, next);
      for (let i = 1; i <= 6; i += 1) await remote.go('DOWN', `settings/items/${i}`);
      await remote.go('OK', 'channels/rows/0');
      await expect(page.getByTestId('channels')).toHaveAttribute('data-status', 'ready');
      await settled(screen);
      expect(await page.getByTestId('channels').getAttribute('data-count')).toBe('0');
      await remote.go('BACK', 'settings/items/6');
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
      await toLastEntry(remote, ar, GROUPS.length + 1);
      await remote.go('OK', 'pin/pad/0');
      await typePin(remote, NEW_PIN);
      // (On the first group that came back, once its channels are read.)
      await remote.expectFocus('live/rail/1');
      await settled(live);
      await expect(live).toHaveAttribute('data-status', 'ready');
      await remote.go(ar ? 'LEFT' : 'RIGHT', 'live/channels/0');
      await openSettings(remote, next);
      for (let i = 1; i <= 6; i += 1) await remote.go('DOWN', `settings/items/${i}`);
      await remote.go('OK', 'channels/rows/0');
      await settled(screen);
      expect(await page.getByTestId('channels').getAttribute('data-count')).toBe('1');
      expect(await text(page, 'channels-row-0-line')).toBe(words['parental.locked']);
      await remote.go('DOWN', 'channels/rows/1');
      await remote.go('OK', 'channel-edit/actions/0');
      expect(await menuActions(page)).toEqual(['rename', 'number', 'hide', 'unlock', 'reset', 'cancel']);
      for (let i = 1; i <= 3; i += 1) await remote.go('DOWN', `channel-edit/actions/${i}`);
      await remote.go('OK', 'pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'check', typed: '0', problem: '' });
      await typePin(remote, NEW_PIN);
      await remote.expectFocus('channels/rows/0');
      await settled(screen);
      expect(await page.getByTestId('channels').getAttribute('data-count')).toBe('0');
    });

    expect(errors).toEqual([]);
  });
}

test('shows only our strings, bracketed, on "Parental control", the pad\'s new modes and "Locked groups" (en-XA)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-XA');
  await settled(live);
  await restartWith(page, { parental: pinFields(PIN) }, '/?locale=en-XA');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await remote.expectFocus('live/channels/0');
  await settled(live);
  await openParental(remote, 'RIGHT');
  expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
  await shoot(page, 'parental-page-en-XA');
  await remote.go('OK', 'pin/pad/0');
  await typePin(remote, PIN);
  await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'set');
  expect(await untranslated(page, '[data-testid=pin]')).toEqual([]);
  await typePin(remote, NEW_PIN);
  await typePin(remote, '0000');
  await expect(page.getByTestId('pin-problem')).toHaveAttribute('data-problem', 'mismatch');
  expect(await untranslated(page, '[data-testid=pin]')).toEqual([]);
  await shoot(page, 'parental-pin-mismatch-en-XA');
  await remote.press('BACK');
  await remote.expectFocus('parental/rows/0');
  await remote.go('DOWN', 'parental/rows/1');
  await remote.go('DOWN', 'parental/rows/2');
  await remote.go('OK', 'locked-groups/rows/0');
  await expect(page.getByTestId('locked-groups')).toHaveAttribute('data-status', 'ready');
  // (Groups' names are data: translate=no.)
  expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
  await shoot(page, 'parental-locked-groups-en-XA');
  expect(errors).toEqual([]);
});
