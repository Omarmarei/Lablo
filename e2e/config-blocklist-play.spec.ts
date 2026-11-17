import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { blocklistHash } from '../packages/crypto/src/blocklist';
import { HARNESS_SALT, devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addM3uAndWatch, addXtreamAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The signed config's blocklist before playing (RELAY step 30c3b), with a dev-signed config
 * served by the test (config-server.ts) and `?api=` pointing the app at it. The mock provider
 * runs on 127.0.0.1, and the served doc blocks that host:
 * - at play, the stream's own host: an M3U link on `localhost` (the config server serving a
 *   playlist read from the mock on 127.0.0.1, so its streams are on 127.0.0.1) adds, since its
 *   link's host isn't blocked; OK on a channel shows the refusal card; lifted, it plays;
 * - while a channel plays: a refresh that blocks its host stops it, and a zap is refused too;
 * - the card in Arabic.
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

/** The mock's host (127.0.0.1) on the doc's blocklist. */
const BLOCKS_MOCK = { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] };

const SAYS = {
  en: { title: "Can't play this", text: "Its server can't be used with Lablo.", channels: 'Channels' },
  ar: { title: 'تعذّر تشغيل هذا المحتوى', text: 'لا يمكن استخدام خادمه مع لابلو.', channels: 'القنوات' },
} as const;

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

/** The config's answer is in, fresh, and no run goes on (the query worker has read its blocklist). */
async function configFresh(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe('fresh');
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.configIdle() ?? false)).toBe(true);
}

/** Serves `blocklist` from now on (`null`: the harness doc's own), and brings it in with a refresh (no restart). */
async function serveBlocklist(page: Page, server: ConfigServer, blocklist: unknown, later: number): Promise<void> {
  server.serve(devSignedAnswer(doc(blocklist === null ? {} : { blocklist }, Date.now() + later)));
  expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh' });
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

/** The blocklist's card, in `language`, over a stopped stream and the screen's own black. */
async function blockedCard(remote: RemoteDriver, language: 'en' | 'ar', plays: number): Promise<void> {
  const { page } = remote;
  const card = page.getByTestId('player-refused');
  await expect(card).toHaveAttribute('data-rule', 'BLOCKLIST');
  await expect(card.locator('.player__card-title')).toHaveText(SAYS[language].title);
  await expect(page.getByTestId('player-refused-text')).toHaveText(SAYS[language].text);
  await expect(page.getByTestId('player-close')).toHaveText(SAYS[language].channels);
  await remote.expectFocus('player/card/0');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-refused', 'BLOCKLIST');
  await expect(player).toHaveAttribute('data-state', 'idle');
  // The play was asked (the check runs in the controller): it counts.
  await expect(player).toHaveAttribute('data-plays', String(plays));
  await expect.poll(() => stageStopped(page)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.elementFromPoint(960, 600)!).backgroundColor)).toBe('rgb(0, 0, 0)');
}

test("at play: an M3U link on an allowed host adds, its streams' blocked host is refused; lifted, the channel plays", async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  // The mock's playlist, read on 127.0.0.1: its streams (HLS, which Chromium plays) are there.
  const playlist = await (await fetch(`http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus&output=m3u8`)).text();
  expect(playlist).toContain(`http://${host}/live/`);
  await withServer(devSignedAnswer(doc({ blocklist: BLOCKS_MOCK })), async (server) => {
    server.file('/list.m3u', playlist, 'audio/x-mpegurl');
    const link = `${server.origin.replace('127.0.0.1', 'localhost')}/list.m3u`.replace(/^http:\/\//, '');
    await addM3uAndWatch(remote, link, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await configFresh(page);

    // OK on the first channel: its stream's host is blocked.
    await remote.press('OK');
    await blockedCard(remote, 'en', 1);
    await shoot(page, 'config-blocked-play-en');
    // The track menu doesn't open over it.
    await remote.press('AUDIO');
    await expect(page.getByTestId('player')).toHaveAttribute('data-menu', 'false');
    // "Channels" goes back to the row.
    await remote.press('OK');
    await expect(page.getByTestId('player')).toHaveCount(0);
    await remote.expectFocus('live/channels/0');

    // Lifted by the next refresh: the channel plays.
    await serveBlocklist(page, server, null, 1_000);
    await remote.press('OK');
    const player = page.getByTestId('player');
    await expect(player).toHaveAttribute('data-plays', '2');
    await expect(player).toHaveAttribute('data-refused', '');
    await remote.expectFocus('player/actions/0');
    // The stage holds its stream (the mock's synthetic streams don't decode outside the media run).
    await expect.poll(() => stageStopped(page)).toBe(false);
    expect(errors).toEqual([]);
  });
});

test('while a channel plays: a refresh that blocks its host stops it, and a zap is refused too', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await configFresh(page);
    await remote.press('OK');
    const player = page.getByTestId('player');
    await remote.expectFocus('player/actions/0');
    await expect.poll(() => stageStopped(page)).toBe(false);

    // The operator blocks the host: the refresh brings it, and the stream on show stops.
    await serveBlocklist(page, server, BLOCKS_MOCK, 1_000);
    await blockedCard(remote, 'en', 1);
    // A zap goes ahead (the card goes) and is refused for its server too.
    await remote.press('CH_UP');
    await expect(player).toHaveAttribute('data-playing', '1');
    await expect(player).toHaveAttribute('data-plays', '2');
    await blockedCard(remote, 'en', 2);
    await remote.press('BACK');
    await remote.expectFocus('live/channels/1');
    expect(errors).toEqual([]);
  });
});

test('in Arabic: the card for a blocked server', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=ar-SA&api=${encodeURIComponent(server.origin)}`);
    await configFresh(page);
    await serveBlocklist(page, server, BLOCKS_MOCK, 1_000);
    await remote.press('OK');
    await blockedCard(remote, 'ar', 1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await shoot(page, 'config-blocked-play-ar');
    expect(errors).toEqual([]);
  });
});
