import { LARGE_TEXT_ROWS, setRowScale } from '@lablo/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_ROW, SETTINGS_VISIBLE, settingsWindow } from './settings-window';

/** A settings page's rows as drawn (RELAY step 58a): 7 of 120 px; with larger text 5 of 171 px, in the same 888 px. */
describe('settingsWindow', () => {
  afterEach(() => setRowScale(1));

  it('draws the layout rows from the focus engine top at the normal size', () => {
    expect([SETTINGS_VISIBLE, SETTINGS_ROW.height]).toEqual([7, 120]);
    expect(settingsWindow(0, 13)).toEqual({ from: 0, to: 7, height: 120 });
    expect(settingsWindow(6, 13, 12)).toEqual({ from: 6, to: 13, height: 120 });
    expect(settingsWindow(0, 3)).toEqual({ from: 0, to: 3, height: 120 });
  });

  it('with larger text, fewer and taller rows, kept on the focused row', () => {
    setRowScale(LARGE_TEXT_ROWS);
    expect(settingsWindow(0, 13)).toEqual({ from: 0, to: 5, height: 171 });
    // Player's "Accessibility" (row 8) focused under a window kept from the normal size (top 2).
    expect(settingsWindow(2, 9, 8)).toEqual({ from: 4, to: 9, height: 171 });
    expect(5 * 171 + 4 * SETTINGS_ROW.gap).toBeLessThanOrEqual(7 * 120 + 6 * SETTINGS_ROW.gap);
  });
});
