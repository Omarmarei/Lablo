/**
 * Tolerant Xtream Codes client (architecture.md §1.4 step 5). Pure: the HTTP transport is
 * injected (`TextTransport`; the data layer supplies fetch or XHR in step 8), so this file only
 * builds URLs and decodes `player_api.php` answers.
 *
 * Panels disagree on types: numbers come as numbers or numeric strings, `null` as `""`, flags as
 * `1`/`"1"`/`true`, and series episodes as an object keyed by season, an array of arrays, or a
 * flat array. The decoders accept all of these and skip (and count) what they can't use, such as
 * an item without a usable id. List endpoints stream through the JSON-array splitter.
 *
 * Never log or key on URLs or credentials. Errors carry a code and an HTTP status only.
 */

import { xtreamKey } from './content-key';
import type { CatchupWindow } from './catchup';
import { xtreamCatchupUrl } from './catchup';
import type { JsonSplitterOptions, JsonSplitterStats } from './json-splitter';
import { JsonArraySplitter } from './json-splitter';
import type { CatalogItem, ContentKey, ContentKind } from './model';
import { matchName, normalizeName } from './normalize';
import { cutText } from './text';
import type { PanelZone } from './timezone';
import { panelZone } from './timezone';
import type { XtreamAccount, XtreamStreamKind } from './xtream-url';
import { streamExtension, xtreamApiUrl, xtreamStreamUrl } from './xtream-url';
import type { Obj, TextResponse, TextTransport } from './xtream-base';
import { XtreamError, isObj, positiveInt, readAll, xFlag, xId, xInt, xNumber, xText, xtreamJson, xtreamOpen } from './xtream-base';
import type { XtreamEpgEntry } from './xtream-epg';
import { xtreamShortEpg } from './xtream-epg';

// The plumbing and the short EPG have files of their own (RELAY step 9c): a bundle that only
// asks for a channel's short EPG (the query worker) then leaves the list parser out.
export type { TextResponse, TextTransport, XtreamErrorCode } from './xtream-base';
export { XtreamError, xFlag, xId, xInt, xNumber, xText } from './xtream-base';
export type { XtreamEpgEntry } from './xtream-epg';
export { decodeShortEpg, xtreamEpgProgrammes } from './xtream-epg';

function textOrNull(v: unknown): string | null {
  const text = xText(v);
  return text.length > 0 ? text : null;
}

function yearOf(...values: unknown[]): number | null {
  for (const v of values) {
    const n = xInt(v);
    if (n !== null && n >= 1880 && n <= 2100) return n;
    const m = /^\s*(\d{4})/.exec(xText(v));
    if (m) {
      const y = Number(m[1]);
      if (y >= 1880 && y <= 2100) return y;
    }
  }
  return null;
}

/** Rating out of 10 (`rating`, else `rating_5based` × 2). */
function ratingOf(o: Obj): number | null {
  const r = xNumber(o['rating']);
  if (r !== null && r > 0 && r <= 10) return r;
  const r5 = xNumber(o['rating_5based']);
  return r5 !== null && r5 > 0 && r5 <= 5 ? Math.round(r5 * 20) / 10 : null;
}

/** `duration_secs`, else `duration` as `HH:MM:SS` or minutes. */
function durationOf(o: Obj): number | null {
  const secs = xInt(o['duration_secs']);
  if (secs !== null && secs > 0) return secs;
  const text = xText(o['duration']);
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] === undefined ? 0 : Number(m[3]));
  const minutes = xInt(o['episode_run_time']);
  return minutes !== null && minutes > 0 ? minutes * 60 : null;
}

function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(xText).filter((s) => s.length > 0);
  const one = xText(v);
  return one.length > 0 ? [one] : [];
}

// ---------------------------------------------------------------------------------------------
// Login, categories, lists

/** Why a panel that accepted a login serves the account nothing. */
export type XtreamAccountProblem = 'expired' | 'blocked';

/**
 * What an accepted login's `user_info.status` says (RELAY step 13b). Panels keep accepting an
 * expired, banned or disabled account's login but serve it no lists, so the status is the only
 * place the user can learn why. Only the status decides: an `exp_date` in the past with an
 * `Active` status still loads (panels update it late, or write it in another zone), and so does a
 * status we don't know.
 */
export function xtreamAccountProblem(user: Pick<XtreamUserInfo, 'status'>): XtreamAccountProblem | null {
  const status = user.status.toLowerCase();
  if (status === 'expired') return 'expired';
  if (status === 'banned' || status === 'disabled') return 'blocked';
  return null;
}

