import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { epgCell } from '../focus/epg';
import type { EpgZone, ZonePosition } from '../focus/types';
import { step } from '../focus/zones';
import type { GuideCell, GuideRange, GuideSchedule } from './guide-cells';
import { GUIDE_MIN_GAP, guideCellAt, guideCellsIn, guideSlots, guideZone } from './guide-cells';

const H = 60;
/** 12:00 to 18:00 on day 0, in 30-minute slots. */
const RANGE: GuideRange = { from: 12 * H, to: 18 * H, slot: 30 };

function schedule(rows: ReadonlyArray<readonly [number, number, string]>): GuideSchedule {
  return { start: rows.map((r) => r[0]), end: rows.map((r) => r[1]), title: rows.map((r) => r[2]) };
}

/** Every cell of a row over the whole guide, as `[start, end, programme]`. */
function tiles(s: GuideSchedule | null, range: GuideRange = RANGE): Array<[number, number, number]> {
  return guideCellsIn(s, range, range.from, range.to).map((c) => [c.start, c.end, c.programme]);
}

/** HH:MM on day 0, for readable expectations. */
const t = (hours: number, minutes = 0): number => hours * H + minutes;

describe('guideCellAt', () => {
  it('gives a row with no schedule the slots, as the epg zone does for a row without data', () => {
    expect(tiles(null)).toEqual(Array.from({ length: 12 }, (_, i) => [t(12) + 30 * i, t(12) + 30 * (i + 1), -1]));
    const zone: EpgZone = { kind: 'epg', id: 'g', rows: 1, from: RANGE.from, to: RANGE.to, span: 120, now: 0, cell: () => null };
    for (let minute = RANGE.from; minute < RANGE.to; minute += 7) {
      const cell = guideCellAt(null, RANGE, minute);
      expect({ start: cell?.start, end: cell?.end }).toEqual(epgCell(zone, 0, minute));
    }
    expect(tiles({ start: [], end: [], title: [] })).toEqual(tiles(null));
  });

  it('cuts programmes to the guide and fills the gaps with slot-cut placeholders', () => {
    const s = schedule([
      [t(11, 30), t(13), 'Began before the guide'],
      [t(13), t(13, 40), 'Back to back'],
      [t(15, 3), t(15, 58), 'After a gap'],
      [t(17), t(19), 'Runs past the guide'],
    ]);
    expect(tiles(s)).toEqual([
      [t(12), t(13), 0],
      [t(13), t(13, 40), 1],
      // 13:40 to 15:03: cut at 14:00 and 14:30; 15:00 is too close to the gap's end.
      [t(13, 40), t(14), -1],
      [t(14), t(14, 30), -1],
      [t(14, 30), t(15, 3), -1],
      [t(15, 3), t(15, 58), 2],
      // 15:58 to 17:00: 16:00 is too close to the gap's start.
      [t(15, 58), t(16, 30), -1],
      [t(16, 30), t(17), -1],
      [t(17), t(18), 3],
    ]);
    expect(guideCellAt(s, RANGE, t(14, 59))).toEqual({ start: t(14, 30), end: t(15, 3), programme: -1 });
    expect(guideCellAt(s, RANGE, t(12))).toEqual({ start: t(12), end: t(13), programme: 0 });
  });

  it('gives a gap shorter than GUIDE_MIN_GAP to the programme before it', () => {
    expect(GUIDE_MIN_GAP).toBe(5);
    const s = schedule([
      [t(12), t(12, 58), 'Two minutes short'],
      [t(13), t(13, 26), 'Four minutes short'],
      [t(13, 30), t(13, 55), 'Five minutes short'],
      [t(14), t(17, 57), 'Three minutes before the end'],
    ]);
    expect(tiles(s)).toEqual([
      [t(12), t(13), 0],
      [t(13), t(13, 30), 1],
      [t(13, 30), t(13, 55), 2],
      [t(13, 55), t(14), -1],
      [t(14), t(18), 3],
    ]);
    // The cell holds the gap's minutes too, so the cursor never lands in a sliver.
    expect(guideCellAt(s, RANGE, t(12, 59))).toEqual({ start: t(12), end: t(13), programme: 0 });
  });

  it('keeps a short gap at the start of the guide as its own placeholder', () => {
    const s = schedule([[t(12, 3), t(13), 'Starts three minutes in']]);
    expect(tiles(s).slice(0, 2)).toEqual([
      [t(12), t(12, 3), -1],
      [t(12, 3), t(13), 0],
    ]);
  });

  it('ends an overlapping programme where the next starts, and drops one that is gone before the guide', () => {
    const s = schedule([
      [t(10), t(11), 'Over before the guide'],
      [t(12, 10), t(13, 30), 'Overlaps the next'],
      [t(13), t(14), 'Starts inside the one before'],
    ]);
    expect(tiles(s).slice(0, 3)).toEqual([
      [t(12), t(12, 10), -1],
      [t(12, 10), t(13), 1],
      [t(13), t(14), 2],
    ]);
  });

  it('keeps only the last of programmes with the same start', () => {
    const s = schedule([
      [t(13), t(14), 'First'],
      [t(13), t(13, 30), 'Second'],
    ]);
    expect(tiles(s).slice(2, 4)).toEqual([
      [t(13), t(13, 30), 1],
      [t(13, 30), t(14), -1],
    ]);
  });

  it('has no cell outside the guide', () => {
    expect(guideCellAt(null, RANGE, t(11, 59))).toBeNull();
    expect(guideCellAt(null, RANGE, t(18))).toBeNull();
    expect(guideCellAt(null, RANGE, Number.NaN)).toBeNull();
    expect(guideCellAt(null, RANGE, t(17, 59))).toEqual({ start: t(17, 30), end: t(18), programme: -1 });
  });

  it('counts the slots from the guide’s start, and a guide that ends inside a slot cuts it', () => {
    const range: GuideRange = { from: t(12, 10), to: t(13, 20), slot: 30 };
    expect(tiles(null, range)).toEqual([
      [t(12, 10), t(12, 40), -1],
      [t(12, 40), t(13, 10), -1],
      [t(13, 10), t(13, 20), -1],
    ]);
    // The default slot is 30 minutes.
    expect(tiles(null, { from: t(12), to: t(13) })).toEqual([
      [t(12), t(12, 30), -1],
      [t(12, 30), t(13), -1],
    ]);
  });
});

