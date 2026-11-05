/**
 * The EPG refresh (architecture.md §1.5), as the ingest worker runs it. A refresh reads the guides
 * the app lists (epg-sources.ts) one after the other, each into a new generation that is then
 * swapped in, like a catalog refresh (ingest.ts):
 *
 * 1. Guides stored but no longer listed are deleted. Every other stored guide loses what a crashed
 *    refresh left behind and the past days it no longer needs, whether it is read this time or not.
 * 2. The wanted set is every live channel of every catalog source's active generation, read once
 *    per refresh. Its basis (the generations, the tier, the overrides and `EPG_INGEST_VERSION`)
 *    is stored with each guide: while it is the same, a guide whose server answers 304 or whose
 *    bytes hash the same is left as it is, and only its past days are pruned.
 * 3. Fetch, FNV-1a, gunzip and UTF-8 as the catalog ingest does, into core's `EpgGuideReader`.
 *    Its buckets are written about 10 per transaction (fragments merged with the stored record),
 *    with the throttle's busy pause and low-tier duty cycle between batches.
 * 4. A guide cut short, or one that isn't XMLTV at all, fails (`format`); nothing is written then.
 * 5. Swap: the match table, then one transaction makes the new generation active (`onSwap`: the
 *    query worker reloads), and the previous one is deleted.
 *
 * A failure before the swap abandons the new generation and keeps the active one; a crash keeps it
 * too, and the next refresh prunes what was half written. One guide's failure doesn't stop the
 * others; a cancel stops the whole refresh. Error messages never contain URLs.
 */

import type { CatalogItem, DeviceTier, EpgBucket, EpgOverride, EpgWantedChannel, ZoneOffset } from '@zoma/core';
import { EPG_WINDOWS, EpgGuideReader, EpgWantedSet, epgWantedChannel, epgWindow, hash53Base36, panelZone } from '@zoma/core';
import type { ByteTransport } from './bytes';
import { Fnv1a, decodeUtf8, tapBytes } from './bytes';
import type { FetchStamp, SourceMeta } from './catalog-store';
import { getSources } from './catalog-store';
import type { EpgChannelTable, EpgSummary } from './epg-store';
import {
  abandonEpgGeneration,
  beginEpgGeneration,
  commitEpgGeneration,
  deleteEpgGeneration,
  deleteEpgSource,
  epgFirstDay,
  getEpgMeta,
  getEpgMetas,
  markEpgChecked,
  markEpgFailed,
  pruneEpgDays,
  pruneEpgGenerations,
  putEpgBuckets,
  putEpgChannels,
  setEpgRank,
} from './epg-store';
import type { EpgGuide } from './epg-sources';
import type { GunzipMode } from './gunzip';
import { MaybeGunzip } from './gunzip';
import { onSuccess, transact } from './idb';
import type { IngestErrorCode } from './ingest-errors';
import { IngestError, headerNumber, ingestError } from './ingest-errors';
import type { CancelToken } from './rpc';
import { CancelError, NEVER } from './rpc';
import { STORE } from './schema';
import type { ThrottleStats } from './throttle';
import { Throttle } from './throttle';

/** Bump when reading or the stored bucket shape changes: unchanged guides are then read again. */
export const EPG_INGEST_VERSION = 1;
/** Buckets per write transaction. */
export const EPG_WRITE_BATCH = 10;
const PROGRESS_EVERY_MS = 250;

export interface EpgRefreshJob {
  /** Every guide, in priority order (`epgGuides`). Stored guides not listed are deleted. */
  guides: EpgGuide[];
  /** Read only these guides (default: every one listed). */
  only?: string[];
  tier: DeviceTier;
  /** UI languages, most preferred first (titles in them win). */
  languages?: string[];
  /** The user's manual mappings (step 24). */
  overrides?: EpgOverride[];
  /** Ignore validators and the byte hash: read every guide again. */
  force?: boolean;
}

export interface EpgProgress {
  epgSrc: string;
  /** Bytes received for this guide so far. */
  bytes: number;
  total: number | null;
  /** Programmes kept so far. */
  kept: number;
}

export interface EpgSwap {
  epgSrc: string;
  /** The active generation now (0: the guide was deleted). */
  gen: number;
  previous: number;
}

export interface EpgResult {
  epgSrc: string;
  /** `committed`: a new generation is active. `unchanged`: the guide had nothing new. */
  status: 'committed' | 'unchanged';
  gen: number;
  previous: number;
  /** What the active generation matched and kept. */
  summary: EpgSummary | null;
  fetch: FetchStamp | null;
  gzipped: boolean;
  elapsedMs: number;
  throttle: ThrottleStats;
}

