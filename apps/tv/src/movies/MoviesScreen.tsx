import type { Focus, FocusBinding } from '@lablo/ui';
import { Button, Chip, LAYOUT, Spinner, Tile, VirtualGrid, VirtualList, useZone } from '@lablo/ui';
import type { AppI18n, MessageKey } from '../i18n';
import { LIVE } from '../live/live-state';
import type { MovieEntry, Movies, PosterKind } from './movies-state';
import { MOVIES, MOVIES_GRID, MOVIES_RAIL, MOVIES_RETRY, episodeLabel } from './movies-state';
import './movies.css';

/** A poster screen's own words. */
interface Words {
  readonly title: MessageKey;
  /** "Continue watching" (step 27d). */
  readonly continue: MessageKey;
  readonly recent: MessageKey;
  readonly all: MessageKey;
  readonly noGroup: MessageKey;
  /** `{n}`: the entry's count. */
  readonly count: MessageKey;
  /** `{n}`: the count of an entry of a playlist's episodes alone (`Movies.episodes`); none: `count`. */
  readonly episodes?: MessageKey;
  readonly loading: MessageKey;
  readonly empty: MessageKey;
  readonly failed: MessageKey;
}

/** Each kind's words (step 27a: series say "Recently updated", "All series"…). */
export const POSTER_WORDS: Readonly<Record<PosterKind, Words>> = {
  movie: {
    title: 'movies.title',
    continue: 'movies.continue',
    recent: 'movies.recent',
    all: 'movies.all',
    noGroup: 'movies.noGroup',
    count: 'movies.count',
    loading: 'movies.loading',
    empty: 'movies.empty',
    failed: 'movies.failed',
  },
  series: {
    title: 'series.title',
    continue: 'series.continue',
    recent: 'series.recent',
    all: 'series.all',
    noGroup: 'series.noGroup',
    count: 'series.count',
    episodes: 'series.episodes',
    loading: 'series.loading',
    empty: 'series.empty',
    failed: 'series.failed',
  },
};

/**
 * Each kind's test ids: the screen's parts are `<screen>-…` (`movies-rail`, `series-rail`), its
 * tiles `<tile>-<i>` (`movie-0`, `show-0`).
 */
export const POSTER_TEST_IDS: Readonly<Record<PosterKind, { readonly screen: string; readonly tile: string }>> = {
  movie: { screen: 'movies', tile: 'movie' },
  series: { screen: 'series', tile: 'show' },
};

/** A rail entry's label: our own words for "Continue watching", "Recently added", "All movies" and a nameless group, else the provider's. */
function entryLabel(entry: MovieEntry, t: AppI18n['t'], words: Words): { label: string; data: boolean } {
  if (entry.kind === 'continue') return { label: t(words.continue), data: false };
  if (entry.kind === 'recent') return { label: t(words.recent), data: false };
  if (entry.kind === 'all') return { label: t(words.all), data: false };
  if (entry.name === '') return { label: t(words.noGroup), data: false };
  return { label: entry.name, data: true };
}

interface Props {
  readonly movies: Movies;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
  /** The live screen's clock at its last minute tick (ms): the header's time. */
  readonly clock: number;
}

/**
 * The movies screen (RELAY step 26a), and the series screen (step 27a: the same screen with its
 * own words and test ids), painted instead of the live screen while it is on top of the live
 * navigator: a header with the title, the category on show and its count, and the
 * clock; then the rail and the poster grid (`VirtualGrid`, the rows in view only). A tile
 * draws its poster when `movies.poster` gives it one, else the title on the tile's background.
 * Names are the provider's data (`dir="auto"`, `translate=false`).
 */
