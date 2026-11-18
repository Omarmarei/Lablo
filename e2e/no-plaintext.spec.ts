import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { devices, expect, test } from '@playwright/test';
import { fileCipherLength, fileFrameCount, sha256, toBase64Url, utf8 } from '@lablo/crypto';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { E2E_DATABASE, WEB, serverUrl, withDatabase } from '../apps/web/test/web-db';
import { phonePadded } from '../tools/engines/src/pair-phone';
import type { ApiFront } from './api-front';
import { startApiFront } from './api-front';
import { leaks } from './no-plaintext';
import { addXtreamAndWatch, toSourceTypes, trackErrors } from './onboard';
import { SHOTS, openSources, shownCode, storedProfile, usePhone } from './pairing-steps';
import { RemoteDriver } from './remote-driver';

/**
 * The "no plaintext" test, end to end (RELAY step 31e, step 31's own "Done when"): the real phone
 * page, the web app (`next start` and `lablo_e2e`), the TV app (its dev app) and the mock provider,
 * once for each source type. The phone page runs in a browser context of its own at a phone's
 * size, opened through the test front (e2e/api-front.ts), so every request it and the TV make is
 * seen on its way to the web app; it types the code the TV shows.
 *
 * What the web app received (each request's line, headers and body: `front.received`), every row of
 * every table it keeps (read while the TV's reads are held, so the posted payload is still in its
 * row, and again at the end) and its blobs (exactly the uploads' bodies) are searched for the
 * source's server, user name, password, links, name and, for a file, its lines (`leaks`: as text,
 * JSON-escaped, percent-encoded, and inside base64 runs). None may appear. A control: the TV keeps
 * the same secrets in the clear, so the search would find them.
 */

/** The real API (`next start`), as playwright.web.config.ts starts it. */
const API = `http://127.0.0.1:${Number(process.env.LABLO_WEB_E2E_PORT ?? 3101)}`;

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}
const pg = createRequire(path.join(WEB, 'package.json'))('pg') as { Client: new (config: { connectionString: string }) => PgClient };

async function withClient<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: withDatabase(serverUrl(), E2E_DATABASE) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Every row of every table in `lablo_e2e`'s public schema, one `<table> <row as JSON>` line each. */
async function everyRow(): Promise<string> {
  return withClient(async (client) => {
    const tables = await client.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1", []);
    expect(tables.rows.map((t) => t.name)).toContain('PairSession');
    const lines: string[] = [];
    for (const { name } of tables.rows) {
      const rows = await client.query<{ row: string }>(`SELECT row_to_json(t)::text AS "row" FROM "${name}" t`, []);
      for (const { row } of rows.rows) lines.push(`${name} ${row}`);
    }
    return lines.join('\n');
  });
}

/** Whether the session's row (found by its code's hash) holds a posted payload. */
async function payloadKept(code: string): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query<{ kept: boolean }>('SELECT "payload" IS NOT NULL AS "kept" FROM "PairSession" WHERE "codeHash" = $1', [toBase64Url(sha256(utf8(code)))]);
    return result.rows[0]?.kept ?? false;
  });
}

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

let fronts = 0;

async function withFront(run: (front: ApiFront) => Promise<void>): Promise<void> {
  fronts += 1;
  const front = await startApiFront({ upstream: API, address: `10.252.${test.info().workerIndex % 250}.${fronts % 250}` });
  try {
    await run(front);
  } finally {
    await front.close();
  }
}

const m3uLink = (): string => `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`;
const guideLink = (): string => `http://${host}/xmltv.php?username=${U}&password=${P}`;

interface Phone {
  readonly page: Page;
  /** The page's every request was to the front's origin. */
  onlyItsOrigin(): void;
  close(): Promise<void>;
}

/** The real phone page at a phone's size, in a context of its own, through the front; the TV's code typed. */
async function phoneTypes(browser: Browser, front: ApiFront, locale: string, code: string): Promise<Phone> {
  const context = await browser.newContext({ ...devices['Pixel 7'], locale });
  const page = await context.newPage();
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.goto(`${front.origin}/p`);
  await page.locator('#code').fill(code);
  await page.locator('#code').press('Enter');
  await expect(page.getByTestId('phone')).toHaveAttribute('data-view', 'form');
  return {
    page,
    onlyItsOrigin: () => {
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.filter((url) => new URL(url).origin !== front.origin)).toEqual([]);
    },
    close: () => context.close(),
  };
}

/**
 * "Send" on the phone page while the front holds the TV's reads of its session: once the payload is
 * in its row, every row is read; then the TV may read. The rows as they were.
 */
