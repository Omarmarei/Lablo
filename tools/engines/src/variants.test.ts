import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import {
  APP_SCREENS,
  APP_VARIANT,
  CSS_SEEDS,
  NO_POLYFILLS_VARIANT,
  SEEDS,
  SYNTAX_SEED_SCREENS,
  WALK_SEEDS,
  dropGuideCellX,
  mustPass,
  removeDeclarations,
  removeRules,
  seedBundle,
  seedCss,
  stageApp,
  stageCssSeed,
  stageSeed,
} from './variants';

const parses = (code: string, ecmaVersion: 5 | 2016 | 2017 | 2018 | 2019 | 2020): boolean => {
  try {
    parse(code, { ecmaVersion, sourceType: 'script' });
    return true;
  } catch {
    return false;
  }
};

/** The shape of the built app.css: comments, mirrored rules, an at-rule with nested blocks. */
const APP_CSS = `/* tokens */
:root {
  --row-height: 88px;
}

@font-face {
  font-family: 'Zoma Sans';
  src: url("assets/zoma-latin-400.woff2") format('woff2');
}

@keyframes z-spin {
  to {
    transform: rotate(360deg);
  }
}

/*
 * ListRow: a channel row (.z-row), var(--row-height) tall.
 */
.z-row {
  display: flex;
  height: var(--row-height);
}

.z-row__head,
.z-row__now {
  display: flex;
}

[dir="ltr"] .z-row__badges > * + * {
  margin-left: 8px;
}

[dir="rtl"] .z-row__badges > * + * {
  margin-right: 8px;
}

.z-row.is-focused {
  border-color: var(--color-focus);
}

.z-rowset {
  color: red;
}

/* The live screen (live.css). */
.live {
  display: flex;
  padding: var(--safe-y) var(--safe-x);
}

[dir="ltr"] .live__rail {
  margin-right: 32px;
}

[dir="rtl"] .live__rail {
  margin-left: 32px;
}

.live__rail .z-vlist__item > .z-chip {
  justify-content: flex-start;
}

.lively {
  color: blue;
}

.gallery {
  display: flex;
  width: var(--screen-width);
  padding: var(--safe-y) var(--safe-x);
  overflow: hidden;
}

.gallery.is-loading {
  padding: 0;
}

/* The grid guide's cells (GuideGrid.css), placed by a custom property. */
.z-guide__cell {
  position: absolute;
  width: var(--w);
}

[dir="ltr"] .z-guide__cell {
  left: var(--x);
}

[dir="rtl"] .z-guide__cell {
  right: var(--x);
}

[dir="ltr"] .z-guide__slot {
  left: var(--x);
}

[dir="rtl"] .z-guide__slot {
  right: var(--x);
}
`;

function fakeDist(): string {
  const dist = mkdtempSync(path.join(tmpdir(), 'zoma-engines-'));
  for (const platform of ['tizen', 'webos']) {
    mkdirSync(path.join(dist, platform));
    writeFileSync(path.join(dist, platform, 'index.html'), '<!DOCTYPE html>');
    writeFileSync(path.join(dist, platform, 'main.js'), `!function(){window.app="${platform}"}();`);
    writeFileSync(path.join(dist, platform, 'app.css'), APP_CSS);
  }
  return dist;
}

