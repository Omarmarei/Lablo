/**
 * A QR code encoder for the TV's pairing screen (RELAY step 31c1, architecture.md §3.3 A): the
 * link `<domain>/p#c=<code>&k=<tvPk>` as a matrix of modules, which the screen draws.
 *
 * Only what that link needs, after ISO/IEC 18004:2015: byte mode (the text's UTF-8 bytes),
 * versions 1 to 10 (up to 213 bytes at level M), error correction M raised to Q or H when the
 * text still fits the same version (a TV screen is photographed from across a room, at an
 * angle), and the mask with the lowest penalty under the standard's four rules. Two oracles prove
 * it in `qr.test.ts`: `uqr` (Nayuki's encoder) gives the same modules for the same text, version
 * and mask, and `jsqr` (an independent decoder) reads every matrix back.
 *
 * Plain ES2017 with number arrays and index loops on purpose: it runs in a Chromium 53 worker,
 * and Babel adds a core-js module for every API name a TV file mentions (typed arrays,
 * `Array.from`, `fill`, `map`, `shift`), whether or not the engine needs it.
 */

/** A QR code's modules: `rows[y][x]` is `1` (dark) or `0` (light). No quiet zone around it. */
export interface QrMatrix {
  /** Modules per side: 21 for version 1, four more for each version after it. */
  readonly size: number;
  /** 1 to 10. */
  readonly version: number;
  /** The error correction level used: M, or Q or H when the text fits the same version. */
  readonly level: QrLevel;
  /** The mask pattern drawn, 0 to 7. */
  readonly mask: number;
  readonly rows: readonly string[];
}

export type QrLevel = 'M' | 'Q' | 'H';

/** The largest version this encoder makes (213 bytes at level M). */
export const QR_MAX_VERSION = 10;

/** The levels from M up, with their two format bits (ISO/IEC 18004 Table C.1). */
const LEVELS: readonly QrLevel[] = ['M', 'Q', 'H'];
const FORMAT_BITS: readonly number[] = [0, 3, 2];

/** Error correction codewords per block, by level (M, Q, H) and version (index 0 unused). */
const ECC_PER_BLOCK: readonly (readonly number[])[] = [
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];

/** Error correction blocks, by level (M, Q, H) and version (index 0 unused). */
const BLOCKS: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** A string's UTF-8 bytes (a lone surrogate becomes U+FFFD, as `TextEncoder` does). */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        c = 0xfffd;
      }
    }
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

/** Modules per side of a version. */
export function qrSize(version: number): number {
  return version * 4 + 17;
}

/** The modules left for data and error correction once the function patterns are drawn. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Data codewords of a version at a level (index into `LEVELS`). */
export function dataCodewords(version: number, level: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[level]![version]! * BLOCKS[level]![version]!;
}

/** Bits a byte-mode segment of `bytes` bytes takes in a version: the mode, the count, the data. */
function segmentBits(version: number, bytes: number): number {
  return 4 + (version <= 9 ? 8 : 16) + bytes * 8;
}

/** The centres of a version's alignment patterns along one axis (none for version 1). */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(0);
  out[0] = 6;
  let pos = qrSize(version) - 7;
  for (let i = count - 1; i >= 1; i--) {
    out[i] = pos;
    pos -= step;
  }
  return out;
}

/** GF(2^8) product modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The Reed-Solomon generator polynomial of `degree`, its leading 1 left out, highest term first. */
export function rsDivisor(degree: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The error correction codewords of `data` for a divisor from `rsDivisor`. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const n = divisor.length;
  const result: number[] = [];
  for (let i = 0; i < n; i++) result.push(0);
  for (let d = 0; d < data.length; d++) {
    const factor = data[d]! ^ result[0]!;
    for (let i = 0; i + 1 < n; i++) result[i] = result[i + 1]!;
    result[n - 1] = 0;
    for (let i = 0; i < n; i++) result[i] = result[i]! ^ gfMultiply(divisor[i]!, factor);
  }
  return result;
}

