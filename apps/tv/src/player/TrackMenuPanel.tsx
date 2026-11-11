import type { VNode } from 'preact';
import { normalizeLang } from '@lablo/core';
import type { PlayerTrack, PlayerTracks, SubtitleFeed } from '@lablo/player';
import { fileIndex } from '@lablo/player';
import type { FocusBinding, ItemBinding, Screen } from '@lablo/ui';
import { useZone } from '@lablo/ui';
import type { AppI18n, MessageKey } from '../i18n';
import type { SubtitleSize, TrackMenu } from './track-menu';
import { MENU_ROWS, STYLE_SIZE, STYLE_TIMING, styleRows } from './track-menu';

/** The languages the catalogs name; any other shows as the stream wrote it. */
const LANGUAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  ar: 'lang.ar',
  en: 'lang.en',
  fr: 'lang.fr',
  es: 'lang.es',
  de: 'lang.de',
  it: 'lang.it',
  pt: 'lang.pt',
  ru: 'lang.ru',
  tr: 'lang.tr',
  fa: 'lang.fa',
  ur: 'lang.ur',
  hi: 'lang.hi',
  zh: 'lang.zh',
  ja: 'lang.ja',
  ko: 'lang.ko',
  bn: 'lang.bn',
  ta: 'lang.ta',
  ml: 'lang.ml',
  tl: 'lang.tl',
  ku: 'lang.ku',
};

/** A track's name: its language in the UI's words, else as the stream wrote it, else "Track n". */
export function trackName(i18n: AppI18n, track: PlayerTrack, index: number): { readonly text: string; readonly provider: boolean } {
  const key = Object.prototype.hasOwnProperty.call(LANGUAGE_KEYS, track.lang) ? LANGUAGE_KEYS[track.lang] : undefined;
  if (key !== undefined) return { text: i18n.t(key), provider: false };
  const own = track.streamLang.trim();
  if (own !== '') return { text: own, provider: true };
  return { text: i18n.t('tracks.track', { n: index + 1 }), provider: false };
}

const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
  </svg>
);

interface RowProps {
  readonly item: ItemBinding;
  readonly name: string;
  /** The name is the stream's own text. */
  readonly provider: boolean;
  /** The stream's label, shown after the name ('' for none). Provider text. */
  readonly label: string;
  /** Our own words after the name (a subtitle file says "File"), or ''. */
  readonly note: string;
  readonly selected: boolean;
  readonly testId: string;
}

function Row({ item, name, provider, label, note, selected, testId }: RowProps) {
  const state = item.state;
  const classes = `tracks__row${selected ? ' is-selected' : ''}${state === 'focused' ? ' is-focused' : state === 'memory' ? ' is-memory' : ''}`;
  return (
    <div
      class={classes}
      role="menuitemradio"
      aria-checked={selected ? 'true' : 'false'}
      data-testid={testId}
      data-state={state}
      data-selected={String(selected)}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <span class="tracks__check">{selected && CHECK}</span>
      <span class="tracks__name" dir={provider ? 'auto' : undefined} translate={provider ? false : undefined}>
        {name}
      </span>
      {label !== '' && (
        <span class="tracks__label" dir="auto" translate={false}>
          {label}
        </span>
      )}
      {note !== '' && <span class="tracks__label">{note}</span>}
    </div>
  );
}

/**
 * The label worth showing after the name: not when it is only the language's name again
 * (`العربية`, `English`, `Español`); `English 5.1 (AC3)` and `Commentary` stay.
 */
export function extraLabel(track: PlayerTrack, name: string): string {
  const label = track.label.trim();
  if (label === '' || label.toLowerCase() === name.toLowerCase() || label.toLowerCase() === track.streamLang.toLowerCase()) return '';
  return track.lang !== '' && ONE_WORD.test(label) && normalizeLang(label) === track.lang ? '' : label;
}

const ONE_WORD = /^[^\s\d]+$/;

interface ListProps {
  readonly i18n: AppI18n;
  readonly screen: Screen;
  readonly binding: FocusBinding;
  readonly zone: 'audio' | 'text';
  readonly tracks: readonly PlayerTrack[];
}

/** One zone's rows from its view's top (a long list scrolls); the subtitles start with "Off". */
function TrackList({ i18n, screen, binding, zone, tracks }: ListProps) {
  const view = useZone(binding, screen, zone);
  const offset = zone === 'text' ? 1 : 0;
  const count = tracks.length + offset;
  const top = Math.max(0, Math.min(view.position.top, count - MENU_ROWS));
  const rows: VNode[] = [];
  for (let i = top; i < Math.min(count, top + MENU_ROWS); i++) {
    if (i < offset) {
      rows.push(<Row key="off" item={view.item(0)} name={i18n.t('tracks.off')} provider={false} label="" note="" selected={!tracks.some((t) => t.selected)} testId="tracks-text-off" />);
      continue;
    }
    const track = tracks[i - offset]!;
    const name = trackName(i18n, track, i - offset);
    rows.push(
      <Row
        key={track.id}
        item={view.item(i)}
        name={name.text}
        provider={name.provider}
        label={extraLabel(track, name.text)}
        note={fileIndex(track.id) === -1 ? '' : i18n.t('tracks.file')}
        selected={track.selected}
        testId={`tracks-${zone}-${track.id}`}
      />,
    );
  }
  return (
    <div class="tracks__list" role="menu" data-testid={`tracks-${zone}-list`} data-top={top}>
      {rows}
    </div>
  );
}

