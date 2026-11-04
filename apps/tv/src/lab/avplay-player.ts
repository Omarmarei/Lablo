/**
 * The battery's AVPlay player (RELAY step 15c2, spikes S4 and S8): `LabPlayer` on Samsung's
 * native player, through platform-tizen's typed AVPlay (the lab never touches `webapis`).
 *
 * - **Open:** `open`, `setListener`, `setDisplayRect` (the stage's hole), `prepareAsync`, then
 *   `play`. A prepare that never answers is AVPlay's 302 freeze: the row's wait runs out.
 *   `prepare` stops before `play` (S8's pre-buffering); `start` plays.
 * - **First frame:** AVPlay paints on the video plane, which the page can't see, so a frame is
 *   the clock moving while `PLAYING`: two readings 50 ms apart (or two `oncurrentplaytime`
 *   calls) that differ. The size comes from the video stream's `Width`/`Height`.
 * - **Tracks:** `getTotalTrackInfo` (AUDIO, TEXT), the selection from `getCurrentStreamInfo`,
 *   `setSelectTrack`; subtitles shown with `setSilentSubtitle(false)` and reported from
 *   `onsubtitlechange` as `cue` events.
 * - **Home and back:** `suspend`, then `restore` (live: no resume time; VOD: the position).
 * - **Stop:** `stop` and `close`, which ends the connection (providers allow few).
 */
import type { AvplayError, AvplayListener, AvplayManager, AvplayTrack } from '@zoma/platform-tizen';
import { avplayErrorText, avplayTracks, avplayUnsupported } from '@zoma/platform-tizen';
import type { LabPlayer, LabPlayerEvent, LabTrack, OpenOptions, PlayerError, PlayerSnapshot } from './player';
import type { VideoTimers } from './video-player';

/** Every 50 ms until this open's first frame. */
export const AVPLAY_POLL_MS = 50;

/** AVPlay's display rect, in its 1920×1080 space. */
export interface AvplayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where AVPlay's picture shows: a transparent hole in the page, and a caption. */
export interface AvplayStage {
  rect(): AvplayRect;
  caption(text: string): void;
  remove(): void;
}

/** How far a prepare got (S8). */
export interface AvplayReadiness {
  readonly prepared: boolean;
  /** From the open to `prepareAsync`'s success; null before it. */
  readonly ms: number | null;
  readonly error: PlayerError | null;
}

/** `LabPlayer` plus what pre-buffering needs. */
export interface AvplayLabPlayer extends LabPlayer {
  /** Opens and prepares `url` without playing it. */
  prepare(url: string, options: OpenOptions): void;
  /** Plays what `prepare` opened: now if it is prepared, else as soon as it is. */
  start(): void;
  readiness(): AvplayReadiness;
}

export interface AvplayEnv {
  readonly timers: VideoTimers;
  /** A monotonic clock in ms (prepare times). */
  now(): number;
}

const PAGE_ENV = (): AvplayEnv => ({
  timers: { setInterval: (handler, ms) => window.setInterval(handler, ms), clearInterval: (id) => window.clearInterval(id) },
  now: () => performance.now(),
});

/** Runs an AVPlay call that may throw; the error's text, or null. */
function attempt(call: () => void): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return avplayErrorText(error);
  }
}

function read<T>(call: () => T, fallback: T): T {
  try {
    return call();
  } catch {
    return fallback;
  }
}

const isTrack = (type: string) => (t: AvplayTrack) => t.type === type;

