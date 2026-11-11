/**
 * S1's IndexedDB bulk write, as the ingest worker writes a catalog: `items` small records in
 * `chunk`-sized readwrite transactions, then a count, a getAll over one chunk, and the database
 * deleted again. Runs in the lab worker (and in Node over fake-indexeddb in the tests).
 */
import { deleteDatabaseAndWait } from './idb-delete';
import type { BulkReport } from './worker-protocol';

export const BULK_DB = 'lablo-lab-s1';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(BULK_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('items', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
    req.onblocked = () => reject(new Error('open blocked'));
  });
}

async function remove(factory: IDBFactory): Promise<boolean> {
  return (await deleteDatabaseAndWait(factory, BULK_DB)) === null;
}

/** A catalog-like record (about 130 bytes). */
export function bulkItem(i: number): { id: number; num: number; name: string; group: string; url: string } {
  return { id: i, num: i + 1, name: `Channel ${i} قناة`, group: `Group ${i % 14}`, url: `http://example.invalid/live/${i}.ts` };
}

export async function idbBulkWrite(factory: IDBFactory, items: number, chunk: number, clock: () => number = () => Date.now()): Promise<BulkReport> {
  await remove(factory);
  const db = await open(factory);
  try {
    const started = clock();
    let slowestChunkMs = 0;
    for (let from = 0; from < items; from += chunk) {
      const chunkStarted = clock();
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const to = Math.min(items, from + chunk);
      for (let i = from; i < to; i += 1) store.put(bulkItem(i));
      await done(tx);
      slowestChunkMs = Math.max(slowestChunkMs, clock() - chunkStarted);
    }
    const writeMs = clock() - started;
    const read = db.transaction('items', 'readonly').objectStore('items');
    const count = await request(read.count());
    const getAll = typeof read.getAll === 'function' ? (await request(read.getAll(IDBKeyRange.bound(0, chunk - 1)))).length : null;
    db.close();
    return { items, chunk, writeMs, slowestChunkMs, count, getAll, deleted: await remove(factory) };
  } catch (error) {
    db.close();
    await remove(factory);
    throw error;
  }
}
