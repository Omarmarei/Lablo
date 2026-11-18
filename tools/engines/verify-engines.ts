/**
 * `pnpm verify:engines`: runs the built TV apps (dist/tv, from `pnpm build:tv`) in real old
 * Chromium engines: 53 (LG webOS 4, 2018), 56 (Samsung Tizen 4, 2018) and 68 (2020 sets).
 * See docs/runbooks/old-engines.md.
 *
 * Per engine: the pinned snapshot is downloaded once into .cache/engines (SHA-256 checked),
 * started headed under Xvfb in Docker, in a zone where it is 21:xx (`--hour`, step 26q), and
 * driven over raw CDP. Per app: boot with no syntax or
 * runtime error, the Blob worker and an IndexedDB write/read in it, the data workers (refresh a
 * fixture playlist served in the container, then search it), and remote keys → intents. Then
 * the component gallery (`?screen=gallery`): the layout at 1920x1080, the rows, the focus, the
 * fonts, and a screenshot (artifacts/engines/gallery-<engine>-<platform>.png); then the same in
 * Arabic after the language switch by keys, with the bidi probe (FSI/PDI) and `-ar.png`. Then
 * onboarding, the start screen (no `?screen=`), walked by keys in English and in Arabic from a
 * fresh database: the fixture playlist's link typed into the field, loading, done with its
 * counts, "Start watching" to the live screen (step 14a), and a relaunch that skips onboarding
 * to it, then the live screen by keys: CH−/CH+, the rail, a category, Back and the exit, then
 * the grid guide from the header's "Guide" (step 23e: every cell, slot label and the now line
 * against GUIDE_LAYOUT, across rows and time) (artifacts/engines/onboarding-*.png: the form,
 * done, live, category, on Tizen exit, and guide screens).
 * Then onboarding by phone (step 31c2b): the source screen's "Use your phone" in English and
 * in Arabic from a fresh database, against the stand-in pairing API on the host (the container's
 * 127.0.0.1:8091 forwarded to it), a scripted phone sending the fixture playlist's link: the
 * code, the QR code module by module against the link the TV must hold, the source added, the
 * phone reading `ok` (artifacts/engines/pairing-*.png: the code and done views).
 * Then step 32's wipe (step 32d1) on a simulated webOS (the webOS build with a stand-in luna
 * bridge that gives an LGUDID): onboarding by phone, an upload to the stand-in backup API, the
 * database deleted, and the same address again with no key: "Welcome back", then the live screen
 * filled, in English and in Arabic (artifacts/engines/backup-*.png: "Welcome back" and the live
 * screen after it).
 * Then the Lablo Lab (dist/tv-lab, step 15a) runs its spikes at launch and reports to a mock
 * provider on the host (artifacts/engines/lab-logs): S1 must pass on every engine, and the
 * polyfills it filled must be exactly the ones the engine lacks.
 * Last, the crypto vectors page (dist/tv-vectors, step 29b1): @lablo/crypto's shared vectors
 * in the page and in a Blob worker, every check with Node's answer under Node's names; then the
 * backup worker's checks (step 32b) in a second Blob worker, with the engine's IndexedDB.
 *
 * Options:
 *   --engine chrome53|chrome56|chrome68   repeatable; default all
 *   --dist <dir>                          the builds to test (default dist/tv)
 *   --dist-lab <dir>                      the lab builds (default dist/tv-lab)
 *   --dist-vectors <dir>                  the crypto vectors page (default dist/tv-vectors)
 *   --self-test                           also run seeded broken bundles that must fail
 *   --keep                                leave the containers running (for debugging)
 *   --hour <0-23>                         the hour of the day each engine starts in, in its own
 *                                         zone (default 21: the guide steps cross midnight)
 * Environment: LABLO_ENGINE_CACHE overrides the download cache directory.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { CryptoVectors } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
import { checkQr } from '@lablo/core/check-qr';
import { checkSamples } from '@lablo/protocol/check-samples';
import type { BackupRun } from './src/backup-walk';
import { backupSummary, backupWalkUrl, evaluateBackupRun, runBackupWalk, simLookupId, stageWebosSim } from './src/backup-walk';
import type { CdpClient } from './src/cdp';
import { connectToPage, waitForDevtools } from './src/cdp';
import { ENGINE_HOUR, assertDockerRunning, engineLogs, engineZone, ensureImage, forwardToHost, startEngine, stopEngine, zoneOffset } from './src/docker';
import type { Engine } from './src/engines';
import { TV_RUNTIME_FLAGS, TV_SCREEN_FLAGS, selectEngines } from './src/engines';
import { trustsDevKey } from './src/config';
import { ensureEngineZip } from './src/fetch';
import type { DataCheck } from './src/fixture';
import { FIXTURE_DIR, appUrl, fixtureEntries, liveCategories, movieCategories, stageFixtures } from './src/fixture';
import type { BidiState, GalleryRun } from './src/gallery';
import { evaluateGallery, galleryUrl, runGallery } from './src/gallery';
import type { LabServer } from './src/lab';
import { LAB_DIR, LAB_SEED, evaluateLab, labSummary, labUrl, runLab, stageLab, stageLabSeed, startLabServer } from './src/lab';
import type { OnboardingRun, WalkCheck, WalkLanguage } from './src/onboarding';
import { evaluateOnboarding, onboardingUrl, runOnboarding, stageBlankPage, stepTime } from './src/onboarding';
import type { PairServer } from './src/pair-server';
import { startPairServer } from './src/pair-server';
import type { PairingRun } from './src/pairing';
import { PAIR_ORIGIN, PAIR_PORT, evaluatePairing, pairingSummary, pairingUrl, runPairing } from './src/pairing';
import type { PlatformRun, TvPlatform } from './src/scenario';
import { TV_PLATFORMS, evaluateRun, readProbe, runPlatform } from './src/scenario';
import type { AppScreen, Variant } from './src/variants';
import { APP_VARIANT, BACKUP_SEEDS, CSS_SEEDS, PAIR_SEEDS, SEEDS, WALK_SEEDS, mustPass, screenPlatforms, stageApp, stageCssSeed, stageNoPolyfills, stageSeed } from './src/variants';
import { VECTORS_DIR, VECTORS_SEED, evaluateVectors, runVectors, stageVectors, stageVectorsSeed, vectorsSummary, vectorsUrl } from './src/vectors';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'artifacts/engines');
const VARIANTS_DIR = path.join(OUT, 'variants');
const BOOT_TIMEOUT_MS = 20_000;
const KEY_TIMEOUT_MS = 3_000;
/** "Add source" to the done screen: the fixture's 3,000 items and its guide, in the old engine. */
const LOAD_TIMEOUT_MS = 60_000;
/** A key on the live screen to its data answered: the focus, the rows' now/next and the 600 ms focus wait. */
const LIVE_TIMEOUT_MS = 8_000;
/** The lab's whole run at launch, S2's write test included. */
const LAB_TIMEOUT_MS = 120_000;
/** Every crypto vector in the page, then in the worker (two N = 2^15 scrypts and RFC 7914's p = 16). */
const VECTORS_TIMEOUT_MS = 180_000;

