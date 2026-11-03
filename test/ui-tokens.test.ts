// The ui design tokens (RELAY step 11): the numbers code uses equal the CSS custom
// properties, text contrast, and the list-window helper. In root test/ because it reads
// packages/ui/src/styles/tokens.css from disk (package tests have no Node types, and Vitest
// gives `.css?raw` imports no text).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYOUT, SCREEN, SPACE, fits, pxTokens } from '../packages/ui/src/design/tokens';

const css = readFileSync(path.resolve(import.meta.dirname, '../packages/ui/src/styles/tokens.css'), 'utf8');

/** The custom properties `:root` declares in tokens.css. */
function rootTokens(): Map<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const tokens = new Map<string, string>();
  const declaration = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  for (let match = declaration.exec(root); match !== null; match = declaration.exec(root)) {
    tokens.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return tokens;
}

/** WCAG 2 relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('design tokens', () => {
  it('has every layout number in tokens.css with the same value', () => {
    const tokens = rootTokens();
    const numbers = pxTokens();
    expect(Object.keys(numbers)).toHaveLength(17);
    for (const [name, px] of Object.entries(numbers)) {
      expect([name, tokens.get(name)]).toEqual([name, `${px}px`]);
    }
    // Every px token in the CSS layout and space groups is known to code too.
    const cssPx = [...tokens].filter(([name, value]) => /^--(space|screen|safe|row|rail|tile|focus)-/.test(name) && /px$/.test(value));
    expect(cssPx.map(([name]) => name).sort()).toEqual(Object.keys(numbers).sort());
  });

  it('fits the safe area to the 1920x1080 canvas and keeps the spacing grid on 4 px', () => {
    expect([SCREEN.safeX, SCREEN.safeY]).toEqual([SCREEN.width * 0.05, SCREEN.height * 0.05]);
    for (const px of SPACE) expect(px % 4).toBe(0);
    expect(LAYOUT.rowHeight % 4).toBe(0);
  });

  it('keeps text readable at 3 m: body and muted text at least 4.5:1 on every surface', () => {
    const tokens = rootTokens();
    const get = (name: string): string => {
      const value = tokens.get(name);
      if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not #rrggbb: ${value}`);
      return value;
    };
    for (const surface of ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-focus']) {
      for (const text of ['--color-text', '--color-text-muted']) {
        expect([surface, text, contrast(get(surface), get(text)) >= 4.5]).toEqual([surface, text, true]);
      }
    }
    expect(contrast(get('--color-accent'), get('--color-text-on-accent'))).toBeGreaterThanOrEqual(4.5);
    // The focus ring stands out from the surfaces it sits on (WCAG 1.4.11: 3:1).
    for (const surface of ['--color-bg', '--color-surface', '--color-surface-raised']) {
      expect(contrast(get(surface), get('--color-focus'))).toBeGreaterThanOrEqual(3);
    }
  });

  it('sets no text size under 22 px', () => {
    const sizes = [...rootTokens()].filter(([name]) => name.startsWith('--font-size-')).map(([, value]) => parseInt(value, 10));
    expect(sizes.length).toBeGreaterThan(4);
    expect(Math.min(...sizes)).toBe(22);
  });

  it('counts how many fixed-size items fit, for a list window', () => {
    expect(fits(4 * LAYOUT.rowHeight, LAYOUT.rowHeight)).toBe(4);
    expect(fits(4 * LAYOUT.rowHeight - 1, LAYOUT.rowHeight)).toBe(3);
    // Gaps sit between items: 3 items of 100 with 2 gaps of 10 need exactly 320.
    expect(fits(320, 100, 10)).toBe(3);
    expect(fits(319, 100, 10)).toBe(2);
    expect(fits(0, 100)).toBe(0);
    expect(() => fits(100, 0)).toThrow(RangeError);
  });
});
