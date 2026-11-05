import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKey, EpgProgramme } from '@zoma/core';
import type { ProgrammeRequest } from '@zoma/data';
import type { GuideChannel, Navigator } from '@zoma/ui';

/**
 * The programme details (RELAY step 24a, PLAN 6.3): a dialog over the guide screen, opened by OK
 * on a programme gone by or to come (OK on the cell that holds now plays its channel).
 *
 *   actions  (a row: "Watch from the start" for a programme in the channel's archive, then
 *            "Watch the channel", "Guide channel", "Close")
 *
 * - What the grid has shows at once: the channel, the title and the programme's own times (the
 *   grid's: a programme that runs into the next day's first one ends where that one starts). The
 *   rest (the sub-title, the category, the episode, the description) comes with the query
 *   worker's read of the programme; an answer for a dialog that closed, or a newer one, is dropped.
 * - **Watch from the start** (step 25a) comes first, and has the focus, when the guide says the
 *   programme can be played from the channel's archive (`target.archive`: it has ended, within the
 *   channel's catch-up days). It closes the dialog and hands the programme to `fromStart` (the
 *   guide plays it from the archive: the player over the guide, Back from it back to the guide).
 *   The dialog then says how long it can still be watched (`target.daysLeft`, step 25c).
 * - **Watch the channel** closes the dialog and hands the programme to `watch` (the guide plays
 *   the channel: the player over the guide, and Back from it comes back to the guide). **Guide
 *   channel** (step 24e) closes it and hands the programme to `map`: the manual mapping's picker
 *   on its channel, for one the guides matched wrongly; Back from it comes back to the guide. **Close**
 *   and Back close it, the guide's focus where it was. Only the dialog's own keys close it: it is
 *   on top then.
 */

/** The dialog's id on the navigator, and its one zone's. */
export const DETAILS_SCREEN = 'programme';
export const DETAILS_ACTIONS = 'actions';

/** The dialog's buttons: "Watch from the start", "Watch the channel", "Guide channel", "Close". */
export type DetailsAction = 'archive' | 'watch' | 'map' | 'close';

const ARCHIVE_ACTIONS: readonly DetailsAction[] = ['archive', 'watch', 'map', 'close'];
const PLAIN_ACTIONS: readonly DetailsAction[] = ['watch', 'map', 'close'];

/** The buttons in order: "Watch from the start" first for a programme in the archive. */
export function detailsActions(archive: boolean): readonly DetailsAction[] {
  return archive ? ARCHIVE_ACTIONS : PLAIN_ACTIONS;
}

/** A programme the grid shows, as the dialog opens on it. */
export interface DetailsTarget {
  readonly key: ContentKey;
  readonly channel: GuideChannel;
  /** The programme's own times in the grid (UTC minutes, after the tvg-shift) and its title. */
  readonly start: number;
  readonly end: number;
  readonly title: string;
  /** It can be watched from the start, out of the channel's archive (step 25a). */
  readonly archive?: boolean;
  /**
   * With `archive`, the local calendar days left before it leaves the archive (step 25c: 0, it
   * leaves today). Absent when the channel states no days.
   */
  readonly daysLeft?: number;
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
  /** "Guide channel" (step 24e): the dialog has closed. */
  readonly map?: (target: DetailsTarget) => void;
  /** "Watch from the start" (step 25a): the dialog has closed. */
  readonly fromStart?: (target: DetailsTarget) => void;
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
      const actions = detailsActions(target.archive === true);
      nav.push({
        id: DETAILS_SCREEN,
        zones: [{ kind: 'list', id: DETAILS_ACTIONS, axis: 'horizontal', count: actions.length }],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
        onSelect: (focus) => {
          close();
          const action = actions[focus.index];
          if (action === 'archive') options.fromStart?.(target);
          else if (action === 'watch') options.watch(target);
          else if (action === 'map') options.map?.(target);
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