const log = (line: string): void => console.log(line);

/** One platform's data check, plus what its live screen must list. */
type WalkData = DataCheck & WalkCheck;

interface RunReport {
  readonly engine: string;
  readonly variant: string;
  readonly platform: string;
  readonly screen: AppScreen | 'lab' | 'vectors';
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
  /** The lab's session in artifacts/engines/lab-logs, and its counts (lab runs only). */
  readonly lab: { readonly session: string | null; readonly summary: string } | null;
  /** The crypto vectors page: each run's time and the backup's scrypt in it, ms (vectors runs only). */
  readonly vectors: { readonly pageMs: number | null; readonly workerMs: number | null; readonly pageScryptMs: number | null; readonly workerScryptMs: number | null } | null;
  /** Onboarding by phone: each walk's code and add times, the QR code's version, its screenshots (pairing runs only). */
  readonly pairing?: ReadonlyArray<{
    readonly language: WalkLanguage;
    readonly codeMs: number | null;
    readonly addMs: number | null;
    readonly qrVersion: number | null;
    /** How the phone sent the playlist: its link, or the file (step 31d2b2a). */
    readonly sent: 'link' | 'file';
    readonly screenshots: readonly string[];
  }>;
  /** The wipe on the simulated webOS: each walk's times from the relaunch to "Welcome back" and to the live screen, its screenshots (backup runs only). */
  readonly backup?: ReadonlyArray<{
    readonly language: WalkLanguage;
    readonly welcomeMs: number | null;
    readonly liveMs: number | null;
    readonly screenshots: readonly string[];
  }>;
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
  const config = boot.configStatus === null || boot.configStatus === '' ? '' : `; config ${boot.configStatus}, blocked ${boot.blockedList ?? '?'}`;
  return `  data: ${boot.ingestItems ?? '?'} items${gzip}${hits}${guide}${onAir}${config}`;
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
  /** From the relaunch to the live screen with its data requests answered. */
  readonly relaunchMs: number | null;
  /** On the live screen, from the key to its data answered: CH− (a window further) and OK on a category. */
  readonly pageMs: number | null;
  readonly categoryMs: number | null;
  /** OK on the header's "Guide" to the grid with its data, and CH− in the grid to a page with its data (step 23e). */
  readonly guideMs: number | null;
  readonly guidePageMs: number | null;
  readonly phases: readonly string[] | null;
  readonly screenshots: readonly string[];
}

