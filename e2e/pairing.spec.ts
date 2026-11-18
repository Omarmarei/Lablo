import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import type { PairPayload } from '../packages/protocol/src/pairing';
import { devSignedAnswer } from '../tools/engines/src/config';
import { phoneSees, phoneSends } from '../tools/engines/src/pair-phone';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addXtreamAndWatch, toSourceTypes, trackErrors } from './onboard';
import { SHOTS, openSources, shoot, shownCode, storedProfile } from './pairing-steps';
import { RemoteDriver } from './remote-driver';

/**
 * The TV's pairing screen (RELAY step 31c2a) against a stand-in pairing API on the test's config
 * origin (`?api=`, tools/engines/src/pair-stand-in.ts) and a scripted phone in this process
 * (tools/engines/src/pair-phone.ts: the typed-code path, the payload sealed here):
 * - onboarding's "Use your phone": an M3U link from the mock with two guide links (one given
 *   twice), held in its guide phase: `ok` reaches the phone before the load ends; then the done
 *   screen, the source and one guide kept, and nothing of the source on the stand-in;
 * - Settings › Sources › "Add from your phone", in Arabic: a wrong password gives `auth_failed`
 *   and keeps nothing; "Show a new code", an M3U link, the done view, and Sources lists both;
 * - a code that ends is renewed; the config's `block-new-sources` refuses the phone's source
 *   (`blocked`), and nothing is kept.
 * Screenshots in English and Arabic go to artifacts/screenshots.
 */

const NO_NEW = { en: 'Adding sources is paused for maintenance.', ar: 'إضافة المصادر متوقفة مؤقتًا للصيانة.' };
const blockNew = { id: 'no-new', match: {}, mode: 'block-new-sources', message: NO_NEW };

let app: MockServer;
let host: string;
/** Holds the mock's guide downloads while set. */
let guideGate: Promise<void> | null = null;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  app.addHook('onRequest', async (request) => {
    if (guideGate !== null && request.url.indexOf('/xmltv.php') !== -1) await guideGate;
  });
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

/** The links as the phone page sends them: normalized, with their scheme (the payload's schema wants one). */
const m3uLink = (): string => `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`;
const guideLink = (): string => `http://${host}/xmltv.php?username=${U}&password=${P}`;

/** The code on show, once the TV has polled for it at least once; checked against the stand-in. */
async function codeOnShow(page: Page, server: ConfigServer): Promise<string> {
  const code = await shownCode(page);
  expect(code).toBe(server.pair.latest()?.code);
  await expect.poll(() => server.pair.latest()?.polls ?? 0).toBeGreaterThan(0);
  return code;
}

/** Nothing of the source reached the stand-in: its sessions hold keys, codes and ciphertext only. */
function nothingInTheClear(server: ConfigServer, secrets: readonly string[]): void {
  const kept = JSON.stringify(server.pair.sessions);
  for (const secret of secrets) expect(kept).not.toContain(secret);
}

