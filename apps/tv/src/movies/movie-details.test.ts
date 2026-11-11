import type { CatalogItem, XtreamVodInfo } from '@lablo/core';
import type { VodInfoRequest } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import { createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import { BACK_ACTION, MOVIE_ACTIONS, MOVIE_SCREEN, PLAY_ACTION, createMovieDetails, movieFacts, movieRequest, releaseYear } from './movie-details';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function film(id: number, overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    key: `x:s1:movie:${id}`,
    src: 's1',
    kind: 'movie',
    name: `Film ${id}`,
    normName: '',
    group: 'Blender',
    url: `http://panel.test/movie/u/p/${id}.mp4`,
    logo: `http://panel.test/images/movie-${id}.png`,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
    ...overrides,
  };
}

const INFO: XtreamVodInfo = {
  name: 'Sintel (2010)',
  plot: 'A girl looks for her dragon.',
  genre: 'Animation, Fantasy',
  cast: 'Halina Reijn',
  director: 'Colin Levy',
  releaseDate: '2010-09-27',
  durationSecs: 888,
  rating: 7.4,
  cover: 'http://panel.test/c/sintel.jpg',
  backdrops: [],
  trailer: null,
  ext: 'mp4',
};

/** The movies screen's navigator with the details over it; the engine's reads held until the test answers. */
function setup() {
  const nav = createNavigator({
    root: { id: 'movies', zones: [{ kind: 'grid', id: 'grid', columns: 6, count: 12, visibleRows: 3 }] },
    dir: 'ltr',
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const reads: { req: VodInfoRequest; answer: (info: XtreamVodInfo | null) => void; fail: (error: unknown) => void }[] = [];
  const played: { item: CatalogItem; info: XtreamVodInfo | null }[] = [];
  const details = createMovieDetails({
    nav,
    engine: { vodInfo: (req) => new Promise((resolve, reject) => reads.push({ req, answer: resolve, fail: reject })) },
    play: (item, info) => played.push({ item, info }),
  });
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { nav, details, reads, played, press, at };
}

describe('movie details (RELAY step 26c)', () => {
  it("opens on Play with the catalog's facts, reads the panel's, and shows them", async () => {
    const t = setup();
    const item = film(203);
    t.details.open(item);
    expect(t.at()).toBe(`${MOVIE_SCREEN} · ${MOVIE_ACTIONS} ${PLAY_ACTION}`);
    expect(t.nav.snapshot().depth).toBe(2);
    expect(t.details.screen.value).toBe(t.nav.top);
    expect(t.details.shown.value).toEqual({ item, status: 'reading', info: null });
    expect(t.details.pending.value).toBe(1);
    expect(t.reads.map((r) => r.req)).toEqual([{ src: 's1', key: item.key, url: item.url }]);
    t.reads[0]!.answer(INFO);
    await flush();
    expect(t.details.shown.value).toEqual({ item, status: 'read', info: INFO });
    expect(t.details.pending.value).toBe(0);
    // Open, another movie opens nothing.
    t.details.open(film(204));
    expect(t.reads).toHaveLength(1);
    expect(t.details.shown.value!.item).toBe(item);
  });

  it('shows the catalog\'s facts alone when the read fails, or when there is no panel', async () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.details.open(film(203));
    t.reads[0]!.fail(new Error('HTTP 503'));
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'failed', info: null });
    expect(t.details.pending.value).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    await t.press('BACK');
    // A plain playlist's movie: the worker answers `null` at once.
    t.details.open(film(9, { key: 'm:s2:abc', src: 's2', url: 'http://cdn.test/films/9.mkv' }));
    t.reads[1]!.answer(null);
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'read', info: null });
    warn.mockRestore();
  });

  it('plays with what was read, or without waiting for it; the details stay under the player', async () => {
    const t = setup();
    const item = film(203);
    t.details.open(item);
    await t.press('OK');
    expect(t.played).toEqual([{ item, info: null }]);
    expect(t.nav.snapshot().depth).toBe(2);
    t.reads[0]!.answer(INFO);
    await flush();
    await t.press('OK');
    expect(t.played).toEqual([
      { item, info: null },
      { item, info: INFO },
    ]);
  });

  it('closes on Back (the key or the button), and drops an answer that comes after', async () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.details.open(film(203));
    await t.press('BACK');
    expect(t.details.shown.value).toBeNull();
    expect(t.details.screen.value).toBeNull();
    expect(t.details.pending.value).toBe(0);
    expect(t.at()).toBe('movies · grid 0');
    t.reads[0]!.answer(INFO);
    await flush();
    expect(t.details.shown.value).toBeNull();
    // The button; an earlier open's late failure says nothing and changes nothing.
    t.details.open(film(204));
    await t.press('RIGHT');
    expect(t.at()).toBe(`${MOVIE_SCREEN} · ${MOVIE_ACTIONS} ${BACK_ACTION}`);
    await t.press('OK');
    expect(t.details.shown.value).toBeNull();
    expect(t.played).toEqual([]);
    t.details.open(film(205));
    t.reads[1]!.fail(new Error('late'));
    await flush();
    expect(t.details.shown.value).toMatchObject({ item: { key: 'x:s1:movie:205' }, status: 'reading' });
    expect(warn).not.toHaveBeenCalled();
    // Dispose drops the answer still out.
    t.details.dispose();
    t.reads[2]!.answer(INFO);
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'reading' });
    warn.mockRestore();
  });

  it("keeps the poster's failure until the next open", () => {
    const t = setup();
    t.details.open(film(203));
    t.details.failPoster();
    expect(t.details.posterFailed.value).toBe(true);
    t.nav.handle('BACK');
    t.details.open(film(204));
    expect(t.details.posterFailed.value).toBe(false);
  });
});

