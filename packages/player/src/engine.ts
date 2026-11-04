/**
 * The contract every playback engine implements (architecture.md §2): `Html5Engine` (webOS, the
 * desktop, Tizen's HLS fallback; RELAY step 18) and `AvplayEngine` (Tizen, step 19). Platform
 * adapters construct the engines and `apps/tv` hands them to `PlayerController` (ADR-008).
 *
 * An engine plays one source at a time and knows nothing about retries, URL choices or
 * channels: the controller decides those. Every `load` carries a token, and every event the
 * engine emits carries the token of the load it belongs to, so the controller can drop events
 * from a load it has already left (fast zapping).
 */

/** How a stream is packaged, as far as the URL tells. */
export type Container = 'ts' | 'hls' | 'mp4' | 'mkv' | 'other';

/** Live channel, a VOD file (movie or episode), or a catch-up recording. */
export type PlayMode = 'live' | 'vod' | 'catchup';

/** One URL the engine is asked to play. */
export interface EngineSource {
  /** Holds credentials: never log it, never send it anywhere but the provider. */
  readonly url: string;
  readonly container: Container;
  /** A live stream (no duration, no seeking, a reopen goes to the live edge). */
  readonly live: boolean;
}

/**
 * What went wrong, sorted by the engine into a kind the error classifier understands. The
 * controller's watchdog produces `timeout` and `stall` errors itself.
 */
export type PlaybackErrorKind =
  /** The connection failed or broke (no HTTP status known). */
  | 'network'
  /** The server answered with an error status (`status`), e.g. from a redirect probe. */
  | 'http'
  /** Nothing played within the open timeout. */
  | 'timeout'
  /** Playback stopped moving, buffered too long, or a live stream ended. */
  | 'stall'
  /**
   * The TV can't play this format or codec. Only when the engine is sure: HTML5's
   * `MEDIA_ERR_SRC_NOT_SUPPORTED` also covers HTTP errors, and this kind is never retried on
   * the same URL (`isDefinitive`).
   */
  | 'unsupported'
  /** The data arrived but couldn't be decoded (a broken stream). */
  | 'decode'
  /** A bug or an unexpected engine state. */
  | 'app';

export interface PlaybackError {
  readonly kind: PlaybackErrorKind;
  /**
   * The engine's or watchdog's own code, for the diagnostic code and telemetry
   * (`MEDIA_ERR_NETWORK`, `PLAYER_ERROR_CONNECTION_FAILED`, `FROZEN`). Never a URL.
   */
  readonly code: string;
  /** The HTTP status, for `http`. */
  readonly status?: number;
}

/** A value is a `PlaybackError` (engines and probes reject with one). */
export function isPlaybackError(value: unknown): value is PlaybackError {
  if (value === null || typeof value !== 'object') return false;
  const v = value as { kind?: unknown; code?: unknown };
  return typeof v.kind === 'string' && PLAYBACK_ERROR_KINDS.indexOf(v.kind as PlaybackErrorKind) !== -1 && typeof v.code === 'string';
}

export const PLAYBACK_ERROR_KINDS: readonly PlaybackErrorKind[] = ['network', 'http', 'timeout', 'stall', 'unsupported', 'decode', 'app'];

/** What an engine reports while it plays. */
export type EngineEvent =
  /** The first frame of this load is on the screen (or, audio-only, the clock started). */
  | { readonly type: 'firstFrame' }
  /** Playback is waiting for data. */
  | { readonly type: 'buffering' }
  /** Playback moves again after `buffering`. */
  | { readonly type: 'playing' }
  /** The end of a VOD file or recording; on a live stream it means the stream closed. */
  | { readonly type: 'ended' }
  /** The audio or text track list changed. */
  | { readonly type: 'tracks' }
  /**
   * An embedded subtitle's text, for the app's overlay to draw for `durationMs`, from engines
   * that deliver it (`caps.deliversSubtitleText`: AVPlay's `onsubtitlechange`) while a text
   * track is selected.
   */
  | { readonly type: 'cue'; readonly text: string; readonly durationMs: number }
  /** Playback failed; the load is over. */
  | { readonly type: 'error'; readonly error: PlaybackError };

