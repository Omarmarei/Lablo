/**
 * Tizen version → model year and web engine. Best-known public values (Samsung "Web Engine
 * Specifications"); spike S0 confirms them on real sets.
 */
const TIZEN_RELEASES: ReadonlyMap<string, { year: number; chromium: number }> = new Map([
  ['3.0', { year: 2017, chromium: 47 }],
  ['4.0', { year: 2018, chromium: 56 }],
  ['5.0', { year: 2019, chromium: 63 }],
  ['5.5', { year: 2020, chromium: 69 }],
  ['6.0', { year: 2021, chromium: 76 }],
  ['6.5', { year: 2022, chromium: 85 }],
  ['7.0', { year: 2023, chromium: 94 }],
  ['8.0', { year: 2024, chromium: 108 }],
  ['9.0', { year: 2025, chromium: 120 }],
]);

/** `4.0.0.3` → `4.0`; `5.5` → `5.5`. */
function majorMinor(version: string): string {
  const [major = '', minor = '0'] = version.trim().split('.');
  return `${major}.${minor}`;
}

/** The model year of a Tizen platform version, or `null` when the version is unknown. */
export function tizenModelYear(platformVersion: string): number | null {
  return TIZEN_RELEASES.get(majorMinor(platformVersion))?.year ?? null;
}

/** The Chromium version a Tizen release ships, for user agents that omit `Chrome/`. */
export function tizenChromiumVersion(platformVersion: string): number | null {
  return TIZEN_RELEASES.get(majorMinor(platformVersion))?.chromium ?? null;
}