describe('seeded variants', () => {
  it.each(SEEDS)('$id uses exactly ES$ecmaVersion syntax, which the build gate (ES2016) would reject', (seed) => {
    expect(parses(seed.code, seed.ecmaVersion)).toBe(true);
    expect(parses(seed.code, (seed.ecmaVersion - 1) as 2017 | 2019)).toBe(false);
    expect(parses(seed.code, 2016)).toBe(false);
  });

  it('includes an ES2018 seed (the RELAY step 2b requirement)', () => {
    expect(SEEDS.some((seed) => seed.ecmaVersion === 2018)).toBe(true);
  });

  it('prepends the seed to the bundle', () => {
    expect(seedBundle('main();', SEEDS[0]!)).toBe(`${SEEDS[0]!.code}\nmain();`);
  });

  it('expects failures exactly below each variant\'s minimum engine', () => {
    expect(mustPass(APP_VARIANT, 53)).toBe(true);
    const spread = SEEDS.find((seed) => seed.id === 'seed-es2018-object-spread')!;
    expect([53, 56, 68].map((major) => mustPass(spread, major))).toEqual([false, false, true]);
    const chaining = SEEDS.find((seed) => seed.id === 'seed-es2020-optional-chaining')!;
    expect([53, 56, 68].map((major) => mustPass(chaining, major))).toEqual([false, false, false]);
    expect([53, 56, 68].map((major) => mustPass(NO_POLYFILLS_VARIANT, major))).toEqual([false, false, false]);
  });

  it('stages the real builds and the seeded copies side by side', () => {
    const dist = fakeDist();
    const root = mkdtempSync(path.join(tmpdir(), 'zoma-variants-'));
    stageApp(dist, root);
    const seed = SEEDS[0]!;
    stageSeed(dist, root, seed);
    for (const platform of ['tizen', 'webos']) {
      const original = readFileSync(path.join(dist, platform, 'main.js'), 'utf8');
      expect(readFileSync(path.join(root, 'app', platform, 'main.js'), 'utf8')).toBe(original);
      expect(readFileSync(path.join(root, seed.id, platform, 'main.js'), 'utf8')).toBe(`${seed.code}\n${original}`);
      expect(readFileSync(path.join(root, seed.id, platform, 'index.html'), 'utf8')).toBe('<!DOCTYPE html>');
    }
    // The real build is never modified.
    expect(readFileSync(path.join(dist, 'webos', 'main.js'), 'utf8')).toBe('!function(){window.app="webos"}();');
  });

  it('asks for pnpm build:tv when there is nothing to test', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'zoma-empty-'));
    expect(() => stageApp(empty, path.join(empty, 'out'))).toThrow(/run pnpm build:tv first/);
  });
});

describe('the screens each variant runs', () => {
  it('runs the real app on every screen, onboarding included', () => {
    expect(APP_SCREENS).toEqual(['hello', 'gallery', 'onboarding']);
    expect(APP_VARIANT.screens).toEqual(APP_SCREENS);
  });

  it('runs the syntax seeds on the two developer screens: a parse error fails whatever opens', () => {
    expect(SYNTAX_SEED_SCREENS).toEqual(['hello', 'gallery']);
    for (const seed of SEEDS) expect(seed.screens).toEqual(SYNTAX_SEED_SCREENS);
  });

  it('runs the no-polyfills build on the hello screen only: the gallery needs no polyfill', () => {
    expect(NO_POLYFILLS_VARIANT.screens).toEqual(['hello']);
  });

  it("runs the component CSS seeds on the gallery, and live.css's and the grid guide's on the walk to them, and they must fail on every engine", () => {
    expect(CSS_SEEDS.map((seed) => [seed.id, seed.screens])).toEqual([
      ['seed-css-no-list-row', ['gallery']],
      ['seed-css-no-safe-area', ['gallery']],
      ['seed-css-no-live', ['onboarding']],
      ['seed-css-no-guide-x', ['onboarding']],
    ]);
    for (const seed of CSS_SEEDS) {
      expect([53, 56, 68, 140].map((major) => mustPass(seed, major))).toEqual([false, false, false, false]);
    }
  });
});

