import { encodeQr } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import { QR_MAX_PX, QR_QUIET, qrModulePx, qrPath } from './pair-qr';

/** The QR code as drawn (RELAY step 31c2a): the path holds exactly the dark modules, in whole pixels. */

/** The modules a path draws, read back from its `M x y h n v1 h-n z` runs. */
function modulesOf(d: string, size: number): string[] {
  const grid: string[][] = [];
  for (let y = 0; y < size; y += 1) grid.push(new Array<string>(size).fill('0'));
  const run = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let consumed = 0;
  for (let m = run.exec(d); m !== null; m = run.exec(d)) {
    expect(m.index).toBe(consumed);
    consumed += m[0].length;
    const [x, y, n, back] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    expect(back).toBe(n);
    for (let i = 0; i < n; i += 1) {
      expect(grid[y - QR_QUIET]![x - QR_QUIET + i]).toBe('0');
      grid[y - QR_QUIET]![x - QR_QUIET + i] = '1';
    }
  }
  expect(consumed).toBe(d.length);
  return grid.map((row) => row.join(''));
}

describe('qrPath', () => {
  it('draws each run of dark modules as one rectangle, inside the quiet zone', () => {
    expect(qrPath(['101', '011', '000'])).toBe('M4 4h1v1h-1zM6 4h1v1h-1zM5 5h2v1h-2z');
    expect(qrPath(['111'])).toBe('M4 4h3v1h-3z');
    expect(qrPath(['000', ''])).toBe('');
    expect(qrPath([])).toBe('');
  });

  it("holds exactly a real code's dark modules", () => {
    const link = 'http://127.0.0.1:3100/p#c=ABCD2345&k=Xq3gjdcm0Jtm6P8oRu5WlQZb5Am2nYc7Vw7d8QZb3Aw';
    for (const version of [1, 5, 10]) {
      const qr = encodeQr(version === 1 ? 'LABLO' : link, { minVersion: version })!;
      expect(qr.version).toBe(version);
      expect(modulesOf(qrPath(qr.rows), qr.size)).toEqual(qr.rows);
    }
  });
});

describe('qrModulePx', () => {
  it('gives as many whole pixels per module as fit, the quiet zone included', () => {
    // Version 1 (21), the production link's version 5 (37), version 6 (41), version 10 (57).
    expect(qrModulePx(21)).toBe(15);
    expect(qrModulePx(37)).toBe(10);
    expect(qrModulePx(41)).toBe(9);
    expect(qrModulePx(57)).toBe(7);
    for (let size = 21; size <= 57; size += 4) expect((size + 2 * QR_QUIET) * qrModulePx(size)).toBeLessThanOrEqual(QR_MAX_PX);
    expect(qrModulePx(10_000)).toBe(1);
  });
});
