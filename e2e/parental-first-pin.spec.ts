import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { devSignedAnswer } from '../tools/engines/src/config';
import { phoneSends } from '../tools/engines/src/pair-phone';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { catalog } from './live-rows';
import { fillXtream, settled, trackErrors } from './onboard';
import { openSources, shownCode } from './pairing-steps';
import { chips, pad, toLastEntry, typePin, untranslated } from './parental-steps';
import { RemoteDriver } from './remote-driver';

/**
 * The first PIN asked for when a source is added (RELAY step 38c3, Q2): the mock's panel has the
 * 18+ group, locked by default, and no PIN is set, so the done screens offer "Set a PIN" or "Later".
 *
 * Checked, in en-US and ar-SA:
 * - onboarding's done screen: its line and two buttons; "Set a PIN" opens the pad's new PIN over
 *   it, Back returns to the two buttons; the PIN typed twice starts the live screen, locked, and
 *   "Locked groups" asks for that PIN, which opens the 18+ group;
 * - "Later": the live screen with no PIN ("Locked groups" says one is needed); then Settings ›
 *   Sources › "Add from your phone" (the stand-in pairing API, a scripted phone) offers it again on
 *   the pairing screen's done view; Back from its pad returns to the view; the PIN kept closes the
 *   pairing screen to Sources, and "Locked groups" asks for it.
 * In en-XA: both prompts and the pad over onboarding show only our strings.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const PIN = '4826';
const ADULT = catalog.live.find((c) => c.adult)!;
const ADULT_GROUP = catalog.liveCategories.find((c) => c.id === ADULT.categoryId)!.name;
/** The rail's groups by default: every one with channels but the adult one. */
const GROUPS = catalog.liveCategories.filter((c) => catalog.live.some((ch) => ch.categoryId === c.id && !ch.adult)).map((c) => c.name);

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace('http://', '');
});

test.afterAll(async () => {
  await app.close();
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).first().textContent()) ?? '');
}

