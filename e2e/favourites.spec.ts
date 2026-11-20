import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Catalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { stripIsolates } from '../packages/core/src/bidi';
import { catalog, ordered, rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Favourites lists in the live screen (RELAY step 35c), by keys: the info bar's star opens the
 * panel, "New list" makes a named list with the channel in it, a second channel joins it, the
 * rail shows the list after "All channels" with its channels numbered 1, 2, and number entry and
 * CH± in it use those numbers. The list keeps its channels through a refresh where the panel
 * renumbered every stream (the mock's ids all moved: the ingest re-matches them by name).
 *
 * "All channels" lists the mock's channels category by category (`ordered`).
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

interface Mock {
  readonly app: MockServer;
  readonly host: string;
  readonly requests: string[];
}

async function startMock(): Promise<Mock> {
  const app = await mock({ now: () => Date.now() });
  const requests: string[] = [];
  app.addHook('onRequest', async (request) => {
    requests.push(request.url);
  });
  const host = (await listen(app)).replace(/^http:\/\//, '');
  return { app, host, requests };
}

/** The mock's catalog with every id moved by `by`: a provider that renumbered its streams. */
function renumbered(c: Catalog, by: number): Catalog {
  return { ...c, live: c.live.map((x) => ({ ...x, id: x.id + by })), movies: c.movies.map((x) => ({ ...x, id: x.id + by })) };
}

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).textContent()) ?? '');
}

async function expectInSafeArea(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(SAFE.left);
  expect(box!.y).toBeGreaterThanOrEqual(SAFE.top);
  expect(box!.x + box!.width).toBeLessThanOrEqual(SAFE.right);
  expect(box!.y + box!.height).toBeLessThanOrEqual(SAFE.bottom);
}

/**
 * Text of ours outside brackets under `selector` in en-XA (the provider's and the user's text is
 * `translate="no"`), and names of icons that aren't bracketed.
 */
function untranslated(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (root === null) return [`no ${sel}`];
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(value) || node.parentElement?.closest('[translate="no"]') != null) continue;
      if (/^(· )?\d{1,2}:\d{2} [AP]M( – \d{1,2}:\d{2} [AP]M)?$/.test(value)) continue;
      if (!(value.startsWith('[') && value.endsWith(']'))) out.push(value);
    }
    for (const el of Array.from(root.querySelectorAll('[aria-label]'))) {
      const name = (el.getAttribute('aria-label') ?? '').trim();
      if (!(name.startsWith('[') && name.endsWith(']'))) out.push(`aria-label: ${name}`);
    }
    return out;
  }, selector);
}

/** From the live list's row 1, the player, then the info bar's star (its last button). */
async function toStar(remote: RemoteDriver, next: 'LEFT' | 'RIGHT'): Promise<void> {
  await remote.go('DOWN', 'live/channels/1');
  await remote.press('OK');
  await remote.expectFocus('player/actions/0');
  for (let i = 1; i <= 4; i += 1) await remote.go(next, `player/actions/${i}`);
}

