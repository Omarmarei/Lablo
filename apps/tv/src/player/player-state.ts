import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import { DIGIT_INTENTS } from '@zoma/platform-api';
import type { PictureMode, PlayerStatus, PlayOptions, PlayRequest, StreamStats, SubtitleView } from '@zoma/player';
import { NO_TRACKS, nextPicture, streamCandidates } from '@zoma/player';
import type { Focus, Navigator, Screen, ZoneSpec } from '@zoma/ui';
import type { LiveRow, Timers } from '../live/live-state';
import { mark } from '../marks';
import type { ArchiveProgramme } from './catchup';
import { MOVIE_STEP_MS, SEEK_STEP_MS, seekStep } from './catchup';
import type { StreamInfoPanel } from './stream-info';
import { createStreamInfo } from './stream-info';
import type { SubtitleSize, TrackMenu, TrackSection } from './track-menu';
import { createTrackMenu } from './track-menu';

/**
 * The player (RELAY step 20a, architecture.md §2 "Zapping"): the full-screen route that OK on a
 * channel of the live screen opens. It is a screen on the live screen's navigator:
 *
 *   actions  (the info bar's buttons: "Previous channel", "Audio and subtitles", "Stream info",
 *            "Picture")
 *   card     (the error card's "Try again" and "Channels", only once the player gave up)
 *
 * - **Zapping:** CH+/CH− and UP/DOWN move through the list the live screen showed, wrapping at
 *   its ends. The info bar shows the new channel at once; its stream opens `ZAP_DELAY_MS` after
 *   the last key, so a run of presses opens only the channel it ends on.
 * - **Number entry:** digits collect for `DIGITS_MS` (OK ends it early, Back cancels it), then the
 *   channel with that number opens, or a note says no channel has it.
 * - **Previous channel:** PRE-CH, or the info bar's button: the channel watched before this one.
 * - **The info bar** shows on open, on a zap and on INFO, and hides `INFO_MS` after the last key
 *   once the stream has a picture. The error card keeps it up.
 * - **Back** (or STOP) closes the player: playback stops, and the live list's focus goes to the
 *   channel that played. Back during number entry only cancels the entry.
 * - The controller comes from `player()`, made on the first play (the stage and the engines with
 *   it). Its states give "Connecting…", the "Reconnecting…" badge and the error card.
 * - **The track menu** (step 20b, `track-menu.ts`): the info bar's "Audio and subtitles", or the
 *   remote's audio (MTS) and subtitle (Caption) keys. The info bar hides while it shows; the menu
 *   closes when the player gives up (the card shows) or closes.
 * - **The subtitles** (step 20b2b): what the controller says to draw (`subtitles`), in the size
 *   the menu sets; the menu's timing goes to the controller, which keeps it per content (20c1).
 * - **The start on the last channel** (step 20c1): `resume` opens the player on a channel the
 *   list doesn't have yet (the profile's), plays it at once, and moves to its row once the list
 *   finds it (`locate`). Until then the info bar shows the profile's row, and zapping starts once
 *   the list is in. `tuned` tells the app each channel whose stream opens, with its row.
 * - **The stream info** (step 20c2a, `stream-info.ts`): the info bar's "Stream info" turns the
 *   panel on and off; it stays through zaps and goes when the player closes. Each play asks only
 *   for the formats the source's account allows (`outputFormats`).
 * - **The picture** (step 20c2b): the info bar's "Picture" goes round the modes the engine can
 *   show (fit, zoom, stretch, 4:3; no zoom on AVPlay), for every channel from then on. The
 *   controller gets the kept mode when it is made (`picture`), and each change is kept (`pictured`).
 * - **A catalog refresh while it plays** (step 22a): `listChanging` comes before the live screen's
 *   list is replaced. The channel playing stays pinned at its row and the stream isn't touched;
 *   `locate` then moves it (and the previous channel) to their rows in the new list.
 * - **Catch-up** (step 25a): `catchup` opens the player on a channel and plays a programme gone by
 *   from its archive (`catchupRequest`, the app's). The info bar shows that programme (`archive`)
 *   instead of the live now/next. A zap, a number, the previous channel or the card's "Channels"
 *   leave it; the card's "Try again" plays the programme again. A catch-up play doesn't change
 *   the profile's last channel (`tuned`): the start always plays live.
 * - **Catch-up's controls** (step 25d): the info bar gains a seek bar (zone `seek`, above the
 *   buttons; UP and DOWN move between them, CH+/CH− still zap). It shows the position: the time
 *   from the programme's start, its length, and the time it aired there (`position`).
 *   - **Pause:** OK on the seek bar or with the bar hidden, and PLAY/PAUSE.
 *   - **Seeking:** LEFT/RIGHT (on the seek bar or with the bar hidden) and FF/RW, in steps that
 *     grow while a key is held (`seekStep`); a run of presses makes one seek `SEEK_DELAY_MS` after
 *     the last. An HLS archive seeks inside the stream; any other stream plays again from the new
 *     start, cut to the minute. Back stops at the programme's start, forward at its last minute;
 *     forward past now goes live. The media timeline runs left to right in every language.
 *   - **The programme's end:** a stream that plays on (`shift`, Flussonic's `timeshift_abs`)
 *     moves the info bar on to the programme aired then (`programmeAt`); a stream that ends shows
 *     a card, "The programme has ended", with "Watch live" and "Back to the guide".
 * - **A movie** (step 26c): `movie` opens the player on a movie from its details and plays its
 *   request (`mode: 'vod'`). The info bar shows the movie and the seek bar over its media time and
 *   length (the engine's once it knows it, else the panel's), and its buttons lose "Previous
 *   channel". Pause and seeking are catch-up's, inside the stream (`controller.seek`; a stream
 *   that can't plays again from there), with LEFT/RIGHT in `MOVIE_STEP_MS` steps; forward stops
 *   at the last step before the end. CH±, the digits and PRE-CH do nothing (decided in step 26c:
 *   a key that would end the film by mistake is worse than one that does nothing; Back leaves).
 *   Back closes the player onto the details (`MoviePlay.closed`), and so does the end's card,
 *   "The movie has ended", with "Back". The error card's "Try again" plays on from where it was.
 *   A movie never changes the live list, its focus or the last channel.
 */

