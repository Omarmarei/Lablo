/**
 * @zoma/platform-tizen: the Samsung Tizen adapter.
 *
 * Step 2 covers what the hello app needs: device info, remote-key registration through
 * `tizen.tvinputdevice`, lifecycle and exit; step 15a the DUID (`deviceSecret`); step 15b2 the
 * screensaver and Voice Guide (`tv-settings.ts`); step 15c2 AVPlay typed for the lab's S4 and S8
 * (`avplay.ts`); step 19 the AvplayEngine (`avplay-engine.ts`) and the redirect probe
 * (`redirect-probe.ts`). The only package allowed to touch `tizen` and `webapis` (lint-enforced).
 * Every API is feature-checked, so the bundle also boots in a desktop browser.
 */
import { chromiumMajorFromUserAgent, deviceTier } from '@zoma/core';
import type { DeviceInfo, Intent, KeyLike, KeyRegistration, LifecycleEvent, Platform, PlatformCall, ScreenReaderState, TextKey } from '@zoma/platform-api';
import type { PlayerEngine } from '@zoma/player';
import { FallbackEngine, Html5Engine, createStageVideo } from '@zoma/player';
import { tizenAvplay } from './avplay';
import { AvplayEngine, createAvplayPlane } from './avplay-engine';
import { tizenChromiumVersion, tizenModelYear } from './device';
import type { TizenKey, TvInputDevice } from './keys';
import { createRedirectProbe } from './redirect-probe';
import { buildTizenKeyMap, registerTizenKeys, tizenTextKey } from './keys';
import type { TvSettingsApi } from './tv-settings';
import { tizenScreenReader, tizenSetScreenSaver } from './tv-settings';

export type { AvplayError, AvplayListener, AvplayManager, AvplayState, AvplayStore, AvplayStreamInfo, AvplayTrack, AvplayWebApis } from './avplay';
export { avplayErrorText, avplayExtraInfo, avplayTracks, avplayUnsupported, tizenAvplay, tizenAvplayStore } from './avplay';
export type { AvplayEngineOptions } from './avplay-engine';
export { AVPLAY_FRAME_POLL_MS, AvplayEngine, PREPARE_TIMEOUT_MS, avplayError, createAvplayPlane } from './avplay-engine';
export { tizenChromiumVersion, tizenModelYear } from './device';
export type { TizenKey, TvInputDevice } from './keys';
export { TIZEN_IME_CANCEL, TIZEN_IME_DONE, buildTizenKeyMap, registerTizenKeys, tizenKeysToRegister, tizenTextKey } from './keys';
export type { TvSettingsApi } from './tv-settings';
export type { ProbeXhr, RedirectMemory, RedirectMode, RedirectProbeOptions } from './redirect-probe';
export { MemoryRedirectMemory, PROBE_TIMEOUT_MS, createRedirectProbe } from './redirect-probe';
export { tizenScreenReader, tizenSetScreenSaver, voiceGuideOn } from './tv-settings';

/** The slice of the Tizen Web Device API this adapter uses. */
interface TizenApi {
  readonly tvinputdevice?: TvInputDevice;
  readonly systeminfo?: {
    getCapability(key: string): unknown;
  };
  readonly application?: {
    getCurrentApplication(): { exit(): void };
  };
}

/** The slice of Samsung's TV Product API (`$WEBAPIS/webapis/webapis.js`) this adapter uses. */
interface WebApis extends TvSettingsApi {
  readonly productinfo?: {
    getRealModel?(): string;
    getModel?(): string;
    getFirmware?(): string;
    getDuid?(): string;
  };
}

interface TizenGlobals {
  readonly tizen?: TizenApi;
  readonly webapis?: WebApis;
}

const PLATFORM_VERSION_KEY = 'http://tizen.org/feature/platform.version';

function globals(): TizenGlobals {
  return window as unknown as TizenGlobals;
}

/** Calls a TV API that may be missing or throw (privileges, old firmware); `fallback` on failure. */
function attempt<T>(read: () => T | undefined, fallback: T): T {
  try {
    return read() ?? fallback;
  } catch {
    return fallback;
  }
}

