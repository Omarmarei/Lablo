/**
 * The app's side of the data workers (architecture.md §1.2 and §1.4, RELAY step 8b):
 * - the **query worker** starts once and keeps running; every catalog read goes through it;
 * - an **ingest worker** starts for each refresh and is terminated when the refresh ends,
 *   which frees its whole heap. At app start a short-lived one runs `prune`, which clears what
 *   crashed or killed refreshes left behind;
 * - when a refresh swaps in a new generation (`swapped`), the query worker `reload`s;
 * - remote keys mark the UI busy: the running refresh pauses (`setBusy`) until the keys have
 *   been idle for `idleMs`.
 *
 * Workers come from factories, so tests serve the real services over message channels; the
 * app passes the `?worker` imports (`./workers.ts`).
 */

import type { CancelToken, DataClient, IngestClient, IngestJob, IngestProgress, IngestResult, ItemRef, QueryStatus, RpcPort } from '@zoma/data';
// The client entry only: the package index would pull every data module's polyfills into main.
import { createDataClient, createIngestClient } from '@zoma/data/client';

/** What the engine needs from a worker (a `Worker`, or a test double). */
export interface WorkerLike extends RpcPort {
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface DataEngineOptions {
  startQueryWorker: () => WorkerLike;
  startIngestWorker: () => WorkerLike;
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
}

export interface RefreshOptions {
  /** A low-tier TV: the refresh runs the 50/50 duty cycle. */
  lowTier?: boolean;
  onProgress?: (progress: IngestProgress) => void;
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
  private ingest: IngestClient | null = null;
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

  /** True while a refresh runs. */
  get refreshing(): boolean {
    return this.ingest !== null;
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
    if (this.ingest !== null) throw new Error('A catalog refresh is already running');
    const prune = this.start();
    // Claim the slot before waiting, so a second refresh can't slip in behind the prune.
    this.ingest = PENDING;
    // A failed prune (no IndexedDB, say) fails the refresh too, with its own error.
    await prune.catch(ignore);
    let reload: Promise<unknown> = Promise.resolve();
    try {
      return await this.withIngestWorker(async (client) => {
        this.ingest = client;
        client.on('swapped', () => {
          reload = this.query.call('reload');
          reload.catch(ignore);
        });
        if (options.onProgress) client.on('progress', options.onProgress);
        if (this.busyFlag) client.call('setBusy', { busy: true }).catch(ignore);
        const result = await client.call('run', { job, lowTier: options.lowTier }, { cancel: options.cancel });
        // The refresh itself succeeded; a query worker that can't reload reports that on the
        // next read.
        await reload.catch(ignore);
        return result;
      });
    } finally {
      this.ingest = null;
    }
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
    return { query: result.query, total: result.total, names: items.map((item) => (item === null ? '?' : item.name)) };
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
    const client = this.ingest;
    if (client !== null && client !== PENDING) client.call('setBusy', { busy }).catch(ignore);
    this.options.onBusy?.(busy);
  }

  /** Runs `use` with a fresh ingest worker, then terminates it whatever happened. */
  private async withIngestWorker<T>(use: (client: IngestClient) => Promise<T>): Promise<T> {
    const worker = this.options.startIngestWorker();
    const client = createIngestClient(worker);
    try {
      return await use(client);
    } finally {
      client.close();
      worker.terminate();
    }
  }
}

/** Marks the refresh slot as taken while the start-up prune finishes. */
const PENDING = {} as IngestClient;
