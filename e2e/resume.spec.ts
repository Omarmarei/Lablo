import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { addXtreamAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The start on the last channel (RELAY step 20c1, architecture.md §2 "Start on last channel"), by
 * keys without generated media (`pnpm e2e`): a channel played from a category is kept in the
 * profile; a relaunch opens the player on it at once and plays it before the live screen's
 * categories are read (the start's User Timing marks), shows the category it played from behind
 * it, finds its row there, zaps on from it, and Back lands on it.
 *
 * The placeholder streams never play on the desktop, so the plays are read from what the player
 * asked for (`data-playing`, `data-plays`) and the stream requests. "Test News", the rail's first
 * category, lists 101, 102, 110 and 111.
 */

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).textContent()) ?? '');
}

/** The profile's last channel as the app stored it (`null`: none yet), read from IndexedDB. */
function storedLast(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('profile', 'readonly').objectStore('profile').get('current');
          get.onerror = () => {
            db.close();
            resolve(null);
          };
          get.onsuccess = () => {
            db.close();
            const last = (get.result as { doc?: { player?: { last?: { item: { key: string; name: string }; number: number; index: number; category: unknown } | null } } } | undefined)?.doc?.player?.last;
            resolve(last ? { key: last.item.key, name: last.item.name, number: last.number, index: last.index, category: last.category } : null);
          };
        };
      }),
  );
}

/** When the start's marks were made (ms since the page's start; `null`: not made). */
function marks(page: Page): Promise<Record<string, number | null>> {
  return page.evaluate(() => {
    const at = (name: string): number | null => {
      const entry = performance.getEntriesByName(name)[0];
      return entry === undefined ? null : entry.startTime;
    };
    return { resume: at('lablo:resume'), liveReady: at('lablo:live-ready') };
  });
}

test('a relaunch plays the last channel before the catalog is read, finds its row, zaps on and lands on it', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  // A fresh profile keeps no channel: the first start shows the live screen.
  expect(await storedLast(page)).toBeNull();

  // "Test News", its third channel (stream 110), then CH+ to the fourth (111).
  await remote.go('LEFT', 'live/rail/0');
  await remote.go('DOWN', 'live/rail/1');
  await remote.press('OK');
  await remote.expectFocus('live/channels/0');
  await expect(live).toHaveAttribute('data-category', '1');
  await remote.go('DOWN', 'live/channels/1');
  await remote.go('DOWN', 'live/channels/2');
  await remote.press('OK');
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-playing', '2');
  await remote.press('CH_UP');
  await expect(player).toHaveAttribute('data-playing', '3');
  const name = await text(page, 'player-name');
  const number = await text(page, 'player-number');
  await expect.poll(() => storedLast(page)).toEqual({ key: expect.stringMatching(/:live:/), name, number: Number(number), index: 3, category: { src: 's1', name: 'Test News' } });

  // The relaunch: the player at once, on that channel, its stream asked for.
  const streams: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.host === host && url.pathname.indexOf('/live/') === 0) streams.push(url.pathname);
  });
  await page.reload();
  await remote.expectFocus('player/actions/0');
  expect(await text(page, 'player-name')).toBe(name);
  expect(await text(page, 'player-number')).toBe(number);
  await expect(player).toHaveAttribute('data-plays', '1');
  await expect.poll(() => streams.length).toBeGreaterThan(0);
  expect(streams[0]).toBe(`/live/${U}/${P}/111.ts`);
  // Played before the live screen's categories were read.
  await expect.poll(async () => (await marks(page)).liveReady).not.toBeNull();
  const made = await marks(page);
  expect(made.resume).not.toBeNull();
  expect(made.resume!).toBeLessThan(made.liveReady!);
  // Its row, found in the category it played from.
  await expect(player).toHaveAttribute('data-playing', '3');
  await expect(player).toHaveAttribute('data-target', '3');

  // Back lands on its row, in that category.
  await remote.press('BACK');
  await remote.expectFocus('live/channels/3');
  await expect(live).toHaveAttribute('data-category', '1');

  // Again from the list, then CH− to the third: the new last channel, kept for the next start.
  await remote.press('OK');
  await expect(player).toHaveAttribute('data-playing', '3');
  await remote.press('CH_DOWN');
  await expect(player).toHaveAttribute('data-playing', '2');
  const third = await text(page, 'player-name');
  await expect.poll(() => storedLast(page)).toMatchObject({ name: third, index: 2, category: { src: 's1', name: 'Test News' } });
  await page.reload();
  await remote.expectFocus('player/actions/0');
  expect(await text(page, 'player-name')).toBe(third);
  await expect(player).toHaveAttribute('data-playing', '2');
  // It zaps on from there once the list is in: CH+ to the fourth again.
  await remote.press('CH_UP');
  await expect(player).toHaveAttribute('data-playing', '3');
  expect(await text(page, 'player-name')).toBe(name);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
