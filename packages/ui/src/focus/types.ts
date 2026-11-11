import type { Intent } from '@lablo/platform-api';

/** Text direction of the UI: Arabic is `rtl`, English `ltr`. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * A move in logical terms. `start` and `end` are the inline start and end of the screen:
 * left and right in LTR, right and left in RTL. Zones, their neighbours and free-zone
 * geometry are all logical, so `moveDirection` is the one place where a physical key
 * becomes a direction, and the RTL swap happens there exactly once.
 */
export type Direction = 'up' | 'down' | 'start' | 'end';

/**
 * The logical direction of an arrow Intent, or `null` for any other Intent. In RTL, LEFT
 * and RIGHT swap (LEFT goes towards the end); UP and DOWN never do.
 */
export function moveDirection(intent: Intent, dir: TextDirection): Direction | null {
  switch (intent) {
    case 'UP':
      return 'up';
    case 'DOWN':
      return 'down';
    case 'LEFT':
      return dir === 'rtl' ? 'end' : 'start';
    case 'RIGHT':
      return dir === 'rtl' ? 'start' : 'end';
    default:
      return null;
  }
}

/** The zone the focus goes to when it leaves a zone in a direction. */
export type Neighbours = Readonly<Partial<Record<Direction, string>>>;

interface ZoneBase {
  /** Unique within its screen. */
  readonly id: string;
  readonly neighbours?: Neighbours;
}

/**
 * A row or column of items, addressed by index, so a virtual list renders only the window
 * from `top`. A `vertical` list moves on UP/DOWN and pages on CH_UP/CH_DOWN; a
 * `horizontal` list moves on LEFT/RIGHT (towards `start` and `end`).
 */
export interface ListZone extends ZoneBase {
  readonly kind: 'list';
  readonly axis: 'vertical' | 'horizontal';
  readonly count: number;
  /** Items the viewport shows (a layout constant); the view scrolls to keep the focus in it. Default: all. */
  readonly visible?: number;
  /** Moving past either end wraps around instead of leaving the zone. */
  readonly wrap?: boolean;
}

/** Items in rows of `columns`, filled from the start: index = row × columns + column. */
export interface GridZone extends ZoneBase {
  readonly kind: 'grid';
  readonly columns: number;
  readonly count: number;
  /** Rows the viewport shows. Default: all. */
  readonly visibleRows?: number;
}

/** A programme cell of an EPG row, in UTC minutes: `[start, end)`. */
export interface EpgCell {
  readonly start: number;
  readonly end: number;
}

/**
 * The guide grid: a channel row plus a time cursor. The focused cell is the one that holds
 * the cursor; UP/DOWN keep the cursor (so the focus doesn't drift), LEFT/RIGHT go to the
 * previous or next cell and put the cursor at its start.
 */
export interface EpgZone extends ZoneBase {
  readonly kind: 'epg';
  readonly rows: number;
  /** Rows the viewport shows. Default: all. */
  readonly visibleRows?: number;
  /** The guide's time range `[from, to)` in UTC minutes. Put `from` on a slot boundary. */
  readonly from: number;
  readonly to: number;
  /** Minutes the viewport shows. */
  readonly span: number;
  /** Slot length in minutes: the view scrolls by it, and rows without data get cells of it. Default 30. */
  readonly slot?: number;
  /** Where the cursor starts: usually now. */
  readonly now: number;
  /**
   * The cell of `row` that holds `minute`, or `null` when the row has no data there. Fill
   * the gaps between programmes with placeholder cells, or a move skips a short programme.
   */
  readonly cell: (row: number, minute: number) => EpgCell | null;
}

/** A logical rectangle: `x` grows from the inline start (from the right in RTL). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Geometry fallback for small static screens (a dialog, a form): the focus goes to the
 * nearest item in the direction. Sizes come from layout constants, never from the DOM.
 */
export interface FreeZone extends ZoneBase {
  readonly kind: 'free';
  readonly rects: readonly Rect[];
}

export type ZoneSpec = ListZone | GridZone | EpgZone | FreeZone;

/**
 * Where a zone's focus and view are. A zone keeps its position while the focus is in
 * another zone or on another screen (per-zone memory).
 */
export interface ZonePosition {
  /** The focused item (EPG: row), or -1 while the zone is empty. */
  readonly index: number;
  /** The first visible item (list) or row (grid, EPG). */
  readonly top: number;
  /** EPG: the cursor in UTC minutes. 0 in other zones. */
  readonly time: number;
  /** EPG: the first visible minute. 0 in other zones. */
  readonly view: number;
}
