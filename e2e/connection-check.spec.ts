import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { parseScenario } from '../apps/mock-provider/src/faults';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { stripIsolates } from '../packages/core/src/bidi';
import { devSignedAnswer } from '../tools/engines/src/config';
import { doc, startConfigServer } from './config-server';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { untranslated } from './parental-steps';
import { RemoteDriver } from './remote-driver';
import { openSettings, settingsRow, toSettingsRow } from './settings-rows';

/**
 * Settings › "Check the connection" (RELAY step 40a) against the mock's panel, in English, Arabic
 * and the pseudo-locale: the row (before "Send a report to support") and its page: the verdict,
 * the internet, the source's panel (its time, the account active until its date with its
 * connections) and the last stream (none yet), all inside the safe area. In English: the panel
 * answering 503 (the provider's side), the account expired (the error card's words), the TV
 * offline (nothing asked) and back, each by "Check again".
 *
 * "Test stream" (RELAY step 40b), with a dev-signed config naming a link (`?api=` the test's
 * stand-in), in the three languages: the button between "Check again" and "Close" and the
 * line "Not played yet"; the test screen over the stage (the page transparent) with its bar;
 * plain e2e plays nothing, so the link answers 404: the bar says it didn't play with the
 * player's code, and back on the page the line and the verdict say so, "Last stream" untouched.
 * In English, a config without the link takes the button and the line away. Without a config
 * (step 40a's test) there is neither. The played path is in the media e2e (player-media.spec.ts).
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
test.afterEach(() => {
  app.mockState.scenario = null;
  const account = app.mockState.fixture.accounts.find((a) => a.username === U)!;
  (account as { status: string }).status = 'Active';
});

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).first().textContent()) ?? '');
}

/** Waits for the verdict, and gives it. */
async function verdict(page: Page): Promise<string> {
  await expect(page.getByTestId('connection')).not.toHaveAttribute('data-verdict', '');
  return (await page.getByTestId('connection').getAttribute('data-verdict')) ?? '';
}

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';

  test(`Settings › "Check the connection": the internet, the panel's account and the last stream, then the verdict (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);

    await test.step('the row, between "Usage and crash reports" and "Send a report to support"', async () => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'connection');
      if (words !== null) {
        expect(stripIsolates((await page.locator('[data-testid=settings-connection] .settings__name').textContent()) ?? '')).toBe(words['settings.connection']);
        expect(stripIsolates((await page.locator('[data-testid=settings-connection] .settings__hint').textContent()) ?? '')).toBe(words['settings.connectionHint']);
      }
      await remote.go('DOWN', settingsRow('report'));
      await remote.go('UP', settingsRow('connection'));
    });

    await test.step('its page: everything answers, the account active, nothing played yet', async () => {
      await remote.go('OK', 'connection-check/actions/0');
      expect(await verdict(page)).toBe('ok');
      await expect(page.getByTestId('settings')).toHaveCount(0);
      await expect(page.getByTestId('settings-screen')).toHaveAttribute('data-pending', '0');
      await expect(page.getByTestId('connection-internet')).toHaveAttribute('data-tone', 'ok');
      await expect(page.getByTestId('connection-source-0')).toHaveAttribute('data-tone', 'ok');
      await expect(page.getByTestId('connection-source-1')).toHaveCount(0);
      await expect(page.getByTestId('connection-last')).toHaveAttribute('data-tone', 'info');
      // No config here, so no test stream (step 40b).
      await expect(page.getByTestId('connection-test-play')).toHaveCount(0);
      await expect(page.getByTestId('connection-test')).toHaveCount(0);
      if (words !== null) {
        expect(await text(page, 'connection-verdict')).toBe(words['connection.verdict.ok']);
        expect(await text(page, 'connection-internet-value')).toBe(words['connection.online']);
        // The panel's name as onboarding gave it, its time, and the account (`lablo`: a year, 2 connections).
        expect(await text(page, 'connection-source-0-value')).toMatch(tag === 'ar' ? /^أجاب خلال .+ ث$/ : /^Answered in \d+(\.\d)? s$/);
        const detail = await text(page, 'connection-source-0-detail');
        const until = words['connection.activeUntil'].split('{date}')[0]!;
        expect(detail.startsWith(until)).toBe(true);
        expect(detail).toContain(stripIsolates(words['player.account.connections'].split('{active, number}')[0]!));
        expect(await text(page, 'connection-last-value')).toBe(words['connection.lastNone']);
        expect(await page.getByTestId('connection-again').textContent()).toBe(words['connection.again']);
        expect(await page.getByTestId('connection-close').textContent()).toBe(words['action.close']);
      } else {
        expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      }
    });

    await test.step('all of it inside the safe area: the verdict on at most two lines, each line 76 px', async () => {
      for (const id of ['connection-verdict', 'connection-internet', 'connection-source-0', 'connection-last', 'connection-again', 'connection-close']) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.x, id).toBeGreaterThanOrEqual(SAFE.left);
        expect(box!.y, id).toBeGreaterThanOrEqual(SAFE.top);
        expect(box!.x + box!.width, id).toBeLessThanOrEqual(SAFE.right);
        expect(box!.y + box!.height, id).toBeLessThanOrEqual(SAFE.bottom);
        if (id.startsWith('connection-') && !id.endsWith('verdict') && !id.endsWith('again') && !id.endsWith('close')) expect(box!.height, id).toBe(76);
      }
      expect((await page.getByTestId('connection-verdict').boundingBox())!.height).toBeLessThanOrEqual(112);
      // Every line's words are on one line, cut with an ellipsis if they must be.
      const wraps = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.connection__value, .connection__name, .connection__detail'))
          .filter((e) => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) + 1)
          .map((e) => e.textContent),
      );
      expect(wraps).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `connection-check-${tag}.png`), animations: 'disabled' });
    });

    if (tag === 'en') {
      await test.step('the panel answering 503: the provider\'s side, its status on its line', async () => {
        app.mockState.scenario = parseScenario({ rules: [{ match: { path: '/player_api.php' }, faults: [{ type: 'status', status: 503 }] }] }, 'panel-down');
        await remote.press('OK');
        expect(await verdict(page)).toBe('provider');
        expect(await text(page, 'connection-verdict')).toBe(EN['connection.verdict.provider']);
        expect(await text(page, 'connection-source-0-value')).toBe('Answered with error 503');
        await expect(page.getByTestId('connection-source-0')).toHaveAttribute('data-tone', 'warn');
        // A server answered: the internet works.
        expect(await text(page, 'connection-internet-value')).toBe(EN['connection.online']);
        app.mockState.scenario = null;
      });

      await test.step("the account expired: the error card's words, as the verdict and under the line", async () => {
        const account = app.mockState.fixture.accounts.find((a) => a.username === U)!;
        (account as { status: string }).status = 'Expired';
        await remote.press('OK');
        expect(await verdict(page)).toBe('expired');
        expect(await text(page, 'connection-verdict')).toBe(EN['player.account.expired']);
        expect(await text(page, 'connection-source-0-detail')).toBe(EN['player.account.expired']);
        (account as { status: string }).status = 'Active';
      });

      await test.step('offline: nothing asked, "Not connected"; back online, all answers again', async () => {
        await page.context().setOffline(true);
        await remote.press('OK');
        expect(await verdict(page)).toBe('offline');
        expect(await text(page, 'connection-internet-value')).toBe(EN['connection.offline']);
        await expect(page.getByTestId('connection-source-0')).toHaveCount(0);
        await page.context().setOffline(false);
        await remote.press('OK');
        expect(await verdict(page)).toBe('ok');
        await expect(page.getByTestId('connection-source-0')).toHaveAttribute('data-tone', 'ok');
      });

      await test.step("a channel the provider doesn't send: the error card, then the last stream's line and the verdict say so", async () => {
        app.mockState.scenario = parseScenario({ rules: [{ match: { path: '/live/**' }, faults: [{ type: 'status', status: 404 }] }] }, 'no-streams');
        await remote.go('BACK', settingsRow('connection'));
        await remote.go('BACK', 'live/header/5');
        await remote.go('DOWN', 'live/channels/0');
        await remote.press('OK');
        const player = page.getByTestId('player');
        await expect(page.getByTestId('player-card')).toHaveAttribute('data-category', 'provider', { timeout: 20_000 });
        const code = (await player.getAttribute('data-failure')) ?? '';
        expect(code).toMatch(/^PRV-/);
        await remote.go('BACK', 'live/channels/0');
        app.mockState.scenario = null;
        await openSettings(remote, next);
        await toSettingsRow(remote, 'connection');
        await remote.go('OK', 'connection-check/actions/0');
        expect(await verdict(page)).toBe('channel');
        expect(await text(page, 'connection-verdict')).toBe(EN['connection.verdict.channel']);
        expect(await text(page, 'connection-last-value')).toBe(EN['player.provider.title']);
        expect(await text(page, 'connection-last-detail')).toBe(`Code ${code}`);
        await expect(page.getByTestId('connection-last')).toHaveAttribute('data-tone', 'warn');
      });
    }

    await test.step('"Close" and Back return to its row', async () => {
      await remote.go(next, 'connection-check/actions/1');
      await remote.go('OK', settingsRow('connection'));
      await remote.go('OK', 'connection-check/actions/0');
      await remote.go('BACK', settingsRow('connection'));
    });

    // The streams the 404 step refused are the only errors (the browser logs each).
    expect(errors.filter((e) => !e.includes('the server responded with a status of 404'))).toEqual([]);
  });

  test(`"Test stream" (step 40b): the button with the config's link, its screen over the stage, and a failure on the page (${locale})`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const previous = tag === 'ar' ? 'RIGHT' : 'LEFT';
    const server = await startConfigServer('');
    try {
      // Plain e2e decodes no stream (the mock's play only in the media run): the link answers 404.
      server.serve(devSignedAnswer(doc({ kill: [], testStream: { url: `${server.origin}/test/pattern.m3u8` } })));
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}&api=${encodeURIComponent(server.origin)}`);
      await settled(live);
      await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe('fresh');
      await openSettings(remote, next);
      await toSettingsRow(remote, 'connection');
      await remote.go('OK', 'connection-check/actions/0');
      expect(await verdict(page)).toBe('ok');
      let code = '';

      await test.step('the button between "Check again" and "Close", the line not played yet, inside the safe area', async () => {
        await expect(page.getByTestId('connection-test')).toHaveAttribute('data-tone', 'info');
        if (words !== null) {
          expect(await text(page, 'connection-test-play')).toBe(words['connection.test']);
          expect(stripIsolates((await page.locator('[data-testid=connection-test] .connection__name').textContent()) ?? '')).toBe(words['connection.test']);
          expect(await text(page, 'connection-test-value')).toBe(words['connection.testNone']);
        }
        for (const id of ['connection-last', 'connection-test', 'connection-again', 'connection-test-play', 'connection-close']) {
          const box = await page.getByTestId(id).boundingBox();
          expect(box, id).not.toBeNull();
          expect(box!.x, id).toBeGreaterThanOrEqual(SAFE.left);
          expect(box!.y, id).toBeGreaterThanOrEqual(SAFE.top);
          expect(box!.x + box!.width, id).toBeLessThanOrEqual(SAFE.right);
          expect(box!.y + box!.height, id).toBeLessThanOrEqual(SAFE.bottom);
        }
        expect((await page.getByTestId('connection-test').boundingBox())!.height).toBe(76);
        // In reading order: "Check again", "Test stream", "Close" (from the right in Arabic).
        const xs: number[] = [];
        for (const id of ['connection-again', 'connection-test-play', 'connection-close']) xs.push((await page.getByTestId(id).boundingBox())!.x);
        expect(xs).toEqual(tag === 'ar' ? [...xs].sort((a, b) => b - a) : [...xs].sort((a, b) => a - b));
        await remote.go(next, 'connection-check/actions/1');
      });

      await test.step('its screen: the stage under a transparent page, then the failure with its code', async () => {
        await remote.go('OK', 'test-stream/test/0');
        await expect(page.locator('html')).toHaveAttribute('data-player', 'on');
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        await expect(page.getByTestId('test-stream')).toHaveAttribute('data-phase', 'failed', { timeout: 60_000 });
        const detail = await text(page, 'test-stream-detail');
        const label = words === null ? EN['player.code'] : words['player.code'];
        if (words !== null) {
          expect(await text(page, 'test-stream-state')).toBe(words['connection.testFailed']);
          expect(detail.startsWith(label.split('{code}')[0]!)).toBe(true);
          code = detail.slice(label.split('{code}')[0]!.length);
          expect(code).toMatch(/^[A-Z]+-[A-Z0-9-]+$/);
        } else {
          expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
        }
        // The bar at the bottom of the safe area; nothing else paints over the picture.
        const bar = (await page.locator('.test-stream__bar').boundingBox())!;
        expect(bar.x).toBeGreaterThanOrEqual(SAFE.left);
        expect(bar.x + bar.width).toBeLessThanOrEqual(SAFE.right);
        expect(Math.round(bar.y + bar.height)).toBe(SAFE.bottom);
        expect(await page.evaluate(() => getComputedStyle(document.elementFromPoint(960, 300)!).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        await page.screenshot({ path: path.join(SHOTS, `test-stream-${tag}.png`), animations: 'disabled' });
      });

      await test.step("Back: the page again; its line and the verdict say Lablo's test stream didn't play, and the last stream is untouched", async () => {
        await remote.go('BACK', 'connection-check/actions/1');
        await expect(page.locator('html')).toHaveAttribute('data-player', 'off');
        expect(await verdict(page)).toBe('test');
        await expect(page.getByTestId('connection-test')).toHaveAttribute('data-tone', 'warn');
        if (words !== null) {
          expect(await text(page, 'connection-verdict')).toBe(words['connection.verdict.test']);
          expect(await text(page, 'connection-test-value')).toBe(words['connection.testFailed']);
          expect(await text(page, 'connection-test-detail')).toBe(words['player.code'].replace('{code}', code));
          expect(await text(page, 'connection-last-value')).toBe(words['connection.lastNone']);
        } else {
          expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
        }
        await page.screenshot({ path: path.join(SHOTS, `connection-test-${tag}.png`), animations: 'disabled' });
      });

      if (tag === 'en') {
        await test.step('a config turning playback off: no button and no line at the next check', async () => {
          server.serve(devSignedAnswer(doc({ kill: [{ id: 'off', match: {}, mode: 'disable-playback' }], testStream: { url: `${server.origin}/test/pattern.m3u8` } }, Date.now() + 1_000)));
          expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh' });
          await remote.go(previous, 'connection-check/actions/0');
          await remote.press('OK');
          await expect(page.getByTestId('connection-test-play')).toHaveCount(0);
          await expect(page.getByTestId('connection-test')).toHaveCount(0);
          await remote.expectFocus('connection-check/actions/0');
          // This check read the last stream again: the test's failure never became it.
          await expect(page.getByTestId('connection-last')).toHaveAttribute('data-tone', 'info');
          expect(await text(page, 'connection-last-value')).toBe(EN['connection.lastNone']);
        });

        await test.step('a config without the link: no button and no line at the next check', async () => {
          // Playback allowed again, with the link: the button is back; then without the link it goes.
          server.serve(devSignedAnswer(doc({ kill: [], testStream: { url: `${server.origin}/test/pattern.m3u8` } }, Date.now() + 2_000)));
          expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh' });
          await remote.press('OK');
          await expect(page.getByTestId('connection-test-play')).toHaveCount(1);
          server.serve(devSignedAnswer(doc({ kill: [] }, Date.now() + 3_000)));
          expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh' });
          await remote.go(previous, 'connection-check/actions/0');
          await remote.press('OK');
          await expect(page.getByTestId('connection-test-play')).toHaveCount(0);
          await expect(page.getByTestId('connection-test')).toHaveCount(0);
          await remote.expectFocus('connection-check/actions/0');
        });
      }

      // The 404s the test stream got are the only errors (the browser logs each).
      expect(errors.filter((e) => !e.includes('the server responded with a status of 404'))).toEqual([]);
    } finally {
      await server.close();
    }
  });
}
