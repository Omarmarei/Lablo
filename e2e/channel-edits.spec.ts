import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { readGrid } from './guide-grid';
import { rows } from './live-rows';
import { addM3uAndWatch, settled, trackErrors } from './onboard';
import { playlistOnly } from './playlist-only';
import { RemoteDriver } from './remote-driver';

/**
 * Channels the user changed (RELAY step 36b): the live screen with changes written to the profile
 * (step 36c's screens will make them), on the mock's M3U playlist, which gives no channel numbers,
 * so every channel is numbered by its place in the provider's list.
 *
 * The playlist's live channels by group, with their numbers: Test News (1 Lablo Test 1 SMPTE,
 * 2 "UK: Lablo Test 2 Clock" here, 3 Lablo Test FR - Mire, 4 Lablo Prueba ES - Carta de ajuste),
 * the Arabic group (5–7), Kids (8), Sports (9 Lablo Sports Test HD, 10 FHD), Radio (11), 18+ (12).
 *
 * The changes: SMPTE (Test News) renamed, FR hidden, ES numbered 77, Sports HD hidden and
 * numbered 90, and "Clean channel names" on (Clock's "UK: " goes). Checked: the rows (the hidden
 * ones gone, every other number where it was), the group's count, the info bar while zapping past
 * FR, number entry (77 in the list; 90 hidden, over the list; FR's old 3 finds nothing), the
 * guide's rows, and Sports HD played from the search over the list with its own number.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

/** The mock's catalog with Clock's name behind a country tag, as many playlists write them. */
function taggedCatalog(): ReturnType<typeof loadCatalog> {
  const base = loadCatalog();
  return { ...base, live: base.live.map((c) => (c.name === 'Lablo Test 2 Clock' ? { ...c, name: 'UK: Lablo Test 2 Clock' } : c)) };
}

