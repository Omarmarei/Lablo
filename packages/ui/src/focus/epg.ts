import type { EpgCell, EpgZone, ZonePosition } from './types';

const DEFAULT_SLOT = 30;

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** The zone's slot length in minutes (default 30). */
export function slotLength(zone: Pick<EpgZone, 'slot'>): number {
  return zone.slot !== undefined && zone.slot > 0 ? zone.slot : DEFAULT_SLOT;
}

/** The start of the slot that holds `minute`. Slots count from the guide's `from`. */
export function slotStart(zone: Pick<EpgZone, 'from' | 'slot'>, minute: number): number {
  const slot = slotLength(zone);
  return minute - ((((minute - zone.from) % slot) + slot) % slot);
}

/**
 * The cell of `row` at `minute`, cut to the guide's range. Where the screen has no cell (or
 * one that doesn't hold `minute`), the slot is the cell, so a row without data still moves
 * slot by slot.
 */
export function epgCell(zone: EpgZone, row: number, minute: number): EpgCell {
  const given = zone.cell(row, minute);
  const start = given !== null && given.start <= minute && minute < given.end ? given.start : slotStart(zone, minute);
  const end = given !== null && given.start <= minute && minute < given.end ? given.end : start + slotLength(zone);
  return { start: Math.max(start, zone.from), end: Math.min(end, zone.to) };
}

/**
 * Keeps the cursor inside the guide and in view. When the cursor leaves the view, the view
 * jumps to the cursor's slot (the last view ends at `to`).
 */
export function epgClamp(zone: EpgZone, pos: ZonePosition): ZonePosition {
  const time = clamp(pos.time, zone.from, Math.max(zone.from, zone.to - 1));
  const span = Math.max(slotLength(zone), zone.span);
  const view = time < pos.view || time >= pos.view + span ? slotStart(zone, time) : pos.view;
  return { ...pos, time, view: clamp(view, zone.from, Math.max(zone.from, zone.to - span)) };
}

/**
 * The cursor after a move to the previous (`start`) or next (`end`) cell of `row`: the start
 * of that cell. `null` at the edge of the guide.
 */
export function epgTimeStep(zone: EpgZone, row: number, time: number, direction: 'start' | 'end'): number | null {
  const cell = epgCell(zone, row, time);
  if (direction === 'start') return cell.start <= zone.from ? null : epgCell(zone, row, cell.start - 1).start;
  if (cell.end >= zone.to) return null;
  // max(): a cell that overlaps the current one must still move the cursor forward.
  return Math.max(epgCell(zone, row, cell.end).start, cell.end);
}