export function createAvplayPlayer(api: AvplayManager, stage: AvplayStage, env: AvplayEnv = PAGE_ENV()): AvplayLabPlayer {
  const listeners: Array<(event: LabPlayerEvent) => void> = [];
  const emit = (event: LabPlayerEvent): void => {
    for (const listener of listeners.slice()) listener(event);
  };
  /** Each open gets a token; callbacks of an older one change nothing. */
  let token = 0;
  let opened: { readonly url: string; readonly options: OpenOptions } | null = null;
  let hold = false;
  let openedAt = 0;
  let prepared = false;
  let prepareMs: number | null = null;
  let playing = false;
  let framed = false;
  /** The last position read while playing, to see the clock move. */
  let lastSeen: number | null = null;
  let lastPos = 0;
  let size: { width: number; height: number } | null = null;
  let buffering = false;
  let error: PlayerError | null = null;
  let lastEvent = '';
  let shownText: number | null = null;
  let resumeAtMs: number | null = null;
  let timer: number | null = null;

  const stopPolling = (): void => {
    if (timer !== null) env.timers.clearInterval(timer);
    timer = null;
  };

  const fail = (message: string, name: string): void => {
    error = { code: null, message, unsupported: avplayUnsupported(name) };
    emit({ type: 'error', error });
  };

  /** A position read while playing: the second one that differs is the first frame. */
  const observe = (ms: number): void => {
    if (!playing) return;
    lastPos = ms;
    if (framed) return;
    if (lastSeen !== null && ms !== lastSeen) {
      framed = true;
      stopPolling();
      emit({ type: 'frame' });
      return;
    }
    lastSeen = ms;
  };

  const poll = (): void => {
    if (framed || !playing) return;
    if (read(() => api.getState(), '') !== 'PLAYING') return;
    observe(read(() => api.getCurrentTime(), lastPos));
  };

  const startPolling = (): void => {
    stopPolling();
    timer = env.timers.setInterval(poll, AVPLAY_POLL_MS);
  };

  const listenerFor = (mine: number): AvplayListener => {
    const live = (): boolean => mine === token;
    return {
      onbufferingstart: () => {
        if (!live()) return;
        buffering = true;
        if (framed) emit({ type: 'waiting' });
      },
      onbufferingcomplete: () => {
        if (live()) buffering = false;
      },
      oncurrentplaytime: (ms) => {
        if (live() && typeof ms === 'number') observe(ms);
      },
      onstreamcompleted: () => {
        if (live()) emit({ type: 'ended' });
      },
      onevent: (event, data) => {
        if (live()) lastEvent = typeof data !== 'string' || data === '' ? String(event) : `${String(event)} ${data}`;
      },
      onerror: (name) => {
        if (live()) fail(String(name), String(name));
      },
      onsubtitlechange: (_duration, text) => {
        if (!live() || shownText === null || typeof text !== 'string' || text === '') return;
        emit({ type: 'cue', track: shownText, text });
      },
    };
  };

  const play = (mine: number): void => {
    if (mine !== token) return;
    playing = true;
    lastSeen = null;
    const failed = attempt(() => api.play());
    if (failed !== null) {
      fail(`play: ${failed}`, failed);
      return;
    }
    const startMs = opened?.options.startMs;
    if (startMs !== undefined && startMs > 0 && typeof api.seekTo === 'function') {
      const seek = api.seekTo.bind(api);
      // The jump itself is no frame: watch the clock again once it has landed.
      playing = false;
      const landed = (): void => {
        if (mine !== token) return;
        playing = true;
        lastSeen = null;
      };
      const seekFailed = attempt(() => seek(startMs, landed, landed));
      if (seekFailed !== null) landed();
    }
    startPolling();
  };

  const close = (): void => {
    token += 1;
    stopPolling();
    playing = false;
    // Each step on its own: a stop in the wrong state must not keep the connection open.
    attempt(() => api.stop());
    attempt(() => api.close());
  };

  const load = (url: string, options: OpenOptions, holdIt: boolean): void => {
    close();
    const mine = token;
    opened = { url, options };
    hold = holdIt;
    openedAt = env.now();
    prepared = false;
    prepareMs = null;
    framed = false;
    lastSeen = null;
    lastPos = options.startMs ?? 0;
    size = null;
    buffering = false;
    error = null;
    lastEvent = '';
    shownText = null;
    resumeAtMs = null;
    const opening = attempt(() => api.open(url));
    if (opening !== null) {
      fail(`open: ${opening}`, opening);
      return;
    }
    attempt(() => api.setListener(listenerFor(mine)));
    const r = stage.rect();
    attempt(() => api.setDisplayRect(r.x, r.y, r.width, r.height));
    const preparing = attempt(() =>
      api.prepareAsync(
        () => {
          if (mine !== token) return;
          prepared = true;
          prepareMs = Math.round(env.now() - openedAt);
          if (!hold) play(mine);
        },
        (e: AvplayError) => {
          if (mine !== token) return;
          const text = avplayErrorText(e);
          fail(`prepareAsync: ${text}`, typeof e?.name === 'string' ? e.name : text);
        },
      ),
    );
    if (preparing !== null) fail(`prepareAsync: ${preparing}`, preparing);
  };

  const tracksOf = (type: string): AvplayTrack[] => avplayTracks(read(() => api.getTotalTrackInfo(), [])).filter(isTrack(type));
  const currentOf = (type: string): AvplayTrack | undefined => avplayTracks(read(() => api.getCurrentStreamInfo(), [])).filter(isTrack(type))[0];
  const labTrack = (t: AvplayTrack, i: number, selected: boolean): LabTrack => ({
    index: i,
    id: String(t.index),
    lang: t.lang,
    label: `${t.codec}${t.channels === null ? '' : ` ${t.channels}ch`}`,
    kind: t.type.toLowerCase(),
    selected,
  });

  const pictureSize = (): { width: number; height: number } => {
    if (size !== null) return size;
    const video = currentOf('VIDEO') ?? tracksOf('VIDEO')[0];
    if (video === undefined || video.width === null || video.height === null) return { width: 0, height: 0 };
    // Kept once the picture is up: the stream's size doesn't change within an open.
    if (framed) size = { width: video.width, height: video.height };
    return { width: video.width, height: video.height };
  };

  return {
    kind: 'avplay',
    describe: () => ({
      engine: 'avplay',
      version: read(() => (typeof api.getVersion === 'function' ? api.getVersion() : null), null),
      state: read(() => api.getState(), 'unknown'),
      apis: {
        seekTo: typeof api.seekTo === 'function',
        setSilentSubtitle: typeof api.setSilentSubtitle === 'function',
        getVersion: typeof api.getVersion === 'function',
        restore: typeof api.restore === 'function',
      },
    }),
    // AVPlay has no canPlayType: it says what it can't play by failing.
    canPlay: () => null,
    open: (url, options) => load(url, options, false),
    prepare: (url, options) => load(url, options, true),
    start: () => {
      hold = false;
      if (prepared && !playing) play(token);
    },
    readiness: () => ({ prepared, ms: prepareMs, error }),
    snapshot: (): PlayerSnapshot => {
      const state = read(() => api.getState(), 'unknown');
      if (playing && (state === 'PLAYING' || state === 'PAUSED')) lastPos = read(() => api.getCurrentTime(), lastPos);
      const picture = framed ? pictureSize() : { width: 0, height: 0 };
      const notes = [state, buffering ? 'buffering' : '', opened !== null && !prepared ? 'preparing' : '', lastEvent].filter((part) => part !== '');
      return { positionMs: lastPos, width: picture.width, height: picture.height, frames: null, paused: state !== 'PLAYING', muted: false, state: notes.join(', '), error };
    },
    on: (listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at !== -1) listeners.splice(at, 1);
      };
    },
    audioTracks: () => {
      const current = currentOf('AUDIO');
      return tracksOf('AUDIO').map((t, i) => labTrack(t, i, current !== undefined && current.index === t.index));
    },
    selectAudio: (index) => {
      const track = tracksOf('AUDIO')[index];
      if (track === undefined) return false;
      return attempt(() => api.setSelectTrack('AUDIO', track.index)) === null;
    },
    // AVPlay has no second route: setSelectTrack is the one.
    audioService: () => null,
    textTracks: () => {
      const current = currentOf('TEXT');
      return tracksOf('TEXT').map((t, i) => labTrack(t, i, shownText === i && current !== undefined && current.index === t.index));
    },
    showText: (index) => {
      if (index === null) {
        shownText = null;
        return typeof api.setSilentSubtitle !== 'function' || attempt(() => api.setSilentSubtitle?.(true)) === null;
      }
      const track = tracksOf('TEXT')[index];
      if (track === undefined) return false;
      if (attempt(() => api.setSelectTrack('TEXT', track.index)) !== null) return false;
      attempt(() => api.setSilentSubtitle?.(false));
      shownText = index;
      return true;
    },
    suspend: () => {
      if (opened === null) return;
      resumeAtMs = opened.options.live ? null : read(() => api.getCurrentTime(), lastPos);
      stopPolling();
      playing = false;
      const failed = attempt(() => api.suspend());
      if (failed !== null) fail(`suspend: ${failed}`, failed);
    },
    resume: () => {
      if (opened === null) return;
      framed = false;
      lastSeen = null;
      // Live: no resume time (it means nothing there); VOD: the position, never 0.
      const at = resumeAtMs !== null && resumeAtMs > 0 ? resumeAtMs : null;
      const failed = attempt(() => (at === null ? api.restore() : api.restore(null, at)));
      if (failed !== null) {
        fail(`restore: ${failed}`, failed);
        return;
      }
      playing = true;
      startPolling();
    },
    caption: (text) => stage.caption(text),
    stop: () => {
      close();
      opened = null;
    },
    dispose: () => {
      close();
      opened = null;
      stage.remove();
    },
  };
}

