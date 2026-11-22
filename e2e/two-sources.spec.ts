import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Catalog } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Two sources with groups of the same name (RELAY step 36d, Omar's option 1: label, don't merge).
 *
 * The first source is the mock's Xtream panel (its six live groups, numbered 1–12 by the panel);
 * the second, written to the profile beside it, is a second mock's M3U playlist with "Test News"
 * (the same name), "SPORTS TEST" (the panel's "Sports Test" in capitals) and "Music Test" (its
 * own). The app reads the new source at the refresh schedule's first check. Checked: the rail
 * tags the four same-named groups with their sources' names and nothing else; the tag sits
 * between the name and the count (mirrored in Arabic); the header names the source of the group
 * on show; the playlist's channels are numbered after the panel's (13 on: numbers run on across
 * sources); Settings › "Channel groups" names every group's source; the movies rail tags the two
 * sources' same-named categories too. In en-XA: nothing of ours left untranslated, and a long
 * source name is cut at half the chip, its group's name still shown.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

/** The second source's catalog: "Test News" as the panel's, "SPORTS TEST", and a group of its own. */
function secondCatalog(): Catalog {
  const base = loadCatalog();
  const news = base.liveCategories.find((c) => c.id === 1)!;
  const clock = base.live.find((c) => c.id === 102)!;
  return {
    ...base,
    liveCategories: [news, { ...news, id: 4, name: 'SPORTS TEST' }, { ...news, id: 7, name: 'Music Test' }],
    live: base.live.filter((c) => c.categoryId === 1 || c.categoryId === 4).concat([{ ...clock, id: 113, num: 13, name: 'Lablo Music Test', categoryId: 7 }]),
  };
}

async function startMock(catalog?: Catalog): Promise<{ app: MockServer; host: string }> {
  const app = await mock(catalog === undefined ? { now: () => Date.now() } : { now: () => Date.now(), catalog });
  return { app, host: (await listen(app)).replace(/^http:\/\//, '') };
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function text(locator: Locator): Promise<string> {
  return stripIsolates((await locator.textContent()) ?? '');
}

/** No config run and no backup worker in the database. */
async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

/** Names the stored source `first`, and adds `second` after it, in the stored profile. */
function addSource(page: Page, first: string, second: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    ({ name, source }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('profile', 'readwrite');
          const store = tx.objectStore('profile');
          const req = store.get('current');
          req.onsuccess = () => {
            const record = req.result as { doc: { sources: Record<string, unknown>[] } };
            record.doc.sources[0]!.name = name;
            record.doc.sources.push(source);
            store.put(record);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { name: first, source: second },
  );
}

/** The rail's first `count` chips: the name, then the source's tag in brackets when it has one. */
async function chips(page: Page, prefix: string, count: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const chip = page.getByTestId(`${prefix}${i}`);
    const label = await text(chip.locator('.z-chip__label'));
    const tag = chip.locator('.z-chip__source');
    out.push((await tag.count()) === 0 ? label : `${label} [${await text(tag)}]`);
  }
  return out;
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

/** Text that isn't ours in brackets (en-XA), names (`translate=no`) aside. */
function untranslated(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (root === null) return [`no ${sel}`];
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(value) || node.parentElement?.closest('[translate="no"]') != null) continue;
      if (!(value.startsWith('[') && value.endsWith(']'))) out.push(value);
    }
    return out;
  }, selector);
}

const LOCALES = [
  { locale: 'en-US', tag: 'en', first: 'Home panel', second: 'Phone list' },
  { locale: 'ar-SA', tag: 'ar', first: 'لوحة المنزل', second: 'قائمة الهاتف' },
  { locale: 'en-XA', tag: 'en-XA', first: 'Home panel with a name far too long for half a chip', second: 'Phone list' },
] as const;

