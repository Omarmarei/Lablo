import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, XtreamEpisode, XtreamSeason, XtreamSeriesInfo } from '@lablo/core';
import type { SeriesInfoRequest } from '@lablo/data';
import type { Focus, Navigator, Screen, ZoneSpec } from '@lablo/ui';
import { LAYOUT, SCREEN, fits } from '@lablo/ui';
import { releaseYear } from '../movies/movie-details';

/**
 * A show's details (RELAY step 27b, PLAN 7.1): a screen pushed on the live navigator over the
 * series screen by OK on a show's cover, painted instead of it.
 *
 *   seasons   (a row of chips: "Season 1", or the panel's own name)
 *   episodes  (the season's episodes, a list: number, title, plot, length)
 *
 * - **What shows at once:** the catalog's facts (the cover, the title, the category). The rest
 *   comes from the panel's `get_series_info`, read when the details open and kept 24 h in the
 *   query worker: the year, the rating, the genre, the plot, and the seasons and episodes. A
 *   spinner shows while the read is out; a failed read keeps the catalog's facts, with a note;
 *   a show the panel lists no episodes for (or doesn't know) says so. An answer for details that
 *   closed, or opened on another show since, is dropped.
 * - **Seasons:** the panel's seasons that have episodes, in order. It opens on the first, with
 *   the focus on its first episode. The season on show follows the focus along the row (no read:
 *   every episode came with the show), and its episodes start from the top again.
 * - **Keys:** UP from the first episode goes to the seasons, DOWN or OK on a season to its
 *   episodes. OK on an episode does nothing yet (playing it is step 27c). Back goes from the
 *   episodes to the season on show, and from the seasons (or a screen with nothing to focus)
 *   closes the details: the series screen's focus is where it was.
 * - `pending` is 1 while the read is out (e2e).
 */

export const SHOW_SCREEN = 'show';
export const SHOW_SEASONS = 'seasons';
export const SHOW_EPISODES = 'episodes';

/**
 * The screen's geometry (show.css): a 1728 x 892 px body under the header. The top band (300 px:
 * a 200 x 300 cover and the text beside it), 24 px, the row of seasons (264 px chips, 16 px apart),
 * 24 px, then the episodes (LAYOUT.rowHeight rows, 8 px apart) in the 480 px left.
 */
export const SHOW = {
  bodyWidth: SCREEN.width - 2 * SCREEN.safeX,
  topHeight: 300,
  seasonWidth: 264,
  seasonGap: 16,
  rowGap: 8,
  listHeight: 480,
} as const;
/** Season chips the row shows: 6. */
export const SEASONS_VISIBLE = fits(SHOW.bodyWidth, SHOW.seasonWidth, SHOW.seasonGap);
/** Episode rows the list shows: 5. */
export const EPISODES_VISIBLE = fits(SHOW.listHeight, LAYOUT.rowHeight, SHOW.rowGap);

/** `reading`: the panel's read is out; `read`: it answered (`info` may still be `null`); `failed`: it didn't. */
export type ShowDetailsStatus = 'reading' | 'read' | 'failed';

/** A season with episodes, as the row lists it. */
export interface ShowSeason {
  readonly number: number;
  /** The panel's name when it says more than ours ("Season 2"); `''`: ours. */
  readonly name: string;
  /** In the panel's order. */
  readonly episodes: readonly XtreamEpisode[];
}

export interface ShowDetailsShown {
  readonly item: CatalogItem;
  readonly status: ShowDetailsStatus;
  /** The panel's details once read (`null` before, after a failure, or with no panel). */
  readonly info: XtreamSeriesInfo | null;
  /** The seasons that have episodes, in order (`[]` until read). */
  readonly seasons: readonly ShowSeason[];
}

/** What the details need from the data engine (a `DataEngine` fits). */
export interface ShowDetailsEngine {
  seriesInfo(req: SeriesInfoRequest): Promise<XtreamSeriesInfo | null>;
}

export interface ShowDetailsOptions {
  /** The live screen's navigator: the details are a screen on it, over the series screen. */
  readonly nav: Navigator;
  readonly engine: ShowDetailsEngine;
}

export interface ShowDetails {
  /** The details while they show. */
  readonly shown: ReadonlySignal<ShowDetailsShown | null>;
  /** Their screen on the navigator while they show. */
  readonly screen: ReadonlySignal<Screen | null>;
  /** The season on show: an index into `shown.seasons`. */
  readonly season: ReadonlySignal<number>;
  /** 1 while the panel's read is out. */
  readonly pending: ReadonlySignal<number>;
  /** The cover failed: the screen shows the title in its place. */
  readonly posterFailed: ReadonlySignal<boolean>;
  /** Opens the details on `item` and reads the panel's (nothing when they are open). */
  open(item: CatalogItem): void;
  /** The cover's image failed. */
  failPoster(): void;
  dispose(): void;
}

/** What the details screen shows of a show. */
export interface ShowFacts {
  readonly title: string;
  /** The catalog's category (`''`: none). */
  readonly group: string;
  /** The catalog's cover, else the panel's (`null`: none). */
  readonly poster: string | null;
  readonly year: number | null;
  /** Out of 10. */
  readonly rating: number | null;
  readonly genre: string;
  readonly plot: string;
}

/** A show's facts: the catalog's, with the panel's details when they were read. */
export function showFacts(item: CatalogItem, info: XtreamSeriesInfo | null): ShowFacts {
  return {
    title: item.name,
    group: item.group,
    poster: item.logo ?? info?.cover ?? null,
    year: info === null ? null : releaseYear(info.releaseDate),
    rating: info === null || info.rating === null || info.rating <= 0 ? null : info.rating,
    genre: info?.genre ?? '',
    plot: info?.plot ?? '',
  };
}

