/**
 * IndexedDB plumbing for the data workers: opening the database with versioned migrations, and
 * running transactions.
 *
 * Transactions are callback-driven inside, promise-based outside. A transaction body issues its
 * requests and chains follow-up requests from their `onsuccess` callbacks; it never `await`s.
 * IndexedDB commits a transaction once a task ends with no request pending, and on Chromium 53
 * the transpiled `async` code may resume on a later task (a polyfilled Promise can schedule
 * with `setTimeout`), so an `await` inside a transaction would find it committed.
 */

import type { Migration } from './schema';
import { DB_NAME, MIGRATIONS } from './schema';

export type TxMode = 'readonly' | 'readwrite';

/** Error from a failed open, migration or transaction, with the IndexedDB error name. */
export class IdbError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'IdbError';
  }
}

function idbError(error: { name: string; message: string } | null | undefined, fallback: string): IdbError {
  if (error instanceof IdbError) return error;
  return new IdbError(error?.message || fallback, error?.name || 'AbortError');
}

/**
 * Runs `body` in one transaction over `stores` and resolves, once the transaction has committed,
 * with the value last passed to `done` (`undefined` if never called). Rejects if the body
 * throws, a request fails, or the transaction aborts; nothing it wrote is kept then.
 */
export function transact<T = void>(
  db: IDBDatabase,
  stores: string | string[],
  mode: TxMode,
  body: (tx: IDBTransaction, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(idbError(error as Error, 'Could not start a transaction'));
      return;
    }
    let value: T | undefined;
    tx.oncomplete = () => resolve(value as T);
    tx.onabort = () => reject(FAILURES.has(tx) ? FAILURES.get(tx) : idbError(tx.error, 'Transaction aborted'));
    try {
      body(tx, (v) => {
        value = v;
      });
    } catch (error) {
      fail(tx, error);
    }
  });
}

/** Why a transaction was aborted from our own code (the error `transact` rejects with). */
const FAILURES = new WeakMap<IDBTransaction, unknown>();

function fail(tx: IDBTransaction, error: unknown): void {
  if (!FAILURES.has(tx)) FAILURES.set(tx, error);
  try {
    tx.abort();
  } catch {
    // Already finished: onabort or oncomplete settles the promise.
  }
}

/**
 * Sets `onsuccess` on a request. If `then` throws, the transaction is aborted and `transact`
 * rejects with that error; a failed request aborts it too (with the request's error).
 */
export function onSuccess<R>(request: IDBRequest<R>, then: (result: R) => void): void {
  request.onsuccess = () => {
    try {
      then(request.result);
    } catch (error) {
      if (request.transaction) fail(request.transaction, error);
      else throw error;
    }
  };
}

/** Reads one value by key in its own transaction. */
export function getValue<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return transact<T | undefined>(db, store, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(store).get(key), (v) => done(v as T | undefined));
  });
}

export interface OpenOptions {
  /** Database name (default `zoma`). */
  name?: string;
  /** Migration list (default: the app's `MIGRATIONS`); the database version is its length. */
  migrations?: readonly Migration[];
  /** Another tab or worker holds an older version open and hasn't closed it yet. */
  onBlocked?: () => void;
}

/**
 * Opens the database, running every migration from its stored version to the latest inside the
 * upgrade transaction. A migration that throws aborts the upgrade: the database stays at its old
 * version with its data untouched, and the promise rejects with that error. Opened connections
 * close themselves when another context needs to upgrade.
 */
export function openDatabase(factory: IDBFactory, options: OpenOptions = {}): Promise<IDBDatabase> {
  const migrations = options.migrations ?? MIGRATIONS;
  const name = options.name ?? DB_NAME;
  return new Promise<IDBDatabase>((resolve, reject) => {
    let failure: unknown = null;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, migrations.length);
    } catch (error) {
      reject(idbError(error as Error, 'Could not open the database'));
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      try {
        for (let v = event.oldVersion; v < migrations.length; v++) migrations[v]!(db, tx);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = (event) => {
      event.preventDefault();
      reject(failure !== null ? failure : idbError(request.error, 'Could not open the database'));
    };
    request.onblocked = () => options.onBlocked?.();
  });
}

/** Deletes a database (tests and "reset app data"). */
export function deleteDatabase(factory: IDBFactory, name = DB_NAME): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(idbError(request.error, 'Could not delete the database'));
  });
}
