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
  ProfileV6,
  ProfileV7,
  ProfileV8,
  ProfileV9,
  ShowProgress,
  SnapshotReason,
  SourceRecord,
  SourceRecordV3,
  SourceRecordV7,
  SourceWithoutLogin,
  StoredSource,
  StoredTrackChoice,
  StoredTrackPick,
  WatchProgress,
} from './profile';
export {
  MAX_CHANNELS,
  MAX_PROGRESS,
  MAX_SHOWS,
  MAX_TRACK_CHOICES,
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  ProfileError,
  SNAPSHOT_EVERY_MS,
  SNAPSHOT_SLOTS,
  applyProfileEdit,
  emptyProfile,
  favouriteKeysOf,
  isShowProgress,
  isWatchProgress,
  listSnapshots,
  loadProfile,
  migrateProfile,
  noPlayerMemory,
  putProfileIfNone,
  readEpgOffsets,
  readEpgOverrides,
  readFavouriteKeys,
  restoreSnapshot,
  saveProfile,
  storedProfileDoc,
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
  KeyItemsRequest,
  NumberRequest,
  NumberedChannel,
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
  UnlockAnswer,
  LockState,
} from './query-service';
export { GUIDE_CHANNELS_MAX_ROWS, GUIDE_MAX_READS, KEY_ITEMS_MAX, QueryService, UNLOCK_TRIES, UNLOCK_WAIT_MS, UNMATCHED_MAX_ROWS } from './query-service';
export type { GroupLock, LockRef, ParentalChange, ParentalDoc, ParentalPin, ParentalState } from './parental';
export { MAX_GROUP_LOCKS, PIN_LENGTH, applyParentalChange, isLockRef, isPin, lockId, parentalOf } from './parental';
export type { LoadedCategories } from './lock-view';
export { LockView } from './lock-view';

export type { ByteRequest, ByteResponse, ByteSource, ByteTransport, FetchLike, TextSource } from './bytes';
export { Fnv1a, NetworkError, decodeUtf8, fetchTransport, tapBytes } from './bytes';

export type { GunzipMode } from './gunzip';
export { GzipError, MaybeGunzip, hasNativeGunzip } from './gunzip';

export type { Clock, DutyCycle, ThrottleOptions, ThrottleStats } from './throttle';
export { BUSY_MAX_MS, BUSY_POLL_MS, LOW_TIER_DUTY, REAL_CLOCK, Throttle, YIELD_EVERY_MS } from './throttle';

export type { CatalogView, Candidate, FavouriteReport } from './favourites';
export type { FavouriteList, GroupRef } from './favourite-lists';
export { keySource, removeSourceFromProfile, sourceFavouriteCount } from './source-removal';
export {
  LIST_ID_MAX,
  LIST_NAME_MAX,
  MAX_FAVOURITES,
  MAX_FAVOURITE_LISTS,
  MAX_GROUP_REFS,
  MAX_LIST_ITEMS,
  favouriteListsOf,
  groupId,
  groupOrderOf,
  hiddenGroupsOf,
  isGroupRef,
  isListId,
  isListName,
} from './favourite-lists';
export type { FavouriteChange, FavouriteItem, FavouritesPart, GroupChange, GroupsPart } from './favourite-edits';
export { applyFavouriteChange, applyGroupChange, isFavouriteItem, relinkLists } from './favourite-edits';
export { FavouriteMatcher, MISSING_KEEP_MS, reconcileFavourites } from './favourites';
export type { ChannelEdit } from './channel-edits';
export { CHANNEL_NAME_MAX, CHANNEL_NUMBER_MAX, MAX_CHANNEL_EDITS, channelEditsOf, cleanNamesOn, isChannelName, isChannelNumber, shownChunks } from './channel-edits';
export type { ChannelChange } from './channel-changes';
export { applyChannelChange } from './channel-changes';
export { relinkChannelEdits, trackedRefs } from './channel-relink';

export type { IngestErrorCode, IngestJob, IngestOptions, IngestProgress, IngestResult, IngestSource, IngestSwap, LinkSource } from './ingest';
export { INGEST_VERSION, IngestError, WRITE_BATCH, runIngest } from './ingest';
export { QUOTA_ERROR, Room, dropGuides, isQuotaError } from './storage-room';

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

export type { EpgCatalogSource, EpgDueReason, EpgGuide, GuideWithoutLink, StoredGuide, UserGuide } from './epg-sources';
export { EPG_AHEAD_MS, EPG_OFFSET_MAX, EPG_OFFSET_STEP, EPG_REFRESH_MS, EPG_RETRY_MS, epgGuides, epgOffsetsOf, epgRefreshDue, isEpgOffset } from './epg-sources';

export type { ShortEpgAnswer, ShortEpgRequest, ShortEpgSource, ShortEpgTarget } from './short-epg';
export { SHORT_EPG_LIMIT, SHORT_EPG_TTL_MS, ShortEpgCache, shortEpgNowNext, shortEpgTarget, textTransport } from './short-epg';

export type { LinkWithoutLogin, RefreshSource } from './logins';
export { backupDoc, lacksLogin, linkOrigin, withoutLogins } from './logins';

export type { AccountCheck } from './account-check';
export { LOGIN_REFUSED, accountOf, checkAccount, sourceAccount } from './account-check';
export type { ProbeOptions, SourceProbe } from './source-probe';
export { PROBE_ANSWER_MAX, PROBE_TIMEOUT_MS, probeSource, startsPlaylist } from './source-probe';

