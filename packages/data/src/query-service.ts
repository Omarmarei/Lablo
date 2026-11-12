/**
 * The query worker's service (architecture.md §1.2, §1.4 step 11): it stays running, keeps the
 * active generations' search segments in memory, and answers the UI's catalog reads over RPC.
 *
 * - `search` ranks over every loaded segment (core `searchSegments`), with the favourites set
 *   by `setFavourites` boosted. Hits name their generation and chunk; `items` resolves them.
 * - `categories`, `chunk` and `items` read the active generation from IndexedDB, with a small
 *   chunk cache (the visible pages of a list touch the same few chunks).
 * - `reload` re-reads `sources_meta` and the segments, after an ingest swapped a generation, and
 *   the guides' match tables, after an EPG refresh swapped one. It runs lazily before the first
 *   read too.
 * - `nowNext` gives the programme on air and the next one for live channels (step 9b): the
 *   guides' match tables are combined in priority order (core `combineEpgMatches`), and each
 *   channel's buckets of the days around now are read from IndexedDB, with its tvg-shift applied.
 *   Every read of a guide's programmes adds the user's time offset for that guide (step 24b) to
 *   the tvg-shift: the offsets are read from the profile at each reload, and an `editProfile`
 *   that changes them applies them at once (no reload; an older read answering later is dropped).
 * - `guide` gives the grid guide its rows (step 23a): each live channel's programmes over a time
 *   range, from the same guide channel as its now/next, as plain arrays.
 * - `programme` gives the programme details one programme (step 24a): its description, episode
 *   and the rest, from the one bucket that holds its start.
 * - `epgStatus` lists the guides and how many live channels have one, and the key of the profile's
 *   manual mappings (step 24d): a guide matched with others is due for a refresh.
 * - `guideChannels` searches the XMLTV channels the guides declare (step 24d: the manual mapping's
 *   picker), by their names normalized as the matcher does, paged. Each guide's list is read once
 *   after a reload, when it is first asked for.
 * - `unmatched` pages through the live channels that no guide matches once the guides are
 *   combined (step 24c), in the order "All channels" lists them. Each source's list is walked
 *   once after a reload, when it is first asked for, and kept as chunk addresses; a page reads
 *   the few chunks its rows are in.
 * - `shortEpg` is the fallback for a focused live channel no guide matches (step 9c): its Xtream
 *   panel's `get_short_epg`, kept 30 min per channel (`short-epg.ts`). The app asks only after
 *   600 ms of focus. A matched channel gets its guide's now/next, with no request; a channel the
 *   user mapped to no guide (step 24d) gets none, with no request either.
 * - `account` re-checks a source's Xtream account for the player's error card (step 20a,
 *   `account-check.ts`).
 * - `vodInfo` gives a movie's details from its Xtream panel's `get_vod_info` when they open (step
 *   26c), kept 24 h per movie (`vod-info.ts`); `null` for a movie with no panel.
 * - `seriesInfo` gives a show's seasons and episodes from its Xtream panel's `get_series_info`
 *   when its details open (step 27b), kept 24 h per show (`series-info.ts`); `null` for a show
 *   with no panel.
 * - `recent` gives the newest movies across the sources asked ("Recently added", step 26e; series
 *   too since step 27a): each active generation's list kept at ingest (`recent.ts`), merged; no
 *   chunk is read.
 * - `profile` and `editProfile` read and change the profile document for the app (step 13b):
 *   onboarding's answers and the sources the user added. An edit is a read-modify-write in one
 *   transaction, like the ingest worker's favourites update, so neither can lose the other's.
 *
 * A segment that fails to load (other layout version, inconsistent data) is skipped and listed
 * in `status().stale`, so the ingest can rebuild it.
 */

import type { CatalogItem, ContentKey, ContentKind, EpgBucket, EpgMatchMethod, EpgOverride, EpgProgramme, EpgSchedule, FavouriteMarks, SearchResult, XtreamSeriesInfo, XtreamVodInfo } from '@lablo/core';
import { CONTENT_KINDS, SearchSegment, combineEpgMatches, epgDay, epgNowNext, epgProgrammeAt, epgSchedule, favouriteMarks, normalizeName, searchSegments } from '@lablo/core';
import type { CategoryInfo } from './chunker';
import type { ChunkKey, SourceMeta } from './catalog-store';
import { getSources, readCategories, readChunks, readIndexes, readRecent, scanChunks } from './catalog-store';
import type { EpgBucketKey, EpgDeclaredChannels, EpgMeta, StoredEpgMatch } from './epg-store';
import { epgDeclared, getEpgMetas, readEpgBuckets, readEpgChannels, readEpgDeclared } from './epg-store';
import { epgMappingKey, epgOverridesOf } from './epg-overrides';
import type { RpcContext } from './rpc';
import type { ByteTransport } from './bytes';
import type { LoadedProfile, ProfileDoc, ProfileEdit } from './profile';
import { applyProfileEdit, loadProfile, readEpgOffsets, readEpgOverrides, updateProfile } from './profile';
import { epgOffsetsOf } from './epg-sources';
import type { ShortEpgRequest } from './short-epg';
import { ShortEpgCache, shortEpgNowNext, shortEpgTarget, textTransport } from './short-epg';
import type { AccountCheck } from './account-check';
import { checkAccount, sourceAccount } from './account-check';
import type { SourceRecord } from './profile';
import type { VodInfoRequest } from './vod-info';
import { VodInfoCache, vodInfoTarget } from './vod-info';
import type { SeriesInfoRequest } from './series-info';
import { SeriesInfoCache, seriesInfoTarget } from './series-info';
import type { RecentItem } from './recent';
import { RECENT_MAX, mergeRecent } from './recent';

