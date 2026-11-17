import fc from 'fast-check';
import jsQR from 'jsqr';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { QR_CASES, checkQr, qrHash } from './check-qr';
import type { QrMatrix } from './qr';
import {
  QR_MAX_VERSION,
  alignmentPositions,
  dataCodewords,
  dataCodewordsFor,
  encodeQr,
  formatBits,
  gfMultiply,
  interleave,
  maskBit,
  penalty,
  qrFits,
  qrSize,
  rawDataModules,
  rsDivisor,
  rsRemainder,
  utf8Bytes,
  versionBits,
} from './qr';

/**
 * The QR encoder (RELAY step 31c1) against two oracles: `uqr` (Nayuki's encoder, which takes
 * the same choices: byte mode for a byte array, level M boosted, the lowest-penalty mask) must
 * give exactly the same modules, and `jsqr` (an independent decoder) must read every matrix
 * back to the same bytes. Then the standard's own numbers.
 */

/** Byte-mode capacities at M, Q and H for versions 1 to 10 (ISO/IEC 18004:2015 Table 7). */
const BYTE_CAPACITY: Record<'M' | 'Q' | 'H', readonly number[]> = {
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
};
const LEVEL_INDEX = { M: 0, Q: 1, H: 2 } as const;

/** A link as the TV shows it: production-like, and the development one (`?api=` origins). */
const KEY = 'q3mWr0Zt9xYbK2LhVd8sNfPeAj6cGu4oTy1iRk7wBzA';
const LINKS = [
  `https://lablo.app/p#c=7K3MZ9QX&k=${KEY}`,
  `http://127.0.0.1:3100/p#c=0123ABCD&k=${KEY}`,
  `http://127.0.0.1:54321/p#c=ZZZZZZZZ&k=${KEY}`,
];

function oracle(text: string, options: { mask?: number; minVersion?: number } = {}) {
  return encode(utf8Bytes(text), { ecc: 'M', boostEcc: true, border: 0, maskPattern: options.mask ?? -1, minVersion: options.minVersion ?? 1, maxVersion: QR_MAX_VERSION });
}

function rowsOf(data: readonly (readonly boolean[])[]): string[] {
  return data.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
}

/** The matrix as an RGBA image with a 4-module quiet zone, 4 pixels a module. */
function image(matrix: QrMatrix): { data: Uint8ClampedArray; width: number } {
  const scale = 4;
  const width = (matrix.size + 8) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.rows[y]![x] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = ((y + 4) * scale + dy) * width + (x + 4) * scale + dx;
          data.fill(0, at * 4, at * 4 + 3);
        }
      }
    }
  }
  return { data, width };
}

function decoded(matrix: QrMatrix): number[] | null {
  const { data, width } = image(matrix);
  const found = jsQR(data, width, width, { inversionAttempts: 'dontInvert' });
  return found === null ? null : found.binaryData;
}

/** A text of `n` bytes (ASCII, varied, so masks differ). */
function textOf(n: number, seed = 0): string {
  let out = '';
  for (let i = 0; i < n; i++) out += String.fromCharCode(33 + ((i * 7 + seed * 13) % 90));
  return out;
}

describe('utf8Bytes', () => {
  it('gives the bytes Node gives, a lone surrogate as U+FFFD', () => {
    for (const text of ['', 'a', 'لابلو', 'é€😀', 'x\uD800y', '\uDC00', 'end\uD83D', 'x\uD800\uE000', LINKS[0]!]) {
      expect(utf8Bytes(text), text).toEqual([...Buffer.from(text, 'utf8')]);
    }
  });

  it('takes one, two, three or four bytes at the right code points', () => {
    for (const text of ['\u007f', '\u0080', '\u07ff', '\u0800', '\uffff', '\ud800\udc00', '\udbff\udfff']) {
      expect(utf8Bytes(text), text.charCodeAt(0).toString(16)).toEqual([...Buffer.from(text, 'utf8')]);
    }
    expect(['\u007f', '\u0080', '\u07ff', '\u0800', '\uffff', '\ud800\udc00'].map((t) => utf8Bytes(t).length)).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it('agrees with Node on any string', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        expect(utf8Bytes(text)).toEqual([...Buffer.from(text, 'utf8')]);
      }),
    );
  });
});