/** One guide's outcome: its result, or why it failed (the others still ran). */
export type EpgOutcome =
  | { epgSrc: string; result: EpgResult; error: null }
  | { epgSrc: string; result: null; error: { code: IngestErrorCode | 'failed'; status: number | null; message: string } };

export interface EpgRefreshResult {
  outcomes: EpgOutcome[];
  /** Guides deleted because they are no longer listed. */
  deleted: string[];
  /**
   * Stored guides whose priority changed (the user moved one, step 22b): set without a download.
   * The caller reloads the query worker, which orders the guides by it.
   */
  reranked: string[];
  /** Live channels in the wanted set. */
  wanted: number;
}

export interface EpgIngestOptions {
  db: IDBDatabase;
  transport: ByteTransport;
  token?: CancelToken;
  throttle?: Throttle;
  now?: () => number;
  gunzip?: GunzipMode;
  /** Programmes the reader holds before it hands buckets out (core's default: 20,000). */
  flushAt?: number;
  onProgress?: (progress: EpgProgress) => void;
  /** Right after a guide's swap (or delete): the query worker should reload. */
  onSwap?: (swap: EpgSwap) => void;
}

/** The live channels a refresh matches against, and what they were read from. */
export interface EpgWanted {
  wanted: EpgWantedSet;
  /** `EPG_INGEST_VERSION`, tier, catalog generations and overrides. */
  basis: string;
  sources: SourceMeta[];
}

/** Every live channel of every source's active generation, in source and storage order. */
export async function readEpgWanted(db: IDBDatabase, tier: DeviceTier, overrides: readonly EpgOverride[] = []): Promise<EpgWanted> {
  const sources = (await getSources(db)).sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
  const live = sources.filter((s) => s.gen > 0 && (s.counts.live ?? 0) > 0);
  const channels = await transact<EpgWantedChannel[]>(db, STORE.chunks, 'readonly', (tx, done) => {
    const out: EpgWantedChannel[] = [];
    done(out);
    const store = tx.objectStore(STORE.chunks);
    // One source after the other, so the order (and with it every tie-break) is stable.
    const next = (i: number): void => {
      const s = live[i];
      if (s === undefined) return;
      onSuccess(store.openCursor(IDBKeyRange.bound([s.src, s.gen, 'live'], [s.src, s.gen, 'live', []])), (cursor) => {
        if (cursor === null) {
          next(i + 1);
          return;
        }
        for (const item of (cursor.value as { items: CatalogItem[] }).items) {
          const c = epgWantedChannel(item);
          if (c !== null) out.push(c);
        }
        cursor.continue();
      });
    };
    next(0);
  });
  const gens = sources.map((s) => `${s.src}:${s.gen}`).join(',');
  const basis = `v${EPG_INGEST_VERSION}|${tier}|${gens}|${overrides.length === 0 ? '-' : hash53Base36(JSON.stringify(overrides))}`;
  return { wanted: new EpgWantedSet(channels, overrides), basis, sources };
}

/** Writes buckets in batches and tracks the latest programme end. */
class BucketWriter {
  private pending: EpgBucket[] = [];
  /** UTC epoch minutes of the latest end written (`null`: nothing yet). */
  until: number | null = null;

  constructor(
    private readonly db: IDBDatabase,
    private readonly epgSrc: string,
    readonly gen: number,
    private readonly throttle: Throttle,
    private readonly token: CancelToken,
  ) {}

  async add(buckets: EpgBucket[], all = false): Promise<void> {
    for (const b of buckets) {
      this.pending.push(b);
      for (let i = 0; i < b.end.length; i++) if (this.until === null || b.end[i]! > this.until) this.until = b.end[i]!;
    }
    while (this.pending.length >= EPG_WRITE_BATCH || (all && this.pending.length > 0)) {
      await putEpgBuckets(this.db, this.epgSrc, this.gen, this.pending.splice(0, EPG_WRITE_BATCH));
      await this.throttle.checkpoint(this.token);
    }
  }
}

function summarize(reader: EpgGuideReader, tier: DeviceTier, nowMs: number): EpgSummary {
  const r = reader.report();
  const w = r.window ?? epgWindow(nowMs, tier, 0);
  return {
    wanted: r.match.wanted,
    matched: r.match.matched,
    byMethod: { ...r.match.byMethod },
    ambiguous: r.match.ambiguous,
    declared: r.match.declared,
    used: r.match.used,
    programmes: r.programmes.programmes,
    kept: r.programmes.kept,
    buckets: r.programmes.buckets,
    pastDays: w.pastDays,
    futureDays: w.futureDays,
  };
}

