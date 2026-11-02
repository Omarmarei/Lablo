/**
 * The profile document (architecture.md §1.3): the only data that can't be rebuilt from the
 * provider. It lives in the `profile` store as `current`, plus 3 rolling snapshots for rollback,
 * and (from step 32) in the encrypted cloud backup.
 *
 * Its shape is versioned separately from the database. Older documents are upgraded on load by
 * `PROFILE_MIGRATIONS`, pure functions that never drop data; the document from before the
 * upgrade is kept as a snapshot. A document from a newer app version is returned as it is and
 * never overwritten by this version.
 *
 * Version 1 (RELAY step 7) holds the favourites. Later steps add fields with a migration each.
 */

import type { ContentKey, ContentKind } from '@zoma/core';
import { onSuccess, transact } from './idb';
import { STORE } from './schema';

/** A favourite item. `normName` re-matches it when a provider renumbers its streams (step 8). */
export interface FavouriteRef {
  key: ContentKey;
  src: string;
  kind: ContentKind;
  normName: string;
  /** Epoch ms when it was added. */
  added: number;
  /** Epoch ms since its key has been missing from the catalog (`null`: present). */
  missingSince: number | null;
}

// A type alias (not an interface) so that it is assignable to `AnyProfile`.
export type ProfileV1 = {
  v: 1;
  favourites: FavouriteRef[];
};

/** The current profile shape. */
export type ProfileDoc = ProfileV1;

/** A stored document of any version (older ones are migrated on load). */
export interface AnyProfile {
  v: number;
  [field: string]: unknown;
}

/** `PROFILE_MIGRATIONS[i]` upgrades a version `i + 1` document to version `i + 2`. Append only. */
export type ProfileMigration = (doc: AnyProfile) => AnyProfile;

export const PROFILE_MIGRATIONS: readonly ProfileMigration[] = [];

export const PROFILE_VERSION = PROFILE_MIGRATIONS.length + 1;

/** Snapshot slots kept for rollback. */
export const SNAPSHOT_SLOTS = 3;
/** A save snapshots the previous document when the newest snapshot is older than this. */
export const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000;

export type SnapshotReason = 'daily' | 'migration' | 'restore';

interface ProfileRecord {
  id: string;
  savedAt: number;
  doc: AnyProfile;
}

export interface ProfileSnapshot extends ProfileRecord {
  reason: SnapshotReason;
}

const CURRENT = 'current';
const SNAPSHOTS = (): IDBKeyRange => IDBKeyRange.bound('snap:', 'snap:~');

export function emptyProfile(): ProfileDoc {
  return { v: 1, favourites: [] };
}

/** Thrown for a stored document that is not a profile, or a migration that fails. */
export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

function checkVersion(doc: unknown): AnyProfile {
  const v = (doc as AnyProfile | null)?.v;
  if (typeof doc !== 'object' || doc === null || typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
    throw new ProfileError('Stored profile has no valid version');
  }
  return doc as AnyProfile;
}

/**
 * Upgrades `doc` to the latest version. Pure: returns new objects, leaves `doc` alone.
 * `migrated` is false when it was already current (or newer: `newer` is then true).
 */
export function migrateProfile(
  doc: unknown,
  migrations: readonly ProfileMigration[] = PROFILE_MIGRATIONS,
): { doc: AnyProfile; from: number; migrated: boolean; newer: boolean } {
  const start = checkVersion(doc);
  const latest = migrations.length + 1;
  if (start.v >= latest) return { doc: start, from: start.v, migrated: false, newer: start.v > latest };
  let out: AnyProfile = JSON.parse(JSON.stringify(start)) as AnyProfile;
  for (let v = start.v; v < latest; v++) {
    out = migrations[v - 1]!(out);
    if (out.v !== v + 1) throw new ProfileError(`Profile migration ${v} → ${v + 1} returned version ${String(out.v)}`);
  }
  return { doc: out, from: start.v, migrated: true, newer: false };
}

/** Picks the slot to write: an empty one, else the oldest snapshot (never `keep`). */
function snapshotSlot(snapshots: ProfileSnapshot[], keep?: string): string {
  for (let i = 0; i < SNAPSHOT_SLOTS; i++) {
    const id = `snap:${i}`;
    if (id !== keep && !snapshots.some((s) => s.id === id)) return id;
  }
  let oldest: ProfileSnapshot | null = null;
  for (const s of snapshots) if (s.id !== keep && (!oldest || s.savedAt < oldest.savedAt)) oldest = s;
  return oldest!.id;
}

