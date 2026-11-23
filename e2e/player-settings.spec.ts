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
 * Settings › "Player" (RELAY step 38d3) on the mock's panel, in English, Arabic and the
 * pseudo-locale: the row and its page (the values the start has: the app's language, no
 * subtitles, Medium, Fit; the modes of the desktop's `<video>`); each row changed in place, by OK
 * round its values and by the arrows towards the reading end, stopping at the end; the profile's
 * four fields; then the player: the picture in the chosen mode (`data-picture`, the info bar's
 * "Picture: …", the `<video>`'s fit) and the subtitles' size (`data-subtitle-size`: the overlay
 * draws only cues the app has, and the desktop gives it none); a restart keeping all of it. The
 * languages are applied on real tracks in `player-media.spec.ts`.
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

/** The profile's player fields this page sets (absent: `null`), read from IndexedDB. */
function storedPlayer(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const player = ((req.result as { doc?: { player?: Record<string, unknown> } } | undefined)?.doc?.player ?? {}) as Record<string, unknown>;
            resolve({ audioLang: player['audioLang'] ?? null, subtitleLang: player['subtitleLang'] ?? null, subtitleSize: player['subtitleSize'] ?? null, picture: player['picture'] ?? null });
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The `<video>`'s fit and box on the stage (`null`: no video yet). */
function picture(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector('#stage video');
    if (video === null) return null;
    const r = video.getBoundingClientRect();
    return { fit: getComputedStyle(video).objectFit, left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

const ROWS = ['audio', 'subtitles', 'size', 'picture'] as const;

/** Each row's value as stored (`data-value`). */
function values(page: Page): Promise<(string | null)[]> {
  return Promise.all(ROWS.map((row) => page.getByTestId(`player-settings-${row}`).getAttribute('data-value')));
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';
  const back = tag === 'ar' ? 'RIGHT' : 'LEFT';

  test(`Settings › "Player": each row changed in place, kept in the profile, and the picture and the subtitles' size applied in the player, through a restart (${locale})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);

    await test.step('the row, between "Parental control" and "Language"', async () => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'player');
      if (words !== null) {
        expect(await text(page, '[data-testid=settings-player] .settings__name')).toBe(words['settings.player']);
        expect(await text(page, '[data-testid=settings-player] .settings__hint')).toBe(words['settings.playerHint']);
      }
      await remote.go('DOWN', settingsRow('language'));
      await remote.go('UP', settingsRow('player'));
    });

    await test.step("its page on the start's values and the desktop's modes", async () => {
      await remote.go('OK', 'player-settings/rows/0');
      const shown = page.getByTestId('player-settings');
      await expect(shown).toHaveAttribute('data-modes', 'fit zoom stretch 4:3');
      expect(await values(page)).toEqual(['app', 'off', 'm', 'fit']);
      // The settings' list isn't painted under it.
      await expect(page.getByTestId('settings')).toHaveCount(0);
      if (words !== null) {
        expect(await text(page, '[data-testid=player-settings] .settings__title')).toBe(words['settings.player']);
        const names = await Promise.all(ROWS.map((row) => text(page, `[data-testid=player-settings-${row}] .settings__name`)));
        expect(names).toEqual([words['playerSettings.audio'], words['tracks.subtitles'], words['playerSettings.size'], words['playerSettings.picture']]);
        const shownValues = await Promise.all(ROWS.map((row) => text(page, `[data-testid=player-settings-${row}-value]`)));
        expect(shownValues).toEqual([words['playerSettings.app'], words['tracks.off'], words['tracks.size.m'], words['player.picture.fit']]);
      } else {
        expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      }
    });

    await test.step('each row changed: OK round the values, the arrows towards the reading end and no further', async () => {
      // Audio: OK, from the app's language to Arabic.
      await remote.press('OK');
      await expect(page.getByTestId('player-settings-audio')).toHaveAttribute('data-value', 'ar');
      // Subtitles: towards the reading end, Arabic then English, and no further; then back to Arabic.
      await remote.go('DOWN', 'player-settings/rows/1');
      await remote.press(next);
      await expect(page.getByTestId('player-settings-subtitles')).toHaveAttribute('data-value', 'ar');
      await remote.press(next);
      await expect(page.getByTestId('player-settings-subtitles')).toHaveAttribute('data-value', 'en');
      await remote.press(next);
      await remote.expectFocus('player-settings/rows/1');
      await expect(page.getByTestId('player-settings-subtitles')).toHaveAttribute('data-value', 'en');
      await remote.press(back);
      await expect(page.getByTestId('player-settings-subtitles')).toHaveAttribute('data-value', 'ar');
      // Size: one step larger.
      await remote.go('DOWN', 'player-settings/rows/2');
      await remote.press(next);
      await expect(page.getByTestId('player-settings-size')).toHaveAttribute('data-value', 'l');
      // Picture: OK twice, Zoom then Stretch.
      await remote.go('DOWN', 'player-settings/rows/3');
      await remote.press('OK');
      await expect(page.getByTestId('player-settings-picture')).toHaveAttribute('data-value', 'zoom');
      await remote.press('OK');
      await expect(page.getByTestId('player-settings-picture')).toHaveAttribute('data-value', 'stretch');
      if (words !== null) {
        const shownValues = await Promise.all(ROWS.map((row) => text(page, `[data-testid=player-settings-${row}-value]`)));
        expect(shownValues).toEqual([words['lang.ar'], words['lang.ar'], words['tracks.size.l'], words['player.picture.stretch']]);
      } else {
        expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      }
      await page.screenshot({ path: path.join(SHOTS, `settings-player-${tag}.png`), animations: 'disabled' });
      await expect.poll(() => storedPlayer(page)).toEqual({ audioLang: 'ar', subtitleLang: 'ar', subtitleSize: 'l', picture: 'stretch' });
    });

    const player = page.getByTestId('player');
    const expectApplied = async (): Promise<void> => {
      await expect(player).toHaveAttribute('data-picture', 'stretch');
      await expect(player).toHaveAttribute('data-subtitle-size', 'l');
      expect(await picture(page)).toEqual({ fit: 'fill', left: 0, top: 0, width: 1920, height: 1080 });
    };

    await test.step('the player: Stretch on the stage and on the info bar, the large size', async () => {
      await remote.go('BACK', settingsRow('player'));
      await remote.go('BACK', 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
      await remote.press('OK');
      await remote.expectFocus('player/actions/0');
      await expectApplied();
      for (let i = 1; i <= 3; i += 1) await remote.go(next, `player/actions/${i}`);
      if (words !== null) expect(await text(page, '[data-testid=player-picture]')).toBe(words['player.picture'].replace('{mode}', words['player.picture.stretch']));
      // The info bar's button goes on from the mode chosen in Settings.
      await remote.press('OK');
      await expect(player).toHaveAttribute('data-picture', '4:3');
      await remote.press('OK', 'OK', 'OK');
      await expect(player).toHaveAttribute('data-picture', 'stretch');
      await remote.go('BACK', 'live/channels/0');
    });

    await test.step('a restart: the last channel plays as chosen, and the page shows the same values', async () => {
      await appIdle(page);
      await page.goto(`/?locale=${locale}`);
      await remote.expectFocus('player/actions/0');
      await expectApplied();
      await remote.go('BACK', 'live/channels/0');
      await openSettings(remote, next);
      await toSettingsRow(remote, 'player');
      await remote.go('OK', 'player-settings/rows/0');
      expect(await values(page)).toEqual(['ar', 'ar', 'l', 'stretch']);
      // Back to the app's language: OK twice more round Arabic, English, the app's.
      await remote.press('OK');
      await remote.press('OK');
      await expect(page.getByTestId('player-settings-audio')).toHaveAttribute('data-value', 'app');
      await expect.poll(() => storedPlayer(page)).toEqual({ audioLang: null, subtitleLang: 'ar', subtitleSize: 'l', picture: 'stretch' });
    });

    expect(errors).toEqual([]);
  });
}
