/**
 * Html5Engine (architecture.md §2, RELAY step 18): a `PlayerEngine` over one `<video>` element.
 * webOS plays everything through it, Tizen falls back to it for HLS (step 19), and the desktop
 * is the dev loop. Written from what the lab's `<video>` battery (spike S5) found on the LG TV
 * and in desktop Chromium (docs/spikes/results.md):
 * - **The first frame** is the first moment after `playing` that the element has a picture size
 *   and its clock has moved (polled every 50 ms). A stream that plays sound with no picture (a
 *   video codec the TV can't decode, such as HEVC in headless desktop Chromium) fails as
 *   `unsupported`/`NO_PICTURE` once 5 s of it played, instead of an open timeout that would be
 *   blamed on the provider. Audio-only streams (radio) wait for step 37.
 * - **Errors:** `MediaError` codes by kind. `MEDIA_ERR_SRC_NOT_SUPPORTED` also covers HTTP errors
 *   and panels' error pages, so it is `unsupported` (never retried on the same URL) only when the
 *   element says it can't play the container at all (`canPlayType` ''), and only for containers
 *   whose answer can be trusted: the LG TV answers '' for `video/x-matroska` and plays MKV.
 * - **`stop()`** pauses, drops `src` and loads nothing, which closes the connection; a pending
 *   `load()` rejects with `app`/`ABORTED`. Events of a load that was stopped or replaced are
 *   dropped here too, besides the controller's token check.
 * - **Audio tracks:** the element's `audioTracks` (the LG TV switched in 154–205 ms without a
 *   restart). Where the element ignores a switch or has no list, the platform's track service by
 *   the element's `mediaId` (webOS luna `selectTrack`, which LG's ACG table doesn't list:
 *   ADR-012 keeps it a fallback).
 * - **Text tracks:** the element's own, drawn by the TV (webOS draws embedded subtitles itself).
 *   The LG TV listed none for in-band SRT or mov_text, so the subtitle overlay (step 20) needs
 *   its own parser.
 * - **Lifecycle:** `suspend()` closes the connection and `resume()` reopens the same URL: live at
 *   the live edge, VOD and catch-up where they were (webOS stops a hidden app's media).
 * - **Autoplay:** a desktop browser may refuse sound before a key press; the engine then plays
 *   muted. TVs don't refuse.
 */

import type { Clock } from './clock';
import { SYSTEM_CLOCK } from './clock';
import type { Container, EngineCaps, EngineEvent, EngineSource, EngineStats, LoadOptions, PictureFit, PlaybackError, PlayerEngine, Rect, Track } from './engine';

/** How often the engine looks for the first frame after `playing`. */
export const FRAME_POLL_MS = 50;
/** Media time played with no picture before the engine calls the stream unsupported. */
export const NO_PICTURE_MS = 5000;

/** `MediaError.code` values. */
export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
const MEDIA_ERROR_NAMES = ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'];

/**
 * The MIME type `canPlayType` is asked for, for the containers whose '' can be trusted. MKV is
 * left out (the LG TV answers '' for `video/x-matroska` and plays MKV, S5), and `other` names no
 * container.
 */
export const CONTAINER_MIME: Readonly<Partial<Record<Container, string>>> = {
  ts: 'video/mp2t',
  hls: 'application/vnd.apple.mpegurl',
  mp4: 'video/mp4',
};

/**
 * A `MediaError` as a `PlaybackError`. `canPlay` is the element's `canPlayType` answer for the
 * container, or null when the container has no trusted answer.
 */
export function mediaError(code: number, canPlay: string | null): PlaybackError {
  const name = MEDIA_ERROR_NAMES[code] ?? 'MEDIA_ERR_' + String(code);
  if (code === MEDIA_ERR_DECODE) return { kind: 'decode', code: name };
  if (code === MEDIA_ERR_SRC_NOT_SUPPORTED && canPlay === '') return { kind: 'unsupported', code: name };
  // The network, an abort, or "not supported" that may be an HTTP error: worth a retry.
  return { kind: 'network', code: name };
}

