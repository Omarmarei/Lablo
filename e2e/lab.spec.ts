import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { listen, mock } from '../apps/mock-provider/test/helpers';
import { S6_PRESSES, S6_QUERIES } from '../apps/tv/src/lab/scale';
import { RemoteDriver } from './remote-driver';

/**
 * The Zoma Lab (RELAY step 15a) in the desktop browser: under `pnpm dev` (lab.html) and as the
 * built TV bundle from file:// (dist/tv-lab). Every check's record must reach the in-process
 * mock's LAN log collector, which is how the lab reports from a real TV.
 */
const LAB_DIST = path.resolve(import.meta.dirname, '../dist/tv-lab');

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

/** What the desktop browser answers (a TV is expected to pass S7's no-CORS checks, and to have a device ID). */
const DESKTOP: ReadonlyArray<readonly [string, string]> = [
  ['S0/device', 'info'],
  ['S1/boot', 'pass'],
  ['S1/polyfills', 'pass'],
  ['S1/apis', 'info'],
  ['S1/preact', 'pass'],
  ['S1/blob-worker', 'pass'],
  ['S1/text-decoder', 'pass'],
  ['S1/fetch-stream', 'pass'],
  ['S1/fetch-stream-worker', 'pass'],
  ['S1/idb', 'pass'],
  ['S1/idb-bulk-worker', 'pass'],
  ['S2/local-storage', 'info'],
  ['S2/indexeddb', 'info'],
  ['S2/quota', 'info'],
  ['S2/write-test', 'pass'],
  ['S3/device-id', 'skip'],
  ['S3/stable', 'skip'],
  ['S7/xhr-cors', 'pass'],
  // The browser enforces CORS: the requests a TV app may make, a web page may not.
  ['S7/xhr-no-cors', 'fail'],
  ['S7/fetch-no-cors', 'fail'],
  ['S7/xhr-redirect', 'pass'],
  ['S7/fetch-redirect', 'pass'],
  ['S7/xhr-redirect-no-cors', 'fail'],
  // Arabic: the app's own faces, shaping and isolation must work; Intl is only measured.
  ['S9/fonts', 'pass'],
  ['S9/shaping', 'pass'],
  ['S9/bidi', 'pass'],
  ['S9/intl', 'info'],
  // A desktop browser has no screensaver, screen reader setting or TV speech, and "Run all" asks nobody.
  ['S11/lifecycle', 'info'],
  ['S11/screensaver', 'skip'],
  ['S11/screen-reader', 'skip'],
  ['S11/speech', 'skip'],
  ['S11/focus-reading', 'skip'],
  ['S11/live-reading', 'skip'],
  // The mock's own small catalog: S6 measures everything and judges nothing (pnpm lab:scale judges).
  ['S6/source', 'info'],
  ['S6/ingest', 'info'],
  ['S6/search', 'info'],
  ['S6/keys', 'info'],
  ['S6/guide', 'info'],
  ['S6/cold-start', 'info'],
  ['S6/cleanup', 'info'],
];

/**
 * What a TV bundle answers differently in a desktop engine: S3 finds no device ID, and the
 * adapters find no TV APIs (webOS has no screensaver API at all).
 */
const BUNDLE: { readonly [platform in 'tizen' | 'webos']: { readonly [key: string]: string } } = {
  tizen: { 'S3/device-id': 'fail', 'S11/screensaver': 'fail', 'S11/screen-reader': 'info', 'S11/speech': 'info' },
  webos: { 'S3/device-id': 'fail', 'S11/screensaver': 'info', 'S11/screen-reader': 'info', 'S11/speech': 'info' },
};

let app: MockServer;
let base: string;
let logDir: string;

