import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { parseScenario } from '../apps/mock-provider/src/faults';
import { FileMedia } from '../apps/mock-provider/src/file-media';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { devSignedAnswer } from '../tools/engines/src/config';
import { doc, startConfigServer } from './config-server';
import { addXtreamAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import { openSettings, settingsRow, toSettingsRow } from './settings-rows';

/**
 * The player in the app on the generated media (RELAY step 20a; `pnpm e2e:media`, in
 * `pnpm verify:media`, CI job `media`): OK on a live channel plays it full screen through the
 * browser platform's Html5Engine (desktop Chromium refuses the `.ts` form, the `.m3u8` plays and
 * is remembered), a zap plays the next one, and when the mock breaks the stream's segments the
 * player retries under the "Reconnecting…" badge (no error card) until the stream comes back.
 * The picture goes black meanwhile: Html5Engine closes the connection before each reopen (the
 * last frame kept on screen is later work).
 *
 * The track menu (RELAY step 20b) on the multi-audio MKV: the UI's language chosen as the tracks
 * appear, a pick from the menu, and the channel's choice kept across a zap and, through the
 * profile, across a relaunch that starts on that channel (step 20c1). `audioTracks` is behind a
 * Blink flag on the desktop (webOS ships it), turned on here.
 *
 * The stream info (RELAY step 20c2a) on real live channels: the picture size, the frame rate and
 * the bitrate measured from the `<video>`'s counters, the format and the player.
 *
 * "Test stream" (RELAY step 40b): a dev-signed config names the mock's first channel (SMPTE bars
 * with a tone) as Lablo's test stream; Settings › "Check the connection" › "Test stream" plays it
 * on the app's player under the test screen's bar, and back on the page its line says it played
 * (HLS, the time to the picture) while "Last stream" still says nothing played.
 *
 * The picture's 4:3 mode (RELAY step 20c2b) on a real picture, read from the screen's pixels.
 *
 * Radio (RELAY step 37b): the mock's radio channel (MP3 in HLS segments, no picture) plays through
 * the `<video>` past the 5 s a picture would have had, with the radio card on the dark stage, in
 * English, Arabic and the pseudo-locale.
 *
 * Catch-up from the guide (RELAY step 25a): "From the start" in a programme's details plays it
 * from the archive (the desktop refuses the `.ts` timeshift; its `.m3u8` form plays), and the
 * mock served the programme's own start.
 *
 * A movie (RELAY step 26c): "Play" in Big Buck Bunny's details plays its MP4; three RIGHTs seek
 * 30 s on inside the file (no new play) and the frames move on from there; FF stops 10 s before
 * the end, and the end shows "The movie has ended", whose "Back" returns to the details.
 *
 * Resume (RELAY step 26d): Big Buck Bunny left five minutes in keeps that place (to the second);
 * "Resume from 5:0x" plays its file from within 5 s of it, the frames moving on.
 *
 * An episode (RELAY step 27c1): "Lablo Test Series" S1 E1 (an MKV) left a minute in keeps that
 * place in its row ("Resume from 1:0x"); OK there plays its file from within 5 s of it. Played to
 * its end, "The episode has ended" offers the next one (step 27c2: "Next: S1 E2 · Tone and
 * Clock", "Starts in 10 s"), which plays after the countdown, its frames moving; Back lands on it.
 */
const MEDIA_DIR = path.resolve(import.meta.dirname, '../.cache/media');
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

test.use({ launchOptions: { args: ['--enable-blink-features=AudioVideoTracks'] } });

let app: MockServer;
let host: string;
/** The archive windows the mock served (`X-Mock-Archive-Start`, epoch seconds), in order. */
const archiveStarts: number[] = [];

test.beforeAll(async () => {
  expect(existsSync(path.join(MEDIA_DIR, 'manifest.json')), `no generated media in ${MEDIA_DIR}: run pnpm mock:media first`).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  // The real clock: live streams sit on the epoch timeline.
  app = await mock({ now: Date.now, media: new FileMedia({ dir: MEDIA_DIR }) });
  app.addHook('onResponse', async (_request, reply) => {
    const start = reply.getHeader('x-mock-archive-start');
    if (start !== undefined) archiveStarts.push(Number(start));
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

/** The stage's `<video>`: its clock and picture. */
function video(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector('#stage video') as HTMLVideoElement | null;
    return v === null ? null : { time: v.currentTime, width: v.videoWidth, height: v.videoHeight, paused: v.paused };
  });
}

async function expectMoving(page: Page): Promise<void> {
  const before = await video(page);
  await page.waitForTimeout(1500);
  const after = await video(page);
  expect(before?.width ?? 0).toBeGreaterThan(0);
  expect((after?.time ?? 0) - (before?.time ?? 0), 'the picture moves').toBeGreaterThan(0.5);
}

test('plays a live channel in the app, zaps to the next, and shows "Reconnecting…" through a broken stream until it comes back', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'hls');
  await expectMoving(page);
  // The bar goes 5 s after the last key once the picture shows.
  await expect(player).toHaveAttribute('data-info', 'false', { timeout: 10_000 });
  await remote.press('INFO');
  await expect(page.getByTestId('player-bar')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'player-live-en.png'), animations: 'disabled' });

  // CH+: the next channel, straight to HLS (remembered for the source).
  await remote.press('CH_UP');
  await expect(player).toHaveAttribute('data-playing', '1');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'hls');
  await expectMoving(page);

  // The panel stops serving the stream's segments: the player retries with the badge up.
  app.mockState.scenario = parseScenario({ description: 'Segments fail', rules: [{ match: { path: '/hls/**' }, faults: [{ type: 'status', status: 503 }] }] }, 'broken-segments');
  await expect(player).toHaveAttribute('data-state', 'reconnecting', { timeout: 60_000 });
  await expect(page.getByTestId('player-reconnecting')).toBeVisible();
  await expect(page.getByTestId('player-card')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'player-reconnecting-en.png'), animations: 'disabled' });
  // It comes back before the player gives up.
  app.mockState.scenario = null;
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 40_000 });
  await expect(page.getByTestId('player-reconnecting')).toHaveCount(0);
  await expectMoving(page);

  await remote.press('BACK');
  await remote.expectFocus('live/channels/1');
  // Stopped: the stage's element holds no source.
  expect(await page.evaluate(() => (document.querySelector('#stage video') as HTMLVideoElement).getAttribute('src'))).toBeNull();
  // The failed segments are logged by the browser.
  expect(errors.filter((e) => e.indexOf('status of 503') === -1)).toEqual([]);
});

