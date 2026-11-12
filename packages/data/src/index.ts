/**
 * @lablo/data: IndexedDB schema and migrations, ingest and query workers, typed worker RPC, DataClient.
 *
 * Allowed imports are listed in CLAUDE.md ("Package boundaries") and enforced by
 * eslint-plugin-boundaries. `ui` uses only the client part (`createDataClient`, the RPC types).
 */
export type { Migration } from './schema';
export { DB_NAME, DB_VERSION, MIGRATIONS, STORE } from './schema';

export type { OpenOptions, TxMode } from './idb';
export { IdbError, deleteDatabase, getValue, onSuccess, openDatabase, transact } from './idb';

export type {
  AnyProfile,
  FavouriteRef,
  GuideChange,
  LastChannel,
  LoadedProfile,
  OnboardingAnswers,
  PlayerChange,
  PlayerMemoryDoc,
  ProfileDoc,
  ProfileEdit,
  ProfileMigration,
  ProfileOptions,
  ProfileSnapshot,
  ProfileV1,
  ProfileV2,
  ProfileV3,
  ProfileV4,
  ProfileV5,
  SnapshotReason,
  SourceRecord,
  SourceRecordV3,
  StoredTrackChoice,
  StoredTrackPick,
  WatchProgress,
} from './profile';
export {
  MAX_PROGRESS,
  MAX_TRACK_CHOICES,
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  ProfileError,
  SNAPSHOT_EVERY_MS,
  SNAPSHOT_SLOTS,
  applyProfileEdit,
  emptyProfile,
  isWatchProgress,
  listSnapshots,
  loadProfile,
  migrateProfile,
  noPlayerMemory,
  readEpgOffsets,
  readEpgOverrides,
  restoreSnapshot,
  saveProfile,
  updateProfile,
} from './profile';

export type { CatalogChunk, CategoryInfo, ChunkerOptions } from './chunker';
export { CHUNK_SIZE, CatalogChunker, MAX_BUFFERED, indexChunk } from './chunker';

export type { ChunkKey, FetchStamp, SourceMeta, SourceMetaPatch } from './catalog-store';
export {
  GenerationError,
  abandonGeneration,
  beginGeneration,
  commitGeneration,
  deleteGeneration,
  deleteSource,
  getSource,
  getSources,
  markChecked,
  newSourceMeta,
  pruneGenerations,
  putCatalogKind,
  putChunks,
  readCategories,
  readChunks,
  readIndexes,
  readRecent,
} from './catalog-store';

export type { RecentItem } from './recent';
export { RECENT_KINDS, RECENT_MAX, RecentList, mergeRecent } from './recent';

export type { CallOptions, CancelToken, RpcContext, RpcHandler, RpcHandlers, RpcPort, RpcServer } from './rpc';
export { CancelError, CancelSource, NEVER, RpcClient, RpcError, serveRpc } from './rpc';

export type {
  EpgNowNext,
  EpgStatus,
  GuideChannel,
  GuideChannelsPage,
  GuideChannelsRequest,
  GuideRequest,
  GuideRow,
  ItemRef,
  ProgrammeRequest,
  QueryServiceOptions,
  QueryStatus,
  RecentRequest,
  SearchRequest,
  SegmentStatus,
  ShortEpgNowNext,
  UnmatchedChannel,
  UnmatchedPage,
  UnmatchedRequest,
} from './query-service';
export { GUIDE_CHANNELS_MAX_ROWS, GUIDE_MAX_READS, QueryService, UNMATCHED_MAX_ROWS } from './query-service';

export type { ByteRequest, ByteResponse, ByteSource, ByteTransport, FetchLike, TextSource } from './bytes';
export { Fnv1a, NetworkError, decodeUtf8, fetchTransport, tapBytes } from './bytes';

export type { GunzipMode } from './gunzip';
export { GzipError, MaybeGunzip, hasNativeGunzip } from './gunzip';

export type { Clock, DutyCycle, ThrottleOptions, ThrottleStats } from './throttle';
export { BUSY_MAX_MS, BUSY_POLL_MS, LOW_TIER_DUTY, REAL_CLOCK, Throttle, YIELD_EVERY_MS } from './throttle';

export type { CatalogView, Candidate, FavouriteReport } from './favourites';
export { FavouriteMatcher, MISSING_KEEP_MS, reconcileFavourites } from './favourites';

export type { IngestErrorCode, IngestJob, IngestOptions, IngestProgress, IngestResult, IngestSource, IngestSwap } from './ingest';
export { INGEST_VERSION, IngestError, WRITE_BATCH, runIngest } from './ingest';

export type { DeclaredChannel, EpgBucketKey, EpgChannelTable, EpgDeclaredChannels, EpgFailure, EpgMeta, EpgMetaPatch, EpgSummary, StoredEpgMatch } from './epg-store';
export {
  abandonEpgGeneration,
  beginEpgGeneration,
  commitEpgGeneration,
  deleteEpgGeneration,
  deleteEpgSource,
  epgDeclared,
  epgFirstDay,
  getEpgMeta,
  getEpgMetas,
  markEpgChecked,
  markEpgFailed,
  newEpgMeta,
  pruneEpgDays,
  pruneEpgGenerations,
  putEpgBuckets,
  putEpgChannels,
  putEpgDeclared,
  readEpgBuckets,
  readEpgChannels,
  readEpgDeclared,
  setEpgRank,
} from './epg-store';

export type { EpgPin } from './epg-overrides';
export { NO_MAPPING, epgMappingKey, epgOverridesOf, isEpgPin } from './epg-overrides';

export type { EpgCatalogSource, EpgDueReason, EpgGuide, UserGuide } from './epg-sources';
export { EPG_AHEAD_MS, EPG_OFFSET_MAX, EPG_OFFSET_STEP, EPG_REFRESH_MS, EPG_RETRY_MS, epgGuides, epgOffsetsOf, epgRefreshDue, isEpgOffset } from './epg-sources';

export type { ShortEpgAnswer, ShortEpgRequest, ShortEpgSource, ShortEpgTarget } from './short-epg';
export { SHORT_EPG_LIMIT, SHORT_EPG_TTL_MS, ShortEpgCache, shortEpgNowNext, shortEpgTarget, textTransport } from './short-epg';

export type { AccountCheck } from './account-check';
export { LOGIN_REFUSED, checkAccount, sourceAccount } from './account-check';

export type { VodInfoRequest, VodInfoTarget } from './vod-info';
export { VOD_INFO_TTL_MS, VodInfoCache, vodInfoTarget } from './vod-info';

export type { EpgIngestOptions, EpgOutcome, EpgProgress, EpgRefreshJob, EpgRefreshResult, EpgResult, EpgSwap, EpgWanted } from './epg-ingest';
export { EPG_INGEST_VERSION, EPG_WRITE_BATCH, readEpgWanted, runEpgIngest, runEpgRefresh } from './epg-ingest';

export type { IngestEvents, IngestRunRequest, IngestServiceOptions } from './ingest-service';
export { IngestService } from './ingest-service';

export type { EpgEvents, EpgRunRequest, EpgServiceOptions } from './epg-service';
export { EpgService } from './epg-service';

export type { DataClient, EpgClient, EpgHandlers, IngestClient, IngestHandlers, QueryHandlers } from './client';
export { createDataClient, createEpgClient, createIngestClient } from './client';
