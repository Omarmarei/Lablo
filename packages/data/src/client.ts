/**
 * The UI's side of the data workers: typed RPC clients over the query worker, the ingest worker,
 * the EPG worker and the config worker (architecture.md §1.2, §3.3 C). `ui` imports only this part
 * of `@lablo/data`.
 */

export type { EpgCatalogSource, EpgDueReason, EpgGuide, UserGuide } from './epg-sources';
// Pure helpers the app decides EPG refreshes with (no data module behind them).
export { EPG_AHEAD_MS, EPG_OFFSET_MAX, EPG_OFFSET_STEP, EPG_REFRESH_MS, EPG_RETRY_MS, epgGuides, epgOffsetsOf, epgRefreshDue, isEpgOffset } from './epg-sources';

import type { ConfigEvents, configHandlers } from './config-service';
import type { EpgEvents, EpgService } from './epg-service';
import type { IngestEvents, IngestService } from './ingest-service';
import type { QueryService } from './query-service';
import type { RpcPort } from './rpc';
import { RpcClient } from './rpc';

// The ingest's version (a constant of its own module): the refresh schedule refreshes a catalog an
// older version built (step 26e).
export { INGEST_VERSION } from './ingest-version';
// "Recently added"'s types (step 26e).
export type { RecentItem } from './recent';
export type { RecentRequest } from './query-service';
// "Continue watching"'s lookup by key (step 27d).
export type { KeyItemsRequest } from './query-service';

// The signed config's policy as the app keeps and enforces it (steps 30b2 and 30c): config-policy.ts
// and config-constants.ts import no schema, so main gets none of the config worker's code.
export type { ConfigPlatform, ConfigPolicy, PolicyRule } from './config-policy';
export { KILL_STRENGTH, noPolicy, policyStops } from './config-policy';
export { CONFIG_REFRESH_MS, CONFIG_RETRY_MS } from './config-constants';
export type { ConfigEvents, ConfigFailure, ConfigResult, ConfigRunRequest, ConfigStatus } from './config-service';

// Cancel tokens and the errors calls reject with (rpc.ts is bundled here anyway): the app cancels
// a refresh and reads its error code without importing the package index (step 13b).
export type { CancelToken } from './rpc';
export { CancelError, CancelSource, RpcError } from './rpc';

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

/** The config worker's RPC methods. */
export type ConfigHandlers = ReturnType<typeof configHandlers>;

/** Calls a config worker: `client.call('run', request)`, event `cached` first. */
export type ConfigClient = RpcClient<ConfigHandlers, ConfigEvents>;

/** Wraps a started config worker. If it dies, the run rejects; the cached copy is untouched. */
export function createConfigClient(port: RpcPort & { onerror?: ((event: ErrorEvent) => void) | null }): ConfigClient {
  const client = new RpcClient<ConfigHandlers, ConfigEvents>(port);
  if ('onerror' in port) {
    port.onerror = (event: ErrorEvent) => {
      client.fail(new Error(`Config worker failed: ${event.message || 'unknown error'}`));
    };
  }
  return client;
}
