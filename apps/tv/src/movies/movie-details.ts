import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, XtreamVodInfo } from '@zoma/core';
import { parseXtreamStreamUrl, streamExtension, xtreamStreamUrl } from '@zoma/core';
import type { VodInfoRequest } from '@zoma/data';
import type { PlayRequest } from '@zoma/player';
import { containerOf } from '@zoma/player';
import type { Navigator, Screen } from '@zoma/ui';

/**
 * A movie's details (RELAY step 26c, PLAN 7.1): a screen pushed on the live navigator over the
 * movies screen by OK on a poster, painted instead of it.
 *
 *   actions  ("Play", then "Back")
 *
 * - **What shows at once:** the catalog's facts (the poster, the title, the category). An Xtream
 *   movie's details (the year, the length, the rating, the genre, the plot, the director and the
 *   cast) come from its panel's `get_vod_info`, read when the details open and kept 24 h in the
 *   query worker; a spinner shows while the read is out. A movie with no panel (a plain playlist's)
 *   or one the panel doesn't know shows only the catalog's facts; so does a failed read, with a
 *   note. An answer for details that closed, or opened on another movie since, is dropped.
 * - **Play** (first, focused) hands the movie and what was read to `play`: the player opens over
 *   the details, and Back from it comes back here. Play doesn't wait for the read.
 * - **Back** (the button or the key) closes the details: the movies screen's focus is where it was.
 * - `pending` is 1 while the read is out (e2e).
 */

export const MOVIE_SCREEN = 'movie';
export const MOVIE_ACTIONS = 'actions';

/** "Play", then "Back". */
export const PLAY_ACTION = 0;
export const BACK_ACTION = 1;

/** `reading`: the panel's read is out; `read`: it answered (`info` may still be `null`); `failed`: it didn't. */
export type MovieDetailsStatus = 'reading' | 'read' | 'failed';

export interface MovieDetailsShown {
  readonly item: CatalogItem;
  readonly status: MovieDetailsStatus;
  /** The panel's details once read (`null` before, after a failure, or with no panel). */
  readonly info: XtreamVodInfo | null;
}

/** What the details need from the data engine (a `DataEngine` fits). */
export interface MovieDetailsEngine {
  vodInfo(req: VodInfoRequest): Promise<XtreamVodInfo | null>;
}

export interface MovieDetailsOptions {
  /** The live screen's navigator: the details are a screen on it, over the movies screen. */
  readonly nav: Navigator;
  readonly engine: MovieDetailsEngine;
  /** "Play": the movie and the panel's details (`null`: none read). */
  readonly play: (item: CatalogItem, info: XtreamVodInfo | null) => void;
}

export interface MovieDetails {
  /** The details while they show. */
  readonly shown: ReadonlySignal<MovieDetailsShown | null>;
  /** Their screen on the navigator while they show. */
  readonly screen: ReadonlySignal<Screen | null>;
  /** 1 while the panel's read is out. */
  readonly pending: ReadonlySignal<number>;
  /** The poster failed: the screen shows the title in its place. */
  readonly posterFailed: ReadonlySignal<boolean>;
  /** Opens the details on `item` and reads the panel's (nothing when they are open). */
  open(item: CatalogItem): void;
  /** The poster's image failed. */
  failPoster(): void;
  dispose(): void;
}

/** What the details screen shows of a movie. */
export interface MovieFacts {
  readonly title: string;
  /** The catalog's category (`''`: none). */
  readonly group: string;
  /** The catalog's poster, else the panel's cover (`null`: none). */
  readonly poster: string | null;
  readonly year: number | null;
  readonly lengthSecs: number | null;
  /** Out of 10. */
  readonly rating: number | null;
  readonly genre: string;
  readonly plot: string;
  readonly director: string;
  readonly cast: string;
}

/** The year of a panel's release date (`2010-05-01`, `2010`); `null` for anything else. */
export function releaseYear(date: string): number | null {
  const year = Number(date.slice(0, 4));
  // (Four characters in that range are a whole year.)
  return year >= 1900 && year <= 2100 ? year : null;
}

/** A movie's facts: the catalog's, with the panel's details when they were read. */
export function movieFacts(item: CatalogItem, info: XtreamVodInfo | null): MovieFacts {
  return {
    title: item.name,
    group: item.group,
    poster: item.logo ?? info?.cover ?? null,
    year: info === null ? null : releaseYear(info.releaseDate),
    lengthSecs: info === null || info.durationSecs === null || info.durationSecs <= 0 ? null : info.durationSecs,
    rating: info === null || info.rating === null || info.rating <= 0 ? null : info.rating,
    genre: info?.genre ?? '',
    plot: info?.plot ?? '',
    director: info?.director ?? '',
    cast: info?.cast ?? '',
  };
}

/**
 * The request that plays `item` (`mode: 'vod'`): its URL, with the panel's `container_extension`
 * when the details name another one than the catalog's URL has (a list without the extension
 * gets `.mp4` in the catalog).
 */
export function movieRequest(item: CatalogItem, info: XtreamVodInfo | null): PlayRequest {
  let url = item.url;
  const ext = info === null || info.ext === null ? '' : streamExtension(info.ext, '');
  const parsed = ext === '' ? null : parseXtreamStreamUrl(url);
  if (parsed !== null && parsed.kind === 'movie' && parsed.ext !== ext) url = xtreamStreamUrl(parsed, 'movie', parsed.id, ext);
  return { key: item.key, src: item.src, mode: 'vod', candidates: [{ url, container: containerOf(url) }] };
}

export function createMovieDetails(options: MovieDetailsOptions): MovieDetails {
  const { nav, engine } = options;
  const shown = signal<MovieDetailsShown | null>(null);
  const screen = signal<Screen | null>(null);
  const pending = signal(0);
  const posterFailed = signal(false);
  /** Bumps on each close and dispose: an answer from before is dropped. */
  let seq = 0;

  const close = (): void => {
    seq += 1;
    shown.value = null;
    screen.value = null;
    pending.value = 0;
    nav.pop();
  };

  const settle = (mine: number, item: CatalogItem, status: MovieDetailsStatus, info: XtreamVodInfo | null): void => {
    if (mine !== seq) return;
    pending.value = 0;
    shown.value = { item, status, info };
  };

  return {
    shown,
    screen,
    pending,
    posterFailed,
    open(item: CatalogItem): void {
      if (shown.value !== null) return;
      const mine = seq;
      shown.value = { item, status: 'reading', info: null };
      pending.value = 1;
      posterFailed.value = false;
      screen.value = nav.push({
        id: MOVIE_SCREEN,
        zones: [{ kind: 'list', id: MOVIE_ACTIONS, axis: 'horizontal', count: 2 }],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
        onSelect: (focus) => {
          const now = shown.value;
          if (focus.index === BACK_ACTION) close();
          else if (now !== null) options.play(now.item, now.info);
        },
      });
      engine.vodInfo({ src: item.src, key: item.key, url: item.url }).then(
        (info) => settle(mine, item, 'read', info),
        (error: unknown) => {
          if (mine === seq) console.warn("The movie's details could not be read", error);
          settle(mine, item, 'failed', null);
        },
      );
    },
    failPoster(): void {
      posterFailed.value = true;
    },
    dispose(): void {
      seq += 1;
    },
  };
}
