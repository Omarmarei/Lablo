import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { programmes, slotMinutes } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import type { Grid } from './guide-grid';
import { SAFE, SPAN, checkGeometry, focused, readGrid as readAny } from './guide-grid';
import { guideOf, nowTitles, ordered, rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * A guide's time offset (RELAY step 24b) by keys, in English and Arabic: the guides screen's
 * menu on the panel's own guide, "Time offset", +1:00 from the chooser. The live list's now/next,
 * the grid's cells and the programme details then show the mock's schedule an hour later, and
 * no request goes to the guide's URL (the query worker applies the offset when it reads). Then
 * back to no offset. The mock runs on the real clock (as guide.spec.ts), so its guide covers now.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const MINUTE = 60_000;
/** The chooser's steps: −12 h to +12 h in half hours (OFFSET_STEPS in guides-state.ts), "No offset" at 24. */
const STEPS = 49;
const NONE = 24;
/** Seven in view (OFFSETS.visible in guides-state.ts). */
const IN_VIEW = 7;
/** A line's text starts this close to its box's edge: a 4 px border, 16 px padding, the 28 px check and its 12 px gap, and some room. */
const EDGE = 72;
const MINUS = String.fromCharCode(0x2212);

const SAYS = {
  en: { offset: 'Time offset', matches: 'Matches', cancel: 'Cancel', label: 'Time offset:', none: 'No offset', noInfo: 'No information' },
  ar: { offset: 'فرق التوقيت', matches: 'المطابقة', cancel: 'إلغاء', label: 'فرق التوقيت:', none: 'بلا فرق', noInfo: 'لا توجد معلومات' },
} as const;
type Language = keyof typeof SAYS;

interface Mock {
  readonly app: MockServer;
  readonly host: string;
  /** Every request path the mock received, in order. */
  readonly requests: string[];
}

async function startMock(): Promise<Mock> {
  const app = await mock({ now: () => Date.now() });
  const requests: string[] = [];
  // Before listen: the hook sees every request, the data workers' too.
  app.addHook('onRequest', async (request) => {
    requests.push(request.url);
  });
  const host = (await listen(app)).replace(/^http:\/\//, '');
  return { app, host, requests };
}

/** Requests for the panel's guide. */
const guideRequests = (m: Mock): number => m.requests.filter((url) => url.indexOf('/xmltv.php') !== -1).length;

/** The guides' offsets the profile holds (`undefined`: none set yet). */
function storedOffsets(page: Page): Promise<Record<string, number> | undefined> {
  return page.evaluate(
    () =>
      new Promise<Record<string, number> | undefined>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { doc: { epgOffsets?: Record<string, number> } } | undefined)?.doc.epgOffsets);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** From the list's first row: the header's "Settings", "TV guides", the panel's own guide focused. */
async function openGuides(remote: RemoteDriver, language: Language): Promise<Locator> {
  await remote.go('UP', 'live/header/0');
  await remote.go(language === 'ar' ? 'LEFT' : 'RIGHT', 'live/header/1');
  await remote.go(language === 'ar' ? 'LEFT' : 'RIGHT', 'live/header/2');
  await remote.go('OK', 'settings/items/0');
  await remote.go('OK', 'guides/guides/0');
  const root = remote.page.getByTestId('settings-screen');
  await expect(remote.page.getByTestId('guides')).toHaveAttribute('data-status', 'ready');
  await settled(root);
  await expect(remote.page.getByTestId('guide-0')).toHaveAttribute('data-src', 's1:xmltv');
  return root;
}

/** Back from the guides screen to the list's first row. */
async function backToList(remote: RemoteDriver): Promise<void> {
  await remote.go('BACK', 'settings/items/0');
  await remote.go('BACK', 'live/header/2');
  await remote.go('DOWN', 'live/channels/0');
}

/** The chooser as drawn, read in one go. */
interface Chooser {
  readonly title: string;
  readonly steps: { index: number; minutes: number; state: string; selected: boolean; text: string; dir: string | null }[];
  readonly outside: string[];
  readonly cut: string[];
  /** The focused step's box, its value's text and its check. */
  readonly step: { left: number; right: number };
  readonly value: { left: number; right: number };
  readonly check: { left: number; right: number };
  /** The dialog's row under its message: the steps fill it. */
  readonly actions: { left: number; right: number };
  /** The focused step's height, and how many steps carry the check mark. */
  readonly height: number;
  readonly checks: number;
}

function readChooser(page: Page): Promise<Chooser> {
  return page.evaluate((safe) => {
    const root = document.querySelector('[data-testid=guide-offset]')!;
    const outside: string[] = [];
    root.querySelectorAll('.z-dialog__panel, .z-dialog__panel *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.left < safe.left - 0.5 || r.top < safe.top - 0.5 || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(el.className || el.tagName);
    });
    const cut = Array.from(root.querySelectorAll('.z-dialog__title, .guides__step, .guides__value'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.className);
    const steps = Array.from(root.querySelectorAll('.guides__step')).map((el) => {
      const value = el.querySelector('.guides__value > span');
      return {
        index: Number(el.closest('.z-vlist__item')?.getAttribute('data-index')),
        minutes: Number(el.getAttribute('data-minutes')),
        state: el.getAttribute('data-state') ?? '',
        selected: el.getAttribute('data-selected') === 'true',
        text: value?.textContent ?? '',
        dir: value?.getAttribute('dir') ?? null,
      };
    });
    const on = root.querySelector('.guides__step.is-focused')!;
    const span = (el: Element | null): { left: number; right: number } => {
      const range = document.createRange();
      range.selectNodeContents(el!);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right };
    };
    const box = (el: Element | null): { left: number; right: number } => {
      const r = el!.getBoundingClientRect();
      return { left: r.left, right: r.right };
    };
    return {
      title: root.querySelector('.z-dialog__title')?.textContent ?? '',
      steps,
      outside,
      cut,
      step: box(on),
      value: span(on.querySelector('.guides__value > span')),
      check: box(on.querySelector('.guides__check')),
      actions: box(root.querySelector('.z-dialog__actions')),
      height: on.getBoundingClientRect().height,
      checks: root.querySelectorAll('.guides__check svg').length,
    };
  }, SAFE);
}

/** OK on the panel's guide (its menu: Time offset, Matches, Cancel), then "Time offset": the chooser on `from`'s step. */
async function openChooser(remote: RemoteDriver, language: Language, from: number): Promise<void> {
  const { page } = remote;
  await remote.go('OK', 'guide-menu/actions/0');
  const buttons = page.locator('[data-testid=guide-menu] .z-button');
  await expect(buttons).toHaveCount(3);
  await expect(buttons.nth(0)).toHaveAttribute('data-testid', 'guide-menu-offset');
  await expect(buttons.nth(0)).toHaveText(SAYS[language].offset);
  await expect(buttons.nth(1)).toHaveText(SAYS[language].matches);
  await expect(buttons.nth(2)).toHaveText(SAYS[language].cancel);
  await remote.go('OK', `guide-offset/steps/${NONE + from / 30}`);
}

/** In the chooser: to `to`'s step, then OK. Back on the guides screen. */
async function choose(remote: RemoteDriver, from: number, to: number): Promise<void> {
  const moves = (to - from) / 30;
  for (let i = 0; i < Math.abs(moves); i += 1) await remote.press(moves > 0 ? 'DOWN' : 'UP');
  await remote.expectFocus(`guide-offset/steps/${NONE + to / 30}`);
  await remote.go('OK', 'guides/guides/0');
}

/**
 * Every row the list draws has the mock's programme `shift` minutes earlier on air (the guide
 * read `shift` later), or the placeholder for a channel without one. A channel whose slots are
 * an hour or shorter shows another programme than without the offset.
 */
async function expectRows(page: Page, shift: number): Promise<void> {
  await expect
    .poll(async () => {
      const before = Date.now();
      const drawn = await rows(page);
      const after = Date.now();
      const wrong = drawn.filter((row) => {
        const channel = ordered[row.index]!;
        const titles = nowTitles(channel, before - shift * MINUTE - MINUTE, after - shift * MINUTE);
        if (titles.length === 0) return row.nowTitle !== null;
        if (titles.indexOf(row.nowTitle ?? '') === -1) return true;
        const guide = guideOf(channel)!;
        return shift !== 0 && slotMinutes(guide) <= shift && nowTitles(channel, before - MINUTE, after).indexOf(row.nowTitle ?? '') !== -1;
      });
      return drawn.length > 5 && wrong.length === 0 ? 'ok' : wrong.map((r) => `${r.index} ${r.nowTitle}`).join(', ');
    })
    .toBe('ok');
}

function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-screen', '.guide__header > *');
}