describe('the standard numbers', () => {
  it('sizes and raw modules', () => {
    expect(qrSize(1)).toBe(21);
    expect(qrSize(10)).toBe(57);
    // Total codewords per version (Table 9): 26, 44, 70, 100, 134, 172, 196, 242, 292, 346.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => Math.floor(rawDataModules(v) / 8))).toEqual([26, 44, 70, 100, 134, 172, 196, 242, 292, 346]);
    // Remainder bits: 0 for version 1, 7 for 2 to 6, 0 for 7 to 10.
    expect([1, 2, 6, 7, 10].map((v) => rawDataModules(v) % 8)).toEqual([0, 7, 7, 0, 0]);
  });

  it("the byte capacity of each version at M, Q and H", () => {
    for (const level of ['M', 'Q', 'H'] as const) {
      for (let v = 1; v <= 10; v++) {
        const bits = dataCodewords(v, LEVEL_INDEX[level]) * 8 - 4 - (v <= 9 ? 8 : 16);
        expect(Math.floor(bits / 8), `${v}-${level}`).toBe(BYTE_CAPACITY[level][v - 1]);
      }
    }
  });

  it('alignment pattern centres (Annex E)', () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(6)).toEqual([6, 34]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(8)).toEqual([6, 24, 42]);
    expect(alignmentPositions(9)).toEqual([6, 26, 46]);
    expect(alignmentPositions(10)).toEqual([6, 28, 50]);
  });

  it('format bits (Annex C, Table C.1)', () => {
    expect(formatBits(0, 0)).toBe(0b101010000010010);
    expect(formatBits(0, 5)).toBe(0b100000011001110);
    expect(formatBits(0, 7)).toBe(0b100101010100000);
    expect(formatBits(1, 0)).toBe(0b011010101011111);
    expect(formatBits(1, 5)).toBe(0b010000110000011);
    expect(formatBits(2, 0)).toBe(0b001011010001001);
    expect(formatBits(2, 7)).toBe(0b000100000111011);
  });

  it('version bits (Annex D, Table D.1)', () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(8)).toBe(0x085bc);
    expect(versionBits(9)).toBe(0x09a99);
    expect(versionBits(10)).toBe(0x0a4d3);
  });

  it('GF(256) products and the generator polynomial', () => {
    expect(gfMultiply(0, 0x53)).toBe(0);
    expect(gfMultiply(1, 0x53)).toBe(0x53);
    expect(gfMultiply(0x80, 2)).toBe(0x1d);
    expect(gfMultiply(0x53, 0xca)).toBe(gfMultiply(0xca, 0x53));
    // x^7 + 127x^6 + 122x^5 + 154x^4 + 164x^3 + 11x^2 + 68x + 117 (Annex A, 7 codewords).
    expect(rsDivisor(7)).toEqual([127, 122, 154, 164, 11, 68, 117]);
    expect(rsDivisor(1)).toEqual([1]);
  });

  it("the standard's 1-M example: its data codewords give its error correction", () => {
    // ISO/IEC 18004 Annex I ("01234567" in numeric mode, version 1-M).
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
    // One block: the data, then its error correction.
    expect(interleave(data, 1, 0)).toEqual(data.concat([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]));
  });

  it('pads the data with 0xEC and 0x11 after a terminator', () => {
    // "A" at 1-M: 0100 00000001 01000001 0000, then the pad bytes up to 16.
    expect(dataCodewordsFor([0x41], 1, 0)).toEqual([0x40, 0x14, 0x10, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
    // Version 10 counts in 16 bits.
    expect(dataCodewordsFor([0x41], 10, 0).slice(0, 4)).toEqual([0x40, 0x00, 0x14, 0x10]);
    // 14 bytes fill 1-M but its last 4 bits: the terminator takes them, and no pad byte follows.
    const bytes = utf8Bytes(textOf(14));
    const full = dataCodewordsFor(bytes, 1, 0);
    expect(full).toHaveLength(16);
    expect(full[15]).toBe((bytes[13]! & 0x0f) << 4);
    // 2-M holds 28 data codewords: 26 bytes take 4 + 8 + 208 bits, then 4 terminator bits, no pad byte.
    const two = dataCodewordsFor(utf8Bytes(textOf(26)), 2, 0);
    expect(two).toHaveLength(28);
    expect(two[27]).toBe((utf8Bytes(textOf(26))[25]! & 0x0f) << 4);
  });

  it('the eight masks (Table 10) at a few modules', () => {
    const at = (x: number, y: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((m) => (maskBit(m, x, y) ? 1 : 0)).join('');
    expect(at(0, 0)).toBe('11111111');
    expect(at(1, 0)).toBe('01001110');
    expect(at(1, 1)).toBe('10001010');
    expect(at(2, 1)).toBe('00011010');
    expect(at(3, 2)).toBe('01101110');
    expect(at(2, 3)).toBe('00000110');
    expect(at(5, 4)).toBe('01010010');
    expect(at(1, 3)).toBe('10000001');
  });
});

describe('encodeQr against uqr', () => {
  it('the same modules for every version from 1 to 10 under each of the eight masks', () => {
    for (let v = 1; v <= 10; v++) {
      // Fills most of the version at M, so the level stays M and the data reaches the last blocks.
      const text = textOf(BYTE_CAPACITY.M[v - 1]! - 1, v);
      for (let mask = 0; mask < 8; mask++) {
        const ours = encodeQr(text, { mask })!;
        const theirs = oracle(text, { mask });
        expect([ours.version, ours.mask, ours.size], `${v}/${mask}`).toEqual([theirs.version, theirs.maskPattern, theirs.size]);
        expect(ours.rows, `${v}/${mask}`).toEqual(rowsOf(theirs.data));
      }
    }
  });

  it('the same version, level boost, mask and modules for the pairing links', () => {
    for (const link of LINKS) {
      const ours = encodeQr(link)!;
      const theirs = oracle(link);
      expect(ours.version).toBe(theirs.version);
      expect(ours.mask).toBe(theirs.maskPattern);
      expect(ours.rows).toEqual(rowsOf(theirs.data));
    }
    // A production link (76 bytes) is a version 5 code at level M.
    expect(encodeQr(LINKS[0]!)).toMatchObject({ version: 5, level: 'M', size: 37 });
  });

  it('the same choices for any text that fits', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 70 }), (text) => {
        fc.pre(utf8Bytes(text).length <= 213);
        const ours = encodeQr(text)!;
        const theirs = oracle(text);
        expect(ours.mask).toBe(theirs.maskPattern);
        expect(ours.rows).toEqual(rowsOf(theirs.data));
      }),
      { numRuns: 150 },
    );
  });

  it('a smallest version on request (the tests above use it)', () => {
    const ours = encodeQr('A', { minVersion: 3, mask: 2 })!;
    expect(ours.version).toBe(3);
    expect(ours.rows).toEqual(rowsOf(oracle('A', { minVersion: 3, mask: 2 }).data));
  });
});

