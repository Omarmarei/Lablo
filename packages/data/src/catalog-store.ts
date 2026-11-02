/**
 * Catalog records in IndexedDB, versioned by generation (architecture.md §1.4 steps 7-9).
 *
 * A refresh writes a whole new generation of a source next to the active one:
 * 1. `beginGeneration` reserves the next generation number and marks it as being built;
 * 2. `putChunks` (about 10 chunks per transaction) and `putCatalogKind` (categories and search
 *    segment, per kind) write it;
 * 3. `commitGeneration` switches `sources_meta.gen` to it in one transaction;
 * 4. `deleteGeneration` removes the previous one in the background.
 *
 * If the app dies before step 3, the active generation is untouched; the half-written one is
 * removed by `pruneGenerations` at the next start. Key layout: chunks `[src, gen, kind, catIdx,
 * chunk]`, categories and index `[src, gen, kind]`. Array keys sort after numbers, so
 * `[src, gen]`..`[src, gen, []]` covers one generation and `[src]`..`[src, []]` a whole source.
 */

import type { CatalogItem, ContentKind, SearchSegmentData, XtreamServerInfo } from '@zoma/core';
import type { CatalogChunk, CategoryInfo } from './chunker';
import { onSuccess, transact } from './idb';
import { STORE } from './schema';

/** Ingest bookkeeping for one source. */
export interface SourceMeta {
  src: string;
  /** Active generation (0: nothing ingested yet). */
  gen: number;
  /** Generation being written (`null`: none). */
  building: number | null;
  /** Next generation number to hand out. */
  nextGen: number;
  /** Epoch ms of the last committed refresh. */
  updatedAt: number | null;
  /** Items per kind in the active generation. */
  counts: Partial<Record<ContentKind, number>>;
  /** What the active generation was built from (conditional fetch; step 8). */
  fetch?: FetchStamp | null;
  /** Epoch ms of the last refresh that finished: committed, or found nothing new (step 8). */
  checkedAt?: number | null;
  /** The Xtream panel's server facts from the last login (catch-up needs its zone; step 8). */
  server?: XtreamServerInfo | null;
}

/**
 * Identifies the download a generation was built from. A refresh sends the validators back
 * (`If-None-Match`, `If-Modified-Since`), and one that downloads the same bytes (same FNV-1a
 * hash and length) with the same ingest version changes nothing.
 */
export interface FetchStamp {
  /** `INGEST_VERSION` that built it: a newer parser rebuilds even unchanged bytes. */
  v: number;
  /** FNV-1a of every byte received, as downloaded (before gunzip). */
  hash: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
}

/** Optional fields `commitGeneration` and `markChecked` also set. */
export type SourceMetaPatch = Partial<Pick<SourceMeta, 'fetch' | 'checkedAt' | 'server'>>;

/** Thrown when a commit finds another refresh took over the source. */
export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

const generationRange = (src: string, gen: number): IDBKeyRange => IDBKeyRange.bound([src, gen], [src, gen, []]);
const sourceRange = (src: string): IDBKeyRange => IDBKeyRange.bound([src], [src, []]);
const CATALOG_STORES = [STORE.chunks, STORE.cats, STORE.index];

export function newSourceMeta(src: string): SourceMeta {
  return { src, gen: 0, building: null, nextGen: 1, updatedAt: null, counts: {} };
}

export function getSources(db: IDBDatabase): Promise<SourceMeta[]> {
  return transact<SourceMeta[]>(db, STORE.sources, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.sources).getAll(), (all) => done(all as SourceMeta[]));
  });
}

/** One source's bookkeeping (`null`: never refreshed). */
export function getSource(db: IDBDatabase, src: string): Promise<SourceMeta | null> {
  return transact<SourceMeta | null>(db, STORE.sources, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.sources).get(src), (value) => done((value as SourceMeta | undefined) ?? null));
  });
}

