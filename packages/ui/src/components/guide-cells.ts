import { slotLength, slotStart } from '../focus/epg';
import type { EpgCell, EpgZone } from '../focus/types';

/**
 * The cells of the grid guide's rows (RELAY step 23b): one function, `guideCellAt`, gives the
 * cell that holds a minute, and both the `epg` zone's `cell(row, minute)` (`guideZone`) and the
 * drawing (`guideCellsIn`, which walks it) use it, so the focus and the cells on screen can't
 * disagree.
 *
 * A row's cells cover the guide's `[from, to)` once, with no hole and no overlap:
 * - **a programme** is a cell from its start to its end, cut to the guide's range and at the
 *   next programme's start (an overlap ends where the next one starts, as core's buckets do);
 * - **a gap** between programmes is filled with placeholder cells cut at the slot boundaries
 *   (the slots count from `from`, as the zone's own slots do), so the cursor moves slot by slot
 *   where there is no data, as it does in a row with no guide at all;
 * - **slivers** shorter than `GUIDE_MIN_GAP` never stand alone: a short gap after a programme
 *   is part of that programme's cell (providers often leave a minute or two between programmes,
 *   and a 1-minute cell would cost a key press to cross), and a slot boundary that close to a
 *   gap's end is skipped, so the piece next to it is a little longer.
 *
 * Plain loops and arrays only: this is main-thread TV code (no `.at`, `Array.from`, typed
 * arrays: each would pull core-js modules into main.js).
 */

/**
 * A channel's programmes over the guide's hours: core's `EpgSchedule` and the query worker's
 * `GuideRow` are both one. Times are UTC epoch minutes (whole numbers), sorted by start; an
 * end after the next start is cut there.
 */
export interface GuideSchedule {
  readonly start: readonly number[];
  readonly end: readonly number[];
  readonly title: readonly string[];
}

/** A cell of a guide row, `[start, end)` in UTC minutes, inside the guide's range. */
export interface GuideCell extends EpgCell {
  /** The programme's index in the row's schedule, or -1 for a placeholder. */
  readonly programme: number;
}

/** What the cells are cut by: the `epg` zone's range and slot. */
export type GuideRange = Pick<EpgZone, 'from' | 'to' | 'slot'>;

/** The shortest cell that stands alone, in minutes (see above). */
export const GUIDE_MIN_GAP = 5;

const NONE: readonly number[] = [];

/** The last index whose start is at or before `minute`, or -1: `starts[i] <= minute < starts[i + 1]`. */
function lastStartAt(starts: readonly number[], minute: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((starts[mid] ?? Infinity) <= minute) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The cell of a row that holds `minute`, or `null` outside the guide's `[from, to)`. A row
 * with no schedule (`null`: no guide, or not read yet) is all placeholders.
 */
export function guideCellAt(schedule: GuideSchedule | null, range: GuideRange, minute: number): GuideCell | null {
  if (!(minute >= range.from && minute < range.to)) return null;
  const starts = schedule === null ? NONE : schedule.start;
  const ends = schedule === null ? NONE : schedule.end;
  const i = lastStartAt(starts, minute);
  const next = starts[i + 1] ?? Infinity;
  // Whatever holds `minute` ends here at the latest: the next programme or the guide's end.
  const limit = Math.min(next, range.to);
  let gapStart = range.from;
  if (i >= 0) {
    const start = Math.max(starts[i] ?? range.from, range.from);
    const end = ends[i] ?? start;
    // The programme, or the short gap after it.
    if (end > start && (minute < end || limit - end < GUIDE_MIN_GAP)) {
      return { start, end: limit - end < GUIDE_MIN_GAP ? limit : end, programme: i };
    }
    gapStart = Math.max(start, end);
  }
  // A placeholder: the slot boundaries at least GUIDE_MIN_GAP inside the gap cut it.
  const slot = slotLength(range);
  const lo = gapStart + GUIDE_MIN_GAP;
  const hi = limit - GUIDE_MIN_GAP;
  const before = slotStart(range, Math.min(minute, hi));
  const after = Math.max(slotStart(range, minute) + slot, slotStart(range, lo - 1) + slot);
  return { start: before >= lo ? before : gapStart, end: after > hi ? limit : after, programme: -1 };
}

/** The cells of a row that cross `[from, to)`, in order (the drawing's: `view` to `view + span`). */
export function guideCellsIn(schedule: GuideSchedule | null, range: GuideRange, from: number, to: number): GuideCell[] {
  const out: GuideCell[] = [];
  let minute = Math.max(from, range.from);
  while (minute < to) {
    const cell = guideCellAt(schedule, range, minute);
    // Past the guide's end. (A cell always ends after the minute it holds, so this walks on.)
    if (cell === null) break;
    out.push(cell);
    minute = cell.end;
  }
  return out;
}

/** The slot boundaries in `[from, to)` and inside the guide: the time header's labels. */
export function guideSlots(range: GuideRange, from: number, to: number): number[] {
  const out: number[] = [];
  const slot = slotLength(range);
  const end = Math.min(to, range.to);
  for (let minute = slotStart(range, Math.max(from, range.from) - 1) + slot; minute < end; minute += slot) out.push(minute);
  return out;
}

/**
 * An `epg` zone whose `cell(row, minute)` is `guideCellAt` over `schedule(row)`: give the grid
 * the same `schedule`, and the focus is always on a cell it draws.
 */
export function guideZone(spec: Omit<EpgZone, 'kind' | 'cell'>, schedule: (row: number) => GuideSchedule | null): EpgZone {
  const zone: EpgZone = { ...spec, kind: 'epg', cell: (row, minute) => guideCellAt(schedule(row), zone, minute) };
  return zone;
}
