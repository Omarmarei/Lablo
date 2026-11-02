/**
 * The app's side of the data workers (architecture.md §1.2 and §1.4, RELAY step 8b):
 * - the **query worker** starts once and keeps running; every catalog read goes through it;
 * - an **ingest worker** starts for each refresh and is terminated when the refresh ends,
 *   which frees its whole heap. At app start a short-lived one runs `prune`, which clears what
 *   crashed or killed refreshes left behind;
 * - when a refresh swaps in a new generation (`swapped`), the query worker `reload`s;
 * - remote keys mark the UI busy: the running refresh pauses (`setBusy`) until the keys have
 *   been idle for `idleMs`;
 * - an **EPG worker** starts for each EPG refresh (step 9b). The guides come from the catalog
 *   sources (`epgGuides`), and `due` refreshes only those `epgRefreshDue` names. Catalog and EPG
 *   refreshes share one slot, so a low-tier TV never runs both at once; when a guide swaps in, the
 *   query worker reloads, and `nowNext` reads the store through it.
 *
 * Workers come from factories, so tests serve the real services over message channels; the
 * app passes the `?worker` imports (`./workers.ts`).
 */

import type { ContentKey, DeviceTier, EpgOverride } from '@zoma/core';
import type {
  CancelToken,
  DataClient,
  EpgCatalogSource,
  EpgNowNext,
  EpgProgress,
  EpgRefreshResult,
  EpgStatus,
  IngestClient,
  IngestJob,
  IngestProgress,
  IngestResult,
  ItemRef,
  QueryStatus,
  RpcPort,
  UserGuide,
} from '@zoma/data';
// The client entry only: the package index would pull every data module's polyfills into main.
import { createDataClient, createEpgClient, createIngestClient, epgGuides, epgRefreshDue } from '@zoma/data/client';

/** What the engine needs from a worker (a `Worker`, or a test double). */
export interface WorkerLike extends RpcPort {
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface DataEngineOptions {
  startQueryWorker: () => WorkerLike;
  startIngestWorker: () => WorkerLike;
  startEpgWorker: () => WorkerLike;
  /** The clock `due` EPG refreshes are decided by (default `Date.now`). */
  now?: () => number;
  /** How long after the last remote key the UI counts as idle again (default 1000 ms). */
  idleMs?: number;
  /** Called when the busy flag changes. */
  onBusy?: (busy: boolean) => void;
}

export interface DataSummary {
  sources: number;
  /** Items in every active generation. */
  items: number;
  /** Segments that could not be loaded. */
  stale: number;
}

export interface SearchSummary {
  /** The normalized query that ran. */
  query: string;
  total: number;
  /** Display names of the first hits. */
  names: string[];
  /** Their keys, and which of them are live channels. */
  keys: ContentKey[];
  live: boolean[];
}

export interface RefreshOptions {
  /** A low-tier TV: the refresh runs the 50/50 duty cycle. */
  lowTier?: boolean;
  onProgress?: (progress: IngestProgress) => void;
  cancel?: CancelToken;
}

export interface EpgRefreshOptions {
  tier: DeviceTier;
  /** Guides the user added, in their order (step 22). */
  user?: UserGuide[];
  /** UI languages, most preferred first. */
  languages?: string[];
  overrides?: EpgOverride[];
  /** Read only the guides that are due (`epgRefreshDue`); without it, every guide. */
  due?: boolean;
  /** Ignore validators and byte hashes. */
  force?: boolean;
  onProgress?: (progress: EpgProgress) => void;
  cancel?: CancelToken;
}

export const IDLE_MS = 1000;

const ignore = (): void => undefined;

function summarize(status: QueryStatus): DataSummary {
  return {
    sources: status.sources.length,
    items: status.segments.reduce((sum, s) => sum + s.count, 0),
    stale: status.stale.length,
  };
}

export class DataEngine {
  private queryWorker: WorkerLike | null = null;
  private queryClient: DataClient | null = null;
  private started: Promise<number> | null = null;
  /** The refresh running (catalog or EPG), or `null`. */
  private slot: 'catalog' | 'epg' | null = null;
  /** Tells the running refresh's worker that the UI is busy. */
  private sendBusy: ((busy: boolean) => void) | null = null;
  private busyFlag = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: DataEngineOptions) {}