describe('the walk seeds', () => {
  it('break onboarding or the live screen it ends on, and must fail on every engine', () => {
    expect(WALK_SEEDS.map((seed) => seed.id)).toEqual(['seed-walk-no-input-focus', 'seed-walk-forgets-profile', 'seed-live-no-back-key', 'seed-focus-engine-stuck']);
    for (const seed of WALK_SEEDS) {
      expect(seed.screens).toEqual(['onboarding']);
      expect([53, 56, 68, 140].map((major) => mustPass(seed, major))).toEqual([false, false, false, false]);
    }
  });

  it.each(WALK_SEEDS)('$id is plain ES5, so only the walk can fail it, not the parser', (seed) => {
    expect(parses(seed.code, 5)).toBe(true);
  });

  it('turn off DOM focus, and delete the app database at every start', () => {
    const [noFocus, forgets] = WALK_SEEDS;
    expect(noFocus!.code).toBe('HTMLElement.prototype.focus = function () {};');
    expect(forgets!.code).toBe("indexedDB.deleteDatabase('zoma');");
  });

  it("keep the TVs' Back keys (Tizen 10009, webOS 461) from the app, and every other key reaches it", () => {
    const seed = WALK_SEEDS.find((s) => s.id === 'seed-live-no-back-key')!;
    const listeners: Array<{ type: string; listener: (event: unknown) => void; capture: unknown }> = [];
    const window = { addEventListener: (type: string, listener: (event: unknown) => void, capture: unknown) => listeners.push({ type, listener, capture }) };
    runInNewContext(seed.code, { window });
    expect(listeners.map((l) => [l.type, l.capture])).toEqual([['keydown', true]]);
    const stopped = (keyCode: number): boolean => {
      let stop = false;
      listeners[0]!.listener({ keyCode, stopImmediatePropagation: () => (stop = true) });
      return stop;
    };
    expect([10009, 461, 13, 37, 8, 428, 34].map(stopped)).toEqual([true, true, false, false, false, false, false]);
  });

  it("keep window.__ZOMA_TEST__ on the first focus it saw, whatever the focus engine does next", () => {
    const seed = WALK_SEEDS.find((s) => s.id === 'seed-focus-engine-stuck')!;
    const window: { __ZOMA_TEST__?: { focusPath(): string | null } } = {};
    runInNewContext(seed.code, { window, Object });
    let path: string | null = null;
    // The app installs its hook as main.tsx does, and its focus then moves.
    window.__ZOMA_TEST__ = { focusPath: () => path };
    expect(window.__ZOMA_TEST__.focusPath()).toBeNull();
    path = 'language/languages/0';
    expect(window.__ZOMA_TEST__.focusPath()).toBe('language/languages/0');
    path = 'disclaimer/actions/0';
    expect(window.__ZOMA_TEST__.focusPath()).toBe('language/languages/0');
  });

  it('are staged like the syntax seeds: prepended to a copy of main.js', () => {
    const dist = fakeDist();
    const root = mkdtempSync(path.join(tmpdir(), 'zoma-variants-'));
    for (const seed of WALK_SEEDS) {
      stageSeed(dist, root, seed);
      expect(readFileSync(path.join(root, seed.id, 'tizen', 'main.js'), 'utf8')).toBe(`${seed.code}\n!function(){window.app="tizen"}();`);
    }
  });
});

