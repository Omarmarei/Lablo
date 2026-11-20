import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { stripIsolates } from '../packages/core/src/bidi';
import { catalog, ordered, rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Settings › "Channel groups" (RELAY step 35d), by keys: a list made from the info bar's star
 * (step 35c) is renamed, its channels moved, then deleted after its question; a group is hidden
 * (the rail leaves it out, and a search hit in it still plays, over the list), then shown again
 * from the same screen. The live screen follows each change.
 *
 * The mock's live groups, in the panel's order: Test News, اختبار - أخبار, Kids Test | أطفال,
 * Sports Test, Radio Test, 18+ Test (lock check). "All channels" lists their channels group by
 * group (`ordered`).
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
const GROUPS = catalog.liveCategories.map((c) => c.name);

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function startMock(): Promise<{ app: MockServer; host: string }> {
  const app = await mock({ now: () => Date.now() });
  const host = (await listen(app)).replace(/^http:\/\//, '');
  return { app, host };
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

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** The rail's chips' names (each chip's text less its count). */
async function chips(page: Page): Promise<string[]> {
  const names = await page.locator('[data-testid^=chip-] .z-chip__label').allTextContents();
  return names.map((n) => stripIsolates(n));
}

/** The groups screen's rows as `name` (`!` when hidden). */
async function groupRows(page: Page): Promise<string[]> {
  const count = Number(await page.getByTestId('groups').getAttribute('data-count'));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = page.getByTestId(`group-${i}`);
    out.push(`${await text(page, `group-${i}-name`)}${(await row.getAttribute('data-hidden')) === 'true' ? '!' : ''}`);
  }
  return out;
}

/** A list's channels' names as drawn. */
async function channelNames(page: Page): Promise<string[]> {
  const count = Number(await page.getByTestId('group-channels').getAttribute('data-count'));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(await text(page, `group-channel-${i}-name`));
  return out;
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
      if (!(value.startsWith('[') && value.endsWith(']'))) out.push(value);
    }
    for (const el of Array.from(root.querySelectorAll('[aria-label]'))) {
      const name = (el.getAttribute('aria-label') ?? '').trim();
      if (!(name.startsWith('[') && name.endsWith(']'))) out.push(`aria-label: ${name}`);
    }
    return out;
  }, selector);
}

/**
 * The list "Favourites" from the info bar's star: live row 1's channel, then the next `more`
 * channels by CH+ (the focus stays on the star). Back to the live list on the last one's row.
 */
async function makeList(remote: RemoteDriver, next: 'LEFT' | 'RIGHT', more: number): Promise<void> {
  const page = remote.page;
  await remote.go('DOWN', 'live/channels/1');
  await remote.press('OK');
  await remote.expectFocus('player/actions/0');
  for (let i = 1; i <= 4; i += 1) await remote.go(next, `player/actions/${i}`);
  await remote.go('OK', 'favourites/lists/0');
  await remote.press('OK');
  await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'true');
  await remote.go('BACK', 'player/actions/4');
  for (let i = 0; i < more; i += 1) {
    await remote.press('CH_UP');
    await expect(page.getByTestId('player')).toHaveAttribute('data-playing', String(2 + i));
    await remote.go('OK', 'favourites/lists/0');
    await remote.press('OK');
    await expect(page.getByTestId('favourites-list-0')).toHaveAttribute('data-checked', 'true');
    await expect(page.getByTestId('favourites')).toHaveAttribute('data-pending', '0');
    await remote.go('BACK', 'player/actions/4');
  }
  await remote.go('BACK', `live/channels/${1 + more}`);
}

/** From the rail: UP to the header (on the button focused there last), then to its end, "Settings". */
async function toSettingsButton(remote: RemoteDriver, rtl: boolean): Promise<void> {
  await remote.press('UP');
  for (let i = 0; i < 5; i += 1) await remote.press(rtl ? 'LEFT' : 'RIGHT');
  await remote.expectFocus('live/header/5');
}