for (const { locale, tag, first, second } of LOCALES) {
  const ar = locale === 'ar-SA';
  const pseudo = locale === 'en-XA';

  test(`tags two sources' groups of one name with the sources' names, in ${locale}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const panel = await startMock();
    const playlist = await startMock(secondCatalog());
    try {
      const remote = new RemoteDriver(page);
      let live = await addXtreamAndWatch(remote, { host: panel.host, username: U, password: P }, `locale=${locale}`);
      await settled(live);

      await test.step('the playlist added beside the panel, read at the first check', async () => {
        await appIdle(page);
        await page.goto('/?screen=gallery');
        await addSource(page, first, { id: 's2', type: 'm3u', name: second, url: `http://${playlist.host}/get.php?username=${U}&password=${P}&type=m3u_plus&output=m3u8`, added: Date.now() });
        await page.goto(`/?locale=${locale}`);
        live = page.getByTestId('live');
        await expect(live).toHaveAttribute('data-status', 'ready');
        await remote.expectFocus('live/channels/0');
        // The schedule's first check comes 15 s after the start; the rail then reads both sources.
        await expect(page.getByTestId('chip-9')).toBeVisible({ timeout: 60_000 });
        await settled(live);
      });

      await test.step('the rail: the same-named groups tagged, nothing else', async () => {
        expect((await chips(page, 'chip-', 10)).slice(1)).toEqual([
          `Test News [${first}]`,
          'اختبار - أخبار',
          'Kids Test | أطفال',
          `Sports Test [${first}]`,
          'Radio Test',
          '18+ Test (lock check)',
          `Test News [${second}]`,
          `SPORTS TEST [${second}]`,
          'Music Test',
        ]);
        await expect(page.getByTestId('chip-10')).toHaveCount(0);
        const tagOf = page.getByTestId('chip-1').locator('.z-chip__source');
        await expect(tagOf).toHaveAttribute('dir', 'auto');
        await expect(tagOf).toHaveAttribute('translate', 'no');
        if (!ar && !pseudo) await expect(page.getByTestId('chip-1').locator('.z-chip__count')).toHaveText('4');

        // The tag inside its chip, between the name and the count (mirrored in Arabic).
        for (const i of [1, 8]) {
          const chip = page.getByTestId(`chip-${i}`);
          const c = await box(chip);
          const label = await box(chip.locator('.z-chip__label'));
          const source = await box(chip.locator('.z-chip__source'));
          const count = await box(chip.locator('.z-chip__count'));
          expect(source.x).toBeGreaterThanOrEqual(c.x);
          expect(source.x + source.width).toBeLessThanOrEqual(c.x + c.width);
          expect(source.y).toBeGreaterThanOrEqual(c.y);
          expect(source.y + source.height).toBeLessThanOrEqual(c.y + c.height);
          if (ar) {
            expect(count.x + count.width).toBeLessThanOrEqual(source.x + 1);
            expect(source.x + source.width).toBeLessThanOrEqual(label.x + 1);
          } else {
            expect(label.x + label.width).toBeLessThanOrEqual(source.x + 1);
            expect(source.x + source.width).toBeLessThanOrEqual(count.x + 1);
          }
          expect(label.width).toBeGreaterThan(100);
        }
        if (pseudo) {
          // A long name is cut past half the chip; the group's name keeps the rest.
          const chip = page.getByTestId('chip-1');
          const tagBox = await box(chip.locator('.z-chip__source'));
          expect(tagBox.width).toBeLessThanOrEqual((await box(chip)).width / 2);
          expect(await chip.locator('.z-chip__source').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
          expect(await untranslated(page, '[data-testid=rail]')).toEqual([]);
        } else {
          expect(await page.getByTestId('chip-1').locator('.z-chip__source').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
        await shoot(page, `two-sources-rail-${tag}`);
      });

      await test.step("the header names the source of the group on show; the playlist's numbers run on after the panel's", async () => {
        const meta = page.getByTestId('live-meta');
        await remote.go(ar ? 'RIGHT' : 'LEFT', 'live/rail/0');
        await expect(page.getByTestId('live-source')).toHaveCount(0);
        await remote.go('DOWN', 'live/rail/1');
        await remote.go('OK', 'live/channels/0');
        await expect(live).toHaveAttribute('data-category', '1');
        await expect(page.getByTestId('live-source')).toHaveText(first);
        await expect(page.getByTestId('live-source')).toHaveAttribute('translate', 'no');
        if (!ar && !pseudo) await expect(meta).toHaveText(`Test News · ${first} · 4 channels`);
        if (pseudo) expect(await untranslated(page, '[data-testid=live-meta]')).toEqual([]);

        await remote.go(ar ? 'RIGHT' : 'LEFT', 'live/rail/1');
        for (let i = 2; i <= 8; i += 1) await remote.go('DOWN', `live/rail/${i}`);
        await remote.go('OK', 'live/channels/0');
        await expect(live).toHaveAttribute('data-category', '8');
        await expect(page.getByTestId('live-source')).toHaveText(second);
        if (!ar && !pseudo) await expect(meta).toHaveText(`SPORTS TEST · ${second} · 2 channels`);
        await settled(live);
        await expect
          .poll(async () => (await rows(page)).map((r) => `${stripIsolates(r.number)} ${stripIsolates(r.name)}`))
          .toEqual(['17 Lablo Sports Test HD', '18 Lablo Sports Test FHD']);
        await shoot(page, `two-sources-header-${tag}`);
      });

      await test.step('Settings › "Channel groups" names every group\'s source', async () => {
        await remote.go(ar ? 'RIGHT' : 'LEFT', 'live/rail/8');
        for (let i = 7; i >= 0; i -= 1) await remote.go('UP', `live/rail/${i}`);
        await remote.press('UP');
        for (let i = 0; i < 5; i += 1) await remote.press(ar ? 'LEFT' : 'RIGHT');
        await remote.expectFocus('live/header/5');
        await remote.go('OK', 'settings/items/0');
        for (let i = 1; i <= 5; i += 1) await remote.go('DOWN', `settings/items/${i}`);
        await remote.go('OK', 'groups/rows/0');
        await expect(page.getByTestId('groups')).toHaveAttribute('data-status', 'ready');
        await settled(page.getByTestId('settings-screen'));
        expect(await text(page.getByTestId('group-0-name'))).toBe('Test News');
        expect(await text(page.getByTestId('group-6-name'))).toBe('Test News');
        const line0 = await text(page.getByTestId('group-0-line'));
        const line6 = await text(page.getByTestId('group-6-line'));
        if (!ar && !pseudo) {
          expect(line0).toBe(`From ${first} · 4 channels`);
          expect(line6).toBe(`From ${second} · 4 channels`);
        } else {
          expect(line0).toContain(first);
          expect(line6).toContain(second);
        }
        if (pseudo) expect(await untranslated(page, '[data-testid=groups]')).toEqual([]);
        await shoot(page, `two-sources-groups-${tag}`);
        await remote.go('BACK', 'settings/items/5');
        await remote.go('BACK', 'live/header/5');
      });

      await test.step("the movies rail tags the two sources' same-named categories", async () => {
        for (let i = 4; i >= 1; i -= 1) await remote.go(ar ? 'RIGHT' : 'LEFT', `live/header/${i}`);
        await remote.press('OK');
        const movies = page.getByTestId('movies-screen');
        await expect(movies).toHaveAttribute('data-status', 'ready');
        const shown = await page.locator('[data-testid=movies-rail] [data-testid^="movies-chip-"]').count();
        const tagged = (await chips(page, 'movies-chip-', shown)).filter((c) => c.indexOf(' [') > 0);
        expect(tagged).toEqual([`Open Movies | أفلام مفتوحة [${first}]`, `Test Patterns [${first}]`, `Open Movies | أفلام مفتوحة [${second}]`, `Test Patterns [${second}]`]);
        if (pseudo) expect(await untranslated(page, '[data-testid=movies-rail]')).toEqual([]);
        // The header names the source of the category on show.
        await expect(page.getByTestId('movies-source')).toHaveCount(0);
        const at = (await chips(page, 'movies-chip-', shown)).findIndex((c) => c.indexOf(' [') > 0);
        await remote.go(ar ? 'RIGHT' : 'LEFT', 'movies/rail/0');
        for (let i = 1; i <= at; i += 1) await remote.go('DOWN', `movies/rail/${i}`);
        await remote.press('OK');
        await expect(movies).toHaveAttribute('data-category', String(at));
        await expect(page.getByTestId('movies-source')).toHaveText(tagged[0]!.slice(tagged[0]!.indexOf(' [') + 2, -1));
        await shoot(page, `two-sources-movies-${tag}`);
      });

      expect(errors).toEqual([]);
    } finally {
      await panel.app.close();
      await playlist.app.close();
    }
  });
}
