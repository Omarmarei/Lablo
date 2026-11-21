import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ListPart } from './channel-index';
import { ChannelIndex, chunkId, storedOffset } from './channel-index';

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
  // (Places as a rail in the user's order gives them: s1's category 2 first in the provider's list.)
  const parts: ListPart[] = [
    { src: 's1', catIdx: 0, chunks: [3], first: 1200 },
    { src: 's1', catIdx: 1, chunks: [], first: 1203 },
    { src: 's1', catIdx: 2, chunks: [500, 500, 200], first: 0 },
    { src: 's2', catIdx: 0, chunks: [0], first: 1203 },
    { src: 's2', catIdx: 4, chunks: [2], first: 1210 },
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

  it("gives a row's place in the provider's whole list, and the row at a place (step 35c)", () => {
    const index = new ChannelIndex(parts);
    expect(index.place(0)).toBe(1200);
    expect(index.place(2)).toBe(1202);
    expect(index.place(3)).toBe(0);
    expect(index.place(1202)).toBe(1199);
    expect(index.place(1203)).toBe(1210);
    expect(index.place(1204)).toBe(1211);
    expect(index.place(-1)).toBe(-1);
    expect(index.place(1205)).toBe(-1);
    expect(index.rowOfPlace(1200)).toBe(0);
    expect(index.rowOfPlace(1202)).toBe(2);
    expect(index.rowOfPlace(0)).toBe(3);
    expect(index.rowOfPlace(1199)).toBe(1202);
    expect(index.rowOfPlace(1211)).toBe(1204);
    // A place no part on show holds (a hidden group's), or past the parts.
    expect(index.rowOfPlace(1203)).toBe(-1);
    expect(index.rowOfPlace(1205)).toBe(-1);
    expect(index.rowOfPlace(1212)).toBe(-1);
    expect(index.rowOfPlace(-1)).toBe(-1);
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

  // s1's category 2 with places 0, 499, 500 and 1,100 hidden: its chunks serve 498, 499 and 199.
  const withHidden: ListPart[] = [
    { src: 's1', catIdx: 0, chunks: [3], first: 1200, hidden: [1] },
    { src: 's1', catIdx: 2, chunks: [500, 500, 200], first: 0, hidden: [0, 499, 500, 1100] },
    { src: 's2', catIdx: 4, chunks: [2], first: 1210 },
  ];

  it("counts a hidden channel's place but not its row (step 36b)", () => {
    const index = new ChannelIndex(withHidden);
    expect(index.count).toBe(2 + 1196 + 2);
    // Rows walk the served chunks: category 0 serves 2, category 2 serves 498, 499 and 199.
    expect(address(index.locate(0))).toBe('s1|0|0|0');
    expect(address(index.locate(1))).toBe('s1|0|0|1');
    expect(address(index.locate(2))).toBe('s1|2|0|0');
    expect(address(index.locate(499))).toBe('s1|2|0|497');
    expect(address(index.locate(500))).toBe('s1|2|1|0');
    expect(address(index.locate(998))).toBe('s1|2|1|498');
    expect(address(index.locate(999))).toBe('s1|2|2|0');
    expect(address(index.locate(1197))).toBe('s1|2|2|198');
    expect(address(index.locate(1198))).toBe('s2|4|0|0');
    expect(index.firstRow({ src: 's1', catIdx: 2, chunk: 1 })).toBe(500);
    expect(index.firstRow({ src: 's1', catIdx: 2, chunk: 2 })).toBe(999);
    expect(index.firstRow({ src: 's2', catIdx: 4, chunk: 0 })).toBe(1198);
    expect(index.chunksFor(495, 1001).map(chunkId)).toEqual(['s1|2|0', 's1|2|1', 's1|2|2']);
    // Places step over the hidden ones: no other number moves.
    expect(index.place(0)).toBe(1200);
    expect(index.place(1)).toBe(1202);
    expect(index.place(2)).toBe(1);
    expect(index.place(499)).toBe(498);
    expect(index.place(500)).toBe(501);
    expect(index.place(1098)).toBe(1099);
    expect(index.place(1099)).toBe(1101);
    expect(index.place(1198)).toBe(1210);
    expect(index.rowOfPlace(1202)).toBe(1);
    expect(index.rowOfPlace(1)).toBe(2);
    expect(index.rowOfPlace(501)).toBe(500);
    expect(index.rowOfPlace(1101)).toBe(1099);
    expect(index.rowOfPlace(1199)).toBe(1197);
    for (const place of [1201, 0, 499, 500, 1100]) expect(index.rowOfPlace(place)).toBe(-1);
  });

  it("finds the row of a provider's address, and none for a hidden channel or one the list doesn't hold", () => {
    const index = new ChannelIndex(withHidden);
    const at = (src: string, catIdx: number, chunk: number, slot: number): number => index.rowOfStored({ src, catIdx, chunk, slot });
    expect(at('s1', 0, 0, 0)).toBe(0);
    expect(at('s1', 0, 0, 2)).toBe(1);
    expect(at('s1', 2, 0, 1)).toBe(2);
    expect(at('s1', 2, 0, 498)).toBe(499);
    expect(at('s1', 2, 1, 1)).toBe(500);
    expect(at('s1', 2, 2, 99)).toBe(1098);
    expect(at('s1', 2, 2, 101)).toBe(1099);
    expect(at('s1', 2, 2, 199)).toBe(1197);
    expect(at('s2', 4, 0, 1)).toBe(1199);
    // Hidden.
    for (const [chunk, slot] of [[0, 0], [0, 499], [1, 0], [2, 100]] as const) expect(at('s1', 2, chunk, slot)).toBe(-1);
    expect(at('s1', 0, 0, 1)).toBe(-1);
    // Past a chunk, a chunk or category the list doesn't have, another source.
    expect(at('s1', 2, 2, 200)).toBe(-1);
    expect(at('s1', 2, 3, 0)).toBe(-1);
    expect(at('s1', 2, -1, 0)).toBe(-1);
    expect(at('s1', 2, 0, -1)).toBe(-1);
    expect(at('s1', 1, 0, 0)).toBe(-1);
    expect(at('s3', 2, 0, 1)).toBe(-1);
  });

  it("gives a stored channel's place in its category, from the category's top for a chunk it doesn't have", () => {
    const part = withHidden[1]!;
    expect(storedOffset(part, 0, 7)).toBe(7);
    expect(storedOffset(part, 1, 0)).toBe(500);
    expect(storedOffset(part, 2, 150)).toBe(1150);
    expect(storedOffset(part, 3, 4)).toBe(4);
    expect(storedOffset(part, -1, 4)).toBe(4);
  });

  it('matches the flattened list for any categories and chunk sizes', () => {
    const part = fc.record({
      src: fc.constantFrom('s1', 's2', 's10'),
      catIdx: fc.nat(40),
      chunks: fc.array(fc.nat(7), { maxLength: 4 }),
      first: fc.nat(60),
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
        // Each row's place is its part's first plus its place in the part; a place's row is the first row with it.
        const places: number[] = [];
        for (const p of list) for (let k = 0; k < p.chunks.reduce((n, c) => n + c, 0); k += 1) places.push(p.first + k);
        for (let i = 0; i < rows.length; i += 1) expect(index.place(i)).toBe(places[i]);
        for (let q = -1; q <= 100; q += 1) expect(index.rowOfPlace(q)).toBe(places.indexOf(q));
      }),
    );
  });

  /** Every shown row, the slow way (step 36b): its served address, its place in the whole list, and where the provider stores it. */
  function shownRows(parts: readonly ListPart[]): { served: string; place: number; stored: { src: string; catIdx: number; chunk: number; slot: number } }[] {
    const out: { served: string; place: number; stored: { src: string; catIdx: number; chunk: number; slot: number } }[] = [];
    for (const part of parts) {
      const hidden = part.hidden ?? [];
      let offset = 0;
      part.chunks.forEach((size, chunk) => {
        let served = 0;
        for (let slot = 0; slot < size; slot += 1, offset += 1) {
          if (hidden.includes(offset)) continue;
          out.push({ served: `${part.src}|${part.catIdx}|${chunk}|${served}`, place: part.first + offset, stored: { src: part.src, catIdx: part.catIdx, chunk, slot } });
          served += 1;
        }
      });
    }
    return out;
  }

  it('matches the flattened list with hidden channels, for any categories, chunk sizes and hidden places (step 36b)', () => {
    const part = fc.record({
      src: fc.constantFrom('s1', 's2', 's10'),
      catIdx: fc.nat(40),
      chunks: fc.array(fc.nat(7), { maxLength: 4 }),
      gap: fc.nat(60),
      mask: fc.array(fc.boolean(), { maxLength: 28 }),
    });
    fc.assert(
      fc.property(fc.uniqueArray(part, { maxLength: 8, selector: (p) => `${p.src}|${p.catIdx}` }), fc.integer({ min: -5, max: 80 }), fc.integer({ min: -5, max: 80 }), (drawn, a, b) => {
        // Places as the provider's whole list gives them: apart, in an order other than the list's.
        const list: ListPart[] = drawn.map(({ gap, mask, ...p }, i) => {
          const total = p.chunks.reduce((n, c) => n + c, 0);
          const hidden: number[] = [];
          for (let k = 0; k < total; k += 1) if (mask[k] === true) hidden.push(k);
          const first = 100 * ((i * 3) % 8) + gap;
          return hidden.length === 0 ? { ...p, first } : { ...p, first, hidden };
        });
        const index = new ChannelIndex(list);
        const rows = shownRows(list);
        expect(index.count).toBe(rows.length);
        for (let i = -1; i <= rows.length; i += 1) expect(address(index.locate(i))).toBe(rows[i]?.served ?? null);
        const from = Math.min(a, b);
        const to = Math.max(a, b);
        const expected: string[] = [];
        for (const row of rows.slice(Math.max(0, from), Math.max(0, to))) {
          const id = row.served.slice(0, row.served.lastIndexOf('|'));
          if (expected[expected.length - 1] !== id) expected.push(id);
        }
        expect(index.chunksFor(from, to).map(chunkId)).toEqual(expected);
        for (let i = 0; i < rows.length; i += 1) {
          const at = index.locate(i)!;
          expect(index.firstRow(at) + at.slot).toBe(i);
          expect(index.place(i)).toBe(rows[i]!.place);
          expect(index.rowOfStored(rows[i]!.stored)).toBe(i);
        }
        for (let q = -1; q <= 800; q += 1) expect(index.rowOfPlace(q)).toBe(rows.findIndex((r) => r.place === q));
        // A hidden channel has no row, by its place or by where it is stored.
        for (const p of list) {
          let offset = 0;
          p.chunks.forEach((size, chunk) => {
            for (let slot = 0; slot < size; slot += 1, offset += 1) {
              if (!(p.hidden ?? []).includes(offset)) continue;
              expect(index.rowOfPlace(p.first + offset)).toBe(-1);
              expect(index.rowOfStored({ src: p.src, catIdx: p.catIdx, chunk, slot })).toBe(-1);
            }
          });
        }
      }),
    );
  });
});
