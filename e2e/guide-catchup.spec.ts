import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { programmes } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { Grid } from './guide-grid';
import { SAFE, focused, readGrid as readAny } from './guide-grid';
import { guideOf, ordered } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Catch-up from the guide (RELAY step 25a) by keys, in English and Arabic, after onboarding adds
 * the mock provider's Xtream login: a programme gone by on "Lablo Test 1 SMPTE" (101, seven days
 * of archive) opens its details with "From the start" first; OK on it plays the programme
 * from the archive. The mock's archive answers (`X-Mock-Archive-*`) show the window it was asked
 * for: the programme's own start, and at least its length. The info bar names the programme, and
 * Back comes back to the guide on the same cell. A programme gone by on a channel without
 * catch-up has no such button. On a panel in Kathmandu (+05:45, the mock's `odd-timezone`), the
 * timeshift URL's start is that zone's wall time and the mock still serves the programme's own
 * start. The mock's media here is synthetic (no picture): `e2e:media` plays a real one. The
 * screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const MINUTE = 60_000;

const SAYS = {
  en: { archive: 'From the start', watch: 'Watch the channel', mapping: 'Guide channel', close: 'Close' },
  ar: { archive: 'من البداية', watch: 'شاهد القناة', mapping: 'قناة الدليل', close: 'إغلاق' },
} as const;

/** One archive answer of the mock: the path asked and the window it served. */
interface ArchiveAnswer {
  readonly url: string;
  readonly status: number;
  readonly channel: number;
  readonly start: number;
  readonly duration: number;
}

interface Mock {
  readonly app: MockServer;
  /** `host:port`, typed the way a user would (no `http://`). */
  readonly host: string;
  readonly answers: ArchiveAnswer[];
}

/** The mock on the real clock (as guide.spec.ts: its guide and archive cover now), its archive answers recorded. */
async function startMock(scenario?: string): Promise<Mock> {
  const app = await mock({ now: () => Date.now(), ...(scenario === undefined ? {} : { scenario }) });
  const answers: ArchiveAnswer[] = [];
  // Before listen: the hook sees every answer.
  app.addHook('onResponse', async (request, reply) => {
    const start = reply.getHeader('x-mock-archive-start');
    if (request.url.indexOf('/timeshift/') === -1 && start === undefined) return;
    answers.push({
      url: request.url,
      status: reply.statusCode,
      channel: Number(reply.getHeader('x-mock-archive-channel') ?? NaN),
      start: Number(start ?? NaN),
      duration: Number(reply.getHeader('x-mock-archive-duration') ?? NaN),
    });
  });
  const host = (await listen(app)).replace(/^http:\/\//, '');
  return { app, host, answers };
}

let utc: Mock;
let kathmandu: Mock;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  utc = await startMock();
  kathmandu = await startMock('odd-timezone');
});
test.afterAll(async () => {
  await utc.app.close();
  await kathmandu.app.close();
});

function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-screen', '.guide__header > *');
}

interface Buttons {
  readonly ids: string[];
  readonly texts: string[];
  readonly lefts: number[];
  /** Each button's top (one line: all equal). */
  readonly tops: number[];
  readonly cut: string[];
  readonly outside: string[];
  /** Buttons not inside the panel's padding box (the panel's 48 px padding). */
  readonly outOfPanel: string[];
}

/** The details dialog's buttons in order, their texts and left edges, any cut or outside the safe area. */
function readButtons(page: Page): Promise<Buttons> {
  return page.evaluate((safe) => {
    const root = document.querySelector('[data-testid=programme]')!;
    const buttons = Array.from(root.querySelectorAll('.z-dialog__actions .z-button'));
    const outside: string[] = [];
    root.querySelectorAll('.z-dialog__panel, .z-dialog__panel *').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return;
      if (b.left < safe.left - 0.5 || b.top < safe.top - 0.5 || b.right > safe.right + 0.5 || b.bottom > safe.bottom + 0.5) outside.push(el.className || el.tagName);
    });
    const panel = root.querySelector('.z-dialog__panel')!.getBoundingClientRect();
    const inner = { left: panel.left + 48 + 2, right: panel.right - 48 - 2 };
    return {
      ids: buttons.map((el) => el.getAttribute('data-testid') ?? ''),
      texts: buttons.map((el) => el.textContent ?? ''),
      lefts: buttons.map((el) => el.getBoundingClientRect().left),
      tops: buttons.map((el) => el.getBoundingClientRect().top),
      cut: buttons.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent ?? ''),
      outside,
      outOfPanel: buttons
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.left < inner.left - 0.5 || b.right > inner.right + 0.5;
        })
        .map((el) => el.getAttribute('data-testid') ?? ''),
    };
  }, SAFE);
}

