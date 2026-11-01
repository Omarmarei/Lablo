/**
 * @zoma/core: Pure TypeScript domain logic: models, ContentKey, normalization, M3U/Xtream/XMLTV parsers, search, EPG matching. No DOM, no platform globals, no fetch.
 *
 * Allowed imports are listed in CLAUDE.md ("Package boundaries") and enforced by
 * eslint-plugin-boundaries.
 */
export type { DeviceTier } from './device';
export { FULL_TIER_FROM_CHROMIUM, FULL_TIER_FROM_YEAR, chromiumMajorFromUserAgent, deviceTier } from './device';
