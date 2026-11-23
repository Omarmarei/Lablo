import type { FocusBinding, ItemBinding } from '@lablo/ui';
import { useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { TrackLang } from '../player/player-memory';
import { PICTURE_TEXT } from '../player/PlayerScreen';
import { SIZE_KEYS } from '../player/TrackMenuPanel';
import type { PlayerSettings, PlayerSettingsRow, PlayerValues } from './player-settings';
import { PLAYER_SETTINGS_ROWS } from './player-settings';

/**
 * Settings › "Player" as drawn (RELAY step 38d3): each row its name, its value beside it and a line
 * under it, as "Parental control"'s rows. The values are the words the track menu and the info bar
 * use (`lang.*`, `tracks.*`, `player.picture.*`).
 */

type Translate = AppI18n['t'];

function rowClass(base: string, item: ItemBinding): string {
  return item.state === 'focused' ? `${base} is-focused` : item.state === 'memory' ? `${base} is-memory` : base;
}

/** A track language in words; `none` for `null` ("Same as the app", "Off"). */
function langText(t: Translate, lang: TrackLang | null, none: string): string {
  return lang === null ? none : t(lang === 'ar' ? 'lang.ar' : 'lang.en');
}

/** A row's name, its value and the line under it. */
export function playerRowText(t: Translate, row: PlayerSettingsRow, values: PlayerValues): { name: string; value: string; hint: string } {
  if (row === 'audio') return { name: t('playerSettings.audio'), value: langText(t, values.audio, t('playerSettings.app')), hint: t('playerSettings.audioHint') };
  if (row === 'subtitles') return { name: t('tracks.subtitles'), value: langText(t, values.subtitles, t('tracks.off')), hint: t('playerSettings.subtitlesHint') };
  if (row === 'size') return { name: t('playerSettings.size'), value: t(SIZE_KEYS[values.size]), hint: t('playerSettings.sizeHint') };
  return { name: t('playerSettings.picture'), value: t(PICTURE_TEXT[values.picture]), hint: t('playerSettings.pictureHint') };
}

/** A row's value as stored (`data-value`): a language, `app` or `off`, a size, a mode. */
function rawValue(row: PlayerSettingsRow, values: PlayerValues): string {
  if (row === 'audio') return values.audio ?? 'app';
  if (row === 'subtitles') return values.subtitles ?? 'off';
  return row === 'size' ? values.size : values.picture;
}

/** The page as drawn, hook-free: its four rows. */
export function PlayerSettingsView({ i18n, page, item }: { i18n: AppI18n; page: PlayerSettings; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const values: PlayerValues = { audio: page.audio.value, subtitles: page.subtitles.value, size: page.size.value, picture: page.picture.value };
  return (
    <div class="settings__page" data-testid="player-settings" data-modes={page.modes.value.join(' ')}>
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.player')}</h1>
      </header>
      <div class="settings__items" role="menu">
        {PLAYER_SETTINGS_ROWS.map((row, i) => {
          const binding = item(i);
          const text = playerRowText(t, row, values);
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
  return <PlayerSettingsView i18n={i18n} page={page} item={(i) => zone.item(i)} />;
}