test('onboarding by phone: an M3U link and its guides are added, ok reaches the phone during the guide, nothing in the clear on the server', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    const onboarding = await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await remote.go('DOWN', 'source/types/1');
    await remote.go('DOWN', 'source/types/2');
    await expect(page.getByTestId('type-phone')).toHaveText('Use your phone');
    await expect(page.getByTestId('type-hint')).toHaveText('Scan a code on this screen, then type the details on your phone');
    await remote.go('OK', 'pair/actions/0');
    const code = await codeOnShow(page, server);
    await expect(page.getByTestId('pair-address')).toHaveText(`${server.origin.replace(/^http:\/\//, '')}/p`);
    const qr = page.getByTestId('pair-qr');
    await expect(qr).toHaveAttribute('data-version', '5');
    await expect(qr).toHaveAttribute('data-size', '37');
    // Whole pixels per module: 45 modules (with the quiet zone) of 10 px.
    expect(await qr.boundingBox()).toMatchObject({ width: 450, height: 450 });
    await expect(page.getByTestId('pair-state')).toHaveText('Waiting for your phone…');
    await shoot(page, 'pair-code-en');

    // The phone sends; the guide is held, so the load stays in its guide phase for a look.
    let open: () => void = () => undefined;
    guideGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const payload: PairPayload = { v: 1, source: { type: 'm3u', url: m3uLink() }, name: 'Phone list', epg: [guideLink(), guideLink().replace('http://', 'HTTP://')] };
    await phoneSends(server.origin, code, payload);
    await expect(page.getByTestId('pair')).toHaveAttribute('data-view', 'loading', { timeout: 10_000 });
    await expect(page.getByTestId('pair-load')).toHaveAttribute('data-phase', 'guide', { timeout: 20_000 });
    expect(stripIsolates((await page.getByTestId('pair-title').textContent()) ?? '')).toBe('Adding Phone list');
    // The catalog is saved: the phone hears ok before the guide is read.
    await expect.poll(() => phoneSees(server.origin, code)).toEqual({ state: 'done', status: 'ok' });
    await expect(page.getByTestId('pair')).toHaveAttribute('data-sent', 'ok');
    await shoot(page, 'pair-loading-en');
    guideGate = null;
    open();

    await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
    await remote.expectFocus('done/actions/0');
    await expect(page.getByTestId('done-live')).not.toHaveAttribute('data-n', '0');
    const kept = await storedProfile(page);
    expect(kept?.sources).toEqual([expect.objectContaining({ id: 's1', type: 'm3u', name: 'Phone list', url: m3uLink() })]);
    // The same guide given twice (its scheme in capitals the second time) is kept once, named after the source.
    expect(kept?.guides).toEqual([{ id: 's1', url: guideLink() }]);
    nothingInTheClear(server, [U, P, 'Phone list', 'get.php', 'xmltv.php']);
    expect(server.pair.sessions).toHaveLength(1);
    expect(server.pair.latest()?.status).toBe('ok');

    await remote.press('OK');
    const live = page.getByTestId('live');
    await expect(live).toHaveAttribute('data-status', 'ready');
    expect(errors).toEqual([]);
  });
});