describe('encodeQr', () => {
  it('raises the level to Q or H when the text still fits the same version', () => {
    expect(encodeQr('A')).toMatchObject({ version: 1, level: 'H' });
    expect(encodeQr(textOf(BYTE_CAPACITY.H[0]!))).toMatchObject({ version: 1, level: 'H' });
    expect(encodeQr(textOf(BYTE_CAPACITY.H[0]! + 1))).toMatchObject({ version: 1, level: 'Q' });
    expect(encodeQr(textOf(BYTE_CAPACITY.Q[0]!))).toMatchObject({ version: 1, level: 'Q' });
    expect(encodeQr(textOf(BYTE_CAPACITY.Q[0]! + 1))).toMatchObject({ version: 1, level: 'M' });
  });

  it('takes the next version at each capacity, and null past version 10', () => {
    for (let v = 1; v <= 10; v++) {
      expect(encodeQr(textOf(BYTE_CAPACITY.M[v - 1]!))!.version, `${v}`).toBe(v);
      if (v < 10) expect(encodeQr(textOf(BYTE_CAPACITY.M[v - 1]! + 1))!.version, `${v}+1`).toBe(v + 1);
    }
    expect(encodeQr(textOf(213))!.version).toBe(10);
    expect(encodeQr(textOf(214))).toBeNull();
    // The limit is in bytes: 107 Arabic letters are 214 bytes.
    expect(encodeQr('ل'.repeat(106))!.version).toBe(10);
    expect(encodeQr('ل'.repeat(107))).toBeNull();
  });

  it('draws the function patterns: finders, timing, the dark module', () => {
    const qr = encodeQr(LINKS[1]!)!;
    const n = qr.size;
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    for (let i = 0; i < 7; i++) {
      expect(qr.rows[i]!.slice(0, 7)).toBe(finder[i]);
      expect(qr.rows[i]!.slice(n - 7)).toBe(finder[i]);
      expect(qr.rows[n - 7 + i]!.slice(0, 7)).toBe(finder[i]);
    }
    // Separators are light.
    expect(qr.rows[7]!.slice(0, 8)).toBe('00000000');
    for (let i = 8; i < n - 8; i++) {
      expect(qr.rows[6]![i], `timing row ${i}`).toBe(i % 2 === 0 ? '1' : '0');
      expect(qr.rows[i]![6], `timing column ${i}`).toBe(i % 2 === 0 ? '1' : '0');
    }
    expect(qr.rows[n - 8]![8]).toBe('1');
  });

  it('takes the first of two masks with the same lowest penalty, as uqr does', () => {
    // Found by artifacts/qr-ties31c1.ts: the best two masks tie on these texts.
    for (const [text, tied] of [
      ['tie77', [0, 1]],
      ['tie129', [5, 6]],
      ['tie352', [1, 6]],
    ] as const) {
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => penalty(grid(encodeQr(text, { mask })!.rows)));
      expect(scores[tied[0]], text).toBe(Math.min(...scores));
      expect(scores[tied[1]], text).toBe(scores[tied[0]]);
      expect(encodeQr(text)!.mask, text).toBe(tied[0]);
      expect(oracle(text).maskPattern, text).toBe(tied[0]);
    }
  });

  it('qrFits: up to 213 bytes', () => {
    expect(qrFits(textOf(213))).toBe(true);
    expect(qrFits(textOf(214))).toBe(false);
    expect(qrFits('ل'.repeat(106))).toBe(true);
    expect(qrFits('ل'.repeat(107))).toBe(false);
    expect(qrFits('')).toBe(true);
  });

  it('picks the lowest penalty, the first of equals', () => {
    const text = LINKS[2]!;
    const chosen = encodeQr(text)!;
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => penalty(grid(encodeQr(text, { mask })!.rows)));
    expect(chosen.mask).toBe(scores.indexOf(Math.min(...scores)));
  });
});