/** Each drawn row's cells: the mock's programmes over the view, read `shift` minutes earlier and drawn `shift` later. */
function checkCells(g: Grid, shift: number, noInfo: string): void {
  for (const row of g.rows) {
    const channel = ordered[row.row]!;
    const cells = g.cells.filter((c) => c.row === row.row);
    const guide = guideOf(channel);
    const want = guide === null ? [] : programmes(guide, (g.view - shift) * MINUTE, (g.view + SPAN - shift) * MINUTE);
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
    ).toEqual(want.map((p) => [p.start / MINUTE + shift, p.stop / MINUTE + shift, p.title]));
  }
}

/**
 * From the list's first row: the grid, its cells `shift` later than the mock's; the next
 * programme's details, the mock's description of the programme `shift` earlier; back to the list.
 */
async function checkGuide(remote: RemoteDriver, shift: number, language: Language, forward: 'LEFT' | 'RIGHT', shot: string | null): Promise<void> {
  const { page } = remote;
  // The header remembers "Settings" (the guides screen opened from it); "Guide" is before it.
  await remote.go('UP', 'live/header/2');
  await remote.go(language === 'ar' ? 'RIGHT' : 'LEFT', 'live/header/1');
  await remote.go(language === 'ar' ? 'RIGHT' : 'LEFT', 'live/header/0');
  await remote.go('OK', 'guide/grid/0');
  const screen = page.getByTestId('guide-screen');
  await settled(screen);
  let g = await readGrid(page);
  checkGeometry(g);
  checkCells(g, shift, SAYS[language].noInfo);
  const onAir = focused(g);
  expect(onAir.start).toBeLessThanOrEqual(g.time);
  expect(onAir.end).toBeGreaterThan(g.time);
  if (shot !== null) await page.screenshot({ path: path.join(SHOTS, `${shot}.png`), animations: 'disabled' });

  await remote.press(forward);
  await expect.poll(async () => (await readGrid(page)).time).toBe(onAir.end);
  g = await readGrid(page);
  const next = focused(g);
  await remote.go('OK', 'programme/actions/0');
  await settled(screen);
  const [mockNext] = programmes(guideOf(ordered[0]!)!, (next.start - shift) * MINUTE, (next.start - shift) * MINUTE + 1);
  expect(mockNext!.start).toBe((next.start - shift) * MINUTE);
  await expect(page.getByTestId('programme-body')).toHaveAttribute('data-status', 'read');
  await expect(page.locator('[data-testid=programme] .z-dialog__title')).toHaveText(mockNext!.title);
  await expect(page.locator('[data-testid=programme] .details__desc')).toHaveText(mockNext!.description);
  await remote.go('BACK', 'guide/grid/0');
  await remote.go('BACK', 'live/channels/0');
}

