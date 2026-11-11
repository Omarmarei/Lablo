/**
 * The movies screen in an old engine (RELAY step 26b). The movies screen (apps/tv/src/movies,
 * step 26a) is the first screen of images, and its poster grid is the first row layout of
 * images without CSS Grid (Chromium 53 and 56 have none): `VirtualGrid` draws flexbox rows whose
 * gaps are margins, mirrored by postcss-rtlcss in Arabic. The onboarding walk (onboarding.ts)
 * opens it from the live screen's header by keys; these are the parts it uses there:
 * - `MOVIES_VIEW_FUNCTION`, plain ES5 for the walk's probe: the screen's category and count, the
 *   rail's chips, the grid's box and first row, and each tile drawn with its box, title, focus
 *   and poster (the `img`'s address, whether it has been drawn, and its box).
 * - `moviesFailures`: everything drawn where `MOVIES_LAYOUT` says, measured from the inline start
 *   (the left edge in English, the right in Arabic): the rail, then 32 px further the grid, its
 *   tiles 184 x 276 px, 6 a row with 24 px between them, 3 rows with 24 px between them. Each tile
 *   against the fixture (fixture.ts `movieCategories`): its title, and its poster drawn at its
 *   real size inside it, or no image where the movie has no poster or its poster failed. The
 *   rail's chips and counts, the header's category, and the one focused tile.
 *
 * The layout constants, the selectors and our own words are kept equal to packages/ui, the
 * movies screen, the e2e test and the app's catalogs by test/engines-onboarding.test.ts
 * (tools/* may not import @lablo/ui).
 */
import { stripIsolates } from '@lablo/core';
import type { ListedFilmCategory, ListedMovie } from './fixture';
import { POSTER_SIZE } from './fixture';
import { SAFE_AREA, list } from './gallery';
import type { GridBox } from './guide';
import type { LiveChipView, LiveLanguage } from './live';

/**
 * packages/ui `LAYOUT.posterWidth`/`posterHeight` and apps/tv `MOVIES`, `MOVIES_ROWS` (px), and
 * the live screen's frame the movies screen shares (`LIVE`): the header and its gap above the
 * body, the rail's width, and the gap between the rail and the grid.
 */
export const MOVIES_LAYOUT = {
  posterWidth: 184,
  posterHeight: 276,
  columns: 6,
  rows: 3,
  tileGap: 24,
  rowGap: 24,
  /** `LIVE.headerHeight + LIVE.headerGap`. */
  header: 80,
  railWidth: 440,
  /** `LIVE.columnGap`. */
  railGap: 32,
} as const;

/** The grid's size: 6 tiles and 5 gaps across, 3 rows and 2 gaps down. */
export const MOVIES_GRID_SIZE = {
  width: MOVIES_LAYOUT.columns * MOVIES_LAYOUT.posterWidth + (MOVIES_LAYOUT.columns - 1) * MOVIES_LAYOUT.tileGap,
  height: MOVIES_LAYOUT.rows * MOVIES_LAYOUT.posterHeight + (MOVIES_LAYOUT.rows - 1) * MOVIES_LAYOUT.rowGap,
} as const;

/** The boxes and labels measured on the movies screen (the safe area, no label cut). */
export const MOVIES_BOXES = '.z-chip, .z-tile, .movies__header > *';
export const MOVIES_LABELS = '.movies__title, .movies__clock, .z-chip__label:not([translate="no"])';

/** Our own words on the movies screen, as the app's catalogs have them. */
export const MOVIES_TEXT: Record<LiveLanguage, { readonly open: string; readonly all: string }> = {
  en: { open: 'Movies', all: 'All movies' },
  ar: { open: 'الأفلام', all: 'كل الأفلام' },
};

/** A poster as drawn: its address, whether the engine has decoded it, its size and its box. */
export interface PosterView extends GridBox {
  readonly src: string;
  /** `complete` and a natural size: the engine drew the image. */
  readonly drawn: boolean;
  readonly width: number;
  readonly height: number;
}

/** A tile of the grid as drawn: its place (`data-index`), its row, its box, title, focus and poster. */
export interface MovieTileView extends GridBox {
  readonly index: number;
  readonly row: number;
  readonly title: string | null;
  readonly focused: boolean;
  readonly poster: PosterView | null;
}

