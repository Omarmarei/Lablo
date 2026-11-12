import { writeFileSync } from 'node:fs';
import type { Catalog, Category, LiveChannel, Movie, Series } from '../apps/mock-provider/src/config';
import { escapeXml } from '../apps/mock-provider/src/xmltv';

/**
 * A large live catalog for the mock, built in-process (RELAY step 14b): `pnpm verify` has no
 * `.cache/fixtures`. Provider-like names in English, Arabic and French, long category names,
 * the panel's own numbers, and a guide for most channels.
 */
export interface BigCatalogOptions {
  readonly channels: number;
  readonly categories: number;
  /**
   * The first `archive.channels` channels have `archive.days` of Xtream catch-up (`tv_archive`,
   * RELAY step 25c: the grid's throttled run). Default: none.
   */
  readonly archive?: { readonly channels: number; readonly days: number };
  /**
   * `movies.count` movies spread evenly over `movies.categories` VOD categories, numbered in
   * category order (RELAY step 26b: the poster grid's throttled run). Default: none.
   */
  readonly movies?: { readonly count: number; readonly categories: number };
  /**
   * `series.count` shows (no seasons: only their list is read) spread evenly over
   * `series.categories` series categories (RELAY step 28a: the search's throttled run). Default: none.
   */
  readonly series?: { readonly count: number; readonly categories: number };
}

/** Every `NO_GUIDE_EVERY`th channel has no guide id: its row says so. */
export const NO_GUIDE_EVERY = 10;

const GROUPS = ['EN | News', 'AR | أخبار', 'Sports HD', 'AR | MBC Group HD', 'FR | Cinéma', 'Kids | أطفال', 'ES | Deportes', 'Documentary 4K'] as const;
const NAMES = ['Lablo Test {n} HD', 'قناة الاختبار {n}', 'Test Channel {n} FHD', 'Lablo Radio {n}', 'Chaîne Test {n}'] as const;

function fill(pattern: string, n: number): string {
  return pattern.replace('{n}', String(n));
}

const MOVIE_GROUPS = ['EN | Movies', 'AR | أفلام عربية', 'Action 4K', 'FR | Films', 'Kids | أفلام أطفال'] as const;
const MOVIE_NAMES = ['Lablo Test Film {n}', 'فيلم الاختبار {n}', 'The Long Test Film Number {n}: A Story', 'Film Test {n}'] as const;
/** The first movie's id: a movie's poster is the mock's `/images/movie-<id>.png`. */
export const BIG_MOVIE_ID = 500_000;

/** `count` movies spread evenly over `categories` VOD categories, in category order. */
function bigMovies(count: number, categories: number): Pick<Catalog, 'vodCategories' | 'movies'> {
  const vodCategories: Category[] = Array.from({ length: categories }, (_v, i) => ({ id: 5000 + i, name: `${MOVIE_GROUPS[i % MOVIE_GROUPS.length]} ${i + 1}`, parentId: 0 }));
  const movies: Movie[] = Array.from({ length: count }, (_v, j) => ({
    id: BIG_MOVIE_ID + j,
    num: j + 1,
    name: fill(MOVIE_NAMES[j % MOVIE_NAMES.length]!, j + 1),
    categoryId: 5000 + Math.floor((j * categories) / count),
    ext: 'mp4',
    year: 2000 + (j % 27),
    durationSecs: 5400,
    rating: 6,
    genre: 'Test',
    plot: 'A test film of the big catalog.',
    addedDaysAgo: j % 30,
    media: 'vod',
  }));
  return { vodCategories, movies };
}

const SERIES_GROUPS = ['EN | Series', 'AR | مسلسلات', 'Drama HD'] as const;
const SERIES_NAMES = ['Lablo Test Show {n}', 'مسلسل الاختبار {n}', 'The Long Test Show Number {n}'] as const;
/** The first show's id. */
export const BIG_SERIES_ID = 900_000;