/** `audioTracks` isn't in TypeScript's DOM library (Chromium has it behind a flag; webOS ships it). */
export interface AudioTrackLike {
  readonly language: string;
  readonly label: string;
  enabled: boolean;
}

export interface TextTrackLike {
  readonly language: string;
  readonly label: string;
  mode: string;
}

export interface TrackListLike<T> {
  readonly length: number;
  readonly [index: number]: T | undefined;
}

export interface AudioTrackListLike extends TrackListLike<AudioTrackLike> {
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

/** What the engine reads and calls on its element: an `HTMLVideoElement` (tests pass a fake). */
export interface MediaElementLike {
  src: string;
  currentTime: number;
  /** Seconds: NaN before the metadata, Infinity for a live stream. */
  readonly duration: number;
  muted: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly error: { readonly code: number } | null;
  readonly style: { left: string; top: string; width: string; height: string; objectFit: string };
  readonly audioTracks?: AudioTrackListLike;
  readonly textTracks?: TrackListLike<TextTrackLike>;
  /** webOS: the media pipeline's id for this element, once it loads (luna `com.webos.media`). */
  readonly mediaId?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  removeAttribute(name: string): void;
  load(): void;
  play(): Promise<void> | undefined;
  pause(): void;
  canPlayType(type: string): string;
  getVideoPlaybackQuality?(): { readonly droppedVideoFrames: number; readonly totalVideoFrames?: number };
  /** Chromium's own counters: old engines have them where `getVideoPlaybackQuality` is missing, and only they count bytes. */
  readonly webkitDecodedFrameCount?: number;
  readonly webkitDroppedFrameCount?: number;
  readonly webkitVideoDecodedByteCount?: number;
  readonly webkitAudioDecodedByteCount?: number;
}

export interface Html5EngineOptions {
  readonly clock?: Clock;
  /**
   * The platform's audio track service, by the element's `mediaId` and the track's place in the
   * stream (webOS luna `com.webos.media/selectTrack`); resolves when the service took the call.
   */
  readonly selectAudioTrack?: ((mediaId: string, index: number) => Promise<unknown>) | null;
  /** The tallest picture the device shows. */
  readonly maxHeight?: number;
  readonly framePollMs?: number;
  readonly noPictureMs?: number;
}

/** One `load()`: what it plays and how far it got. */
interface Load {
  readonly token: number;
  readonly source: EngineSource;
  /** Where to start (ms), applied once the metadata is in; null: the start, or the live edge. */
  startMs: number | null;
  /** The `load()` promise's ends, until it settles. */
  settle: { readonly resolve: () => void; readonly reject: (error: PlaybackError) => void } | null;
  /** Media time (s) at this open's first `playing`; null before it. */
  playingAt: number | null;
  framed: boolean;
  waiting: boolean;
  failed: boolean;
  suspended: boolean;
}

const ABORTED: PlaybackError = { kind: 'app', code: 'ABORTED' };
const DESTROYED: PlaybackError = { kind: 'app', code: 'DESTROYED' };

/** A track id (its place in the element's list) as an index, or -1. */
function trackIndex(id: string): number {
  const index = Number(id);
  return id !== '' && index >= 0 && Math.floor(index) === index ? index : -1;
}

/** The `<video>` does every fit (CSS `object-fit`, in Chromium since 31). */
const HTML5_FITS: readonly PictureFit[] = ['contain', 'fill', 'cover'];

function px(value: number): string {
  return String(Math.round(value)) + 'px';
}

export class Html5Engine implements PlayerEngine {
  readonly kind = 'html5' as const;
  readonly caps: EngineCaps;
  private readonly clock: Clock;
  private readonly selectAudioTrack: ((mediaId: string, index: number) => Promise<unknown>) | null;
  private readonly framePollMs: number;
  private readonly noPictureMs: number;
  private listeners: ((e: EngineEvent & { readonly token: number }) => void)[] = [];
  private cur: Load | null = null;
  /** The element has a source (a stop must close it). */
  private loaded = false;
  private destroyed = false;
  private pollTimer: unknown = null;
  private readonly handlers: ReadonlyArray<readonly [string, () => void]> = [
    ['loadedmetadata', () => this.onMetadata()],
    ['playing', () => this.onPlaying()],
    ['waiting', () => this.onWaiting()],
    ['ended', () => this.onEnded()],
    ['error', () => this.onError()],
  ];
  private readonly onTracks = (): void => {
    const l = this.cur;
    if (l !== null) this.emit({ type: 'tracks', token: l.token });
  };

