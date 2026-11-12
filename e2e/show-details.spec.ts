import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * A show's details (RELAY step 27b) by keys, in English and Arabic. The series screen opens on
 * "Recently updated": the Arabic show (302) first, "Lablo Test Series" (301) second. OK on 301
 * opens its details: the cover, the title and the category at once, a spinner while the panel's
 * `get_series_info` is out (the mock holds it), then the year, the rating, the genre, the plot,
 * the row of seasons ("Season 1" and "Season 2" in the UI's language: the mock's names say no
 * more) and season 1's three episodes, the focus on the first. UP to the seasons and along them
 * shows season 2's two episodes; OK on an episode plays it (step 27c1) and Back from the player
 * returns to it; Back goes to the season on show, then to the grid. 301 opens again from the
 * 24 h cache, with no second read, on that episode (the show's last).
 * 302's first read fails (the mock answers 503): a note, the catalog's facts. Opened again, it is
 * read (a failure isn't kept): one season with the panel's own name «الموسم ١».
 *
 * A show the panel lists no episodes for says so, with no season row.
 *
 * The screenshots go to artifacts/screenshots.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

const SAYS = {
  en: {
    heading: 'Series',
    facts: '2026 · Rated 8/10',
    seasons: ['Season 1', 'Season 2'],
    failed: "Couldn't read this show's episodes.",
    empty: 'This show has no episodes yet.',
    lengths: { 300: '5 min', 240: '4 min', 180: '3 min' },
  },
  ar: {
    heading: 'المسلسلات',
    facts: '2026 · التقييم 8/10',
    seasons: ['الموسم 1', 'الموسم 2'],
    failed: 'تعذّرت قراءة حلقات هذا المسلسل.',
    empty: 'لا توجد حلقات لهذا المسلسل بعد.',
    lengths: { 300: '5 د', 240: '4 د', 180: '3 د' },
  },
} as const;

const GROUP = 'Test Series | مسلسلات تجريبية';
const SHOW = 'Lablo Test Series';
const ARABIC_SHOW = 'مسلسل الاختبار';
const SEASON_1 = ['Pilot - Colour Bars', 'Tone and Clock', 'Lip Sync'];
const SEASON_2 = ['Return of the Bars', 'Finale'];
const ARABIC_EPISODES = ['الحلقة الأولى', 'الحلقة الثانية'];

/** The marks and isolates the i18n runtime puts around a message's arguments (core's `isolateText`). */
const MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x2066, 0x2067, 0x2068, 0x2069)}]`, 'g');

/** An element's text without them. */
async function plain(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(MARKS, '');
}

/** The season chips and episode rows as drawn: their words (the marks taken out) and boxes. */
async function readShow(page: Page) {
  const drawn = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect().toJSON() as { left: number; right: number; top: number; bottom: number };
    const seasons = Array.prototype.slice.call(document.querySelectorAll('[data-testid^=season-]')) as HTMLElement[];
    const rows = Array.prototype.slice.call(document.querySelectorAll('[data-testid^=episode-]')) as HTMLElement[];
    return {
      seasons: seasons.map((s) => ({
        label: s.querySelector('.z-chip__label')!.textContent,
        counted: s.querySelector('.z-chip__count') !== null,
        selected: s.getAttribute('aria-selected'),
        box: box(s),
      })),
      episodes: rows.map((r) => ({
        number: r.querySelector('.show__episode-number')!.textContent,
        title: r.querySelector('.show__episode-title')!.textContent,
        length: r.querySelector('.show__episode-length')?.textContent ?? null,
        key: r.getAttribute('data-key'),
        state: r.getAttribute('data-state'),
        box: box(r),
      })),
      poster: box(document.querySelector('[data-testid=show-poster]')!),
      title: box(document.querySelector('[data-testid=show-title]')!),
      screen: box(document.querySelector('[data-testid=show-details]')!),
    };
  });
  for (const season of drawn.seasons) season.label = (season.label ?? '').replace(MARKS, '');
  for (const episode of drawn.episodes) {
    episode.number = (episode.number ?? '').replace(MARKS, '');
    episode.length = episode.length === null ? null : episode.length.replace(MARKS, '');
  }
  return drawn;
}

let app: MockServer;
let host: string;
/** Each `get_series_info` the mock was asked, by its `series_id`. */
const infoAsked: string[] = [];
/** Ids whose `get_series_info` waits for `release`, ids it fails with a 503, and ids it lists no episodes for. */
const held = new Set<string>();
const failing = new Set<string>();
const emptied = new Set<string>();
let release: () => void = () => undefined;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  app.addHook('onRequest', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.action !== 'get_series_info') return;
    const id = query.series_id ?? '';
    infoAsked.push(id);
    if (held.has(id)) await new Promise<void>((resolve) => (release = resolve));
    if (failing.has(id)) await reply.code(503).send('busy');
    else if (emptied.has(id)) await reply.send({ seasons: [], info: { name: SHOW }, episodes: {} });
  });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

/** Onboards the mock's panel and opens the series screen ("Recently updated": 302, then 301). */
async function openSeries(page: Page, locale: string): Promise<RemoteDriver> {
  const forward = locale === 'ar-SA' ? 'LEFT' : 'RIGHT';
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
  await settled(live);
  await remote.go('UP', 'live/header/0');
  await remote.go(forward, 'live/header/1');
  await remote.go(forward, 'live/header/2');
  await remote.go('OK', 'series/grid/0');
  await settled(page.getByTestId('series-screen'));
  return remote;
}

test.describe("a show's details (RELAY step 27b)", () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`seasons and episodes from the panel, by keys; a failed read (${locale})`, async ({ page }) => {
      test.setTimeout(120_000);
      infoAsked.length = 0;
      failing.clear();
      emptied.clear();
      const errors = trackErrors(page);
      const says = SAYS[language];
      const forward = dir === 'rtl' ? 'LEFT' : 'RIGHT';
      const backward = dir === 'rtl' ? 'RIGHT' : 'LEFT';
      const remote = await openSeries(page, locale);

      // Lablo Test Series: the catalog's facts at once, a spinner while the panel's read is held.
      held.add('301');
      await remote.go(forward, 'series/grid/1');
      await remote.press('OK');
      const details = page.getByTestId('show-details');
      await expect(details).toHaveAttribute('data-status', 'reading');
      await expect(details).toHaveAttribute('data-pending', '1');
      await expect(details).toHaveAttribute('data-language', language);
      await expect(details).toHaveAttribute('data-key', /:series:301$/);
      await expect(page.getByTestId('show-spinner')).toBeVisible();
      await expect(details.locator('.show__heading')).toHaveText(says.heading);
      await expect(page.getByTestId('show-title')).toHaveText(SHOW);
      await expect(page.getByTestId('show-group')).toHaveText(GROUP);
      await expect(page.getByTestId('show-poster').locator('img')).toHaveAttribute('src', /\/images\/series-301\.png$/);
      await expect(page.getByTestId('show-facts')).toHaveCount(0);
      await expect(page.locator('[data-testid^=season-]')).toHaveCount(0);
      await expect(page.locator('[data-testid^=episode-]')).toHaveCount(0);
      await expect(page.getByTestId('show-empty')).toHaveCount(0);
      // Back while it reads would close it; the read answers first here.
      held.delete('301');
      release();
      await expect(details).toHaveAttribute('data-status', 'read');
      await expect(details).toHaveAttribute('data-pending', '0');
      await remote.expectFocus('show/episodes/0');
      await expect(page.getByTestId('show-spinner')).toHaveCount(0);
      await expect.poll(() => plain(page, 'show-facts')).toBe(says.facts);
      await expect(page.getByTestId('show-genre')).toHaveText('Test');
      await expect(page.getByTestId('show-plot')).toHaveText('Our own test series for seasons, resume and auto-next.');
      expect(infoAsked).toEqual(['301']);

      // Two seasons in the UI's words, the first on show; its three episodes, the first focused.
      let drawn = await readShow(page);
      expect(drawn.seasons.map((s) => [s.label, s.counted, s.selected])).toEqual([
        [says.seasons[0], false, 'true'],
        [says.seasons[1], false, 'false'],
      ]);
      expect(drawn.episodes.map((e) => [e.number, e.title, e.length])).toEqual(SEASON_1.map((title, i) => [String(i + 1), title, says.lengths[300]]));
      expect(drawn.episodes.map((e) => e.key!.replace(/^x:[^:]+:/, ''))).toEqual(['episode:3001', 'episode:3002', 'episode:3003']);
      expect(drawn.episodes[0]!.state).toBe('focused');
      await expect(details).toHaveAttribute('data-season', '0');
      // The cover and the first season at the inline start; everything inside the title-safe area.
      if (dir === 'ltr') {
        expect(drawn.poster.right).toBeLessThan(drawn.title.left);
        expect(drawn.seasons[0]!.box.right).toBeLessThan(drawn.seasons[1]!.box.left);
        expect(drawn.seasons[0]!.box.left).toBeCloseTo(96, 0);
      } else {
        expect(drawn.poster.left).toBeGreaterThan(drawn.title.right);
        expect(drawn.seasons[0]!.box.left).toBeGreaterThan(drawn.seasons[1]!.box.right);
        expect(drawn.seasons[0]!.box.right).toBeCloseTo(1920 - 96, 0);
      }
      // show.css as SHOW lays it out: the 200 x 300 cover under the header, 24 px, the 64 px season
      // chips 264 px wide and 16 px apart, 24 px, the 88 px episode rows 8 px apart.
      expect(drawn.poster.top).toBeCloseTo(54 + 56 + 24, 0);
      expect(drawn.poster.bottom - drawn.poster.top).toBeCloseTo(300, 0);
      expect(drawn.poster.right - drawn.poster.left).toBeCloseTo(200, 0);
      const chip = drawn.seasons[0]!.box;
      expect(chip.top).toBeCloseTo(drawn.poster.bottom + 24, 0);
      expect(chip.right - chip.left).toBeCloseTo(264, 0);
      expect(dir === 'ltr' ? drawn.seasons[1]!.box.left - chip.right : chip.left - drawn.seasons[1]!.box.right).toBeCloseTo(16, 0);
      expect(drawn.episodes[0]!.box.top).toBeCloseTo(chip.bottom + 24, 0);
      expect(drawn.episodes[0]!.box.bottom - drawn.episodes[0]!.box.top).toBeCloseTo(88, 0);
      expect(drawn.episodes[1]!.box.top - drawn.episodes[0]!.box.bottom).toBeCloseTo(8, 0);
      expect(drawn.episodes[0]!.box.right - drawn.episodes[0]!.box.left).toBeCloseTo(1728, 0);
      await page.screenshot({ path: path.join(SHOTS, `show-details-${locale}.png`), animations: 'disabled' });

      // UP from the first episode only; along the seasons, season 2's two episodes.
      await remote.go('DOWN', 'show/episodes/1');
      await remote.go('DOWN', 'show/episodes/2');
      await remote.go('DOWN', 'show/episodes/2');
      await remote.go('UP', 'show/episodes/1');
      await remote.go('UP', 'show/episodes/0');
      await remote.go('UP', 'show/seasons/0');
      await remote.go(forward, 'show/seasons/1');
      await expect(details).toHaveAttribute('data-season', '1');
      drawn = await readShow(page);
      expect(drawn.seasons.map((s) => s.selected)).toEqual(['false', 'true']);
      expect(drawn.episodes.map((e) => [e.number, e.title, e.length])).toEqual(SEASON_2.map((title, i) => [String(i + 1), title, says.lengths[240]]));
      expect(drawn.episodes.map((e) => e.key!.replace(/^x:[^:]+:/, ''))).toEqual(['episode:3011', 'episode:3012']);
      await remote.go(forward, 'show/seasons/1');
      await remote.go('DOWN', 'show/episodes/0');
      await remote.go('DOWN', 'show/episodes/1');
      await page.screenshot({ path: path.join(SHOTS, `show-details-season2-${locale}.png`), animations: 'disabled' });
      // OK on an episode plays it (step 27c1; episode-resume.spec.ts); Back returns to it.
      await remote.go('OK', 'player/seek/0');
      await expect(page.getByTestId('player')).toHaveAttribute('data-movie', /:episode:3012$/);
      await remote.go('BACK', 'show/episodes/1');
      await expect(page.getByTestId('player')).toHaveCount(0);

      // Back: the season on show, then the grid on the show.
      await remote.go('BACK', 'show/seasons/1');
      await remote.go('BACK', 'series/grid/1');
      await expect(details).toHaveCount(0);

      // Opened again: from the 24 h cache, no second read, on the episode played last (step 27c1).
      await remote.go('OK', 'show/episodes/1');
      await expect(details).toHaveAttribute('data-status', 'read');
      await expect(details).toHaveAttribute('data-season', '1');
      expect(infoAsked).toEqual(['301']);
      await remote.go('BACK', 'show/seasons/1');
      await remote.go('BACK', 'series/grid/1');

      // The Arabic show's read fails: a note, the catalog's facts, nothing to focus; Back closes.
      failing.add('302');
      await remote.go(backward, 'series/grid/0');
      await remote.press('OK');
      await expect(details).toHaveAttribute('data-status', 'failed');
      await expect(page.getByTestId('show-title')).toHaveText(ARABIC_SHOW);
      await expect(page.getByTestId('show-failed')).toHaveText(says.failed);
      await expect(page.getByTestId('show-empty')).toHaveCount(0);
      await expect(page.getByTestId('show-facts')).toHaveCount(0);
      await expect(page.getByTestId('show-plot')).toHaveCount(0);
      await expect(page.locator('[data-testid^=season-]')).toHaveCount(0);
      await page.screenshot({ path: path.join(SHOTS, `show-details-failed-${locale}.png`), animations: 'disabled' });
      await remote.go('BACK', 'series/grid/0');

      // Opened again, it is read (a failure isn't kept): one season, named by the panel.
      failing.delete('302');
      await remote.go('OK', 'show/episodes/0');
      await expect(details).toHaveAttribute('data-status', 'read');
      expect(infoAsked).toEqual(['301', '302', '302']);
      await expect(page.getByTestId('show-plot')).toHaveText('مسلسل تجريبي لاختبار الواجهة العربية.');
      await expect(page.getByTestId('show-genre')).toHaveText('اختبار');
      drawn = await readShow(page);
      expect(drawn.seasons.map((s) => s.label)).toEqual(['الموسم ١']);
      expect(drawn.episodes.map((e) => [e.number, e.title, e.length])).toEqual(ARABIC_EPISODES.map((title, i) => [String(i + 1), title, says.lengths[180]]));
      await page.screenshot({ path: path.join(SHOTS, `show-details-arabic-${locale}.png`), animations: 'disabled' });
      await remote.go('BACK', 'show/seasons/0');
      await remote.go('BACK', 'series/grid/0');
      // (The rail on "Recently updated", under "Continue watching" since step 27d: S2 E2 played.)
      await remote.go('BACK', 'series/rail/1');
      await remote.go('BACK', 'live/header/2');
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    });

    test(`a show the panel lists no episodes for (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      failing.clear();
      emptied.clear();
      emptied.add('301');
      const errors = trackErrors(page);
      const says = SAYS[language];
      const remote = await openSeries(page, locale);
      await remote.go(dir === 'rtl' ? 'LEFT' : 'RIGHT', 'series/grid/1');
      await remote.press('OK');
      const details = page.getByTestId('show-details');
      await expect(details).toHaveAttribute('data-status', 'read');
      await expect(page.getByTestId('show-empty')).toHaveText(says.empty);
      await expect(page.locator('[data-testid^=season-]')).toHaveCount(0);
      await expect(page.getByTestId('show-seasons')).toHaveCount(0);
      await expect(page.locator('[data-testid^=episode-]')).toHaveCount(0);
      await expect(details).toHaveAttribute('data-season', '');
      // In the seasons' place: under the top band, at the inline start.
      const note = (await page.getByTestId('show-empty').boundingBox())!;
      const top = (await page.getByTestId('show-poster').boundingBox())!;
      expect(note.y).toBeCloseTo(top.y + top.height + 24, 0);
      expect(note.height).toBeCloseTo(64, 0);
      await page.screenshot({ path: path.join(SHOTS, `show-details-empty-${locale}.png`), animations: 'disabled' });
      // Nothing to focus: UP and OK do nothing, Back closes.
      await remote.press('UP', 'OK');
      await expect(details).toHaveAttribute('data-index', '-1');
      await remote.go('BACK', 'series/grid/1');
      expect(errors).toEqual([]);
    });
  }
});
