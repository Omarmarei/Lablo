/**
 * S2's storage probes: markers that the next run reads back (does storage survive an app
 * update?), the quota the engine reports, and how much IndexedDB really takes.
 *
 * S2 runs across installs: run the lab, install a newer lab build over it (same app id, a
 * higher version), run it again. A marker written by the older version means the store survived
 * the update (docs/runbooks/tv-setup.md describes the steps).
 */
import { deleteDatabaseAndWait } from './idb-delete';
import type { CheckResult, LabMarker } from './types';

export const MARKER_KEY = 'lablo-lab-marker';
export const MARKER_DB = 'lablo-lab';
export const WRITE_TEST_DB = 'lablo-lab-quota';
const MB = 1024 * 1024;

/** A stored marker, or null when absent or not one of ours. */
export function parseMarker(raw: unknown): LabMarker | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (typeof m.version !== 'string' || typeof m.session !== 'string' || typeof m.at !== 'string' || typeof m.runs !== 'number') return null;
  const hash = m.deviceIdHash;
  return { version: m.version, session: m.session, at: m.at, runs: m.runs, deviceIdHash: typeof hash === 'string' ? hash : null };
}

/** This run's marker: one more run than any marker found. */
export function nextMarker(
  previous: { readonly localStorage: LabMarker | null; readonly indexedDB: LabMarker | null },
  run: { readonly version: string; readonly session: string; readonly at: string; readonly deviceIdHash: string | null },
): LabMarker {
  const runs = Math.max(previous.localStorage?.runs ?? 0, previous.indexedDB?.runs ?? 0) + 1;
  return { ...run, runs };
}

/** What a marker found at start says about a store. */
export function markerVerdict(store: string, found: LabMarker | null, version: string): CheckResult {
  if (found === null) return { status: 'info', value: { found: null }, note: `no marker in ${store}: the lab's first run here, or ${store} was wiped` };
  if (found.version !== version) {
    return { status: 'pass', value: { found }, note: `${store} survived an update from ${found.version} to ${version} (marker from ${found.at})` };
  }
  return { status: 'info', value: { found }, note: `${store} kept the marker of an earlier run of ${version} (${found.at}); install a newer version to test an update` };
}

export function readLocalMarker(storage: Storage | null): LabMarker | null {
  if (storage === null) return null;
  try {
    return parseMarker(storage.getItem(MARKER_KEY));
  } catch {
    return null;
  }
}

