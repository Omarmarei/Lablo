/**
 * The backup code on the old engines (RELAY step 32d3d): a TV with no device ID backs up under its
 * backup code, is wiped, and gets its sources back by typing the code at the first start, in
 * Chromium 53, 56 and 68.
 *
 * **The plain Tizen build** (`<variant>/tizen`): an engine has no `webapis`, so the build reads no
 * device ID, which is a TV after "Not now" (and the restore walk of the platform the wipe walk,
 * `backup-walk.ts`, doesn't cover). The salt's platform is `tizen`, its app id the staged
 * config.xml's (`tizenAppId`).
 *
 * **Each walk** (English, then Arabic), from a fresh database:
 * 1. onboarding by phone as the pairing walk, but "Not now" at the consent (RIGHT in English, LEFT
 *    in Arabic); "Start watching"; an upload now (the test hook's `uploadBackup()`): `GET 404`,
 *    `PUT 200`, under the new code's lookup ID;
 * 2. the code read from the app's database (`kv` `backup.code`) by an ES5 read through CDP: the app
 *    has no hook that shows the code, and must not grow one. Its lookup ID is derived here
 *    (`codeLookupId`), and a mistyped code's (`mistyped`: its last character changed, still a code);
 * 3. the wipe (the database deleted from the blank page), the same address: onboarding at once (no
 *    device ID, nothing to look for); the language, the disclaimer, "Not now", ArrowDown three
 *    times to "Use a backup code", OK; the field's edit, the mistyped code typed as `char` key
 *    events (Chromium 53 has no `Input.insertText`), Enter, OK on "Restore": "No backup was
 *    found" (`GET 404`), the focus back on the field; the edit again, Backspace until the field is
 *    empty, the real code typed in lower case in groups of four with spaces (drawn upper case, in
 *    groups), Enter (a screenshot), OK on "Restore";
 * 4. "Opening your backup…" seen or skipped (scrypt is about a second on 53), the app starts
 *    again (`?restored=1`): "Welcome back" in the walk's language with one source (a screenshot),
 *    then the live screen by itself, its rows filled, as the fixture says (a screenshot);
 * 5. the profile read back holds the phone's source, the walk's language and `consent: false`;
 *    `kv`'s code is the one read before the wipe; the stand-in answered `GET 404, PUT 200, GET 404,
 *    GET 200`, each under the code's lookup ID but the third, under the mistyped code's.
 * The database is deleted after the walks, and the stand-in forgets the backups.
 *
 * The steps, the probes and the evaluation are unit-tested; `runCodeWalk` drives a real engine.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { backupKeys, deriveBackupMaster, readBackupCode } from '@lablo/crypto';
import type { StartState } from './backup-walk';
import { START_EXPRESSION, UPLOAD_EXPRESSION, UPLOAD_RESULT, backupSteps, forgetBackup, restoredFailures, restoredLanded, startShown, welcomeFailures } from './backup-walk';
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import { chromeMajor } from './engines';
import type { DataCheck } from './fixture';
import type { Expectation, Key, StoredProfile, WalkCheck, WalkLanguage, WalkState } from './onboarding';
import {
  APP_DATABASE,
  KEY,
  PROFILE_EXPRESSION,
  PROFILE_RESULT,
  STALE_MARK,
  WALK_EXPRESSION,
  WALK_LANGUAGES,
  describeExpectation,
  describeState,
  resetDatabase,
  screenFailures,
  stepLanded,
  stepStuck,
  typeText,
  untilConfigIdle,
} from './onboarding';
import { phoneSends } from './pair-phone';
import type { PairServer } from './pair-server';
import type { PairStepId, PairState } from './pairing';
import { PAIR_EXPRESSION, PHONE_NAMES, pairingUrl, phonePayload } from './pairing';
import type { RunOptions } from './scenario';
import { delay, pressKey, readProbe, waitForProbe, watchErrors } from './scenario';

/** The build the walk runs: its salt's platform. */
export const CODE_PLATFORM = 'tizen';
/** The code field's input (apps/tv `CODE_FIELD`; a root test pins it). */
export const CODE_INPUT = 'onboarding-code';
/** Where the app keeps the backup code: `kv`, under packages/data's `BACKUP_CODE_KEY`. */
export const CODE_KV = { store: 'kv', key: 'backup.code' } as const;
/** The source screen's rows: the two forms, "Use your phone", then "Use a backup code". */
export const CODE_ROW = 3;
/** The code's alphabet (Crockford's base32, @lablo/crypto's). */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Backspaces that empty the field: a code drawn in groups is 32 characters. */
export const CLEAR_KEYS = 32;

