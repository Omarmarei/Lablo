/**
 * @lablo/platform-api: the Platform and Intent contracts every TV adapter implements.
 *
 * Interfaces only, plus the Intent vocabulary as a constant list. Adapters
 * (platform-tizen, platform-webos, platform-browser) implement `Platform`; apps/tv
 * picks one per build through the `__PLATFORM__` define. See docs/architecture.md §1.1
 * and §1.2. Player types are imported here with `import type` only (ADR-008).
 */
import type { DeviceTier } from '@lablo/core';
import type { PlayerEngine } from '@lablo/player';

export type { DeviceTier };

export type PlatformId = 'tizen' | 'webos' | 'browser';

/** What the hello screen, telemetry and tier-dependent limits know about the device. */
export interface DeviceInfo {
  readonly platform: PlatformId;
  /** Model code as the TV reports it, e.g. `UE43NU7100` or `43UK6300PLB`. */
  readonly model: string;
  /** Model year (2018, 2020, …) derived from the OS version (webOS: or the engine), or `null` when unknown. */
  readonly modelYear: number | null;
  /** OS version: Tizen `4.0`, webOS `6.5.3` (or just the major, `6`, when only the engine names it), or `n/a` in a desktop browser. */
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
  /**
   * The platform's own facts behind the fields above, as it gave them (webOS: where the version
   * came from and the keys of `PalmSystem.deviceInfo`). Spike S0 records them; nothing decides on them.
   */
  readonly details?: Readonly<Record<string, string>>;
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
  /** The audio track key (Samsung MTS): the player's track menu on its audio list. */
  'AUDIO',
  /** The subtitle key (Samsung Caption): the player's track menu on its subtitles. */
  'SUBTITLES',
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
 * What a key does while a text field is being edited, that is while its `<input>` has DOM
 * focus and the TV's on-screen keyboard is up (RELAY step 13a, docs/architecture.md §1.2):
 * - `done`: Enter, or the on-screen keyboard's Done key: the edit ends and the focus moves on;
 * - `close`: Back, Escape or the keyboard's Cancel key: the edit ends and the focus stays (the
 *   typed text is kept: a stray Back must never throw away a long URL typed on a remote);
 * - `up` / `down`: the edit ends and the focus moves up or down.
 * Every other key (letters, Backspace, the caret keys) belongs to the field.
 */
export type TextKey = 'done' | 'close' | 'up' | 'down';

/**
 * What Back does on the root screen: Tizen apps show an exit dialog; webOS apps hand Back
 * to the system (`platformBack`), which webOS 23+ requires.
 */
export type RootBackPolicy = 'exit-dialog' | 'platform-back';

/**
 * A platform call this TV may not offer: `done` when the TV took it, `unsupported` when the TV,
 * its firmware or the desktop browser has no such API. A TV that has the API and refuses the
 * call rejects with its reason.
 */
export type PlatformCall = 'done' | 'unsupported';

/** A remote key as the TV names it: Tizen `tvinputdevice.getSupportedKeys()`. */
export interface RemoteKey {
  readonly name: string;
  readonly code: number;
}

/**
 * What `registerKeys()` did (RELAY step 15b3: spike S10 records it). Tizen delivers only the
 * arrows, Enter and Back unless the app registers each other key; webOS and the desktop deliver
 * every key.
 */
export interface KeyRegistration {
  /** Why nothing was registered (`webOS delivers every key`, `no tizen.tvinputdevice`), or null. */
  readonly skipped: string | null;
  /** The keys the TV says it has, or null where it doesn't say. */
  readonly supported: readonly RemoteKey[] | null;
  /** The keys registered. */
  readonly registered: readonly string[];
  /** The app's keys the TV doesn't list (never asked for). */
  readonly unsupported: readonly string[];
  /** The keys the TV refused, with its reason. */
  readonly refused: ReadonlyArray<{ readonly name: string; readonly error: string }>;
}

/** The TV's screen reader (Samsung Voice Guide, LG Audio Guidance), as far as the TV says. */
export interface ScreenReaderState {
  /** On or off; `null` when the TV doesn't say (no API, a refusal, an answer we can't read). */
  readonly on: boolean | null;
  /** What the TV answered, or why there is no answer: for the lab's records (spike S11). */
  readonly detail: string;
}

/**
 * Builds the platform's playback engines, best first (ADR-008: the adapters construct them, and
 * apps/tv hands them to the `PlayerController`). `stage` is the app's player layer: each engine
 * puts its picture there (the one app-wide `<video>`, or AVPlay's `<object>`). Called once.
 */
export type EngineFactory = (stage: HTMLElement) => PlayerEngine[];