/** The class on `<html>` that makes the page transparent over AVPlay's plane (lab.css). */
export const AVPLAY_PAGE_CLASS = 'lab--avplay';

/**
 * AVPlay's stage: a box at the bottom right like the `<video>` one, with AVPlay's
 * `<object type="application/avplayer">` where the picture goes, and the page made transparent
 * while it shows (AVPlay paints under the page). The rect is in AVPlay's 1920×1080 space.
 */
export function mountAvplayStage(doc: Document): AvplayStage {
  const box = doc.createElement('div');
  box.className = 'lab__player lab__player--avplay';
  box.setAttribute('data-testid', 'lab-player');
  const plane = doc.createElement('object');
  plane.setAttribute('type', 'application/avplayer');
  plane.className = 'lab__video lab__avplay';
  const caption = doc.createElement('p');
  caption.className = 'lab__player-caption';
  caption.setAttribute('data-testid', 'lab-player-caption');
  box.appendChild(plane);
  box.appendChild(caption);
  doc.body.appendChild(box);
  const root = doc.documentElement;
  root.className = `${root.className} ${AVPLAY_PAGE_CLASS}`.trim();
  return {
    rect: () => {
      const r = plane.getBoundingClientRect();
      const view = doc.defaultView;
      const scale = view !== null && view.innerWidth > 0 ? 1920 / view.innerWidth : 1;
      return { x: Math.round(r.left * scale), y: Math.round(r.top * scale), width: Math.round(r.width * scale), height: Math.round(r.height * scale) };
    },
    caption: (text) => {
      caption.textContent = text;
    },
    remove: () => {
      if (box.parentNode !== null) box.parentNode.removeChild(box);
      root.className = root.className
        .split(' ')
        .filter((name) => name !== AVPLAY_PAGE_CLASS && name !== '')
        .join(' ');
    },
  };
}
