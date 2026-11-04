import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Intent } from '@zoma/platform-api';
import type { PlayerTrack, PlayerTracks, SubtitleFeed } from '@zoma/player';
import { fileIndex } from '@zoma/player';
import type { Focus, Navigator, Screen, ZoneSpec } from '@zoma/ui';

/**
 * The track menu (RELAY step 20b, architecture.md §2 "Tracks"): the player's audio and subtitle
 * choice, a screen pushed on the live navigator over the player. The info bar's "Audio and
 * subtitles" button opens it on the audio list, and so do the remote's audio key (Samsung MTS,
 * `AUDIO`) and subtitle key (Caption, `SUBTITLES`, on the subtitles):
 *
 *   audio  (the stream's audio tracks; none where the TV can't switch them: the menu says so)
 *   text   ("Off", then the stream's subtitle tracks, then its subtitle files: step 20b2b)
 *   style  (step 20b2b, while the app draws subtitles: "Size", and "Timing" for a file)
 *
 * OK switches to the focused track and the menu stays, so the user hears the change; the
 * controller remembers the choice for the channel. A switch the TV refuses, or a file that
 * can't be loaded, says so. Back, or the key that opened it, closes the menu; STOP closes the
 * player too.
 *
 * The style rows change with LEFT and RIGHT (towards the reading end: larger, later); OK on
 * "Size" goes round the sizes and OK on "Timing" puts the file back in time. Both are kept for
 * the app's run until the profile keeps them (step 20c or the settings screen).
 */

export type TrackSection = 'audio' | 'text';

/** Rows each list shows; a longer list scrolls. */
export const MENU_ROWS = 5;

export type SubtitleSize = 's' | 'm' | 'l';
export const SUBTITLE_SIZES: readonly SubtitleSize[] = ['s', 'm', 'l'];
export const DEFAULT_SUBTITLE_SIZE: SubtitleSize = 'm';
/** A file's timing moves by this much per press, up to `MAX_DELAY_MS` either way. */
export const DELAY_STEP_MS = 250;
export const MAX_DELAY_MS = 30_000;

/** The style rows. */
export const STYLE_SIZE = 0;
export const STYLE_TIMING = 1;

/** Style rows: "Size" while the app draws subtitles, and "Timing" too for a file (an engine's cues can't be moved). */
export function styleRows(feed: SubtitleFeed): number {
  return feed === null ? 0 : feed === 'file' ? 2 : 1;
}

/** What the menu needs of `PlayerController`. */
export interface TrackSwitcher {
  selectAudio(id: string): Promise<boolean>;
  selectText(id: string | null): Promise<boolean>;
}

export interface TrackMenuOptions {
  readonly nav: Navigator;
  /** The stream's tracks now (the player's status). */
  readonly tracks: () => PlayerTracks;
  /** Where the subtitles the app draws come from now (the player's subtitles). */
  readonly feed: () => SubtitleFeed;
  readonly switcher: () => TrackSwitcher;
  /** The timing changed: the player moves a file's cues. */
  readonly delayed: (ms: number) => void;
  /** The menu closed (the player shows its info bar again). */
  readonly closed: () => void;
  /** STOP in the menu: the player closes. */
  readonly stop: () => void;
}

export interface TrackMenu {
  /** Its screen on the navigator, while it shows. */
  readonly screen: ReadonlySignal<Screen | null>;
  /**
   * The list whose last switch the TV refused, or `file` for a subtitle file that couldn't be
   * loaded (`null`: none since the menu opened or the next switch).
   */
  readonly refused: ReadonlySignal<TrackSection | 'file' | null>;
  /** Switches the TV hasn't answered yet (files being loaded included). */
  readonly pending: ReadonlySignal<number>;
  /** The subtitles' size and a file's timing (ms later; negative: earlier). */
  readonly size: ReadonlySignal<SubtitleSize>;
  readonly delay: ReadonlySignal<number>;
  /** Opens the menu on `section` (or moves to it). */
  show(section: TrackSection): void;
  close(): void;
  /** The tracks changed: the lists follow. */
  sync(): void;
}

/** Audio rows: none where the TV can't switch. */
export function audioRows(tracks: PlayerTracks): number {
  return tracks.switching === 'none' ? 0 : tracks.audio.length;
}

function selectedIndex(list: readonly PlayerTrack[]): number {
  for (let i = 0; i < list.length; i++) if (list[i]!.selected) return i;
  return -1;
}

function zones(tracks: PlayerTracks, feed: SubtitleFeed): [ZoneSpec, ZoneSpec, ZoneSpec] {
  return [
    { kind: 'list', id: 'audio', axis: 'vertical', count: audioRows(tracks), visible: MENU_ROWS, neighbours: { down: 'text' } },
    { kind: 'list', id: 'text', axis: 'vertical', count: tracks.text.length + 1, visible: MENU_ROWS, neighbours: { up: 'audio', down: 'style' } },
    { kind: 'list', id: 'style', axis: 'vertical', count: styleRows(feed), neighbours: { up: 'text' } },
  ];
}

