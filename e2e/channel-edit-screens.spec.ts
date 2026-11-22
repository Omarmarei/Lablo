import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { stripIsolates } from '../packages/core/src/bidi';
import { rows } from './live-rows';
import { addM3uAndWatch, settled, trackErrors } from './onboard';
import { playlistOnly } from './playlist-only';
import { RemoteDriver } from './remote-driver';

/**
 * The editing screens (RELAY step 36c): "Edit channel" from the info bar's pencil, over the
 * player, and Settings › "Channels", on the mock's M3U playlist (numbers by place, 1–12; "UK: "
 * in front of Clock's name, as many playlists write them).
 *
 * In en and ar: SMPTE (1) renamed from the panel, numbered 42 with the remote's digits (number
 * entry then finds it), and hidden (gone from the list and the rail's count, still found by 42,
 * over the list); then in "Channels": the row with all three marks, "Clean channel names" on
 * (Clock's "UK: " goes), "Show channel" (back in the list), "Undo my changes" (the provider's name
 * and number again, the row gone). In en-XA: every panel, form, menu and the page, bracketed.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

/** The mock's catalog with Clock's name behind a country tag (as `channel-edits.spec.ts`'s). */
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

/** The test ids of the menu's actions, in order. */
async function actions(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid=channel-edit] [data-testid^="channel-edit-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
  return ids.filter((id) => id !== 'channel-edit-name' && id !== 'channel-edit-problem').map((id) => id.slice('channel-edit-'.length));
}

/** Text that isn't ours in brackets (en-XA), names (`translate=no`) aside; aria-labels too. */
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

async function expectInSafeArea(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(SAFE.left);
  expect(box!.y).toBeGreaterThanOrEqual(SAFE.top);
  expect(box!.x + box!.width).toBeLessThanOrEqual(SAFE.right);
  expect(box!.y + box!.height).toBeLessThanOrEqual(SAFE.bottom);
}

/** From the player's first button: along the info bar to the pencil, then OK. */
async function openPencil(remote: RemoteDriver, next: 'LEFT' | 'RIGHT'): Promise<void> {
  await remote.expectFocus('player/actions/0');
  for (let i = 1; i <= 5; i += 1) await remote.go(next, `player/actions/${i}`);
  await remote.go('OK', 'channel-edit/actions/0');
  await expect(remote.page.getByTestId('channel-edit')).toHaveAttribute('data-pending', '0');
}

/** From the list's first row: the header's "Settings", then "Channels" (the seventh row, `row`'s words). */
async function openChannels(remote: RemoteDriver, next: 'LEFT' | 'RIGHT', row?: string): Promise<void> {
  await remote.go('UP', 'live/header/0');
  for (let i = 1; i <= 5; i += 1) await remote.go(next, `live/header/${i}`);
  await remote.go('OK', 'settings/items/0');
  for (let i = 1; i <= 6; i += 1) await remote.go('DOWN', `settings/items/${i}`);
  if (row !== undefined) expect(await text(remote.page, 'settings-channels')).toBe(row);
  await remote.go('OK', 'channels/rows/0');
  await expect(remote.page.getByTestId('channels')).toHaveAttribute('data-status', 'ready');
  await settled(remote.page.getByTestId('settings-screen'));
}

