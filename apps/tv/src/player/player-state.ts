import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKey } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import { DIGIT_INTENTS } from '@zoma/platform-api';
import type { PlayerStatus, PlayRequest } from '@zoma/player';
import { streamCandidates } from '@zoma/player';
import type { Focus, Navigator, Screen, ZoneSpec } from '@zoma/ui';
import type { LiveRow, Timers } from '../live/live-state';

/**
 * The player (RELAY step 20a, architecture.md §2 "Zapping"): the full-screen route that OK on a
 * channel of the live screen opens. It is a screen on the live screen's navigator:
 *
 *   actions  (the info bar's buttons: "Previous channel")
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
  readonly timers?: Timers;
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
  /** Opens the player on row `index` of the list and plays it at once. */
  show(index: number): void;
  close(): void;
  dispose(): void;
}

const IDLE: PlayerStatus = { state: 'idle', session: 0, key: null, container: null, attempt: 0, failure: null };

function actionsZone(): ZoneSpec {
  return { kind: 'list', id: 'actions', axis: 'horizontal', count: 1 };
}

function cardZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'card', axis: 'horizontal', count };
}

/** A live channel's request: Xtream live tries `.ts`, then `.m3u8` (`streamCandidates`). */
export function liveRequest(row: LiveRow): PlayRequest {
  return { key: row.item.key, src: row.item.src, mode: 'live', candidates: streamCandidates(row.item.url, 'live') };
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

  let controller: PlayerLike | null = null;
  let unsubscribe: (() => void) | null = null;
  let zapTimer: unknown = null;
  let entryTimer: unknown = null;
  let infoTimer: unknown = null;
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

  /** The info bar's channel: its now/next is asked when the list never asked it. */
  const aim = (index: number): void => {
    target.value = index;
    const row = list.row(index);
    if (row !== null && list.guide(row.item.key) === undefined) list.askGuide(row.item.key);
  };

  /** The bar shows row `index`; a row the list never read is read now, for its name and now/next. */
  const point = (index: number): void => {
    aim(index);
    if (list.row(index) !== null) return;
    list.load(index).then(
      () => {
        if (target.value === index) aim(index);
      },
      () => undefined,
    );
  };

  const onStatus = (s: PlayerStatus): void => {
    status.value = s;
    const failed = s.state === 'failed';
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

  const ctrl = (): PlayerLike => {
    if (controller === null) {
      controller = options.player();
      unsubscribe = controller.subscribe(onStatus);
      status.value = controller.status;
    }
    return controller;
  };

  /** Opens row `index`'s stream now (reading its chunk first when needed). */
  const playRow = (index: number): void => {
    zapTimer = clear(zapTimer);
    seq += 1;
    const mine = seq;
    const start = (row: LiveRow | null): void => {
      if (mine !== seq || !open.value || row === null) return;
      if (playing.value !== -1 && playing.value !== index) previous.value = playing.value;
      playing.value = index;
      plays.value += 1;
      void ctrl().play(liveRequest(row));
    };
    const row = list.row(index);
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
    options.closed(playing.value !== -1 ? playing.value : target.value);
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
    if (focus.zone === 'actions') previousChannel();
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
    show(index: number): void {
      if (open.value) return;
      open.value = true;
      carded = false;
      screen.value = nav.push({ id: 'player', zones: [actionsZone(), cardZone(0)], initial: 'actions', onIntent, onSelect });
      options.chrome(true);
      go(index);
    },
    close,
    dispose(): void {
      close();
      if (unsubscribe !== null) unsubscribe();
      unsubscribe = null;
    },
  };
}
