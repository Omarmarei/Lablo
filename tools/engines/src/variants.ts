/**
 * The bundles the harness runs. Normally only `app`: the real TV builds from `pnpm build:tv`.
 *
 * `--self-test` adds deliberately broken bundles to prove the harness catches what the TVs
 * would choke on, even if the build-time ES2016 gate were bypassed:
 * - a seeded ES2018 feature (object spread, Chromium 60+), prepended to the shipped main.js;
 * - a seeded ES2020 feature (optional chaining, Chromium 80+), which even Chromium 68 rejects;
 * - the real app built without core-js (`build-tv --unsafe-no-polyfills`): `Object.entries`
 *   (in the worker) is missing before Chromium 54, `padStart` before 57 and `queueMicrotask`
 *   (used by the app's dependencies) before 71, so it fails on every engine we run.
 * Each variant must fail on every engine older than `minChrome` and pass on the rest.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TV_PLATFORMS } from './scenario';

export interface Variant {
  readonly id: string;
  readonly description: string;
  /** Engines below this Chromium major must report a failure; the others must pass. */
  readonly minChrome: number;
}

export interface Seed extends Variant {
  /** The ECMAScript edition that introduced the seeded syntax. */
  readonly ecmaVersion: 2018 | 2020;
  /** A complete statement using only that syntax, prepended to main.js. */
  readonly code: string;
}

export const APP_VARIANT: Variant = { id: 'app', description: 'the TV builds from pnpm build:tv', minChrome: 0 };

export const SEEDS: readonly Seed[] = [
  {
    id: 'seed-es2018-object-spread',
    description: 'ES2018 object spread prepended to main.js',
    ecmaVersion: 2018,
    minChrome: 60,
    code: 'var __zomaSeed = { ...{ seeded: true } };',
  },
  {
    id: 'seed-es2020-optional-chaining',
    description: 'ES2020 optional chaining prepended to main.js',
    ecmaVersion: 2020,
    minChrome: 80,
    code: 'var __zomaSeed = window.__zomaMissing?.value;',
  },
];

export const NO_POLYFILLS_VARIANT: Variant = {
  id: 'no-polyfills',
  description: 'the app built without core-js (Object.entries needs Chromium 54, padStart 57, queueMicrotask 71)',
  minChrome: 71,
};

export function seedBundle(mainJs: string, seed: Seed): string {
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
export function stageSeed(distTv: string, root: string, seed: Seed): Variant {
  assertBuilt(distTv);
  const target = path.join(root, seed.id);
  copyPlatforms(distTv, target);
  for (const platform of TV_PLATFORMS) {
    const main = path.join(target, platform, 'main.js');
    writeFileSync(main, seedBundle(readFileSync(main, 'utf8'), seed));
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