/** Where a search hit (or any item) is stored. */
export interface ItemRef {
  src: string;
  kind: ContentKind;
  gen: number;
  catIdx: number;
  chunk: number;
  slot: number;
}

export interface SearchRequest {
  query: string;
  kinds?: ContentKind[];
  /** Source order to rank by (and filter to); default: every source, by id. */
  sources?: string[];
  limit?: number;
}

export interface SegmentStatus {
  src: string;
  kind: ContentKind;
  gen: number;
  count: number;
}

export interface QueryStatus {
  sources: SourceMeta[];
  segments: SegmentStatus[];
  /** Segments that exist in `sources_meta` but couldn't be loaded (need a rebuild). */
  stale: { src: string; kind: ContentKind; gen: number; reason: string }[];
}

/** A live channel's programme now and next. */
export interface EpgNowNext {
  key: ContentKey;
  /** The guide and its XMLTV channel (`null`: no guide matches this channel). */
  epgSrc: string | null;
  channel: string | null;
  method: EpgMatchMethod | null;
  now: EpgProgramme | null;
  next: EpgProgramme | null;
}

/** A focused channel's now/next, and where it came from. */
export interface ShortEpgNowNext extends EpgNowNext {
  /**
   * `guide`: a stored guide matches the channel (no request). `panel`: its panel's short EPG.
   * `none`: no guide, and its source is no Xtream panel (or the worker has no transport).
   */
  from: 'guide' | 'panel' | 'none';
  /** The panel's answer came from the 30-minute cache: no request was made. */
  cached: boolean;
}

/** The grid guide's ask: these live channels over `[from, to)`. */
export interface GuideRequest {
  keys: ContentKey[];
  /** UTC epoch minutes: the programmes that end after `from` and start before `to`. */
  from: number;
  to: number;
}

/** One live channel's row of the grid guide. */
export interface GuideRow extends EpgSchedule {
  key: ContentKey;
  /** The guide its programmes come from (`null`: no guide matches it, so the row is empty). */
  epgSrc: string | null;
}

/** The programme details' ask (step 24a): a live channel's programme that starts at `start`. */
export interface ProgrammeRequest {
  key: ContentKey;
  /** UTC epoch minutes, after the channel's tvg-shift and its guide's offset (as `guide` gives it). */
  start: number;
}

/**
 * Most channel-day buckets one `guide` call reads: a screen's rows and a page either side over
 * two or three days is a few hundred. A larger ask is refused, not cut, so the caller can't take
 * a partial answer for the whole one.
 */
export const GUIDE_MAX_READS = 2_000;

/** The "Channels without a guide" list's ask (step 24c): rows `[offset, offset + limit)`. */
export interface UnmatchedRequest {
  /**
   * The sources in the order "All channels" lists them (the profile's); the list goes source by
   * source in this order. A source with no catalog stored adds nothing.
   */
  sources: string[];
  offset: number;
  /** 0 asks for the count alone (no chunk is read). */
  limit: number;
}

/** A live channel that no guide matches, once the guides are combined. */
export interface UnmatchedChannel {
  key: ContentKey;
  name: string;
  src: string;
  /** Its category's name as the provider wrote it (`''`: none). */
  category: string;
}

export interface UnmatchedPage {
  /**
   * Bumps at each reload (a catalog or a guide swapped): a list read at another version may
   * hold other rows now, so the caller drops its pages and asks again.
   */
  version: number;
  /** The live channels without a guide over the sources asked. */
  count: number;
  offset: number;
  /** Rows `offset` to `offset + limit` (fewer at the end, or where a chunk is gone). */
  rows: UnmatchedChannel[];
}

/** Most rows one `unmatched` call gives (a larger ask is refused, not cut, as `guide`'s). */
export const UNMATCHED_MAX_ROWS = 500;

/** One source's live channels without a guide, in "All channels" order. */
interface UnmatchedIndex {
  gen: number;
  /** Each one's category, chunk and slot, flat (three numbers per channel). */
  refs: number[];
}

export interface EpgStatus {
  /** Every stored guide, in priority order. */
  guides: EpgMeta[];
  /** Live channels that have a guide channel, over every guide. */
  matched: number;
  /** The catalog sources (their `epgUrls` and Xtream `server` decide the guides). */
  sources: SourceMeta[];
  /**
   * The key of the profile's manual mappings now (`epgMappingKey`, step 24d): a guide matched
   * with another (`EpgMeta.mapping`) is due (`epgRefreshDue`).
   */
  mapping: string;
}

/** The manual mapping picker's search (step 24d): the guides' declared channels, rows `[offset, offset + limit)`. */
export interface GuideChannelsRequest {
  /** One guide's channels; default: every active guide's, in priority order. */
  epgSrc?: string;
  /**
   * Words to look for, normalized as the matcher normalizes names: a channel is listed when each
   * word is in one of its display names or its id. Empty: every channel.
   */
  query: string;
  offset: number;
  /** 0 asks for the count alone. */
  limit: number;
}