/** The code screen's title, "Opening your backup…" and the answer for a code with no backup, as the catalogs give them. */
export const CODE_TEXT: Readonly<Record<WalkLanguage, { readonly title: string; readonly opening: string; readonly none: string }>> = {
  en: { title: 'Restore with a backup code', opening: 'Opening your backup…', none: 'No backup was found for this code. Check it and try again.' },
  ar: { title: 'الاستعادة برمز احتياطي', opening: 'جارٍ فتح نسختك الاحتياطية…', none: 'لم يُعثر على نسخة احتياطية لهذا الرمز. تحقّق منه وحاول مرة أخرى.' },
};

/** The plain Tizen build of `variant`, its API on the forwarded port. */
export function codeWalkUrl(variant: string): string {
  return pairingUrl(variant, CODE_PLATFORM);
}

/** Where the app starts again after a restore (apps/tv `restartUrl`; a root test pins the two equal). */
export function restartedUrl(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? `${url}?restored=1` : `${url.slice(0, q)}?restored=1&${url.slice(q + 1)}`;
}

/** The staged Tizen build's app id (its config.xml's `<tizen:application id>`: the salt's `__APP_ID__`). */
export function tizenAppId(variantDir: string): string {
  const file = path.join(variantDir, CODE_PLATFORM, 'config.xml');
  if (!existsSync(file)) throw new Error(`${path.dirname(file)} has no config.xml: stage the variant first`);
  const id = /<tizen:application\s+id="([^"]+)"/.exec(readFileSync(file, 'utf8'))?.[1];
  if (id === undefined) throw new Error(`${file} has no <tizen:application id="…">`);
  return id;
}

/** The code in groups of four, as Settings draws it and the field shows it. */
export const codeGroups = (code: string): string => code.replace(/(.{4})(?=.)/g, '$1 ');
/** The real code as the walk types it: lower case, in groups of four with spaces. */
export const typedCode = (code: string): string => codeGroups(code).toLowerCase();

/** The code with its last character the next one of the alphabet: still a code, another backup. */
export function mistyped(code: string): string {
  const last = code.charAt(code.length - 1);
  return code.slice(0, -1) + CODE_ALPHABET.charAt((CODE_ALPHABET.indexOf(last) + 1) % CODE_ALPHABET.length);
}

/** The lookup ID a TV with `code` backs up under: the app's derivation, on the Tizen build. */
export async function codeLookupId(code: string, appId: string): Promise<string> {
  return backupKeys(await deriveBackupMaster(code, CODE_PLATFORM, appId)).lookupId;
}

/** The restore-code screen as drawn (null when it isn't on show). */
export interface CodeView {
  readonly phase: string | null;
  readonly problem: string | null;
  readonly notice: string | null;
  /** The field's text, its `dir` attribute and computed direction (null while restoring: no field). */
  readonly value: string | null;
  readonly dir: string | null;
  readonly direction: string | null;
  readonly title: string | null;
  /** The answer's text under the field (null: none shows). */
  readonly noticeText: string | null;
}

/** Onboarding and the live screen as the onboarding walk sees them, with the code screen. */
export interface CodeState extends WalkState {
  readonly code: CodeView | null;
}

/** `codeView()`: the restore-code screen as drawn, or null; plain ES5 (a unit test runs it on a fake page). */
export const CODE_VIEW_FUNCTION = `function codeView() {
    var root = document.querySelector('[data-testid="restore-code"]');
    if (!root) return null;
    var input = document.getElementById('${CODE_INPUT}');
    var title = root.querySelector('[data-testid="onboarding-title"]');
    var notice = root.querySelector('[data-testid="restore-notice"]');
    return {
      phase: root.getAttribute('data-phase'),
      problem: root.getAttribute('data-problem'),
      notice: root.getAttribute('data-notice'),
      value: input ? input.value : null,
      dir: input ? input.getAttribute('dir') : null,
      direction: input ? getComputedStyle(input).direction : null,
      title: title ? title.textContent : null,
      noticeText: notice ? notice.textContent : null
    };
  }`;

/** `WALK_EXPRESSION` with the code screen (`code`); plain ES5 (a unit test parses it at ecmaVersion 5). */
export const CODE_EXPRESSION = `(function () {
  ${CODE_VIEW_FUNCTION}
  var state = JSON.parse(${WALK_EXPRESSION});
  state.code = codeView();
  return JSON.stringify(state);
})()`;