/** Records a refresh that found nothing new (`checkedAt`, plus `patch`). No-op for an unknown source. */
export function markChecked(db: IDBDatabase, src: string, now: number, patch: SourceMetaPatch = {}): Promise<void> {
  return transact<void>(db, STORE.sources, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.sources);
    onSuccess(store.get(src), (value) => {
      const meta = value as SourceMeta | undefined;
      if (meta) store.put({ ...meta, ...patch, checkedAt: now } satisfies SourceMeta);
    });
  });
}

/**
 * Drops a generation that will never be committed (a failed or cancelled refresh, or one that
 * turned out unchanged): its records, and the `building` mark if it is still the one being built.
 */
export function abandonGeneration(db: IDBDatabase, src: string, gen: number): Promise<void> {
  return transact<void>(db, [STORE.sources, ...CATALOG_STORES], 'readwrite', (tx) => {
    const sources = tx.objectStore(STORE.sources);
    onSuccess(sources.get(src), (value) => {
      const meta = value as SourceMeta | undefined;
      if (meta && meta.building === gen) sources.put({ ...meta, building: null } satisfies SourceMeta);
    });
    if (gen > 0) for (const name of CATALOG_STORES) tx.objectStore(name).delete(generationRange(src, gen));
  });
}

/** Reserves a new generation for `src` and marks it as being built. Returns its number. */
export function beginGeneration(db: IDBDatabase, src: string): Promise<number> {
  return transact<number>(db, STORE.sources, 'readwrite', (tx, done) => {
    const store = tx.objectStore(STORE.sources);
    onSuccess(store.get(src), (value) => {
      const meta = (value as SourceMeta | undefined) ?? newSourceMeta(src);
      const gen = meta.nextGen;
      store.put({ ...meta, building: gen, nextGen: gen + 1 } satisfies SourceMeta);
      done(gen);
    });
  });
}

/** Writes chunks of a generation in one transaction (callers batch about 10). */
export function putChunks(db: IDBDatabase, src: string, gen: number, chunks: readonly CatalogChunk[]): Promise<void> {
  return transact<void>(db, STORE.chunks, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.chunks);
    for (const c of chunks) store.put({ items: c.items }, [src, gen, c.kind, c.catIdx, c.chunk]);
  });
}

/** Writes one kind's categories and search segment of a generation. */
export function putCatalogKind(db: IDBDatabase, src: string, gen: number, kind: ContentKind, cats: readonly CategoryInfo[], index: SearchSegmentData): Promise<void> {
  if (index.src !== src || index.gen !== gen || index.kind !== kind) throw new RangeError('Search segment belongs to another source, generation or kind');
  return transact<void>(db, [STORE.cats, STORE.index], 'readwrite', (tx) => {
    tx.objectStore(STORE.cats).put({ cats }, [src, gen, kind]);
    tx.objectStore(STORE.index).put(index, [src, gen, kind]);
  });
}

/**
 * Makes `gen` the active generation of `src`, in one transaction. Returns the previous active
 * generation (0 if none) for `deleteGeneration`. Fails if `gen` is not the one being built
 * (another refresh began after it, or it was already committed). `patch` sets the fetch stamp
 * and panel facts of the new generation in the same write.
 */
export function commitGeneration(
  db: IDBDatabase,
  src: string,
  gen: number,
  counts: Partial<Record<ContentKind, number>>,
  now = Date.now(),
  patch: SourceMetaPatch = {},
): Promise<number> {
  return transact<number>(db, STORE.sources, 'readwrite', (tx, done) => {
    const store = tx.objectStore(STORE.sources);
    onSuccess(store.get(src), (value) => {
      const meta = value as SourceMeta | undefined;
      if (!meta || meta.building !== gen) throw new GenerationError(`Generation ${gen} of ${src} is not being built`);
      store.put({ ...meta, ...patch, gen, building: null, updatedAt: now, counts: { ...counts } } satisfies SourceMeta);
      done(meta.gen);
    });
  });
}

/** Deletes every record of one generation (chunks, categories, index). */
export function deleteGeneration(db: IDBDatabase, src: string, gen: number): Promise<void> {
  return transact<void>(db, CATALOG_STORES, 'readwrite', (tx) => {
    for (const name of CATALOG_STORES) tx.objectStore(name).delete(generationRange(src, gen));
  });
}

