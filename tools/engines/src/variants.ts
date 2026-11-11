/**
 * The bundles the harness runs. Normally only `app`: the real TV builds from `pnpm build:tv`.
 *
 * `--self-test` adds deliberately broken bundles to prove the harness catches what the TVs
 * would choke on, even if the build-time ES2016 gate were bypassed:
 * - a seeded ES2018 feature (object spread, Chromium 60+), prepended to the shipped main.js;
 * - a seeded ES2020 feature (optional chaining, Chromium 80+), which even Chromium 68 rejects;
 * - the real app built without core-js (`build-tv --unsafe-no-polyfills`): `Object.entries`
 *   (in the worker) is missing before Chromium 54, `padStart` before 57 and `queueMicrotask`
 *   (used by the app's dependencies) before 71, so it fails on every engine we run. Only on
 *   the hello screen: the gallery needs no polyfill at all, and passes without core-js on
 *   Chromium 53, 56 and 68 (step 11c, 2026-11-03), its Arabic phase included (step 12b).
 * - two CSS seeds (step 11c), the real app with part of app.css taken out, caught by the
 *   gallery's layout checks on every engine: ListRow.css's rules (the channel rows lose their
 *   88 px height), and the gallery's title-safe padding (its components touch the edges).
 * - two walk seeds (step 13c), the real app with a TV fault prepended to main.js, caught by the
 *   onboarding walk on every engine: inputs that never take DOM focus (a TV keyboard that never
 *   opens), and a database deleted at every start (a TV that keeps nothing between launches).
 * - two live-screen seeds (step 14c), caught where the walk goes on to the live screen, on every
 *   engine: app.css without live.css (the screen's layout), and a Back key that never reaches
 *   the app (its keys). And a focus engine whose path stays on the first focus while the screen
 *   draws the moves, caught by the walk's check that the engine and the screen agree.
 * - a grid guide seed (step 23e): app.css without the cells' `left: var(--x)` (and its mirror,
 *   `right`), caught by the walk's grid geometry on every engine, in both languages.
 * Each variant must fail on every engine older than `minChrome` and pass on the rest, on each
 * of its screens.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TV_PLATFORMS } from './scenario';

/**
 * The app's screens the harness opens: the hello screen and the component gallery (developer
 * screens behind `?screen=`), and onboarding, the start screen a TV opens (step 13c).
 */
export type AppScreen = 'hello' | 'gallery' | 'onboarding';
export const APP_SCREENS: readonly AppScreen[] = ['hello', 'gallery', 'onboarding'];
/** The syntax seeds fail at parse time on whatever screen opens: the two developer screens show it. */
export const SYNTAX_SEED_SCREENS: readonly AppScreen[] = ['hello', 'gallery'];

export interface Variant {
  readonly id: string;
  readonly description: string;
  /** Engines below this Chromium major must report a failure; the others must pass. */
  readonly minChrome: number;
  /** The screens to run it on: each one's checks must fail (or pass) as `minChrome` says. */
  readonly screens: readonly AppScreen[];
}

/** A variant made by prepending code to the real main.js. */
export interface ScriptSeed extends Variant {
  /** A complete statement, prepended to main.js. */
  readonly code: string;
}

export interface Seed extends ScriptSeed {
  /** The ECMAScript edition that introduced the seeded syntax (`code` uses only that). */
  readonly ecmaVersion: 2018 | 2020;
}

export const APP_VARIANT: Variant = { id: 'app', description: 'the TV builds from pnpm build:tv', minChrome: 0, screens: APP_SCREENS };

export const SEEDS: readonly Seed[] = [
  {
    id: 'seed-es2018-object-spread',
    description: 'ES2018 object spread prepended to main.js',
    ecmaVersion: 2018,
    minChrome: 60,
    screens: SYNTAX_SEED_SCREENS,
    code: 'var __labloSeed = { ...{ seeded: true } };',
  },
  {
    id: 'seed-es2020-optional-chaining',
    description: 'ES2020 optional chaining prepended to main.js',
    ecmaVersion: 2020,
    minChrome: 80,
    screens: SYNTAX_SEED_SCREENS,
    code: 'var __labloSeed = window.__labloMissing?.value;',
  },
];

/**
 * TV faults the onboarding walk must catch on every engine (plain ES5, so they parse
 * everywhere and only the walk can fail them).
 */