/** Reads the backup code the app keeps (once the app has opened the database); `CODE_READ_RESULT` polls for it. */
export const CODE_READ_EXPRESSION = `(function () {
  window.__labloCode = null;
  function done(value) { window.__labloCode = JSON.stringify(value); }
  function failed(error) { done({ code: null, error: String(error && error.name || error) }); }
  var open = indexedDB.open('${APP_DATABASE.name}');
  open.onerror = function () { failed(open.error); };
  open.onsuccess = function () {
    var db = open.result;
    try {
      var request = db.transaction('${CODE_KV.store}').objectStore('${CODE_KV.store}').get('${CODE_KV.key}');
      request.onsuccess = function () {
        db.close();
        var value = request.result;
        done(typeof value === 'string' ? { code: value } : { code: null, error: 'kv holds ' + (value === undefined ? 'no code' : typeof value) });
      };
      request.onerror = function () { db.close(); failed(request.error); };
    } catch (error) {
      db.close();
      failed(error);
    }
  };
  return JSON.stringify('reading');
})()`;
export const CODE_READ_RESULT = `(function () { return window.__labloCode || null; })()`;

/** What the code read answered. */
export interface KeptCode {
  readonly code: string | null;
  readonly error?: string;
}

export type CodeStepId =
  | PairStepId
  | 'watch'
  | 'not-now'
  | 'restart'
  | 'to-code'
  | 'code'
  | 'open-field'
  | 'type-wrong'
  | 'end-wrong'
  | 'wrong'
  | 'reopen'
  | 'clear'
  | 'type'
  | 'end-edit';
/** The screens a walk saves: the mistyped code's answer, the real code typed, "Welcome back", the live screen after it. */
export type CodeShot = 'none' | 'typed' | 'welcome' | 'restored';

export interface CodeStep {
  readonly id: CodeStepId;
  readonly label: string;
  readonly navigate?: true;
  readonly keys?: readonly Key[];
  /** Typed into the input with DOM focus (`char` key events), after the keys. */
  readonly type?: string;
  readonly expect: Expectation;
  /** The code screen's own marks, each given must match. */
  readonly code?: Partial<CodeView>;
  /** Measure the screen once there (the safe area, no label cut, its fonts settled): its name in failure messages. */
  readonly layout?: string;
  readonly shot?: CodeShot;
  /** `boot`: a page load; `key`: a key; `load`: the phone's source added, or a code's answer. */
  readonly wait: 'boot' | 'key' | 'load';
}

/** "Not now" (RIGHT in English, LEFT in Arabic: the end of the row), then OK: the source screen's first row. */
function notNowSteps(language: WalkLanguage): CodeStep[] {
  const next = language === 'ar' ? KEY.left : KEY.right;
  return [
    { id: 'not-now', label: `${next.key} to "Not now"`, keys: [next], expect: { screen: 'consent', zone: 'actions', index: 1 }, wait: 'key' },
    { id: 'consent', label: 'OK on "Not now"', keys: [KEY.enter], expect: { screen: 'source', zone: 'types', index: 0 }, wait: 'key' },
  ];
}

/** Before the wipe: the wipe walk's (onboarding by phone, "Start watching"), with "Not now" for "Allow". */
export function codeFirstSteps(language: WalkLanguage): CodeStep[] {
  return backupSteps(language).flatMap((step): CodeStep[] => (step.id === 'consent' ? notNowSteps(language) : [step]));
}