describe("movieFacts: the catalog's facts and the panel's", () => {
  it('takes the title, category and poster from the catalog, the rest from the panel', () => {
    expect(movieFacts(film(203), INFO)).toEqual({
      title: 'Film 203',
      group: 'Blender',
      poster: 'http://panel.test/images/movie-203.png',
      year: 2010,
      lengthSecs: 888,
      rating: 7.4,
      genre: 'Animation, Fantasy',
      plot: 'A girl looks for her dragon.',
      director: 'Colin Levy',
      cast: 'Halina Reijn',
    });
    // No catalog poster: the panel's cover; nothing read: the catalog's alone.
    expect(movieFacts(film(203, { logo: null }), INFO).poster).toBe('http://panel.test/c/sintel.jpg');
    expect(movieFacts(film(203, { logo: null, group: '' }), null)).toEqual({ title: 'Film 203', group: '', poster: null, year: null, lengthSecs: null, rating: null, genre: '', plot: '', director: '', cast: '' });
    // A zero length or rating says nothing.
    expect(movieFacts(film(1), { ...INFO, durationSecs: 0, rating: 0 })).toMatchObject({ lengthSecs: null, rating: null });
    expect(movieFacts(film(1), { ...INFO, durationSecs: null, rating: null, cover: null })).toMatchObject({ lengthSecs: null, rating: null });
  });

  it('reads the year of a release date', () => {
    expect(releaseYear('2010-09-27')).toBe(2010);
    expect(releaseYear('1999')).toBe(1999);
    expect(releaseYear('1900-01-01')).toBe(1900);
    expect(releaseYear('2100')).toBe(2100);
    expect(releaseYear('2010.5')).toBe(2010);
    for (const date of ['', '201', '20a0-01-01', '1899-12-31', '2101', '  2010', '0000-00-00']) expect(releaseYear(date)).toBeNull();
  });
});

describe('movieRequest', () => {
  it("plays the catalog's URL as a VOD, with the panel's container_extension when it differs", () => {
    expect(movieRequest(film(203), null)).toEqual({ key: 'x:s1:movie:203', src: 's1', mode: 'vod', candidates: [{ url: 'http://panel.test/movie/u/p/203.mp4', container: 'mp4' }] });
    expect(movieRequest(film(203), INFO).candidates).toEqual([{ url: 'http://panel.test/movie/u/p/203.mp4', container: 'mp4' }]);
    expect(movieRequest(film(206), { ...INFO, ext: '.MKV' }).candidates).toEqual([{ url: 'http://panel.test/movie/u/p/206.mkv', container: 'mkv' }]);
    // No extension named, or one that isn't one: the catalog's URL.
    expect(movieRequest(film(206), { ...INFO, ext: null }).candidates[0]!.url).toBe('http://panel.test/movie/u/p/206.mp4');
    expect(movieRequest(film(206), { ...INFO, ext: 'm k v' }).candidates[0]!.url).toBe('http://panel.test/movie/u/p/206.mp4');
    // A URL that is no panel's movie URL is played as it is.
    const plain = film(9, { url: 'http://cdn.test/films/9.mkv?t=1' });
    expect(movieRequest(plain, { ...INFO, ext: 'mp4' }).candidates).toEqual([{ url: 'http://cdn.test/films/9.mkv?t=1', container: 'mkv' }]);
  });
});