export const WALK_SEEDS: readonly ScriptSeed[] = [
  {
    id: 'seed-walk-no-input-focus',
    description: "focus() does nothing: the playlist field's input never takes DOM focus, so a TV's keyboard would never open",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['onboarding'],
    code: 'HTMLElement.prototype.focus = function () {};',
  },
  {
    id: 'seed-walk-forgets-profile',
    description: "the app's database is deleted at every start, as on a TV that keeps nothing between launches: the relaunch shows onboarding again",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['onboarding'],
    code: "indexedDB.deleteDatabase('lablo');",
  },
  {
    id: 'seed-live-no-back-key',
    description: "the remote's Back key (Tizen 10009, webOS 461) never reaches the app: Back in the live screen's list doesn't go to the rail",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['onboarding'],
    code: "window.addEventListener('keydown', function (event) { if (event.keyCode === 10009 || event.keyCode === 461) event.stopImmediatePropagation(); }, true);",
  },
  {
    id: 'seed-focus-engine-stuck',
    description: "window.__LABLO_TEST__ keeps answering the first focus it saw: the screen draws each move, but the focus engine's path stays put, so the two disagree",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['onboarding'],
    code: "(function () { var hook; Object.defineProperty(window, '__LABLO_TEST__', { configurable: true, get: function () { return hook; }, set: function (real) { var first = null; hook = { focusPath: function () { var path = real.focusPath(); if (first === null) first = path; return first; } }; } }); })();",
  },
];

export const NO_POLYFILLS_VARIANT: Variant = {
  id: 'no-polyfills',
  description: 'the app built without core-js (Object.entries needs Chromium 54, padStart 57, queueMicrotask 71)',
  minChrome: 71,
  // The gallery needs no polyfill: without core-js it passes on every engine (step 11c).
  screens: ['hello'],
};

/** What a CSS seed did to app.css: the result, and how many rules or declarations it took out. */
export interface CssEdit {
  readonly css: string;
  readonly removed: number;
}

/**
 * Rewrites each style rule `edit` returns a replacement for (null keeps it), after stripping
 * the comments. Rules inside at-rule blocks (`@media`) count too; at-rules themselves
 * (`@font-face`, `@keyframes`) are kept. Enough for app.css, which has no braces in strings.
 */
function editRules(css: string, edit: (selector: string, body: string) => { rule: string; removed: number } | null): CssEdit {
  let removed = 0;
  const out = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]*)\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    const head = selector.trim();
    if (head.startsWith('@')) return rule;
    const next = edit(head, body);
    if (next === null) return rule;
    removed += next.removed;
    return next.rule;
  });
  return { css: out, removed };
}

/** Takes out the style rules whose selector `drop` matches. */
export function removeRules(css: string, drop: (selector: string) => boolean): CssEdit {
  return editRules(css, (selector) => (drop(selector) ? { rule: '', removed: 1 } : null));
}

/** Takes out the declarations `drop` matches from the rules whose selector is `selector`. */
export function removeDeclarations(css: string, selector: string, drop: (declaration: string) => boolean): CssEdit {
  return editRules(css, (head, body) => {
    if (head !== selector) return null;
    const declarations = body.split(';').map((d) => d.trim()).filter((d) => d !== '');
    const kept = declarations.filter((d) => !drop(d));
    if (kept.length === declarations.length) return null;
    return { rule: `\n${head} {\n${kept.map((d) => `  ${d};\n`).join('')}}`, removed: declarations.length - kept.length };
  });
}

export interface CssSeed extends Variant {
  /** Breaks app.css; staging fails when it takes nothing out, so a seed can't go stale. */
  readonly edit: (css: string) => CssEdit;
}

/** Every ListRow.css selector: `.z-row` itself and its `.z-row__*` parts, in both directions. */
const LIST_ROW_SELECTOR = /\.z-row(?:__|(?![\w-]))/;
/** Every live.css selector: `.live` itself and its `.live__*` parts, in both directions. */
const LIVE_SELECTOR = /\.live(?:__|(?![\w-]))/;

/**
 * Part of app.css missing. The gallery shows every component, so it runs the component seeds;
 * the live screen's own CSS shows only where the walk reaches the live screen.
 */
