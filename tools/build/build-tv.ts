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
 * Each platform is built three times: the app (apps/tv/src/main.tsx -> dist/tv), the app's test
 * copy with the developer screens (-> dist/tv-dev; RELAY step 35b: the hello screen and the
 * galleries behind `?screen=`, which the store build swaps out, `STORE_SWAPS` in src/bundle.ts;
 * never packaged, and only its workers have a budget) and the Lablo Lab
 * (apps/tv/src/lab/lab-main.tsx -> dist/tv-lab, its own app id; RELAY step 15a, src/lab.ts).
 * The three share each worker's build (`workerCache`).
 * Then once, for both platforms, the crypto vectors page (apps/tv/src/vectors -> dist/tv-vectors:
 * @lablo/crypto's shared vectors through this pipeline, for the old engines; step 29b1, src/vectors.ts).
 *
 * Options: --platform tizen|webos (repeatable; default both), --target app|dev|lab|vectors
 * (repeatable; default all four), --skip-package.
 * Lab options: --lab-server http://host:port (the mock provider the TV reaches; default this
 * PC's LAN address, port 8080), --lab-version x.y.z (default the app's: raise it to test an
 * update over an installed lab, spike S2), --lab-write-mb N (S2's write test, default 200),
 * --lab-no-auto (wait for "Run all" instead of running at launch).
 * --out <dir>: the staging root of one app build instead of dist/tv (or dist/tv-dev): the app,
 * or `--target dev`. Test only (the old-engine harness self-test, tools/engines):
 * --unsafe-no-polyfills builds without core-js; it requires --out and skips packaging, so an
 * unpolyfilled build can never land in dist/. It builds the app or its test copy only.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { BudgetResult } from './src/budgets';
import { bundleBudgets, formatBudget, kb } from './src/budgets';
import type { BundleResult } from './src/bundle';
import { SyntaxGateError, bundleIife } from './src/bundle';
import type { CssBuild } from './src/css';
import { ASSET_DIR, buildCss } from './src/css';
import { CssGateError } from './src/css-gate';
import type { LabConfigFile } from './src/lab';
import { checkAcg } from './src/acg';
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
import { readVectorsJson, renderVectorsIndexHtml, vectorsDataScript } from './src/vectors';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_DIR = path.join(ROOT, 'apps/tv');
const DIST_TV = path.join(ROOT, 'dist/tv');
const DIST_DEV = path.join(ROOT, 'dist/tv-dev');
const DIST_LAB = path.join(ROOT, 'dist/tv-lab');
const DIST_VECTORS = path.join(ROOT, 'dist/tv-vectors');
const NATIVE_PROBE = path.join(APP_DIR, 'src/lab/native-probe.js');
const DIST_PACKAGES = path.join(ROOT, 'dist/packages');
const MANIFESTS = new Set(['config.xml', 'appinfo.json']);
/**
 * Files shipped next to the CSS assets: the fonts' licence (the SIL Open Font License asks
 * for it to travel with the fonts).
 */
const LICENCES: ReadonlyArray<readonly [string, string]> = [['packages/ui/assets/fonts/OFL.txt', `${ASSET_DIR}/fonts-OFL.txt`]];

const rel = (file: string): string => path.relative(ROOT, file).split(path.sep).join('/');

type Target = 'app' | 'dev' | 'lab' | 'vectors';
const TARGETS: readonly Target[] = ['app', 'dev', 'lab', 'vectors'];

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
  /** The app's staging root; `dist/tv` unless --out is given. */
  readonly outDir: string;
  /** The test copy's staging root (`dev`); `dist/tv-dev` unless --out is given. */
  readonly devOutDir: string;
  readonly polyfills: boolean;
  /** Each worker's build, shared by the app, its test copy and the lab (`BundleOptions.workerCache`). */
  readonly workerCache: Map<string, BundleResult>;
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
  const dir = path.join(lab ? DIST_LAB : target === 'dev' ? options.devOutDir : options.outDir, platform);
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
  const { id, requiredACG } = checkAppinfo(readFileSync(path.join(dir, 'appinfo.json'), 'utf8'), version);
  const acgProblems = checkAcg(mainJs, requiredACG, { declareBundle: lab });
  if (acgProblems.length > 0) {
    throw new Error(`${lab ? 'lab ' : ''}appinfo.json (webos), requiredACG:\n${acgProblems.map((p) => `  ${p}`).join('\n')}`);
  }
  return { dir, webosApp: { id, version } };
}

