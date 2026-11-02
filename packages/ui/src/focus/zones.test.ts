import { INTENTS } from '@zoma/platform-api';
import { describe, expect, it } from 'vitest';
import { epgCell } from './epg';
import { freeStep } from './free';
import type { EpgCell, EpgZone, GridZone, ListZone, Rect, ZonePosition } from './types';
import { moveDirection } from './types';
import { clampPosition, initialPosition, page, scroll, scrollTop, step } from './zones';

const at = (index: number, top = 0): ZonePosition => ({ index, top, time: 0, view: 0 });

const list = (count: number, extra: Partial<ListZone> = {}): ListZone => ({
  kind: 'list',
  id: 'l',
  axis: 'vertical',
  count,
  ...extra,
});

const grid = (count: number, columns: number, visibleRows?: number): GridZone => ({
  kind: 'grid',
  id: 'g',
  columns,
  count,
  ...(visibleRows === undefined ? {} : { visibleRows }),
});

describe('moveDirection: the one RTL swap', () => {
  it('maps the arrows to logical directions in LTR', () => {
    expect(['UP', 'DOWN', 'LEFT', 'RIGHT'].map((i) => moveDirection(i as 'UP', 'ltr'))).toEqual([
      'up',
      'down',
      'start',
      'end',
    ]);
  });

  it('swaps LEFT and RIGHT in RTL, never UP and DOWN', () => {
    expect(['UP', 'DOWN', 'LEFT', 'RIGHT'].map((i) => moveDirection(i as 'UP', 'rtl'))).toEqual([
      'up',
      'down',
      'end',
      'start',
    ]);
  });

  it('gives no direction for any other Intent', () => {
    const others = INTENTS.filter((i) => !['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(i));
    expect(others).toHaveLength(INTENTS.length - 4);
    for (const intent of others) {
      expect(moveDirection(intent, 'ltr')).toBeNull();
      expect(moveDirection(intent, 'rtl')).toBeNull();
    }
  });
});

describe('scrollTop', () => {
  it('moves the view as little as possible', () => {
    expect(scrollTop(0, 3, 4, 10)).toBe(0);
    expect(scrollTop(0, 4, 4, 10)).toBe(1);
    expect(scrollTop(5, 2, 4, 10)).toBe(2);
    expect(scrollTop(5, 7, 4, 10)).toBe(5);
    expect(scrollTop(5, 9, 4, 10)).toBe(6);
  });

  it('stays inside the rows, and at 0 when everything fits', () => {
    expect(scrollTop(9, 9, 4, 10)).toBe(6);
    expect(scrollTop(3, 2, 4, 4)).toBe(0);
    expect(scrollTop(3, 2, Infinity, 10)).toBe(0);
  });
});

describe('list zones', () => {
  it('moves a vertical list on up and down only', () => {
    const zone = list(3);
    expect(step(zone, at(0), 'down')?.index).toBe(1);
    expect(step(zone, at(1), 'up')?.index).toBe(0);
    expect(step(zone, at(0), 'up')).toBeNull();
    expect(step(zone, at(2), 'down')).toBeNull();
    expect(step(zone, at(1), 'start')).toBeNull();
    expect(step(zone, at(1), 'end')).toBeNull();
  });

  it('moves a horizontal list towards start and end only', () => {
    const zone = list(3, { axis: 'horizontal' });
    expect(step(zone, at(0), 'end')?.index).toBe(1);
    expect(step(zone, at(2), 'start')?.index).toBe(1);
    expect(step(zone, at(0), 'start')).toBeNull();
    expect(step(zone, at(2), 'end')).toBeNull();
    expect(step(zone, at(1), 'up')).toBeNull();
    expect(step(zone, at(1), 'down')).toBeNull();
  });

  it('wraps when asked, but not a single item', () => {
    expect(step(list(3, { wrap: true }), at(2), 'down')?.index).toBe(0);
    expect(step(list(3, { wrap: true }), at(0), 'up')?.index).toBe(2);
    expect(step(list(1, { wrap: true }), at(0), 'down')).toBeNull();
  });

  it('scrolls the view to keep the focus in it', () => {
    const zone = list(10, { visible: 4 });
    let pos = at(0);
    const tops: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      pos = step(zone, pos, 'down')!;
      tops.push(pos.top);
    }
    expect(pos.index).toBe(9);
    expect(tops).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6]);
    pos = step(zone, pos, 'up')!;
    expect(pos).toMatchObject({ index: 8, top: 6 });
    expect(step(zone, at(6, 6), 'up')).toMatchObject({ index: 5, top: 5 });
  });

  it('does nothing in an empty zone', () => {
    expect(initialPosition(list(0)).index).toBe(-1);
    expect(step(list(0), at(-1), 'down')).toBeNull();
    expect(page(list(0), at(-1), 1)).toBeNull();
    expect(scroll(list(0, { visible: 4 }), at(-1), 1)).toBeNull();
  });

  it('pages a vertical list by a viewport, the view moving with it', () => {
    const zone = list(10, { visible: 4 });
    expect(page(zone, at(1), 1)).toMatchObject({ index: 5, top: 4 });
    expect(page(zone, at(5, 4), 1)).toMatchObject({ index: 9, top: 6 });
    expect(page(zone, at(9, 6), 1)).toBeNull();
    expect(page(zone, at(9, 6), -1)).toMatchObject({ index: 5, top: 2 });
    expect(page(zone, at(2), -1)).toMatchObject({ index: 0, top: 0 });
    expect(page(zone, at(0), -1)).toBeNull();
    // Without a viewport, a page is the whole list.
    expect(page(list(10), at(3), 1)).toMatchObject({ index: 9, top: 0 });
    expect(page(list(3, { axis: 'horizontal' }), at(0), 1)).toBeNull();
  });

  it('scrolls with the wheel, keeping the focus in view', () => {
    const zone = list(10, { visible: 4 });
    expect(scroll(zone, at(1), 1)).toMatchObject({ index: 1, top: 1 });
    expect(scroll(zone, at(1), 3)).toMatchObject({ index: 3, top: 3 });
    expect(scroll(zone, at(1), 100)).toMatchObject({ index: 6, top: 6 });
    expect(scroll(zone, at(8, 6), -2)).toMatchObject({ index: 7, top: 4 });
    expect(scroll(zone, at(0), -1)).toBeNull();
    expect(scroll(zone, at(9, 6), 1)).toBeNull();
    expect(scroll(zone, at(0), 0)).toBeNull();
    expect(scroll(list(4, { visible: 4 }), at(0), 1)).toBeNull();
    expect(scroll(list(10), at(0), 1)).toBeNull();
  });
});

