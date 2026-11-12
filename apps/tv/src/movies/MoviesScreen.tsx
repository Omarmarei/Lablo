import type { Focus, FocusBinding } from '@lablo/ui';
import { Button, Chip, LAYOUT, Spinner, Tile, VirtualGrid, VirtualList, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { LIVE } from '../live/live-state';
import type { MovieEntry, Movies } from './movies-state';
import { MOVIES, MOVIES_GRID, MOVIES_RAIL, MOVIES_RETRY } from './movies-state';
import './movies.css';

/** A rail entry's label: our own words for "Recently added", "All movies" and a nameless group, else the provider's. */
function entryLabel(entry: MovieEntry, t: AppI18n['t']): { label: string; data: boolean } {
  if (entry.kind === 'recent') return { label: t('movies.recent'), data: false };
  if (entry.kind === 'all') return { label: t('movies.all'), data: false };
  if (entry.name === '') return { label: t('movies.noGroup'), data: false };
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
 * The movies screen (RELAY step 26a), painted instead of the live screen while it is on top of
 * the live navigator: a header with the title, the category on show and its count, and the
 * clock; then the rail and the poster grid (`VirtualGrid`, the rows in view only). A tile
 * draws its poster when `movies.poster` gives it one, else the title on the tile's background.
 * Names are the provider's data (`dir="auto"`, `translate=false`).
 */
export function MoviesScreen({ movies, i18n, binding, focus, clock }: Props) {
  const { t } = i18n;
  const screen = movies.screen.value;
  if (screen === null) return null;
  const status = movies.status.value;
  const entries = movies.rail.value;
  const shown = movies.category.value;
  const entry = entries[shown];
  // Read here so the tiles draw again when chunks or posters arrive.
  const version = movies.version.value;
  const retry = useZone(binding, screen, MOVIES_RETRY);
  const heading = entry === undefined ? null : entryLabel(entry, t);

  return (
    <main
      class="movies"
      data-testid="movies-screen"
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
        <h1 class="movies__title">{t('movies.title')}</h1>
        <p class="movies__meta" data-testid="movies-meta">
          {heading !== null && entry !== undefined && (
            <span>
              <span class="movies__category" dir={heading.data ? 'auto' : undefined} translate={heading.data ? false : undefined}>
                {heading.label}
              </span>
              {' · '}
              <span data-n={entry.count}>{t('movies.count', { n: entry.count })}</span>
            </span>
          )}
        </p>
        <p class="movies__clock" data-testid="movies-clock">
          {i18n.time(new Date(clock))}
        </p>
      </header>

      {status === 'loading' && (
        <div class="movies__message">
          <Spinner size="l" label={t('movies.loading')} testId="movies-spinner" />
        </div>
      )}
      {status === 'empty' && (
        <div class="movies__message" data-testid="movies-empty">
          <p class="movies__text">{t('movies.empty')}</p>
        </div>
      )}
      {status === 'failed' && (
        <div class="movies__message" data-testid="movies-failed">
          <p class="movies__text">{t('movies.failed')}</p>
          <Button label={t('live.retry')} variant="primary" {...retry.item(0)} testId="movies-retry" />
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
            testId="movies-rail"
            renderItem={(i, item) => {
              const at = entries[i];
              if (at === undefined) return null;
              const { label, data } = entryLabel(at, t);
              return <Chip label={label} data={data} selected={i === shown} count={i18n.number(at.count)} {...item} testId={`movies-chip-${i}`} />;
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
            testId="movies-grid"
            renderItem={(i, item) => {
              const movie = movies.movie(i);
              const poster = movies.poster(i);
              return (
                <Tile
                  poster
                  title={movie === null ? '' : movie.name}
                  image={poster}
                  progress={movies.progress(i)}
                  onImageLoad={poster === undefined ? undefined : () => movies.posterLoaded(poster)}
                  onImageError={poster === undefined ? undefined : () => movies.posterFailed(poster)}
                  {...item}
                  testId={`movie-${i}`}
                />
              );
            }}
          />
        </div>
      )}
    </main>
  );
}
