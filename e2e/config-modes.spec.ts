import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addXtreamAndWatch, fillXtream, startWatching, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The config's kill modes inside the app (RELAY step 30c2b), with a dev-signed config served by
 * the test (config-server.ts) and `?api=` pointing the app at it:
 * - `block-new-sources`: onboarding's "Add source" refused at once with the doc's message,
 *   nothing in the profile; the rule lifted by a refresh, "Try again" adds the source;
 * - `disable-playback` arriving through `refreshConfig()` while a channel plays: the stream
 *   stops, the card shows the doc's message, its button goes back to the row, and the next
 *   channel is refused too;
 * - both in Arabic, in the doc's Arabic text.
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const NO_NEW = { en: 'Adding sources is paused for maintenance.', ar: 'إضافة المصادر متوقفة مؤقتًا للصيانة.' };
const NO_PLAY = { en: 'Playback is paused in your region.', ar: 'التشغيل متوقف مؤقتًا في منطقتك.' };
const blockNew = { id: 'no-new', match: {}, mode: 'block-new-sources', message: NO_NEW };
const noPlay = { id: 'no-play', match: {}, mode: 'disable-playback', message: NO_PLAY };

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

async function withServer(answer: string, run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(answer);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

/** The config's answer is in with the kill rule `mode` (`null`: none), and no run goes on. */
async function configHas(page: Page, mode: string | null): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe('fresh');
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.kill?.mode ?? null)).toBe(mode);
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.configIdle() ?? false)).toBe(true);
}

/** The profile's sources (their ids), read from IndexedDB once the app has opened it. */
function storedSources(page: Page): Promise<unknown> {
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
            const record = req.result as { doc: { sources?: { id: string }[] } } | undefined;
            resolve(record === undefined ? null : (record.doc.sources ?? []).map((s) => s.id));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The stage's `<video>` holds no stream: gone, or stopped (no `src`). */
function stageStopped(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const video = document.querySelector('#stage video');
    return video === null || video.getAttribute('src') === null;
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** The live screen's channel at `row` opened with OK (the player's screen is up). */
async function openChannel(remote: RemoteDriver, row: number): Promise<void> {
  await remote.go('DOWN', `live/channels/${row}`);
  await remote.press('OK');
}

test('block-new-sources: Add is refused with the doc\'s message, nothing is kept; lifted, Try again adds the source', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc({ kill: [blockNew] })), async (server) => {
    const onboarding = await fillXtream(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await configHas(page, 'block-new-sources');
    await remote.press('OK');
    await remote.expectFocus('loading/actions/0');
    const error = page.getByTestId('load-error');
    await expect(error).toHaveAttribute('data-code', 'refused');
    await expect(error).toHaveAttribute('data-rule', 'no-new');
    await expect(error).toHaveText(NO_NEW.en);
    expect(stripIsolates((await page.getByTestId('onboarding-title').textContent()) ?? '')).toBe(`Couldn't add ${host.replace(/:\d+$/, '')}`);
    await expect(page.getByTestId('action-0')).toHaveText('Edit details');
    await expect(page.getByTestId('action-1')).toHaveText('Try again');
    await shoot(page, 'config-refused-add-en');
    // Nothing went into the profile.
    expect(await storedSources(page)).toEqual([]);
    // Still refused on Try again; Edit details keeps the form.
    await remote.go('RIGHT', 'loading/actions/1');
    await remote.press('OK');
    await remote.expectFocus('loading/actions/0');
    await expect(error).toHaveAttribute('data-code', 'refused');
    await remote.press('OK');
    await remote.expectFocus('form/actions/0');
    await expect(onboarding).toHaveAttribute('data-screen', 'form');

    // The operator lifts it: the next refresh brings it, and Add goes through.
    server.serve(devSignedAnswer(doc({}, Date.now() + 1_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: null });
    await startWatching(remote, onboarding, 20_000);
    expect(await storedSources(page)).toEqual(['s1']);
    expect(errors).toEqual([]);
  });
});