/** The info bar's stream opens this long after the last zap key. */
export const ZAP_DELAY_MS = 350;
/** Digits collect for this long after the last one. */
export const DIGITS_MS = 1500;
/** The most digits a channel number has. */
export const MAX_DIGITS = 4;
/** "No channel 57" stays this long. */
export const MISSING_MS = 2000;
/** The info bar hides this long after the last key (once the stream shows a picture). */
export const INFO_MS = 5000;
/** A catch-up seek happens this long after the last seek key (step 25d): a run of presses makes one. */
export const SEEK_DELAY_MS = 600;
/** Seek keys closer than this make one held key's run. */
export const HOLD_MS = 300;
/** The catch-up's position is read this often. */
export const POSITION_MS = 1000;
/**
 * A catch-up this far past its programme's end plays on (a stream that ends stops at the end:
 * its `ended` comes before the position gets this far).
 */
export const PLAY_ON_MS = 5000;

const MINUTE_MS = 60_000;

/** Where a catch-up is (step 25d). */
export interface ArchivePosition {
  /** The time it aired at the position, or where a waiting seek goes (epoch ms). */
  readonly time: number;
  /** A seek waits for the keys to rest. */
  readonly seeking: boolean;
  /** The waiting seek goes past now: the live channel. */
  readonly live: boolean;
}

/** The channel list the player zaps through: the live screen's category on show. */
export interface ZapList {
  /** Channels in the list. */
  count(): number;
  /** Row `index` when its chunk is loaded, else `null`. */
  row(index: number): LiveRow | null;
  /** Row `index`, reading its chunk when needed (`null`: not in the list). */
  load(index: number): Promise<LiveRow | null>;
  /** The row of the channel numbered `n` (`-1`: no channel has it). */
  find(n: number): Promise<number>;
  /** The row of channel `key` once the list is in, looked for from row `guess` (`-1`: not in it). */
  locate(key: ContentKey, guess: number): Promise<number>;
  /** A channel's now/next, once asked. */
  guide(key: ContentKey): EpgNowNext | undefined;
  /** Asks a channel's now/next (the info bar of a channel the list never showed). */
  askGuide(key: ContentKey): void;
}

/** What the player needs of `PlayerController`. */
export interface PlayerLike {
  readonly status: PlayerStatus;
  subscribe(listener: (status: PlayerStatus) => void): () => void;
  /** Plays `req` (a movie from `startMs`: step 26c). */
  play(req: PlayRequest, opts?: PlayOptions): Promise<void>;
  stop(): Promise<void>;
  selectAudio(id: string): Promise<boolean>;
  selectText(id: string | null): Promise<boolean>;
  readonly subtitles: SubtitleView;
  subscribeSubtitles(listener: (view: SubtitleView) => void): () => void;
  /** The content playing's subtitle timing (a play sets the content's). */
  readonly subtitleDelay: number;
  setSubtitleDelay(ms: number): void;
  /** The stream on show's figures (`null`: no picture), for the stream info. */
  stats(): StreamStats | null;
  /** The picture modes the engine can show. */
  readonly pictureModes: readonly PictureMode[];
  /** Shows every stream in `mode` from now on; returns the mode shown (`fit` for one the engine lacks). */
  setPicture(mode: PictureMode): PictureMode;
  /** Pauses a playing stream, and plays a paused one on (step 25d). */
  pause(): void;
  resume(): void;
  /** The stream on show's media time (ms; 0 without a picture). */
  positionMs(): number;
  /** Seeks inside the VOD or catch-up stream on show (`false`: it can't, or the engine refused). */
  seek(ms: number): Promise<boolean>;
  /** The VOD stream on show's length (ms; 0: not known, or no picture). */
  durationMs(): number;
}

/** A movie to play (step 26c), from its details. */
export interface MoviePlay {
  readonly item: CatalogItem;
  /** Its request (`mode: 'vod'`, the movie's URL). */
  readonly request: PlayRequest;
  /** Its length from the panel's details (ms; `null`: not known). */
  readonly lengthMs: number | null;
  /** The player closed (Back, or the end's "Back"): the details show again. */
  readonly closed: () => void;
}

/** The movie playing (step 26c). */
export interface PlayingMovie {
  readonly item: CatalogItem;
  /** Its length: the engine's once it knows it, else the panel's (ms; `null`: neither knows). */
  readonly lengthMs: number | null;
}

/** Number entry: the digits typed, then the search, then (maybe) "no channel has it". */
export interface NumberEntry {
  readonly digits: string;
  readonly phase: 'typing' | 'finding' | 'missing';
}

