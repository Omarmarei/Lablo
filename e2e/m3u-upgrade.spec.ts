import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { settled, toSourceTypes, toStartButton, trackErrors, typeInto } from './onboard';
import { storedProfile } from './pairing-steps';
import { playlistOnly } from './playlist-only';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST, toSettingsRow } from './settings-rows';

/**
 * The M3U→Xtream upgrade at add (RELAY step 37a), by keys, in English and Arabic. Onboarding's
 * form is given the mock panel's `get.php` link as an M3U playlist:
 * - the panel's API answers: the done screen counts the panel's shows (2), where the playlist
 *   lists 7 episodes; the profile keeps the panel's login (no link), and Settings › Sources says
 *   "Xtream login";
 * - the panel's API logs in but serves no lists (`playlistOnly`): the link is read as the playlist
 *   it was given as (7 episodes), kept as the link, and Sources says "M3U playlist".
 * The phone's link is upgraded in pairing.spec.ts and pairing-api.spec.ts. The screenshots go to
 * artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const SAYS = {
  en: { sources: 'Sources', upgraded: 'Xtream login', playlist: 'M3U playlist' },
  ar: { sources: 'المصادر', upgraded: 'تسجيل دخول Xtream', playlist: 'قائمة تشغيل M3U' },
} as const;

let panel: MockServer;
let broken: MockServer;
const hosts = { upgraded: '', playlist: '' };

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  panel = await mock({ now: () => Date.now() });
  hosts.upgraded = (await listen(panel)).replace(/^http:\/\//, '');
  broken = await mock({ now: () => Date.now(), scenario: playlistOnly() });
  hosts.playlist = (await listen(broken)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await panel.close();
  await broken.close();
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

for (const [locale, language] of [
  ['en-US', 'en'],
  ['ar-SA', 'ar'],
] as const) {
  for (const kind of ['upgraded', 'playlist'] as const) {
    test(`the panel's get.php link given as a playlist: ${kind === 'upgraded' ? 'read through its API, kept as its login' : 'its API serving no lists, kept as the playlist'} (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const remote = new RemoteDriver(page);
      const host = hosts[kind];
      const app = kind === 'upgraded' ? panel : broken;
      const catalog = app.mockState.catalog;
      const episodes = catalog.series.reduce((n, s) => n + s.seasons.reduce((m, season) => m + season.episodes.length, 0), 0);
      // Typed the way a user would: no `http://` (the form adds it).
      const link = `${host}/get.php?username=${U}&password=${P}&type=m3u_plus&output=ts`;

      const onboarding = await toSourceTypes(remote, `locale=${locale}`);
      await remote.go('DOWN', 'source/types/1');
      await remote.go('OK', 'form/fields/0');
      await typeInto(remote, onboarding, 'playlist', link);
      await remote.expectFocus('form/fields/1');
      await remote.go('DOWN', 'form/fields/2');
      await remote.go('DOWN', 'form/actions/0');
      await remote.press('OK');
      await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 30_000 });
      // The panel's shows, or the playlist's lines (its episodes listed flat).
      await expect(page.getByTestId('done-live')).toHaveAttribute('data-n', String(catalog.live.length));
      await expect(page.getByTestId('done-movies')).toHaveAttribute('data-n', String(catalog.movies.length));
      await expect(page.getByTestId('done-series')).toHaveAttribute('data-n', String(kind === 'upgraded' ? catalog.series.length : episodes));
      await shoot(page, `m3u-upgrade-done-${kind}-${locale}`);
      const name = host.replace(/:\d+$/, '');
      const kept = await storedProfile(page);
      expect(kept?.sources).toEqual([
        kind === 'upgraded'
          ? { id: 's1', type: 'xtream', name, account: { base: `http://${host}`, username: U, password: P }, added: expect.any(Number) }
          : { id: 's1', type: 'm3u', name, url: `http://${link}`, added: expect.any(Number) },
      ]);

      // Start watching, then Settings › Sources: the source's kind and server.
      await toStartButton(remote, onboarding);
      await remote.press('OK');
      const live = page.getByTestId('live');
      await expect(live).toHaveAttribute('data-status', 'ready');
      await settled(live);
      const side = language === 'ar' ? 'LEFT' : 'RIGHT';
      await remote.go('UP', 'live/header/0');
      for (let i = 1; i <= 5; i += 1) await remote.go(side, `live/header/${i}`);
      await remote.go('OK', SETTINGS_FIRST);
      await expect(page.getByTestId('settings-sources')).toContainText(says.sources);
      await toSettingsRow(remote, 'sources');
      await remote.go('OK', 'sources/sources/0');
      await expect(page.getByTestId('sources')).toHaveAttribute('data-status', 'ready');
      await expect(page.getByTestId('source-0')).toHaveAttribute('data-src', 's1');
      await expect(page.getByTestId('source-0-name')).toHaveText(name);
      expect(stripIsolates((await page.getByTestId('source-0-kind').textContent()) ?? '')).toBe(`${says[kind]} · ${host}`);
      await shoot(page, `m3u-upgrade-sources-${kind}-${locale}`);
      expect(errors).toEqual([]);
    });
  }
}