describe('guideCellsIn and guideSlots', () => {
  const s = schedule([
    [t(12), t(13, 15), 'Long'],
    [t(13, 15), t(13, 45), 'Short'],
    [t(13, 45), t(15), 'Late'],
  ]);

  it('gives the cells that cross the view, uncut', () => {
    expect(guideCellsIn(s, RANGE, t(13), t(14)).map((c) => [c.start, c.end])).toEqual([
      [t(12), t(13, 15)],
      [t(13, 15), t(13, 45)],
      [t(13, 45), t(15)],
    ]);
    expect(guideCellsIn(s, RANGE, t(13, 15), t(13, 45)).map((c) => c.programme)).toEqual([1]);
    expect(guideCellsIn(s, RANGE, t(13, 45), t(13, 45))).toEqual([]);
    // Cut to the guide: nothing before `from` or from `to`.
    expect(guideCellsIn(null, RANGE, t(11), t(12, 30)).map((c) => c.start)).toEqual([t(12)]);
    expect(guideCellsIn(null, RANGE, t(17, 30), t(19)).map((c) => c.end)).toEqual([t(18)]);
  });

  it('gives the slot boundaries in view and inside the guide', () => {
    expect(guideSlots(RANGE, t(13), t(15))).toEqual([t(13), t(13, 30), t(14), t(14, 30)]);
    expect(guideSlots(RANGE, t(13, 10), t(14, 10))).toEqual([t(13, 30), t(14)]);
    expect(guideSlots(RANGE, t(17), t(19))).toEqual([t(17), t(17, 30)]);
    expect(guideSlots(RANGE, t(11), t(12, 30))).toEqual([t(12)]);
    expect(guideSlots({ from: t(12, 10), to: t(14), slot: 15 }, t(12, 10), t(13))).toEqual([t(12, 10), t(12, 25), t(12, 40), t(12, 55)]);
  });
});

