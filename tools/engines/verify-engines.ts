/**
 * `pnpm verify:engines`: runs the built TV apps (dist/tv, from `pnpm build:tv`) in real old
 * Chromium engines: 53 (LG webOS 4, 2018), 56 (Samsung Tizen 4, 2018) and 68 (2020 sets).
 * See docs/runbooks/old-engines.md.
 *
 * Per engine: the pinned snapshot is downloaded once into .cache/engines (SHA-256 checked),
 * started headed under Xvfb in Docker, and driven over raw CDP. Per app: boot with no syntax or
 * runtime error, the Blob worker and an IndexedDB write/read in it, and remote keys → intents.
 *
 * Options:
 *   --engine chrome53|chrome56|chrome68   repeatable; default all
 *   --dist <dir>                          the builds to test (default dist/tv)
 *   --self-test                           also run seeded broken bundles that must fail
 *   --keep                                leave the containers running (for debugging)
 * Environment: ZOMA_ENGINE_CACHE overrides the download cache directory.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { connectToPage, waitForDevtools } from './src/cdp';
import { assertDockerRunning, engineLogs, ensureImage, startEngine, stopEngine } from './src/docker';
import type { Engine } from './src/engines';
import { TV_RUNTIME_FLAGS, selectEngines } from './src/engines';
import { ensureEngineZip } from './src/fetch';
import type { PlatformRun } from './src/scenario';
import { TV_PLATFORMS, evaluateRun, runPlatform } from './src/scenario';
import type { Variant } from './src/variants';
import { SEEDS, mustPass, stageApp, stageNoPolyfills, stageSeed } from './src/variants';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/engines');
const VARIANTS_DIR = path.join(OUT, 'variants');
const BOOT_TIMEOUT_MS = 20_000;
const KEY_TIMEOUT_MS = 3_000;

const log = (line: string): void => console.log(line);

interface RunReport {
  readonly engine: string;
  readonly variant: string;
  readonly platform: string;
  readonly userAgent: string | null;
  readonly failures: readonly string[];
  readonly mustPass: boolean;
  readonly durationMs: number;
}

async function runEngine(engine: Engine, zip: string, image: string, variants: readonly Variant[], keep: boolean): Promise<RunReport[]> {
  const running = startEngine({
    image,
    zip,
    appDir: VARIANTS_DIR,
    name: `zoma-${engine.id}-${process.pid}-${Date.now()}`,
    chromeFlags: TV_RUNTIME_FLAGS,
  });
  const reports: RunReport[] = [];
  try {
    const version = await waitForDevtools(running.port, 60_000);
    log(`\n${engine.id}: ${version.Browser}, standing in for ${engine.tvs}`);
    const client = await connectToPage(running.port);
    try {
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      // Chromium 53 reports uncaught errors only through the (later deprecated) Console domain.
      await client.send('Console.enable').catch(() => undefined);
      for (const variant of variants) {
        for (const platform of TV_PLATFORMS) {
          const url = `file:///app/${variant.id}/${platform}/index.html`;
          const run: PlatformRun = await runPlatform(client, platform, url, { bootTimeoutMs: BOOT_TIMEOUT_MS, keyTimeoutMs: KEY_TIMEOUT_MS });
          const failures = evaluateRun(run, engine, BOOT_TIMEOUT_MS);
          const report: RunReport = {
            engine: engine.id,
            variant: variant.id,
            platform,
            userAgent: run.boot?.userAgent ?? null,
            failures,
            mustPass: mustPass(variant, engine.major),
            durationMs: run.durationMs,
          };
          reports.push(report);
          const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
          const expected = report.mustPass === (failures.length === 0) ? '' : '  <-- UNEXPECTED';
          log(`  ${variant.id.padEnd(30)} ${platform.padEnd(6)} ${verdict} ${(run.durationMs / 1000).toFixed(1)} s${expected}`);
          for (const failure of failures) log(`      ${failure}`);
        }
      }
    } finally {
      client.close();
    }
  } catch (error) {
    log(`\n${engine.id}: the engine run itself failed; container output:\n${engineLogs(running.container)}`);
    throw error;
  } finally {
    if (keep) log(`  container kept: ${running.container} (DevTools on 127.0.0.1:${running.port})`);
    else stopEngine(running.container);
  }
  return reports;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      engine: { type: 'string', multiple: true },
      dist: { type: 'string', default: 'dist/tv' },
      'self-test': { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
    },
  });
  const engines = selectEngines(values.engine ?? []);
  const selfTest = values['self-test'];
  const distTv = path.resolve(ROOT, values.dist);
  const cacheDir = path.resolve(ROOT, process.env.ZOMA_ENGINE_CACHE ?? '.cache/engines');

  assertDockerRunning();
  const image = ensureImage(path.join(import.meta.dirname, 'docker'), log);

  rmSync(VARIANTS_DIR, { recursive: true, force: true });
  mkdirSync(VARIANTS_DIR, { recursive: true });
  const variants: Variant[] = [stageApp(distTv, VARIANTS_DIR)];
  if (selfTest) {
    variants.push(...SEEDS.map((seed) => stageSeed(distTv, VARIANTS_DIR, seed)));
    log('\nbuilding the no-polyfills variant (test only)');
    variants.push(stageNoPolyfills(ROOT, VARIANTS_DIR));
  }

  const reports: RunReport[] = [];
  for (const engine of engines) {
    const zip = await ensureEngineZip(engine, cacheDir, log);
    reports.push(...(await runEngine(engine, zip, image, variants, values.keep)));
  }

  writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(reports, null, 2)}\n`);
  const unexpected = reports.filter((report) => report.mustPass !== (report.failures.length === 0));
  const caught = reports.filter((report) => !report.mustPass && report.failures.length > 0);

  log('');
  if (selfTest) log(`self-test: ${caught.length} seeded failures caught as expected`);
  if (unexpected.length > 0) {
    log(`${unexpected.length} unexpected result(s):`);
    for (const report of unexpected) {
      log(`  ${report.engine} ${report.variant} ${report.platform}: ${report.mustPass ? 'failed' : 'passed but must fail'}`);
    }
    log(`report: ${path.relative(ROOT, path.join(OUT, 'report.json'))}`);
    process.exitCode = 1;
    return;
  }
  log(`all ${reports.length} runs as expected on ${engines.map((e) => e.id).join(', ')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