/** The movies screen as the walk's probe reads it (`MOVIES_VIEW_FUNCTION`). */
export interface MoviesView {
  /** The rail entry on show (`data-category`), the header's category and its count (`data-n`). */
  readonly category: number;
  readonly heading: string | null;
  readonly count: number | null;
  readonly chips: readonly LiveChipView[];
  /** The rail's box (null: not drawn). */
  readonly rail: GridBox | null;
  /** The grid: its box, its first row (`data-top`), its movies in all (`data-count`), its columns. */
  readonly box: GridBox | null;
  readonly top: number | null;
  readonly total: number | null;
  readonly columns: number | null;
  readonly tiles: readonly MovieTileView[];
}

/** In-page helper (plain ES5, inside the walk's probe): `moviesView(moviesScreen)` reads a `MoviesView`, or null. */
export const MOVIES_VIEW_FUNCTION = `function moviesView(screen) {
    if (!screen) return null;
    function box(el) {
      var r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }
    function text(root, selector) {
      var el = root.querySelector(selector);
      return el ? el.textContent : null;
    }
    function all(root, selector) {
      return root ? Array.prototype.slice.call(root.querySelectorAll(selector)) : [];
    }
    function has(el, name) {
      return el !== null && (' ' + el.className + ' ').indexOf(' ' + name + ' ') !== -1;
    }
    var grid = screen.querySelector('[data-testid="movies-grid"]');
    var rail = screen.querySelector('[data-testid="movies-rail"]');
    var count = screen.querySelector('[data-testid="movies-meta"] [data-n]');
    return {
      category: Number(screen.getAttribute('data-category')),
      heading: text(screen, '.movies__category'),
      count: count ? Number(count.getAttribute('data-n')) : null,
      chips: all(rail, '.z-vlist__item').map(function (item) {
        return {
          i: Number(item.getAttribute('data-index')),
          label: text(item, '.z-chip__label'),
          count: text(item, '.z-chip__count'),
          selected: has(item.querySelector('.z-chip'), 'is-selected')
        };
      }),
      rail: rail ? box(rail) : null,
      box: grid ? box(grid) : null,
      top: grid ? Number(grid.getAttribute('data-top')) : null,
      total: grid ? Number(grid.getAttribute('data-count')) : null,
      columns: grid ? Number(grid.getAttribute('data-columns')) : null,
      tiles: all(grid, '.z-vgrid__item').map(function (item) {
        var tile = item.querySelector('.z-tile');
        var img = item.querySelector('img');
        var row = item.parentNode;
        var b = box(item);
        var i = img ? box(img) : null;
        return {
          index: Number(item.getAttribute('data-index')),
          row: row && row.getAttribute ? Number(row.getAttribute('data-row')) : -1,
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          title: text(item, '.z-tile__title'),
          focused: has(tile, 'is-focused'),
          poster: img ? { src: img.src, drawn: img.complete && img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight, left: i.left, right: i.right, top: i.top, bottom: i.bottom } : null
        };
      })
    };
  }`;

/** A rail entry of the movies screen: "All movies" (entry 0, every category in turn) or one category. */
export interface ListedFilmEntry {
  /** The category's name (null: "All movies"). */
  readonly name: string | null;
  readonly movies: readonly ListedMovie[];
}

/** Rail entry `index` for the fixture's movie categories (null: no such entry). */
export function listedFilms(categories: readonly ListedFilmCategory[], index: number): ListedFilmEntry | null {
  if (index === 0) return { name: null, movies: categories.flatMap((c) => c.movies) };
  return categories[index - 1] ?? null;
}

const plain = (text: string | null): string | null => (text === null ? null : stripIsolates(text).trim());
/** `Math.round` to a tenth, for messages. */
const px = (n: number): string => String(Math.round(n * 10) / 10);
/** Within half a pixel, as the e2e's `toBeCloseTo(…, 0)`. */
const near = (got: number, want: number): boolean => Math.abs(got - want) < 0.5;
/** Digits only: a count as the locale writes it (`600`). */
const digits = (text: string | null): string => (text === null ? '' : text.replace(/[^0-9]/g, ''));

/** px from `outer`'s inline start to `inner`'s: the left edges in English, the right ones in Arabic. */
const fromStart = (rtl: boolean, outer: Pick<GridBox, 'left' | 'right'>, inner: Pick<GridBox, 'left' | 'right'>): number => (rtl ? outer.right - inner.right : inner.left - outer.left);

/**
 * The grid where MOVIES_LAYOUT says (`e2e/movies.spec.ts` measures the same in current Chromium):
 * 6 x 184 px tiles with 24 px gaps from the grid's inline start, rows 300 px apart from its top,
 * the grid 472 px (the rail and its gap) from the safe area's inline start and 80 px below its
 * top, the rail at the inline start. The rows drawn are the view's, from `top`.
 */