const seconds = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);

/** `en: first screen 0.2 s, load 2.0 s, relaunch 0.2 s, CH− 0.7 s, category 0.8 s; ar: …` for the log. */
function onboardingSummary(run: OnboardingRun): string {
  const walks = run.walks
    .filter((walk) => walk.steps.length > 0)
    .map(
      (walk) =>
        `${walk.language}: first screen ${seconds(stepTime(walk, 'start'))}, load ${seconds(stepTime(walk, 'add'))}, relaunch ${seconds(stepTime(walk, 'relaunch'))}, CH− ${seconds(stepTime(walk, 'live-page-down'))}, category ${seconds(stepTime(walk, 'live-category'))}, guide ${seconds(stepTime(walk, 'guide-open'))}, guide CH− ${seconds(stepTime(walk, 'guide-page'))}`,
    );
  return walks.length === 0 ? '' : `  ${walks.join('; ')}`;
}

/** A path relative to the repo, with forward slashes. */
const repoPath = (file: string | null): string | null => (file === null ? null : path.relative(ROOT, file).split(path.sep).join('/'));

interface Outcome {
  readonly failures: string[];
  readonly durationMs: number;
  readonly summary: string;
  readonly fields: Pick<RunReport, 'userAgent' | 'refresh' | 'search' | 'guide' | 'nowNext' | 'screenshot' | 'arabicScreenshot' | 'bidi' | 'onboarding' | 'pairing' | 'backup'>;
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

async function runOnboardingScreen(client: CdpClient, engine: Engine, variant: Variant, platform: TvPlatform, check: WalkData): Promise<Outcome> {
  // Only the real app's screens are kept, as for the gallery.
  const shot =
    variant.id === APP_VARIANT.id
      ? (language: WalkLanguage, screen: string): string => path.join(OUT, `onboarding-${engine.id}-${platform}-${language}-${screen}.png`)
      : null;
  const run = await runOnboarding(client, platform, onboardingUrl(variant.id, platform), check, {
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    keyTimeoutMs: KEY_TIMEOUT_MS,
    loadTimeoutMs: LOAD_TIMEOUT_MS,
    liveTimeoutMs: LIVE_TIMEOUT_MS,
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
        pageMs: stepTime(walk, 'live-page-down'),
        categoryMs: stepTime(walk, 'live-category'),
        guideMs: stepTime(walk, 'guide-open'),
        guidePageMs: stepTime(walk, 'guide-page'),
        phases: walk.phases,
        screenshots: walk.screenshots.map((file) => repoPath(file) ?? file),
      })),
    },
  };
}

/** A lab build to run: the real one must pass, the seed must fail. */
interface LabTarget {
  readonly variant: string;
  readonly dir: string;
  readonly mustPass: boolean;
}