/** The stage's `<video>`: which of its audio tracks plays (the Blink flag lists them). */
function enabledAudio(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector('#stage video') as (HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean; language: string } } }) | null;
    const list = v?.audioTracks;
    if (list === undefined) return null;
    const out: string[] = [];
    for (let i = 0; i < list.length; i += 1) if (list[i]!.enabled) out.push(list[i]!.language);
    return out;
  });
}

test("the audio menu on a stream with three languages: the UI's language first, a pick from the menu, remembered for the channel across a relaunch", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  // Channel 104 (row 5) answers with the multi-audio MKV (AAC ara, eng, spa; ara is its default):
  // desktop Chromium lists no languages for HLS audio, but it does for Matroska.
  const mkv = `http://${host}/movie/${U}/${P}/206.mkv`;
  await page.route(`**/live/${U}/${P}/104.*`, (route) => route.fulfill({ status: 302, headers: { location: mkv } }));
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  for (let i = 0; i < 5; i += 1) await remote.press('DOWN');
  await remote.expectFocus('live/channels/5');
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  // English, the UI's language, took over from the file's Arabic as the tracks appeared.
  await expect.poll(() => enabledAudio(page)).toEqual(['eng']);
  await expectMoving(page);

  await remote.press('AUDIO');
  await remote.expectFocus('tracks/audio/1');
  const menu = page.getByTestId('tracks');
  await expect(menu).toHaveAttribute('data-switching', 'reliable');
  expect(await page.getByTestId('tracks-audio-list').locator('[role=menuitemradio]').allTextContents()).toEqual(['Arabic', 'English', 'Spanish']);
  await expect(page.getByTestId('tracks-audio-1')).toHaveAttribute('data-selected', 'true');
  // No in-band subtitles on the desktop.
  await expect(page.getByTestId('tracks-text-note')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'player-tracks-media-en.png'), animations: 'disabled' });

  // Arabic from the menu: it plays at once, without a restart, and the menu stays.
  await remote.press('UP', 'OK');
  await expect(page.getByTestId('tracks-audio-0')).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => enabledAudio(page)).toEqual(['ara']);
  await expect(menu).toHaveAttribute('data-refused', '');
  await expect(player).toHaveAttribute('data-state', 'playing');
  await expect(player).toHaveAttribute('data-session', '1');
  await remote.press('BACK');
  await expect(player).toHaveAttribute('data-menu', 'false');

  // Away to the next channel and back: the channel's own choice wins over the UI's language.
  await remote.press('CH_UP');
  await expect(player).toHaveAttribute('data-playing', '6');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await remote.press('CH_DOWN');
  await expect(player).toHaveAttribute('data-playing', '5');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect.poll(() => enabledAudio(page)).toEqual(['ara']);
  await remote.press('AUDIO');
  await remote.expectFocus('tracks/audio/0');
  await remote.press('BACK', 'BACK');
  await remote.expectFocus('live/channels/5');

  // A relaunch (step 20c1): the last channel plays at once, in the Arabic the profile kept for it.
  await page.reload();
  await remote.expectFocus('player/actions/0');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-playing', '5');
  await expect.poll(() => enabledAudio(page)).toEqual(['ara']);
  await remote.press('BACK');
  await remote.expectFocus('live/channels/5');
  expect(errors).toEqual([]);
});

