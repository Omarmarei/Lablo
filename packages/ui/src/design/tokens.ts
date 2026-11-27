/**
 * The design tokens that code needs as numbers (RELAY step 11). Sizes come from layout
 * constants, never from DOM measurements: Chromium 53 has no ResizeObserver, and measuring
 * fights the focus engine's index-based lists. styles/tokens.css holds the same values as
 * custom properties; test/ui-tokens.test.ts keeps the two equal.
 */

/** The TV canvas in CSS pixels, and its title-safe margins (5%). */
export const SCREEN = { width: 1920, height: 1080, safeX: 96, safeY: 54 } as const;

/** Sizes lists are built from: a list row, a rail chip, a channel tile, a poster tile (2:3, RELAY step 26a). */
export const LAYOUT = { rowHeight: 88, railHeight: 64, tileWidth: 264, tileHeight: 148, posterWidth: 184, posterHeight: 276 } as const;

/** The 4 px spacing grid: SPACE[n] is `--space-n`. */
export const SPACE = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;

export const FOCUS_RING = 4;

/** The CSS custom property each number above is in styles/tokens.css. */
export function pxTokens(): Record<string, number> {
  const tokens: Record<string, number> = {
    '--screen-width': SCREEN.width,
    '--screen-height': SCREEN.height,
    '--safe-x': SCREEN.safeX,
    '--safe-y': SCREEN.safeY,
    '--row-height': LAYOUT.rowHeight,
    '--rail-height': LAYOUT.railHeight,
    '--tile-width': LAYOUT.tileWidth,
    '--tile-height': LAYOUT.tileHeight,
    '--poster-width': LAYOUT.posterWidth,
    '--poster-height': LAYOUT.posterHeight,
    '--focus-ring': FOCUS_RING,
  };
  for (let n = 1; n < SPACE.length; n += 1) tokens[`--space-${n}`] = SPACE[n] ?? 0;
  return tokens;
}

/**
 * "Larger text" (RELAY steps 43 and 58a): the text is about a quarter bigger, so a vertical list
 * shows about a quarter fewer rows, each taller, in the same box (nothing beside the list moves).
 * A row's text then fits its row in both languages (e2e/text-fit.spec.ts). Main sets the scale
 * with the text size; the focus engine (`zones.ts`) and `VirtualList` read it, so the rows the
 * focus scrolls through are the rows drawn. Horizontal lists and grids keep their sizes.
 */
export const LARGE_TEXT_ROWS = 1.25;

let rowScale = 1;

/** The rows' scale: `LARGE_TEXT_ROWS` with larger text, 1 without. */
export function setRowScale(scale: number): void {
  rowScale = scale > 1 ? scale : 1;
}

/** The rows a vertical list laid out for `visible` rows shows at the current scale (at least one). */
export function shownRows(visible: number): number {
  return Math.max(1, Math.floor(visible / rowScale));
}

/** The size of each of those rows: the list's box (`visible` rows of `size`, `gap` apart) shared among them. */
export function shownRowSize(visible: number, size: number, gap = 0): number {
  const shown = shownRows(visible);
  return shown === visible ? size : Math.floor((visible * (size + gap)) / shown) - gap;
}

/** How many fixed-size items fit in `extent` pixels: the `visible` of a focus-engine list. */
export function fits(extent: number, item: number, gap = 0): number {
  if (item <= 0) throw new RangeError('item size must be positive');
  return Math.max(0, Math.floor((extent + gap) / (item + gap)));
}
