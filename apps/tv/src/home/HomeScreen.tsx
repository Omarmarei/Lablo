import type { Focus, FocusBinding } from '@lablo/ui';
import { Button, LAYOUT, Spinner, Tile, VirtualList, useZone } from '@lablo/ui';
import type { AppI18n, MessageKey } from '../i18n';
import { episodeLabel } from '../movies/movies-state';
import type { Home, ShelfId } from './home-state';
import { HOME, HOME_CHANNELS, HOME_RETRY, HOME_SHELVES } from './home-state';
import './home.css';

/** Each shelf's title. */
export const SHELF_TITLES: Readonly<Record<ShelfId, MessageKey>> = {
  continue: 'continue.title',
  channels: 'home.channels',
  movies: 'home.movies',
  series: 'home.series',
};

interface Props {
  readonly home: Home;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
  /** The live screen's clock at its last minute tick (ms): the header's time. */
  readonly clock: number;
}

/**
 * Home (RELAY step 28b1), painted instead of the live screen while it is on top of the live
 * navigator: a header with the title and the clock, then the shelves in view (`HOME_SHELVES` from
 * `home.top`), each its title over a row of poster tiles (`VirtualList`, the tiles in view only).
 * A tile draws its poster when `home.poster` gives one, else its title on the tile's background,
 * and its bar when the item was left part way. "Recent channels" (step 28b2) is a row of
 * landscape channel tiles: the logo whole over the name, else the name. Names are the provider's
 * data (`Tile`: `dir="auto"`, `translate=false`).
 */
export function HomeScreen({ home, i18n, binding, focus, clock }: Props) {
  const { t } = i18n;
  const screen = home.screen.value;
  if (screen === null) return null;
  const status = home.status.value;
  const shelves = home.shelves.value;
  const top = home.top.value;
  // Read here so the tiles draw again when the shelves or the posters change.
  const version = home.version.value;
  const retry = useZone(binding, screen, HOME_RETRY);
  const inView = shelves.slice(top, top + HOME_SHELVES);

  return (
    <main
      class="home"
      data-testid="home-screen"
      data-ready={status === 'loading' ? 'false' : 'true'}
      data-status={status}
      data-pending={home.pending.value}
      data-version={version}
      data-shelves={shelves.join(' ')}
      data-top={top}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="home__header">
        <h1 class="home__title">{t('home.title')}</h1>
        <p class="home__clock" data-testid="home-clock">
          {i18n.time(new Date(clock))}
        </p>
      </header>

      {status === 'loading' && (
        <div class="home__message">
          <Spinner size="l" label={t('home.loading')} testId="home-spinner" />
        </div>
      )}
      {status === 'empty' && (
        <div class="home__message" data-testid="home-empty">
          <p class="home__text">{t('home.empty')}</p>
        </div>
      )}
      {status === 'failed' && (
        <div class="home__message" data-testid="home-failed">
          <p class="home__text">{t('home.failed')}</p>
          <Button label={t('live.retry')} variant="primary" {...retry.item(0)} testId="home-retry" />
        </div>
      )}
      {status === 'ready' && (
        <div class="home__body">
          {inView.map((shelf) => {
            const channels = shelf === HOME_CHANNELS;
            return (
              <section key={shelf} class={channels ? 'home__shelf home__shelf--channels' : 'home__shelf'} data-testid={`home-shelf-${shelf}`}>
                <h2 class="home__shelf-title">{t(SHELF_TITLES[shelf])}</h2>
                <VirtualList
                  binding={binding}
                  screen={screen}
                  zone={shelf}
                  itemSize={channels ? LAYOUT.tileWidth : LAYOUT.posterWidth}
                  gap={HOME.tileGap}
                  class={channels ? 'home__tiles home__tiles--channels' : 'home__tiles'}
                  testId={`home-${shelf}`}
                  renderItem={(i, item) => {
                    const found = home.item(shelf, i);
                    const poster = home.poster(shelf, i);
                    if (channels) {
                      return (
                        <Tile
                          class="home__channel"
                          title={found === null ? '' : found.name}
                          image={poster}
                          onImageLoad={poster === undefined ? undefined : () => home.posterLoaded(poster)}
                          onImageError={poster === undefined ? undefined : () => home.posterFailed(poster)}
                          {...item}
                          testId={`home-${shelf}-${i}`}
                        />
                      );
                    }
                    // A name that ends in "S01 E01" (a playlist's episode): the mark under the name, never cut.
                    const label = found === null ? null : episodeLabel(found.name);
                    return (
                      <Tile
                        poster
                        title={label === null ? '' : label.title}
                        subtitle={label === null || label.mark === null ? undefined : label.mark}
                        image={poster}
                        progress={home.progress(shelf, i)}
                        onImageLoad={poster === undefined ? undefined : () => home.posterLoaded(poster)}
                        onImageError={poster === undefined ? undefined : () => home.posterFailed(poster)}
                        {...item}
                        testId={`home-${shelf}-${i}`}
                      />
                    );
                  }}
                />
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
