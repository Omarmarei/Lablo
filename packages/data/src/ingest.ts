/**
 * The catalog ingest (architecture.md §1.4 steps 3-10), as the ingest worker runs it: one source
 * per call, streamed from the network into a new catalog generation, then swapped in.
 *
 * 1. Leftovers of a refresh of this source that crashed or was killed are pruned first. Only one
 *    refresh per source may run at a time (a second one would supersede the first).
 * 2. Fetch: M3U sends the validators of the active generation (`If-None-Match`,
 *    `If-Modified-Since`); a 304 ends the refresh as `unchanged` before anything is written.
 *    Xtream logs in (the panel's zone is kept for catch-up), then streams each kind's
 *    categories and list.
 * 3. Bytes are hashed (FNV-1a) as downloaded, gunzipped when they start with `1f 8b`, decoded
 *    as UTF-8 in stream mode and parsed by core's streaming parsers.
 * 4. Items go through a chunker and search-index builder per kind; chunks are written about 10
 *    per transaction. Reading waits for each write, and the throttle pauses for the busy UI
 *    and runs the low-tier duty cycle between chunks and batches.
 * 5. Nothing at all parsed is an error (`empty`), never an empty catalog.
 * 6. Bytes identical to the active generation's (hash and length, same `INGEST_VERSION`): the
 *    new generation is dropped and the refresh ends as `unchanged`.
 * 7. Swap: one transaction makes the new generation active (`onSwap` then tells the query
 *    worker to reload). The favourites of the source are reconciled with it (favourites.ts),
 *    and the previous generation is deleted.
 *
 * Any failure before the swap (network, gzip, HTTP, cancel) abandons the new generation and
 * leaves the active one untouched; a crash leaves it untouched too, with the leftovers pruned
 * by the next refresh. Error messages never contain URLs (they carry credentials).
 */

import type { CatalogItem, ContentKind, M3uStats, TextTransport, XtreamAccount, XtreamListStats, XtreamServerInfo } from '@zoma/core';
import { CONTENT_KINDS, M3uCatalogParser, SearchIndexBuilder, SearchSegment, XtreamClient, XtreamError } from '@zoma/core';
import type { ByteResponse, ByteTransport, TextSource } from './bytes';
import { Fnv1a, NetworkError, decodeUtf8, tapBytes } from './bytes';
import type { FetchStamp } from './catalog-store';
import {
  GenerationError,
  abandonGeneration,
  beginGeneration,
  commitGeneration,
  deleteGeneration,
  getSource,
  markChecked,
  pruneGenerations,
  putCatalogKind,
  putChunks,
} from './catalog-store';
import type { CatalogChunk } from './chunker';
import { CatalogChunker, indexChunk } from './chunker';
import type { CatalogView, FavouriteReport } from './favourites';
import { FavouriteMatcher, reconcileFavourites } from './favourites';
import type { GunzipMode } from './gunzip';
import { GzipError, MaybeGunzip } from './gunzip';
import type { ProfileDoc } from './profile';
import { loadProfile, updateProfile } from './profile';
import type { CancelToken } from './rpc';
import { CancelError, NEVER } from './rpc';
import type { ThrottleStats } from './throttle';
import { Throttle } from './throttle';

/** Bump when parsing or the stored item shape changes: unchanged bytes are then re-ingested. */
export const INGEST_VERSION = 1;
/** Chunks per write transaction (about 5,000 items). */
export const WRITE_BATCH = 10;
const PROGRESS_EVERY_MS = 250;

export type IngestSource =
  | { type: 'm3u'; url: string }
  | {
      type: 'xtream';
      account: XtreamAccount;
      /** Kinds to load (default all). A kind left out is empty in the new generation. */
      kinds?: ContentKind[];
      liveExt?: 'ts' | 'm3u8';
    };

export interface IngestJob {
  /** Source id (ContentKeys and records are scoped by it). */
  src: string;
  source: IngestSource;
  /** Ignore validators and the byte hash: always build and commit a new generation. */
  force?: boolean;
}

export type IngestErrorCode = 'http' | 'auth' | 'network' | 'format' | 'empty' | 'superseded';

