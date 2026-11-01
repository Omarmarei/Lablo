/**
 * @zoma/platform-api: the Platform and Intent contracts every TV adapter implements.
 *
 * Interfaces only, plus the Intent vocabulary as a constant list. Adapters
 * (platform-tizen, platform-webos, platform-browser) implement `Platform`; apps/tv
 * picks one per build through the `__PLATFORM__` define. See docs/architecture.md §1.1
 * and §1.2. Player types will be imported here with `import type` only (ADR-008).
 */
import type { DeviceTier } from '@zoma/core';

export type { DeviceTier };

export type PlatformId = 'tizen' | 'webos' | 'browser';

/** What the hello screen, telemetry and tier-dependent limits know about the device. */
export interface DeviceInfo {
  readonly platform: PlatformId;
  /** Model code as the TV reports it, e.g. `UE43NU7100` or `43UK6300PLB`. */
  readonly model: string;
  /** Model year (2018, 2020, …) derived from the OS version, or `null` when unknown. */
  readonly modelYear: number | null;
  /** OS version: Tizen `4.0`, webOS `4.1.0`, or `n/a` in a desktop browser. */
  readonly osVersion: string;
  /** Firmware build string, or the OS version when the TV exposes no separate firmware id. */
  readonly firmware: string;
  /** Chromium major version of the web engine, or `null` when unknown. */
  readonly chromiumVersion: number | null;
  readonly tier: DeviceTier;
  /** BCP 47 UI locale of the TV, e.g. `ar-SA` or `en-US`. */
  readonly locale: string;
  /** ISO 3166-1 alpha-2 country, or `null` until the adapter can read it. */
  readonly country: string | null;
}

/** Number keys 0–9, indexed by digit: `DIGIT_INTENTS[7] === 'DIGIT_7'`. */
export const DIGIT_INTENTS = [
  'DIGIT_0',
  'DIGIT_1',
  'DIGIT_2',
  'DIGIT_3',
  'DIGIT_4',
  'DIGIT_5',
  'DIGIT_6',
  'DIGIT_7',
  'DIGIT_8',
  'DIGIT_9',
] as const;

/**
 * Remote-control actions. Adapters turn platform key codes into these; screens and the
 * focus engine only ever see Intents. In RTL, the focus engine swaps LEFT and RIGHT once
 * for horizontal zones (not here).
 */
export const INTENTS = [
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'OK',
  'BACK',
  'CH_UP',
  'CH_DOWN',
  ...DIGIT_INTENTS,
  'PLAY_PAUSE',
  'STOP',
  'FF',
  'RW',
  'INFO',
  'GUIDE',
  'RED',
  'GREEN',
  'YELLOW',
  'BLUE',
  'PREV_CH',
] as const;

export type Intent = (typeof INTENTS)[number];

/** The parts of a `KeyboardEvent` an adapter needs; a real `KeyboardEvent` satisfies it. */
export interface KeyLike {
  readonly keyCode: number;
  readonly key?: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

export type LifecycleEvent = 'hidden' | 'visible' | 'relaunch';

/**
 * What Back does on the root screen: Tizen apps show an exit dialog; webOS apps hand Back
 * to the system (`platformBack`), which webOS 23+ requires.
 */
export type RootBackPolicy = 'exit-dialog' | 'platform-back';

/**
 * The only seam between the app and a TV platform. Later steps add `deviceSecret()`,
 * `setScreenSaver()`, `createEngines()` and the optional extras listed in
 * docs/architecture.md §1.1.
 */
export interface Platform {
  readonly id: PlatformId;
  /** Device facts. Async because some TV APIs answer through callbacks. */
  info(): Promise<DeviceInfo>;
  /** Asks the TV to deliver the remote keys the app handles (Tizen needs this; others no-op). */
  registerKeys(): void;
  /** The Intent for a key event, or `null` for keys the app does not handle. */
  keyToIntent(event: KeyLike): Intent | null;
  /** Subscribes to app visibility changes and relaunches; returns an unsubscribe function. */
  onLifecycle(listener: (event: LifecycleEvent) => void): () => void;
  rootBackPolicy(): RootBackPolicy;
  /** Leaves the app the platform's way (on webOS this is Back to the launcher). */
  exitApp(): void;
}