test.beforeAll(async () => {
  logDir = await mkdtemp(path.join(tmpdir(), 'zoma-lab-e2e-'));
  app = await mock({ labLogDir: logDir });
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
    const text = message.text();
    // The no-CORS checks are refused by design, and Tizen's webapis.js exists only on a TV.
    if (message.type() === 'error' && !/CORS|ERR_FAILED|ERR_FILE_NOT_FOUND/.test(text)) errors.push(`console: ${text}`);
  });
  return errors;
}

/** The session's records as the collector stored them. */
async function collected(session: string): Promise<Record[]> {
  const res = await fetch(`${base}/__lab/logs/${session}`);
  expect(res.status).toBe(200);
  return (await res.text())
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record);
}

/** Waits for the run to end and every record to reach the collector; returns them. */
async function finishedRun(page: Page, runs: number): Promise<{ session: string; records: Record[] }> {
  const lab = page.getByTestId('lab');
  await expect(lab).toHaveAttribute('data-runs', String(runs), { timeout: 60_000 });
  await expect(lab).toHaveAttribute('data-phase', 'done');
  await expect(lab).toHaveAttribute('data-pending', '0', { timeout: 15_000 });
  const session = (await lab.getAttribute('data-session')) ?? '';
  expect(session).toMatch(/^[a-z]+-[A-Za-z0-9._-]+-\d{8}-\d{6}-[a-z0-9]{4}$/);
  const records = await collected(session);
  expect(Number(await lab.getAttribute('data-sent'))).toBe(records.length);
  return { session, records };
}

/**
 * S6 against the in-process mock's own catalog (25 entries, 12 live channels): the app's data
 * engine and live screen ran every step, and the records say what they measured.
 */
function expectS6(records: readonly Record[]): void {
  const s6 = (id: string): Record | undefined => records.find((r) => r.spike === 'S6' && r.check === id);
  expect(s6('source')?.value).toMatchObject({ items: 25, live: 12, guide: { static: false }, atScale: { catalog: false, guide: false } });
  // The test account's URLs never reach the records.
  expect(JSON.stringify(records.filter((r) => r.spike === 'S6'))).not.toMatch(/zoma-test|password=/);
  expect(s6('ingest')?.value).toMatchObject({ items: 25, expected: 25, counts: { live: 12, movie: 6, series: 7 } });
  const search = s6('search')?.value as { queries: { q: string; total: number }[] };
  expect(search.queries.map((q) => q.q)).toEqual(S6_QUERIES);
  expect(search.queries.find((q) => q.q === 'zoma')?.total).toBeGreaterThan(0);
  expect(search.queries.find((q) => q.q === 'زوما')?.total).toBe(1);
  // Every press timed to its painted focus, on the app's live screen.
  const keys = s6('keys')?.value as { count: number; presses: [string, string, number | null][]; refresh: { ended: string } };
  expect(keys.count).toBe(S6_PRESSES.length);
  expect(keys.presses.map((p) => p[0])).toEqual(S6_PRESSES);
  expect(keys.presses.every((p) => typeof p[2] === 'number')).toBe(true);
  expect(keys.presses[0]?.[1]).toBe('live/channels/1');
  expect(keys.presses.find((p) => p[0] === 'LEFT')?.[1]).toBe('live/rail/0');
  // A small refresh may end before the presses do, or (paused by them on the low tier) be cancelled.
  expect(['finished', 'cancelled']).toContain(keys.refresh.ended);
  // The guide moved to today: the mock's guide matched and kept programmes.
  expect(s6('guide')?.value).toMatchObject({ wanted: 12, matched: 11, gzipped: true });
  expect((s6('guide')?.value as { kept: number }).kept).toBeGreaterThan(0);
  const cold = s6('cold-start')?.value as { bootMs: number; dataMs: number; totalMs: number; idleMs: number; start: string };
  expect(cold.start).toBe('home');
  expect(cold.totalMs).toBe(cold.bootMs + cold.dataMs);
  expect(cold.bootMs).toBeGreaterThan(0);
  expect(cold.idleMs).toBeGreaterThanOrEqual(cold.dataMs);
  expect(s6('cleanup')?.note).toBe('deleted "zoma"');
}


