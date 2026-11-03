/**
 * `pnpm verify:engines`: runs the built TV apps (dist/tv, from `pnpm build:tv`) in real old
 * Chromium engines: 53 (LG webOS 4, 2018), 56 (Samsung Tizen 4, 2018) and 68 (2020 sets).
 * See docs/runbooks/old-engines.md.
 *
 * Per engine: the pinned snapshot is downloaded once into .cache/engines (SHA-256 checked),
 * started headed under Xvfb in Docker, and driven over raw CDP. Per app: boot with no syntax or
 * runtime error, the Blob worker and an IndexedDB write/read in it, the data workers (refresh a
 * fixture playlist served in the container, then search it), and remote keys → intents. Then
 * the component gallery (`?screen=gallery`): the layout at 1920x1080, the rows, the focus, the
 * fonts, and a screenshot (artifacts/engines/gallery-<engine>-<platform>.png); then the same in
 * Arabic after the language switch by keys, with the bidi probe (FSI/PDI) and `-ar.png`. Then
 * onboarding, the start screen (no `?screen=`), walked by keys in English and in Arabic from a
 * fresh database: the fixture playlist's link typed into the field, loading, done with its
 * counts, and a relaunch that skips onboarding (artifacts/engines/onboarding-*.png).
 *
 * Options:
 *   --engine chrome53|chrome56|chrome68   repeatable; default all
 *   --dist <dir>                          the builds to test (default dist/tv)
 *   --self-test                           also run seeded broken bundles that must fail
 *   --keep                                leave the containers running (for debugging)
 * Environment: ZOMA_ENGINE_CACHE overrides the download cache directory.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { CdpClient } from './src/cdp';
import { connectToPage, waitForDevtools } from './src/cdp';
import { assertDockerRunning, engineLogs, ensureImage, startEngine, stopEngine } from './src/docker';
import type { Engine } from './src/engines';
import { TV_RUNTIME_FLAGS, TV_SCREEN_FLAGS, selectEngines } from './src/engines';
import { ensureEngineZip } from './src/fetch';
import type { DataCheck } from './src/fixture';
import { appUrl, stageFixtures } from './src/fixture';
import type { BidiState, GalleryRun } from './src/gallery';
import { evaluateGallery, galleryUrl, runGallery } from './src/gallery';
import type { OnboardingRun, WalkLanguage } from './src/onboarding';
import { evaluateOnboarding, onboardingUrl, runOnboarding, stageBlankPage, stepTime } from './src/onboarding';
import type { PlatformRun, TvPlatform } from './src/scenario';
import { TV_PLATFORMS, evaluateRun, runPlatform } from './src/scenario';
import type { AppScreen, Variant } from './src/variants';
import { APP_VARIANT, CSS_SEEDS, SEEDS, WALK_SEEDS, mustPass, stageApp, stageCssSeed, stageNoPolyfills, stageSeed } from './src/variants';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/engines');
const VARIANTS_DIR = path.join(OUT, 'variants');
const BOOT_TIMEOUT_MS = 20_000;
const KEY_TIMEOUT_MS = 3_000;
/** "Add source" to the done screen: the fixture's 3,000 items and its guide, in the old engine. */
const LOAD_TIMEOUT_MS = 60_000;

const log = (line: string): void => console.log(line);

interface RunReport {
  readonly engine: string;
  readonly variant: string;
  readonly platform: string;
  readonly screen: AppScreen;
  readonly userAgent: string | null;
  /** What the catalog panel showed: the refresh, the search, the guide and now/next. */
  readonly refresh: string | null;
  readonly search: string | null;
  readonly guide: string | null;
  readonly nowNext: string | null;
  /** The gallery's screenshots, relative to the repo (app variant only). */
  readonly screenshot: string | null;
  readonly arabicScreenshot: string | null;
  /** The gallery's bidi probe in Arabic: the isolation's width and run order (null on the hello screen). */
  readonly bidi: BidiState | null;
  /** Onboarding's walks: the time to the first screen, the load and the relaunch, in ms (null elsewhere). */
  readonly onboarding: readonly WalkTimes[] | null;
  readonly failures: readonly string[];
  readonly mustPass: boolean;
  readonly durationMs: number;
}

/** `3000 items, gzip; "news" 308 hits; guide 300/2400` for the log, from what the page showed. */
function dataSummary(run: PlatformRun): string {
  const boot = run.boot;
  if (run.data === null || boot?.ingest?.startsWith('ok: ') !== true) return '';
  const gzip = boot.gzip === 'true' ? ', gzip' : '';
  const hits = boot.search?.startsWith('ok: ') === true ? `; "${run.data.query}" ${boot.searchTotal ?? '?'} hits` : '';
  const guide = boot.epg?.startsWith('ok: ') === true ? `; guide ${boot.epgMatched ?? '?'}/${boot.epgWanted ?? '?'}` : '';
  const onAir = boot.nowNext?.startsWith('ok: ') === true ? ', now/next' : '';
  return `  data: ${boot.ingestItems ?? '?'} items${gzip}${hits}${guide}${onAir}`;
}

