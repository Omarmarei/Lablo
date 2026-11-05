/**
 * Test support (movies.test.ts, onboarding.test.ts): the movies screen as the app draws it for
 * the harness's fixture (RELAY step 26b), box by box, in either direction. Everything sits where
 * MOVIES_LAYOUT says and every poster is drawn, so the checks pass on it, and a test breaks one
 * thing to see them fail.
 */
import type { ListedFilmCategory } from './fixture';
import { POSTER_SIZE } from './fixture';
import { SAFE_AREA } from './gallery';
import type { GridBox } from './guide';
import type { LiveLanguage } from './live';
import type { MovieTileView, MoviesView } from './movies';
import { MOVIES_GRID_SIZE, MOVIES_LAYOUT, MOVIES_TEXT, listedFilms } from './movies';

export interface FilmsDrawing {
  readonly language: LiveLanguage;
  readonly categories: readonly ListedFilmCategory[];
  /** The rail entry on show, the grid's first row, and the focus (`zone`, `index`). */
  readonly category: number;
  readonly top: number;
  readonly zone: 'grid' | 'rail';
  readonly index: number;
}

/** `width` px at `from` px from `outer`'s inline start: the left in English, the right in Arabic. */
function placed(rtl: boolean, outer: Pick<GridBox, 'left' | 'right'>, from: number, width: number): Pick<GridBox, 'left' | 'right'> {
  return rtl ? { left: outer.right - from - width, right: outer.right - from } : { left: outer.left + from, right: outer.left + from + width };
}

/** The focus ring's width: the poster is drawn inside it. */
const RING = 4;

export function drawnMovies(d: FilmsDrawing): MoviesView {
  const L = MOVIES_LAYOUT;
  const rtl = d.language === 'ar';
  const safe = { left: SAFE_AREA.left, right: SAFE_AREA.right };
  const top = SAFE_AREA.top + L.header;
  const box: GridBox = { ...placed(rtl, safe, L.railWidth + L.railGap, MOVIES_GRID_SIZE.width), top, bottom: top + MOVIES_GRID_SIZE.height };
  const rail: GridBox = { ...placed(rtl, safe, 0, L.railWidth), top, bottom: SAFE_AREA.bottom };
  const entry = listedFilms(d.categories, d.category)!;
  const total = entry.movies.length;
  const tiles: MovieTileView[] = [];
  const last = Math.min((d.top + L.rows) * L.columns, total);
  for (let index = d.top * L.columns; index < last; index += 1) {
    const row = Math.floor(index / L.columns);
    const tileTop = top + (row - d.top) * (L.posterHeight + L.rowGap);
    const across = placed(rtl, box, (index % L.columns) * (L.posterWidth + L.tileGap), L.posterWidth);
    const tile: GridBox = { ...across, top: tileTop, bottom: tileTop + L.posterHeight };
    const movie = entry.movies[index]!;
    const drawn = movie.poster !== null && !movie.fails;
    tiles.push({
      index,
      row,
      ...tile,
      title: movie.name,
      focused: d.zone === 'grid' && index === d.index,
      poster: drawn
        ? { src: movie.poster!, drawn: true, width: POSTER_SIZE.width, height: POSTER_SIZE.height, left: tile.left + RING, right: tile.right - RING, top: tile.top + RING, bottom: tile.bottom - RING }
        : null,
    });
  }
  const chips = [null, ...d.categories].map((category, i) => {
    const at = listedFilms(d.categories, i)!;
    return { i, label: category === null ? MOVIES_TEXT[d.language].all : category.name, count: at.movies.length.toLocaleString('en-US'), selected: i === d.category };
  });
  return {
    category: d.category,
    heading: entry.name ?? MOVIES_TEXT[d.language].all,
    count: total,
    chips,
    rail,
    box,
    top: d.top,
    total,
    columns: L.columns,
    tiles,
  };
}
