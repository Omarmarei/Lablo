/**
 * Step 32's own "Done when" on the old engines (RELAY step 32d1): a simulated webOS wipe restores
 * automatically, in Chromium 53, 56 and 68.
 *
 * **The simulated webOS.** The harness's TV builds read no device ID (an engine has no luna
 * bridge), so `stageWebosSim` copies a variant's webOS build to `<variant>/webos-sim` and prepends
 * `WEBOS_SIM_BRIDGE` (ES5) to its main.js: a `PalmServiceBridge` that answers the LGUDID's luna call
 * (`DEVICE_ID_URI`) with `SIM_LGUDID`, refuses every other call (`returnValue: false`), and records
 * the URIs it was asked (`window.__labloLuna`). The bundle itself runs unchanged: the app reads the
 * ID through its real path (`readLgudid`, `lunaRequest`, `lgudidFrom`).
 *
 * **Each walk** (English, then Arabic), from a fresh database and with no backup under the TV's
 * lookup ID on the pair server's backup stand-in (`BackupStandIn`, which the container reaches as its
 * own 127.0.0.1:`PAIR_PORT`):
 * 1. the first start reads the ID with no consent asked and looks for a backup: none (`GET` 404),
 *    so onboarding opens; then onboarding by phone as the pairing walk (the language, the
 *    disclaimer, "Allow", "Use your phone", the scripted phone sends the fixture's playlist link)
 *    and "Start watching";
 * 2. an upload now (the test hook's `uploadBackup()`, which the schedule would run 60 s on): the
 *    first send asks `GET` (404), then `PUT` (200);
 * 3. **the wipe:** the app's database deleted from the blank page, then the same address loaded
 *    again with no key pressed: "Looking for your backup", "Welcome back" in the walk's language
 *    with one source (inside the title-safe area, no label cut; a screenshot), then the live screen
 *    by itself, its rows filled, its rail, count and rows as the fixture says (a screenshot);
 * 4. the profile read back holds the phone's source, the language and `consent: true`; the stand-in
 *    answered `GET 404, GET 404, PUT 200, GET 200`, all under the lookup ID the simulated LGUDID
 *    gives (`simLookupId`); the bridge was asked for the LGUDID on both pages.
 * The database is deleted after the walks, and the stand-in forgets the backup.
 *
 * The bridge, the steps, the probes and the evaluation are unit-tested; `runBackupWalk` drives a
 * real engine.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { backupKeys, deriveBackupMaster } from '@lablo/crypto';
import type { BackupStandIn } from './backup-stand-in';
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import { chromeMajor } from './engines';
import type { DataCheck } from './fixture';
import { SAFE_AREA } from './gallery';
import { listedEntry, railFailures, rowFailures, rowsFilled, unfilledRows } from './live';
import type { Expectation, StoredProfile, WalkCheck, WalkLanguage, WalkState } from './onboarding';
import {
  KEY,
  LAYOUT_BOXES,
  LAYOUT_LABELS,
  PROFILE_EXPRESSION,
  PROFILE_RESULT,
  STALE_MARK,
  WALK_EXPRESSION,
  WALK_LANGUAGES,
  describeExpectation,
  describeState,
  resetDatabase,
  stepLanded,
  stepStuck,
  untilConfigIdle,
} from './onboarding';
import { phoneSends } from './pair-phone';
import type { PairServer } from './pair-server';
import type { PairStep, PairStepId, PairState } from './pairing';
import { PAIR_EXPRESSION, PAIR_ORIGIN, PHONE_NAMES, pairSteps, phonePayload } from './pairing';
import type { RunOptions } from './scenario';
import { delay, pressKey, readProbe, waitForProbe, watchErrors } from './scenario';

/** The staged copy of a variant's webOS build with the simulated luna bridge. */
export const WEBOS_SIM = 'webos-sim';
/** The LGUDID's luna call (packages/platform-webos `DEVICE_ID_URI`; tools/ may not import it: a root test pins it). */
export const DEVICE_ID_URI = 'luna://com.webos.service.sm/deviceid/getIDs';
/** The simulated TV's LGUDID. */
export const SIM_LGUDID = 'lablo-sim-lgudid-32d1';
/** The salt's platform for a webOS build (`__PLATFORM__`). */
export const SIM_PLATFORM = 'webos';

