/**
 * What the harness checks in one engine for one built TV app (relay step 2b):
 * 1. The bundle boots from file:// with no syntax or runtime error (`#boot-error` stays empty,
 *    no Runtime.exceptionThrown) and the hello screen reports `data-ready=true`.
 * 2. Web Worker and IndexedDB sanity: the inlined Blob worker answers (`worker-status` "ok in …")
 *    and completes an IndexedDB write/read inside the worker (`idb-status` "ok").
 * 3. The data workers (step 8b): the query worker and a start-up prune, then a refresh of the
 *    staged fixture playlist in an ingest worker, and a search through the query worker. The
 *    refresh must commit every item (gunzipping the .gz one), and the search must count exactly
 *    the expected hits (`fixture.ts`). Then the guide the playlist names, in an EPG worker
 *    (step 9b): exactly the expected channels matched, and a now/next read from IndexedDB.
 * 4. Remote-key navigation: ArrowUp and Enter (the TV remote key codes 38 and 13) reach the app
 *    as the UP and OK intents.
 *
 * The pure parts (settling, exception formatting, evaluation) are unit-tested; `runPlatform`
 * drives a real engine over CDP.
 */
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import { chromeMajor } from './engines';
import type { DataCheck } from './fixture';

export type TvPlatform = 'tizen' | 'webos';
export const TV_PLATFORMS: readonly TvPlatform[] = ['tizen', 'webos'];

/** The hello screen as the harness sees it. */
export interface PageState {
  readonly href: string;
  readonly userAgent: string;
  readonly bootError: string;
  readonly ready: boolean;
  readonly platformId: string | null;
  readonly worker: string | null;
  readonly idb: string | null;
  readonly lastIntent: string | null;
  readonly keyCount: string | null;
  /** The focus engine's row (step 10): `screen · zone index`. */
  readonly focus: string | null;
  /** The catalog panel: data workers, refresh and search (null when the app has none). */
  readonly data: string | null;
  readonly ingest: string | null;
  readonly ingestItems: string | null;
  readonly gzip: string | null;
  readonly search: string | null;
  readonly searchTotal: string | null;
  /** The guide row (step 9b) and the now/next row. */
  readonly epg: string | null;
  readonly epgMatched: string | null;
  readonly epgWanted: string | null;
  readonly nowNext: string | null;
}

/**
 * Evaluated inside the page on every engine, so it is plain ES5 (a unit test parses it at
 * ecmaVersion 5). It returns a JSON string because returnByValue on old engines is limited.
 */
export const STATE_EXPRESSION = `(function () {
  function text(id) {
    var el = document.querySelector('[data-testid="' + id + '"]');
    return el ? el.textContent : null;
  }
  function attr(id, name) {
    var el = document.querySelector('[data-testid="' + id + '"]');
    return el ? el.getAttribute(name) : null;
  }
  var hello = document.querySelector('[data-testid="hello"]');
  var boot = document.getElementById('boot-error');
  return JSON.stringify({
    href: location.href,
    userAgent: navigator.userAgent,
    bootError: boot ? boot.textContent : '',
    ready: hello !== null && hello.getAttribute('data-ready') === 'true',
    platformId: text('platform-id'),
    worker: text('worker-status'),
    idb: text('idb-status'),
    lastIntent: text('last-intent'),
    keyCount: text('key-count'),
    focus: text('focus-status'),
    data: text('data-status'),
    ingest: text('ingest-status'),
    ingestItems: attr('ingest-status', 'data-items'),
    gzip: attr('ingest-status', 'data-gzip'),
    search: text('search-status'),
    searchTotal: attr('search-status', 'data-total'),
    epg: text('epg-status'),
    epgMatched: attr('epg-status', 'data-matched'),
    epgWanted: attr('epg-status', 'data-wanted'),
    nowNext: text('nownext-status')
  });
})()`;

export interface KeyStep {
  readonly key: string;
  readonly keyCode: number;
  readonly intent: string;
  /** The focus engine's row after the key: the demo starts on its list's first item. */
  readonly focus: string;
}

