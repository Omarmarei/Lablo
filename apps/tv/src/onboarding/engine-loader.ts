import type { ContentKind, DeviceTier } from '@lablo/core';
import type { EpgCatalogSource, EpgProgress, IngestProgress, IngestResult, IngestSource, LinkSource, LoadedProfile, ProfileEdit, SourceRecord, UserGuide } from '@lablo/data';
// The client entry only: the package index would pull every data module's polyfills into main.
import { CancelSource } from '@lablo/data/client';
import type { EpgRefreshOptions, RefreshOptions } from '../data/engine';
import type { SourceDraft } from './form';
import type { LoadErrorCode, LoadHandle, LoadProgress, LoadResult, SourceLoader } from './loader';
import { LoadError } from './loader';

/**
 * Onboarding's loader on the data engine (RELAY step 13b): the new source goes through the
 * ingest worker, its guides through the EPG worker, and it is saved in the profile.
 *
 * 1. `checking`: the source gets its id (`nextSourceId`). The data engine refuses a source whose
 *    server is on the signed config's blocklist (`blocklisted`, step 30c3a) before any worker
 *    starts. An Xtream login is checked first by the ingest itself: a refused login is `auth`,
 *    and an expired, banned or disabled account (`user_info.status`) is `expired` or `blocked`,
 *    before any list is read.
 * 2. `download`, `saving`: the catalog refresh's progress (`IngestProgress`: download, commit).
 * 3. `guide`: the guides of the playlist or panel, and the guide links typed in the form or sent
 *    from the phone (`UserGuide`s named after the source, after the user's guides already listed: step 31c2a), read through
 *    `refreshEpg` with `due`. A guide that fails doesn't fail the source: the EPG refresh keeps
 *    its failure and retries it later (step 9b).
 * 4. The source goes into the profile (the login with it, in IndexedDB only until step 32
 *    encrypts it), then the typed guides into the guide list (step 22b), then the counts.
 *
 * Cancel stops the running refresh in its worker; the load then never settles. A new load waits
 * for the cancelled one to let go of the refresh slot, and for any other refresh holding it (a
 * background refresh while a source is added from Settings, step 31c2a): `refreshing`, checked
 * every `SLOT_WAIT_MS`, right before each refresh is asked for.
 */

/** What the loader needs from the data engine (a `DataEngine` fits; unit tests pass a fake). */
export interface LoaderEngine {
  /** A refresh holds the data engine's one slot (another would be refused). Absent: never waited for. */
  readonly refreshing?: boolean;
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
  /** Waits `ms` (the slot's wait; default `setTimeout`). */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** How often a load waiting for the refresh slot looks again. */
export const SLOT_WAIT_MS = 500;

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

const PASSED_ON: readonly LoadErrorCode[] = ['auth', 'expired', 'blocked', 'blocklisted', 'network', 'format', 'empty'];

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

/** A stored source as the guides need it (its Xtream login brings the panel's guide). */
export function catalogOf(record: SourceRecord): EpgCatalogSource {
  return record.type === 'xtream' ? { src: record.id, type: 'xtream', account: record.account } : { src: record.id, type: 'm3u' };
}

/** A stored source as its catalog refresh reads it. */
export function ingestSourceOf(record: SourceRecord): LinkSource {
  return record.type === 'xtream' ? { type: 'xtream', account: record.account } : { type: 'm3u', url: record.url };
}

/** The user's guides of a profile, in the user's order (`[]` when it has none; step 22b). */
export function userGuides(profile: LoadedProfile | null): UserGuide[] {
  const guides = profile === null ? null : (profile.doc as { guides?: unknown }).guides;
  return Array.isArray(guides) ? (guides as UserGuide[]) : [];
}

/**
 * The guide links given with a new source, as guides named after the source: `<id>`, then
 * `<id>-2`, `<id>-3`, `<id>-4` by place in `urls` (source ids are never reused, so neither are
 * these). A link the list has already, or given twice, is left out.
 */
export function typedGuides(id: string, urls: readonly string[], listed: readonly UserGuide[]): UserGuide[] {
  const guides: UserGuide[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!;
    if (listed.some((g) => g.url === url) || guides.some((g) => g.url === url)) continue;
    guides.push({ id: i === 0 ? id : `${id}-${i + 1}`, url });
  }
  return guides;
}

export function createEngineLoader(options: EngineLoaderOptions): SourceLoader {
  const { engine } = options;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** Resolves once no refresh holds the slot; rejects when the load is cancelled meanwhile. */
  const slotFree = async (cancel: CancelSource): Promise<void> => {
    while (engine.refreshing === true) {
      await sleep(SLOT_WAIT_MS);
      cancel.token.throwIfCancelled();
    }
  };
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
        ? { id, type: 'xtream', name: draft.name, account: draft.account, added: now() }
        : { id, type: 'm3u', name: draft.name, url: draft.url, added: now() };
    const listed = userGuides(profile);
    const guides = typedGuides(id, draft.epgUrls, listed);
    const source = ingestSourceOf(record);

    // Nothing awaits between the slot's check and the refresh, which claims it at once.
    await slotFree(cancel);
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
      await slotFree(cancel);
      await engine.refreshEpg(all.map(catalogOf), {
        tier,
        user: listed.concat(guides),
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
    for (let i = 0; i < guides.length; i += 1) await engine.editProfile({ kind: 'guide', change: { op: 'add', guide: guides[i]! } });
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