  constructor(
    private readonly video: MediaElementLike,
    options: Html5EngineOptions = {},
  ) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.selectAudioTrack = options.selectAudioTrack ?? null;
    this.framePollMs = options.framePollMs ?? FRAME_POLL_MS;
    this.noPictureMs = options.noPictureMs ?? NO_PICTURE_MS;
    const audio = video.audioTracks;
    this.caps = {
      maxHeight: options.maxHeight ?? 2160,
      trackSwitch: audio !== undefined ? 'reliable' : this.selectAudioTrack !== null ? 'unreliable' : 'none',
      deliversSubtitleText: false,
      preloadSlots: 0,
      rates: [1],
      fits: HTML5_FITS,
    };
    for (const [type, handler] of this.handlers) video.addEventListener(type, handler);
    if (audio !== undefined && audio.addEventListener !== undefined) {
      audio.addEventListener('addtrack', this.onTracks);
      audio.addEventListener('removetrack', this.onTracks);
      audio.addEventListener('change', this.onTracks);
    }
  }

  load(source: EngineSource, token: number, opts: LoadOptions = {}): Promise<void> {
    if (this.destroyed) return Promise.reject(DESTROYED);
    // The controller always stops first; a load without one replaces the old source.
    this.drop();
    return new Promise<void>((resolve, reject) => {
      const start = opts.startMs;
      const l: Load = {
        token,
        source,
        startMs: !source.live && start !== undefined && start > 0 ? start : null,
        settle: { resolve, reject },
        playingAt: null,
        framed: false,
        waiting: false,
        failed: false,
        suspended: false,
      };
      this.cur = l;
      this.open(l);
    });
  }

  stop(): Promise<void> {
    this.drop();
    this.close();
    return Promise.resolve();
  }

  play(): void {
    // Nothing to play, or nothing on the element while suspended (`resume` plays).
    if (this.cur !== null && !this.cur.suspended) this.startPlayback();
  }

  pause(): void {
    this.video.pause();
  }

  seek(ms: number): Promise<void> {
    this.video.currentTime = ms / 1000;
    return Promise.resolve();
  }

  setRect(r: Rect | 'full'): void {
    const style = this.video.style;
    if (r === 'full') {
      style.left = '0';
      style.top = '0';
      style.width = '100%';
      style.height = '100%';
      return;
    }
    style.left = px(r.x);
    style.top = px(r.y);
    style.width = px(r.width);
    style.height = px(r.height);
  }

  setFit(fit: PictureFit): void {
    this.video.style.objectFit = fit;
  }

  getTracks(): { audio: Track[]; text: Track[] } {
    const audio: Track[] = [];
    const text: Track[] = [];
    const a = this.video.audioTracks;
    if (a !== undefined) {
      for (let i = 0; i < a.length; i += 1) {
        const t = a[i];
        if (t !== undefined) audio.push({ id: String(i), lang: t.language, label: t.label, selected: t.enabled });
      }
    }
    const s = this.video.textTracks;
    if (s !== undefined) {
      for (let i = 0; i < s.length; i += 1) {
        const t = s[i];
        if (t !== undefined) text.push({ id: String(i), lang: t.language, label: t.label, selected: t.mode === 'showing' });
      }
    }
    return { audio, text };
  }

