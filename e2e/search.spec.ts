import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The search screen (RELAY step 28a) by keys, in English and Arabic, over the mock's panel. The
 * header's "Search" (between "Series" and "Settings") opens it on the field; OK opens the
 * keyboard, and each change of the text searches the live channels, movies and series:
 * - "lablo test": the channels first (names starting with the words, then names holding them as
 *   words), then the movie, then the show; OK on "Lablo Test FR - Mire" plays it, and Back
 *   returns to its row; under the search, the live list now shows its group, on it;
 * - "الاخباريه" (no hamza, a final ه): the Arabic news channel "قناة الاختبار الإخبارية";
 * - "اختبار": the Arabic movie (its name starts with the word) before the channel and the show
 *   (the word inside theirs); OK on the show opens its details, Back returns;
 * - "sintel": the movie; OK opens its details;
 * - "zzzz": nothing, and the field's line says so.
 * Back goes from the results to the field, and from the field to the header's "Search". Every
 * box is inside the title-safe area and no text is cut. Screenshots in artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

const SAYS = {
  en: {
    open: 'Search',
    field: 'Channels, movies and series',
    hint: 'Part of a name, in any language',
    none: 'Nothing has these words.',
    count: (n: number) => `${n} ${n === 1 ? 'result' : 'results'}`,
    kinds: { live: 'Channel', movie: 'Movie', series: 'Series' },
  },
  ar: {
    open: 'البحث',
    field: 'القنوات والأفلام والمسلسلات',
    hint: 'جزء من الاسم، بأي لغة',
    none: 'لا يوجد ما يحتوي هذه الكلمات.',
    count: (n: number) => (n === 0 ? 'لا توجد نتائج' : n === 1 ? 'نتيجة واحدة' : n === 2 ? 'نتيجتان' : n <= 10 ? `${n} نتائج` : `${n} نتيجة`),
    kinds: { live: 'قناة', movie: 'فيلم', series: 'مسلسل' },
  },
} as const;

/** "lablo test", as ranked: the channels whose names start with the words, those holding them as words, the movie, the show. */
const LABLO_TEST = [
  ['live', 'Lablo Test 1 SMPTE', 'Test News'],
  ['live', 'Lablo Test 2 Clock', 'Test News'],
  ['live', 'Lablo Test FR - Mire', 'Test News'],
  ['live', 'Lablo Test 1 SMPTE', 'اختبار - أخبار'],
  ['live', 'Lablo Kids Test', 'Kids Test | أطفال'],
  ['live', 'Lablo Sports Test HD', 'Sports Test'],
  ['live', 'Lablo Sports Test FHD', 'Sports Test'],
  ['live', 'Lablo Radio Test', 'Radio Test'],
  ['movie', 'Lablo Test Pattern 4K HEVC', 'Test Patterns'],
  ['series', 'Lablo Test Series', 'Test Series | مسلسلات تجريبية'],
] as const;

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

interface Drawn {
  readonly rows: { index: number; kind: string; name: string; where: string }[];
  readonly count: string;
  readonly hint: string;
  readonly outside: string[];
  readonly cut: string[];
}