async function buildPlatform(platform: TvPlatform, target: Target, options: BuildOptions): Promise<PlatformReport> {
  const label = target === 'lab' ? `lab main.js (${platform})` : target === 'dev' ? `test copy main.js (${platform})` : `main.js (${platform})`;
  const bundle = await bundleIife({
    input: path.join(APP_DIR, target === 'lab' ? 'src/lab/lab-main.tsx' : 'src/main.tsx'),
    platform,
    label,
    polyfills: options.polyfills,
    devScreens: target === 'dev',
    workerCache: options.workerCache,
  });
  const { code } = bundle;

  const budgets = bundleBudgets(label, bundle, (w) => `worker ${rel(w.entry)} (${platform})`);

  // The test copy never ships: its main.js (the app's and the developer screens') has no budget.
  const over = budgets.filter((b) => !b.ok && !(target === 'dev' && b.kind === 'main'));
  if (over.length > 0) {
    throw new Error(`Bundle budget exceeded:\n${over.map((b) => `  ${formatBudget(b)}`).join('\n')}`);
  }

  const leaked = foreignCode(platform, code);
  if (leaked.length > 0) {
    throw new Error(`${label} contains another platform's adapter (${leaked.join(', ')}); check the __PLATFORM__ branches`);
  }

  const css = await buildCss(bundle.css, `${target === 'lab' ? 'lab ' : target === 'dev' ? 'test copy ' : ''}app.css (${platform})`);
  const staged = stage(platform, target, code, css, options);
  let packaged: PackageResult | null = null;
  if (!options.skipPackage && target !== 'dev') {
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

/**
 * The crypto vectors page: the page and its inlined worker through bundleIife (Babel chrome 53,
 * core-js, the ES2016 gate), the vectors as a gated classic script. Not packaged, no budget.
 */
async function buildVectors(): Promise<{ mainBytes: number; workerBytes: number; dataBytes: number }> {
  const bundle = await bundleIife({ input: path.join(APP_DIR, 'src/vectors/vectors-main.ts'), platform: 'webos', label: 'vectors main.js' });
  if (bundle.css.length > 0) throw new Error(`the vectors page imports CSS (${bundle.css.map(rel).join(', ')})`);
  const data = vectorsDataScript(readVectorsJson(ROOT));
  const dataViolation = checkSyntax(data, 'vectors vectors.js');
  if (dataViolation !== null) throw new SyntaxGateError(formatViolation(dataViolation));
  rmSync(DIST_VECTORS, { recursive: true, force: true });
  mkdirSync(DIST_VECTORS, { recursive: true });
  writeFileSync(path.join(DIST_VECTORS, 'index.html'), renderVectorsIndexHtml());
  writeFileSync(path.join(DIST_VECTORS, 'main.js'), bundle.code);
  writeFileSync(path.join(DIST_VECTORS, 'vectors.js'), data);
  const workerBytes = bundle.workers.reduce((sum, worker) => sum + Buffer.byteLength(worker.code, 'utf8'), 0);
  return { mainBytes: Buffer.byteLength(bundle.code, 'utf8') - bundle.inlinedBytes, workerBytes, dataBytes: Buffer.byteLength(data, 'utf8') };
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
  const out = values.out === undefined ? null : path.resolve(values.out);
  if (!polyfills && out !== null && (path.relative(DIST_TV, out) === '' || path.relative(DIST_DEV, out) === '')) {
    throw new Error('--unsafe-no-polyfills must not write to dist/tv or dist/tv-dev');
  }
  const requested = values.platform ?? [...TV_PLATFORMS];
  const unknown = requested.filter((p) => !(TV_PLATFORMS as readonly string[]).includes(p));
  if (unknown.length > 0) throw new Error(`unknown --platform ${unknown.join(', ')} (expected tizen or webos)`);
  const platforms = requested as TvPlatform[];
  // An --out build (the harness's unpolyfilled copy) is one app build: the app, or its test copy.
  const requestedTargets = values.target ?? (out === null ? [...TARGETS] : ['app']);
  const badTargets = requestedTargets.filter((t) => !(TARGETS as readonly string[]).includes(t));
  if (badTargets.length > 0) throw new Error(`unknown --target ${badTargets.join(', ')} (expected app, dev, lab or vectors)`);
  const targets = TARGETS.filter((t) => requestedTargets.includes(t));
  if (out !== null && (targets.length !== 1 || (targets[0] !== 'app' && targets[0] !== 'dev'))) {
    throw new Error('--out stages one app build: --target app or --target dev');
  }

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
    outDir: out ?? DIST_TV,
    devOutDir: out ?? DIST_DEV,
    polyfills,
    workerCache: new Map(),
    lab,
  };
  console.log(`Lablo TV build ${version}: ${platforms.join(', ')}, ${targets.join(', ')}${polyfills ? '' : ' (UNSAFE: no polyfills, test only)'}`);
  if (targets.includes('lab')) console.log(`Lablo Lab ${lab.version}: results to ${lab.server}${lab.autoRun ? ', runs at launch' : ''}`);

  for (const target of targets) {
    if (target === 'vectors') {
      const started = Date.now();
      const sizes = await buildVectors();
      console.log(`\n[crypto vectors] built in ${((Date.now() - started) / 1000).toFixed(1)} s, ES2016 gate passed`);
      console.log(`  main.js ${kb(sizes.mainBytes)} + its two workers ${kb(sizes.workerBytes)}, vectors.js ${kb(sizes.dataBytes)}`);
      console.log(`  staged:  ${rel(DIST_VECTORS)}/`);
      continue;
    }
    for (const platform of platforms) {
      const started = Date.now();
      printReport(await buildPlatform(platform, target, options), started);
    }
  }
}

function printReport(report: PlatformReport, started: number): void {
  const platform = report.target === 'lab' ? `lab ${report.platform}` : report.target === 'dev' ? `test copy ${report.platform}` : report.platform;
  console.log(`\n[${platform}] built in ${((Date.now() - started) / 1000).toFixed(1)} s, ES2016 and CSS gates passed`);
  for (const budget of report.budgets) {
    // (The test copy's main.js has no budget: its size, for the record.)
    if (report.target === 'dev' && budget.kind === 'main') console.log(`  size ${budget.label}: ${kb(budget.bytes)} own code (no budget: never shipped)`);
    else console.log(`  ${formatBudget(budget)}`);
  }
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