/**
 * Prepended to the simulated copy's main.js; plain ES5 (a unit test parses it at ecmaVersion 5). The
 * answer comes on a later task, as a TV's does.
 */
export const WEBOS_SIM_BRIDGE = `(function () {
  var calls = [];
  window.__labloLuna = calls;
  function SimBridge() { this.onservicecallback = null; }
  SimBridge.prototype.call = function (uri, params) {
    calls.push(uri);
    var bridge = this;
    var answer = uri === '${DEVICE_ID_URI}'
      ? '{"returnValue":true,"idList":[{"idType":"LGUDID","idValue":"${SIM_LGUDID}"}]}'
      : '{"returnValue":false,"errorCode":-1,"errorText":"not in the simulated webOS"}';
    setTimeout(function () { if (bridge.onservicecallback) bridge.onservicecallback(answer); }, 0);
  };
  SimBridge.prototype.cancel = function () { this.onservicecallback = null; };
  window.PalmServiceBridge = SimBridge;
})();
`;

/**
 * Copies `<variantDir>/webos` to `<variantDir>/webos-sim` with `WEBOS_SIM_BRIDGE` before its main.js,
 * and answers the build's app id (its appinfo.json's `id`: the salt's `__APP_ID__`).
 */
export function stageWebosSim(variantDir: string): string {
  const from = path.join(variantDir, 'webos');
  const main = path.join(from, 'main.js');
  if (!existsSync(main)) throw new Error(`${from} has no main.js: stage the variant first`);
  const to = path.join(variantDir, WEBOS_SIM);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  writeFileSync(path.join(to, 'main.js'), `${WEBOS_SIM_BRIDGE}${readFileSync(main, 'utf8')}`);
  const { id } = JSON.parse(readFileSync(path.join(to, 'appinfo.json'), 'utf8')) as { id?: unknown };
  if (typeof id !== 'string' || id === '') throw new Error(`${to}/appinfo.json has no id`);
  return id;
}

/** The lookup ID the simulated TV's backup lives under: what the app derives from `SIM_LGUDID`. */
export async function simLookupId(appId: string): Promise<string> {
  return backupKeys(await deriveBackupMaster(SIM_LGUDID, SIM_PLATFORM, appId)).lookupId;
}

/** The simulated webOS build of `variant`, its API on the forwarded port. */
export function backupWalkUrl(variant: string): string {
  return `file:///app/${variant}/${WEBOS_SIM}/index.html?keyboard=native&api=${encodeURIComponent(PAIR_ORIGIN)}`;
}

export type BackupStepId = PairStepId | 'watch';

export interface BackupStep extends Omit<PairStep, 'id'> {
  readonly id: BackupStepId;
}

/** Onboarding by phone (the pairing walk's steps), then "Start watching": the live screen in the walk's language. */
export function backupSteps(language: WalkLanguage): BackupStep[] {
  const ar = language === 'ar';
  return [
    ...pairSteps(language),
    {
      id: 'watch',
      label: 'OK on "Start watching"',
      keys: [KEY.enter],
      expect: { live: true, liveIdle: true, screen: 'live', zone: 'channels', index: 0, language, dir: ar ? 'rtl' : 'ltr' },
      wait: 'boot',
    },
  ];
}

/** The start's own screens ("Looking for your backup", "Welcome back") as drawn. */
export interface StartState {
  readonly href: string;
  readonly stale: boolean;
  readonly bootError: string;
  /** `looking`, `welcome`, or null when the screen isn't on show. */
  readonly screen: string | null;
  readonly zone: string | null;
  readonly index: number | null;
  readonly language: string | null;
  readonly dir: string;
  /** "Welcome back"'s count of sources restored. */
  readonly sources: number | null;
  readonly title: string | null;
  /** Onboarding (ready: past the boot's placeholder) or the live screen is on show instead. */
  readonly onboarding: boolean;
  readonly live: boolean;
  readonly outside: readonly string[];
  readonly cut: readonly string[];
}

