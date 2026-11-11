import type { Platform } from '@lablo/platform-api';
import { GuideGrid, Spinner, connectRemote, guideCellAt, resolveLocale, useFocus } from '@lablo/ui';
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { AppI18n } from '../i18n';
import { appI18n } from '../i18n';
import type { GuideGallery } from './guide-gallery';
import { GUIDE_NOW } from './guide-gallery';
import './gallery.css';

const MINUTE = 60_000;

function GuideScreen({ gallery, i18n }: { gallery: GuideGallery; i18n: AppI18n }) {
  const { t, locale } = i18n;
  const focus = useFocus(gallery.binding);
  const time = (minute: number): string => i18n.time(new Date(minute * MINUTE));
  // The programme with the focus, under the title: its own times, not its cell's.
  const programmes = gallery.schedule(focus.index);
  const cell = guideCellAt(programmes, gallery.zone, focus.time ?? GUIDE_NOW);
  const p = cell === null ? -1 : cell.programme;
  const title = p >= 0 && programmes !== null ? (programmes.title[p] ?? '') : null;
  const from = p >= 0 && programmes !== null ? (programmes.start[p] ?? 0) : (cell?.start ?? 0);
  const to = p >= 0 && programmes !== null ? (programmes.end[p] ?? 0) : (cell?.end ?? 0);
  const selection = gallery.selection.value;
  const selected = selection === null ? null : gallery.schedule(selection.row);
  const selectedCell = selection === null ? null : guideCellAt(selected, gallery.zone, selection.start);
  const what = selectedCell !== null && selectedCell.programme >= 0 && selected !== null ? (selected.title[selectedCell.programme] ?? '') : t('guide.noInfo');

  return (
    <main
      class="gallery guide-gallery"
      data-testid="guide-gallery"
      data-ready="true"
      data-language={locale.pseudo ? 'pseudo' : locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-time={focus.time ?? ''}
      data-dir={focus.dir}
    >
      <header class="guide-gallery__header">
        <div class="guide-gallery__top">
          <h1 class="gallery__title">{t('gallery.guideTitle')}</h1>
          <p class="gallery__status" data-testid="guide-status" data-selects={selection?.count ?? 0}>
            {selection === null ? t('gallery.pressOk') : t('gallery.selected', { what })}
          </p>
        </div>
        <p class="guide-gallery__details" data-testid="guide-details">
          {title === null ? (
            <span class="guide-gallery__what">{t('guide.noInfo')}</span>
          ) : (
            <span class="guide-gallery__what" dir="auto" translate={false}>
              {title}
            </span>
          )}
          {/* In the page's direction, as the player's info bar: in Arabic the start is on the right, read first. */}
          <span class="guide-gallery__when" data-testid="guide-when">{`${time(from)} – ${time(to)}`}</span>
        </p>
      </header>
      <GuideGrid
        binding={gallery.binding}
        screen={gallery.screen}
        zone="guide"
        channel={(row) => gallery.rows[row]?.channel ?? { name: '' }}
        schedule={gallery.schedule}
        now={GUIDE_NOW}
        formatTime={time}
        formatDay={(minute) => i18n.date(new Date(minute * MINUTE), 'day')}
        placeholder={t('guide.noInfo')}
        testId="guide"
      />
    </main>
  );
}

interface Props {
  readonly platform: Platform;
  readonly gallery: GuideGallery;
}

/** `?screen=gallery-guide`: waits for the device locale (`?locale=ar-SA` in the browser), then shows the grid. */
export function GuideGalleryApp({ platform, gallery }: Props) {
  const i18n = useSignal<AppI18n | null>(null);
  useEffect(() => {
    let live = true;
    const start = (tag: string, country: string | null): void => {
      if (!live) return;
      const locale = resolveLocale(tag, { country });
      gallery.nav.setDir(locale.dir);
      document.documentElement.lang = locale.tag;
      document.documentElement.dir = locale.dir;
      i18n.value = appI18n(locale);
    };
    platform.info().then(
      (info) => start(info.locale, info.country),
      () => start('en-US', null),
    );
    const disconnect = connectRemote({ platform, nav: gallery.nav, target: window });
    return () => {
      live = false;
      disconnect();
    };
  }, [platform, gallery]);

  if (i18n.value === null) {
    return (
      <main class="gallery is-loading" data-testid="guide-gallery" data-ready="false">
        <Spinner size="l" />
      </main>
    );
  }
  return <GuideScreen gallery={gallery} i18n={i18n.value} />;
}
