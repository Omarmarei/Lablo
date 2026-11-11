// Test helpers for @lablo/data (imported by *.test.ts only; never by package code).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { CatalogItem, ContentKind } from '@lablo/core';
import { normalizeName, xtreamKey } from '@lablo/core';
import type { CatalogChunk } from './chunker';
import { CatalogChunker, indexChunk } from './chunker';
import { SearchIndexBuilder } from '@lablo/core';
import { beginGeneration, commitGeneration, putCatalogKind, putChunks } from './catalog-store';
import type { Migration } from './schema';
import { openDatabase, transact } from './idb';
import type { ByteRequest, ByteResponse, ByteTransport } from './bytes';
import { NetworkError } from './bytes';

/** One canned response of `fakeTransport`. */
export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Bytes per chunk (default 4096). */
  chunk?: number;
  /** Fail with `NetworkError` once this many bytes have been read. */
  failAfter?: number;
  /** Runs before chunk `n` (0-based) is handed out; may throw (a crash) or wait. */
  beforeChunk?: (n: number) => void | Promise<void>;
}

export interface FakeTransport extends ByteTransport {
  requests: { url: string; headers: Record<string, string> }[];
  /** Responses cancelled before their end. */
  cancelled: number;
}

/** A transport answering from `respond`, chunk by chunk, as a network would. */
export function fakeTransport(respond: (url: string, headers: Record<string, string>) => FakeResponse): FakeTransport {
  const t: FakeTransport = {
    requests: [],
    cancelled: 0,
    async get(url: string, request: ByteRequest = {}): Promise<ByteResponse> {
      const headers = { ...(request.headers ?? {}) };
      t.requests.push({ url, headers });
      const r = respond(url, headers);
      const body = typeof r.body === 'string' ? new TextEncoder().encode(r.body) : (r.body ?? new Uint8Array(0));
      const size = r.chunk ?? 4096;
      const lower = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      let at = 0;
      let n = 0;
      let done = false;
      return {
        status: r.status ?? 200,
        header: (name) => lower.get(name.toLowerCase()) ?? null,
        async read() {
          if (done) return null;
          if (r.failAfter !== undefined && at >= r.failAfter) {
            done = true;
            throw new NetworkError('Connection lost');
          }
          if (at >= body.length) {
            done = true;
            return null;
          }
          await r.beforeChunk?.(n++);
          if (done) return null;
          const end = Math.min(body.length, at + size, r.failAfter ?? Infinity);
          const piece = body.slice(at, end);
          at = end;
          return piece;
        },
        cancel() {
          if (!done) t.cancelled++;
          done = true;
        },
      };
    },
  };
  return t;
}

/** A fresh, empty IndexedDB implementation per test. */
export const freshFactory = (): IDBFactory => new IDBFactory();

export interface StoreShape {
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: Record<string, { keyPath: string | string[]; unique: boolean; multiEntry: boolean }>;
}

/** The database's stores and indexes, for shape comparisons. */
export async function describeSchema(db: IDBDatabase): Promise<{ version: number; stores: Record<string, StoreShape> }> {
  const names = Array.from(db.objectStoreNames);
  const stores: Record<string, StoreShape> = {};
  if (names.length > 0) {
    await transact(db, names, 'readonly', (tx) => {
      for (const name of names) {
        const store = tx.objectStore(name);
        const indexes: StoreShape['indexes'] = {};
        for (const i of Array.from(store.indexNames)) {
          const index = store.index(i);
          indexes[i] = { keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
        }
        stores[name] = { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes };
      }
    });
  }
  return { version: db.version, stores };
}

/** Opens, describes and closes. */
export async function schemaOf(factory: IDBFactory, migrations: readonly Migration[], name = 'lablo'): Promise<Awaited<ReturnType<typeof describeSchema>>> {
  const db = await openDatabase(factory, { migrations, name });
  try {
    return await describeSchema(db);
  } finally {
    db.close();
  }
}

/** Every value of a store as `[key, value]` pairs, in key order. */
export function dumpStore(db: IDBDatabase, store: string): Promise<[IDBValidKey, unknown][]> {
  return transact<[IDBValidKey, unknown][]>(db, store, 'readonly', (tx, done) => {
    const out: [IDBValidKey, unknown][] = [];
    done(out);
    const request = tx.objectStore(store).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      out.push([cursor.key, cursor.value]);
      cursor.continue();
    };
  });
}

/** A catalog item with sensible defaults. */
export function item(src: string, kind: ContentKind, id: number, name: string, group = ''): CatalogItem {
  return {
    key: xtreamKey(src, kind, id),
    src,
    kind,
    name,
    normName: normalizeName(name),
    group,
    url: `http://p.test/${kind}/u/p/${id}.ts`,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

/**
 * Writes `items` as a full generation of `src` (chunker, search index, swap), as the ingest
 * worker does (ingest.ts, step 8) but from items in memory. Returns the committed generation and the one it replaced.
 */
export async function ingest(db: IDBDatabase, src: string, items: CatalogItem[], options: { chunkSize?: number; now?: number; commit?: boolean } = {}): Promise<{ gen: number; previous: number }> {
  const gen = await beginGeneration(db, src);
  const counts: Partial<Record<ContentKind, number>> = {};
  for (const kind of ['live', 'movie', 'series'] as const) {
    const ofKind = items.filter((i) => i.kind === kind);
    if (ofKind.length === 0) continue;
    const chunker = new CatalogChunker(kind, { chunkSize: options.chunkSize });
    const builder = new SearchIndexBuilder(src, kind, gen);
    const batch: CatalogChunk[] = [];
    const write = async (chunks: CatalogChunk[]): Promise<void> => {
      for (const c of chunks) indexChunk(builder, c);
      batch.push(...chunks);
      if (batch.length >= 10) await putChunks(db, src, gen, batch.splice(0));
    };
    for (const i of ofKind) await write(chunker.push(i));
    await write(chunker.end());
    await putChunks(db, src, gen, batch);
    await putCatalogKind(db, src, gen, kind, chunker.categories(), builder.finish());
    counts[kind] = ofKind.length;
  }
  if (options.commit === false) return { gen, previous: -1 };
  const previous = await commitGeneration(db, src, gen, counts, options.now ?? 1);
  return { gen, previous };
}