/** A panel's season name that says no more than ours: "Season 2", "season 02", "S2". */
const PLAIN_SEASON = /^(?:season|s)\s*(\d+)$/i;

/**
 * The name a season's chip shows from the panel: `''` (ours, "Season 2" in the UI's language)
 * when the panel's is empty or says only that, else the panel's own («الموسم ١», "Specials").
 */
export function seasonName(season: XtreamSeason): string {
  const found = PLAIN_SEASON.exec(season.name);
  return found !== null && Number(found[1]) === season.number ? '' : season.name;
}

/** What an episode's row shows. */
export interface EpisodeLine {
  /** The panel's episode number, else its place in the season (from 1). */
  readonly number: number;
  /** The panel's title (`''`: none, the row says "Episode 3"). */
  readonly title: string;
  /** Its length (`null`: none, or 0). */
  readonly lengthSecs: number | null;
}

/** An episode's row: `index` is its place in the season. */
export function episodeLine(episode: XtreamEpisode, index: number): EpisodeLine {
  return {
    number: episode.episodeNum ?? index + 1,
    title: episode.title,
    lengthSecs: episode.durationSecs !== null && episode.durationSecs > 0 ? episode.durationSecs : null,
  };
}

/** The seasons a show's details list: the panel's that have episodes, in order, each with its episodes. */
export function showSeasons(info: XtreamSeriesInfo | null): ShowSeason[] {
  const out: ShowSeason[] = [];
  if (info === null) return out;
  for (const season of info.seasons) {
    const episodes: XtreamEpisode[] = [];
    for (const episode of info.episodes) if (episode.season === season.number) episodes.push(episode);
    if (episodes.length > 0) out.push({ number: season.number, name: seasonName(season), episodes });
  }
  return out;
}

function seasonsZone(count: number): ZoneSpec {
  return { kind: 'list', id: SHOW_SEASONS, axis: 'horizontal', count, visible: SEASONS_VISIBLE, neighbours: { down: SHOW_EPISODES } };
}

function episodesZone(count: number): ZoneSpec {
  return { kind: 'list', id: SHOW_EPISODES, axis: 'vertical', count, visible: EPISODES_VISIBLE, neighbours: { up: SHOW_SEASONS } };
}

export function createShowDetails(options: ShowDetailsOptions): ShowDetails {
  const { nav, engine } = options;
  const shown = signal<ShowDetailsShown | null>(null);
  const screen = signal<Screen | null>(null);
  const season = signal(0);
  const pending = signal(0);
  const posterFailed = signal(false);
  /** Bumps on each close and dispose: an answer from before is dropped. */
  let seq = 0;

  const close = (): void => {
    seq += 1;
    shown.value = null;
    screen.value = null;
    season.value = 0;
    pending.value = 0;
    nav.pop();
  };

  /** Shows season `index`: its episodes, from the top. */
  const showSeason = (top: Screen, seasons: readonly ShowSeason[], index: number): void => {
    season.value = index;
    top.update(episodesZone(seasons[index]?.episodes.length ?? 0));
    top.reset(SHOW_EPISODES);
  };

  const settle = (mine: number, item: CatalogItem, status: ShowDetailsStatus, info: XtreamSeriesInfo | null): void => {
    const top = screen.value;
    if (mine !== seq || top === null) return;
    const seasons = showSeasons(info);
    pending.value = 0;
    shown.value = { item, status, info, seasons };
    top.update(seasonsZone(seasons.length));
    // The episodes are the screen's initial zone: the focus lands on the first one.
    showSeason(top, seasons, 0);
  };

  const onIntent = (intent: string, focus: Focus): boolean => {
    if (intent !== 'BACK') return false;
    // Back in the episodes goes to the season on show.
    if (focus.zone === SHOW_EPISODES && (shown.value?.seasons.length ?? 0) > 0) {
      screen.value?.focus(SHOW_SEASONS, season.value);
      return true;
    }
    close();
    return true;
  };

  const onSelect = (focus: Focus): void => {
    const top = screen.value;
    // OK on a season: its episodes, where the focus last was in them (DOWN's way).
    if (focus.zone === SHOW_SEASONS && top !== null) top.focus(SHOW_EPISODES, Math.max(0, top.position(SHOW_EPISODES).index));
  };

  // The season on show follows the focus along the row.
  const stopFollowing = nav.subscribe((focus) => {
    const top = screen.value;
    const now = shown.value;
    if (focus.screen !== SHOW_SCREEN || focus.zone !== SHOW_SEASONS || top === null || now === null) return;
    if (focus.index !== season.value) showSeason(top, now.seasons, focus.index);
  });

  return {
    shown,
    screen,
    season,
    pending,
    posterFailed,
    open(item: CatalogItem): void {
      if (shown.value !== null) return;
      const mine = seq;
      shown.value = { item, status: 'reading', info: null, seasons: [] };
      pending.value = 1;
      posterFailed.value = false;
      screen.value = nav.push({
        id: SHOW_SCREEN,
        zones: [seasonsZone(0), episodesZone(0)],
        initial: SHOW_EPISODES,
        onIntent,
        onSelect,
      });
      engine.seriesInfo({ src: item.src, key: item.key }).then(
        (info) => settle(mine, item, 'read', info),
        (error: unknown) => {
          if (mine === seq) console.warn("The show's details could not be read", error);
          settle(mine, item, 'failed', null);
        },
      );
    },
    failPoster(): void {
      posterFailed.value = true;
    },
    dispose(): void {
      seq += 1;
      stopFollowing();
    },
  };
}