/**
 * The penalty rules read straight from the standard, as run lengths: N1 for each run of five or
 * more in a line, N2 for each 2x2 block of one colour, N3 for each dark-light-dark-dark-dark-
 * light-dark run of 1:1:3:1:1 with four times its module width of light on one side (the quiet
 * zone counts as light), N4 for each 5% the dark share is away from half.
 */
function referenceParts(rows: readonly string[]): { n1: number; n2: number; n3: number; n4: number } {
  const size = rows.length;
  const lines: string[] = rows.slice();
  for (let x = 0; x < size; x++) lines.push(rows.map((row) => row[x]).join(''));
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  const runsOf = (line: string): Array<{ dark: boolean; n: number }> => {
    const runs: Array<{ dark: boolean; n: number }> = [];
    for (const c of line) {
      const last = runs[runs.length - 1];
      if (last !== undefined && last.dark === (c === '1')) last.n++;
      else runs.push({ dark: c === '1', n: 1 });
    }
    return runs;
  };
  for (const line of lines) {
    for (const run of runsOf(line)) if (run.n >= 5) n1 += 3 + (run.n - 5);
    const padded = runsOf('0'.repeat(size) + line + '0'.repeat(size));
    for (let i = 0; i + 6 < padded.length; i++) {
      const r = padded.slice(i, i + 7);
      if (r[0]!.dark) continue;
      const n = r[1]!.n;
      if (r[2]!.n !== n || r[3]!.n !== 3 * n || r[4]!.n !== n || r[5]!.n !== n) continue;
      if (r[0]!.n >= 4 * n && r[6]!.n >= n) n3 += 40;
      if (r[6]!.n >= 4 * n && r[0]!.n >= n) n3 += 40;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = rows[y]![x];
      if (c === '1') dark++;
      if (x + 1 < size && y + 1 < size && c === rows[y]![x + 1] && c === rows[y + 1]![x] && c === rows[y + 1]![x + 1]) n2 += 3;
    }
  }
  const total = size * size;
  return { n1, n2, n3, n4: (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10 };
}

function referencePenalty(rows: readonly string[]): number {
  const parts = referenceParts(rows);
  return parts.n1 + parts.n2 + parts.n3 + parts.n4;
}

const grid = (rows: readonly string[]) => rows.map((row) => row.split('').map((c) => c === '1'));

/** A checkerboard of odd `size` whose first module is `first`. */
function board(size: number, first: '0' | '1'): string[] {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) row += (x + y) % 2 === 0 ? first : first === '1' ? '0' : '1';
    rows.push(row);
  }
  return rows;
}

