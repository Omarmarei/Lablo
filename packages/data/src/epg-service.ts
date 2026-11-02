/**
 * The EPG worker's service (architecture.md §1.5, RELAY step 9b). Like the ingest worker, the app
 * starts a fresh EPG worker for each refresh and terminates it when the refresh is done, which
 * frees the reader's whole heap. It is a worker of its own because the XMLTV reader doesn't fit
 * the ingest worker's 150 KB budget next to the catalog parsers. Handlers:
 *
 * - `run`: one EPG refresh (`runEpgRefresh`): every stored guide is pruned first, then the listed
 *   ones are read. `progress` events while it reads, a `swapped` event per guide swapped in or
 *   deleted (the app then calls the query worker's `reload`). Cancelling the call cancels it.
 * - `setBusy`: the UI is zapping or starting playback; the refresh pauses until it is idle.
 *
 * Low-tier TVs pass `lowTier` (the 50/50 duty cycle). The app runs one refresh at a time, catalog
 * or EPG, so a low-tier TV never runs both at once (§1.5 step 8).
 */

import type { ByteTransport } from './bytes';
import type { EpgProgress, EpgRefreshJob, EpgRefreshResult, EpgSwap } from './epg-ingest';
import { runEpgRefresh } from './epg-ingest';
import type { GunzipMode } from './gunzip';
import type { RpcContext } from './rpc';
import type { Clock, DutyCycle } from './throttle';
import { LOW_TIER_DUTY, Throttle } from './throttle';

export interface EpgRunRequest {
  job: EpgRefreshJob;
  /** A low-tier TV: run the duty cycle. */
  lowTier?: boolean;
  duty?: DutyCycle;
}

/** Events the EPG worker pushes. */
export interface EpgEvents extends Record<string, unknown> {
  progress: EpgProgress;
  swapped: EpgSwap;
}

export interface EpgServiceOptions {
  openDb: () => Promise<IDBDatabase>;
  transport: ByteTransport;
  clock?: Clock;
  gunzip?: GunzipMode;
  now?: () => number;
  /** The reader's flush size (tests use a small one to get bucket fragments). */
  flushAt?: number;
}

export class EpgService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  readonly throttle: Throttle;

  constructor(private readonly options: EpgServiceOptions) {
    this.throttle = new Throttle({ clock: options.clock });
  }

  handlers() {
    return {
      run: (req: EpgRunRequest, ctx: RpcContext): Promise<EpgRefreshResult> => this.run(req, ctx),
      setBusy: (arg: { busy: boolean }): boolean => {
        this.throttle.setBusy(arg.busy);
        return this.throttle.busy;
      },
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

  async run(req: EpgRunRequest, ctx: RpcContext): Promise<EpgRefreshResult> {
    const db = await this.db();
    this.throttle.duty = req.lowTier ? (req.duty ?? LOW_TIER_DUTY) : null;
    return runEpgRefresh(req.job, {
      db,
      transport: this.options.transport,
      token: ctx.token,
      throttle: this.throttle,
      gunzip: this.options.gunzip,
      now: this.options.now,
      flushAt: this.options.flushAt,
      onProgress: (p) => ctx.emit('progress', p),
      onSwap: (s) => ctx.emit('swapped', s),
    });
  }
}
