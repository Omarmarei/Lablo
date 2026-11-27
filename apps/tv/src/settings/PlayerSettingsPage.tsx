import type { FocusBinding, ItemBinding } from '@lablo/ui';
import { useZone } from '@lablo/ui';
import type { AppI18n, MessageKey } from '../i18n';
import type { CaptionBackground, CaptionColor } from '../player/appearance';
import type { TrackLang } from '../player/player-memory';
import { PICTURE_TEXT } from '../player/PlayerScreen';
import { SIZE_KEYS } from '../player/TrackMenuPanel';
import type { SleepTimer } from '../player/watch-guard';
import type { PlayerSettings, PlayerValueRow, PlayerValues } from './player-settings';
import { PLAYER_ACCESS_ROWS, PLAYER_SETTINGS_ROWS } from './player-settings';
import { settingsWindow } from './settings-window';

/**
 * Settings › "Player" as drawn (RELAY step 38d3): each row its name, its value beside it and a line
 * under it, as "Parental control"'s rows. The values are the words the track menu and the info bar
 * use (`lang.*`, `tracks.*`, `player.picture.*`); the clock's (step 39a) are its own.
 * "Still watching?" (step 39c) is named by its prompt's title; the sleep timer's line says when
 * playback stops while it runs. "Buffering" (step 39d) says what its value does. The page draws
 * `SETTINGS_VISIBLE` rows from `top`, the focus engine's window, as the settings list does.
 * "Accessibility" (step 55), the last row, is drawn as the settings list's rows are (its name and
 * what its page holds, no value); its page draws step 43's three rows as this page draws its own.
 */

/** What the rows show: the page's values, and the sleep timer as it stands. */
export interface PlayerShown extends PlayerValues {
  readonly sleep: SleepTimer | null;
}

function rowClass(base: string, item: ItemBinding): string {
  return item.state === 'focused' ? `${base} is-focused` : item.state === 'memory' ? `${base} is-memory` : base;
}

const BACKGROUND_TEXT: Readonly<Record<CaptionBackground, MessageKey>> = { dark: 'playerSettings.bg.dark', none: 'playerSettings.bg.none', solid: 'playerSettings.bg.solid' };
const COLOR_TEXT: Readonly<Record<CaptionColor, MessageKey>> = { white: 'playerSettings.color.white', yellow: 'playerSettings.color.yellow', cyan: 'playerSettings.color.cyan', green: 'playerSettings.color.green' };

/** A track language in words; `none` for `null` ("Same as the app", "Off"). */
function langText(t: AppI18n['t'], lang: TrackLang | null, none: string): string {
  return lang === null ? none : t(lang === 'ar' ? 'lang.ar' : 'lang.en');
}

/** A row's name, its value and the line under it. */
export function playerRowText(i18n: AppI18n, row: PlayerValueRow, values: PlayerShown): { name: string; value: string; hint: string } {
  const { t } = i18n;
  if (row === 'audio') return { name: t('playerSettings.audio'), value: langText(t, values.audio, t('playerSettings.app')), hint: t('playerSettings.audioHint') };
  if (row === 'subtitles') return { name: t('tracks.subtitles'), value: langText(t, values.subtitles, t('tracks.off')), hint: t('playerSettings.subtitlesHint') };
  if (row === 'size') return { name: t('playerSettings.size'), value: t(SIZE_KEYS[values.size]), hint: t('playerSettings.sizeHint') };
  if (row === 'picture') return { name: t('playerSettings.picture'), value: t(PICTURE_TEXT[values.picture]), hint: t('playerSettings.pictureHint') };
  if (row === 'clock') return { name: t('playerSettings.clock'), value: t(values.clock ? 'playerSettings.on' : 'playerSettings.off'), hint: t('playerSettings.clockHint') };
  if (row === 'still') {
    return { name: t('player.still.title'), value: values.still === null ? t('playerSettings.stillNever') : t('playerSettings.stillAfter', { n: values.still }), hint: t('playerSettings.stillHint') };
  }
  if (row === 'captionBg') return { name: t('playerSettings.captionBg'), value: t(BACKGROUND_TEXT[values.captionBg]), hint: t('playerSettings.captionBgHint') };
  if (row === 'captionColor') return { name: t('playerSettings.captionColor'), value: t(COLOR_TEXT[values.captionColor]), hint: t('playerSettings.captionColorHint') };
  if (row === 'largeText') return { name: t('playerSettings.largeText'), value: t(values.largeText ? 'playerSettings.on' : 'playerSettings.off'), hint: t('playerSettings.largeTextHint') };
  if (row === 'buffer') {
    const stable = values.buffer === 'stable';
    return { name: t('playerSettings.buffer'), value: t(stable ? 'playerSettings.stable' : 'playerSettings.fast'), hint: t(stable ? 'playerSettings.stableHint' : 'playerSettings.fastHint') };
  }
  const sleep = values.sleep;
  if (sleep === null) return { name: t('playerSettings.sleep'), value: t('playerSettings.sleepOff'), hint: t('playerSettings.sleepHint') };
  return { name: t('playerSettings.sleep'), value: t('playerSettings.sleepFor', { n: sleep.minutes }), hint: t('playerSettings.sleepUntil', { time: i18n.time(new Date(sleep.until)) }) };
}