async function startMock(): Promise<{ app: MockServer; link: string }> {
  // A playlist's own keys and names: the panel's API serves no lists (step 37a).
  const app = await mock({ now: () => Date.now(), catalog: taggedCatalog(), scenario: playlistOnly() });
  const host = (await listen(app)).replace(/^http:\/\//, '');
  return { app, link: `${host}/get.php?username=${U}&password=${P}&type=m3u_plus&output=m3u8` };
}

async function text(page: Page, testId: string): Promise<string> {
  return stripIsolates((await page.getByTestId(testId).textContent()) ?? '');
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** The rows on show as `number name`. */
async function shownRows(page: Page): Promise<string[]> {
  return (await rows(page)).map((r) => `${stripIsolates(r.number)} ${stripIsolates(r.name)}`);
}

/** No config run and no backup worker in the database. */
async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

interface StoredChannel {
  readonly key: string;
  readonly src: string;
  readonly name: string;
  readonly group: string;
  readonly normName: string;
  readonly epgId: string | null;
}

/** Every live channel the catalog stores, read from IndexedDB. */
function storedChannels(page: Page): Promise<StoredChannel[]> {
  return page.evaluate(
    () =>
      new Promise<StoredChannel[]>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('catalog_chunks', 'readonly');
          const out: StoredChannel[] = [];
          const req = tx.objectStore('catalog_chunks').openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor === null) return;
            if ((cursor.primaryKey as unknown[])[2] === 'live') {
              for (const it of (cursor.value as { items: StoredChannel[] }).items) out.push({ key: it.key, src: it.src, name: it.name, group: it.group, normName: it.normName, epgId: it.epgId });
            }
            cursor.continue();
          };
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/** Writes `fields` into the stored profile document. */
function editProfile(page: Page, fields: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    (changes) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('profile', 'readwrite');
          const store = tx.objectStore('profile');
          const req = store.get('current');
          req.onsuccess = () => {
            const record = req.result as { doc: Record<string, unknown> };
            for (const name of Object.keys(changes)) record.doc[name] = changes[name];
            store.put(record);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    fields,
  );
}

for (const locale of ['en-US', 'ar-SA'] as const) {
  const ar = locale === 'ar-SA';
  const tag = ar ? 'ar' : 'en';
  /** SMPTE's new name. */
  const renamed = ar ? 'قناتي' : 'My SMPTE';

  test(`shows the channels the user hid, renamed and numbered, and "Clean channel names", in the list, the player and the guide, in ${locale}`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackErrors(page);
    const m = await startMock();
    try {
      const remote = new RemoteDriver(page);
      let live = await addM3uAndWatch(remote, m.link, `locale=${locale}`);
      await settled(live);
      await expect
        .poll(() => shownRows(page))
        .toEqual([
          '1 Lablo Test 1 SMPTE',
          '2 UK: Lablo Test 2 Clock',
          '3 Lablo Test FR - Mire',
          '4 Lablo Prueba ES - Carta de ajuste',
          '5 لابلو تجريبي ٣',
          '6 قناة الاختبار الإخبارية',
          '7 Lablo Test 1 SMPTE',
          '8 Lablo Kids Test',
          '9 Lablo Sports Test HD',
        ]);
      await expect(page.locator('[data-testid=live-meta] [data-n]')).toHaveAttribute('data-n', '12');

      await test.step('the changes written to the profile, then a start', async () => {
        await appIdle(page);
        await page.goto('/?screen=gallery');
        const stored = await storedChannels(page);
        const find = (name: string, group: string): StoredChannel => {
          const found = stored.find((c) => c.name === name && c.group === group);
          if (found === undefined) throw new Error(`no stored channel ${name} in ${group}`);
          return found;
        };
        const entry = (c: StoredChannel, change: Record<string, unknown>): Record<string, unknown> => ({
          key: c.key,
          src: c.src,
          kind: 'live',
          normName: c.normName,
          group: c.group,
          epgId: c.epgId,
          added: Date.now(),
          missingSince: null,
          ...change,
        });
        await editProfile(page, {
          channelEdits: [
            entry(find('Lablo Test 1 SMPTE', 'Test News'), { name: renamed }),
            entry(find('Lablo Test FR - Mire', 'Test News'), { hidden: true }),
            entry(find('Lablo Prueba ES - Carta de ajuste', 'Test News'), { number: 77 }),
            entry(find('Lablo Sports Test HD', 'Sports Test'), { hidden: true, number: 90 }),
          ],
          cleanNames: true,
        });
        await page.goto(`/?locale=${locale}`);
        live = page.getByTestId('live');
        await expect(live).toHaveAttribute('data-status', 'ready');
        await remote.expectFocus('live/channels/0');
        await settled(live);
      });

      await test.step('"All channels": the hidden ones gone, every other number where it was', async () => {
        await expect
          .poll(() => shownRows(page))
          .toEqual([
            `1 ${renamed}`,
            '2 Lablo Test 2 Clock',
            '77 Lablo Prueba ES - Carta de ajuste',
            '5 لابلو تجريبي ٣',
            '6 قناة الاختبار الإخبارية',
            '7 Lablo Test 1 SMPTE',
            '8 Lablo Kids Test',
            '10 Lablo Sports Test FHD',
            '11 Lablo Radio Test',
          ]);
        await expect(page.locator('[data-testid=live-meta] [data-n]')).toHaveAttribute('data-n', '10');
        await shoot(page, `channel-edits-list-${tag}`);
      });

      await test.step('a group: its count without the hidden channel', async () => {
        await remote.go(ar ? 'RIGHT' : 'LEFT', 'live/rail/0');
        await remote.go('DOWN', 'live/rail/1');
        await remote.press('OK');
        await expect(live).toHaveAttribute('data-category', '1');
        await settled(live);
        await expect.poll(() => shownRows(page)).toEqual([`1 ${renamed}`, '2 Lablo Test 2 Clock', '77 Lablo Prueba ES - Carta de ajuste']);
        await expect(page.locator('[data-testid=live-meta] [data-n]')).toHaveAttribute('data-n', '3');
        await remote.go('BACK', 'live/rail/1');
        await remote.go('UP', 'live/rail/0');
        await remote.press('OK');
        await expect(live).toHaveAttribute('data-category', '0');
        await remote.go(ar ? 'LEFT' : 'RIGHT', 'live/channels/0');
        await settled(live);
      });

      await test.step('the player: its names and numbers, CH+ past the hidden channel, and number entry', async () => {
        const player = page.getByTestId('player');
        await remote.go('OK', 'player/actions/0');
        await expect(player).toHaveAttribute('data-playing', '0');
        expect(await text(page, 'player-number')).toBe('1');
        expect(await text(page, 'player-name')).toBe(renamed);
        await shoot(page, `channel-edits-player-${tag}`);
        await remote.press('CH_UP');
        await expect(player).toHaveAttribute('data-target', '1');
        expect(await text(page, 'player-name')).toBe('Lablo Test 2 Clock');
        await remote.press('CH_UP');
        await expect(player).toHaveAttribute('data-target', '2');
        expect(await text(page, 'player-number')).toBe('77');
        expect(await text(page, 'player-name')).toBe('Lablo Prueba ES - Carta de ajuste');
        await expect(player).toHaveAttribute('data-playing', '2');
        // Number entry: the user's 77 from elsewhere in the list; FR's old 3 finds nothing.
        await remote.press('CH_UP');
        await expect(player).toHaveAttribute('data-playing', '3');
        await remote.press('DIGIT_7', 'DIGIT_7', 'OK');
        await expect(player).toHaveAttribute('data-playing', '2');
        await expect(player).toHaveAttribute('data-entry', '');
        expect(await text(page, 'player-number')).toBe('77');
        // The user's 90 is hidden: it plays over the list, at the bar's row.
        await remote.press('DIGIT_9', 'DIGIT_0', 'OK');
        await expect.poll(() => text(page, 'player-name')).toBe('Lablo Sports Test HD');
        await expect(player).toHaveAttribute('data-entry', '');
        expect(await text(page, 'player-number')).toBe('90');
        await expect(player).toHaveAttribute('data-playing', '2');
        await remote.press('DIGIT_3', 'OK');
        await expect(player).toHaveAttribute('data-entry', 'missing');
        await remote.press('BACK');
        await expect(player).toHaveAttribute('data-entry', '');
        await remote.press('BACK');
        await remote.expectFocus('live/channels/2');
      });

      await test.step('the guide: the names and numbers as the list shows them', async () => {
        await remote.go('UP', 'live/channels/1');
        await remote.go('UP', 'live/channels/0');
        await remote.go('UP', 'live/header/0');
        await remote.go('OK', 'guide/grid/0');
        const guide = page.getByTestId('guide-screen');
        await settled(guide);
        await expect
          .poll(async () => (await readGrid(page, 'guide-screen', '.guide__header > *')).rows.slice(0, 4).map((r) => `${stripIsolates(r.number)} ${stripIsolates(r.name)}`))
          .toEqual([`1 ${renamed}`, '2 Lablo Test 2 Clock', '77 Lablo Prueba ES - Carta de ajuste', '5 لابلو تجريبي ٣']);
        await shoot(page, `channel-edits-guide-${tag}`);
        // Back: the list, on the guide's row.
        await remote.press('BACK');
        await remote.expectFocus('live/channels/0');
      });

      await test.step('a hidden channel from the search plays over the list, with its own number', async () => {
        await remote.go('UP', 'live/header/0');
        for (let i = 1; i <= 4; i += 1) await remote.go(ar ? 'LEFT' : 'RIGHT', `live/header/${i}`);
        await remote.go('OK', 'search/field/0');
        const search = page.getByTestId('search-screen');
        await remote.press('OK');
        await expect(search).toHaveAttribute('data-editing', 'search-field');
        await page.keyboard.type('sports test hd');
        await expect(search).toHaveAttribute('data-answered', 'sports test hd');
        await settled(search);
        await remote.press('OK');
        await remote.expectFocus('search/results/0');
        await remote.press('OK');
        await remote.expectFocus('player/actions/0');
        expect(await text(page, 'player-name')).toBe('Lablo Sports Test HD');
        expect(await text(page, 'player-number')).toBe('90');
        await shoot(page, `channel-edits-hidden-play-${tag}`);
        await remote.go('BACK', 'search/results/0');
        await remote.go('BACK', 'search/field/0');
        await remote.go('BACK', 'live/header/4');
        // The list on show stays as it was.
        await expect(live).toHaveAttribute('data-category', '0');
        await expect.poll(async () => (await shownRows(page)).slice(0, 3)).toEqual([`1 ${renamed}`, '2 Lablo Test 2 Clock', '77 Lablo Prueba ES - Carta de ajuste']);
      });

      expect(errors).toEqual([]);
    } finally {
      await m.app.close();
    }
  });
}