/**
 * Remote keys that share their key codes with every TV remote (arrows 37–40, Enter 13). UP
 * leaves the list for the rail above it, and OK opens a details screen on the rail's item.
 */
export const KEY_STEPS: readonly KeyStep[] = [
  { key: 'ArrowUp', keyCode: 38, intent: 'UP', focus: 'home · rail 0' },
  { key: 'Enter', keyCode: 13, intent: 'OK', focus: 'details · buttons 0' },
];

export interface KeyResult {
  readonly key: string;
  readonly expected: string;
  readonly observed: string | null;
  readonly expectedFocus: string;
  readonly focus: string | null;
}

export interface PlatformRun {
  readonly platform: TvPlatform;
  readonly url: string;
  /** What the catalog panel must show (null: the data workers are not checked). */
  readonly data: DataCheck | null;
  /** The last state read while booting (null if the page could never be read). */
  readonly boot: PageState | null;
  /** False when boot neither finished nor failed before the timeout. */
  readonly settled: boolean;
  readonly keys: readonly KeyResult[];
  readonly keyCount: string | null;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
}

/** A row that has answered: `ok`, `failed`, or `none` (nothing to do, e.g. no guide named). */
const isFinal = (status: string | null): boolean =>
  status !== null && (status.startsWith('ok') || status.startsWith('failed') || status.startsWith('none'));

/**
 * Boot is over when it failed visibly, or when the worker and IndexedDB checks have answered,
 * and (with a data check) the refresh, the search, the guide and now/next have too.
 */
export function isSettled(state: PageState, url: string, data: DataCheck | null = null): boolean {
  if (state.href !== url) return false;
  if (state.bootError.trim() !== '') return true;
  const booted = state.ready && isFinal(state.worker) && isFinal(state.idb);
  if (!booted || data === null) return booted;
  if (state.data?.startsWith('failed') === true) return true;
  return isFinal(state.data) && isFinal(state.ingest) && isFinal(state.search) && isFinal(state.epg) && isFinal(state.nowNext);
}

/** What went wrong in the catalog panel; empty when it shows exactly what `check` expects. */
function evaluateData(state: PageState, check: DataCheck): string[] {
  if (state.data?.startsWith('ok: ') !== true) return [`data workers: ${state.data ?? 'missing'}`];
  const failures: string[] = [];
  if (state.ingest?.startsWith('ok: committed') !== true) failures.push(`refresh of ${check.file}: ${state.ingest ?? 'missing'}`);
  else {
    if (state.ingestItems !== String(check.items)) failures.push(`refresh of ${check.file} committed ${state.ingestItems ?? '?'} items, expected ${check.items}`);
    if (state.gzip !== String(check.gzip)) failures.push(`refresh of ${check.file}: gzip ${state.gzip ?? '?'}, expected ${String(check.gzip)}`);
  }
  if (state.search?.startsWith('ok: ') !== true) failures.push(`search "${check.query}": ${state.search ?? 'missing'}`);
  else if (state.searchTotal !== String(check.total)) failures.push(`search "${check.query}" found ${state.searchTotal ?? '?'}, expected ${check.total}`);
  if (state.epg?.startsWith('ok: ') !== true) failures.push(`guide ${check.guide}: ${state.epg ?? 'missing'}`);
  else if (state.epgMatched !== String(check.epgMatched) || state.epgWanted !== String(check.epgWanted)) {
    failures.push(`guide ${check.guide} matched ${state.epgMatched ?? '?'} of ${state.epgWanted ?? '?'}, expected ${check.epgMatched} of ${check.epgWanted}`);
  }
  if (state.nowNext?.startsWith('ok: ') !== true) failures.push(`now/next: ${state.nowNext ?? 'missing'}`);
  return failures;
}

interface ExceptionDetails {
  text?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  exception?: { description?: string };
}

/**
 * `Runtime.exceptionThrown`: protocol 1.2 (Chromium 54+) sends `exceptionDetails`; older
 * engines sent `details` plus a separate `exception`.
 */
