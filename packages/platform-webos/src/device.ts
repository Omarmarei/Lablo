/**
 * webOS platform version → model year and web engine. webOS TV 22, 23, 24 and 25 report
 * platform versions 7, 8, 9 and 10. Best-known public values (LG "Web Engine" and
 * "webOS TV versions" pages); spike S0 confirms them on real sets.
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

/** The model year of a webOS platform version (`4.1.0` → 2018, `4.5.0` → 2019), or `null`. */
export function webosModelYear(platformVersion: string): number | null {
  const v = parseVersion(platformVersion);
  if (v === null) return null;
  const release = WEBOS_MAJORS.get(v.major);
  if (release === undefined) return null;
  // webOS 3.5 (2017) and 4.5 (2019) share a major with the year before.
  return (v.major === 3 || v.major === 4) && v.minor >= 5 ? release.year + 1 : release.year;
}

/** The Chromium version a webOS release ships, for when the user agent lacks `Chrome/`. */
export function webosChromiumVersion(platformVersion: string): number | null {
  const v = parseVersion(platformVersion);
  return v === null ? null : (WEBOS_MAJORS.get(v.major)?.chromium ?? null);
}

/** The fields this adapter reads from `PalmSystem.deviceInfo` (a JSON string). */
export interface WebosDeviceInfo {
  readonly modelName?: string;
  readonly platformVersion?: string;
  readonly firmwareVersion?: string;
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
    };
  } catch {
    return {};
  }
}
