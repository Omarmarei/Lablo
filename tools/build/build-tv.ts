/**
 * `pnpm build:tv`: the production TV build (ADR-003, docs/architecture.md §4).
 *
 * For each TV platform:
 *   1. Bundle apps/tv/src/main.tsx as a Rollup IIFE through Babel (chrome 53) and core-js.
 *      Every `?worker` import is built the same way first and inlined as a Blob URL.
 *   2. ES2016 syntax gate on each worker and on the main bundle (inside bundleIife).
 *   3. Bundle budgets: main's own code ≤ 500 KB (the inlined workers don't count there),
 *      each worker ≤ 150 KB.
 *   4. Check that no other platform's adapter leaked into the bundle.
 *   5. app.css from the CSS files the bundle imports: postcss-rtlcss, the url() assets copied
 *      to assets/, the Chromium 53 CSS gate (src/css.ts).
 *   6. Stage dist/tv/<platform>/ (index.html, main.js, app.css, assets, manifest, icons).
 *   7. Package: webOS .ipk via ares-package; Tizen .wgt only with the Tizen CLI and a profile.
 *
 * Each platform is built twice: the app (apps/tv/src/main.tsx -> dist/tv) and the Zoma Lab
 * (apps/tv/src/lab/lab-main.tsx -> dist/tv-lab, its own app id; RELAY step 15a, src/lab.ts).
 *
 * Options: --platform tizen|webos (repeatable; default both), --target app|lab (repeatable;
 * default both), --skip-package.
 * Lab options: --lab-server http://host:port (the mock provider the TV reaches; default this
 * PC's LAN address, port 8080), --lab-version x.y.z (default the app's: raise it to test an
 * update over an installed lab, spike S2), --lab-write-mb N (S2's write test, default 200),
 * --lab-no-auto (wait for "Run all" instead of running at launch).
 * Test only (the old-engine harness self-test, tools/engines): --unsafe-no-polyfills builds
 * without core-js; it requires --out <dir> (the staging root instead of dist/tv) and skips
 * packaging, so an unpolyfilled build can never land in dist/. It builds the app only.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { BudgetResult } from './src/budgets';
import { bundleBudgets, formatBudget, kb } from './src/budgets';
import { SyntaxGateError, bundleIife } from './src/bundle';
import type { CssBuild } from './src/css';
import { ASSET_DIR, buildCss } from './src/css';
import { CssGateError } from './src/css-gate';
import type { LabConfigFile } from './src/lab';
import { DEFAULT_LAB_WRITE_MB, checkLabServer, labConfigScript, labManifest, lanAddress, renderLabIndexHtml } from './src/lab';
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
const DIST_LAB = path.join(ROOT, 'dist/tv-lab');
const NATIVE_PROBE = path.join(APP_DIR, 'src/lab/native-probe.js');
const DIST_PACKAGES = path.join(ROOT, 'dist/packages');
const MANIFESTS = new Set(['config.xml', 'appinfo.json']);
/**
 * Files shipped next to the CSS assets: the fonts' licence (the SIL Open Font License asks
 * for it to travel with the fonts).
 */
const LICENCES: ReadonlyArray<readonly [string, string]> = [['packages/ui/assets/fonts/OFL.txt', `${ASSET_DIR}/fonts-OFL.txt`]];

const rel = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');

type Target = 'app' | 'lab';
const TARGETS: readonly Target[] = ['app', 'lab'];

interface PlatformReport {
  readonly platform: TvPlatform;
  readonly target: Target;
  /** The staging root the platform's folder is in. */
  readonly outDir: string;
  readonly budgets: readonly BudgetResult[];
  readonly css: { readonly files: number; readonly bytes: number; readonly assets: number };
  readonly packaged: PackageResult | null;
}

interface BuildOptions {
  readonly version: string;
  readonly skipPackage: boolean;
  /** Staging root; `dist/tv` unless --out is given. */
  readonly outDir: string;
  readonly polyfills: boolean;
  /** The lab's settings (its staging root is dist/tv-lab). */
  readonly lab: LabConfigFile;
}

