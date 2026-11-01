/**
 * `pnpm build:tv`: the production TV build (ADR-003, docs/architecture.md §4).
 *
 * For each TV platform:
 *   1. Bundle apps/tv/src/main.tsx as a Rollup IIFE through Babel (chrome 53) and core-js.
 *      Every `?worker` import is built the same way first and inlined as a Blob URL.
 *   2. ES2016 syntax gate on each worker and on the main bundle (inside bundleIife).
 *   3. Bundle budgets: main ≤ 500 KB, each worker ≤ 150 KB.
 *   4. Check that no other platform's adapter leaked into the bundle.
 *   5. Stage dist/tv/<platform>/ (index.html, main.js, app.css, manifest, icons).
 *   6. Package: webOS .ipk via ares-package; Tizen .wgt only with the Tizen CLI and a profile.
 *
 * Options: --platform tizen|webos (repeatable; default both), --skip-package.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { BudgetResult } from './src/budgets';
import { checkBudget, formatBudget } from './src/budgets';
import { SyntaxGateError, bundleIife } from './src/bundle';
import type { PackageResult } from './src/package';
import { packageTizen, packageWebos } from './src/package';
import type { TvPlatform } from './src/platform-files';
import {
  BOOT_ERROR_SCRIPT,
  TV_PLATFORMS,
  assertAppVersion,
  checkAppinfo,
  checkConfigXml,
  fillTemplate,
  foreignCode,
  renderIndexHtml,
} from './src/platform-files';
import { checkSyntax, formatViolation } from './src/syntax-gate';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_DIR = path.join(ROOT, 'apps/tv');
const DIST_TV = path.join(ROOT, 'dist/tv');
const DIST_PACKAGES = path.join(ROOT, 'dist/packages');
const MANIFESTS = new Set(['config.xml', 'appinfo.json']);

const rel = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');

interface PlatformReport {
  readonly platform: TvPlatform;
  readonly budgets: readonly BudgetResult[];
  readonly packaged: PackageResult | null;
}

function stage(platform: TvPlatform, mainJs: string, version: string): { dir: string; webosApp?: { id: string; version: string } } {
  const dir = path.join(DIST_TV, platform);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'main.js'), mainJs);
  writeFileSync(path.join(dir, 'index.html'), renderIndexHtml(platform));
  cpSync(path.join(APP_DIR, 'src/app.css'), path.join(dir, 'app.css'));

  const platformDir = path.join(ROOT, 'platforms', platform);
  for (const name of readdirSync(platformDir)) {
    const source = path.join(platformDir, name);
    if (MANIFESTS.has(name)) writeFileSync(path.join(dir, name), fillTemplate(readFileSync(source, 'utf8'), version));
    else cpSync(source, path.join(dir, name), { recursive: true });
  }

  if (platform === 'tizen') {
    checkConfigXml(readFileSync(path.join(dir, 'config.xml'), 'utf8'), version);
    return { dir };
  }
  return { dir, webosApp: checkAppinfo(readFileSync(path.join(dir, 'appinfo.json'), 'utf8'), version) };
}

async function buildPlatform(platform: TvPlatform, version: string, skipPackage: boolean): Promise<PlatformReport> {
  const label = `main.js (${platform})`;
  const { code, workers } = await bundleIife({ input: path.join(APP_DIR, 'src/main.tsx'), platform, label });

  const budgets = [
    checkBudget(label, 'main', code),
    ...workers.map((w) => checkBudget(`worker ${rel(w.entry)} (${platform})`, 'worker', w.code)),
  ];

  const over = budgets.filter((b) => !b.ok);
  if (over.length > 0) {
    throw new Error(`Bundle budget exceeded:\n${over.map((b) => `  ${formatBudget(b)}`).join('\n')}`);
  }

  const leaked = foreignCode(platform, code);
  if (leaked.length > 0) {
    throw new Error(`${label} contains another platform's adapter (${leaked.join(', ')}); check the __PLATFORM__ branches`);
  }

  const staged = stage(platform, code, version);
  let packaged: PackageResult | null = null;
  if (!skipPackage) {
    packaged = staged.webosApp ? packageWebos(staged.dir, DIST_PACKAGES, staged.webosApp) : packageTizen(staged.dir, DIST_PACKAGES);
  }
  return { platform, budgets, packaged };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string', multiple: true },
      'skip-package': { type: 'boolean', default: false },
    },
  });
  const requested = values.platform ?? [...TV_PLATFORMS];
  const unknown = requested.filter((p) => !(TV_PLATFORMS as readonly string[]).includes(p));
  if (unknown.length > 0) throw new Error(`unknown --platform ${unknown.join(', ')} (expected tizen or webos)`);
  const platforms = requested as TvPlatform[];

  const version = (JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')) as { version: string }).version;
  assertAppVersion(version);

  const bootViolation = checkSyntax(BOOT_ERROR_SCRIPT, 'index.html boot-error script');
  if (bootViolation !== null) throw new SyntaxGateError(formatViolation(bootViolation));

  console.log(`Zoma TV build ${version}: ${platforms.join(', ')}`);

  for (const platform of platforms) {
    const started = Date.now();
    const report = await buildPlatform(platform, version, values['skip-package']);

    console.log(`\n[${platform}] built in ${((Date.now() - started) / 1000).toFixed(1)} s, ES2016 gate passed`);
    for (const budget of report.budgets) console.log(`  ${formatBudget(budget)}`);
    console.log(`  staged:  ${rel(path.join(DIST_TV, platform))}/`);
    if (report.packaged === null) console.log('  package: skipped (--skip-package)');
    else if (report.packaged.ok) console.log(`  package: ${rel(report.packaged.file)}`);
    else console.log(`  package: skipped, ${report.packaged.skipped}`);
  }
}

main().catch(
  (error: unknown) => {
    if (error instanceof SyntaxGateError) console.error(`\n${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  },
);
