import type { ContentKind, DeviceTier } from '@lablo/core';
import { xtreamFromM3uUrl } from '@lablo/core';
import type { EpgCatalogSource, EpgProgress, IngestProgress, IngestResult, IngestSource, LinkSource, LinkWithoutLogin, LoadedProfile, ProfileEdit, SourceRecord, StoredGuide, StoredSource, UserGuide } from '@lablo/data';
import type { FileFeed } from '@lablo/data/client';
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
 *    An M3U link that is an Xtream link (`xtreamFromM3uUrl`: `get.php?username=…&password=…`)
 *    is read through the panel's API first, and saved as an Xtream source when that works (step
 *    37a: categories, details, shows and catch-up). When it fails for any reason but the account
 *    (`expired`, `blocked`) or a blocked server (`blocklisted`), the link is read as the playlist
 *    it was given as, and saved as one; the progress starts again for it. Only a source being
 *    added is upgraded: a stored one keeps its type, and with it its ContentKeys.
 * 3. `guide`: the guides of the playlist or panel, and the guide links typed in the form or sent
 *    from the phone (`UserGuide`s named after the source, after the user's guides already listed: step 31c2a), read through
 *    `refreshEpg` with `due`. A guide that fails doesn't fail the source: the EPG refresh keeps
 *    its failure and retries it later (step 9b).
 * 4. The source goes into the profile (the login with it, in IndexedDB only and unencrypted:
 *    ADR-013), then the typed guides into the guide list (step 22b), then the counts.
 *
 * The phone's M3U file (step 31d2b1) has no link: the draft's `file()` fetches its frames in the
 * pair worker once the refresh slot is free, and the refresh reads them (`RefreshOptions.file`).
 * The slot is waited for again after it (normally no wait), so the refresh claims it with nothing
 * awaited in between. A file sent again under the name of a stored file source loads under that
 * source's id (its favourites and places carry over); its new guide links get `g<n>` ids, as the
 * guides screen gives (`<id>`, `<id>-2`… may name a removed guide whose records are still stored).
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
  /** The stored guides (a file sent again names its new guides past their ids). */
  epgStatus(): Promise<{ readonly guides: readonly { readonly epgSrc: string }[] }>;
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

const GUIDE_NUMBER = /^g(\d{1,9})$/;

/** The next id of a guide given on its own: `g1`, `g2`… one past the highest `g` id in `taken`. */
export function nextGuideId(taken: readonly string[]): string {
  let highest = 0;
  for (const id of taken) {
    const match = GUIDE_NUMBER.exec(id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return `g${highest + 1}`;
}

const USER_PREFIX = 'u~';

/** The guide ids a user guide's stored records are under (`u~<id>`), from the EPG's status. */
export function storedGuideIds(guides: readonly { readonly epgSrc: string }[]): string[] {
  const ids: string[] = [];
  for (const meta of guides) if (meta.epgSrc.indexOf(USER_PREFIX) === 0) ids.push(meta.epgSrc.slice(USER_PREFIX.length));
  return ids;
}

/** The stored sources of a profile, whatever its version wrote (`[]` when it has none): some without their login (step 32d4a). */
export function storedSources(profile: LoadedProfile | null): StoredSource[] {
  const sources = profile === null ? null : (profile.doc as { sources?: unknown }).sources;
  return Array.isArray(sources) ? (sources as StoredSource[]) : [];
}

const PASSED_ON: readonly LoadErrorCode[] = ['auth', 'expired', 'blocked', 'blocklisted', 'network', 'format', 'empty', 'file'];

/**
 * Whether an upgrade's failed Xtream read (step 37a) goes on to the link as a playlist: yes,
 * unless the panel said the account is expired or blocked (its playlist refuses such an account
 * too, and the panel's reason is the better answer) or the server is on the blocklist.
 */
export function triesPlaylist(error: unknown): boolean {
  const code = loadError(error).code;
  return code !== 'expired' && code !== 'blocked' && code !== 'blocklisted';
}

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

/**
 * A stored source as the guides need it (its Xtream login brings the panel's guide, none without
 * it; a playlist's header names its own, a file's too).
 */
export function catalogOf(record: StoredSource): EpgCatalogSource {
  return record.type === 'xtream' ? { src: record.id, type: 'xtream', account: record.account } : { src: record.id, type: 'm3u' };
}

/**
 * A stored source as its catalog refresh reads it; `null` for a file from the phone, which has no
 * link (never refreshed by itself). A source without its login (step 32d4a) gives what it kept,
 * which the data engine refuses (`needs-login`).
 */
export function ingestSourceOf(record: SourceRecord): LinkSource | null;
export function ingestSourceOf(record: StoredSource): LinkSource | LinkWithoutLogin | null;
export function ingestSourceOf(record: StoredSource): LinkSource | LinkWithoutLogin | null {
  if (record.type === 'm3u-file') return null;
  if (record.type === 'xtream') return record.account === null ? { type: 'xtream', account: null, base: record.base } : { type: 'xtream', account: record.account };
  return record.url === null ? { type: 'm3u', url: null, origin: record.origin } : { type: 'm3u', url: record.url };
}

/** A stored source a backup made without logins brought back (step 32d4a): it needs its login or link again (step 32d4b). */
export function needsLogin(record: StoredSource): boolean {
  return (record.type === 'xtream' && record.account === null) || (record.type === 'm3u' && record.url === null);
}

/** The stored file source named `name`, which a file sent again replaces (`null`: none). */
export function sameFile(stored: readonly StoredSource[], name: string): SourceRecord | null {
  for (const record of stored) if (record.type === 'm3u-file' && record.name === name) return record;
  return null;
}

/** The user's guides of a profile, in the user's order (`[]` when it has none; step 22b): some without their link (step 32d4a). */
export function userGuides(profile: LoadedProfile | null): StoredGuide[] {
  const guides = profile === null ? null : (profile.doc as { guides?: unknown }).guides;
  return Array.isArray(guides) ? (guides as StoredGuide[]) : [];
}

/**
 * The guide links given with a new source, as guides named after the source: `<id>`, then
 * `<id>-2`, `<id>-3`, `<id>-4` by place in `urls` (source ids are never reused, so neither are
 * these). A link the list has already, or given twice, is left out.
 */
export function typedGuides(id: string, urls: readonly string[], listed: readonly StoredGuide[]): UserGuide[] {
  const guides: UserGuide[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!;
    if (listed.some((g) => g.url === url) || guides.some((g) => g.url === url)) continue;
    guides.push({ id: i === 0 ? id : `${id}-${i + 1}`, url });
  }
  return guides;
}

/**
 * The guide links given with a file sent again, as guides of their own: `g<n>` ids past every id
 * listed or in `taken` (the stored guides'), one by one. A link the list has already, or given
 * twice, is left out.
 */
export function freshGuides(urls: readonly string[], listed: readonly StoredGuide[], taken: readonly string[]): UserGuide[] {
  const ids = listed.map((g) => g.id).concat(taken);
  const guides: UserGuide[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!;
    if (listed.some((g) => g.url === url) || guides.some((g) => g.url === url)) continue;
    const id = nextGuideId(ids);
    ids.push(id);
    guides.push({ id, url });
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
    // A file sent again under a stored file source's name replaces it, under its id.
    const same = draft.type === 'm3u-file' ? sameFile(stored, draft.name) : null;
    const id = same !== null ? same.id : nextSourceId(stored.map((s) => s.id).concat(catalog));
    // An Xtream link given as a playlist: its panel's API first (step 37a).
    const account = draft.type === 'm3u' ? xtreamFromM3uUrl(draft.url) : null;
    let record: SourceRecord =
      draft.type === 'xtream'
        ? { id, type: 'xtream', name: draft.name, account: draft.account, added: now() }
        : draft.type === 'm3u'
          ? { id, type: 'm3u', name: draft.name, url: draft.url, added: now() }
          : { id, type: 'm3u-file', name: draft.name, added: same !== null ? same.added : now() };
    const listed = userGuides(profile);
    let guides: UserGuide[];
    if (same === null) guides = typedGuides(id, draft.epgUrls, listed);
    else {
      const status = await engine.epgStatus();
      cancel.token.throwIfCancelled();
      guides = freshGuides(draft.epgUrls, listed, storedGuideIds(status.guides));
    }
    const source: IngestSource = ingestSourceOf(record) ?? { type: 'm3u-file' };
    const refreshOptions: RefreshOptions = {
      lowTier: tier === 'low',
      cancel: cancel.token,
      onProgress: (p: IngestProgress) => report({ phase: p.phase === 'commit' ? 'saving' : 'download', bytes: p.bytes, total: p.total, items: p.items }),
    };

    // Nothing awaits between the slot's check and the refresh, which claims it at once.
    await slotFree(cancel);
    if (draft.type === 'm3u-file') {
      // The file's frames once the slot is free (its download held no longer than needed), then
      // the slot again: the feed's two requests took time.
      const feed: FileFeed = await draft.file();
      cancel.token.throwIfCancelled();
      refreshOptions.file = feed;
      await slotFree(cancel);
    }
    let result: IngestResult | null = null;
    if (account !== null) {
      try {
        result = await engine.refresh({ src: id, source: { type: 'xtream', account, upgrade: true } }, refreshOptions);
        record = { id, type: 'xtream', name: draft.name, account, added: record.added };
      } catch (error) {
        cancel.token.throwIfCancelled();
        if (!triesPlaylist(error)) throw error;
        await slotFree(cancel);
      }
    }
    if (result === null) result = await engine.refresh({ src: id, source }, refreshOptions);
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
