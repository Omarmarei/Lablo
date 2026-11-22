/**
 * The app's side of the data workers (architecture.md §1.2 and §1.4, RELAY step 8b):
 * - the **query worker** starts once and keeps running; every catalog read goes through it;
 * - an **ingest worker** starts for each refresh and is terminated when the refresh ends,
 *   which frees its whole heap. At app start a short-lived one runs `prune`, which clears what
 *   crashed or killed refreshes left behind;
 * - when a refresh swaps in a new generation (`swapped`), the query worker `reload`s;
 * - remote keys mark the UI busy: the running refresh pauses (`setBusy`) until the keys have
 *   been idle for `idleMs`;
 * - an **EPG worker** starts for each EPG refresh (step 9b). The guides come from the catalog
 *   sources (`epgGuides`), and `due` refreshes only those `epgRefreshDue` names (a guide matched
 *   with other manual mappings than the profile's is one: step 24d; the EPG worker reads the
 *   mappings from the profile itself). Catalog and EPG
 *   refreshes share one slot, so a low-tier TV never runs both at once; when a guide swaps in, the
 *   query worker reloads, and `nowNext` reads the store through it (`guide`, the grid guide's
 *   rows over a time range, too: step 23a);
 * - `focusChannel` is the short-EPG fallback (step 9c): once a live channel has kept the focus
 *   for `FOCUS_MS`, the query worker gives its now/next, from its guide or, when no guide matches
 *   it, from its Xtream panel's `get_short_epg` (kept 30 min per channel in the worker);
 * - `profile` and `editProfile` read and change the profile document through the query worker
 *   (step 13b: onboarding's answers and the sources);
 * - `categories` and `chunk` read a source's categories and one chunk of a category (step 14a:
 *   the live screen reads only the chunks of the rows around its window);
 * - `account` re-checks a source's Xtream account for the player's error card (step 20a);
 * - `vodInfo` reads a movie's details from its Xtream panel when they open (step 26c, kept 24 h in
 *   the query worker);
 * - `seriesInfo` reads a show's seasons and episodes from its Xtream panel when its details open
 *   (step 27b, kept 24 h in the query worker);
 * - `recent` gives the newest movies across the sources ("Recently added", step 26e), from the
 *   lists the ingest keeps;
 * - `itemsByKey` gives the catalog items of ContentKeys ("Continue watching", step 27d);
 * - `unlock`, `relock`, `lockState` and `setPin` are parental control's (step 38): the query worker
 *   checks the PIN, keeps the session's unlock and serves nothing locked while it is locked;
 * - a **config worker** starts for each config refresh (`refreshConfig`, step 30b2): it answers
 *   the cached copy's policy first (`onCached`), then fetches `GET <api>/v1/config`, and ends.
 *   It runs beside the refresh slot (it reads and writes one small record). After each run, a
 *   running query worker reads the blocklist again (`reloadConfig`), and `blocked` asks it about
 *   URLs;
 * - a **pair worker** starts for each opening of the pairing screen (`pairing`, step 31c1) and
 *   ends when it closes: it holds the TV's secret key for the codes it shows, and opens the
 *   phone's payload. It runs beside the refresh slot (the add path's refresh takes the slot).
 *   An M3U file from the phone (step 31d2a) is fetched and opened there too: `PairSession.file`
 *   makes a `MessageChannel`, gives one port to the pair worker and the other, as a `FileFeed`,
 *   to the refresh (`RefreshOptions.file`), whose ingest worker pulls the plain frames from it.
 *   The add's load is cancelled before the pair worker ends (the pairing screen's `close`).
 * - a **backup worker** starts for each `prepareBackup` (step 32b), `uploadBackup` and
 *   `restoreBackup` (step 32c1) and ends when it answers: it keeps the backup code and the master
 *   key in IndexedDB (scrypt, seconds on a 2018 TV, runs there only when no master is kept for the
 *   secret), and sends or restores the profile through the backup API. It runs beside the refresh
 *   slot;
 * - a **telemetry worker** starts for each `sendTelemetry` (step 33b1) and ends when it answers: it
 *   keeps the install ID and the events not yet sent in `kv`, and posts them to the telemetry API.
 *   It runs beside the refresh slot.
 *
 * Workers come from factories, so tests serve the real services over message channels; the
 * app passes the `?worker` imports (`./workers.ts`).
 */