/** An XMLTV channel a guide declares. */
export interface GuideChannel {
  epgSrc: string;
  /** Its id, as the guide declares it (what a mapping keeps). */
  id: string;
  /** The display name for the UI languages (the id when it has none). */
  name: string;
}

export interface GuideChannelsPage {
  /** Bumps at each reload (`UnmatchedPage.version`): the caller drops its pages and asks again. */
  version: number;
  /** The channels found, over the guides asked. */
  count: number;
  offset: number;
  /** Rows `offset` to `offset + limit`, guide by guide in priority order, each in the order it declares them. */
  rows: GuideChannel[];
}

/** Most rows one `guideChannels` call gives (a larger ask is refused, not cut). */
export const GUIDE_CHANNELS_MAX_ROWS = 500;

/** "Recently added"'s ask (step 26e): the newest items of one kind across `sources`. */
export interface RecentRequest {
  /**
   * The sources in the order the app lists them (on an equal date the one listed first comes
   * first). A source with no catalog stored, or one an older ingest version built, adds nothing.
   */
  sources: string[];
  kind: ContentKind;
  /** At most `RECENT_MAX` (the default); a larger ask is refused, not cut. */
  limit?: number;
}

/** The words of a normalized name (single spaces between them, none at either end). */
function wordsOf(normalized: string): string[] {
  const out: string[] = [];
  let from = 0;
  while (from < normalized.length) {
    const space = normalized.indexOf(' ', from);
    const to = space === -1 ? normalized.length : space;
    out.push(normalized.slice(from, to));
    from = to + 1;
  }
  return out;
}

/** Where a live channel's programmes are stored. */
interface EpgLink {
  epgSrc: string;
  gen: number;
  channel: string;
  method: EpgMatchMethod;
  /** The live channel's tvg-shift, in hours. */
  shift: number;
}

export interface QueryServiceOptions {
  /** Opens (and migrates) the database; called once, on first use. */
  openDb: () => Promise<IDBDatabase>;
  /** Chunks kept in memory (default 16, about 8,000 items). */
  chunkCache?: number;
  /** The clock now/next is read at when the caller gives no time (and short EPG ages by). */
  now?: () => number;
  /** The network, for the short-EPG fallback, the account re-check and the movies' details (none: no panel is asked). */
  transport?: ByteTransport;
}

const chunkId = (k: ChunkKey): string => `${k.src}|${k.gen}|${k.kind}|${k.catIdx}|${k.chunk}`;

