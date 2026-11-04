/**
 * The playback harness's API (RELAY step 18): what `playback-main.ts` puts on
 * `window.__ZOMA_PLAYBACK__` for the desktop playback e2e (e2e/playback*.spec.ts). Types only, so
 * the e2e code (root tsc, no JSX) can import them.
 */
import type { Container, EngineStats, ExternalSub, PlaybackFailure, PlayerState, PlayerTrack, PlayMode, SubtitleView, Track } from '@zoma/player';

export interface PlaybackInput {
  /** A catalog stream URL: the URLs to try come from `streamCandidates` (Xtream live: `.ts`, then `.m3u8`). */
  readonly url?: string;
  /** Or the URLs to try, in order. */
  readonly candidates?: ReadonlyArray<{ readonly url: string; readonly container: Container }>;
  readonly mode: PlayMode;
  /** The source id the URL strategy is remembered by (default `mock`). */
  readonly src?: string;
  readonly startMs?: number;
  /** Subtitle files beside the stream (step 20b2b), fetched by the app's loader when chosen. */
  readonly externalSubs?: readonly ExternalSub[];
}

export interface PlaybackSnapshot {
  readonly state: PlayerState;
  readonly session: number;
  readonly container: Container | null;
  readonly attempt: number;
  readonly failure: PlaybackFailure | null;
  readonly positionMs: number;
  /** Every status the controller reported (`state container`), but those that only brought new track lists. */
  readonly history: readonly string[];
  /** The engine: `load <token> <container>`, `loaded <token>`, `rejected <token> <kind>/<code>`, and its events (`firstFrame <token>`). */
  readonly trace: readonly string[];
  readonly tracks: { readonly audio: readonly Track[]; readonly text: readonly Track[] };
  readonly stats: EngineStats;
  /** The kinds of the engines the platform built, best first. */
  readonly engines: readonly string[];
  readonly trackSwitch: string;
  /** The controller's subtitle list: the stream's own, then the files (`ext:n`). */
  readonly textTracks: readonly PlayerTrack[];
  /** What the overlay draws. */
  readonly subtitles: SubtitleView;
}

export interface PlaybackHarness {
  play(input: PlaybackInput): void;
  stop(): Promise<void>;
  snapshot(): PlaybackSnapshot;
  selectAudio(id: string): Promise<boolean>;
  /** The controller's subtitle choice (`ext:n`: a file), as the track menu makes it. */
  selectText(id: string | null): Promise<boolean>;
  setSubtitleDelay(ms: number): void;
  /** The overlay's size. */
  setSubtitleSize(size: 's' | 'm' | 'l'): void;
  /** The engine's `<video>` element's answer. */
  canPlayType(mime: string): string;
}

export interface PlaybackTarget {
  __ZOMA_PLAYBACK__?: PlaybackHarness;
}
