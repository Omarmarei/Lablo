/**
 * @zoma/platform-browser: the desktop development and test adapter.
 *
 * The keyboard stands in for the TV remote (docs/architecture.md §4) and the device info
 * is fake, with URL overrides so tests can force a tier, locale or country:
 * `?tier=low&locale=ar-SA&country=SA`.
 */
import { chromiumMajorFromUserAgent } from '@zoma/core';
import type { DeviceInfo, Intent, KeyLike, LifecycleEvent, Platform } from '@zoma/platform-api';
import { DIGIT_INTENTS } from '@zoma/platform-api';

/** `KeyboardEvent.key` values and the Intent each one stands for. */
const KEY_INTENTS: ReadonlyMap<string, Intent> = new Map<string, Intent>([
  ['ArrowUp', 'UP'],
  ['ArrowDown', 'DOWN'],
  ['ArrowLeft', 'LEFT'],
  ['ArrowRight', 'RIGHT'],
  ['Enter', 'OK'],
  ['Backspace', 'BACK'],
  ['Escape', 'BACK'],
  ['PageUp', 'CH_UP'],
  ['PageDown', 'CH_DOWN'],
  ['F1', 'RED'],
  ['F2', 'GREEN'],
  ['F3', 'YELLOW'],
  ['F4', 'BLUE'],
  [' ', 'PLAY_PAUSE'],
  ['i', 'INFO'],
  ['g', 'GUIDE'],
  ['s', 'STOP'],
  ['f', 'FF'],
  ['r', 'RW'],
  ['p', 'PREV_CH'],
]);

/** The desktop keyboard layout, for on-screen help. */
export const BROWSER_KEY_HELP: ReadonlyArray<readonly [keys: string, intent: string]> = [
  ['Arrows', 'Move'],
  ['Enter', 'OK'],
  ['Esc / Backspace', 'Back'],
  ['PgUp / PgDn', 'Channel + / −'],
  ['0–9', 'Digits'],
  ['F1–F4', 'Red, Green, Yellow, Blue'],
  ['Space', 'Play / Pause'],
  ['i / g', 'Info / Guide'],
  ['s / f / r / p', 'Stop / FF / Rewind / Previous channel'],
];

/**
 * The Intent for a desktop key press. Presses with Ctrl, Alt or Meta are left to the
 * browser so shortcuts such as reload keep working.
 */
export function browserKeyToIntent(event: KeyLike): Intent | null {
  if (event.ctrlKey === true || event.altKey === true || event.metaKey === true) return null;
  const key = event.key;
  if (key === undefined) return null;
  if (key.length === 1 && key >= '0' && key <= '9') return DIGIT_INTENTS[Number(key)] ?? null;
  return KEY_INTENTS.get(key) ?? KEY_INTENTS.get(key.toLowerCase()) ?? null;
}

/** The minimal document surface the adapter needs; tests pass a fake. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface BrowserEnv {
  readonly userAgent: string;
  /** Browser UI language, e.g. `en-US`. */
  readonly language: string;
  /** `location.search`, for the `tier`, `locale` and `country` overrides. */
  readonly search: string;
  readonly document: VisibilitySource;
  /** Called by `exitApp()`; the browser cannot close a tab it did not open. */
  readonly onExit: () => void;
}

function defaultEnv(): BrowserEnv {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    search: location.search,
    document,
    onExit: () => console.info('[zoma] exitApp(): ignored in the desktop browser'),
  };
}

function fakeDeviceInfo(env: BrowserEnv): DeviceInfo {
  const params = new URLSearchParams(env.search);
  return {
    platform: 'browser',
    model: 'Desktop browser',
    modelYear: null,
    osVersion: 'n/a',
    firmware: 'n/a',
    chromiumVersion: chromiumMajorFromUserAgent(env.userAgent),
    // A desktop is never the slow tier unless a test asks for it.
    tier: params.get('tier') === 'low' ? 'low' : 'full',
    locale: params.get('locale') ?? (env.language || 'en-US'),
    country: params.get('country'),
  };
}

export function createBrowserPlatform(env: BrowserEnv = defaultEnv()): Platform {
  return {
    id: 'browser',
    info: () => Promise.resolve(fakeDeviceInfo(env)),
    registerKeys: () => undefined,
    keyToIntent: browserKeyToIntent,
    onLifecycle(listener: (event: LifecycleEvent) => void): () => void {
      const onVisibility = (): void => listener(env.document.hidden ? 'hidden' : 'visible');
      env.document.addEventListener('visibilitychange', onVisibility);
      return () => env.document.removeEventListener('visibilitychange', onVisibility);
    },
    // A desktop mouse has no shown/hidden events; it shows itself by moving.
    onPointer: () => () => undefined,
    rootBackPolicy: () => 'exit-dialog',
    exitApp: () => env.onExit(),
  };
}