/** Evaluated inside the page on every engine, so it is plain ES5. */
export const START_EXPRESSION = `(function () {
  var SAFE = ${JSON.stringify(SAFE_AREA)};
  function name(el) {
    return el.getAttribute('class') + ': ' + (el.textContent || '').slice(0, 40);
  }
  var start = document.querySelector('[data-testid="backup-start"]');
  var title = document.querySelector('[data-testid="backup-title"]');
  var boot = document.getElementById('boot-error');
  var outside = [];
  var cut = [];
  if (start) {
    Array.prototype.slice.call(start.querySelectorAll('${LAYOUT_BOXES}')).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.left < SAFE.left || r.top < SAFE.top || r.right > SAFE.right + 0.5 || r.bottom > SAFE.bottom + 0.5) outside.push(name(el));
    });
    cut = Array.prototype.slice.call(start.querySelectorAll('${LAYOUT_LABELS}'))
      .filter(function (el) { return el.scrollWidth > el.clientWidth + 1; })
      .map(name);
  }
  var sources = start ? start.getAttribute('data-sources') : null;
  // (The boot's placeholder is a not-ready onboarding root: only a ready one is onboarding.)
  var ob = document.querySelector('[data-testid="onboarding"]');
  return JSON.stringify({
    href: location.href,
    stale: window.__labloStale === true,
    bootError: boot ? boot.textContent : '',
    screen: start ? start.getAttribute('data-screen') : null,
    zone: start ? start.getAttribute('data-zone') : null,
    index: start && start.hasAttribute('data-index') ? Number(start.getAttribute('data-index')) : null,
    language: start ? start.getAttribute('data-language') : null,
    dir: document.documentElement.getAttribute('dir') || '',
    sources: sources === null || sources === '' ? null : Number(sources),
    title: title ? title.textContent : null,
    onboarding: ob !== null && ob.getAttribute('data-ready') === 'true',
    live: document.querySelector('[data-testid="live"]') !== null,
    outside: outside,
    cut: cut
  });
})()`;

/** Starts the test hook's upload; `UPLOAD_RESULT` reads its state (`pending` until it settles). */
export const UPLOAD_EXPRESSION = `(function () {
  var hook = window.__LABLO_TEST__;
  if (!hook || typeof hook.uploadBackup !== 'function') {
    window.__labloUpload = 'no test hook';
    return JSON.stringify(window.__labloUpload);
  }
  window.__labloUpload = 'pending';
  hook.uploadBackup().then(function (state) {
    window.__labloUpload = state === null ? 'none ran' : String(state);
  }, function (error) {
    window.__labloUpload = 'error: ' + (error && error.message ? error.message : String(error));
  });
  return JSON.stringify(window.__labloUpload);
})()`;
export const UPLOAD_RESULT = `JSON.stringify(window.__labloUpload || null)`;

/** The luna calls the simulated bridge was asked on this page (null: no bridge on it). */
export const LUNA_RESULT = `JSON.stringify(window.__labloLuna || null)`;

export interface BackupStepRecord {
  readonly id: BackupStepId;
  readonly label: string;
  readonly expect: Expectation;
  readonly met: boolean;
  readonly state: WalkState | null;
  readonly ms: number;
}

export interface BackupWalk {
  readonly language: WalkLanguage;
  readonly reset: string;
  readonly steps: readonly BackupStepRecord[];
  readonly phoneError: string | null;
  /** The upload's state (`sent` …), or what went wrong starting it; null when the walk stopped before it. */
  readonly upload: string | null;
  /** The luna calls on the first page (null: no bridge, or the walk stopped before reading it). */
  readonly lunaBefore: readonly string[] | null;
  /** How deleting the database for the wipe went (null: the walk stopped before it). */
  readonly wipe: string | null;
  /** The start's screen after the wipe, once it showed "Welcome back" (or what showed instead). */
  readonly welcome: StartState | null;
  /** The live screen after "Welcome back", with no key pressed. */
  readonly restored: WalkState | null;
  /** From the relaunch to "Welcome back", and to the live screen with its rows filled (ms). */
  readonly welcomeMs: number | null;
  readonly liveMs: number | null;
  readonly lunaAfter: readonly string[] | null;
  /** The stand-in's backup requests during the walk: `<method> <status>`, and their lookup IDs. */
  readonly requests: readonly string[];
  readonly lookupIds: readonly string[];
  readonly profile: StoredProfile | null;
  readonly screenshots: readonly string[];
  readonly screenshotError: string | null;
}

