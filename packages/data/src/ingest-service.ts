/**
 * The ingest worker's service (architecture.md §1.4 step 2): the app starts a fresh ingest
 * worker for each refresh and terminates it when the refresh is done, which frees its whole
 * heap. The worker serves these handlers over RPC:
 *
 * - `run`: one refresh (`runIngest`), with `progress` events while it reads and a `swapped`
 *   event as soon as the new generation is active (the app then calls the query worker's
 *   `reload`). Cancelling the call cancels the refresh.
 * - `setBusy`: the UI is zapping or starting playback; the refresh pauses until it is idle.
 * - `prune`: at app start, removes what crashed or killed refreshes left behind, for every source.
 *
 * Low-tier TVs pass `lowTier`, which turns on the 50/50 duty cycle for that refresh.
 */

import type { ByteTransport } from './bytes';
import { getSources, pruneGenerations } from './catalog-store';
import type { GunzipMode } from './gunzip';
import type { IngestJob, IngestProgress, IngestResult, IngestSwap } from './ingest';
import { runIngest } from './ingest';
import type { RpcContext } from './rpc';
import type { Clock, DutyCycle } from './throttle';
import { LOW_TIER_DUTY, Throttle } from './throttle';

export interface IngestRunRequest {
  job: IngestJob;
  /** A low-tier TV: run the duty cycle. */
  lowTier?: boolean;
  /** Overrides the low-tier duty cycle (remote config). */
  duty?: DutyCycle;
}

/** Events the ingest worker pushes. */
export interface IngestEvents extends Record<string, unknown> {
  progress: IngestProgress;
  swapped: IngestSwap;
}

export interface IngestServiceOptions {
  openDb: () => Promise<IDBDatabase>;
  transport: ByteTransport;
  clock?: Clock;
  gunzip?: GunzipMode;
}

export class IngestService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  readonly throttle: Throttle;

  constructor(private readonly options: IngestServiceOptions) {
    this.throttle = new Throttle({ clock: options.clock });
  }

  handlers() {
    return {
      run: (req: IngestRunRequest, ctx: RpcContext): Promise<IngestResult> => this.run(req, ctx),
      setBusy: (arg: { busy: boolean }): boolean => {
        this.throttle.setBusy(arg.busy);
        return this.throttle.busy;
      },
      prune: (): Promise<number> => this.prune(),
    };
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.options.openDb();
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async run(req: IngestRunRequest, ctx: RpcContext): Promise<IngestResult> {
    const db = await this.db();
    this.throttle.duty = req.lowTier ? (req.duty ?? LOW_TIER_DUTY) : null;
    return runIngest(req.job, {
      db,
      transport: this.options.transport,
      token: ctx.token,
      throttle: this.throttle,
      gunzip: this.options.gunzip,
      onProgress: (p) => ctx.emit('progress', p),
      onSwap: (s) => ctx.emit('swapped', s),
    });
  }

  /** Prunes every source; returns how many there are. Run before any refresh starts. */
  async prune(): Promise<number> {
    const db = await this.db();
    const sources = await getSources(db);
    for (const s of sources) await pruneGenerations(db, s.src, { abandon: true });
    return sources.length;
  }
}