/** S9's records: every face loaded, the word joined, the lines in order, and Intl beside the app. */
function expectS9(records: readonly Record[]): void {
  const s9 = (id: string): Record | undefined => records.find((r) => r.spike === 'S9' && r.check === id);
  expect(s9('fonts')?.value).toEqual({ faces: expect.arrayContaining(['la400:loaded', 'la700:loaded', 'ar400:loaded', 'ar700:loaded']) });
  const shaping = s9('shaping')?.value as { word: number; wordApart: number; ligature: number; ligatureApart: number; arabicFaceLoaded: boolean };
  expect(shaping.arabicFaceLoaded).toBe(true);
  expect(shaping.word).toBeLessThan(shaping.wordApart * 0.95);
  expect(shaping.ligature).toBeLessThan(shaping.ligatureApart * 0.9);
  expect(s9('bidi')?.value).toMatchObject({ trailing: { first: expect.any(Number) } });
  const intl = s9('intl')?.value as { hasIntl: boolean; locales: { tag: string; app: { date: string; time: string; number: string; digits: string } }[] };
  expect(intl.hasIntl).toBe(true);
  // The app's own output (ADR-011): Gregorian, Western digits, the same on every engine.
  expect(intl.locales.map((l) => [l.tag, l.app.date, l.app.time, l.app.number])).toEqual([
    ['ar-SA', 'الأربعاء، 4 نوفمبر 2026', '8:05 م', '1,234.5'],
    ['ar-AE', 'الأربعاء، 4 نوفمبر 2026', '8:05 م', '1,234.5'],
    ['ar', 'الأربعاء، 4 نوفمبر 2026', '8:05 م', '1,234.5'],
    ['en-US', 'Wednesday, November 4, 2026', '8:05 PM', '1,234.5'],
  ]);
  expect(s9('intl')?.note).toMatch(/^Intl: ar-SA [a-z-]+·[a-z]+, ar-AE .*; the app: Gregorian, latn digits in Arabic \(ADR-011\)$/);
}

function statuses(records: readonly Record[]): Array<[string, string]> {
  return records.filter((r) => r.type === 'check').map((r) => [`${r.spike ?? ''}/${r.check ?? ''}`, r.status ?? '']);
}