/**
 * Deletes the generations of `src` that are neither active nor being built: leftovers of a
 * crashed refresh or an interrupted background delete. Run at startup. With `abandon`, the one
 * being built is dropped too (no refresh is running in this session).
 */
export function pruneGenerations(db: IDBDatabase, src: string, options: { abandon?: boolean } = {}): Promise<void> {
  return transact<void>(db, [STORE.sources, ...CATALOG_STORES], 'readwrite', (tx) => {
    const sources = tx.objectStore(STORE.sources);
    onSuccess(sources.get(src), (value) => {
      const meta = value as SourceMeta | undefined;
      const keep: number[] = [];
      if (meta && meta.gen > 0) keep.push(meta.gen);
      if (meta && meta.building !== null && !options.abandon) keep.push(meta.building);
      if (meta && meta.building !== null && options.abandon) sources.put({ ...meta, building: null } satisfies SourceMeta);
      if (keep.length === 2 && keep[0] === keep[1]) keep.pop();
      keep.sort((a, b) => a - b);
      // The ranges between the kept generations: [src] .. [src, k1) .. (k1 all] .. [src, k2) ..
      const ranges: IDBKeyRange[] = [];
      let lower: IDBValidKey = [src];
      let lowerOpen = false;
      for (const k of keep) {
        ranges.push(IDBKeyRange.bound(lower, [src, k], lowerOpen, true));
        lower = [src, k, []];
        lowerOpen = true;
      }
      ranges.push(IDBKeyRange.bound(lower, [src, []], lowerOpen, false));
      for (const name of CATALOG_STORES) {
        const store = tx.objectStore(name);
        for (const range of ranges) store.delete(range);
      }
    });
  });
}

/** Deletes a source: its bookkeeping and every generation. */
export function deleteSource(db: IDBDatabase, src: string): Promise<void> {
  return transact<void>(db, [STORE.sources, ...CATALOG_STORES], 'readwrite', (tx) => {
    tx.objectStore(STORE.sources).delete(src);
    for (const name of CATALOG_STORES) tx.objectStore(name).delete(sourceRange(src));
  });
}

/** Key of a stored chunk. */
export interface ChunkKey {
  src: string;
  gen: number;
  kind: ContentKind;
  catIdx: number;
  chunk: number;
}

/** Reads chunks in one transaction; a missing chunk gives `null`. */
export function readChunks(db: IDBDatabase, keys: readonly ChunkKey[]): Promise<(CatalogItem[] | null)[]> {
  return transact<(CatalogItem[] | null)[]>(db, STORE.chunks, 'readonly', (tx, done) => {
    const store = tx.objectStore(STORE.chunks);
    const out: (CatalogItem[] | null)[] = keys.map(() => null);
    done(out);
    keys.forEach((k, i) => {
      onSuccess(store.get([k.src, k.gen, k.kind, k.catIdx, k.chunk]), (value) => {
        out[i] = value ? (value as { items: CatalogItem[] }).items : null;
      });
    });
  });
}

export function readCategories(db: IDBDatabase, src: string, gen: number, kind: ContentKind): Promise<CategoryInfo[] | null> {
  return transact<CategoryInfo[] | null>(db, STORE.cats, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.cats).get([src, gen, kind]), (value) => done(value ? (value as { cats: CategoryInfo[] }).cats : null));
  });
}

/** Reads the search segments of the given generations, in one transaction (missing: `null`). */
export function readIndexes(db: IDBDatabase, keys: readonly { src: string; gen: number; kind: ContentKind }[]): Promise<(SearchSegmentData | null)[]> {
  return transact<(SearchSegmentData | null)[]>(db, STORE.index, 'readonly', (tx, done) => {
    const store = tx.objectStore(STORE.index);
    const out: (SearchSegmentData | null)[] = keys.map(() => null);
    done(out);
    keys.forEach((k, i) => {
      onSuccess(store.get([k.src, k.gen, k.kind]), (value) => {
        out[i] = (value as SearchSegmentData | undefined) ?? null;
      });
    });
  });
}