const SIZE_KEYS: Readonly<Record<SubtitleSize, MessageKey>> = { s: 'tracks.size.s', m: 'tracks.size.m', l: 'tracks.size.l' };

/** A file's timing in words: "No delay", "0.5 s later", "1.25 s earlier". */
export function timingText(i18n: AppI18n, delayMs: number): string {
  if (delayMs === 0) return i18n.t('tracks.timing.none');
  const seconds = Math.abs(delayMs) / 1000;
  return delayMs > 0 ? i18n.t('tracks.timing.later', { seconds }) : i18n.t('tracks.timing.earlier', { seconds });
}

function StyleRow({ item, name, value, testId }: { item: ItemBinding; name: string; value: string; testId: string }) {
  const state = item.state;
  return (
    <div
      class={`tracks__row tracks__row--style${state === 'focused' ? ' is-focused' : state === 'memory' ? ' is-memory' : ''}`}
      role="menuitem"
      data-testid={testId}
      data-state={state}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <span class="tracks__name">{name}</span>
      <span class="tracks__value">{value}</span>
    </div>
  );
}

interface StyleProps {
  readonly i18n: AppI18n;
  readonly screen: Screen;
  readonly binding: FocusBinding;
  readonly feed: SubtitleFeed;
  readonly size: SubtitleSize;
  readonly delay: number;
}

/** "Size", and "Timing" for a file: changed by LEFT and RIGHT. */
function StyleList({ i18n, screen, binding, feed, size, delay }: StyleProps) {
  const view = useZone(binding, screen, 'style');
  const { t } = i18n;
  return (
    <div class="tracks__list" role="menu" data-testid="tracks-style-list">
      <StyleRow item={view.item(STYLE_SIZE)} name={t('tracks.size')} value={t(SIZE_KEYS[size])} testId="tracks-style-size" />
      {styleRows(feed) > STYLE_TIMING && <StyleRow item={view.item(STYLE_TIMING)} name={t('tracks.timing')} value={timingText(i18n, delay)} testId="tracks-style-timing" />}
    </div>
  );
}

interface Props {
  readonly menu: TrackMenu;
  /** The status's tracks, as a prop: @preact/signals skips a child whose props didn't change. */
  readonly tracks: PlayerTracks;
  /** Where the subtitles the app draws come from (the style rows show only while it draws them). */
  readonly feed: SubtitleFeed;
  readonly i18n: AppI18n;
  readonly screen: Screen;
  readonly binding: FocusBinding;
}

/**
 * The track menu (RELAY step 20b): a panel at the inline end over the picture, the audio list
 * ("Not supported on this TV" where the engine can't switch), the subtitles ("Off" first, the
 * subtitle files last) and, while the app draws subtitles, their style (step 20b2b).
 */
export function TrackMenuPanel({ menu, tracks, feed, i18n, screen, binding }: Props) {
  const { t } = i18n;
  const refused = menu.refused.value;
  return (
    <aside class="tracks" data-testid="tracks" data-refused={refused ?? ''} data-pending={menu.pending.value} data-switching={tracks.switching}>
      <h2 class="tracks__title">{t('player.tracks')}</h2>
      <section class="tracks__section" data-testid="tracks-audio">
        <h3 class="tracks__heading">{t('tracks.audio')}</h3>
        {tracks.switching === 'none' ? (
          <p class="tracks__note" data-testid="tracks-audio-note">
            {t('tracks.unsupported')}
          </p>
        ) : tracks.audio.length === 0 ? (
          <p class="tracks__note" data-testid="tracks-audio-note">
            {t('tracks.none')}
          </p>
        ) : (
          <TrackList i18n={i18n} screen={screen} binding={binding} zone="audio" tracks={tracks.audio} />
        )}
      </section>
      <section class="tracks__section" data-testid="tracks-text">
        <h3 class="tracks__heading">{t('tracks.subtitles')}</h3>
        <TrackList i18n={i18n} screen={screen} binding={binding} zone="text" tracks={tracks.text} />
        {tracks.text.length === 0 && (
          <p class="tracks__note" data-testid="tracks-text-note">
            {t('tracks.none')}
          </p>
        )}
      </section>
      {styleRows(feed) > 0 && (
        <section class="tracks__section" data-testid="tracks-style">
          <h3 class="tracks__heading">{t('tracks.style')}</h3>
          <StyleList i18n={i18n} screen={screen} binding={binding} feed={feed} size={menu.size.value} delay={menu.delay.value} />
          <p class="tracks__hint">{t('tracks.styleHint')}</p>
        </section>
      )}
      {refused !== null && (
        <p class="tracks__refused" role="status" data-testid="tracks-refused">
          {t(refused === 'file' ? 'tracks.fileFailed' : 'tracks.refused')}
        </p>
      )}
    </aside>
  );
}
