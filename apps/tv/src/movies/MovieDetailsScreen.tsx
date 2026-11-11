import type { Focus, FocusBinding } from '@lablo/ui';
import { Button, Spinner, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { MovieDetails } from './movie-details';
import { BACK_ACTION, MOVIE_ACTIONS, PLAY_ACTION, movieFacts } from './movie-details';
import './movie.css';

interface Props {
  readonly details: MovieDetails;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
  /** The live screen's clock at its last minute tick (ms): the header's time. */
  readonly clock: number;
}

/** A length in the catalog's words: `1 h 28 min`, or `48 min` under an hour. */
function lengthText(i18n: AppI18n, seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return h > 0 ? i18n.t('movie.hours', { h: i18n.number(h), m: i18n.number(m) }) : i18n.t('movie.minutes', { m: i18n.number(m) });
}

/**
 * A movie's details (RELAY step 26c), painted instead of the movies screen while they are on top
 * of the live navigator: the movies screen's header, then the poster at the inline start (the
 * title on its background when there is none or it fails) and the text beside it: the title, the
 * category, the year, length and rating, the genre, the plot, the director and the cast, then
 * "Play" and "Back". A spinner while the panel's read is out; a note when it failed. The
 * provider's text is data (`dir="auto"`, `translate=false`).
 */
export function MovieDetailsScreen({ details, i18n, binding, focus, clock }: Props) {
  const { t } = i18n;
  const shown = details.shown.value;
  const screen = details.screen.value;
  if (shown === null || screen === null) return null;
  const actions = useZone(binding, screen, MOVIE_ACTIONS);
  const facts = movieFacts(shown.item, shown.info);
  const line: string[] = [];
  if (facts.year !== null) line.push(String(facts.year));
  if (facts.lengthSecs !== null) line.push(lengthText(i18n, facts.lengthSecs));
  // The whole "7.5/10" is one argument: isolated alone, the 7.5 would part from its "/10" in Arabic.
  if (facts.rating !== null) line.push(t('movie.rating', { rating: `${i18n.number(facts.rating, 1)}/10` }));
  const poster = facts.poster !== null && !details.posterFailed.value ? facts.poster : null;
  return (
    <main
      class="movie"
      data-testid="movie-details"
      data-status={shown.status}
      data-pending={details.pending.value}
      data-key={shown.item.key}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="movie__header">
        <p class="movie__heading">{t('movies.title')}</p>
        <p class="movie__clock" data-testid="movie-clock">
          {i18n.time(new Date(clock))}
        </p>
      </header>
      <div class="movie__body">
        <div class="movie__poster" data-testid="movie-poster">
          {poster !== null ? (
            <img class="movie__image" src={poster} alt="" onError={() => details.failPoster()} />
          ) : (
            <span class="movie__poster-title" dir="auto" translate={false}>
              {facts.title}
            </span>
          )}
        </div>
        <section class="movie__text">
          <h1 class="movie__title" dir="auto" translate={false} data-testid="movie-title">
            {facts.title}
          </h1>
          {facts.group !== '' && (
            <p class="movie__group" dir="auto" translate={false} data-testid="movie-group">
              {facts.group}
            </p>
          )}
          {line.length > 0 && (
            <p class="movie__facts" data-testid="movie-facts">
              {line.join(' · ')}
            </p>
          )}
          {facts.genre !== '' && (
            <p class="movie__genre" dir="auto" translate={false} data-testid="movie-genre">
              {facts.genre}
            </p>
          )}
          {shown.status === 'reading' && (
            <div class="movie__wait">
              <Spinner size="m" label={t('movie.reading')} testId="movie-spinner" />
            </div>
          )}
          {shown.status === 'failed' && (
            <p class="movie__note" data-testid="movie-failed">
              {t('movie.failed')}
            </p>
          )}
          {facts.plot !== '' && (
            <p class="movie__plot" dir="auto" translate={false} data-testid="movie-plot">
              {facts.plot}
            </p>
          )}
          {facts.director !== '' && (
            <p class="movie__credit" data-testid="movie-director">
              {t('movie.director', { name: facts.director })}
            </p>
          )}
          {facts.cast !== '' && (
            <p class="movie__credit" data-testid="movie-cast">
              {t('movie.cast', { names: facts.cast })}
            </p>
          )}
          <div class="movie__actions">
            <Button label={t('movie.play')} variant="primary" {...actions.item(PLAY_ACTION)} testId="movie-play" />
            <Button label={t('movie.back')} {...actions.item(BACK_ACTION)} testId="movie-back" />
          </div>
        </section>
      </div>
    </main>
  );
}