function channelTable(reader: EpgGuideReader, wanted: EpgWantedSet): EpgChannelTable {
  const shift = new Map<string, number>();
  for (const c of wanted.channels) shift.set(c.key, c.shiftHours);
  return {
    matches: reader.matcher.matches().map((m) => ({ key: m.key, channel: m.channel, method: m.method, ambiguous: m.ambiguous, shift: shift.get(m.key) ?? 0 })),
    channels: reader.matcher.usedChannels().map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    unmatched: reader.report().unmatched,
  };
}

/** The fallback zone of a guide's times without an offset. */
function fallbackZone(guide: EpgGuide, sources: readonly SourceMeta[]): number | ZoneOffset {
  const zone = guide.zone;
  if ('minutes' in zone) return zone.minutes;
  let server: SourceMeta['server'] = null;
  for (const s of sources) if (s.src === zone.panel) server = s.server ?? null;
  return panelZone(server ?? null).offset;
}

/** Reads one guide into a new generation and swaps it in. See the module comment. */
export async function runEpgIngest(
  guide: EpgGuide,
  job: Pick<EpgRefreshJob, 'tier' | 'languages' | 'force'> & { rank?: number },
  wanted: EpgWanted,
  options: EpgIngestOptions,
): Promise<EpgResult> {
  const { db, transport } = options;
  const epgSrc = guide.epgSrc;
  const rank = job.rank ?? 0;
  const token = options.token ?? NEVER;
  const throttle = options.throttle ?? new Throttle();
  const now = options.now ?? (() => Date.now());
  const started = now();
  throttle.reset();
  token.throwIfCancelled();

  await pruneEpgGenerations(db, epgSrc, { abandon: true });
  const meta = await getEpgMeta(db, epgSrc);
  const known = !job.force && meta !== null && meta.gen > 0 && meta.basis === wanted.basis && meta.fetch ? meta.fetch : null;
  const hasher = new Fnv1a();
  let unzip: MaybeGunzip | null = null;
  let writer: BucketWriter | null = null;
  let committed = false;
  let current: { cancel(): void } | null = null;
  const stopCancel = token.onCancel(() => current?.cancel());
  let total: number | null = null;
  let lastProgress = -Infinity;
  let kept = 0;

  const done = (status: EpgResult['status'], fields: Partial<EpgResult>): EpgResult => ({
    epgSrc,
    status,
    gen: meta ? meta.gen : 0,
    previous: meta ? meta.gen : 0,
    summary: meta && meta.summary ? meta.summary : null,
    fetch: null,
    gzipped: unzip !== null && unzip.gzipped === true,
    elapsedMs: now() - started,
    throttle: throttle.stats(),
    ...fields,
  });

  /** Nothing new: drop the past days the stored generation still has. */
  const unchanged = async (fields: Partial<EpgResult>, patch: { fetch?: FetchStamp }): Promise<EpgResult> => {
    const at = now();
    await markEpgChecked(db, epgSrc, at, { ...patch, rank });
    const pastDays = meta && meta.summary ? meta.summary.pastDays : EPG_WINDOWS[job.tier].maxPastDays;
    await pruneEpgDays(db, epgSrc, epgFirstDay(at, pastDays));
    return done('unchanged', fields);
  };

  try {
    if (wanted.wanted.size === 0) throw new IngestError('empty', null, 'There are no live channels to match a guide to');
    const headers: Record<string, string> = {};
    if (known?.etag) headers['If-None-Match'] = known.etag;
    if (known?.lastModified) headers['If-Modified-Since'] = known.lastModified;
    const res = await transport.get(guide.url, { headers });
    current = res;
    token.throwIfCancelled();
    if (res.status === 304 && Object.keys(headers).length > 0) {
      res.cancel();
      return await unchanged({}, {});
    }
    if (res.status < 200 || res.status >= 300) {
      res.cancel();
      throw new IngestError(res.status === 401 || res.status === 403 ? 'auth' : 'http', res.status);
    }
    const etag = res.header('etag');
    const lastModified = res.header('last-modified');
    total = headerNumber(res.header('content-length'));
    writer = new BucketWriter(db, epgSrc, await beginEpgGeneration(db, epgSrc, rank), throttle, token);
    unzip = new MaybeGunzip(
      tapBytes(res, (chunk) => hasher.update(chunk)),
      options.gunzip,
    );
    const text = decodeUtf8(unzip);
    current = text;
    const nowMs = now();
    const reader = new EpgGuideReader({
      epgSrc,
      wanted: wanted.wanted,
      tier: job.tier,
      nowMs,
      languages: job.languages,
      fallback: fallbackZone(guide, wanted.sources),
      flushAt: options.flushAt,
    });
    const progress = (force = false): void => {
      if (!options.onProgress) return;
      const t = now();
      if (!force && t - lastProgress < PROGRESS_EVERY_MS) return;
      lastProgress = t;
      options.onProgress({ epgSrc, bytes: hasher.bytes, total, kept });
    };
    for (let chunk = await text.read(); chunk !== null; chunk = await text.read()) {
      await writer.add(reader.push(chunk));
      kept = reader.stats.kept;
      progress();
    }
    // A cancel ends the read early: never commit what was cut short.
    token.throwIfCancelled();
    await writer.add(reader.end(), true);
    kept = reader.stats.kept;
    progress(true);

    const xmltv = reader.xmltvStats;
    if (xmltv.truncated) throw new IngestError('format', null, 'The guide was cut short');
    if (xmltv.channels === 0 && xmltv.programmes === 0) throw new IngestError('format', null, 'This is not an XMLTV guide');
    const stamp: FetchStamp = { v: EPG_INGEST_VERSION, hash: hasher.digest(), bytes: hasher.bytes, etag, lastModified };

    if (known && known.hash === stamp.hash && known.bytes === stamp.bytes) {
      const unused = writer.gen;
      writer = null;
      await abandonEpgGeneration(db, epgSrc, unused);
      return await unchanged({ fetch: stamp }, { fetch: stamp });
    }

    const gen = writer.gen;
    const summary = summarize(reader, job.tier, nowMs);
    await putEpgChannels(db, epgSrc, gen, channelTable(reader, wanted.wanted));
    const previous = await commitEpgGeneration(db, epgSrc, gen, now(), { fetch: stamp, basis: wanted.basis, until: writer.until, summary, rank });
    committed = true;
    options.onSwap?.({ epgSrc, gen, previous });
    // Best effort: a previous generation left behind is pruned by the next refresh.
    if (previous > 0 && previous !== gen) await deleteEpgGeneration(db, epgSrc, previous).catch(() => undefined);
    return done('committed', { gen, previous, summary, fetch: stamp });
  } catch (error) {
    if (writer && !committed) {
      const unused = writer.gen;
      await abandonEpgGeneration(db, epgSrc, unused).catch(() => undefined);
    }
    throw ingestError(error, token);
  } finally {
    stopCancel();
    current = null;
  }
}

