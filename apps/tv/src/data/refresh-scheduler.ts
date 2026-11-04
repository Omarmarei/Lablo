import type { DeviceTier } from '@zoma/core';
import type { EpgCatalogSource, EpgRefreshResult, IngestResult, IngestSource, LoadedProfile, SourceMeta } from '@zoma/data';
import type { LifecycleEvent } from '@zoma/platform-api';
// The client entry only: the package index would pull every data module's polyfills into main.
import { CancelSource } from '@zoma/data/client';
import { catalogOf, guidesOf, ingestSourceOf, storedSources } from '../onboarding/engine-loader';
import type { EpgRefreshOptions, RefreshOptions } from './engine';

/**
 * The refresh schedule while the app runs (RELAY step 22a, architecture.md §1.4 item 1 and §1.5
 * item 8). Startup always shows what is stored; the refreshes come after, in the background:
 *
 * - **When:** a first check `FIRST_CHECK_MS` after the live screen opens (the start on the last
 *   channel and the first list stay fast), then every `CHECK_MS`. Hidden, nothing is checked; a
 *   check comes `FIRST_CHECK_MS` after the app is visible again.
 * - **Catalogs:** each stored source whose last check is `CATALOG_REFRESH_MS` old, or that has no
 *   catalog at all (webOS may wipe the database on an update), is refreshed, one at a time. A
 *   failed one waits `CATALOG_RETRY_MS` (kept in memory: a relaunch tries again).
 * - **Guides:** `refreshEpg` with `due` (`epgRefreshDue`: 12 h, or under 24 h of programmes left,
 *   failures held 2 h). After a catalog refresh that committed, every guide is read (new
 *   channels may match), at the next pass when the slot was busy.
 * - **One at a time:** the data engine has one refresh slot, so a low-tier TV never runs a
 *   catalog and a guide refresh at once. When something else holds it (onboarding, the hello
 *   screen), the work waits `BUSY_RETRY_MS`.
 * - **The screens:** `onCatalog` after a catalog swapped in (the live screen reads it again),
 *   `onGuides` after a guide swapped in or was deleted (now/next is asked again).
 */

/** The first check after the start, and after the app is visible again. */
export const FIRST_CHECK_MS = 15_000;
/** How often the schedule is checked while the app runs. */
export const CHECK_MS = 15 * 60_000;
/** A catalog checked this long ago is refreshed (live after 12 h, PLAN.md; the source's lists come together). */
export const CATALOG_REFRESH_MS = 12 * 3_600_000;
/** A catalog refresh that failed waits this long. */
export const CATALOG_RETRY_MS = 2 * 3_600_000;
/** The next try when another refresh holds the slot. */
export const BUSY_RETRY_MS = 60_000;

/** What the schedule needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface SchedulerEngine {
  readonly refreshing: boolean;
  profile(): Promise<LoadedProfile | null>;
  sourceStatus(): Promise<SourceMeta[]>;
  refresh(job: { src: string; source: IngestSource }, options: RefreshOptions): Promise<IngestResult>;
  refreshEpg(catalogs: readonly EpgCatalogSource[], options: EpgRefreshOptions): Promise<EpgRefreshResult>;
}

export interface SchedulerTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SchedulerOptions {
  readonly engine: SchedulerEngine;
  /** The TV's tier: a low-tier TV refreshes at the 50/50 duty cycle and keeps less guide. */
  readonly tier: () => Promise<DeviceTier>;
  /** UI languages, most preferred first (the guides' titles are picked by them). */
  readonly languages: () => string[];
  /** Subscribes to the app's visibility (`Platform.onLifecycle`). */
  readonly lifecycle?: (listener: (event: LifecycleEvent) => void) => () => void;
  /** Catalogs swapped in: the sources' ids. */
  readonly onCatalog?: (srcs: string[]) => void;
  /** A guide swapped in, or one no longer listed was deleted. */
  readonly onGuides?: () => void;
  readonly now?: () => number;
  readonly timers?: SchedulerTimers;
}

