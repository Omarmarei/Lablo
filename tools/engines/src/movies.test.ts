import { inflateSync } from 'node:zlib';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { ARABIC_FILMS, FILMS, FIXTURE_ORIGIN, MISSING_POSTER, POSTER_FILES, POSTER_SIZE, fixtureEntries, fixtureM3u, movieCategories, moviePoster } from './fixture';
import type { MoviesView } from './movies';
import { MOVIES_GRID_SIZE, MOVIES_LAYOUT, MOVIES_TEXT, MOVIES_VIEW_FUNCTION, filmRailFailures, listedFilms, moviesFailures, moviesGridFailures, posterFailures, tileFocusFailures } from './movies';
import type { FilmsDrawing } from './movies-drawn';
import { drawnMovies } from './movies-drawn';
import { crc32, pngSize, posterPng } from './poster';

const FILMS_LIST = movieCategories(fixtureEntries());
const at = (d: Partial<FilmsDrawing> = {}): MoviesView => drawnMovies({ language: 'en', categories: FILMS_LIST, category: 0, top: 0, zone: 'grid', index: 0, ...d });
const ok = (view: MoviesView, dir = 'ltr', zone: 'grid' | 'rail' = 'grid', index = 0, language: 'en' | 'ar' = 'en'): string[] => moviesFailures(view, { dir, zone, index }, FILMS_LIST, language);
/** `view` with tile `index` changed by `change`. */
const withTile = (view: MoviesView, index: number, change: (tile: MoviesView['tiles'][number]) => Partial<MoviesView['tiles'][number]>): MoviesView => ({
  ...view,
  tiles: view.tiles.map((t) => (t.index === index ? { ...t, ...change(t) } : t)),
});

describe('the fixture movies (RELAY step 26b)', () => {
  it('has 300 Latin films, then 300 Arabic ones, each group in turn', () => {
    expect(FILMS_LIST.map((c) => [c.name, c.movies.length])).toEqual([
      [FILMS, 300],
      [ARABIC_FILMS, 300],
    ]);
    expect(FILMS_LIST[0]!.movies[0]!.name).toBe('Lablo Film 2401');
    expect(FILMS_LIST[1]!.movies[0]!.name).toBe('فيلم لابلو 2701');
  });

  it('gives each movie a poster of its own address, but the 13th of every 50 none and the 8th one that fails', () => {
    expect(moviePoster(1, 2401)).toBe(`${FIXTURE_ORIGIN}/poster-1.png?m=2401`);
    expect(moviePoster(3, 2403)).toBe(`${FIXTURE_ORIGIN}/poster-0.png?m=2403`);
    expect(moviePoster(8, 2408)).toBe(`${FIXTURE_ORIGIN}/${MISSING_POSTER}?m=2408`);
    expect(moviePoster(13, 2413)).toBeUndefined();
    expect(moviePoster(63, 2463)).toBeUndefined();
    const all = listedFilms(FILMS_LIST, 0)!.movies;
    // In the first view (18 tiles) and in the Arabic group's: one without a poster, one that fails.
    for (const movies of [all.slice(0, 18), FILMS_LIST[1]!.movies.slice(0, 18)]) {
      expect(movies.map((m, i) => (m.poster === null ? `${i}:none` : m.fails ? `${i}:fails` : null)).filter((x) => x !== null)).toEqual(['7:fails', '12:none']);
    }
    expect(new Set(all.map((m) => m.poster).filter((p) => p !== null)).size).toBe(all.filter((m) => m.poster !== null).length);
    expect(POSTER_FILES.map((p) => p.file)).toEqual(['poster-0.png', 'poster-1.png', 'poster-2.png']);
  });

  it("writes the posters as the movies' tvg-logo", () => {
    const m3u = fixtureM3u(fixtureEntries());
    expect(m3u).toContain(`#EXTINF:-1 tvg-id="fixture.2401" tvg-logo="${FIXTURE_ORIGIN}/poster-1.png?m=2401" group-title="Films",Lablo Film 2401`);
    expect(m3u).toContain('#EXTINF:-1 tvg-id="fixture.2413" group-title="Films",Lablo Film 2413');
    expect(m3u).toContain(`tvg-logo="${FIXTURE_ORIGIN}/poster-2.png?m=2702" group-title="${ARABIC_FILMS}",فيلم لابلو 2702`);
    // No live channel has one.
    expect(m3u.split('\n').filter((l) => l.includes('tvg-logo')).length).toBe(600 - 12);
  });
});