export interface XtreamUserInfo {
  auth: boolean;
  /** `Active`, `Expired`, `Banned`, `Disabled`… as the panel writes it. */
  status: string;
  /** Expiry, epoch seconds; `null` for "never" (or not stated). */
  expDate: number | null;
  isTrial: boolean;
  activeCons: number | null;
  maxConnections: number | null;
  createdAt: number | null;
  message: string;
  outputFormats: string[];
}

export interface XtreamServerInfo {
  url: string;
  port: string;
  httpsPort: string;
  protocol: string;
  /** IANA zone the panel runs in (catch-up start times are wall time there). */
  timezone: string | null;
  /** Panel clock, epoch seconds. */
  timestampNow: number | null;
  /** Panel clock as wall time, `YYYY-MM-DD HH:MM:SS`. */
  timeNow: string | null;
}

export interface XtreamLogin {
  user: XtreamUserInfo;
  server: XtreamServerInfo | null;
}

/** Decodes the answer to `player_api.php` without an action; `null` when it has no `user_info`. */
export function decodeLogin(v: unknown): XtreamLogin | null {
  if (!isObj(v) || !isObj(v['user_info'])) return null;
  const u = v['user_info'];
  const status = xText(u['status']);
  const s = v['server_info'];
  return {
    user: {
      auth: 'auth' in u ? xFlag(u['auth']) : status.length > 0,
      status,
      expDate: positiveInt(u['exp_date']),
      isTrial: xFlag(u['is_trial']),
      activeCons: xInt(u['active_cons']),
      maxConnections: xInt(u['max_connections']),
      createdAt: positiveInt(u['created_at']),
      message: cutText(xText(u['message']), 1000),
      outputFormats: stringList(u['allowed_output_formats']),
    },
    server: isObj(s)
      ? {
          url: xText(s['url']),
          port: xText(s['port']),
          httpsPort: xText(s['https_port']),
          protocol: xText(s['server_protocol']),
          timezone: textOrNull(s['timezone']),
          timestampNow: positiveInt(s['timestamp_now']),
          timeNow: textOrNull(s['time_now']),
        }
      : null,
  };
}

export interface XtreamCategory {
  id: string;
  name: string;
  parentId: string | null;
}

export function decodeCategory(v: unknown): XtreamCategory | null {
  if (!isObj(v)) return null;
  const id = xId(v['category_id']);
  if (id === null) return null;
  const parent = xId(v['parent_id']);
  return { id, name: cutText(xText(v['category_name'])), parentId: parent === null || parent === '0' ? null : parent };
}

/** A list item with the panel facts a CatalogItem has no field for. */
export interface XtreamListItem {
  item: CatalogItem;
  /** The panel's stream id (series id for series). */
  id: string;
  /** Panel category id; `''` when none. */
  categoryId: string;
  /** When the panel added (or last changed) it, epoch seconds. */
  added: number | null;
  /** The panel's adult flag (`is_adult`); groups are also checked by name later (step 38). */
  adult: boolean;
  /** Out of 10. */
  rating: number | null;
  year: number | null;
}

export interface XtreamDecodeContext {
  /** Source id for ContentKeys. */
  src: string;
  account: XtreamAccount;
  /** Category id → name, from the matching `get_*_categories` (`''` group when missing). */
  categories?: Map<string, string>;
  /** Live URL format; the player's URL strategy may switch it later. Default `ts`. */
  liveExt?: 'ts' | 'm3u8';
}

const ID_FIELD: Record<ContentKind, string> = { live: 'stream_id', movie: 'stream_id', series: 'series_id' };