export function MoviesScreen({ movies, i18n, binding, focus, clock }: Props) {
  const { t } = i18n;
  const words = POSTER_WORDS[movies.kind];
  const ids = POSTER_TEST_IDS[movies.kind];
  const screen = movies.screen.value;
  if (screen === null) return null;
  const status = movies.status.value;
  const entries = movies.rail.value;
  const shown = movies.category.value;
  const entry = entries[shown];
  // Read here so the tiles draw again when chunks or posters arrive.
  const version = movies.version.value;
  const retry = useZone(binding, screen, MOVIES_RETRY);
  const heading = entry === undefined ? null : entryLabel(entry, t, words);

  return (
    <main
      class="movies"
      data-testid={`${ids.screen}-screen`}
      data-kind={movies.kind}
      data-ready={status === 'loading' ? 'false' : 'true'}
      data-status={status}
      data-pending={movies.pending.value}
      data-version={version}
      data-category={shown}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="movies__header">
        <h1 class="movies__title">{t(words.title)}</h1>
        <p class="movies__meta" data-testid={`${ids.screen}-meta`}>
          {heading !== null && entry !== undefined && (
            <span>
              <span class="movies__category" dir={heading.data ? 'auto' : undefined} translate={heading.data ? false : undefined}>
                {heading.label}
              </span>
              {' · '}
              <span data-n={entry.count}>{t(movies.episodes(shown) ? (words.episodes ?? words.count) : words.count, { n: entry.count })}</span>
            </span>
          )}
        </p>
        <p class="movies__clock" data-testid={`${ids.screen}-clock`}>
          {i18n.time(new Date(clock))}
        </p>
      </header>

      {status === 'loading' && (
        <div class="movies__message">
          <Spinner size="l" label={t(words.loading)} testId={`${ids.screen}-spinner`} />
        </div>
      )}
      {status === 'empty' && (
        <div class="movies__message" data-testid={`${ids.screen}-empty`}>
          <p class="movies__text">{t(words.empty)}</p>
        </div>
      )}
      {status === 'failed' && (
        <div class="movies__message" data-testid={`${ids.screen}-failed`}>
          <p class="movies__text">{t(words.failed)}</p>
          <Button label={t('live.retry')} variant="primary" {...retry.item(0)} testId={`${ids.screen}-retry`} />
        </div>
      )}
      {status === 'ready' && (
        <div class="movies__body">
          <VirtualList
            binding={binding}
            screen={screen}
            zone={MOVIES_RAIL}
            itemSize={LAYOUT.railHeight}
            gap={LIVE.railGap}
            class="movies__rail"
            testId={`${ids.screen}-rail`}
            renderItem={(i, item) => {
              const at = entries[i];
              if (at === undefined) return null;
              const { label, data } = entryLabel(at, t, words);
              return <Chip label={label} data={data} selected={i === shown} count={i18n.number(at.count)} {...item} testId={`${ids.screen}-chip-${i}`} />;
            }}
          />
          <VirtualGrid
            binding={binding}
            screen={screen}
            zone={MOVIES_GRID}
            itemWidth={LAYOUT.posterWidth}
            itemHeight={LAYOUT.posterHeight}
            columnGap={MOVIES.tileGap}
            rowGap={MOVIES.rowGap}
            class="movies__grid"
            testId={`${ids.screen}-grid`}
            renderItem={(i, item) => {
              const movie = movies.movie(i);
              const poster = movies.poster(i);
              // A name that ends in "S01 E01" (a playlist's episode, step 27a): the mark under the name, never cut.
              const label = movie === null ? null : episodeLabel(movie.name);
              return (
                <Tile
                  poster
                  title={label === null ? '' : label.title}
                  subtitle={label === null || label.mark === null ? undefined : label.mark}
                  image={poster}
                  progress={movies.progress(i)}
                  onImageLoad={poster === undefined ? undefined : () => movies.posterLoaded(poster)}
                  onImageError={poster === undefined ? undefined : () => movies.posterFailed(poster)}
                  {...item}
                  testId={`${ids.tile}-${i}`}
                />
              );
            }}
          />
        </div>
      )}
    </main>
  );
}