/** After the wipe, with the code read before it: onboarding to "Use a backup code", a mistyped code, then the real one typed. */
export function codeRestoreSteps(language: WalkLanguage, code: string): CodeStep[] {
  const first = codeFirstSteps(language);
  const intro = first
    .slice(0, first.findIndex((step) => step.id === 'to-phone'))
    .map((step): CodeStep => (step.id === 'start' ? { ...step, id: 'restart', label: 'the start after the wipe' } : step));
  const wrong = codeGroups(mistyped(code));
  const editing: Expectation = { screen: 'restore-code', zone: 'field', index: 0, editing: CODE_INPUT, active: CODE_INPUT };
  const onRestore: Expectation = { screen: 'restore-code', zone: 'actions', index: 0, editing: '', active: 'BODY' };
  const text = CODE_TEXT[language];
  return [
    ...intro,
    {
      id: 'to-code',
      label: 'ArrowDown three times to "Use a backup code"',
      keys: [KEY.down, KEY.down, KEY.down],
      expect: { screen: 'source', zone: 'types', index: CODE_ROW },
      layout: 'source',
      wait: 'key',
    },
    {
      id: 'code',
      label: 'OK on "Use a backup code"',
      keys: [KEY.enter],
      expect: { screen: 'restore-code', zone: 'field', index: 0, editing: '' },
      code: { phase: 'typing', value: '', title: text.title, dir: 'ltr' },
      layout: 'restore-code',
      wait: 'key',
    },
    { id: 'open-field', label: 'OK on the code field', keys: [KEY.enter], expect: editing, wait: 'key' },
    { id: 'type-wrong', label: `typing the mistyped code "${wrong}"`, type: wrong, expect: editing, code: { value: wrong }, wait: 'key' },
    { id: 'end-wrong', label: 'OK (key 13) in the field', keys: [KEY.enter], expect: onRestore, code: { value: wrong, problem: '' }, wait: 'key' },
    {
      id: 'wrong',
      label: 'OK on "Restore" with the mistyped code',
      keys: [KEY.enter],
      expect: { screen: 'restore-code', zone: 'field', index: 0, editing: '' },
      code: { phase: 'typing', problem: '', notice: 'none', noticeText: text.none, value: wrong },
      layout: 'restore-code',
      shot: 'none',
      wait: 'load',
    },
    { id: 'reopen', label: 'OK on the code field again', keys: [KEY.enter], expect: editing, code: { value: wrong }, wait: 'key' },
    { id: 'clear', label: `Backspace ${CLEAR_KEYS} times`, keys: Array<Key>(CLEAR_KEYS).fill(KEY.backspace), expect: editing, code: { value: '', notice: '' }, wait: 'key' },
    { id: 'type', label: `typing the code as "${typedCode(code)}"`, type: typedCode(code), expect: editing, code: { value: codeGroups(code) }, wait: 'key' },
    {
      id: 'end-edit',
      label: 'OK (key 13) in the field',
      keys: [KEY.enter],
      expect: onRestore,
      code: { phase: 'typing', problem: '', notice: '', value: codeGroups(code), dir: 'ltr', direction: 'ltr', title: text.title },
      layout: 'restore-code',
      shot: 'typed',
      wait: 'key',
    },
  ];
}

/** The code screen's marks `want` gives all hold. */
export function codeMatches(want: Partial<CodeView> | undefined, view: CodeView | null): boolean {
  if (want === undefined) return true;
  if (view === null) return false;
  return (Object.keys(want) as Array<keyof CodeView>).every((key) => want[key] === view[key]);
}

/** Has the step landed: the onboarding walk's test, and the code screen's marks. */
export function codeStepLanded(step: Pick<CodeStep, 'expect' | 'code' | 'layout'>, state: CodeState): boolean {
  return stepLanded(step, state) && codeMatches(step.code, state.code);
}

const show = (value: string | null): string => (value === null ? '-' : `"${value}"`);

/** `the code screen: phase typing, problem -, notice "none", the field "ABCD EFGH"`. */
export function describeCode(view: CodeView | null): string {
  if (view === null) return 'no code screen';
  const parts = [`phase ${view.phase ?? '-'}`, `problem ${show(view.problem)}`, `notice ${show(view.notice)}`, `the field ${show(view.value)}`];
  if (view.dir !== null) parts.push(`dir="${view.dir}" (${view.direction ?? '-'})`);
  if (view.title !== null) parts.push(`title ${show(view.title)}`);
  if (view.noticeText !== null) parts.push(`answer ${show(view.noticeText)}`);
  return `the code screen: ${parts.join(', ')}`;
}

/** What a step wants of the code screen, as `describeCode` puts it. */
export function describeCodeExpectation(want: Partial<CodeView> | undefined): string {
  if (want === undefined) return '';
  return (Object.keys(want) as Array<keyof CodeView>).map((key) => `${key} ${show(want[key] ?? null)}`).join(', ');
}

export interface CodeStepRecord {
  readonly id: CodeStepId;
  readonly label: string;
  readonly expect: Expectation;
  readonly code: Partial<CodeView> | null;
  readonly layout: string | null;
  readonly met: boolean;
  readonly state: CodeState | null;
  readonly ms: number;
}

