import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import {
  APP_SCREENS,
  APP_VARIANT,
  CSS_SEEDS,
  NO_POLYFILLS_VARIANT,
  SEEDS,
  mustPass,
  removeDeclarations,
  removeRules,
  seedBundle,
  seedCss,
  stageApp,
  stageCssSeed,
  stageSeed,
} from './variants';

const parses = (code: string, ecmaVersion: 2016 | 2017 | 2018 | 2019 | 2020): boolean => {
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

.gallery {
  display: flex;
  width: var(--screen-width);
  padding: var(--safe-y) var(--safe-x);
  overflow: hidden;
}

.gallery.is-loading {
  padding: 0;
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
  it('runs the real app and the syntax seeds on both screens', () => {
    expect(APP_SCREENS).toEqual(['hello', 'gallery']);
    expect(APP_VARIANT.screens).toEqual(APP_SCREENS);
    for (const seed of SEEDS) expect(seed.screens).toEqual(APP_SCREENS);
  });

  it('runs the no-polyfills build on the hello screen only: the gallery needs no polyfill', () => {
    expect(NO_POLYFILLS_VARIANT.screens).toEqual(['hello']);
  });

  it('runs the CSS seeds on the gallery, and they must fail on every engine', () => {
    expect(CSS_SEEDS.map((seed) => seed.id)).toEqual(['seed-css-no-list-row', 'seed-css-no-safe-area']);
    for (const seed of CSS_SEEDS) {
      expect(seed.screens).toEqual(['gallery']);
      expect([53, 56, 68, 140].map((major) => mustPass(seed, major))).toEqual([false, false, false, false]);
    }
  });
});

describe('the CSS seeds', () => {
  const [noListRow, noSafeArea] = CSS_SEEDS as readonly [(typeof CSS_SEEDS)[number], (typeof CSS_SEEDS)[number]];

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
    expect(css).not.toContain('padding: var(--safe-y) var(--safe-x);');
    expect(css).toContain('height: var(--row-height);');
  });

  it('fails the staging when a seed finds nothing to take out (a renamed class)', () => {
    const renamed = APP_CSS.replace(/z-row/g, 'z-line').replace(/\.gallery \{/g, '.showcase {');
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
