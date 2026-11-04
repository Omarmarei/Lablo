import { describe, expect, it } from 'vitest';
import { FOUR_THREE, PICTURE_MODES, asPictureMode, nextPicture, pictureLayout, pictureModes } from './picture';

describe('the picture modes (RELAY step 20c2b)', () => {
  it('puts each mode in a rect with a fit', () => {
    expect(PICTURE_MODES.map((mode) => pictureLayout(mode))).toEqual([
      { rect: 'full', fit: 'contain' },
      { rect: 'full', fit: 'cover' },
      { rect: 'full', fit: 'fill' },
      { rect: FOUR_THREE, fit: 'fill' },
    ]);
    // 4:3 in the middle of the 1920×1080 screen, its full height.
    expect(FOUR_THREE.width / FOUR_THREE.height).toBe(4 / 3);
    expect(FOUR_THREE.x * 2 + FOUR_THREE.width).toBe(1920);
    expect([FOUR_THREE.y, FOUR_THREE.height]).toEqual([0, 1080]);
  });

  it('offers the modes whose fit the engine has, fit always', () => {
    expect(pictureModes(['contain', 'fill', 'cover'])).toEqual(['fit', 'zoom', 'stretch', '4:3']);
    expect(pictureModes(['contain', 'fill'])).toEqual(['fit', 'stretch', '4:3']);
    expect(pictureModes(['contain', 'cover'])).toEqual(['fit', 'zoom']);
    expect(pictureModes(['contain'])).toEqual(['fit']);
    expect(pictureModes([])).toEqual(['fit']);
  });

  it('goes round the modes offered, and back to fit from one that is not', () => {
    const all = pictureModes(['contain', 'fill', 'cover']);
    expect([nextPicture('fit', all), nextPicture('zoom', all), nextPicture('stretch', all), nextPicture('4:3', all)]).toEqual(['zoom', 'stretch', '4:3', 'fit']);
    const avplay = pictureModes(['contain', 'fill']);
    expect([nextPicture('fit', avplay), nextPicture('stretch', avplay), nextPicture('4:3', avplay)]).toEqual(['stretch', '4:3', 'fit']);
    expect(nextPicture('zoom', avplay)).toBe('fit');
    expect(nextPicture('fit', ['fit'])).toBe('fit');
  });

  it('reads a stored mode', () => {
    expect(PICTURE_MODES.map((mode) => asPictureMode(mode))).toEqual(PICTURE_MODES);
    for (const bad of ['', 'Fit', '16:9', 'cover', null, undefined, 3, {}]) expect(asPictureMode(bad)).toBeNull();
  });
});
