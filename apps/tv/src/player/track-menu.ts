import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Intent } from '@zoma/platform-api';
import type { PlayerTrack, PlayerTracks } from '@zoma/player';
import type { Focus, Navigator, Screen, ZoneSpec } from '@zoma/ui';

/**
 * The track menu (RELAY step 20b, architecture.md §2 "Tracks"): the player's audio and subtitle
 * choice, a screen pushed on the live navigator over the player. The info bar's "Audio and
 * subtitles" button opens it on the audio list, and so do the remote's audio key (Samsung MTS,
 * `AUDIO`) and subtitle key (Caption, `SUBTITLES`, on the subtitles):
 *
 *   audio  (the stream's audio tracks; none where the TV can't switch them: the menu says so)
 *   text   ("Off", then the stream's subtitle tracks)
 *
 * OK switches to the focused track and the menu stays, so the user hears the change; the
 * controller remembers the choice for the channel. A switch the TV refuses says so. Back, or
 * the key that opened it, closes the menu; STOP closes the player too.
 */

export type TrackSection = 'audio' | 'text';

/** Rows each list shows; a longer list scrolls. */
export const MENU_ROWS = 5;

/** What the menu needs of `PlayerController`. */
export interface TrackSwitcher {
  selectAudio(id: string): Promise<boolean>;
  selectText(id: string | null): Promise<boolean>;
}

export interface TrackMenuOptions {
  readonly nav: Navigator;
  /** The stream's tracks now (the player's status). */
  readonly tracks: () => PlayerTracks;
  readonly switcher: () => TrackSwitcher;
  /** The menu closed (the player shows its info bar again). */
  readonly closed: () => void;
  /** STOP in the menu: the player closes. */
  readonly stop: () => void;
}

export interface TrackMenu {
  /** Its screen on the navigator, while it shows. */
  readonly screen: ReadonlySignal<Screen | null>;
  /** The list whose last switch the TV refused (`null`: none since the menu opened or the next switch). */
  readonly refused: ReadonlySignal<TrackSection | null>;
  /** Switches the TV hasn't answered yet. */
  readonly pending: ReadonlySignal<number>;
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

function zones(tracks: PlayerTracks): [ZoneSpec, ZoneSpec] {
  return [
    { kind: 'list', id: 'audio', axis: 'vertical', count: audioRows(tracks), visible: MENU_ROWS, neighbours: { down: 'text' } },
    { kind: 'list', id: 'text', axis: 'vertical', count: tracks.text.length + 1, visible: MENU_ROWS, neighbours: { up: 'audio' } },
  ];
}

export function createTrackMenu(options: TrackMenuOptions): TrackMenu {
  const { nav } = options;
  const screen = signal<Screen | null>(null);
  const refused = signal<TrackSection | null>(null);
  const pending = signal(0);
  /** Bumps when the menu opens or closes: the answer of a switch from an earlier menu is dropped. */
  let seq = 0;

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

  const run = (section: TrackSection, switched: Promise<boolean>): void => {
    const mine = seq;
    refused.value = null;
    pending.value += 1;
    const settle = (ok: boolean): void => {
      if (mine !== seq) return;
      pending.value -= 1;
      if (!ok) refused.value = section;
    };
    switched.then(settle, () => settle(false));
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
      if (track !== undefined && !track.selected) run('text', options.switcher().selectText(track.id));
    }
  };

  const onIntent = (intent: Intent, focus: Focus): boolean => {
    switch (intent) {
      case 'BACK':
        close();
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
      const pushed = nav.push({ id: 'tracks', zones: zones(tracks), initial: audioRows(tracks) > 0 ? 'audio' : 'text', onIntent, onSelect });
      screen.value = pushed;
      focusOn(pushed, section);
    },
    close,
    sync(): void {
      const shown = screen.value;
      if (shown === null || !shown.open) return;
      const [audio, text] = zones(options.tracks());
      shown.update(audio);
      shown.update(text);
    },
  };
}
