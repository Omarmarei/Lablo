import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { idbRoundTrip } from './idb-check';

describe('idbRoundTrip (hello worker IndexedDB check)', () => {
  it('writes a record and reads it back', async () => {
    await expect(idbRoundTrip(new FakeIDBFactory(), 42)).resolves.toBe('ok');
  });

  it('works again on an existing database (second app start)', async () => {
    const factory = new FakeIDBFactory();
    await expect(idbRoundTrip(factory, 1)).resolves.toBe('ok');
    await expect(idbRoundTrip(factory, 2)).resolves.toBe('ok');
  });

  it('reports a missing indexedDB instead of throwing', async () => {
    await expect(idbRoundTrip(undefined, 1)).resolves.toBe('failed: indexedDB is missing');
  });

  it('reports a database that cannot be opened', async () => {
    const broken = {
      open() {
        throw new Error('access denied for this origin');
      },
    } as unknown as IDBFactory;
    await expect(idbRoundTrip(broken, 1)).resolves.toBe('failed: open threw access denied for this origin');
  });

  it('reports a record that does not read back', async () => {
    const factory = new FakeIDBFactory();
    const realOpen = factory.open.bind(factory);
    const dropsWrites = {
      open(name: string, version?: number) {
        const request = realOpen(name, version);
        // Registered before the check's own onsuccess handler, so it runs first: put() becomes a no-op.
        request.addEventListener('success', () => {
          const db = request.result;
          const realTransaction = db.transaction.bind(db);
          db.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
            const tx = realTransaction(...args);
            const store = tx.objectStore('kv');
            store.put = (() => store.get('nothing')) as unknown as IDBObjectStore['put'];
            tx.objectStore = (() => store) as IDBTransaction['objectStore'];
            return tx;
          }) as IDBDatabase['transaction'];
        });
        return request;
      },
    } as unknown as IDBFactory;
    await expect(idbRoundTrip(dropsWrites, 7)).resolves.toBe('failed: read back undefined');
  });
});
