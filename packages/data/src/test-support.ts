// Test helpers for @zoma/data (imported by *.test.ts only; never by package code).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { CatalogItem, ContentKind } from '@zoma/core';
import { normalizeName, xtreamKey } from '@zoma/core';
import type { CatalogChunk } from './chunker';
import { CatalogChunker, indexChunk } from './chunker';
import { SearchIndexBuilder } from '@zoma/core';
import { beginGeneration, commitGeneration, putCatalogKind, putChunks } from './catalog-store';
import type { Migration } from './schema';
import { openDatabase, transact } from './idb';

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
export async function schemaOf(factory: IDBFactory, migrations: readonly Migration[], name = 'zoma'): Promise<Awaited<ReturnType<typeof describeSchema>>> {
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
 * worker will in step 8. Returns the committed generation and the one it replaced.
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
