import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { blocklistHash, fileFrameCount, sha256, toBase64Url, utf8 } from '@lablo/crypto';
import type { PairPayload } from '@lablo/protocol';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { E2E_DATABASE, WEB, serverUrl, withDatabase } from '../apps/web/test/web-db';
import { stripIsolates } from '../packages/core/src/bidi';
import { HARNESS_SALT, devSignedAnswer } from '../tools/engines/src/config';
import { phonePadded, phoneSees, phoneSends, phoneSendsFile } from '../tools/engines/src/pair-phone';
import type { ApiFront, Forwarded } from './api-front';
import { startApiFront } from './api-front';
import { doc } from './config-server';
import { addXtreamAndWatch, toSourceTypes, trackErrors } from './onboard';
import { SHOTS, openSources, shoot, shownCode, storedProfile, usePhone } from './pairing-steps';
import { RemoteDriver } from './remote-driver';

/**
 * The TV's pairing against the real API (RELAY step 31c3): `next start` and its `lablo_e2e`
 * database (playwright.web.config.ts, `pnpm e2e:web`), the TV's dev app (its second web server)
 * with `?api=` a test front before the API (api-front.ts: everything passes on unchanged, with the
 * test's own caller address; the config is the real route's unless a test serves its own), the
 * mock provider in this process, and the scripted phone over HTTP (tools/engines/src/pair-phone.ts,
 * the typed-code path, the payload sealed here):
 * - onboarding by phone in English, an Xtream login: the phone reads `open`, `received` while the
 *   panel is held, then `ok`; the session's row keeps the status and no payload;
 * - Settings › Sources by phone in Arabic, an M3U link with a guide link: added, `ok`, and kept as
 *   the panel's login (step 37a's upgrade);
 * - on one screen, a new code each time: a wrong password (`auth_failed`), the mock's expired
 *   account (`expired`), a closed port (`unreachable`); nothing kept;
 * - a served config whose blocklist holds the mock's host (`blocked`), in Arabic;
 * - a served config's `block-new-sources` (`blocked`);
 * - onboarding by phone with an M3U file (step 31d2b2b): three frames up through the front to the
 *   development blob route and down to the TV, deleted with the status; then a changed file sent
 *   again under the same name from Settings replaces the source under its id.
 * Every test: the TV's preflights answered by the real routes, no error on the page.
 * Screenshots in English and Arabic go to artifacts/screenshots (`pair-api-*`).
 */

/** The real API (`next start`), as playwright.web.config.ts starts it. */
const API = `http://127.0.0.1:${Number(process.env.LABLO_WEB_E2E_PORT ?? 3101)}`;

const NO_NEW = { en: 'Adding sources is paused for maintenance.', ar: 'إضافة المصادر متوقفة مؤقتًا للصيانة.' };
const blockNew = { id: 'no-new', match: {}, mode: 'block-new-sources', message: NO_NEW };
/** The mock's host (127.0.0.1) on a served doc's blocklist. */
const BLOCKS_MOCK = { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] };
const BLOCKLISTED = { en: "This server can't be used with Lablo.", ar: 'لا يمكن استخدام هذا الخادم مع لابلو.' };

/** The part of node-postgres used here (the root has no `pg`, nor its types: apps/web's is loaded). */
interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}
const pg = createRequire(path.join(WEB, 'package.json'))('pg') as { Client: new (config: { connectionString: string }) => PgClient };