/** The 15 format bits of a level (index into `LEVELS`) and mask, BCH-coded and masked. */
export function formatBits(level: number, mask: number): number {
  const data = (FORMAT_BITS[level]! << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up), BCH-coded. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function bit(value: number, i: number): boolean {
  return ((value >>> i) & 1) !== 0;
}

/** The data codewords: mode, count, bytes, terminator, then the pad bytes 0xEC and 0x11. */
export function dataCodewordsFor(bytes: readonly number[], version: number, level: number): number[] {
  const capacity = dataCodewords(version, level) * 8;
  const bits: number[] = [];
  const append = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0x4, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) append(bytes[i]!, 8);
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    out.push(byte);
  }
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** The final codeword sequence: the data split into blocks, each with its error correction, interleaved. */
export function interleave(data: readonly number[], version: number, level: number): number[] {
  const blocks = BLOCKS[level]![version]!;
  const eccLength = ECC_PER_BLOCK[level]![version]!;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const all: number[][] = [];
  let k = 0;
  for (let i = 0; i < blocks; i++) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block: number[] = [];
    for (let j = 0; j < length; j++) block.push(data[k + j]!);
    k += length;
    const ecc = rsRemainder(block, divisor);
    // A short block takes a placeholder, so every block's error correction lines up.
    if (i < shortBlocks) block.push(0);
    for (let j = 0; j < ecc.length; j++) block.push(ecc[j]!);
    all.push(block);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    for (let j = 0; j < all.length; j++) {
      if (i !== shortLength - eccLength || j >= shortBlocks) out.push(all[j]![i]!);
    }
  }
  return out;
}

/** True when the module at (x, y) is dark under `mask`. */
export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** A matrix being drawn: the modules, and which of them belong to function patterns. */
interface Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
}

function newGrid(size: number): Grid {
  const dark: boolean[][] = [];
  const fixed: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const a: boolean[] = [];
    const b: boolean[] = [];
    for (let x = 0; x < size; x++) {
      a.push(false);
      b.push(false);
    }
    dark.push(a);
    fixed.push(b);
  }
  return { size, dark, fixed };
}

function setFunction(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.dark[y]![x] = dark;
  grid.fixed[y]![x] = true;
}

/** A finder pattern centred at (x, y), with its light separator inside the matrix. */
function drawFinder(grid: Grid, x: number, y: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && xx < grid.size && yy >= 0 && yy < grid.size) setFunction(grid, xx, yy, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(grid: Grid, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) setFunction(grid, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
}

/** Both copies of the format bits, and the dark module beside the bottom-left finder. */
function drawFormat(grid: Grid, level: number, mask: number): void {
  const bits = formatBits(level, mask);
  const size = grid.size;
  for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(bits, i));
  setFunction(grid, 8, 7, bit(bits, 6));
  setFunction(grid, 8, 8, bit(bits, 7));
  setFunction(grid, 7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) setFunction(grid, size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) setFunction(grid, 8, size - 15 + i, bit(bits, i));
  setFunction(grid, 8, size - 8, true);
}

function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, a, b, bit(bits, i));
    setFunction(grid, b, a, bit(bits, i));
  }
}

function drawFunctionPatterns(grid: Grid, version: number, level: number): void {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      // Not over the three finders' corners.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      drawAlignment(grid, positions[i]!, positions[j]!);
    }
  }
  // Reserves the format modules; the real bits go in once the mask is chosen.
  drawFormat(grid, level, 0);
  drawVersion(grid, version);
}

/** The codewords' bits in the standard's zigzag: two columns at a time from the right, up then down. */
function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing pattern's column is skipped.
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!grid.fixed[y]![x] && i < codewords.length * 8) {
          grid.dark[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
        // Remainder bits (when the modules outnumber the codewords' bits) stay light.
      }
    }
  }
}

/** Flips every data module the mask covers (twice undoes it). */
function applyMask(grid: Grid, mask: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.fixed[y]![x] && maskBit(mask, x, y)) grid.dark[y]![x] = !grid.dark[y]![x];
    }
  }
}

/** Shifts a run length into the history of the last seven runs, newest first. */
function addRun(length: number, history: number[], size: number): void {
  // The first run is preceded by the light quiet zone.
  const run = history[0] === 0 ? length + size : length;
  for (let i = history.length - 1; i > 0; i--) history[i] = history[i - 1]!;
  history[0] = run;
}