export interface CodeWalk {
  readonly language: WalkLanguage;
  readonly reset: string;
  /** Before the wipe: onboarding by phone with "Not now", "Start watching". */
  readonly steps: readonly CodeStepRecord[];
  readonly phoneError: string | null;
  /** The upload's state (`sent` …), or what went wrong starting it; null when the walk stopped before it. */
  readonly upload: string | null;
  /** The code the app kept, read before the wipe (null: not read). */
  readonly kept: KeptCode | null;
  /** The lookup IDs the harness derived: the code's and the mistyped code's (null: no code to derive from). */
  readonly lookupIds: { readonly code: string; readonly mistyped: string } | null;
  /** How deleting the database for the wipe went (null: the walk stopped before it). */
  readonly wipe: string | null;
  /** After the wipe: onboarding to the code screen, the mistyped code, the real one typed. */
  readonly after: readonly CodeStepRecord[];
  /** The code screen while restoring, if it showed before the app started again. */
  readonly opening: CodeView | null;
  /** The code screen still on show once the restore ended without starting the app (null: it started again). */
  readonly answer: CodeState | null;
  /** The start's screen after the restore ("Welcome back", or what showed instead). */
  readonly welcome: StartState | null;
  /** The live screen after "Welcome back", with no key pressed. */
  readonly restored: WalkState | null;
  /** OK on "Restore" with the mistyped code to its answer, and with the real one to "Welcome back" and to the live screen filled (ms). */
  readonly noneMs: number | null;
  readonly welcomeMs: number | null;
  readonly liveMs: number | null;
  /** The stand-in's backup requests during the walk: `<method> <status>`, and each one's lookup ID. */
  readonly requests: readonly string[];
  readonly requestIds: readonly string[];
  readonly profile: StoredProfile | null;
  /** The code the app keeps after the restore. */
  readonly keptAfter: KeptCode | null;
  readonly screenshots: readonly string[];
  readonly screenshotError: string | null;
}

export interface CodeRun {
  readonly url: string;
  readonly appId: string;
  readonly walks: readonly CodeWalk[];
  readonly cleanup: string;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
}

export interface CodeWalkOptions extends RunOptions {
  /** "Add" by phone to the done screen, a code's answer, and the restore to the live screen's rows. */
  readonly loadTimeoutMs: number;
  readonly screenshot: ((language: WalkLanguage, view: CodeShot) => string) | null;
  readonly save: (file: string, png: Buffer) => void;
}

/** The focus ring's transition ends before a screenshot. */
const SETTLE_MS = 400;

