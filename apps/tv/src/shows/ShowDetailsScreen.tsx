import type { XtreamEpisode } from '@lablo/core';
import type { Focus, FocusBinding, ItemBinding } from '@lablo/ui';
import { Chip, LAYOUT, Spinner, VirtualList } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { lengthText } from '../movies/MovieDetailsScreen';
import type { ShowDetails, ShowSeason } from './show-details';
import { SHOW, SHOW_EPISODES, SHOW_SEASONS, episodeLine, showFacts } from './show-details';
import './show.css';

interface Props {
  readonly details: ShowDetails;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
  /** The live screen's clock at its last minute tick (ms): the header's time. */
  readonly clock: number;
}

/** A season chip's words: the panel's name when it says more than ours, else "Season 2". */
function seasonLabel(i18n: AppI18n, season: ShowSeason): { label: string; data: boolean } {
  if (season.name !== '') return { label: season.name, data: true };
  return { label: i18n.t('show.season', { n: i18n.number(season.number) }), data: false };
}

/**
 * One episode of the list, LAYOUT.rowHeight tall: its number, its title over its plot (the
 * provider's text, each in its own direction), and its length at the inline end. An episode with
 * no number shows its place in the season; one with no title, "Episode 3".
 */
function EpisodeRow({ i18n, index, episode, item }: { i18n: AppI18n; index: number; episode: XtreamEpisode; item: ItemBinding }) {
  const { number, title, lengthSecs } = episodeLine(episode, index);
  const state = item.state;
  return (
    <div
      class={state === 'focused' ? 'show__episode is-focused' : state === 'memory' ? 'show__episode is-memory' : 'show__episode'}
      role="option"
      aria-selected={state === 'focused' ? 'true' : 'false'}
      data-testid={`episode-${index}`}
      data-state={state ?? 'idle'}
      data-key={episode.key}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <span class="show__episode-number">{i18n.number(number)}</span>
      <div class="show__episode-main">
        {title !== '' ? (
          <span class="show__episode-title" dir="auto" translate={false}>
            {title}
          </span>
        ) : (
          <span class="show__episode-title">{i18n.t('show.episode', { n: i18n.number(number) })}</span>
        )}
        {episode.plot !== '' && (
          <span class="show__episode-plot" dir="auto" translate={false}>
            {episode.plot}
          </span>
        )}
      </div>
      {lengthSecs !== null && <span class="show__episode-length">{lengthText(i18n, lengthSecs)}</span>}
    </div>
  );
}

/**
 * A show's details (RELAY step 27b), painted instead of the series screen while they are on top
 * of the live navigator: the series screen's header, then the cover at the inline start (the
 * title on its background when there is none or it fails) and the text beside it (the title, the
 * category, the year and rating, the genre, the plot), the row of seasons, and the season's
 * episodes. A spinner while the panel's read is out; a note when it failed, or in the seasons'
 * place when the panel lists no episodes. The provider's text is data (`dir="auto"`, `translate=false`).
 */
export function ShowDetailsScreen({ details, i18n, binding, focus, clock }: Props) {
  const { t } = i18n;
  const shown = details.shown.value;
  const screen = details.screen.value;
  if (shown === null || screen === null) return null;
  const facts = showFacts(shown.item, shown.info);
  const line: string[] = [];
  if (facts.year !== null) line.push(String(facts.year));
  // The whole "7.5/10" is one argument: isolated alone, the 7.5 would part from its "/10" in Arabic.
  if (facts.rating !== null) line.push(t('movie.rating', { rating: `${i18n.number(facts.rating, 1)}/10` }));
  const poster = facts.poster !== null && !details.posterFailed.value ? facts.poster : null;
  const seasons = shown.seasons;
  const onShow = details.season.value;
  const episodes = seasons[onShow]?.episodes ?? [];
  return (
    <main
      class="show"
      data-testid="show-details"
      data-status={shown.status}
      data-pending={details.pending.value}
      data-key={shown.item.key}
      data-season={seasons.length === 0 ? '' : onShow}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="show__header">
        <p class="show__heading">{t('series.title')}</p>
        <p class="show__clock" data-testid="show-clock">
          {i18n.time(new Date(clock))}
        </p>
      </header>
      <div class="show__top">
        <div class="show__poster" data-testid="show-poster">
          {poster !== null ? (
            <img class="show__image" src={poster} alt="" onError={() => details.failPoster()} />
          ) : (
            <span class="show__poster-title" dir="auto" translate={false}>
              {facts.title}
            </span>
          )}
        </div>
        <section class="show__text">
          <h1 class="show__title" dir="auto" translate={false} data-testid="show-title">
            {facts.title}
          </h1>
          {facts.group !== '' && (
            <p class="show__group" dir="auto" translate={false} data-testid="show-group">
              {facts.group}
            </p>
          )}
          {line.length > 0 && (
            <p class="show__facts" data-testid="show-facts">
              {line.join(' · ')}
            </p>
          )}
          {facts.genre !== '' && (
            <p class="show__genre" dir="auto" translate={false} data-testid="show-genre">
              {facts.genre}
            </p>
          )}
          {shown.status === 'reading' && (
            <div class="show__wait">
              <Spinner size="m" label={t('show.reading')} testId="show-spinner" />
            </div>
          )}
          {shown.status === 'failed' && (
            <p class="show__note" data-testid="show-failed">
              {t('show.failed')}
            </p>
          )}
          {facts.plot !== '' && (
            <p class="show__plot" dir="auto" translate={false} data-testid="show-plot">
              {facts.plot}
            </p>
          )}
        </section>
      </div>
      {shown.status === 'read' && seasons.length === 0 ? (
        // In the seasons' place: a panel that lists no episodes.
        <p class="show__note show__empty" data-testid="show-empty">
          {t('show.noEpisodes')}
        </p>
      ) : (
        // No episode count on a chip: "Season 2  2" reads as one number.
        <VirtualList
          binding={binding}
          screen={screen}
          zone={SHOW_SEASONS}
          itemSize={SHOW.seasonWidth}
          gap={SHOW.seasonGap}
          class="show__seasons"
          testId="show-seasons"
          renderItem={(i, item) => {
            const at = seasons[i];
            if (at === undefined) return null;
            const { label, data } = seasonLabel(i18n, at);
            return <Chip label={label} data={data} selected={i === onShow} {...item} testId={`season-${i}`} />;
          }}
        />
      )}
      <VirtualList
        binding={binding}
        screen={screen}
        zone={SHOW_EPISODES}
        itemSize={LAYOUT.rowHeight}
        gap={SHOW.rowGap}
        class="show__episodes"
        testId="show-episodes"
        renderItem={(i, item) => {
          const at = episodes[i];
          return at === undefined ? null : <EpisodeRow i18n={i18n} index={i} episode={at} item={item} />;
        }}
      />
    </main>
  );
}