/** The stage's `<video>`: the languages of its text tracks that show. */
function showingText(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector('#stage video') as HTMLVideoElement | null;
    if (v === null) return null;
    const out: string[] = [];
    for (let i = 0; i < v.textTracks.length; i += 1) if (v.textTracks[i]!.mode === 'showing') out.push(v.textTracks[i]!.language);
    return out;
  });
}

for (const { locale, audio, subtitles } of [
  { locale: 'en-US', audio: 'ara', subtitles: 'en' },
  { locale: 'ar-SA', audio: 'eng', subtitles: 'ar' },
] as const) {
  test(`Settings › "Player"'s languages on real tracks (step 38d3): the sound and the subtitles chosen there, not the app's language (${locale})`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackErrors(page);
    const next = locale === 'ar-SA' ? 'LEFT' : 'RIGHT';
    // Desktop Chromium lists no in-band subtitles: the stage's <video> gets two text tracks, Arabic
    // and English (as webOS's <video> lists a stream's), before the stream's tracks are read.
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const v = document.querySelector('#stage video') as (HTMLVideoElement & { labloTracks?: boolean }) | null;
        if (v === null || v.labloTracks === true) return;
        v.labloTracks = true;
        v.addTextTrack('subtitles', 'Arabic', 'ar');
        v.addTextTrack('subtitles', 'English', 'en');
      }).observe(document, { childList: true, subtree: true });
    });
    // Channel 104 (row 5) answers with the multi-audio MKV (AAC ara, eng, spa; ara is its default).
    const mkv = `http://${host}/movie/${U}/${P}/206.mkv`;
    await page.route(`**/live/${U}/${P}/104.*`, (route) => route.fulfill({ status: 302, headers: { location: mkv } }));
    const remote = new RemoteDriver(page);
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    // Settings › "Player": the audio language the app's language isn't (OK: Arabic, OK again: English).
    await openSettings(remote, next);
    await toSettingsRow(remote, 'player');
    await remote.go('OK', 'player-settings/rows/0');
    await remote.press('OK');
    if (audio === 'eng') await remote.press('OK');
    await expect(page.getByTestId('player-settings-audio')).toHaveAttribute('data-value', audio === 'ara' ? 'ar' : 'en');
    // The subtitles: OK round to Arabic, then English.
    await remote.go('DOWN', 'player-settings/rows/1');
    await remote.press('OK');
    if (subtitles === 'en') await remote.press('OK');
    await expect(page.getByTestId('player-settings-subtitles')).toHaveAttribute('data-value', subtitles);
    await remote.go('BACK', settingsRow('player'));
    await remote.go('BACK', 'live/header/5');
    await remote.go('DOWN', 'live/channels/0');
    for (let i = 1; i <= 5; i += 1) await remote.go('DOWN', `live/channels/${i}`);
    await remote.press('OK');
    const player = page.getByTestId('player');
    await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
    // Both chosen as the tracks appeared (the subtitles after the sound, in the same pass).
    await expect.poll(() => showingText(page)).toEqual([subtitles]);
    await expect.poll(() => enabledAudio(page)).toEqual([audio]);
    await expectMoving(page);
    // And it stays: the app's language would have switched the sound.
    expect(await enabledAudio(page)).toEqual([audio]);
    await remote.press('SUBTITLES');
    // (Each row by its track's id: the <video>'s index.)
    await expect(page.getByTestId(`tracks-text-${subtitles === 'ar' ? 0 : 1}`)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('tracks-text-off')).toHaveAttribute('data-selected', 'false');
    await remote.press('BACK');
    await expect(player).toHaveAttribute('data-menu', 'false');
    expect(errors).toEqual([]);
  });
}

/** A figure of the stream info panel. */
function figure(page: Page, id: string) {
  return page.getByTestId(`stream-info-${id}`).locator('.stream-info__value');
}

/** The panel's bitrate in kb/s. */
async function kbps(page: Page): Promise<number> {
  const shown = (await figure(page, 'bitrate').textContent()) ?? '';
  const m = /^([\d.]+) (kb|Mb)\/s$/.exec(shown.replace(/[\u2066-\u2069]/g, ''));
  if (m === null) return NaN;
  return Number(m[1]) * (m[2] === 'Mb' ? 1000 : 1);
}

