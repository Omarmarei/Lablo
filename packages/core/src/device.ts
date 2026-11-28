/**
 * Device facts shared by every platform adapter. Pure functions: no DOM, no platform globals.
 */

/**
 * Performance tier. `full` covers 2020 and newer, which since ADR-012 (LG) and ADR-015 (Samsung)
 * is every TV the stores install Lablo on. `low` is left for a set below that minimum (a developer
 * install on a 2018–2019 TV, an old engine in the harness) and for tests (`?tier=low`).
 * Tier-dependent limits (EPG window, poster loading, ingest duty cycle, motion) key off this value.
 */
export type DeviceTier = 'low' | 'full';

/** First model year of the `full` tier. */
export const FULL_TIER_FROM_YEAR = 2020;

/**
 * Oldest Chromium of the `full` tier, used only when the model year is unknown:
 * 2020 sets ship Chromium 68 (webOS 5) and 69 (Tizen 5.5).
 */
export const FULL_TIER_FROM_CHROMIUM = 68;

/**
 * The tier for a device. The model year decides when it is known; otherwise the Chromium
 * version does. With neither, the answer is `full`: both platforms start at 2020, so a set the
 * version tables don't know is newer than them (a Tizen user agent names no `Chrome/`; ADR-015).
 */
export function deviceTier(facts: { modelYear: number | null; chromiumVersion: number | null }): DeviceTier {
  if (facts.modelYear !== null) return facts.modelYear >= FULL_TIER_FROM_YEAR ? 'full' : 'low';
  if (facts.chromiumVersion !== null) return facts.chromiumVersion >= FULL_TIER_FROM_CHROMIUM ? 'full' : 'low';
  return 'full';
}

/**
 * The Chromium major version in a user-agent string, or `null` when it has none
 * (some Tizen user agents omit it). Matches `Chrome/53.0…` and `HeadlessChrome/140.0…`.
 */
export function chromiumMajorFromUserAgent(userAgent: string): number | null {
  const match = /Chrome\/(\d+)\./.exec(userAgent);
  const major = match?.[1];
  return major === undefined ? null : Number(major);
}
