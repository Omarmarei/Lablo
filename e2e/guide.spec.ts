import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { programmes } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { Grid } from './guide-grid';
import { ROWS, SAFE, SPAN, checkGeometry, focused, readGrid as readAny } from './guide-grid';
import { guideOf, ordered } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The guide screen (RELAY step 23c) by keys, after onboarding adds the mock provider's Xtream
 * login: the live screen's header "Guide", the grid over "All channels" with the mock's schedule
 * in its cells (the mock runs on the real clock, as in live.spec.ts, so its guide covers now),
 * the remote across rows and time, OK on the programme on air (the player), and Back. The
 * screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const MINUTE = 60_000;
/** The header above the grid: `GUIDE.headerHeight` in guide-state.ts (its 9 rows fit under it). */
const HEADER = 110;

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

const SAYS = {
  en: { open: 'Guide', title: 'Guide', noInfo: 'No information' },
  ar: { open: 'الدليل', title: 'دليل البرامج', noInfo: 'لا توجد معلومات' },
} as const;

/** The guide screen's grid (e2e/guide-grid.ts reads it, and checks it against GUIDE_LAYOUT). */
function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-screen', '.guide__header > *');
}

/**
 * Each drawn row against the mock: the channel's number and name, and in its timeline the
 * mock's programmes over the view, with their own times and titles. A channel the guide doesn't
 * match ("18+ Test Pattern") has only placeholders.
 */
function checkSchedule(g: Grid, noInfo: string): void {
  for (const row of g.rows) {
    const channel = ordered[row.row]!;
    expect(row.name).toBe(channel.name);
    expect(row.number).toBe(String(channel.num));
    const cells = g.cells.filter((c) => c.row === row.row);
    const guide = guideOf(channel);
    const want = guide === null ? [] : programmes(guide, g.view * MINUTE, (g.view + SPAN) * MINUTE);
    if (want.length === 0) {
      expect(
        cells.every((c) => c.programme === -1 && c.title === noInfo),
        channel.name,
      ).toBe(true);
      continue;
    }
    expect(
      cells.map((c) => [c.start, c.end, c.title]),
      channel.name,
    ).toEqual(want.map((p) => [p.start / MINUTE, p.stop / MINUTE, p.title]));
  }
}

/** None of the header's labels cut. */
function cutLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.guide__title, .guide__clock, .guide__when'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.className),
  );
}