/** The screen as drawn, read in one go. */
function readSearch(page: Page): Promise<Drawn> {
  return page.evaluate(
    ({ safe, marks }) => {
      const strip = new RegExp(marks, 'g');
      const root = document.querySelector('[data-testid=search-screen]')!;
      const outside: string[] = [];
      root.querySelectorAll('.search__header, .search__title, .search__count, .search__field, .z-field__box, .search__row').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < safe.left - 0.5 || r.top < safe.top - 0.5 || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(`${el.className}: ${(el.textContent ?? '').slice(0, 30)}`);
      });
      const cut = Array.from(root.querySelectorAll('.search__title, .search__count, .z-field__label, .z-field__note, .search__name, .search__where'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.className}: ${(el.textContent ?? '').slice(0, 30)}`);
      return {
        rows: Array.from(root.querySelectorAll('.search__row')).map((el) => ({
          index: Number(el.closest('.z-vlist__item')?.getAttribute('data-index')),
          kind: el.getAttribute('data-kind') ?? '',
          name: el.querySelector('.search__name')?.textContent ?? '',
          where: el.querySelector('.search__where')?.textContent ?? '',
        })),
        count: (root.querySelector('.search__count')?.textContent ?? '').replace(strip, ''),
        hint: root.querySelector('.z-field__note')?.textContent ?? '',
        outside,
        cut,
      };
    },
    { safe: SAFE, marks: MARKS.source },
  );
}

/** OK on the field, its text replaced by `text` on the desktop keyboard, the answer in; then OK (the keyboard's done: down to the first result, if any). */
async function searchFor(remote: RemoteDriver, root: Locator, text: string, results: number): Promise<void> {
  await remote.go('OK', 'search/field/0');
  await expect(root).toHaveAttribute('data-editing', 'search-field');
  await remote.page.keyboard.press('Control+A');
  await remote.page.keyboard.press('Backspace');
  await remote.page.keyboard.type(text);
  await expect(root).toHaveAttribute('data-answered', text);
  await expect(root).toHaveAttribute('data-count', String(results));
  await settled(root);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
  await remote.expectFocus(results > 0 ? 'search/results/0' : 'search/field/0');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

test.describe('the search screen by keys (RELAY step 28a)', () => {
  for (const [locale, language] of [
    ['en-US', 'en'],
    ['ar-SA', 'ar'],
  ] as const) {
    test(`a channel played, a show's and a movie's details, nothing found (${locale})`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = language === 'ar' ? 'LEFT' : 'RIGHT';
      const kind = (k: keyof typeof says.kinds, group: string): string => `${says.kinds[k]} · ${group}`;
      const remote = new RemoteDriver(page);
      const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
      await settled(live);

      // The header: "Search" between "Series" and "Settings", all five buttons inside the header's end.
      await remote.go('UP', 'live/header/0');
      await remote.go(forward, 'live/header/1');
      await remote.go(forward, 'live/header/2');
      await remote.go(forward, 'live/header/3');
      await expect(page.getByTestId('live-search')).toHaveText(says.open);
      await expect(page.getByTestId('live-search')).toHaveAttribute('data-state', 'focused');
      const buttons = await page.locator('.live__end .z-button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { left: number; right: number; top: number }));
      expect(buttons).toHaveLength(5);
      for (const b of buttons) {
        expect(b.left).toBeGreaterThanOrEqual(SAFE.left);
        expect(b.right).toBeLessThanOrEqual(SAFE.right);
        expect(b.top).toBe(buttons[0]!.top);
      }
      // In reading order: "Search" after "Series", before "Settings".
      const order = buttons.map((b) => b.left);
      expect(language === 'ar' ? order.slice().sort((a, b) => b - a) : order.slice().sort((a, b) => a - b)).toEqual(order);
      await shot(page, `search-header-${locale}`);

      // The screen opens on the field, nothing typed.
      await remote.go('OK', 'search/field/0');
      const root = page.getByTestId('search-screen');
      await expect(root).toHaveAttribute('data-status', 'idle');
      await expect(root).toHaveAttribute('data-language', language);
      await expect(root.locator('h1')).toHaveText(says.open);
      await expect(page.getByTestId('search-field').locator('label')).toHaveText(says.field);
      let drawn = await readSearch(page);
      expect(drawn.hint).toBe(says.hint);
      expect(drawn.rows).toEqual([]);
      expect(drawn.outside).toEqual([]);
      expect(drawn.cut).toEqual([]);
      await shot(page, `search-${locale}`);

      // "lablo test": channels, then the movie, then the show; seven rows in view.
      await searchFor(remote, root, 'lablo test', LABLO_TEST.length);
      await expect(root).toHaveAttribute('data-total', String(LABLO_TEST.length));
      drawn = await readSearch(page);
      expect(drawn.count).toBe(says.count(LABLO_TEST.length));
      expect(drawn.rows.map((r) => [r.kind, r.name, r.where])).toEqual(LABLO_TEST.slice(0, 7).map(([k, name, group]) => [k, name, kind(k, group)]));
      expect(drawn.outside).toEqual([]);
      expect(drawn.cut).toEqual([]);
      await shot(page, `search-results-${locale}`);
      for (let i = 1; i < LABLO_TEST.length; i += 1) await remote.go('DOWN', `search/results/${i}`);
      await settled(root);
      drawn = await readSearch(page);
      expect(drawn.rows.slice(-3).map((r) => [r.index, r.kind, r.name])).toEqual(LABLO_TEST.slice(7).map(([k, name], i) => [7 + i, k, name]));
      expect(drawn.outside).toEqual([]);

      // OK on "Lablo Test FR - Mire": it plays; Back returns to its row.
      for (let i = LABLO_TEST.length - 2; i >= 2; i -= 1) await remote.go('UP', `search/results/${i}`);
      await remote.go('OK', 'player/actions/0');
      await expect(page.getByTestId('player-name')).toHaveText('Lablo Test FR - Mire');
      await remote.go('BACK', 'search/results/2');
      await expect(root).toHaveAttribute('data-answered', 'lablo test');

      // Arabic letter forms folded: no hamza and a final ه find "الإخبارية".
      await remote.go('BACK', 'search/field/0');
      await searchFor(remote, root, 'الاخباريه', 1);
      drawn = await readSearch(page);
      expect(drawn.count).toBe(says.count(1));
      expect(drawn.rows.map((r) => [r.kind, r.name, r.where])).toEqual([['live', 'قناة الاختبار الإخبارية', kind('live', 'اختبار - أخبار')]]);

      // "اختبار": the movie whose name starts with it, before the channel and the show with it inside a word.
      await remote.go('BACK', 'search/field/0');
      await searchFor(remote, root, 'اختبار', 3);
      drawn = await readSearch(page);
      expect(drawn.rows.map((r) => [r.kind, r.name])).toEqual([
        ['movie', 'اختبار الصوت المتعدد'],
        ['live', 'قناة الاختبار الإخبارية'],
        ['series', 'مسلسل الاختبار'],
      ]);
      expect(drawn.cut).toEqual([]);
      await shot(page, `search-arabic-${locale}`);
      // OK on the show: its details; Back (to its seasons, then out) returns to its row.
      await remote.go('DOWN', 'search/results/1');
      await remote.go('DOWN', 'search/results/2');
      await remote.press('OK');
      const show = page.getByTestId('show-details');
      await expect(show).toHaveAttribute('data-key', /:series:302$/);
      await expect(show).toHaveAttribute('data-status', 'read');
      await expect(page.getByTestId('show-title')).toHaveText('مسلسل الاختبار');
      await remote.expectFocus('show/episodes/0');
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'search/results/2');

      // "sintel": the movie; OK opens its details, Back returns.
      await remote.go('BACK', 'search/field/0');
      await searchFor(remote, root, 'sintel', 1);
      drawn = await readSearch(page);
      expect(drawn.rows.map((r) => [r.kind, r.name, r.where])).toEqual([['movie', 'Sintel', kind('movie', 'Open Movies | أفلام مفتوحة')]]);
      await remote.go('OK', 'movie/actions/0');
      await expect(page.getByTestId('movie-title')).toHaveText('Sintel');
      await remote.go('BACK', 'search/results/0');

      // Nothing found: the field's line says so, and OK stays on the field.
      await remote.go('BACK', 'search/field/0');
      await searchFor(remote, root, 'zzzz', 0);
      drawn = await readSearch(page);
      expect(drawn.count).toBe(says.count(0));
      expect(drawn.hint).toBe(says.none);
      expect(drawn.rows).toEqual([]);
      expect(drawn.cut).toEqual([]);
      await shot(page, `search-none-${locale}`);

      // Back closes it, on the header's "Search"; the live list shows the channel's group, on it.
      await remote.go('BACK', 'live/header/3');
      await expect(page.getByTestId('live-search')).toHaveAttribute('data-state', 'focused');
      await remote.go('DOWN', 'live/channels/2');
      await expect(live).toHaveAttribute('data-category', '1');
      await expect(live).toHaveAttribute('data-selected', /:live:110$/);
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });
  }
});
