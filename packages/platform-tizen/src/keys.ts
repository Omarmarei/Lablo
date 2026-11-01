import type { Intent } from '@zoma/platform-api';

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

/** Key code → Intent, using the TV's reported codes where it has them. */
export function buildTizenKeyMap(supported: readonly TizenKey[] | null): Map<number, Intent> {
  const reported = new Map<string, number>();
  for (const key of supported ?? []) reported.set(key.name, key.code);
  const map = new Map<number, Intent>();
  for (const key of TIZEN_KEYS) map.set(reported.get(key.name) ?? key.code, key.intent);
  return map;
}