export interface PlayerOptions {
  /** The live screen's navigator: the player is a screen on it. */
  readonly nav: Navigator;
  readonly list: ZapList;
  /** The app's controller (made on the first call). */
  readonly player: () => PlayerLike;
  /** The player route is on or off: the app makes the page transparent over the stage. */
  readonly chrome: (on: boolean) => void;
  /** The player closed; `index` is the row that played last (the live list focuses it). */
  readonly closed: (index: number) => void;
  /** A channel's stream opened: row `index` of the list (step 20c1: the app keeps the last channel). */
  readonly tuned?: (row: LiveRow, index: number) => void;
  /** A source's `allowed_output_formats` (step 20c2a; `null`: not known, every format is tried). */
  readonly outputFormats?: (src: string) => readonly string[] | null;
  /** The subtitles' size to start with (the profile's). */
  readonly subtitleSize?: SubtitleSize;
  /** The subtitles' size changed (the app keeps it). */
  readonly sized?: (size: SubtitleSize) => void;
  /** The picture's mode to start with (the profile's; default `fit`). */
  readonly picture?: PictureMode;
  /** The user chose another picture mode (the app keeps it). */
  readonly pictured?: (mode: PictureMode) => void;
  /**
   * A programme's request from a channel's archive (step 25a; `null`: its URL can't carry one),
   * from its start, or from `from` (epoch ms, a whole minute: step 25d's seek by URL).
   */
  readonly catchupRequest?: (row: LiveRow, programme: ArchiveProgramme, from?: number) => PlayRequest | null;
  /** The programme `row`'s channel aired at `at` (epoch ms; step 25d: a catch-up playing on past its programme). */
  readonly programmeAt?: (row: LiveRow, at: number) => Promise<ArchiveProgramme | null>;
  readonly timers?: Timers;
  /** The clock the stream info measures its rates by, and held keys are timed by (ms; default `Date.now`). */
  readonly now?: () => number;
  /** The wall clock (epoch ms; default `Date.now`): a catch-up seek past it goes live. */
  readonly clock?: () => number;
}

export interface Player {
  /** The player shows. */
  readonly open: ReadonlySignal<boolean>;
  /** Its screen on the navigator, while it shows. */
  readonly screen: ReadonlySignal<Screen | null>;
  /** The row the info bar shows (it leads the stream while a zap waits). */
  readonly target: ReadonlySignal<number>;
  /** The row whose stream was opened last (`-1`: none yet). */
  readonly playing: ReadonlySignal<number>;
  /** The row watched before (`-1`: none). */
  readonly previous: ReadonlySignal<number>;
  readonly status: ReadonlySignal<PlayerStatus>;
  readonly info: ReadonlySignal<boolean>;
  readonly entry: ReadonlySignal<NumberEntry | null>;
  /** Streams opened since the app started (the e2e checks the debounce with it). */
  readonly plays: ReadonlySignal<number>;
  /** The audio and subtitle menu over the player (it also holds the subtitles' size and timing). */
  readonly menu: TrackMenu;
  /** The subtitles to draw now. */
  readonly subtitles: ReadonlySignal<SubtitleView>;
  /** The stream info panel (on and off, and its figures). */
  readonly streamInfo: StreamInfoPanel;
  /** The picture's mode on show (the kept one until the controller is made). */
  readonly picture: ReadonlySignal<PictureMode>;
  /** The programme playing from the archive (step 25a; `null`: live). */
  readonly archive: ReadonlySignal<ArchiveProgramme | null>;
  /**
   * Where the catch-up is (step 25d; `null`: live), read every `POSITION_MS`; in a movie (step 26c)
   * `time` is its media time (ms from its start).
   */
  readonly position: ReadonlySignal<ArchivePosition | null>;
  /** The movie playing (step 26c; `null`: a channel). */
  readonly movie: ReadonlySignal<PlayingMovie | null>;
  /** The info bar's buttons, in order: a movie's have no "Previous channel". */
  readonly actions: ReadonlySignal<readonly PlayerAction[]>;
  /** Opens the player on row `index` of the list and plays it at once. */
  show(index: number): void;
  /**
   * Opens the player on row `index` of the list and plays `programme` from the channel's archive
   * (step 25a); the channel live when its URL can't carry catch-up.
   */
  catchup(index: number, programme: ArchiveProgramme): void;
  /**
   * Opens the player on `row`, a channel the list may not have yet (the start's last channel,
   * step 20c1), plays it at once, and moves to its row when the list finds it from row `guess`.
   */
  resume(row: LiveRow, guess: number): void;
  /** Opens the player on a movie (step 26c) and plays it; Back closes it onto the details. */
  playMovie(film: MoviePlay): void;
  /** Row `index` as the player shows it: the resumed channel until the list has found it. */
  row(index: number): LiveRow | null;
  /**
   * The list is about to be replaced by a refreshed catalog (step 22a; the old one can still be
   * read): the channel playing stays as it is, and moves to its row once the new list finds it.
   */
  listChanging(): void;
  close(): void;
  dispose(): void;
}

const IDLE: PlayerStatus = { state: 'idle', session: 0, key: null, container: null, attempt: 0, failure: null, tracks: NO_TRACKS };
const NO_SUBTITLES: SubtitleView = { feed: null, cues: [] };

/** The info bar's buttons: "Previous channel", "Audio and subtitles", "Stream info" and "Picture". */
export const ACTIONS = 4;
/** The info bar's "Audio and subtitles". */
export const TRACKS_ACTION = 1;
/** The info bar's "Stream info". */
export const STATS_ACTION = 2;
/** The info bar's "Picture" (step 20c2b). */
export const PICTURE_ACTION = 3;