export function moviesGridFailures(view: MoviesView, dir: string): string[] {
  const L = MOVIES_LAYOUT;
  const rtl = dir === 'rtl';
  const g = view.box;
  if (g === null || view.top === null || view.total === null) return ['the movies screen draws no grid'];
  const failures: string[] = [];
  if (view.columns !== L.columns) failures.push(`the grid has ${view.columns ?? '-'} columns, expected ${L.columns}`);
  const width = g.right - g.left;
  const height = g.bottom - g.top;
  if (!near(width, MOVIES_GRID_SIZE.width) || !near(height, MOVIES_GRID_SIZE.height)) failures.push(`the grid is ${px(width)}x${px(height)} px, expected ${MOVIES_GRID_SIZE.width}x${MOVIES_GRID_SIZE.height}`);
  const start = fromStart(rtl, { left: SAFE_AREA.left, right: SAFE_AREA.right }, g);
  if (!near(start, L.railWidth + L.railGap)) failures.push(`the grid starts ${px(start)} px from the safe area's inline start, expected ${L.railWidth + L.railGap} (the rail and its gap)`);
  if (!near(g.top - SAFE_AREA.top, L.header)) failures.push(`the grid starts ${px(g.top - SAFE_AREA.top)} px below the safe area's top, expected ${L.header} (the header)`);
  const rail = view.rail;
  if (rail === null) failures.push('the rail is missing');
  else {
    const railStart = fromStart(rtl, { left: SAFE_AREA.left, right: SAFE_AREA.right }, rail);
    if (!near(railStart, 0) || !near(rail.right - rail.left, L.railWidth)) {
      failures.push(`the rail is ${px(rail.right - rail.left)} px wide at ${px(railStart)} px from the safe area's inline start (the ${rtl ? 'right' : 'left'}), expected ${L.railWidth} at 0`);
    }
  }

  const rows = Math.ceil(view.total / L.columns);
  const want: number[] = [];
  for (let row = view.top; row < Math.min(view.top + L.rows, rows); row += 1) {
    for (let i = row * L.columns; i < Math.min((row + 1) * L.columns, view.total); i += 1) want.push(i);
  }
  const got = view.tiles.map((t) => t.index);
  if (got.join() !== want.join()) failures.push(`the grid draws tiles ${got.join(', ') || 'none'}, expected ${want.join(', ')} (rows from ${view.top})`);

  const wrong: string[] = [];
  for (const tile of view.tiles) {
    const row = Math.floor(tile.index / L.columns);
    const column = tile.index % L.columns;
    const at = `tile ${tile.index}`;
    if (tile.row !== row) wrong.push(`${at} is in row ${tile.row}, expected ${row}`);
    if (!near(tile.right - tile.left, L.posterWidth) || !near(tile.bottom - tile.top, L.posterHeight)) wrong.push(`${at} is ${px(tile.right - tile.left)}x${px(tile.bottom - tile.top)} px, expected ${L.posterWidth}x${L.posterHeight}`);
    const across = fromStart(rtl, g, tile);
    const wantAcross = column * (L.posterWidth + L.tileGap);
    if (!near(across, wantAcross)) wrong.push(`${at} starts ${px(across)} px from the grid's inline start, expected ${wantAcross}`);
    const down = tile.top - g.top;
    const wantDown = (row - view.top) * (L.posterHeight + L.rowGap);
    if (!near(down, wantDown)) wrong.push(`${at} is ${px(down)} px below the grid's top, expected ${wantDown}`);
  }
  if (wrong.length > 0) failures.push(`${wrong.length} misplaced: ${list(wrong)}`);
  return failures;
}

/**
 * Each tile against the fixture: its movie's title, and its poster: drawn (decoded, at the
 * staged file's size) inside the tile, from the movie's own address; no image for a movie
 * without a poster or whose poster failed (the tile shows the title).
 */
