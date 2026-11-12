import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { LiveChannel } from '../apps/mock-provider/src/config';
import { programmes } from '../apps/mock-provider/src/epg';
import { parseScenario } from '../apps/mock-provider/src/faults';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { Cell, Grid } from './guide-grid';
import { focused, readGrid as readAny } from './guide-grid';
import { guideOf, ordered } from './live-rows';
import { addM3uAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Catch-up from an M3U source (RELAY step 25b) by keys, in English and Arabic. Onboarding adds
 * the mock's `get.php` playlist as an M3U link, on a panel in Riyadh (+03:00) whose XMLTV times
 * carry no offset: the ingest logs in to the panel once for its zone (ADR-010), and the
 * playlist's own guide (the panel's `xmltv.php`) is read in it. A programme gone by on each of
 * the playlist's catch-up modes (101 `xc`, 102 `default`, 103 `append`, 105 `shift`, 106
 * `flussonic`) plays "From the start": the mock's archive answers (`X-Mock-Archive-*`) show the
 * window it was asked for, the programme's own start and at least its length (`append`, `shift`
 * and `flussonic`'s TS form play on to now). The `xc` channel's timeshift start is Riyadh's wall
 * time. With +1:00 on the playlist's guide, the request's start is an hour later. The mock's
 * media here is synthetic (no picture). The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const MINUTE = 60_000;
/** Riyadh, minutes east of UTC (no DST). */
const EAST = 180;
/** The chooser's "No offset" step (guide-offset.spec.ts). */
const NONE = 24;

/** One archive answer of the mock: the path asked and the window it served. */
interface ArchiveAnswer {
  readonly url: string;
  readonly status: number;
  readonly channel: number;
  readonly start: number;
  readonly duration: number;
}

let app: MockServer;
let link: string;
const answers: ArchiveAnswer[] = [];

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  // The mock on the real clock (its guide and archive cover now), on a Riyadh panel.
  const scenario = parseScenario({ rules: [{ match: { path: '**' }, faults: [{ type: 'timezone', tz: 'Asia/Riyadh', xmltv: 'none' }] }] }, 'riyadh');
  app = await mock({ now: () => Date.now(), scenario });
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
  // Typed the way a user would: no `http://`.
  link = `${(await listen(app)).replace(/^http:\/\//, '')}/get.php?username=${U}&password=${P}&type=m3u_plus`;
});
test.afterAll(async () => {
  await app.close();
});

function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-screen', '.guide__header > *');
}

/** `YYYY-MM-DD:HH-MM` of UTC minute `minute` in Riyadh (the /timeshift/ form). */
function riyadh(minute: number): string {
  const iso = new Date((minute + EAST) * MINUTE).toISOString();
  return `${iso.slice(0, 10)}:${iso.slice(11, 13)}-${iso.slice(14, 16)}`;
}

/** The archive request a mode makes for a programme from `start` to `end` (UTC minutes), as the mock receives it. */
function expectedUrl(c: LiveChannel, start: number, end: number): RegExp {
  const s = start * 60;
  const tail = '\\?utc=' + s + '&lutc=\\d+$';
  switch (c.catchup) {
    case 'xc':
      return new RegExp(`^/timeshift/${U}/${P}/${end - start}/${riyadh(start)}/${c.id}\\.ts$`);
    case 'default':
      return new RegExp(`^/catchup/${U}/${P}/${c.id}\\.ts\\?start=${s}&end=${end * 60}$`);
    case 'append':
    case 'shift':
      return new RegExp(`^/live/${U}/${P}/${c.id}\\.ts${tail}`);
    case 'flussonic':
      return new RegExp(`^/flussonic/${U}/${P}/${c.id}/timeshift_abs-${s}\\.ts$`);
    default:
      throw new Error(`no catch-up on ${c.name}`);
  }
}

/** Back (towards the past) until the focused programme has ended: one gone by. */
async function toGoneBy(remote: RemoteDriver, back: 'LEFT' | 'RIGHT'): Promise<Cell> {
  const { page } = remote;
  for (let i = 0; i < 4; i += 1) {
    const cell = focused(await readGrid(page));
    if (cell.programme !== -1 && cell.end * MINUTE <= Date.now()) return cell;
    const before = cell.start;
    await remote.press(back);
    await expect.poll(async () => focused(await readGrid(page)).start).toBeLessThan(before);
  }
  throw new Error('no programme gone by within four presses');
}

/**
 * From the guide's focused programme gone by on `c`'s row: its details ("From the start" first
 * and focused), OK, and the mock's answers for its window; Back to the guide on the same cell.
 */
async function playFromStart(remote: RemoteDriver, screen: Locator, c: LiveChannel, row: number, cell: Cell, shift = 0, shot: string | null = null): Promise<ArchiveAnswer[]> {
  const { page } = remote;
  // The guide shows the mock's own programme (read in the panel's zone), `shift` on.
  const mine = programmes(guideOf(c)!, (cell.start - shift) * MINUTE, (cell.start - shift) * MINUTE + 1)[0]!;
  expect([mine.start / MINUTE + shift, mine.stop / MINUTE + shift, mine.title], c.name).toEqual([cell.start, cell.end, cell.title]);
  await remote.go('OK', 'programme/actions/0');
  await settled(screen);
  await expect(page.getByTestId('programme-archive')).toHaveAttribute('data-state', 'focused');
  if (shot !== null) await page.screenshot({ path: path.join(SHOTS, `${shot}-details.png`), animations: 'disabled' });
  const asked = answers.length;
  await remote.press('OK');
  // The info bar's first button, or already the error card's: the mock's synthetic media fails
  // at once, and an M3U mode has one URL to try (an Xtream channel tries .ts, then .m3u8).
  await expect.poll(() => remote.focusPath()).toMatch(/^player\/(?:seek|card)\/0$/);
  const player = page.getByTestId('player');
  await expect(player).toHaveAttribute('data-archive', String(cell.start));
  await expect(page.getByTestId('player-archive')).toContainText(cell.title);
  await expect(page.getByTestId('player-name')).toHaveText(c.name);
  await expect.poll(() => answers.length).toBeGreaterThan(asked);
  if (shot !== null) await page.screenshot({ path: path.join(SHOTS, `${shot}-player.png`), animations: 'disabled' });
  await remote.go('BACK', `guide/grid/${row}`);
  await expect(player).toHaveCount(0);
  expect(focused(await readGrid(page)).start).toBe(cell.start);
  return answers.slice(asked);
}

