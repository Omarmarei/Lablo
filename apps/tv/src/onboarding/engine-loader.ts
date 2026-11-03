import type { ContentKind, DeviceTier } from '@zoma/core';
import type { EpgCatalogSource, EpgProgress, IngestProgress, IngestResult, IngestSource, LoadedProfile, ProfileEdit, SourceRecord, UserGuide } from '@zoma/data';
// The client entry only: the package index would pull every data module's polyfills into main.
import { CancelSource } from '@zoma/data/client';
import type { EpgRefreshOptions, RefreshOptions } from '../data/engine';
import type { SourceDraft } from './form';
import type { LoadErrorCode, LoadHandle, LoadProgress, LoadResult, SourceLoader } from './loader';
import { LoadError } from './loader';

/**
 * Onboarding's loader on the data engine (RELAY step 13b): the new source goes through the
 * ingest worker, its guides through the EPG worker, and it is saved in the profile.
 *
 * 1. `checking`: the source gets its id (`nextSourceId`). An Xtream login is checked first by
 *    the ingest itself: a refused login is `auth`, and an expired, banned or disabled account
 *    (`user_info.status`) is `expired` or `blocked`, before any list is read.
 * 2. `download`, `saving`: the catalog refresh's progress (`IngestProgress`: download, commit).
 * 3. `guide`: the guides of the playlist or panel, and the guide link typed in the form (a
 *    `UserGuide`), read through `refreshEpg` with `due`. A guide that fails doesn't fail the
 *    source: the EPG refresh keeps its failure and retries it later (step 9b).
 * 4. The source goes into the profile (the login with it, in IndexedDB only until step 32
 *    encrypts it), then the counts.
 *
 * Cancel stops the running refresh in its worker; the load then never settles. A new load waits
 * for the cancelled one to let go of the refresh slot.
 */