describe('grid zones', () => {
  // 3 columns, 8 items: rows [0 1 2] [3 4 5] [6 7].
  const zone = grid(8, 3);

  it('moves by columns and rows', () => {
    expect(step(zone, at(4), 'up')?.index).toBe(1);
    expect(step(zone, at(4), 'down')?.index).toBe(7);
    expect(step(zone, at(4), 'start')?.index).toBe(3);
    expect(step(zone, at(4), 'end')?.index).toBe(5);
  });

  it('leaves at its edges', () => {
    expect(step(zone, at(1), 'up')).toBeNull();
    expect(step(zone, at(3), 'start')).toBeNull();
    expect(step(zone, at(5), 'end')).toBeNull();
    expect(step(zone, at(7), 'end')).toBeNull();
    expect(step(zone, at(6), 'down')).toBeNull();
    expect(step(zone, at(7), 'down')).toBeNull();
  });

  it('goes down to the last item from above a short last row', () => {
    expect(step(zone, at(5), 'down')?.index).toBe(7);
    expect(step(zone, at(2), 'down')?.index).toBe(5);
  });

  it('scrolls by rows', () => {
    const tall = grid(30, 3, 2);
    expect(step(tall, at(4), 'down')).toMatchObject({ index: 7, top: 1 });
    expect(step(tall, at(7, 1), 'up')).toMatchObject({ index: 4, top: 1 });
    expect(step(tall, at(4, 1), 'up')).toMatchObject({ index: 1, top: 0 });
  });

  it('pages and scrolls by rows, keeping the column', () => {
    const tall = grid(8, 3, 1);
    expect(page(tall, at(1), 1)).toMatchObject({ index: 4, top: 1 });
    expect(page(tall, at(5, 1), 1)).toMatchObject({ index: 7, top: 2 });
    expect(page(tall, at(4, 1), -1)).toMatchObject({ index: 1, top: 0 });
    expect(scroll(tall, at(2), 1)).toMatchObject({ index: 5, top: 1 });
    expect(scroll(tall, at(2), 2)).toMatchObject({ index: 7, top: 2 });
    expect(scroll(tall, at(7, 2), -1)).toMatchObject({ index: 4, top: 1 });
  });
});

