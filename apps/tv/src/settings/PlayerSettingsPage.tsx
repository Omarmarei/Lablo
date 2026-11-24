import type { FocusBinding, ItemBinding } from '@lablo/ui';
import { listWindow, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { TrackLang } from '../player/player-memory';
import { PICTURE_TEXT } from '../player/PlayerScreen';
import { SIZE_KEYS } from '../player/TrackMenuPanel';
import type { SleepTimer } from '../player/watch-guard';
import type { PlayerSettings, PlayerSettingsRow, PlayerValues } from './player-settings';
import { PLAYER_SETTINGS_ROWS } from './player-settings';
import { SETTINGS_VISIBLE } from './settings-window';

/**
 * Settings › "Player" as drawn (RELAY step 38d3): each row its name, its value beside it and a line
 * under it, as "Parental control"'s rows. The values are the words the track menu and the info bar
 * use (`lang.*`, `tracks.*`, `player.picture.*`); the clock's (step 39a) are its own.
 * "Still watching?" (step 39c) is named by its prompt's title; the sleep timer's line says when
 * playback stops while it runs. "Buffering" (step 39d) says what its value does. The page draws
 * `SETTINGS_VISIBLE` rows from `top`, the focus engine's window, as the settings list does.
 */

/** What the rows show: the page's values, and the sleep timer as it stands. */
export interface PlayerShown extends PlayerValues {
  readonly sleep: SleepTimer | null;
}

function rowClass(base: string, item: ItemBinding): string {
  return item.state === 'focused' ? `${base} is-focused` : item.state === 'memory' ? `${base} is-memory` : base;
}

/** A track language in words; `none` for `null` ("Same as the app", "Off"). */
function langText(t: AppI18n['t'], lang: TrackLang | null, none: string): string {
  return lang === null ? none : t(lang === 'ar' ? 'lang.ar' : 'lang.en');
}

/** A row's name, its value and the line under it. */
export function playerRowText(i18n: AppI18n, row: PlayerSettingsRow, values: PlayerShown): { name: string; value: string; hint: string } {
  const { t } = i18n;
  if (row === 'audio') return { name: t('playerSettings.audio'), value: langText(t, values.audio, t('playerSettings.app')), hint: t('playerSettings.audioHint') };
  if (row === 'subtitles') return { name: t('tracks.subtitles'), value: langText(t, values.subtitles, t('tracks.off')), hint: t('playerSettings.subtitlesHint') };
  if (row === 'size') return { name: t('playerSettings.size'), value: t(SIZE_KEYS[values.size]), hint: t('playerSettings.sizeHint') };
  if (row === 'picture') return { name: t('playerSettings.picture'), value: t(PICTURE_TEXT[values.picture]), hint: t('playerSettings.pictureHint') };
  if (row === 'clock') return { name: t('playerSettings.clock'), value: t(values.clock ? 'playerSettings.on' : 'playerSettings.off'), hint: t('playerSettings.clockHint') };
  if (row === 'still') {
    return { name: t('player.still.title'), value: values.still === null ? t('playerSettings.stillNever') : t('playerSettings.stillAfter', { n: values.still }), hint: t('playerSettings.stillHint') };
  }
  if (row === 'buffer') {
    const stable = values.buffer === 'stable';
    return { name: t('playerSettings.buffer'), value: t(stable ? 'playerSettings.stable' : 'playerSettings.fast'), hint: t(stable ? 'playerSettings.stableHint' : 'playerSettings.fastHint') };
  }
  const sleep = values.sleep;
  if (sleep === null) return { name: t('playerSettings.sleep'), value: t('playerSettings.sleepOff'), hint: t('playerSettings.sleepHint') };
  return { name: t('playerSettings.sleep'), value: t('playerSettings.sleepFor', { n: sleep.minutes }), hint: t('playerSettings.sleepUntil', { time: i18n.time(new Date(sleep.until)) }) };
}

/** A row's value as stored (`data-value`): a language, `app` or `off`, a size, a mode, `on` or `off`, the hours or the minutes, `fast` or `stable`. */
function rawValue(row: PlayerSettingsRow, values: PlayerShown): string {
  if (row === 'audio') return values.audio ?? 'app';
  if (row === 'subtitles') return values.subtitles ?? 'off';
  if (row === 'clock') return values.clock ? 'on' : 'off';
  if (row === 'still') return values.still === null ? 'off' : String(values.still);
  if (row === 'sleep') return values.sleep === null ? 'off' : String(values.sleep.minutes);
  if (row === 'buffer') return values.buffer;
  return row === 'size' ? values.size : values.picture;
}

/** The page as drawn, hook-free: the rows in its window from `top`. */
export function PlayerSettingsView({ i18n, page, item, top = 0 }: { i18n: AppI18n; page: PlayerSettings; item: (index: number) => ItemBinding; top?: number }) {
  const { t } = i18n;
  const values: PlayerShown = {
    audio: page.audio.value,
    subtitles: page.subtitles.value,
    size: page.size.value,
    picture: page.picture.value,
    clock: page.clock.value,
    still: page.still.value,
    buffer: page.buffer.value,
    sleep: page.sleep(),
  };
  const { from, to } = listWindow(top, PLAYER_SETTINGS_ROWS.length, SETTINGS_VISIBLE);
  return (
    <div class="settings__page" data-testid="player-settings" data-modes={page.modes.value.join(' ')}>
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.player')}</h1>
      </header>
      <div class="settings__items" role="menu" data-top={from} data-count={PLAYER_SETTINGS_ROWS.length}>
        {PLAYER_SETTINGS_ROWS.slice(from, to).map((row, n) => {
          const binding = item(from + n);
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
        })}
      </div>
    </div>
  );
}

export function PlayerSettingsPage({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: PlayerSettings }) {
  const zone = useZone(binding, binding.nav.top, 'rows');
  return <PlayerSettingsView i18n={i18n} page={page} item={(i) => zone.item(i)} top={zone.position.top} />;
}