describe('guideZone', () => {
  const rows: Array<GuideSchedule | null> = [
    schedule([
      [t(12), t(12, 40), 'A'],
      [t(12, 40), t(12, 42), 'Two minutes'],
      [t(12, 42), t(14), 'B'],
    ]),
    null,
  ];
  const zone = guideZone({ id: 'guide', rows: 2, from: RANGE.from, to: RANGE.to, span: 120, slot: 30, now: t(12, 5) }, (row) => rows[row] ?? null);

  it('is an epg zone whose cells are guideCellAt’s', () => {
    expect(zone).toMatchObject({ kind: 'epg', id: 'guide', rows: 2, from: RANGE.from, to: RANGE.to, span: 120, slot: 30, now: t(12, 5) });
    for (let minute = RANGE.from - 1; minute <= RANGE.to; minute += 1) {
      expect(zone.cell(0, minute)).toEqual(guideCellAt(rows[0]!, RANGE, minute));
      expect(zone.cell(1, minute)).toEqual(guideCellAt(null, RANGE, minute));
    }
  });

  it('moves the focus cell by cell along the drawn cells, short ones included', () => {
    for (const row of [0, 1]) {
      let pos: ZonePosition = { index: row, top: 0, time: RANGE.from, view: RANGE.from };
      const starts = [pos.time];
      for (;;) {
        const next = step(zone, pos, 'end');
        if (next === null) break;
        pos = next;
        starts.push(pos.time);
      }
      expect(starts).toEqual(guideCellsIn(rows[row] ?? null, RANGE, RANGE.from, RANGE.to).map((c) => c.start));
    }
  });
});

// ---- Properties ------------------------------------------------------------------------------

/**
 * The cells by a different road: who owns each minute, runs of owners, short gaps given to the
 * programme before, then each gap cut at the slot boundaries at least GUIDE_MIN_GAP inside it.
 */
function oracle(s: GuideSchedule, range: Required<GuideRange>): Array<[number, number, number]> {
  const runs: Array<[number, number, number]> = [];
  for (let m = range.from; m < range.to; m += 1) {
    let owner = -1;
    for (let i = 0; i < s.start.length; i += 1) if (s.start[i]! <= m && m < s.end[i]!) owner = i;
    const last = runs[runs.length - 1];
    if (last !== undefined && last[2] === owner) last[1] = m + 1;
    else runs.push([m, m + 1, owner]);
  }
  const merged: Array<[number, number, number]> = [];
  for (const run of runs) {
    const before = merged[merged.length - 1];
    if (run[2] === -1 && before !== undefined && before[2] >= 0 && run[1] - run[0] < GUIDE_MIN_GAP) before[1] = run[1];
    else merged.push([run[0], run[1], run[2]]);
  }
  const out: Array<[number, number, number]> = [];
  for (const [start, end, owner] of merged) {
    if (owner >= 0) {
      out.push([start, end, owner]);
      continue;
    }
    let from = start;
    for (let b = start + 1; b < end; b += 1) {
      const onSlot = (((b - range.from) % range.slot) + range.slot) % range.slot === 0;
      if (onSlot && b - start >= GUIDE_MIN_GAP && end - b >= GUIDE_MIN_GAP) {
        out.push([from, b, -1]);
        from = b;
      }
    }
    out.push([from, end, -1]);
  }
  return out;
}