/** What the loader needs from the data engine (a `DataEngine` fits; unit tests pass a fake). */
export interface LoaderEngine {
  refresh(job: { src: string; source: IngestSource }, options: RefreshOptions): Promise<IngestResult>;
  refreshEpg(catalogs: readonly EpgCatalogSource[], options: EpgRefreshOptions): Promise<unknown>;
  sourceIds(): Promise<string[]>;
  profile(): Promise<LoadedProfile | null>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

export interface EngineLoaderOptions {
  readonly engine: LoaderEngine;
  /** The TV's tier: a low-tier TV refreshes at the 50/50 duty cycle and keeps less guide. */
  readonly tier: () => Promise<DeviceTier>;
  /** UI languages, most preferred first (the guides' titles are picked by them). */
  readonly languages: () => string[];
  readonly now?: () => number;
}

const SOURCE_NUMBER = /^s(\d{1,9})$/;

/**
 * The next source id: `s1`, `s2`… one past the highest used, so an id is never reused, even one
 * whose catalog a crash left without a profile entry. Short on purpose: every ContentKey and
 * stored record carries it (`x:s1:live:123`, ADR-009).
 */
export function nextSourceId(taken: readonly string[]): string {
  let highest = 0;
  for (const id of taken) {
    const match = SOURCE_NUMBER.exec(id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return `s${highest + 1}`;
}

/** The stored sources of a profile, whatever its version wrote (`[]` when it has none). */
export function storedSources(profile: LoadedProfile | null): SourceRecord[] {
  const sources = profile === null ? null : (profile.doc as { sources?: unknown }).sources;
  return Array.isArray(sources) ? (sources as SourceRecord[]) : [];
}

const PASSED_ON: readonly LoadErrorCode[] = ['auth', 'expired', 'blocked', 'network', 'format', 'empty'];

/**
 * A failed load's `LoadError`, from the ingest's code (an `RpcError` from the worker carries it,
 * and the HTTP status for `http`). `superseded` (another refresh of the source took over), a
 * worker that died and anything unknown are `other`.
 */
export function loadError(error: unknown): LoadError {
  if (error instanceof LoadError) return error;
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  if (code === 'http') return new LoadError('http', typeof status === 'number' ? status : null);
  for (const known of PASSED_ON) if (known === code) return new LoadError(known);
  return new LoadError('other');
}

function count(counts: Partial<Record<ContentKind, number>>, kind: ContentKind): number {
  return counts[kind] ?? 0;
}

function catalogOf(record: SourceRecord): EpgCatalogSource {
  return record.type === 'xtream' ? { src: record.id, type: 'xtream', account: record.account } : { src: record.id, type: 'm3u' };
}

function guidesOf(records: readonly SourceRecord[]): UserGuide[] {
  const out: UserGuide[] = [];
  for (const r of records) if (r.epgUrl !== null) out.push({ id: r.id, url: r.epgUrl });
  return out;
}

export function createEngineLoader(options: EngineLoaderOptions): SourceLoader {
  const { engine } = options;
  const now = options.now ?? (() => Date.now());
  /** The last load's run, settled either way: the next one waits for its refresh slot. */
  let previous: Promise<unknown> = Promise.resolve();

  const run = async (draft: SourceDraft, cancel: CancelSource, report: (progress: LoadProgress) => void): Promise<LoadResult> => {
    cancel.token.throwIfCancelled();
    report({ phase: 'checking', bytes: 0, total: null, items: 0 });
    const [profile, catalog, tier] = await Promise.all([engine.profile(), engine.sourceIds(), options.tier()]);
    cancel.token.throwIfCancelled();
    const stored = storedSources(profile);
    const id = nextSourceId(stored.map((s) => s.id).concat(catalog));
    const record: SourceRecord =
      draft.type === 'xtream'
        ? { id, type: 'xtream', name: draft.name, account: draft.account, epgUrl: draft.epgUrl, added: now() }
        : { id, type: 'm3u', name: draft.name, url: draft.url, epgUrl: draft.epgUrl, added: now() };
    const source: IngestSource = record.type === 'xtream' ? { type: 'xtream', account: record.account } : { type: 'm3u', url: record.url };

    const result = await engine.refresh(
      { src: id, source },
      {
        lowTier: tier === 'low',
        cancel: cancel.token,
        onProgress: (p: IngestProgress) => report({ phase: p.phase === 'commit' ? 'saving' : 'download', bytes: p.bytes, total: p.total, items: p.items }),
      },
    );
    const counts: LoadResult = { live: count(result.counts, 'live'), movies: count(result.counts, 'movie'), series: count(result.counts, 'series') };
    const items = counts.live + counts.movies + counts.series;

    // Every source's guides are listed (a guide no longer listed would be deleted); `due` reads
    // the new ones, and the others only when they are due anyway.
    const all = stored.filter((s) => s.id !== id).concat([record]);
    report({ phase: 'guide', bytes: 0, total: null, items });
    try {
      await engine.refreshEpg(all.map(catalogOf), {
        tier,
        user: guidesOf(all),
        languages: options.languages(),
        due: true,
        cancel: cancel.token,
        onProgress: (p: EpgProgress) => report({ phase: 'guide', bytes: p.bytes, total: p.total, items }),
      });
    } catch {
      // The guide is extra: the source is in without it, and the next EPG refresh tries again.
      cancel.token.throwIfCancelled();
    }
    cancel.token.throwIfCancelled();
    await engine.editProfile({ kind: 'source', source: record });
    return counts;
  };

  return {
    start(draft: SourceDraft, onProgress: (progress: LoadProgress) => void): LoadHandle {
      const cancel = new CancelSource();
      let cancelled = false;
      const report = (progress: LoadProgress): void => {
        if (!cancelled) onProgress(progress);
      };
      const ran = previous.then(() => run(draft, cancel, report));
      previous = ran.catch(() => undefined);
      const done = new Promise<LoadResult>((resolve, reject) => {
        ran.then(
          (result) => {
            if (!cancelled) resolve(result);
          },
          (error: unknown) => {
            if (!cancelled) reject(loadError(error));
          },
        );
      });
      return {
        done,
        cancel: () => {
          cancelled = true;
          cancel.cancel();
        },
      };
    },
  };
}