function stage(
  platform: TvPlatform,
  target: Target,
  mainJs: string,
  css: CssBuild,
  options: BuildOptions,
): { dir: string; webosApp?: { id: string; version: string } } {
  const lab = target === 'lab';
  const version = lab ? options.lab.version : options.version;
  const dir = path.join(lab ? DIST_LAB : options.outDir, platform);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'main.js'), mainJs);
  if (lab) {
    writeFileSync(path.join(dir, 'index.html'), renderLabIndexHtml(platform, readFileSync(NATIVE_PROBE, 'utf8')));
    writeFileSync(path.join(dir, 'lab-config.js'), labConfigScript(options.lab));
  } else {
    writeFileSync(path.join(dir, 'index.html'), renderIndexHtml(platform));
  }
  writeFileSync(path.join(dir, 'app.css'), css.css);
  for (const asset of css.assets) cpSync(asset.from, path.join(dir, asset.to));
  if (css.assets.length > 0) {
    for (const [from, to] of LICENCES) cpSync(path.join(ROOT, from), path.join(dir, to));
  }

  const platformDir = path.join(ROOT, 'platforms', platform);
  for (const name of readdirSync(platformDir)) {
    const source = path.join(platformDir, name);
    if (MANIFESTS.has(name)) {
      const filled = fillTemplate(readFileSync(source, 'utf8'), version);
      writeFileSync(path.join(dir, name), lab ? labManifest(platform, filled) : filled);
    }
    else cpSync(source, path.join(dir, name), { recursive: true });
  }

  if (platform === 'tizen') {
    checkConfigXml(readFileSync(path.join(dir, 'config.xml'), 'utf8'), version);
    return { dir };
  }
  return { dir, webosApp: checkAppinfo(readFileSync(path.join(dir, 'appinfo.json'), 'utf8'), version) };
}