const rangeArb = fc
  .record({ from: fc.integer({ min: -2000, max: 2000 }), length: fc.integer({ min: 1, max: 400 }), slot: fc.integer({ min: 1, max: 90 }) })
  .map(({ from, length, slot }) => ({ from, to: from + length, slot }));

/** A schedule as core makes them: sorted, no overlap, every programme at least a minute. */
const validArb = (range: Required<GuideRange>): fc.Arbitrary<GuideSchedule> =>
  fc
    .record({
      lead: fc.integer({ min: 0, max: 300 }),
      parts: fc.array(
        fc.record({
          gap: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 120 })),
          length: fc.oneof(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 200 })),
        }),
        { maxLength: 30 },
      ),
    })
    .map(({ lead, parts }) => {
      const out = { start: [] as number[], end: [] as number[], title: [] as string[] };
      let at = range.from - lead;
      for (const part of parts) {
        at += part.gap;
        out.start.push(at);
        out.end.push(at + part.length);
        out.title.push(`p${out.title.length}`);
        at += part.length;
      }
      return out;
    });

/** Anything with sorted starts: ends before starts, overlaps, repeats. */
const anyArb: fc.Arbitrary<GuideSchedule> = fc
  .array(fc.tuple(fc.integer({ min: -2500, max: 2500 }), fc.integer({ min: -2500, max: 2500 })), { maxLength: 30 })
  .map((pairs) => {
    const starts = pairs.map((p) => p[0]).sort((a, b) => a - b);
    return { start: starts, end: pairs.map((p) => p[1]), title: pairs.map((_, i) => `p${i}`) };
  });

/** The cells walked from `from`, checked against guideCellAt at every minute they hold. */
function checkTiling(s: GuideSchedule | null, range: Required<GuideRange>): GuideCell[] {
  const cells = guideCellsIn(s, range, range.from, range.to);
  expect(cells[0]?.start).toBe(range.from);
  expect(cells[cells.length - 1]?.end).toBe(range.to);
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    expect(cell.end).toBeGreaterThan(cell.start);
    if (i > 0) expect(cell.start).toBe(cells[i - 1]!.end);
    for (let m = cell.start; m < cell.end; m += 1) expect(guideCellAt(s, range, m)).toEqual(cell);
    if (cell.programme >= 0 && s !== null) {
      // A programme's cell starts where it does (or at `from`) and ends before the next one.
      expect(cell.start).toBe(Math.max(s.start[cell.programme]!, range.from));
      expect(cell.end).toBeLessThanOrEqual(Math.min(s.start[cell.programme + 1] ?? Infinity, range.to));
    }
  }
  return cells;
}

describe('guide cells, for any schedule', () => {
  it('match the minute-by-minute oracle for schedules as core makes them', () => {
    fc.assert(
      fc.property(
        rangeArb.chain((range) => fc.tuple(fc.constant(range), validArb(range))),
        ([range, s]) => {
          const cells = checkTiling(s, range);
          expect(cells.map((c) => [c.start, c.end, c.programme])).toEqual(oracle(s, range));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('cover the guide once, each minute in the cell guideCellAt gives, whatever the schedule', () => {
    fc.assert(
      fc.property(rangeArb, anyArb, (range, s) => {
        checkTiling(s, range);
        checkTiling(null, range);
      }),
      { numRuns: 300 },
    );
  });

  it('draw, between any two minutes, the same cells as the whole row has there', () => {
    fc.assert(
      fc.property(
        rangeArb.chain((range) => fc.tuple(fc.constant(range), validArb(range), fc.integer({ min: -50, max: 450 }), fc.integer({ min: 0, max: 200 }))),
        ([range, s, offset, length]) => {
          const a = range.from + offset;
          const all = guideCellsIn(s, range, range.from, range.to);
          // An empty view crosses nothing.
          const crossing = all.filter((c) => length > 0 && c.end > a && c.start < a + length);
          expect(guideCellsIn(s, range, a, a + length)).toEqual(crossing);
        },
      ),
      { numRuns: 300 },
    );
  });
});
