import type { Platform } from '@zoma/platform-api';
import type { ItemBinding } from '@zoma/ui';
import {
  Badge,
  Button,
  Chip,
  Dialog,
  ListRow,
  ProgressBar,
  Spinner,
  Tile,
  VirtualList,
  connectRemote,
  localeDir,
  useFocus,
  useZone,
} from '@zoma/ui';
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Gallery } from './gallery-state';
import { ACTIONS, DISABLED_ACTION, GALLERY } from './gallery-state';
import type { DemoChannel } from './gallery-data';
import { DEMO_CATEGORIES, DEMO_CHANNELS, DEMO_TILES } from './gallery-data';
import type { GalleryText } from './gallery-text';
import { galleryLanguage, galleryText } from './gallery-text';
import './gallery.css';

/** Media play: a triangle that never mirrors (playback runs the same way in every language). */
const PLAY_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);

function ChannelRow({ channel, t, item, testId }: { channel: DemoChannel; t: GalleryText; item: ItemBinding; testId: string }) {
  const badges = channel.marks.map((mark) =>
    mark === 'hd' || mark === '4k' ? (
      <Badge key={mark} label={mark.toUpperCase()} tone="outline" data />
    ) : (
      <Badge key={mark} label={t(mark)} tone={mark === 'live' ? 'live' : 'neutral'} />
    ),
  );
  return (
    <ListRow
      number={channel.number}
      name={channel.name}
      now={channel.now}
      next={channel.next}
      nextLabel={t('next')}
      placeholder={t('noGuide')}
      badges={badges.length > 0 ? badges : undefined}
      {...item}
      testId={testId}
    />
  );
}

function Meter({ label, value, children, media, testId }: { label: string; value: number; children: string; media?: boolean; testId: string }) {
  return (
    <div class="gallery__meter">
      <div class="gallery__meter-head">
        <span>{label}</span>
        {/* A time range reads left to right in Arabic too: without dir, bidi swaps its two times. */}
        <span class="gallery__meter-value" translate={false} dir={media === true ? 'ltr' : undefined}>
          {children}
        </span>
      </div>
      <ProgressBar value={value} media={media} label={label} testId={testId} />
    </div>
  );
}

