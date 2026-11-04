import type { Platform } from '@zoma/platform-api';
import type { AccountStatus, Clock, ControllerOptions } from '@zoma/player';
import { PlayerController } from '@zoma/player';

/**
 * The app's one `PlayerController` (RELAY step 20a, ADR-008), made on the first play so that a
 * start that never plays builds no stage and no engine:
 * - the stage (`stage()`, the layer under the page) and the platform's engines on it
 *   (`Platform.createEngines`, called once; the best engine plays: Tizen's is AVPlay with the
 *   `<video>` as its HLS fallback);
 * - `resolveUrl`: the platform's redirect probe, where it has one (Tizen);
 * - `screenSaver`: `Platform.setScreenSaver` (a TV that refuses it changes nothing);
 * - `online` and `checkAccount` (the error card's facts) from the app;
 * - the lifecycle: `hidden` and `visible` go to the controller's `hide` and `show`.
 */
export interface AppPlayerDeps {
  readonly platform: Pick<Platform, 'id' | 'createEngines' | 'resolveUrl' | 'setScreenSaver' | 'onLifecycle'>;
  /** The player's layer (made on the first call). */
  readonly stage: () => HTMLElement;
  /** Re-checks a source's account after a provider failure (the query worker's `account`). */
  readonly checkAccount: (src: string) => Promise<AccountStatus | null>;
  /** Whether the TV is online (the app passes `navigator.onLine`). */
  readonly online: () => boolean;
  /** Tests pin the clock. */
  readonly clock?: Clock;
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