/** Decodes one element of `get_live_streams`, `get_vod_streams` or `get_series`; `null` if unusable. */
export function decodeListItem(kind: ContentKind, v: unknown, ctx: XtreamDecodeContext): XtreamListItem | null {
  if (!isObj(v)) return null;
  const id = xId(v[ID_FIELD[kind]]);
  if (id === null) return null;
  const name = cutText(xText(v['name']) || xText(v['title']));
  const categoryId = xId(v['category_id']) ?? '';
  const group = ctx.categories?.get(categoryId) ?? '';
  const normName = normalizeName(name);
  const base = {
    key: xtreamKey(ctx.src, kind, id),
    src: ctx.src,
    kind,
    name,
    normName,
    group,
    tvgName: null,
    tvgShift: 0,
    hints: null,
  };
  let item: CatalogItem;
  let added: number | null;
  if (kind === 'live') {
    const type = xText(v['stream_type']).toLowerCase();
    // Catch-up needs the flag; `tv_archive_duration` alone (often 0 or stale) doesn't count.
    const archive = xFlag(v['tv_archive']);
    const days = positiveInt(v['tv_archive_duration']);
    item = {
      ...base,
      url: xtreamStreamUrl(ctx.account, 'live', id, ctx.liveExt ?? 'ts'),
      logo: textOrNull(v['stream_icon']),
      epgId: textOrNull(v['epg_channel_id']),
      matchName: matchName(name),
      chno: positiveInt(v['num']),
      catchup: archive ? { mode: 'xc', days, source: null } : null,
      radio: type === 'radio_streams' || type === 'radio',
    };
    added = positiveInt(v['added']);
  } else if (kind === 'movie') {
    item = {
      ...base,
      url: xtreamStreamUrl(ctx.account, 'movie', id, streamExtension(xText(v['container_extension']), 'mp4')),
      logo: textOrNull(v['stream_icon']) ?? textOrNull(v['cover']),
      epgId: null,
      matchName: null,
      chno: null,
      catchup: null,
      radio: false,
    };
    added = positiveInt(v['added']);
  } else {
    item = {
      ...base,
      // Series play through their episodes (`get_series_info`, fetched when opened).
      url: '',
      logo: textOrNull(v['cover']) ?? textOrNull(v['stream_icon']),
      epgId: null,
      matchName: null,
      chno: null,
      catchup: null,
      radio: false,
    };
    added = positiveInt(v['last_modified']) ?? positiveInt(v['added']);
  }
  return {
    item,
    id,
    categoryId,
    added,
    adult: xFlag(v['is_adult']),
    rating: ratingOf(v),
    year: yearOf(v['year'], v['releaseDate'], v['release_date']),
  };
}

export interface XtreamListStats {
  /** Items decoded. */
  items: number;
  /** Elements that weren't valid JSON. */
  badJson: number;
  /** Valid JSON that isn't a usable item (no id, not an object…). */
  skipped: number;
  /** Duplicate ids (the first one wins). */
  duplicates: number;
  json: JsonSplitterStats;
}

/**
 * Streams one list response (`get_live_streams`, `get_vod_streams`, `get_series`) into items:
 * `push` text chunks, get the items each chunk completed. One instance per response.
 */
export class XtreamListParser {
  private readonly splitter: JsonArraySplitter;
  private readonly seen = new Set<string>();
  private readonly counts = { items: 0, badJson: 0, skipped: 0, duplicates: 0 };

  constructor(
    private readonly kind: ContentKind,
    private readonly ctx: XtreamDecodeContext,
    options: JsonSplitterOptions = {},
  ) {
    this.splitter = new JsonArraySplitter(options);
  }

  push(chunk: string): XtreamListItem[] {
    return this.decode(this.splitter.push(chunk));
  }

  end(): XtreamListItem[] {
    return this.decode(this.splitter.end());
  }

  stats(): XtreamListStats {
    return { ...this.counts, json: { ...this.splitter.stats } };
  }