/** `7 rows of 88 px; gallery-chrome53-tizen.png; Arabic: isolation +0 px, gallery-chrome53-tizen-ar.png` for the log. */
function gallerySummary(run: GalleryRun): string {
  const rows = run.boot?.rows ?? [];
  if (rows.length === 0) return '';
  const heights = [...new Set(rows)].join('/');
  const shot = run.screenshot === null ? '' : `; ${path.basename(run.screenshot)}`;
  const bidi = run.bidi === null ? '' : `; Arabic: isolation +${Math.round((run.bidi.isolated - run.bidi.plain) * 10) / 10} px`;
  const arabicShot = run.arabicScreenshot === null ? '' : `, ${path.basename(run.arabicScreenshot)}`;
  return `  ${rows.length} rows of ${heights} px${shot}${bidi}${arabicShot}`;
}

interface WalkTimes {
  readonly language: WalkLanguage;
  /** From the navigation to the first screen: the profile read behind the spinner. */
  readonly firstScreenMs: number | null;
  readonly loadMs: number | null;
  /** From the relaunch to the hello screen. */
  readonly relaunchMs: number | null;
  readonly phases: readonly string[] | null;
  readonly screenshots: readonly string[];
}

const seconds = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);

/** `en: first screen 0.2 s, load 2.0 s, relaunch 0.2 s; ar: …` for the log. */
function onboardingSummary(run: OnboardingRun): string {
  const walks = run.walks
    .filter((walk) => walk.steps.length > 0)
    .map((walk) => `${walk.language}: first screen ${seconds(stepTime(walk, 'start'))}, load ${seconds(stepTime(walk, 'add'))}, relaunch ${seconds(stepTime(walk, 'relaunch'))}`);
  return walks.length === 0 ? '' : `  ${walks.join('; ')}`;
}

/** A path relative to the repo, with forward slashes. */
const repoPath = (file: string | null): string | null => (file === null ? null : path.relative(ROOT, file).split(path.sep).join('/'));

interface Outcome {
  readonly failures: string[];
  readonly durationMs: number;
  readonly summary: string;
  readonly fields: Pick<RunReport, 'userAgent' | 'refresh' | 'search' | 'guide' | 'nowNext' | 'screenshot' | 'arabicScreenshot' | 'bidi' | 'onboarding'>;
}

async function runHello(client: CdpClient, engine: Engine, variant: Variant, platform: TvPlatform, check: DataCheck): Promise<Outcome> {
  const run: PlatformRun = await runPlatform(client, platform, appUrl(variant.id, platform, check), check, {
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    keyTimeoutMs: KEY_TIMEOUT_MS,
  });
  return {
    failures: evaluateRun(run, engine, BOOT_TIMEOUT_MS),
    durationMs: run.durationMs,
    summary: dataSummary(run),
    fields: {
      userAgent: run.boot?.userAgent ?? null,
      refresh: run.boot?.ingest ?? null,
      search: run.boot?.search ?? null,
      guide: run.boot?.epg ?? null,
      nowNext: run.boot?.nowNext ?? null,
      screenshot: null,
      arabicScreenshot: null,
      bidi: null,
      onboarding: null,
    },
  };
}

async function runGalleryScreen(client: CdpClient, engine: Engine, variant: Variant, platform: TvPlatform): Promise<Outcome> {
  // Only the real app's screens are kept; a seed's would only show what its failure says.
  const shot = variant.id === APP_VARIANT.id ? path.join(OUT, `gallery-${engine.id}-${platform}.png`) : null;
  const run = await runGallery(client, platform, galleryUrl(variant.id, platform), {
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    keyTimeoutMs: KEY_TIMEOUT_MS,
    screenshot: shot,
    save: (file, png) => writeFileSync(file, png),
  });
  return {
    failures: evaluateGallery(run, engine, BOOT_TIMEOUT_MS),
    durationMs: run.durationMs,
    summary: gallerySummary(run),
    fields: {
      userAgent: run.boot?.userAgent ?? null,
      refresh: null,
      search: null,
      guide: null,
      nowNext: null,
      screenshot: repoPath(run.screenshot),
      arabicScreenshot: repoPath(run.arabicScreenshot),
      bidi: run.bidi,
      onboarding: null,
    },
  };
}

