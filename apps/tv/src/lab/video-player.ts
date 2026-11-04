/**
 * The battery's `<video>` player (RELAY step 15c, S5): one element shown in a box over the lab,
 * with a caption for the person watching. webOS plays everything through it, Tizen falls back to
 * it for HLS, and the desktop is the dev loop (docs/architecture.md §2).
 *
 * The first frame is the first moment the element has a picture size and its clock has moved
 * since `playing` (checked every 50 ms), so a stream that only plays sound (a codec the engine
 * can't decode) never counts as playing.
 */
import { AC3_MIME, CONTAINER_MIME, EAC3_MIME, HEVC_MIME } from './media';
import type { LabPlayer, LabPlayerEvent, LabTrack, OpenOptions, PlayerError, PlayerSnapshot } from './player';

/** The engine's guesses the battery records (`describe`). */
const DESCRIBED = [
  CONTAINER_MIME.ts,
  'video/mp2t; codecs="avc1.4D401F, mp4a.40.2"',
  CONTAINER_MIME.hls,
  'application/x-mpegURL',
  'video/mp4; codecs="avc1.640028, mp4a.40.2"',
  HEVC_MIME,
  'video/mp4; codecs="hev1.1.6.L150.B0"',
  CONTAINER_MIME.mkv,
  'video/webm; codecs="vp9, opus"',
  AC3_MIME,
  EAC3_MIME,
  'audio/mpeg',
];

/** Every 50 ms until this open's first frame. */
export const FRAME_POLL_MS = 50;

/** `MediaError.code` 4: the format or codec isn't supported. */
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
const MEDIA_ERRORS = ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'];

/** `audioTracks` isn't in TypeScript's DOM library (Chromium has it behind a flag; webOS ships it). */
interface AudioTrackLike {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly language: string;
  enabled: boolean;
}
interface TrackListLike<T> {
  readonly length: number;
  readonly [index: number]: T | undefined;
}

/** What the player reads and calls on its element (an `HTMLVideoElement`; tests pass a fake). */
export type VideoLike = Pick<
  HTMLVideoElement,
  | 'addEventListener'
  | 'removeEventListener'
  | 'removeAttribute'
  | 'load'
  | 'play'
  | 'pause'
  | 'canPlayType'
  | 'currentTime'
  | 'paused'
  | 'readyState'
  | 'networkState'
  | 'videoWidth'
  | 'videoHeight'
  | 'error'
  | 'muted'
  | 'textTracks'
> & {
  src: string;
  readonly audioTracks?: TrackListLike<AudioTrackLike>;
  readonly webkitDecodedFrameCount?: number;
  getVideoPlaybackQuality?(): { readonly totalVideoFrames: number };
};

/** The box the picture sits in. */
export interface VideoStage {
  caption(text: string): void;
  remove(): void;
}

