/**
 * The UI's side of the data workers: typed RPC clients over the query worker, the ingest worker
 * and the EPG worker (architecture.md §1.2). `ui` imports only this part of `@zoma/data`.
 */

export type { EpgCatalogSource, EpgDueReason, EpgGuide, UserGuide } from './epg-sources';
// Pure helpers the app decides EPG refreshes with (no data module behind them).
export { EPG_AHEAD_MS, EPG_REFRESH_MS, EPG_RETRY_MS, epgGuides, epgRefreshDue } from './epg-sources';

import type { EpgEvents, EpgService } from './epg-service';
import type { IngestEvents, IngestService } from './ingest-service';
import type { QueryService } from './query-service';
import type { RpcPort } from './rpc';
import { RpcClient } from './rpc';

/** The query worker's RPC methods. */
export type QueryHandlers = ReturnType<QueryService['handlers']>;

/** Calls the query worker: `client.call('search', { query })`. */
export type DataClient = RpcClient<QueryHandlers>;

/**
 * Wraps a started query worker (or any port serving `QueryService`). If the worker dies, every
 * pending and later call rejects with its error.
 */
export function createDataClient(port: RpcPort & { onerror?: ((event: ErrorEvent) => void) | null }): DataClient {
  const client = new RpcClient<QueryHandlers>(port);
  if ('onerror' in port) {
    port.onerror = (event: ErrorEvent) => {
      client.fail(new Error(`Query worker failed: ${event.message || 'unknown error'}`));
    };
  }
  return client;
}

/** The ingest worker's RPC methods. */
export type IngestHandlers = ReturnType<IngestService['handlers']>;

/** Calls an ingest worker: `client.call('run', { job }, { cancel })`, events `progress` and `swapped`. */
export type IngestClient = RpcClient<IngestHandlers, IngestEvents>;

/**
 * Wraps a started ingest worker. If the worker dies (or is terminated mid-refresh), pending
 * calls reject; the refresh's half-written generation is pruned by the next one.
 */
export function createIngestClient(port: RpcPort & { onerror?: ((event: ErrorEvent) => void) | null }): IngestClient {
  const client = new RpcClient<IngestHandlers, IngestEvents>(port);
  if ('onerror' in port) {
    port.onerror = (event: ErrorEvent) => {
      client.fail(new Error(`Ingest worker failed: ${event.message || 'unknown error'}`));
    };
  }
  return client;
}

/** The EPG worker's RPC methods. */
export type EpgHandlers = ReturnType<EpgService['handlers']>;

/** Calls an EPG worker: `client.call('run', { job }, { cancel })`, events `progress` and `swapped`. */
export type EpgClient = RpcClient<EpgHandlers, EpgEvents>;

/** Wraps a started EPG worker. If it dies mid-refresh, the next refresh prunes what it left. */
export function createEpgClient(port: RpcPort & { onerror?: ((event: ErrorEvent) => void) | null }): EpgClient {
  const client = new RpcClient<EpgHandlers, EpgEvents>(port);
  if ('onerror' in port) {
    port.onerror = (event: ErrorEvent) => {
      client.fail(new Error(`EPG worker failed: ${event.message || 'unknown error'}`));
    };
  }
  return client;
}