/** `count` shows spread evenly over `categories` series categories, in category order. */
function bigSeries(count: number, categories: number): Pick<Catalog, 'seriesCategories' | 'series'> {
  const seriesCategories: Category[] = Array.from({ length: categories }, (_v, i) => ({ id: 7000 + i, name: `${SERIES_GROUPS[i % SERIES_GROUPS.length]} ${i + 1}`, parentId: 0 }));
  const series: Series[] = Array.from({ length: count }, (_v, j) => ({
    id: BIG_SERIES_ID + j,
    num: j + 1,
    name: fill(SERIES_NAMES[j % SERIES_NAMES.length]!, j + 1),
    categoryId: 7000 + Math.floor((j * categories) / count),
    year: 2000 + (j % 27),
    rating: 7,
    genre: 'Test',
    plot: 'A test show of the big catalog.',
    addedDaysAgo: j % 30,
    seasons: [],
  }));
  return { seriesCategories, series };
}

/** `channels` live channels spread evenly over `categories` categories, numbered 1… in category order. */
export function bigCatalog({ channels, categories, archive, movies, series }: BigCatalogOptions): Catalog {
  const liveCategories: Category[] = Array.from({ length: categories }, (_v, i) => ({ id: 1000 + i, name: `${GROUPS[i % GROUPS.length]} ${i + 1}`, parentId: 0 }));
  const live: LiveChannel[] = Array.from({ length: channels }, (_v, j) => ({
    id: 100_000 + j,
    num: j + 1,
    name: fill(NAMES[j % NAMES.length]!, j + 1),
    categoryId: 1000 + Math.floor((j * categories) / channels),
    epgId: j % NO_GUIDE_EVERY === NO_GUIDE_EVERY - 1 ? null : `big${j + 1}.lablo`,
    xmltvId: null,
    logo: false,
    archiveDays: archive !== undefined && j < archive.channels ? archive.days : 0,
    catchup: archive !== undefined && j < archive.channels ? 'xc' : null,
    radio: false,
    adult: false,
    addedDaysAgo: 1,
    media: 'clock',
  }));
  const vod = movies === undefined ? { vodCategories: [], movies: [] } : bigMovies(movies.count, movies.categories);
  const shows = series === undefined ? { seriesCategories: [], series: [] } : bigSeries(series.count, series.categories);
  return { liveCategories, live, ...vod, ...shows };
}

const SLOT_MS = 2 * 3_600_000;
const TITLES = ['Evening News', 'نشرة الأخبار المسائية', 'Match of the Day', 'Le Journal', 'برنامج الأطفال', 'Documentary Hour'] as const;