for (const locale of ['en-US', 'ar-SA'] as const) {
  const ar = locale === 'ar-SA';
  const words = ar ? AR : EN;
  const tag = ar ? 'ar' : 'en';
  /** The new list's name, typed on the keyboard. */
  const named = ar ? 'رياضة' : 'Sport';

  test(`makes a list from the info bar's star, shows it in the rail and zaps in it by its numbers, in ${locale}`, async ({ page }) => {
    const errors = trackErrors(page);
    const m = await startMock();
    try {
      await page.clock.install();
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host: m.host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      const next = ar ? 'LEFT' : 'RIGHT';
      const player = page.getByTestId('player');

      await test.step('the star opens the panel: "Favourites" to make, then "New list"', async () => {
        await toStar(remote, next);
        expect(await text(page, 'player-favourite')).toBe(words['player.favourites']);
        await expect(player).toHaveAttribute('data-favourite', 'false');
        await remote.press('OK');
        await remote.expectFocus('favourites/lists/0');
        await expect(player).toHaveAttribute('data-favourites', 'true');
        await expect(page.getByTestId('player-bar')).toHaveCount(0);
        expect(await text(page, 'favourites-list-0')).toBe(words['category.favourites']);
        await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'false');
        expect(await text(page, 'favourites-new')).toBe(words['favourites.new']);
        expect(stripIsolates((await page.getByTestId('favourites').locator('h2').textContent()) ?? '')).toBe(words['favourites.title']);
        await expectInSafeArea(page.getByTestId('favourites'));
        await page.screenshot({ path: path.join(SHOTS, `favourites-panel-${tag}.png`), animations: 'disabled' });
      });

      await test.step('"New list" makes a named list with the channel in it', async () => {
        await remote.go('DOWN', 'favourites/lists/1');
        await remote.press('OK');
        await remote.expectFocus('favourite-new/field/0');
        expect(await text(page, 'favourite-new-create')).toBe(words['favourites.create']);
        await remote.press('OK');
        await expect(player).toHaveAttribute('data-editing', 'favourite-name');
        await page.keyboard.type(named);
        await remote.press('OK');
        await expect(player).toHaveAttribute('data-editing', '');
        await remote.expectFocus('favourite-new/actions/0');
        await page.screenshot({ path: path.join(SHOTS, `favourites-new-${tag}.png`), animations: 'disabled' });
        await remote.press('OK');
        await remote.expectFocus('favourites/lists/0');
        await expect(page.getByTestId('favourites')).toHaveAttribute('data-pending', '0');
        expect(await text(page, 'favourites-list-0')).toBe(named);
        await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'true');
        await remote.press('BACK');
        await remote.expectFocus('player/actions/4');
        await expect(player).toHaveAttribute('data-favourite', 'true');
        await page.screenshot({ path: path.join(SHOTS, `player-star-${tag}.png`), animations: 'disabled' });
      });

      await test.step('the next channel joins the list from its own info bar', async () => {
        await remote.press('CH_UP');
        await expect(player).toHaveAttribute('data-playing', '2');
        await expect(player).toHaveAttribute('data-favourite', 'false');
        await remote.press('OK');
        await remote.expectFocus('favourites/lists/0');
        await remote.press('OK');
        await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'true');
        await remote.press('BACK');
        await expect(player).toHaveAttribute('data-favourite', 'true');
        await remote.press('BACK');
        await remote.expectFocus('live/channels/2');
      });

      await test.step('the rail has the list after "All channels", its channels numbered 1 and 2', async () => {
        await remote.go('BACK', 'live/rail/0');
        await remote.go('DOWN', 'live/rail/1');
        expect(await text(page, 'chip-1')).toContain(named);
        await remote.press('OK');
        await expect(live).toHaveAttribute('data-category', '1');
        await settled(live);
        await expect.poll(async () => (await rows(page)).map((r) => [r.number, r.name])).toEqual([
          ['1', ordered[1]!.name],
          ['2', ordered[2]!.name],
        ]);
        expect(await text(page, 'live-meta')).toContain(named);
        await expect(page.getByTestId('live-meta').locator('[data-n]')).toHaveAttribute('data-n', '2');
        await page.screenshot({ path: path.join(SHOTS, `live-list-${tag}.png`), animations: 'disabled' });
      });

      await test.step('number entry and CH± in the list use its own numbers', async () => {
        await remote.expectFocus('live/channels/0');
        await remote.press('OK');
        await expect(player).toHaveAttribute('data-playing', '0');
        expect(await text(page, 'player-number')).toBe('1');
        await remote.press('DIGIT_2');
        await expect(player).toHaveAttribute('data-playing', '1', { timeout: 5_000 });
        expect(await text(page, 'player-number')).toBe('2');
        expect(await text(page, 'player-name')).toBe(ordered[2]!.name);
        // Past the list's end: back to its first channel.
        await remote.press('CH_UP');
        await expect(player).toHaveAttribute('data-playing', '0');
        expect(await text(page, 'player-name')).toBe(ordered[1]!.name);
        await remote.press('BACK');
        await remote.expectFocus('live/channels/0');
      });

      if (!ar) {
        await test.step('the list keeps its channels through a refresh where the panel renumbered every stream', async () => {
          const before = m.requests.filter((url) => url.indexOf('action=get_live_streams') !== -1).length;
          m.app.mockState.catalog = renumbered(catalog, 1000);
          await page.clock.fastForward('12:30:00');
          await expect.poll(() => m.requests.filter((url) => url.indexOf('action=get_live_streams') !== -1).length, { timeout: 20_000 }).toBe(before + 1);
          await settled(live, 20_000);
          await expect(live).toHaveAttribute('data-category', '1');
          await expect.poll(async () => (await rows(page)).map((r) => [r.number, r.name]), { timeout: 10_000 }).toEqual([
            ['1', ordered[1]!.name],
            ['2', ordered[2]!.name],
          ]);
          // The list plays the renumbered streams.
          await remote.press('OK');
          await remote.press('DIGIT_2');
          await expect(player).toHaveAttribute('data-playing', '1', { timeout: 5_000 });
          expect(await text(page, 'player-name')).toBe(ordered[2]!.name);
          // Its new stream id: the list holds the re-matched key.
          await expect.poll(() => m.requests.some((url) => url.indexOf(`/${ordered[2]!.id + 1000}.`) !== -1)).toBe(true);
          await remote.press('BACK');
        });
      }
      expect(errors).toEqual([]);
    } finally {
      await m.app.close();
    }
  });
}

test('shows only our strings, bracketed, in the panel, the form and the rail, in the pseudo-locale (en-XA)', async ({ page }) => {
  const errors = trackErrors(page);
  const m = await startMock();
  try {
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host: m.host, username: U, password: P }, 'locale=en-XA');
    await settled(live);
    await toStar(remote, 'RIGHT');
    const player = page.getByTestId('player');
    expect(await untranslated(page, '[data-testid=player-bar]')).toEqual([]);
    await remote.press('OK');
    await remote.expectFocus('favourites/lists/0');
    expect(await untranslated(page, '[data-testid=favourites]')).toEqual([]);
    // "Favourites" made at once, with the channel in it.
    await remote.press('OK');
    await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'true');
    await remote.go('DOWN', 'favourites/lists/1');
    await remote.press('OK');
    await remote.expectFocus('favourite-new/field/0');
    expect(await untranslated(page, '[data-testid=favourite-new]')).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'favourites-new-en-XA.png'), animations: 'disabled' });
    await remote.press('BACK', 'BACK');
    await expect(player).toHaveAttribute('data-favourite', 'true');
    expect(await untranslated(page, '[data-testid=player-bar]')).toEqual([]);
    await remote.press('BACK');
    await remote.go('BACK', 'live/rail/0');
    await remote.go('DOWN', 'live/rail/1');
    await remote.press('OK');
    await settled(live);
    expect(await untranslated(page, '[data-testid=live]')).toEqual([]);
    expect(await text(page, 'chip-1')).toMatch(/^\[.+\]1$/u);
    await page.screenshot({ path: path.join(SHOTS, 'live-list-en-XA.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
  } finally {
    await m.app.close();
  }
});
