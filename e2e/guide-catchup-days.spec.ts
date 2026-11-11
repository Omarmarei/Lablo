import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { programmes } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { Grid } from './guide-grid';
import { focused, readGrid as readAny } from './guide-grid';
import { guideOf, ordered } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The guide's catch-up days and the archive marks (RELAY step 25c) by keys, in English and
 * Arabic, after onboarding adds the mock provider's Xtream login. The mock's longest archive is
 * seven days ("Zoma Test 1 SMPTE", 101, and 112), so the guide reaches back to local midnight
 * seven days ago. Every programme gone by within its channel's archive days carries the
 * catch-up mark, named "Catch-up" in the cell's text; none on air, to come, older than the
 * archive, or on a channel without one. A programme six days back on 101 plays from the start:
 * its details say how many days it has left, and the mock's archive answers it from its start.
 * The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const MINUTE = 60_000;
const DAY = 1440;

const SAYS = {
  en: { mark: 'Catch-up', left: (n: number): string => (n === 0 ? 'Expires today' : n === 1 ? 'Expires in 1 day' : `Expires in ${n} days`) },
  ar: { mark: 'إعادة المشاهدة', left: (n: number): string => (n === 0 ? 'ينتهي اليوم' : n === 1 ? 'ينتهي خلال يوم واحد' : 'ينتهي خلال يومين') },
} as const;

interface ArchiveAnswer {
  readonly url: string;
  readonly status: number;
  readonly channel: number;
  readonly start: number;
}

let app: MockServer;
let host: string;
const answers: ArchiveAnswer[] = [];

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  // The real clock: the mock's guide and archive cover now.
  app = await mock({ now: () => Date.now() });
  app.addHook('onResponse', async (request, reply) => {
    const start = reply.getHeader('x-mock-archive-start');
    if (start === undefined) return;
    answers.push({ url: request.url, status: reply.statusCode, channel: Number(reply.getHeader('x-mock-archive-channel') ?? NaN), start: Number(start) });
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-screen', '.guide__header > *');
}

/** The page's clock in UTC minutes, and its local midnight `days` days back. */
function clock(page: Page, days: number): Promise<{ now: number; midnight: number }> {
  return page.evaluate((back) => {
    const d = new Date();
    return { now: Math.floor(d.getTime() / 60_000), midnight: Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime() / 60_000) };
  }, days);
}

/**
 * Each drawn cell's mark against the mock's archives: a programme that ended by `now` and
 * started within its channel's archive days has it, named `name`; nothing else does. A cell
 * that ends, or leaves the archive, within a minute of `now` may be drawn either way.
 */
function checkMarks(g: Grid, now: number, name: string): { marked: number; unmarked: number } {
  let marked = 0;
  let unmarked = 0;
  for (const c of g.cells) {
    const channel = ordered[c.row]!;
    const at = `row ${c.row} (${channel.id}) ${c.start}–${c.end}`;
    if (c.programme < 0) {
      expect(c.mark, at).toBeNull();
      continue;
    }
    const days = channel.archiveDays;
    if (Math.abs(c.end - now) <= 1 || (days > 0 && Math.abs(c.start - (now - days * DAY)) <= 1)) continue;
    const want = days > 0 && c.end <= now && c.start >= now - days * DAY;
    expect(c.mark, at).toBe(want ? name : null);
    expect(c.cls.split(' ').indexOf('is-archive') !== -1, at).toBe(want);
    if (want) marked += 1;
    else unmarked += 1;
  }
  return { marked, unmarked };
}

