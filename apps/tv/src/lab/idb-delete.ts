/**
 * Deleting a lab database (S1's bulk write, S2's write test, S6's copy of the app database).
 * A connection just closed still finishes its transactions, and the delete's `blocked` event can
 * fire meanwhile; the delete then goes ahead. So `blocked` is not the answer: success, an error
 * or the timeout is. No imports: the lab worker uses it too.
 */

/** Deletes a database, waiting out connections that are still closing (`onblocked` is not the end). */
export function deleteDatabaseAndWait(factory: IDBFactory, name: string, timeoutMs = 20_000): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (error: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(error);
    };
    const timer = setTimeout(() => finish(`still blocked after ${timeoutMs} ms`), timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = factory.deleteDatabase(name);
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error));
      return;
    }
    req.onsuccess = () => finish(null);
    req.onerror = () => finish(req.error ? req.error.message : 'delete failed');
  });
}