  private decode(elements: string[]): XtreamListItem[] {
    const out: XtreamListItem[] = [];
    for (const text of elements) {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        this.counts.badJson++;
        continue;
      }
      const item = decodeListItem(this.kind, value, this.ctx);
      if (item === null) {
        this.counts.skipped++;
      } else if (this.seen.has(item.id)) {
        this.counts.duplicates++;
      } else {
        this.seen.add(item.id);
        this.counts.items++;
        out.push(item);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// Details fetched on demand (cached 24 h by the data layer)

export interface XtreamVodInfo {
  name: string;
  plot: string;
  genre: string;
  cast: string;
  director: string;
  releaseDate: string;
  durationSecs: number | null;
  rating: number | null;
  cover: string | null;
  backdrops: string[];
  trailer: string | null;
  /** `container_extension` from `movie_data`, if any. */
  ext: string | null;
}

/** Decodes `get_vod_info`; `null` for "not found" (`[]`) or anything without an `info` object. */
export function decodeVodInfo(v: unknown): XtreamVodInfo | null {
  if (!isObj(v) || !isObj(v['info'])) return null;
  const info = v['info'];
  const data = isObj(v['movie_data']) ? v['movie_data'] : {};
  return {
    name: cutText(xText(info['name']) || xText(data['name'])),
    plot: cutText(xText(info['plot']) || xText(info['description']), 2000),
    genre: cutText(xText(info['genre'])),
    cast: cutText(xText(info['cast']) || xText(info['actors']), 1000),
    director: cutText(xText(info['director'])),
    releaseDate: xText(info['releasedate']) || xText(info['release_date']),
    durationSecs: durationOf(info),
    rating: ratingOf(info),
    cover: textOrNull(info['cover_big']) ?? textOrNull(info['movie_image']),
    backdrops: stringList(info['backdrop_path']),
    trailer: textOrNull(info['youtube_trailer']),
    ext: textOrNull(data['container_extension']),
  };
}

export interface XtreamSeason {
  number: number;
  name: string;
  cover: string | null;
  episodeCount: number | null;
}

export interface XtreamEpisode {
  key: ContentKey;
  id: string;
  season: number;
  episodeNum: number | null;
  title: string;
  url: string;
  durationSecs: number | null;
  plot: string;
  image: string | null;
  added: number | null;
}

export interface XtreamSeriesInfo {
  name: string;
  plot: string;
  genre: string;
  cast: string;
  director: string;
  rating: number | null;
  cover: string | null;
  backdrops: string[];
  seasons: XtreamSeason[];
  /** Sorted by season, then episode number. */
  episodes: XtreamEpisode[];
  /** Episodes skipped (no usable id, or a duplicate id). */
  skipped: number;
}

/** The episode objects of `episodes`, with the season each was listed under. */
function episodeObjects(v: unknown): { o: Obj; season: number | null }[] {
  const out: { o: Obj; season: number | null }[] = [];
  const add = (list: unknown, season: number | null): void => {
    if (Array.isArray(list)) {
      for (const e of list) {
        if (Array.isArray(e)) add(e, season);
        else if (isObj(e)) out.push({ o: e, season });
      }
    } else if (isObj(list)) {
      // A season's episodes keyed by index ("1": {...}) instead of an array.
      for (const k of Object.keys(list)) add([list[k]], season);
    }
  };
  if (isObj(v)) for (const key of Object.keys(v)) add(v[key], xInt(key));
  else add(v, null);
  return out;
}

/** Decodes `get_series_info`; `null` for "not found" (`[]`) or a body without `episodes` or `info`. */
export function decodeSeriesInfo(v: unknown, ctx: XtreamDecodeContext): XtreamSeriesInfo | null {
  if (!isObj(v) || (!('episodes' in v) && !isObj(v['info']))) return null;
  const info = isObj(v['info']) ? v['info'] : {};
  const seasons: XtreamSeason[] = [];
  if (Array.isArray(v['seasons'])) {
    for (const s of v['seasons']) {
      if (!isObj(s)) continue;
      const number = xInt(s['season_number']) ?? xInt(s['id']);
      if (number === null) continue;
      seasons.push({
        number,
        name: cutText(xText(s['name'])),
        cover: textOrNull(s['cover_big']) ?? textOrNull(s['cover']),
        episodeCount: xInt(s['episode_count']),
      });
    }
  }
  const episodes: XtreamEpisode[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const { o, season: listedSeason } of episodeObjects(v['episodes'])) {
    const id = xId(o['id']) ?? xId(o['stream_id']);
    if (id === null || seen.has(id)) {
      skipped++;
      continue;
    }
    seen.add(id);
    const epInfo = isObj(o['info']) ? o['info'] : {};
    const season = xInt(o['season']) ?? listedSeason ?? xInt(epInfo['season']) ?? 1;
    episodes.push({
      key: xtreamKey(ctx.src, 'episode', id),
      id,
      season,
      episodeNum: xInt(o['episode_num']),
      title: cutText(xText(o['title'])),
      url: xtreamStreamUrl(ctx.account, 'series', id, streamExtension(xText(o['container_extension']), 'mp4')),
      durationSecs: durationOf(epInfo),
      plot: cutText(xText(epInfo['plot']), 2000),
      image: textOrNull(epInfo['movie_image']) ?? textOrNull(epInfo['cover_big']),
      added: positiveInt(o['added']),
    });
  }
  const order = (n: number | null): number => (n === null ? Number.MAX_SAFE_INTEGER : n);
  episodes.sort((a, b) => a.season - b.season || order(a.episodeNum) - order(b.episodeNum));
  for (const e of episodes) {
    if (!seasons.some((s) => s.number === e.season)) seasons.push({ number: e.season, name: '', cover: null, episodeCount: null });
  }
  seasons.sort((a, b) => a.number - b.number);
  return {
    name: cutText(xText(info['name']) || xText(info['title'])),
    plot: cutText(xText(info['plot']), 2000),
    genre: cutText(xText(info['genre'])),
    cast: cutText(xText(info['cast']), 1000),
    director: cutText(xText(info['director'])),
    rating: ratingOf(info),
    cover: textOrNull(info['cover']),
    backdrops: stringList(info['backdrop_path']),
    seasons,
    episodes,
    skipped,
  };
}

// ---------------------------------------------------------------------------------------------
// Client

const LIST_ACTION: Record<ContentKind, string> = { live: 'get_live_streams', movie: 'get_vod_streams', series: 'get_series' };
const CATEGORY_ACTION: Record<ContentKind, string> = { live: 'get_live_categories', movie: 'get_vod_categories', series: 'get_series_categories' };

export interface XtreamListOptions {
  categories?: Map<string, string>;
  /** Only this category (`&category_id=`): the low-tier fallback loads categories lazily. */
  categoryId?: string;
  liveExt?: 'ts' | 'm3u8';
  splitter?: JsonSplitterOptions;
}

export class XtreamClient {
  private loginInfo: XtreamLogin | null = null;

  constructor(
    readonly account: XtreamAccount,
    private readonly transport: TextTransport,
    readonly src: string,
  ) {}

  /** Checks the credentials. Throws `XtreamError('auth')` when the panel rejects them. */
  async login(): Promise<XtreamLogin> {
    const login = decodeLogin(await this.json(xtreamApiUrl(this.account)));
    if (login === null) throw new XtreamError('format');
    if (!login.user.auth) throw new XtreamError('auth');
    this.loginInfo = login;
    return login;
  }

  /** The panel's zone for catch-up URLs (UTC until `login()` has run). */
  zone(): PanelZone {
    return panelZone(this.loginInfo ? this.loginInfo.server : null);
  }

  async categories(kind: ContentKind): Promise<XtreamCategory[]> {
    const res = await this.open(xtreamApiUrl(this.account, CATEGORY_ACTION[kind]));
    const splitter = new JsonArraySplitter();
    const out: XtreamCategory[] = [];
    const take = (elements: string[]): void => {
      for (const text of elements) {
        try {
          const c = decodeCategory(JSON.parse(text));
          if (c !== null) out.push(c);
        } catch {
          // A broken element: skip it.
        }
      }
    };
    await readAll(res, (chunk) => take(splitter.push(chunk)));
    take(splitter.end());
    return out;
  }

  /**
   * Streams a whole list, handing over items as each chunk completes them. `onItems` may return
   * a promise (to write a batch, or to pause while the UI is busy); reading waits for it.
   */
  async list(kind: ContentKind, onItems: (items: XtreamListItem[]) => void | Promise<void>, options: XtreamListOptions = {}): Promise<XtreamListStats> {
    const res = await this.open(xtreamApiUrl(this.account, LIST_ACTION[kind], { category_id: options.categoryId }));
    const parser = new XtreamListParser(
      kind,
      { src: this.src, account: this.account, categories: options.categories, liveExt: options.liveExt },
      options.splitter,
    );
    await readAll(res, async (chunk) => {
      const items = parser.push(chunk);
      if (items.length > 0) await onItems(items);
    });
    const rest = parser.end();
    if (rest.length > 0) await onItems(rest);
    return parser.stats();
  }

  async vodInfo(vodId: string | number): Promise<XtreamVodInfo | null> {
    return decodeVodInfo(await this.json(xtreamApiUrl(this.account, 'get_vod_info', { vod_id: vodId })));
  }

  async seriesInfo(seriesId: string | number): Promise<XtreamSeriesInfo | null> {
    return decodeSeriesInfo(await this.json(xtreamApiUrl(this.account, 'get_series_info', { series_id: seriesId })), {
      src: this.src,
      account: this.account,
    });
  }

  shortEpg(streamId: string | number, limit = 4): Promise<XtreamEpgEntry[]> {
    return xtreamShortEpg(this.account, this.transport, streamId, limit);
  }

  streamUrl(kind: XtreamStreamKind, id: string | number, ext: string): string {
    return xtreamStreamUrl(this.account, kind, id, ext);
  }

  /** The `/timeshift/` URL for a programme on a live stream, in the panel's zone. */
  catchupUrl(streamId: string | number, window: CatchupWindow, ext = 'ts'): string {
    return xtreamCatchupUrl(this.account, streamId, window, this.zone().offset, ext);
  }

  private open(url: string): Promise<TextResponse> {
    return xtreamOpen(this.transport, url);
  }

  private json(url: string): Promise<unknown> {
    return xtreamJson(this.transport, url);
  }
}
