/**
 * webOS version → model year and web engine. webOS TV 22, 23, 24 and 25 run webOS 7, 8, 9
 * and 10. Best-known public values (LG "Web Engine" and "webOS TV versions" pages); spike S0
 * checks them on real sets. Each release since webOS 3 ships its own Chromium, so the user
 * agent's Chromium names the release when nothing else does.
 */
const WEBOS_MAJORS: ReadonlyMap<number, { year: number; chromium: number }> = new Map([
  [3, { year: 2016, chromium: 38 }],
  [4, { year: 2018, chromium: 53 }],
  [5, { year: 2020, chromium: 68 }],
  [6, { year: 2021, chromium: 79 }],
  [7, { year: 2022, chromium: 87 }],
  [8, { year: 2023, chromium: 94 }],
  [9, { year: 2024, chromium: 108 }],
  [10, { year: 2025, chromium: 120 }],
]);

function parseVersion(version: string): { major: number; minor: number } | null {
  const match = /^(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2] ?? '0') };
}

/** The model year of a webOS version (`4.1.0` → 2018, `4.5.0` → 2019, `6.5.3` → 2021), or `null`. */
export function webosModelYear(version: string): number | null {
  const v = parseVersion(version);
  if (v === null) return null;
  const release = WEBOS_MAJORS.get(v.major);
  if (release === undefined) return null;
  // webOS 3.5 (2017) and 4.5 (2019) share a major with the year before.
  return (v.major === 3 || v.major === 4) && v.minor >= 5 ? release.year + 1 : release.year;
}

/** The Chromium version a webOS release ships, for when the user agent lacks `Chrome/`. */
export function webosChromiumVersion(version: string): number | null {
  const v = parseVersion(version);
  return v === null ? null : (WEBOS_MAJORS.get(v.major)?.chromium ?? null);
}

/**
 * The webOS major version that ships a Chromium (79 → 6), or `null` for one no release ships.
 * Chromium 38 and 53 each span two model years (2016–17, 2018–19); the earlier one is meant.
 */
export function webosMajorFromChromium(chromium: number): number | null {
  let found: number | null = null;
  WEBOS_MAJORS.forEach((release, major) => {
    if (release.chromium === chromium) found = major;
  });
  return found;
}

/**
 * The fields this adapter reads from `PalmSystem.deviceInfo` (a JSON string), and the keys the
 * string had (spike S0 records them).
 *
 * On a webOS 6 TV (relay leg 34) and in the webOS TV Simulators, `platformVersion` holds the
 * firmware (`03.53.45`), not the webOS version. LG's webOSTV.js documents `sdkVersion` as the
 * webOS TV SDK version (`6.5.3` on that TV, from `ares-device --system-info`).
 */
export interface WebosDeviceInfo {
  readonly modelName?: string;
  readonly platformVersion?: string;
  readonly firmwareVersion?: string;
  readonly sdkVersion?: string;
  /** Every key of the parsed object, in its order; absent when the string wasn't an object. */
  readonly keys?: readonly string[];
}

/** Parses `PalmSystem.deviceInfo`; tolerant of missing or malformed values. */
export function parsePalmDeviceInfo(raw: unknown): WebosDeviceInfo {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return {};
    const record = parsed as Record<string, unknown>;
    const text = (key: string): string | undefined => {
      const value = record[key];
      return typeof value === 'string' && value !== '' ? value : undefined;
    };
    return {
      modelName: text('modelName'),
      platformVersion: text('platformVersion'),
      firmwareVersion: text('firmwareVersion'),
      sdkVersion: text('sdkVersion'),
      keys: Object.keys(record),
    };
  } catch {
    return {};
  }
}

/** Where `webosVersionFacts` found the webOS version. */
export type WebosVersionSource = 'sdkVersion' | 'chromium' | 'none';

export interface WebosVersionFacts {
  /** The webOS version: `sdkVersion` (`6.5.3`), the major from the engine (`6`), or `unknown`. */
  readonly osVersion: string;
  readonly modelYear: number | null;
  readonly chromiumVersion: number | null;
  /** The firmware: `firmwareVersion`, else `platformVersion` (which holds it), else `unknown`. */
  readonly firmware: string;
  readonly versionFrom: WebosVersionSource;
}

/**
 * The webOS version, model year, engine and firmware from `PalmSystem.deviceInfo` and the user
 * agent's Chromium major. `sdkVersion` decides when the TV gives one the table knows; otherwise
 * the engine does. `platformVersion` never decides: it is the firmware (see `WebosDeviceInfo`).
 */
export function webosVersionFacts(info: WebosDeviceInfo, userAgentChromium: number | null): WebosVersionFacts {
  const firmware = info.firmwareVersion ?? info.platformVersion ?? 'unknown';
  const sdkYear = info.sdkVersion === undefined ? null : webosModelYear(info.sdkVersion);
  if (info.sdkVersion !== undefined && sdkYear !== null) {
    return {
      osVersion: info.sdkVersion,
      modelYear: sdkYear,
      chromiumVersion: userAgentChromium ?? webosChromiumVersion(info.sdkVersion),
      firmware,
      versionFrom: 'sdkVersion',
    };
  }
  const major = userAgentChromium === null ? null : webosMajorFromChromium(userAgentChromium);
  if (major !== null) {
    return { osVersion: `${major}`, modelYear: webosModelYear(`${major}`), chromiumVersion: userAgentChromium, firmware, versionFrom: 'chromium' };
  }
  return { osVersion: 'unknown', modelYear: null, chromiumVersion: userAgentChromium, firmware, versionFrom: 'none' };
}