describe('penalty', () => {
  it('an all-light 5x5: ten runs of five, sixteen blocks, no dark modules', () => {
    const light = ['00000', '00000', '00000', '00000', '00000'];
    expect(penalty(grid(light))).toBe(30 + 48 + 90);
    expect(referencePenalty(light)).toBe(30 + 48 + 90);
  });

  it('each rule alone, on a checkerboard', () => {
    // 25 of 49 dark: k = 0, and no runs or blocks.
    const base = board(7, '1');
    expect(penalty(grid(base))).toBe(0);
    // A run of six in the first row: 3 + 1; the share moves to 27 of 49 (k = 1).
    expect(penalty(grid(['1111110'].concat(base.slice(1))))).toBe(4 + 10);
    // One 2x2 block (two light modules turned dark): 3; and 27 of 49 dark (k = 1).
    expect(penalty(grid(['1110101', '0111010'].concat(base.slice(2))))).toBe(3 + 10);
  });

  it('a finder-like run with four light modules before it, and the quiet zone after it', () => {
    // Row 0 of 11: 0000 1011101; on its own the light run before is 4 (+ the quiet zone, 15).
    const rows = ['00001011101'].concat(board(11, '0').slice(1));
    expect(referenceParts(rows).n3).toBe(80);
    expect(penalty(grid(rows))).toBe(referencePenalty(rows));
    // Three light modules before it, the quiet zone beyond them: still both sides (80).
    const three = ['0001011101' + '0'].concat(board(11, '0').slice(1));
    expect(referenceParts(three).n3).toBe(80);
    const inside = ['10001011101'].concat(board(11, '0').slice(1));
    expect(referenceParts(inside).n3).toBe(40);
    expect(penalty(grid(inside))).toBe(referencePenalty(inside));
  });

  it('agrees with the reference on any odd-sized grid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }).chain((half) =>
          fc.array(fc.array(fc.boolean(), { minLength: half * 2 + 1, maxLength: half * 2 + 1 }), { minLength: half * 2 + 1, maxLength: half * 2 + 1 }),
        ),
        (cells) => {
          const rows = cells.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
          expect(penalty(grid(rows))).toBe(referencePenalty(rows));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('agrees with the reference on finder-like lines, scaled up to three modules wide', () => {
    for (const scale of [1, 2, 3]) {
      for (const before of [0, 1, 3, 4, 7, 12]) {
        const core = ['1', '0', '111', '0', '1'].map((part) => part.repeat(scale)).join('');
        for (const after of [0, 1, 3, 4, 12]) {
          const line = '0'.repeat(before) + core + '0'.repeat(after);
          if (line.length % 2 === 0) continue;
          const rows = [line].concat(board(line.length, '0').slice(1));
          expect(penalty(grid(rows)), `${scale}/${before}/${after}`).toBe(referencePenalty(rows));
          const column = rows.map((_, y) => rows.map((row) => row[y]).join(''));
          expect(penalty(grid(column)), `column ${scale}/${before}/${after}`).toBe(referencePenalty(column));
        }
      }
    }
  });

  it('needs a module width of light on the short side: a scaled pattern with too little light, then a dark module', () => {
    for (const scale of [2, 3]) {
      const core = ['1', '0', '111', '0', '1'].map((part) => part.repeat(scale)).join('');
      for (const after of [1, scale - 1, scale]) {
        // Four widths of light before it; then `after` light modules and a dark one, inside the line.
        let line = '0'.repeat(4 * scale) + core + '0'.repeat(after) + '1';
        if (line.length % 2 === 0) line += '0';
        const rows = [line].concat(board(line.length, '0').slice(1));
        const counted = referenceParts(rows).n3 > 0;
        expect([after, counted], `${scale}/${after}`).toEqual([after, after >= scale]);
        expect(penalty(grid(rows)), `${scale}/${after}`).toBe(referencePenalty(rows));
      }
    }
  });

  it('agrees with the reference on every mask of the links', () => {
    for (const link of LINKS) {
      for (let mask = 0; mask < 8; mask++) {
        const rows = encodeQr(link, { mask })!.rows;
        expect(penalty(grid(rows)), `${mask}`).toBe(referencePenalty(rows));
      }
    }
  });
});

describe('every matrix reads back', () => {
  it('jsqr decodes each version and each link to the same bytes', () => {
    const texts = LINKS.slice();
    for (let v = 1; v <= 10; v++) texts.push(textOf(BYTE_CAPACITY.M[v - 1]!, v + 3));
    texts.push('لابلو: https://lablo.app/p', 'é€😀');
    for (const text of texts) {
      const qr = encodeQr(text)!;
      expect(decoded(qr), `${text.length} characters, version ${qr.version}`).toEqual(utf8Bytes(text));
    }
  });

  it('jsqr decodes under every mask', () => {
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeQr(LINKS[0]!, { mask })!;
      expect(decoded(qr), `mask ${mask}`).toEqual(utf8Bytes(LINKS[0]!));
    }
  });
});

