/**
 * The picture's mode (RELAY step 20c2b, architecture.md §2 "Built in step 20c2b"): how a stream's
 * picture fills the screen, chosen once for every channel. Each mode is a rect on the screen and
 * a fit in it (`PlayerEngine.setRect` and `setFit`):
 * - `fit`: the whole picture in its own shape, with bars where its shape isn't the screen's;
 * - `zoom`: the screen filled in the picture's shape, its edges cropped (the `<video>` only:
 *   AVPlay can't crop);
 * - `stretch`: the picture stretched to the screen;
 * - `4:3`: the picture stretched to a 4:3 window in the middle of the screen (a 4:3 broadcast
 *   sent stretched to 16:9).
 */

import type { PictureFit, Rect } from './engine';

export type PictureMode = 'fit' | 'zoom' | 'stretch' | '4:3';

/** Every mode, in the order the player goes round them. */
export const PICTURE_MODES: readonly PictureMode[] = ['fit', 'zoom', 'stretch', '4:3'];

/** Where a mode puts the picture, and how it fills it. */
export interface PictureLayout {
  readonly rect: Rect | 'full';
  readonly fit: PictureFit;
}

/** The 4:3 window in the middle of the 1920×1080 screen. */
export const FOUR_THREE: Rect = { x: 240, y: 0, width: 1440, height: 1080 };

const LAYOUTS: Readonly<Record<PictureMode, PictureLayout>> = {
  fit: { rect: 'full', fit: 'contain' },
  zoom: { rect: 'full', fit: 'cover' },
  stretch: { rect: 'full', fit: 'fill' },
  '4:3': { rect: FOUR_THREE, fit: 'fill' },
};

export function pictureLayout(mode: PictureMode): PictureLayout {
  return LAYOUTS[mode];
}

/** The modes an engine with `fits` can show, in order (`fit` always). */
export function pictureModes(fits: readonly PictureFit[]): PictureMode[] {
  return PICTURE_MODES.filter((mode) => mode === 'fit' || fits.indexOf(LAYOUTS[mode].fit) !== -1);
}

/**
 * The mode after `mode` among `modes` (`pictureModes`: `fit` first): back to `fit` after the
 * last, and the first for a mode that isn't among them.
 */
export function nextPicture(mode: PictureMode, modes: readonly PictureMode[]): PictureMode {
  return modes[modes.indexOf(mode) + 1] ?? 'fit';
}

/** A stored value as a mode, or `null` when it isn't one. */
export function asPictureMode(value: unknown): PictureMode | null {
  return PICTURE_MODES.indexOf(value as PictureMode) === -1 ? null : (value as PictureMode);
}