test.describe("a guide's time offset by keys (pnpm dev, after onboarding)", () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const [locale, language, dir, forward] of [
    ['en-US', 'en', 'ltr', 'RIGHT'],
    ['ar-SA', 'ar', 'rtl', 'LEFT'],
  ] as const) {
    const rtl = dir === 'rtl';

    test(`+1:00 on the panel's guide moves the list, the grid and the details an hour on, with no download, then back (${locale})`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const m = await startMock();
      try {
        const remote = new RemoteDriver(page);
        const live = await addXtreamAndWatch(remote, { host: m.host, username: U, password: P }, `locale=${locale}`);
        await settled(live);
        await expectRows(page, 0);
        const read = guideRequests(m);
        expect(read).toBe(1);

        // The panel's own guide: a menu with the time offset first, then the chooser on "No offset".
        const root = await openGuides(remote, language);
        await expect(page.getByTestId('guide-0')).toHaveAttribute('data-offset', '0');
        await expect(page.getByTestId('guide-0-offset')).toHaveCount(0);
        await openChooser(remote, language, 0);
        await expect(page.locator('[data-testid=guide-offset] .z-dialog__title')).toHaveText(says.offset);
        let c = await readChooser(page);
        // Seven steps in view, "No offset" in the middle, marked and focused.
        expect(c.steps.map((s) => s.index)).toEqual([21, 22, 23, 24, 25, 26, 27]);
        expect(c.steps.map((s) => [s.minutes, s.text, s.dir])).toEqual([
          [-90, `${MINUS}1:30`, 'ltr'],
          [-60, `${MINUS}1:00`, 'ltr'],
          [-30, `${MINUS}0:30`, 'ltr'],
          [0, says.none, null],
          [30, '+0:30', 'ltr'],
          [60, '+1:00', 'ltr'],
          [90, '+1:30', 'ltr'],
        ]);
        expect(c.steps.filter((s) => s.selected).map((s) => s.index)).toEqual([NONE]);
        expect(c.steps.filter((s) => s.state === 'focused').map((s) => s.index)).toEqual([NONE]);
        expect(c.outside).toEqual([]);
        expect(c.cut).toEqual([]);
        expect(c.step).toEqual(c.actions);
        expect(c.height).toBe(64);
        expect(c.checks).toBe(1);
        // The check, then the value, from the screen's side (the right in Arabic).
        if (rtl) {
          expect(c.step.right - c.check.right).toBeLessThan(EDGE - 28);
          expect(c.check.left).toBeGreaterThan(c.value.right);
          expect(c.step.right - c.value.right).toBeLessThan(EDGE);
        } else {
          expect(c.check.left - c.step.left).toBeLessThan(EDGE - 28);
          expect(c.check.right).toBeLessThan(c.value.left);
          expect(c.value.left - c.step.left).toBeLessThan(EDGE);
        }
        await page.screenshot({ path: path.join(SHOTS, `guides-offset-${language}.png`), animations: 'disabled' });
        // To the chooser's ends: the list scrolls, seven steps at a time in view.
        for (let i = NONE; i < STEPS - 1; i += 1) await remote.press('DOWN');
        await remote.expectFocus(`guide-offset/steps/${STEPS - 1}`);
        c = await readChooser(page);
        expect(c.steps.map((s) => s.index)).toEqual([42, 43, 44, 45, 46, 47, 48]);
        expect(c.steps[IN_VIEW - 1]!.text).toBe('+12:00');
        // Back changes nothing.
        await remote.go('BACK', 'guides/guides/0');
        await expect(page.getByTestId('guide-offset')).toHaveCount(0);
        expect(await storedOffsets(page)).toBeUndefined();

        // +1:00: saved, shown on the row, and nothing read again.
        await openChooser(remote, language, 0);
        await choose(remote, 0, 60);
        await settled(root);
        await expect(page.getByTestId('guide-0')).toHaveAttribute('data-offset', '60');
        expect(stripIsolates((await page.getByTestId('guide-0-offset').textContent()) ?? '')).toBe(`${says.label} +1:00`);
        await expect(page.getByTestId('guide-0-offset').locator('span[dir=ltr]')).toHaveText('+1:00');
        expect(await storedOffsets(page)).toEqual({ 's1:xmltv': 60 });
        // Between the link and the owner, the label first (on the right in Arabic).
        const sides = await page.getByTestId('guide-0').evaluate((row) => {
          const span = (el: Element): { left: number; right: number } => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const r = range.getBoundingClientRect();
            return { left: r.left, right: r.right };
          };
          const offset = row.querySelector('.guides__offset')!;
          const box = offset.getBoundingClientRect();
          return {
            link: span(row.querySelector('.guides__link')!),
            offset: { left: box.left, right: box.right },
            label: span(offset.querySelector('span:first-child')!),
            value: span(offset.querySelector('span[dir=ltr]')!),
            owner: span(row.querySelector('.guides__owner')!),
            cut: Array.from(row.querySelectorAll('.guides__link, .guides__offset, .guides__owner, .guides__status')).filter((el) => el.scrollWidth > el.clientWidth + 1).length,
          };
        });
        expect(sides.cut).toBe(0);
        if (rtl) {
          expect(sides.offset.right).toBeLessThanOrEqual(sides.link.left);
          expect(sides.offset.left).toBeGreaterThanOrEqual(sides.owner.right);
          expect(sides.value.right).toBeLessThanOrEqual(sides.label.left + 0.5);
        } else {
          expect(sides.offset.left).toBeGreaterThanOrEqual(sides.link.right);
          expect(sides.offset.right).toBeLessThanOrEqual(sides.owner.left);
          expect(sides.value.left).toBeGreaterThanOrEqual(sides.label.right - 0.5);
        }
        await page.screenshot({ path: path.join(SHOTS, `guides-offset-row-${language}.png`), animations: 'disabled' });

        // The list: every row an hour on. The grid and the details too.
        await backToList(remote);
        await settled(live);
        await expectRows(page, 60);
        await checkGuide(remote, 60, language, forward, `guide-offset-${language}`);
        expect(guideRequests(m)).toBe(read);

        // Back to no offset: the chooser opens on +1:00, two steps up.
        await openGuides(remote, language);
        await openChooser(remote, language, 60);
        c = await readChooser(page);
        expect(c.steps.filter((s) => s.selected).map((s) => s.minutes)).toEqual([60]);
        await choose(remote, 60, 0);
        await settled(root);
        await expect(page.getByTestId('guide-0')).toHaveAttribute('data-offset', '0');
        await expect(page.getByTestId('guide-0-offset')).toHaveCount(0);
        expect(await storedOffsets(page)).toEqual({});
        await backToList(remote);
        await settled(live);
        await expectRows(page, 0);
        await checkGuide(remote, 0, language, forward, null);
        expect(guideRequests(m)).toBe(read);
        expect(errors).toEqual([]);
      } finally {
        await m.app.close();
      }
    });
  }
});
