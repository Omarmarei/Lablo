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

export { collapseSpace, cutText, decodeBase64Utf8 } from './text';

export type { JsonShape, JsonSplitterOptions, JsonSplitterStats } from './json-splitter';
export { DEFAULT_MAX_ELEMENT_LENGTH, JsonArraySplitter, splitJsonArray } from './json-splitter';

export type { XtreamAccount, XtreamStreamKind, XtreamStreamUrl } from './xtream-url';
export {
  normalizeXtreamBase,
  parseQuery,
  parseXtreamStreamUrl,
  streamExtension,
  xtreamApiUrl,
  xtreamFromM3uUrl,
  xtreamM3uUrl,
  xtreamStreamUrl,
  xtreamXmltvUrl,
} from './xtream-url';

export type {
  TextResponse,
  TextTransport,
  XtreamCategory,
  XtreamDecodeContext,
  XtreamEpgEntry,
  XtreamEpisode,
  XtreamErrorCode,
  XtreamListItem,
  XtreamListOptions,
  XtreamListStats,
  XtreamLogin,
  XtreamSeason,
  XtreamSeriesInfo,
  XtreamServerInfo,
  XtreamUserInfo,
  XtreamVodInfo,
} from './xtream';
export {
  XtreamClient,
  XtreamError,
  XtreamListParser,
  decodeCategory,
  decodeListItem,
  decodeLogin,
  decodeSeriesInfo,
  decodeShortEpg,
  decodeVodInfo,
  xFlag,
  xId,
  xInt,
  xNumber,
  xText,
} from './xtream';

export type { PanelClock, PanelZone, ZoneOffset, ZoneSource } from './timezone';
export { UTC_ZONE, clockOffset, fixedZone, intlZone, panelZone, wallParts } from './timezone';

export type { CatchupMode, CatchupOptions, CatchupWindow, FlussonicForm } from './catchup';
export { catchupMode, fillCatchupTemplate, flussonicCatchupUrl, m3uCatchupUrl, xtreamCatchupUrl } from './catchup';

export type { XmltvChannel, XmltvItem, XmltvOptions, XmltvProgramme, XmltvStats } from './xmltv';
export { XmltvTokenizer, decodeXmlEntities, parseXmltv, parseXmltvTime } from './xmltv';