/** Runs a whole EPG refresh: deletes unlisted guides, then reads the listed ones in order. */
export async function runEpgRefresh(job: EpgRefreshJob, options: EpgIngestOptions): Promise<EpgRefreshResult> {
  const { db } = options;
  const token = options.token ?? NEVER;
  const now = options.now ?? (() => Date.now());
  token.throwIfCancelled();
  const listed = job.guides.map((g) => g.epgSrc);
  const deleted: string[] = [];
  const reranked: string[] = [];
  for (const meta of await getEpgMetas(db)) {
    const rank = listed.indexOf(meta.epgSrc);
    if (rank !== -1) {
      if (meta.rank !== rank) {
        await setEpgRank(db, meta.epgSrc, rank);
        reranked.push(meta.epgSrc);
      }
      await pruneEpgGenerations(db, meta.epgSrc, { abandon: true });
      if (meta.summary) await pruneEpgDays(db, meta.epgSrc, epgFirstDay(now(), meta.summary.pastDays));
      continue;
    }
    await deleteEpgSource(db, meta.epgSrc);
    deleted.push(meta.epgSrc);
    options.onSwap?.({ epgSrc: meta.epgSrc, gen: 0, previous: meta.gen });
  }
  // Nothing to read (a guide was only removed or moved): the live items aren't read either.
  if (job.only !== undefined && job.only.length === 0) return { outcomes: [], deleted, reranked, wanted: 0 };
  const wanted = await readEpgWanted(db, job.tier, job.overrides);
  const outcomes: EpgOutcome[] = [];
  for (let rank = 0; rank < job.guides.length; rank++) {
    const guide = job.guides[rank]!;
    if (job.only && job.only.indexOf(guide.epgSrc) === -1) continue;
    try {
      const result = await runEpgIngest(guide, { tier: job.tier, languages: job.languages, force: job.force, rank }, wanted, options);
      outcomes.push({ epgSrc: guide.epgSrc, result, error: null });
    } catch (error) {
      if (error instanceof CancelError) throw error;
      const failure = error instanceof IngestError ? { code: error.code, status: error.status } : { code: 'failed' as const, status: null };
      await markEpgFailed(db, guide.epgSrc, now(), rank, failure).catch(() => undefined);
      outcomes.push({ epgSrc: guide.epgSrc, result: null, error: { ...failure, message: error instanceof Error ? error.message : String(error) } });
    }
  }
  return { outcomes, deleted, reranked, wanted: wanted.wanted.size };
}