/**
 * From the rail's first entry: the header's "Settings" (its end: the left in Arabic), then
 * "Channel groups", the last row (`row`: its text, checked on the way).
 */
async function openGroups(remote: RemoteDriver, rtl: boolean, row?: string): Promise<Locator> {
  await toSettingsButton(remote, rtl);
  await remote.go('OK', 'settings/items/0');
  for (let i = 1; i <= 5; i += 1) await remote.go('DOWN', `settings/items/${i}`);
  if (row !== undefined) expect(await text(remote.page, 'settings-groups')).toBe(row);
  await remote.go('OK', 'groups/rows/0');
  const root = remote.page.getByTestId('groups');
  await expect(root).toHaveAttribute('data-status', 'ready');
  await settled(remote.page.getByTestId('settings-screen'));
  return root;
}

/** Back from "Channel groups" to the live screen's rail, its first entry. */
async function backToRail(remote: RemoteDriver): Promise<void> {
  await remote.go('BACK', 'settings/items/5');
  await remote.go('BACK', 'live/header/5');
  await remote.go('DOWN', 'live/rail/0');
  await settled(remote.page.getByTestId('live'));
}

for (const locale of ['en-US', 'ar-SA'] as const) {
  const ar = locale === 'ar-SA';
  const words = ar ? AR : EN;
  const tag = ar ? 'ar' : 'en';
  /** The list's new name, typed on the keyboard. */
  const named = ar ? 'رياضة' : 'Sport';

  test(`renames a list, moves its channels, hides a group and shows it again, and deletes the list after asking, in ${locale}`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackErrors(page);
    const m = await startMock();
    try {
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host: m.host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      const next = ar ? 'LEFT' : 'RIGHT';
      const settings = page.getByTestId('settings-screen');
      await makeList(remote, next, 2);
      await remote.go('BACK', 'live/rail/0');

      let groups: Locator;
      await test.step('"Channel groups" lists the list, then every group in the rail’s order', async () => {
        groups = await openGroups(remote, ar, `${words['settings.groups']}${words['settings.groupsHint']}`);
        expect(await groupRows(page)).toEqual([words['category.favourites'], ...GROUPS]);
        expect(await text(page, 'group-0-line')).toContain(words['groups.kindList']);
        expect(stripIsolates((await groups.locator('h1').textContent()) ?? '')).toBe(words['groups.title']);
        await expectInSafeArea(page.getByTestId('groups-list'));
        await shoot(page, `groups-${tag}`);
      });

      await test.step('Rename: the form, then the list’s new name', async () => {
        await remote.go('OK', 'group-menu/actions/0');
        expect(await text(page, 'group-menu-rename')).toBe(words['groups.rename']);
        // One list: Channels, Rename, Delete, Cancel.
        await expect(page.locator('[data-testid^="group-menu-"]')).toHaveCount(4);
        await shoot(page, `groups-menu-${tag}`);
        await remote.go('DOWN', 'group-menu/actions/1');
        await remote.go('OK', 'group-rename/field/0');
        await remote.press('OK');
        await expect(settings).toHaveAttribute('data-editing', 'group-name');
        await page.keyboard.type(named);
        await remote.press('OK');
        await expect(settings).toHaveAttribute('data-editing', '');
        await remote.expectFocus('group-rename/actions/0');
        await shoot(page, `groups-rename-${tag}`);
        await remote.go('OK', 'groups/rows/0');
        await settled(settings);
        expect(await text(page, 'group-0-name')).toBe(named);
      });

      await test.step('a list’s channels: the first one moved to the end', async () => {
        await remote.go('OK', 'group-menu/actions/0');
        await remote.go('OK', 'group-channels/channels/0');
        await settled(settings);
        expect(await channelNames(page)).toEqual([ordered[1]!.name, ordered[2]!.name, ordered[3]!.name]);
        await remote.go('OK', 'group-channel-menu/actions/0');
        await remote.go('OK', 'group-channels/channels/0');
        await expect(page.getByTestId('group-channels')).toHaveAttribute('data-moving', '0');
        expect(await text(page, 'groups-intro')).toBe(words['groups.moving']);
        await remote.go('DOWN', 'group-channels/channels/1');
        await remote.go('DOWN', 'group-channels/channels/2');
        await expect(page.getByTestId('group-channel-2')).toHaveAttribute('data-moving', 'true');
        await shoot(page, `groups-channels-moving-${tag}`);
        await remote.press('OK');
        await expect(page.getByTestId('group-channels')).toHaveAttribute('data-moving', '-1');
        await settled(settings);
        await remote.expectFocus('group-channels/channels/2');
        expect(await channelNames(page)).toEqual([ordered[2]!.name, ordered[3]!.name, ordered[1]!.name]);
        await remote.go('BACK', 'groups/rows/0');
      });

      await test.step('a group hidden: marked here, gone from the rail', async () => {
        for (let i = 1; i <= 4; i += 1) await remote.go('DOWN', `groups/rows/${i}`);
        await remote.go('OK', 'group-menu/actions/0');
        await remote.go('DOWN', 'group-menu/actions/1');
        expect(await text(page, 'group-menu-hide')).toBe(words['groups.hide']);
        await remote.go('OK', 'groups/rows/4');
        await settled(settings);
        await expect(page.getByTestId('group-4')).toHaveAttribute('data-hidden', 'true');
        expect(await text(page, 'group-4-line')).toContain(words['groups.hidden']);
        await shoot(page, `groups-hidden-${tag}`);
        await backToRail(remote);
        await expect.poll(() => chips(page)).toEqual([words['category.all'], named, ...GROUPS.filter((g) => g !== GROUPS[3])]);
      });

      await test.step('the list in the rail has its channels in the new order', async () => {
        await remote.go('DOWN', 'live/rail/1');
        await remote.press('OK');
        await expect(live).toHaveAttribute('data-category', '1');
        await settled(live);
        await expect.poll(async () => (await rows(page)).map((r) => r.name)).toEqual([ordered[2]!.name, ordered[3]!.name, ordered[1]!.name]);
        await remote.go('BACK', 'live/rail/1');
        await remote.go('UP', 'live/rail/0');
      });

      if (!ar) {
        await test.step('a search hit in the hidden group still plays, over the list on show', async () => {
          await toSettingsButton(remote, false);
          await remote.go('LEFT', 'live/header/4');
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
          await shoot(page, 'groups-hidden-play-en');
          await remote.go('BACK', 'search/results/0');
          await remote.go('BACK', 'search/field/0');
          await remote.go('BACK', 'live/header/4');
          await remote.go('DOWN', 'live/rail/0');
        });
      }

      await test.step('the hidden group’s way back: Show, and the rail has it again', async () => {
        groups = await openGroups(remote, ar);
        for (let i = 1; i <= 4; i += 1) await remote.go('DOWN', `groups/rows/${i}`);
        await remote.go('OK', 'group-menu/actions/0');
        await remote.go('DOWN', 'group-menu/actions/1');
        expect(await text(page, 'group-menu-show')).toBe(words['groups.show']);
        await remote.go('OK', 'groups/rows/4');
        await settled(settings);
        await expect(page.getByTestId('group-4')).toHaveAttribute('data-hidden', 'false');
        await remote.go('UP', 'groups/rows/3');
        await remote.go('UP', 'groups/rows/2');
        await remote.go('UP', 'groups/rows/1');
        await remote.go('UP', 'groups/rows/0');
        await backToRail(remote);
        await expect.poll(() => chips(page)).toEqual([words['category.all'], named, ...GROUPS]);
      });

      await test.step('Delete asks first, "Cancel" focused; Delete takes the list away', async () => {
        groups = await openGroups(remote, ar);
        await remote.go('OK', 'group-menu/actions/0');
        await remote.go('DOWN', 'group-menu/actions/1');
        await remote.go('DOWN', 'group-menu/actions/2');
        await remote.go('OK', 'group-delete/actions/1');
        expect(stripIsolates((await page.getByTestId('group-delete').locator('h2').textContent()) ?? '')).toBe(words['groups.deleteTitle']);
        await shoot(page, `groups-delete-${tag}`);
        // Cancel: nothing goes.
        await remote.go('OK', 'groups/rows/0');
        expect(await text(page, 'group-0-name')).toBe(named);
        await remote.go('OK', 'group-menu/actions/0');
        await remote.go('DOWN', 'group-menu/actions/1');
        await remote.go('DOWN', 'group-menu/actions/2');
        await remote.go('OK', 'group-delete/actions/1');
        await remote.go(ar ? 'RIGHT' : 'LEFT', 'group-delete/actions/0');
        await remote.go('OK', 'groups/rows/0');
        await settled(settings);
        expect(await groupRows(page)).toEqual(GROUPS);
        await backToRail(remote);
        await expect.poll(() => chips(page)).toEqual([words['category.all'], ...GROUPS]);
      });
      expect(errors).toEqual([]);
    } finally {
      await m.app.close();
    }
  });
}