export const CSS_SEEDS: readonly CssSeed[] = [
  {
    id: 'seed-css-no-list-row',
    description: "app.css without ListRow.css's rules: the channel rows lose their 88 px height",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['gallery'],
    edit: (css) => removeRules(css, (selector) => LIST_ROW_SELECTOR.test(selector)),
  },
  {
    id: 'seed-css-no-safe-area',
    description: "the gallery's title-safe padding taken out of app.css: its components touch the screen's edges",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['gallery'],
    edit: (css) => removeDeclarations(css, '.gallery', (declaration) => declaration.startsWith('padding')),
  },
  {
    id: 'seed-css-no-live',
    description: "app.css without live.css's rules: the live screen loses its title-safe padding and its rail beside the list",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['onboarding'],
    edit: (css) => removeRules(css, (selector) => LIVE_SELECTOR.test(selector)),
  },
  {
    id: 'seed-css-no-guide-x',
    description: "app.css without the grid guide's cell positions (`left: var(--x)`, mirrored to `right` in Arabic): every cell of a row at its timeline's start",
    minChrome: Number.POSITIVE_INFINITY,
    screens: ['onboarding'],
    edit: dropGuideCellX,
  },
];

/** The rules postcss-rtlcss makes of `.z-guide__cell { left: var(--x) }`, one per direction. */
export const GUIDE_CELL_X: ReadonlyArray<readonly [selector: string, property: string]> = [
  ['[dir="ltr"] .z-guide__cell', 'left'],
  ['[dir="rtl"] .z-guide__cell', 'right'],
];

/**
 * Takes the cells' `left: var(--x)` and its mirror `right: var(--x)` out of app.css. Both must be
 * there (else it takes out nothing, and staging fails), so neither language can pass untested.
 */
export function dropGuideCellX(css: string): CssEdit {
  let out = css;
  let removed = 0;
  for (const [selector, property] of GUIDE_CELL_X) {
    const edit = removeDeclarations(out, selector, (declaration) => declaration.replace(/\s/g, '') === `${property}:var(--x)`);
    if (edit.removed === 0) return { css, removed: 0 };
    out = edit.css;
    removed += edit.removed;
  }
  return { css: out, removed };
}

/** Applies a CSS seed to app.css; throws when it took nothing out (a renamed class or file). */
export function seedCss(css: string, seed: CssSeed): string {
  const result = seed.edit(css);
  if (result.removed === 0) throw new Error(`${seed.id}: nothing to take out of app.css (was a class or a file renamed?)`);
  return result.css;
}

export function seedBundle(mainJs: string, seed: Pick<ScriptSeed, 'code'>): string {
  return `${seed.code}\n${mainJs}`;
}

/** Does this engine have to pass the variant? */
export function mustPass(variant: Variant, engineMajor: number): boolean {
  return engineMajor >= variant.minChrome;
}

function assertBuilt(distTv: string): void {
  for (const platform of TV_PLATFORMS) {
    const index = path.join(distTv, platform, 'index.html');
    if (!existsSync(index)) throw new Error(`${index} is missing: run pnpm build:tv first`);
  }
}

function copyPlatforms(distTv: string, target: string): void {
  rmSync(target, { recursive: true, force: true });
  for (const platform of TV_PLATFORMS) {
    cpSync(path.join(distTv, platform), path.join(target, platform), { recursive: true });
  }
}

/** Copies the real builds to `<root>/app`. */
export function stageApp(distTv: string, root: string): Variant {
  assertBuilt(distTv);
  copyPlatforms(distTv, path.join(root, APP_VARIANT.id));
  return APP_VARIANT;
}

/** Copies the real builds to `<root>/<seed>` and prepends the seed to each main.js. */
export function stageSeed(distTv: string, root: string, seed: ScriptSeed): Variant {
  assertBuilt(distTv);
  const target = path.join(root, seed.id);
  copyPlatforms(distTv, target);
  for (const platform of TV_PLATFORMS) {
    const main = path.join(target, platform, 'main.js');
    writeFileSync(main, seedBundle(readFileSync(main, 'utf8'), seed));
  }
  return seed;
}

/** Copies the real builds to `<root>/<seed>` and applies the CSS seed to each app.css. */
export function stageCssSeed(distTv: string, root: string, seed: CssSeed): Variant {
  assertBuilt(distTv);
  const target = path.join(root, seed.id);
  copyPlatforms(distTv, target);
  for (const platform of TV_PLATFORMS) {
    const css = path.join(target, platform, 'app.css');
    writeFileSync(css, seedCss(readFileSync(css, 'utf8'), seed));
  }
  return seed;
}

/** Builds the app without polyfills into `<root>/no-polyfills` (test-only build flag). */
export function stageNoPolyfills(repoRoot: string, root: string): Variant {
  const target = path.join(root, NO_POLYFILLS_VARIANT.id);
  mkdirSync(root, { recursive: true });
  const build = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tools/build/build-tv.ts', '--unsafe-no-polyfills', '--skip-package', '--out', target],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (build.status !== 0) throw new Error('build-tv --unsafe-no-polyfills failed');
  return NO_POLYFILLS_VARIANT;
}