export type { VodInfoRequest, VodInfoTarget } from './vod-info';
export { VOD_INFO_TTL_MS, VodInfoCache, vodInfoTarget } from './vod-info';

export type { SeriesInfoRequest, SeriesInfoTarget } from './series-info';
export { SERIES_INFO_TTL_MS, SeriesInfoCache, seriesInfoTarget } from './series-info';

export { PanelAnswers } from './panel-answers';

export type { EpgIngestOptions, EpgOutcome, EpgProgress, EpgRefreshJob, EpgRefreshResult, EpgResult, EpgSwap, EpgWanted } from './epg-ingest';
export { EPG_INGEST_VERSION, EPG_WRITE_BATCH, readEpgWanted, runEpgIngest, runEpgRefresh } from './epg-ingest';

export type { ConfigPlatform, ConfigPolicy, PolicyInput, PolicyRule } from './config-policy';
export { KILL_STRENGTH, compareVersions, configPolicy, noPolicy, policyStops, ruleMatches, versionParts } from './config-policy';

export { Blocklist, asciiHost, cachedBlocklist, punycode, urlHost } from './blocklist';

export type { CachedConfig, ConfigCheck, ConfigRefusal, VerifiedConfig } from './config-check';
export { checkConfigResponse, readCachedConfig } from './config-check';

export { MAX_NOTICES, isRuleId } from './config-constants';

export type { ConfigEvents, ConfigFailure, ConfigRequest, ConfigResult, ConfigRunRequest, ConfigServiceOptions, ConfigStatus, ConfigTarget } from './config-service';
export { CONFIG_KEY, CONFIG_MAX_BYTES, CONFIG_REFRESH_MS, CONFIG_RETRY_MS, CONFIG_TIMEOUT_MS, ConfigService, configHandlers } from './config-service';

// The pairing client (RELAY step 31c1): the pair worker's service.
export type { PairCode, PairFailure, PairFileFailure, PairFileResult, PairOpenResult, PairPollResult, PairServiceOptions, PairStatusResult } from './pair-service';
export { PAIR_ANSWER_MAX_BYTES, PAIR_POLL_MS, PAIR_RETRY_MS, PAIR_TIMEOUT_MS, PairService, pairHandlers, readPayload, retryAfterMs } from './pair-service';
// The phone's M3U file (RELAY step 31d2a): opened in the pair worker, read by the ingest worker.
export type { FileFrameHandlers, FileSecret } from './file-frames';
export { FileError, openFileFrames, serveFileFrames } from './file-frames';
export type { FileFeed } from './file-feed';
export { feedResponse } from './file-feed';
// The backup (RELAY steps 32b and 32c1): the backup worker's service, its plaintext, the API's client and its stand-in.
export type {
  BackupCallRequest,
  BackupCodeRequest,
  BackupEvents,
  BackupFailure,
  BackupPrepareRequest,
  BackupPrepareResult,
  BackupRestoreResult,
  BackupServiceOptions,
  BackupSource,
  BackupStatus,
  BackupSwitchRequest,
  BackupSwitchResult,
  BackupUploadResult,
  DeriveMaster,
  MasterRecord,
  OldCopy,
  SentRecord,
} from './backup-service';
export { BACKUP_CODE_KEY, BACKUP_MASTER_KEY, BACKUP_OFF_KEY, BACKUP_SENT_KEY, BackupService, backupHandlers, readMasterRecord, readSentRecord, secretCheck } from './backup-service';
export { BACKUP_PLAIN_MAX_BYTES, backupPlain, profileHash, readBackupPlain } from './backup-plain';
export type { BackupAnswer } from './backup-api';
export { BACKUP_ANSWER_MAX_BYTES, BACKUP_TIMEOUT_MS, BackupApi, envelopeBody, readEnvelope } from './backup-api';
export type { BackupStandIn, StandInRequest } from './backup-stand-in';
export { backupStandIn } from './backup-stand-in';

// Telemetry (RELAY step 33b1): the telemetry worker's service.
export type { DiagParts, DiagSendRequest, DiagSendResult, TelemetrySendRequest, TelemetrySendResult, TelemetryServiceOptions } from './telemetry-service';
export {
  TELEMETRY_CAPABILITY_KEY,
  TELEMETRY_ID_BYTES,
  TELEMETRY_ID_KEY,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_MAX,
  TELEMETRY_TIMEOUT_MS,
  batchBody,
  capabilityKey,
  samplePoint,
  sampled,
  telemetryHandlers,
  telemetryOff,
  utf8Length,
} from './telemetry-service';

export type { IngestEvents, IngestRunRequest, IngestServiceOptions } from './ingest-service';
export { IngestService } from './ingest-service';

export type { EpgEvents, EpgRunRequest, EpgServiceOptions } from './epg-service';
export { EpgService } from './epg-service';

export type { BackupClient, BackupHandlers, ConfigClient, ConfigHandlers, DataClient, EpgClient, EpgHandlers, IngestClient, IngestHandlers, PairClient, PairHandlers, QueryHandlers, TelemetryClient, TelemetryHandlers } from './client';
export { createBackupClient, createConfigClient, createDataClient, createEpgClient, createIngestClient, createPairClient, createTelemetryClient } from './client';