import type { CatalogItem, ContentKey, ContentKind, DeviceTier, EpgProgramme, SearchResult, XtreamSeriesInfo, XtreamVodInfo, ZoneOffset } from '@lablo/core';
import { panelZone } from '@lablo/core';
import type {
  AccountCheck,
  CancelToken,
  CategoryInfo,
  ConfigResult,
  ConfigRunRequest,
  DataClient,
  EpgCatalogSource,
  EpgNowNext,
  EpgProgress,
  EpgRefreshResult,
  EpgStatus,
  GuideChannelsPage,
  GuideChannelsRequest,
  GuideRequest,
  GuideRow,
  IngestClient,
  IngestJob,
  IngestProgress,
  IngestResult,
  IngestSource,
  ItemRef,
  KeyItemsRequest,
  LinkSource,
  LinkWithoutLogin,
  LoadedProfile,
  ProfileEdit,
  ProgrammeRequest,
  QueryStatus,
  RecentItem,
  RecentRequest,
  RefreshSource,
  RpcPort,
  SearchRequest,
  SeriesInfoRequest,
  ShortEpgNowNext,
  ShortEpgSource,
  SourceMeta,
  UnmatchedPage,
  UnmatchedRequest,
  StoredGuide,
  VodInfoRequest,
} from '@lablo/data';
// The client entry only: the package index would pull every data module's polyfills into main.
import type {
  BackupCallRequest,
  BackupCodeRequest,
  BackupPrepareRequest,
  BackupPrepareResult,
  BackupRestoreResult,
  BackupStatus,
  BackupSwitchRequest,
  BackupSwitchResult,
  BackupUploadResult,
  FileFeed,
  PairFileFailure,
  PairOpenResult,
  PairPollResult,
  PairStatusResult,
  DiagSendRequest,
  DiagSendResult,
  LockState,
  NumberRequest,
  NumberedChannel,
  TelemetrySendRequest,
  UnlockAnswer,
  TelemetrySendResult,
} from '@lablo/data/client';
import {
  createBackupClient,
  createConfigClient,
  createDataClient,
  createEpgClient,
  createIngestClient,
  createPairClient,
  createTelemetryClient,
  epgGuides,
  epgRefreshDue,
  lacksLogin,
} from '@lablo/data/client';
import type { PairStatus } from '@lablo/protocol';

/** What a source's stream and catch-up URLs need from its last login (`DataEngine.sourceFacts`). */
export interface SourceFacts {
  /** The account's `allowed_output_formats` (`null`: a playlist, or no login yet). */
  readonly outputFormats: readonly string[] | null;
  /** The panel's zone (`panelZone` of its `server_info`, ADR-010; UTC without one). */
  readonly zone: ZoneOffset;
}

/** The phone's file, ready to read: a feed for one refresh (`RefreshOptions.file`), or why not. */
export type PairFileFeedResult = { readonly ok: true; readonly feed: FileFeed } | { readonly ok: false; readonly failure: PairFileFailure };

/**
 * One opening of the pairing screen (step 31c1): its own pair worker, whose calls are
 * `PairService`'s (packages/data/src/pair-service.ts). `close` forgets the key and ends the
 * worker; calls after it reject.
 */
export interface PairSession {
  open(base: string): Promise<PairOpenResult>;
  poll(): Promise<PairPollResult>;
  /** After `ready` with an M3U file (step 31d2a): its frames, fetched and opened in the pair worker. */
  file(): Promise<PairFileFeedResult>;
  status(status: PairStatus): Promise<PairStatusResult>;
  close(): void;
}

/** What the engine needs from a worker (a `Worker`, or a test double). */
export interface WorkerLike extends RpcPort {
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface DataEngineOptions {
  startQueryWorker: () => WorkerLike;
  startIngestWorker: () => WorkerLike;
  startEpgWorker: () => WorkerLike;
  startConfigWorker: () => WorkerLike;
  /** The pairing screen's worker (step 31c1); an engine without one can't pair. */
  startPairWorker?: () => WorkerLike;
  /** The backup's worker (step 32b); an engine without one can't back up. */
  startBackupWorker?: () => WorkerLike;
  /** Telemetry's worker (step 33b1); an engine without one sends no telemetry. */
  startTelemetryWorker?: () => WorkerLike;
  /** The clock `due` EPG refreshes are decided by (default `Date.now`). */
  now?: () => number;
  /** How long after the last remote key the UI counts as idle again (default 1000 ms). */
  idleMs?: number;
  /** Called when the busy flag changes. */
  onBusy?: (busy: boolean) => void;
  /**
   * Called after the profile may have changed (step 32c2: the backup's upload schedule): an
   * `editProfile` that changed it, and a catalog refresh that committed (a new source's record,
   * favourites matched again). A call too many costs an upload that finds nothing changed.
   */
  onProfileChanged?: () => void;
  /**
   * Called after each catalog refresh that resolves, and each EPG refresh that ran its worker
   * (step 33b2: telemetry's `ingest_done` and `epg_match`). A refused or failed refresh calls
   * nothing.
   */
  onRefreshed?: (done: RefreshDone) => void;
  /**
   * Called when a worker the engine started dies of an uncaught error (step 33c: telemetry's
   * `crash`), after its client has failed its calls. Only what the worker's `error` event says: its
   * message and position, and which worker.
   */
  onWorkerError?: (error: WorkerError) => void;
}

/** The engine's workers, as `onWorkerError` names them. */
export type WorkerName = 'query' | 'ingest' | 'epg' | 'config' | 'pair' | 'backup' | 'telemetry';

/** A worker's uncaught error as its `Worker` hears it (Chromium gives no stack, and `error: null`). */
export interface WorkerError {
  readonly worker: WorkerName;
  /** `Uncaught Error: …` (empty when the engine gave none). */
  readonly message: string;
  /** Where in the worker's bundle (0: unknown). */
  readonly line: number;
  readonly col: number;
}

/** A refresh that resolved (`DataEngineOptions.onRefreshed`): the catalog's source type and its result, or the guides'. */
export type RefreshDone = { readonly kind: 'catalog'; readonly source: IngestSource['type']; readonly result: IngestResult } | { readonly kind: 'epg'; readonly result: EpgRefreshResult };

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
  /** Their keys, and which of them are live channels. */
  keys: ContentKey[];
  live: boolean[];
}