async function withServer(run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(devSignedAnswer(doc()));
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

/** Settings › Sources › "Add from your phone": the phone sends the mock's playlist link, and the pairing screen shows its done view. */
async function addFromPhone(remote: RemoteDriver, server: ConfigServer, language: 'en' | 'ar'): Promise<void> {
  await openSources(remote, language);
  await remote.go('UP', 'sources/header/0');
  await remote.go('OK', 'pair/actions/0');
  const code = await shownCode(remote.page);
  await expect.poll(() => server.pair.latest()?.polls ?? 0).toBeGreaterThan(0);
  await phoneSends(server.origin, code, { v: 1, source: { type: 'm3u', url: `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus` }, name: 'Phone list' });
  await expect(remote.page.getByTestId('pair')).toHaveAttribute('data-view', 'done', { timeout: 30_000 });
  await remote.expectFocus('pair/actions/0');
}

/** From the list: the rail's last entry, "Locked groups"; OK opens the pad on its PIN, which opens the locked groups. */
async function openWith(remote: RemoteDriver, ar: boolean, words: typeof AR): Promise<void> {
  const page = remote.page;
  await toLastEntry(remote, ar, (await chips(page)).length);
  expect((await chips(page)).pop()).toBe(`locked ${words['parental.lockedGroups']}`);
  await remote.go('OK', 'pin/pad/0');
  expect(await pad(page)).toEqual({ purpose: 'rail', typed: '0', problem: '' });
  await typePin(remote, PIN);
  // (The rail is windowed: with two sources' groups its focus, on the first group that came back, scrolls "Lock again" out of view.)
  await expect.poll(() => chips(page)).toContain(`open ${ADULT_GROUP}`);
  await expect(page.getByTestId('pin')).toHaveCount(0);
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
] as const) {
  const ar = tag === 'ar';
  const words = ar ? AR : EN;
  const next = ar ? 'LEFT' : 'RIGHT';

  test(`onboarding's done screen sets the first PIN; the live screen starts locked (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const onboarding = await fillXtream(remote, { host, username: U, password: P }, `locale=${locale}`);
    await remote.press('OK');
    await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
    await remote.expectFocus('done/actions/0');
    expect(await text(page, 'done-pin')).toBe(words['done.pinNote']);
    expect(await text(page, 'action-0')).toBe(words['parental.set']);
    expect(await text(page, 'action-1')).toBe(words['done.later']);
    await shoot(page, `parental-first-pin-done-${tag}`);

    // The pad's new PIN over the done screen; Back returns to its two buttons.
    await remote.go('OK', 'pin/pad/0');
    expect(await pad(page)).toEqual({ purpose: 'set', typed: '0', problem: '' });
    expect(await text(page, 'pin-dialog')).toContain(words['parental.setTitle']);
    await remote.go('BACK', 'done/actions/0');
    await expect(onboarding).toHaveAttribute('data-screen', 'done');
    await expect(page.getByTestId('action-1')).toHaveCount(1);

    // The PIN typed twice: onboarding is over, the live screen starts with the 18+ group out of sight.
    await remote.go('OK', 'pin/pad/0');
    await typePin(remote, PIN);
    await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'again');
    await typePin(remote, PIN);
    const live = page.getByTestId('live');
    await expect(live).toHaveAttribute('data-status', 'ready');
    await remote.expectFocus('live/channels/0');
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    await settled(live);
    await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS, `locked ${words['parental.lockedGroups']}`]);

    // "Locked groups" asks for the PIN just set (with none, a dialog would say one is needed).
    await openWith(remote, ar, words);
    expect(errors).toEqual([]);
  });

  test(`"Later" sets no PIN; Settings' add from the phone asks again, and sets it there (${locale})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    await withServer(async (server) => {
      const onboarding = await fillXtream(remote, { host, username: U, password: P }, `locale=${locale}&api=${encodeURIComponent(server.origin)}`);
      await remote.press('OK');
      await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
      await remote.go(next, 'done/actions/1');
      await remote.press('OK');
      const live = page.getByTestId('live');
      await expect(live).toHaveAttribute('data-status', 'ready');
      await remote.expectFocus('live/channels/0');
      await settled(live);

      // No PIN: "Locked groups" says one is needed.
      await toLastEntry(remote, ar, GROUPS.length + 2);
      await remote.go('OK', 'no-pin/buttons/0');
      await remote.go(next, 'no-pin/buttons/1');
      await remote.press('OK');
      await remote.expectFocus(`live/rail/${GROUPS.length + 1}`);
      await remote.go(next, 'live/channels/0');

      // The phone's source: the done view asks again (the 18+ group is still locked, still no PIN).
      await addFromPhone(remote, server, tag);
      expect(await text(page, 'pair-pin')).toBe(words['done.pinNote']);
      expect(await text(page, 'pair-action-0')).toBe(words['parental.set']);
      expect(await text(page, 'pair-action-1')).toBe(words['done.later']);
      await shoot(page, `parental-first-pin-pair-${tag}`);
      await remote.go('OK', 'pin/pad/0');
      expect(await pad(page)).toEqual({ purpose: 'set', typed: '0', problem: '' });
      await remote.go('BACK', 'pair/actions/0');
      await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'done');
      await remote.go('OK', 'pin/pad/0');
      await typePin(remote, PIN);
      await expect(page.getByTestId('pin')).toHaveAttribute('data-purpose', 'again');
      await typePin(remote, PIN);
      // Kept: the pairing screen closes to Sources, which lists both.
      await remote.expectFocus('sources/header/0');
      await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '2');

      // Back on the list, "Locked groups" asks for the new PIN.
      await remote.go('BACK', 'settings/items/1');
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
      await settled(live);
      await openWith(remote, ar, words);
    });
    expect(errors).toEqual([]);
  });
}

test('shows only our strings, bracketed, on both prompts and the pad over onboarding (en-XA)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(async (server) => {
    const onboarding = await fillXtream(remote, { host, username: U, password: P }, `locale=en-XA&api=${encodeURIComponent(server.origin)}`);
    await remote.press('OK');
    await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
    await expect(onboarding).toHaveAttribute('data-language', 'pseudo');
    await expect(page.getByTestId('done-pin')).toHaveCount(1);
    expect(await untranslated(page, '[data-testid=onboarding]')).toEqual([]);
    await shoot(page, 'parental-first-pin-done-en-XA');
    await remote.go('OK', 'pin/pad/0');
    expect(await untranslated(page, '[data-testid=pin]')).toEqual([]);
    await shoot(page, 'parental-first-pin-pad-en-XA');

    // "Later", then the phone's source from Settings: its done view's prompt.
    await remote.go('BACK', 'done/actions/0');
    await remote.go('RIGHT', 'done/actions/1');
    await remote.press('OK');
    const live = page.getByTestId('live');
    await expect(live).toHaveAttribute('data-status', 'ready');
    await remote.expectFocus('live/channels/0');
    await settled(live);
    await addFromPhone(remote, server, 'en');
    await expect(page.getByTestId('pair-pin')).toHaveCount(1);
    expect(await untranslated(page, '[data-testid=pair]')).toEqual([]);
    await shoot(page, 'parental-first-pin-pair-en-XA');
    await remote.go('RIGHT', 'pair/actions/1');
    await remote.press('OK');
    await remote.expectFocus('sources/header/0');
  });
  expect(errors).toEqual([]);
});
