/**
 * @zoma/core: Pure TypeScript domain logic: models, ContentKey, normalization, M3U/Xtream/XMLTV and subtitle (SRT/WebVTT/ASS) parsers, search, EPG matching. No DOM, no platform globals, no fetch.
 *
 * Allowed imports are listed in CLAUDE.md ("Package boundaries") and enforced by
 * eslint-plugin-boundaries.
 */
export type { DeviceTier } from './device';
export { FULL_TIER_FROM_CHROMIUM, FULL_TIER_FROM_YEAR, chromiumMajorFromUserAgent, deviceTier } from './device';

export type { CatalogItem, CatchupInfo, ContentKey, ContentKind, SourceType, StreamHints } from './model';
export { CONTENT_KINDS, MAX_TEXT } from './model';

export { matchName, normalizeName } from './normalize';
export { normalizeLang } from './language';
export type { TextDirection } from './bidi';
export { firstStrongDirection, isolateText, stripIsolates } from './bidi';
export type { PluralCategory, PluralLanguage } from './plural';
export { PLURAL_CATEGORIES, pluralCategory, pluralLanguage } from './plural';
export { hash53, hash53Base36 } from './hash';

export type { M3uKeyFields, ParsedContentKey, XtreamKeyKind } from './content-key';
export { M3uKeyAllocator, isSourceId, m3uKeyHash, parseContentKey, xtreamKey } from './content-key';

export type { M3uEntry, M3uHeader, M3uParserOptions, M3uStats } from './m3u';
export { DEFAULT_MAX_LINE_LENGTH, MAX_ATTRIBUTES, M3uParser } from './m3u';

export type { M3uCatalogSummary } from './m3u-catalog';
export { M3uCatalogParser, classifyStreamUrl, parseM3uCatalog } from './m3u-catalog';

export { collapseSpace, cutText, decodeBase64Utf8 } from './text';

export type { ParsedSubtitles, SubtitleCue, SubtitleFormat, SubtitleParserOptions, SubtitleStats } from './subtitles';
export { DEFAULT_MAX_CUES, DEFAULT_SUBTITLE_LINE_LENGTH, MAX_CUE_TEXT, SubtitleParser, SubtitleTrack, cueText, parseSubtitleClock, parseSubtitles } from './subtitles';

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

export type { TextResponse, TextTransport, XtreamErrorCode } from './xtream-base';
export { XtreamError, xFlag, xId, xInt, xNumber, xText, xtreamJson } from './xtream-base';
export type { XtreamEpgEntry } from './xtream-epg';
export { decodeShortEpg, xtreamEpgProgrammes, xtreamShortEpg } from './xtream-epg';
export type {
  XtreamAccountProblem,
  XtreamCategory,
  XtreamDecodeContext,
  XtreamEpisode,
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
export { XtreamClient, XtreamListParser, decodeCategory, decodeListItem, decodeLogin, decodeSeriesInfo, decodeVodInfo, xtreamAccountProblem } from './xtream';

export type { PanelClock, PanelZone, ZoneOffset, ZoneSource } from './timezone';
export { UTC_ZONE, clockOffset, fixedZone, intlZone, panelZone, wallParts } from './timezone';

export type { CatchupMode, CatchupOptions, CatchupWindow, FlussonicForm } from './catchup';
export { catchupMode, fillCatchupTemplate, flussonicCatchupUrl, m3uCatchupUrl, xtreamCatchupUrl } from './catchup';

export type { XmltvChannel, XmltvItem, XmltvOptions, XmltvProgramme, XmltvStats } from './xmltv';
export { XmltvTokenizer, decodeXmlEntities, parseXmltv, parseXmltvTime, xmltvTimeHasZone } from './xmltv';

export type { EpgChannelMatch, EpgMatchMethod, EpgMatchStats, EpgOverride, EpgSourceMatch, EpgWantedChannel } from './epg-match';
export { EPG_MATCH_METHODS, EpgMatcher, EpgWantedSet, combineEpgMatches, epgMethodRank, epgWantedChannel, xmltvIdStem } from './epg-match';

export type { EpgBucket, EpgGuideOptions, EpgGuideStats, EpgProgramme, EpgSchedule, EpgSourceReport, EpgTierWindow, EpgWindow } from './epg-guide';
export {
  EPG_DAY_MINUTES,
  EPG_DEFAULT_LENGTH,
  EPG_FLAG_CUT,
  EPG_FLAG_STOP_GUESSED,
  EPG_FLAG_TIME_REPAIRED,
  EPG_MAX_LENGTH,
  EPG_WINDOWS,
  EpgBucketBuilder,
  EpgGuideReader,
  buildEpgBucket,
  epgDay,
  epgNowNext,
  epgProgrammes,
  epgSchedule,
  epgWindow,
  formatEpgReport,
  mergeEpgBuckets,
} from './epg-guide';

export type { ChunkRef, FavouriteMarks, SearchHit, SearchMatch, SearchOptions, SearchResult, SearchSegmentData } from './search';
export {
  SEARCH_INDEX_VERSION,
  SEARCH_LIMIT,
  SEARCH_LIMIT_MAX,
  SEARCH_SEPARATOR,
  SearchIndexBuilder,
  SearchIndexError,
  SearchSegment,
  buildSearchSegment,
  favouriteMarks,
  searchSegments,
  searchTerms,
} from './search';
