// RELAY step 11c: the old-engine harness checks the component gallery with its own ES5 probe
// and constants (tools/* may not import @zoma/ui). This keeps them equal to the app's and to
// the e2e test's, and proves the CSS seeds still find what they take out of the real sources.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readScreen } from '../apps/tv/src/data/params';
import { LAYOUT, SCREEN } from '../packages/ui/src/design/tokens';
import { GALLERY_EXPRESSION, GALLERY_ROWS, ROW_HEIGHT, SAFE_AREA, VIEWPORT, galleryUrl } from '../tools/engines/src/gallery';
import { CSS_SEEDS, seedCss } from '../tools/engines/src/variants';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('the gallery checks of the old-engine harness', () => {
  it('use the canvas, the safe area and the row height of the app', () => {
    expect(VIEWPORT).toEqual({ width: SCREEN.width, height: SCREEN.height });
    expect(SAFE_AREA).toEqual({ left: SCREEN.safeX, top: SCREEN.safeY, right: SCREEN.width - SCREEN.safeX, bottom: SCREEN.height - SCREEN.safeY });
    expect(ROW_HEIGHT).toBe(LAYOUT.rowHeight);
  });

  // gallery-state.ts (CHANNELS_VISIBLE) imports the .tsx components, which the root tsc can't
  // compile; the e2e test pins the same window.
  it('expect the channel window and measure the boxes and labels of e2e/gallery.spec.ts', () => {
    const spec = read('e2e/gallery.spec.ts');
    const windows = [...spec.matchAll(/locator\('\[data-testid=channels\] \.z-row'\)\)\.toHaveCount\((\d+)\)/g)].map((m) => Number(m[1]));
    expect(windows.length).toBeGreaterThan(0);
    for (const rows of windows) expect(rows).toBe(GALLERY_ROWS);
    for (const name of ['boxes', 'labels']) {
      const selectors = new RegExp(`const ${name} = '([^']+)';`).exec(spec)?.[1];
      expect(selectors, `const ${name} in e2e/gallery.spec.ts`).toBeDefined();
      expect(GALLERY_EXPRESSION).toContain(`all('${selectors ?? ''}')`);
    }
  });

  it('open the screen the app reads from the address', () => {
    expect(readScreen(new URL(galleryUrl('app', 'webos')).search)).toBe('gallery');
  });

  it('seed failures into the real component and gallery CSS', () => {
    const css = `${read('packages/ui/src/components/ListRow.css')}\n${read('apps/tv/src/gallery/gallery.css')}`;
    for (const seed of CSS_SEEDS) expect(seed.edit(css).removed, seed.id).toBeGreaterThan(0);
    const [noListRow, noSafeArea] = CSS_SEEDS;
    expect(seedCss(css, noListRow!)).not.toContain('.z-row');
    expect(seedCss(css, noSafeArea!)).not.toContain('padding: var(--safe-y) var(--safe-x)');
  });
});