async function runLabs(client: CdpClient, engine: Engine, server: LabServer, labs: readonly LabTarget[]): Promise<RunReport[]> {
  const reports: RunReport[] = [];
  for (const lab of labs) {
    for (const platform of TV_PLATFORMS) {
      const run = await runLab(client, platform, labUrl(lab.dir, platform, server.port), server.logDir, LAB_TIMEOUT_MS);
      const failures = evaluateLab(run, engine);
      const summary = labSummary(run);
      reports.push({
        engine: engine.id,
        variant: lab.variant,
        platform,
        screen: 'lab',
        userAgent: run.state?.userAgent ?? null,
        refresh: null,
        search: null,
        guide: null,
        nowNext: null,
        screenshot: null,
        arabicScreenshot: null,
        bidi: null,
        onboarding: null,
        lab: { session: run.state?.session ?? null, summary },
        vectors: null,
        failures,
        mustPass: lab.mustPass,
        durationMs: run.durationMs,
      });
      const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
      const expected = lab.mustPass === (failures.length === 0) ? '' : '  <-- UNEXPECTED';
      log(`  ${lab.variant.padEnd(30)} ${platform.padEnd(6)} ${'lab'.padEnd(10)} ${verdict} ${(run.durationMs / 1000).toFixed(1)} s${expected}${summary}`);
      for (const failure of failures) log(`      ${failure}`);
    }
  }
  return reports;
}

/** A vectors page to run: the real one must pass, the seed must fail. */
interface VectorsTarget {
  readonly variant: string;
  readonly dir: string;
  readonly mustPass: boolean;
}

async function runVectorsPages(client: CdpClient, engine: Engine, targets: readonly VectorsTarget[], expected: readonly string[]): Promise<RunReport[]> {
  const reports: RunReport[] = [];
  for (const target of targets) {
    const run = await runVectors(client, vectorsUrl(target.dir), VECTORS_TIMEOUT_MS);
    const failures = evaluateVectors(run, engine, expected);
    const report = run.state?.report ?? null;
    const scryptMs = (results: ReadonlyArray<{ readonly name: string; readonly ms: number }> | null | undefined): number | null =>
      results?.find((r) => r.name === 'backup[0].master')?.ms ?? null;
    reports.push({
      engine: engine.id,
      variant: target.variant,
      platform: 'both',
      screen: 'vectors',
      userAgent: run.state?.userAgent ?? null,
      refresh: null,
      search: null,
      guide: null,
      nowNext: null,
      screenshot: null,
      arabicScreenshot: null,
      bidi: null,
      onboarding: null,
      lab: null,
      vectors: {
        pageMs: report?.page.ms ?? null,
        workerMs: report?.worker.ms ?? null,
        pageScryptMs: scryptMs(report?.page.results),
        workerScryptMs: scryptMs(report?.worker.results),
      },
      failures,
      mustPass: target.mustPass,
      durationMs: run.durationMs,
    });
    const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
    const unexpected = target.mustPass === (failures.length === 0) ? '' : '  <-- UNEXPECTED';
    log(`  ${target.variant.padEnd(30)} ${'both'.padEnd(6)} ${'vectors'.padEnd(10)} ${verdict} ${(run.durationMs / 1000).toFixed(1)} s${unexpected}${vectorsSummary(run)}`);
    for (const failure of failures) log(`      ${failure}`);
  }
  return reports;
}