async function buildPlatform(platform: TvPlatform, target: Target, options: BuildOptions): Promise<PlatformReport> {
  const label = target === 'lab' ? `lab main.js (${platform})` : `main.js (${platform})`;
  const bundle = await bundleIife({
    input: path.join(APP_DIR, target === 'lab' ? 'src/lab/lab-main.tsx' : 'src/main.tsx'),
    platform,
    label,
    polyfills: options.polyfills,
  });
  const { code } = bundle;

  const budgets = bundleBudgets(label, bundle, (w) => `worker ${rel(w.entry)} (${platform})`);

  const over = budgets.filter((b) => !b.ok);
  if (over.length > 0) {
    throw new Error(`Bundle budget exceeded:\n${over.map((b) => `  ${formatBudget(b)}`).join('\n')}`);
  }

  const leaked = foreignCode(platform, code);
  if (leaked.length > 0) {
    throw new Error(`${label} contains another platform's adapter (${leaked.join(', ')}); check the __PLATFORM__ branches`);
  }

  const css = await buildCss(bundle.css, `${target === 'lab' ? 'lab ' : ''}app.css (${platform})`);
  const staged = stage(platform, target, code, css, options);
  let packaged: PackageResult | null = null;
  if (!options.skipPackage) {
    packaged = staged.webosApp ? packageWebos(staged.dir, DIST_PACKAGES, staged.webosApp) : packageTizen(staged.dir, DIST_PACKAGES);
  }
  return {
    platform,
    target,
    outDir: path.dirname(staged.dir),
    budgets,
    css: { files: bundle.css.length, bytes: Buffer.byteLength(css.css, 'utf8'), assets: css.assets.length },
    packaged,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string', multiple: true },
      target: { type: 'string', multiple: true },
      'skip-package': { type: 'boolean', default: false },
      'lab-server': { type: 'string' },
      'lab-version': { type: 'string' },
      'lab-write-mb': { type: 'string' },
      'lab-no-auto': { type: 'boolean', default: false },
      out: { type: 'string' },
      'unsafe-no-polyfills': { type: 'boolean', default: false },
    },
  });
  const polyfills = !values['unsafe-no-polyfills'];
  if (!polyfills && values.out === undefined) {
    throw new Error('--unsafe-no-polyfills is for the old-engine self-test only and needs --out <dir> (never dist/tv)');
  }
  const outDir = values.out === undefined ? DIST_TV : path.resolve(values.out);
  if (!polyfills && path.relative(DIST_TV, outDir) === '') throw new Error('--unsafe-no-polyfills must not write to dist/tv');
  const requested = values.platform ?? [...TV_PLATFORMS];
  const unknown = requested.filter((p) => !(TV_PLATFORMS as readonly string[]).includes(p));
  if (unknown.length > 0) throw new Error(`unknown --platform ${unknown.join(', ')} (expected tizen or webos)`);
  const platforms = requested as TvPlatform[];
  // An --out build (the harness's unpolyfilled app) is the app only.
  const requestedTargets = values.target ?? (values.out === undefined ? [...TARGETS] : ['app']);
  const badTargets = requestedTargets.filter((t) => !(TARGETS as readonly string[]).includes(t));
  if (badTargets.length > 0) throw new Error(`unknown --target ${badTargets.join(', ')} (expected app or lab)`);
  const targets = TARGETS.filter((t) => requestedTargets.includes(t));
  if (!polyfills && targets.includes('lab')) throw new Error('--unsafe-no-polyfills builds the app only (no --target lab)');

  const version = (JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')) as { version: string }).version;
  assertAppVersion(version);

  const bootViolation = checkSyntax(BOOT_ERROR_SCRIPT, 'index.html boot-error script');
  if (bootViolation !== null) throw new SyntaxGateError(formatViolation(bootViolation));
  const probeViolation = checkSyntax(readFileSync(NATIVE_PROBE, 'utf8'), 'lab index.html native probe');
  if (probeViolation !== null) throw new SyntaxGateError(formatViolation(probeViolation));

  const labVersion = values['lab-version'] ?? version;
  assertAppVersion(labVersion);
  const writeMb = values['lab-write-mb'] === undefined ? DEFAULT_LAB_WRITE_MB : Number(values['lab-write-mb']);
  if (!Number.isInteger(writeMb) || writeMb < 1) throw new Error('--lab-write-mb must be a whole number of MB');
  const lab: LabConfigFile = {
    server: checkLabServer(values['lab-server'] ?? `http://${lanAddress(networkInterfaces())}:8080`),
    version: labVersion,
    writeMb,
    autoRun: !values['lab-no-auto'],
  };

  const options: BuildOptions = {
    version,
    // An unpolyfilled build is never packaged.
    skipPackage: values['skip-package'] || !polyfills,
    outDir,
    polyfills,
    lab,
  };
  console.log(`Zoma TV build ${version}: ${platforms.join(', ')}, ${targets.join(' and ')}${polyfills ? '' : ' (UNSAFE: no polyfills, test only)'}`);
  if (targets.includes('lab')) console.log(`Zoma Lab ${lab.version}: results to ${lab.server}${lab.autoRun ? ', runs at launch' : ''}`);

  for (const target of targets) {
    for (const platform of platforms) {
      const started = Date.now();
      printReport(await buildPlatform(platform, target, options), started);
    }
  }
}

function printReport(report: PlatformReport, started: number): void {
  const platform = report.target === 'lab' ? `lab ${report.platform}` : report.platform;
  console.log(`\n[${platform}] built in ${((Date.now() - started) / 1000).toFixed(1)} s, ES2016 and CSS gates passed`);
  for (const budget of report.budgets) console.log(`  ${formatBudget(budget)}`);
  console.log(`  app.css: ${kb(report.css.bytes)} from ${report.css.files} files, ${report.css.assets} assets`);
  console.log(`  staged:  ${rel(path.join(report.outDir, report.platform))}/`);
  if (report.packaged === null) console.log('  package: skipped (--skip-package)');
  else if (report.packaged.ok) console.log(`  package: ${rel(report.packaged.file)}`);
  else console.log(`  package: skipped, ${report.packaged.skipped}`);
}

main().catch(
  (error: unknown) => {
    if (error instanceof SyntaxGateError || error instanceof CssGateError) console.error(`\n${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  },
);