export function posterFailures(view: MoviesView, entry: ListedFilmEntry): string[] {
  const wrong: string[] = [];
  for (const tile of view.tiles) {
    const movie = entry.movies[tile.index];
    if (movie === undefined) {
      wrong.push(`tile ${tile.index}: not in the fixture`);
      continue;
    }
    const at = `tile ${tile.index} (${movie.name})`;
    if (plain(tile.title) !== movie.name) wrong.push(`${at}: title ${tile.title === null ? 'missing' : `"${plain(tile.title) ?? ''}"`}`);
    const poster = tile.poster;
    if (movie.poster === null || movie.fails) {
      if (poster !== null) wrong.push(`${at}: draws an image (${poster.src}), though its poster ${movie.poster === null ? 'is none' : 'failed'}`);
      continue;
    }
    if (poster === null) {
      wrong.push(`${at}: no poster`);
      continue;
    }
    if (poster.src !== movie.poster) wrong.push(`${at}: the poster is ${poster.src}, expected ${movie.poster}`);
    if (!poster.drawn) wrong.push(`${at}: the poster was never drawn`);
    else if (poster.width !== POSTER_SIZE.width || poster.height !== POSTER_SIZE.height) wrong.push(`${at}: the poster is ${poster.width}x${poster.height}, expected the file's ${POSTER_SIZE.width}x${POSTER_SIZE.height}`);
    const inside = poster.left >= tile.left - 0.5 && poster.right <= tile.right + 0.5 && poster.top >= tile.top - 0.5 && poster.bottom <= tile.bottom + 0.5;
    // (Inside the tile's focus ring: at least half its size.)
    const big = poster.right - poster.left >= MOVIES_LAYOUT.posterWidth / 2 && poster.bottom - poster.top >= MOVIES_LAYOUT.posterHeight / 2;
    if (!inside || !big) wrong.push(`${at}: the poster is drawn at ${px(poster.right - poster.left)}x${px(poster.bottom - poster.top)} px${inside ? '' : ', outside its tile'}`);
  }
  return wrong.length === 0 ? [] : [`${wrong.length} of ${view.tiles.length} tiles wrong: ${list(wrong)}`];
}

/** The focused tile: exactly the focus (`index`) when the grid has it, none when the rail has it. */
export function tileFocusFailures(view: MoviesView, zone: string | null, index: number | null): string[] {
  const focused = view.tiles.filter((t) => t.focused).map((t) => t.index);
  const want = zone === 'grid' && index !== null ? [index] : [];
  return focused.join() === want.join() ? [] : [`tiles ${focused.join(', ') || 'none'} drawn focused, expected ${want.join(', ') || 'none'} (the focus is on the ${zone ?? '-'})`];
}

/**
 * The rail against the fixture: its chips from the top ("All movies", then each category with
 * its count), only the category on show selected, and the header naming it with its count.
 */
export function filmRailFailures(view: MoviesView, categories: readonly ListedFilmCategory[], language: LiveLanguage): string[] {
  const failures: string[] = [];
  const got = view.chips.map((chip) => chip.i);
  const want = categories.map((_c, n) => n).concat([categories.length]);
  if (got.join() !== want.join()) failures.push(`the rail draws chips ${got.join(', ') || 'none'}, expected ${want.join(', ')}`);
  const wrong: string[] = [];
  for (const chip of view.chips) {
    const entry = listedFilms(categories, chip.i);
    if (entry === null) continue;
    const label = entry.name ?? MOVIES_TEXT[language].all;
    if (plain(chip.label) !== label) wrong.push(`chip ${chip.i}: "${plain(chip.label) ?? ''}", expected "${label}"`);
    if (digits(chip.count) !== String(entry.movies.length)) wrong.push(`chip ${chip.i}: count "${chip.count ?? ''}", expected ${entry.movies.length}`);
  }
  if (wrong.length > 0) failures.push(`rail: ${list(wrong)}`);
  const selected = view.chips.filter((chip) => chip.selected).map((chip) => chip.i);
  if (selected.join() !== String(view.category)) failures.push(`rail: chips ${selected.join(', ') || 'none'} selected, expected ${view.category}`);
  const shown = listedFilms(categories, view.category);
  if (shown === null) return [...failures, `the screen shows rail entry ${view.category}, which the fixture does not have`];
  const heading = shown.name ?? MOVIES_TEXT[language].all;
  if (plain(view.heading) !== heading) failures.push(`the header names "${plain(view.heading) ?? ''}", expected "${heading}"`);
  if (view.count !== shown.movies.length) failures.push(`the header counts ${view.count ?? 'no'} movies, expected ${shown.movies.length}`);
  return failures;
}

/** Everything wrong with the movies screen once a step is there; empty when it is all as the fixture says. */
export function moviesFailures(view: MoviesView | null, state: { readonly dir: string; readonly zone: string | null; readonly index: number | null }, categories: readonly ListedFilmCategory[], language: LiveLanguage): string[] {
  if (view === null) return ['no movies screen'];
  const entry = listedFilms(categories, view.category);
  return [
    ...moviesGridFailures(view, state.dir),
    ...filmRailFailures(view, categories, language),
    ...(entry === null ? [] : posterFailures(view, entry)),
    ...tileFocusFailures(view, state.zone, state.index),
  ];
}
