/**
 * IndexedDB sanity check for the hello worker (relay step 2b): open a database, write a record,
 * read it back in the same transaction, close. The data engine keeps the catalog in IndexedDB
 * inside workers, so this proves the path on every engine the old-engine harness runs.
 *
 * Resolves `'ok'` or `'failed: <reason>'`; never rejects.
 */
export function idbRoundTrip(factory: IDBFactory | undefined, nonce: number, name = 'zoma-hello'): Promise<string> {
  return new Promise((resolve) => {
    if (factory === undefined || factory === null) {
      resolve('failed: indexedDB is missing');
      return;
    }
    const fail = (stage: string, error: DOMException | null): void => {
      resolve(`failed: ${stage}${error === null ? '' : ` (${error.name}: ${error.message})`}`);
    };

    let open: IDBOpenDBRequest;
    try {
      open = factory.open(name, 1);
    } catch (error) {
      resolve(`failed: open threw ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    open.onupgradeneeded = () => {
      open.result.createObjectStore('kv');
    };
    open.onerror = () => fail('open', open.error);
    open.onblocked = () => fail('open blocked', null);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.put({ nonce }, 'ping');
      const read = store.get('ping');
      tx.oncomplete = () => {
        db.close();
        const value = read.result as { nonce?: unknown } | undefined;
        resolve(value?.nonce === nonce ? 'ok' : `failed: read back ${JSON.stringify(value)}`);
      };
      tx.onerror = () => {
        db.close();
        fail('transaction', tx.error);
      };
    };
  });
}
