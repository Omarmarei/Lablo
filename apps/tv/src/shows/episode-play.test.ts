import type { CatalogItem, ContentKey, XtreamEpisode } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import type { ResumePoint } from '../movies/movie-progress';
import type { EpisodePlayOptions } from './episode-play';
import { FIRST_PLACE, episodeItem, episodeMark, episodePlace, episodePlay, episodeRequest, nextPlace, resumePlace } from './episode-play';
import type { ShowSeason } from './show-details';

const SHOW: CatalogItem = {
  key: 'x:s1:series:301',
  src: 's1',
  kind: 'series',
  name: 'Lablo Test Series',
  normName: 'lablo test series',
  group: 'Test Series',
  url: '',
  logo: 'http://panel.test/images/series-301.png',
  epgId: null,
  tvgName: null,
  matchName: null,
  chno: null,
  tvgShift: 0,
  catchup: null,
  radio: false,
  hints: null,
};

function episode(id: number, season: number, num: number | null, ext = 'mkv'): XtreamEpisode {
  return {
    key: `x:s1:episode:${id}`,
    id: String(id),
    season,
    episodeNum: num,
    title: `Episode ${id}`,
    url: `http://panel.test/series/u/p/${id}.${ext}`,
    durationSecs: 300,
    plot: '',
    image: null,
    added: null,
  };
}

/** Season 1 with three episodes, season 2 with two, season 4 with one (none listed for 3). */
const SEASONS: ShowSeason[] = [
  { number: 1, name: '', episodes: [episode(3001, 1, 1), episode(3002, 1, 2), episode(3003, 1, 3)] },
  { number: 2, name: '', episodes: [episode(3011, 2, 1, 'mp4'), episode(3012, 2, 2, 'mp4')] },
  { number: 4, name: '', episodes: [episode(3031, 4, 1)] },
];

const closed = (): void => undefined;
/** No episode was left part way. */
const none = (): ResumePoint | null => null;
/** The places kept, by key (read when asked). */
function keptAt(points: Record<string, ResumePoint>): (key: ContentKey) => ResumePoint | null {
  return (key) => (Object.prototype.hasOwnProperty.call(points, key) ? points[key]! : null);
}

/** A show of one season with `e` at `index` (other episodes before it). */
function alone(e: XtreamEpisode, index = 1): Pick<EpisodePlayOptions, 'seasons' | 'place'> {
  const episodes: XtreamEpisode[] = [];
  for (let i = 0; i < index; i += 1) episodes.push(episode(3900 + i, e.season, i + 1));
  episodes.push(e);
  return { seasons: [{ number: e.season, name: '', episodes }], place: { season: 0, index } };
}