/**
 * A catalog refresh the app asks for: `IngestJob`'s, with a source that may lack its login (step
 * 32d4a: a backup without logins brought it back), which the engine refuses.
 */
export interface RefreshJob {
  src: string;
  source: RefreshSource;
  force?: boolean;
}

export interface RefreshOptions {
  /** A low-tier TV: the refresh runs the 50/50 duty cycle. */
  lowTier?: boolean;
  onProgress?: (progress: IngestProgress) => void;
  cancel?: CancelToken;
  /** An `m3u-file` source's frames (`PairSession.file`, step 31d2a): its port goes to the ingest worker, once. */
  file?: FileFeed;
}

export interface EpgRefreshOptions {
  tier: DeviceTier;
  /** Guides the user added, in their order (step 22). */
  user?: StoredGuide[];
  /** UI languages, most preferred first. */
  languages?: string[];
  /** Read only the guides that are due (`epgRefreshDue`); without it, every guide. */
  due?: boolean;
  /** Ignore validators and byte hashes. */
  force?: boolean;
  onProgress?: (progress: EpgProgress) => void;
  cancel?: CancelToken;
}

export const IDLE_MS = 1000;
/** How long a live channel keeps the focus before its short EPG is asked for (§1.5 item 1). */
export const FOCUS_MS = 600;

/** A focused live channel. */
export interface FocusedChannel {
  key: ContentKey;
  /** Its stream URL (the panel's stream id is read from it; it never leaves the data layer). */
  url: string;
  /** Its catalog source, as the app refreshes it (a link source: `LinkSource` fits). */
  source: ShortEpgSource;
}

const ignore = (): void => undefined;

/**
 * A refresh the data engine refused because the source's server is on the signed config's
 * blocklist (RELAY step 30c3a): `code` is `blocklisted`, as onboarding's `loadError` reads it.
 */
export class BlockedSourceError extends Error {
  readonly code = 'blocklisted';

  constructor() {
    super("The source's server is on the blocklist");
    this.name = 'BlockedSourceError';
  }
}

/**
 * A refresh the data engine refused because the source has no login on the TV (step 32d4a: a
 * backup made without logins brought it back): `code` is `needs-login`. Nothing was asked of the
 * source's server.
 */
export class NeedsLoginError extends Error {
  readonly code = 'needs-login';

  constructor() {
    super('The source has no login on this TV');
    this.name = 'NeedsLoginError';
  }
}

/**
 * The URL whose host a source's catalog comes from: an Xtream account's server, an M3U link (for a
 * source without its login, step 32d4a: the server or the link's origin it kept). (The phone's file
 * has none: its streams meet the blocklist when they play.)
 */