test.describe('catch-up from the guide (RELAY step 25a)', () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`plays a programme gone by from the archive, from its details (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const back = dir === 'ltr' ? 'LEFT' : 'RIGHT';
      const { host, answers } = utc;
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      await remote.go('UP', 'live/header/0');
      await remote.go('OK', 'guide/grid/0');
      const screen = page.getByTestId('guide-screen');
      await settled(screen);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const channel = ordered[0]!;
      expect([channel.id, channel.archiveDays]).toEqual([101, 7]);
      const onAir = focused(await readGrid(page));

      // A cell back from now: the programme gone by before the one on air.
      await remote.press(back);
      await expect.poll(async () => focused(await readGrid(page)).end).toBe(onAir.start);
      const grid = await readGrid(page);
      const before = focused(grid);
      expect(before.end * MINUTE).toBeLessThanOrEqual(Date.now());
      const mock = programmes(guideOf(channel)!, before.start * MINUTE, before.start * MINUTE + 1)[0]!;
      expect([mock.start, mock.stop, mock.title]).toEqual([before.start * MINUTE, before.end * MINUTE, before.title]);

      // Its details: "From the start" first and focused, then the other three, on one line inside the panel.
      await remote.go('OK', 'programme/actions/0');
      await settled(screen);
      const b = await readButtons(page);
      expect(b.ids).toEqual(['programme-archive', 'programme-watch', 'programme-map', 'programme-close']);
      expect(b.texts).toEqual([says.archive, says.watch, says.mapping, says.close]);
      // In the language's order: left to right in English, right to left in Arabic.
      for (let i = 1; i < b.lefts.length; i += 1) {
        if (dir === 'ltr') expect(b.lefts[i]!).toBeGreaterThan(b.lefts[i - 1]!);
        else expect(b.lefts[i]!).toBeLessThan(b.lefts[i - 1]!);
      }
      expect(b.cut).toEqual([]);
      expect(b.outside).toEqual([]);
      expect(b.outOfPanel).toEqual([]);
      expect(new Set(b.tops).size).toBe(1);
      // The first line starts at the panel's padding, on the language's side.
      const panel = await page.locator('[data-testid=programme] .z-dialog__panel').boundingBox();
      const archiveBox = await page.getByTestId('programme-archive').boundingBox();
      if (dir === 'ltr') expect(archiveBox!.x - panel!.x).toBeCloseTo(48 + 2, 0);
      else expect(panel!.x + panel!.width - (archiveBox!.x + archiveBox!.width)).toBeCloseTo(48 + 2, 0);
      await expect(page.getByTestId('programme-archive')).toHaveAttribute('data-state', 'focused');
      await page.screenshot({ path: path.join(SHOTS, `guide-catchup-details-${locale}.png`), animations: 'disabled' });

      // OK: the player over the guide, playing the programme from the archive.
      const asked = answers.length;
      await remote.go('OK', 'player/seek/0');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-playing', '0');
      await expect(player).toHaveAttribute('data-archive', String(before.start));
      // The mock served the programme's window: from its start, at least its length (whole minutes).
      await expect.poll(() => answers.length).toBeGreaterThan(asked);
      const mine = answers.slice(asked);
      const first = mine[0]!;
      expect(first.url).toMatch(new RegExp(`^/timeshift/${U}/${P}/${before.end - before.start}/\\d{4}-\\d{2}-\\d{2}:\\d{2}-\\d{2}/101\\.ts$`));
      for (const a of mine) expect([a.status, a.channel, a.start, a.duration >= (before.end - before.start) * 60]).toEqual([200, 101, before.start * 60, true]);
      // The info bar names the programme, with its day and times, not the channel's now/next.
      const bar = page.getByTestId('player-archive');
      await expect(bar).toContainText(before.title);
      await expect(page.getByTestId('player-name')).toHaveText(channel.name);
      await expect(page.getByTestId('player-next')).toHaveCount(0);
      const times = await bar.locator('.player__time').textContent();
      expect(times).toContain(' · ');
      await page.screenshot({ path: path.join(SHOTS, `guide-catchup-player-${locale}.png`), animations: 'disabled' });

      // Back: the guide on the same cell, the details closed.
      await remote.go('BACK', 'guide/grid/0');
      await expect(player).toHaveCount(0);
      await expect(page.getByTestId('programme')).toHaveCount(0);
      expect((await readGrid(page)).time).toBe(grid.time);

      // A programme gone by on a channel without catch-up ("Lablo Test FR - Mire", row 2): no such button.
      expect([ordered[2]!.id, ordered[2]!.archiveDays]).toEqual([110, 0]);
      await remote.go('DOWN', 'guide/grid/1');
      await remote.go('DOWN', 'guide/grid/2');
      await settled(screen);
      const other = focused(await readGrid(page));
      expect(other.end * MINUTE).toBeLessThanOrEqual(Date.now());
      await remote.go('OK', 'programme/actions/0');
      expect((await readButtons(page)).ids).toEqual(['programme-watch', 'programme-map', 'programme-close']);
      await remote.go('BACK', 'guide/grid/2');
      // Every archive answer since the OK was the programme's window (the .ts form, then the .m3u8).
      for (const a of answers.slice(asked)) expect([a.status, a.channel, a.start]).toEqual([200, 101, before.start * 60]);
      expect(errors).toEqual([]);
    });
  }

  test('keeps the four buttons inside the panel in the pseudo-locale, a line of their own if need be (en-XA)', async ({ page }) => {
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host: utc.host, username: U, password: P }, 'locale=en-XA');
    await settled(live);
    await remote.go('UP', 'live/header/0');
    await remote.go('OK', 'guide/grid/0');
    const screen = page.getByTestId('guide-screen');
    await settled(screen);
    const onAir = focused(await readGrid(page));
    await remote.press('LEFT');
    await expect.poll(async () => focused(await readGrid(page)).end).toBe(onAir.start);
    await remote.go('OK', 'programme/actions/0');
    await settled(screen);
    const b = await readButtons(page);
    expect(b.ids).toEqual(['programme-archive', 'programme-watch', 'programme-map', 'programme-close']);
    expect(b.texts.every((text) => text.startsWith('[') && text.endsWith(']'))).toBe(true);
    expect(b.cut).toEqual([]);
    expect(b.outside).toEqual([]);
    expect(b.outOfPanel).toEqual([]);
    // Every line starts at the panel's padding.
    const panel = (await page.locator('[data-testid=programme] .z-dialog__panel').boundingBox())!;
    const lines = [...new Set(b.tops)];
    for (const top of lines) expect(Math.min(...b.lefts.filter((_left, i) => b.tops[i] === top)) - panel.x).toBeCloseTo(48 + 2, 0);
    await page.screenshot({ path: path.join(SHOTS, 'guide-catchup-details-en-XA.png'), animations: 'disabled' });
  });

  test("writes the timeshift start in the panel's zone: Kathmandu, +05:45 (en-US)", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    const { host, answers } = kathmandu;
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
    await settled(live);
    await remote.go('UP', 'live/header/0');
    await remote.go('OK', 'guide/grid/0');
    const screen = page.getByTestId('guide-screen');
    await settled(screen);
    const onAir = focused(await readGrid(page));
    await remote.press('LEFT');
    await expect.poll(async () => focused(await readGrid(page)).end).toBe(onAir.start);
    const before = focused(await readGrid(page));
    // The guide (written without offsets, read in the panel's zone) shows the mock's own times.
    const mock = programmes(guideOf(ordered[0]!)!, before.start * MINUTE, before.start * MINUTE + 1)[0]!;
    expect([mock.start, mock.title]).toEqual([before.start * MINUTE, before.title]);
    await remote.go('OK', 'programme/actions/0');
    await expect(page.getByTestId('programme-archive')).toBeVisible();
    const asked = answers.length;
    await remote.go('OK', 'player/seek/0');
    await expect(page.getByTestId('player')).toHaveAttribute('data-archive', String(before.start));
    await expect.poll(() => answers.length).toBeGreaterThan(asked);
    // The start as Kathmandu's wall time: 5 h 45 min ahead of UTC.
    const wall = new Date((before.start + 345) * MINUTE).toISOString();
    const stamp = `${wall.slice(0, 10)}:${wall.slice(11, 13)}-${wall.slice(14, 16)}`;
    const first = answers[asked]!;
    expect(first.url).toBe(`/timeshift/${U}/${P}/${before.end - before.start}/${stamp}/101.ts`);
    for (const a of answers.slice(asked)) expect([a.status, a.channel, a.start]).toEqual([200, 101, before.start * 60]);
    await remote.go('BACK', 'guide/grid/0');
    expect(errors).toEqual([]);
  });
});