export function formatException(params: unknown): string {
  const value = (params ?? {}) as {
    exceptionDetails?: ExceptionDetails;
    details?: ExceptionDetails;
    exception?: { description?: string };
  };
  const details = value.exceptionDetails ?? value.details ?? {};
  const description = details.exception?.description ?? value.exception?.description ?? details.text ?? 'unknown exception';
  const firstLine = description.split('\n')[0] ?? description;
  const where = details.url === undefined || details.url === '' ? '' : ` (${details.url.split('/').pop() ?? ''}:${(details.lineNumber ?? 0) + 1})`;
  return `${firstLine}${where}`;
}

/**
 * `Console.messageAdded`: a JavaScript error logged by the engine (Chromium 53 reports uncaught
 * errors only this way). Network errors, warnings and app logs are ignored.
 */
export function formatConsoleError(params: unknown): string | null {
  const message = (params as { message?: { source?: string; level?: string; text?: string; url?: string; line?: number } } | null)
    ?.message;
  if (message?.source !== 'javascript' || message.level !== 'error') return null;
  const text = (message.text ?? 'unknown error').split('\n')[0] ?? '';
  const where = message.url === undefined || message.url === '' ? '' : ` (${message.url.split('/').pop() ?? ''}:${message.line ?? 0})`;
  return `${text}${where}`;
}

/** Everything wrong with one run; empty means it passed. */
export function evaluateRun(run: PlatformRun, engine: Pick<Engine, 'major'>, bootTimeoutMs: number): string[] {
  const boot = run.boot;
  if (boot === null) return ['the page state could not be read at all', ...run.exceptions.map((e) => `uncaught: ${e}`)];

  const failures: string[] = [];
  const major = chromeMajor(boot.userAgent);
  if (major !== engine.major) failures.push(`the engine reports Chrome ${major ?? '?'} ("${boot.userAgent}"), expected ${engine.major}`);
  if (boot.bootError.trim() !== '') failures.push(boot.bootError.trim().split('\n').join(' | '));
  else if (!run.settled) {
    const data = run.data === null ? '' : `, data=${boot.data ?? '-'}, refresh=${boot.ingest ?? '-'}, search=${boot.search ?? '-'}`;
    failures.push(
      `did not finish booting within ${bootTimeoutMs / 1000} s (ready=${boot.ready}, worker=${boot.worker ?? '-'}, idb=${boot.idb ?? '-'}${data})`,
    );
  }

  if (boot.bootError.trim() === '' && run.settled) {
    if (boot.platformId !== run.platform) failures.push(`platform-id is "${boot.platformId ?? ''}", expected "${run.platform}"`);
    if (boot.worker?.startsWith('ok in ') !== true) failures.push(`worker: ${boot.worker ?? 'missing'}`);
    if (boot.idb !== 'ok') failures.push(`IndexedDB in the worker: ${boot.idb ?? 'missing'}`);
    if (run.data !== null) failures.push(...evaluateData(boot, run.data));
    for (const key of run.keys) {
      if (key.observed !== key.expected) failures.push(`key ${key.key}: expected intent ${key.expected}, saw ${key.observed ?? 'nothing'}`);
      else if (key.focus !== key.expectedFocus) {
        failures.push(`key ${key.key}: expected focus "${key.expectedFocus}", saw "${key.focus ?? 'nothing'}"`);
      }
    }
    // After an uncaught error the keys are skipped; the error itself is the failure.
    if (run.exceptions.length === 0) {
      if (run.keys.length !== KEY_STEPS.length) failures.push(`only ${run.keys.length} of ${KEY_STEPS.length} key steps ran`);
      else if (run.keyCount !== String(KEY_STEPS.length)) failures.push(`key-count is ${run.keyCount ?? '-'}, expected ${KEY_STEPS.length}`);
    }
  }

  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  return failures;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ERROR_GRACE_MS = 2_000;

async function readState(client: CdpClient): Promise<PageState | null> {
  try {
    const reply = await client.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression: STATE_EXPRESSION,
      returnByValue: true,
    });
    const value = reply.result?.value;
    return typeof value === 'string' ? (JSON.parse(value) as PageState) : null;
  } catch {
    // The document is being replaced (navigation in progress).
    return null;
  }
}