export function sourceUrlOf(source: LinkSource | LinkWithoutLogin): string {
  if (source.type === 'xtream') return source.account === null ? source.base : source.account.base;
  return source.url === null ? source.origin : source.url;
}

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
  /** The refresh running (catalog or EPG), or `null`. */
  private slot: 'catalog' | 'epg' | null = null;
  /** Tells the running refresh's worker that the UI is busy. */
  private sendBusy: ((busy: boolean) => void) | null = null;
  private busyFlag = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** The focus waiting out `FOCUS_MS`, and the newest focus (older answers are dropped). */
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private focusWaiting: ((value: null) => void) | null = null;
  private focusSeq = 0;

  constructor(private readonly options: DataEngineOptions) {}

  /** The query worker's client (starts the worker on first use). */
  get query(): DataClient {
    return this.queryClientOrStart();
  }

  /** True while remote keys are being pressed. */
  get busy(): boolean {
    return this.busyFlag;
  }

  /** True while a refresh (catalog or EPG) runs. */
  get refreshing(): boolean {
    return this.slot !== null;
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
   * Each source's facts from its last login, for the player's URLs:
   * - `outputFormats`: an Xtream account's `allowed_output_formats` (step 20c2a), for
   *   `streamCandidates` and `catchupCandidates`; `null` for playlists and sources no refresh has
   *   logged in to yet;
   * - `zone` (step 25a): the panel's zone (`panelZone` of its `server_info`, ADR-010), in which
   *   Xtream catch-up starts are written; UTC without one.
   */
  async sourceFacts(): Promise<Map<string, SourceFacts>> {
    const facts = new Map<string, SourceFacts>();
    for (const s of (await this.query.call('status')).sources) {
      facts.set(s.src, { outputFormats: s.outputFormats ?? null, zone: panelZone(s.server ?? null).offset });
    }
    return facts;
  }

  /** The ids of every catalog source stored (a refresh that never reached the profile included). */
  async sourceIds(): Promise<string[]> {
    return (await this.query.call('status')).sources.map((s) => s.src);
  }

  /** Every catalog source's record: its generation and when it was last checked (step 22a's schedule). */
  async sourceStatus(): Promise<SourceMeta[]> {
    return (await this.query.call('status')).sources;
  }

  /**
   * The profile (step 13b), upgraded first if an older app version wrote it; `null` when there
   * is none yet. Read and written by the query worker.
   */
  profile(): Promise<LoadedProfile | null> {
    return this.query.call('profile');
  }

  /**
   * Changes the profile in one read-modify-write transaction (creating it when there is none).
   * Resolves `false` when nothing changed or the stored profile is from a newer app version.
   */
  editProfile(edit: ProfileEdit): Promise<boolean> {
    return this.query.call('editProfile', edit).then((changed) => {
      if (changed) this.options.onProfileChanged?.();
      return changed;
    });
  }

  /**
   * One refresh in a fresh ingest worker. Waits for the start-up prune first (a prune would
   * abandon a refresh running next to it). When the refresh swaps generations, the query worker
   * reloads before this resolves, so the next read sees the new catalog.
   */
  async refresh(job: RefreshJob, options: RefreshOptions = {}): Promise<IngestResult> {
    const source = job.source;
    // A source without its login (step 32d4a) is never read, before anything: no URL can be built.
    if (lacksLogin(source)) throw new NeedsLoginError();
    const ingest: IngestJob = { src: job.src, source };
    if (job.force !== undefined) ingest.force = job.force;
    // The slot first, at once: a second refresh called meanwhile is refused as before.
    await this.claim('catalog');
    let reload: Promise<unknown> = Promise.resolve();
    try {
      // The blocklist (step 30c3a): a source on a blocked server is never read; no ingest worker starts.
      // A file from the phone has no catalog server (`PlayerController.play` checks its streams).
      if (source.type !== 'm3u-file') {
        const blocked = await this.blockedOrNone([sourceUrlOf(source)]);
        if (blocked[0] === true) throw new BlockedSourceError();
      }
      return await this.withIngestWorker(async (client) => {
        this.busyTo((busy) => client.call('setBusy', { busy }).catch(ignore));
        client.on('swapped', () => {
          reload = this.query.call('reload');
          reload.catch(ignore);
        });
        if (options.onProgress) client.on('progress', options.onProgress);
        const file = options.file;
        const result = await client.call(
          'run',
          file === undefined ? { job: ingest, lowTier: options.lowTier } : { job: ingest, lowTier: options.lowTier, file },
          file === undefined ? { cancel: options.cancel } : { cancel: options.cancel, transfer: [file.port as MessagePort] },
        );
        // The refresh itself succeeded; a query worker that can't reload reports that on the
        // next read.
        await reload.catch(ignore);
        if (result.status === 'committed') this.options.onProfileChanged?.();
        this.options.onRefreshed?.({ kind: 'catalog', source: source.type, result });
        return result;
      });
    } finally {
      this.release();
    }
  }

  /**
   * One EPG refresh in a fresh EPG worker, for the guides of `catalogs` (plus the user's), in
   * the refresh slot. With `due`, only the guides `epgRefreshDue` names are read, and no worker
   * starts when none is, unless a stored guide is no longer listed (it is deleted) or has moved
   * in the order (step 22b: its rank is set, with no download). When a guide swaps in or moves,
   * the query worker reloads before this resolves.
   */
  async refreshEpg(catalogs: readonly EpgCatalogSource[], options: EpgRefreshOptions): Promise<EpgRefreshResult> {
    await this.claim('epg');
    let reload: Promise<unknown> = Promise.resolve();
    try {
      const status = await this.query.call('epgStatus');
      const guides = epgGuides(catalogs, status.sources, options.user);
      const listed = guides.map((g) => g.epgSrc);
      // A guide on a blocked server (step 30c3a) isn't read, but stays listed: its programmes are kept.
      const blocked = await this.blockedOrNone(guides.map((g) => g.url));
      let only: string[] | undefined;
      if (options.due) {
        const now = this.options.now ? this.options.now() : Date.now();
        only = guides.filter((g, i) => !blocked[i] && epgRefreshDue(findGuide(status, g.epgSrc), now, status.mapping) !== null).map((g) => g.epgSrc);
        // A guide gone from the list, or one in another place (its rank is its place).
        const changed = status.guides.some((m) => listed.indexOf(m.epgSrc) !== m.rank);
        if (only.length === 0 && !changed) return { outcomes: [], deleted: [], reranked: [], wanted: 0 };
      } else if (blocked.indexOf(true) !== -1) {
        only = guides.filter((_, i) => !blocked[i]).map((g) => g.epgSrc);
      }
      return await this.withWorker('epg', this.options.startEpgWorker, createEpgClient, async (client) => {
        this.busyTo((busy) => client.call('setBusy', { busy }).catch(ignore));
        client.on('swapped', () => {
          reload = this.query.call('reload');
          reload.catch(ignore);
        });
        if (options.onProgress) client.on('progress', options.onProgress);
        // (No mappings in the job: the EPG worker reads the profile's.)
        const job = { guides, only, tier: options.tier, languages: options.languages, force: options.force };
        const result = await client.call('run', { job, lowTier: options.tier === 'low' }, { cancel: options.cancel });
        // A guide that only moved sends no swap: the query worker orders the guides by rank.
        if (result.reranked.length > 0) reload = this.query.call('reload');
        await reload.catch(ignore);
        this.options.onRefreshed?.({ kind: 'epg', result });
        return result;
      });
    } finally {
      this.release();
    }
  }

  /**
   * One config refresh in a fresh config worker (step 30b2): `onCached` gets the cached copy's
   * policy (or the defaults) as soon as it is read, then this resolves with the fetched one (or,
   * on any failure, the cached one again and why). A worker that dies rejects; the cached copy
   * stays. Not in the refresh slot. A running query worker reads its blocklist again afterwards.
   */
  async refreshConfig(request: ConfigRunRequest, onCached?: (result: ConfigResult) => void): Promise<ConfigResult> {
    const result = await this.withWorker('config', this.options.startConfigWorker, createConfigClient, (client) => {
      if (onCached) client.on('cached', onCached);
      return client.call('run', request);
    });
    // A new copy, or a copy this build no longer trusts deleted: the blocklist may have changed.
    // A query worker not started yet reads it when first asked.
    if (this.queryClient !== null) await this.queryClient.call('reloadConfig').catch(ignore);
    return result;
  }

  /**
   * A pairing session in a pair worker of its own (step 31c1), started now. The worker ends with
   * the session's `close` (or when it dies: its calls reject).
   */
  pairing(): PairSession {
    const start = this.options.startPairWorker;
    if (start === undefined) throw new Error('This data engine has no pair worker');
    const worker = start();
    const client = createPairClient(worker);
    this.watch('pair', worker);
    return {
      open: (base) => client.call('open', { base }),
      poll: () => client.call('poll'),
      file: () => {
        // One end to the pair worker, which serves the frames; the other for the refresh.
        const channel = new MessageChannel();
        return client.call('file', { port: channel.port1 }, { transfer: [channel.port1] }).then(
          (result): PairFileFeedResult => {
            if (result.ok) return { ok: true, feed: { port: channel.port2, size: result.size } };
            channel.port2.close();
            return result;
          },
          (error: unknown) => {
            channel.port2.close();
            throw error;
          },
        );
      },
      status: (status) => client.call('status', { status }),
      // Both are safe to repeat: a second close does nothing more.
      close: () => {
        client.close();
        worker.terminate();
      },
    };
  }

  /**
   * Makes sure the backup's master key for `request`'s secret is kept (step 32b), in a backup
   * worker of its own, started now and ended when it answers: the device ID after "Allow", else
   * the backup code (made and kept at the first call). `onProgress` gets scrypt's progress, 0 to 1
   * in whole percents, when it has to run. Not in the refresh slot.
   */
  prepareBackup(request: BackupPrepareRequest, onProgress?: (fraction: number) => void): Promise<BackupPrepareResult> {
    return this.withBackupWorker((client) => {
      if (onProgress) client.on('progress', onProgress);
      return client.call('prepare', request);
    });
  }

  /**
   * Sends the profile to the backup API at `request.base` when it changed since the last send
   * (step 32c1), in a backup worker of its own: `sent`, `same`, `none` (nothing worth sending),
   * `held` (a backup this TV hasn't seen is there: never written over), `too-large`, `off` (step
   * 32d2a: the backup is off; copies still to delete were tried) or `failed`.
   * The master is derived first when none is kept (scrypt). Not in the refresh slot.
   */
  uploadBackup(request: BackupCallRequest): Promise<BackupUploadResult> {
    return this.withBackupWorker((client) => client.call('upload', request));
  }

  /**
   * Looks for this TV's backup with its device ID and restores it where there is no profile (step
   * 32c1), in a backup worker of its own: `onProgress` gets scrypt's progress. Nothing is kept
   * unless a backup is restored. A cancel (the app's time limit) rejects with `CancelError` and
   * ends the worker. Not in the refresh slot.
   */
  restoreBackup(request: BackupCallRequest, options: { readonly onProgress?: (fraction: number) => void; readonly cancel?: CancelToken } = {}): Promise<BackupRestoreResult> {
    return this.withBackupWorker((client) => {
      if (options.onProgress) client.on('progress', options.onProgress);
      return client.call('restore', request, { cancel: options.cancel });
    });
  }

  /**
   * What Settings' backup page shows (step 32d2a), in a backup worker of its own: on or off, the
   * master's source, the backup code while on with the code as the secret (made and kept then if
   * there is none), when the copy on the server was last written, deletes still pending.
   */
  backupStatus(request: BackupPrepareRequest): Promise<BackupStatus> {
    return this.withBackupWorker((client) => client.call('status', request));
  }

  /**
   * Turns the backup on or off (step 32d2a). Off is kept first (no upload sends after it), then
   * every copy this TV wrote, and the one under this request's lookup ID, is deleted; what can't
   * be deleted yet is tried again by each upload (which answers `off`).
   */
  setBackup(request: BackupSwitchRequest): Promise<BackupSwitchResult> {
    return this.withBackupWorker((client) => client.call('setEnabled', request));
  }

  /**
   * A held backup (step 32d2a): restores it over the profile, which is kept as a snapshot
   * (`restored`, or `none`, `unreadable`, `newer`, `failed`; `kept` when the profile is from a
   * newer app). The caller starts the app again: every screen holds the old profile.
   */
  restoreHeldBackup(request: BackupCallRequest): Promise<BackupRestoreResult> {
    return this.withBackupWorker((client) => client.call('restoreHeld', request));
  }

  /**
   * The backup code typed at a first start (step 32d3b), in a backup worker of its own: restores
   * the backup it finds where there is no profile or one with no source yet (`restored`; `kept`
   * when a source is there; `none`, `unreadable`, `newer`, `failed` keep nothing). `onProgress`
   * gets scrypt's progress; a cancel rejects with `CancelError` and ends the worker. Text that
   * can't be a code rejects (check it with `readBackupCode` first).
   */
  restoreBackupCode(request: BackupCodeRequest, options: { readonly onProgress?: (fraction: number) => void; readonly cancel?: CancelToken } = {}): Promise<BackupRestoreResult> {
    return this.withBackupWorker((client) => {
      if (options.onProgress) client.on('progress', options.onProgress);
      return client.call('restoreCode', request, { cancel: options.cancel });
    });
  }

  /** A held backup (step 32d2a): sends the profile over it, as an upload does without its `GET`. */
  replaceHeldBackup(request: BackupCallRequest): Promise<BackupUploadResult> {
    return this.withBackupWorker((client) => client.call('replaceHeld', request));
  }

  /**
   * Hands `request.events` to the telemetry queue and posts it (step 33b1), in a telemetry worker
   * of its own: `sent`, `refused` (gone for good), `failed` (kept), `empty`, or `off` (the
   * profile's switch: the queue and the install ID are gone).
   */
  sendTelemetry(request: TelemetrySendRequest): Promise<TelemetrySendResult> {
    const start = this.options.startTelemetryWorker;
    if (start === undefined) return Promise.reject(new Error('This data engine has no telemetry worker'));
    return this.withWorker('telemetry', start, createTelemetryClient, (client) => client.call('send', request));
  }

  /**
   * Sends the diagnostics report (step 33d2) in a telemetry worker of its own: `sent` with the
   * support code, or `failed`. The worker reads the rest of the report from the database.
   */
  sendDiagReport(request: DiagSendRequest): Promise<DiagSendResult> {
    const start = this.options.startTelemetryWorker;
    if (start === undefined) return Promise.reject(new Error('This data engine has no telemetry worker'));
    return this.withWorker('telemetry', start, createTelemetryClient, (client) => client.call('report', request));
  }

  /** For each URL, whether its host is on the signed config's blocklist (step 30b2; enforced in 30c). */
  blocked(urls: string[]): Promise<boolean[]> {
    return this.query.call('blocked', { urls });
  }

  /**
   * `blocked`, or nothing blocked when the query worker can't answer (step 30c3a): the blocklist
   * is then unknown, and a broken worker is no reason to refuse a user's source. The player asks
   * it before each stream opens (step 30c3b).
   */
  blockedOrNone(urls: string[]): Promise<boolean[]> {
    return this.blocked(urls).catch((error: unknown) => {
      console.warn('The blocklist could not be read', error);
      return urls.map(() => false);
    });
  }

  /** A source's categories of one kind in its active generation (`[]`: none). */
  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]> {
    return this.query.call('categories', { src, kind });
  }

  /** One chunk (up to 500 items) of a category in the source's active generation (`[]`: gone). */
  chunk(src: string, kind: ContentKind, catIdx: number, chunk: number): Promise<CatalogItem[]> {
    return this.query.call('chunk', { src, kind, catIdx, chunk });
  }

  /** Now and next for live channels, from the stored guides (through the query worker). */
  nowNext(keys: ContentKey[], at?: number): Promise<EpgNowNext[]> {
    return this.query.call('nowNext', { keys, at });
  }

  /**
   * The grid guide's rows: each live channel's programmes over `[from, to)` (UTC minutes), from the
   * guide channel its now/next comes from. Rejects an ask of too many channel-days at once.
   */
  guide(req: GuideRequest): Promise<GuideRow[]> {
    return this.query.call('guide', req);
  }

  /**
   * The programme details (step 24a): the whole programme of a live channel that starts at
   * `start` (UTC minutes, as the grid gives it), or `null` when its guide has none starting then.
   */
  programme(req: ProgrammeRequest): Promise<EpgProgramme | null> {
    return this.query.call('programme', req);
  }

  /** The stored guides and how many live channels have one. */
  epgStatus(): Promise<EpgStatus> {
    return this.query.call('epgStatus');
  }

  /**
   * The past days the stored guides keep (step 25c: the grid guide reaches that far back): the
   * longest of their last refreshes' windows, which keep their channels' longest catch-up within
   * the tier's limit (`EPG_WINDOWS`); 0 without a stored guide.
   */
  async guidePastDays(): Promise<number> {
    const guides = (await this.query.call('epgStatus')).guides;
    let days = 0;
    for (let i = 0; i < guides.length; i += 1) days = Math.max(days, guides[i]!.summary?.pastDays ?? 0);
    return days;
  }

  /**
   * A page of the live channels no guide matches (step 24c), over the sources in the order
   * given, as "All channels" lists them; its `count` is the whole list's.
   */
  unmatched(req: UnmatchedRequest): Promise<UnmatchedPage> {
    return this.query.call('unmatched', req);
  }

  /**
   * A page of the XMLTV channels the guides declare (step 24d: the manual mapping's picker), or
   * one guide's, whose names hold each word of the query; its `count` is the whole search's.
   */
  guideChannels(req: GuideChannelsRequest): Promise<GuideChannelsPage> {
    return this.query.call('guideChannels', req);
  }

  /**
   * A live channel got the focus (`null`: the focus left the live channels). Once it has kept
   * the focus for `FOCUS_MS`, the query worker gives its now/next: its guide's when one matches
   * it, otherwise its Xtream panel's short EPG (`from: 'panel'`). A focus that moves on before
   * then asks nothing, so scrolling through a list makes no requests.
   *
   * Resolves with the answer, or `null` when the focus moved on first (or the engine was
   * disposed): each call settles the one before. Rejects with the panel's error for the focused
   * channel (the next focus asks again).
   */
  focusChannel(channel: FocusedChannel | null): Promise<ShortEpgNowNext | null> {
    const seq = ++this.focusSeq;
    this.clearFocus();
    if (channel === null || this.disposed) return Promise.resolve(null);
    return new Promise<ShortEpgNowNext | null>((resolve, reject) => {
      this.focusWaiting = resolve;
      this.focusTimer = setTimeout(() => {
        this.focusTimer = null;
        this.focusWaiting = null;
        const current = (): boolean => seq === this.focusSeq && !this.disposed;
        if (!current()) {
          resolve(null);
          return;
        }
        this.query.call('shortEpg', { key: channel.key, url: channel.url, source: channel.source }).then(
          (answer) => resolve(current() ? answer : null),
          (error: unknown) => (current() ? reject(error) : resolve(null)),
        );
      }, FOCUS_MS);
    });
  }

  /**
   * How the account behind source `src` stands, for the player's error card (step 20a): its
   * Xtream panel's `player_api.php` answer through the query worker, or `null` for a playlist with
   * no panel. Rejects with the panel's error.
   */
  account(src: string): Promise<AccountCheck | null> {
    return this.query.call('account', { src });
  }

  /**
   * A movie's details (step 26c): its Xtream panel's `get_vod_info` through the query worker, kept
   * 24 h per movie; `null` for a movie with no panel (a plain playlist's) or one the panel doesn't
   * know. Rejects with the panel's error (the next open asks again).
   */
  vodInfo(req: VodInfoRequest): Promise<XtreamVodInfo | null> {
    return this.query.call('vodInfo', req);
  }

  /**
   * A show's seasons and episodes (step 27b): its Xtream panel's `get_series_info` through the
   * query worker, kept 24 h per show; `null` for a show with no panel or one the panel doesn't
   * know. Rejects with the panel's error (the next open asks again).
   */
  seriesInfo(req: SeriesInfoRequest): Promise<XtreamSeriesInfo | null> {
    return this.query.call('seriesInfo', req);
  }

  /**
   * The newest items of a kind across the sources, newest first ("Recently added", step 26e): the
   * lists each catalog keeps from its ingest, merged in the query worker (no chunk is read).
   */
  recent(req: RecentRequest): Promise<RecentItem[]> {
    return this.query.call('recent', req);
  }

  /**
   * The catalog items of ContentKeys, of one kind, in the order asked ("Continue watching", step
   * 27d): found by the query worker's key maps, read from their chunks; a key of a source not
   * listed, or of an item no longer in its catalog, finds nothing.
   */
  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]> {
    return this.query.call('itemsByKey', req);
  }

  /**
   * The channel the user numbered `req.number` in one of `req.sources` (step 36b: number entry):
   * its stored address, the item as shown, and whether the user hid it; `null` when none has it.
   */
  numbered(req: NumberRequest): Promise<NumberedChannel | null> {
    return this.query.call('numbered', req);
  }

  /**
   * Unlocks the session with `pin` (step 38): the query worker checks it against the profile's
   * PIN; five wrong ones in a row make it wait a minute. The answer says how it went.
   */
  unlock(pin: string): Promise<UnlockAnswer> {
    return this.query.call('unlock', { pin });
  }

  /** Locks the session again (step 38: the app hidden, or "Lock again"). */
  relock(): Promise<void> {
    return this.query.call('relock');
  }

  /** Whether a PIN is set, whether the session is unlocked, and the kinds with something locked (step 38). */
  lockState(): Promise<LockState> {
    return this.query.call('lockState');
  }

  /**
   * Keeps `pin` as the PIN (step 38: a new salt and its hash in the profile). Resolves `false` for
   * one that isn't four digits; a changed profile is told to the backup schedule, as an edit is.
   */
  setPin(pin: string): Promise<boolean> {
    return this.query.call('setPin', { pin }).then((changed) => {
      if (changed) this.options.onProfileChanged?.();
      return changed;
    });
  }

  /**
   * The search screen's search (step 28a): the query worker's ranked hits over the active
   * catalogs (`SEARCH_LIMIT` at most by default), in `req.sources`' order. `cancel` drops a search
   * the text has moved past: one still waiting never scans, and its answer is never sent back.
   */
  find(req: SearchRequest, cancel?: CancelToken): Promise<SearchResult> {
    return cancel === undefined ? this.query.call('search', req) : this.query.call('search', req, { cancel });
  }

  /** The items at `refs` (a search's hits), `null` where the chunk or slot is gone (an older generation's). */
  items(refs: ItemRef[]): Promise<(CatalogItem | null)[]> {
    return this.query.call('items', { refs });
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
    return {
      query: result.query,
      total: result.total,
      names: items.map((item) => (item === null ? '?' : item.name)),
      keys: items.map((item) => (item === null ? '' : item.key)),
      live: refs.map((r) => r.kind === 'live'),
    };
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
    this.clearFocus();
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
      this.watch('query', worker);
    }
    return this.queryClient;
  }

  /** Stops the focus timer; a focus still waiting resolves with `null`. */
  private clearFocus(): void {
    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
    this.focusTimer = null;
    const waiting = this.focusWaiting;
    this.focusWaiting = null;
    waiting?.(null);
  }

  private setBusy(busy: boolean): void {
    this.busyFlag = busy;
    this.sendBusy?.(busy);
    this.options.onBusy?.(busy);
  }

  /**
   * Takes the one refresh slot, then waits for the start-up prune (a prune would abandon a
   * refresh running next to it). The slot is taken first, so a second refresh can't slip in
   * behind the prune. A failed prune (no IndexedDB, say) fails the refresh with its own error.
   */
  private async claim(kind: 'catalog' | 'epg'): Promise<void> {
    if (this.slot !== null) throw new Error(`A ${this.slot === 'epg' ? 'guide' : 'catalog'} refresh is already running`);
    this.slot = kind;
    await this.start().catch(ignore);
  }

  private release(): void {
    this.slot = null;
    this.sendBusy = null;
  }

  /** Routes busy changes to the running refresh's worker; tells it at once if keys are down. */
  private busyTo(send: (busy: boolean) => void): void {
    this.sendBusy = send;
    if (this.busyFlag) send(true);
  }

  /** Runs `use` with a fresh ingest worker, then terminates it whatever happened. */
  private withIngestWorker<T>(use: (client: IngestClient) => Promise<T>): Promise<T> {
    return this.withWorker('ingest', this.options.startIngestWorker, createIngestClient, use);
  }

  /** One call in a backup worker started now and ended when it answers (step 32b). */
  private withBackupWorker<T>(use: (client: ReturnType<typeof createBackupClient>) => Promise<T>): Promise<T> {
    const start = this.options.startBackupWorker;
    if (start === undefined) return Promise.reject(new Error('This data engine has no backup worker'));
    return this.withWorker('backup', start, createBackupClient, use);
  }

  /**
   * Tells `onWorkerError` of `worker`'s uncaught errors (step 33c), after the client's own handler
   * (which fails its calls) has run. A report that throws is logged; the client's handler still ran.
   */
  private watch(name: WorkerName, worker: WorkerLike): void {
    const report = this.options.onWorkerError;
    if (report === undefined) return;
    const failed = worker.onerror;
    worker.onerror = (event: ErrorEvent) => {
      if (failed !== null) failed.call(worker, event);
      try {
        // (A worker whose script didn't load fires a plain `Event`: no message, no position.)
        report({ worker: name, message: event.message || '', line: event.lineno || 0, col: event.colno || 0 });
      } catch (error) {
        console.warn('A worker error was not reported', error);
      }
    };
  }

  /** Runs `use` with a fresh worker and its client, then terminates it whatever happened. */
  private async withWorker<C extends { close(): void }, T>(name: WorkerName, start: () => WorkerLike, wrap: (worker: WorkerLike) => C, use: (client: C) => Promise<T>): Promise<T> {
    const worker = start();
    const client = wrap(worker);
    this.watch(name, worker);
    try {
      return await use(client);
    } finally {
      client.close();
      worker.terminate();
    }
  }
}

function findGuide(status: EpgStatus, epgSrc: string): EpgStatus['guides'][number] | null {
  for (const g of status.guides) if (g.epgSrc === epgSrc) return g;
  return null;
}
