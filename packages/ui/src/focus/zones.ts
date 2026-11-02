import { clamp, epgClamp, epgTimeStep } from './epg';
import { freeStep } from './free';
import type { Direction, ZonePosition, ZoneSpec } from './types';

/** A whole, non-negative number; counts come from data and can be anything. */
function whole(n: number | undefined): number {
  return n !== undefined && n > 0 ? Math.floor(n) : 0;
}

/** Items in a zone (EPG: rows). */
export function zoneCount(zone: ZoneSpec): number {
  switch (zone.kind) {
    case 'list':
    case 'grid':
      return whole(zone.count);
    case 'epg':
      return whole(zone.rows);
    case 'free':
      return zone.rects.length;
  }
}

function columns(zone: ZoneSpec): number {
  return zone.kind === 'grid' ? Math.max(1, whole(zone.columns)) : 1;
}

/** Rows of items: a grid's items over its columns; one item per row otherwise. */
function rowCount(zone: ZoneSpec): number {
  return Math.ceil(zoneCount(zone) / columns(zone));
}

/** Rows the viewport shows; `Infinity` when the zone doesn't scroll. */
function visibleRows(zone: ZoneSpec): number {
  const visible = zone.kind === 'list' ? zone.visible : zone.kind === 'free' ? undefined : zone.visibleRows;
  return visible === undefined ? Infinity : Math.max(1, whole(visible));
}

/** `top` moved as little as possible to bring `row` into a view of `visible` rows. */
export function scrollTop(top: number, row: number, visible: number, rows: number): number {
  if (!(visible < rows)) return 0;
  const moved = row < top ? row : row >= top + visible ? row - visible + 1 : top;
  return clamp(moved, 0, rows - visible);
}

/** The item of `row` in the focused item's column (the last item when that row is short). */
function placeRow(zone: ZoneSpec, pos: ZonePosition, row: number): ZonePosition {
  const cols = columns(zone);
  const index = Math.min(row * cols + (pos.index % cols), zoneCount(zone) - 1);
  return { ...pos, index, top: scrollTop(pos.top, row, visibleRows(zone), rowCount(zone)) };
}

function at(zone: ZoneSpec, pos: ZonePosition, index: number): ZonePosition {
  return {
    ...pos,
    index,
    top: scrollTop(pos.top, Math.floor(index / columns(zone)), visibleRows(zone), rowCount(zone)),
  };
}

/** Where a zone starts: its first item, and an EPG cursor at `now`. */
export function initialPosition(zone: ZoneSpec): ZonePosition {
  const pos = { index: zoneCount(zone) > 0 ? 0 : -1, top: 0, time: 0, view: 0 };
  return zone.kind === 'epg' ? epgClamp(zone, { ...pos, time: zone.now, view: -Infinity }) : pos;
}

/**
 * `pos` made valid for the zone as it is now (after its count changed, or for an index
 * asked from outside): the index inside the items, the view around it. An empty zone has
 * index -1; its first item is focused once it has items.
 */
export function clampPosition(zone: ZoneSpec, pos: ZonePosition): ZonePosition {
  const count = zoneCount(zone);
  if (count === 0) return { ...pos, index: -1, top: 0 };
  const placed = at(zone, pos, clamp(pos.index >= 0 ? Math.floor(pos.index) : 0, 0, count - 1));
  return zone.kind === 'epg' ? epgClamp(zone, placed) : placed;
}

/** One step in `direction`, or `null` when the zone has nothing there (the focus leaves the zone). */
export function step(zone: ZoneSpec, pos: ZonePosition, direction: Direction): ZonePosition | null {
  if (pos.index < 0) return null;
  const count = zoneCount(zone);
  switch (zone.kind) {
    case 'list': {
      const vertical = zone.axis === 'vertical';
      const delta =
        direction === (vertical ? 'down' : 'end') ? 1 : direction === (vertical ? 'up' : 'start') ? -1 : 0;
      if (delta === 0) return null;
      let index = pos.index + delta;
      if (index < 0 || index >= count) {
        if (zone.wrap !== true || count < 2) return null;
        index = index < 0 ? count - 1 : 0;
      }
      return at(zone, pos, index);
    }
    case 'grid': {
      const cols = columns(zone);
      const i = pos.index;
      const lastRow = Math.floor((count - 1) / cols);
      let index = -1;
      if (direction === 'up') index = i - cols;
      // Down from above a short last row lands on its last item.
      else if (direction === 'down') index = i + cols < count ? i + cols : Math.floor(i / cols) < lastRow ? count - 1 : -1;
      else if (direction === 'start') index = i % cols > 0 ? i - 1 : -1;
      else index = i % cols < cols - 1 && i + 1 < count ? i + 1 : -1;
      return index < 0 ? null : at(zone, pos, index);
    }
    case 'epg': {
      if (direction === 'up' || direction === 'down') {
        const index = pos.index + (direction === 'down' ? 1 : -1);
        return index < 0 || index >= count ? null : at(zone, pos, index);
      }
      const time = epgTimeStep(zone, pos.index, pos.time, direction);
      return time === null ? null : epgClamp(zone, { ...pos, time });
    }
    case 'free': {
      const index = freeStep(zone.rects, pos.index, direction);
      return index === null ? null : { ...pos, index };
    }
  }
}

/** Whether CH_UP/CH_DOWN page the zone: vertical lists, grids and the guide's rows. */
export function pages(zone: ZoneSpec): boolean {
  return zone.kind === 'list' ? zone.axis === 'vertical' : zone.kind !== 'free';
}

/**
 * CH_UP (-1) / CH_DOWN (1): a viewport of rows towards the start or the end, with the view
 * moving by the same amount. `null` when already at that end.
 */
export function page(zone: ZoneSpec, pos: ZonePosition, sign: 1 | -1): ZonePosition | null {
  if (pos.index < 0 || !pages(zone)) return null;
  const rows = rowCount(zone);
  const amount = Math.min(visibleRows(zone), rows);
  const row = Math.floor(pos.index / columns(zone));
  const target = clamp(row + sign * amount, 0, rows - 1);
  if (target === row) return null;
  return placeRow(zone, { ...pos, top: clamp(pos.top + sign * amount, 0, Math.max(0, rows - amount)) }, target);
}

/**
 * The Magic Remote wheel: scrolls the view by `steps` rows (positive towards the end) and
 * keeps the focus inside it. `null` when the view can't move.
 */
export function scroll(zone: ZoneSpec, pos: ZonePosition, steps: number): ZonePosition | null {
  if (pos.index < 0 || zone.kind === 'free') return null;
  const rows = rowCount(zone);
  const visible = visibleRows(zone);
  if (!(visible < rows)) return null;
  const top = clamp(pos.top + steps, 0, rows - visible);
  if (top === pos.top) return null;
  const row = clamp(Math.floor(pos.index / columns(zone)), top, top + visible - 1);
  return placeRow(zone, { ...pos, top }, row);
}