export interface RefreshScheduler {
  /** Checks `FIRST_CHECK_MS` from now, then every `CHECK_MS`. */
  start(): void;
  /** Stops the checks and cancels a refresh it runs. */
  dispose(): void;
}

/** Whether a stored source's catalog should be refreshed now (`failedAt`: its last failure in this run). */
export function catalogRefreshDue(meta: SourceMeta | undefined, failedAt: number | undefined, now: number): boolean {
  if (failedAt !== undefined && now - failedAt < CATALOG_RETRY_MS) return false;
  if (meta === undefined || meta.gen === 0) return true;
  const checked = typeof meta.checkedAt === 'number' ? meta.checkedAt : meta.updatedAt;
  return checked === null || now - checked >= CATALOG_REFRESH_MS;
}

const defaultTimers: SchedulerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createRefreshScheduler(options: SchedulerOptions): RefreshScheduler {
  const { engine } = options;
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? defaultTimers;
  const cancel = new CancelSource();
  /** When each source's catalog refresh last failed (this run only). */
  const failures = new Map<string, number>();
  let timer: unknown = null;
  let running = false;
  let hidden = false;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  /** A catalog committed since the guides were last read: every guide is read next. */
  let readAll = false;

  const schedule = (ms: number): void => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(check, ms);
  };

  /** One pass: the catalogs that are due, then the guides. Resolves `true` when the slot was busy. */
  const pass = async (): Promise<boolean> => {
    const records = storedSources(await engine.profile());
    if (records.length === 0) return false;
    const [metas, tier] = await Promise.all([engine.sourceStatus(), options.tier()]);
    const committed: string[] = [];
    let busy = false;
    for (const record of records) {
      if (disposed) return false;
      let meta: SourceMeta | undefined;
      for (const m of metas) if (m.src === record.id) meta = m;
      if (!catalogRefreshDue(meta, failures.get(record.id), now())) continue;
      if (engine.refreshing) {
        busy = true;
        break;
      }
      try {
        const result = await engine.refresh({ src: record.id, source: ingestSourceOf(record) }, { lowTier: tier === 'low', cancel: cancel.token });
        failures.delete(record.id);
        if (result.status === 'committed') committed.push(record.id);
      } catch (error) {
        if (disposed) return false;
        failures.set(record.id, now());
        console.warn('A catalog refresh failed', error);
      }
    }
    if (disposed) return false;
    if (committed.length > 0) {
      readAll = true;
      options.onCatalog?.(committed);
    }
    if (busy || engine.refreshing) return true;
    const result = await engine.refreshEpg(records.map(catalogOf), {
      tier,
      user: guidesOf(records),
      languages: options.languages(),
      // A new catalog: every guide is read again (new channels may match).
      due: !readAll,
      cancel: cancel.token,
    });
    readAll = false;
    let swapped = result.deleted.length > 0;
    for (const outcome of result.outcomes) if (outcome.result !== null && outcome.result.status === 'committed') swapped = true;
    if (swapped && !disposed) options.onGuides?.();
    return false;
  };

  function check(): void {
    timer = null;
    if (disposed || hidden || running) return;
    running = true;
    pass().then(
      (busy) => after(busy),
      (error: unknown) => {
        if (!disposed) console.warn('The scheduled refresh failed', error);
        after(false);
      },
    );
  }

  /** A pass ended: the next check, unless hidden (the next visible schedules it) or disposed. */
  const after = (busy: boolean): void => {
    running = false;
    if (disposed || hidden) return;
    schedule(busy ? BUSY_RETRY_MS : CHECK_MS);
  };

  return {
    start(): void {
      if (disposed || unsubscribe !== null) return;
      unsubscribe =
        options.lifecycle?.((event) => {
          if (disposed) return;
          if (event === 'hidden') {
            hidden = true;
            if (timer !== null) timers.clear(timer);
            timer = null;
            return;
          }
          hidden = false;
          // A pass running now schedules the next check when it ends.
          if (!running) schedule(FIRST_CHECK_MS);
        }) ?? (() => undefined);
      schedule(FIRST_CHECK_MS);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      cancel.cancel();
    },
  };
}