describe('the CSS seeds', () => {
  const [noListRow, noSafeArea, noLive, noGuideX] = CSS_SEEDS as readonly [(typeof CSS_SEEDS)[number], (typeof CSS_SEEDS)[number], (typeof CSS_SEEDS)[number], (typeof CSS_SEEDS)[number]];

  it('removeRules takes out whole rules and keeps at-rules and the other rules', () => {
    const result = removeRules(APP_CSS, (selector) => selector.startsWith('.gallery'));
    expect(result.removed).toBe(2);
    expect(result.css).not.toContain('.gallery');
    expect(result.css).toContain('@keyframes z-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}');
    expect(result.css).toContain('.z-row {\n  display: flex;\n  height: var(--row-height);\n}');
    // The comments go first, so a comment naming a class is never taken for a selector.
    expect(result.css).not.toContain('/*');
    // At-rules are never style rules: even a predicate that drops everything keeps them.
    const bare = removeRules(APP_CSS, () => true);
    expect(bare.css).toContain("@font-face {\n  font-family: 'Zoma Sans';");
    expect(bare.css).toContain('@keyframes z-spin {');
    expect(bare.css).not.toContain('.z-row');
  });

  it('removeDeclarations takes out only the matching declarations of the named rule', () => {
    const result = removeDeclarations(APP_CSS, '.gallery', (d) => d.startsWith('padding'));
    expect(result.removed).toBe(1);
    expect(result.css).toContain('.gallery {\n  display: flex;\n  width: var(--screen-width);\n  overflow: hidden;\n}');
    expect(result.css).toContain('.gallery.is-loading {\n  padding: 0;\n}');
    expect(removeDeclarations(APP_CSS, '.gallery', (d) => d.startsWith('margin')).removed).toBe(0);
  });

  it('seed-css-no-list-row takes out every ListRow rule in both directions, and nothing else', () => {
    const css = seedCss(APP_CSS, noListRow);
    expect(css).not.toMatch(/\.z-row(__|[^\w-])/);
    expect(css).toContain('.z-rowset {\n  color: red;\n}');
    expect(css).toContain('padding: var(--safe-y) var(--safe-x);');
    expect(noListRow.edit(APP_CSS).removed).toBe(5);
  });

  it('seed-css-no-safe-area takes out the gallery padding only', () => {
    const css = seedCss(APP_CSS, noSafeArea);
    expect(css).not.toMatch(/\.gallery \{[^}]*padding/);
    expect(css).toContain('height: var(--row-height);');
  });

  it('seed-css-no-live takes out every live.css rule in both directions, and nothing else', () => {
    const css = seedCss(APP_CSS, noLive);
    expect(css).not.toMatch(/\.live(__|[^\w-])/);
    expect(css).toContain('.lively {\n  color: blue;\n}');
    expect(css).toContain('.gallery {\n  display: flex;');
    expect(css).toContain('.z-row {\n  display: flex;');
    expect(noLive.edit(APP_CSS).removed).toBe(4);
  });

  it("seed-css-no-guide-x takes out the cells' left: var(--x) and its mirror, and nothing else", () => {
    const css = seedCss(APP_CSS, noGuideX);
    expect(noGuideX.edit(APP_CSS).removed).toBe(2);
    expect(css).not.toMatch(/\.z-guide__cell \{[^}]*(left|right):/);
    // The rest of the cell's rule, and the slot labels' positions, stay.
    expect(css).toContain('.z-guide__cell {\n  position: absolute;\n  width: var(--w);\n}');
    expect(css).toContain('[dir="ltr"] .z-guide__slot {\n  left: var(--x);\n}');
    expect(css).toContain('[dir="rtl"] .z-guide__slot {\n  right: var(--x);\n}');
    expect(css).toContain('.gallery {\n  display: flex;');
  });

  it('seed-css-no-guide-x takes out nothing unless both directions are there: neither language may pass untested', () => {
    const ltrOnly = APP_CSS.replace('[dir="rtl"] .z-guide__cell {\n  right: var(--x);\n}', '');
    const rtlOnly = APP_CSS.replace('[dir="ltr"] .z-guide__cell {\n  left: var(--x);\n}', '');
    for (const css of [ltrOnly, rtlOnly]) {
      expect(css).not.toBe(APP_CSS);
      expect(dropGuideCellX(css)).toEqual({ css, removed: 0 });
      expect(() => seedCss(css, noGuideX)).toThrow(/seed-css-no-guide-x: nothing to take out/);
    }
  });

  it('fails the staging when a seed finds nothing to take out (a renamed class)', () => {
    const renamed = APP_CSS.replace(/z-row/g, 'z-line').replace(/\.gallery \{/g, '.showcase {').replace(/\.live/g, '.watch').replace(/z-guide__cell/g, 'z-epg__cell');
    for (const seed of CSS_SEEDS) expect(() => seedCss(renamed, seed)).toThrow(new RegExp(`${seed.id}: nothing to take out`));
  });

  it('stages seeded copies of app.css and leaves the build alone', () => {
    const dist = fakeDist();
    const root = mkdtempSync(path.join(tmpdir(), 'zoma-css-'));
    for (const seed of CSS_SEEDS) {
      expect(stageCssSeed(dist, root, seed)).toBe(seed);
      for (const platform of ['tizen', 'webos']) {
        expect(readFileSync(path.join(root, seed.id, platform, 'app.css'), 'utf8')).toBe(seedCss(APP_CSS, seed));
        expect(readFileSync(path.join(root, seed.id, platform, 'main.js'), 'utf8')).toBe(`!function(){window.app="${platform}"}();`);
      }
    }
    expect(readFileSync(path.join(dist, 'tizen', 'app.css'), 'utf8')).toBe(APP_CSS);
  });
});
