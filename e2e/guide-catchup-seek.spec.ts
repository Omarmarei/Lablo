import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { Grid } from './guide-grid';
import { focused, readGrid as readAny } from './guide-grid';
import { ordered } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * A catch-up's seek bar (RELAY step 25d) by keys, in English and Arabic: a programme gone by on
 * "Lablo Test 1 SMPTE" (101, an Xtream timeshift) plays from the start, and the info bar's seek
 * bar shows the time from its start, its length and the time it aired. Three RIGHTs move the
 * target three minutes on at once, and one request asks the mock for the new start once the keys
 * rest (a `.ts` timeshift can't seek inside itself: a new URL, in whole minutes); FF moves five
 * more, and LEFT stops at the programme's start. The timeline runs left to right in both
 * languages. DOWN and UP move between the bar and the buttons, and Back returns to the guide.
 *
 * The archive's answers reach the mock but never the page (the route holds them), so the player
 * stays "Connecting…" and the keys stay the seek bar's: the mock's media here is synthetic, and a
 * failed stream's card would take them. `e2e:media` seeks inside a real HLS archive
 * (player-media.spec.ts). The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const MINUTE = 60_000;

const SAYS = {
  en: { aired: 'Aired at' },
  ar: { aired: 'وقت البث' },
} as const;

/** One archive answer of the mock: the path asked and the window it served. */
interface ArchiveAnswer {
  readonly url: string;
  readonly channel: number;
  readonly start: number;
  readonly duration: number;
}

let app: MockServer;
let host: string;
const answers: ArchiveAnswer[] = [];

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  // The real clock: the guide and the archive cover now.
  app = await mock({ now: () => Date.now() });
  app.addHook('onResponse', async (request, reply) => {
    const start = reply.getHeader('x-mock-archive-start');
    if (start === undefined) return;
    answers.push({
      url: request.url,
      channel: Number(reply.getHeader('x-mock-archive-channel') ?? NaN),
      start: Number(start),
      duration: Number(reply.getHeader('x-mock-archive-duration') ?? NaN),
    });
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-screen', '.guide__header > *');
}

/** A length as the seek bar shows it: `1:00:00`, or `30:00` under an hour. */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:00` : `${m}:00`;
}

/** The seek bar's parts: left edges, and whether each lies inside the bar. */
function readSeek(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid=player-seek]')!;
    const box = (selector: string) => bar.querySelector(selector)!.getBoundingClientRect();
    const all = bar.getBoundingClientRect();
    const parts = ['.player__elapsed', '.player__seekbar', '.player__length', '.player__aired'].map(box);
    return {
      lefts: parts.map((b) => b.left),
      inside: parts.every((b) => b.left >= all.left - 0.5 && b.right <= all.right + 0.5),
      fill: (bar.querySelector('.z-progress__fill') as HTMLElement).style.width,
    };
  });
}

/** Waits for the mock's first archive answer after `asked`, and checks that every later one asked the same window. */
async function nextAnswer(asked: number): Promise<ArchiveAnswer> {
  await expect.poll(() => answers.length).toBeGreaterThan(asked);
  const first = answers[asked]!;
  for (const a of answers.slice(asked)) expect([a.channel, a.start, a.duration]).toEqual([first.channel, first.start, first.duration]);
  return first;
}

test.describe("a catch-up's seek bar (RELAY step 25d)", () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`seeks by keys: the mock is asked for the new start (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      // The mock sees each archive request; the page waits on it for good.
      await page.route('**/timeshift/**', async (route) => {
        await route.fetch().catch(() => undefined);
      });
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      await remote.go('UP', 'live/header/0');
      await remote.go('OK', 'guide/grid/0');
      const screen = page.getByTestId('guide-screen');
      await settled(screen);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect([ordered[0]!.id, ordered[0]!.archiveDays]).toEqual([101, 7]);
      const onAir = focused(await readGrid(page));
      // A cell back from now (back is LEFT in English, RIGHT in Arabic: the guide mirrors).
      await remote.press(dir === 'ltr' ? 'LEFT' : 'RIGHT');
      await expect.poll(async () => focused(await readGrid(page)).end).toBe(onAir.start);
      const before = focused(await readGrid(page));
      const length = before.end - before.start;
      expect(length).toBeGreaterThanOrEqual(15);
      await remote.go('OK', 'programme/actions/0');
      await expect(page.getByTestId('programme-archive')).toBeVisible();

      // From the start: the seek bar is focused, at the programme's start.
      let asked = answers.length;
      await remote.go('OK', 'player/seek/0');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-archive', String(before.start));
      expect((await nextAnswer(asked)).start).toBe(before.start * 60);
      const seek = page.getByTestId('player-seek');
      await expect(seek).toHaveAttribute('data-at', String(before.start * MINUTE));
      await expect(seek).toHaveClass(/is-focused/);
      await expect(page.getByTestId('player-elapsed')).toHaveText('0:00');
      await expect(seek.locator('.player__length')).toHaveText(clock(length));
      await expect(page.getByTestId('player-aired')).toContainText(SAYS[language].aired);

      // Three RIGHTs: the target three minutes on at once, then one request from there (whole minutes, to the end).
      asked = answers.length;
      await remote.press('RIGHT', 'RIGHT', 'RIGHT');
      await expect(seek).toHaveAttribute('data-at', String((before.start + 3) * MINUTE));
      const three = await nextAnswer(asked);
      expect(three.url).toMatch(new RegExp(`^/timeshift/${U}/${P}/${length - 3}/\\d{4}-\\d{2}-\\d{2}:\\d{2}-\\d{2}/101\\.ts$`));
      expect([three.channel, three.start, three.duration]).toEqual([101, (before.start + 3) * 60, (length - 3) * 60]);
      await expect(seek).toHaveAttribute('data-seeking', 'false');
      await expect(page.getByTestId('player-elapsed')).toHaveText('3:00');
      await expect(player).toHaveAttribute('data-archive', String(before.start));

      // FF: five minutes more.
      asked = answers.length;
      await remote.press('FF');
      expect((await nextAnswer(asked)).start).toBe((before.start + 8) * 60);
      await expect(page.getByTestId('player-elapsed')).toHaveText('8:00');

      // The timeline runs left to right in both languages; the time it aired sits on the language's end.
      const parts = await readSeek(page);
      expect(parts.inside).toBe(true);
      expect(parts.lefts[0]!).toBeLessThan(parts.lefts[1]!);
      expect(parts.lefts[1]!).toBeLessThan(parts.lefts[2]!);
      if (dir === 'ltr') expect(parts.lefts[3]!).toBeGreaterThan(parts.lefts[2]!);
      else expect(parts.lefts[3]!).toBeLessThan(parts.lefts[0]!);
      expect(Number.parseFloat(parts.fill)).toBeCloseTo(800 / length, 0);
      await page.screenshot({ path: path.join(SHOTS, `guide-catchup-seek-${locale}.png`), animations: 'disabled' });

      // LEFT ten times: back to the programme's start, not before.
      asked = answers.length;
      for (let i = 0; i < 10; i += 1) await remote.press('LEFT');
      await expect(seek).toHaveAttribute('data-at', String(before.start * MINUTE));
      expect((await nextAnswer(asked)).start).toBe(before.start * 60);

      // DOWN to the buttons and UP back; Back returns to the guide.
      await remote.go('DOWN', 'player/actions/0');
      await expect(seek).not.toHaveClass(/is-focused/);
      await remote.go('UP', 'player/seek/0');
      await remote.go('BACK', 'guide/grid/0');
      await expect(player).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});
