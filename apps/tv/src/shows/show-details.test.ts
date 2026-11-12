import { effect } from '@preact/signals';
import type { CatalogItem, XtreamEpisode, XtreamSeriesInfo } from '@lablo/core';
import type { SeriesInfoRequest } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import { LAYOUT, createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { MovieProgress } from '../movies/movie-progress';
import { createMovieProgress } from '../movies/movie-progress';
import {
  EPISODES_VISIBLE,
  SEASONS_VISIBLE,
  SHOW,
  SHOW_EPISODES,
  SHOW_SCREEN,
  SHOW_SEASONS,
  createShowDetails,
  episodeLine,
  seasonName,
  showFacts,
  showSeasons,
} from './show-details';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function show(id: number, overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    key: `x:s1:series:${id}`,
    src: 's1',
    kind: 'series',
    name: `Show ${id}`,
    normName: '',
    group: 'Test Series',
    url: '',
    logo: `http://panel.test/images/series-${id}.png`,
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

function episode(id: number, season: number, num: number | null): XtreamEpisode {
  return {
    key: `x:s1:episode:${id}`,
    id: String(id),
    season,
    episodeNum: num,
    title: `E${num ?? '?'}`,
    url: `http://panel.test/series/u/p/${id}.mkv`,
    durationSecs: 300,
    plot: '',
    image: null,
    added: null,
  };
}

/** Three seasons listed: the first two with episodes (3 and 2), "Specials" with none. */
const INFO: XtreamSeriesInfo = {
  name: 'Show 301',
  plot: 'Our own test series.',
  genre: 'Test',
  cast: '',
  director: '',
  releaseDate: '2026-01-01',
  rating: 8,
  cover: 'http://panel.test/c/301.jpg',
  backdrops: [],
  seasons: [
    { number: 1, name: 'Season 1', cover: null, episodeCount: 3 },
    { number: 2, name: 'Season 2', cover: null, episodeCount: 2 },
    { number: 3, name: 'Specials', cover: null, episodeCount: 0 },
  ],
  episodes: [episode(3001, 1, 1), episode(3002, 1, 2), episode(3003, 1, 3), episode(3011, 2, 1), episode(3012, 2, 2)],
  skipped: 0,
};

/** What OK on an episode played: the show, the episode, its place in its season, and where it starts. */
type Played = [CatalogItem, XtreamEpisode, number, number | undefined];

/** Episodes' places and shows' last episodes, as the app keeps them (its writes go nowhere). */
function places(): MovieProgress {
  return createMovieProgress({ edit: () => Promise.resolve(true), now: () => 1000 });
}

/** The series screen's navigator with the details over it; the engine's reads held until the test answers. */
function setup(progress?: MovieProgress) {
  const nav = createNavigator({
    root: { id: 'series', zones: [{ kind: 'grid', id: 'grid', columns: 6, count: 2, visibleRows: 3 }] },
    dir: 'ltr',
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const reads: { req: SeriesInfoRequest; answer: (info: XtreamSeriesInfo | null) => void; fail: (error: unknown) => void }[] = [];
  const played: Played[] = [];
  const details = createShowDetails({
    nav,
    engine: { seriesInfo: (req) => new Promise((resolve, reject) => reads.push({ req, answer: resolve, fail: reject })) },
    play: (item, at, index, fromMs) => played.push([item, at, index, fromMs]),
    ...(progress === undefined ? {} : { progress }),
  });
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  /** The zones' counts as the screen has them. */
  const counts = (): string => {
    const top = details.screen.value!;
    const count = (id: string): number => {
      const zone = top.zone(id);
      return zone.kind === 'list' ? zone.count : -1;
    };
    return `${count(SHOW_SEASONS)} seasons, ${count(SHOW_EPISODES)} episodes`;
  };
  return { nav, details, reads, press, at, counts, played };
}

describe("a show's details (RELAY step 27b)", () => {
  it("opens with the catalog's facts, reads the panel's, and shows the first season's episodes", async () => {
    const t = setup();
    const item = show(301);
    t.details.open(item);
    expect(t.nav.snapshot().depth).toBe(2);
    expect(t.details.screen.value).toBe(t.nav.top);
    expect(t.nav.top.id).toBe(SHOW_SCREEN);
    // The e2e and the old-engine walk read the screen's id in the focus path.
    expect(SHOW_SCREEN).toBe('show');
    expect(t.details.shown.value).toEqual({ item, status: 'reading', info: null, seasons: [] });
    expect(t.details.pending.value).toBe(1);
    expect(t.counts()).toBe('0 seasons, 0 episodes');
    expect(t.reads.map((r) => r.req)).toEqual([{ src: 's1', key: item.key }]);
    t.reads[0]!.answer(INFO);
    await flush();
    const shown = t.details.shown.value!;
    expect(shown).toMatchObject({ item, status: 'read', info: INFO });
    expect(shown.seasons.map((s) => [s.number, s.name, s.episodes.map((e) => e.id).join(' ')])).toEqual([
      [1, '', '3001 3002 3003'],
      [2, '', '3011 3012'],
    ]);
    expect(t.details.pending.value).toBe(0);
    expect(t.details.season.value).toBe(0);
    expect(t.counts()).toBe('2 seasons, 3 episodes');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
    // Open, another show opens nothing.
    t.details.open(show(302));
    expect(t.reads).toHaveLength(1);
    expect(t.details.shown.value!.item).toBe(item);
  });

  it('follows the focus along the seasons, each from its first episode', async () => {
    const t = setup();
    t.details.open(show(301));
    t.reads[0]!.answer(INFO);
    await flush();
    await t.press('DOWN', 'DOWN');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 2`);
    // UP from the first episode only: then the seasons, on the season on show.
    await t.press('UP', 'UP');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
    await t.press('UP');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_SEASONS} 0`);
    expect(t.details.season.value).toBe(0);
    // RIGHT: season 2 and its two episodes, from the top.
    await t.press('DOWN', 'DOWN', 'UP', 'UP', 'UP');
    await t.press('RIGHT');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_SEASONS} 1`);
    expect(t.details.season.value).toBe(1);
    expect(t.counts()).toBe('2 seasons, 2 episodes');
    expect(t.nav.top.position(SHOW_EPISODES).index).toBe(0);
    // No season after the last.
    await t.press('RIGHT');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_SEASONS} 1`);
    await t.press('DOWN', 'DOWN');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 1`);
    expect(t.nav.snapshot().depth).toBe(2);
    // Back to season 1: its three episodes, from the top again.
    await t.press('UP', 'UP', 'LEFT');
    expect(t.details.season.value).toBe(0);
    expect(t.counts()).toBe('2 seasons, 3 episodes');
    expect(t.nav.top.position(SHOW_EPISODES).index).toBe(0);
    // Left on the third episode (Back goes up from anywhere), season 2 still starts at its first.
    await t.press('DOWN', 'DOWN', 'DOWN', 'BACK', 'RIGHT');
    expect(t.details.season.value).toBe(1);
    expect(t.nav.top.position(SHOW_EPISODES).index).toBe(0);
  });

  it('goes from a season to its episodes with OK, where the focus was', async () => {
    const t = setup();
    t.details.open(show(301));
    t.reads[0]!.answer(INFO);
    await flush();
    await t.press('DOWN', 'DOWN');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 2`);
    expect(t.details.shown.value!.status).toBe('read');
    t.nav.top.focus(SHOW_SEASONS, 0);
    await t.press('OK');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 2`);
    await t.press('UP', 'UP', 'UP', 'RIGHT', 'OK');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
    expect(t.details.season.value).toBe(1);
    // OK on a season plays nothing.
    expect(t.played).toEqual([]);
  });

  it('goes Back from the episodes to the season on show, and from the seasons to the series screen', async () => {
    const t = setup();
    const item = show(301);
    t.details.open(item);
    t.reads[0]!.answer(INFO);
    await flush();
    await t.press('UP', 'RIGHT', 'DOWN', 'DOWN', 'BACK');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_SEASONS} 1`);
    expect(t.details.season.value).toBe(1);
    // DOWN returns to the episode the focus left.
    await t.press('DOWN');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 1`);
    await t.press('BACK', 'BACK');
    expect(t.at()).toBe('series · grid 0');
    expect(t.details.shown.value).toBeNull();
    expect(t.details.screen.value).toBeNull();
    expect(t.details.season.value).toBe(0);
    // It opens again, from the first season (the answer is the worker's to keep).
    t.details.open(item);
    t.reads[1]!.answer(INFO);
    await flush();
    expect(t.details.season.value).toBe(0);
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
    expect(t.counts()).toBe('2 seasons, 3 episodes');
  });

  it("keeps the catalog's facts when the read fails; Back closes, while it reads too", async () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.details.open(show(301));
    await t.press('BACK');
    expect(t.at()).toBe('series · grid 0');
    expect(t.details.pending.value).toBe(0);
    // The answer of the closed details is dropped, a failure unreported.
    t.reads[0]!.fail(new Error('HTTP 503'));
    await flush();
    expect(t.details.shown.value).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    t.details.open(show(302));
    t.reads[1]!.fail(new Error('HTTP 503'));
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'failed', info: null, seasons: [] });
    expect(t.details.pending.value).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t.counts()).toBe('0 seasons, 0 episodes');
    await t.press('OK', 'UP', 'BACK');
    expect(t.at()).toBe('series · grid 0');
    warn.mockRestore();
  });

  it('has no seasons for a show with no panel, one the panel lists no episodes for, or one it does not know', async () => {
    const t = setup();
    t.details.open(show(301));
    t.reads[0]!.answer({ ...INFO, episodes: [] });
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'read', seasons: [] });
    expect(t.counts()).toBe('0 seasons, 0 episodes');
    expect(t.nav.snapshot().index).toBe(-1);
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} -1`);
    expect(t.details.season.value).toBe(0);
    await t.press('BACK');
    t.details.open(show(302));
    t.reads[1]!.answer(null);
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'read', info: null, seasons: [] });
    await t.press('BACK');
    expect(t.nav.snapshot().depth).toBe(1);
  });

  it('drops an answer for details opened on another show since', async () => {
    const t = setup();
    t.details.open(show(301));
    await t.press('BACK');
    t.details.open(show(302));
    t.reads[0]!.answer(INFO);
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'reading', seasons: [] });
    expect(t.details.pending.value).toBe(1);
    t.reads[1]!.answer({ ...INFO, name: 'Show 302', episodes: [episode(3021, 1, 1)] });
    await flush();
    expect(t.details.shown.value!.item.key).toBe('x:s1:series:302');
    expect(t.counts()).toBe('1 seasons, 1 episodes');
  });

  it('marks a failed cover until the next open, and drops answers after dispose', async () => {
    const t = setup();
    t.details.open(show(301));
    t.details.failPoster();
    expect(t.details.posterFailed.value).toBe(true);
    await t.press('BACK');
    t.details.open(show(301));
    expect(t.details.posterFailed.value).toBe(false);
    t.details.dispose();
    t.reads[1]!.answer(INFO);
    await flush();
    expect(t.details.shown.value).toMatchObject({ status: 'reading', seasons: [] });
    // Disposed, it no longer follows the focus along the seasons.
    t.nav.top.update({ kind: 'list', id: SHOW_SEASONS, axis: 'horizontal', count: 2 });
    t.nav.top.focus(SHOW_SEASONS, 1);
    expect(t.details.season.value).toBe(0);
  });
});

