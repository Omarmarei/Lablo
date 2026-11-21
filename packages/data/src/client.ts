/**
 * The UI's side of the data workers: typed RPC clients over the query worker, the ingest worker,
 * the EPG worker, the config worker, the pair worker, the backup worker and the telemetry worker
 * (architecture.md §1.2, §3.3 A, B and C, §3.4).
 * `ui` imports only this part of `@lablo/data`.
 */

export type { EpgCatalogSource, EpgDueReason, EpgGuide, GuideWithoutLink, StoredGuide, UserGuide } from './epg-sources';
// Pure helpers the app decides EPG refreshes with (no data module behind them).
export { EPG_AHEAD_MS, EPG_OFFSET_MAX, EPG_OFFSET_STEP, EPG_REFRESH_MS, EPG_RETRY_MS, epgGuides, epgOffsetsOf, epgRefreshDue, isEpgOffset } from './epg-sources';

import type { BackupEvents, backupHandlers } from './backup-service';
import type { ConfigEvents, configHandlers } from './config-service';
import type { pairHandlers } from './pair-service';
import type { EpgEvents, EpgService } from './epg-service';
import type { IngestEvents, IngestService } from './ingest-service';
import type { QueryService } from './query-service';
import type { telemetryHandlers } from './telemetry-service';
import type { RpcPort } from './rpc';
import { RpcClient } from './rpc';

// The favourites lists and the live groups as main reads them (step 35a): favourite-lists.ts imports
// nothing and uses nothing Babel polyfills; the edits themselves are the query worker's.
export type { FavouriteList, GroupRef } from './favourite-lists';
export { LIST_NAME_MAX, MAX_FAVOURITES, MAX_FAVOURITE_LISTS, MAX_LIST_ITEMS, favouriteListsOf, groupId, groupOrderOf, hiddenGroupsOf } from './favourite-lists';
export type { FavouriteChange, FavouriteItem, GroupChange } from './favourite-edits';
// The changed channels as main and settings.js read them (step 36a): channel-edits.ts imports
// nothing at run time and uses nothing Babel polyfills; the edits are the query worker's.
export type { ChannelEdit } from './channel-edits';
export { CHANNEL_NAME_MAX, CHANNEL_NUMBER_MAX, MAX_CHANNEL_EDITS, channelEditsOf, cleanNamesOn, shownChunks } from './channel-edits';
export type { ChannelChange } from './channel-changes';

// A source without its login (step 32d4a): logins.ts imports no data module.
export type { LinkWithoutLogin, RefreshSource } from './logins';
export { lacksLogin } from './logins';

// The ingest's version (a constant of its own module): the refresh schedule refreshes a catalog an
// older version built (step 26e).
export { INGEST_VERSION } from './ingest-version';
// "Recently added"'s types (step 26e).
export type { RecentItem } from './recent';
export type { RecentRequest } from './query-service';
// "Continue watching"'s lookup by key (step 27d).
export type { KeyItemsRequest } from './query-service';
// Number entry's lookup of a user's number (step 36a2).
export type { NumberRequest, NumberedChannel } from './query-service';

// The signed config's policy as the app keeps and enforces it (steps 30b2 and 30c): config-policy.ts
// and config-constants.ts import no schema, so main gets none of the config worker's code.
export type { ConfigPlatform, ConfigPolicy, PolicyRule } from './config-policy';
export { KILL_STRENGTH, noPolicy, policyStops } from './config-policy';
export { CONFIG_REFRESH_MS, CONFIG_RETRY_MS, MAX_NOTICES, isRuleId } from './config-constants';
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

export type { PairCode, PairFailure, PairFileFailure, PairFileResult, PairOpenResult, PairPollResult, PairStatusResult } from './pair-service';
// The phone's file as the ingest worker gets it (RELAY step 31d2a): a port and the plain length.
export type { FileFeed } from './file-feed';
export { PAIR_POLL_MS, PAIR_RETRY_MS, PAIR_TIMEOUT_MS } from './pair-constants';

/** The pair worker's RPC methods (pair.worker.ts, RELAY step 31c1). */
export type PairHandlers = ReturnType<typeof pairHandlers>;

/** Calls a pair worker: `open`, `poll`, `file`, `status`, `close`. */
export type PairClient = RpcClient<PairHandlers>;

/** Wraps a started pair worker. If it dies, the pending calls reject (the screen makes a new code). */
export function createPairClient(port: RpcPort & { onerror?: ((event: ErrorEvent) => void) | null }): PairClient {
  const client = new RpcClient<PairHandlers>(port);
  if ('onerror' in port) {
    port.onerror = (event: ErrorEvent) => {
      client.fail(new Error(`Pair worker failed: ${event.message || 'unknown error'}`));
    };
  }
  return client;
}

// The backup (RELAY steps 32b and 32c1): the requests and the answers; no key leaves the worker.
export type { BackupCallRequest, BackupCodeRequest, BackupEvents, BackupFailure, BackupPrepareRequest, BackupPrepareResult, BackupRestoreResult, BackupSource, BackupStatus, BackupSwitchRequest, BackupSwitchResult, BackupUploadResult } from './backup-service';

/** The backup worker's RPC methods (backup.worker.ts, RELAY step 32b). */
export type BackupHandlers = ReturnType<typeof backupHandlers>;

/** Calls a backup worker: `prepare`, `upload` or `restore`, event `progress` (scrypt's). */
export type BackupClient = RpcClient<BackupHandlers, BackupEvents>;

// Telemetry (RELAY step 33b1): the request and the answer.
export type { DiagParts, DiagSendRequest, DiagSendResult, TelemetrySendRequest, TelemetrySendResult } from './telemetry-service';

/** The telemetry worker's RPC methods (telemetry.worker.ts, RELAY step 33b1). */
export type TelemetryHandlers = ReturnType<typeof telemetryHandlers>;

/** Calls a telemetry worker: `send`. */
export type TelemetryClient = RpcClient<TelemetryHandlers>;

/** Wraps a started telemetry worker. If it dies, the send rejects; the queue in `kv` stays. */
export function createTelemetryClient(port: RpcPort & { onerror?: ((event: ErrorEvent) => void) | null }): TelemetryClient {
  const client = new RpcClient<TelemetryHandlers>(port);
  if ('onerror' in port) {
    port.onerror = (event: ErrorEvent) => {
      client.fail(new Error(`Telemetry worker failed: ${event.message || 'unknown error'}`));
    };
  }
  return client;
}

/** Wraps a started backup worker. If it dies, the call rejects; what it kept stays kept. */
export function createBackupClient(port: RpcPort & { onerror?: ((event: ErrorEvent) => void) | null }): BackupClient {
  const client = new RpcClient<BackupHandlers, BackupEvents>(port);
  if ('onerror' in port) {
    port.onerror = (event: ErrorEvent) => {
      client.fail(new Error(`Backup worker failed: ${event.message || 'unknown error'}`));
    };
  }
  return client;
}