  /** The query worker's client (starts the worker on first use). */
  get query(): DataClient {
    return this.queryClientOrStart();
  }

  /** True while remote keys are being pressed. */
  get busy(): boolean {
    return this.busyFlag;
  }

  /** True while a refresh (catalog or EPG) runs. */
  get refreshing(): boolean {
    return this.slot !== null;
  }

  /**
   * App start: starts the query worker and prunes leftovers in a short-lived ingest worker.
   * Resolves with the number of sources. Calling it again returns the same promise.
   */
  start(): Promise<number> {
    if (this.started === null) {
      this.started = (async () => {
        this.queryClientOrStart();
        return this.withIngestWorker((client) => client.call('prune'));
      })();
    }
    return this.started;
  }

  /** Sources and item counts, as the query worker sees them. */
  async summary(): Promise<DataSummary> {
    return summarize(await this.query.call('status'));
  }

  /**
   * One refresh in a fresh ingest worker. Waits for the start-up prune first (a prune would
   * abandon a refresh running next to it). When the refresh swaps generations, the query worker
   * reloads before this resolves, so the next read sees the new catalog.
   */
  async refresh(job: IngestJob, options: RefreshOptions = {}): Promise<IngestResult> {
    await this.claim('catalog');
    let reload: Promise<unknown> = Promise.resolve();
    try {
      return await this.withIngestWorker(async (client) => {
        this.busyTo((busy) => client.call('setBusy', { busy }).catch(ignore));
        client.on('swapped', () => {
          reload = this.query.call('reload');
          reload.catch(ignore);
        });
        if (options.onProgress) client.on('progress', options.onProgress);
        const result = await client.call('run', { job, lowTier: options.lowTier }, { cancel: options.cancel });
        // The refresh itself succeeded; a query worker that can't reload reports that on the
        // next read.
        await reload.catch(ignore);
        return result;
      });
    } finally {
      this.release();
    }
  }

  /**
   * One EPG refresh in a fresh EPG worker, for the guides of `catalogs` (plus the user's), in
   * the refresh slot. With `due`, only the guides `epgRefreshDue` names are read, and no worker
   * starts when none is (stored guides that are no longer listed are still deleted then). When a
   * guide swaps in, the query worker reloads before this resolves.
   */
  async refreshEpg(catalogs: readonly EpgCatalogSource[], options: EpgRefreshOptions): Promise<EpgRefreshResult> {
    await this.claim('epg');
    let reload: Promise<unknown> = Promise.resolve();
    try {
      const status = await this.query.call('epgStatus');
      const guides = epgGuides(catalogs, status.sources, options.user);
      const listed = guides.map((g) => g.epgSrc);
      let only: string[] | undefined;
      if (options.due) {
        const now = this.options.now ? this.options.now() : Date.now();
        only = guides.filter((g) => epgRefreshDue(findGuide(status, g.epgSrc), now) !== null).map((g) => g.epgSrc);
        const unlisted = status.guides.some((m) => listed.indexOf(m.epgSrc) === -1);
        if (only.length === 0 && !unlisted) return { outcomes: [], deleted: [], wanted: 0 };
      }
      return await this.withWorker(this.options.startEpgWorker, createEpgClient, async (client) => {
        this.busyTo((busy) => client.call('setBusy', { busy }).catch(ignore));
        client.on('swapped', () => {
          reload = this.query.call('reload');
          reload.catch(ignore);
        });
        if (options.onProgress) client.on('progress', options.onProgress);
        const job = { guides, only, tier: options.tier, languages: options.languages, overrides: options.overrides, force: options.force };
        const result = await client.call('run', { job, lowTier: options.tier === 'low' }, { cancel: options.cancel });
        await reload.catch(ignore);
        return result;
      });
    } finally {
      this.release();
    }
  }

