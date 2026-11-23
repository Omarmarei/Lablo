import type { ReadonlySignal, Signal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { PictureMode } from '@lablo/player';
import type { Navigator } from '@lablo/ui';
import type { TrackLang } from '../player/player-memory';
import type { SubtitleSize } from '../player/track-menu';
import { DEFAULT_SUBTITLE_SIZE, SUBTITLE_SIZES } from '../player/track-menu';

/**
 * Settings › "Player" (RELAY step 38d3): a page of four rows, each with its value beside its name.
 * OK goes round a row's values; LEFT and RIGHT step towards the reading end (RIGHT in English,
 * LEFT in Arabic) and stop at the ends, as the track menu's style rows do.
 *
 *   audio      "Same as the app", Arabic, English: the sound a stream plays first
 *   subtitles  Off, Arabic, English: the subtitles turned on when a stream has them
 *   size       Small, Medium, Large: the player's subtitle size (the track menu's "Size")
 *   picture    the modes the TV's engine can show (the info bar's "Picture")
 *
 * Main gives the values and their changes (`PlayerSettingsOptions`): the languages are the
 * profile's (`player-memory.ts`), read at each stream's tracks; the size and the picture are the
 * player's own, so the next play shows them. A content's own remembered track choice still wins.
 *
 * Main-safe as the settings are: no `trim`, `.sort(`, regex or object spread.
 */

export const PLAYER_SETTINGS_SCREEN = 'player-settings';

export type PlayerSettingsRow = 'audio' | 'subtitles' | 'size' | 'picture';
export const PLAYER_SETTINGS_ROWS: readonly PlayerSettingsRow[] = ['audio', 'subtitles', 'size', 'picture'];

/** The languages the audio and subtitle rows go round: `null` ("Same as the app", "Off") first. */
export const TRACK_CHOICES: readonly (TrackLang | null)[] = [null, 'ar', 'en'];

/** The rows' values now. */
export interface PlayerValues {
  /** `null`: the app's language first. */
  readonly audio: TrackLang | null;
  /** `null`: none turned on. */
  readonly subtitles: TrackLang | null;
  readonly size: SubtitleSize;
  readonly picture: PictureMode;
}

/** What main gives (step 38d3): the player's values and their changes. */
export interface PlayerSettingsOptions {
  /** The picture modes the TV's engine can show (this makes the player's controller). */
  modes(): readonly PictureMode[];
  /** The values now, read after `modes` (a kept mode the engine lacks shows as `fit` once the controller is made). */
  values(): PlayerValues;
  setAudio(lang: TrackLang | null): void;
  setSubtitles(lang: TrackLang | null): void;
  setSize(size: SubtitleSize): void;
  setPicture(mode: PictureMode): void;
}

export interface PlayerSettings {
  readonly audio: ReadonlySignal<TrackLang | null>;
  readonly subtitles: ReadonlySignal<TrackLang | null>;
  readonly size: ReadonlySignal<SubtitleSize>;
  readonly picture: ReadonlySignal<PictureMode>;
  /** The picture modes the page offers (read at each opening). */
  readonly modes: ReadonlySignal<readonly PictureMode[]>;
  /** Opens the page over the settings, its values read again. */
  open(): void;
}

/**
 * The value after `value` in `list`: OK (`step` 0) goes round the list; LEFT or RIGHT (`step` 1 or
 * -1) goes towards an end and no further. A value the list lacks moves to its first.
 */
export function nextValue<T>(list: readonly T[], value: T, step: 0 | 1 | -1): T {
  const at = list.indexOf(value);
  if (at === -1) return list[0]!;
  if (step === 0) return list[(at + 1) % list.length]!;
  const to = at + step;
  return list[to < 0 ? 0 : to >= list.length ? list.length - 1 : to]!;
}

/** `value` moved in `list` by `step`; a new value is shown and told once (`set`). */
function move<T>(value: Signal<T>, list: readonly T[], step: 0 | 1 | -1, set: (next: T) => void): void {
  const next = nextValue(list, value.value, step);
  if (next === value.value) return;
  value.value = next;
  set(next);
}

export function createPlayerSettings(nav: Navigator, options: PlayerSettingsOptions): PlayerSettings {
  const audio = signal<TrackLang | null>(null);
  const subtitles = signal<TrackLang | null>(null);
  const size = signal<SubtitleSize>(DEFAULT_SUBTITLE_SIZE);
  const picture = signal<PictureMode>('fit');
  const modes = signal<readonly PictureMode[]>(['fit']);

  const change = (index: number, step: 0 | 1 | -1): void => {
    const row = PLAYER_SETTINGS_ROWS[index];
    if (row === 'audio') move(audio, TRACK_CHOICES, step, (lang) => options.setAudio(lang));
    else if (row === 'subtitles') move(subtitles, TRACK_CHOICES, step, (lang) => options.setSubtitles(lang));
    else if (row === 'size') move(size, SUBTITLE_SIZES, step, (next) => options.setSize(next));
    else move(picture, modes.value, step, (mode) => options.setPicture(mode));
  };

  return {
    audio,
    subtitles,
    size,
    picture,
    modes,
    open(): void {
      modes.value = options.modes();
      const now = options.values();
      audio.value = now.audio;
      subtitles.value = now.subtitles;
      size.value = now.size;
      picture.value = now.picture;
      nav.push({
        id: PLAYER_SETTINGS_SCREEN,
        zones: [{ kind: 'list', id: 'rows', axis: 'vertical', count: PLAYER_SETTINGS_ROWS.length }],
        onIntent: (intent, focus) => {
          if (intent !== 'LEFT' && intent !== 'RIGHT') return false;
          // RIGHT goes towards the reading end in English, LEFT in Arabic.
          change(focus.index, (intent === 'RIGHT') === (focus.dir === 'ltr') ? 1 : -1);
          return true;
        },
        onSelect: (focus) => change(focus.index, 0),
      });
    },
  };
}