let app: MockServer;
let host: string;
/** Holds the mock's Xtream API while set (the TV then stays in its load). */
let panelGate: Promise<void> | null = null;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  app.addHook('onRequest', async (request) => {
    if (panelGate !== null && request.url.indexOf('/player_api.php') !== -1) await panelGate;
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

let fronts = 0;

/** A front before the real API for one test, with an address of its own (10.251.<worker>.<n>). */
async function withFront(run: (front: ApiFront) => Promise<void>): Promise<void> {
  fronts += 1;
  const front = await startApiFront({ upstream: API, address: `10.251.${test.info().workerIndex % 250}.${fronts % 250}` });
  try {
    await run(front);
  } finally {
    await front.close();
  }
}

/** The links as the phone page sends them: with their scheme. */
const m3uLink = (): string => `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`;
const guideLink = (): string => `http://${host}/xmltv.php?username=${U}&password=${P}`;
const xtream = (username: string, password: string, name: string): PairPayload => ({ v: 1, source: { type: 'xtream', server: `http://${host}`, username, password }, name });

interface SessionRow {
  readonly status: string | null;
  readonly payload: unknown;
  /** The phone's file (step 31d1): set by the upload URL, cleared with the status. */
  readonly fileId: string | null;
  readonly delivered: boolean;
}

/** The session's row in `lablo_e2e`, found by its code's hash as the API keeps it. */
async function sessionRow(code: string): Promise<SessionRow | undefined> {
  const client = new pg.Client({ connectionString: withDatabase(serverUrl(), E2E_DATABASE) });
  await client.connect();
  try {
    const result = await client.query<SessionRow>(
      'SELECT "status", "payload", "fileId", "deliveredAt" IS NOT NULL AS "delivered" FROM "PairSession" WHERE "codeHash" = $1',
      [toBase64Url(sha256(utf8(code)))],
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

/** The code on show, made by the real API (its row there, waiting) and polled for through the front. */
async function apiCode(page: Page, front: ApiFront): Promise<string> {
  const code = await shownCode(page);
  expect(await sessionRow(code)).toEqual({ status: null, payload: null, fileId: null, delivered: false });
  await expect.poll(() => front.forwarded.filter((f) => f.method === 'GET' && f.path.startsWith('/v1/pair/s/') && f.status === 200).length).toBeGreaterThan(0);
  expect(await phoneSees(front.origin, code)).toMatchObject({ state: 'open' });
  return code;
}

/** The pair screen's failed view, its reason, and the status the phone reads from the API. */
async function failsWith(page: Page, front: ApiFront, code: string, reason: string, status: string): Promise<void> {
  await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'failed', { timeout: 30_000 });
  await expect(page.getByTestId('pair-error')).toHaveAttribute('data-code', reason);
  await expect.poll(() => phoneSees(front.origin, code)).toEqual({ state: 'done', status });
  expect(await sessionRow(code)).toEqual({ status, payload: null, fileId: null, delivered: true });
}

/** The TV met the real routes' CORS: each preflight answered 204 by the API, none refused. */
function preflightsPassed(front: ApiFront): void {
  const preflights = front.forwarded.filter((f) => f.method === 'OPTIONS');
  expect(preflights.length).toBeGreaterThan(0);
  expect(preflights.filter((f) => f.status !== 204)).toEqual([]);
}

/** The config's answer is in, fresh, and no run goes on (the query worker has read its blocklist). */
async function configFresh(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe('fresh');
  await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.configIdle() ?? false)).toBe(true);
}

test('onboarding by phone: an Xtream login reaches the TV through the real API, the phone reads received then ok', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withFront(async (front) => {
    const onboarding = await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(front.origin)}`);
    const code = await usePhone(remote);
    await apiCode(page, front);
    await expect(page.getByTestId('pair-address')).toHaveText(`${front.origin.replace(/^http:\/\//, '')}/p`);
    await expect(page.getByTestId('pair-state')).toHaveText('Waiting for your phone…');
    await shoot(page, 'pair-api-code-en');

    // The panel is held: the TV has read the payload and is loading, so the phone reads `received`.
    let open: () => void = () => undefined;
    panelGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    try {
      await phoneSends(front.origin, code, xtream(U, P, 'Phone panel'));
      await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'loading', { timeout: 10_000 });
      await expect.poll(() => phoneSees(front.origin, code)).toEqual({ state: 'received' });
      expect(await sessionRow(code)).toEqual({ status: null, payload: null, fileId: null, delivered: true });
    } finally {
      panelGate = null;
      open();
    }

    await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
    await expect.poll(() => phoneSees(front.origin, code)).toEqual({ state: 'done', status: 'ok' });
    expect(await sessionRow(code)).toEqual({ status: 'ok', payload: null, fileId: null, delivered: true });
    const kept = await storedProfile(page);
    expect(kept?.sources).toEqual([expect.objectContaining({ id: 's1', type: 'xtream', name: 'Phone panel' })]);

    // The real config (the committed one), and the real routes' CORS.
    expect(front.configAnswers()).toBe(0);
    expect(front.forwarded).toContainEqual({ method: 'GET', path: '/v1/config', status: 200 });
    preflightsPassed(front);

    await remote.expectFocus('done/actions/0');
    await remote.press('OK');
    await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
    expect(errors).toEqual([]);
  });
});

test('from Settings in Arabic: an M3U link and its guide reach the TV through the real API, ok', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withFront(async (front) => {
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=ar-SA&api=${encodeURIComponent(front.origin)}`);
    await openSources(remote, 'ar');
    await remote.expectFocus('sources/sources/0');
    await remote.go('UP', 'sources/header/0');
    await remote.go('OK', 'pair/actions/0');
    const code = await apiCode(page, front);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('pair-title')).toHaveText('أضف مصدرًا من هاتفك');
    await shoot(page, 'pair-api-code-ar');

    await phoneSends(front.origin, code, { v: 1, source: { type: 'm3u', url: m3uLink() }, name: 'قائمة الهاتف', epg: [guideLink()] });
    const pair = page.getByTestId('pair');
    await expect(pair).toHaveAttribute('data-view', 'done', { timeout: 30_000 });
    await expect.poll(() => phoneSees(front.origin, code)).toEqual({ state: 'done', status: 'ok' });
    expect(await sessionRow(code)).toEqual({ status: 'ok', payload: null, fileId: null, delivered: true });
    await expect(page.getByTestId('pair-title')).toHaveText('كل شيء جاهز');
    await shoot(page, 'pair-api-done-ar');

    await remote.press('OK');
    await remote.expectFocus('sources/header/0');
    await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '2');
    const kept = await storedProfile(page);
    expect(kept?.sources.map((s) => s.id)).toEqual(['s1', 's2']);
    // The phone's get.php link is read through the panel's API, and kept as its login (step 37a).
    expect(kept?.sources[1]).toMatchObject({ type: 'xtream', name: 'قائمة الهاتف', account: { base: `http://${host}`, username: U, password: P } });
    expect(kept?.guides).toContainEqual({ id: 's2', url: guideLink() });
    preflightsPassed(front);
    expect(errors).toEqual([]);
  });
});

