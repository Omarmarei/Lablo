import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LoadedProfile, SourceMeta, SourceRecord } from '@lablo/data';
import type { Navigator, Screen, ScreenSpec, ZoneSpec } from '@lablo/ui';
import { SCREEN, fits } from '@lablo/ui';
import { sourceUrlOf } from '../data/engine';
import { ingestSourceOf, storedSources } from '../onboarding/engine-loader';
import { GUIDES, shownLink } from './guides-state';

/**
 * The sources screen (RELAY step 30c3a): the playlists and panels the user added, opened by the
 * settings screen's "Sources" row and pushed on the live navigator.
 *
 *   header   ("Add from your phone", step 31c2a: the pairing screen; only when the app can pair)
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
  readonly type: SourceRecord['type'];
  /** The server as shown: its host and port, nothing else (a file from the phone has none: empty). */
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
  /**
   * The header's "Add from your phone" (step 31c2a). The list keeps the first focus; an empty
   * list gives it to the button. Without it the screen has no header.
   */
  readonly addFromPhone?: () => void;
}

export interface SourcesList {
  readonly status: ReadonlySignal<SourcesStatus>;
  readonly rows: ReadonlySignal<readonly SourceRow[]>;
  /** Data requests in flight (0: the screen is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** The screen has the header's "Add from your phone" (step 31c2a). */
  readonly canAdd: boolean;
  /** Opens the screen and reads the sources. */
  open(): void;
  /** Reads the sources again while the screen is open (a source was added): the focus stays. */
  reload(): void;
  dispose(): void;
}

/** A source's server as the screen shows it: the host and port of its link, nothing else. */
export function shownHost(url: string): string {
  const link = shownLink(url);
  const slash = link.indexOf('/');
  return slash === -1 ? link : link.slice(0, slash);
}

/** A stored source's link or server (`''` for a file from the phone, which has none). */
function linkOf(record: SourceRecord): string {
  const source = ingestSourceOf(record);
  return source === null ? '' : sourceUrlOf(source);
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
      // A file from the phone: no link, no server shown (`shownHost('')` is empty).
      host: shownHost(linkOf(record)),
      checkedAt: meta !== null && meta.gen > 0 ? checkedAt : null,
      // A file has no server to block (its URL is empty; its streams are checked as they play).
      blocked: record.type !== 'm3u-file' && blocked[i] === true,
    });
  }
  return rows;
}

/** The header's one button (step 31c2a). */
const HEADER_ZONE: ZoneSpec = { kind: 'list', id: 'header', axis: 'horizontal', count: 1, neighbours: { down: 'sources' } };

function sourcesZone(count: number, header: boolean): ZoneSpec {
  return header
    ? { kind: 'list', id: 'sources', axis: 'vertical', count, visible: SOURCES_VISIBLE, neighbours: { up: 'header' } }
    : { kind: 'list', id: 'sources', axis: 'vertical', count, visible: SOURCES_VISIBLE };
}

export function createSourcesList(options: SourcesOptions): SourcesList {
  const { nav, engine } = options;
  const header = options.addFromPhone !== undefined;
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
        // A file from the phone has no server: an empty URL, never blocked (its streams are checked as they play).
        const urls = storedSources(profile).map((record) => linkOf(record));
        // An unknown blocklist blocks nothing (as the data engine reads it).
        const asked = track(() => engine.blocked(urls)).catch((error: unknown): boolean[] => {
          console.warn('The blocklist could not be read', error);
          return [];
        });
        return asked.then((blocked) => {
          if (!current()) return;
          rows.value = sourceRows(profile, metas, blocked);
          status.value = 'ready';
          // (A closed screen ignores updates and focus moves.)
          screen?.update(sourcesZone(rows.value.length, header));
          if (header && rows.value.length === 0) screen?.focus('header', 0);
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
    canAdd: header,
    open(): void {
      if (disposed) return;
      openSeq += 1;
      status.value = 'loading';
      rows.value = [];
      const spec: ScreenSpec = header
        ? {
            id: SOURCES_SCREEN,
            zones: [HEADER_ZONE, sourcesZone(0, true)],
            initial: 'sources',
            onSelect: (focus) => {
              if (focus.zone === 'header') options.addFromPhone?.();
            },
          }
        : { id: SOURCES_SCREEN, zones: [sourcesZone(0, false)] };
      screen = nav.push(spec);
      read(openSeq);
    },
    reload(): void {
      if (disposed || screen === null || !screen.open) return;
      openSeq += 1;
      read(openSeq);
    },
    dispose(): void {
      disposed = true;
    },
  };
}