/** Writes the marker; returns an error text, or null when written and read back. */
export function writeLocalMarker(storage: Storage | null, marker: LabMarker): string | null {
  if (storage === null) return 'no localStorage';
  try {
    storage.setItem(MARKER_KEY, JSON.stringify(marker));
    return parseMarker(storage.getItem(MARKER_KEY))?.session === marker.session ? null : 'read back something else';
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

function openMarkers(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(MARKER_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('markers');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
    req.onblocked = () => reject(new Error('open blocked'));
  });
}

export function readIdbMarker(factory: IDBFactory | null): Promise<LabMarker | null> {
  if (factory === null) return Promise.resolve(null);
  return openMarkers(factory).then(
    (db) =>
      new Promise<LabMarker | null>((resolve) => {
        const req = db.transaction('markers', 'readonly').objectStore('markers').get('marker');
        req.onsuccess = () => {
          db.close();
          resolve(parseMarker(req.result));
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      }),
    () => null,
  );
}

/** Resolves an error text, or null when written. */
export function writeIdbMarker(factory: IDBFactory | null, marker: LabMarker): Promise<string | null> {
  if (factory === null) return Promise.resolve('no indexedDB');
  return openMarkers(factory).then(
    (db) =>
      new Promise<string | null>((resolve) => {
        const tx = db.transaction('markers', 'readwrite');
        tx.objectStore('markers').put(marker, 'marker');
        tx.oncomplete = () => {
          db.close();
          resolve(null);
        };
        tx.onerror = () => {
          db.close();
          resolve(tx.error === null ? 'transaction failed' : `${tx.error.name}: ${tx.error.message}`);
        };
      }),
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

export interface QuotaReport {
  readonly api: 'storage.estimate' | 'webkitTemporaryStorage' | 'none';
  readonly quotaMb: number | null;
  readonly usageMb: number | null;
  /** `navigator.storage.persisted()`, when the engine has it. */
  readonly persisted: boolean | null;
}

interface StorageNavigator {
  readonly storage?: { estimate?(): Promise<{ quota?: number; usage?: number }>; persisted?(): Promise<boolean> };
  readonly webkitTemporaryStorage?: { queryUsageAndQuota(ok: (usage: number, quota: number) => void, fail?: (error: unknown) => void): void };
}

const toMb = (bytes: number | undefined): number | null => (typeof bytes === 'number' ? Math.round((bytes / MB) * 10) / 10 : null);

export async function readQuota(nav: StorageNavigator): Promise<QuotaReport> {
  const persisted = typeof nav.storage?.persisted === 'function' ? await nav.storage.persisted().catch(() => null) : null;
  if (typeof nav.storage?.estimate === 'function') {
    const estimate = await nav.storage.estimate();
    return { api: 'storage.estimate', quotaMb: toMb(estimate.quota), usageMb: toMb(estimate.usage), persisted };
  }
  const temporary = nav.webkitTemporaryStorage;
  if (temporary !== undefined) {
    const [usage, quota] = await new Promise<[number, number]>((resolve, reject) => {
      temporary.queryUsageAndQuota((u, q) => resolve([u, q]), reject);
    });
    return { api: 'webkitTemporaryStorage', quotaMb: toMb(quota), usageMb: toMb(usage), persisted };
  }
  return { api: 'none', quotaMb: null, usageMb: null, persisted };
}

export interface WriteTestReport {
  readonly targetMb: number;
  readonly writtenMb: number;
  readonly ms: number;
  readonly mbPerSecond: number | null;
  /** Why the writes stopped short, or null. */
  readonly error: string | null;
  readonly deleted: boolean;
}

async function deleteDb(factory: IDBFactory, name: string): Promise<boolean> {
  return (await deleteDatabaseAndWait(factory, name)) === null;
}

/** A megabyte that doesn't compress (xorshift), so the store really holds what is written. */
export function noise(bytes: number, seed: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let x = seed | 0 || 1;
  for (let i = 0; i < bytes; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 255;
    out[i + 1] = (x >>> 8) & 255;
    out[i + 2] = (x >>> 16) & 255;
    out[i + 3] = (x >>> 24) & 255;
  }
  return out;
}

/**
 * Writes `targetMb` one-megabyte records into a scratch database, `perTransaction` at a time,
 * until done or the engine refuses (QuotaExceededError), then deletes it.
 */
export async function idbWriteTest(factory: IDBFactory, targetMb: number, clock: () => number = () => Date.now(), perTransaction = 4): Promise<WriteTestReport> {
  await deleteDb(factory, WRITE_TEST_DB);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(WRITE_TEST_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
    req.onblocked = () => reject(new Error('open blocked'));
  });
  const block = noise(MB, 0x2545f491);
  const started = clock();
  let written = 0;
  let error: string | null = null;
  while (written < targetMb && error === null) {
    const batch = Math.min(perTransaction, targetMb - written);
    error = await new Promise<string | null>((resolve) => {
      const tx = db.transaction('blobs', 'readwrite');
      const store = tx.objectStore('blobs');
      try {
        for (let i = 0; i < batch; i += 1) {
          // Each record differs: its number in the first bytes (put clones the bytes right away).
          const n = written + i;
          block[0] = n & 255;
          block[1] = (n >>> 8) & 255;
          store.put(block.buffer, n);
        }
      } catch (thrown) {
        // A put can also refuse at once (an inactive or aborted transaction).
        try {
          tx.abort();
        } catch {
          // Already finished.
        }
        resolve(thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown));
        return;
      }
      tx.oncomplete = () => resolve(null);
      tx.onerror = () => resolve(tx.error === null ? 'transaction failed' : `${tx.error.name}: ${tx.error.message}`);
      tx.onabort = () => resolve(tx.error === null ? 'transaction aborted' : `${tx.error.name}: ${tx.error.message}`);
    });
    if (error === null) written += batch;
  }
  const ms = clock() - started;
  db.close();
  return {
    targetMb,
    writtenMb: written,
    ms,
    mbPerSecond: ms > 0 ? Math.round((written / (ms / 1000)) * 10) / 10 : null,
    error,
    deleted: await deleteDb(factory, WRITE_TEST_DB),
  };
}