/** A refresh that failed; the active generation is unchanged. Never holds a URL. */
export class IngestError extends Error {
  constructor(
    readonly code: IngestErrorCode,
    readonly status: number | null = null,
    message?: string,
  ) {
    super(message ?? `Catalog refresh failed: ${code}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'IngestError';
  }
}

export interface IngestProgress {
  src: string;
  phase: 'download' | 'commit';
  /** Bytes received so far, over every request of this refresh. */
  bytes: number;
  /** `Content-Length` of the response being read, when the server sent one. */
  total: number | null;
  /** Items parsed so far. */
  items: number;
  /** Xtream: the list being read. */
  kind: ContentKind | null;
}

export interface IngestSwap {
  src: string;
  gen: number;
  previous: number;
  counts: Partial<Record<ContentKind, number>>;
}

export interface IngestResult {
  src: string;
  /** `committed`: a new generation is active. `unchanged`: the provider had nothing new. */
  status: 'committed' | 'unchanged';
  /** The active generation now. */
  gen: number;
  /** The generation it replaced (0: none; equal to `gen` when unchanged). */
  previous: number;
  /** Items per kind in the active generation. */
  counts: Partial<Record<ContentKind, number>>;
  /** The download (`null` when the server answered 304). */
  fetch: FetchStamp | null;
  gzipped: boolean;
  elapsedMs: number;
  m3u: { epgUrls: string[]; userAgents: string[]; looksLikeHls: boolean; stats: M3uStats } | null;
  xtream: { server: XtreamServerInfo | null; lists: Partial<Record<ContentKind, XtreamListStats>> } | null;
  /** What happened to the favourites (`null`: no profile, or unchanged catalog). */
  favourites: FavouriteReport | null;
  /** Why the favourites couldn't be updated (the swap still happened). */
  favouritesError: string | null;
  throttle: ThrottleStats;
}

export interface IngestOptions {
  db: IDBDatabase;
  transport: ByteTransport;
  /** Cancels the refresh (rejects with `CancelError`; the active generation stays). */
  token?: CancelToken;
  /** Busy pause and duty cycle (default: full speed). */
  throttle?: Throttle;
  now?: () => number;
  gunzip?: GunzipMode;
  chunkSize?: number;
  onProgress?: (progress: IngestProgress) => void;
  /** Right after the swap: the query worker should reload. */
  onSwap?: (swap: IngestSwap) => void;
}

class KindWriter {
  readonly chunker: CatalogChunker;
  readonly builder: SearchIndexBuilder;
  count = 0;
  finished = false;

  constructor(kind: ContentKind, src: string, gen: number, chunkSize?: number) {
    this.chunker = new CatalogChunker(kind, { chunkSize });
    this.builder = new SearchIndexBuilder(src, kind, gen);
  }

  push(item: CatalogItem): CatalogChunk[] {
    this.count++;
    const ready = this.chunker.push(item);
    for (const c of ready) indexChunk(this.builder, c);
    return ready;
  }

  end(): CatalogChunk[] {
    const ready = this.chunker.end();
    for (const c of ready) indexChunk(this.builder, c);
    return ready;
  }
}

/** Writes one generation: chunks in batches, then each kind's categories and search segment. */
class GenerationWriter {
  private readonly kinds = new Map<ContentKind, KindWriter>();
  private pending: CatalogChunk[] = [];
  readonly segments = new Map<ContentKind, SearchSegment>();
  items = 0;

  constructor(
    private readonly db: IDBDatabase,
    private readonly src: string,
    readonly gen: number,
    private readonly throttle: Throttle,
    private readonly token: CancelToken,
    private readonly chunkSize?: number,
  ) {}

  add(item: CatalogItem): void {
    let w = this.kinds.get(item.kind);
    if (!w) {
      w = new KindWriter(item.kind, this.src, this.gen, this.chunkSize);
      this.kinds.set(item.kind, w);
    }
    if (w.finished) throw new RangeError(`More ${item.kind} items after that kind was finished`);
    this.items++;
    for (const c of w.push(item)) this.pending.push(c);
  }

  /** Writes the full batches waiting (with `all`, every chunk waiting). */
  async flush(all = false): Promise<void> {
    while (this.pending.length >= WRITE_BATCH || (all && this.pending.length > 0)) {
      await putChunks(this.db, this.src, this.gen, this.pending.splice(0, WRITE_BATCH));
      await this.throttle.checkpoint(this.token);
    }
  }

  /** Writes a kind's last chunks, its categories and its search segment. */
  async finishKind(kind: ContentKind): Promise<void> {
    const w = this.kinds.get(kind);
    if (!w || w.finished) return;
    w.finished = true;
    for (const c of w.end()) this.pending.push(c);
    await this.flush(true);
    const data = w.builder.finish();
    await putCatalogKind(this.db, this.src, this.gen, kind, w.chunker.categories(), data);
    this.segments.set(kind, new SearchSegment(data));
  }

  async finish(): Promise<void> {
    for (const kind of CONTENT_KINDS) await this.finishKind(kind);
  }

  counts(): Partial<Record<ContentKind, number>> {
    const out: Partial<Record<ContentKind, number>> = {};
    for (const [kind, w] of this.kinds) if (w.count > 0) out[kind] = w.count;
    return out;
  }
}

function headerNumber(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** The error a failed refresh rejects with. */
function ingestError(error: unknown, token: CancelToken): Error {
  if (error instanceof CancelError) return error;
  if (token.cancelled) return new CancelError();
  if (error instanceof IngestError) return error;
  if (error instanceof XtreamError) return new IngestError(error.code, error.status);
  if (error instanceof NetworkError) return new IngestError('network', null, error.message);
  if (error instanceof GzipError) return new IngestError('format', null, error.message);
  if (error instanceof GenerationError) return new IngestError('superseded', null, 'Another refresh of this source took over');
  return error instanceof Error ? error : new Error(String(error));
}

/** Refreshes one source. See the module comment for the steps and guarantees. */
export async function runIngest(job: IngestJob, options: IngestOptions): Promise<IngestResult> {
  const { db, transport } = options;
  const src = job.src;
  const token = options.token ?? NEVER;
  const throttle = options.throttle ?? new Throttle();
  const now = options.now ?? (() => Date.now());
  const started = now();
  throttle.reset();
  token.throwIfCancelled();

  await pruneGenerations(db, src, { abandon: true });
  const meta = await getSource(db, src);
  const loaded = await loadProfile(db, { now: now() });
  const matcher = new FavouriteMatcher(src, loaded && !loaded.newer ? (loaded.doc as ProfileDoc).favourites : []);
  const known = !job.force && meta !== null && meta.gen > 0 && meta.fetch && meta.fetch.v === INGEST_VERSION ? meta.fetch : null;

  const hasher = new Fnv1a();
  let hashing = true;
  const unzips: MaybeGunzip[] = [];
  let current: { cancel(): void } | null = null;
  const stopCancel = token.onCancel(() => current?.cancel());
  let writer: GenerationWriter | null = null;
  let committed = false;
  let total: number | null = null;
  let kindNow: ContentKind | null = null;
  let lastProgress = -Infinity;

  const progress = (phase: IngestProgress['phase'], force = false): void => {
    if (!options.onProgress) return;
    const t = now();
    if (!force && t - lastProgress < PROGRESS_EVERY_MS) return;
    lastProgress = t;
    options.onProgress({ src, phase, bytes: hasher.bytes, total, items: writer ? writer.items : 0, kind: kindNow });
  };

  /** Hashing, gunzip and UTF-8 over a response. */
  const decode = (res: ByteResponse): TextSource => {
    total = headerNumber(res.header('content-length'));
    const unzip = new MaybeGunzip(
      tapBytes(res, (chunk) => {
        if (hashing) hasher.update(chunk);
      }),
      options.gunzip,
    );
    unzips.push(unzip);
    const text = decodeUtf8(unzip);
    current = text;
    return text;
  };

  const take = async (items: CatalogItem[]): Promise<void> => {
    for (const item of items) {
      matcher.see(item);
      writer!.add(item);
    }
    await writer!.flush();
    await throttle.checkpoint(token);
    progress('download');
  };

  const done = (status: IngestResult['status'], fields: Partial<IngestResult>): IngestResult => ({
    src,
    status,
    gen: meta ? meta.gen : 0,
    previous: meta ? meta.gen : 0,
    counts: meta ? { ...meta.counts } : {},
    fetch: null,
    gzipped: unzips.some((u) => u.gzipped === true),
    elapsedMs: now() - started,
    m3u: null,
    xtream: null,
    favourites: null,
    favouritesError: null,
    throttle: throttle.stats(),
    ...fields,
  });

  try {
    let etag: string | null = null;
    let lastModified: string | null = null;
    let m3u: IngestResult['m3u'] = null;
    let xtream: IngestResult['xtream'] = null;
    const source = job.source;

    if (source.type === 'm3u') {
      const headers: Record<string, string> = {};
      if (known?.etag) headers['If-None-Match'] = known.etag;
      if (known?.lastModified) headers['If-Modified-Since'] = known.lastModified;
      const res = await transport.get(source.url, { headers });
      current = res;
      token.throwIfCancelled();
      // Only an answer to our own validators means "unchanged".
      if (res.status === 304 && Object.keys(headers).length > 0) {
        res.cancel();
        await markChecked(db, src, now());
        return done('unchanged', {});
      }
      if (res.status < 200 || res.status >= 300) {
        res.cancel();
        throw new IngestError(res.status === 401 || res.status === 403 ? 'auth' : 'http', res.status);
      }
      etag = res.header('etag');
      lastModified = res.header('last-modified');
      writer = new GenerationWriter(db, src, await beginGeneration(db, src), throttle, token, options.chunkSize);
      const text = decode(res);
      const parser = new M3uCatalogParser(src);
      for (let chunk = await text.read(); chunk !== null; chunk = await text.read()) await take(parser.push(chunk));
      // A cancel ends the read early: never parse on (or commit) what was cut short.
      token.throwIfCancelled();
      await take(parser.end());
      const summary = parser.summary();
      m3u = { epgUrls: summary.epgUrls, userAgents: summary.userAgents, looksLikeHls: summary.looksLikeHls, stats: summary.stats };
    } else {
      const textTransport: TextTransport = {
        get: async (url) => {
          const res = await transport.get(url);
          current = res;
          if (token.cancelled) {
            res.cancel();
            throw new CancelError();
          }
          const text = decode(res);
          return { status: res.status, read: () => text.read(), cancel: () => text.cancel() };
        },
      };
      const client = new XtreamClient(source.account, textTransport, src);
      // The login answer carries the panel clock, which changes on every call: not hashed.
      hashing = false;
      const login = await client.login();
      hashing = true;
      token.throwIfCancelled();
      writer = new GenerationWriter(db, src, await beginGeneration(db, src), throttle, token, options.chunkSize);
      const lists: Partial<Record<ContentKind, XtreamListStats>> = {};
      for (const kind of source.kinds ?? CONTENT_KINDS) {
        kindNow = kind;
        const categories = new Map((await client.categories(kind)).map((c) => [c.id, c.name]));
        lists[kind] = await client.list(kind, (items) => take(items.map((i) => i.item)), { categories, liveExt: source.liveExt });
        token.throwIfCancelled();
        await writer.finishKind(kind);
      }
      xtream = { server: login.server, lists };
    }

    await writer.finish();
    token.throwIfCancelled();
    if (writer.items === 0) {
      throw new IngestError('empty', null, m3u?.looksLikeHls ? 'This is a single stream, not a playlist' : 'The source has no channels or videos');
    }
    const stamp: FetchStamp = { v: INGEST_VERSION, hash: hasher.digest(), bytes: hasher.bytes, etag, lastModified };
    const server = xtream ? xtream.server : null;

    if (known && known.hash === stamp.hash && known.bytes === stamp.bytes) {
      const unused = writer.gen;
      writer = null;
      await abandonGeneration(db, src, unused);
      await markChecked(db, src, now(), { fetch: stamp, server });
      return done('unchanged', { fetch: stamp, m3u, xtream });
    }

    progress('commit', true);
    const at = now();
    const counts = writer.counts();
    const gen = writer.gen;
    const previous = await commitGeneration(db, src, gen, counts, at, { fetch: stamp, checkedAt: at, server });
    committed = true;
    options.onSwap?.({ src, gen, previous, counts });

    let favourites: FavouriteReport | null = null;
    let favouritesError: string | null = null;
    const segments = writer.segments;
    const view: CatalogView = {
      has: (f) => matcher.saw(f.key) ?? (segments.get(f.kind)?.indexOfKey(f.key) ?? -1) !== -1,
      byName: (kind, normName) => matcher.byName(kind, normName),
      byEpgId: (kind, epgId) => matcher.byEpgId(kind, epgId),
    };
    const kinds = source.type === 'xtream' && source.kinds ? source.kinds : undefined;
    try {
      await updateProfile(
        db,
        (doc) => {
          const r = reconcileFavourites(doc.favourites, src, view, at, kinds);
          favourites = r.report;
          return r.report.changed ? { ...doc, favourites: r.favourites } : null;
        },
        { now: at },
      );
    } catch (error) {
      favourites = null;
      favouritesError = error instanceof Error ? error.message : String(error);
    }

    // Best effort too: a previous generation left behind is pruned by the next refresh.
    if (previous > 0 && previous !== gen) await deleteGeneration(db, src, previous).catch(() => undefined);
    return done('committed', { gen, previous, counts, fetch: stamp, m3u, xtream, favourites, favouritesError });
  } catch (error) {
    if (writer && !committed) {
      const unused = writer.gen;
      // Best effort: after a crash-like failure (the database is gone) the next refresh prunes it.
      await abandonGeneration(db, src, unused).catch(() => undefined);
    }
    throw ingestError(error, token);
  } finally {
    stopCancel();
    current = null;
  }
}
