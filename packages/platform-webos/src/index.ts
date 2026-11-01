/**
 * @zoma/platform-webos: the LG webOS adapter.
 *
 * Step 2 covers what the hello app needs: device info from `PalmSystem.deviceInfo`, remote
 * key codes, lifecycle and exit. LGUDID, luna helpers, the DB8 mirror and the track-switch
 * strategy follow in later steps. The only package allowed to touch `webOS` and
 * `PalmSystem` (lint-enforced). Every API is feature-checked, so the bundle also boots in a
 * desktop browser.
 */
import { chromiumMajorFromUserAgent, deviceTier } from '@zoma/core';
import type { DeviceInfo, Intent, KeyLike, LifecycleEvent, Platform } from '@zoma/platform-api';
import { DIGIT_INTENTS } from '@zoma/platform-api';
import { parsePalmDeviceInfo, webosChromiumVersion, webosModelYear } from './device';

export type { WebosDeviceInfo } from './device';
export { parsePalmDeviceInfo, webosChromiumVersion, webosModelYear } from './device';

/** LG remote key codes. webOS delivers every key without registration. */
const WEBOS_KEYS: ReadonlyMap<number, Intent> = new Map<number, Intent>([
  [38, 'UP'],
  [40, 'DOWN'],
  [37, 'LEFT'],
  [39, 'RIGHT'],
  [13, 'OK'],
  [461, 'BACK'],
  [33, 'CH_UP'],
  [34, 'CH_DOWN'],
  ...DIGIT_INTENTS.map((intent, digit): [number, Intent] => [48 + digit, intent]),
  [415, 'PLAY_PAUSE'],
  [19, 'PLAY_PAUSE'],
  [413, 'STOP'],
  [417, 'FF'],
  [412, 'RW'],
  [457, 'INFO'],
  [458, 'GUIDE'],
  [403, 'RED'],
  [404, 'GREEN'],
  [405, 'YELLOW'],
  [406, 'BLUE'],
]);

export function webosKeyToIntent(event: KeyLike): Intent | null {
  return WEBOS_KEYS.get(event.keyCode) ?? null;
}

/** The slice of the native `PalmSystem` object this adapter uses. */
interface PalmSystemApi {
  readonly deviceInfo?: string;
  platformBack?(): void;
}

function palmSystem(): PalmSystemApi | undefined {
  return (window as unknown as { PalmSystem?: PalmSystemApi }).PalmSystem;
}

function readDeviceInfo(): DeviceInfo {
  const raw = parsePalmDeviceInfo(palmSystem()?.deviceInfo);
  const osVersion = raw.platformVersion ?? 'unknown';
  const modelYear = webosModelYear(osVersion);
  const chromiumVersion = chromiumMajorFromUserAgent(navigator.userAgent) ?? webosChromiumVersion(osVersion);
  return {
    platform: 'webos',
    model: raw.modelName ?? 'unknown',
    modelYear,
    osVersion,
    firmware: raw.firmwareVersion ?? osVersion,
    chromiumVersion,
    tier: deviceTier({ modelYear, chromiumVersion }),
    locale: navigator.language || 'en-US',
    country: null,
  };
}

export function createWebosPlatform(): Platform {
  return {
    id: 'webos',
    info: () => Promise.resolve(readDeviceInfo()),
    registerKeys: () => undefined,
    keyToIntent: webosKeyToIntent,
    onLifecycle(listener: (event: LifecycleEvent) => void): () => void {
      const onVisibility = (): void => listener(document.hidden ? 'hidden' : 'visible');
      const onRelaunch = (): void => listener('relaunch');
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('webOSRelaunch', onRelaunch);
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('webOSRelaunch', onRelaunch);
      };
    },
    rootBackPolicy: () => 'platform-back',
    exitApp(): void {
      // appinfo.json sets disableBackHistoryAPI, so the app owns Back; at the root it hands
      // Back to the system (the launcher), as LG's guidelines require. `window.close()` is
      // the fallback outside webOS.
      const palm = palmSystem();
      if (palm?.platformBack !== undefined) palm.platformBack();
      else window.close();
    },
  };
}
