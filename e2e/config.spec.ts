import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { CONFIG_PROBES, HARNESS_NOTICE, devSignedAnswer, harnessConfigDoc } from '../tools/engines/src/config';
import { trackErrors } from './onboard';

/**
 * The signed config reaching the app (RELAY step 30c1): a test server on 127.0.0.1 answers
 * `GET /v1/config` the way apps/web does, with a config signed by the dev key (the dev app trusts
 * it), and `?api=` points the app at it. The policy is read through the test hook
 * (`window.__LABLO_TEST__.config()`), and `refreshConfig()` runs the schedule now, so a changed
 * config arrives without waiting 6 h. Step 30c2 enforces what arrives.
 */

interface ConfigServer {
  readonly origin: string;
  /** Requests for `/v1/config` so far. */
  requests(): number;
  /** What the next request gets: an answer's exact text. */
  serve(answer: string): void;
  close(): Promise<void>;
}

async function startConfigServer(answer: string): Promise<ConfigServer> {
  let body = answer;
  let requests = 0;
  const server: Server = createServer((request, response) => {
    // The app's config worker fetches cross-origin (the dev app is on localhost:<port>).
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (request.method === 'GET' && request.url === '/v1/config') {
      requests += 1;
      response.writeHead(200, { ...headers, 'content-type': 'application/json' });
      response.end(body);
      return;
    }
    response.writeHead(404, headers);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests: () => requests,
    serve: (next) => {
      body = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A config doc dated around now, with `fields` in place of the harness doc's (no kill rule, one notice, two blocked hosts). */
function doc(fields: Record<string, unknown> = {}, now = Date.now()): Record<string, unknown> {
  return { ...harnessConfigDoc(now), ...fields };
}

test('a served config reaches the app, and a changed one arrives with refreshConfig()', async ({ page }) => {
  const errors = trackErrors(page);
  const issued = Date.now();
  const server = await startConfigServer(devSignedAnswer(doc({ kill: [{ id: 'welcome', match: {}, mode: 'notice' }] }, issued)));
  try {
    await page.goto(`/?api=${encodeURIComponent(server.origin)}`);
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-ready', 'true');
    // The first run, after the first paint: the doc verified and kept, its notice in the policy.
    await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config() ?? null)).toMatchObject({ status: 'fresh' });
    expect(await page.evaluate(() => window.__LABLO_TEST__?.config() ?? null)).toEqual({
      status: 'fresh',
      failure: null,
      issuedAt: issued - 60_000,
      kill: null,
      notices: ['welcome'],
      updateRequired: false,
    });
    expect(server.requests()).toBe(1);

    // The operator signs a kill rule: it arrives with the next run, no restart.
    server.serve(devSignedAnswer(doc({ kill: [{ id: 'stop-play', match: {}, mode: 'disable-playback' }] }, issued + 1_000)));
    const next = await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig());
    expect(next).toEqual({
      status: 'fresh',
      failure: null,
      issuedAt: issued + 1_000 - 60_000,
      kill: { id: 'stop-play', mode: 'disable-playback' },
      notices: [],
      updateRequired: false,
    });
    expect(await page.evaluate(() => window.__LABLO_TEST__?.config() ?? null)).toEqual(next);
    expect(server.requests()).toBe(2);

    // An older doc (a replay) is refused: the newer one stays in force.
    server.serve(devSignedAnswer(doc({}, issued - 3_600_000)));
    expect(await page.evaluate(() => window.__LABLO_TEST__!.refreshConfig())).toMatchObject({
      status: 'cached',
      failure: 'older',
      kill: { id: 'stop-play', mode: 'disable-playback' },
    });
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});

test('the hello screen verifies the served config and asks the blocklist about three URLs', async ({ page }) => {
  const errors = trackErrors(page);
  const server = await startConfigServer(devSignedAnswer(doc()));
  try {
    const checks = CONFIG_PROBES.map((probe) => `&check=${encodeURIComponent(probe.url)}`).join('');
    await page.goto(`/?screen=hello&api=${encodeURIComponent(server.origin)}${checks}`);
    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    const config = page.getByTestId('config-status');
    await expect(config).toHaveAttribute('data-status', 'fresh');
    await expect(config).toHaveAttribute('data-failure', '');
    await expect(config).toHaveAttribute('data-notices', HARNESS_NOTICE);
    await expect(config).toHaveText(/^ok: fresh, issued \d{4}-\d\d-\d\dT[\d:.]+Z, nothing killed, notices harness-notice$/);
    const blocked = page.getByTestId('blocked-status');
    await expect(blocked).toHaveAttribute('data-blocked', 'true,true,false');
    await expect(blocked).toHaveText('ok: blocked, blocked, allowed');
    // The developer screen runs no schedule: the hook has no config.
    expect(await page.evaluate(() => window.__LABLO_TEST__?.config() ?? null)).toBeNull();
    expect(server.requests()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});

test('a forged config is refused: the defaults stay, nothing blocked', async ({ page }) => {
  const errors = trackErrors(page);
  // The signed text changed after signing (a host taken off the list on the way).
  const answer = JSON.parse(devSignedAnswer(doc())) as { doc: string; sig: string; country: string };
  const forged = JSON.stringify({ ...answer, doc: answer.doc.replace(HARNESS_NOTICE, 'forged-notice') });
  const server = await startConfigServer(forged);
  try {
    const checks = CONFIG_PROBES.map((probe) => `&check=${encodeURIComponent(probe.url)}`).join('');
    await page.goto(`/?screen=hello&api=${encodeURIComponent(server.origin)}${checks}`);
    const config = page.getByTestId('config-status');
    await expect(config).toHaveAttribute('data-status', 'none');
    await expect(config).toHaveAttribute('data-failure', 'bad-signature');
    await expect(config).toHaveText('none: bad-signature (nothing killed, nothing blocked)');
    await expect(page.getByTestId('blocked-status')).toHaveAttribute('data-blocked', 'false,false,false');
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