describe('checkQr (the vectors page)', () => {
  it("passes in Node, and each case's version, mask and hash are uqr's", () => {
    expect(checkQr().filter((r) => !r.ok)).toEqual([]);
    expect(checkQr().map((r) => r.name)).toEqual(QR_CASES.map((c) => `qr: ${c.name}`));
    for (const c of QR_CASES) {
      const theirs = oracle(c.text);
      expect([theirs.version, theirs.maskPattern, qrHash(rowsOf(theirs.data))], c.name).toEqual([c.version, c.mask, c.hash]);
    }
  });

  it('reports a case whose modules, version or mask differ, or that does not fit', () => {
    const base = QR_CASES[1]!;
    const results = checkQr([
      { ...base, hash: 'x' },
      { ...base, mask: (base.mask + 1) % 8 },
      { ...base, version: base.version + 1 },
      { ...base, text: textOf(214) },
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, false, false]);
    expect(results[0]!.detail).toBe(`modules hash ${base.hash}, expected x`);
    expect(results[1]!.detail).toBe(`version 5 mask ${base.mask}, expected 5 and ${(base.mask + 1) % 8}`);
    expect(results[2]!.detail).toBe(`version 5 mask ${base.mask}, expected 6 and ${base.mask}`);
    expect(results[3]!.detail).toBe('did not fit');
  });
});