describe('playing an episode (RELAY step 27c1)', () => {
  it('plays the episode OK is on, from where it was left, in its season', async () => {
    const progress = places();
    const t = setup(progress);
    const item = show(301);
    const [e1, e2, , e4] = INFO.episodes;
    t.details.open(item);
    t.reads[0]!.answer(INFO);
    await flush();
    // Never played: from its start.
    await t.press('OK');
    expect(t.played).toEqual([[item, e1, 0, undefined]]);
    expect(t.nav.snapshot().depth).toBe(2);
    // Left at 0:40: from there; the row's place and bar.
    progress.save(e2!.key, 40_000, 300_000, false, item.key);
    expect(t.details.point(e2!.key)).toEqual({ positionMs: 40_000, lengthMs: 300_000 });
    expect(t.details.share(e2!.key)).toBeCloseTo(40 / 300, 6);
    expect(t.details.point(e1!.key)).toBeNull();
    expect(t.details.share(e1!.key)).toBeUndefined();
    await t.press('DOWN', 'OK');
    expect(t.played[1]).toEqual([item, e2, 1, 40_000]);
    // Never played, further down: from its start, its place in the season.
    await t.press('DOWN', 'OK');
    expect(t.played[2]).toEqual([item, INFO.episodes[2], 2, undefined]);
    // Season 2's first: its own place in its season.
    await t.press('UP', 'UP', 'UP', 'RIGHT', 'DOWN', 'OK');
    expect(t.played[3]).toEqual([item, e4, 0, undefined]);
    expect(t.played).toHaveLength(4);
  });

  it("reads the rows' places again when one is saved, and has none without the app's", async () => {
    const progress = places();
    const t = setup(progress);
    const item = show(301);
    const key = INFO.episodes[0]!.key;
    const before = progress.version.value;
    t.details.open(item);
    t.reads[0]!.answer(INFO);
    await flush();
    let reads = 0;
    const stop = effect(() => {
      t.details.point(key);
      reads += 1;
    });
    progress.save(key, 60_000, 300_000, false, item.key);
    expect(progress.version.value).toBe(before + 1);
    expect(reads).toBe(2);
    stop();
    let shares = 0;
    const stopShares = effect(() => {
      t.details.share(key);
      shares += 1;
    });
    progress.save(key, 70_000, 300_000, false, item.key);
    expect(shares).toBe(2);
    stopShares();
    // No places kept: none to show, and OK plays from the start.
    const bare = setup();
    bare.details.open(item);
    bare.reads[0]!.answer(INFO);
    await flush();
    expect(bare.details.point(key)).toBeNull();
    expect(bare.details.share(key)).toBeUndefined();
    await bare.press('OK');
    expect(bare.played).toEqual([[item, INFO.episodes[0], 0, undefined]]);
  });

  it("opens on the show's last episode, or the next once it was watched, across seasons", async () => {
    const progress = places();
    const item = show(301);
    const open = async (): Promise<ReturnType<typeof setup>> => {
      const t = setup(progress);
      t.details.open(item);
      t.reads[0]!.answer(INFO);
      await flush();
      return t;
    };
    // Left part way: on it.
    progress.save(INFO.episodes[1]!.key, 40_000, 300_000, false, item.key);
    let t = await open();
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 1`);
    expect(t.details.season.value).toBe(0);
    // Watched, the last of season 1: season 2's first, the seasons' row on it.
    progress.save(INFO.episodes[2]!.key, 0, 300_000, true, item.key);
    t = await open();
    expect(t.details.season.value).toBe(1);
    expect(t.counts()).toBe('2 seasons, 2 episodes');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
    await t.press('UP');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_SEASONS} 1`);
    // Watched, the show's last episode: it stays on it.
    progress.save(INFO.episodes[4]!.key, 230_000, 240_000, false, item.key);
    t = await open();
    expect(t.details.season.value).toBe(1);
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 1`);
    // Another show's last episode isn't this one's.
    t = setup(progress);
    t.details.open(show(302));
    t.reads[0]!.answer(INFO);
    await flush();
    expect(t.details.season.value).toBe(0);
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
    // One the panel no longer lists: the first.
    progress.save('x:s1:episode:9999', 40_000, 300_000, false, item.key);
    t = await open();
    expect(t.details.season.value).toBe(0);
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
  });

  it("goes to the show's last episode when the player closes (refresh)", async () => {
    const progress = places();
    const t = setup(progress);
    const item = show(301);
    // Not open: nothing.
    t.details.refresh();
    expect(t.at()).toBe('series · grid 0');
    t.details.open(item);
    // Still reading: nothing to focus.
    t.details.refresh();
    expect(t.details.season.value).toBe(0);
    t.reads[0]!.answer(INFO);
    await flush();
    await t.press('DOWN', 'DOWN');
    // Season 2's first played and left part way: on it, the seasons' row on season 2.
    progress.save(INFO.episodes[3]!.key, 30_000, 240_000, false, item.key);
    t.details.refresh();
    expect(t.details.season.value).toBe(1);
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 0`);
    await t.press('BACK');
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_SEASONS} 1`);
    // It ended: on the next one, in the same season.
    progress.save(INFO.episodes[3]!.key, 0, 240_000, true, item.key);
    t.details.refresh();
    expect(t.at()).toBe(`${SHOW_SCREEN} · ${SHOW_EPISODES} 1`);
    // A show with no episodes: nothing to focus.
    await t.press('BACK', 'BACK');
    t.details.open(show(302));
    t.reads[1]!.answer({ ...INFO, episodes: [] });
    await flush();
    t.details.refresh();
    expect(t.nav.snapshot().index).toBe(-1);
  });
});

describe("a show's seasons and facts", () => {
  it('names a season only when the panel says more than "Season 2"', () => {
    const name = (number: number, text: string): string => seasonName({ number, name: text, cover: null, episodeCount: null });
    expect(name(2, 'Season 2')).toBe('');
    expect(name(2, 'season 02')).toBe('');
    expect(name(2, 'S2')).toBe('');
    expect(name(2, '')).toBe('');
    // Another number, or more words: the panel's.
    expect(name(2, 'Season 1')).toBe('Season 1');
    expect(name(1, 'Season 1: The Start')).toBe('Season 1: The Start');
    expect(name(1, 'الموسم ١')).toBe('الموسم ١');
    expect(name(0, 'Specials')).toBe('Specials');
    // A name that only ends like "S2" is the panel's own.
    expect(name(2, 'Bonus 2')).toBe('Bonus 2');
    expect(name(2, 'Extras S2')).toBe('Extras S2');
  });

  it("gives an episode's row its number, title and length", () => {
    expect(episodeLine(episode(3002, 1, 2), 1)).toEqual({ number: 2, title: 'E2', lengthSecs: 300 });
    // No number: its place in the season. No title, no length.
    expect(episodeLine({ ...episode(3009, 1, null), title: '', durationSecs: null }, 4)).toEqual({ number: 5, title: '', lengthSecs: null });
    expect(episodeLine({ ...episode(3009, 1, 7), durationSecs: 0 }, 0)).toEqual({ number: 7, title: 'E7', lengthSecs: null });
  });

  it('lists the seasons that have episodes, in order', () => {
    expect(showSeasons(null)).toEqual([]);
    const seasons = showSeasons(INFO);
    expect(seasons.map((s) => s.number)).toEqual([1, 2]);
    expect(seasons[1]!.episodes).toEqual([INFO.episodes[3], INFO.episodes[4]]);
    expect(showSeasons({ ...INFO, seasons: [{ number: 0, name: 'Specials', cover: null, episodeCount: 1 }, ...INFO.seasons], episodes: [episode(1, 0, 1), ...INFO.episodes] }).map((s) => s.name)).toEqual(['Specials', '', '']);
  });

  it("takes the catalog's facts first, and the panel's once read", () => {
    const item = show(301);
    expect(showFacts(item, null)).toEqual({ title: 'Show 301', group: 'Test Series', poster: item.logo, year: null, rating: null, genre: '', plot: '' });
    expect(showFacts(item, INFO)).toEqual({ title: 'Show 301', group: 'Test Series', poster: item.logo, year: 2026, rating: 8, genre: 'Test', plot: 'Our own test series.' });
    // No catalog cover: the panel's. No year, no rating (0 is none).
    expect(showFacts(show(302, { logo: null }), { ...INFO, releaseDate: '', rating: 0 })).toMatchObject({ poster: INFO.cover, year: null, rating: null });
    expect(showFacts(show(302, { logo: null }), null).poster).toBeNull();
  });

  it('fits five episodes and six seasons in the screen, as show.css lays them out', () => {
    expect(SEASONS_VISIBLE).toBe(6);
    expect(EPISODES_VISIBLE).toBe(5);
    expect(SEASONS_VISIBLE * SHOW.seasonWidth + (SEASONS_VISIBLE - 1) * SHOW.seasonGap).toBeLessThanOrEqual(SHOW.bodyWidth);
    // The body under the header: the top band, 24 px, the seasons, 24 px, the episodes.
    expect(SHOW.topHeight + 24 + LAYOUT.railHeight + 24 + SHOW.listHeight).toBe(1080 - 2 * 54 - 56 - 24);
  });
});