describe('clampPosition', () => {
  it('keeps the index inside a shrunk or grown zone', () => {
    expect(clampPosition(list(3), at(7))).toMatchObject({ index: 2 });
    expect(clampPosition(list(0), at(2, 1))).toMatchObject({ index: -1, top: 0 });
    expect(clampPosition(list(5), at(-1))).toMatchObject({ index: 0 });
    expect(clampPosition(list(20, { visible: 4 }), at(12))).toMatchObject({ index: 12, top: 9 });
    expect(clampPosition(list(5, { visible: 4 }), at(4, 3))).toMatchObject({ index: 4, top: 1 });
  });

  it('takes any number from outside', () => {
    expect(clampPosition(list(5), at(2.7)).index).toBe(2);
    expect(clampPosition(list(5), at(Number.NaN)).index).toBe(0);
    expect(clampPosition(list(Number.NaN), at(1)).index).toBe(-1);
    expect(clampPosition(grid(5, 0), at(3)).index).toBe(3);
  });
});

describe('free zones (geometry fallback)', () => {
  const r = (x: number, y: number, width = 100, height = 40): Rect => ({ x, y, width, height });

  it('moves along a row of buttons', () => {
    const row = [r(0, 0), r(120, 0), r(240, 0)];
    expect(freeStep(row, 0, 'end')).toBe(1);
    expect(freeStep(row, 1, 'end')).toBe(2);
    expect(freeStep(row, 2, 'end')).toBeNull();
    expect(freeStep(row, 1, 'start')).toBe(0);
    expect(freeStep(row, 0, 'start')).toBeNull();
    expect(freeStep(row, 1, 'up')).toBeNull();
    expect(freeStep(row, 1, 'down')).toBeNull();
  });

  it('prefers the item in line over a nearer one off to the side', () => {
    // A two-column form; a wide button under it.
    const form = [r(0, 0), r(300, 0), r(0, 60), r(300, 60), r(0, 260, 400)];
    expect(freeStep(form, 0, 'down')).toBe(2);
    expect(freeStep(form, 1, 'down')).toBe(3);
    expect(freeStep(form, 3, 'down')).toBe(4);
    expect(freeStep(form, 4, 'up')).toBe(2);
    expect(freeStep(form, 2, 'end')).toBe(3);
    // In line far away (gap 400) beats off to the side close by (gap 10, offset 250).
    const wide = [r(0, 0), r(500, 0), r(110, 290)];
    expect(freeStep(wide, 0, 'end')).toBe(1);
  });

  it('breaks ties by the lower index', () => {
    const fan = [r(0, 100), r(200, 0), r(200, 200)];
    expect(freeStep(fan, 0, 'end')).toBe(1);
  });

  it('needs the centre beyond, not just an edge', () => {
    const overlap = [r(0, 0, 200), r(50, 0, 100)];
    expect(freeStep(overlap, 0, 'end')).toBeNull();
    expect(freeStep(overlap, 1, 'end')).toBeNull();
    expect(freeStep(overlap, 1, 'start')).toBeNull();
  });

  it('ignores an index outside the rects', () => {
    expect(freeStep([r(0, 0)], 3, 'end')).toBeNull();
  });
});

