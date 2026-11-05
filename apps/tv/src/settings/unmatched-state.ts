import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LoadedProfile, SourceRecord, UnmatchedChannel, UnmatchedPage, UnmatchedRequest } from '@zoma/data';
import type { Navigator, Screen } from '@zoma/ui';
import { SCREEN, fits } from '@zoma/ui';
import { storedSources } from '../onboarding/engine-loader';
import { GUIDES } from './guides-state';

/**
 * "Channels without a guide" (RELAY step 24c, architecture.md §1.5 "Built in step 24c"): the
 * live channels that no guide matches once the guides are combined, opened from the guides
 * screen's header and pushed on the live navigator.
 *
 *   channels  (one row per channel: its name, its source and its category, in the order "All
 *              channels" lists them; step 24e makes OK map one to a guide channel)
 *
 * - **Reads:** the profile first (the sources' order and names), then pages of `UNMATCHED.page`
 *   rows from the query worker (`unmatched`). Only the pages around the window are asked for and
 *   kept (`UNMATCHED.pages`), so 20,000 channels list as fast as twenty.
 * - **A new version** (a catalog or a guide swapped in the worker since the last page): every
 *   page held is dropped, the count and the list take the new answer, and the window is asked
 *   for again. An answer for an older version, a closed screen or an older opening is dropped.
 * - Back closes it.
 */

/** Sizes, all layout constants (no DOM measuring). settings.css uses the same numbers. */
export const UNMATCHED = {
  /** A channel's row: its name, then its source and category. */
  rowHeight: 88,
  rowGap: 8,
  /** Rows per ask. */
  page: 50,
  /** Pages kept (the window and one window either side fit in three). */
  pages: 6,
} as const;

/** Under the header and its line, as on the guides screen. */
export const UNMATCHED_BODY = SCREEN.height - 2 * SCREEN.safeY - GUIDES.headerHeight - GUIDES.headerGap - GUIDES.introHeight;
export const UNMATCHED_VISIBLE = fits(UNMATCHED_BODY, UNMATCHED.rowHeight, UNMATCHED.rowGap);

export type UnmatchedStatus = 'loading' | 'ready' | 'failed';

/** What the screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface UnmatchedEngine {
  profile(): Promise<LoadedProfile | null>;
  unmatched(req: UnmatchedRequest): Promise<UnmatchedPage>;
}

export interface UnmatchedOptions {
  readonly nav: Navigator;
  readonly engine: UnmatchedEngine;
}

export interface UnmatchedList {
  /** The screen while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<UnmatchedStatus>;
  /** The channels without a guide, as the last answer counted them. */
  readonly count: ReadonlySignal<number>;
  /** Bumps when rows come in or go: the list draws again. */
  readonly drawn: ReadonlySignal<number>;
  /** Requests in flight: 0 means the screen is settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  /** Row `index`, or `null` while its page isn't read. */
  row(index: number): UnmatchedChannel | null;
  /** A source's name as the profile gives it (`''`: not there). */
  sourceName(src: string): string;
  /** Opens the screen and reads the list. */
  open(): void;
  dispose(): void;
}

const ZONE = 'channels';

