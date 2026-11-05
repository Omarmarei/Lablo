import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKey, EpgProgramme } from '@zoma/core';
import type { ProgrammeRequest } from '@zoma/data';
import type { GuideChannel, Navigator } from '@zoma/ui';

/**
 * The programme details (RELAY step 24a, PLAN 6.3): a dialog over the guide screen, opened by OK
 * on a programme gone by or to come (OK on the cell that holds now plays its channel).
 *
 *   actions  (a row: "Watch the channel", "Close")
 *
 * - What the grid has shows at once: the channel, the title and the programme's own times (the
 *   grid's: a programme that runs into the next day's first one ends where that one starts). The
 *   rest (the sub-title, the category, the episode, the description) comes with the query
 *   worker's read of the programme; an answer for a dialog that closed, or a newer one, is dropped.
 * - **Watch the channel** closes the dialog and hands the programme to `watch` (the guide plays
 *   the channel: the player over the guide, and Back from it comes back to the guide). **Close**
 *   and Back close it, the guide's focus where it was. Only the dialog's own keys close it: it is
 *   on top then.
 * - Step 25 adds catch-up's "Watch from the start" for a programme gone by.
 */

/** The dialog's id on the navigator, and its one zone's. */
export const DETAILS_SCREEN = 'programme';
export const DETAILS_ACTIONS = 'actions';
/** The buttons, in order. */
export const DETAILS_WATCH = 0;
export const DETAILS_CLOSE = 1;

/** A programme the grid shows, as the dialog opens on it. */
export interface DetailsTarget {
  readonly key: ContentKey;
  readonly channel: GuideChannel;
  /** The programme's own times in the grid (UTC minutes, after the tvg-shift) and its title. */
  readonly start: number;
  readonly end: number;
  readonly title: string;
}

/** `reading`: the read is out; `read`: it answered (`programme` may still be `null`); `failed`: it didn't. */
export type DetailsStatus = 'reading' | 'read' | 'failed';

export interface DetailsShown {
  readonly target: DetailsTarget;
  readonly status: DetailsStatus;
  /** The whole programme once read (`null` before, after a failure, or when its guide has none starting then). */
  readonly programme: EpgProgramme | null;
}

/** What the dialog needs from the data engine (a `DataEngine` fits). */
export interface DetailsEngine {
  programme(req: ProgrammeRequest): Promise<EpgProgramme | null>;
}

export interface DetailsOptions {
  /** The live screen's navigator: the dialog is a screen on it, over the guide. */
  readonly nav: Navigator;
  readonly engine: DetailsEngine;
  /** "Watch the channel": the dialog has closed. */
  readonly watch: (target: DetailsTarget) => void;
  /** Runs a read (the guide counts it in its `pending`). */
  readonly track?: <T>(request: () => Promise<T>) => Promise<T>;
}

export interface Details {
  /** The dialog while it shows. */
  readonly shown: ReadonlySignal<DetailsShown | null>;
  /** Opens the dialog on `target` and reads the rest of the programme. */
  open(target: DetailsTarget): void;
  dispose(): void;
}

export function createDetails(options: DetailsOptions): Details {
  const { nav, engine } = options;
  const track = options.track ?? (<T>(request: () => Promise<T>): Promise<T> => request());
  const shown = signal<DetailsShown | null>(null);
  /** Bumps on each close and dispose (an open always follows one, or none yet): an answer from before is dropped. */
  let seq = 0;

  const close = (): void => {
    seq += 1;
    shown.value = null;
    nav.pop();
  };

  const settle = (mine: number, target: DetailsTarget, status: DetailsStatus, programme: EpgProgramme | null): void => {
    if (mine !== seq) return;
    shown.value = { target, status, programme };
  };

  return {
    shown,
    open(target: DetailsTarget): void {
      if (shown.value !== null) return;
      const mine = seq;
      shown.value = { target, status: 'reading', programme: null };
      nav.push({
        id: DETAILS_SCREEN,
        zones: [{ kind: 'list', id: DETAILS_ACTIONS, axis: 'horizontal', count: 2 }],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
        onSelect: (focus) => {
          close();
          if (focus.index === DETAILS_WATCH) options.watch(target);
        },
      });
      track(() => engine.programme({ key: target.key, start: target.start })).then(
        (programme) => settle(mine, target, 'read', programme),
        (error: unknown) => {
          if (mine === seq) console.warn('The programme could not be read', error);
          settle(mine, target, 'failed', null);
        },
      );
    },
    dispose(): void {
      seq += 1;
    },
  };
}
