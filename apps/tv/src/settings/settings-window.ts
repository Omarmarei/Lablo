import type { ListWindow } from '@lablo/ui';
import { SCREEN, fits, listWindow, shownRowSize, shownRows } from '@lablo/ui';

/**
 * The settings pages' rows: their size and how many are in view (step 38c1's settings list; step
 * 39d's "Player" page, whose eighth row made it scroll too). Its own module so that the "Player"
 * page needs nothing from `settings-state.ts`, which builds it.
 */

/** A settings row's height and the gap between rows (settings.css uses the same numbers). */
export const SETTINGS_ROW = { height: 120, gap: 8 } as const;

/** The rows in view: the safe area less the header (56 px and a 24 px gap). */
export const SETTINGS_VISIBLE = fits(SCREEN.height - 2 * SCREEN.safeY - 56 - 24, SETTINGS_ROW.height, SETTINGS_ROW.gap);

/**
 * A settings page's rows as drawn (step 58a): with larger text, fewer and taller (`shownRows`,
 * as the focus engine scrolls them), from the focus engine's `top`, kept on the focused row
 * `at`. `height` is each row's, for `--settings-row` (settings.css).
 */
export function settingsWindow(top: number, count: number, at?: number): ListWindow & { readonly height: number } {
  const { from, to } = listWindow(top, count, shownRows(SETTINGS_VISIBLE), at);
  return { from, to, height: shownRowSize(SETTINGS_VISIBLE, SETTINGS_ROW.height, SETTINGS_ROW.gap) };
}