export interface BackupRun {
  readonly url: string;
  /** The lookup ID the simulated LGUDID gives. */
  readonly lookupId: string;
  readonly walks: readonly BackupWalk[];
  readonly cleanup: string;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
}

export interface BackupWalkOptions extends RunOptions {
  /** "Add" by phone to the done screen, the look-up and "Welcome back" to the live screen's rows. */
  readonly loadTimeoutMs: number;
  readonly screenshot: ((language: WalkLanguage, view: 'welcome' | 'restored') => string) | null;
  readonly save: (file: string, png: Buffer) => void;
}

/** The focus ring's transition ends before a screenshot. */
const SETTLE_MS = 400;

async function shoot(client: CdpClient, options: BackupWalkOptions, language: WalkLanguage, view: 'welcome' | 'restored', into: string[]): Promise<string | null> {
  if (options.screenshot === null) return null;
  const file = options.screenshot(language, view);
  await delay(SETTLE_MS);
  try {
    const shot = await client.send<{ data?: string }>('Page.captureScreenshot', { format: 'png' });
    if (shot.data === undefined || shot.data === '') throw new Error('the engine returned no image');
    options.save(file, Buffer.from(shot.data, 'base64'));
    into.push(file);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The stand-in forgets the backup under `lookupId`: the TV has none yet. */
export function forgetBackup(standIn: Pick<BackupStandIn, 'blobs' | 'hashes'>, lookupId: string): void {
  standIn.blobs.delete(lookupId);
  standIn.hashes.delete(lookupId);
}

/** The live screen after the wipe: in the walk's language, on the first channel, its rows filled, no key pressed. */
export function restoredLanded(state: WalkState, language: WalkLanguage): boolean {
  return state.live && state.liveIdle && state.screen === 'live' && state.zone === 'channels' && state.index === 0 && state.language === language && rowsFilled(state);
}

/**
 * The restored live screen against the fixture, as the onboarding walk checks its relaunch: the
 * rail (its side, chips, counts, the header), the header's channel count, and the rows (their
 * numbers, names, and now/next or the placeholder at the page's clock). Empty: as it must be.
 */
export function restoredFailures(state: WalkState, categories: WalkCheck['categories'], language: WalkLanguage): string[] {
  const failures = railFailures(state, categories, language);
  const entry = state.category === null ? null : listedEntry(categories, state.category);
  if (entry !== null && state.liveCount !== entry.channels.length) failures.push(`the header counts ${state.liveCount ?? 'no'} channels, expected ${entry.channels.length}`);
  failures.push(...rowFailures(state, categories, language));
  return failures;
}

/** One walk in one language, from a fresh database and no backup, until a step doesn't land. */
async function backupOnce(
  client: CdpClient,
  url: string,
  language: WalkLanguage,
  check: Pick<DataCheck, 'file'> & Pick<WalkCheck, 'categories'>,
  server: Pick<PairServer, 'origin' | 'standIn' | 'backup'>,
  lookupId: string,
  options: BackupWalkOptions,
  watch: ReturnType<typeof watchErrors>,
): Promise<BackupWalk> {
  const reset = await resetDatabase(client);
  forgetBackup(server.backup, lookupId);
  const first = server.backup.requests.length;
  const steps: BackupStepRecord[] = [];
  const screenshots: string[] = [];
  let screenshotError: string | null = null;
  let phoneError: string | null = null;
  let code: string | null = null;
  let upload: string | null = null;
  let lunaBefore: string[] | null = null;
  let wipe: string | null = null;
  let welcome: StartState | null = null;
  let restored: WalkState | null = null;
  let welcomeMs: number | null = null;
  let liveMs: number | null = null;
  let lunaAfter: string[] | null = null;
  let profile: StoredProfile | null = null;
  const result = (): BackupWalk => {
    const made = server.backup.requests.slice(first);
    return {
      language,
      reset,
      steps,
      phoneError,
      upload,
      lunaBefore,
      wipe,
      welcome,
      restored,
      welcomeMs,
      liveMs,
      lunaAfter,
      requests: made.map((r) => `${r.method} ${r.status}`),
      lookupIds: made.map((r) => r.lookupId).filter((id, i, ids) => ids.indexOf(id) === i),
      profile,
      screenshots,
      screenshotError,
    };
  };
  if (reset !== 'ok') return result();

  const timeouts = { boot: options.bootTimeoutMs, key: options.keyTimeoutMs, load: options.loadTimeoutMs };
  for (const step of backupSteps(language)) {
    const started = Date.now();
    if (step.navigate === true) {
      await untilConfigIdle(client);
      await readProbe<boolean>(client, STALE_MARK);
      await client.send('Page.navigate', { url });
    }
    if (step.id === 'added') {
      try {
        await phoneSends(server.origin, code!, phonePayload(check, language));
      } catch (error) {
        phoneError = error instanceof Error ? error.message : String(error);
        return result();
      }
    }
    for (const key of step.keys ?? []) await pressKey(client, key);
    const landed = await waitForProbe<WalkState>(
      client,
      WALK_EXPRESSION,
      (state) => state.href === url && !state.stale && (stepLanded(step, state) || stepStuck(step, state) || watch.erroredOut()),
      timeouts[step.wait],
    );
    const met = landed.state !== null && landed.state.href === url && !landed.state.stale && stepLanded(step, landed.state);
    steps.push({ id: step.id, label: step.label, expect: step.expect, met, state: landed.state, ms: Date.now() - started });
    if (!met) return result();
    if (step.id === 'phone') {
      // The pair worker's code, as the stand-in holds it.
      const shown = await waitForProbe<PairState | null>(client, PAIR_EXPRESSION, (s) => s !== null && (s.view === 'code' || s.view === 'unavailable'), options.bootTimeoutMs);
      const held = server.standIn.latest();
      if (shown.state?.view !== 'code' || held === undefined || held.code !== shown.state.code) {
        phoneError = `the pair screen shows ${shown.state?.code ?? shown.state?.view ?? 'nothing'}, the stand-in's newest code is ${held?.code ?? 'none'}`;
        return result();
      }
      code = held.code;
    }
  }

  // The upload now: the first send under the lookup ID asks GET, then PUT.
  await readProbe<string>(client, UPLOAD_EXPRESSION);
  upload = (await waitForProbe<string>(client, UPLOAD_RESULT, (state) => state !== 'pending', options.loadTimeoutMs)).state ?? 'no answer';
  lunaBefore = await readProbe<string[]>(client, LUNA_RESULT);
  if (upload !== 'sent') return result();

  // The wipe (the walk's own delete waits for the app's workers first), then the same address, no key.
  wipe = await resetDatabase(client);
  if (wipe !== 'ok') return result();
  const relaunched = Date.now();
  await client.send('Page.navigate', { url });
  const start = await waitForProbe<StartState>(
    client,
    START_EXPRESSION,
    (state) => state.href === url && !state.stale && (state.screen === 'welcome' || state.onboarding || state.live || state.bootError.trim() !== '' || watch.erroredOut()),
    options.loadTimeoutMs,
  );
  welcome = start.state;
  if (!start.met || welcome === null || welcome.screen !== 'welcome') return result();
  welcomeMs = Date.now() - relaunched;
  screenshotError ??= await shoot(client, options, language, 'welcome', screenshots);
  const live = await waitForProbe<WalkState>(
    client,
    WALK_EXPRESSION,
    // (Until the rows match the fixture too: the guide may come a moment after the catalog.)
    (state) => state.href === url && ((restoredLanded(state, language) && restoredFailures(state, check.categories, language).length === 0) || state.onboarding || state.bootError.trim() !== '' || watch.erroredOut()),
    options.loadTimeoutMs,
  );
  restored = live.state;
  if (restored === null || !restoredLanded(restored, language)) return result();
  liveMs = Date.now() - relaunched;
  screenshotError ??= await shoot(client, options, language, 'restored', screenshots);
  lunaAfter = await readProbe<string[]>(client, LUNA_RESULT);
  await untilConfigIdle(client);
  await readProbe<string>(client, PROFILE_EXPRESSION);
  profile = (await waitForProbe<StoredProfile>(client, PROFILE_RESULT, () => true, options.keyTimeoutMs)).state;
  return result();
}

/**
 * The wipe walk at `url` (a simulated webOS build) in English, then in Arabic; the database deleted
 * and the stand-in's backup forgotten at the end. The caller enables the Page and Runtime domains,
 * starts the engine full screen and forwards `PAIR_PORT` to `server` (`forwardToHost`).
 */
export async function runBackupWalk(
  client: CdpClient,
  url: string,
  check: Pick<DataCheck, 'file'> & Pick<WalkCheck, 'categories'>,
  server: Pick<PairServer, 'origin' | 'standIn' | 'backup'>,
  lookupId: string,
  options: BackupWalkOptions,
): Promise<BackupRun> {
  const started = Date.now();
  const watch = watchErrors(client);
  const walks: BackupWalk[] = [];
  try {
    for (const language of WALK_LANGUAGES) walks.push(await backupOnce(client, url, language, check, server, lookupId, options, watch));
    const cleanup = await resetDatabase(client);
    forgetBackup(server.backup, lookupId);
    return { url, lookupId, walks, cleanup, exceptions: watch.errors(), durationMs: Date.now() - started };
  } finally {
    watch.stop();
  }
}

/** The stand-in's requests a walk must have made: the look-up, the first send's GET and PUT, the restore. */
export const WALK_REQUESTS: readonly string[] = ['GET 404', 'GET 404', 'PUT 200', 'GET 200'];

/** How many of `calls` asked for the LGUDID. */
const idReads = (calls: readonly string[] | null): number => (calls === null ? 0 : calls.filter((uri) => uri === DEVICE_ID_URI).length);

/** `en`'s "Welcome back" and the title it must show in each language. */
export const WELCOME_TITLES: Readonly<Record<WalkLanguage, string>> = { en: 'Welcome back', ar: 'مرحبًا بعودتك' };

/** What the start showed instead of "Welcome back". */
export function startShown(start: StartState): string {
  if (start.bootError.trim() !== '') return `a boot error (${start.bootError.trim()})`;
  if (start.onboarding) return 'onboarding';
  if (start.live) return 'the live screen';
  return start.screen === null ? 'nothing' : `"${start.screen}"`;
}

/** Everything wrong with "Welcome back" in `language`, with one source (step 32d3d's walk checks it too). */
export function welcomeFailures(welcome: StartState, language: WalkLanguage): string[] {
  const failures: string[] = [];
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  if (welcome.language !== language || welcome.dir !== dir) failures.push(`"Welcome back" is in ${welcome.language ?? '-'} (dir="${welcome.dir}"), expected ${language} (dir="${dir}")`);
  if (welcome.title !== WELCOME_TITLES[language]) failures.push(`"Welcome back"'s title reads "${welcome.title ?? ''}", expected "${WELCOME_TITLES[language]}"`);
  if (welcome.sources !== 1) failures.push(`"Welcome back" counts ${welcome.sources ?? 'no'} sources, expected 1`);
  if (welcome.zone !== 'actions' || welcome.index !== 0) failures.push(`"Welcome back"'s focus is at ${welcome.zone ?? '-'} ${welcome.index ?? '-'}, expected "Continue"`);
  if (welcome.outside.length > 0) failures.push(`"Welcome back" outside the title-safe area: ${welcome.outside.join('; ')}`);
  if (welcome.cut.length > 0) failures.push(`"Welcome back" cuts a label: ${welcome.cut.join('; ')}`);
  return failures;
}

/** Everything wrong with one walk, its live screen against the fixture's `categories`; empty means it passed. */
export function evaluateBackupWalk(walk: BackupWalk, lookupId: string, categories: WalkCheck['categories']): string[] {
  if (walk.reset !== 'ok') return [`the app's database could not be deleted before the walk (${walk.reset})`];
  const missed = walk.steps.find((s) => !s.met);
  if (missed !== undefined) return [`"${missed.label}" did not land: expected ${describeExpectation(missed.expect)}, at ${missed.state === null ? 'nothing' : describeState(missed.state)}`];
  if (walk.phoneError !== null) return [`the phone: ${walk.phoneError}`];
  if (walk.upload === null) return ['the walk stopped before the upload'];
  if (walk.upload !== 'sent') return [`the upload answered "${walk.upload}", expected "sent"`];
  if (walk.wipe !== 'ok') return [`the wipe could not delete the app's database (${walk.wipe ?? 'not tried'})`];
  const welcome = walk.welcome;
  if (welcome === null) return ['after the wipe, the page could not be read'];
  if (welcome.screen !== 'welcome') return [`after the wipe the start showed ${startShown(welcome)}, not "Welcome back"`];
  const failures = welcomeFailures(welcome, walk.language);
  const restored = walk.restored;
  if (restored === null || !restoredLanded(restored, walk.language)) {
    failures.push(`after "Welcome back" the live screen never filled by itself: ${restored === null ? 'nothing' : `${describeState(restored)}${restored.live ? `; ${unfilledRows(restored)}` : ''}`}`);
    return failures;
  }
  failures.push(...restoredFailures(restored, categories, walk.language).map((f) => `after the wipe: ${f}`));
  if (walk.requests.join(', ') !== WALK_REQUESTS.join(', ')) failures.push(`the backup stand-in answered ${walk.requests.join(', ') || 'nothing'}, expected ${WALK_REQUESTS.join(', ')}`);
  if (walk.lookupIds.length !== 1 || walk.lookupIds[0] !== lookupId) failures.push(`the requests went under ${walk.lookupIds.join(', ') || 'no lookup ID'}, expected only the simulated LGUDID's (${lookupId})`);
  if (idReads(walk.lunaBefore) < 2) failures.push(`the first page read the LGUDID ${idReads(walk.lunaBefore)} times, expected at the look-up and at the upload`);
  if (idReads(walk.lunaAfter) < 1) failures.push('the page after the wipe never read the LGUDID');
  const profile = walk.profile;
  const want = `s1,m3u,${PHONE_NAMES[walk.language]}`;
  if (profile === null || profile.error !== undefined) failures.push(`the restored profile could not be read${profile?.error === undefined ? '' : `: ${profile.error}`}`);
  else {
    const sources = profile.sources === null ? 'no profile' : profile.sources.map((s) => s.join(',')).join('; ') || 'none';
    if (sources !== want) failures.push(`the restored profile has the sources ${sources}, expected ${want}`);
    if (profile.language !== walk.language || profile.consent !== true) {
      failures.push(`the restored answers are language ${profile.language ?? '-'}, consent ${String(profile.consent)}, expected ${walk.language} and true`);
    }
  }
  return failures;
}

/** Everything wrong with one run; empty means it passed. The Arabic walk's failures say so. */
export function evaluateBackupRun(run: BackupRun, engine: Pick<Engine, 'major'>, categories: WalkCheck['categories']): string[] {
  const failures: string[] = [];
  const userAgent = run.walks.flatMap((w) => w.steps).find((s) => s.state !== null)?.state?.userAgent ?? null;
  if (userAgent === null) failures.push('the page state could not be read at all');
  else {
    const major = chromeMajor(userAgent);
    if (major !== engine.major) failures.push(`the engine reports Chrome ${major ?? '?'} ("${userAgent}"), expected ${engine.major}`);
  }
  for (const language of WALK_LANGUAGES) {
    const walk = run.walks.find((w) => w.language === language);
    const prefix = language === 'ar' ? 'in Arabic: ' : '';
    if (walk === undefined) failures.push(`${prefix}the walk did not run`);
    else failures.push(...evaluateBackupWalk(walk, run.lookupId, categories).map((f) => `${prefix}${f}`));
  }
  if (run.cleanup !== 'ok') failures.push(`the app's database could not be deleted after the walks (${run.cleanup})`);
  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  return failures;
}

/** `  en: "Welcome back" 2.1 s, live 7.9 s; ar: …` (from the relaunch after the wipe). */
export function backupSummary(run: BackupRun): string {
  const seconds = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);
  const parts = run.walks.map((w) => `${w.language}: "Welcome back" ${seconds(w.welcomeMs)}, live ${seconds(w.liveMs)}`);
  return parts.length === 0 ? '' : `  ${parts.join('; ')}`;
}
