/**
 * The query worker's service (architecture.md §1.2, §1.4 step 11): it stays running, keeps the
 * active generations' search segments in memory, and answers the UI's catalog reads over RPC.
 *
 * - `search` ranks over every loaded segment (core `searchSegments`), with the favourites set
 *   by `setFavourites` boosted. Hits name their generation and chunk; `items` resolves them.
 * - `categories`, `chunk` and `items` read the active generation from IndexedDB, with a small
 *   chunk cache (the visible pages of a list touch the same few chunks).
 * - `reload` re-reads `sources_meta` and the segments, after an ingest swapped a generation.
 *   It runs lazily before the first search too.
 *
 * A segment that fails to load (other layout version, inconsistent data) is skipped and listed
 * in `status().stale`, so the ingest can rebuild it.
 */

import type { CatalogItem, ContentKey, ContentKind, FavouriteMarks, SearchResult } from '@zoma/core';
import { CONTENT_KINDS, SearchSegment, favouriteMarks, searchSegments } from '@zoma/core';
import type { CategoryInfo } from './chunker';
import type { ChunkKey, SourceMeta } from './catalog-store';
import { getSources, readCategories, readChunks, readIndexes } from './catalog-store';
import type { RpcContext } from './rpc';

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

export interface QueryServiceOptions {
  /** Opens (and migrates) the database; called once, on first use. */
  openDb: () => Promise<IDBDatabase>;
  /** Chunks kept in memory (default 16, about 8,000 items). */
  chunkCache?: number;
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

  constructor(private readonly options: QueryServiceOptions) {
    this.cacheSize = Math.max(1, options.chunkCache ?? 16);
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
    this.sources = sources;
    this.segments = segments;
    this.stale = stale;
    this.marks = null;
    this.loaded = true;
    // Chunks of replaced generations are never asked for again; drop them.
    const live = new Set(sources.map((s) => `${s.src}|${s.gen}|`));
    for (const id of [...this.cache.keys()]) if (!live.has(id.slice(0, id.indexOf('|', id.indexOf('|') + 1) + 1))) this.cache.delete(id);
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