export class QueryService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private loading: Promise<void> | null = null;
  private loaded = false;
  private sources: SourceMeta[] = [];
  private segments: SearchSegment[] = [];
  private stale: QueryStatus['stale'] = [];
  private favourites: ContentKey[] = [];
  private marks: FavouriteMarks | null = null;
  private readonly cache = new Map<string, CatalogItem[]>();
  private readonly cacheSize: number;
  private epgLinks = new Map<ContentKey, EpgLink>();
  /** The user's time offset per guide, in minutes (step 24b). */
  private epgOffsets: Record<string, number> = {};
  /** The live channels the user mapped to no guide (step 24d): no panel's short EPG either. */
  private noGuide = new Set<ContentKey>();
  /**
   * Bumps when an edit's write starts. A read takes the number as it is: it sees that edit's
   * write (IndexedDB runs them in the order they start) and none after, so an answer with a
   * lower number than the offsets (and mappings) held is older than them.
   */
  private offsetSeq = 0;
  private offsetsFrom = 0;
  /** Bumps at each reload (`UnmatchedPage.version`). */
  private version = 0;
  /** Each source's list of channels without a guide, built when first asked after a reload. */
  private unmatchedIndexes = new Map<string, Promise<UnmatchedIndex>>();
  /** The active guides in priority order, as loaded. */
  private epgActive: { epgSrc: string; gen: number }[] = [];
  /** Each guide's declared channels, read when first asked after a reload. */
  private declaredLists = new Map<string, Promise<EpgDeclaredChannels>>();
  private readonly panelEpg: ShortEpgCache | null;
  private readonly vodInfos: VodInfoCache | null;
  private readonly seriesInfos: SeriesInfoCache | null;

  constructor(private readonly options: QueryServiceOptions) {
    this.cacheSize = Math.max(1, options.chunkCache ?? 16);
    this.panelEpg = options.transport ? new ShortEpgCache(options.transport, () => this.clock()) : null;
    this.vodInfos = options.transport ? new VodInfoCache(textTransport(options.transport), () => this.clock()) : null;
    this.seriesInfos = options.transport ? new SeriesInfoCache(textTransport(options.transport), () => this.clock()) : null;
  }

  private clock(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  /** The RPC handlers (serve them with `serveRpc`). */
  handlers() {
    return {
      status: (): Promise<QueryStatus> => this.status(),
      reload: (): Promise<QueryStatus> => this.reload(),
      search: (req: SearchRequest, ctx: RpcContext): Promise<SearchResult> => this.search(req, ctx),
      setFavourites: (arg: { keys: ContentKey[] }): number => this.setFavourites(arg.keys),
      categories: (arg: { src: string; kind: ContentKind }): Promise<CategoryInfo[]> => this.categories(arg.src, arg.kind),
      chunk: (arg: { src: string; kind: ContentKind; catIdx: number; chunk: number }): Promise<CatalogItem[]> => this.chunk(arg),
      items: (arg: { refs: ItemRef[] }): Promise<(CatalogItem | null)[]> => this.items(arg.refs),
      nowNext: (arg: { keys: ContentKey[]; at?: number }): Promise<EpgNowNext[]> => this.nowNext(arg.keys, arg.at),
      guide: (req: GuideRequest): Promise<GuideRow[]> => this.guide(req),
      programme: (req: ProgrammeRequest): Promise<EpgProgramme | null> => this.programme(req),
      epgStatus: (): Promise<EpgStatus> => this.epgStatus(),
      guideChannels: (req: GuideChannelsRequest): Promise<GuideChannelsPage> => this.guideChannels(req),
      unmatched: (req: UnmatchedRequest): Promise<UnmatchedPage> => this.unmatched(req),
      shortEpg: (req: ShortEpgRequest): Promise<ShortEpgNowNext> => this.shortEpg(req),
      account: (arg: { src: string }): Promise<AccountCheck | null> => this.account(arg.src),
      vodInfo: (req: VodInfoRequest): Promise<XtreamVodInfo | null> => this.vodInfo(req),
      seriesInfo: (req: SeriesInfoRequest): Promise<XtreamSeriesInfo | null> => this.seriesInfo(req),
      recent: (req: RecentRequest): Promise<RecentItem[]> => this.recent(req),
      profile: (): Promise<LoadedProfile | null> => this.profile(),
      editProfile: (edit: ProfileEdit): Promise<boolean> => this.editProfile(edit),
    };
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.options.openDb();
      // A failed open is retried on the next call.
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.reload();
  }

  async status(): Promise<QueryStatus> {
    await this.ensureLoaded();
    return {
      sources: this.sources.map((s) => ({ ...s, counts: { ...s.counts } })),
      segments: this.segments.map((s) => ({ src: s.src, kind: s.kind, gen: s.gen, count: s.count })),
      stale: this.stale.slice(),
    };
  }

  /** Re-reads sources and search segments. Concurrent calls share one load. */
  async reload(): Promise<QueryStatus> {
    if (!this.loading) {
      this.loading = this.load().then(
        () => {
          this.loading = null;
        },
        (error: unknown) => {
          this.loading = null;
          throw error;
        },
      );
    }
    await this.loading;
    return this.status();
  }

  private async load(): Promise<void> {
    const db = await this.db();
    // First, so that an edit of the offsets or mappings made while this load runs is ordered after it.
    const offsetSeq = this.offsetSeq;
    const offsets = readEpgOffsets(db);
    const overrides = readEpgOverrides(db);
    const sources = (await getSources(db)).sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
    const keys: { src: string; gen: number; kind: ContentKind }[] = [];
    for (const s of sources) if (s.gen > 0) for (const kind of CONTENT_KINDS) if ((s.counts[kind] ?? 0) > 0) keys.push({ src: s.src, gen: s.gen, kind });
    const data = await readIndexes(db, keys);
    const segments: SearchSegment[] = [];
    const stale: QueryStatus['stale'] = [];
    keys.forEach((k, i) => {
      const d = data[i];
      if (!d) {
        stale.push({ ...k, reason: 'missing' });
        return;
      }
      try {
        segments.push(new SearchSegment(d));
      } catch (error) {
        stale.push({ ...k, reason: error instanceof Error ? error.message : String(error) });
      }
    });
    const epg = await this.loadEpg(db);
    this.setOffsets(await offsets, await overrides, offsetSeq);
    this.sources = sources;
    this.segments = segments;
    this.stale = stale;
    this.marks = null;
    this.epgLinks = epg.links;
    // (A guide never read has generation 0, which holds nothing.)
    this.epgActive = epg.metas.map((m) => ({ epgSrc: m.epgSrc, gen: m.gen }));
    this.version += 1;
    this.unmatchedIndexes = new Map();
    this.declaredLists = new Map();
    this.loaded = true;
    // Chunks of replaced generations are never asked for again; drop them.
    const live = new Set(sources.map((s) => `${s.src}|${s.gen}|`));
    for (const id of [...this.cache.keys()]) if (!live.has(id.slice(0, id.indexOf('|', id.indexOf('|') + 1) + 1))) this.cache.delete(id);
  }

  /** The active guides in priority order, and which guide channel each live channel takes. */
  private async loadEpg(db: IDBDatabase): Promise<{ metas: EpgMeta[]; links: Map<ContentKey, EpgLink> }> {
    const metas = (await getEpgMetas(db)).sort((a, b) => a.rank - b.rank || (a.epgSrc < b.epgSrc ? -1 : a.epgSrc > b.epgSrc ? 1 : 0));
    const active = metas.filter((m) => m.gen > 0);
    const tables = await readEpgChannels(
      db,
      active.map((m) => ({ epgSrc: m.epgSrc, gen: m.gen })),
    );
    const guides: { epgSrc: string; matches: StoredEpgMatch[] }[] = [];
    const shifts = new Map<string, number>();
    active.forEach((m, i) => {
      const table = tables[i];
      if (!table) return;
      for (const x of table.matches) shifts.set(`${m.epgSrc}|${x.key}`, x.shift);
      guides.push({ epgSrc: m.epgSrc, matches: table.matches });
    });
    const gens = new Map<string, number>();
    for (const m of active) gens.set(m.epgSrc, m.gen);
    const links = new Map<ContentKey, EpgLink>();
    combineEpgMatches(guides).forEach((m, key) => {
      links.set(key, { epgSrc: m.epgSrc, gen: gens.get(m.epgSrc) ?? 0, channel: m.channel, method: m.method, shift: shifts.get(`${m.epgSrc}|${key}`) ?? 0 });
    });
    return { metas, links };
  }

  /** Takes the offsets and mappings read or written at `seq`, unless ones from a later edit are held already. */
  private setOffsets(offsets: Record<string, number>, overrides: readonly EpgOverride[], seq: number): void {
    if (seq < this.offsetsFrom) return;
    this.offsetsFrom = seq;
    this.epgOffsets = offsets;
    const none = new Set<ContentKey>();
    for (const o of overrides) if (o.channel === null) none.add(o.key);
    this.noGuide = none;
  }

  /** A link's whole shift in minutes: its channel's tvg-shift and its guide's time offset. */
  private shiftOf(link: EpgLink): number {
    // (Guide ids hold `:` or `~`: never a name an object inherits.)
    return Math.round(link.shift * 60) + (this.epgOffsets[link.epgSrc] ?? 0);
  }

  /**
   * The guides and sources as stored now (read fresh: a catalog refresh that found nothing new
   * may still have updated a source's `epgUrls` without a reload), and how many live channels
   * the loaded match tables give a guide.
   */
  async epgStatus(): Promise<EpgStatus> {
    await this.ensureLoaded();
    const db = await this.db();
    const sources = (await getSources(db)).sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
    const guides = (await getEpgMetas(db)).sort((a, b) => a.rank - b.rank || (a.epgSrc < b.epgSrc ? -1 : a.epgSrc > b.epgSrc ? 1 : 0));
    return { guides, matched: this.epgLinks.size, sources, mapping: epgMappingKey(await readEpgOverrides(db)) };
  }

  /**
   * The manual mapping picker's search (step 24d): the XMLTV channels the active guides declare
   * (or `req.epgSrc`'s alone) whose display names or id hold each word of `req.query`, normalized
   * as the matcher normalizes names, guide by guide in priority order. Rejects an `offset` that
   * isn't a whole number from 0, or a `limit` above `GUIDE_CHANNELS_MAX_ROWS`.
   */
  async guideChannels(req: GuideChannelsRequest): Promise<GuideChannelsPage> {
    const { offset, limit } = req;
    if (!(offset >= 0 && Math.floor(offset) === offset && limit >= 0 && limit <= GUIDE_CHANNELS_MAX_ROWS)) {
      throw new RangeError(`A page of a guide's channels is up to ${GUIDE_CHANNELS_MAX_ROWS} rows from a whole row number`);
    }
    await this.ensureLoaded();
    const version = this.version;
    const guides = this.epgActive.filter((g) => req.epgSrc === undefined || g.epgSrc === req.epgSrc);
    const lists = await Promise.all(guides.map((g) => this.declaredOf(g.epgSrc, g.gen)));
    const words = wordsOf(normalizeName(req.query));
    const rows: GuideChannel[] = [];
    let count = 0;
    lists.forEach((list, i) => {
      const epgSrc = guides[i]!.epgSrc;
      for (let c = 0; c < list.ids.length; c += 1) {
        const search = list.search[c]!;
        let found = true;
        for (let w = 0; w < words.length && found; w += 1) found = search.indexOf(words[w]!) !== -1;
        if (!found) continue;
        if (count >= offset && count < offset + limit) rows.push({ epgSrc, id: list.ids[c]!, name: list.names[c]! });
        count += 1;
      }
    });
    return { version, count, offset, rows };
  }

  /** Guide `epgSrc`'s declared channels in generation `gen`, read once per reload. */
  private declaredOf(epgSrc: string, gen: number): Promise<EpgDeclaredChannels> {
    const lists = this.declaredLists;
    const known = lists.get(epgSrc);
    if (known !== undefined) return known;
    const read = this.readDeclared(epgSrc, gen);
    lists.set(epgSrc, read);
    // A read that failed is tried again at the next ask.
    read.catch(() => lists.delete(epgSrc));
    return read;
  }

  /**
   * A generation's declared channels; for one read before step 24d, which has none stored, the
   * channels in use from its match table (the guide is read again with the next refresh).
   */
  private async readDeclared(epgSrc: string, gen: number): Promise<EpgDeclaredChannels> {
    const db = await this.db();
    const declared = await readEpgDeclared(db, epgSrc, gen);
    if (declared !== null) return declared;
    const [table] = await readEpgChannels(db, [{ epgSrc, gen }]);
    return epgDeclared(table ? table.channels.map((c) => ({ id: c.id, name: c.name, names: [c.name] })) : []);
  }

  /**
   * The live channels without a guide (step 24c): those of `req.sources`' active catalogs that
   * the combined match tables don't have, source by source in that order and, in each, category
   * by category as "All channels" lists them. Rejects an `offset` that isn't a whole number from
   * 0, or a `limit` above `UNMATCHED_MAX_ROWS`.
   */
  async unmatched(req: UnmatchedRequest): Promise<UnmatchedPage> {
    const { offset, limit } = req;
    if (!(offset >= 0 && Math.floor(offset) === offset && limit >= 0 && limit <= UNMATCHED_MAX_ROWS)) {
      throw new RangeError(`A page of channels without a guide is up to ${UNMATCHED_MAX_ROWS} rows from a whole row number`);
    }
    await this.ensureLoaded();
    const version = this.version;
    const lists = await Promise.all(req.sources.map((src) => this.unmatchedOf(src)));
    const keys: ChunkKey[] = [];
    const slots: number[] = [];
    // The list's first row of each source as it goes, and the whole count at the end.
    let count = 0;
    lists.forEach((list, i) => {
      const src = req.sources[i]!;
      const size = list.refs.length / 3;
      for (let row = Math.max(offset, count); row < Math.min(offset + limit, count + size); row += 1) {
        const at = (row - count) * 3;
        keys.push({ src, gen: list.gen, kind: 'live', catIdx: list.refs[at]!, chunk: list.refs[at + 1]! });
        slots.push(list.refs[at + 2]!);
      }
      count += size;
    });
    const chunks = await this.readCached(keys);
    const rows: UnmatchedChannel[] = [];
    slots.forEach((slot, i) => {
      const item = chunks[i]?.[slot];
      // (An item's group is its category's name: the ingest files it under it.)
      if (item !== undefined) rows.push({ key: item.key, name: item.name, src: item.src, category: item.group });
    });
    return { version, count, offset, rows };
  }

  /** Source `src`'s live channels without a guide, walked once per reload (none with no catalog stored: generation 0 has no chunks). */
  private unmatchedOf(src: string): Promise<UnmatchedIndex> {
    const indexes = this.unmatchedIndexes;
    const known = indexes.get(src);
    if (known !== undefined) return known;
    const built = this.buildUnmatched(src, this.activeGen(src), this.epgLinks);
    indexes.set(src, built);
    // A walk that failed is tried again at the next ask (until it settles, every ask shares it).
    built.catch(() => indexes.delete(src));
    return built;
  }

  /**
   * Walks generation `gen` of `src`'s live chunks for the channels `links` lacks. The chunks'
   * key order (category, then chunk) is the order "All channels" lists them: categories are
   * numbered as they first appear, and the live screen lists them by that number.
   */
  private async buildUnmatched(src: string, gen: number, links: ReadonlyMap<ContentKey, EpgLink>): Promise<UnmatchedIndex> {
    const db = await this.db();
    const refs: number[] = [];
    await scanChunks(db, src, gen, 'live', (catIdx, chunk, items) => {
      items.forEach((item, slot) => {
        if (!links.has(item.key)) refs.push(catIdx, chunk, slot);
      });
    });
    return { gen, refs };
  }

  /**
   * Now and next for each live channel at `at` (default: now). Reads days `d - 1` to `d + 1` of
   * its guide channel, `d` being the UTC day at `at` minus its shift (the tvg-shift and the
   * guide's offset): a programme from the evening before can still be on air, and the next one
   * can start tomorrow.
   */
  async nowNext(keys: ContentKey[], at?: number): Promise<EpgNowNext[]> {
    await this.ensureLoaded();
    const nowMs = at ?? this.clock();
    const reads: EpgBucketKey[] = [];
    const plan = keys.map((key) => {
      const link = this.epgLinks.get(key);
      if (link === undefined || link.gen === 0) return null;
      const shift = this.shiftOf(link);
      const day = epgDay(Math.floor(nowMs / 60_000) - shift);
      const from = reads.length;
      for (let d = day - 1; d <= day + 1; d++) reads.push({ epgSrc: link.epgSrc, gen: link.gen, channel: link.channel, day: d });
      return { link, shift, from };
    });
    const buckets = reads.length === 0 ? [] : await readEpgBuckets(await this.db(), reads);
    return keys.map((key, i) => {
      const p = plan[i];
      if (p === null || p === undefined) return { key, epgSrc: null, channel: null, method: null, now: null, next: null };
      const found: EpgBucket[] = [];
      for (let j = p.from; j < p.from + 3; j++) {
        const b = buckets[j];
        if (b) found.push(b);
      }
      // Core takes hours: minutes / 60 * 60 rounds back to the same whole minutes.
      const nn = epgNowNext(found, nowMs, p.shift / 60);
      return { key, epgSrc: p.link.epgSrc, channel: p.link.channel, method: p.link.method, now: nn.now, next: nn.next };
    });
  }

  /**
   * The grid guide's rows: for each live channel, its programmes that overlap `[from, to)`, read
   * from the guide channel now/next uses (the stronger match, then the guide listed first) and
   * shifted by its tvg-shift and its guide's offset. Its buckets of the days the range covers in guide time are read,
   * and the day before: a programme from the evening before can still be on at `from`. Rejects
   * an ask of more than `GUIDE_MAX_READS` buckets.
   */
  async guide(req: GuideRequest): Promise<GuideRow[]> {
    await this.ensureLoaded();
    const reads: EpgBucketKey[] = [];
    const plan = req.keys.map((key) => {
      const link = this.epgLinks.get(key);
      if (link === undefined) return null;
      const shift = this.shiftOf(link);
      const first = epgDay(req.from - shift) - 1;
      const last = epgDay(req.to - 1 - shift);
      if (reads.length + (last - first + 1) > GUIDE_MAX_READS) throw new RangeError(`The guide was asked for more than ${GUIDE_MAX_READS} channel-days`);
      const at = reads.length;
      for (let d = first; d <= last; d++) reads.push({ epgSrc: link.epgSrc, gen: link.gen, channel: link.channel, day: d });
      return { link, shift, at, count: reads.length - at };
    });
    const buckets = await readEpgBuckets(await this.db(), reads);
    return req.keys.map((key, i) => {
      const p = plan[i];
      if (!p) return { key, epgSrc: null, start: [], end: [], title: [] };
      const found: EpgBucket[] = [];
      for (let j = p.at; j < p.at + p.count; j++) {
        const b = buckets[j];
        if (b) found.push(b);
      }
      return { key, epgSrc: p.link.epgSrc, ...epgSchedule(found, req.from, req.to, p.shift / 60) };
    });
  }

  /**
   * The programme details (step 24a): the whole programme of a live channel's guide channel (the
   * one its now/next and grid row come from) that starts at `start`, shifted by its tvg-shift and
   * its guide's offset, or
   * `null` (no guide matches the channel, or no programme starts then). One bucket is read: the
   * one of the start's day in guide time. Its end is the stored one (the grid cuts a programme
   * that runs into the next day's first one; the screen shows the grid's times).
   */
  async programme(req: ProgrammeRequest): Promise<EpgProgramme | null> {
    await this.ensureLoaded();
    const link = this.epgLinks.get(req.key);
    if (link === undefined) return null;
    const shift = this.shiftOf(link);
    const day = epgDay(req.start - shift);
    const [bucket] = await readEpgBuckets(await this.db(), [{ epgSrc: link.epgSrc, gen: link.gen, channel: link.channel, day }]);
    return bucket ? epgProgrammeAt(bucket, req.start, shift / 60) : null;
  }

  /**
   * Now/next for a focused live channel: its guide's when one matches it, otherwise its Xtream
   * panel's short EPG (cached 30 min). Rejects with the panel's error (`XtreamError`,
   * `NetworkError`), which isn't cached.
   */
  async shortEpg(req: ShortEpgRequest): Promise<ShortEpgNowNext> {
    const [stored] = await this.nowNext([req.key], req.at);
    const base = stored ?? { key: req.key, epgSrc: null, channel: null, method: null, now: null, next: null };
    if (base.epgSrc !== null) return { ...base, from: 'guide', cached: false };
    // Mapped to no guide by the user: the panel's guide isn't asked either.
    const target = this.panelEpg === null || this.noGuide.has(req.key) ? null : shortEpgTarget(req.url, req.source);
    if (target === null || this.panelEpg === null) return { ...base, from: 'none', cached: false };
    const answer = await this.panelEpg.programmes(req.key, target);
    const nn = shortEpgNowNext(answer.programmes, req.at ?? this.clock());
    return { ...base, now: nn.now, next: nn.next, from: 'panel', cached: answer.cached };
  }

  /**
   * How the account behind source `src` stands, for the player's error card (step 20a): its Xtream
   * panel's answer (`auth: false` when the panel refuses the login), or `null` when the source
   * isn't stored, has no panel (a plain playlist), or the worker has no network. Rejects with the
   * panel's other errors (`XtreamError`, `NetworkError`), which never hold the URL.
   */
  async account(src: string): Promise<AccountCheck | null> {
    const transport = this.options.transport;
    if (transport === undefined) return null;
    const record = await this.sourceRecord(src);
    const account = record === null ? null : sourceAccount(record);
    return account === null ? null : checkAccount(account, textTransport(transport));
  }

  /**
   * A movie's details (step 26c): its Xtream panel's `get_vod_info`, kept 24 h per movie; `null`
   * when its source isn't stored or has no panel (a plain playlist), its URL is no Xtream movie
   * URL, the panel doesn't know it, or the worker has no network. Rejects with the panel's other
   * errors (`XtreamError`, `NetworkError`), which never hold the URL and aren't kept.
   */
  async vodInfo(req: VodInfoRequest): Promise<XtreamVodInfo | null> {
    if (this.vodInfos === null) return null;
    const record = await this.sourceRecord(req.src);
    const target = record === null ? null : vodInfoTarget(req.url, sourceAccount(record));
    return target === null ? null : this.vodInfos.info(req.key, target);
  }

  /**
   * A show's seasons and episodes (step 27b): its Xtream panel's `get_series_info`, kept 24 h per
   * show; `null` when its source isn't stored or has no panel, its key is no Xtream show's of
   * that source, the panel doesn't know it, or the worker has no network. Rejects with the
   * panel's other errors (`XtreamError`, `NetworkError`), which never hold the URL and aren't kept.
   */
  async seriesInfo(req: SeriesInfoRequest): Promise<XtreamSeriesInfo | null> {
    if (this.seriesInfos === null) return null;
    const record = await this.sourceRecord(req.src);
    const target = record === null ? null : seriesInfoTarget(req.src, req.key, sourceAccount(record));
    return target === null ? null : this.seriesInfos.info(req.src, req.key, target);
  }

  /**
   * The newest items of `req.kind` across `req.sources` ("Recently added", step 26e), newest first:
   * the lists each active generation keeps from its ingest, merged. A source named twice counts
   * once. Rejects a `limit` that isn't a whole number from 0 to `RECENT_MAX`.
   */
  async recent(req: RecentRequest): Promise<RecentItem[]> {
    const limit = req.limit ?? RECENT_MAX;
    if (!(limit >= 0 && limit <= RECENT_MAX && Math.floor(limit) === limit)) {
      throw new RangeError(`"Recently added" gives up to ${RECENT_MAX} items`);
    }
    await this.ensureLoaded();
    const keys: { src: string; gen: number; kind: ContentKind }[] = [];
    const asked: string[] = [];
    for (const src of req.sources) {
      if (asked.indexOf(src) !== -1) continue;
      asked.push(src);
      // (A source with no catalog has generation 0, which holds nothing.)
      keys.push({ src, gen: this.activeGen(src), kind: req.kind });
    }
    return mergeRecent(await readRecent(await this.db(), keys), limit);
  }

  /** The profile's record of source `src` (`null`: no profile, or no such source). */
  private async sourceRecord(src: string): Promise<SourceRecord | null> {
    const profile = await this.profile();
    const sources = profile === null ? null : (profile.doc as { sources?: unknown }).sources;
    const records: SourceRecord[] = Array.isArray(sources) ? (sources as SourceRecord[]) : [];
    for (const record of records) if (record.id === src) return record;
    return null;
  }

  /**
   * The profile, upgraded in place first if an older app version wrote it; `null` when there is
   * none yet (a fresh install, or a webOS wipe). A document from a newer app version comes back
   * as it is, with `newer` set.
   */
  async profile(): Promise<LoadedProfile | null> {
    return loadProfile(await this.db(), { now: this.clock() });
  }

  /**
   * Applies `edit` to the profile in one read-modify-write transaction, creating the profile when
   * there is none (onboarding's first answer does). Resolves `false` when nothing changed, or when
   * the stored profile is from a newer app version (never written over). The guides' time offsets
   * the written document holds are applied at once (step 24b): the next read has them; so is a
   * mapping to no guide (step 24d) in the short EPG. Other mappings need the guides read again.
   */
  async editProfile(edit: ProfileEdit): Promise<boolean> {
    const db = await this.db();
    let written: ProfileDoc | null = null;
    const seq = ++this.offsetSeq;
    const wrote = await updateProfile(
      db,
      (doc) => {
        written = applyProfileEdit(doc, edit);
        return written;
      },
      { create: true, now: this.clock() },
    );
    if (wrote) this.setOffsets(epgOffsetsOf(written), epgOverridesOf(written), seq);
    return wrote;
  }

  /** Sets the favourite keys boosted in search. Returns how many are in loaded segments. */
  setFavourites(keys: ContentKey[]): number {
    this.favourites = keys.slice();
    this.marks = null;
    if (!this.loaded) return 0;
    return this.favouriteMarks().reduce((n, m) => n + (m ? m.size : 0), 0);
  }

  private favouriteMarks(): FavouriteMarks {
    if (!this.marks) this.marks = favouriteMarks(this.segments, this.favourites);
    return this.marks;
  }

  async search(req: SearchRequest, ctx?: RpcContext): Promise<SearchResult> {
    await this.ensureLoaded();
    ctx?.token.throwIfCancelled();
    let segments = this.segments;
    let marks = this.favouriteMarks();
    if (req.sources) {
      const order = req.sources;
      const picked = segments.map((s, i) => ({ s, i, rank: order.indexOf(s.src) })).filter((x) => x.rank !== -1);
      picked.sort((a, b) => a.rank - b.rank || a.i - b.i);
      segments = picked.map((x) => x.s);
      marks = picked.map((x) => marks[x.i] ?? null);
    }
    return searchSegments(segments, req.query, { kinds: req.kinds, limit: req.limit, favourites: marks });
  }

  private activeGen(src: string): number {
    const meta = this.sources.find((s) => s.src === src);
    return meta ? meta.gen : 0;
  }

  async categories(src: string, kind: ContentKind): Promise<CategoryInfo[]> {
    await this.ensureLoaded();
    const gen = this.activeGen(src);
    if (gen === 0) return [];
    return (await readCategories(await this.db(), src, gen, kind)) ?? [];
  }

  /** One chunk of the active generation (`[]` if it doesn't exist). */
  async chunk(arg: { src: string; kind: ContentKind; catIdx: number; chunk: number }): Promise<CatalogItem[]> {
    await this.ensureLoaded();
    const gen = this.activeGen(arg.src);
    if (gen === 0) return [];
    const [items] = await this.readCached([{ src: arg.src, gen, kind: arg.kind, catIdx: arg.catIdx, chunk: arg.chunk }]);
    return items ?? [];
  }

  /** The items at `refs` (`null` where the chunk or slot is gone, e.g. an old generation). */
  async items(refs: ItemRef[]): Promise<(CatalogItem | null)[]> {
    const chunks = await this.readCached(refs);
    return refs.map((r, i) => chunks[i]?.[r.slot] ?? null);
  }

  private async readCached(keys: readonly ChunkKey[]): Promise<(CatalogItem[] | null)[]> {
    const ids = keys.map(chunkId);
    // Everything this call answers with, so cache evictions during the call can't lose a chunk.
    const found = new Map<string, CatalogItem[] | null>();
    const missing: ChunkKey[] = [];
    const missingIds: string[] = [];
    ids.forEach((id, i) => {
      if (found.has(id)) return;
      const hit = this.cache.get(id);
      if (hit) {
        // Refresh its place in the LRU order.
        this.cache.delete(id);
        this.cache.set(id, hit);
        found.set(id, hit);
      } else {
        found.set(id, null);
        missing.push(keys[i]!);
        missingIds.push(id);
      }
    });
    if (missing.length > 0) {
      const read = await readChunks(await this.db(), missing);
      missingIds.forEach((id, i) => {
        const items = read[i] ?? null;
        found.set(id, items);
        if (items) this.remember(id, items);
      });
    }
    return ids.map((id) => found.get(id) ?? null);
  }

  private remember(id: string, items: CatalogItem[]): void {
    this.cache.set(id, items);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }
}