test.describe('the Zoma Lab in the desktop browser (pnpm dev)', () => {
  test('runs every spike by the remote and sends each result to the collector', async ({ page }) => {
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    await page.goto(`/lab.html?server=${base}&mb=8&auto=0`);
    const lab = page.getByTestId('lab');
    await expect(lab).toHaveAttribute('data-ready', 'true');
    await remote.expectFocus('lab/actions/0');
    await expect(lab).toHaveAttribute('data-phase', 'ready');
    // Run all.
    await remote.press('OK');
    const { session, records } = await finishedRun(page, 1);
    // S6's live screen is gone again: the lab shows alone.
    await expect(page.getByTestId('lab-stage')).toHaveCount(0);

    // In order: the start, one record per check, the end.
    expect(records.map((r) => r.seq)).toEqual(records.map((_, i) => i + 1));
    expect(records.every((r) => r.session === session)).toBe(true);
    expect(records[0]?.type).toBe('start');
    expect(records[0]?.value).toMatchObject({ version: 'dev', server: base, writeMb: 8, autoRun: false, previous: { localStorage: null, indexedDB: null } });
    expect(statuses(records)).toEqual(DESKTOP);
    const end = records[records.length - 1];
    expect(end?.type).toBe('end');
    expect(end?.value).toMatchObject({ run: 1, spikes: ['S0', 'S1', 'S2', 'S3', 'S7', 'S9', 'S11', 'S6'], counts: { pass: 16, fail: 3, info: 14, skip: 7 } });

    // What the records say, beyond the status.
    const check = (key: string): Record | undefined => records.find((r) => `${r.spike ?? ''}/${r.check ?? ''}` === key);
    expect(check('S0/device')?.value).toMatchObject({ platform: 'browser', model: 'Desktop browser', labVersion: 'dev' });
    expect(check('S1/fetch-stream')?.value).toMatchObject({ bytes: 20_000 * 30, lines: 20_000, badLine: null });
    expect(check('S1/fetch-stream-worker')?.value).toMatchObject({ bytes: 20_000 * 30, lines: 20_000, badLine: null });
    expect(check('S1/idb-bulk-worker')?.value).toMatchObject({ items: 10_000, count: 10_000, getAll: 500, deleted: true });
    expect(check('S1/blob-worker')?.value).toMatchObject({ features: { TextDecoder: true, fetch: true, indexedDB: true, 'Response.body': true } });
    expect(check('S2/write-test')?.value).toMatchObject({ targetMb: 8, writtenMb: 8, error: null, deleted: true });
    expect(check('S7/xhr-redirect')?.value).toEqual({ status: 200, responseURL: `${base}/__lab/echo` });
    expect(check('S7/xhr-no-cors')?.note).toMatch(/^no readable answer/);
    expectS9(records);
    expect(check('S11/lifecycle')?.note).toMatch(/^no lifecycle events yet/);
    expectS6(records);

    // The screen: each spike's overall status, and the checks of the spike in focus.
    const spikeStatus = async (id: string): Promise<string | null> => page.getByTestId(`spike-${id}`).getAttribute('data-status');
    expect(await Promise.all(['S0', 'S1', 'S2', 'S3', 'S7', 'S9', 'S11', 'S6'].map(spikeStatus))).toEqual(['info', 'pass', 'pass', 'skip', 'fail', 'pass', 'info', 'info']);
    await remote.go('DOWN', 'lab/spikes/0');
    await remote.go('DOWN', 'lab/spikes/1');
    await expect(page.getByTestId('checks')).toHaveAttribute('data-spike', 'S1');
    await expect(page.getByTestId('check-S1-idb-bulk-worker')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('sent')).toHaveText(`${records.length} records sent`);

    // OK on a spike runs it alone: S2 again, now finding the first run's markers.
    await remote.go('DOWN', 'lab/spikes/2');
    await remote.press('OK');
    const again = await finishedRun(page, 2);
    expect(again.session).toBe(session);
    const second = again.records.slice(records.length);
    expect(statuses(second)).toEqual([
      ['S2/local-storage', 'info'],
      ['S2/indexeddb', 'info'],
      ['S2/quota', 'info'],
      ['S2/write-test', 'pass'],
    ]);
    // The markers were read at start, so a run in the same session still sees none.
    expect(second[0]?.note).toMatch(/^no marker in localStorage/);
    expect(second[second.length - 1]).toMatchObject({ type: 'end', note: 'S2', value: { run: 2, spikes: ['S2'] } });

    // Back on the root asks first (the browser, like Tizen); Stay keeps the lab.
    await remote.go('BACK', 'exit/buttons/0');
    await remote.go('OK', 'lab/spikes/2');
    expect(errors).toEqual([]);
  });

  test('logs lifecycle events as they come, and asks by ear when S11 runs alone (S11)', async ({ page }) => {
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    await page.goto(`/lab.html?server=${base}&auto=0`);
    const lab = page.getByTestId('lab');
    await expect(lab).toHaveAttribute('data-ready', 'true');
    // The tab hidden, then back after a while (the browser adapter reads document.hidden).
    const setHidden = (hidden: boolean): Promise<void> =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    await page.waitForTimeout(1100);
    await setHidden(false);

    // To S11 (the seventh row) and OK: S11 alone, so its questions are asked.
    await remote.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    await remote.go('DOWN', 'lab/spikes/6');
    await remote.go('OK', 'ask/items/0');
    const ask = page.getByTestId('ask');
    await expect(ask).toHaveAttribute('data-mode', 'focus');
    const focused = (): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
    // DOM focus follows the remote, so a screen reader can read the label.
    await expect.poll(focused).toBe('Zoma Lab first button');
    await remote.go('RIGHT', 'ask/items/1');
    await expect.poll(focused).toBe('Zoma Lab second button');
    await expect(page.getByTestId('ask-item-1')).toHaveAttribute('role', 'button');
    // GREEN: read. The second question comes up.
    await remote.press('GREEN');
    await expect(ask).toHaveAttribute('data-mode', 'live');
    await remote.expectFocus('ask/items/0');
    await remote.go('RIGHT', 'ask/items/1');
    await remote.go('RIGHT', 'ask/items/2');
    // No DOM focus here: the live region says the focused label.
    await expect(page.getByTestId('ask-live')).toHaveText('Zoma Lab third button');
    await expect(page.getByTestId('ask-live')).toHaveAttribute('aria-live', 'assertive');
    expect(await focused()).toBeNull();
    // RED: not read.
    await remote.press('RED');
    const { records } = await finishedRun(page, 1);
    await expect(ask).toHaveCount(0);
    await remote.expectFocus('lab/spikes/6');

    // The lifecycle events went out as they came, before the run.
    const events = records.filter((r) => r.type === 'event');
    expect(events.map((r) => [r.check, r.note])).toEqual([
      ['lifecycle', 'hidden'],
      ['lifecycle', 'visible'],
    ]);
    const back = events[1]?.value as { away: { ms: number; beats: number }; visibility: string };
    expect(back.away.ms).toBeGreaterThanOrEqual(1000);
    expect(back.away.beats).toBeGreaterThanOrEqual(1);
    const s11 = records.filter((r) => r.type === 'check');
    expect(s11.map((r) => [r.check, r.status])).toEqual([
      ['lifecycle', 'info'],
      ['screensaver', 'skip'],
      ['screen-reader', 'skip'],
      ['speech', 'skip'],
      ['focus-reading', 'pass'],
      ['live-reading', 'fail'],
    ]);
    expect(s11[0]?.note).toMatch(/^hidden at \d+\.\d s, visible at \d+\.\d s \(away \d+\.\d s, \d+ beats?\)$/);
    expect(s11[4]?.value).toMatchObject({ answer: 'yes', moves: 1 });
    expect(s11[5]?.value).toMatchObject({ answer: 'no', moves: 2 });
    expect(records[records.length - 1]).toMatchObject({ type: 'end', note: 'S11', value: { counts: { pass: 1, fail: 1, info: 1, skip: 3 } } });
    expect(errors).toEqual([]);
  });

  test('finds the markers of an older version after an "update" (S2), and of the same version after a relaunch', async ({ page }) => {
    const errors = trackErrors(page);
    // The TV build's lab-config.js, as an older lab would have had it.
    await page.addInitScript(() => {
      const version = sessionStorage.getItem('lab-version') ?? '0.1.0';
      (window as unknown as { ZOMA_LAB_CONFIG: unknown }).ZOMA_LAB_CONFIG = { version, writeMb: 4, autoRun: true };
    });
    await page.goto(`/lab.html?server=${base}`);
    const first = await finishedRun(page, 1);
    expect(first.records[0]?.value).toMatchObject({ version: '0.1.0', writeMb: 4, autoRun: true });

    // The same version again: the markers are there, nothing to judge yet.
    await page.reload();
    const relaunch = await finishedRun(page, 1);
    const relaunchMarker = relaunch.records.find((r) => r.check === 'indexeddb');
    expect(relaunchMarker?.status).toBe('info');
    expect(relaunchMarker?.note).toMatch(/^IndexedDB kept the marker of an earlier run of 0\.1\.0/);

    // A newer version over it: both stores survived the "update".
    await page.evaluate(() => sessionStorage.setItem('lab-version', '0.1.1'));
    await page.reload();
    const update = await finishedRun(page, 1);
    expect(update.records[0]?.value).toMatchObject({ version: '0.1.1', previous: { localStorage: { version: '0.1.0', runs: 2 }, indexedDB: { version: '0.1.0', runs: 2 } } });
    const s2 = update.records.filter((r) => r.spike === 'S2' && r.type === 'check');
    expect(s2.slice(0, 2).map((r) => [r.check, r.status, r.note])).toEqual([
      ['local-storage', 'pass', expect.stringMatching(/^localStorage survived an update from 0\.1\.0 to 0\.1\.1/)],
      ['indexeddb', 'pass', expect.stringMatching(/^IndexedDB survived an update from 0\.1\.0 to 0\.1\.1/)],
    ]);
    // Three sessions, three files in the collector.
    expect(new Set([first.session, relaunch.session, update.session]).size).toBe(3);
    expect(errors).toEqual([]);
  });

  test('keeps the records while the collector is down and sends them once it answers', async ({ page }) => {
    const late = await mock({ labLogDir: logDir });
    // A port nobody listens on yet: start the server on it later.
    const probe = await listen(late);
    await late.close();
    const port = new URL(probe).port;
    const collector = `http://127.0.0.1:${port}`;
    await page.goto(`/lab.html?server=${collector}&mb=2&auto=0`);
    const lab = page.getByTestId('lab');
    await expect(lab).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('sent')).toHaveText(/^Collector unreachable \(.*\): 1 record waiting, retrying$/);
    const restarted = await mock({ labLogDir: logDir });
    await restarted.listen({ port: Number(port), host: '127.0.0.1' });
    try {
      // The start record arrives within the retry delays (1, 2, 4… s).
      await expect(lab).toHaveAttribute('data-pending', '0', { timeout: 20_000 });
      await expect(page.getByTestId('sent')).toHaveText('1 record sent');
      const session = (await lab.getAttribute('data-session')) ?? '';
      const res = await fetch(`${collector}/__lab/logs/${session}`);
      expect((await res.text()).split('\n').filter((l) => l !== '')).toHaveLength(1);
    } finally {
      await restarted.close();
    }
  });
});

