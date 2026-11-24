import type { ReadonlySignal } from '@preact/signals';
import { computed, signal } from '@preact/signals';

/**
 * Whether Lablo's storage on the TV is full (RELAY step 39s1, architecture.md §1.3 "Storage
 * space"), as the data engine sees its writes: a source's catalog refresh, a guide's refresh and a
 * profile save each fail for space or go through. The data layer has made room first (the guides
 * go; storage-room.ts), so a failure here means that was not enough.
 *
 * - **The live screen's line** shows while any of them failed for space and has not gone through
 *   since (`full`).
 * - **The sources screen** says it on the row of each source whose refresh failed for space
 *   (`sourceFull`); the guides screen reads its own from each guide's stored failure.
 * - It lasts for the run only: a restart starts with nothing failed, and the schedule's next try
 *   finds it again.
 */

/** A write the state follows: a source's catalog, a guide, or the profile. */
export type StorageItem = { readonly kind: 'source' | 'guide'; readonly id: string } | { readonly kind: 'profile' };

/** What the data engine tells the state (`DataEngineOptions.storage`). */
export interface StorageWatch {
  /** `item`'s write failed for space. */
  failed(item: StorageItem): void;
  /** `item`'s write went through (or the item is gone). */
  saved(item: StorageItem): void;
}

export interface StorageState extends StorageWatch {
  /** A write failed for space and has not gone through since. */
  readonly full: ReadonlySignal<boolean>;
  /** The source's last refresh in this run failed for space. */
  sourceFull(id: string): boolean;
}

/** Whether a data call failed because the storage is full: IndexedDB's error, or a refresh's `storage`. */
export function isStorageError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'QuotaExceededError' || code === 'storage';
}

function keyOf(item: StorageItem): string {
  return item.kind === 'profile' ? 'profile' : item.kind + ':' + item.id;
}

export function createStorageState(): StorageState {
  const failing = signal<readonly string[]>([]);
  return {
    full: computed(() => failing.value.length > 0),
    sourceFull: (id) => failing.value.indexOf(keyOf({ kind: 'source', id })) !== -1,
    failed: (item) => {
      const key = keyOf(item);
      if (failing.value.indexOf(key) === -1) failing.value = failing.value.concat([key]);
    },
    saved: (item) => {
      const key = keyOf(item);
      if (failing.value.indexOf(key) !== -1) failing.value = failing.value.filter((k) => k !== key);
    },
  };
}
