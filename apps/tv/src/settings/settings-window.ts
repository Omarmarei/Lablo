import { SCREEN, fits } from '@lablo/ui';

/**
 * The settings pages' rows: their size and how many are in view (step 38c1's settings list; step
 * 39d's "Player" page, whose eighth row made it scroll too). Its own module so that the "Player"
 * page needs nothing from `settings-state.ts`, which builds it.
 */

/** A settings row's height and the gap between rows (settings.css uses the same numbers). */
export const SETTINGS_ROW = { height: 120, gap: 8 } as const;

/** The rows in view: the safe area less the header (56 px and a 24 px gap). */
export const SETTINGS_VISIBLE = fits(SCREEN.height - 2 * SCREEN.safeY - 56 - 24, SETTINGS_ROW.height, SETTINGS_ROW.gap);