describe('the poster PNGs', () => {
  it('are real PNGs of the size asked: a valid IHDR, CRCs and the pixel rows', () => {
    const png = posterPng(POSTER_SIZE.width, POSTER_SIZE.height, [200, 90, 60], [60, 30, 20]);
    expect(pngSize(png)).toEqual({ width: 184, height: 276 });
    // CRC-32 of "IEND" is PNG's well-known AE426082.
    expect(crc32(Buffer.from('IEND', 'ascii'))).toBe(0xae426082);
    expect(png.subarray(png.length - 8).toString('hex')).toBe('49454e44ae426082');
    // IDAT: one filter byte and three bytes a pixel per row; the first pixel the top colour, the middle third lighter.
    const length = png.readUInt32BE(33);
    expect(png.toString('ascii', 37, 41)).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + length));
    expect(raw.length).toBe(276 * (1 + 184 * 3));
    expect([...raw.subarray(0, 4)]).toEqual([0, 200, 90, 60]);
    const middle = 138 * (1 + 184 * 3);
    expect(raw[middle + 1]).toBeGreaterThan(Math.round(200 + (60 - 200) * (138 / 275)));
    expect(pngSize(Buffer.from('not a png at all, really not'))).toBeNull();
    // 8 bits a sample, colour type 2 (RGB), deflate, no filters, no interlace.
    expect([...png.subarray(24, 29)]).toEqual([8, 2, 0, 0, 0]);
    // The signature, then a chunk other than IHDR first: not a PNG it can size.
    const odd = Buffer.from(png);
    odd.write('IDAT', 12, 'ascii');
    expect(pngSize(odd)).toBeNull();
    expect(() => posterPng(0, 10, [0, 0, 0], [0, 0, 0])).toThrow('posterPng: 0x10 is not a size');
  });
});

