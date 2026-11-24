import type { ReadonlySignal, Signal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { PictureMode } from '@lablo/player';
import type { Navigator } from '@lablo/ui';
import type { TrackLang } from '../player/player-memory';
import type { SubtitleSize } from '../player/track-menu';
import { DEFAULT_SUBTITLE_SIZE, SUBTITLE_SIZES } from '../player/track-menu';
import type { SleepTimer } from '../player/watch-guard';
import { DEFAULT_STILL_HOURS } from '../player/watch-guard';
import type { BufferMode } from '../player/play-tuning';
import { BUFFER_MODES } from '../player/play-tuning';
import { SETTINGS_VISIBLE } from './settings-window';

/**
 * Settings › "Player" (RELAY step 38d3): a page of rows, each with its value beside its name.
 * OK goes round a row's values; LEFT and RIGHT step towards the reading end (RIGHT in English,
 * LEFT in Arabic) and stop at the ends, as the track menu's style rows do.
 *
 *   audio      "Same as the app", Arabic, English: the sound a stream plays first
 *   subtitles  Off, Arabic, English: the subtitles turned on when a stream has them
 *   size       Small, Medium, Large: the player's subtitle size (the track menu's "Size")
 *   picture    the modes the TV's engine can show (the info bar's "Picture")
 *   clock      Off, On: the time over the video while the info bar is hidden (step 39a)
 *   still      Never, After 2, 4 or 6 hours: "Still watching?" after that long with no key (step 39c)
 *   sleep      Off, 30, 60, 90 or 120 minutes: the sleep timer, counted from the change (step 39c)
 *   buffer     Fast start, Stable: "Buffering", the watchdog's patience and AVPlay's buffers (step 39d)
 *
 * Main gives the values and their changes (`PlayerSettingsOptions`): the languages are the
 * profile's (`player-memory.ts`), read at each stream's tracks; the size and the picture are the
 * player's own, so the next play shows them (the clock at once). A content's own remembered
 * track choice still wins. The sleep timer is the player's own too, for the app's run only: its
 * row reads it as it stands (`sleep`), so it shows Off once the timer has ended. "Buffering" is the
 * profile's, read at each play (`play-tuning.ts`). The rows scroll, seven in view (step 39d), as
 * the settings list does.
 *
 * Main-safe as the settings are: no `trim`, `.sort(`, regex or object spread.
 */

export const PLAYER_SETTINGS_SCREEN = 'player-settings';

export type PlayerSettingsRow = 'audio' | 'subtitles' | 'size' | 'picture' | 'clock' | 'still' | 'sleep' | 'buffer';
export const PLAYER_SETTINGS_ROWS: readonly PlayerSettingsRow[] = ['audio', 'subtitles', 'size', 'picture', 'clock', 'still', 'sleep', 'buffer'];

/** The languages the audio and subtitle rows go round: `null` ("Same as the app", "Off") first. */
export const TRACK_CHOICES: readonly (TrackLang | null)[] = [null, 'ar', 'en'];

/** The clock row's values (step 39a): Off, then On. */
export const CLOCK_CHOICES: readonly boolean[] = [false, true];

/** "Still watching?"'s values (step 39c), in hours: never (`null`), then the guard's `STILL_HOURS`. */
export const STILL_CHOICES: readonly (number | null)[] = [null, 2, 4, 6];

/** The sleep timer's values (step 39c), in minutes: off (`null`), then the guard's `SLEEP_MINUTES`. */
export const SLEEP_CHOICES: readonly (number | null)[] = [null, 30, 60, 90, 120];

/** The rows' values now. */
export interface PlayerValues {
  /** `null`: the app's language first. */
  readonly audio: TrackLang | null;
  /** `null`: none turned on. */
  readonly subtitles: TrackLang | null;
  readonly size: SubtitleSize;
  readonly picture: PictureMode;
  /** "Clock while watching" (step 39a). */
  readonly clock: boolean;
  /** "Still watching?" (step 39c): the hours without a key before it asks (`null`: never). */
  readonly still: number | null;
  /** "Buffering" (step 39d). */
  readonly buffer: BufferMode;
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
  setClock(on: boolean): void;
  setStill(hours: number | null): void;
  /** The sleep timer as it stands (step 39c; `null`: off), read from the player's signal: a row that reads it while drawing follows it. */
  sleep(): SleepTimer | null;
  /** Sets the sleep timer to `minutes` from now (`null`: off). */
  setSleep(minutes: number | null): void;
  setBuffer(mode: BufferMode): void;
}

export interface PlayerSettings {
  readonly audio: ReadonlySignal<TrackLang | null>;
  readonly subtitles: ReadonlySignal<TrackLang | null>;
  readonly size: ReadonlySignal<SubtitleSize>;
  readonly picture: ReadonlySignal<PictureMode>;
  readonly clock: ReadonlySignal<boolean>;
  readonly still: ReadonlySignal<number | null>;
  readonly buffer: ReadonlySignal<BufferMode>;
  /** The sleep timer as it stands (main's `sleep`). */
  sleep(): SleepTimer | null;
  /** The picture modes the page offers (read at each opening). */
  readonly modes: ReadonlySignal<readonly PictureMode[]>;
  /** Opens the page over the settings, its values read again. */
  open(): void;
}

/**
 * The value after `value` in `list`: OK (`step` 0) goes round the list; LEFT or RIGHT (`step` 1 or
 * -1) goes towards an end and no further. A value the list lacks (`indexOf` -1) moves to its first
 * either way.
 */
export function nextValue<T>(list: readonly T[], value: T, step: 0 | 1 | -1): T {
  const at = list.indexOf(value);
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
  const clock = signal(false);
  const still = signal<number | null>(DEFAULT_STILL_HOURS);
  const buffer = signal<BufferMode>('fast');

  const change = (index: number, step: 0 | 1 | -1): void => {
    const row = PLAYER_SETTINGS_ROWS[index];
    if (row === 'audio') move(audio, TRACK_CHOICES, step, (lang) => options.setAudio(lang));
    else if (row === 'subtitles') move(subtitles, TRACK_CHOICES, step, (lang) => options.setSubtitles(lang));
    else if (row === 'size') move(size, SUBTITLE_SIZES, step, (next) => options.setSize(next));
    else if (row === 'picture') move(picture, modes.value, step, (mode) => options.setPicture(mode));
    else if (row === 'clock') move(clock, CLOCK_CHOICES, step, (on) => options.setClock(on));
    else if (row === 'still') move(still, STILL_CHOICES, step, (hours) => options.setStill(hours));
    else if (row === 'buffer') move(buffer, BUFFER_MODES, step, (mode) => options.setBuffer(mode));
    else {
      // The sleep timer is the player's: the row shows what main says, and a new value starts it from now.
      const set = options.sleep();
      const minutes = set === null ? null : set.minutes;
      const next = nextValue(SLEEP_CHOICES, minutes, step);
      if (next !== minutes) options.setSleep(next);
    }
  };

  return {
    audio,
    subtitles,
    size,
    picture,
    clock,
    still,
    buffer,
    sleep: () => options.sleep(),
    modes,
    open(): void {
      modes.value = options.modes();
      const now = options.values();
      audio.value = now.audio;
      subtitles.value = now.subtitles;
      size.value = now.size;
      picture.value = now.picture;
      clock.value = now.clock;
      still.value = now.still;
      buffer.value = now.buffer;
      nav.push({
        id: PLAYER_SETTINGS_SCREEN,
        zones: [{ kind: 'list', id: 'rows', axis: 'vertical', count: PLAYER_SETTINGS_ROWS.length, visible: SETTINGS_VISIBLE }],
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