async function waitFor(
  client: CdpClient,
  predicate: (state: PageState) => boolean,
  timeoutMs: number,
): Promise<{ state: PageState | null; met: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let last: PageState | null = null;
  while (Date.now() < deadline) {
    const state = await readState(client);
    if (state !== null) {
      last = state;
      if (predicate(state)) return { state, met: true };
    }
    await delay(100);
  }
  return { state: last, met: false };
}

async function pressKey(client: CdpClient, step: KeyStep): Promise<void> {
  const key = { key: step.key, code: step.key, windowsVirtualKeyCode: step.keyCode, nativeVirtualKeyCode: step.keyCode };
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

export interface RunOptions {
  readonly bootTimeoutMs: number;
  readonly keyTimeoutMs: number;
}

/**
 * Loads `url` in the connected page and runs the boot, worker/IndexedDB, data-worker (when
 * `data` is given) and key checks. The caller enables the Page and Runtime domains once per
 * connection.
 */
export async function runPlatform(
  client: CdpClient,
  platform: TvPlatform,
  url: string,
  data: DataCheck | null,
  options: RunOptions,
): Promise<PlatformRun> {
  const started = Date.now();
  const exceptions: string[] = [];
  const consoleErrors: string[] = [];
  const collect = (params: unknown): void => {
    exceptions.push(formatException(params));
  };
  const collectConsole = (params: unknown): void => {
    const error = formatConsoleError(params);
    if (error !== null) consoleErrors.push(error);
  };

  // Start from a blank document so a previous app's state can never be mistaken for this one.
  await client.send('Page.navigate', { url: 'about:blank' });
  await waitFor(client, (state) => state.href === 'about:blank', 5_000);

  client.on('Runtime.exceptionThrown', collect);
  client.on('Console.messageAdded', collectConsole);
  try {
    await client.send('Page.navigate', { url });
    // An uncaught error in a promise chain can stall boot without touching #boot-error: give
    // the page a short grace period after the first one instead of the full boot timeout.
    let firstErrorAt: number | null = null;
    const erroredOut = (): boolean => {
      if (exceptions.length + consoleErrors.length === 0) return false;
      firstErrorAt ??= Date.now();
      return Date.now() - firstErrorAt > ERROR_GRACE_MS;
    };
    const booted = await waitFor(client, (state) => isSettled(state, url, data) || erroredOut(), options.bootTimeoutMs);

    const keys: KeyResult[] = [];
    let keyCount: string | null = null;
    if (booted.met && booted.state !== null && booted.state.bootError.trim() === '' && firstErrorAt === null) {
      for (const step of KEY_STEPS) {
        await pressKey(client, step);
        const after = await waitFor(
          client,
          (state) => state.lastIntent === step.intent && state.focus === step.focus,
          options.keyTimeoutMs,
        );
        keys.push({
          key: step.key,
          expected: step.intent,
          observed: after.state?.lastIntent ?? null,
          expectedFocus: step.focus,
          focus: after.state?.focus ?? null,
        });
        keyCount = after.state?.keyCount ?? null;
      }
      // Late errors (e.g. from a worker reply) land in #boot-error too.
      const final = await readState(client);
      if (final !== null && final.bootError.trim() !== '') booted.state = final;
    }

    return {
      platform,
      url,
      data,
      boot: booted.state,
      settled: booted.met,
      keys,
      keyCount,
      // Engines that report exceptions both ways would list each one twice.
      exceptions: exceptions.length > 0 ? exceptions : consoleErrors,
      durationMs: Date.now() - started,
    };
  } finally {
    client.off('Runtime.exceptionThrown', collect);
    client.off('Console.messageAdded', collectConsole);
  }
}