export interface Track {
  readonly id: string;
  /** As the stream names it (`ara`, `en`, ''); the controller normalizes it. */
  readonly lang: string;
  readonly label: string;
  readonly selected: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What an engine says about the stream it plays (the stream info, RELAY step 20c2a). Each engine
 * says what it can: the `<video>` counts frames and bytes (the app measures the frame rate and
 * bitrate between two readings), AVPlay names the codecs and declares a bitrate.
 */
export interface EngineStats {
  /** Picture size; 0 before the first frame or for audio-only streams. */
  readonly width: number;
  readonly height: number;
  /** The bitrate the stream declares (AVPlay's `Bit_rate`), in bits per second; `null` when the engine doesn't say. */
  readonly bitrate: number | null;
  readonly droppedFrames: number | null;
  /** Video frames decoded since this load began; `null` where the engine doesn't count them (AVPlay). */
  readonly decodedFrames: number | null;
  /** Media bytes (video and audio) decoded since this load began; `null` where the engine doesn't count them. */
  readonly decodedBytes: number | null;
  /** The codecs as the engine names them (AVPlay's `fourCC`: `H264`, `HEVC`, `AAC`); '' when it doesn't say (the `<video>`). */
  readonly videoCodec: string;
  readonly audioCodec: string;
  /** The audio's channels (2, 6); `null` when the engine doesn't say. */
  readonly audioChannels: number | null;
}

/** The stats of an engine with nothing to say (nothing playing yet). */
export const NO_STATS: EngineStats = {
  width: 0,
  height: 0,
  bitrate: null,
  droppedFrames: null,
  decodedFrames: null,
  decodedBytes: null,
  videoCodec: '',
  audioCodec: '',
  audioChannels: null,
};

export interface EngineCaps {
  readonly maxHeight: number;
  readonly trackSwitch: 'reliable' | 'unreliable' | 'none';
  /** Embedded subtitles arrive as text the app draws (AVPlay), not drawn by the TV itself. */
  readonly deliversSubtitleText: boolean;
  readonly preloadSlots: number;
  readonly rates: readonly number[];
}

export interface LoadOptions {
  /** A VOD or catch-up position to start from, in ms. */
  readonly startMs?: number;
}

export interface PlayerEngine {
  readonly kind: 'avplay' | 'html5' | 'mse';
  readonly caps: EngineCaps;
  /**
   * Opens `source` and starts playing it. Resolves once the engine has taken the source and
   * started playback; rejects with a `PlaybackError` when the source can't be opened. Later
   * problems arrive as `error` events. The controller always awaits `stop()` first.
   */
  load(source: EngineSource, token: number, opts?: LoadOptions): Promise<void>;
  play(): void;
  pause(): void;
  seek(ms: number): Promise<void>;
  /**
   * Stops playback and closes the network connection (providers often allow one connection).
   * A pending `load` settles. Safe to call when nothing is loaded.
   */
  stop(): Promise<void>;
  /** AVPlay `setDisplayRect`, or CSS on the single `<video>`. */
  setRect(r: Rect | 'full'): void;
  getTracks(): { audio: Track[]; text: Track[] };
  selectAudio(id: string): Promise<boolean>;
  selectText(id: string | null): Promise<boolean>;
  /** Media time in ms (live: time since the stream's start, for progress checks only). */
  positionMs(): number;
  stats(): EngineStats;
  /** Tizen app hide/show (AVPlay suspend/restore). */
  suspend(): void;
  resume(): void;
  /** Registers the event listener; returns its removal. */
  on(cb: (e: EngineEvent & { readonly token: number }) => void): () => void;
  destroy(): void;
}