  selectAudio(id: string): Promise<boolean> {
    const index = trackIndex(id);
    if (index === -1) return Promise.resolve(false);
    const list = this.video.audioTracks;
    if (list !== undefined) {
      const chosen = list[index];
      if (chosen === undefined) return Promise.resolve(false);
      // The new one first, so the element is never left without sound.
      chosen.enabled = true;
      for (let i = 0; i < list.length; i += 1) {
        const t = list[i];
        if (i !== index && t !== undefined) t.enabled = false;
      }
      if (chosen.enabled) return Promise.resolve(true);
    }
    // The element has no list or ignored the switch: the platform's track service, if any.
    const service = this.selectAudioTrack;
    const mediaId = this.video.mediaId;
    if (service === null || mediaId === undefined || mediaId === '') return Promise.resolve(false);
    return service(mediaId, index).then(
      () => true,
      () => false,
    );
  }

  selectText(id: string | null): Promise<boolean> {
    const list = this.video.textTracks;
    if (list === undefined) return Promise.resolve(id === null);
    const index = id === null ? -1 : trackIndex(id);
    let found = false;
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i];
      if (t === undefined) continue;
      t.mode = i === index ? 'showing' : 'disabled';
      if (i === index) found = true;
    }
    return Promise.resolve(found || id === null);
  }

  positionMs(): number {
    return this.video.currentTime * 1000;
  }

  /** The element's `duration`: NaN before the metadata, Infinity for a live stream (both 0 here). */
  durationMs(): number {
    const seconds = this.video.duration;
    return isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }

  /**
   * The picture size, and the element's counters (step 20c2a): frames from
   * `getVideoPlaybackQuality` or Chromium's own counters, bytes from Chromium's only. The element
   * names no codec and declares no bitrate.
   */
  stats(): EngineStats {
    const video = this.video;
    const quality = video.getVideoPlaybackQuality === undefined ? null : video.getVideoPlaybackQuality();
    const total = quality === null ? undefined : quality.totalVideoFrames;
    const videoBytes = counter(video.webkitVideoDecodedByteCount);
    const audioBytes = counter(video.webkitAudioDecodedByteCount);
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      bitrate: null,
      droppedFrames: counter(quality === null ? video.webkitDroppedFrameCount : quality.droppedVideoFrames),
      decodedFrames: counter(total === undefined ? video.webkitDecodedFrameCount : total),
      decodedBytes: videoBytes === null && audioBytes === null ? null : (videoBytes ?? 0) + (audioBytes ?? 0),
      videoCodec: '',
      audioCodec: '',
      audioChannels: null,
    };
  }

  suspend(): void {
    const l = this.cur;
    if (l === null || l.failed || l.suspended) return;
    l.suspended = true;
    if (!l.source.live) {
      const at = this.video.currentTime * 1000;
      if (at > 0) l.startMs = at;
    }
    this.stopPoll();
    l.playingAt = null;
    l.framed = false;
    l.waiting = false;
    this.close();
  }

  resume(): void {
    const l = this.cur;
    if (l === null || !l.suspended) return;
    l.suspended = false;
    this.open(l);
  }

  on(cb: (e: EngineEvent & { readonly token: number }) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  destroy(): void {
    void this.stop();
    this.destroyed = true;
    for (const [type, handler] of this.handlers) this.video.removeEventListener(type, handler);
    const audio = this.video.audioTracks;
    if (audio !== undefined && audio.removeEventListener !== undefined) {
      audio.removeEventListener('addtrack', this.onTracks);
      audio.removeEventListener('removetrack', this.onTracks);
      audio.removeEventListener('change', this.onTracks);
    }
    this.listeners = [];
  }

  /** Points the element at the load's URL and starts it. */
  private open(l: Load): void {
    this.loaded = true;
    this.video.src = l.source.url;
    this.startPlayback();
  }

  private startPlayback(): void {
    const started = this.video.play();
    if (started === undefined) return;
    started.then(undefined, (reason: unknown) => {
      // A desktop browser refuses sound before a key press (a page a test opened): play muted then.
      if ((reason as { name?: unknown } | null)?.name !== 'NotAllowedError' || this.video.muted) return;
      this.video.muted = true;
      const again = this.video.play();
      if (again !== undefined) again.then(undefined, () => undefined);
    });
  }

  /** Forgets the current load: its events no longer count, and a pending `load()` rejects. */
  private drop(): void {
    const l = this.cur;
    this.cur = null;
    this.stopPoll();
    if (l !== null && l.settle !== null) {
      const settle = l.settle;
      l.settle = null;
      settle.reject(ABORTED);
    }
  }

  /** Pauses, drops the source and loads nothing, which closes the connection. */
  private close(): void {
    if (!this.loaded) return;
    this.loaded = false;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }

  private onMetadata(): void {
    const l = this.cur;
    if (l === null) return;
    if (l.startMs !== null) {
      this.video.currentTime = l.startMs / 1000;
      l.startMs = null;
    }
    this.emit({ type: 'tracks', token: l.token });
  }

  private onPlaying(): void {
    const l = this.cur;
    if (l === null || l.failed) return;
    if (l.playingAt === null) {
      l.playingAt = this.video.currentTime;
      const settle = l.settle;
      l.settle = null;
      if (settle !== null) settle.resolve();
      this.schedulePoll(l);
      return;
    }
    if (!l.waiting) return;
    l.waiting = false;
    this.emit({ type: 'playing', token: l.token });
  }

  private onWaiting(): void {
    const l = this.cur;
    if (l === null || !l.framed || l.waiting) return;
    l.waiting = true;
    this.emit({ type: 'buffering', token: l.token });
  }

  private onEnded(): void {
    const l = this.cur;
    if (l === null || l.failed) return;
    this.emit({ type: 'ended', token: l.token });
  }

  private onError(): void {
    const l = this.cur;
    const error = this.video.error;
    if (l === null || l.failed || error === null) return;
    const mime = CONTAINER_MIME[l.source.container];
    this.fail(l, mediaError(error.code, mime === undefined ? null : this.video.canPlayType(mime)));
  }

  /** The load failed: its `load()` rejects, or (once it resolved) an `error` event says so. */
  private fail(l: Load, error: PlaybackError): void {
    l.failed = true;
    this.stopPoll();
    const settle = l.settle;
    l.settle = null;
    if (settle !== null) settle.reject(error);
    else this.emit({ type: 'error', error, token: l.token });
  }

  private schedulePoll(l: Load): void {
    this.pollTimer = this.clock.setTimeout(() => this.poll(l), this.framePollMs);
  }

  private stopPoll(): void {
    this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** Looks for the first frame: a picture size and a clock that moved since `playing`. */
  private poll(l: Load): void {
    this.pollTimer = null;
    const playingAt = l.playingAt as number;
    const t = this.video.currentTime;
    if (t !== playingAt) {
      if (this.video.videoWidth > 0) {
        l.framed = true;
        this.emit({ type: 'firstFrame', token: l.token });
        return;
      }
      if (Math.round((t - playingAt) * 1000) >= this.noPictureMs) {
        this.fail(l, { kind: 'unsupported', code: 'NO_PICTURE' });
        return;
      }
    }
    this.schedulePoll(l);
  }

  private emit(e: EngineEvent & { readonly token: number }): void {
    for (const listener of this.listeners.slice()) listener(e);
  }
}

/** A counter the element has, or `null`. */
function counter(value: number | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * The app's one `<video>` element, filling `stage` (the app's player layer), for an
 * `Html5Engine`. `setRect` moves it later.
 */
export function createStageVideo(stage: HTMLElement): HTMLVideoElement {
  const video = stage.ownerDocument.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('data-testid', 'player-video');
  const style = video.style;
  style.position = 'absolute';
  style.left = '0';
  style.top = '0';
  style.width = '100%';
  style.height = '100%';
  style.objectFit = 'contain';
  style.backgroundColor = '#000';
  stage.appendChild(video);
  return video;
}