async function runOnboardingScreen(client: CdpClient, engine: Engine, variant: Variant, platform: TvPlatform, check: DataCheck): Promise<Outcome> {
  // Only the real app's screens are kept, as for the gallery.
  const shot =
    variant.id === APP_VARIANT.id
      ? (language: WalkLanguage, screen: string): string => path.join(OUT, `onboarding-${engine.id}-${platform}-${language}-${screen}.png`)
      : null;
  const run = await runOnboarding(client, platform, onboardingUrl(variant.id, platform), check, {
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    keyTimeoutMs: KEY_TIMEOUT_MS,
    loadTimeoutMs: LOAD_TIMEOUT_MS,
    screenshot: shot,
    save: (file, png) => writeFileSync(file, png),
  });
  const first = run.walks.flatMap((walk) => walk.steps).find((step) => step.state !== null);
  return {
    failures: evaluateOnboarding(run, engine, check),
    durationMs: run.durationMs,
    summary: onboardingSummary(run),
    fields: {
      userAgent: first?.state?.userAgent ?? null,
      refresh: null,
      search: null,
      guide: null,
      nowNext: null,
      screenshot: null,
      arabicScreenshot: null,
      bidi: null,
      onboarding: run.walks.map((walk) => ({
        language: walk.language,
        firstScreenMs: stepTime(walk, 'start'),
        loadMs: stepTime(walk, 'add'),
        relaunchMs: stepTime(walk, 'relaunch'),
        phases: walk.phases,
        screenshots: walk.screenshots.map((file) => repoPath(file) ?? file),
      })),
    },
  };
}

async function runEngine(
  engine: Engine,
  zip: string,
  image: string,
  variants: readonly Variant[],
  checks: Record<TvPlatform, DataCheck>,
  keep: boolean,
): Promise<RunReport[]> {
  const running = startEngine({
    image,
    zip,
    appDir: VARIANTS_DIR,
    name: `zoma-${engine.id}-${process.pid}-${Date.now()}`,
    chromeFlags: [...TV_RUNTIME_FLAGS, ...TV_SCREEN_FLAGS],
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
        for (const screen of variant.screens) {
          for (const platform of TV_PLATFORMS) {
            const outcome =
              screen === 'hello'
                ? await runHello(client, engine, variant, platform, checks[platform])
                : screen === 'gallery'
                  ? await runGalleryScreen(client, engine, variant, platform)
                  : await runOnboardingScreen(client, engine, variant, platform, checks[platform]);
            const { failures } = outcome;
            const report: RunReport = {
              engine: engine.id,
              variant: variant.id,
              platform,
              screen,
              ...outcome.fields,
              failures,
              mustPass: mustPass(variant, engine.major),
              durationMs: outcome.durationMs,
            };
            reports.push(report);
            const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
            const expected = report.mustPass === (failures.length === 0) ? '' : '  <-- UNEXPECTED';
            log(
              `  ${variant.id.padEnd(30)} ${platform.padEnd(6)} ${screen.padEnd(10)} ${verdict} ${(outcome.durationMs / 1000).toFixed(1)} s${expected}${outcome.summary}`,
            );
            for (const failure of failures) log(`      ${failure}`);
          }
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
  // A screenshot that a run didn't write again must not pass for a fresh one.
  for (const file of readdirSync(OUT)) if (/^(gallery|onboarding)-.*\.png$/.test(file)) rmSync(path.join(OUT, file));
  const variants: Variant[] = [stageApp(distTv, VARIANTS_DIR)];
  // Served in each container at FIXTURE_ORIGIN; every variant's runs ingest them.
  const checks = stageFixtures(VARIANTS_DIR);
  // The onboarding walk deletes the app's database from a page of the same file:// origin.
  stageBlankPage(VARIANTS_DIR);
  if (selfTest) {
    variants.push(...SEEDS.map((seed) => stageSeed(distTv, VARIANTS_DIR, seed)));
    variants.push(...CSS_SEEDS.map((seed) => stageCssSeed(distTv, VARIANTS_DIR, seed)));
    variants.push(...WALK_SEEDS.map((seed) => stageSeed(distTv, VARIANTS_DIR, seed)));
    log('\nbuilding the no-polyfills variant (test only)');
    variants.push(stageNoPolyfills(ROOT, VARIANTS_DIR));
  }

  const reports: RunReport[] = [];
  for (const engine of engines) {
    const zip = await ensureEngineZip(engine, cacheDir, log);
    reports.push(...(await runEngine(engine, zip, image, variants, checks, values.keep)));
  }

  writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(reports, null, 2)}\n`);
  const unexpected = reports.filter((report) => report.mustPass !== (report.failures.length === 0));
  const caught = reports.filter((report) => !report.mustPass && report.failures.length > 0);

  log('');
  if (selfTest) log(`self-test: ${caught.length} seeded failures caught as expected`);
  if (unexpected.length > 0) {
    log(`${unexpected.length} unexpected result(s):`);
    for (const report of unexpected) {
      log(`  ${report.engine} ${report.variant} ${report.platform} ${report.screen}: ${report.mustPass ? 'failed' : 'passed but must fail'}`);
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