function GalleryScreen({ gallery, locale }: { gallery: Gallery; locale: string }) {
  const t = galleryText(locale);
  const { binding, home } = gallery;
  const focus = useFocus(binding);
  const actions = useZone(binding, home, 'actions');
  const tiles = useZone(binding, home, 'tiles');
  const selection = gallery.selection.value;
  const category = gallery.category.value;
  const dialog = focus.screen === 'play' || focus.screen === 'exit' ? useZone(binding, binding.nav.top, 'buttons') : null;
  const what = (zone: string, index: number): string => {
    if (zone === 'actions') return t(ACTIONS[index] ?? 'play');
    if (zone === 'rail') return t(DEMO_CATEGORIES[index] ?? 'all');
    if (zone === 'tiles') return DEMO_TILES[index]?.title ?? '';
    return DEMO_CHANNELS[index]?.name ?? '';
  };

  return (
    <main
      class="gallery"
      data-testid="gallery"
      data-ready="true"
      data-language={galleryLanguage(locale)}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="gallery__header">
        <h1 class="gallery__title">{t('title')}</h1>
        <p class="gallery__status" data-testid="gallery-status" data-selects={selection?.count ?? 0}>
          {selection === null ? t('pressOk') : t('selected', { what: what(selection.zone, selection.index) })}
        </p>
        <p class="gallery__meta">
          <span translate={false}>{locale}</span>
          {' · '}
          {t('channelCount', { n: DEMO_CHANNELS.length })}
        </p>
      </header>

      <div class="gallery__actions">
        {ACTIONS.map((key, i) => (
          <Button
            key={key}
            label={t(key)}
            variant={i === 0 ? 'primary' : key === 'remove' ? 'danger' : 'secondary'}
            disabled={i === DISABLED_ACTION}
            icon={i === 0 ? PLAY_ICON : undefined}
            {...actions.item(i)}
            testId={`action-${i}`}
          />
        ))}
      </div>

      <VirtualList
        binding={binding}
        screen={home}
        zone="rail"
        itemSize={GALLERY.chipWidth}
        gap={GALLERY.chipGap}
        class="gallery__rail"
        testId="rail"
        renderItem={(i, item) => (
          <Chip
            label={t(DEMO_CATEGORIES[i] ?? 'all')}
            selected={category === i}
            count={i === 0 ? DEMO_CHANNELS.length : undefined}
            {...item}
            testId={`chip-${i}`}
          />
        )}
      />

      <div class="gallery__body">
        <VirtualList
          binding={binding}
          screen={home}
          zone="channels"
          gap={GALLERY.rowGap}
          class="gallery__channels"
          testId="channels"
          renderItem={(i, item) => {
            const channel = DEMO_CHANNELS[i];
            return channel === undefined ? null : <ChannelRow channel={channel} t={t} item={item} testId={`row-${i}`} />;
          }}
        />

        <div class="gallery__side">
          <h2 class="gallery__section">{t('continueWatching')}</h2>
          <div class="gallery__tiles">
            {DEMO_TILES.map((tile, i) => (
              <Tile
                key={tile.title}
                title={tile.title}
                subtitle={tile.subtitle}
                progress={tile.progress}
                badge={tile.fresh === true ? <Badge label={t('new')} tone="accent" /> : undefined}
                class={`gallery__tone-${i}`}
                {...tiles.item(i)}
                testId={`tile-${i}`}
              />
            ))}
          </div>

          <h2 class="gallery__section">{t('status')}</h2>
          <div class="gallery__meters">
            <div class="gallery__loading">
              <Spinner size="s" label={t('loading')} testId="spinner" />
              <Meter label={t('loading')} value={0.35} testId="progress-loading">
                35%
              </Meter>
            </div>
            <Meter label={t('timeline')} value={0.61} media testId="progress-media">
              01:12:30 / 01:58:00
            </Meter>
          </div>
          <div class="gallery__badges" data-testid="badges">
            <Badge label={t('live')} tone="live" />
            <Badge label={t('updated')} tone="accent" />
            <Badge label="HD" tone="outline" data />
            <Badge label="5.1" data />
            <Badge label={t('catchUp')} />
            <Badge label={t('expires')} tone="warn" />
          </div>
        </div>
      </div>

      {dialog !== null && focus.screen === 'play' && (
        <Dialog
          title={t('playTitle', { name: DEMO_CHANNELS[gallery.playing.value]?.name ?? '' })}
          message={t('playMessage')}
          testId="play-dialog"
        >
          <Button label={t('cancel')} {...dialog.item(0)} testId="dialog-0" />
          <Button label={t('play')} variant="primary" icon={PLAY_ICON} {...dialog.item(1)} testId="dialog-1" />
        </Dialog>
      )}
      {dialog !== null && focus.screen === 'exit' && (
        <Dialog title={t('exitTitle')} message={t('exitMessage')} testId="exit-dialog">
          <Button label={t('stay')} {...dialog.item(0)} testId="dialog-0" />
          <Button label={t('exit')} {...dialog.item(1)} testId="dialog-1" />
        </Dialog>
      )}
    </main>
  );
}

interface Props {
  readonly platform: Platform;
  readonly gallery: Gallery;
}

/**
 * `?screen=gallery`: waits for the device locale (it picks the language and the direction),
 * then shows every component. `?locale=en-XA` shows the pseudo-locale.
 */
export function GalleryApp({ platform, gallery }: Props) {
  const locale = useSignal<string | null>(null);
  useEffect(() => {
    const apply = (value: string): void => {
      const dir = localeDir(value);
      gallery.nav.setDir(dir);
      document.documentElement.lang = value;
      document.documentElement.dir = dir;
      locale.value = value;
    };
    platform.info().then(
      (info) => apply(info.locale),
      () => apply('en-US'),
    );
    return connectRemote({ platform, nav: gallery.nav, target: window });
  }, [platform, gallery]);

  if (locale.value === null) {
    return (
      <main class="gallery is-loading" data-testid="gallery" data-ready="false">
        <Spinner size="l" />
      </main>
    );
  }
  return <GalleryScreen gallery={gallery} locale={locale.value} />;
}
