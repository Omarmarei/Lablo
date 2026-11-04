import { normalizeLang } from '@zoma/core';
import type { Platform } from '@zoma/platform-api';
import type { SubtitleCue } from '@zoma/core';
import type { AccountStatus, Clock, ControllerOptions, ExternalSub, SourceMemory, TrackMemory, TrackPreferences } from '@zoma/player';
import { PlayerController } from '@zoma/player';
import { createSubtitleLoader } from './subtitle-loader';

/**
 * The app's one `PlayerController` (RELAY step 20a, ADR-008), made on the first play so that a
 * start that never plays builds no stage and no engine:
 * - the stage (`stage()`, the layer under the page) and the platform's engines on it
 *   (`Platform.createEngines`, called once; the best engine plays: Tizen's is AVPlay with the
 *   `<video>` as its HLS fallback);
 * - `resolveUrl`: the platform's redirect probe, where it has one (Tizen);
 * - `screenSaver`: `Platform.setScreenSaver` (a TV that refuses it changes nothing);
 * - `online` and `checkAccount` (the error card's facts) from the app;
 * - the lifecycle: `hidden` and `visible` go to the controller's `hide` and `show`;
 * - `preferences` (step 20b): the track languages to prefer, read when a stream's tracks appear;
 * - `loadSubtitles` (step 20b2b): a request's subtitle files, fetched and parsed by the app
 *   (`subtitle-loader.ts`);
 * - `memory` and `trackMemory` (step 20c1): the profile's, through `player-memory.ts`.
 */
export interface AppPlayerDeps {
  readonly platform: Pick<Platform, 'id' | 'createEngines' | 'resolveUrl' | 'setScreenSaver' | 'onLifecycle'>;
  /** The player's layer (made on the first call). */
  readonly stage: () => HTMLElement;
  /** Re-checks a source's account after a provider failure (the query worker's `account`). */
  readonly checkAccount: (src: string) => Promise<AccountStatus | null>;
  /** Whether the TV is online (the app passes `navigator.onLine`). */
  readonly online: () => boolean;
  /** The audio and subtitle languages to prefer (`uiTrackPreferences` of the UI's language). */
  readonly preferences?: () => TrackPreferences;
  /** Fetches and parses a subtitle file (default: `createSubtitleLoader()`). */
  readonly loadSubtitles?: (sub: ExternalSub) => Promise<readonly SubtitleCue[]>;
  /** The container that played per source (the profile's; default: for the app's run). */
  readonly memory?: SourceMemory;
  /** Each content's track choice and timing (the profile's; default: for the app's run). */
  readonly trackMemory?: TrackMemory;
  /** Tests pin the clock. */
  readonly clock?: Clock;
}

/**
 * The track languages for a UI language tag (RELAY step 20b): sound in the UI's language, then the
 * other one the app speaks (Arabic and English); no subtitles until the user turns them on (the
 * settings screen sets the lists later).
 */
export function uiTrackPreferences(tag: string): TrackPreferences {
  const ui = normalizeLang(tag);
  if (ui === '') return { audio: [], text: [] };
  return { audio: ui === 'ar' ? ['ar', 'en'] : ui === 'en' ? ['en', 'ar'] : [ui, 'en', 'ar'], text: [] };
}

export function appPlayer(deps: AppPlayerDeps): () => PlayerController {
  let made: PlayerController | null = null;
  return () => {
    if (made !== null) return made;
    const { platform } = deps;
    const engine = platform.createEngines(deps.stage())[0];
    if (engine === undefined) throw new Error(`The ${platform.id} platform built no playback engine`);
    const options: ControllerOptions = {
      online: deps.online,
      checkAccount: deps.checkAccount,
      loadSubtitles: deps.loadSubtitles ?? createSubtitleLoader(),
      ...(deps.preferences === undefined ? {} : { preferences: deps.preferences }),
      ...(deps.memory === undefined ? {} : { memory: deps.memory }),
      ...(deps.trackMemory === undefined ? {} : { trackMemory: deps.trackMemory }),
      screenSaver: (allowed) => {
        platform.setScreenSaver(allowed).catch((error: unknown) => console.warn('The screensaver setting was refused', error));
      },
    };
    const timed: ControllerOptions = deps.clock === undefined ? options : { ...options, clock: deps.clock };
    const controller = new PlayerController(engine, platform.resolveUrl === undefined ? timed : { ...timed, resolveUrl: platform.resolveUrl });
    platform.onLifecycle((event) => {
      if (event === 'hidden') controller.hide();
      else if (event === 'visible') controller.show();
    });
    made = controller;
    return controller;
  };
}
