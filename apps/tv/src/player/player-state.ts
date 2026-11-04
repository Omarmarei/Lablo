import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKey } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import { DIGIT_INTENTS } from '@zoma/platform-api';
import type { PictureMode, PlayerStatus, PlayRequest, StreamStats, SubtitleView } from '@zoma/player';
import { NO_TRACKS, nextPicture, streamCandidates } from '@zoma/player';
import type { Focus, Navigator, Screen, ZoneSpec } from '@zoma/ui';
import type { LiveRow, Timers } from '../live/live-state';
import { mark } from '../marks';
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
  play(req: PlayRequest): Promise<void>;
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
  readonly timers?: Timers;
  /** The clock the stream info measures its rates by (ms; default `Date.now`). */
  readonly now?: () => number;
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
  /** Opens the player on row `index` of the list and plays it at once. */
  show(index: number): void;
  /**
   * Opens the player on `row`, a channel the list may not have yet (the start's last channel,
   * step 20c1), plays it at once, and moves to its row when the list finds it from row `guess`.
   */
  resume(row: LiveRow, guess: number): void;
  /** Row `index` as the player shows it: the resumed channel until the list has found it. */
  row(index: number): LiveRow | null;
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

function actionsZone(): ZoneSpec {
  return { kind: 'list', id: 'actions', axis: 'horizontal', count: ACTIONS };
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

  const clear = (handle: unknown): null => {
    if (handle !== null) timers.clear(handle);
    return null;
  };

  /** Hides the info bar `INFO_MS` from now, unless the stream is still opening or failed. */
  const armInfo = (): void => {
    infoTimer = clear(infoTimer);
    infoTimer = timers.set(() => {
      infoTimer = null;
      const state = status.value.state;
      if (state === 'opening' || state === 'failed') armInfo();
      else info.value = false;
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
    const failed = s.state === 'failed';
    // The card takes over from the menu.
    if (failed) menu.close();
    else menu.sync();
    const top = screen.value;
    if (top === null || failed === carded) return;
    carded = failed;
    top.update(cardZone(failed ? 2 : 0));
    if (failed) {
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

  /** Opens row `index`'s stream now (reading its chunk first when needed). */
  const playRow = (index: number): void => {
    zapTimer = clear(zapTimer);
    seq += 1;
    const mine = seq;
    const start = (row: LiveRow | null): void => {
      if (mine !== seq || !open.value || row === null) return;
      if (playing.value !== -1 && playing.value !== index) previous.value = playing.value;
      const resumed = pinned !== null && pinned.row === row;
      // Another row: the resumed channel is the list's own from now on.
      if (!resumed) pinned = null;
      resumeFrame = false;
      playing.value = index;
      plays.value += 1;
      const c = ctrl();
      void c.play(liveRequest(row, options.outputFormats === undefined ? null : options.outputFormats(row.item.src)));
      menu.showDelay(c.subtitleDelay);
      // The resumed channel was the last channel already: the list's row says where it is now.
      if (!resumed && options.tuned !== undefined) options.tuned(row, index);
    };
    const row = rowAt(index);
    if (row !== null) start(row);
    else list.load(index).then(start, () => undefined);
  };

  /** Moves the info bar `delta` rows on; the stream follows once the keys rest. */
  const zap = (delta: number): void => {
    const count = list.count();
    if (count <= 0) return;
    cancelEntry();
    const next = (((target.value + delta) % count) + count) % count;
    point(next);
    showInfo();
    zapTimer = clear(zapTimer);
    zapTimer = timers.set(() => {
      zapTimer = null;
      playRow(target.value);
    }, ZAP_DELAY_MS);
  };

  /** Goes straight to row `index` (no debounce: one deliberate action). */
  const go = (index: number): void => {
    point(index);
    showInfo();
    playRow(index);
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
    entry.value = null;
    info.value = false;
    open.value = false;
    const shown = screen.value;
    screen.value = null;
    carded = false;
    if (shown !== null && shown.open) nav.pop();
    options.chrome(false);
    if (controller !== null) void controller.stop();
    resumeFrame = false;
    options.closed(playing.value !== -1 ? playing.value : target.value);
  };

  /** The list found the resumed channel at row `found` (`-1`: it isn't in the list). */
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
    const d = DIGIT_INTENTS.indexOf(intent as (typeof DIGIT_INTENTS)[number]);
    if (d !== -1) {
      digit(d);
      return true;
    }
    switch (intent) {
      case 'CH_UP':
      case 'UP':
        zap(1);
        return true;
      case 'CH_DOWN':
      case 'DOWN':
        zap(-1);
        return true;
      case 'PREV_CH':
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
    if (focus.zone === 'actions' && focus.index === TRACKS_ACTION) openMenu('audio');
    else if (focus.zone === 'actions' && focus.index === STATS_ACTION) streamInfo.toggle();
    else if (focus.zone === 'actions' && focus.index === PICTURE_ACTION) nextMode();
    else if (focus.zone === 'actions') previousChannel();
    else if (focus.zone === 'card' && focus.index === 0) go(playing.value !== -1 ? playing.value : target.value);
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
    show(index: number): void {
      if (open.value) return;
      open.value = true;
      carded = false;
      screen.value = nav.push({ id: 'player', zones: [actionsZone(), cardZone(0)], initial: 'actions', onIntent, onSelect });
      options.chrome(true);
      go(index);
    },
    resume(row: LiveRow, guess: number): void {
      if (open.value) return;
      const mine = { index: guess, row };
      pinned = mine;
      open.value = true;
      carded = false;
      screen.value = nav.push({ id: 'player', zones: [actionsZone(), cardZone(0)], initial: 'actions', onIntent, onSelect });
      options.chrome(true);
      go(mine.index);
      mark('zoma:resume');
      resumeFrame = true;
      list.locate(row.item.key, mine.index).then(
        (found) => located(found, mine),
        () => undefined,
      );
    },
    row: rowAt,
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
