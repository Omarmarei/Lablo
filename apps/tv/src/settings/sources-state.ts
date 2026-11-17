import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LoadedProfile, SourceMeta } from '@lablo/data';
import type { Navigator, Screen, ZoneSpec } from '@lablo/ui';
import { SCREEN, fits } from '@lablo/ui';
import { sourceUrlOf } from '../data/engine';
import { ingestSourceOf, storedSources } from '../onboarding/engine-loader';
import { GUIDES, shownLink } from './guides-state';

/**
 * The sources screen (RELAY step 30c3a): the playlists and panels the user added, opened by the
 * settings screen's "Sources" row and pushed on the live navigator.
 *
 *   sources  (one row per stored source, in the profile's order: its name, its kind and server,
 *             and when its catalog was last updated; no actions yet)
 *
 * - **Reads,** when it opens: the profile (the sources, their names and their links), every
 *   catalog's record (`sourceStatus`: when it was last checked), then the signed config's
 *   blocklist for each source's server (`blocked`). A source on a blocked server isn't updated
 *   (the data engine refuses its refresh), and its row says so.
 * - **The server** shown is the host (and port) only: never the login, the path or the query
 *   (an M3U link may carry the login in either).
 * - Back closes it (the navigator's own Back).
 */

export const SOURCES_SCREEN = 'sources';

/** Under the header and its line, as on the guides screen; a source's row is a guide's. */
export const SOURCES_BODY = SCREEN.height - 2 * SCREEN.safeY - GUIDES.headerHeight - GUIDES.headerGap - GUIDES.introHeight;
export const SOURCES_VISIBLE = fits(SOURCES_BODY, GUIDES.rowHeight, GUIDES.rowGap);

/** One row of the sources screen. */
export interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly type: 'xtream' | 'm3u';
  /** The server as shown: its host and port, nothing else. */
  readonly host: string;
  /** When its catalog was last checked (`checkedAt`, else `updatedAt`; `null`: never). */
  readonly checkedAt: number | null;
  /** Its server is on the signed config's blocklist: it isn't updated. */
  readonly blocked: boolean;
}

export type SourcesStatus = 'loading' | 'ready' | 'failed';

/** What the screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface SourcesEngine {
  profile(): Promise<LoadedProfile | null>;
  sourceStatus(): Promise<SourceMeta[]>;
  blocked(urls: string[]): Promise<boolean[]>;
}

export interface SourcesOptions {
  readonly nav: Navigator;
  readonly engine: SourcesEngine;
}

export interface SourcesList {
  readonly status: ReadonlySignal<SourcesStatus>;
  readonly rows: ReadonlySignal<readonly SourceRow[]>;
  /** Data requests in flight (0: the screen is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** Opens the screen and reads the sources. */
  open(): void;
  dispose(): void;
}

/** A source's server as the screen shows it: the host and port of its link, nothing else. */
export function shownHost(url: string): string {
  const link = shownLink(url);
  const slash = link.indexOf('/');
  return slash === -1 ? link : link.slice(0, slash);
}

/** The rows, in the profile's order; `blocked[i]` is the i-th source's answer (missing: not blocked). */
export function sourceRows(profile: LoadedProfile | null, metas: readonly SourceMeta[], blocked: readonly boolean[]): SourceRow[] {
  const rows: SourceRow[] = [];
  const records = storedSources(profile);
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    let meta: SourceMeta | null = null;
    for (let m = 0; m < metas.length; m += 1) if (metas[m]!.src === record.id) meta = metas[m]!;
    const checkedAt = meta === null ? null : (meta.checkedAt ?? meta.updatedAt);
    rows.push({
      id: record.id,
      name: record.name,
      type: record.type,
      host: shownHost(sourceUrlOf(ingestSourceOf(record))),
      checkedAt: meta !== null && meta.gen > 0 ? checkedAt : null,
      blocked: blocked[i] === true,
    });
  }
  return rows;
}

function sourcesZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'sources', axis: 'vertical', count, visible: SOURCES_VISIBLE };
}

export function createSourcesList(options: SourcesOptions): SourcesList {
  const { nav, engine } = options;
  const status = signal<SourcesStatus>('loading');
  const rows = signal<readonly SourceRow[]>([]);
  const pending = signal(0);
  let screen: Screen | null = null;
  let disposed = false;
  /** Bumps on each opening: an older opening's answer is dropped. */
  let openSeq = 0;

  /** Runs `request`, counting it in `pending` until it settles either way. */
  function track<T>(request: () => Promise<T>): Promise<T> {
    pending.value += 1;
    let running: Promise<T>;
    try {
      running = request();
    } catch (error) {
      running = Promise.reject(error);
    }
    const done = (): void => {
      pending.value -= 1;
    };
    running.then(done, done);
    return running;
  }

  const read = (seq: number): void => {
    const current = (): boolean => !disposed && seq === openSeq;
    track(() => Promise.all([engine.profile(), engine.sourceStatus()]))
      .then((both) => {
        if (!current()) return null;
        const profile = both[0];
        const metas = both[1];
        const urls = storedSources(profile).map((record) => sourceUrlOf(ingestSourceOf(record)));
        // An unknown blocklist blocks nothing (as the data engine reads it).
        const asked = track(() => engine.blocked(urls)).catch((error: unknown): boolean[] => {
          console.warn('The blocklist could not be read', error);
          return [];
        });
        return asked.then((blocked) => {
          if (!current()) return;
          rows.value = sourceRows(profile, metas, blocked);
          status.value = 'ready';
          screen?.update(sourcesZone(rows.value.length));
        });
      })
      .catch((error: unknown) => {
        if (!current()) return;
        console.warn('The sources could not be read', error);
        status.value = 'failed';
      });
  };

  return {
    status,
    rows,
    pending,
    open(): void {
      if (disposed) return;
      openSeq += 1;
      status.value = 'loading';
      rows.value = [];
      screen = nav.push({ id: SOURCES_SCREEN, zones: [sourcesZone(0)] });
      read(openSeq);
    },
    dispose(): void {
      disposed = true;
    },
  };
}
