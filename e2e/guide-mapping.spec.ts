import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { LiveChannel } from '../apps/mock-provider/src/config';
import { programmes } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import type { Grid } from './guide-grid';
import { SPAN, readGrid as readAny } from './guide-grid';
import { catalog, nowTitles, ordered, rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The manual mapping's screens (RELAY step 24e) by keys, in English and Arabic, against the mock
 * on the real clock (its panel's guide declares 9 channels; "18+ Test Pattern" is the one live
 * channel no guide has):
 *
 * - from "Channels without a guide", OK on "18+ Test Pattern" opens the picker: "No guide" first,
 *   then the guide's 9 channels, none marked. Words typed in the search field, then Back twice
 *   (the keyboard, then the picker), change nothing: no mapping, no download;
 * - the words again, the channel found, OK: the mapping is saved and the guide read again
 *   ("Reading the guides…", the guide's download held until a screenshot); the channel leaves the
 *   list, and the live list and the grid show the mapped channel's programmes;
 * - from the programme details of "Lablo Test 1 SMPTE" (matched by the guides, marked in the
 *   picker), "No guide": after the refresh its row in the grid has no programmes.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const MINUTE = 60_000;
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
/** A row's text starts this close to its own edge: its 4 px border, 32 px padding, the 28 px check and its 16 px gap, and some room. */
const EDGE = 96;
const KEY = 'x:s1:live:109';
const NAME = '18+ Test Pattern';
/** The guide's channels as the mock declares them, in its order. */
const DECLARED = ['lablo.test1', 'lablo.test2', 'lablo.ar3', 'lablo.ar4', 'lablo.kids', 'lablo.sports', 'lablo.radio', 'lablo.fr', 'lablo.es'];

const SAYS = {
  en: {
    title: 'Guide channel',
    intro: `Channel: ${NAME} · no guide has it yet`,
    auto: 'Channel: Lablo Test 1 SMPTE · now Lablo Test 1 SMPTE, found by the guides',
    count: (n: number) => (n === 1 ? '1 channel' : `${n} channels`),
    search: "Search the guides' channels",
    hint: 'Part of a name or an ID',
    off: ['No guide', 'Show no programmes for this channel'],
    reading: 'Reading the guides…',
    none: 'Every live channel has a guide.',
    noInfo: 'No information',
    mapping: 'Guide channel',
    /** Words typed, and the guide channel they find. */
    query: 'kids',
    found: 'lablo.kids',
  },
  ar: {
    title: 'قناة الدليل',
    intro: `القناة: ${NAME} · لا يحتوي عليها أي دليل بعد`,
    auto: 'القناة: Lablo Test 1 SMPTE · الآن Lablo Test 1 SMPTE، وجدتها الأدلة',
    count: (n: number) => (n === 1 ? 'قناة واحدة' : `${n} قنوات`),
    search: 'ابحث في قنوات الأدلة',
    hint: 'جزء من الاسم أو المعرّف',
    off: ['بلا دليل', 'لا تعرض برامج لهذه القناة'],
    reading: 'جارٍ قراءة الأدلة…',
    none: 'لكل قناة مباشرة دليل.',
    noInfo: 'لا توجد معلومات',
    mapping: 'قناة الدليل',
    query: 'الاختبار',
    found: 'lablo.ar4',
  },
} as const;
type Language = keyof typeof SAYS;

interface Mock {
  readonly app: MockServer;
  readonly host: string;
  /** Every request path the mock received, in order. */
  readonly requests: string[];
  /** Holds the guide's downloads until `release` (the screens' "Reading…" stays for a look). */
  hold(): void;
  release(): void;
}

async function startMock(): Promise<Mock> {
  const app = await mock({ now: () => Date.now() });
  const requests: string[] = [];
  let gate: Promise<void> | null = null;
  let open: () => void = () => undefined;
  app.addHook('onRequest', async (request) => {
    requests.push(request.url);
    if (gate !== null && request.url.indexOf('/xmltv.php') !== -1) await gate;
  });
  const host = (await listen(app)).replace(/^http:\/\//, '');
  return {
    app,
    host,
    requests,
    hold: () => {
      gate = new Promise<void>((resolve) => (open = resolve));
    },
    release: () => {
      gate = null;
      open();
    },
  };
}

const guideRequests = (m: Mock): number => m.requests.filter((url) => url.indexOf('/xmltv.php') !== -1).length;

/** The mappings the profile holds (`undefined`: none set yet). */
function storedMappings(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { doc: { epgOverrides?: Record<string, unknown> } } | undefined)?.doc.epgOverrides);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

async function plainText(locator: Locator): Promise<string> {
  return stripIsolates((await locator.textContent()) ?? '');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** From the list's first row: "Settings", "TV guides", then the header's "Channels without a guide". */
async function openUnmatched(remote: RemoteDriver, language: Language): Promise<Locator> {
  const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
  await remote.go('UP', 'live/header/0');
  await remote.go(forward, 'live/header/1');
  await remote.go(forward, 'live/header/2');
  await remote.go('OK', 'settings/items/0');
  await remote.go('OK', 'guides/guides/0');
  const root = remote.page.getByTestId('settings-screen');
  await expect(remote.page.getByTestId('guides')).toHaveAttribute('data-status', 'ready');
  await settled(root);
  await remote.go('UP', 'guides/header/0');
  await remote.go(forward, 'guides/header/1');
  await remote.go('OK', 'unmatched/channels/0');
  await expect(remote.page.getByTestId('unmatched')).toHaveAttribute('data-status', 'ready');
  await settled(root);
  return root;
}

/** The picker as drawn, read in one go. */
interface Picker {
  readonly rows: { index: number; kind: string; id: string; selected: boolean; name: string; where: string; height: number }[];
  readonly checks: number;
  readonly outside: string[];
  readonly cut: string[];
  /** Each drawn row's box and where its name and second line are drawn. */
  readonly sides: { row: { left: number; right: number }; name: { left: number; right: number }; where: { left: number; right: number } }[];
}

function readPicker(page: Page): Promise<Picker> {
  return page.evaluate((safe) => {
    const root = document.querySelector('[data-testid=mapping]')!;
    const span = (el: Element): { left: number; right: number } => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right };
    };
    const outside: string[] = [];
    root.querySelectorAll('.settings__header, .guides__intro, .mapping__search, .z-field__box, .mapping__row').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left - 0.5 || r.top < safe.top - 0.5 || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(`${el.className}: ${(el.textContent ?? '').slice(0, 30)}`);
    });
    const cut = Array.from(root.querySelectorAll('.settings__title, .unmatched__count, .guides__intro, .z-field__label, .z-field__note, .mapping__name, .mapping__where'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className}: ${(el.textContent ?? '').slice(0, 30)}`);
    const rows = Array.from(root.querySelectorAll('.mapping__row'));
    return {
      rows: rows.map((el) => ({
        index: Number(el.closest('.z-vlist__item')?.getAttribute('data-index')),
        kind: el.getAttribute('data-kind') ?? '',
        id: el.getAttribute('data-id') ?? '',
        selected: el.getAttribute('data-selected') === 'true',
        name: el.querySelector('.mapping__name')?.textContent ?? '',
        where: el.querySelector('.mapping__where')?.textContent ?? '',
        height: el.getBoundingClientRect().height,
      })),
      checks: root.querySelectorAll('.mapping__check svg').length,
      outside,
      cut,
      sides: rows.map((el) => {
        const r = el.getBoundingClientRect();
        return { row: { left: r.left, right: r.right }, name: span(el.querySelector('.mapping__name')!), where: span(el.querySelector('.mapping__where')!) };
      }),
    };
  }, SAFE);
}

/** OK on the search field, `words` typed on the desktop keyboard, then `end` ('OK': to "No guide"; 'BACK': the keyboard closes on the field). */
async function search(remote: RemoteDriver, root: Locator, words: string, end: 'OK' | 'BACK'): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', 'mapping-search');
  await remote.page.keyboard.type(words);
  await remote.press(end);
  await expect(root).toHaveAttribute('data-editing', '');
  await remote.expectFocus(end === 'OK' ? 'guide-map/channels/0' : 'guide-map/search/0');
}

function channelOf(id: string): LiveChannel {
  return catalog.live.find((c) => (c.xmltvId ?? c.epgId) === id)!;
}

function readGrid(page: Page): Promise<Grid> {
  return readAny(page, 'guide-screen', '.guide__header > *');
}

/** Row `row`'s cells: `guide`'s programmes over the view, or placeholders for none. */
function expectCells(g: Grid, row: number, guide: LiveChannel | null, noInfo: string): void {
  const cells = g.cells.filter((c) => c.row === row);
  expect(cells.length, `row ${row} drawn`).toBeGreaterThan(0);
  if (guide === null) {
    expect(
      cells.every((c) => c.programme === -1 && c.title === noInfo),
      `row ${row}: placeholders`,
    ).toBe(true);
    return;
  }
  const want = programmes(guide, g.view * MINUTE, (g.view + SPAN) * MINUTE);
  expect(cells.map((c) => [c.start, c.end, c.title])).toEqual(want.map((p) => [p.start / MINUTE, p.stop / MINUTE, p.title]));
}

test.describe('the manual mapping by keys (pnpm dev, after onboarding)', () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    const rtl = dir === 'rtl';
    const forward = rtl ? 'LEFT' : 'RIGHT';
    const says = SAYS[language];

    test(`maps the channel without a guide to a guide's channel, and a matched one to no guide (${locale})`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = trackErrors(page);
      const m = await startMock();
      try {
        const remote = new RemoteDriver(page);
        const live = await addXtreamAndWatch(remote, { host: m.host, username: U, password: P }, `locale=${locale}`);
        await settled(live);
        const read = guideRequests(m);
        expect(read).toBe(1);

        // "Channels without a guide": OK on its one channel opens the picker.
        const root = await openUnmatched(remote, language);
        await expect(page.getByTestId('unmatched-0')).toHaveAttribute('data-key', KEY);
        await remote.go('OK', 'guide-map/search/0');
        const picker = page.getByTestId('mapping');
        await expect(picker).toHaveAttribute('data-status', 'ready');
        await settled(root);
        await expect(picker).toHaveAttribute('data-current', 'none');
        await expect(picker.locator('.settings__title')).toHaveText(says.title);
        expect(await plainText(page.getByTestId('mapping-intro'))).toBe(says.intro);
        expect(await plainText(page.getByTestId('mapping-count'))).toBe(says.count(9));
        await expect(page.getByTestId('mapping-search').locator('.z-field__label')).toHaveText(says.search);
        await expect(page.getByTestId('mapping-search').locator('.z-field__note')).toHaveText(says.hint);
        let p = await readPicker(page);
        // "No guide", then the guide's channels in its order: seven rows in view, none marked.
        expect(p.rows.map((r) => [r.index, r.kind, r.id])).toEqual([[0, 'off', ''], ...DECLARED.slice(0, 6).map((id, i) => [i + 1, 'channel', id])]);
        expect([p.rows[0]!.name, p.rows[0]!.where]).toEqual([...says.off]);
        expect(p.rows[5]!.name).toBe(channelOf('lablo.kids').name);
        expect(p.rows[5]!.where).toBe(`lablo.kids · ${m.host}/xmltv.php`);
        expect(p.rows.every((r) => !r.selected && r.height === 88)).toBe(true);
        expect(p.checks).toBe(0);
        expect(p.outside).toEqual([]);
        expect(p.cut).toEqual([]);
        // Each row's name and line from the screen's side, past the check's place.
        for (const s of p.sides) {
          for (const part of [s.name, s.where]) expect(rtl ? s.row.right - part.right : part.left - s.row.left).toBeLessThan(EDGE);
        }
        await expect(page.locator('[data-testid=mapping-5] .mapping__name')).toHaveAttribute('dir', 'auto');
        await expect(page.locator('[data-testid=mapping-5] .mapping__id')).toHaveAttribute('dir', 'ltr');
        await shot(page, `mapping-${language}`);
        // Down past the seventh row: the list scrolls to the last channel.
        for (let i = 0; i < DECLARED.length + 1; i += 1) await remote.press('DOWN');
        await remote.expectFocus(`guide-map/channels/${DECLARED.length}`);
        p = await readPicker(page);
        expect(p.rows[p.rows.length - 1]!.id).toBe('lablo.es');

        // Back changes nothing: words typed, the keyboard closed by Back, then the picker.
        for (let i = 0; i < DECLARED.length + 1; i += 1) await remote.press('UP');
        await remote.expectFocus('guide-map/search/0');
        await search(remote, root, says.query, 'BACK');
        await expect(picker).toHaveAttribute('data-count', '1');
        await settled(root);
        p = await readPicker(page);
        expect(p.rows.map((r) => [r.kind, r.id])).toEqual([
          ['off', ''],
          ['channel', says.found],
        ]);
        await remote.go('BACK', 'unmatched/channels/0');
        await expect(picker).toHaveCount(0);
        await settled(root);
        expect(await storedMappings(page)).toBeUndefined();
        expect(guideRequests(m)).toBe(read);
        await expect(page.getByTestId('unmatched')).toHaveAttribute('data-count', '1');

        // Mapped: the words again (the picker opens afresh), the channel found, OK.
        await remote.go('OK', 'guide-map/search/0');
        await expect(picker).toHaveAttribute('data-status', 'ready');
        await expect(page.getByTestId('mapping-search').locator('input')).toHaveValue('');
        await search(remote, root, says.query, 'OK');
        await expect(picker).toHaveAttribute('data-count', '1');
        await remote.go('DOWN', 'guide-map/channels/1');
        await expect(page.getByTestId('mapping-1')).toHaveAttribute('data-id', says.found);
        await shot(page, `mapping-search-${language}`);
        m.hold();
        await remote.go('OK', 'unmatched/channels/0');
        // "Reading the guides…" until the guide is read again (its download held here).
        const unmatched = page.getByTestId('unmatched');
        await expect(unmatched).toHaveAttribute('data-reading', '1');
        await expect(page.getByTestId('unmatched-reading')).toHaveText(says.reading);
        const title = await page.locator('[data-testid=unmatched] .settings__title').boundingBox();
        const note = await page.getByTestId('unmatched-reading').boundingBox();
        expect(rtl ? note!.x + note!.width < title!.x : note!.x > title!.x + title!.width).toBe(true);
        await expect.poll(() => guideRequests(m)).toBe(read + 1);
        await shot(page, `unmatched-reading-${language}`);
        m.release();
        await settled(root, 30_000);
        await expect(unmatched).toHaveAttribute('data-reading', '0');
        await expect(page.getByTestId('unmatched-reading')).toHaveCount(0);
        expect(await storedMappings(page)).toEqual({ [KEY]: { epgSrc: 's1:xmltv', channel: says.found } });
        // The channel has a guide now: the list says so.
        await expect(unmatched).toHaveAttribute('data-count', '0');
        await expect(page.getByTestId('unmatched-none')).toHaveText(says.none);

        // The live list: the channel's row shows the mapped channel's programme on air.
        await remote.go('BACK', 'guides/header/1');
        await remote.go('BACK', 'settings/items/0');
        await remote.go('BACK', 'live/header/2');
        await remote.go('DOWN', 'live/channels/0');
        const row = ordered.findIndex((c) => c.id === 109);
        for (let i = 0; i < row; i += 1) await remote.press('DOWN');
        await remote.expectFocus(`live/channels/${row}`);
        await settled(live);
        const mapped = channelOf(says.found);
        await expect
          .poll(async () => {
            const before = Date.now();
            const drawn = (await rows(page)).find((r) => r.index === row);
            return drawn !== undefined && nowTitles(mapped, before - MINUTE, Date.now()).indexOf(drawn.nowTitle ?? '') !== -1;
          })
          .toBe(true);

        // The grid (opened from the header on the first row, then down to the channel): its row has the mapped channel's schedule.
        for (let i = 0; i < row; i += 1) await remote.press('UP');
        await remote.expectFocus('live/channels/0');
        await remote.go('UP', 'live/header/2');
        await remote.go(rtl ? 'RIGHT' : 'LEFT', 'live/header/1');
        await remote.go(rtl ? 'RIGHT' : 'LEFT', 'live/header/0');
        await remote.go('OK', 'guide/grid/0');
        const guide = page.getByTestId('guide-screen');
        for (let i = 0; i < row; i += 1) await remote.press('DOWN');
        await remote.expectFocus(`guide/grid/${row}`);
        await settled(guide);
        let g = await readGrid(page);
        expectCells(g, row, mapped, says.noInfo);
        await shot(page, `guide-mapped-${language}`);

        // From the first channel's next programme, its details' "Guide channel": the guides' match marked.
        for (let i = 0; i < row; i += 1) await remote.press('UP');
        await remote.expectFocus('guide/grid/0');
        const onAir = g.time;
        await remote.press(forward);
        await expect.poll(async () => (await readGrid(page)).time).toBeGreaterThan(onAir);
        await remote.go('OK', 'programme/actions/0');
        await expect(page.getByTestId('programme-map')).toHaveText(says.mapping);
        await remote.go(forward, 'programme/actions/1');
        await remote.go('OK', 'guide-map/search/0');
        await expect(picker).toHaveAttribute('data-status', 'ready');
        await settled(root);
        await expect(picker).toHaveAttribute('data-current', 'auto');
        expect(await plainText(page.getByTestId('mapping-intro'))).toBe(says.auto);
        p = await readPicker(page);
        expect(p.rows.filter((r) => r.selected).map((r) => [r.index, r.id])).toEqual([[1, 'lablo.test1']]);
        expect(p.checks).toBe(1);
        expect(p.outside).toEqual([]);
        expect(p.cut).toEqual([]);
        await shot(page, `mapping-current-${language}`);

        // "No guide": back on the guide, "Reading the guides…" in its header, then no programmes in the row.
        m.hold();
        await remote.go('DOWN', 'guide-map/channels/0');
        await remote.go('OK', 'guide/grid/0');
        await expect(guide).toHaveAttribute('data-reading', '1');
        await expect(page.getByTestId('guide-reading')).toHaveText(says.reading);
        const reading = await page.getByTestId('guide-reading').boundingBox();
        expect(reading!.x).toBeGreaterThanOrEqual(SAFE.left);
        expect(reading!.x + reading!.width).toBeLessThanOrEqual(SAFE.right);
        await expect.poll(() => guideRequests(m)).toBe(read + 2);
        await shot(page, `guide-reading-${language}`);
        m.release();
        await settled(guide, 30_000);
        await expect(guide).toHaveAttribute('data-reading', '0');
        await expect.poll(async () => (await readGrid(page)).cells.filter((c) => c.row === 0).every((c) => c.programme === -1)).toBe(true);
        g = await readGrid(page);
        expectCells(g, 0, null, says.noInfo);
        // The same guide channel's other playlist channel keeps it.
        const twin = ordered.findIndex((c) => c.id === 112);
        expectCells(g, twin, channelOf('lablo.test1'), says.noInfo);
        expect(await storedMappings(page)).toEqual({
          [KEY]: { epgSrc: 's1:xmltv', channel: says.found },
          'x:s1:live:101': { epgSrc: '', channel: null },
        });
        await remote.go('BACK', 'live/channels/0');
        expect(errors).toEqual([]);
      } finally {
        m.release();
        await m.app.close();
      }
    });
  }
});