test.describe('the catch-up days in the guide and the archive marks (RELAY step 25c)', () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`reaches seven days back, marks the archive, and plays a programme six days back (${locale})`, async ({ page }) => {
      test.setTimeout(150_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      // Earlier in time: LEFT in English, RIGHT in Arabic.
      const back = dir === 'ltr' ? 'LEFT' : 'RIGHT';
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      await remote.go('UP', 'live/header/0');
      await remote.go('OK', 'guide/grid/0');
      const screen = page.getByTestId('guide-screen');
      await settled(screen);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const channel = ordered[0]!;
      expect([channel.id, channel.archiveDays, Math.max(...ordered.map((c) => c.archiveDays))]).toEqual([101, 7, 7]);

      // The range: from local midnight seven days back (the stored guide keeps 101's seven days).
      const { midnight: sevenBack } = await clock(page, 7);
      await expect(page.getByTestId('guide')).toHaveAttribute('data-from', String(sevenBack));
      const onAir = focused(await readGrid(page));

      // A programme back: the one gone by, marked, and the one on air not.
      await remote.press(back);
      await expect.poll(async () => focused(await readGrid(page)).end).toBe(onAir.start);
      await settled(screen);
      let g = await readGrid(page);
      let counts = checkMarks(g, (await clock(page, 0)).now, says.mark);
      expect(focused(g).mark).toBe(says.mark);
      expect(counts.marked).toBeGreaterThan(0);
      expect(counts.unmarked).toBeGreaterThan(0);

      /**
       * Back until the focused cell starts at `minute` or the range's start: the remaining hours'
       * presses, then the screen settles. (Days not read yet move by 30-minute slots, so a round
       * never passes `minute`: 101's programmes are an hour long, on the hour.)
       */
      const backTo = async (minute: number): Promise<void> => {
        for (let round = 0; round < 30; round += 1) {
          await settled(screen, 15_000);
          const g = await readGrid(page);
          const at = focused(g).start;
          if (at <= minute || g.time <= g.from) return;
          const n = Math.max(1, Math.floor((at - minute) / 60));
          for (let i = 0; i < n; i += 1) await remote.press(back);
        }
      };

      // Six days back on 101: 143 programmes of an hour further.
      const target = onAir.start - 6 * DAY;
      await backTo(target);
      g = await readGrid(page);
      const cell = focused(g);
      expect([cell.start, cell.end, cell.row]).toEqual([target, target + 60, 0]);
      // The cursor is in that cell, at its start or half an hour in: a press over a day not read
      // yet stops at a slot, and which days were read at each rest depends on the hour (step 26q).
      const placed = g.time;
      expect([target, target + 30]).toContain(placed);
      const mock = programmes(guideOf(channel)!, target * MINUTE, target * MINUTE + 1)[0]!;
      expect([mock.start, mock.title]).toEqual([target * MINUTE, cell.title]);
      // This far back, 101's programmes are all in its archive. (The mock's guide reaches back
      // only as far as each channel's own archive, so the other rows have no programmes here.)
      counts = checkMarks(g, (await clock(page, 0)).now, says.mark);
      const own = g.cells.filter((c) => c.row === 0 && c.programme >= 0);
      expect(own.length).toBeGreaterThan(1);
      expect(own.every((c) => c.mark === says.mark)).toBe(true);
      expect(counts.marked).toBeGreaterThanOrEqual(own.length);
      // The mark sits inside its cell, before the title on the language's side.
      const box = await page.evaluate(() => {
        const at = document.querySelector('[data-testid=guide] .z-guide__cell[data-state=focused]')!;
        const r = (el: Element) => el.getBoundingClientRect();
        const mark = r(at.querySelector('.z-guide__mark')!);
        const title = r(at.querySelector('.z-guide__title')!);
        const c = r(at);
        return { cell: [c.left, c.right, c.top, c.bottom], mark: [mark.left, mark.right, mark.top, mark.bottom], title: [title.left, title.right] };
      });
      expect(box.mark[1]! - box.mark[0]!).toBeCloseTo(20, 0);
      expect(box.mark[0]!).toBeGreaterThan(box.cell[0]!);
      expect(box.mark[1]!).toBeLessThan(box.cell[1]!);
      expect(box.mark[2]!).toBeGreaterThan(box.cell[2]!);
      expect(box.mark[3]!).toBeLessThan(box.cell[3]!);
      if (dir === 'ltr') expect(box.mark[1]!).toBeLessThanOrEqual(box.title[0]! + 0.5);
      else expect(box.mark[0]!).toBeGreaterThanOrEqual(box.title[1]! - 0.5);
      await page.screenshot({ path: path.join(SHOTS, `guide-catchup-days-${locale}.png`), animations: 'disabled' });

      // Its details: "From the start", and the days it has left.
      await remote.go('OK', 'programme/actions/0');
      await settled(screen);
      await expect(page.getByTestId('programme-archive')).toHaveAttribute('data-state', 'focused');
      const left = await page.evaluate((start) => {
        const leaves = new Date((start + 7 * 1440) * 60_000);
        const today = new Date();
        return Math.round((Date.UTC(leaves.getFullYear(), leaves.getMonth(), leaves.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
      }, target);
      expect(left).toBeLessThanOrEqual(1);
      await expect(page.getByTestId('programme-left')).toHaveAttribute('data-days', String(left));
      await expect(page.getByTestId('programme-left')).toHaveText(says.left(left));
      await page.screenshot({ path: path.join(SHOTS, `guide-catchup-days-${locale}-details.png`), animations: 'disabled' });

      // OK: the mock's archive serves the programme from its start.
      const asked = answers.length;
      await remote.go('OK', 'player/seek/0');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-archive', String(target));
      await expect.poll(() => answers.length).toBeGreaterThan(asked);
      for (const a of answers.slice(asked)) expect([a.status, a.channel, a.start]).toEqual([200, 101, target * 60]);
      expect(answers[asked]!.url).toMatch(new RegExp(`^/timeshift/${U}/${P}/60/\\d{4}-\\d{2}-\\d{2}:\\d{2}-\\d{2}/101\\.ts$`));
      await expect(page.getByTestId('player-archive')).toContainText(cell.title);
      await remote.go('BACK', 'guide/grid/0');
      // Back where it was: the same cursor, on the programme that played.
      const after = await readGrid(page);
      expect([after.time, focused(after).start]).toEqual([placed, target]);

      // On to the range's start: the cursor stops at local midnight seven days back.
      await backTo(sevenBack);
      for (let i = 0; i < 3; i += 1) await remote.press(back);
      await settled(screen);
      g = await readGrid(page);
      expect(g.time).toBe(sevenBack);
      expect(g.view).toBe(sevenBack);
      // Older than the archive: nothing marked.
      const end = (await clock(page, 0)).now;
      checkMarks(g, end, says.mark);
      expect(g.cells.filter((c) => c.mark !== null && c.start < end - 7 * DAY - 1)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