/** 0, 1 or 2: finder-like 1:1:3:1:1 runs with four light modules before or after them. */
function finderLike(history: readonly number[]): number {
  const n = history[1]!;
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) + (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0);
}

/** The finder-like runs at a line's end, the quiet zone after it counted as light. */
function finderLikeAtEnd(dark: boolean, length: number, history: number[], size: number): number {
  let run = length;
  if (dark) {
    addRun(run, history, size);
    run = 0;
  }
  addRun(run + size, history, size);
  return finderLike(history);
}

/** The penalty of one line (a row, or a column with `column`): long runs (N1) and finder-like runs (N3). */
function linePenalty(grid: Grid, line: number, column: boolean): number {
  const size = grid.size;
  let result = 0;
  let color = false;
  let run = 0;
  const history = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < size; i++) {
    const dark = column ? grid.dark[i]![line]! : grid.dark[line]![i]!;
    if (dark === color) {
      run++;
      if (run === 5) result += PENALTY_N1;
      else if (run > 5) result++;
    } else {
      addRun(run, history, size);
      if (!color) result += finderLike(history) * PENALTY_N3;
      color = dark;
      run = 1;
    }
  }
  return result + finderLikeAtEnd(color, run, history, size) * PENALTY_N3;
}

/** The standard's penalty score of a masked matrix (lower is better). */
export function penalty(dark: readonly (readonly boolean[])[]): number {
  const size = dark.length;
  const grid: Grid = { size, dark: dark as boolean[][], fixed: [] };
  let result = 0;
  for (let i = 0; i < size; i++) result += linePenalty(grid, i, false) + linePenalty(grid, i, true);
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const here = dark[y]![x]!;
      if (here) count++;
      if (x + 1 < size && y + 1 < size && here === dark[y]![x + 1] && here === dark[y + 1]![x] && here === dark[y + 1]![x + 1]) result += PENALTY_N2;
    }
  }
  // N4: 10 points for each 5% the dark share is away from 50% (k = 0 within 45%-55%).
  const total = size * size;
  const k = Math.ceil(Math.abs(count * 20 - total * 10) / total) - 1;
  return result + k * PENALTY_N4;
}

/** The text fits a QR code this encoder makes: its UTF-8 bytes at level M in version 10 (213 bytes). */
export function qrFits(text: string): boolean {
  return segmentBits(QR_MAX_VERSION, utf8Bytes(text).length) <= dataCodewords(QR_MAX_VERSION, 0) * 8;
}

export interface QrOptions {
  /** Draws this mask (0 to 7) instead of the one with the lowest penalty (the tests). */
  readonly mask?: number;
  /** The smallest version to use (the tests); default 1. */
  readonly minVersion?: number;
}

/**
 * `text` as a QR code: the smallest version from 1 to 10 that holds its UTF-8 bytes at level M
 * (raised to Q or H when they fit the same version), with the lowest-penalty mask. `null` when it
 * doesn't fit version 10.
 */
export function encodeQr(text: string, options: QrOptions = {}): QrMatrix | null {
  const bytes = utf8Bytes(text);
  let version = Math.max(1, options.minVersion ?? 1);
  while (version <= QR_MAX_VERSION && segmentBits(version, bytes.length) > dataCodewords(version, 0) * 8) version++;
  if (version > QR_MAX_VERSION) return null;
  let level = 0;
  while (level + 1 < LEVELS.length && segmentBits(version, bytes.length) <= dataCodewords(version, level + 1) * 8) level++;

  const grid = newGrid(qrSize(version));
  drawFunctionPatterns(grid, version, level);
  drawCodewords(grid, interleave(dataCodewordsFor(bytes, version, level), version, level));

  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(grid, m);
      drawFormat(grid, level, m);
      const score = penalty(grid.dark);
      if (score < best) {
        best = score;
        mask = m;
      }
      applyMask(grid, m);
    }
  }
  applyMask(grid, mask);
  drawFormat(grid, level, mask);

  const rows: string[] = [];
  for (let y = 0; y < grid.size; y++) {
    let row = '';
    for (let x = 0; x < grid.size; x++) row += grid.dark[y]![x] ? '1' : '0';
    rows.push(row);
  }
  return { size: grid.size, version, level: LEVELS[level]!, mask, rows };
}
