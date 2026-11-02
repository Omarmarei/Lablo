/**
 * Catalog domain types (architecture.md §1.4). Shared by the parsers (M3U here, Xtream in step 6),
 * the data workers (IDB records, search index) and the UI. Plain data only: every value is
 * structured-clonable, so items cross worker boundaries and go into IndexedDB as they are.
 */

/** What an item is. M3U entries under `/series/` are episodes; they are `series` too. */
export type ContentKind = 'live' | 'movie' | 'series';

export const CONTENT_KINDS: readonly ContentKind[] = ['live', 'movie', 'series'];

/** How a source delivers its catalog. Stalker/MAG portals are dropped for good (ADR-007). */
export type SourceType = 'xtream' | 'm3u';

/**
 * Stable identity of a catalog item across provider refreshes (see `content-key.ts`, ADR-009).
 * Favourites, progress and channel-number overrides reference it. Never derived from a URL.
 */
export type ContentKey = string;

/** Catch-up (archive) facts as the playlist states them. Step 6 turns them into URLs. */
export interface CatchupInfo {
  /**
   * Lower-cased `catchup` mode as written (`default`, `append`, `shift`, `flussonic`,
   * `flussonic-hls`, `flussonic-ts`, `fs`, `xc`, `vod`, or anything else a playlist invents);
   * `null` when the playlist gives archive days but no mode.
   */
  mode: string | null;
  /** Archive depth in days (`catchup-days`, `timeshift` or `tvg-rec`); `null` when not stated. */
  days: number | null;
  /** `catchup-source` URL template; `null` when absent. */
  source: string | null;
}

/**
 * Request hints a playlist attaches to a stream (`#EXTVLCOPT`, `|User-Agent=` URL suffixes,
 * `user-agent` attributes). TV players can't set these headers, so they are recorded for
 * diagnostics only (architecture.md §1.4 step 5).
 */
export interface StreamHints {
  userAgent: string | null;
  referrer: string | null;
}

/** One playable item of a source, as the ingest pipeline stores and the UI lists it. */
export interface CatalogItem {
  key: ContentKey;
  /** Id of the source it came from (`[A-Za-z0-9_-]`, no colons). */
  src: string;
  kind: ContentKind;
  /** Display name as the provider wrote it (trimmed, capped at `MAX_TEXT`). */
  name: string;
  /** `normalizeName(name)`: what search matches against. */
  normName: string;
  /** Category or group title (`''` when the provider gives none). */
  group: string;
  /** Stream URL. Holds credentials: never log it, never send it anywhere, never key on it. */
  url: string;
  logo: string | null;
  /** XMLTV channel id (`tvg-id`, or Xtream `epg_channel_id`). */
  epgId: string | null;
  /** `tvg-name` when it differs from `name` (another EPG matching candidate). */
  tvgName: string | null;
  /** `matchName(name)` for live items (EPG matching); `null` for movies and series. */
  matchName: string | null;
  /** Channel number the provider assigns (`tvg-chno`), if any. */
  chno: number | null;
  /** EPG time shift in hours (`tvg-shift`); 0 when absent. */
  tvgShift: number;
  catchup: CatchupInfo | null;
  /** Audio-only channel (`radio="true"`, or Xtream `radio_streams`). */
  radio: boolean;
  hints: StreamHints | null;
}

/** Longest display name or group title kept, in UTF-16 code units. Longer ones are cut. */
export const MAX_TEXT = 256;