export interface VideoTimers {
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface VideoEnv {
  readonly timers: VideoTimers;
  /** `window.MediaSource`, for the record. */
  readonly mediaSource: { isTypeSupported?(type: string): boolean } | null;
}

const PAGE_ENV = (): VideoEnv => ({
  timers: { setInterval: (handler, ms) => window.setInterval(handler, ms), clearInterval: (id) => window.clearInterval(id) },
  mediaSource: typeof MediaSource === 'undefined' ? null : MediaSource,
});

function framesOf(video: VideoLike): number | null {
  if (typeof video.getVideoPlaybackQuality === 'function') return video.getVideoPlaybackQuality().totalVideoFrames;
  return typeof video.webkitDecodedFrameCount === 'number' ? video.webkitDecodedFrameCount : null;
}

function errorOf(video: VideoLike): PlayerError | null {
  const error = video.error;
  if (error === null) return null;
  const name = MEDIA_ERRORS[error.code] ?? `code ${error.code}`;
  return { code: error.code, message: error.message === '' ? name : `${name}: ${error.message}`, unsupported: error.code === MEDIA_ERR_SRC_NOT_SUPPORTED };
}

/** The element's text of a cue (`VTTCue.text`; TypeScript's `TextTrackCue` has none). */
function cueText(cue: TextTrackCue | undefined): string {
  const text = (cue as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

export function createVideoPlayer(video: VideoLike, stage: VideoStage, env: VideoEnv = PAGE_ENV()): LabPlayer {
  const listeners: Array<(event: LabPlayerEvent) => void> = [];
  const emit = (event: LabPlayerEvent): void => {
    for (const listener of listeners.slice()) listener(event);
  };
  let opened: { readonly url: string; readonly options: OpenOptions } | null = null;
  // This open: whether `playing` came (and the clock then), its first frame, its loads.
  let playingAt: number | null = null;
  let framed = false;
  let loads = 0;
  let pendingStartMs: number | null = null;
  let resumeAtMs: number | undefined;
  let muted = false;
  let timer: number | null = null;
  let shown: { readonly track: TextTrack; readonly index: number; readonly onChange: () => void } | null = null;

  const stopPolling = (): void => {
    if (timer !== null) env.timers.clearInterval(timer);
    timer = null;
  };
  const poll = (): void => {
    if (framed || playingAt === null) return;
    if (video.videoWidth > 0 && video.currentTime !== playingAt) {
      framed = true;
      stopPolling();
      emit({ type: 'frame' });
    }
  };

  const onLoadStart = (): void => {
    loads += 1;
    if (loads > 1 && framed) emit({ type: 'restart' });
  };
  const onMetadata = (): void => {
    if (pendingStartMs === null) return;
    video.currentTime = pendingStartMs / 1000;
    pendingStartMs = null;
  };
  const onPlaying = (): void => {
    if (playingAt === null) playingAt = video.currentTime;
  };
  const onWaiting = (): void => emit({ type: 'waiting' });
  const onEnded = (): void => emit({ type: 'ended' });
  const onError = (): void => {
    const error = errorOf(video);
    if (opened !== null && error !== null) emit({ type: 'error', error });
  };
  const events: Array<[string, () => void]> = [
    ['loadstart', onLoadStart],
    ['loadedmetadata', onMetadata],
    ['playing', onPlaying],
    ['waiting', onWaiting],
    ['ended', onEnded],
    ['error', onError],
  ];
  for (const [name, handler] of events) video.addEventListener(name, handler);

  const hideText = (): void => {
    if (shown === null) return;
    shown.track.removeEventListener('cuechange', shown.onChange);
    shown = null;
  };

  /** Pauses, drops the source and loads nothing, which closes the connection. */
  const close = (): void => {
    stopPolling();
    hideText();
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  const play = (): void => {
    const started = video.play() as Promise<void> | undefined;
    if (started === undefined || typeof started.then !== 'function') return;
    started.then(undefined, (error: unknown) => {
      // A desktop browser refuses sound before a key press (a run at launch): play muted then.
      if ((error as { name?: string } | null)?.name !== 'NotAllowedError' || video.muted) return;
      video.muted = true;
      muted = true;
      void (video.play() as Promise<void> | undefined)?.then(undefined, () => undefined);
    });
  };

  const open = (url: string, options: OpenOptions): void => {
    close();
    opened = { url, options };
    playingAt = null;
    framed = false;
    loads = 0;
    pendingStartMs = options.startMs !== undefined && options.startMs > 0 ? options.startMs : null;
    video.src = url;
    play();
    timer = env.timers.setInterval(poll, FRAME_POLL_MS);
  };

  const trackOf = (index: number, id: string, lang: string, label: string, kind: string, selected: boolean): LabTrack => ({ index, id, lang, label, kind, selected });

  return {
    kind: 'video',
    describe: () => {
      const canPlayType: Record<string, string> = {};
      for (const mime of DESCRIBED) canPlayType[mime] = video.canPlayType(mime);
      const mse = env.mediaSource;
      return {
        canPlayType,
        apis: {
          audioTracks: video.audioTracks !== undefined,
          textTracks: video.textTracks !== undefined,
          getVideoPlaybackQuality: typeof video.getVideoPlaybackQuality === 'function',
          webkitDecodedFrameCount: typeof video.webkitDecodedFrameCount === 'number',
          MediaSource: mse !== null,
        },
        mse:
          mse === null || typeof mse.isTypeSupported !== 'function'
            ? null
            : { h264: mse.isTypeSupported('video/mp4; codecs="avc1.640028"'), hevc: mse.isTypeSupported(HEVC_MIME), ac3: mse.isTypeSupported(AC3_MIME) },
      };
    },
    canPlay: (mime) => video.canPlayType(mime),
    open,
    snapshot: (): PlayerSnapshot => ({
      positionMs: Math.round(video.currentTime * 1000),
      width: video.videoWidth,
      height: video.videoHeight,
      frames: framesOf(video),
      paused: video.paused,
      muted,
      state: `ready ${video.readyState}, network ${video.networkState}`,
      error: errorOf(video),
    }),
    on: (listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at !== -1) listeners.splice(at, 1);
      };
    },
    audioTracks: () => {
      const list = video.audioTracks;
      if (list === undefined) return null;
      const tracks: LabTrack[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const t = list[i];
        if (t !== undefined) tracks.push(trackOf(i, t.id, t.language, t.label, t.kind, t.enabled));
      }
      return tracks;
    },
    selectAudio: (index) => {
      const list = video.audioTracks;
      // The new one first, so the element is never left without sound.
      const chosen = list === undefined ? undefined : list[index];
      if (list === undefined || chosen === undefined) return false;
      chosen.enabled = true;
      for (let i = 0; i < list.length; i += 1) {
        const t = list[i];
        if (i !== index && t !== undefined) t.enabled = false;
      }
      return true;
    },
    textTracks: () => {
      const list = video.textTracks as TextTrackList | undefined;
      if (list === undefined) return null;
      const tracks: LabTrack[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const t = list[i];
        if (t !== undefined) tracks.push(trackOf(i, t.id, t.language, t.label, t.kind, t.mode === 'showing'));
      }
      return tracks;
    },
    showText: (index) => {
      hideText();
      const list = video.textTracks as TextTrackList | undefined;
      if (list === undefined) return false;
      let found: TextTrack | null = null;
      for (let i = 0; i < list.length; i += 1) {
        const t = list[i];
        if (t === undefined) continue;
        t.mode = i === index ? 'showing' : 'disabled';
        if (i === index) found = t;
      }
      if (found === null) return index === null;
      const track = found;
      const onChange = (): void => {
        const cues = track.activeCues;
        const text = cues !== null && cues.length > 0 ? cueText(cues[0]) : '';
        if (text !== '' && index !== null) emit({ type: 'cue', track: index, text });
      };
      track.addEventListener('cuechange', onChange);
      shown = { track, index: index as number, onChange };
      return true;
    },
    suspend: () => {
      if (opened === null) return;
      resumeAtMs = opened.options.live ? undefined : Math.round(video.currentTime * 1000);
      close();
    },
    resume: () => {
      if (opened === null) return;
      open(opened.url, { live: opened.options.live, startMs: resumeAtMs });
    },
    caption: (text) => stage.caption(text),
    stop: () => {
      close();
      opened = null;
    },
    dispose: () => {
      close();
      opened = null;
      for (const [name, handler] of events) video.removeEventListener(name, handler);
      stage.remove();
    },
  };
}

/** The battery's picture: a box over the lab with the element and a caption, until `remove`. */
export function mountVideoStage(doc: Document): { readonly video: HTMLVideoElement; readonly stage: VideoStage } {
  const box = doc.createElement('div');
  box.className = 'lab__player';
  box.setAttribute('data-testid', 'lab-player');
  const video = doc.createElement('video');
  video.className = 'lab__video';
  video.setAttribute('playsinline', '');
  const caption = doc.createElement('p');
  caption.className = 'lab__player-caption';
  caption.setAttribute('data-testid', 'lab-player-caption');
  box.appendChild(video);
  box.appendChild(caption);
  doc.body.appendChild(box);
  return {
    video,
    stage: {
      caption: (text) => {
        caption.textContent = text;
      },
      remove: () => {
        if (box.parentNode !== null) box.parentNode.removeChild(box);
      },
    },
  };
}

/** A `<video>` player on this page. */
export function pageVideoPlayer(): LabPlayer {
  const { video, stage } = mountVideoStage(document);
  return createVideoPlayer(video as VideoLike, stage);
}
