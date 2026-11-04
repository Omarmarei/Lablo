/**
 * What the lab's player batteries (RELAY step 15c, docs/architecture.md §5 S4 and S5) ask of a
 * player. The battery's checks are written once against `LabPlayer`; the `<video>` element
 * (webOS, the desktop and Tizen's HLS fallback: `video-player.ts`) and AVPlay (Tizen, step 15c2)
 * each implement it. This is a lab tool, not the app's `PlayerEngine` (steps 17–19): it reports
 * what an engine does, and the engines are written from its answers.
 */

/** A track as the engine lists it. */
export interface LabTrack {
  /** Its place in the engine's list. */
  readonly index: number;
  readonly id: string;
  /** As the engine gives it: `ara`, `en`, or '' when it gives none. */
  readonly lang: string;
  readonly label: string;
  readonly kind: string;
  readonly selected: boolean;
}

export interface PlayerError {
  /** The engine's code (`MediaError.code`), or null. */
  readonly code: number | null;
  readonly message: string;
  /** The engine says it can't play this format or codec. */
  readonly unsupported: boolean;
}

/** What the player shows at one moment. */
export interface PlayerSnapshot {
  /** Media time in ms. */
  readonly positionMs: number;
  readonly width: number;
  readonly height: number;
  /** Video frames decoded since the open, or null where the engine doesn't count them. */
  readonly frames: number | null;
  readonly paused: boolean;
  /** Muted by the lab, because the engine refused to play with sound before a key press (a desktop browser). */
  readonly muted: boolean;
  /** The engine's own state, for the record (`ready 4, network 2`). */
  readonly state: string;
  readonly error: PlayerError | null;
}

export type LabPlayerEvent =
  /** This open's first frame is on the screen. */
  | { readonly type: 'frame' }
  | { readonly type: 'waiting' }
  | { readonly type: 'error'; readonly error: PlayerError }
  | { readonly type: 'ended' }
  /** The engine started the stream again on its own (not after `open`). */
  | { readonly type: 'restart' }
  /** A subtitle cue of the shown text track. */
  | { readonly type: 'cue'; readonly track: number; readonly text: string };

export interface OpenOptions {
  /** A live stream: `resume` reopens it at the live edge, not at the position it was hidden at. */
  readonly live: boolean;
  /** A VOD file from this position. */
  readonly startMs?: number;
}

/**
 * A platform's own way to choose a track by its place in the stream, beside the engine's track
 * list (webOS: luna `com.webos.media/selectTrack` with the element's `mediaId`, RELAY step 15c2).
 */
export interface TrackService {
  /** For the record: `luna`. */
  readonly name: string;
  /** Resolves a few words from the service when it took the call; rejects with why not. */
  selectAudio(index: number): Promise<string>;
}

export interface LabPlayer {
  readonly kind: 'video' | 'avplay';
  /** Facts about the engine for the record: the formats it says it plays, the APIs it has. */
  describe(): Readonly<Record<string, unknown>>;
  /** The engine's own guess for a MIME type (`canPlayType`: '', 'maybe', 'probably'), or null where it has none (AVPlay). */
  canPlay(mime: string): string | null;
  /** Plays `url`, closing whatever was open first. */
  open(url: string, options: OpenOptions): void;
  snapshot(): PlayerSnapshot;
  on(listener: (event: LabPlayerEvent) => void): () => void;
  /** The audio tracks, or null when the engine has no API for them. */
  audioTracks(): readonly LabTrack[] | null;
  /** Selects audio track `index` alone; false when the engine refused or has no such track. */
  selectAudio(index: number): boolean;
  /** The platform's second route to the audio tracks, or null where it has none (not webOS, or no `mediaId` yet). */
  audioService(): TrackService | null;
  /** The in-band text tracks, or null when the engine has no API for them. */
  textTracks(): readonly LabTrack[] | null;
  /** Shows text track `index` and reports its cues as `cue` events; null shows none. */
  showText(index: number | null): boolean;
  /** The app left the screen (Home): what the app's engine would do there (webOS: stop; AVPlay: suspend). */
  suspend(): void;
  /** Back on the screen: live at the live edge, VOD where it was. */
  resume(): void;
  /** A line under the picture for the person watching. */
  caption(text: string): void;
  /** Closes the stream and its connection (a provider may allow only one). */
  stop(): void;
  /** Stops and takes the picture off the screen. */
  dispose(): void;
}