describe("an episode's play (RELAY step 27c1)", () => {
  it("is the show's item with the episode's key, URL, title and image", () => {
    const e = episode(3002, 1, 2);
    expect(episodeItem(SHOW, e)).toEqual({ ...SHOW, key: e.key, name: 'Episode 3002', url: e.url });
    expect(episodeItem(SHOW, { ...e, title: '', image: 'http://panel.test/e.jpg' })).toEqual({ ...SHOW, key: e.key, url: e.url, logo: 'http://panel.test/e.jpg' });
  });

  it("asks for the episode's URL as VOD, keyed by the episode", () => {
    expect(episodeRequest('s1', episode(3002, 1, 2))).toEqual({
      key: 'x:s1:episode:3002',
      src: 's1',
      mode: 'vod',
      candidates: [{ url: 'http://panel.test/series/u/p/3002.mkv', container: 'mkv' }],
    });
    expect(episodeRequest('s2', episode(3011, 2, 1, 'mp4')).candidates).toEqual([{ url: 'http://panel.test/series/u/p/3011.mp4', container: 'mp4' }]);
  });

  it('marks the episode with its season and number, else its place in the season', () => {
    expect(episodeMark(SHOW, episode(3002, 1, 2), 1)).toEqual({ show: SHOW, season: 1, number: 2, title: 'Episode 3002' });
    expect(episodeMark(SHOW, episode(3009, 3, null), 4)).toEqual({ show: SHOW, season: 3, number: 5, title: 'Episode 3009' });
  });

  it("plays with the panel's length, else the one kept with its place, from where it was left", () => {
    const e = episode(3002, 1, 2);
    const play = episodePlay({ show: SHOW, seasons: SEASONS, place: { season: 0, index: 1 }, kept: none, closed });
    expect(play).toEqual({ item: episodeItem(SHOW, e), request: episodeRequest('s1', e), lengthMs: 300_000, episode: episodeMark(SHOW, e, 1), closed, next: expect.any(Function) });
    expect('fromMs' in play).toBe(false);
    expect(play.closed).toBe(closed);
    // The panel's length first; none (or 0): the one kept with its own place; neither: none.
    const left = { positionMs: 40_000, lengthMs: 290_000 };
    expect(episodePlay({ show: SHOW, ...alone(e), kept: keptAt({ [e.key]: left }), fromMs: 40_000, closed })).toMatchObject({ lengthMs: 300_000, fromMs: 40_000 });
    expect(episodePlay({ show: SHOW, ...alone({ ...e, durationSecs: null }), kept: keptAt({ [e.key]: left }), closed }).lengthMs).toBe(290_000);
    expect(episodePlay({ show: SHOW, ...alone({ ...e, durationSecs: null }), kept: keptAt({ 'x:s1:episode:3900': left }), closed }).lengthMs).toBeNull();
    expect(episodePlay({ show: SHOW, ...alone({ ...e, durationSecs: 0 }), kept: keptAt({ [e.key]: { positionMs: 40_000, lengthMs: null } }), closed }).lengthMs).toBeNull();
    expect(episodePlay({ show: SHOW, ...alone({ ...e, durationSecs: null }), kept: none, closed }).lengthMs).toBeNull();
    expect(episodePlay({ show: SHOW, seasons: SEASONS, place: { season: 0, index: 1 }, kept: none, fromMs: 0, closed }).fromMs).toBe(0);
    // The mark's number: the panel's, else the episode's place in its season.
    expect(episodePlay({ show: SHOW, ...alone({ ...e, episodeNum: null }, 4), kept: none, closed }).episode).toEqual({ show: SHOW, season: 1, number: 5, title: 'Episode 3002' });
    // The episode at the place: season 2's second.
    const s2e2 = episodePlay({ show: SHOW, seasons: SEASONS, place: { season: 1, index: 1 }, kept: none, closed });
    expect(s2e2.item.key).toBe('x:s1:episode:3012');
    expect(s2e2.episode).toEqual({ show: SHOW, season: 2, number: 2, title: 'Episode 3012' });
  });
});

