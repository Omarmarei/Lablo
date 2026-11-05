import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { programmes } from '../apps/mock-provider/src/epg';
import type { Programme } from '../apps/mock-provider/src/epg';
import type { LiveChannel } from '../apps/mock-provider/src/config';
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
 * the remote across rows and time, OK on the programme on air (the player), and Back. Then the
 * programme details (step 24a): OK on a programme to come or gone by, the mock's description and
 * category in the dialog, "Watch the channel" and "Close". The screenshots go to
 * artifacts/screenshots.
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
  en: { open: 'Guide', title: 'Guide', noInfo: 'No information', watch: 'Watch the channel', mapping: 'Guide channel', close: 'Close', minutes: (n: number) => `${n} minutes`, filler: 'A long description of the programme. ' },
  // Every mock slot (30, 45, 60, 90 minutes) takes Arabic's "many" form (11–99).
  ar: { open: 'الدليل', title: 'دليل البرامج', noInfo: 'لا توجد معلومات', watch: 'شاهد القناة', mapping: 'قناة الدليل', close: 'إغلاق', minutes: (n: number) => `${n} دقيقةً`, filler: 'وصف طويل للبرنامج على هذه القناة. ' },
} as const;

/** The mock's programme of `channel` (through its guide's channel) that starts at `start` (UTC minutes). */
function programmeOf(channel: LiveChannel, start: number): Programme {
  const guide = guideOf(channel);
  const found = guide === null ? [] : programmes(guide, start * MINUTE, start * MINUTE + 1);
  expect(found.map((p) => p.start)).toEqual([start * MINUTE]);
  return found[0]!;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The programme details dialog as drawn, read in one go. */
interface Details {
  readonly status: string | null;
  readonly title: string;
  readonly titleDir: string | null;
  readonly number: string | null;
  readonly name: string;
  readonly sub: string | null;
  readonly day: string;
  readonly times: string;
  /** Its length in minutes (`data-n`), and as written. */
  readonly length: number;
  readonly lengthText: string;
  readonly tags: string[];
  readonly desc: string | null;
  readonly note: string | null;
  readonly spinner: boolean;
  readonly panel: Box;
  /** Where the title's and the description's text runs (a Range's box), and the day, times and length spans. */
  readonly titleText: Box;
  readonly descText: Box | null;
  readonly when: Box[];
  readonly buttons: { readonly id: string; readonly text: string; readonly box: Box }[];
  /** Our texts cut short: the buttons' labels, the day, the times, the length, the note. */
  readonly cut: string[];
  /** Boxes of the dialog's panel outside the title-safe area. */
  readonly outside: string[];
}

function readDetails(page: Page): Promise<Details> {
  return page.evaluate((safe) => {
    const root = document.querySelector('[data-testid=programme]')!;
    const one = (selector: string): Element | null => root.querySelector(selector);
    const text = (selector: string): string | null => one(selector)?.textContent ?? null;
    const box = (el: Element | Range): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const ours = ['.z-button', '.details__day', '.details__times', '.details__length', '.details__note'];
    const cut: string[] = [];
    for (const selector of ours) {
      root.querySelectorAll(selector).forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) cut.push(selector);
      });
    }
    const outside: string[] = [];
    root.querySelectorAll('.z-dialog__panel, .z-dialog__panel *').forEach((el) => {
      const b = box(el);
      if (b.right - b.left === 0 && b.bottom - b.top === 0) return;
      if (b.left < safe.left - 0.5 || b.top < safe.top - 0.5 || b.right > safe.right + 0.5 || b.bottom > safe.bottom + 0.5) outside.push(el.className || el.tagName);
    });
    const length = one('.details__length');
    const textBox = (el: Element | null): Box | null => {
      if (el === null) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      return box(range);
    };
    return {
      status: one('[data-testid=programme-body]')?.getAttribute('data-status') ?? null,
      title: text('.z-dialog__title') ?? '',
      titleDir: one('.z-dialog__title')?.getAttribute('dir') ?? null,
      number: text('.details__number'),
      name: text('.details__name') ?? '',
      sub: text('.details__sub'),
      day: text('.details__day') ?? '',
      times: text('.details__times') ?? '',
      length: Number(length?.getAttribute('data-n') ?? NaN),
      lengthText: length?.textContent ?? '',
      tags: Array.from(root.querySelectorAll('.details__tag')).map((el) => el.textContent ?? ''),
      desc: text('.details__desc'),
      note: text('.details__note'),
      spinner: one('[data-testid=programme-spinner]') !== null,
      panel: box(one('.z-dialog__panel')!),
      titleText: textBox(one('.z-dialog__title'))!,
      descText: textBox(one('.details__desc')),
      when: Array.from(root.querySelectorAll('.details__when > *')).map(box),
      buttons: Array.from(root.querySelectorAll('.z-dialog__actions .z-button')).map((el) => ({ id: el.getAttribute('data-testid') ?? '', text: el.textContent ?? '', box: box(el) })),
      cut,
      outside,
    };
  }, SAFE);
}

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

      // The next programme: the cursor at its start, the header with it. OK there opens its
      // details (the next test reads them), not the player; Back closes them.
      await remote.press(forward);
      await expect.poll(async () => (await readGrid(page)).time).toBe(cell.end);
      g = await readGrid(page);
      expect(focused(g)).toMatchObject({ row: 0, start: cell.end });
      await expect(page.getByTestId('guide-details')).toContainText(focused(g).title);
      await remote.go('OK', 'programme/actions/0');
      await expect(page.getByTestId('player')).toHaveCount(0);
      await remote.go('BACK', 'guide/grid/0');

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

    test(`opens a programme's details, to come and gone by, and plays from them (${locale})`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const back = forward === 'RIGHT' ? 'LEFT' : 'RIGHT';
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);
      await remote.go('UP', 'live/header/0');
      await remote.go('OK', 'guide/grid/0');
      const screen = page.getByTestId('guide-screen');
      await settled(screen);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const channel = ordered[0]!;
      const onAir = focused(await readGrid(page));

      // The programme to come: its title, channel, times and length from the grid, the rest from the guide.
      await remote.press(forward);
      await expect.poll(async () => (await readGrid(page)).time).toBe(onAir.end);
      const next = focused(await readGrid(page));
      const when = (await page.getByTestId('guide-when').textContent()) ?? '';
      await remote.go('OK', 'programme/actions/0');
      await settled(screen);
      const mockNext = programmeOf(channel, next.start);
      let d = await readDetails(page);
      expect(d).toMatchObject({
        status: 'read',
        title: mockNext.title,
        titleDir: 'auto',
        number: String(channel.num),
        name: channel.name,
        sub: null,
        times: when,
        length: next.end - next.start,
        lengthText: says.minutes(next.end - next.start),
        tags: [mockNext.category],
        desc: mockNext.description,
        note: null,
        spinner: false,
      });
      expect(d.title).toBe(next.title);
      expect(d.day).not.toBe('');
      // The wide panel; the title and the description (data, dir=auto) start on the page's side,
      // after the panel's 48 px padding, whatever their own direction; the time line's parts apart.
      expect(d.panel.right - d.panel.left).toBe(1200);
      for (const text of [d.titleText, d.descText!]) {
        if (dir === 'ltr') expect(text.left - d.panel.left).toBeCloseTo(48 + 2, 0);
        else expect(d.panel.right - text.right).toBeCloseTo(48 + 2, 0);
      }
      expect(d.when).toHaveLength(3);
      const order = dir === 'ltr' ? d.when : d.when.slice().reverse();
      for (let i = 1; i < order.length; i += 1) expect(order[i]!.left - order[i - 1]!.right).toBeGreaterThanOrEqual(24 - 0.5);
      // The header under the dialog still names the grid's focused programme.
      await expect(page.getByTestId('guide-details')).toContainText(next.title);
      // Inside the safe area, none of our texts cut, "Watch the channel" first (on the right in Arabic).
      expect(d.outside).toEqual([]);
      expect(d.cut).toEqual([]);
      expect(d.buttons.map((b) => [b.id, b.text])).toEqual([
        ['programme-watch', says.watch],
        ['programme-map', says.mapping],
        ['programme-close', says.close],
      ]);
      const [watch, map, close] = d.buttons;
      if (dir === 'ltr') expect(watch!.box.right < map!.box.left && map!.box.right < close!.box.left).toBe(true);
      else expect(watch!.box.left > map!.box.right && map!.box.left > close!.box.right).toBe(true);
      // A description at the full tier's cap (1,000 characters), on a copy of the dialog (the
      // app's own nodes untouched): cut at eight lines of 38 px, the panel inside the safe area.
      const long = await page.evaluate(
        ({ text, safe }) => {
          const copy = document.querySelector('[data-testid=programme]')!.cloneNode(true) as HTMLElement;
          copy.setAttribute('data-testid', 'programme-copy');
          document.querySelector('#app')!.appendChild(copy);
          const desc = copy.querySelector('.details__desc')!;
          desc.textContent = text;
          const panel = copy.querySelector('.z-dialog__panel')!.getBoundingClientRect();
          const style = getComputedStyle(desc);
          // (Newer Chromium reports the clamp's -webkit-box as flow-root: only its lines are checked.)
          const clamp = { lines: style.getPropertyValue('-webkit-line-clamp') };
          return { height: desc.getBoundingClientRect().height, full: desc.scrollHeight, top: panel.top, bottom: panel.bottom, clamp, safe };
        },
        { text: says.filler.repeat(60).slice(0, 1000), safe: SAFE },
      );
      expect(long.height).toBe(8 * 38);
      // Cut with an ellipsis by the line clamp (not only its height).
      expect(long.clamp).toEqual({ lines: '8' });
      expect(long.full).toBeGreaterThan(8 * 38);
      expect(long.top).toBeGreaterThanOrEqual(SAFE.top);
      expect(long.bottom).toBeLessThanOrEqual(SAFE.bottom);
      await page.screenshot({ path: path.join(SHOTS, `guide-details-long-${locale}.png`), animations: 'disabled' });
      await page.evaluate(() => document.querySelector('[data-testid=programme-copy]')!.remove());
      // The grid stays under the dialog, its cell kept (drawn as the focus's memory).
      await expect(screen).toHaveAttribute('data-screen', 'programme');
      expect((await readGrid(page)).cells.filter((c) => c.state !== 'idle').map((c) => [c.state, c.start])).toEqual([['memory', next.start]]);
      await page.screenshot({ path: path.join(SHOTS, `guide-details-${locale}.png`), animations: 'disabled' });

      // "Close" (the forward arrow twice, the language's way) and Back close it on the same cell.
      await remote.go(forward, 'programme/actions/1');
      await remote.go(forward, 'programme/actions/2');
      await remote.go('OK', 'guide/grid/0');
      await expect(page.getByTestId('programme')).toHaveCount(0);
      expect((await readGrid(page)).time).toBe(next.start);
      await remote.go('OK', 'programme/actions/0');
      await remote.go('BACK', 'guide/grid/0');
      expect((await readGrid(page)).time).toBe(next.start);

      // The programme gone by: two cells back (past the one on air).
      await remote.press(back);
      await expect.poll(async () => (await readGrid(page)).time).toBe(onAir.start);
      await remote.press(back);
      await expect.poll(async () => focused(await readGrid(page)).end).toBe(onAir.start);
      const before = focused(await readGrid(page));
      await remote.go('OK', 'programme/actions/0');
      await settled(screen);
      const mockBefore = programmeOf(channel, before.start);
      d = await readDetails(page);
      expect(d).toMatchObject({ status: 'read', title: mockBefore.title, length: before.end - before.start, tags: [mockBefore.category], desc: mockBefore.description });
      expect(d.outside).toEqual([]);
      expect(d.cut).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `guide-details-past-${locale}.png`), animations: 'disabled' });

      // On this channel (seven days of catch-up) "From the start" comes first (step 25a,
      // guide-catchup.spec.ts); "Watch the channel" is next: the player over the guide, live,
      // and Back from it to the guide.
      expect(d.buttons.map((b) => b.id)).toEqual(['programme-archive', 'programme-watch', 'programme-map', 'programme-close']);
      await remote.go(forward, 'programme/actions/1');
      await remote.go('OK', 'player/actions/0');
      await expect(page.getByTestId('player')).toHaveAttribute('data-playing', '0');
      await expect(page.getByTestId('player')).toHaveAttribute('data-archive', '');
      await remote.go('BACK', 'guide/grid/0');
      await expect(page.getByTestId('player')).toHaveCount(0);
      await expect(page.getByTestId('programme')).toHaveCount(0);
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
    expect(await unbracketed(page)).toEqual([]);
    expect(await cutLabels(page)).toEqual([]);
    // The programme details over it too.
    await remote.press('RIGHT');
    await remote.go('OK', 'programme/actions/0');
    await settled(screen);
    expect(await unbracketed(page)).toEqual([]);
    expect((await readDetails(page)).cut).toEqual([]);
  });
});

/** The guide screen's texts that are neither bracketed (ours, en-XA) nor data, the locale's times or its day. */
function unbracketed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
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
}