describe('EPG zones', () => {
  // UTC minutes; the guide shows 12:00–18:00 of day 0, 2 h at a time.
  const H = 60;
  const schedule: Record<number, EpgCell[]> = {
    0: [
      { start: 11 * H, end: 12 * H + 30 },
      { start: 12 * H + 30, end: 12 * H + 40 },
      { start: 12 * H + 40, end: 14 * H },
      { start: 14 * H, end: 19 * H },
    ],
    1: [
      { start: 12 * H, end: 13 * H },
      { start: 13 * H, end: 13 * H + 5 },
      { start: 13 * H + 5, end: 18 * H },
    ],
    // Row 2 has no data.
  };
  const cell = (row: number, minute: number): EpgCell | null =>
    schedule[row]?.find((c) => c.start <= minute && minute < c.end) ?? null;
  const zone: EpgZone = {
    kind: 'epg',
    id: 'guide',
    rows: 3,
    from: 12 * H,
    to: 18 * H,
    span: 2 * H,
    now: 12 * H + 50,
    cell,
  };
  const pos = (index: number, time: number, view = 12 * H): ZonePosition => ({ index, top: 0, time, view });

  it('starts at now, in the slot that holds it', () => {
    expect(initialPosition(zone)).toEqual({ index: 0, top: 0, time: 12 * H + 50, view: 12 * H + 30 });
    expect(initialPosition({ ...zone, now: 30 * H })).toMatchObject({ time: 18 * H - 1, view: 16 * H });
  });

  it('steps cell by cell, the cursor at each cell start', () => {
    let p = pos(0, 12 * H);
    const times: number[] = [];
    for (;;) {
      const next = step(zone, p, 'end');
      if (next === null) break;
      p = next;
      times.push(p.time);
    }
    expect(times).toEqual([12 * H + 30, 12 * H + 40, 14 * H]);
    const back: number[] = [];
    for (;;) {
      const next = step(zone, p, 'start');
      if (next === null) break;
      p = next;
      back.push(p.time);
    }
    // The first programme began before the guide: its cell starts at `from`.
    expect(back).toEqual([12 * H + 40, 12 * H + 30, 12 * H]);
  });

  it('keeps the cursor on up and down, so the focus does not drift', () => {
    const p = pos(0, 12 * H + 35);
    const down = step(zone, p, 'down')!;
    expect(down).toMatchObject({ index: 1, time: 12 * H + 35 });
    expect(epgCell(zone, 1, down.time)).toEqual({ start: 12 * H, end: 13 * H });
    expect(step(zone, down, 'up')).toMatchObject({ index: 0, time: 12 * H + 35 });
    expect(step(zone, p, 'up')).toBeNull();
    expect(step(zone, pos(2, 12 * H), 'down')).toBeNull();
  });

  it('moves slot by slot through a row without data', () => {
    expect(step(zone, pos(2, 12 * H + 50), 'end')?.time).toBe(13 * H);
    expect(step(zone, pos(2, 12 * H + 50), 'start')?.time).toBe(12 * H);
    expect(step(zone, pos(2, 17 * H + 40), 'end')).toBeNull();
  });

  it('scrolls the view by slots when the cursor leaves it', () => {
    const p = step(zone, pos(0, 12 * H + 40), 'end')!;
    expect(p).toMatchObject({ time: 14 * H, view: 14 * H });
    // The last view ends at `to`.
    expect(step(zone, pos(2, 15 * H + 30, 14 * H), 'end')).toMatchObject({ time: 16 * H, view: 16 * H });
    expect(step(zone, pos(1, 13 * H + 5, 13 * H + 30), 'start')).toMatchObject({ time: 13 * H, view: 13 * H });
  });

  it('cuts cells to the guide', () => {
    expect(epgCell(zone, 0, 12 * H)).toEqual({ start: 12 * H, end: 12 * H + 30 });
    expect(epgCell(zone, 0, 17 * H)).toEqual({ start: 14 * H, end: 18 * H });
    expect(step(zone, pos(0, 17 * H, 16 * H), 'end')).toBeNull();
  });

  it('moves forward even past a cell that overlaps the current one', () => {
    const overlapping: EpgZone = {
      ...zone,
      cell: (_row, minute) => (minute < 13 * H ? { start: 12 * H, end: 13 * H } : { start: 12 * H + 50, end: 14 * H }),
    };
    expect(step(overlapping, pos(0, 12 * H), 'end')?.time).toBe(13 * H);
  });

  it('uses a slot where the screen gives a cell that does not hold the minute', () => {
    const wrong: EpgZone = { ...zone, slot: 15, cell: () => ({ start: 0, end: 10 }) };
    expect(epgCell(wrong, 0, 12 * H + 20)).toEqual({ start: 12 * H + 15, end: 12 * H + 30 });
  });
});