describe("the next episode's play (RELAY step 27c2)", () => {
  it('goes on across seasons, each from where it was left (read when asked), until the last', () => {
    const points: Record<string, ResumePoint> = { 'x:s1:episode:3011': { positionMs: 50_000, lengthMs: 240_000 } };
    const kept = keptAt(points);
    const first = episodePlay({ show: SHOW, seasons: SEASONS, place: { season: 0, index: 1 }, kept, fromMs: 40_000, closed });
    // S1 E3: never played, from its start (the first's start isn't carried on).
    const second = first.next!()!;
    const e3 = SEASONS[0]!.episodes[2]!;
    expect(second).toEqual({ item: episodeItem(SHOW, e3), request: episodeRequest('s1', e3), lengthMs: 300_000, episode: episodeMark(SHOW, e3, 2), closed, next: expect.any(Function) });
    expect('fromMs' in second).toBe(false);
    // Season 2's first, from where it was left.
    const third = second.next!()!;
    const s2e1 = SEASONS[1]!.episodes[0]!;
    expect(third).toMatchObject({ item: episodeItem(SHOW, s2e1), request: episodeRequest('s1', s2e1), fromMs: 50_000, episode: { season: 2, number: 1 } });
    expect(third.closed).toBe(closed);
    // Then season 2's second, season 4's only one, and none after it.
    const fourth = third.next!()!;
    expect(fourth.item.key).toBe('x:s1:episode:3012');
    expect('fromMs' in fourth).toBe(false);
    const fifth = fourth.next!()!;
    expect(fifth.item.key).toBe('x:s1:episode:3031');
    expect(fifth.episode).toEqual({ show: SHOW, season: 4, number: 1, title: 'Episode 3031' });
    expect(fifth.next!()).toBeNull();
    // The place is read when the next one is asked for: one saved since counts, one taken away goes.
    points['x:s1:episode:3012'] = { positionMs: 70_000, lengthMs: 240_000 };
    expect(third.next!()!.fromMs).toBe(70_000);
    delete points['x:s1:episode:3011'];
    expect('fromMs' in second.next!()!).toBe(false);
    // A length kept with the next one's place when the panel has none.
    const bare: ShowSeason[] = [{ number: 1, name: '', episodes: [episode(3001, 1, 1), { ...episode(3002, 1, 2), durationSecs: null }] }];
    const next = episodePlay({ show: SHOW, seasons: bare, place: FIRST_PLACE, kept: keptAt({ 'x:s1:episode:3002': { positionMs: 20_000, lengthMs: 280_000 } }), closed }).next!()!;
    expect(next).toMatchObject({ lengthMs: 280_000, fromMs: 20_000 });
  });
});

describe("an episode's place in the details (RELAY step 27c1)", () => {
  it('finds an episode by its key in the seasons listed', () => {
    expect(episodePlace(SEASONS, 'x:s1:episode:3001')).toEqual({ season: 0, index: 0 });
    expect(episodePlace(SEASONS, 'x:s1:episode:3003')).toEqual({ season: 0, index: 2 });
    expect(episodePlace(SEASONS, 'x:s1:episode:3012')).toEqual({ season: 1, index: 1 });
    expect(episodePlace(SEASONS, 'x:s1:episode:3031')).toEqual({ season: 2, index: 0 });
    expect(episodePlace(SEASONS, 'x:s1:episode:9999')).toBeNull();
    expect(episodePlace([], 'x:s1:episode:3001')).toBeNull();
  });

  it('goes on to the next episode in its season, then to the next season listed; none after the last', () => {
    expect(nextPlace(SEASONS, { season: 0, index: 0 })).toEqual({ season: 0, index: 1 });
    expect(nextPlace(SEASONS, { season: 0, index: 2 })).toEqual({ season: 1, index: 0 });
    expect(nextPlace(SEASONS, { season: 1, index: 1 })).toEqual({ season: 2, index: 0 });
    expect(nextPlace(SEASONS, { season: 2, index: 0 })).toBeNull();
    expect(nextPlace(SEASONS.slice(0, 1), { season: 0, index: 2 })).toBeNull();
  });

  it("opens on the show's last episode, the next once watched (the last stays), else the first", () => {
    expect(FIRST_PLACE).toEqual({ season: 0, index: 0 });
    expect(resumePlace(SEASONS, null)).toBe(FIRST_PLACE);
    expect(resumePlace(SEASONS, { episode: 'x:s1:episode:3002', watched: false })).toEqual({ season: 0, index: 1 });
    expect(resumePlace(SEASONS, { episode: 'x:s1:episode:3002', watched: true })).toEqual({ season: 0, index: 2 });
    expect(resumePlace(SEASONS, { episode: 'x:s1:episode:3003', watched: true })).toEqual({ season: 1, index: 0 });
    expect(resumePlace(SEASONS, { episode: 'x:s1:episode:3031', watched: true })).toEqual({ season: 2, index: 0 });
    expect(resumePlace(SEASONS, { episode: 'x:s1:episode:9999', watched: false })).toBe(FIRST_PLACE);
    expect(resumePlace(SEASONS, { episode: 'x:s1:episode:9999', watched: true })).toBe(FIRST_PLACE);
  });
});
