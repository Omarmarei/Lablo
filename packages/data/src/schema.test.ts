import { describe, expect, it } from 'vitest';
import { IdbError, onSuccess, openDatabase, transact } from './idb';
import type { Migration } from './schema';
import { DB_VERSION, MIGRATIONS, STORE } from './schema';
import type { StoreShape } from './test-support';
import { describeSchema, dumpStore, freshFactory, schemaOf } from './test-support';

const plain: StoreShape = { keyPath: null, autoIncrement: false, indexes: {} };

/**
 * The shape of every database version that has shipped (or will ship with this code). Adding a
 * migration means adding its shape here; editing an old migration makes its line fail.
 */
const SHAPES: Record<number, Record<string, StoreShape>> = {
  1: {
    [STORE.sources]: { ...plain, keyPath: 'src' },
    [STORE.chunks]: plain,
    [STORE.cats]: plain,
    [STORE.index]: plain,
    [STORE.profile]: { ...plain, keyPath: 'id' },
    [STORE.kv]: plain,
  },
};

/**
 * Data written by each version's app, which every later version must keep. Step 9's migration
 * adds the EPG stores and a seed for them here.
 */
const SEEDS: Record<number, Record<string, [IDBValidKey | null, unknown][]>> = {
  1: {
    [STORE.sources]: [[null, { src: 'tv', gen: 2, building: null, nextGen: 3, updatedAt: 5, counts: { live: 1 } }]],
    [STORE.chunks]: [[['tv', 2, 'live', 0, 0], { items: [{ key: 'x:tv:live:1', name: 'One' }] }]],
    [STORE.profile]: [[null, { id: 'current', savedAt: 5, doc: { v: 1, favourites: [] } }]],
    [STORE.kv]: [['config', { signed: 'abc' }]],
  },
};

async function seed(db: IDBDatabase, data: Record<string, [IDBValidKey | null, unknown][]>): Promise<void> {
  await transact(db, Object.keys(data), 'readwrite', (tx) => {
    for (const [store, rows] of Object.entries(data)) for (const [key, value] of rows) tx.objectStore(store).put(value, key ?? undefined);
  });
}

describe('database schema', () => {
  it('has a pinned shape for every version, and the latest is what a fresh install gets', async () => {
    expect(Math.max(...Object.keys(SHAPES).map(Number))).toBe(DB_VERSION);
    for (let v = 1; v <= DB_VERSION; v++) {
      const shape = await schemaOf(freshFactory(), MIGRATIONS.slice(0, v));
      expect(shape, `version ${v}`).toEqual({ version: v, stores: SHAPES[v] });
    }
  });

  it('upgrades from every earlier version to the fresh-install shape, keeping the data', async () => {
    const fresh = await schemaOf(freshFactory(), MIGRATIONS);
    for (let from = 1; from <= DB_VERSION; from++) {
      const factory = freshFactory();
      const old = await openDatabase(factory, { migrations: MIGRATIONS.slice(0, from) });
      for (let v = 1; v <= from; v++) await seed(old, SEEDS[v] ?? {});
      old.close();
      const db = await openDatabase(factory);
      expect(await describeSchema(db), `from version ${from}`).toEqual(fresh);
      for (let v = 1; v <= from; v++) {
        for (const [store, rows] of Object.entries(SEEDS[v] ?? {})) {
          const dumped = await dumpStore(db, store);
          for (const [, value] of rows) expect(dumped.map(([, val]) => val)).toContainEqual(value);
        }
      }
      db.close();
    }
  });
});

describe('the migration runner', () => {
  // Synthetic versions: 1 creates a store, 2 adds an index and backfills a field, 3 adds a store.
  const m1: Migration = (db) => {
    db.createObjectStore('people', { keyPath: 'id' });
  };
  const m2: Migration = (_db, tx) => {
    const store = tx.objectStore('people');
    store.createIndex('byName', 'name');
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.update({ ...(cursor.value as object), seen: true });
      cursor.continue();
    };
  };
  const m3: Migration = (db) => {
    db.createObjectStore('notes');
  };
  const broken: Migration = (db) => {
    db.createObjectStore('half');
    throw new Error('migration 4 failed');
  };

  it('runs exactly the migrations above the stored version, keeping and transforming data', async () => {
    const factory = freshFactory();
    const v1 = await openDatabase(factory, { name: 'm', migrations: [m1] });
    await transact(v1, 'people', 'readwrite', (tx) => {
      tx.objectStore('people').put({ id: 1, name: 'Huda' });
      tx.objectStore('people').put({ id: 2, name: 'Sam' });
    });
    v1.close();
    const v3 = await openDatabase(factory, { name: 'm', migrations: [m1, m2, m3] });
    expect(v3.version).toBe(3);
    expect((await dumpStore(v3, 'people')).map(([, v]) => v)).toEqual([
      { id: 1, name: 'Huda', seen: true },
      { id: 2, name: 'Sam', seen: true },
    ]);
    const shape = await describeSchema(v3);
    expect(Object.keys(shape.stores).sort()).toEqual(['notes', 'people']);
    expect(shape.stores.people!.indexes.byName).toEqual({ keyPath: 'name', unique: false, multiEntry: false });
    v3.close();
  });

  it('leaves the database at its old version, data intact, when a migration throws', async () => {
    const factory = freshFactory();
    const v3 = await openDatabase(factory, { name: 'm', migrations: [m1, m2, m3] });
    await transact(v3, 'people', 'readwrite', (tx) => tx.objectStore('people').put({ id: 7, name: 'Ali' }));
    v3.close();
    await expect(openDatabase(factory, { name: 'm', migrations: [m1, m2, m3, broken] })).rejects.toThrow('migration 4 failed');
    const again = await openDatabase(factory, { name: 'm', migrations: [m1, m2, m3] });
    expect(again.version).toBe(3);
    expect(Array.from(again.objectStoreNames).sort()).toEqual(['notes', 'people']);
    expect(await dumpStore(again, 'people')).toEqual([[7, { id: 7, name: 'Ali' }]]);
    again.close();
  });

  it('refuses to open a database written by a newer app version', async () => {
    const factory = freshFactory();
    (await openDatabase(factory, { name: 'm', migrations: [m1, m2] })).close();
    const error = await openDatabase(factory, { name: 'm', migrations: [m1] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IdbError);
    expect((error as IdbError).code).toBe('VersionError');
  });

  it('lets an older connection close itself so an upgrade is not blocked', async () => {
    const factory = freshFactory();
    const old = await openDatabase(factory, { name: 'm', migrations: [m1] });
    const upgraded = await openDatabase(factory, { name: 'm', migrations: [m1, m2] });
    expect(upgraded.version).toBe(2);
    expect(() => old.transaction('people', 'readonly')).toThrow();
    upgraded.close();
  });

  it('rolls back a transaction whose body or callback throws', async () => {
    const db = await openDatabase(freshFactory(), { name: 'm', migrations: [m1] });
    await expect(
      transact(db, 'people', 'readwrite', (tx) => {
        tx.objectStore('people').put({ id: 1, name: 'x' });
        throw new Error('body failed');
      }),
    ).rejects.toThrow('body failed');
    await expect(
      transact(db, 'people', 'readwrite', (tx) => {
        const store = tx.objectStore('people');
        store.put({ id: 2, name: 'y' });
        onSuccess(store.get(2), () => {
          throw new Error('callback failed');
        });
      }),
    ).rejects.toThrow('callback failed');
    await expect(transact(db, 'missing', 'readonly', () => undefined)).rejects.toBeInstanceOf(IdbError);
    expect(await dumpStore(db, 'people')).toEqual([]);
    db.close();
  });
});
