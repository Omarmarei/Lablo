import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { decodeLogin, panelZone, xtreamCatchupUrl } from '@lablo/core';
import { FileMedia } from '../apps/mock-provider/src/file-media';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { PlaybackInput, PlaybackSnapshot, PlaybackTarget } from '../apps/tv/src/playback/harness';

/**
 * The desktop playback e2e (RELAY step 18, "done when: e2e plays live, VOD and catch-up on
 * desktop"): the playback harness (apps/tv/playback.html) hands the browser platform's
 * Html5Engine to a PlayerController, against the mock's generated media (`pnpm mock:media`).
 * Only in `pnpm e2e:media` (part of `pnpm verify:media`, CI job `media`), since `pnpm verify` has
 * no ffmpeg. Desktop Chromium plays HLS, MP4 and MKV but no MPEG-TS, and no HEVC picture
 * headless; `audioTracks` is behind a Blink flag (webOS ships it), turned on here.
 */
const MEDIA_DIR = path.resolve(import.meta.dirname, '../.cache/media');
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const HEVC_MIME = 'video/mp4; codecs="hvc1.1.6.L150.B0"';

test.use({ launchOptions: { args: ['--enable-blink-features=AudioVideoTracks'] } });

let app: MockServer;
let base: string;

test.beforeAll(async () => {
  expect(existsSync(path.join(MEDIA_DIR, 'manifest.json')), `no generated media in ${MEDIA_DIR}: run pnpm mock:media first`).toBe(true);
  // The real clock: live streams and catch-up sit on the epoch timeline.
  app = await mock({ now: Date.now, media: new FileMedia({ dir: MEDIA_DIR }) });
  base = await listen(app);
});
test.afterAll(async () => {
  await app.close();
});

async function open(page: Page): Promise<void> {
  await page.goto('/playback.html');
  await expect(page.getByTestId('playback')).toHaveAttribute('data-ready', 'true');
}

function play(page: Page, input: PlaybackInput): Promise<void> {
  return page.evaluate((i) => (window as PlaybackTarget).__LABLO_PLAYBACK__?.play(i), input);
}

function stop(page: Page): Promise<void> {
  return page.evaluate(() => (window as PlaybackTarget).__LABLO_PLAYBACK__?.stop());
}

async function snapshot(page: Page): Promise<PlaybackSnapshot> {
  const s = await page.evaluate(() => (window as PlaybackTarget).__LABLO_PLAYBACK__?.snapshot());
  if (s === undefined) throw new Error('no playback harness on the page');
  return s;
}

async function state(page: Page, want: string, timeout = 20_000): Promise<PlaybackSnapshot> {
  await expect(page.getByTestId('playback')).toHaveAttribute('data-state', want, { timeout });
  return snapshot(page);
}

/** The position moves on: two readings `ms` apart. */
async function moving(page: Page, ms = 1500): Promise<[number, number]> {
  const before = (await snapshot(page)).positionMs;
  await page.waitForTimeout(ms);
  const after = (await snapshot(page)).positionMs;
  expect(after - before, `the position moved from ${before} to ${after} in ${ms} ms`).toBeGreaterThan(ms / 2);
  return [before, after];
}

/** The cue on the overlay now, the start (in s) its text names, and the media clock, read together. */
async function subtitleNow(page: Page): Promise<{ text: string | null; named: number | null; positionMs: number }> {
  return page.evaluate(() => {
    const cue = document.querySelector('[data-testid="subtitle-cue"]');
    const text = cue === null ? null : cue.textContent;
    const m = text === null ? null : /(\d\d):(\d\d)$/.exec(text);
    const positionMs = (window as PlaybackTarget).__LABLO_PLAYBACK__?.snapshot().positionMs ?? -1;
    return { text, named: m === null ? null : Number(m[1]) * 60 + Number(m[2]), positionMs };
  });
}

