/**
 * M3U entries → catalog items (architecture.md §1.4 steps 5-6): classification, names,
 * normalization, ContentKeys, catch-up facts and stream hints. Streaming like the parser
 * underneath: `push` chunks of text, get the items each chunk completed.
 */

import { M3uKeyAllocator } from './content-key';
import type { M3uEntry, M3uParserOptions, M3uStats } from './m3u';
import { M3uParser } from './m3u';
import type { CatalogItem, CatchupInfo, ContentKind, StreamHints } from './model';
import { matchName, normalizeName } from './normalize';
import { cutText as cut } from './text';

/** File extensions of on-demand files. Anything else without a path hint is live. */
const VOD_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'webm', 'mpg', 'mpeg', 'flv', '3gp', 'ogv', 'divx', 'vob']);
const MOVIE_DIRS = ['/movie/', '/movies/', '/vod/'];
const SERIES_DIRS = ['/series/'];
const NO_CATCHUP = new Set(['0', 'false', 'no', 'none', 'disabled', 'off']);
/** Distinct user-agent hints kept for diagnostics. */
const MAX_USER_AGENTS = 10;

/**
 * live, movie or series, from the URL path: Xtream-style `/movie/` (or `/movies/`, `/vod/`),
 * `/series/` and `/live/` first, then a video-file extension (`.mp4`, `.mkv`…) means a movie.
 * Anything unclear is live (`.ts`, `.m3u8`, no extension). The host and query never count.
 */
export function classifyStreamUrl(url: string): ContentKind {
  let path = url;
  const query = path.search(/[?#]/);
  if (query !== -1) path = path.slice(0, query);
  const scheme = path.indexOf('://');
  if (scheme !== -1) {
    const slash = path.indexOf('/', scheme + 3);
    path = slash === -1 ? '/' : path.slice(slash);
  }
  path = path.toLowerCase();
  for (const dir of MOVIE_DIRS) if (path.indexOf(dir) !== -1) return 'movie';
  for (const dir of SERIES_DIRS) if (path.indexOf(dir) !== -1) return 'series';
  if (path.indexOf('/live/') !== -1) return 'live';
  const lastSlash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  if (dot > lastSlash && VOD_EXTENSIONS.has(path.slice(dot + 1))) return 'movie';
  return 'live';
}

export interface M3uCatalogSummary {
  /** EPG URLs from the `#EXTM3U` header (`url-tvg`, `x-tvg-url`): added as EPG sources. */
  epgUrls: string[];
  counts: Record<ContentKind, number>;
  stats: M3uStats;
  /** Distinct user-agent hints (the first 10), for diagnostics. */
  userAgents: string[];
  /** The text has HLS tags (`#EXT-X-…`): the user probably entered a stream, not a playlist. */
  looksLikeHls: boolean;
}

/** Parses one M3U source into catalog items, chunk by chunk. One instance per refresh. */
export class M3uCatalogParser {
  private readonly parser: M3uParser;
  private readonly keys: M3uKeyAllocator;
  private readonly normGroups = new Map<string, string>();
  private readonly counts: Record<ContentKind, number> = { live: 0, movie: 0, series: 0 };
  private readonly userAgents: string[] = [];

  constructor(
    private readonly src: string,
    options: M3uParserOptions = {},
  ) {
    this.keys = new M3uKeyAllocator(src);
    this.parser = new M3uParser(options);
  }

  push(chunk: string): CatalogItem[] {
    return this.items(this.parser.push(chunk));
  }

  end(): CatalogItem[] {
    return this.items(this.parser.end());
  }

  summary(): M3uCatalogSummary {
    return {
      epgUrls: this.parser.header.epgUrls.slice(),
      counts: { ...this.counts },
      stats: { ...this.parser.stats },
      userAgents: this.userAgents.slice(),
      looksLikeHls: this.parser.stats.hlsTags > 0,
    };
  }

  private items(entries: M3uEntry[]): CatalogItem[] {
    const out: CatalogItem[] = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) out[i] = this.item(entries[i]!);
    return out;
  }

  private item(entry: M3uEntry): CatalogItem {
    const attrs = entry.attrs;
    const name = cut(entry.title || attrs.get('tvg-name') || '');
    const group = cut(attrs.get('group-title') || entry.group || '');
    const radio = isTrue(attrs.get('radio'));
    const kind = radio ? 'live' : classifyStreamUrl(entry.url);
    this.counts[kind]++;
    const normName = normalizeName(name);
    const epgId = nonEmpty(attrs.get('tvg-id'));
    const key = this.keys.next({ tvgId: epgId, normName, normGroup: this.normGroup(group) });
    const tvgNameAttr = nonEmpty(attrs.get('tvg-name'));
    const tvgName = tvgNameAttr === null ? null : cut(tvgNameAttr);
    return {
      key,
      src: this.src,
      kind,
      name,
      normName,
      group,
      url: entry.url,
      logo: nonEmpty(attrs.get('tvg-logo')) ?? nonEmpty(attrs.get('logo')),
      epgId,
      tvgName: tvgName === name ? null : tvgName,
      matchName: kind === 'live' ? matchName(name) : null,
      chno: channelNumber(attrs.get('tvg-chno') ?? attrs.get('channel-number')),
      tvgShift: hoursShift(attrs.get('tvg-shift')),
      catchup: catchupInfo(attrs),
      radio,
      hints: this.hints(entry),
    };
  }

  private normGroup(group: string): string {
    let norm = this.normGroups.get(group);
    if (norm === undefined) {
      norm = normalizeName(group);
      this.normGroups.set(group, norm);
    }
    return norm;
  }

  private hints(entry: M3uEntry): StreamHints | null {
    const attrs = entry.attrs;
    const userAgent = entry.userAgent ?? nonEmpty(attrs.get('http-user-agent')) ?? nonEmpty(attrs.get('user-agent'));
    const referrer =
      entry.referrer ??
      nonEmpty(attrs.get('http-referrer')) ??
      nonEmpty(attrs.get('http-referer')) ??
      nonEmpty(attrs.get('referrer')) ??
      nonEmpty(attrs.get('referer'));
    if (userAgent === null && referrer === null) return null;
    if (userAgent !== null && this.userAgents.length < MAX_USER_AGENTS && this.userAgents.indexOf(userAgent) === -1) {
      this.userAgents.push(userAgent);
    }
    return { userAgent, referrer };
  }
}

/** Parses a whole M3U text at once (tests, small playlists). */
export function parseM3uCatalog(src: string, text: string, options: M3uParserOptions = {}): { items: CatalogItem[]; summary: M3uCatalogSummary } {
  const parser = new M3uCatalogParser(src, options);
  const items = parser.push(text);
  for (const item of parser.end()) items.push(item);
  return { items, summary: parser.summary() };
}

function catchupInfo(attrs: Map<string, string>): CatchupInfo | null {
  const modeAttr = nonEmpty(attrs.get('catchup') ?? attrs.get('catchup-type'));
  const mode = modeAttr === null ? null : modeAttr.toLowerCase();
  if (mode !== null && NO_CATCHUP.has(mode)) return null;
  const days = archiveDays(attrs.get('catchup-days') ?? attrs.get('timeshift') ?? attrs.get('tvg-rec'));
  const source = nonEmpty(attrs.get('catchup-source'));
  if (mode === null && source === null && (days === null || days === 0)) return null;
  return { mode, days, source };
}

function archiveDays(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  return Math.min(Number(text), 365);
}

function channelNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

function hoursShift(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value.trim().replace(',', '.'));
  return isFinite(n) && Math.abs(n) <= 24 ? n : 0;
}

function isTrue(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}