async function sendWhileHeld(front: ApiFront, phone: Phone, code: string): Promise<string> {
  let release: () => void = () => undefined;
  front.hold({
    method: 'GET',
    prefix: '/v1/pair/s/',
    until: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  try {
    await phone.page.getByTestId('send').click();
    await expect.poll(() => payloadKept(code), { timeout: 8_000 }).toBe(true);
    // The haystack holds what matters: the phone's payload.
    expect(front.received.filter((r) => r.method === 'POST' && r.path === `/v1/pair/${code}/payload`)).toHaveLength(1);
    return await everyRow();
  } finally {
    front.hold(null);
    release();
  }
}

/** The phone page's result: "Added", and `ok` from the TV, whose status the web app received. */
async function phoneAdded(phone: Phone, front: ApiFront): Promise<void> {
  await expect(phone.page.getByTestId('result')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  expect(front.received.some((r) => r.method === 'POST' && /^\/v1\/pair\/s\/[^/]+\/status$/.test(r.path))).toBe(true);
}

/**
 * None of `needles` in what the web app received so far (each request's line and headers as text,
 * its body as bytes: the uploads' bodies are its blobs) nor in the rows it kept. Run as soon as the
 * phone has sent (a leak is found even when it breaks the add), and again at the end.
 */
function nothingInTheClear(front: ApiFront, rows: readonly string[], needles: readonly string[]): void {
  for (const request of front.received) {
    expect(leaks(`${request.method} ${request.path}\n${JSON.stringify(request.headers)}`, needles), `${request.method} ${request.path}`).toEqual([]);
    expect(leaks(request.body, needles), `${request.method} ${request.path}: its body`).toEqual([]);
  }
  for (const dump of rows) expect(leaks(dump, needles), 'the rows').toEqual([]);
}

test('an Xtream login typed on the phone page reaches the TV, and nothing of it reaches the web app in the clear', async ({ page, browser }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const name = 'Living room secret';
  await withFront(async (front) => {
    const onboarding = await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(front.origin)}`);
    const code = await usePhone(remote);
    const phone = await phoneTypes(browser, front, 'en-US', code);
    await phone.page.locator('#server').fill(host);
    await phone.page.locator('#username').fill(U);
    await phone.page.locator('#password').fill(P);
    await phone.page.locator('#name').fill(name);
    const needles = [host, U, P, `http://${host}`, name];
    const held = await sendWhileHeld(front, phone, code);
    nothingInTheClear(front, [held], needles);
    await phoneAdded(phone, front);
    await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 30_000 });
    const after = await everyRow();

    // The control: the TV keeps the login in the clear.
    expect(leaks(JSON.stringify(await storedProfile(page)), needles)).toEqual(needles);
    nothingInTheClear(front, [held, after], needles);
    phone.onlyItsOrigin();
    await phone.close();
    expect(errors).toEqual([]);
  });
});

test('in Arabic, an M3U link and its guide link from Settings: nothing of them reaches the web app in the clear', async ({ page, browser }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const name = 'قائمة السطح السرية';
  await withFront(async (front) => {
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=ar-SA&api=${encodeURIComponent(front.origin)}`);
    await openSources(remote, 'ar');
    await remote.go('UP', 'sources/header/0');
    await remote.go('OK', 'pair/actions/0');
    const code = await shownCode(page);
    const phone = await phoneTypes(browser, front, 'ar-SA', code);
    await expect(phone.page.getByTestId('phone')).toHaveAttribute('dir', 'rtl');
    await phone.page.locator('input[name="source-type"][value="m3u"]').check();
    await phone.page.locator('#playlist').fill(m3uLink());
    await phone.page.locator('#epg0').fill(guideLink());
    await phone.page.locator('#name').fill(name);
    const needles = [host, U, P, m3uLink(), guideLink(), '/get.php?username=', '/xmltv.php?username=', name];
    const held = await sendWhileHeld(front, phone, code);
    nothingInTheClear(front, [held], needles);
    await phoneAdded(phone, front);
    await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'done', { timeout: 30_000 });
    await phone.page.screenshot({ path: path.join(SHOTS, 'no-plaintext-phone-done-ar.png') });
    const after = await everyRow();

    const kept = await storedProfile(page);
    expect(kept?.sources.map((s) => s.name)).toContain(name);
    expect(leaks(JSON.stringify(kept), needles)).toEqual(needles);
    nothingInTheClear(front, [held, after], needles);
    phone.onlyItsOrigin();
    await phone.close();
    expect(errors).toEqual([]);
  });
});

test('an M3U file of three frames chosen on the phone page: nothing of it reaches the web app in the clear', async ({ page, browser }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const name = 'Bedroom secret list';
  const answer = await fetch(m3uLink());
  expect(answer.status).toBe(200);
  const plain = phonePadded(await answer.text(), 3);
  expect(fileFrameCount(plain.length)).toBe(3);
  await withFront(async (front) => {
    const onboarding = await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(front.origin)}`);
    const code = await usePhone(remote);
    const phone = await phoneTypes(browser, front, 'en-US', code);
    await phone.page.locator('input[name="source-type"][value="file"]').check();
    await phone.page.locator('#file').setInputFiles({ name: 'hidden-provider-list.m3u', mimeType: 'audio/x-mpegurl', buffer: Buffer.from(plain) });
    await phone.page.locator('#name').fill(name);
    const lines = ['#EXTM3U', '#EXTINF', 'Lablo Test 1 SMPTE', 'group-title="Test News"', `/live/${U}/${P}/101.ts`, '#PAD'];
    const needles = [host, U, P, ...lines, name, 'hidden-provider-list'];
    // The control: the file holds its lines.
    expect(leaks(plain, needles)).toEqual([host, U, P, ...lines]);
    const held = await sendWhileHeld(front, phone, code);
    // The file went up as one PUT of its sealed length, before the payload.
    const puts = front.received.filter((r) => r.method === 'PUT' && r.path.startsWith('/dev/blob/pair/'));
    expect(puts.map((r) => r.body.length)).toEqual([fileCipherLength(plain.length)]);
    nothingInTheClear(front, [held], needles);
    await phoneAdded(phone, front);
    await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('done-live')).toHaveAttribute('data-n', '12');
    await phone.page.screenshot({ path: path.join(SHOTS, 'no-plaintext-phone-done-en.png') });
    const after = await everyRow();

    // The file came down to the TV once; its profile keeps the name.
    expect(front.received.filter((r) => r.method === 'GET' && r.path.startsWith('/dev/blob/pair/'))).toHaveLength(1);
    expect(leaks(JSON.stringify(await storedProfile(page)), [name])).toEqual([name]);
    nothingInTheClear(front, [held, after], needles);
    phone.onlyItsOrigin();
    await phone.close();
    expect(errors).toEqual([]);
  });
});