for (const locale of ['en-US', 'ar-SA'] as const) {
  const ar = locale === 'ar-SA';
  const words = ar ? AR : EN;
  const tag = ar ? 'ar' : 'en';
  const next = ar ? 'LEFT' : 'RIGHT';
  /** SMPTE's new name, typed on the keyboard. */
  const renamed = ar ? 'قناتي' : 'My SMPTE';

  test(`renames, renumbers and hides a channel from the info bar, then shows it, cleans names and undoes it in "Channels", in ${locale}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const m = await startMock();
    try {
      const remote = new RemoteDriver(page);
      const live = await addM3uAndWatch(remote, m.link, `locale=${locale}`);
      await settled(live);
      await expect.poll(async () => (await shownRows(page)).slice(0, 3)).toEqual(['1 Lablo Test 1 SMPTE', '2 UK: Lablo Test 2 Clock', '3 Lablo Test FR - Mire']);
      const player = page.getByTestId('player');

      await test.step('the pencil: "Edit channel" over the player, then Rename', async () => {
        await remote.go('OK', 'player/actions/0');
        await expect(player).toHaveAttribute('data-playing', '0');
        await remote.go(next, 'player/actions/1');
        for (let i = 2; i <= 5; i += 1) await remote.go(next, `player/actions/${i}`);
        // An icon button: its name for screen readers. The six buttons fit the bar in en and ar.
        await expect(page.getByTestId('player-edit')).toHaveAttribute('aria-label', words['player.editChannel']);
        await expectInSafeArea(page, 'player-edit');
        await remote.go('OK', 'channel-edit/actions/0');
        const panel = page.getByTestId('channel-edit');
        await expect(panel).toHaveAttribute('data-pending', '0');
        await expect(panel).toHaveAttribute('data-over', 'true');
        expect(await text(page, 'channel-edit-name')).toBe('Lablo Test 1 SMPTE');
        expect(await actions(page)).toEqual(['rename', 'number', 'hide', 'cancel']);
        expect(await text(page, 'channel-edit-rename')).toBe(words['groups.rename']);
        // The info bar makes room; the picture stays in view (the page over the stage is transparent).
        await expect(page.getByTestId('player-bar')).toHaveCount(0);
        await expectInSafeArea(page, 'channel-edit');
        await shoot(page, `channel-edit-panel-${tag}`);
        await remote.go('OK', 'channel-rename/field/0');
        const field = page.locator('#channel-name');
        await expect(field).toHaveValue('Lablo Test 1 SMPTE');
        await remote.press('OK');
        await expect(page.getByTestId('channel-edit-over')).toHaveAttribute('data-editing', 'channel-name');
        await page.keyboard.press('Control+A');
        await page.keyboard.type(renamed);
        await remote.press('OK');
        await expect(page.getByTestId('channel-edit-over')).toHaveAttribute('data-editing', '');
        await remote.expectFocus('channel-rename/actions/0');
        await shoot(page, `channel-edit-rename-${tag}`);
        await remote.go('OK', 'player/actions/5');
        await expect.poll(() => text(page, 'player-name')).toBe(renamed);
        expect(await text(page, 'player-number')).toBe('1');
      });

      await test.step('Channel number with the remote’s digits; number entry finds it', async () => {
        await remote.go('OK', 'channel-edit/actions/0');
        await expect(page.getByTestId('channel-edit')).toHaveAttribute('data-pending', '0');
        // Changed: "Undo my changes" now.
        expect(await actions(page)).toEqual(['rename', 'number', 'hide', 'reset', 'cancel']);
        expect(await text(page, 'channel-edit-name')).toBe(renamed);
        await remote.go('DOWN', 'channel-edit/actions/1');
        await remote.go('OK', 'channel-number/field/0');
        const field = page.locator('#channel-number-input');
        await expect(field).toHaveValue('');
        await expect(field).toHaveAttribute('type', 'tel');
        // Not a number: it says so and saves nothing.
        await remote.press('DIGIT_0');
        await remote.go('DOWN', 'channel-number/actions/0');
        await remote.press('OK');
        await expect(page.getByTestId('channel-number-field')).toHaveClass(/is-invalid/u);
        await remote.expectFocus('channel-number/actions/0');
        await shoot(page, `channel-edit-number-wrong-${tag}`);
        // A digit after a wrong number starts a new one.
        await remote.press('DIGIT_4', 'DIGIT_2');
        await expect(field).toHaveValue('42');
        await expect(page.getByTestId('channel-number-field')).not.toHaveClass(/is-invalid/u);
        await shoot(page, `channel-edit-number-${tag}`);
        await remote.go('OK', 'player/actions/5');
        await expect.poll(() => text(page, 'player-number')).toBe('42');
        expect(await text(page, 'player-name')).toBe(renamed);
        // Away, then 42: the channel again.
        await remote.press('CH_UP');
        await expect(player).toHaveAttribute('data-playing', '1');
        await remote.press('DIGIT_4', 'DIGIT_2', 'OK');
        await expect(player).toHaveAttribute('data-playing', '0');
        await expect(player).toHaveAttribute('data-entry', '');
        expect(await text(page, 'player-number')).toBe('42');
      });

      await test.step('Hide channel: it plays on; the list and the rail leave it out, 42 still finds it', async () => {
        await remote.expectFocus('player/actions/5');
        await remote.go('OK', 'channel-edit/actions/0');
        await expect(page.getByTestId('channel-edit')).toHaveAttribute('data-pending', '0');
        await remote.go('DOWN', 'channel-edit/actions/1');
        await remote.go('DOWN', 'channel-edit/actions/2');
        expect(await text(page, 'channel-edit-hide')).toBe(words['channels.hide']);
        await remote.go('OK', 'player/actions/5');
        await settled(player);
        // Still on show (over the list now), with its name and number.
        expect(await text(page, 'player-name')).toBe(renamed);
        expect(await text(page, 'player-number')).toBe('42');
        await remote.press('BACK');
        await remote.expectFocus('live/channels/0');
        await settled(live);
        await expect.poll(async () => (await shownRows(page)).slice(0, 3)).toEqual(['2 UK: Lablo Test 2 Clock', '3 Lablo Test FR - Mire', '4 Lablo Prueba ES - Carta de ajuste']);
        // (One hidden, and the 18+ channel locked by default: step 38.)
        await expect(page.locator('[data-testid=live-meta] [data-n]')).toHaveAttribute('data-n', '10');
        await expect(page.getByTestId('chip-0')).toContainText('10');
        await remote.go('OK', 'player/actions/0');
        await expect(player).toHaveAttribute('data-playing', '0');
        expect(await text(page, 'player-name')).toBe('UK: Lablo Test 2 Clock');
        await remote.press('DIGIT_4', 'DIGIT_2', 'OK');
        await expect.poll(() => text(page, 'player-name')).toBe(renamed);
        await expect(player).toHaveAttribute('data-entry', '');
        await remote.press('BACK');
        await remote.expectFocus('live/channels/0');
      });

      await test.step('"Channels": the row with its marks, the switch, Show channel, and Undo my changes', async () => {
        await openChannels(remote, next, `${words['settings.channels']}${words['settings.channelsHint']}`);
        const channels = page.getByTestId('channels');
        await expect(channels).toHaveAttribute('data-count', '1');
        expect(await text(page, 'channels-intro')).toBe(words['channels.intro']);
        await expect(page.getByTestId('channels-clean')).toHaveAttribute('data-value', 'false');
        expect(await text(page, 'channels-clean-value')).toBe(words['channels.off']);
        expect(await text(page, 'channels-row-0-name')).toBe(renamed);
        expect(await text(page, 'channels-row-0-number')).toBe('42');
        expect(await text(page, 'channels-row-0-line')).toBe([words['groups.hidden'], words['channels.renamed'], words['channels.numbered']].join(' · '));
        await expect(page.getByTestId('channels-row-0')).toHaveAttribute('data-hidden', 'true');
        await expectInSafeArea(page, 'channels-list');
        await shoot(page, `channels-${tag}`);
        // "Clean channel names": on.
        await remote.press('OK');
        await expect(page.getByTestId('channels-clean')).toHaveAttribute('data-value', 'true');
        await settled(page.getByTestId('settings-screen'));
        expect(await text(page, 'channels-clean-value')).toBe(words['channels.on']);
        // The channel's menu: Show channel.
        await remote.go('DOWN', 'channels/rows/1');
        await remote.go('OK', 'channel-edit/actions/0');
        expect(await actions(page)).toEqual(['rename', 'number', 'show', 'reset', 'cancel']);
        await expect(page.getByTestId('channel-edit')).not.toHaveAttribute('data-over');
        await shoot(page, `channels-menu-${tag}`);
        await remote.go('DOWN', 'channel-edit/actions/1');
        await remote.go('DOWN', 'channel-edit/actions/2');
        await remote.go('OK', 'channels/rows/1');
        await settled(page.getByTestId('settings-screen'));
        await expect(page.getByTestId('channels-row-0')).toHaveAttribute('data-hidden', 'false');
        expect(await text(page, 'channels-row-0-line')).toBe([words['channels.renamed'], words['channels.numbered']].join(' · '));
        // Undo my changes: the row goes, the focus stays on the page.
        await remote.go('OK', 'channel-edit/actions/0');
        for (let i = 1; i <= 3; i += 1) await remote.go('DOWN', `channel-edit/actions/${i}`);
        expect(await text(page, 'channel-edit-reset')).toBe(words['channels.reset']);
        await remote.press('OK');
        await expect(channels).toHaveAttribute('data-count', '0');
        await settled(page.getByTestId('settings-screen'));
        await remote.expectFocus('channels/rows/0');
        expect(await text(page, 'channels-intro')).toBe(words['channels.none']);
        await shoot(page, `channels-none-${tag}`);
      });

      await test.step('the list: SMPTE back as the provider has it, and Clock’s name cleaned', async () => {
        await remote.go('BACK', 'settings/items/6');
        await remote.go('BACK', 'live/header/5');
        await remote.press('DOWN');
        await settled(live);
        await expect.poll(async () => (await shownRows(page)).slice(0, 3)).toEqual(['1 Lablo Test 1 SMPTE', '2 Lablo Test 2 Clock', '3 Lablo Test FR - Mire']);
        // (The 18+ channel still locked: step 38.)
        await expect(page.locator('[data-testid=live-meta] [data-n]')).toHaveAttribute('data-n', '11');
      });

      expect(errors).toEqual([]);
    } finally {
      await m.app.close();
    }
  });
}

test('shows only our strings, bracketed, in "Edit channel", its forms and "Channels", in the pseudo-locale (en-XA)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const m = await startMock();
  try {
    const remote = new RemoteDriver(page);
    const live = await addM3uAndWatch(remote, m.link, 'locale=en-XA');
    await settled(live);
    await remote.go('OK', 'player/actions/0');
    await openPencil(remote, 'RIGHT');
    expect(await untranslated(page, '[data-testid=player]')).toEqual([]);
    await shoot(page, 'channel-edit-panel-en-XA');
    // Rename's form.
    await remote.go('OK', 'channel-rename/field/0');
    expect(await untranslated(page, '[data-testid=channel-rename]')).toEqual([]);
    await shoot(page, 'channel-edit-rename-en-XA');
    await remote.go('BACK', 'channel-edit/actions/0');
    // The number's form, with its error.
    await remote.go('DOWN', 'channel-edit/actions/1');
    await remote.go('OK', 'channel-number/field/0');
    await remote.press('DIGIT_0');
    await remote.go('DOWN', 'channel-number/actions/0');
    await remote.press('OK');
    await expect(page.getByTestId('channel-number-field')).toHaveClass(/is-invalid/u);
    expect(await untranslated(page, '[data-testid=channel-number]')).toEqual([]);
    await shoot(page, 'channel-edit-number-en-XA');
    // A number, then Hide: the menu with all its actions.
    await remote.press('DIGIT_7');
    await remote.go('OK', 'player/actions/5');
    await remote.go('OK', 'channel-edit/actions/0');
    await expect(page.getByTestId('channel-edit')).toHaveAttribute('data-pending', '0');
    expect(await actions(page)).toEqual(['rename', 'number', 'hide', 'reset', 'cancel']);
    expect(await untranslated(page, '[data-testid=channel-edit]')).toEqual([]);
    await remote.go('DOWN', 'channel-edit/actions/1');
    await remote.go('DOWN', 'channel-edit/actions/2');
    await remote.go('OK', 'player/actions/5');
    await settled(page.getByTestId('player'));
    // The info bar's six buttons in words (the bar overflowed in en-XA before the pencil: "Picture" ends past the safe area).
    expect(await untranslated(page, '[data-testid=player-bar] .player__actions')).toEqual([]);
    await shoot(page, 'channel-edit-bar-en-XA');
    await remote.press('BACK');
    await remote.expectFocus('live/channels/0');
    // "Channels": the switch and the row, then the row's menu.
    await openChannels(remote, 'RIGHT');
    expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
    await shoot(page, 'channels-en-XA');
    await remote.go('DOWN', 'channels/rows/1');
    await remote.go('OK', 'channel-edit/actions/0');
    expect(await untranslated(page, '[data-testid=channel-edit]')).toEqual([]);
    await shoot(page, 'channels-menu-en-XA');
    await remote.go('BACK', 'channels/rows/1');
    // Settings' seventh row fits under the others.
    await remote.go('BACK', 'settings/items/6');
    await expectInSafeArea(page, 'settings-channels');
    expect(await untranslated(page, '[data-testid=settings]')).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await m.app.close();
  }
});