/** The live list's header, "Guide": the grid on the first row. */
async function openGuide(remote: RemoteDriver): Promise<Locator> {
  await remote.go('UP', 'live/header/0');
  await remote.go('OK', 'guide/grid/0');
  const screen = remote.page.getByTestId('guide-screen');
  await settled(screen);
  return screen;
}

test.describe('catch-up from an M3U source (RELAY step 25b)', () => {
  for (const [locale, dir] of [
    ['en-US', 'ltr'],
    ['ar-SA', 'rtl'],
  ] as const) {
    test(`plays a programme gone by in each catch-up mode of the playlist, on a Riyadh panel (${locale})`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = trackErrors(page);
      const back = dir === 'ltr' ? 'LEFT' : 'RIGHT';
      const remote = new RemoteDriver(page);
      const live = await addM3uAndWatch(remote, link, `locale=${locale}`);
      await settled(live);
      const screen = await openGuide(remote);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      let row = 0;
      const modes: string[] = [];
      for (const id of [101, 102, 103, 105, 106]) {
        // The playlist lists its channels group by group, as the panel does.
        const index = ordered.findIndex((c) => c.id === id);
        const c = ordered[index]!;
        for (; row < index; row += 1) await remote.go('DOWN', `guide/grid/${row + 1}`);
        await settled(screen);
        const g = await readGrid(page);
        expect(g.rows.find((r) => r.row === index)!.name).toBe(c.name);
        const cell = await toGoneBy(remote, back);
        const shot = id === 103 ? `guide-catchup-m3u-${locale}` : null;
        const got = await playFromStart(remote, screen, c, index, cell, 0, shot);
        // The mode's request for the programme's window: from its start, at least its length.
        expect(got[0]!.url, c.name).toMatch(expectedUrl(c, cell.start, cell.end));
        for (const a of got) {
          expect([a.status, a.channel, a.start, a.duration >= (cell.end - cell.start) * 60], `${c.name} ${a.url}`).toEqual([200, id, cell.start * 60, true]);
        }
        if (c.catchup === 'default') expect(got[0]!.duration).toBe((cell.end - cell.start) * 60);
        modes.push(c.catchup!);
      }
      expect(modes).toEqual(['xc', 'default', 'append', 'shift', 'flussonic']);
      expect(errors).toEqual([]);
    });
  }

  test("with +1:00 on the playlist's guide, asks for the shown start, an hour later (en-US)", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addM3uAndWatch(remote, link, 'locale=en-US');
    await settled(live);
    // Settings, Guides: the playlist's own guide, its menu, "Time offset", +1:00.
    await remote.go('UP', 'live/header/0');
    await remote.go('RIGHT', 'live/header/1');
    await remote.go('RIGHT', 'live/header/2');
    await remote.go('RIGHT', 'live/header/3');
    await remote.go('OK', 'settings/items/0');
    await remote.go('OK', 'guides/guides/0');
    const settings = page.getByTestId('settings-screen');
    await expect(page.getByTestId('guides')).toHaveAttribute('data-status', 'ready');
    await settled(settings);
    await expect(page.getByTestId('guide-0')).toHaveAttribute('data-src', 's1:tvg0');
    await remote.go('OK', 'guide-menu/actions/0');
    await expect(page.getByTestId('guide-menu-offset')).toHaveAttribute('data-state', 'focused');
    await remote.go('OK', `guide-offset/steps/${NONE}`);
    await remote.go('DOWN', `guide-offset/steps/${NONE + 1}`);
    await remote.go('DOWN', `guide-offset/steps/${NONE + 2}`);
    await remote.go('OK', 'guides/guides/0');
    await settled(settings);
    await expect(page.getByTestId('guide-0')).toHaveAttribute('data-offset', '60');
    await remote.go('BACK', 'settings/items/0');
    await remote.go('BACK', 'live/header/3');
    await remote.go('LEFT', 'live/header/2');
    await remote.go('LEFT', 'live/header/1');
    await remote.go('LEFT', 'live/header/0');
    await remote.go('OK', 'guide/grid/0');
    const screen = page.getByTestId('guide-screen');
    await settled(screen);

    for (const [id, row] of [
      [101, 0],
      [102, 1],
    ] as const) {
      const c = ordered[row]!;
      expect(c.id).toBe(id);
      if (row > 0) await remote.go('DOWN', `guide/grid/${row}`);
      await settled(screen);
      const cell = await toGoneBy(remote, 'LEFT');
      // Shown an hour after the mock's programme; asked for as shown.
      const got = await playFromStart(remote, screen, c, row, cell, 60);
      expect(got[0]!.url, c.name).toMatch(expectedUrl(c, cell.start, cell.end));
      for (const a of got) expect([a.status, a.channel, a.start], a.url).toEqual([200, id, cell.start * 60]);
    }
    expect(errors).toEqual([]);
  });
});