/** Onboarding by phone (step 31c2b) against `server`'s stand-in. */
async function runPairingScreen(client: CdpClient, engine: Engine, variant: Variant, platform: TvPlatform, check: WalkData, server: PairServer): Promise<Outcome> {
  // Only the real app's screens are kept, as for onboarding.
  const shot =
    variant.id === APP_VARIANT.id ? (language: WalkLanguage, view: string): string => path.join(OUT, `pairing-${engine.id}-${platform}-${language}-${view}.png`) : null;
  const run: PairingRun = await runPairing(client, platform, pairingUrl(variant.id, platform), check, server, {
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    keyTimeoutMs: KEY_TIMEOUT_MS,
    loadTimeoutMs: LOAD_TIMEOUT_MS,
    screenshot: shot,
    save: (file, png) => writeFileSync(file, png),
    // The Arabic walk's file (step 31d2b2a): the plain playlist, as a phone would send it.
    playlist: readFileSync(path.join(VARIANTS_DIR, FIXTURE_DIR, check.file.replace(/\.gz$/, '')), 'utf8'),
  });
  const first = run.walks.flatMap((walk) => walk.steps).find((step) => step.state !== null);
  return {
    failures: evaluatePairing(run, engine),
    durationMs: run.durationMs,
    summary: pairingSummary(run),
    fields: {
      userAgent: first?.state?.userAgent ?? null,
      refresh: null,
      search: null,
      guide: null,
      nowNext: null,
      screenshot: null,
      arabicScreenshot: null,
      bidi: null,
      onboarding: null,
      pairing: run.walks.map((walk) => ({
        language: walk.language,
        codeMs: walk.codeMs,
        addMs: walk.addMs,
        qrVersion: walk.pair?.qr?.version ?? null,
        sent: walk.sent,
        screenshots: walk.screenshots.map((file) => repoPath(file) ?? file),
      })),
    },
  };
}

