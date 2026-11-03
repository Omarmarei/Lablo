import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { LiveChannel } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import { upcoming } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { ARABIC_FACE, LATIN_FACE, renderedFontsUnder } from './fonts';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The live screen (RELAY step 14a) by keys, after onboarding adds the mock provider's Xtream
 * login: the category rail, the virtual channel list with the panel's numbers, and now/next from
 * the panel's guide. The mock runs on the real clock here (the other e2e tests pin it), so its
 * guide covers the browser's "now", as a real panel's does. The `RemoteDriver` presses the keys
 * and reads the focus from the focus engine (step 14b); live-throttled.spec.ts times them.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const catalog = loadCatalog();
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
const VISIBLE = 9;

let app: MockServer;
/** The mock's `host:port`, typed the way a user would (no `http://`). */
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

/** The channels in the order "All channels" lists them: category by category, as the panel lists them. */
const ordered: LiveChannel[] = catalog.liveCategories.flatMap((c) => catalog.live.filter((ch) => ch.categoryId === c.id));
const withChannels = catalog.liveCategories.filter((c) => catalog.live.some((ch) => ch.categoryId === c.id));

/**
 * The channel whose programmes a channel shows: the guide's channel of its id (the first channel
 * that declares it, as the mock writes its XMLTV), or by its match name ("Zoma Sports Test FHD"
 * has no id but matches "Zoma Sports Test HD"). `null`: no guide ("18+ Test Pattern").
 */
function guideOf(channel: LiveChannel): LiveChannel | null {
  const id = (c: LiveChannel): string | null => (c.xmltvId ?? c.epgId)?.toLowerCase() ?? null;
  const own = id(channel);
  if (own !== null) return catalog.live.find((c) => id(c) === own) ?? null;
  if (channel.name === 'Zoma Sports Test FHD') return catalog.live.find((c) => c.name === 'Zoma Sports Test HD') ?? null;
  return null;
}

/** The titles a row may show now: the programme on air when the check started or when it ended. */
function nowTitles(channel: LiveChannel, from: number, to: number): string[] {
  const guide = guideOf(channel);
  if (guide === null) return [];
  return [upcoming(guide, from, 1)[0]!.title, upcoming(guide, to, 1)[0]!.title];
}

/** Onboarding by keys with the mock's Xtream login, then "Start watching": the live screen. */
function addSourceAndWatch(remote: RemoteDriver, locale: string): Promise<Locator> {
  return addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
}

interface Row {
  readonly index: number;
  readonly number: string;
  readonly name: string;
  readonly now: string;
  readonly nowTitle: string | null;
  readonly next: string | null;
  readonly state: string;
}

/** The rows the list draws, in order. */
function rows(page: Page): Promise<Row[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid=channels] .z-vlist__item')).map((item) => {
      const text = (selector: string): string | null => item.querySelector(selector)?.textContent ?? null;
      return {
        index: Number(item.getAttribute('data-index')),
        number: text('.z-row__number') ?? '',
        name: text('.z-row__name') ?? '',
        now: text('.z-row__now') ?? '',
        nowTitle: text('.z-row__now .z-row__title'),
        next: text('.z-row__next .z-row__title'),
        state: item.querySelector('.z-row')?.getAttribute('data-state') ?? '',
      };
    }),
  );
}

interface Layout {
  readonly scroll: readonly [number, number];
  readonly outside: string[];
  readonly cut: string[];
}

/** Every box inside the safe area, no page scroll, none of our labels cut. */
function layout(page: Page): Promise<Layout> {
  return page.evaluate((safe) => {
    const name = (el: Element): string => `${el.className}: ${(el.textContent ?? '').slice(0, 40)}`;
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.z-chip, .z-row, .live__title, .live__meta, .live__clock, .z-button'))) {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left || r.top < safe.top || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(name(el));
    }
    const cut = Array.from(document.querySelectorAll('.live__title, .live__clock, .z-chip__label:not([translate="no"]), .z-row__next-head'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(name);
    return { scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const, outside, cut };
  }, SAFE);
}

/**
 * In en-XA every string of ours is bracketed: any other text with letters is hard-coded. The
 * formatter's times (`11:45 PM`, after "Next ·" too) are the locale's format, not catalog text.
 */
function untranslated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid=live]');
    if (root === null) return ['no live screen'];
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(text) || node.parentElement?.closest('[translate="no"]') != null) continue;
      if (/^(· )?\d{1,2}:\d{2} [AP]M$/.test(text)) continue;
      if (!(text.startsWith('[') && text.endsWith(']'))) out.push(text);
    }
    return out;
  });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `live-${name}.png`), animations: 'disabled' });
}