test('shows only our strings, bracketed, in "Channel groups", its menus, forms and a list’s channels, in the pseudo-locale (en-XA)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const m = await startMock();
  try {
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host: m.host, username: U, password: P }, 'locale=en-XA');
    await settled(live);
    await makeList(remote, 'RIGHT', 1);
    await remote.go('BACK', 'live/rail/0');
    await openGroups(remote, false);
    expect(await untranslated(page, '[data-testid=groups]')).toEqual([]);
    // The unnamed list says the catalog's "Favourites", as the panel and the rail do.
    expect(await text(page, 'group-0-name')).toMatch(/^\[.+\]$/u);
    await shoot(page, 'groups-en-XA');
    await remote.go('OK', 'group-menu/actions/0');
    expect(await untranslated(page, '[data-testid=group-menu]')).toEqual([]);
    await remote.go('DOWN', 'group-menu/actions/1');
    await remote.go('OK', 'group-rename/field/0');
    expect(await untranslated(page, '[data-testid=group-rename]')).toEqual([]);
    await shoot(page, 'groups-rename-en-XA');
    await remote.go('BACK', 'groups/rows/0');
    await remote.go('OK', 'group-menu/actions/0');
    await remote.go('DOWN', 'group-menu/actions/1');
    await remote.go('DOWN', 'group-menu/actions/2');
    await remote.go('OK', 'group-delete/actions/1');
    expect(await untranslated(page, '[data-testid=group-delete]')).toEqual([]);
    await shoot(page, 'groups-delete-en-XA');
    await remote.go('BACK', 'groups/rows/0');
    await remote.go('OK', 'group-menu/actions/0');
    await remote.go('OK', 'group-channels/channels/0');
    await settled(page.getByTestId('settings-screen'));
    expect(await untranslated(page, '[data-testid=group-channels]')).toEqual([]);
    await remote.go('OK', 'group-channel-menu/actions/0');
    expect(await untranslated(page, '[data-testid=group-menu]')).toEqual([]);
    await remote.go('OK', 'group-channels/channels/0');
    expect(await untranslated(page, '[data-testid=group-channels]')).toEqual([]);
    await shoot(page, 'groups-channels-en-XA');
    await remote.go('BACK', 'group-channels/channels/0');
    await remote.go('BACK', 'groups/rows/0');
    // A group's menu, and a hidden group's row.
    await remote.go('DOWN', 'groups/rows/1');
    await remote.go('OK', 'group-menu/actions/0');
    expect(await untranslated(page, '[data-testid=group-menu]')).toEqual([]);
    await remote.go('DOWN', 'group-menu/actions/1');
    await remote.go('OK', 'groups/rows/1');
    await settled(page.getByTestId('settings-screen'));
    await expect(page.getByTestId('group-1')).toHaveAttribute('data-hidden', 'true');
    expect(await untranslated(page, '[data-testid=groups]')).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await m.app.close();
  }
});