/**
 * The URL to give the engine for a stream URL of source `src` (`PlayerController`'s
 * `resolveUrl`); `fresh` asks for a new answer instead of the source's remembered one.
 */
export type UrlResolver = (url: string, src: string, fresh: boolean) => Promise<string>;

/** What a redirect probe learned about a source's stream URLs (`unknown`: nothing yet). */
export type RedirectMode = 'unknown' | 'none' | 'redirects';

/**
 * Where a platform's redirect probe (`resolveUrl`) keeps what it learned per source. The app
 * hands the platform one that the profile keeps (RELAY step 20c1); the probe's default keeps it
 * for the app's run.
 */
export interface RedirectMemory {
  mode(src: string): RedirectMode;
  remember(src: string, mode: 'none' | 'redirects'): void;
}

/** What the app hands a platform adapter when it makes it. */
export interface PlatformOptions {
  /** Where the redirect probe keeps its answers (Tizen; the others have no probe). */
  readonly redirects?: RedirectMemory;
}

/**
 * The only seam between the app and a TV platform. Later steps add the optional extras listed
 * in docs/architecture.md §1.1.
 */
export interface Platform {
  readonly id: PlatformId;
  /**
   * The playback engines (see `EngineFactory`): webOS and the desktop `Html5Engine`; Tizen one
   * `FallbackEngine` (AVPlay, then `Html5Engine` for HLS AVPlay refuses), or `Html5Engine` where
   * there is no AVPlay.
   */
  readonly createEngines: EngineFactory;
  /**
   * Tizen: the redirect probe (architecture.md §2 "Redirect handling"), for the controller's
   * `resolveUrl`. Absent where the engine follows redirects itself (webOS, the desktop).
   */
  readonly resolveUrl?: UrlResolver;
  /** Device facts. Async because some TV APIs answer through callbacks. */
  info(): Promise<DeviceInfo>;
  /**
   * Asks the TV to deliver the remote keys the app handles (Tizen needs this; the others have
   * nothing to do), and says what it did.
   */
  registerKeys(): KeyRegistration;
  /** The Intent for a key event, or `null` for keys the app does not handle. */
  keyToIntent(event: KeyLike): Intent | null;
  /** What a key does in a text field being edited, or `null` when the field takes it (see `TextKey`). */
  textKey(event: KeyLike): TextKey | null;
  /**
   * The system's on-screen keyboard shown or hidden: webOS sends `keyboardStateChange`. A text
   * edit ends when the keyboard hides, or the arrows would move the caret of a field nobody
   * sees. Platforms without such events never call the listener. Returns an unsubscribe function.
   */
  onSoftKeyboard(listener: (visible: boolean) => void): () => void;
  /** Subscribes to app visibility changes and relaunches; returns an unsubscribe function. */
  onLifecycle(listener: (event: LifecycleEvent) => void): () => void;
  /**
   * The system's own pointer shown/hidden events: the webOS Magic Remote pointer hides
   * after a few idle seconds and on a key press, and says so. Platforms without such
   * events never call the listener (the app then learns of a shown pointer from its moves,
   * `@lablo/ui` `watchPointerMoves`). Returns an unsubscribe function.
   */
  onPointer(listener: (visible: boolean) => void): () => void;
  rootBackPolicy(): RootBackPolicy;
  /**
   * The TV's own stable device ID: the DUID on Tizen, the LGUDID on webOS; `null` in a desktop
   * browser, or when the TV has none or refuses it. It will key the encrypted backup
   * (docs/architecture.md §3.3), so it is never sent or logged as it is: the lab's spike S3
   * reports only a hash of it.
   */
  deviceSecret(): Promise<string | null>;
  /**
   * Lets the TV's screensaver come (`true`) or keeps it away (`false`) while the app is in the
   * foreground (RELAY step 15b2, spike S11). Tizen: `webapis.appcommon.setScreenSaver`, which
   * Samsung's certification wants back on whenever playback pauses or stops. webOS has no API
   * for it (`unsupported`): full-screen video keeps the screensaver away there (LG's guide).
   */
  setScreenSaver(allowed: boolean): Promise<PlatformCall>;
  /** Whether the TV's screen reader is on (Samsung Voice Guide, LG Audio Guidance). */
  screenReader(): Promise<ScreenReaderState>;
  /**
   * Says `text` with the TV's own speech, for a screen reader that doesn't read our focus
   * (docs/architecture.md §5, S11's fallback). webOS: the `com.webos.service.tts` luna service
   * (used by LG's Enact, not in the TV docs); Tizen has no speech API for web apps
   * (`unsupported`: Voice Guide reads `aria-live` regions instead).
   */
  speak(text: string): Promise<PlatformCall>;
  /** Leaves the app the platform's way (on webOS this is Back to the launcher). */
  exitApp(): void;
}