/** A row's value as stored (`data-value`): a language, `app` or `off`, a size, a mode, `on` or `off`, the hours or the minutes, `fast` or `stable`. */
function rawValue(row: PlayerValueRow, values: PlayerShown): string {
  if (row === 'audio') return values.audio ?? 'app';
  if (row === 'subtitles') return values.subtitles ?? 'off';
  if (row === 'clock') return values.clock ? 'on' : 'off';
  if (row === 'still') return values.still === null ? 'off' : String(values.still);
  if (row === 'sleep') return values.sleep === null ? 'off' : String(values.sleep.minutes);
  if (row === 'buffer') return values.buffer;
  if (row === 'captionBg') return values.captionBg;
  if (row === 'captionColor') return values.captionColor;
  if (row === 'largeText') return values.largeText ? 'on' : 'off';
  return row === 'size' ? values.size : values.picture;
}

/** The values the rows show now, read from the page's signals (the sleep timer as it stands). */
function shown(page: PlayerSettings): PlayerShown {
  return {
    audio: page.audio.value,
    subtitles: page.subtitles.value,
    size: page.size.value,
    picture: page.picture.value,
    clock: page.clock.value,
    still: page.still.value,
    buffer: page.buffer.value,
    captionBg: page.captionBg.value,
    captionColor: page.captionColor.value,
    largeText: page.largeText.value,
    sleep: page.sleep(),
  };
}

/** A row with its value: its name, the value beside it and the line under it (called, not a component, so VNode tests see it). */
function valueRow(i18n: AppI18n, row: PlayerValueRow, values: PlayerShown, binding: ItemBinding) {
  const text = playerRowText(i18n, row, values);
  return (
    <div
      key={row}
      class={rowClass('settings__row settings__switch', binding)}
      role="menuitem"
      data-testid={`player-settings-${row}`}
      data-state={binding.state}
      data-value={rawValue(row, values)}
      onMouseMove={binding.onHover}
      onClick={binding.onPress}
    >
      <div class="settings__top">
        <span class="settings__name">{text.name}</span>
        <span class="settings__value" data-testid={`player-settings-${row}-value`}>
          {text.value}
        </span>
      </div>
      <span class="settings__hint">{text.hint}</span>
    </div>
  );
}

/** The page as drawn, hook-free: the rows in its window from `top`. */
export function PlayerSettingsView({ i18n, page, item, top = 0, at }: { i18n: AppI18n; page: PlayerSettings; item: (index: number) => ItemBinding; top?: number; at?: number }) {
  const { t } = i18n;
  const values = shown(page);
  const { from, to, height } = settingsWindow(top, PLAYER_SETTINGS_ROWS.length, at);
  return (
    <div class="settings__page" data-testid="player-settings" data-modes={page.modes.value.join(' ')}>
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.player')}</h1>
      </header>
      <div class="settings__items" role="menu" data-top={from} data-count={PLAYER_SETTINGS_ROWS.length} style={{ '--settings-row': `${height}px` }}>
        {PLAYER_SETTINGS_ROWS.slice(from, to).map((row, n) => {
          const binding = item(from + n);
          if (row !== 'access') return valueRow(i18n, row, values, binding);
          return (
            <div key={row} class={rowClass('settings__row', binding)} role="menuitem" data-testid="player-settings-access" data-state={binding.state} onMouseMove={binding.onHover} onClick={binding.onPress}>
              <span class="settings__name">{t('playerSettings.access')}</span>
              <span class="settings__hint">{t('playerSettings.accessHint')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "Accessibility"'s page as drawn (step 55), hook-free: step 43's three rows, from `top`. */
export function PlayerAccessView({ i18n, page, item, top = 0, at }: { i18n: AppI18n; page: PlayerSettings; item: (index: number) => ItemBinding; top?: number; at?: number }) {
  const values = shown(page);
  const { from, to, height } = settingsWindow(top, PLAYER_ACCESS_ROWS.length, at);
  return (
    <div class="settings__page" data-testid="player-access">
      <header class="settings__header">
        <h1 class="settings__title">{i18n.t('playerSettings.access')}</h1>
      </header>
      <div class="settings__items" role="menu" data-top={from} data-count={PLAYER_ACCESS_ROWS.length} style={{ '--settings-row': `${height}px` }}>
        {PLAYER_ACCESS_ROWS.slice(from, to).map((row, n) => valueRow(i18n, row, values, item(from + n)))}
      </div>
    </div>
  );
}

export function PlayerSettingsPage({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: PlayerSettings }) {
  const zone = useZone(binding, binding.nav.top, 'rows');
  return <PlayerSettingsView i18n={i18n} page={page} item={(i) => zone.item(i)} top={zone.position.top} at={zone.position.index} />;
}

export function PlayerAccessPage({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: PlayerSettings }) {
  const zone = useZone(binding, binding.nav.top, 'rows');
  return <PlayerAccessView i18n={i18n} page={page} item={(i) => zone.item(i)} top={zone.position.top} at={zone.position.index} />;
}
