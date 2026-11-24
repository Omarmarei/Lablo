/**
 * When Lablo's storage on the TV is full (RELAY step 39s1, architecture.md §1.3 "Storage space").
 *
 * IndexedDB refuses a transaction that writes past the origin's quota with `QuotaExceededError`
 * and keeps nothing it wrote. Chromium always commits a transaction that only deletes (it checks
 * the quota only for one that writes), so deleting always makes room.
 *
 * The guides are what the app gives up first (Omar's choice, 2026-11-24): a catalog refresh or a
 * profile save that fails for space deletes the stored guides and tries once more, and the guides
 * are read again into the space left. The last good catalog and the profile are never deleted to
 * make room. A guide's own refresh deletes only that guide's older programmes (epg-ingest.ts).
 */

import { transact } from './idb';
import { STORE } from './schema';

/** The name of IndexedDB's error, and its code once it crossed a worker (`IdbError`, `RpcError`). */
export const QUOTA_ERROR = 'QuotaExceededError';

/** Whether a write failed because the store is full. */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; name?: unknown };
  return e.code === QUOTA_ERROR || e.name === QUOTA_ERROR;
}

/**
 * Deletes every guide: its bookkeeping, programmes and match tables, in one transaction that only
 * deletes. The guides then read as never read, and the next refresh reads them again. A guide
 * refresh running meanwhile finds its generation gone and fails as superseded.
 */
export function dropGuides(db: IDBDatabase): Promise<void> {
  return transact<void>(db, [STORE.epgMeta, STORE.epgBuckets, STORE.epgChannels], 'readwrite', (tx) => {
    tx.objectStore(STORE.epgMeta).clear();
    tx.objectStore(STORE.epgBuckets).clear();
    tx.objectStore(STORE.epgChannels).clear();
  });
}

/**
 * The room one refresh may make: `write` runs, and when it fails for space, `drop` makes room
 * (once per `Room`) and `write` runs once more. A second failure for space, or any other failure,
 * rejects as it came.
 */
export class Room {
  /** Room was made: `drop` ran. */
  made = false;

  constructor(
    private readonly drop: () => Promise<void>,
    private readonly onMade?: () => void,
  ) {}

  async write<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (this.made || !isQuotaError(error)) throw error;
      this.made = true;
      await this.drop();
      this.onMade?.();
      return write();
    }
  }
}
