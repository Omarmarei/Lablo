/**
 * The QR code as the pairing screen draws it (RELAY step 31c2a): one SVG path of its dark modules
 * on a light square with a 4-module quiet zone (ISO/IEC 18004), each module a whole number of
 * pixels so no edge is blurred. The modules come from the pair worker (`encodeQr`'s `rows`: `1`
 * dark, `0` light). Never mirrored: a QR code read backwards doesn't scan.
 */

/** The light margin around the modules, in modules. */
export const QR_QUIET = 4;
/** The most pixels the drawn code may take on a side (the 1920x1080 canvas). */
export const QR_MAX_PX = 460;

/** The dark modules as one path in module units, the quiet zone included: a rectangle per run of a row. */
export function qrPath(rows: readonly string[]): string {
  let d = '';
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y]!;
    let x = 0;
    while (x < row.length) {
      if (row.charAt(x) !== '1') {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row.charAt(end) === '1') end += 1;
      const run = end - x;
      d += 'M' + (x + QR_QUIET) + ' ' + (y + QR_QUIET) + 'h' + run + 'v1h-' + run + 'z';
      x = end;
    }
  }
  return d;
}

/** The pixels per module for a code `size` modules wide: as many whole pixels as fit in `QR_MAX_PX`, at least 1. */
export function qrModulePx(size: number): number {
  return Math.max(1, Math.floor(QR_MAX_PX / (size + 2 * QR_QUIET)));
}
