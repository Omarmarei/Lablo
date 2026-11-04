import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ListPart } from './channel-index';
import { ChannelIndex, chunkId } from './channel-index';

/** Every row's address, listed the slow way: the oracle. */
function flatten(parts: readonly ListPart[]): string[] {
  const rows: string[] = [];
  for (const part of parts) {
    part.chunks.forEach((size, chunk) => {
      for (let slot = 0; slot < size; slot += 1) rows.push(`${part.src}|${part.catIdx}|${chunk}|${slot}`);
    });
  }
  return rows;
}

const address = (at: { src: string; catIdx: number; chunk: number; slot: number } | null): string | null =>
  at === null ? null : `${at.src}|${at.catIdx}|${at.chunk}|${at.slot}`;

describe('ChannelIndex', () => {
  const parts: ListPart[] = [
    { src: 's1', catIdx: 0, chunks: [3] },
    { src: 's1', catIdx: 1, chunks: [] },
    { src: 's1', catIdx: 2, chunks: [500, 500, 200] },
    { src: 's2', catIdx: 0, chunks: [0] },
    { src: 's2', catIdx: 4, chunks: [2] },
  ];

  it('finds each row across categories, sources and chunks, stepping over empty categories', () => {
    const index = new ChannelIndex(parts);
    expect(index.count).toBe(1205);
    expect(address(index.locate(0))).toBe('s1|0|0|0');
    expect(address(index.locate(2))).toBe('s1|0|0|2');
    expect(address(index.locate(3))).toBe('s1|2|0|0');
    expect(address(index.locate(502))).toBe('s1|2|0|499');
    expect(address(index.locate(503))).toBe('s1|2|1|0');
    expect(address(index.locate(1003))).toBe('s1|2|2|0');
    expect(address(index.locate(1202))).toBe('s1|2|2|199');
    expect(address(index.locate(1203))).toBe('s2|4|0|0');
    expect(address(index.locate(1204))).toBe('s2|4|0|1');
  });

  it('has nothing outside the list, or at a fractional row', () => {
    const index = new ChannelIndex(parts);
    expect(index.locate(-1)).toBeNull();
    expect(index.locate(1205)).toBeNull();
    expect(index.locate(1.5)).toBeNull();
    expect(index.locate(Number.NaN)).toBeNull();
    expect(new ChannelIndex([]).locate(0)).toBeNull();
    expect(new ChannelIndex([]).count).toBe(0);
    expect(new ChannelIndex([]).chunksFor(0, 10)).toEqual([]);
  });

  it('lists the chunks a range of rows needs, once each and in order, clamped to the list', () => {
    const index = new ChannelIndex(parts);
    const ids = (from: number, to: number): string[] => index.chunksFor(from, to).map(chunkId);
    expect(ids(-9, 18)).toEqual(['s1|0|0', 's1|2|0']);
    expect(ids(0, 3)).toEqual(['s1|0|0']);
    expect(ids(500, 1010)).toEqual(['s1|2|0', 's1|2|1', 's1|2|2']);
    expect(ids(1200, 1300)).toEqual(['s1|2|2', 's2|4|0']);
    expect(ids(5, 5)).toEqual([]);
  });

  it("gives a chunk's first row, and -1 for a chunk the list doesn't hold", () => {
    const index = new ChannelIndex(parts);
    expect(index.firstRow({ src: 's1', catIdx: 2, chunk: 0 })).toBe(3);
    expect(index.firstRow({ src: 's1', catIdx: 2, chunk: 2 })).toBe(1003);
    expect(index.firstRow({ src: 's2', catIdx: 4, chunk: 0 })).toBe(1203);
    expect(index.firstRow({ src: 's1', catIdx: 2, chunk: 3 })).toBe(-1);
    expect(index.firstRow({ src: 's1', catIdx: 2, chunk: -1 })).toBe(-1);
    expect(index.firstRow({ src: 's2', catIdx: 2, chunk: 0 })).toBe(-1);
    expect(index.firstRow({ src: 's3', catIdx: 0, chunk: 0 })).toBe(-1);
  });

  it('matches the flattened list for any categories and chunk sizes', () => {
    const part = fc.record({
      src: fc.constantFrom('s1', 's2', 's10'),
      catIdx: fc.nat(40),
      chunks: fc.array(fc.nat(7), { maxLength: 4 }),
    });
    fc.assert(
      // A category of a source is listed once (the rail's parts never repeat one).
      fc.property(fc.uniqueArray(part, { maxLength: 8, selector: (p) => `${p.src}|${p.catIdx}` }), fc.integer({ min: -5, max: 80 }), fc.integer({ min: -5, max: 80 }), (list, a, b) => {
        const index = new ChannelIndex(list);
        const rows = flatten(list);
        expect(index.count).toBe(rows.length);
        for (let i = -1; i <= rows.length; i += 1) expect(address(index.locate(i))).toBe(rows[i] ?? null);
        const from = Math.min(a, b);
        const to = Math.max(a, b);
        const expected: string[] = [];
        for (const row of rows.slice(Math.max(0, from), Math.max(0, to))) {
          const id = row.slice(0, row.lastIndexOf('|'));
          if (expected[expected.length - 1] !== id) expected.push(id);
        }
        expect(index.chunksFor(from, to).map(chunkId)).toEqual(expected);
        // Each row is its chunk's first row plus its slot.
        for (let i = 0; i < rows.length; i += 1) {
          const at = index.locate(i)!;
          expect(index.firstRow(at) + at.slot).toBe(i);
        }
      }),
    );
  });
});
