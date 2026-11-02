/**
 * @zoma/platform-tizen: the Samsung Tizen adapter.
 *
 * Step 2 covers what the hello app needs: device info, remote-key registration through
 * `tizen.tvinputdevice`, lifecycle and exit. DUID, screensaver, AvplayEngine and TTS follow
 * in later steps. The only package allowed to touch `tizen` and `webapis` (lint-enforced).
 * Every API is feature-checked, so the bundle also boots in a desktop browser.
 */
import { chromiumMajorFromUserAgent, deviceTier } from '@zoma/core';
import type { DeviceInfo, Intent, KeyLike, LifecycleEvent, Platform } from '@zoma/platform-api';
import { tizenChromiumVersion, tizenModelYear } from './device';
import type { TizenKey } from './keys';
import { buildTizenKeyMap, tizenKeysToRegister } from './keys';

export { tizenChromiumVersion, tizenModelYear } from './device';
export type { TizenKey } from './keys';
export { buildTizenKeyMap, tizenKeysToRegister } from './keys';

/** The slice of the Tizen Web Device API this adapter uses. */
interface TizenApi {
  readonly tvinputdevice?: {
    getSupportedKeys(): TizenKey[];
    registerKey(name: string): void;
  };
  readonly systeminfo?: {
    getCapability(key: string): unknown;
  };
  readonly application?: {
    getCurrentApplication(): { exit(): void };
  };
}

/** The slice of Samsung's TV Product API (`$WEBAPIS/webapis/webapis.js`) this adapter uses. */
interface WebApis {
  readonly productinfo?: {
    getRealModel?(): string;
    getModel?(): string;
    getFirmware?(): string;
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

export function createTizenPlatform(): Platform {
  let keyMap: Map<number, Intent> | null = null;
  const supportedKeys = (): TizenKey[] | null =>
    attempt(() => globals().tizen?.tvinputdevice?.getSupportedKeys() ?? null, null);
  const getKeyMap = (): Map<number, Intent> => (keyMap ??= buildTizenKeyMap(supportedKeys()));

  return {
    id: 'tizen',
    info: () => Promise.resolve(readDeviceInfo()),
    registerKeys(): void {
      const input = globals().tizen?.tvinputdevice;
      if (input === undefined) return;
      // One call per key: a batch call fails as a whole if any one key is unsupported.
      for (const name of tizenKeysToRegister(supportedKeys())) {
        attempt(() => input.registerKey(name), undefined);
      }
    },
    keyToIntent: (event: KeyLike): Intent | null => getKeyMap().get(event.keyCode) ?? null,
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
    rootBackPolicy: () => 'exit-dialog',
    exitApp(): void {
      attempt(() => globals().tizen?.application?.getCurrentApplication().exit(), undefined);
    },
  };
}
