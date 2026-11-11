import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { FileMedia } from '../apps/mock-provider/src/file-media';
import type { MockServer } from '../apps/mock-provider/src/server';
import { listen, mock } from '../apps/mock-provider/test/helpers';
import { BATTERY } from '../apps/tv/src/lab/battery';
import { CONTAINER_MIME, HEVC_MIME, LAB_MEDIA_IDS } from '../apps/tv/src/lab/media';
import { RemoteDriver } from './remote-driver';

/**
 * S5, the `<video>` battery (RELAY step 15c), on the generated media (`pnpm mock:media`): only
 * in `pnpm lab:media` (part of `pnpm verify:media`, CI job `media`), since `pnpm verify` has no
 * ffmpeg. Desktop Chromium plays H.264/AAC, native HLS and MKV, but no MPEG-TS, no AC3 and (in
 * headless mode) no HEVC picture, and lists no in-band text tracks: every row must say so.
 * `audioTracks` is behind a Blink flag in desktop Chromium (webOS ships it), turned on here so
 * the switch runs.
 */
const MEDIA_DIR = path.resolve(import.meta.dirname, '../.cache/media');

test.use({ launchOptions: { args: ['--enable-blink-features=AudioVideoTracks'] } });

interface Record {
  readonly type: 'start' | 'check' | 'end' | 'event';
  readonly session: string;
  readonly seq: number;
  readonly spike?: string;
  readonly check?: string;
  readonly status?: string;
  readonly note?: string;
  readonly value?: unknown;
}

interface Engine {
  readonly canPlayType: { readonly [mime: string]: string };
  readonly apis: { readonly [api: string]: boolean };
}

let app: MockServer;
let base: string;
let logDir: string;

test.beforeAll(async () => {
  expect(existsSync(path.join(MEDIA_DIR, 'manifest.json')), `no generated media in ${MEDIA_DIR}: run pnpm mock:media first`).toBe(true);
  logDir = await mkdtemp(path.join(tmpdir(), 'lablo-lab-media-'));
  // The real clock: live streams sit on the epoch timeline.
  app = await mock({ labLogDir: logDir, now: Date.now, media: new FileMedia({ dir: MEDIA_DIR }) });
  base = await listen(app);
});
test.afterAll(async () => {
  await app.close();
  await rm(logDir, { recursive: true, force: true });
});

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // S7's no-CORS checks are refused by design in a "Run all".
    if (message.type() === 'error' && !/CORS|ERR_FAILED/.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function finishedRun(page: Page, timeout: number): Promise<Record[]> {
  const lab = page.getByTestId('lab');
  await expect(lab).toHaveAttribute('data-runs', '1', { timeout });
  await expect(lab).toHaveAttribute('data-pending', '0', { timeout: 15_000 });
  const session = (await lab.getAttribute('data-session')) ?? '';
  const res = await fetch(`${base}/__lab/logs/${session}`);
  expect(res.status).toBe(200);
  const records = (await res.text())
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record);
  expect(records.map((r) => r.seq)).toEqual(records.map((_, i) => i + 1));
  return records;
}

