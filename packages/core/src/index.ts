/**
 * @zoma/core: Pure TypeScript domain logic: models, ContentKey, normalization, M3U/Xtream/XMLTV parsers, search, EPG matching. No DOM, no platform globals, no fetch.
 *
 * Allowed imports are listed in CLAUDE.md ("Package boundaries") and enforced by
 * eslint-plugin-boundaries.
 */
export type { DeviceTier } from './device';
export { FULL_TIER_FROM_CHROMIUM, FULL_TIER_FROM_YEAR, chromiumMajorFromUserAgent, deviceTier } from './device';

export type { CatalogItem, CatchupInfo, ContentKey, ContentKind, SourceType, StreamHints } from './model';
export { CONTENT_KINDS, MAX_TEXT } from './model';

export { matchName, normalizeName } from './normalize';
export { hash53, hash53Base36 } from './hash';

export type { M3uKeyFields, ParsedContentKey, XtreamKeyKind } from './content-key';
export { M3uKeyAllocator, isSourceId, m3uKeyHash, parseContentKey, xtreamKey } from './content-key';

export type { M3uEntry, M3uHeader, M3uParserOptions, M3uStats } from './m3u';
export { DEFAULT_MAX_LINE_LENGTH, MAX_ATTRIBUTES, M3uParser } from './m3u';

export type { M3uCatalogSummary } from './m3u-catalog';
export { M3uCatalogParser, classifyStreamUrl, parseM3uCatalog } from './m3u-catalog';