test('one screen, a new code each time: a wrong password, an expired account and a closed port; the phone reads each status', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  // A port nothing listens on: a server's, closed.
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const closedPort = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));

  await withFront(async (front) => {
    await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(front.origin)}`);
    await usePhone(remote);
    const first = await apiCode(page, front);
    await phoneSends(front.origin, first, xtream(U, 'wrong-password', 'Wrong'));
    await failsWith(page, front, first, 'auth', 'auth_failed');
    await expect(page.getByTestId('pair-error')).toHaveText("The provider didn't accept this username and password.");
    await remote.expectFocus('pair/actions/0');

    await remote.press('OK');
    const second = await apiCode(page, front);
    expect(second).not.toBe(first);
    await phoneSends(front.origin, second, xtream('expired', 'expired-test', 'Old'));
    await failsWith(page, front, second, 'expired', 'expired');
    await expect(page.getByTestId('pair-error')).toHaveText('This account has expired. Contact your provider.');

    await remote.press('OK');
    const third = await apiCode(page, front);
    await phoneSends(front.origin, third, { v: 1, source: { type: 'm3u', url: `http://127.0.0.1:${closedPort}/list.m3u` } });
    await failsWith(page, front, third, 'network', 'unreachable');
    await expect(page.getByTestId('pair-error')).toHaveText("Couldn't reach the server. Check the address and your internet connection.");
    await shoot(page, 'pair-api-unreachable-en');

    expect(await storedProfile(page)).toEqual({ sources: [], guides: [] });
    preflightsPassed(front);
    // The closed port's refusal is the browser's own line.
    expect(errors.filter((e) => !/Failed to load resource: net::ERR_CONNECTION_REFUSED/.test(e))).toEqual([]);
  });
});

