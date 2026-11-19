import type { DeviceInfo, DeviceTier } from '@lablo/platform-api';
import type { TelemetryEvent } from '@lablo/protocol';
import { countBucket } from '@lablo/protocol/telemetry-buckets';

/**
 * The events main records at each start (RELAY step 33b1, architecture.md §3.4): `app_start` and
 * `capability`. Each is a plain object in the shape `telemetryEventSchema` reads; main never imports
 * the schema (zod), the server checks them. No URL, host, name or login can be in either: their
 * fields are numbers, buckets, booleans and the TV's model and firmware.
 */

/** The longest cold start the schema takes (an hour). */
export const COLD_START_MAX_MS = 3_600_000;
/** A model's or firmware's longest name (the protocol's `deviceName`). */
export const DEVICE_NAME_MAX = 64;

/** A time as the schema takes it: whole milliseconds from 0 to an hour (step 33b2 shares it). */
export function eventMs(ms: number): number {
  const rounded = Math.round(ms);
  return rounded > 0 ? Math.min(rounded, COLD_START_MAX_MS) : 0;
}

/** `app_start`: the tier, how long the start screen took to paint, and the catalog's size bucket. */
export function appStartEvent(at: number, tier: DeviceTier, coldStartMs: number, items: number): TelemetryEvent {
  return { kind: 'app_start', at, tier, coldStartMs: eventMs(coldStartMs), catalog: countBucket(items) };
}

/** Whether `code` is in the protocol's `deviceName` set: letters, digits, space and `._()+-`. */
function nameChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 32 ||
    code === 46 ||
    code === 95 ||
    code === 40 ||
    code === 41 ||
    code === 43 ||
    code === 45
  );
}

/**
 * A model's or firmware's name as the protocol takes it: characters outside its set become `_`, at
 * most 64 of them, `unknown` when none is left.
 */
export function deviceName(text: string): string {
  let out = '';
  for (let i = 0; i < text.length && out.length < DEVICE_NAME_MAX; i++) {
    const code = text.charCodeAt(i);
    out += nameChar(code) ? text.charAt(i) : '_';
  }
  return out === '' ? 'unknown' : out;
}

/** The feature probes the app reads at a start: the engine decisions they inform, nothing else. */
export interface DeviceProbes {
  /** `MediaSource` exists (the MSE engine could run). */
  readonly mse: boolean;
  /** The video element says it may play an HEVC MP4. */
  readonly hevc: boolean;
}

/** What the probes look at (the page's `window`; tests pass a stand-in). */
export interface ProbeHost {
  readonly MediaSource?: unknown;
  readonly document: { createElement(tag: 'video'): { canPlayType(type: string): string } };
}

/** An HEVC Main profile MP4 at level 3.1, as `canPlayType` asks for it. */
export const HEVC_TYPE = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

/** The start's probes; one that throws counts as no. */
export function deviceProbes(host: ProbeHost): DeviceProbes {
  let hevc = false;
  try {
    hevc = host.document.createElement('video').canPlayType(HEVC_TYPE) !== '';
  } catch {
    hevc = false;
  }
  return { mse: typeof host.MediaSource === 'function', hevc };
}

/**
 * `capability`: the model, the firmware, the engine's Chromium major and the probes. The screen
 * reader's state stays out: it is a disability signal.
 */
export function capabilityEvent(at: number, info: DeviceInfo, probes: DeviceProbes): TelemetryEvent {
  const chromium = info.chromiumVersion;
  const found: Record<string, boolean | number> = { lowTier: info.tier === 'low', mse: probes.mse, hevc: probes.hevc };
  if (info.modelYear !== null) found['year'] = info.modelYear;
  return {
    kind: 'capability',
    at,
    model: deviceName(info.model),
    firmware: deviceName(info.firmware),
    chromium: chromium !== null && chromium >= 1 && chromium <= 999 && Math.floor(chromium) === chromium ? chromium : null,
    probes: found,
  };
}
