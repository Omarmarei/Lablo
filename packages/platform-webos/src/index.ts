/**
 * @zoma/platform-webos: the LG webOS adapter.
 *
 * Step 2 covers what the hello app needs: device info from `PalmSystem.deviceInfo`, remote
 * key codes, lifecycle and exit; step 15a the LGUDID (`deviceSecret`) through a luna call
 * (`lunaRequest`, over `PalmServiceBridge`); step 15b2 Audio Guidance and speech (`speech.ts`). The DB8 mirror and the track-switch strategy
 * follow in later steps. The only package allowed to touch `webOS`, `PalmSystem` and
 * `PalmServiceBridge` (lint-enforced). Every API is feature-checked, so the bundle also boots in a
 * desktop browser.
 */
import { chromiumMajorFromUserAgent, deviceTier } from '@zoma/core';
import type { DeviceInfo, Intent, KeyLike, KeyRegistration, LifecycleEvent, Platform, PlatformCall, TextKey } from '@zoma/platform-api';
import { DIGIT_INTENTS } from '@zoma/platform-api';
import { parsePalmDeviceInfo, webosChromiumVersion, webosModelYear } from './device';
import { readLgudid } from './luna';
import { readAudioGuidance, webosSpeak } from './speech';

export type { WebosDeviceInfo } from './device';
export { parsePalmDeviceInfo, webosChromiumVersion, webosModelYear } from './device';
export type { BridgeFactory, ServiceBridge } from './luna';
export { DEVICE_ID_URI, LunaError, jsonText, lgudidFrom, lunaRequest, palmServiceBridge, readLgudid } from './luna';
export { AUDIO_GUIDANCE_URI, TTS_URI, audioGuidanceFrom, readAudioGuidance, webosSpeak } from './speech';

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

/**
 * Keys that end a text edit. The virtual keyboard sends its Enter as key 13; Back (461) closes
 * it first, and its hiding ends the edit (`watchKeyboardState`). Not checked on a TV yet:
 * spike S10 (docs/architecture.md §5).
 */
const WEBOS_TEXT_KEYS: ReadonlyMap<number, TextKey> = new Map<number, TextKey>([
  [13, 'done'],
  [461, 'close'],
  [38, 'up'],
  [40, 'down'],
]);

/** What a remote key does in a text field being edited (every other key types). */
export function webosTextKey(event: KeyLike): TextKey | null {
  return WEBOS_TEXT_KEYS.get(event.keyCode) ?? null;
}

/** The slice of the native `PalmSystem` object this adapter uses. */
interface PalmSystemApi {
  readonly deviceInfo?: string;
  platformBack?(): void;
}

/**
 * Reports the Magic Remote pointer's `cursorStateChange` events (`detail.visibility`), which
 * webOS sends when the pointer appears, and when it hides after a few idle seconds or on a
 * key press. Returns a function that stops listening.
 */
export function watchCursorState(target: EventTarget, listener: (visible: boolean) => void): () => void {
  const onChange = (event: Event): void => {
    const visibility = (event as CustomEvent<{ readonly visibility?: unknown } | null>).detail?.visibility;
    if (typeof visibility === 'boolean') listener(visibility);
  };
  target.addEventListener('cursorStateChange', onChange);
  return () => target.removeEventListener('cursorStateChange', onChange);
}

/**
 * Reports the virtual keyboard's `keyboardStateChange` events (`detail.visibility`), which
 * webOS sends when the on-screen keyboard opens or closes. Returns a function that stops
 * listening.
 */
export function watchKeyboardState(target: EventTarget, listener: (visible: boolean) => void): () => void {
  const onChange = (event: Event): void => {
    const visibility = (event as CustomEvent<{ readonly visibility?: unknown } | null>).detail?.visibility;
    if (typeof visibility === 'boolean') listener(visibility);
  };
  target.addEventListener('keyboardStateChange', onChange);
  return () => target.removeEventListener('keyboardStateChange', onChange);
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
    registerKeys: (): KeyRegistration => ({ skipped: 'webOS delivers every key', supported: null, registered: [], unsupported: [], refused: [] }),
    keyToIntent: webosKeyToIntent,
    textKey: webosTextKey,
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
    onPointer: (listener: (visible: boolean) => void): (() => void) => watchCursorState(document, listener),
    onSoftKeyboard: (listener: (visible: boolean) => void): (() => void) => watchKeyboardState(document, listener),
    rootBackPolicy: () => 'platform-back',
    deviceSecret: () => readLgudid(),
    // No screensaver API for webOS apps: full-screen video keeps it away (LG's screensaver guide).
    setScreenSaver: (): Promise<PlatformCall> => Promise.resolve('unsupported'),
    screenReader: () => readAudioGuidance(),
    speak: (text: string) => webosSpeak(text),
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
