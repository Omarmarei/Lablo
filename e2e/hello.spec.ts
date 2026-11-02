import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';

/** Fails the test on any uncaught page error or console error. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test.describe('hello app in the desktop browser (pnpm dev)', () => {
  test('shows device info and the worker round trip', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');

    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('platform-id')).toHaveText('browser');
    await expect(page.getByTestId('info-platform')).toHaveText('browser');
    await expect(page.getByTestId('info-model')).toHaveText('Desktop browser');
    await expect(page.getByTestId('info-tier')).toHaveText('full');
    await expect(page.getByTestId('info-chromiumVersion')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('worker-status')).toHaveText(/^ok in \d+ ms \(.*TextDecoder.*indexedDB.*\)$/);
    await expect(page.getByTestId('idb-status')).toHaveText('ok');
    // The data workers started: the query worker answers, and the start-up prune ran.
    await expect(page.getByTestId('data-status')).toHaveText('ok: 0 sources, 0 items');
    await expect(page.getByTestId('ingest-status')).toHaveText(/^none: /);
    await expect(page.getByTestId('search-status')).toHaveText(/^none: /);
    expect(errors).toEqual([]);
  });

  test('maps the keyboard to remote Intents', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page.getByTestId('hello')).toHaveAttribute('data-ready', 'true');
    const lastIntent = page.getByTestId('last-intent');
    await expect(lastIntent).toHaveText('Press a key');

    const presses: Array<[key: string, intent: string]> = [
      ['ArrowDown', 'DOWN'],
      ['ArrowRight', 'RIGHT'],
      ['Enter', 'OK'],
      ['PageUp', 'CH_UP'],
      ['7', 'DIGIT_7'],
      ['F1', 'RED'],
      ['F4', 'BLUE'],
      [' ', 'PLAY_PAUSE'],
      ['i', 'INFO'],
      ['g', 'GUIDE'],
    ];
    for (const [key, intent] of presses) {
      await page.keyboard.press(key === ' ' ? 'Space' : key);
      await expect(lastIntent).toHaveText(intent);
    }
    await expect(page.getByTestId('key-count')).toHaveText(String(presses.length));

    // Unmapped keys change nothing.
    await page.keyboard.press('a');
    await expect(page.getByTestId('key-count')).toHaveText(String(presses.length));

    // Back at the root asks the platform to exit (a no-op in the browser).
    await expect(page.getByTestId('exit-requested')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(lastIntent).toHaveText('BACK');
    await expect(page.getByTestId('exit-requested')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('honours the forced low tier and locale overrides', async ({ page }) => {
    await page.goto('/?tier=low&locale=ar-SA&country=SA');
    await expect(page.getByTestId('info-tier')).toHaveText('low');
    await expect(page.getByTestId('info-locale')).toHaveText('ar-SA');
    await expect(page.getByTestId('info-country')).toHaveText('SA');
  });
});

test.describe('catalog panel in the desktop browser (pnpm dev)', () => {
  let app: MockServer;
  let base: string;

  test.beforeAll(async () => {
    app = await mock();
    base = await listen(app);
  });
  test.afterAll(async () => {
    await app.close();
  });

  test('refreshes the playlist given with ?source= in the data workers and searches it', async ({ page }) => {
    const errors = trackErrors(page);
    const playlist = `${base}/get.php?username=${U}&password=${P}&type=m3u_plus`;
    const body = await (await fetch(playlist)).text();
    const entries = body.split(/\r?\n/).filter((line) => line.startsWith('#EXTINF')).length;
    expect(entries).toBeGreaterThan(10);

    // The playlist URL is pasted as it is: `source` is the last parameter.
    await page.goto(`/?q=sports&source=${playlist}`);
    const ingest = page.getByTestId('ingest-status');
    await expect(ingest).toHaveText(new RegExp(`^ok: committed gen 1, ${entries} items [(]live [0-9]+`), { timeout: 20_000 });
    await expect(ingest).toHaveAttribute('data-items', String(entries));
    await expect(page.getByTestId('data-status')).toHaveText(`ok: 1 source, ${entries} items`);
    const search = page.getByTestId('search-status');
    await expect(search).toHaveText(/^ok: 2 for "sports": Zoma Sports Test F?HD, Zoma Sports Test F?HD$/);
    await expect(search).toHaveAttribute('data-total', '2');
    // Then the guide the playlist header names, in an EPG worker. The match rate doesn't depend
    // on the clock (the mock's schedule is pinned to its own day, the browser's isn't).
    const guide = page.getByTestId('epg-status');
    await expect(guide).toHaveText('ok: 11 of 12 live channels have a guide (91.7%), 1 guide', { timeout: 20_000 });
    await expect(guide).toHaveAttribute('data-matched', '11');
    await expect(page.getByTestId('nownext-status')).toHaveText(/^(ok: Zoma Sports Test F?HD: |none: )/);
    // The one live channel no guide matches, focused for 600 ms: its panel's short EPG is asked,
    // and has nothing for it either (it has no EPG id).
    const panelEpg = page.getByTestId('shortepg-status');
    await expect(panelEpg).toHaveText('none: 18+ Test Pattern: the panel has no programmes for it now', { timeout: 20_000 });
    await expect(panelEpg).toHaveAttribute('data-from', 'panel');

    // A remote key marks the UI busy (a running refresh would pause), then idle again.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('busy-status')).toHaveText('busy (refresh paused)');
    await expect(page.getByTestId('busy-status')).toHaveText('idle');

    // Without a source, the stored catalog is searched; the same playlist again is a 304.
    await page.goto('/?q=sports');
    await expect(page.getByTestId('data-status')).toHaveText(`ok: 1 source, ${entries} items`);
    await expect(search).toHaveAttribute('data-total', '2');
    await expect(guide).toHaveAttribute('data-matched', '11');
    await expect(panelEpg).toHaveText("none: needs ?source=<an Xtream panel's get.php URL>");
    await page.goto(`/?source=${encodeURIComponent(playlist)}`);
    await expect(ingest).toHaveText(new RegExp(`^ok: unchanged gen 1, ${entries} items`), { timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test('falls back to the short EPG of a panel whose guide is off', async ({ page }) => {
    const errors = trackErrors(page);
    const noGuide = await mock({ scenario: 'no-xmltv' });
    try {
      const playlist = `${await listen(noGuide)}/get.php?username=${U}&password=${P}&type=m3u_plus`;
      await page.goto(`/?source=${playlist}`);
      await expect(page.getByTestId('epg-status')).toHaveText('failed: debug:tvg0 http', { timeout: 20_000 });
      const panelEpg = page.getByTestId('shortepg-status');
      await expect(panelEpg).toHaveAttribute('data-from', 'panel', { timeout: 20_000 });
      // The mock's schedule is pinned to its own day and the browser's clock isn't, so the text
      // depends on the clock (packages/data and test/short-epg-mock.test.ts check it exactly).
      await expect(panelEpg).toHaveText(/^(ok: Zoma Test 1 SMPTE: .+ [(]panel[)]|none: Zoma Test 1 SMPTE: the panel has no programmes for it now)$/);
      expect(errors).toEqual([]);
    } finally {
      await noGuide.close();
    }
  });
});