test.describe('the guide screen by keys (pnpm dev, after onboarding)', () => {
  for (const [locale, language, dir, forward] of [
    ['en-US', 'en', 'ltr', 'RIGHT'],
    ['ar-SA', 'ar', 'rtl', 'LEFT'],
  ] as const) {
    test(`opens from the header, draws the mock's schedule, plays on air and goes back (${locale})`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);

      // UP from the list's first row: the header's "Guide", before "Settings".
      await remote.go('UP', 'live/header/0');
      await expect(page.getByTestId('live-guide')).toHaveText(says.open);
      await remote.go('OK', 'guide/grid/0');
      const screen = page.getByTestId('guide-screen');
      await expect(screen).toHaveAttribute('data-language', language);
      await settled(screen);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      // At now: the cursor on the minute it opened, the view from its slot, every channel a row.
      const opened = Math.floor(Date.now() / MINUTE);
      let g = await readGrid(page);
      expect(g.dir).toBe(dir);
      expect(g.count).toBe(ordered.length);
      expect(g.box.top - SAFE.top).toBeCloseTo(HEADER, 0);
      expect(Math.abs(g.time - opened)).toBeLessThanOrEqual(1);
      expect(g.time - g.view).toBeGreaterThanOrEqual(0);
      expect(g.time - g.view).toBeLessThan(30);
      expect(Math.abs(g.now!.minute - g.time)).toBeLessThanOrEqual(1);
      checkGeometry(g);
      checkSchedule(g, says.noInfo);
      let cell = focused(g);
      expect(cell.row).toBe(0);
      expect(cell.start).toBeLessThanOrEqual(g.time);
      expect(cell.end).toBeGreaterThan(g.time);
      // The header: the title, the focused channel, its programme on air.
      await expect(page.locator('.guide__title')).toHaveText(says.title);
      await expect(page.getByTestId('guide-channel')).toContainText(ordered[0]!.name);
      await expect(page.getByTestId('guide-details')).toContainText(cell.title);
      expect(await cutLabels(page)).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `guide-${locale}.png`), animations: 'disabled' });

      // OK on the programme on air plays the channel; Back from the player comes back here.
      await remote.go('OK', 'player/actions/0');
      await expect(page.getByTestId('player')).toHaveAttribute('data-playing', '0');
      await remote.go('BACK', 'guide/grid/0');
      await expect(page.getByTestId('player')).toHaveCount(0);

      // The next programme: the cursor at its start, the header with it. OK there plays nothing.
      await remote.press(forward);
      await expect.poll(async () => (await readGrid(page)).time).toBe(cell.end);
      g = await readGrid(page);
      expect(focused(g)).toMatchObject({ row: 0, start: cell.end });
      await expect(page.getByTestId('guide-details')).toContainText(focused(g).title);
      await remote.press('OK');
      await remote.expectFocus('guide/grid/0');
      await expect(page.getByTestId('player')).toHaveCount(0);

      // DOWN keeps the cursor: the next row's cell that holds it.
      await remote.go('DOWN', 'guide/grid/1');
      g = await readGrid(page);
      cell = focused(g);
      expect(cell.row).toBe(1);
      expect(cell.start).toBeLessThanOrEqual(g.time);
      expect(cell.end).toBeGreaterThan(g.time);
      await expect(page.getByTestId('guide-channel')).toContainText(ordered[1]!.name);

      // CH−: a page of rows (to the list's end); their programmes are asked and drawn.
      const paged = Math.min(1 + ROWS, ordered.length - 1);
      await remote.go('CH_DOWN', `guide/grid/${paged}`);
      await settled(screen);
      g = await readGrid(page);
      expect(g.top).toBe(Math.max(0, Math.min(ROWS, ordered.length - ROWS)));
      checkGeometry(g);
      checkSchedule(g, says.noInfo);

      // On through the programmes until the view moves on: those cells come from the guide too.
      const view = g.view;
      for (let i = 0; i < 20 && (await readGrid(page)).view === view; i += 1) await remote.press(forward);
      await settled(screen);
      g = await readGrid(page);
      expect(g.view).toBeGreaterThan(view);
      expect(g.now).toBeNull();
      checkGeometry(g);
      checkSchedule(g, says.noInfo);
      expect(focused(g).start).toBe(g.time);

      // Back: the live list, on the channel the guide had focused.
      await remote.go('BACK', `live/channels/${paged}`);
      await expect(page.locator(`[data-testid=channels] [data-testid=row-${paged}] .z-row__name`)).toHaveText(ordered[paged]!.name);
      expect(errors).toEqual([]);
    });
  }

  test('shows only our strings, bracketed, in the pseudo-locale (en-XA)', async ({ page }) => {
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-XA');
    await settled(live);
    await remote.go('UP', 'live/header/0');
    await remote.go('OK', 'guide/grid/0');
    const screen = page.getByTestId('guide-screen');
    await expect(screen).toHaveAttribute('data-language', 'pseudo');
    await settled(screen);
    const found = await page.evaluate(() => {
      const root = document.querySelector('[data-testid=guide-screen]')!;
      const out: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.nodeValue ?? '').trim();
        if (!/\p{L}/u.test(text) || node.parentElement?.closest('[translate="no"]') != null) continue;
        // The locale's own formats: times, ranges and the day, not catalog text.
        if (/^\d{1,2}:\d{2} [AP]M( – \d{1,2}:\d{2} [AP]M)?$/.test(text) || /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/.test(text)) continue;
        if (!(text.startsWith('[') && text.endsWith(']'))) out.push(text);
      }
      return out;
    });
    expect(found).toEqual([]);
    expect(await cutLabels(page)).toEqual([]);
  });
});