test('disable-playback arriving while a channel plays: the stream stops, the card says why, and the next channel is refused', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await configHas(page, null);
    await openChannel(remote, 1);
    const player = page.getByTestId('player');
    await remote.expectFocus('player/actions/0');
    await expect(player).toHaveAttribute('data-plays', '1');
    await expect.poll(() => stageStopped(page)).toBe(false);

    // The operator turns playback off: it arrives with the next refresh, no restart.
    server.serve(devSignedAnswer(doc({ kill: [noPlay] }, Date.now() + 1_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: { id: 'no-play', mode: 'disable-playback' } });
    const card = page.getByTestId('player-refused');
    await expect(card).toHaveAttribute('data-rule', 'no-play');
    await expect(card.locator('.player__card-title')).toHaveText('Playback is turned off');
    await expect(page.getByTestId('player-refused-text')).toHaveText(NO_PLAY.en);
    await expect(page.getByTestId('player-close')).toHaveText('Channels');
    await remote.expectFocus('player/card/0');
    await expect(player).toHaveAttribute('data-refused', 'no-play');
    await expect(player).toHaveAttribute('data-state', 'idle');
    await expect.poll(() => stageStopped(page)).toBe(true);
    // The track menu doesn't open over it; a zap is refused too.
    await remote.press('AUDIO');
    await expect(player).toHaveAttribute('data-menu', 'false');
    await remote.press('CH_UP');
    await expect(player).toHaveAttribute('data-playing', '2');
    await remote.expectFocus('player/card/0');
    await expect(player).toHaveAttribute('data-plays', '1');
    await shoot(page, 'config-refused-play-en');

    // "Channels" goes back to the list on the row asked last; OK on a channel is refused at once (`data-plays` counts the player's plays: still 1).
    await remote.press('OK');
    await expect(player).toHaveCount(0);
    await remote.expectFocus('live/channels/2');
    await remote.go('DOWN', 'live/channels/3');
    await remote.press('OK');
    await expect(page.getByTestId('player-refused')).toBeVisible();
    await expect(page.getByTestId('player')).toHaveAttribute('data-playing', '3');
    await expect(page.getByTestId('player')).toHaveAttribute('data-plays', '1');
    await expect.poll(() => stageStopped(page)).toBe(true);
    await remote.press('BACK');
    await remote.expectFocus('live/channels/3');

    // Lifted: the next channel plays.
    server.serve(devSignedAnswer(doc({}, Date.now() + 2_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: null });
    await remote.press('OK');
    await expect(page.getByTestId('player')).toHaveAttribute('data-plays', '2');
    await expect(page.getByTestId('player')).toHaveAttribute('data-refused', '');
    await remote.expectFocus('player/actions/0');
    expect(errors).toEqual([]);
  });
});

test('in Arabic: the refused add and the refused play, in the doc\'s Arabic text', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc({ kill: [blockNew] })), async (server) => {
    const onboarding = await fillXtream(remote, { host, username: U, password: P }, `locale=ar-SA&api=${encodeURIComponent(server.origin)}`);
    await configHas(page, 'block-new-sources');
    await remote.press('OK');
    await remote.expectFocus('loading/actions/0');
    const error = page.getByTestId('load-error');
    await expect(error).toHaveAttribute('data-code', 'refused');
    await expect(error).toHaveText(NO_NEW.ar);
    await expect(page.getByTestId('action-0')).toHaveText('تعديل البيانات');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await shoot(page, 'config-refused-add-ar');

    // Lifted, "Try again" (to the left in Arabic) adds it.
    server.serve(devSignedAnswer(doc({}, Date.now() + 1_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: null });
    await remote.go('LEFT', 'loading/actions/1');
    await startWatching(remote, onboarding, 20_000);

    // disable-playback, then a channel: the card in Arabic.
    server.serve(devSignedAnswer(doc({ kill: [noPlay] }, Date.now() + 2_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh', kill: { id: 'no-play' } });
    await openChannel(remote, 1);
    const card = page.getByTestId('player-refused');
    await expect(card.locator('.player__card-title')).toHaveText('التشغيل متوقف');
    await expect(page.getByTestId('player-refused-text')).toHaveText(NO_PLAY.ar);
    await expect(page.getByTestId('player-close')).toHaveText('القنوات');
    await remote.expectFocus('player/card/0');
    await expect(page.getByTestId('player')).toHaveAttribute('data-plays', '0');
    // Nothing ever played (no stage yet): the screen paints its own black, not the page's white.
    expect(await page.evaluate(() => getComputedStyle(document.elementFromPoint(960, 600)!).backgroundColor)).toBe('rgb(0, 0, 0)');
    await shoot(page, 'config-refused-play-ar');
    expect(errors).toEqual([]);
  });
});