export interface LoadedProfile {
  doc: AnyProfile;
  /** The document came from a newer app version: show it, but never save over it. */
  newer: boolean;
  /** The stored document was upgraded (and the old one snapshotted) by this load. */
  migratedFrom: number | null;
}

export interface ProfileOptions {
  now?: number;
  migrations?: readonly ProfileMigration[];
}

/**
 * Loads the current profile, upgrading it in place if it is older than this app version (the old
 * document goes to a snapshot slot in the same transaction). `null` when there is none: a fresh
 * install, or a webOS wipe (step 32 restores it from the cloud).
 */
export function loadProfile(db: IDBDatabase, options: ProfileOptions = {}): Promise<LoadedProfile | null> {
  const now = options.now ?? Date.now();
  return transact<LoadedProfile | null>(db, STORE.profile, 'readwrite', (tx, done) => {
    const store = tx.objectStore(STORE.profile);
    onSuccess(store.get(CURRENT), (value) => {
      const record = value as ProfileRecord | undefined;
      if (!record) {
        done(null);
        return;
      }
      const result = migrateProfile(record.doc, options.migrations);
      done({ doc: result.doc, newer: result.newer, migratedFrom: result.migrated ? result.from : null });
      if (!result.migrated) return;
      onSuccess(store.getAll(SNAPSHOTS()), (snaps) => {
        const snapshot: ProfileSnapshot = { id: snapshotSlot(snaps as ProfileSnapshot[]), savedAt: now, doc: record.doc, reason: 'migration' };
        store.put(snapshot);
        store.put({ id: CURRENT, savedAt: now, doc: result.doc } satisfies ProfileRecord);
      });
    });
  });
}

/**
 * Saves `doc` as the current profile. When the newest snapshot is older than a day (or there is
 * none), the document being replaced is snapshotted first, in the same transaction.
 */
export function saveProfile(db: IDBDatabase, doc: ProfileDoc, options: { now?: number; snapshotEveryMs?: number } = {}): Promise<void> {
  const now = options.now ?? Date.now();
  const every = options.snapshotEveryMs ?? SNAPSHOT_EVERY_MS;
  checkVersion(doc);
  if (doc.v !== PROFILE_VERSION) throw new ProfileError(`Can't save a version ${doc.v} profile (this app writes ${PROFILE_VERSION})`);
  return transact<void>(db, STORE.profile, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.profile);
    onSuccess(store.get(CURRENT), (value) => {
      const previous = value as ProfileRecord | undefined;
      if (previous && checkVersion(previous.doc).v > PROFILE_VERSION) {
        throw new ProfileError('The stored profile is from a newer app version');
      }
      onSuccess(store.getAll(SNAPSHOTS()), (value2) => {
        const snaps = value2 as ProfileSnapshot[];
        const newest = snaps.reduce((m, s) => Math.max(m, s.savedAt), -Infinity);
        if (previous && now - newest >= every) {
          store.put({ id: snapshotSlot(snaps), savedAt: now, doc: previous.doc, reason: 'daily' } satisfies ProfileSnapshot);
        }
        store.put({ id: CURRENT, savedAt: now, doc } satisfies ProfileRecord);
      });
    });
  });
}

/** The snapshots, newest first. */
export function listSnapshots(db: IDBDatabase): Promise<ProfileSnapshot[]> {
  return transact<ProfileSnapshot[]>(db, STORE.profile, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.profile).getAll(SNAPSHOTS()), (snaps) => {
      done((snaps as ProfileSnapshot[]).sort((a, b) => b.savedAt - a.savedAt));
    });
  });
}

/**
 * Makes snapshot `id` the current profile (rollback). The document it replaces is snapshotted
 * into the oldest other slot, so a rollback can itself be undone.
 */
export function restoreSnapshot(db: IDBDatabase, id: string, options: { now?: number } = {}): Promise<void> {
  const now = options.now ?? Date.now();
  return transact<void>(db, STORE.profile, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.profile);
    onSuccess(store.getAll(SNAPSHOTS()), (value) => {
      const snaps = value as ProfileSnapshot[];
      const chosen = snaps.find((s) => s.id === id);
      if (!chosen) throw new ProfileError(`No profile snapshot ${id}`);
      onSuccess(store.get(CURRENT), (cur) => {
        const current = cur as ProfileRecord | undefined;
        if (current) {
          store.put({ id: snapshotSlot(snaps, id), savedAt: now, doc: current.doc, reason: 'restore' } satisfies ProfileSnapshot);
        }
        store.put({ id: CURRENT, savedAt: now, doc: chosen.doc } satisfies ProfileRecord);
      });
    });
  });
}