test('the stream info on real live channels: the size, a measured frame rate and bitrate, the format and the player, following a channel change', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  // Lablo Test 1 SMPTE: 960x540 at 25 fps, about 0.5 Mb/s of video.
  await remote.press('OK');
  const player = page.getByTestId('player');
  await remote.expectFocus('player/actions/0');
  await remote.go('RIGHT', 'player/actions/1');
  await remote.go('RIGHT', 'player/actions/2');
  await remote.press('OK');
  await expect(player).toHaveAttribute('data-stats', 'true');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  const info = page.getByTestId('player-stream-info');
  await expect(info).toHaveAttribute('data-picture', 'true');
  await expect(figure(page, 'resolution')).toHaveText('960×540');
  await expect(figure(page, 'format')).toHaveText('HLS');
  await expect(figure(page, 'engine')).toHaveText('HTML5');
  // Measured over a few seconds of playback.
  await expect(figure(page, 'fps')).toHaveText(/^(2[2-8]) fps$/, { timeout: 10_000 });
  await expect.poll(() => kbps(page), { timeout: 10_000 }).toBeGreaterThan(200);
  expect(await kbps(page)).toBeLessThan(2000);
  // The <video> names no codec.
  await expect(page.getByTestId('stream-info-video')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'player-stream-info-live-en.png'), animations: 'disabled' });

  // The number 6: Lablo Sports Test HD, 1280x720 at 50 fps, about 1.8 Mb/s of video.
  await remote.press('DIGIT_6');
  await expect(player).toHaveAttribute('data-playing', '8', { timeout: 5_000 });
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-stats', 'true');
  await expect(figure(page, 'resolution')).toHaveText('1280×720', { timeout: 10_000 });
  await expect(figure(page, 'fps')).toHaveText(/^(4[5-9]|5[0-5]) fps$/, { timeout: 10_000 });
  await expect.poll(() => kbps(page), { timeout: 10_000 }).toBeGreaterThan(1000);

  await remote.press('BACK');
  await remote.expectFocus('live/channels/8');

  // Settings › "Check the connection" (step 40a): the last stream played over HLS, and when its picture came.
  for (let i = 7; i >= 0; i -= 1) await remote.go('UP', `live/channels/${i}`);
  await openSettings(remote, 'RIGHT');
  await toSettingsRow(remote, 'connection');
  await remote.go('OK', 'connection-check/actions/0');
  await expect(page.getByTestId('connection')).toHaveAttribute('data-verdict', 'ok');
  const last = stripIsolates((await page.getByTestId('connection-last-value').textContent()) ?? '');
  expect(last).toMatch(/^Played \(HLS\): the picture after \d+(\.\d)? s$/);
  await expect(page.getByTestId('connection-last')).toHaveAttribute('data-tone', 'ok');
  expect(errors).toEqual([]);
});

test('"Test stream" plays the config\'s link on the app\'s player under its bar; the page says it played, the last stream untouched (step 40b)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const server = await startConfigServer('');
  try {
    // The mock's first channel (Lablo Test 1 SMPTE: bars and a tone) stands in for Lablo's test pattern.
    server.serve(devSignedAnswer(doc({ kill: [], testStream: { url: `http://${host}/live/${U}/${P}/101.m3u8` } })));
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe('fresh');
    await openSettings(remote, 'RIGHT');
    await toSettingsRow(remote, 'connection');
    await remote.go('OK', 'connection-check/actions/0');
    await expect(page.getByTestId('connection')).toHaveAttribute('data-verdict', 'ok');
    await expect(page.getByTestId('connection-test-value')).toHaveText('Not played yet');
    await remote.go('RIGHT', 'connection-check/actions/1');
    await remote.go('OK', 'test-stream/test/0');
    const screen = page.getByTestId('test-stream');
    await expect(screen).toHaveAttribute('data-phase', 'playing', { timeout: 30_000 });
    await expect(page.getByTestId('test-stream-state')).toHaveText('If you see the picture and hear the sound, this TV and Lablo play video.');
    // The bars move on the stage, under the transparent page.
    await expectMoving(page);
    expect(await video(page)).toMatchObject({ width: 960, height: 540 });
    await page.screenshot({ path: path.join(SHOTS, 'test-stream-playing-en.png'), animations: 'disabled' });

    await remote.go('BACK', 'connection-check/actions/1');
    await expect(page.locator('html')).toHaveAttribute('data-player', 'off');
    // The player let the stream go.
    await expect.poll(() => page.evaluate(() => document.querySelector('#stage video')?.getAttribute('src') ?? null)).toBeNull();
    await expect(page.getByTestId('connection')).toHaveAttribute('data-verdict', 'ok');
    expect(stripIsolates((await page.getByTestId('connection-test-value').textContent()) ?? '')).toMatch(/^Played \(HLS\): the picture after \d+(\.\d)? s$/);
    await expect(page.getByTestId('connection-test')).toHaveAttribute('data-tone', 'ok');
    // The test isn't a provider's stream: "Last stream" (and telemetry) never hear of it. Opened
    // again (a fresh check, its result cleared), the page reads the last stream again.
    await remote.go('BACK', settingsRow('connection'));
    await remote.go('OK', 'connection-check/actions/0');
    await expect(page.getByTestId('connection-test-value')).toHaveText('Not played yet');
    await expect(page.getByTestId('connection-last-value')).toHaveText('Nothing played since Lablo started');
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});

/** The screen's colour (r, g, b) at each point, from a screenshot the page decodes itself. */
async function colours(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> {
  const png = (await page.screenshot({ animations: 'disabled' })).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return [];
      ctx.drawImage(img, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
    },
    { png, points },
  );
}

