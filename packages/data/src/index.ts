/**
 * @zoma/data: IndexedDB schema and migrations, ingest and query workers, typed worker RPC, DataClient.
 *
 * Allowed imports are listed in CLAUDE.md ("Package boundaries") and enforced by
 * eslint-plugin-boundaries. `ui` uses only the client part (`createDataClient`, the RPC types).
 */
export type { Migration } from './schema';
export { DB_NAME, DB_VERSION, MIGRATIONS, STORE } from './schema';

export type { OpenOptions, TxMode } from './idb';
export { IdbError, deleteDatabase, getValue, onSuccess, openDatabase, transact } from './idb';

export type { AnyProfile, FavouriteRef, LoadedProfile, ProfileDoc, ProfileMigration, ProfileOptions, ProfileSnapshot, ProfileV1, SnapshotReason } from './profile';
export {
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  ProfileError,
  SNAPSHOT_EVERY_MS,
  SNAPSHOT_SLOTS,
  emptyProfile,
  listSnapshots,
  loadProfile,
  migrateProfile,
  restoreSnapshot,
  saveProfile,
} from './profile';

export type { CatalogChunk, CategoryInfo, ChunkerOptions } from './chunker';
export { CHUNK_SIZE, CatalogChunker, MAX_BUFFERED, indexChunk } from './chunker';

export type { ChunkKey, SourceMeta } from './catalog-store';
export {
  GenerationError,
  beginGeneration,
  commitGeneration,
  deleteGeneration,
  deleteSource,
  getSources,
  newSourceMeta,
  pruneGenerations,
  putCatalogKind,
  putChunks,
  readCategories,
  readChunks,
  readIndexes,
} from './catalog-store';

export type { CallOptions, CancelToken, RpcContext, RpcHandler, RpcHandlers, RpcPort, RpcServer } from './rpc';
export { CancelError, CancelSource, NEVER, RpcClient, RpcError, serveRpc } from './rpc';

export type { ItemRef, QueryServiceOptions, QueryStatus, SearchRequest, SegmentStatus } from './query-service';
export { QueryService } from './query-service';

export type { DataClient, QueryHandlers } from './client';
export { createDataClient } from './client';