/** The S5 rows every run checks, interactive or not; returns the rows by check id. */
function expectBattery(records: readonly Record[]): { readonly [check: string]: Record } {
  const s5 = records.filter((r) => r.spike === 'S5' && r.type === 'check');
  const row: { [check: string]: Record } = {};
  for (const r of s5) row[r.check ?? ''] = r;
  // The lab never records a URL: they carry the test account.
  expect(JSON.stringify(s5)).not.toMatch(/lablo-test|\/live\/|\/movie\/|\/series\//);

  const formats = row['formats']?.value as { media: string; items: string[]; engine: Engine };
  expect(row['formats']).toMatchObject({ status: 'info', note: '10 media items on the lab server' });
  expect(formats.media).toBe('files');
  expect(formats.items).toEqual(LAB_MEDIA_IDS.slice());
  const can = formats.engine.canPlayType;
  // What desktop Chromium says it plays (a TV answers differently: step 16).
  expect([can[CONTAINER_MIME.ts], can[HEVC_MIME]]).toEqual(['', '']);
  expect(can[CONTAINER_MIME.hls]).not.toBe('');
  expect(can[CONTAINER_MIME.mkv]).not.toBe('');
  expect(formats.engine.apis).toMatchObject({ audioTracks: true, textTracks: true, mediaId: false, selectTrack: false, MediaSource: true });

  // No MPEG-TS in a desktop browser: recorded as unsupported, within the frame wait.
  expect(row['ts']).toMatchObject({ status: 'fail', value: { played: false, unsupported: true, canPlay: '', limitMs: BATTERY.tsFirstFrameMs } });
  expect(row['ts']?.note).toMatch(/^no picture within \d+ ms: /);
  // Native HLS: the first frame, at the stream's size.
  expect(row['hls']).toMatchObject({ status: 'pass', value: { played: true, width: 960, height: 540, limitMs: BATTERY.hlsFirstFrameMs } });
  expect((row['hls']?.value as { ms: number }).ms).toBeLessThan(BATTERY.hlsFirstFrameMs);
  // TS never played, so the redirect row took HLS through the mock's three 302s.
  expect(row['redirect']).toMatchObject({ status: 'pass', value: { container: 'hls', fault: 'redirect:hops=3', played: true } });
  // HEVC: no picture headless (canPlayType ''); the 4K row says the engine can't.
  expect(row['hevc-4k']).toMatchObject({ status: 'fail', value: { played: false, unsupported: true, canPlay: '', expected: { codec: 'hevc', width: 3840, height: 2160 } } });
  // Three AAC tracks of the five (AC3 and E-AC3 dropped); the switch to the second, in time.
  const audio = row['audio-tracks']?.value as { listed: Array<{ lang: string }>; expected: string[]; switch: { accepted: boolean; ms: number; restarted: boolean }; route: string | null };
  expect(row['audio-tracks']?.status).toBe('pass');
  // The element's own list did it; the desktop has no mediaId, so no luna route.
  expect(audio.route).toBe('audioTracks');
  expect(audio).not.toHaveProperty('service');
  expect(audio.listed.map((t) => t.lang)).toEqual(['ara', 'eng', 'spa']);
  expect(audio.expected).toEqual(['ara:aac', 'eng:aac', 'spa:aac', 'eng:ac3', 'eng:eac3']);
  expect(audio.switch).toMatchObject({ accepted: true, restarted: false });
  expect(audio.switch.ms).toBeLessThan(BATTERY.switchMs);
  expect(row['ac3']).toMatchObject({ status: 'fail', value: { unsupported: true }, note: "the engine lists 3 of the file's 5 audio tracks: it drops the ones it can't decode (AC3, E-AC3)" });
  // Both files play; neither lists its in-band subtitles.
  expect(row['subtitles']).toMatchObject({
    status: 'fail',
    note: 'subs-mkv: no text track; subs-mp4: no text track',
    value: { files: [{ file: 'subs-mkv', played: true, tracks: [] }, { file: 'subs-mp4', played: true, tracks: [] }] },
  });
  return row;
}

test.describe('S5 on the generated media in the desktop browser', () => {
  test('runs every row when S5 is started from its row: Home and back, and a soak with stalls', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    await page.goto(`/lab.html?server=${base}&auto=0&soak=1`);
    const lab = page.getByTestId('lab');
    await expect(lab).toHaveAttribute('data-ready', 'true');
    // To S5 (the tenth row, after S4) and OK: S5 alone, so the rows that need a person run too.
    await remote.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    await remote.go('DOWN', 'lab/spikes/9');
    await remote.press('OK');
    // The picture box shows each row; the suspend row asks for Home.
    const caption = page.getByTestId('lab-player-caption');
    await expect(caption).toHaveText('S5: press Home, wait a few seconds, then come back to the Lablo Lab', { timeout: 120_000 });
    await expect(page.locator('[data-testid="lab-player"] video')).toHaveCount(1);
    // Home: the tab hidden (the browser adapter reads document.hidden), then back.
    const setHidden = (hidden: boolean): Promise<void> =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await page.waitForTimeout(1000);
    await setHidden(true);
    await page.waitForTimeout(1200);
    await setHidden(false);
    await expect(caption).toHaveText('S5: 1 min with a stall every ~20 s; each must recover in under 10 s', { timeout: 30_000 });
    const records = await finishedRun(page, 120_000);
    await expect(page.getByTestId('lab-player')).toHaveCount(0);
    await expect(page.getByTestId('spike-S5')).toHaveAttribute('data-status', 'fail');

    const row = expectBattery(records);
    expect(Object.keys(row)).toEqual(['formats', 'ts', 'hls', 'redirect', 'hevc-4k', 'audio-tracks', 'ac3', 'subtitles', 'suspend', 'soak']);
    // Home and back: the live HLS again in time.
    const suspend = row['suspend']?.value as { container: string; awayMs: number; resumeMs: number };
    expect(row['suspend']?.status).toBe('pass');
    expect(suspend.container).toBe('hls');
    expect(suspend.awayMs).toBeGreaterThanOrEqual(1000);
    expect(suspend.resumeMs).toBeLessThan(BATTERY.resumeMs);
    expect(records.filter((r) => r.type === 'event').map((r) => r.note)).toEqual(['hidden', 'visible']);
    // The soak on the VOD stand-in (no TS here): about one stall per 20 s, each back within 10 s.
    const soak = row['soak']?.value as { source: string; minutes: number; stalls: number; slow: number; worstMs: number; list: Array<[number, number, number]> };
    expect(row['soak']?.status).toBe('pass');
    expect(soak).toMatchObject({ source: 'stall-vod', slow: 0 });
    expect(soak.minutes).toBeGreaterThanOrEqual(1);
    expect(soak.stalls).toBeGreaterThanOrEqual(2);
    // Each stall waited out the watchdog's 6 s before the reopen.
    for (const [, ms] of soak.list) expect(ms).toBeGreaterThanOrEqual(BATTERY.stallMs);
    expect(soak.worstMs).toBeLessThan(BATTERY.recoverMs);
    expect(records[records.length - 1]).toMatchObject({ type: 'end', note: 'S5', value: { counts: { pass: 5, fail: 4, info: 1, skip: 0 } } });
    expect(errors).toEqual([]);
  });

  test('runs the unattended rows in a run at launch, with nobody to press a key', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackErrors(page);
    await page.goto(`/lab.html?server=${base}&mb=8&auto=1`);
    const records = await finishedRun(page, 200_000);
    const row = expectBattery(records);
    expect(row['suspend']).toMatchObject({ status: 'skip', note: 'run S5 alone (OK on its row) and press Home while it plays' });
    expect(row['soak']).toMatchObject({ status: 'skip', note: 'run S5 alone (OK on its row): 60 min of live TS with stalls' });
    // Nobody pressed a key: whether the browser let it play with sound or the lab muted it, the row says.
    expect(typeof (row['hls']?.value as { muted: unknown }).muted).toBe('boolean');
    expect(errors).toEqual([]);
  });
});
