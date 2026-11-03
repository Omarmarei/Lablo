import type { Platform } from '@zoma/platform-api';
import type { ItemBinding, LocaleSettings } from '@zoma/ui';
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
  resolveLocale,
  useFocus,
  useZone,
} from '@zoma/ui';
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Gallery } from './gallery-state';
import { ACTIONS, DISABLED_ACTION, GALLERY } from './gallery-state';
import type { DemoChannel } from './gallery-data';
import { DEMO_CATEGORIES, DEMO_CHANNELS, DEMO_TILES } from './gallery-data';
import type { AppI18n } from '../i18n';
import { LANGUAGE_NAMES, appI18n, otherLanguage, switchedTag } from '../i18n';
import './gallery.css';

/** The media timeline's demo position and length in seconds: 1:13:12 of 2:00:00, 61% (e2e checks the fill). */
const MEDIA_POSITION = 4392;
const MEDIA_LENGTH = 7200;

/** Media play: a triangle that never mirrors (playback runs the same way in every language). */
const PLAY_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);

/** The language switch's globe: findable by someone who can't read the language on show. */
const GLOBE_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </g>
  </svg>
);

function ChannelRow({ channel, t, item, testId }: { channel: DemoChannel; t: AppI18n['t']; item: ItemBinding; testId: string }) {
  const badges = channel.marks.map((mark) =>
    mark === 'hd' || mark === '4k' ? (
      <Badge key={mark} label={mark.toUpperCase()} tone="outline" data />
    ) : (
      <Badge key={mark} label={t(mark === 'live' ? 'badge.live' : 'badge.catchUp')} tone={mark === 'live' ? 'live' : 'neutral'} />
    ),
  );
  return (
    <ListRow
      number={channel.number}
      name={channel.name}
      now={channel.now}
      next={channel.next}
      nextLabel={t('guide.next')}
      placeholder={t('guide.none')}
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

function GalleryScreen({ gallery, i18n }: { gallery: Gallery; i18n: AppI18n }) {
  const { t, locale } = i18n;
  const { binding, home } = gallery;
  const focus = useFocus(binding);
  const actions = useZone(binding, home, 'actions');
  const language = useZone(binding, home, 'language');
  const other = otherLanguage(locale.language);
  const tiles = useZone(binding, home, 'tiles');
  const selection = gallery.selection.value;
  const category = gallery.category.value;
  const dialog = focus.screen === 'play' || focus.screen === 'exit' ? useZone(binding, binding.nav.top, 'buttons') : null;
  const what = (zone: string, index: number): string => {
    if (zone === 'actions') return t(ACTIONS[index] ?? 'action.play');
    if (zone === 'rail') return t(DEMO_CATEGORIES[index] ?? 'category.all');
    if (zone === 'tiles') return DEMO_TILES[index]?.title ?? '';
    return DEMO_CHANNELS[index]?.name ?? '';
  };

  return (
    <main
      class="gallery"
      data-testid="gallery"
      data-ready="true"
      data-language={locale.pseudo ? 'pseudo' : locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="gallery__header">
        <h1 class="gallery__title">{t('gallery.title')}</h1>
        <p class="gallery__status" data-testid="gallery-status" data-selects={selection?.count ?? 0}>
          {selection === null ? t('gallery.pressOk') : t('gallery.selected', { what: what(selection.zone, selection.index) })}
        </p>
        <p class="gallery__meta">
          {/* dir isolates the tag: otherwise bidi joins the count after it into its Latin run. */}
          <span translate={false} dir="ltr">
            {locale.tag}
          </span>
          {' · '}
          {t('gallery.channelCount', { n: DEMO_CHANNELS.length })}
        </p>
      </header>

      <div class="gallery__actions">
        {ACTIONS.map((key, i) => (
          <Button
            key={key}
            label={t(key)}
            variant={i === 0 ? 'primary' : key === 'action.removeSource' ? 'danger' : 'secondary'}
            disabled={i === DISABLED_ACTION}
            icon={i === 0 ? PLAY_ICON : undefined}
            {...actions.item(i)}
            testId={`action-${i}`}
          />
        ))}
        {/* The other language under its own name, at the row's inline end. */}
        <div class="gallery__language">
          <Button label={LANGUAGE_NAMES[other]} lang={other} icon={GLOBE_ICON} {...language.item(0)} testId="language" />
        </div>
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
            label={t(DEMO_CATEGORIES[i] ?? 'category.all')}
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
          <h2 class="gallery__section">{t('gallery.continueWatching')}</h2>
          <div class="gallery__tiles">
            {DEMO_TILES.map((tile, i) => (
              <Tile
                key={tile.title}
                title={tile.title}
                subtitle={tile.subtitle}
                progress={tile.progress}
                badge={tile.fresh === true ? <Badge label={t('badge.new')} tone="accent" /> : undefined}
                class={`gallery__tone-${i}`}
                {...tiles.item(i)}
                testId={`tile-${i}`}
              />
            ))}
          </div>

          <h2 class="gallery__section">{t('gallery.status')}</h2>
          <div class="gallery__meters">
            <div class="gallery__loading">
              <Spinner size="s" label={t('gallery.loading')} testId="spinner" />
              <Meter label={t('gallery.loading')} value={0.35} testId="progress-loading">
                {i18n.percent(0.35)}
              </Meter>
            </div>
            <Meter label={t('gallery.timeline')} value={MEDIA_POSITION / MEDIA_LENGTH} media testId="progress-media">
              {`${i18n.duration(MEDIA_POSITION)} / ${i18n.duration(MEDIA_LENGTH)}`}
            </Meter>
          </div>
          <div class="gallery__badges" data-testid="badges">
            <Badge label={t('badge.live')} tone="live" />
            <Badge label={t('gallery.guideUpdated')} tone="accent" />
            <Badge label="HD" tone="outline" data />
            <Badge label="5.1" data />
            <Badge label={t('badge.catchUp')} />
            <Badge label={t('badge.expires', { days: 3 })} tone="warn" />
          </div>
        </div>
      </div>

      {dialog !== null && focus.screen === 'play' && (
        <Dialog
          title={t('play.title', { name: DEMO_CHANNELS[gallery.playing.value]?.name ?? '' })}
          message={t('gallery.playMessage')}
          testId="play-dialog"
        >
          <Button label={t('action.cancel')} {...dialog.item(0)} testId="dialog-0" />
          <Button label={t('action.play')} variant="primary" icon={PLAY_ICON} {...dialog.item(1)} testId="dialog-1" />
        </Dialog>
      )}
      {dialog !== null && focus.screen === 'exit' && (
        <Dialog title={t('exit.title')} message={t('exit.message')} testId="exit-dialog">
          <Button label={t('exit.stay')} {...dialog.item(0)} testId="dialog-0" />
          <Button label={t('exit.confirm')} {...dialog.item(1)} testId="dialog-1" />
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
 * `?screen=gallery`: waits for the device locale (it picks the catalog, the direction and the
 * formats), then shows every component. `?locale=en-XA` shows the pseudo-locale. The language
 * button flips the catalog, `lang`/`dir` on `<html>` and the remote's LEFT/RIGHT live, with no
 * reload: the navigator, and so the focus, stay as they were.
 */
export function GalleryApp({ platform, gallery }: Props) {
  const i18n = useSignal<AppI18n | null>(null);
  useEffect(() => {
    let device: LocaleSettings | null = null;
    let country: string | null = null;
    const show = (switches: number): void => {
      if (device === null) return;
      const locale = switches % 2 === 0 ? device : resolveLocale(switchedTag(device), { country });
      gallery.nav.setDir(locale.dir);
      document.documentElement.lang = locale.tag;
      document.documentElement.dir = locale.dir;
      i18n.value = appI18n(locale);
    };
    const start = (tag: string, from: string | null): void => {
      country = from;
      device = resolveLocale(tag, { country });
      show(gallery.languageSwitches.peek());
    };
    platform.info().then(
      (info) => start(info.locale, info.country),
      () => start('en-US', null),
    );
    // Runs on every press, before the next key is handled.
    const stop = gallery.languageSwitches.subscribe(show);
    const disconnect = connectRemote({ platform, nav: gallery.nav, target: window });
    return () => {
      stop();
      disconnect();
    };
  }, [platform, gallery]);

  if (i18n.value === null) {
    return (
      <main class="gallery is-loading" data-testid="gallery" data-ready="false">
        <Spinner size="l" />
      </main>
    );
  }
  return <GalleryScreen gallery={gallery} i18n={i18n.value} />;
}
