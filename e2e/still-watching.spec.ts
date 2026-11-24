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
 * RELAY step 39c on the mock's panel, in English, Arabic and the pseudo-locale, on a clock the
 * test moves (`page.clock`; in jumps, since a clock run ahead of the real stream for more than a
 * few seconds reads to the player's watchdog as a frozen picture):
 * - Settings › "Player"'s sixth and seventh rows: "Still watching?" (After 4 hours at the start;
 *   the arrows step to Never and to After 6 hours and stop there; kept in the profile's
 *   `player.options`, nothing kept for the default) and "Sleep timer" (Off), all seven rows on
 *   the screen;
 * - set to two hours: a key starts the count again; two hours after the last key the prompt
 *   shows over the playing channel, "Keep watching" focused, counting down; Back keeps watching;
 * - unanswered for 60 seconds, the player closes onto the channel's row; the prompt's second
 *   button closes it at once;
 * - the sleep timer: its row says when playback stops; at its time the prompt says the timer
 *   ended; unanswered, the player closes, and the row reads Off again; a timer that ends while
 *   its page shows turns the row Off in place;
 * - a restart: the last channel plays by itself, and with no key for the kept two hours the
 *   prompt asks.
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

/** A message's words before its first argument (`'Stops playback at {time}'`: `'Stops playback at '`). */
function lead(message: string): string {
  const at = message.indexOf('{');
  return at === -1 ? message : message.slice(0, at);
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';
  const back = tag === 'ar' ? 'RIGHT' : 'LEFT';

  test(`"Still watching?" and the sleep timer: the rows, the prompt after two hours with no key, its keys and its end, through a restart (${locale})`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackErrors(page);
    await page.clock.install();
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    const player = page.getByTestId('player');
    const card = page.getByTestId('player-still');
    const stillRow = page.getByTestId('player-settings-still');
    const sleepRow = page.getByTestId('player-settings-sleep');

    /** From the live list to Settings › "Player"'s row `index`. */
    const toPlayerRow = async (index: number): Promise<void> => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'player');
      await remote.go('OK', 'player-settings/rows/0');
      for (let i = 1; i <= index; i += 1) await remote.go('DOWN', `player-settings/rows/${i}`);
    };
    /** From Settings › "Player" back to the live list's first channel, then into the player. */
    const backToPlayer = async (): Promise<void> => {
      await remote.go('BACK', settingsRow('player'));
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
      await remote.press('OK');
      await remote.expectFocus('player/actions/0');
    };

    await test.step('Settings › "Player": "Still watching?" after 4 hours, stepped to Never and to After 6 hours, kept in the profile; the sleep timer Off; seven rows on the screen', async () => {
      await toPlayerRow(5);
      await expect(stillRow).toHaveAttribute('data-value', '4');
      await expect(sleepRow).toHaveAttribute('data-value', 'off');
      if (words !== null) {
        expect(await text(page, '[data-testid=player-settings-still] .settings__name')).toBe(words['player.still.title']);
        expect(await text(page, '[data-testid=player-settings-still] .settings__hint')).toBe(words['playerSettings.stillHint']);
        expect(await text(page, '[data-testid=player-settings-sleep] .settings__name')).toBe(words['playerSettings.sleep']);
        expect(await text(page, '[data-testid=player-settings-sleep-value]')).toBe(words['playerSettings.sleepOff']);
        expect(await text(page, '[data-testid=player-settings-sleep] .settings__hint')).toBe(words['playerSettings.sleepHint']);
      }
      if (tag === 'en') expect(await text(page, '[data-testid=player-settings-still-value]')).toBe('After 4 hours');
      await expect.poll(() => storedOptions(page)).toBeNull();
      // Towards the start: two hours, then never, and no further.
      await remote.press(back);
      await expect(stillRow).toHaveAttribute('data-value', '2');
      await expect.poll(() => storedOptions(page)).toEqual({ stillWatching: '2' });
      await remote.press(back);
      await expect(stillRow).toHaveAttribute('data-value', 'off');
      if (words !== null) expect(await text(page, '[data-testid=player-settings-still-value]')).toBe(words['playerSettings.stillNever']);
      await remote.press(back);
      await remote.expectFocus('player-settings/rows/5');
      await expect(stillRow).toHaveAttribute('data-value', 'off');
      await expect.poll(() => storedOptions(page)).toEqual({ stillWatching: 'off' });
      // Towards the end: the default keeps nothing; six hours, and no further.
      await remote.press(next, next);
      await expect(stillRow).toHaveAttribute('data-value', '4');
      await expect.poll(() => storedOptions(page)).toEqual({});
      await remote.press(next, next);
      await expect(stillRow).toHaveAttribute('data-value', '6');
      await expect.poll(() => storedOptions(page)).toEqual({ stillWatching: '6' });
      // OK goes round: never, then two hours, which the rest of the test uses.
      await remote.press('OK', 'OK');
      await expect(stillRow).toHaveAttribute('data-value', '2');
      if (tag === 'en') expect(await text(page, '[data-testid=player-settings-still-value]')).toBe('After 2 hours');
      await expect.poll(() => storedOptions(page)).toEqual({ stillWatching: '2' });
      // The seventh row, in view with the six above it.
      await remote.go('DOWN', 'player-settings/rows/6');
      await expectInSafeArea(sleepRow);
      await expectInSafeArea(page.getByTestId('player-settings-audio'));
      if (words === null) expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `settings-player-still-${tag}.png`), animations: 'disabled' });
    });

    await test.step('two hours after the last key the prompt asks over the channel, "Keep watching" focused, counting down; Back keeps watching', async () => {
      await backToPlayer();
      await expect(player).toHaveAttribute('data-still', '');
      await page.clock.fastForward('01:59:00');
      await expect(player).toHaveAttribute('data-still', '');
      // A key: the count starts again.
      await remote.press('INFO');
      await page.clock.fastForward('01:59:00');
      await expect(player).toHaveAttribute('data-still', '');
      await expect(card).toHaveCount(0);
      await page.clock.fastForward('00:01:05');
      await expect(player).toHaveAttribute('data-still', 'idle');
      await remote.expectFocus('player/card/0');
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('data-reason', 'idle');
      await expect(player).toHaveAttribute('data-info', 'false');
      await expect(page.getByTestId('player-bar')).toHaveCount(0);
      // After the clock's jump the player may be connecting again (to its watchdog the picture froze): no "Connecting…" under the card.
      await expect(page.getByTestId('player-wait')).toHaveCount(0);
      if (words !== null) {
        expect(await text(page, '[data-testid=player-still] h2')).toBe(words['player.still.title']);
        expect(await text(page, '[data-testid=player-still-text]')).toBe(words['player.still.idle']);
        expect(await text(page, '[data-testid=player-still-keep]')).toBe(words['player.still.keep']);
        expect(await text(page, '[data-testid=player-still-stop]')).toBe(words['player.channels']);
        expect(await text(page, '[data-testid=player-still-countdown]')).toContain(lead(words['player.still.in']));
      } else expect(await untranslated(page, '[data-testid=player-still]')).toEqual([]);
      await expectInSafeArea(card);
      await expect(page.getByTestId('player-still-keep')).toHaveAttribute('data-state', 'focused');
      await page.screenshot({ path: path.join(SHOTS, `player-still-${tag}.png`), animations: 'disabled' });
      // The seconds go down.
      const before = Number(await player.getAttribute('data-still-seconds'));
      expect(before).toBeGreaterThan(40);
      expect(before).toBeLessThanOrEqual(60);
      await page.clock.runFor(3_000);
      await expect.poll(async () => Number(await player.getAttribute('data-still-seconds'))).toBeLessThanOrEqual(before - 3);
      expect(Number(await player.getAttribute('data-still-seconds'))).toBeGreaterThan(before - 20);
      expect(await text(page, '[data-testid=player-still-countdown]')).toMatch(/\d/);
      // Back: the prompt goes, the channel plays on.
      const plays = await player.getAttribute('data-plays');
      await remote.press('BACK');
      await expect(player).toHaveAttribute('data-still', '');
      await expect(card).toHaveCount(0);
      await remote.expectFocus('player/actions/0');
      await expect(player).toHaveAttribute('data-plays', plays!);
      await expect(player).toHaveAttribute('data-playing', '0');
    });

    await test.step('unanswered for 60 seconds, the player closes onto the row; the second button closes it at once', async () => {
      await page.clock.fastForward('02:00:05');
      await expect(player).toHaveAttribute('data-still', 'idle');
      await remote.expectFocus('player/card/0');
      // The arrows move between the two buttons and stop at the ends; the prompt stays.
      await remote.press(back);
      await remote.expectFocus('player/card/0');
      await remote.go(next, 'player/card/1');
      await remote.press(next);
      await remote.expectFocus('player/card/1');
      await remote.go(back, 'player/card/0');
      await expect(player).toHaveAttribute('data-still', 'idle');
      await page.clock.fastForward('00:01:01');
      await remote.expectFocus('live/channels/0');
      await expect(player).toHaveCount(0);
      // Again, and "Channels" this time.
      await remote.press('OK');
      await remote.expectFocus('player/actions/0');
      await page.clock.fastForward('02:00:05');
      await expect(player).toHaveAttribute('data-still', 'idle');
      await remote.go(next, 'player/card/1');
      await remote.go('OK', 'live/channels/0');
      await expect(player).toHaveCount(0);
    });

    await test.step('the sleep timer: its row says when playback stops; at its time the prompt says so; unanswered, the player closes and the row is Off again', async () => {
      await toPlayerRow(6);
      await expect(sleepRow).toHaveAttribute('data-value', 'off');
      await remote.press(back);
      await expect(sleepRow).toHaveAttribute('data-value', 'off');
      await remote.press(next);
      await expect(sleepRow).toHaveAttribute('data-value', '30');
      const hint = await text(page, '[data-testid=player-settings-sleep] .settings__hint');
      if (words !== null) {
        expect(hint.startsWith(lead(words['playerSettings.sleepUntil']))).toBe(true);
        expect(hint).not.toBe(words['playerSettings.sleepHint']);
      } else expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      expect(hint).toMatch(/\d/);
      if (tag === 'en') expect(await text(page, '[data-testid=player-settings-sleep-value]')).toBe('30 minutes');
      await page.screenshot({ path: path.join(SHOTS, `settings-player-sleep-${tag}.png`), animations: 'disabled' });
      // It is the player's own, for this run only: nothing of it in the profile.
      await expect.poll(() => storedOptions(page)).toEqual({ stillWatching: '2' });
      await backToPlayer();
      await page.clock.fastForward('00:29:00');
      await expect(player).toHaveAttribute('data-still', '');
      await page.clock.fastForward('00:01:05');
      await expect(player).toHaveAttribute('data-still', 'sleep');
      await remote.expectFocus('player/card/0');
      await expect(card).toHaveAttribute('data-reason', 'sleep');
      if (words !== null) expect(await text(page, '[data-testid=player-still-text]')).toBe(words['player.still.sleep']);
      else expect(await untranslated(page, '[data-testid=player-still]')).toEqual([]);
      await page.clock.fastForward('00:01:01');
      await remote.expectFocus('live/channels/0');
      await expect(player).toHaveCount(0);
      await toPlayerRow(6);
      await expect(sleepRow).toHaveAttribute('data-value', 'off');
      // A timer that ends while its page shows: the row turns Off in place.
      await remote.press(next, next);
      await expect(sleepRow).toHaveAttribute('data-value', '60');
      await page.clock.fastForward('00:59:00');
      await expect(sleepRow).toHaveAttribute('data-value', '60');
      await page.clock.fastForward('00:01:05');
      await expect(sleepRow).toHaveAttribute('data-value', 'off');
      await remote.expectFocus('player-settings/rows/6');
      await remote.go('BACK', settingsRow('player'));
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
    });

    await test.step('a restart: the last channel plays by itself, and two hours later with no key the prompt asks', async () => {
      await appIdle(page);
      await page.goto(`/?locale=${locale}`);
      await remote.expectFocus('player/actions/0');
      await expect(player).toHaveAttribute('data-still', '');
      await page.clock.fastForward('01:59:00');
      await expect(player).toHaveAttribute('data-still', '');
      await page.clock.fastForward('00:01:05');
      await expect(player).toHaveAttribute('data-still', 'idle');
      await remote.expectFocus('player/card/0');
      await remote.go('OK', 'player/actions/0');
      await expect(player).toHaveAttribute('data-still', '');
      await remote.go('BACK', 'live/channels/0');
      await toPlayerRow(5);
      await expect(stillRow).toHaveAttribute('data-value', '2');
      // The sleep timer didn't come back with the app.
      await expect(sleepRow).toHaveAttribute('data-value', 'off');
    });

    expect(errors).toEqual([]);
  });
}
