/**
 * The UI's side of the data workers: typed RPC clients over the query worker and the ingest
 * worker (architecture.md §1.2). `ui` imports only this part of `@zoma/data`.
 */

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
