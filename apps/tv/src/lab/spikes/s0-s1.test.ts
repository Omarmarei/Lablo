import { describe, expect, it } from 'vitest';
import { cssFeatures } from './s0-s1';

/** A `CSS.supports` that knows the listed `property: value` pairs. */
function supportsOnly(known: readonly string[]) {
  return function supports(this: unknown, property: string, value: string): boolean {
    return known.includes(`${property}: ${value}`);
  };
}

const EVERYTHING = ['display: grid', 'gap: 1px', 'display: flex', 'position: sticky', 'margin-inline-start: 1px', '--x: 1'];

describe('S1 apis: the CSS features (cssFeatures)', () => {
  it('reads CSS.supports when CSS is a function object, as on Chromium 79 (relay leg 34)', () => {
    const css = Object.assign(function CSS() {}, { supports: supportsOnly(EVERYTHING) });
    expect(typeof css).toBe('function');
    expect(cssFeatures(css)).toEqual({ grid: true, 'flex gap': true, sticky: true, 'logical properties': true, 'custom properties': true });
  });

  it('reads CSS.supports on a namespace object, and reports each missing feature', () => {
    expect(cssFeatures({ supports: supportsOnly(['display: flex', '--x: 1']) })).toEqual({
      grid: false,
      'flex gap': false,
      sticky: false,
      'logical properties': false,
      'custom properties': true,
    });
  });

  it('calls supports on the CSS object itself', () => {
    const css = {
      known: EVERYTHING,
      supports(this: { known: readonly string[] }, property: string, value: string): boolean {
        return this.known.includes(`${property}: ${value}`);
      },
    };
    expect(cssFeatures(css)?.grid).toBe(true);
  });

  it.each([undefined, null, {}, { supports: true }])('is null without CSS.supports (%j)', (css) => {
    expect(cssFeatures(css)).toBeNull();
  });
});