async function shoot(client: CdpClient, options: CodeWalkOptions, language: WalkLanguage, view: CodeShot, into: string[]): Promise<string | null> {
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

async function readKept(client: CdpClient, timeoutMs: number): Promise<KeptCode | null> {
  await readProbe<string>(client, CODE_READ_EXPRESSION);
  return (await waitForProbe<KeptCode>(client, CODE_READ_RESULT, () => true, timeoutMs)).state;
}

/** One walk in one language, from a fresh database, until a step doesn't land. */
async function codeOnce(
  client: CdpClient,
  url: string,
  appId: string,
  language: WalkLanguage,
  check: Pick<DataCheck, 'file'> & Pick<WalkCheck, 'categories'>,
  server: Pick<PairServer, 'origin' | 'standIn' | 'backup'>,
  options: CodeWalkOptions,
  watch: ReturnType<typeof watchErrors>,
): Promise<CodeWalk> {
  const reset = await resetDatabase(client);
  const first = server.backup.requests.length;
  const steps: CodeStepRecord[] = [];
  const after: CodeStepRecord[] = [];
  const screenshots: string[] = [];
  let screenshotError: string | null = null;
  let phoneError: string | null = null;
  let pairCode: string | null = null;
  let upload: string | null = null;
  let kept: KeptCode | null = null;
  let lookupIds: CodeWalk['lookupIds'] = null;
  let wipe: string | null = null;
  let opening: CodeView | null = null;
  let answer: CodeState | null = null;
  let welcome: StartState | null = null;
  let restored: WalkState | null = null;
  let noneMs: number | null = null;
  let welcomeMs: number | null = null;
  let liveMs: number | null = null;
  let profile: StoredProfile | null = null;
  let keptAfter: KeptCode | null = null;
  const result = (): CodeWalk => {
    const made = server.backup.requests.slice(first);
    return {
      language,
      reset,
      steps,
      phoneError,
      upload,
      kept,
      lookupIds,
      wipe,
      after,
      opening,
      answer,
      welcome,
      restored,
      noneMs,
      welcomeMs,
      liveMs,
      requests: made.map((r) => `${r.method} ${r.status}`),
      requestIds: made.map((r) => r.lookupId),
      profile,
      keptAfter,
      screenshots,
      screenshotError,
    };
  };
  if (reset !== 'ok') return result();

  const timeouts = { boot: options.bootTimeoutMs, key: options.keyTimeoutMs, load: options.loadTimeoutMs };
  /** Runs `list` into `into` until a step doesn't land; true when all did. */
  const walk = async (list: readonly CodeStep[], into: CodeStepRecord[]): Promise<boolean> => {
    for (const step of list) {
      const started = Date.now();
      if (step.navigate === true) {
        await untilConfigIdle(client);
        await readProbe<boolean>(client, STALE_MARK);
        await client.send('Page.navigate', { url });
      }
      if (step.id === 'added') {
        try {
          await phoneSends(server.origin, pairCode!, phonePayload(check, language));
        } catch (error) {
          phoneError = error instanceof Error ? error.message : String(error);
          return false;
        }
      }
      for (const key of step.keys ?? []) await pressKey(client, key);
      if (step.type !== undefined) await typeText(client, step.type);
      const landed = await waitForProbe<CodeState>(
        client,
        CODE_EXPRESSION,
        (state) => state.href === url && !state.stale && (codeStepLanded(step, state) || stepStuck(step, state) || watch.erroredOut()),
        timeouts[step.wait],
      );
      const met = landed.state !== null && landed.state.href === url && !landed.state.stale && codeStepLanded(step, landed.state);
      into.push({ id: step.id, label: step.label, expect: step.expect, code: step.code ?? null, layout: step.layout ?? null, met, state: landed.state, ms: Date.now() - started });
      if (!met) return false;
      if (step.shot !== undefined) screenshotError ??= await shoot(client, options, language, step.shot, screenshots);
      if (step.id === 'phone') {
        // The pair worker's code, as the stand-in holds it.
        const shown = await waitForProbe<PairState | null>(client, PAIR_EXPRESSION, (s) => s !== null && (s.view === 'code' || s.view === 'unavailable'), options.bootTimeoutMs);
        const held = server.standIn.latest();
        if (shown.state?.view !== 'code' || held === undefined || held.code !== shown.state.code) {
          phoneError = `the pair screen shows ${shown.state?.code ?? shown.state?.view ?? 'nothing'}, the stand-in's newest code is ${held?.code ?? 'none'}`;
          return false;
        }
        pairCode = held.code;
      }
    }
    return true;
  };

  try {
    if (!(await walk(codeFirstSteps(language), steps))) return result();

    // The upload now: the first send under the new code asks GET, then PUT.
    await readProbe<string>(client, UPLOAD_EXPRESSION);
    upload = (await waitForProbe<string>(client, UPLOAD_RESULT, (state) => state !== 'pending', options.loadTimeoutMs)).state ?? 'no answer';
    if (upload !== 'sent') return result();

    // The code, from the app's database (never through a hook), and the lookup IDs it and a mistyped one give.
    kept = await readKept(client, options.keyTimeoutMs);
    const code = kept?.code ?? null;
    if (code === null || readBackupCode(code) !== code) return result();
    lookupIds = { code: await codeLookupId(code, appId), mistyped: await codeLookupId(mistyped(code), appId) };

    // The wipe (the walk's own delete waits for the app's workers first), then the same address.
    wipe = await resetDatabase(client);
    if (wipe !== 'ok') return result();
    if (!(await walk(codeRestoreSteps(language, code), after))) return result();
    noneMs = after.find((step) => step.id === 'wrong')?.ms ?? null;

    // OK on "Restore": "Opening your backup…" (or straight on), then the app starts again.
    const pressed = Date.now();
    const restarted = restartedUrl(url);
    await pressKey(client, KEY.enter);
    const left = await waitForProbe<CodeState>(client, CODE_EXPRESSION, (state) => state.href !== url || (state.code !== null && state.code.phase !== 'typing'), options.keyTimeoutMs);
    if (left.state !== null && left.state.href === url && left.state.code?.phase === 'restoring') opening = left.state.code;
    const ended = await waitForProbe<CodeState>(client, CODE_EXPRESSION, (state) => state.href !== url || state.code?.phase === 'typing' || watch.erroredOut(), options.loadTimeoutMs);
    if (ended.state === null || ended.state.href === url) {
      answer = ended.state;
      return result();
    }
    const start = await waitForProbe<StartState>(
      client,
      START_EXPRESSION,
      (state) => state.href === restarted && (state.screen === 'welcome' || state.onboarding || state.live || state.bootError.trim() !== '' || watch.erroredOut()),
      options.loadTimeoutMs,
    );
    welcome = start.state;
    if (!start.met || welcome === null || welcome.screen !== 'welcome') return result();
    welcomeMs = Date.now() - pressed;
    screenshotError ??= await shoot(client, options, language, 'welcome', screenshots);
    const live = await waitForProbe<WalkState>(
      client,
      WALK_EXPRESSION,
      // (Until the rows match the fixture too: the guide may come a moment after the catalog.)
      (state) => state.href === restarted && ((restoredLanded(state, language) && restoredFailures(state, check.categories, language).length === 0) || state.onboarding || state.bootError.trim() !== '' || watch.erroredOut()),
      options.loadTimeoutMs,
    );
    restored = live.state;
    if (restored === null || !restoredLanded(restored, language)) return result();
    liveMs = Date.now() - pressed;
    screenshotError ??= await shoot(client, options, language, 'restored', screenshots);
    await untilConfigIdle(client);
    await readProbe<string>(client, PROFILE_EXPRESSION);
    profile = (await waitForProbe<StoredProfile>(client, PROFILE_RESULT, () => true, options.keyTimeoutMs)).state;
    keptAfter = await readKept(client, options.keyTimeoutMs);
    return result();
  } finally {
    if (lookupIds !== null) forgetBackup(server.backup, lookupIds.code);
  }
}

/**
 * The code walk at `url` (a plain Tizen build) in English, then in Arabic; the database deleted at
 * the end. `appId` is the build's (`tizenAppId`). The caller enables the Page and Runtime domains,
 * starts the engine full screen and forwards `PAIR_PORT` to `server` (`forwardToHost`).
 */
export async function runCodeWalk(
  client: CdpClient,
  url: string,
  appId: string,
  check: Pick<DataCheck, 'file'> & Pick<WalkCheck, 'categories'>,
  server: Pick<PairServer, 'origin' | 'standIn' | 'backup'>,
  options: CodeWalkOptions,
): Promise<CodeRun> {
  const started = Date.now();
  const watch = watchErrors(client);
  const walks: CodeWalk[] = [];
  try {
    for (const language of WALK_LANGUAGES) walks.push(await codeOnce(client, url, appId, language, check, server, options, watch));
    const cleanup = await resetDatabase(client);
    return { url, appId, walks, cleanup, exceptions: watch.errors(), durationMs: Date.now() - started };
  } finally {
    watch.stop();
  }
}

/** The stand-in's requests a walk must have made: the first send's GET and PUT, the mistyped code's look-up, the restore. */
export const CODE_REQUESTS: readonly string[] = ['GET 404', 'PUT 200', 'GET 404', 'GET 200'];

/** Why a step didn't land: the step, what it wanted, and what the page showed. */
function missedStep(step: CodeStepRecord): string {
  const want = [describeExpectation(step.expect), describeCodeExpectation(step.code ?? undefined)].filter((part) => part !== '').join('; ');
  const saw = step.state === null ? 'nothing' : step.code === null ? describeState(step.state) : `${describeState(step.state)}; ${describeCode(step.state.code)}`;
  return `"${step.label}" did not land: expected ${want}, at ${saw}`;
}

/** The measured screens of `records`: the TV's canvas, no scroll, the safe area, no label cut. */
function layoutFailures(records: readonly CodeStepRecord[]): string[] {
  return records.flatMap((step) => (step.layout === null || step.state === null ? [] : screenFailures(step.state).map((f) => `on the ${step.layout} screen: ${f}`)));
}

/** Everything wrong with one walk, its live screen against the fixture's `categories`; empty means it passed. */
export function evaluateCodeWalk(walk: CodeWalk, categories: WalkCheck['categories']): string[] {
  if (walk.reset !== 'ok') return [`the app's database could not be deleted before the walk (${walk.reset})`];
  const missed = walk.steps.find((s) => !s.met);
  if (missed !== undefined) return [missedStep(missed)];
  if (walk.phoneError !== null) return [`the phone: ${walk.phoneError}`];
  if (walk.upload === null) return ['the walk stopped before the upload'];
  if (walk.upload !== 'sent') return [`the upload answered "${walk.upload}", expected "sent"`];
  const kept = walk.kept;
  if (kept === null || kept.code === null) return [`the backup code could not be read from the app's database${kept?.error === undefined ? '' : ` (${kept.error})`}`];
  if (readBackupCode(kept.code) !== kept.code) return [`the app's database holds "${kept.code}", not a backup code`];
  if (walk.lookupIds === null) return ['the walk stopped before deriving the lookup IDs'];
  if (walk.wipe !== 'ok') return [`the wipe could not delete the app's database (${walk.wipe ?? 'not tried'})`];
  const missedAfter = walk.after.find((s) => !s.met);
  if (missedAfter !== undefined) return [`after the wipe: ${missedStep(missedAfter)}`];
  const failures = [...layoutFailures(walk.steps), ...layoutFailures(walk.after)];
  if (walk.opening !== null && walk.opening.title !== CODE_TEXT[walk.language].opening) {
    failures.push(`while restoring the title reads ${show(walk.opening.title)}, expected "${CODE_TEXT[walk.language].opening}"`);
  }
  const welcome = walk.welcome;
  if (welcome === null) {
    const stayed = walk.answer;
    failures.push(stayed === null ? 'after "Restore" with the code, the page could not be read' : `after "Restore" with the code the app never started again: ${describeCode(stayed.code)}`);
    return failures;
  }
  if (welcome.screen !== 'welcome') {
    failures.push(`after the code's restore the start showed ${startShown(welcome)}, not "Welcome back"`);
    return failures;
  }
  failures.push(...welcomeFailures(welcome, walk.language));
  const restored = walk.restored;
  if (restored === null || !restoredLanded(restored, walk.language)) {
    failures.push(`after "Welcome back" the live screen never filled by itself: ${restored === null ? 'nothing' : describeState(restored)}`);
    return failures;
  }
  failures.push(...restoredFailures(restored, categories, walk.language).map((f) => `after the code's restore: ${f}`));
  if (walk.requests.join(', ') !== CODE_REQUESTS.join(', ')) failures.push(`the backup stand-in answered ${walk.requests.join(', ') || 'nothing'}, expected ${CODE_REQUESTS.join(', ')}`);
  const ids = walk.lookupIds;
  const want = [ids.code, ids.code, ids.mistyped, ids.code];
  if (walk.requestIds.join(', ') !== want.join(', ')) {
    const name = (id: string): string => (id === ids.code ? "the code's" : id === ids.mistyped ? "the mistyped code's" : id);
    failures.push(`the requests went under ${walk.requestIds.map(name).join(', ') || 'no lookup ID'}, expected ${want.map(name).join(', ')}`);
  }
  const profile = walk.profile;
  const sources = `s1,m3u,${PHONE_NAMES[walk.language]}`;
  if (profile === null || profile.error !== undefined) failures.push(`the restored profile could not be read${profile?.error === undefined ? '' : `: ${profile.error}`}`);
  else {
    const got = profile.sources === null ? 'no profile' : profile.sources.map((s) => s.join(',')).join('; ') || 'none';
    if (got !== sources) failures.push(`the restored profile has the sources ${got}, expected ${sources}`);
    if (profile.language !== walk.language || profile.consent !== false) {
      failures.push(`the restored answers are language ${profile.language ?? '-'}, consent ${String(profile.consent)}, expected ${walk.language} and false`);
    }
  }
  if (walk.keptAfter?.code !== kept.code) failures.push(`after the restore the app keeps the code ${show(walk.keptAfter?.code ?? null)}, expected the one typed ("${kept.code}")`);
  if (walk.screenshotError !== null) failures.push(`screenshot: ${walk.screenshotError}`);
  return failures;
}

/** Everything wrong with one run; empty means it passed. The Arabic walk's failures say so. */
export function evaluateCodeRun(run: CodeRun, engine: Pick<Engine, 'major'>, categories: WalkCheck['categories']): string[] {
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
    else failures.push(...evaluateCodeWalk(walk, categories).map((f) => `${prefix}${f}`));
  }
  if (run.cleanup !== 'ok') failures.push(`the app's database could not be deleted after the walks (${run.cleanup})`);
  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  return failures;
}

/** `  en: no backup 1.2 s, "Welcome back" 2.1 s, live 7.9 s; ar: …` (from OK on "Restore"). */
export function codeSummary(run: CodeRun): string {
  const seconds = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);
  const parts = run.walks.map((w) => `${w.language}: no backup ${seconds(w.noneMs)}, "Welcome back" ${seconds(w.welcomeMs)}, live ${seconds(w.liveMs)}`);
  return parts.length === 0 ? '' : `  ${parts.join('; ')}`;
}