  /** Now and next for live channels, from the stored guides (through the query worker). */
  nowNext(keys: ContentKey[], at?: number): Promise<EpgNowNext[]> {
    return this.query.call('nowNext', { keys, at });
  }

  /** The stored guides and how many live channels have one. */
  epgStatus(): Promise<EpgStatus> {
    return this.query.call('epgStatus');
  }

  /** Searches every active generation and resolves the first `names` hits to display names. */
  async search(query: string, options: { limit?: number; names?: number } = {}): Promise<SearchSummary> {
    const result = await this.query.call('search', { query, limit: options.limit });
    const refs: ItemRef[] = result.hits.slice(0, options.names ?? 3).map((h) => ({
      src: h.src,
      kind: h.kind,
      gen: h.gen,
      catIdx: h.catIdx,
      chunk: h.chunk,
      slot: h.slot,
    }));
    const items = refs.length === 0 ? [] : await this.query.call('items', { refs });
    return {
      query: result.query,
      total: result.total,
      names: items.map((item) => (item === null ? '?' : item.name)),
      keys: items.map((item) => (item === null ? '' : item.key)),
      live: refs.map((r) => r.kind === 'live'),
    };
  }

  /**
   * A remote key was pressed. The UI turns busy at once (a running refresh pauses at its next
   * checkpoint) and idle again `idleMs` after the last key. Busy is sent once per burst of keys,
   * so the worker's own 15 s expiry still lets a refresh finish under endless key presses.
   */
  noteActivity(): void {
    if (this.disposed) return;
    if (!this.busyFlag) this.setBusy(true);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.setBusy(false);
    }, this.options.idleMs ?? IDLE_MS);
  }

  /** Stops the query worker and any refresh. */
  dispose(): void {
    this.disposed = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.queryClient?.close();
    this.queryWorker?.terminate();
    this.queryClient = null;
    this.queryWorker = null;
  }

  private queryClientOrStart(): DataClient {
    if (this.disposed) throw new Error('The data engine was disposed');
    if (this.queryClient === null) {
      const worker = this.options.startQueryWorker();
      this.queryWorker = worker;
      this.queryClient = createDataClient(worker);
    }
    return this.queryClient;
  }

  private setBusy(busy: boolean): void {
    this.busyFlag = busy;
    this.sendBusy?.(busy);
    this.options.onBusy?.(busy);
  }

  /**
   * Takes the one refresh slot, then waits for the start-up prune (a prune would abandon a
   * refresh running next to it). The slot is taken first, so a second refresh can't slip in
   * behind the prune. A failed prune (no IndexedDB, say) fails the refresh with its own error.
   */
  private async claim(kind: 'catalog' | 'epg'): Promise<void> {
    if (this.slot !== null) throw new Error(`A ${this.slot === 'epg' ? 'guide' : 'catalog'} refresh is already running`);
    this.slot = kind;
    await this.start().catch(ignore);
  }

  private release(): void {
    this.slot = null;
    this.sendBusy = null;
  }

  /** Routes busy changes to the running refresh's worker; tells it at once if keys are down. */
  private busyTo(send: (busy: boolean) => void): void {
    this.sendBusy = send;
    if (this.busyFlag) send(true);
  }

  /** Runs `use` with a fresh ingest worker, then terminates it whatever happened. */
  private withIngestWorker<T>(use: (client: IngestClient) => Promise<T>): Promise<T> {
    return this.withWorker(this.options.startIngestWorker, createIngestClient, use);
  }

  /** Runs `use` with a fresh worker and its client, then terminates it whatever happened. */
  private async withWorker<C extends { close(): void }, T>(start: () => WorkerLike, wrap: (worker: WorkerLike) => C, use: (client: C) => Promise<T>): Promise<T> {
    const worker = start();
    const client = wrap(worker);
    try {
      return await use(client);
    } finally {
      client.close();
      worker.terminate();
    }
  }
}

function findGuide(status: EpgStatus, epgSrc: string): EpgStatus['guides'][number] | null {
  for (const g of status.guides) if (g.epgSrc === epgSrc) return g;
  return null;
}
