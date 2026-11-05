/**
 * The grid guide's sizes in px (RELAY step 23b): layout constants, never measured. In a file of
 * its own, with no JSX or CSS, so the e2e tests (root tsc) can check the drawing against them.
 *
 * A screen picks its zone's `visibleRows` with `guideFits(height)` and its `span` (minutes) so
 * that `guideWidth(span)` fits its box.
 */
export const GUIDE_LAYOUT = {
  /** The time header above the rows. */
  headerHeight: 56,
  /** Each row comes after a gap: below the header, and between rows. */
  rowHeight: 80,
  rowGap: 8,
  /** The channel column at the inline start, and the space after it. */
  channelWidth: 400,
  channelGap: 8,
  /** One minute of the timeline: a 30-minute slot is 330 px, two hours 1,320. */
  minuteWidth: 11,
  /** Space between two cells, taken from the end of each. */
  cellGap: 4,
} as const;

/** The grid's width for a view of `span` minutes: the channel column, then the timeline. */
export function guideWidth(span: number): number {
  return GUIDE_LAYOUT.channelWidth + GUIDE_LAYOUT.channelGap + span * GUIDE_LAYOUT.minuteWidth;
}

/** The grid's height with `rows` rows in view: the header, then each row after its gap. */
export function guideHeight(rows: number): number {
  return GUIDE_LAYOUT.headerHeight + rows * (GUIDE_LAYOUT.rowHeight + GUIDE_LAYOUT.rowGap);
}

/** The rows a grid of `height` px shows: its zone's `visibleRows` (at least 1). */
export function guideFits(height: number): number {
  return Math.max(1, Math.floor((height - GUIDE_LAYOUT.headerHeight) / (GUIDE_LAYOUT.rowHeight + GUIDE_LAYOUT.rowGap)));
}