function clamp(n: number, low: number, high: number): number {
  return n < low ? low : n > high ? high : n;
}

export function createTrackMenu(options: TrackMenuOptions): TrackMenu {
  const { nav } = options;
  const screen = signal<Screen | null>(null);
  const refused = signal<TrackSection | 'file' | null>(null);
  const pending = signal(0);
  const size = signal<SubtitleSize>(DEFAULT_SUBTITLE_SIZE);
  const delay = signal(0);
  /** Bumps when the menu opens or closes: the answer of a switch from an earlier menu is dropped. */
  let seq = 0;
  /** Bumps on every switch: only the newest one's refusal is shown. */
  let turn = 0;

  /** The focus on `section`'s selected row (subtitles: "Off" when none shows; audio: the first). */
  const focusOn = (s: Screen, section: TrackSection): void => {
    const tracks = options.tracks();
    if (section === 'audio' && audioRows(tracks) > 0) s.focus('audio', Math.max(0, selectedIndex(tracks.audio)));
    else s.focus('text', selectedIndex(tracks.text) + 1);
  };

  const close = (): void => {
    const shown = screen.value;
    if (shown === null) return;
    seq += 1;
    screen.value = null;
    if (shown.open && nav.top === shown) nav.pop();
    options.closed();
  };

  const run = (kind: TrackSection | 'file', switched: Promise<boolean>): void => {
    const mine = seq;
    const own = ++turn;
    refused.value = null;
    pending.value += 1;
    const settle = (ok: boolean): void => {
      if (mine !== seq) return;
      pending.value -= 1;
      if (!ok && own === turn) refused.value = kind;
    };
    switched.then(settle, () => settle(false));
  };

  const setDelay = (ms: number): void => {
    if (ms === delay.value) return;
    delay.value = ms;
    options.delayed(ms);
  };

  /** LEFT or RIGHT on a style row: `step` 1 is larger or later. */
  const adjust = (row: number, step: 1 | -1): void => {
    if (row === STYLE_SIZE) size.value = SUBTITLE_SIZES[clamp(SUBTITLE_SIZES.indexOf(size.value) + step, 0, SUBTITLE_SIZES.length - 1)]!;
    else setDelay(clamp(delay.value + step * DELAY_STEP_MS, -MAX_DELAY_MS, MAX_DELAY_MS));
  };

  const onSelect = (focus: Focus): void => {
    const tracks = options.tracks();
    if (focus.zone === 'audio') {
      const track = tracks.audio[focus.index];
      if (track !== undefined && !track.selected) run('audio', options.switcher().selectAudio(track.id));
    } else if (focus.zone === 'text') {
      if (focus.index === 0) {
        if (selectedIndex(tracks.text) !== -1) run('text', options.switcher().selectText(null));
        return;
      }
      const track = tracks.text[focus.index - 1];
      if (track !== undefined && !track.selected) run(fileIndex(track.id) === -1 ? 'text' : 'file', options.switcher().selectText(track.id));
    } else if (focus.index === STYLE_SIZE) {
      size.value = SUBTITLE_SIZES[(SUBTITLE_SIZES.indexOf(size.value) + 1) % SUBTITLE_SIZES.length]!;
    } else {
      setDelay(0);
    }
  };

  const onIntent = (intent: Intent, focus: Focus): boolean => {
    switch (intent) {
      case 'BACK':
        close();
        return true;
      case 'LEFT':
      case 'RIGHT':
        if (focus.zone !== 'style') return false;
        // RIGHT goes towards the reading end in English, LEFT in Arabic.
        adjust(focus.index, (intent === 'RIGHT') === (focus.dir === 'ltr') ? 1 : -1);
        return true;
      case 'STOP':
        close();
        options.stop();
        return true;
      case 'AUDIO':
      case 'SUBTITLES': {
        // The key again closes the menu; the other key moves to its list.
        const section: TrackSection = intent === 'AUDIO' ? 'audio' : 'text';
        const on = focus.zone === section || (section === 'audio' && audioRows(options.tracks()) === 0);
        if (on) close();
        else if (screen.value !== null) focusOn(screen.value, section);
        return true;
      }
      default:
        return false;
    }
  };

  return {
    screen,
    refused,
    pending,
    size,
    delay,
    show(section: TrackSection): void {
      const shown = screen.value;
      if (shown !== null) {
        focusOn(shown, section);
        return;
      }
      seq += 1;
      refused.value = null;
      pending.value = 0;
      const tracks = options.tracks();
      const pushed = nav.push({ id: 'tracks', zones: zones(tracks, options.feed()), initial: audioRows(tracks) > 0 ? 'audio' : 'text', onIntent, onSelect });
      screen.value = pushed;
      focusOn(pushed, section);
    },
    close,
    sync(): void {
      const shown = screen.value;
      if (shown === null || !shown.open) return;
      const [audio, text, style] = zones(options.tracks(), options.feed());
      shown.update(audio);
      shown.update(text);
      shown.update(style);
    },
  };
}