/** Black: the side bars. The SMPTE HD bars' edges are 40% grey. */
const dark = (rgb: number[]): boolean => rgb.every((v) => v < 24);

test('the picture in 4:3 on a real live channel: the 16:9 bars squeezed into the middle, black at the sides', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  // Lablo Test 1 SMPTE: 960x540 HD colour bars, grey at both edges.
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expectMoving(page);
  // Fit: the 16:9 picture fills the 16:9 screen, edge to edge (above the info bar).
  const edges = [[24, 200], [1896, 200]] as const;
  expect((await colours(page, edges)).map(dark)).toEqual([false, false]);
  await remote.expectFocus('player/actions/0');
  await remote.go('RIGHT', 'player/actions/1');
  await remote.go('RIGHT', 'player/actions/2');
  await remote.go('RIGHT', 'player/actions/3');
  await remote.press('OK');
  await remote.press('OK');
  await remote.press('OK');
  await expect(player).toHaveAttribute('data-picture', '4:3');
  // The picture between x 240 and 1680, black beside it; the stream plays on.
  const shown = await colours(page, [...edges, [216, 200], [264, 200], [1656, 200], [1704, 200]]);
  expect(shown.map(dark)).toEqual([true, true, true, false, false, true]);
  await expectMoving(page);
  await expect(player).toHaveAttribute('data-plays', '1');
  await page.screenshot({ path: path.join(SHOTS, 'player-picture-43-live-en.png'), animations: 'disabled' });
  // Fit again: edge to edge.
  await remote.press('OK');
  await expect(player).toHaveAttribute('data-picture', 'fit');
  expect((await colours(page, edges)).map(dark)).toEqual([false, false]);
  await remote.press('BACK');
  await remote.expectFocus('live/channels/0');
  expect(errors).toEqual([]);
});

/** The `<video>`'s no-picture limit (`NO_PICTURE_MS` in packages/player/src/html5-engine.ts). */
const NO_PICTURE_MS = 5000;

/**
 * Our strings in the radio card, in the pseudo-locale: anything with letters outside the
 * provider's text (`translate="no"`) must be bracketed (en-XA's labels end in `]`).
 */
function radioUntranslated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid=player-radio]');
    if (root === null) return ['no radio card'];
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(text) || node.parentElement?.closest('[translate="no"]') != null) continue;
      if (!(text.startsWith('[') && text.endsWith(']'))) out.push(text);
    }
    return out;
  });
}

/** The radio card's box and its parts' boxes (left, top, width, height), rounded. */
function radioBoxes(page: Page) {
  return page.evaluate(() => {
    const box = (id: string): number[] | null => {
      const el = document.querySelector(`[data-testid=${id}]`);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    };
    const name = document.querySelector('[data-testid=player-radio-name]') as HTMLElement | null;
    const logo = document.querySelector('[data-testid=player-radio-logo]') as HTMLImageElement | null;
    return {
      card: box('player-radio'),
      mark: box('player-radio-mark'),
      logo: box('player-radio-logo'),
      decoded: logo !== null && logo.complete && logo.naturalWidth > 0,
      cut: name === null ? null : name.scrollWidth > name.clientWidth,
    };
  });
}

/** The mock's catalog before a radio run gave the radio channel a logo (put back after the test). */
let plainCatalog: MockServer['mockState']['catalog'] | null = null;
test.afterEach(() => {
  if (plainCatalog === null) return;
  app.mockState.catalog = plainCatalog;
  plainCatalog = null;
});

