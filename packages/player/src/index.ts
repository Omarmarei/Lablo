/**
 * @zoma/player: PlayerController, PlayerEngine interface, Html5Engine, watchdog, error classifier, subtitle parsing.
 *
 * Allowed imports are listed in CLAUDE.md ("Package boundaries") and enforced by
 * eslint-plugin-boundaries: `core` only (ADR-008). Html5Engine (step 18) and FallbackEngine
 * (step 19) are here; AvplayEngine is in platform-tizen. The platform adapters construct the engines.
 */
export type { Clock } from './clock';
export { SYSTEM_CLOCK } from './clock';

export type {
  Container,
  EngineCaps,
  EngineEvent,
  EngineSource,
  EngineStats,
  LoadOptions,
  PlaybackError,
  PlaybackErrorKind,
  PlayerEngine,
  PlayMode,
  Rect,
  Track,
} from './engine';
export { PLAYBACK_ERROR_KINDS, isPlaybackError } from './engine';

export type { PlayCandidate, PlayRequest, SourceMemory } from './request';
export { MemorySourceMemory, containerOf, orderCandidates, streamCandidates } from './request';

export type { PlayerTrack, PlayerTracks, TrackChoice, TrackMemory, TrackPick, TrackPreferences } from './tracks';
export { MemoryTrackMemory, NO_PREFERENCES, NO_TRACKS, findPick, playerTracks, preferredTrack, trackPick } from './tracks';

export type { AccountStatus, FailureCategory, FailureFacts, PlaybackFailure } from './failure';
export { classifyFailure, isDefinitive, wantsAccountCheck } from './failure';

export type { LadderOptions, RetryPlan, Rung, WatchdogConfig } from './ladder';
export { DEFAULT_WATCHDOG, RetryLadder } from './ladder';

export type { ControllerOptions, PlayOptions, PlayerState, PlayerStatus } from './controller';
export { PlayerController } from './controller';

export type { AudioTrackLike, AudioTrackListLike, Html5EngineOptions, MediaElementLike, TextTrackLike, TrackListLike } from './html5-engine';
export { CONTAINER_MIME, FRAME_POLL_MS, Html5Engine, NO_PICTURE_MS, createStageVideo, mediaError } from './html5-engine';

export type { FallbackOptions } from './fallback-engine';
export { FallbackEngine, hlsRefused } from './fallback-engine';