test('in Arabic, a served config whose blocklist holds the panel: the phone reads blocked, nothing kept', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withFront(async (front) => {
    front.serve(devSignedAnswer(doc({ blocklist: BLOCKS_MOCK })));
    await toSourceTypes(remote, `locale=ar-SA&api=${encodeURIComponent(front.origin)}`);
    await configFresh(page);
    expect(front.configAnswers()).toBeGreaterThan(0);
    await usePhone(remote);
    const code = await apiCode(page, front);
    await phoneSends(front.origin, code, { v: 1, source: { type: 'm3u', url: m3uLink() }, name: 'محظور' });
    await failsWith(page, front, code, 'blocklisted', 'blocked');
    await expect(page.getByTestId('pair-error')).toHaveText(BLOCKLISTED.ar);
    expect(stripIsolates((await page.getByTestId('pair-title').textContent()) ?? '')).toBe('تعذّرت إضافة محظور');
    await shoot(page, 'pair-api-blocklisted-ar');
    expect(await storedProfile(page)).toEqual({ sources: [], guides: [] });
    preflightsPassed(front);
    expect(errors).toEqual([]);
  });
});

test('a served config refusing new sources: the phone reads blocked, nothing kept', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withFront(async (front) => {
    // Served before the TV's first request: the real route's answer may be kept 5 minutes
    // (`private, max-age=300`), so a refresh after it reads the browser's copy, not the front.
    front.serve(devSignedAnswer(doc({ kill: [blockNew] })));
    await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(front.origin)}`);
    await configFresh(page);
    expect(front.configAnswers()).toBeGreaterThan(0);
    // The pair screen opens and shows a code: the refusal comes when a source does.
    await usePhone(remote);
    const code = await apiCode(page, front);
    await phoneSends(front.origin, code, { v: 1, source: { type: 'm3u', url: m3uLink() } });
    await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'refused', { timeout: 10_000 });
    await expect(page.getByTestId('pair-error')).toHaveAttribute('data-code', 'refused');
    await expect(page.getByTestId('pair-error')).toHaveText(NO_NEW.en);
    await expect.poll(() => phoneSees(front.origin, code)).toEqual({ state: 'done', status: 'blocked' });
    expect(await sessionRow(code)).toEqual({ status: 'blocked', payload: null, fileId: null, delivered: true });
    expect(await storedProfile(page)).toEqual({ sources: [], guides: [] });
    preflightsPassed(front);
    expect(errors).toEqual([]);
  });
});

/**
 * The mock's M3U as a phone sends it in a file, padded at its end to `frames` frames; with
 * `channels`, only its first that many entries (the live channels come first).
 */
async function mockFile(frames: number, channels?: number): Promise<Uint8Array> {
  const answer = await fetch(m3uLink());
  expect(answer.status).toBe(200);
  // The header line, then two lines (#EXTINF and the link) per entry.
  const lines = (await answer.text()).split('\n');
  const plain = phonePadded((channels === undefined ? lines : lines.slice(0, 1 + 2 * channels)).join('\n'), frames);
  expect(fileFrameCount(plain.length)).toBe(frames);
  return plain;
}

/** The development blob route's requests the front passed on (the phone's PUT, the TV's GET). */
const blobRequests = (front: ApiFront, method: 'PUT' | 'GET'): Forwarded[] => front.forwarded.filter((f) => f.method === method && f.path.startsWith('/dev/blob/pair/'));

/** A presigned blob URL's path without its query. */
const blobPath = (url: string): string => url.slice(0, url.indexOf('?'));

test('onboarding by phone with an M3U file through the real API; a changed file sent again from Settings replaces it', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const whole = await mockFile(3);
  // The provider's list as it might change: three channels, two frames.
  const changed = await mockFile(2, 3);
  await withFront(async (front) => {
    const onboarding = await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(front.origin)}`);
    await usePhone(remote);
    const first = await apiCode(page, front);
    // The TV's download held: the payload went with its read, the file waits under its id until the status.
    let release: () => void = () => undefined;
    front.hold({
      method: 'GET',
      prefix: '/dev/blob/',
      until: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    try {
      await phoneSendsFile(front.origin, first, whole, { name: 'Phone file' });
      await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'loading', { timeout: 10_000 });
      await expect.poll(() => phoneSees(front.origin, first)).toEqual({ state: 'received' });
      const uploaded = blobPath(blobRequests(front, 'PUT')[0]!.path);
      expect(await sessionRow(first)).toEqual({ status: null, payload: null, fileId: uploaded.slice(uploaded.lastIndexOf('/') + 1), delivered: true });
    } finally {
      front.hold(null);
      release();
    }
    await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 30_000 });
    await expect.poll(() => phoneSees(front.origin, first)).toEqual({ state: 'done', status: 'ok' });
    // The status took the payload and the file.
    expect(await sessionRow(first)).toEqual({ status: 'ok', payload: null, fileId: null, delivered: true });
    await expect(page.getByTestId('done-live')).toHaveAttribute('data-n', '12');

    // Up and down through the front: the phone's PUT and the TV's GET of one blob, once each; the
    // TV asked the API for the file's URL with its token first.
    const put = blobRequests(front, 'PUT');
    const got = blobRequests(front, 'GET');
    expect(put).toEqual([{ method: 'PUT', path: expect.stringMatching(/^\/dev\/blob\/pair\/[\w-]{22}\/[\w-]{22}\?m=PUT&/), status: 200 }]);
    expect(got).toEqual([{ method: 'GET', path: expect.stringMatching(/^\/dev\/blob\/pair\/[\w-]{22}\/[\w-]{22}\?m=GET&/), status: 200 }]);
    expect(blobPath(got[0]!.path)).toBe(blobPath(put[0]!.path));
    expect(front.forwarded.filter((f) => f.method === 'GET' && /^\/v1\/pair\/s\/[\w-]+\/file$/.test(f.path))).toEqual([expect.objectContaining({ status: 200 })]);
    // The TV's own URL, still within its time, finds nothing: the status deleted the file.
    expect((await fetch(front.origin + got[0]!.path)).status).toBe(404);

    const kept = await storedProfile(page);
    expect(kept?.sources).toEqual([{ id: 's1', type: 'm3u-file', name: 'Phone file', added: expect.any(Number) }]);
    const added = kept?.sources[0]?.added;
    await remote.expectFocus('done/actions/0');
    await remote.press('OK');
    await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');

    // Settings › Sources › "Add from your phone": the changed file under the same name.
    await openSources(remote, 'en');
    await remote.expectFocus('sources/sources/0');
    await remote.go('UP', 'sources/header/0');
    await remote.go('OK', 'pair/actions/0');
    const second = await apiCode(page, front);
    await phoneSendsFile(front.origin, second, changed, { name: 'Phone file' });
    await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('pair-live')).toHaveAttribute('data-n', '3');
    await expect.poll(() => phoneSees(front.origin, second)).toEqual({ state: 'done', status: 'ok' });
    expect(await sessionRow(second)).toEqual({ status: 'ok', payload: null, fileId: null, delivered: true });
    await shoot(page, 'pair-api-file-done-en');
    const gets = blobRequests(front, 'GET').filter((f) => f.status === 200);
    expect(gets).toHaveLength(2);
    expect((await fetch(front.origin + gets[1]!.path)).status).toBe(404);

    // Replaced under its id: one source, the same id, name and date added.
    await remote.press('OK');
    await remote.expectFocus('sources/header/0');
    await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '1');
    expect((await storedProfile(page))?.sources).toEqual([{ id: 's1', type: 'm3u-file', name: 'Phone file', added }]);
    preflightsPassed(front);
    expect(errors).toEqual([]);
  });
});
