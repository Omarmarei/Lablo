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
 * - `epgStatus` lists the guides and how many live channels have one.
 * - `shortEpg` is the fallback for a focused live channel no guide matches (step 9c): its Xtream
 *   panel's `get_short_epg`, kept 30 min per channel (`short-epg.ts`). The app asks only after
 *   600 ms of focus. A matched channel gets its guide's now/next, with no request.
 * - `account` re-checks a source's Xtream account for the player's error card (step 20a,
 *   `account-check.ts`).
 * - `profile` and `editProfile` read and change the profile document for the app (step 13b):
 *   onboarding's answers and the sources the user added. An edit is a read-modify-write in one
 *   transaction, like the ingest worker's favourites update, so neither can lose the other's.
 *
 * A segment that fails to load (other layout version, inconsistent data) is skipped and listed
 * in `status().stale`, so the ingest can rebuild it.
 */

import type { CatalogItem, ContentKey, ContentKind, EpgBucket, EpgMatchMethod, EpgProgramme, FavouriteMarks, SearchResult } from '@zoma/core';
import { CONTENT_KINDS, SearchSegment, combineEpgMatches, epgDay, epgNowNext, favouriteMarks, searchSegments } from '@zoma/core';
import type { CategoryInfo } from './chunker';
import type { ChunkKey, SourceMeta } from './catalog-store';
import { getSources, readCategories, readChunks, readIndexes } from './catalog-store';
import type { EpgBucketKey, EpgMeta, StoredEpgMatch } from './epg-store';
import { getEpgMetas, readEpgBuckets, readEpgChannels } from './epg-store';
import type { RpcContext } from './rpc';
import type { ByteTransport } from './bytes';
import type { LoadedProfile, ProfileEdit } from './profile';
import { applyProfileEdit, loadProfile, updateProfile } from './profile';
import type { ShortEpgRequest } from './short-epg';
import { ShortEpgCache, shortEpgNowNext, shortEpgTarget, textTransport } from './short-epg';
import type { AccountCheck } from './account-check';
import { checkAccount, sourceAccount } from './account-check';
import type { SourceRecord } from './profile';

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

export interface EpgStatus {
  /** Every stored guide, in priority order. */
  guides: EpgMeta[];
  /** Live channels that have a guide channel, over every guide. */
  matched: number;
  /** The catalog sources (their `epgUrls` and Xtream `server` decide the guides). */
  sources: SourceMeta[];
}

/** Where a live channel's programmes are stored. */
interface EpgLink {
  epgSrc: string;
  gen: number;
  channel: string;
  method: EpgMatchMethod;
  shift: number;
}

export interface QueryServiceOptions {
  /** Opens (and migrates) the database; called once, on first use. */
  openDb: () => Promise<IDBDatabase>;
  /** Chunks kept in memory (default 16, about 8,000 items). */
  chunkCache?: number;
  /** The clock now/next is read at when the caller gives no time (and short EPG ages by). */
  now?: () => number;
  /** The network, for the short-EPG fallback (none: `shortEpg` never asks a panel). */
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
  private readonly panelEpg: ShortEpgCache | null;

  constructor(private readonly options: QueryServiceOptions) {
    this.cacheSize = Math.max(1, options.chunkCache ?? 16);
    this.panelEpg = options.transport ? new ShortEpgCache(options.transport, () => this.clock()) : null;
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
      epgStatus: (): Promise<EpgStatus> => this.epgStatus(),
      shortEpg: (req: ShortEpgRequest): Promise<ShortEpgNowNext> => this.shortEpg(req),
      account: (arg: { src: string }): Promise<AccountCheck | null> => this.account(arg.src),
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
    this.sources = sources;
    this.segments = segments;
    this.stale = stale;
    this.marks = null;
    this.epgLinks = epg.links;
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
    return { guides, matched: this.epgLinks.size, sources };
  }

  /**
   * Now and next for each live channel at `at` (default: now). Reads days `d - 1` to `d + 1` of
   * its guide channel, `d` being the UTC day at `at` minus its tvg-shift: a programme from the
   * evening before can still be on air, and the next one can start tomorrow.
   */
  async nowNext(keys: ContentKey[], at?: number): Promise<EpgNowNext[]> {
    await this.ensureLoaded();
    const nowMs = at ?? this.clock();
    const reads: EpgBucketKey[] = [];
    const plan = keys.map((key) => {
      const link = this.epgLinks.get(key);
      if (link === undefined || link.gen === 0) return null;
      const day = epgDay(Math.floor(nowMs / 60_000) - Math.round(link.shift * 60));
      const from = reads.length;
      for (let d = day - 1; d <= day + 1; d++) reads.push({ epgSrc: link.epgSrc, gen: link.gen, channel: link.channel, day: d });
      return { link, from };
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
      const nn = epgNowNext(found, nowMs, p.link.shift);
      return { key, epgSrc: p.link.epgSrc, channel: p.link.channel, method: p.link.method, now: nn.now, next: nn.next };
    });
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
    const target = this.panelEpg === null ? null : shortEpgTarget(req.url, req.source);
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
    const profile = await this.profile();
    const sources = profile === null ? null : (profile.doc as { sources?: unknown }).sources;
    const records: SourceRecord[] = Array.isArray(sources) ? (sources as SourceRecord[]) : [];
    for (const record of records) {
      if (record.id !== src) continue;
      const account = sourceAccount(record);
      return account === null ? null : checkAccount(account, textTransport(transport));
    }
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
   * the stored profile is from a newer app version (never written over).
   */
  async editProfile(edit: ProfileEdit): Promise<boolean> {
    return updateProfile(await this.db(), (doc) => applyProfileEdit(doc, edit), { create: true, now: this.clock() });
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
