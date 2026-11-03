/**
 * The design tokens that code needs as numbers (RELAY step 11). Sizes come from layout
 * constants, never from DOM measurements: Chromium 53 has no ResizeObserver, and measuring
 * fights the focus engine's index-based lists. styles/tokens.css holds the same values as
 * custom properties; test/ui-tokens.test.ts keeps the two equal.
 */

/** The TV canvas in CSS pixels, and its title-safe margins (5%). */
export const SCREEN = { width: 1920, height: 1080, safeX: 96, safeY: 54 } as const;

/** Sizes lists are built from: a list row, a rail chip, a poster or channel tile. */
export const LAYOUT = { rowHeight: 88, railHeight: 64, tileWidth: 264, tileHeight: 148 } as const;

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
    '--focus-ring': FOCUS_RING,
  };
  for (let n = 1; n < SPACE.length; n += 1) tokens[`--space-${n}`] = SPACE[n] ?? 0;
  return tokens;
}

/** How many fixed-size items fit in `extent` pixels: the `visible` of a focus-engine list. */
export function fits(extent: number, item: number, gap = 0): number {
  if (item <= 0) throw new RangeError('item size must be positive');
  return Math.max(0, Math.floor((extent + gap) / (item + gap)));
}