test('from Settings in Arabic: a wrong password sends auth_failed and keeps nothing; a new code adds a second source', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=ar-SA&api=${encodeURIComponent(server.origin)}`);
    await openSources(remote, 'ar');
    await remote.expectFocus('sources/sources/0');
    await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '1');
    await remote.go('UP', 'sources/header/0');
    await expect(page.getByTestId('sources-add-phone')).toHaveText('أضف من هاتفك');
    await shoot(page, 'pair-sources-ar');
    await remote.go('OK', 'pair/actions/0');
    const first = await codeOnShow(page, server);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('pair-title')).toHaveText('أضف مصدرًا من هاتفك');
    // Mirrored layout, unmirrored code: the QR on the left, the steps on the right; the code reads left to right.
    const qrBox = (await page.getByTestId('pair-qr').boundingBox())!;
    const codeBox = (await page.getByTestId('pair-code').boundingBox())!;
    expect(qrBox.x + qrBox.width).toBeLessThan(codeBox.x);
    await expect(page.getByTestId('pair-code')).toHaveAttribute('dir', 'ltr');
    expect(await page.getByTestId('pair-qr').evaluate((svg) => getComputedStyle(svg).transform)).toBe('none');
    await shoot(page, 'pair-code-ar');

    await phoneSends(server.origin, first, { v: 1, source: { type: 'xtream', server: `http://${host}`, username: U, password: 'wrong-password' }, name: 'Wrong' });
    const pair = page.getByTestId('pair');
    await expect(pair).toHaveAttribute('data-view', 'failed', { timeout: 20_000 });
    await expect(page.getByTestId('pair-error')).toHaveAttribute('data-code', 'auth');
    await expect(page.getByTestId('pair-error')).toHaveText('لم يقبل مزوّد الخدمة اسم المستخدم وكلمة المرور هذين.');
    expect(stripIsolates((await page.getByTestId('pair-title').textContent()) ?? '')).toBe('تعذّرت إضافة Wrong');
    await expect.poll(() => phoneSees(server.origin, first)).toEqual({ state: 'done', status: 'auth_failed' });
    await remote.expectFocus('pair/actions/0');
    await expect(page.getByTestId('pair-action-0')).toHaveText('اعرض رمزًا جديدًا');
    await shoot(page, 'pair-failed-ar');
    expect((await storedProfile(page))?.sources.map((s) => s.id)).toEqual(['s1']);

    // "Show a new code": a second session; an M3U link this time.
    await remote.press('OK');
    const second = await codeOnShow(page, server);
    expect(second).not.toBe(first);
    await phoneSends(server.origin, second, { v: 1, source: { type: 'm3u', url: m3uLink() }, name: 'قائمة الهاتف' });
    await expect(pair).toHaveAttribute('data-view', 'done', { timeout: 20_000 });
    await expect.poll(() => phoneSees(server.origin, second)).toEqual({ state: 'done', status: 'ok' });
    await expect(page.getByTestId('pair-title')).toHaveText('كل شيء جاهز');
    await expect(page.getByTestId('pair-live')).not.toHaveAttribute('data-n', '0');
    await remote.expectFocus('pair/actions/0');
    await shoot(page, 'pair-done-ar');
    nothingInTheClear(server, [U, P, 'wrong-password', 'get.php']);

    // Done: Sources again, read again with both.
    await remote.press('OK');
    await remote.expectFocus('sources/header/0');
    await expect(page.getByTestId('sources')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('source-1-name')).toHaveText('قائمة الهاتف');
    expect((await storedProfile(page))?.sources.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(errors).toEqual([]);
  });
});

test('a code that ends is renewed; the config refusing new sources sends blocked, and nothing is kept', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  await withServer(devSignedAnswer(doc()), async (server) => {
    await toSourceTypes(remote, `locale=en-US&api=${encodeURIComponent(server.origin)}`);
    await remote.go('DOWN', 'source/types/1');
    await remote.go('DOWN', 'source/types/2');
    await remote.go('OK', 'pair/actions/0');
    const first = await codeOnShow(page, server);

    // The code ends on the server: the next poll's 410 brings a new one.
    server.pair.expire(first);
    await expect(page.getByTestId('pair')).not.toHaveAttribute('data-code', first, { timeout: 10_000 });
    const second = await codeOnShow(page, server);
    expect(server.pair.sessions.map((s) => s.code)).toEqual([first, second]);
    await expect(page.getByTestId('pair-state')).toHaveText('Waiting for your phone…');

    // The config now refuses new sources: the phone's source is refused before it loads.
    server.serve(devSignedAnswer(doc({ kill: [blockNew] }, Date.now() + 1_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({ status: 'fresh' });
    await phoneSends(server.origin, second, { v: 1, source: { type: 'm3u', url: m3uLink() } });
    const pair = page.getByTestId('pair');
    await expect(pair).toHaveAttribute('data-view', 'refused', { timeout: 10_000 });
    await expect(page.getByTestId('pair-error')).toHaveAttribute('data-code', 'refused');
    await expect(page.getByTestId('pair-error')).toHaveText(NO_NEW.en);
    await expect.poll(() => phoneSees(server.origin, second)).toEqual({ state: 'done', status: 'blocked' });
    await expect(page.getByTestId('pair-action-1')).toHaveText('Try again');
    await shoot(page, 'pair-refused-en');
    expect(await storedProfile(page)).toEqual({ sources: [], guides: [] });

    // Back: onboarding's source screen again.
    await remote.go('BACK', 'source/types/2');
    expect(errors).toEqual([]);
  });
});