/** XMLTV time: `20261102120000 +0000`. */
function xmltvTime(ms: number): string {
  return `${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;
}

/** Programmes per channel: the one before `now`, the one on, and two after. */
const GUIDE_SLOTS = 4;

/**
 * A dense guide's programme lengths in minutes, taken in turn (435 minutes a round, about 33
 * programmes a day): short news, an hour, a film. Lengths that don't divide a day put each
 * channel's programmes across midnight at different times.
 */
export const DENSE_MINUTES = [30, 15, 45, 60, 20, 90, 30, 50, 70, 25] as const;
/** Titles of a dense guide: short ones, and long ones the cells cut. */
const DENSE_TITLES = [...TITLES, 'Documentary Hour: The Deserts of Arabia, Part 2', 'الدوري السعودي: الهلال ضد النصر - البث المباشر', 'Late Night Talk with Special Guests'] as const;

/** The days a dense guide covers either side of `now`. */
export interface DenseGuide {
  /** The catalog's first `channels` channels with a guide id ("All channels" rows `0…channels − 1`). */
  readonly channels: number;
  /** In ms, the first programme on at `fromMs`, the last on at `toMs − 1`. */
  readonly fromMs: number;
  readonly toMs: number;
}

export interface Programme {
  /** UTC ms. */
  readonly start: number;
  readonly stop: number;
  readonly title: string;
}

const MINUTE_MS = 60_000;

/**
 * Channel `id`'s dense schedule over `[fromMs, toMs)`: back-to-back programmes, lengths from
 * `DENSE_MINUTES` starting at a place set by the id, the first starting on a 5-minute boundary
 * less than 35 minutes before `fromMs` (also set by the id), so neighbouring rows' cells
 * don't line up.
 */
export function denseProgrammes(id: number, fromMs: number, toMs: number): Programme[] {
  const step = 5 * MINUTE_MS;
  let at = Math.floor(fromMs / step) * step - (id % 7) * step;
  const out: Programme[] = [];
  for (let k = id % DENSE_MINUTES.length; at < toMs; k += 1) {
    const stop = at + DENSE_MINUTES[k % DENSE_MINUTES.length]! * MINUTE_MS;
    out.push({ start: at, stop, title: `${DENSE_TITLES[(id + k) % DENSE_TITLES.length]!} ${(k % 9) + 1}` });
    at = stop;
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * The dense guide of the grid's throttled run (guide-throttled.spec.ts): "All channels" rows
 * 0–199 (the presses walk to row 155 and ask to row 173), from 8 days before `now` to 8 days
 * after: the full tier's EPG window with seven days of catch-up (7 days back, 7 on, which the
 * store keeps, RELAY step 25c) with a day's margin either side.
 */
export function gridGuide(now: number): DenseGuide {
  return { channels: 200, fromMs: now - 8 * DAY_MS, toMs: now + 8 * DAY_MS };
}

/** The first `dense.channels` channels with a guide id (by the catalog's order). */
export function denseChannels(catalog: Catalog, dense: DenseGuide): Set<number> {
  const out = new Set<number>();
  for (let j = 0; j < Math.min(dense.channels, catalog.live.length); j += 1) {
    const c = catalog.live[j]!;
    if (c.epgId !== null) out.add(c.id);
  }
  return out;
}

/**
 * Writes a guide for every channel with a guide id: four 2-hour programmes around `now` (the
 * one before, the one on, and two after), so each row has now/next. Two after, because a run
 * that starts just before a slot ends (CI once started at 23:59:50 UTC) still needs a next one
 * once the clock passes it. A short window keeps the file small (the mock's own guide covers
 * days per channel).
 *
 * With `dense` (the grid guide's throttled run, RELAY step 23d), the first `dense.channels`
 * channels get `denseProgrammes` over its days instead: the rows the grid's presses walk, with
 * a TV channel's density over every day the guide stores.
 */
export function writeBigGuide(catalog: Catalog, now: number, file: string, dense?: DenseGuide): number {
  const first = Math.floor(now / SLOT_MS) * SLOT_MS - SLOT_MS;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="Lablo e2e big catalog">'];
  const guided = catalog.live.filter((c) => c.epgId !== null);
  const denseIds = dense === undefined ? new Set<number>() : denseChannels(catalog, dense);
  for (const c of guided) out.push(`<channel id="${c.epgId!}"><display-name>${escapeXml(c.name)}</display-name></channel>`);
  let count = 0;
  const programme = (channel: string, p: Programme): void => {
    out.push(`<programme start="${xmltvTime(p.start)}" stop="${xmltvTime(p.stop)}" channel="${channel}"><title>${escapeXml(p.title)}</title></programme>`);
    count++;
  };
  for (const c of guided) {
    if (dense !== undefined && denseIds.has(c.id)) {
      for (const p of denseProgrammes(c.id, dense.fromMs, dense.toMs)) programme(c.epgId!, p);
      continue;
    }
    for (let k = 0; k < GUIDE_SLOTS; k++) {
      const start = first + k * SLOT_MS;
      programme(c.epgId!, { start, stop: start + SLOT_MS, title: `${TITLES[(c.id + k) % TITLES.length]!} ${k + 1}` });
    }
  }
  out.push('</tv>', '');
  writeFileSync(file, out.join('\n'), 'utf8');
  return count;
}