/** Checks the rows on show against the mock: numbers, names, and now/next from its guide. */
async function checkRows(page: Page, root: Locator, from: number, placeholder: string): Promise<void> {
  await settled(root);
  const before = Date.now();
  const drawn = await rows(page);
  const after = Date.now();
  expect(drawn.map((r) => r.index)).toEqual(Array.from({ length: Math.min(VISIBLE, ordered.length - from) }, (_v, i) => from + i));
  for (const row of drawn) {
    const channel = ordered[row.index]!;
    expect(row.number, channel.name).toBe(String(channel.num));
    expect(row.name).toBe(channel.name);
    const titles = nowTitles(channel, before - 60_000, after);
    if (titles.length === 0) {
      expect(row.nowTitle, channel.name).toBeNull();
      expect(row.now, channel.name).toBe(placeholder);
    } else {
      expect(titles, channel.name).toContain(row.nowTitle);
      expect(row.next, channel.name).not.toBeNull();
    }
  }
}

test.describe('the live screen by keys (pnpm dev, after onboarding)', () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`browses the mock's categories and channels in ${language} (${locale})`, async ({ page }) => {
      const errors = trackErrors(page);
      const ar = language === 'ar';
      const remote = new RemoteDriver(page);
      const root = await addSourceAndWatch(remote, locale);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(root).toHaveAttribute('data-language', language);
      await remote.expectFocus('live/channels/0');

      // The rail: every channel first, then the panel's categories with their counts.
      const chips = page.locator('[data-testid=rail] .z-chip');
      await expect(chips).toHaveCount(1 + withChannels.length);
      await expect(chips.nth(0).locator('.z-chip__label')).toHaveText(ar ? 'كل القنوات' : 'All channels');
      await expect(chips.nth(0).locator('.z-chip__count')).toHaveText(String(catalog.live.length));
      await expect(chips.nth(0)).toHaveClass(/is-selected/);
      for (const [i, category] of withChannels.entries()) {
        await expect(chips.nth(i + 1).locator('.z-chip__label')).toHaveText(category.name);
        await expect(chips.nth(i + 1).locator('.z-chip__label')).toHaveAttribute('translate', 'no');
        await expect(chips.nth(i + 1).locator('.z-chip__count')).toHaveText(String(catalog.live.filter((c) => c.categoryId === category.id).length));
      }
      const meta = page.getByTestId('live-meta');
      await expect(meta.locator('[data-n]')).toHaveAttribute('data-n', String(catalog.live.length));
      if (!ar) await expect(meta).toHaveText(`All channels · ${catalog.live.length} channels`);

      // The list: the panel's numbers and names, and now/next from its guide (the 18+ channel has none).
      const placeholder = ar ? 'لا يوجد دليل لهذه القناة' : 'No guide for this channel';
      await checkRows(page, root, 0, placeholder);
      expect((await rows(page))[0]!.state).toBe('focused');
      // The rail sits at the inline start: on the right in Arabic.
      const railBox = (await page.getByTestId('rail').boundingBox())!;
      const listBox = (await page.getByTestId('channels').boundingBox())!;
      expect(ar ? railBox.x > listBox.x : railBox.x < listBox.x).toBe(true);
      expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
      await shot(page, locale);
      const faces = (await renderedFontsUnder(page, '[data-testid=live]')).map((f) => [f.familyName, f.isCustomFont]);
      expect(faces).toContainEqual([LATIN_FACE, true]);
      expect(faces).toContainEqual([ARABIC_FACE, true]);
      expect(faces.every(([, custom]) => custom)).toBe(true);

      // Down the list, then a page (CH−) to its end: the last rows, the 18+ channel's placeholder.
      await remote.press('DOWN', 'DOWN');
      await remote.expectFocus('live/channels/2');
      await remote.go('CH_DOWN', `live/channels/${ordered.length - 1}`);
      await expect(page.getByTestId('channels')).toHaveAttribute('data-top', String(ordered.length - VISIBLE));
      await checkRows(page, root, ordered.length - VISIBLE, placeholder);
      // CH+ pages up by a window (9 rows), then stops at the top.
      await remote.go('CH_UP', `live/channels/${ordered.length - 1 - VISIBLE}`);
      await remote.go('CH_UP', 'live/channels/0');

      // To the rail (LEFT, mirrored in Arabic: the RIGHT key), down to the kids' category, OK: its one channel.
      await remote.go(ar ? 'RIGHT' : 'LEFT', 'live/rail/0');
      const kids = withChannels.findIndex((c) => c.name.startsWith('Kids')) + 1;
      for (let i = 0; i < kids; i++) await remote.press('DOWN');
      await remote.expectFocus(`live/rail/${kids}`);
      await remote.press('OK');
      await expect(root).toHaveAttribute('data-category', String(kids));
      await remote.expectFocus('live/channels/0');
      await expect(meta.locator('.live__category')).toHaveText(withChannels[kids - 1]!.name);
      await expect(meta.locator('[data-n]')).toHaveAttribute('data-n', '1');
      if (!ar) await expect(meta).toHaveText(`${withChannels[kids - 1]!.name} · 1 channel`);
      await settled(root);
      const kidsRows = await rows(page);
      expect(kidsRows.map((r) => [r.number, r.name])).toEqual([['5', 'Zoma Kids Test']]);
      expect(nowTitles(catalog.live.find((c) => c.name === 'Zoma Kids Test')!, Date.now() - 60_000, Date.now())).toContain(kidsRows[0]!.nowTitle);
      await shot(page, `${locale}-category`);

      // OK on a channel marks it (the player opens it from step 20 on).
      await remote.press('OK');
      await expect(root).toHaveAttribute('data-selected', /^x:s1:live:/);

      // Back: the rail on the category on show, then the exit dialog; Stay keeps the screen.
      await remote.go('BACK', `live/rail/${kids}`);
      await remote.go('BACK', 'exit/buttons/0');
      await expect(page.getByTestId('exit-dialog')).toBeVisible();
      await remote.go('OK', `live/rail/${kids}`);
      // Back to every channel: the list starts at its top.
      for (let i = 0; i < kids; i++) await remote.press('UP');
      await remote.expectFocus('live/rail/0');
      await remote.press('OK');
      await expect(root).toHaveAttribute('data-category', '0');
      await remote.expectFocus('live/channels/0');
      await expect(page.getByTestId('channels')).toHaveAttribute('data-top', '0');

      // A relaunch opens the live screen in the language picked, without onboarding.
      await page.reload();
      await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
      await expect(page.getByTestId('onboarding')).toHaveCount(0);
      await expect(page.getByTestId('live')).toHaveAttribute('data-language', language);
      await remote.expectFocus('live/channels/0');
      await settled(page.getByTestId('live'));
      expect(errors).toEqual([]);
    });
  }

  test('shows only our strings, bracketed, in the pseudo-locale (en-XA)', async ({ page }) => {
    const root = await addSourceAndWatch(new RemoteDriver(page), 'en-XA');
    await expect(root).toHaveAttribute('data-language', 'pseudo');
    await settled(root);
    expect(await untranslated(page)).toEqual([]);
    // The provider's text is marked as such: names, titles, category names.
    const header = stripIsolates((await page.getByTestId('live-meta').textContent()) ?? '');
    expect(header).toMatch(/^\[.+\] · \[.+\]$/u);
    expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
    await shot(page, 'en-XA');
  });
});