for (const platform of ['tizen', 'webos'] as const) {
  test(`the ${platform} lab bundle runs from file:// at launch and reports to the collector`, async ({ page }) => {
    const index = path.join(LAB_DIST, platform, 'index.html');
    expect(existsSync(index), `${index} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
    const errors = trackErrors(page);
    // lab-config.js has this PC's LAN address and a 200 MB write test: the URL overrides both.
    await page.goto(`${pathToFileURL(index).href}?server=${encodeURIComponent(base)}&mb=8`);
    await expect(page.locator('#boot-error')).toBeHidden();
    const { records } = await finishedRun(page, 1);
    expect(records[0]?.value).toMatchObject({ server: base, writeMb: 8, autoRun: true, device: { platform, model: 'unknown' } });
    // A TV platform without its TV APIs: no device ID (S3), no screensaver control or speech (S11).
    expect(statuses(records)).toEqual(DESKTOP.map(([key, status]) => [key, BUNDLE[platform][key] ?? status]));
    expect(records.find((r) => r.check === 'screen-reader')?.note).toBe(platform === 'tizen' ? 'unknown: no webapis.tvinfo' : 'unknown: no PalmServiceBridge for luna://com.webos.settingsservice/getSystemSettings');
    expectS9(records);
    expect(records.find((r) => r.check === 'device-id')?.note).toBe(`the ${platform === 'tizen' ? 'DUID' : 'LGUDID'} is not available`);
    // S6 in the bundle: its inlined data workers from file://, and the app's live screen.
    expectS6(records);
    // The native probe ran before the bundle; current Chromium needed no polyfill.
    expect(records.find((r) => r.check === 'polyfills')?.value).toMatchObject({ broken: [], polyfilled: [] });
    expect(errors).toEqual([]);
  });
}