/**
 * Waits for a cue starting with `prefix` and checks it is the file's cue for the media clock
 * moved by `delayMs`: the mock's cues start every 5 s and last 4 s, and the overlay looks them up
 * every 250 ms, so the one showing may be up to a lookup (and the round trip) behind.
 */
async function expectCueInTime(page: Page, prefix: string, delayMs = 0): Promise<string> {
  await expect.poll(async () => (await subtitleNow(page)).text?.indexOf(prefix) === 0, { timeout: 10_000 }).toBe(true);
  const now = await subtitleNow(page);
  const t = now.positionMs - delayMs;
  expect(now.named, `${String(now.text)} at ${now.positionMs} ms`).not.toBeNull();
  expect(now.named! * 1000, `${String(now.text)} at ${now.positionMs} ms`).toBeLessThanOrEqual(t);
  expect(t, `${String(now.text)} at ${now.positionMs} ms`).toBeLessThan(now.named! * 1000 + 4400);
  return now.text!;
}

/** The mock's open streams per account (`GET /__mock/connections`). */
async function connections(): Promise<Record<string, number>> {
  return (await (await fetch(`${base}/__mock/connections`)).json()) as Record<string, number>;
}

test.describe('Playback on the desktop: Html5Engine and the PlayerController on the generated media', () => {
  test('live: MPEG-TS is refused as unsupported, HLS plays at once and is remembered for the source', async ({ page }) => {
    await open(page);
    const live = { url: `${base}/live/${U}/${P}/104.ts`, mode: 'live' as const };
    await play(page, live);
    const s = await state(page, 'playing');
    expect(s.engines).toEqual(['html5']);
    expect(s.history).toEqual(['opening ts', 'opening hls', 'playing hls']);
    expect(s.trace.slice(0, 3)).toEqual(['load 1 ts', 'rejected 1 unsupported/MEDIA_ERR_SRC_NOT_SUPPORTED', 'load 2 hls']);
    expect(s.trace).toContain('firstFrame 2');
    expect(s.attempt).toBe(0);
    // Channel 104's picture.
    expect([s.stats.width, s.stats.height]).toEqual([960, 540]);
    await moving(page);

    await stop(page);
    await state(page, 'idle');
    // The source's next play starts with HLS: no TS attempt.
    await play(page, live);
    const again = await state(page, 'playing');
    expect(again.history.slice(4)).toEqual(['opening hls', 'playing hls']);
    expect(again.trace.filter((t) => t.indexOf('load ') === 0)).toEqual(['load 1 ts', 'load 2 hls', 'load 3 hls']);
  });

  test('VOD: an episode from 20 s in, and stop closes its connection', async ({ page }) => {
    await open(page);
    // The mock holds each response open after 4 MB (about 80 s of this file): without that, a
    // fast runner downloads all 12 MB at once, the browser closes the connection itself, and the
    // check below would see none while it plays (main's CI on 1d4fea2).
    await play(page, { url: `${base}/series/${U}/${P}/3011.mp4?mock_fault=stall:after_bytes=4000000`, mode: 'vod', startMs: 20_000 });
    const s = await state(page, 'playing');
    expect(s.history).toEqual(['opening mp4', 'playing mp4']);
    expect(s.positionMs).toBeGreaterThanOrEqual(20_000);
    expect(s.positionMs).toBeLessThan(25_000);
    await moving(page);
    // One stream open on the test account while it plays…
    expect(await connections()).toEqual({ [U]: 1 });
    await stop(page);
    await state(page, 'idle');
    // …and the provider sees it close on stop (an account may allow only one).
    await expect.poll(connections, { timeout: 5000 }).toEqual({});
  });

  test('catch-up: an Xtream timeshift recording from two hours ago, as HLS', async ({ page }) => {
    await open(page);
    const login = decodeLogin(await (await fetch(`${base}/player_api.php?username=${U}&password=${P}`)).json());
    const zone = panelZone(login?.server ?? null).offset;
    const start = Math.floor((Date.now() - 2 * 3600_000) / 60_000) * 60_000;
    // Built as the app will (core's xtreamCatchupUrl); the desktop needs the .m3u8 form.
    const url = xtreamCatchupUrl({ base, username: U, password: P }, 101, { startMs: start, endMs: start + 30 * 60_000, nowMs: Date.now() }, zone, 'm3u8');
    expect(url).toMatch(/\/timeshift\/lablo\/lablo-test\/30\/\d{4}-\d{2}-\d{2}:\d{2}-\d{2}\/101\.m3u8$/);
    await play(page, { candidates: [{ url, container: 'hls' }], mode: 'catchup' });
    const s = await state(page, 'playing');
    expect(s.history).toEqual(['opening hls', 'playing hls']);
    expect(s.stats.width).toBeGreaterThan(0);
    await moving(page);
  });

  test("audio tracks: the MKV's AAC tracks listed and switched without a restart", async ({ page }) => {
    await open(page);
    await play(page, { url: `${base}/movie/${U}/${P}/206.mkv`, mode: 'vod' });
    const s = await state(page, 'playing');
    expect(s.trackSwitch).toBe('reliable');
    // AC3 and E-AC3 aren't listed: desktop Chromium can't decode them.
    expect(s.tracks.audio.map((t) => `${t.id} ${t.lang} ${String(t.selected)}`)).toEqual(['0 ara true', '1 eng false', '2 spa false']);
    const switched = await page.evaluate(() => (window as PlaybackTarget).__LABLO_PLAYBACK__?.selectAudio('1'));
    expect(switched).toBe(true);
    const after = await snapshot(page);
    expect(after.tracks.audio.map((t) => t.selected)).toEqual([false, true, false]);
    await moving(page);
    // Still the one load, with its one first frame: no restart.
    const end = await snapshot(page);
    expect(end.trace.filter((t) => t.indexOf('firstFrame') === 0)).toEqual(['firstFrame 1']);
    expect(end.state).toBe('playing');
  });

  test("4K HEVC with no picture (headless desktop) is this TV's limit, not the provider's", async ({ page }) => {
    await open(page);
    const canHevc = await page.evaluate((mime) => (window as PlaybackTarget).__LABLO_PLAYBACK__?.canPlayType(mime), HEVC_MIME);
    test.skip(canHevc !== '', 'this Chromium decodes HEVC (a headed run)');
    await play(page, { url: `${base}/movie/${U}/${P}/205.mp4`, mode: 'vod' });
    const s = await state(page, 'failed');
    expect(s.failure).toEqual({ category: 'device', code: 'TV-UNSUPPORTED', detail: 'NO_PICTURE', account: null });
    // Sound played with no picture: unsupported, so the URL wasn't retried.
    expect(s.trace.filter((t) => t.indexOf('load ') === 0)).toEqual(['load 1 mp4']);
    expect(s.trace).toContain('error 1 unsupported/NO_PICTURE');
  });

  test("subtitle files (RELAY step 20b2b): listed after the stream's own, drawn by the media clock, an old Arabic file right to left, the timing and the size", async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(SHOTS, { recursive: true });
    const fetched: string[] = [];
    page.on('request', (request) => {
      const m = /\/subtitles\/[^/]+\/[^/]+\/([^?]+)/.exec(request.url());
      if (m !== null) fetched.push(m[1]!);
    });
    await open(page);
    const file = (name: string): string => `${base}/subtitles/${U}/${P}/${name}`;
    await play(page, {
      url: `${base}/movie/${U}/${P}/206.mkv`,
      mode: 'vod',
      externalSubs: [
        { lang: 'eng', url: file('206.eng.srt'), fmt: 'srt' },
        { lang: 'ara', url: file('206.ara.srt?charset=windows-1256'), fmt: 'srt' },
        { lang: 'eng', url: file('999.eng.vtt'), fmt: 'vtt' },
      ],
    });
    const s = await state(page, 'playing');
    // Desktop Chromium lists none of the MKV's own subtitles (no in-band text): the files only, none loaded yet.
    expect(s.textTracks.map((t) => `${t.id} ${t.lang} ${String(t.selected)}`)).toEqual(['ext:0 en false', 'ext:1 ar false', 'ext:2 en false']);
    expect(s.subtitles).toEqual({ feed: null, cues: [] });
    expect(fetched).toEqual([]);
    const harness = page.getByTestId('playback');
    const selectText = (id: string | null): Promise<boolean | undefined> => page.evaluate((i) => (window as PlaybackTarget).__LABLO_PLAYBACK__?.selectText(i), id);

    // English: the cue the media clock is in, then the next one.
    expect(await selectText('ext:0')).toBe(true);
    await expect(harness).toHaveAttribute('data-subtitles', 'file');
    const first = await expectCueInTime(page, 'English subtitle ');
    await expect(page.getByTestId('subtitle-cue')).not.toHaveText(first, { timeout: 10_000 });
    await expectCueInTime(page, 'English subtitle ');
    // Bottom centre, inside the title-safe area, in the medium size.
    const box = (await page.getByTestId('subtitle-cue').boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 960)).toBeLessThan(2);
    expect(box.y + box.height).toBeLessThanOrEqual(1080 - 54);
    expect(await page.getByTestId('subtitles').evaluate((el) => getComputedStyle(el).fontSize)).toBe('52px');
    await page.screenshot({ path: path.join(SHOTS, 'subtitles-file-en.png'), animations: 'disabled' });

    // Earlier by a minute: the cues of a minute later show now.
    await page.evaluate(() => (window as PlaybackTarget).__LABLO_PLAYBACK__?.setSubtitleDelay(-60_000));
    await expectCueInTime(page, 'English subtitle 01:', -60_000);
    await page.evaluate(() => (window as PlaybackTarget).__LABLO_PLAYBACK__?.setSubtitleDelay(0));

    // The Windows-1256 Arabic file: decoded by the fallback, drawn right to left, in the large size.
    expect(await selectText('ext:1')).toBe(true);
    await page.evaluate(() => (window as PlaybackTarget).__LABLO_PLAYBACK__?.setSubtitleSize('l'));
    const arabic = await expectCueInTime(page, 'ترجمة عربية ');
    expect(arabic).toMatch(/^ترجمة عربية \d\d:\d\d$/);
    expect(await page.getByTestId('subtitle-cue').evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    expect(await page.getByTestId('subtitles').evaluate((el) => getComputedStyle(el).fontSize)).toBe('64px');
    await page.screenshot({ path: path.join(SHOTS, 'subtitles-file-ar.png'), animations: 'disabled' });

    // A file the provider doesn't have: refused, and the Arabic stays.
    expect(await selectText('ext:2')).toBe(false);
    expect((await snapshot(page)).textTracks.filter((t) => t.selected).map((t) => t.id)).toEqual(['ext:1']);
    await expectCueInTime(page, 'ترجمة عربية ');
    // English again: loaded once in this session.
    expect(await selectText('ext:0')).toBe(true);
    await expectCueInTime(page, 'English subtitle ');
    expect(fetched).toEqual(['206.eng.srt', '206.ara.srt', '999.eng.vtt']);

    // Off, then a stop: nothing drawn.
    expect(await selectText(null)).toBe(true);
    await expect(harness).toHaveAttribute('data-subtitles', '');
    await expect(page.getByTestId('subtitles')).toHaveCount(0);
    expect(await selectText('ext:0')).toBe(true);
    await expect(page.getByTestId('subtitle-cue')).toHaveCount(1, { timeout: 10_000 });
    await stop(page);
    await state(page, 'idle');
    await expect(page.getByTestId('subtitles')).toHaveCount(0);
    await expect(harness).toHaveAttribute('data-subtitles', '');
  });
});