/** Step 32's wipe on the simulated webOS (step 32d1) against `server`'s backup stand-in. */
async function runBackupScreen(client: CdpClient, engine: Engine, variant: Variant, check: WalkData, server: PairServer, lookupId: string): Promise<Outcome> {
  const shot = variant.id === APP_VARIANT.id ? (language: WalkLanguage, view: string): string => path.join(OUT, `backup-${engine.id}-${language}-${view}.png`) : null;
  const run: BackupRun = await runBackupWalk(client, backupWalkUrl(variant.id), check, server, lookupId, {
    bootTimeoutMs: BOOT_TIMEOUT_MS,
    keyTimeoutMs: KEY_TIMEOUT_MS,
    loadTimeoutMs: LOAD_TIMEOUT_MS,
    screenshot: shot,
    save: (file, png) => writeFileSync(file, png),
  });
  const first = run.walks.flatMap((walk) => walk.steps).find((step) => step.state !== null);
  return {
    failures: evaluateBackupRun(run, engine, check.categories),
    durationMs: run.durationMs,
    summary: backupSummary(run),
    fields: {
      userAgent: first?.state?.userAgent ?? null,
      refresh: null,
      search: null,
      guide: null,
      nowNext: null,
      screenshot: null,
      arabicScreenshot: null,
      bidi: null,
      onboarding: null,
      backup: run.walks.map((walk) => ({
        language: walk.language,
        welcomeMs: walk.welcomeMs,
        liveMs: walk.liveMs,
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
  checks: Record<TvPlatform, WalkData>,
  labs: { readonly server: LabServer; readonly targets: readonly LabTarget[] },
  vectors: { readonly targets: readonly VectorsTarget[]; readonly expected: readonly string[] },
  pair: PairServer,
  backupLookupId: string,
  keep: boolean,
  hour: number,
): Promise<RunReport[]> {
  // The engine's zone puts it in `hour` now (step 26q): from 21:xx the walk's guide crosses midnight.
  const zone = engineZone(Date.now(), hour);
  const running = startEngine({
    image,
    zip,
    appDir: VARIANTS_DIR,
    name: `lablo-${engine.id}-${process.pid}-${Date.now()}`,
    chromeFlags: [...TV_RUNTIME_FLAGS, ...TV_SCREEN_FLAGS],
    zone,
  });
  const reports: RunReport[] = [];
  try {
    const version = await waitForDevtools(running.port, 60_000);
    // The pairing walk's API, as the TV build takes it: on the device itself (step 31c2b).
    forwardToHost(running.container, PAIR_PORT, pair.port);
    const client = await connectToPage(running.port);
    try {
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      // The page's own clock in that zone, or the run would not cross midnight where it means to.
      const local = await readProbe<[number, string]>(client, 'JSON.stringify([new Date().getTimezoneOffset(), new Date().toString()])');
      if (local === null || local[0] !== zoneOffset(zone)) {
        throw new Error(`${engine.id} is not in ${zone} (offset ${zoneOffset(zone)} min): its page says ${local === null ? 'nothing' : `${local[0]} min, ${local[1]}`}`);
      }
      log(`\n${engine.id}: ${version.Browser}, standing in for ${engine.tvs}; in ${zone}, where it is ${local[1]}`);
      // Chromium 53 reports uncaught errors only through the (later deprecated) Console domain.
      await client.send('Console.enable').catch(() => undefined);
      for (const variant of variants) {
        for (const screen of variant.screens) {
          for (const platform of screenPlatforms(screen)) {
            const outcome =
              screen === 'hello'
                ? await runHello(client, engine, variant, platform, checks[platform])
                : screen === 'gallery'
                  ? await runGalleryScreen(client, engine, variant, platform)
                  : screen === 'onboarding'
                    ? await runOnboardingScreen(client, engine, variant, platform, checks[platform])
                    : screen === 'pairing'
                      ? await runPairingScreen(client, engine, variant, platform, checks[platform], pair)
                      : await runBackupScreen(client, engine, variant, checks[platform], pair, backupLookupId);
            const { failures } = outcome;
            const report: RunReport = {
              engine: engine.id,
              variant: variant.id,
              platform,
              screen,
              ...outcome.fields,
              lab: null,
              vectors: null,
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
      reports.push(...(await runLabs(client, engine, labs.server, labs.targets)));
      reports.push(...(await runVectorsPages(client, engine, vectors.targets, vectors.expected)));
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
      'dist-lab': { type: 'string', default: 'dist/tv-lab' },
      'dist-vectors': { type: 'string', default: 'dist/tv-vectors' },
      'self-test': { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
      hour: { type: 'string', default: String(ENGINE_HOUR) },
    },
  });
  const hour = Number(values.hour);
  // (Checked before anything is staged or started.)
  engineZone(Date.now(), hour);
  const engines = selectEngines(values.engine ?? []);
  const selfTest = values['self-test'];
  const distTv = path.resolve(ROOT, values.dist);
  const distLab = path.resolve(ROOT, values['dist-lab']);
  const distVectors = path.resolve(ROOT, values['dist-vectors']);
  const cacheDir = path.resolve(ROOT, process.env.LABLO_ENGINE_CACHE ?? '.cache/engines');

  assertDockerRunning();
  const image = ensureImage(path.join(import.meta.dirname, 'docker'), log);

  rmSync(VARIANTS_DIR, { recursive: true, force: true });
  mkdirSync(VARIANTS_DIR, { recursive: true });
  // A screenshot that a run didn't write again must not pass for a fresh one.
  for (const file of readdirSync(OUT)) if (/^(gallery|onboarding|pairing|backup)-.*\.png$/.test(file)) rmSync(path.join(OUT, file));
  const variants: Variant[] = [stageApp(distTv, VARIANTS_DIR)];
  const labDir = stageLab(distLab, VARIANTS_DIR);
  if (labDir === null) throw new Error(`${path.relative(ROOT, distLab)} has no lab builds: run pnpm build:tv first`);
  const labTargets: LabTarget[] = [{ variant: 'lab', dir: LAB_DIR, mustPass: true }];
  const vectorsDir = stageVectors(distVectors, VARIANTS_DIR);
  if (vectorsDir === null) throw new Error(`${path.relative(ROOT, distVectors)} has no crypto vectors page: run pnpm build:tv first`);
  const vectorsTargets: VectorsTarget[] = [{ variant: 'crypto-vectors', dir: VECTORS_DIR, mustPass: true }];
  // What every engine must answer: Node's own run of the same vectors, all passing.
  const nodeVectors = await checkVectors(JSON.parse(readFileSync(path.join(ROOT, 'packages/crypto/test/vectors.json'), 'utf8')) as CryptoVectors);
  const nodeFailures = nodeVectors.filter((r) => !r.ok);
  if (nodeFailures.length > 0) throw new Error(`the crypto vectors fail in Node itself: ${nodeFailures.map((r) => r.name).join(', ')}`);
  // Then the protocol samples (step 29b2a), which the page runs after the vectors.
  const nodeSamples = checkSamples();
  const sampleFailures = nodeSamples.filter((r) => !r.ok);
  if (sampleFailures.length > 0) throw new Error(`the protocol samples fail in Node itself: ${sampleFailures.map((r) => r.name).join(', ')}`);
  // And the QR encoder's golden cases (step 31c1), last.
  const nodeQr = checkQr();
  const qrFailures = nodeQr.filter((r) => !r.ok);
  if (qrFailures.length > 0) throw new Error(`the QR cases fail in Node itself: ${qrFailures.map((r) => r.name).join(', ')}`);
  const expectedVectors = [...nodeVectors, ...nodeSamples, ...nodeQr].map((r) => r.name);
  // Served in each container at FIXTURE_ORIGIN; every variant's runs ingest them. The signed
  // config's expectation follows the keys a TV build trusts (step 30c1).
  const staged = stageFixtures(VARIANTS_DIR, Date.now(), trustsDevKey(readFileSync(path.join(ROOT, 'config/keys.json'), 'utf8')));
  // The live screen's rail and rows, as the walk checks them (step 14c).
  const categories = liveCategories(fixtureEntries());
  // And the movies screen's (step 26b).
  const films = movieCategories(fixtureEntries());
  const checks: Record<TvPlatform, WalkData> = { tizen: { ...staged.tizen, categories, films }, webos: { ...staged.webos, categories, films } };
  // The onboarding walk deletes the app's database from a page of the same file:// origin.
  stageBlankPage(VARIANTS_DIR);
  if (selfTest) {
    variants.push(...SEEDS.map((seed) => stageSeed(distTv, VARIANTS_DIR, seed)));
    variants.push(...CSS_SEEDS.map((seed) => stageCssSeed(distTv, VARIANTS_DIR, seed)));
    variants.push(...WALK_SEEDS.map((seed) => stageSeed(distTv, VARIANTS_DIR, seed)));
    variants.push(...PAIR_SEEDS.map((seed) => stageSeed(distTv, VARIANTS_DIR, seed)));
    variants.push(...BACKUP_SEEDS.map((seed) => stageSeed(distTv, VARIANTS_DIR, seed)));
    stageLabSeed(labDir, VARIANTS_DIR);
    labTargets.push({ variant: LAB_SEED.id, dir: LAB_SEED.id, mustPass: false });
    stageVectorsSeed(vectorsDir, VARIANTS_DIR);
    vectorsTargets.push({ variant: VECTORS_SEED.id, dir: VECTORS_SEED.id, mustPass: false });
    log('\nbuilding the no-polyfills variant (test only)');
    variants.push(stageNoPolyfills(ROOT, VARIANTS_DIR));
  }

  // The wipe walk's simulated webOS (step 32d1), beside each variant that runs it; the lookup ID its LGUDID gives.
  const simAppIds = variants.filter((variant) => variant.screens.includes('backup')).map((variant) => stageWebosSim(path.join(VARIANTS_DIR, variant.id)));
  const backupLookupId = await simLookupId(simAppIds[0] ?? '');

  // The lab's collector: a fresh folder per run, read back by the lab checks.
  const labLogs = path.join(OUT, 'lab-logs');
  rmSync(labLogs, { recursive: true, force: true });
  const server = await startLabServer(ROOT, labLogs);
  log(`lab: mock provider on port ${server.port}, records in ${path.relative(ROOT, labLogs)}`);
  const pair = await startPairServer();
  log(`pairing: the stand-in on port ${pair.port}, reached in each engine as ${PAIR_ORIGIN}`);
  const reports: RunReport[] = [];
  try {
    for (const engine of engines) {
      const zip = await ensureEngineZip(engine, cacheDir, log);
      reports.push(
        ...(await runEngine(engine, zip, image, variants, checks, { server, targets: labTargets }, { targets: vectorsTargets, expected: expectedVectors }, pair, backupLookupId, values.keep, hour)),
      );
    }
  } finally {
    server.stop();
    await pair.stop();
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
