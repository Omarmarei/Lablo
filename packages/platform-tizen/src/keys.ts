import type { Intent, KeyLike, KeyRegistration, TextKey } from '@zoma/platform-api';

/** A key as `tizen.tvinputdevice.getSupportedKeys()` reports it. */
export interface TizenKey {
  readonly name: string;
  readonly code: number;
}

interface TizenKeySpec extends TizenKey {
  readonly intent: Intent;
  /** Arrows, Enter and Back always reach the app; every other key must be registered. */
  readonly mandatory?: true;
}

/**
 * Samsung remote keys the app handles, with the usual key codes. The TV's own
 * `getSupportedKeys()` codes take precedence when available.
 */
const TIZEN_KEYS: readonly TizenKeySpec[] = [
  { name: 'ArrowUp', code: 38, intent: 'UP', mandatory: true },
  { name: 'ArrowDown', code: 40, intent: 'DOWN', mandatory: true },
  { name: 'ArrowLeft', code: 37, intent: 'LEFT', mandatory: true },
  { name: 'ArrowRight', code: 39, intent: 'RIGHT', mandatory: true },
  { name: 'Enter', code: 13, intent: 'OK', mandatory: true },
  { name: 'Back', code: 10009, intent: 'BACK', mandatory: true },
  { name: 'ChannelUp', code: 427, intent: 'CH_UP' },
  { name: 'ChannelDown', code: 428, intent: 'CH_DOWN' },
  { name: '0', code: 48, intent: 'DIGIT_0' },
  { name: '1', code: 49, intent: 'DIGIT_1' },
  { name: '2', code: 50, intent: 'DIGIT_2' },
  { name: '3', code: 51, intent: 'DIGIT_3' },
  { name: '4', code: 52, intent: 'DIGIT_4' },
  { name: '5', code: 53, intent: 'DIGIT_5' },
  { name: '6', code: 54, intent: 'DIGIT_6' },
  { name: '7', code: 55, intent: 'DIGIT_7' },
  { name: '8', code: 56, intent: 'DIGIT_8' },
  { name: '9', code: 57, intent: 'DIGIT_9' },
  { name: 'MediaPlayPause', code: 10252, intent: 'PLAY_PAUSE' },
  { name: 'MediaPlay', code: 415, intent: 'PLAY_PAUSE' },
  { name: 'MediaPause', code: 19, intent: 'PLAY_PAUSE' },
  { name: 'MediaStop', code: 413, intent: 'STOP' },
  { name: 'MediaFastForward', code: 417, intent: 'FF' },
  { name: 'MediaRewind', code: 412, intent: 'RW' },
  { name: 'Info', code: 457, intent: 'INFO' },
  { name: 'Guide', code: 458, intent: 'GUIDE' },
  { name: 'ColorF0Red', code: 403, intent: 'RED' },
  { name: 'ColorF1Green', code: 404, intent: 'GREEN' },
  { name: 'ColorF2Yellow', code: 405, intent: 'YELLOW' },
  { name: 'ColorF3Blue', code: 406, intent: 'BLUE' },
  { name: 'PreviousChannel', code: 10190, intent: 'PREV_CH' },
];

/**
 * Names to pass to `tvinputdevice.registerKey()`: every non-mandatory key we handle that
 * the TV supports. With no supported-key list (API missing), all of them are tried.
 */
export function tizenKeysToRegister(supported: readonly TizenKey[] | null): string[] {
  const available = supported === null ? null : new Set(supported.map((k) => k.name));
  return TIZEN_KEYS.filter((k) => k.mandatory !== true && (available === null || available.has(k.name))).map(
    (k) => k.name,
  );
}

/** The slice of `tizen.tvinputdevice` that key registration uses. */
export interface TvInputDevice {
  getSupportedKeys(): TizenKey[];
  registerKey(name: string): void;
}

/** A Tizen `WebAPIException` is no `Error`, but it has a name and a message. */
function reason(error: unknown): string {
  const e = error as { readonly name?: unknown; readonly message?: unknown } | null;
  if (e !== null && typeof e === 'object' && typeof e.message === 'string') return typeof e.name === 'string' ? `${e.name}: ${e.message}` : e.message;
  return String(error);
}

/**
 * Registers each key the app handles that the TV supports, one call per key (a batch call fails
 * as a whole if any one key is unsupported), and says what happened (spike S10).
 */
export function registerTizenKeys(input: TvInputDevice | undefined): KeyRegistration {
  if (input === undefined) return { skipped: 'no tizen.tvinputdevice', supported: null, registered: [], unsupported: [], refused: [] };
  let supported: TizenKey[] | null = null;
  try {
    supported = input.getSupportedKeys();
  } catch {
    // Unknown: every key is tried.
  }
  const wanted = tizenKeysToRegister(supported);
  const registered: string[] = [];
  const refused: Array<{ name: string; error: string }> = [];
  for (const name of wanted) {
    try {
      input.registerKey(name);
      registered.push(name);
    } catch (error) {
      refused.push({ name, error: reason(error) });
    }
  }
  return {
    skipped: null,
    supported: supported === null ? null : supported.map((k) => ({ name: k.name, code: k.code })),
    registered,
    unsupported: tizenKeysToRegister(null).filter((name) => wanted.indexOf(name) === -1),
    refused,
  };
}

/** Key code → Intent, using the TV's reported codes where it has them. */
export function buildTizenKeyMap(supported: readonly TizenKey[] | null): Map<number, Intent> {
  const reported = new Map<string, number>();
  for (const key of supported ?? []) reported.set(key.name, key.code);
  const map = new Map<number, Intent>();
  for (const key of TIZEN_KEYS) map.set(reported.get(key.name) ?? key.code, key.intent);
  return map;
}

/**
 * The Samsung IME's own keys: while a text field has DOM focus, the on-screen keyboard sends
 * Done and Cancel to it as these key codes (Samsung's "Keyboard/IME" guide). Not checked on a
 * TV yet: spike S10 (docs/architecture.md §5).
 */
export const TIZEN_IME_DONE = 65376;
export const TIZEN_IME_CANCEL = 65385;

const TIZEN_TEXT_KEYS: ReadonlyMap<number, TextKey> = new Map<number, TextKey>([
  [13, 'done'],
  [TIZEN_IME_DONE, 'done'],
  [TIZEN_IME_CANCEL, 'close'],
  [10009, 'close'],
  [38, 'up'],
  [40, 'down'],
]);

/** What a remote or IME key does in a text field being edited (every other key types). */
export function tizenTextKey(event: KeyLike): TextKey | null {
  return TIZEN_TEXT_KEYS.get(event.keyCode) ?? null;
}