for (const [locale, lang] of [
  ['en-US', 'en'],
  ['ar-SA', 'ar'],
  ['en-XA', 'xa'],
] as const) {
  test(`plays a radio channel with no picture: the radio card on the dark stage, its clock moving past the no-picture limit, no failure (step 37b, ${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    // In Arabic the radio channel has a logo (the mock's 1x1 PNG): the card shows it in place of the
    // mark. In the pseudo-locale it has one that fails to load: the card falls back to the mark.
    const logo = locale === 'ar-SA';
    if (locale !== 'en-US') {
      const plain = app.mockState.catalog;
      plainCatalog = plain;
      app.mockState.catalog = { ...plain, live: plain.live.map((c) => (c.id === 108 ? { ...c, logo: true } : c)) };
    }
    let failedLogos = 0;
    if (locale === 'en-XA') {
      await page.route('**/images/channel-108.png', (route) => {
        failedLogos += 1;
        return route.fulfill({ status: 404, body: '' });
      });
    }
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await remote.press('OK');
    const player = page.getByTestId('player');
    await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
    // A channel with a picture: no card.
    await expect(player).toHaveAttribute('data-radio', 'false');
    await expect(page.getByTestId('player-radio')).toHaveCount(0);

    // The number 8: Lablo Radio Test, MP3 in HLS segments with no picture.
    await remote.press('DIGIT_8');
    await expect(player).toHaveAttribute('data-plays', '2', { timeout: 5_000 });
    await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
    await expect(player).toHaveAttribute('data-container', 'hls');
    await expect(player).toHaveAttribute('data-radio', 'true');
    const card = page.getByTestId('player-radio');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-logo', String(logo));
    await expect(page.getByTestId('player-radio-name')).toHaveText('Lablo Radio Test');
    await expect(page.getByTestId(logo ? 'player-radio-logo' : 'player-radio-mark')).toBeVisible();
    await expect(page.getByTestId(logo ? 'player-radio-mark' : 'player-radio-logo')).toHaveCount(0);
    // The pseudo-locale's logo was asked for, once: it failed, and the mark stays.
    expect(failedLogos).toBe(locale === 'en-XA' ? 1 : 0);
    // Past the 5 s a picture would have had: still playing, with no picture, and no second open.
    const before = await video(page);
    await page.waitForTimeout(NO_PICTURE_MS + 1000);
    const after = await video(page);
    expect(after?.width).toBe(0);
    expect(after?.paused).toBe(false);
    expect((after?.time ?? 0) - (before?.time ?? 0), 'the radio plays on').toBeGreaterThan(NO_PICTURE_MS / 1000);
    await expect(player).toHaveAttribute('data-state', 'playing');
    await expect(player).toHaveAttribute('data-failure', '');
    await expect(player).toHaveAttribute('data-plays', '2');
    await expect(page.getByTestId('player-card')).toHaveCount(0);
    // The card: in the middle, the logo (whole in its 16:9 box) or the mark centred over the name,
    // nothing cut; the stage black around it.
    const boxes = await radioBoxes(page);
    expect(boxes.card).toEqual([360, 300, 1200, expect.any(Number)]);
    if (logo) {
      expect(boxes.logo).toEqual([760, 300, 400, 224]);
      expect(boxes.decoded).toBe(true);
    } else {
      expect(boxes.mark).toEqual([872, 324, 176, 176]);
    }
    expect(boxes.cut).toBe(false);
    expect((await colours(page, [[24, 200], [1896, 200], [960, 1000]])).map(dark)).toEqual([true, true, true]);
    // The bar went 5 s after the last key: the card alone.
    await expect(player).toHaveAttribute('data-info', 'false', { timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOTS, `player-radio-${lang}.png`), animations: 'disabled' });
    if (locale === 'en-XA') {
      expect(await radioUntranslated(page)).toEqual([]);
      await expect(card.locator('.z-badge')).toHaveText(/^\[.+\]$/u);
    } else {
      await expect(card.locator('.z-badge')).toHaveText(locale === 'en-US' ? 'Radio' : 'إذاعة');
    }
    // The bar over it: the card stays under it.
    await remote.press('INFO');
    await expect(page.getByTestId('player-bar')).toBeVisible();
    await expect(card).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `player-radio-bar-${lang}.png`), animations: 'disabled' });
    // The pseudo-locale's logo failed to load: the browser logs its 404.
    expect(errors.filter((e) => locale !== 'en-XA' || e.indexOf('404') === -1)).toEqual([]);
    if (locale !== 'en-US') return;

    // CH-: back to a channel with a picture, and the card goes.
    await remote.press('CH_DOWN');
    await expect(player).toHaveAttribute('data-plays', '3', { timeout: 5_000 });
    await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
    await expect(player).toHaveAttribute('data-radio', 'false');
    await expect(page.getByTestId('player-radio')).toHaveCount(0);
    await expectMoving(page);
    expect(errors).toEqual([]);
  });
}

test('plays a programme gone by from the archive: "From the start" in its details, the picture moving (step 25a)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  // The guide on the first channel (Lablo Test 1 SMPTE: seven days of archive, colour bars), a cell back from now.
  await remote.go('UP', 'live/header/0');
  await remote.go('OK', 'guide/grid/0');
  const screen = page.getByTestId('guide-screen');
  await expect(screen).toHaveAttribute('data-pending', '0', { timeout: 10_000 });
  const focusedStart = (): Promise<number> =>
    page.evaluate(() => Number(document.querySelector('[data-testid=guide-screen] .z-guide__cell[data-state=focused]')?.getAttribute('data-start') ?? NaN));
  const onAir = await focusedStart();
  await remote.press('LEFT');
  await expect.poll(focusedStart).toBeLessThan(onAir);
  const start = await focusedStart();
  await remote.go('OK', 'programme/actions/0');
  await expect(page.getByTestId('programme-archive')).toHaveText('From the start');
  const asked = archiveStarts.length;
  await remote.go('OK', 'player/seek/0');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-archive', String(start));
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'hls');
  await expectMoving(page);
  // Every archive answer was the programme's own start.
  const served = archiveStarts.slice(asked);
  expect(served.length).toBeGreaterThan(0);
  expect(served.every((s) => s === start * 60)).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, 'player-catchup-en.png'), animations: 'disabled' });

  // Step 25d: RIGHT on the seek bar seeks inside the archive's HLS (no new URL): the clock jumps a
  // minute on, the seek bar says so, and the picture moves on from there.
  const seek = page.getByTestId('player-seek');
  const from = (await video(page))!.time;
  const answered = archiveStarts.length;
  await remote.press('RIGHT');
  await expect.poll(async () => (await video(page))!.time, { timeout: 15_000 }).toBeGreaterThan(from + 55);
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expectMoving(page);
  expect(archiveStarts.length).toBe(answered);
  await expect.poll(async () => Number(await seek.getAttribute('data-at')) - start * 60_000, { timeout: 5000 }).toBeGreaterThan(60_000);
  await expect(seek).toHaveAttribute('data-seeking', 'false');
  // PLAY/PAUSE pauses the picture ("Paused" on the bar), and plays it on.
  await remote.press('PLAY_PAUSE');
  await expect(player).toHaveAttribute('data-state', 'paused');
  await expect(seek).toContainText('Paused');
  const still = (await video(page))!;
  await page.waitForTimeout(1000);
  expect((await video(page))!).toMatchObject({ paused: true, time: still.time });
  await page.screenshot({ path: path.join(SHOTS, 'player-catchup-paused-en.png'), animations: 'disabled' });
  await remote.press('PLAY_PAUSE');
  await expect(player).toHaveAttribute('data-state', 'playing');
  await expectMoving(page);
  await remote.go('BACK', 'guide/grid/0');
  expect(errors).toEqual([]);
});

test('plays a movie from its details, seeks inside it with the frames moving on, and ends on "The movie has ended" (step 26c)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await remote.go('UP', 'live/header/0');
  await remote.go('RIGHT', 'live/header/1');
  await remote.go('OK', 'movies/grid/0');
  await expect(page.getByTestId('movies-screen')).toHaveAttribute('data-pending', '0', { timeout: 10_000 });
  await remote.go('OK', 'movie/actions/0');
  await expect(page.getByTestId('movie-details')).toHaveAttribute('data-status', 'read');
  await remote.go('OK', 'player/seek/0');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-movie', /:movie:201$/);
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'mp4');
  await expectMoving(page);
  // The bar's length is the file's, once the engine knows it.
  const duration = await page.evaluate(() => (document.querySelector('#stage video') as HTMLVideoElement).duration * 1000);
  await expect.poll(async () => Number(await player.getAttribute('data-length'))).toBe(duration);

  // Three RIGHTs: 30 s on inside the file (no new play), the frames moving on from there.
  const plays = await player.getAttribute('data-plays');
  const from = (await video(page))!.time;
  await remote.press('RIGHT');
  await remote.press('RIGHT');
  await remote.press('RIGHT');
  await expect.poll(async () => (await video(page))!.time, { timeout: 15_000 }).toBeGreaterThan(from + 28);
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expectMoving(page);
  await expect(player).toHaveAttribute('data-plays', plays!);
  const seek = page.getByTestId('player-seek');
  await expect(seek).toHaveAttribute('data-seeking', 'false');
  await page.screenshot({ path: path.join(SHOTS, 'player-movie-en.png'), animations: 'disabled' });

  // FF until it stops 10 s before the end; the end's card, then its "Back" to the details.
  for (let i = 0; i < 4; i += 1) await remote.press('FF');
  await expect.poll(async () => Number(await seek.getAttribute('data-at'))).toBe(duration - 10_000);
  await expect(page.getByTestId('player-ended')).toContainText('The movie has ended', { timeout: 40_000 });
  await expect(player).toHaveAttribute('data-state', 'ended');
  await expect(player).toHaveAttribute('data-zone', 'card');
  await page.screenshot({ path: path.join(SHOTS, 'player-movie-ended-en.png'), animations: 'disabled' });
  await remote.go('OK', 'movie/actions/0');
  await expect(page.getByTestId('movie-details')).toHaveAttribute('data-status', 'read');
  await remote.go('BACK', 'movies/grid/0');
  expect(errors).toEqual([]);
});

test('resumes a movie within 5 s of where it was left, inside its file (step 26d)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await remote.go('UP', 'live/header/0');
  await remote.go('RIGHT', 'live/header/1');
  await remote.go('OK', 'movies/grid/0');
  await expect(page.getByTestId('movies-screen')).toHaveAttribute('data-pending', '0', { timeout: 10_000 });
  await remote.go('OK', 'movie/actions/0');
  const details = page.getByTestId('movie-details');
  await expect(details).toHaveAttribute('data-status', 'read');
  await remote.go('OK', 'player/seek/0');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });

  // FF: five minutes on inside the file, the frames moving on from there.
  await remote.press('FF');
  await expect.poll(async () => (await video(page))!.time, { timeout: 15_000 }).toBeGreaterThan(300);
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expectMoving(page);

  // Back: the place the picture was at, to the second (it plays on while the key goes in).
  const left = (await video(page))!.time * 1000;
  await remote.go('BACK', 'movie/actions/0');
  await expect(details).not.toHaveAttribute('data-resume', '');
  const kept = Number(await details.getAttribute('data-resume'));
  expect(kept - left).toBeGreaterThanOrEqual(0);
  expect(kept - left).toBeLessThan(3_000);
  await expect(page.getByTestId('movie-resume')).toHaveText(/^Resume from \S*5:\d\d\S*$/);
  await expect(page.getByTestId('movie-resume')).toHaveAttribute('data-state', 'focused');

  // "Resume": the file from within 5 s of that place, the frames moving on.
  await remote.go('OK', 'player/seek/0');
  await expect(player).toHaveAttribute('data-from', String(kept));
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  const at = (await video(page))!.time * 1000;
  expect(Math.abs(at - kept), `resumed at ${Math.round(at)} ms, left at ${kept} ms`).toBeLessThanOrEqual(5_000);
  await expectMoving(page);
  await page.screenshot({ path: path.join(SHOTS, 'player-movie-resumed-en.png'), animations: 'disabled' });
  await remote.go('BACK', 'movie/actions/0');
  expect(errors).toEqual([]);
});

test('resumes an episode within 5 s of where it was left, inside its file, and its end plays the next (steps 27c1, 27c2)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  // "Series", "Recently updated" (302, then 301), OK on "Lablo Test Series": its first episode.
  await remote.go('UP', 'live/header/0');
  await remote.go('RIGHT', 'live/header/1');
  await remote.go('RIGHT', 'live/header/2');
  await remote.go('OK', 'series/grid/0');
  await expect(page.getByTestId('series-screen')).toHaveAttribute('data-pending', '0', { timeout: 10_000 });
  await remote.go('RIGHT', 'series/grid/1');
  await remote.press('OK');
  const details = page.getByTestId('show-details');
  await expect(details).toHaveAttribute('data-status', 'read');
  await remote.expectFocus('show/episodes/0');
  await remote.go('OK', 'player/seek/0');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-movie', /:episode:3001$/);
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'mkv');

  // Six RIGHTs: a minute on, the frames moving on from there.
  for (let i = 0; i < 6; i += 1) await remote.press('RIGHT');
  await expect.poll(async () => (await video(page))!.time, { timeout: 15_000 }).toBeGreaterThan(60);
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expectMoving(page);

  // Back: the details on that episode, its place to the second (it plays on while the key goes in).
  const left = (await video(page))!.time * 1000;
  await remote.go('BACK', 'show/episodes/0');
  const row = page.getByTestId('episode-0');
  await expect(row).not.toHaveAttribute('data-resume', '');
  const kept = Number(await row.getAttribute('data-resume'));
  expect(kept - left).toBeGreaterThanOrEqual(0);
  expect(kept - left).toBeLessThan(3_000);
  await expect(page.getByTestId('episode-resume-0')).toHaveText(/^Resume from \S*1:\d\d\S*$/);

  // OK: the file from within 5 s of that place, the frames moving on.
  await remote.go('OK', 'player/seek/0');
  await expect(player).toHaveAttribute('data-from', String(kept));
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  const at = (await video(page))!.time * 1000;
  expect(Math.abs(at - kept), `resumed at ${Math.round(at)} ms, left at ${kept} ms`).toBeLessThanOrEqual(5_000);
  await expectMoving(page);
  await page.screenshot({ path: path.join(SHOTS, 'player-episode-resumed-en.png'), animations: 'disabled' });

  // FF to 10 s before its end: "The episode has ended", with the show and the episode, and the next
  // one (step 27c2) with its countdown, "Play now" focused.
  await remote.press('FF');
  const ended = page.getByTestId('player-ended');
  await expect(ended).toContainText('The episode has ended', { timeout: 40_000 });
  await expect(ended).toContainText('Lablo Test Series');
  await expect(page.getByTestId('player-ended-episode')).toHaveText(/^S\S*1\S* E\S*1\S* · Pilot - Colour Bars$/);
  await expect(page.getByTestId('player-next-episode')).toHaveText(/^Next: \S*S\S*1\S* E\S*2\S*\S* · Tone and Clock$/);
  await expect(page.getByTestId('player-countdown')).toHaveText(/^Starts in \S*(10|9)\S* s$/);
  await remote.expectFocus('player/card/0');
  await page.screenshot({ path: path.join(SHOTS, 'player-episode-ended-en.png'), animations: 'disabled' });
  // The countdown's end: S1 E2 plays in the same player, its frames moving.
  await expect(player).toHaveAttribute('data-movie', /:episode:3002$/, { timeout: 15_000 });
  await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 30_000 });
  await expect(player).toHaveAttribute('data-container', 'mkv');
  await expect(page.getByTestId('player-ended')).toHaveCount(0);
  await expectMoving(page);
  await page.screenshot({ path: path.join(SHOTS, 'player-episode-next-en.png'), animations: 'disabled' });
  // Back: the details on S1 E2; S1 E1 is watched (no place kept).
  await remote.go('BACK', 'show/episodes/1');
  await expect(row).toHaveAttribute('data-resume', '');
  expect(errors).toEqual([]);
});
