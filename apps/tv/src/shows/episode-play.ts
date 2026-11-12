import type { CatalogItem, XtreamEpisode } from '@lablo/core';
import type { PlayRequest } from '@lablo/player';
import { containerOf } from '@lablo/player';
import type { LastEpisode, ResumePoint } from '../movies/movie-progress';
import type { EpisodeMark, MoviePlay } from '../player/player-state';
import type { ShowSeason } from './show-details';

/**
 * Playing a show's episode (RELAY step 27c1): the movie player's `playMovie`, with the episode's
 * own key, URL and length, and its place in the show for the info bar ("S1 E2 · title").
 *
 * - **The request** is `mode: 'vod'` on the episode's URL (`/series/<u>/<p>/<id>.<ext>`), keyed by
 *   the episode, so its place is kept as a movie's is.
 * - **The length** is the panel's (`durationSecs`), else the one kept with the episode's place.
 * - **Places** in the details are a season (an index into the seasons listed) and an episode (an
 *   index into its episodes). The show's last episode decides where the details open, and where
 *   Back from the player lands: on it, or on the next one, in the panel's order across seasons,
 *   once it was watched.
 */

/** An episode's place in the details: season `season` of those listed, its episode `index`. */
export interface EpisodePlace {
  readonly season: number;
  readonly index: number;
}

/** The first episode of the first season: where a show never played opens. */
export const FIRST_PLACE: EpisodePlace = { season: 0, index: 0 };

/** The episode as a catalog item (its key, its URL, its title as the name; the show's source and category). */
export function episodeItem(show: CatalogItem, episode: XtreamEpisode): CatalogItem {
  return { ...show, key: episode.key, name: episode.title === '' ? show.name : episode.title, url: episode.url, logo: episode.image ?? show.logo };
}

/** The request that plays `episode` of a show of source `src` (`mode: 'vod'`). */
export function episodeRequest(src: string, episode: XtreamEpisode): PlayRequest {
  return { key: episode.key, src, mode: 'vod', candidates: [{ url: episode.url, container: containerOf(episode.url) }] };
}

/** The episode's place in its show for the info bar: `index` is its place in the season (its number when the panel gives none). */
export function episodeMark(show: CatalogItem, episode: XtreamEpisode, index: number): EpisodeMark {
  return { show, season: episode.season, number: episode.episodeNum ?? index + 1, title: episode.title };
}

export interface EpisodePlayOptions {
  readonly show: CatalogItem;
  readonly episode: XtreamEpisode;
  /** Its place in the season. */
  readonly index: number;
  /** Where it was left (`null`: never, or watched): its length when the panel gives none. */
  readonly kept: ResumePoint | null;
  /** Where it starts (ms; absent: its start). */
  readonly fromMs?: number;
  /** The player closed: the details show again. */
  readonly closed: () => void;
}

/** What the player plays for an episode. */
export function episodePlay(options: EpisodePlayOptions): MoviePlay {
  const { show, episode, index, kept, fromMs, closed } = options;
  const secs = episode.durationSecs;
  const lengthMs = secs !== null && secs > 0 ? secs * 1000 : kept === null ? null : kept.lengthMs;
  const play: MoviePlay = { item: episodeItem(show, episode), request: episodeRequest(show.src, episode), lengthMs, episode: episodeMark(show, episode, index), closed };
  return fromMs === undefined ? play : { ...play, fromMs };
}

/** Where episode `key` is in the seasons listed (`null`: not there). */
export function episodePlace(seasons: readonly ShowSeason[], key: string): EpisodePlace | null {
  for (let s = 0; s < seasons.length; s += 1) {
    const episodes = seasons[s]!.episodes;
    for (let i = 0; i < episodes.length; i += 1) if (episodes[i]!.key === key) return { season: s, index: i };
  }
  return null;
}

/**
 * The episode after `place` (one of the seasons'): the next in its season, else the first of the
 * next season (`null`: it is the last). The seasons listed all have episodes (`showSeasons`).
 */
export function nextPlace(seasons: readonly ShowSeason[], place: EpisodePlace): EpisodePlace | null {
  if (place.index + 1 < seasons[place.season]!.episodes.length) return { season: place.season, index: place.index + 1 };
  return place.season + 1 < seasons.length ? { season: place.season + 1, index: 0 } : null;
}

/**
 * Where the details open on a show (and land when the player closes): its last episode, or the
 * next one once it was watched (the last one stays: nothing comes after it); the first episode
 * of the first season when none played, or the panel no longer lists it.
 */
export function resumePlace(seasons: readonly ShowSeason[], last: LastEpisode | null): EpisodePlace {
  if (last === null) return FIRST_PLACE;
  const at = episodePlace(seasons, last.episode);
  if (at === null) return FIRST_PLACE;
  return last.watched ? (nextPlace(seasons, at) ?? at) : at;
}