function readDeviceInfo(): DeviceInfo {
  const { tizen, webapis } = globals();
  const product = webapis?.productinfo;
  const capability = attempt(() => tizen?.systeminfo?.getCapability(PLATFORM_VERSION_KEY), undefined);
  const osVersion = typeof capability === 'string' ? capability : 'unknown';
  const modelYear = tizenModelYear(osVersion);
  const chromiumVersion = chromiumMajorFromUserAgent(navigator.userAgent) ?? tizenChromiumVersion(osVersion);
  return {
    platform: 'tizen',
    model: attempt(() => product?.getRealModel?.() || product?.getModel?.(), 'unknown'),
    modelYear,
    osVersion,
    firmware: attempt(() => product?.getFirmware?.(), osVersion),
    chromiumVersion,
    tier: deviceTier({ modelYear, chromiumVersion }),
    locale: navigator.language || 'en-US',
    country: null,
  };
}

/**
 * AVPlay, with the `<video>` engine as its fallback for HLS it refuses, as one engine
 * (`FallbackEngine`); the `<video>` engine alone where there is no AVPlay (a desktop browser,
 * the old-engine harness). The `<video>` is hidden while AVPlay plays: AVPlay paints under the
 * page, and the element's black background would cover it.
 */
export function createTizenEngines(stage: HTMLElement, avplay = tizenAvplay()): PlayerEngine[] {
  const video = createStageVideo(stage);
  const html5 = new Html5Engine(video);
  if (avplay === null) return [html5];
  createAvplayPlane(stage);
  const show = (engine: PlayerEngine): void => {
    video.style.display = engine === html5 ? '' : 'none';
  };
  return [new FallbackEngine(new AvplayEngine(avplay), html5, { onActive: show })];
}

export function createTizenPlatform(): Platform {
  let keyMap: Map<number, Intent> | null = null;
  const supportedKeys = (): TizenKey[] | null =>
    attempt(() => globals().tizen?.tvinputdevice?.getSupportedKeys() ?? null, null);
  const getKeyMap = (): Map<number, Intent> => (keyMap ??= buildTizenKeyMap(supportedKeys()));

  return {
    id: 'tizen',
    createEngines: (stage) => createTizenEngines(stage),
    // AVPlay may freeze on a 302: it gets the URL the probe found (architecture.md §2).
    resolveUrl: createRedirectProbe(),
    info: () => Promise.resolve(readDeviceInfo()),
    registerKeys: (): KeyRegistration => registerTizenKeys(attempt(() => globals().tizen?.tvinputdevice, undefined)),
    keyToIntent: (event: KeyLike): Intent | null => getKeyMap().get(event.keyCode) ?? null,
    textKey: (event: KeyLike): TextKey | null => tizenTextKey(event),
    onLifecycle(listener: (event: LifecycleEvent) => void): () => void {
      const onVisibility = (): void => listener(document.hidden ? 'hidden' : 'visible');
      const onAppControl = (): void => listener('relaunch');
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('appcontrol', onAppControl);
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('appcontrol', onAppControl);
      };
    },
    // Tizen remotes have no system pointer events; a mouse shows itself by moving.
    onPointer: () => () => undefined,
    // The IME tells the field itself, with its Done and Cancel keys (tizenTextKey).
    onSoftKeyboard: () => () => undefined,
    rootBackPolicy: () => 'exit-dialog',
    deviceSecret(): Promise<string | null> {
      const duid = attempt(() => globals().webapis?.productinfo?.getDuid?.(), '');
      return Promise.resolve(typeof duid === 'string' && duid.trim() !== '' ? duid.trim() : null);
    },
    setScreenSaver: (allowed: boolean): Promise<PlatformCall> => tizenSetScreenSaver(globals().webapis, allowed),
    screenReader: (): Promise<ScreenReaderState> => Promise.resolve(tizenScreenReader(globals().webapis)),
    // No speech API for Tizen web apps: Voice Guide reads the focused element and aria-live regions.
    speak: (): Promise<PlatformCall> => Promise.resolve('unsupported'),
    exitApp(): void {
      attempt(() => globals().tizen?.application?.getCurrentApplication().exit(), undefined);
    },
  };
}
