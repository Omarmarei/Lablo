import type { DeviceTier } from '@lablo/core';
import type { EpgCatalogSource, EpgRefreshResult, IngestResult, IngestSource, LoadedProfile, SourceMeta } from '@lablo/data';
import type { LifecycleEvent } from '@lablo/platform-api';
// The client entry only: the package index would pull every data module's polyfills into main.
import { CancelSource } from '@lablo/data/client';
import { catalogOf, ingestSourceOf, storedSources, userGuides } from '../onboarding/engine-loader';
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
 *   `onGuides` after a guide swapped in, was deleted or moved (now/next is asked again).
 * - **Now** (step 22b): `refreshNow` reads the guides at once when the user changed the list, or
 *   right after the pass running. A new guide is due at once, a removed one is deleted and a
 *   moved one gets its new rank, with no download. The catalogs wait for the next check.
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
  /** A guide swapped in, one no longer listed was deleted, or one moved in the order. */
  readonly onGuides?: () => void;
  readonly now?: () => number;
  readonly timers?: SchedulerTimers;
}

export interface RefreshScheduler {
  /** Checks `FIRST_CHECK_MS` from now, then every `CHECK_MS`. */
  start(): void;
  /**
   * Reads the guides now (the user changed the list): at once, or right after the pass running
   * (several calls meanwhile share one pass). Only the guides: a catalog that is due waits for
   * the next check, `CHECK_MS` after this pass. Resolves when that pass has ended, whatever it
   * did; at once when disposed.
   */
  refreshNow(): Promise<void>;
  /** Stops the checks and cancels a refresh it runs. */
  dispose(): void;
}

/** Whether a stored source's catalog should be refreshed now (`failedAt`: its last failure in this run). */
export function catalogRefreshDue(meta: SourceMeta | undefined, failedAt: number | undefined, now: number): boolean {
  if (failedAt !== undefined && now - failedAt < CATALOG_RETRY_MS) return false;
  if (meta === undefined || meta.gen === 0) return true;
  const checked = meta.checkedAt ?? meta.updatedAt;
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
  /** `refreshNow` came while a pass ran: a guides pass follows it. */
  let again = false;
  /** `refreshNow` calls the next pass settles. */
  let waiting: (() => void)[] = [];

  const schedule = (ms: number): void => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => check(), ms);
  };

  /**
   * One pass: the catalogs that are due (unless `catalogs` is false), then the guides. Resolves
   * `true` when the slot was busy.
   */
  const pass = async (catalogs: boolean): Promise<boolean> => {
    const profile = await engine.profile();
    const records = storedSources(profile);
    if (records.length === 0) return false;
    const [metas, tier] = await Promise.all([catalogs ? engine.sourceStatus() : Promise.resolve([]), options.tier()]);
    const committed: string[] = [];
    for (const record of catalogs ? records : []) {
      if (disposed) return false;
      let meta: SourceMeta | undefined;
      for (const m of metas) if (m.src === record.id) meta = m;
      if (!catalogRefreshDue(meta, failures.get(record.id), now())) continue;
      // Another refresh holds the slot: the catalogs that committed are told, then it waits.
      if (engine.refreshing) break;
      try {
        // A failure kept here is never older than 2 h when the source is tried again, so a
        // success needs no clearing.
        const result = await engine.refresh({ src: record.id, source: ingestSourceOf(record) }, { lowTier: tier === 'low', cancel: cancel.token });
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
    if (engine.refreshing) return true;
    const result = await engine.refreshEpg(records.map(catalogOf), {
      tier,
      user: userGuides(profile),
      languages: options.languages(),
      // A new catalog: every guide is read again (new channels may match).
      due: !readAll,
      cancel: cancel.token,
    });
    readAll = false;
    let swapped = result.deleted.length > 0 || result.reranked.length > 0;
    for (const outcome of result.outcomes) if (outcome.result !== null && outcome.result.status === 'committed') swapped = true;
    if (swapped && !disposed) options.onGuides?.();
    return false;
  };

  /**
   * A pass now, settling the `refreshNow` calls made so far. Only ever run with no pass running,
   * not disposed, and visible (`refreshNow` aside).
   */
  function check(catalogs = true): void {
    if (timer !== null) timers.clear(timer);
    timer = null;
    running = true;
    const settles = waiting;
    waiting = [];
    pass(catalogs).then(
      (busy) => after(busy, settles),
      (error: unknown) => {
        if (!disposed) console.warn('The scheduled refresh failed', error);
        after(false, settles);
      },
    );
  }

  /**
   * A pass ended: its `refreshNow` calls settle, then a guides pass when one was asked for
   * meanwhile, else the next check, unless hidden (the next visible schedules it) or disposed.
   */
  const after = (busy: boolean, settles: readonly (() => void)[]): void => {
    running = false;
    for (const settle of settles) settle();
    if (disposed) return;
    if (again) {
      again = false;
      check(false);
      return;
    }
    if (hidden) return;
    schedule(busy ? BUSY_RETRY_MS : CHECK_MS);
  };

  return {
    start(): void {
      if (disposed || unsubscribe !== null) return;
      unsubscribe =
        options.lifecycle?.((event) => {
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
    refreshNow(): Promise<void> {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (running) again = true;
        else check(false);
      });
    },
    dispose(): void {
      disposed = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      cancel.cancel();
      const settles = waiting;
      waiting = [];
      for (const settle of settles) settle();
    },
  };
}