/** An info bar button. */
export type PlayerAction = 'previous' | 'tracks' | 'stats' | 'picture';
/** A channel's buttons (`ACTIONS` of them, at `TRACKS_ACTION`, `STATS_ACTION` and `PICTURE_ACTION`). */
export const CHANNEL_ACTIONS: readonly PlayerAction[] = ['previous', 'tracks', 'stats', 'picture'];
/** A movie's (step 26c): no "Previous channel". */
export const MOVIE_ACTIONS: readonly PlayerAction[] = ['tracks', 'stats', 'picture'];

function actionsZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'actions', axis: 'horizontal', count, neighbours: { up: 'seek' } };
}

/** The catch-up's seek bar above the buttons (step 25d): one item, none while live. */
function seekZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'seek', axis: 'horizontal', count, neighbours: { down: 'actions' } };
}

function cardZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'card', axis: 'horizontal', count };
}

/**
 * A live channel's request: Xtream live tries `.ts`, then `.m3u8` (`streamCandidates`), only
 * those of the two the account's `allowed_output_formats` allow when it names either.
 */
export function liveRequest(row: LiveRow, outputFormats: readonly string[] | null = null): PlayRequest {
  return { key: row.item.key, src: row.item.src, mode: 'live', candidates: streamCandidates(row.item.url, 'live', outputFormats) };
}

const defaultTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createPlayer(options: PlayerOptions): Player {
  const { nav, list } = options;
  const timers = options.timers ?? defaultTimers;

  const open = signal(false);
  const screen = signal<Screen | null>(null);
  const target = signal(0);
  const playing = signal(-1);
  const previous = signal(-1);
  const status = signal<PlayerStatus>(IDLE);
  const info = signal(false);
  const entry = signal<NumberEntry | null>(null);
  const plays = signal(0);
  const subtitles = signal<SubtitleView>(NO_SUBTITLES);
  const picture = signal<PictureMode>(options.picture ?? 'fit');
  const archive = signal<ArchiveProgramme | null>(null);
  const position = signal<ArchivePosition | null>(null);
  const movie = signal<PlayingMovie | null>(null);
  const actions = signal<readonly PlayerAction[]>(CHANNEL_ACTIONS);
  const keyClock = options.now ?? Date.now;
  const wall = options.clock ?? Date.now;

  let controller: PlayerLike | null = null;
  const streamInfo = createStreamInfo({
    stats: () => (controller === null ? null : controller.stats()),
    timers,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  let unsubscribe: (() => void) | null = null;
  let unsubscribeSubtitles: (() => void) | null = null;
  let zapTimer: unknown = null;
  let entryTimer: unknown = null;
  let infoTimer: unknown = null;
  /**
   * The resumed channel, shown at row `index` until the list finds it (step 20c1); dropped when
   * another row plays.
   */
  let pinned: { readonly index: number; readonly row: LiveRow } | null = null;
  /** The resumed channel's first frame is still to be marked. */
  let resumeFrame = false;
  /** Bumps on every play, close and entry: late row reads and searches are dropped. */
  let seq = 0;
  /** The card's zone has its buttons. */
  let carded = false;
  /** The catch-up stream's start (epoch ms at its media time 0), and where it was last seen (step 25d). */
  let streamFrom = 0;
  let lastAt = 0;
  /** A seek waiting for the keys to rest: where it goes, or the live channel. */
  let seekTo: number | null = null;
  let seekLive = false;
  let seekTimer: unknown = null;
  /** The run of seek keys: their direction and kind, the presses so far, and the last one's time. */
  let run: { dir: number; kind: 'step' | 'jump'; count: number; last: number } = { dir: 0, kind: 'step', count: 0, last: -Infinity };
  let positionTimer: unknown = null;
  /** The programme whose end the catch-up played past, once its successor was asked for. */
  let playedOn: ArchiveProgramme | null = null;
  /** The movie's request and where Back goes (step 26c). */
  let film: MoviePlay | null = null;

  const clear = (handle: unknown): null => {
    if (handle !== null) timers.clear(handle);
    return null;
  };

  /** Hides the info bar `INFO_MS` from now, unless the stream is opening, paused, ended or failed. */
  const armInfo = (): void => {
    infoTimer = clear(infoTimer);
    infoTimer = timers.set(() => {
      infoTimer = null;
      const state = status.value.state;
      if (state === 'opening' || state === 'failed' || state === 'paused' || state === 'ended') {
        armInfo();
        return;
      }
      info.value = false;
      // Hidden, a catch-up's keys are the seek bar's again.
      focusSeek();
    }, INFO_MS);
  };

  const showInfo = (): void => {
    info.value = true;
    armInfo();
  };

  /** Row `index`: the resumed channel at its row until the list found it, else the list's. */
  const rowAt = (index: number): LiveRow | null => (pinned !== null && pinned.index === index ? pinned.row : list.row(index));

  /** The info bar's channel: its now/next is asked when the list never asked it. */
  const aim = (index: number): void => {
    target.value = index;
    const row = rowAt(index);
    if (row !== null && list.guide(row.item.key) === undefined) list.askGuide(row.item.key);
  };

  /** The bar shows row `index`; a row the list never read is read now, for its name and now/next. */
  const point = (index: number): void => {
    aim(index);
    if (rowAt(index) !== null) return;
    list.load(index).then(
      () => {
        if (target.value === index) aim(index);
      },
      () => undefined,
    );
  };

  const onStatus = (s: PlayerStatus): void => {
    status.value = s;
    if (resumeFrame && s.state === 'playing') {
      resumeFrame = false;
      mark('zoma:resume-frame');
    }
    // The error card, or a catch-up's or a movie's end (steps 25d, 26c): the card takes over from the menu and a waiting seek.
    const card = s.state === 'failed' || (s.state === 'ended' && (archive.value !== null || movie.value !== null));
    if (card) {
      menu.close();
      cancelSeek();
    } else menu.sync();
    const top = screen.value;
    if (top === null || card === carded) return;
    carded = card;
    // A movie's end has one button, "Back".
    top.update(cardZone(!card ? 0 : s.state === 'ended' && movie.value !== null ? 1 : 2));
    if (card) {
      top.focus('card', 0);
      showInfo();
    } else if (top.active === 'card') {
      top.focus('actions', 0);
    }
  };

  /** The menu's style rows follow where the subtitles come from. */
  const onSubtitles = (view: SubtitleView): void => {
    const moved = view.feed !== subtitles.value.feed;
    subtitles.value = view;
    if (moved) menu.sync();
  };

  const ctrl = (): PlayerLike => {
    if (controller === null) {
      controller = options.player();
      unsubscribe = controller.subscribe(onStatus);
      unsubscribeSubtitles = controller.subscribeSubtitles(onSubtitles);
      status.value = controller.status;
      subtitles.value = controller.subtitles;
      // The kept mode, or `fit` where this engine can't show it (the kept one stays kept).
      picture.value = controller.setPicture(picture.value);
    }
    return controller;
  };

  /** The next picture mode the engine can show, kept for every channel. */
  const nextMode = (): void => {
    const c = ctrl();
    const shown = c.setPicture(nextPicture(picture.value, c.pictureModes));
    picture.value = shown;
    if (options.pictured !== undefined) options.pictured(shown);
  };

  /**
   * Opens row `index`'s stream now (reading its chunk first when needed): live, or `programme`
   * from the channel's archive (step 25a).
   */
  const playRow = (index: number, programme: ArchiveProgramme | null = null, from?: number): void => {
    zapTimer = clear(zapTimer);
    cancelSeek();
    seq += 1;
    const mine = seq;
    const start = (row: LiveRow | null): void => {
      if (mine !== seq || !open.value || row === null) return;
      const request = programme === null || options.catchupRequest === undefined ? null : options.catchupRequest(row, programme, from);
      if (playing.value !== -1 && playing.value !== index) previous.value = playing.value;
      const resumed = pinned !== null && pinned.row === row;
      // Another row: the resumed channel is the list's own from now on.
      if (!resumed) pinned = null;
      resumeFrame = false;
      playing.value = index;
      plays.value += 1;
      archive.value = request === null ? null : programme;
      // Step 25d: where the stream starts, and so where it is until it shows a picture.
      streamFrom = request === null || programme === null ? 0 : from === undefined ? programme.start * MINUTE_MS : from;
      lastAt = streamFrom;
      const c = ctrl();
      void c.play(request ?? liveRequest(row, options.outputFormats === undefined ? null : options.outputFormats(row.item.src)));
      seekBar(request !== null);
      menu.showDelay(c.subtitleDelay);
      // The resumed channel was the last channel already: the list's row says where it is now.
      // A catch-up play isn't the last channel: the start plays live.
      if (!resumed && request === null && options.tuned !== undefined) options.tuned(row, index);
    };
    const row = rowAt(index);
    if (row !== null) start(row);
    else list.load(index).then(start, () => undefined);
  };

  /** Plays the movie from its start, or from `from` (ms of its media time: a seek it couldn't make inside the stream, or "Try again"). */
  const playFilm = (from?: number): void => {
    const shown = film;
    if (shown === null) return;
    cancelSeek();
    seq += 1;
    plays.value += 1;
    streamFrom = 0;
    lastAt = from === undefined ? 0 : from;
    const c = ctrl();
    const opts: PlayOptions = from === undefined ? {} : { startMs: from };
    void c.play(shown.request, opts);
    seekBar(true);
    menu.showDelay(c.subtitleDelay);
  };

  /** Where the catch-up stream is now: its start plus its media time while it shows a picture, else where it was last. */
  const streamAt = (): number => {
    const state = status.value.state;
    if (controller !== null && (state === 'playing' || state === 'paused' || state === 'buffering')) lastAt = streamFrom + controller.positionMs();
    return lastAt;
  };

  /** The info bar's position: a waiting seek's target, else the stream's (`null` live); a movie's length once the engine knows it. */
  const showPosition = (): void => {
    const shown = movie.value;
    const length = shown === null || controller === null ? 0 : controller.durationMs();
    if (shown !== null && length > 0 && length !== shown.lengthMs) movie.value = { item: shown.item, lengthMs: length };
    position.value = archive.value === null && shown === null ? null : { time: seekLive ? wall() : seekTo === null ? streamAt() : seekTo, seeking: seekTo !== null || seekLive, live: seekLive };
  };

  /**
   * A stream that plays on past its programme's end (step 25d: `shift`, Flussonic's
   * `timeshift_abs`): the info bar moves on to the programme aired there, asked once per end.
   */
  const playOn = (): void => {
    const shown = archive.value;
    const at = lastAt;
    if (shown === null || options.programmeAt === undefined || seekTo !== null || seekLive || playedOn === shown || at < shown.end * MINUTE_MS + PLAY_ON_MS) return;
    const row = rowAt(playing.value);
    if (row === null) return;
    playedOn = shown;
    const mine = seq;
    options.programmeAt(row, at).then(
      (found) => {
        if (mine !== seq || archive.value !== shown || found === null || found.start < shown.end) return;
        archive.value = found;
        showPosition();
      },
      () => undefined,
    );
  };

  /** Reads the catch-up's position every `POSITION_MS` while it plays (stops once it is live or closed). */
  const tickPosition = (): void => {
    positionTimer = clear(positionTimer);
    showPosition();
    if (archive.value === null && movie.value === null) return;
    playOn();
    positionTimer = timers.set(() => {
      positionTimer = null;
      tickPosition();
    }, POSITION_MS);
  };

  /** The seek bar on (a catch-up: focused) or off (live). */
  function seekBar(on: boolean): void {
    const top = screen.value;
    if (top !== null) {
      if (!on && top.active === 'seek') top.focus('actions', 0);
      top.update(seekZone(on ? 1 : 0));
      if (on) top.focus('seek', 0);
    }
    tickPosition();
  }

  /** A catch-up's keys go to the seek bar (never while a card shows: a stream that failed or ended keeps the bar up). */
  function focusSeek(): void {
    const top = screen.value;
    if (top !== null && (archive.value !== null || movie.value !== null) && top.active !== 'seek') top.focus('seek', 0);
  }

  /** Drops a waiting seek and its key run. */
  function cancelSeek(): void {
    seekTimer = clear(seekTimer);
    seekTo = null;
    seekLive = false;
    run = { dir: 0, kind: 'step', count: 0, last: -Infinity };
  }

  /** Pauses the catch-up, or plays it on. */
  const togglePause = (): void => {
    const state = status.value.state;
    if (controller !== null && (state === 'playing' || state === 'buffering')) controller.pause();
    else if (controller !== null && state === 'paused') controller.resume();
    focusSeek();
    showInfo();
    showPosition();
  };

  /**
   * Moves a catch-up's waiting seek one step (`dir` 1: forward): `step` for LEFT/RIGHT, `jump` for
   * FF/RW, further while the key is held. It stays within the programme (from its start to its
   * last minute); forward past now, it goes live. It happens `SEEK_DELAY_MS` after the last key.
   */
  const seekBy = (dir: number, kind: 'step' | 'jump'): void => {
    const shown = archive.value;
    const playingFilm = movie.value;
    if (shown === null && playingFilm === null) return;
    const pressed = keyClock();
    run = pressed - run.last <= HOLD_MS && run.dir === dir && run.kind === kind ? { dir, kind, count: run.count + 1, last: pressed } : { dir, kind, count: 0, last: pressed };
    if (playingFilm !== null) {
      // A movie (step 26c): within its media time, forward to the last step before its end when its length is known.
      const target = (seekTo === null ? streamAt() : seekTo) + dir * seekStep(kind, run.count, true);
      const length = playingFilm.lengthMs;
      seekTo = Math.max(0, length === null ? target : Math.min(target, length - MOVIE_STEP_MS));
    } else if (shown !== null) {
      const now = wall();
      const target = (seekLive ? now : seekTo === null ? streamAt() : seekTo) + dir * seekStep(kind, run.count);
      const first = shown.start * MINUTE_MS;
      seekLive = target >= now;
      seekTo = seekLive ? null : Math.min(Math.max(target, first), Math.max(first, shown.end * MINUTE_MS - SEEK_STEP_MS));
    }
    seekTimer = clear(seekTimer);
    seekTimer = timers.set(() => {
      seekTimer = null;
      applySeek();
    }, SEEK_DELAY_MS);
    focusSeek();
    showInfo();
    showPosition();
  };

  /** The keys rested: live, inside an HLS archive on show, or a new URL from the target cut to the minute. */
  const applySeek = (): void => {
    const shown = archive.value;
    const to = seekTo;
    const live = seekLive;
    seekTo = null;
    seekLive = false;
    if (movie.value !== null) {
      if (to !== null) seekFilm(to);
      return;
    }
    const index = playing.value;
    if (shown === null || index === -1) return;
    if (live) {
      go(index);
      return;
    }
    if (to === null) return;
    const state = status.value.state;
    const c = controller;
    if (c !== null && status.value.container === 'hls' && to >= streamFrom && (state === 'playing' || state === 'paused' || state === 'buffering')) {
      const mine = seq;
      void c.seek(to - streamFrom).then((ok) => {
        // The engine refused: a new URL from there.
        if (!ok && mine === seq && archive.value === shown) playRow(index, shown, Math.round(to / MINUTE_MS) * MINUTE_MS);
      });
      // The target until the engine has moved.
      position.value = { time: to, seeking: false, live: false };
      return;
    }
    // Whole minutes: the target is within the programme, which starts on one.
    playRow(index, shown, Math.round(to / MINUTE_MS) * MINUTE_MS);
  };

  /** A movie's seek (step 26c): inside the stream on show, else (or when the engine refuses) a new play from there. */
  const seekFilm = (to: number): void => {
    const state = status.value.state;
    const c = controller;
    if (c === null || (state !== 'playing' && state !== 'paused' && state !== 'buffering')) {
      playFilm(to);
      return;
    }
    // A later seek, play or close drops this one's fallback: the newest target wins.
    seq += 1;
    const mine = seq;
    void c.seek(to).then((ok) => {
      if (!ok && mine === seq) playFilm(to);
    });
    // The target until the engine has moved.
    position.value = { time: to, seeking: false, live: false };
  };

  /** UP and DOWN in a catch-up: between the seek bar and the buttons once the bar shows (`false`: the navigator moves). */
  const upDown = (down: boolean, focus: Focus): boolean => {
    const shown = info.value;
    showInfo();
    return !(shown && (down ? focus.zone === 'seek' : focus.zone === 'actions'));
  };

  /** Moves the info bar `delta` rows on; the stream follows once the keys rest. */
  const zap = (delta: number): void => {
    const count = list.count();
    if (count <= 0) return;
    cancelEntry();
    cancelSeek();
    const next = (((target.value + delta) % count) + count) % count;
    point(next);
    showInfo();
    zapTimer = clear(zapTimer);
    zapTimer = timers.set(() => {
      zapTimer = null;
      playRow(target.value);
    }, ZAP_DELAY_MS);
  };

  /** Puts the player's screen on the navigator and the page over the stage (`false`: it is open already). */
  const openScreen = (buttons: readonly PlayerAction[] = CHANNEL_ACTIONS): boolean => {
    if (open.value) return false;
    open.value = true;
    carded = false;
    actions.value = buttons;
    screen.value = nav.push({ id: 'player', zones: [seekZone(0), actionsZone(buttons.length), cardZone(0)], initial: 'actions', onIntent, onSelect });
    options.chrome(true);
    return true;
  };

  /** Goes straight to row `index` (no debounce: one deliberate action), or to `programme` in its archive. */
  const go = (index: number, programme: ArchiveProgramme | null = null): void => {
    point(index);
    showInfo();
    playRow(index, programme);
  };

  const menu = createTrackMenu({
    nav,
    tracks: () => status.value.tracks,
    feed: () => subtitles.value.feed,
    switcher: () => ctrl(),
    delayed: (ms) => ctrl().setSubtitleDelay(ms),
    ...(options.subtitleSize === undefined ? {} : { size: options.subtitleSize }),
    ...(options.sized === undefined ? {} : { sized: options.sized }),
    closed: () => {
      if (open.value) showInfo();
    },
    stop: () => close(),
  });

  /** The track menu over the player; the info bar makes room for it. */
  const openMenu = (section: TrackSection): void => {
    if (!open.value || status.value.state === 'failed') return;
    cancelEntry();
    infoTimer = clear(infoTimer);
    info.value = false;
    menu.show(section);
  };

  const previousChannel = (): void => {
    showInfo();
    if (previous.value !== -1 && previous.value < list.count()) go(previous.value);
  };

  function cancelEntry(): void {
    entryTimer = clear(entryTimer);
    if (entry.value !== null) seq += 1;
    entry.value = null;
  }

  const commit = (): void => {
    const typed = entry.value;
    if (typed === null || typed.phase !== 'typing') return;
    entryTimer = clear(entryTimer);
    entry.value = { digits: typed.digits, phase: 'finding' };
    seq += 1;
    const mine = seq;
    list.find(Number(typed.digits)).then(
      (index) => {
        if (mine !== seq || !open.value) return;
        if (index === -1) {
          entry.value = { digits: typed.digits, phase: 'missing' };
          entryTimer = timers.set(() => {
            entryTimer = null;
            entry.value = null;
          }, MISSING_MS);
          return;
        }
        entry.value = null;
        go(index);
      },
      () => {
        if (mine === seq) entry.value = null;
      },
    );
  };

  const digit = (d: number): void => {
    cancelSeek();
    const typed = entry.value;
    const digits = typed === null || typed.phase !== 'typing' ? String(d) : typed.digits.length < MAX_DIGITS ? typed.digits + d : typed.digits;
    entryTimer = clear(entryTimer);
    if (typed !== null && typed.phase !== 'typing') seq += 1;
    entry.value = { digits, phase: 'typing' };
    entryTimer = timers.set(() => {
      entryTimer = null;
      commit();
    }, DIGITS_MS);
  };

  const close = (): void => {
    if (!open.value) return;
    // The menu's screen is on top of the player's: it goes first.
    menu.close();
    streamInfo.hide();
    seq += 1;
    zapTimer = clear(zapTimer);
    entryTimer = clear(entryTimer);
    infoTimer = clear(infoTimer);
    cancelSeek();
    positionTimer = clear(positionTimer);
    entry.value = null;
    info.value = false;
    open.value = false;
    archive.value = null;
    position.value = null;
    const left = film;
    film = null;
    movie.value = null;
    const shown = screen.value;
    screen.value = null;
    carded = false;
    if (shown !== null && shown.open) nav.pop();
    options.chrome(false);
    if (controller !== null) void controller.stop();
    resumeFrame = false;
    // A movie goes back to its details; a channel to its row.
    if (left !== null) left.closed();
    else options.closed(playing.value !== -1 ? playing.value : target.value);
  };

  /** The list found the pinned channel (resumed, or kept through a catalog refresh) at row `found` (`-1`: it isn't in the list). */
  const located = (found: number, mine: { readonly index: number; readonly row: LiveRow }): void => {
    // Another row played (it dropped `pinned`), or a zap waits: the resumed channel isn't the one shown.
    if (pinned !== mine || !open.value || found === -1 || target.value !== mine.index) return;
    // At its row now; the list's own row takes over once its chunk is in (no empty bar meanwhile).
    const moved = { index: found, row: mine.row };
    pinned = moved;
    target.value = found;
    playing.value = found;
    const at = seq;
    list.load(found).then(
      (row) => {
        if (row !== null) pinned = null;
        // Where the last channel is now, unless another play or a close came first.
        if (at === seq && row !== null && options.tuned !== undefined) options.tuned(row, found);
      },
      () => undefined,
    );
  };

  const onIntent = (intent: Intent, focus: Focus): boolean => {
    // A movie (step 26c): the channel keys do nothing (they don't reach the screens below either).
    const inFilm = movie.value !== null;
    const d = DIGIT_INTENTS.indexOf(intent as (typeof DIGIT_INTENTS)[number]);
    if (d !== -1) {
      if (!inFilm) digit(d);
      return true;
    }
    // A catch-up's and a movie's own keys (steps 25d, 26c), unless a card shows.
    const archived = (archive.value !== null || inFilm) && !carded;
    switch (intent) {
      case 'CH_UP':
      case 'CH_DOWN':
        if (!inFilm) zap(intent === 'CH_UP' ? 1 : -1);
        return true;
      case 'UP':
      case 'DOWN':
        if (archived) return upDown(intent === 'DOWN', focus);
        if (!inFilm) zap(intent === 'UP' ? 1 : -1);
        return true;
      case 'PLAY_PAUSE':
        if (!archived) return false;
        togglePause();
        return true;
      case 'FF':
      case 'RW':
        if (!archived) return false;
        seekBy(intent === 'FF' ? 1 : -1, 'jump');
        return true;
      case 'PREV_CH':
        if (inFilm) return true;
        cancelEntry();
        previousChannel();
        return true;
      case 'AUDIO':
        openMenu('audio');
        return true;
      case 'SUBTITLES':
        openMenu('text');
        return true;
      case 'INFO':
        if (info.value) {
          infoTimer = clear(infoTimer);
          info.value = false;
        } else showInfo();
        return true;
      case 'BACK':
        if (entry.value !== null) cancelEntry();
        else close();
        return true;
      case 'STOP':
        close();
        return true;
      case 'OK':
        if (entry.value !== null) {
          commit();
          return true;
        }
        // The first OK shows the info bar; with it up, OK presses the focused button.
        if (!info.value && focus.zone === 'actions') {
          showInfo();
          return true;
        }
        showInfo();
        return false;
      case 'LEFT':
      case 'RIGHT':
        // A catch-up seeks: on the seek bar, or with the bar hidden. The timeline runs left to right in every language.
        if (archived && (!info.value || focus.zone !== 'actions')) {
          seekBy(intent === 'RIGHT' ? 1 : -1, 'step');
          return true;
        }
        if (!info.value && focus.zone === 'actions') {
          showInfo();
          return true;
        }
        showInfo();
        return false;
      default:
        return false;
    }
  };

  const onSelect = (focus: Focus): void => {
    const action = focus.zone === 'actions' ? actions.value[focus.index] : undefined;
    if (action === 'tracks') openMenu('audio');
    else if (action === 'stats') streamInfo.toggle();
    else if (action === 'picture') nextMode();
    else if (action === 'previous') previousChannel();
    // OK on a catch-up's or a movie's seek bar (steps 25d, 26c; hidden, the focus is on it) pauses it or plays it on.
    else if (focus.zone === 'seek') togglePause();
    // A movie's cards (step 26c): the error card's "Try again" plays on from where it was; "Back" closes the player.
    else if (focus.zone === 'card' && film !== null && focus.index === 0 && status.value.state === 'failed') playFilm(lastAt);
    else if (focus.zone === 'card' && film !== null) close();
    // The end's card (step 25d): "Watch live" and "Back to the guide".
    else if (focus.zone === 'card' && focus.index === 0 && status.value.state === 'ended') go(playing.value);
    else if (focus.zone === 'card' && focus.index === 0) go(playing.value !== -1 ? playing.value : target.value, archive.value);
    else if (focus.zone === 'card') close();
  };

  return {
    open,
    screen,
    target,
    playing,
    previous,
    status,
    info,
    entry,
    plays,
    menu,
    subtitles,
    streamInfo,
    picture,
    archive,
    position,
    movie,
    actions,
    show(index: number): void {
      if (openScreen()) go(index);
    },
    catchup(index: number, programme: ArchiveProgramme): void {
      if (openScreen()) go(index, programme);
    },
    resume(row: LiveRow, guess: number): void {
      if (open.value) return;
      const mine = { index: guess, row };
      pinned = mine;
      openScreen();
      go(mine.index);
      mark('zoma:resume');
      resumeFrame = true;
      list.locate(row.item.key, mine.index).then(
        (found) => located(found, mine),
        () => undefined,
      );
    },
    playMovie(next: MoviePlay): void {
      if (!openScreen(MOVIE_ACTIONS)) return;
      film = next;
      movie.value = { item: next.item, lengthMs: next.lengthMs };
      showInfo();
      playFilm();
    },
    row: rowAt,
    listChanging(): void {
      // A movie isn't in the list.
      if (!open.value || film !== null) return;
      // The stream playing (none: -1, no row; a zap that waits plays the new list's row when it fires).
      const at = playing.value;
      const row = rowAt(at);
      if (row !== null) {
        const mine = { index: at, row };
        pinned = mine;
        list.locate(row.item.key, at).then(
          (found) => located(found, mine),
          () => undefined,
        );
      }
      // PRE-CH's channel: its row in the new list, or none when it is gone.
      const before = previous.value;
      const earlier = list.row(before);
      if (earlier === null) return;
      list.locate(earlier.item.key, before).then(
        (found) => {
          if (previous.value === before) previous.value = found;
        },
        () => undefined,
      );
    },
    close,
    dispose(): void {
      close();
      if (unsubscribe !== null) unsubscribe();
      if (unsubscribeSubtitles !== null) unsubscribeSubtitles();
      unsubscribe = null;
      unsubscribeSubtitles = null;
    },
  };
}