export function createUnmatchedList(options: UnmatchedOptions): UnmatchedList {
  const { nav, engine } = options;
  const screen = signal<Screen | null>(null);
  const status = signal<UnmatchedStatus>('loading');
  const count = signal(0);
  const drawn = signal(0);
  const pending = signal(0);
  let disposed = false;
  /** Bumps at each opening and closing: answers for another one are dropped. */
  let openSeq = 0;
  /** The sources asked for, in their order (the profile's). */
  let records: SourceRecord[] = [];
  /** The worker's version the pages are from (-1: none yet). */
  let version = -1;
  /** The pages held, by page number, least recently wanted first (a Map keeps insertion order). */
  let pages = new Map<number, UnmatchedChannel[]>();
  /** Pages asked for and not answered yet, for this opening and version. */
  let asking = new Set<number>();

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

  /** The pages the window needs: its rows and one window either side. */
  const wanted = (shown: Screen): number[] => {
    const top = shown.position(ZONE).top;
    const first = Math.max(0, top - UNMATCHED_VISIBLE);
    const last = Math.min(count.value, top + 2 * UNMATCHED_VISIBLE) - 1;
    const out: number[] = [];
    for (let p = Math.floor(first / UNMATCHED.page); p * UNMATCHED.page <= last; p += 1) out.push(p);
    return out;
  };

  /**
   * Asks the pages the window needs that aren't held or asked for, and drops the least recently
   * wanted beyond `UNMATCHED.pages` (never one the window needs: those were just moved last, and
   * the window needs two at most).
   */
  const fill = (): void => {
    // (Pushing the screen tells the focus listeners before `screen` holds it.)
    const shown = screen.value;
    if (shown === null) return;
    wanted(shown).forEach((p) => {
      const held = pages.get(p);
      if (held !== undefined) {
        // Wanted again: last in the order.
        pages.delete(p);
        pages.set(p, held);
      } else if (!asking.has(p)) ask(p);
    });
    let excess = pages.size - UNMATCHED.pages;
    pages.forEach((_rows, p) => {
      if (excess <= 0) return;
      pages.delete(p);
      excess -= 1;
    });
  };

  /** Takes page `page`'s answer: a newer version first drops every page held. */
  const take = (page: number, answer: UnmatchedPage): void => {
    // (Open: `ask` drops the answers of an opening that closed.)
    const shown = screen.value!;
    if (answer.version !== version) {
      pages = new Map();
      asking = new Set();
      version = answer.version;
    }
    pages.set(page, answer.rows);
    count.value = answer.count;
    status.value = 'ready';
    shown.update({ kind: 'list', id: ZONE, axis: 'vertical', count: answer.count, visible: UNMATCHED_VISIBLE });
    drawn.value += 1;
    fill();
  };

  function ask(page: number): void {
    const seq = openSeq;
    const from = version;
    asking.add(page);
    track(() => engine.unmatched({ sources: records.map((r) => r.id), offset: page * UNMATCHED.page, limit: UNMATCHED.page })).then(
      (answer) => {
        if (disposed || seq !== openSeq) return;
        if (from === version) asking.delete(page);
        // An answer older than the pages held is dropped (the window asks again).
        if (answer.version < version) return;
        take(page, answer);
      },
      (error: unknown) => {
        if (disposed || seq !== openSeq) return;
        if (from === version) asking.delete(page);
        console.warn('The channels without a guide could not be read', error);
        if (status.value === 'loading') status.value = 'failed';
      },
    );
  }

  const close = (): void => {
    openSeq += 1;
    screen.value = null;
    nav.pop();
  };

  const stopFollowing = nav.subscribe((focus) => {
    if (focus.screen === 'unmatched') fill();
  });

  return {
    screen,
    status,
    count,
    drawn,
    pending,
    row(index: number): UnmatchedChannel | null {
      return pages.get(Math.floor(index / UNMATCHED.page))?.[index % UNMATCHED.page] ?? null;
    },
    sourceName(src: string): string {
      for (let i = 0; i < records.length; i += 1) if (records[i]!.id === src) return records[i]!.name;
      return '';
    },
    open(): void {
      if (disposed) return;
      openSeq += 1;
      const seq = openSeq;
      status.value = 'loading';
      count.value = 0;
      pages = new Map();
      asking = new Set();
      screen.value = nav.push({
        id: 'unmatched',
        zones: [{ kind: 'list', id: ZONE, axis: 'vertical', count: 0, visible: UNMATCHED_VISIBLE }],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
      });
      track(() => engine.profile()).then(
        (profile) => {
          if (disposed || seq !== openSeq) return;
          records = storedSources(profile);
          ask(0);
        },
        (error: unknown) => {
          if (disposed || seq !== openSeq) return;
          console.warn('The sources could not be read', error);
          status.value = 'failed';
        },
      );
    },
    dispose(): void {
      disposed = true;
      stopFollowing();
    },
  };
}