describe('the movies screen checks', () => {
  it('reads the screen in plain ES5, so it runs on every engine', () => {
    expect(() => parse(`(${MOVIES_VIEW_FUNCTION})`, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  it('fits the layout: 6 tiles of 184 x 276 with 24 px gaps, 3 rows, beside the 440 px rail and its 32 px', () => {
    expect(MOVIES_GRID_SIZE).toEqual({ width: 1224, height: 876 });
    expect(MOVIES_LAYOUT.railWidth + MOVIES_LAYOUT.railGap + MOVIES_GRID_SIZE.width).toBeLessThanOrEqual(1728);
  });

  it('passes the screen as the app draws it, in either direction, on the grid or the rail', () => {
    expect(ok(at())).toEqual([]);
    expect(ok(at({ language: 'ar' }), 'rtl', 'grid', 0, 'ar')).toEqual([]);
    expect(ok(at({ top: 3, index: 25 }), 'ltr', 'grid', 25)).toEqual([]);
    expect(ok(at({ zone: 'rail', index: 2, top: 3 }), 'ltr', 'rail', 2)).toEqual([]);
    expect(ok(at({ category: 2, language: 'ar' }), 'rtl', 'grid', 0, 'ar')).toEqual([]);
  });

  it('fails a grid that lost its flexbox rows: every tile on its own line', () => {
    const view = at();
    const stacked = { ...view, tiles: view.tiles.map((t, n) => ({ ...t, left: view.box!.left, right: view.box!.left + 184, top: view.box!.top + n * 276, bottom: view.box!.top + (n + 1) * 276 })) };
    const failures = moviesGridFailures(stacked, 'ltr');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\d+ misplaced: tile 1 starts 0 px from the grid's inline start, expected 208/);
  });

  it('fails an Arabic grid that fills from the left, a grid in the wrong place, and the wrong rows', () => {
    // English boxes read in Arabic: the rows start at the wrong side.
    expect(moviesGridFailures(at(), 'rtl')[0]).toBe("the grid starts 32 px from the safe area's inline start, expected 472 (the rail and its gap)");
    const view = at();
    const lower = { ...view, box: { ...view.box!, top: view.box!.top + 10, bottom: view.box!.bottom + 10 } };
    expect(moviesGridFailures(lower, 'ltr')).toContain("the grid starts 90 px below the safe area's top, expected 80 (the header)");
    expect(moviesGridFailures({ ...view, top: 1 }, 'ltr')[0]).toMatch(/^the grid draws tiles 0, 1, .* expected 6, 7, .*\(rows from 1\)$/);
    expect(moviesGridFailures({ ...view, columns: 5 }, 'ltr')).toContain('the grid has 5 columns, expected 6');
    // Only its height, only the rail's place, only the rail's width.
    expect(moviesGridFailures({ ...view, box: { ...view.box!, bottom: view.box!.bottom - 276 } }, 'ltr')).toEqual(['the grid is 1224x600 px, expected 1224x876']);
    expect(moviesGridFailures({ ...view, rail: { ...view.rail!, left: view.rail!.left + 20, right: view.rail!.right + 20 } }, 'ltr')).toEqual([
      "the rail is 440 px wide at 20 px from the safe area's inline start (the left), expected 440 at 0",
    ]);
    expect(moviesGridFailures({ ...view, rail: { ...view.rail!, right: view.rail!.right - 40 } }, 'ltr')).toEqual([
      "the rail is 400 px wide at 0 px from the safe area's inline start (the left), expected 440 at 0",
    ]);
    // Only a tile's width.
    expect(moviesGridFailures(withTile(view, 3, (t) => ({ right: t.right - 20 })), 'ltr')).toEqual(['1 misplaced: tile 3 is 164x276 px, expected 184x276']);
    expect(moviesGridFailures({ ...view, rail: null }, 'ltr')).toContain('the rail is missing');
    expect(moviesGridFailures({ ...view, box: null }, 'ltr')).toEqual(['the movies screen draws no grid']);
    expect(moviesGridFailures(withTile(view, 3, (t) => ({ bottom: t.bottom - 20 })), 'ltr')).toEqual(['1 misplaced: tile 3 is 184x256 px, expected 184x276']);
    expect(moviesGridFailures(withTile(view, 7, () => ({ row: 2 })), 'ltr')).toEqual(['1 misplaced: tile 7 is in row 2, expected 1']);
    // A short last row: 20 movies from row 2 are tiles 12-19, not up to 23.
    const few = [{ name: 'Few', movies: listedFilms(FILMS_LIST, 0)!.movies.slice(0, 20) }];
    const short = drawnMovies({ language: 'en', categories: few, category: 1, top: 2, zone: 'grid', index: 12 });
    expect(short.tiles.map((t) => t.index)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(moviesGridFailures(short, 'ltr')).toEqual([]);
  });

  it('fails a poster not drawn, at another size, from another movie, or an image where none should be', () => {
    const view = at();
    const entry = listedFilms(FILMS_LIST, 0)!;
    expect(posterFailures(view, entry)).toEqual([]);
    const poster = view.tiles[0]!.poster!;
    expect(posterFailures(withTile(view, 0, () => ({ poster: { ...poster, drawn: false } })), entry)).toEqual(['1 of 18 tiles wrong: tile 0 (Lablo Film 2401): the poster was never drawn']);
    expect(posterFailures(withTile(view, 0, () => ({ poster: { ...poster, width: 1, height: 1 } })), entry)[0]).toContain('the poster is 1x1, expected the file\'s 184x276');
    expect(posterFailures(withTile(view, 0, () => ({ poster: { ...poster, height: 100 } })), entry)[0]).toContain("the poster is 184x100, expected the file's 184x276");
    expect(posterFailures(withTile(view, 0, () => ({ poster: { ...poster, src: view.tiles[1]!.poster!.src } })), entry)[0]).toContain(`the poster is ${view.tiles[1]!.poster!.src}, expected ${poster.src}`);
    expect(posterFailures(withTile(view, 7, () => ({ poster })), entry)[0]).toContain('tile 7 (Lablo Film 2408): draws an image');
    expect(posterFailures(withTile(view, 12, () => ({ poster })), entry)[0]).toContain('though its poster is none');
    expect(posterFailures(withTile(view, 2, () => ({ poster: null })), entry)[0]).toContain('tile 2 (Lablo Film 2403): no poster');
    expect(posterFailures(withTile(view, 2, (t) => ({ poster: { ...t.poster!, left: t.left + 100 } })), entry)[0]).toContain('the poster is drawn at 80x268 px');
    expect(posterFailures(withTile(view, 2, (t) => ({ poster: { ...t.poster!, right: t.right + 30 } })), entry)[0]).toContain(', outside its tile');
    expect(posterFailures(withTile(view, 4, () => ({ title: 'Another' })), entry)[0]).toContain('title "Another"');
  });

  it('fails a focus drawn on another tile, or on a tile while the rail has it', () => {
    expect(tileFocusFailures(at({ index: 3 }), 'grid', 3)).toEqual([]);
    expect(tileFocusFailures(at({ index: 3 }), 'grid', 4)).toEqual(['tiles 3 drawn focused, expected 4 (the focus is on the grid)']);
    expect(tileFocusFailures(at({ index: 3 }), 'rail', 1)).toEqual(['tiles 3 drawn focused, expected none (the focus is on the rail)']);
    expect(tileFocusFailures(at({ zone: 'rail' }), 'rail', 1)).toEqual([]);
  });

  it("fails the rail's chips, counts or selection, and the header's category or count", () => {
    const view = at({ category: 2 });
    expect(filmRailFailures(view, FILMS_LIST, 'en')).toEqual([]);
    expect(filmRailFailures({ ...view, chips: view.chips.slice(0, 2) }, FILMS_LIST, 'en')).toEqual(['the rail draws chips 0, 1, expected 0, 1, 2', 'rail: chips none selected, expected 2']);
    expect(filmRailFailures({ ...view, chips: view.chips.map((c) => (c.i === 1 ? { ...c, count: '299' } : c)) }, FILMS_LIST, 'en')).toEqual(['rail: chip 1: count "299", expected 300']);
    expect(filmRailFailures({ ...view, chips: view.chips.map((c) => ({ ...c, selected: c.i === 0 })) }, FILMS_LIST, 'en')).toEqual(['rail: chips 0 selected, expected 2']);
    expect(filmRailFailures(at({ category: 2, language: 'ar' }), FILMS_LIST, 'ar')).toEqual([]);
    expect(filmRailFailures(at(), FILMS_LIST, 'ar')).toEqual([`rail: chip 0: "${MOVIES_TEXT.en.all}", expected "${MOVIES_TEXT.ar.all}"`, `the header names "${MOVIES_TEXT.en.all}", expected "${MOVIES_TEXT.ar.all}"`]);
    expect(filmRailFailures({ ...view, count: 600 }, FILMS_LIST, 'en')).toEqual(['the header counts 600 movies, expected 300']);
    expect(filmRailFailures({ ...view, category: 9 }, FILMS_LIST, 'en')).toContain('the screen shows rail entry 9, which the fixture does not have');
    expect(moviesFailures(null, { dir: 'ltr', zone: 'grid', index: 0 }, FILMS_LIST, 'en')).toEqual(['no movies screen']);
    // All the checks together: the rail's, and the focus's.
    expect(ok({ ...view, count: 1 }, 'ltr', 'grid', 0)).toEqual(['the header counts 1 movies, expected 300']);
    expect(ok(at({ index: 3 }), 'ltr', 'grid', 0)).toEqual(['tiles 3 drawn focused, expected 0 (the focus is on the grid)']);
  });
});
