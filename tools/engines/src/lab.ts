/**
 * The Zoma Lab in the old engines (RELAY step 15a): the lab bundles (dist/tv-lab, from
 * `pnpm build:tv`) run in Chromium 53/56/68 the way a TV would run them, reporting to a real
 * mock provider on the host through `host.docker.internal`. The lab's own checks are the test:
 * S1 (the runtime baseline) must pass on every engine, the polyfills the bundle filled must be
 * exactly the ones each engine lacks, and every record must reach the collector.
 */
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import type { TvPlatform } from './scenario';
import { resetDatabase } from './onboarding';
import { blankPage, waitForProbe, watchErrors } from './scenario';

/** The lab bundles' folder in the container's /app. */
export const LAB_DIR = 'lab';
/** How the container reaches the host (docker run --add-host host.docker.internal:host-gateway). */
export const LAB_HOST = 'host.docker.internal';
/** S2's write test in the harness: enough to prove the path, quick on Chromium 53. */
export const LAB_WRITE_MB = 16;

export interface LabRecord {
  readonly type: 'start' | 'check' | 'end';
  readonly session: string;
  readonly seq: number;
  readonly spike?: string;
  readonly check?: string;
  readonly status?: string;
  readonly note?: string;
  readonly value?: unknown;
}

export interface LabState {
  readonly href: string;
  readonly bootError: string;
  readonly ready: string | null;
  readonly error: string | null;
  readonly session: string | null;
  readonly runs: number;
  readonly phase: string | null;
  readonly sent: { readonly sent: number; readonly pending: number; readonly failures: number; readonly lastError: string | null } | null;
  /** Filled once the first run ended and every record was sent. */
  readonly records: readonly LabRecord[] | null;
  readonly userAgent: string;
}

export interface LabRun {
  readonly platform: TvPlatform;
  readonly url: string;
  readonly state: LabState | null;
  readonly finished: boolean;
  /** The session's lines in the collector, or null when its file is missing. */
  readonly collected: readonly LabRecord[] | null;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
  /**
   * The app's database deleted before the lab ran (`ok`, or why not). On a TV the lab has its
   * own storage; here the app's screens ran on the same file:// origin first and may leave a
   * source behind (CI's Chromium 68 did, 2026-11-04), where S6 would skip.
   */
  readonly reset: string;
}

/** ES5: the probe runs in Chromium 53. */
export const LAB_STATE_EXPRESSION = `(function () {
  var lab = window.__ZOMA_LAB__;
  var box = document.getElementById('boot-error');
  var root = document.querySelector('[data-testid="lab"]');
  var error = document.querySelector('[data-testid="lab-error"]');
  var sent = lab ? lab.sent() : null;
  var runs = lab ? lab.runs() : 0;
  return JSON.stringify({
    href: location.href,
    bootError: box ? box.textContent : '',
    ready: root ? root.getAttribute('data-ready') : null,
    error: error ? error.textContent : null,
    session: lab ? lab.session : null,
    runs: runs,
    phase: lab ? lab.phase() : null,
    sent: sent,
    records: lab && runs > 0 && sent && sent.pending === 0 ? lab.records : null,
    userAgent: navigator.userAgent
  });
})()`;

/** Copies the lab bundles next to the app variants; null when they weren't built. */
export function stageLab(distLab: string, variantsDir: string): string | null {
  if (!existsSync(path.join(distLab, 'webos', 'index.html')) || !existsSync(path.join(distLab, 'tizen', 'index.html'))) return null;
  const target = path.join(variantsDir, LAB_DIR);
  mkdirSync(target, { recursive: true });
  for (const platform of ['tizen', 'webos'] as const) cpSync(path.join(distLab, platform), path.join(target, platform), { recursive: true });
  return target;
}

/**
 * A seeded lab that must fail: the page loses `Worker` before the bundle runs, so S1's worker
 * checks fail (staged as lab-seed-no-worker, run like the lab).
 */
export const LAB_SEED = { id: 'lab-seed-no-worker', script: 'window.Worker = undefined;' } as const;

export function stageLabSeed(labDir: string, variantsDir: string): string {
  const target = path.join(variantsDir, LAB_SEED.id);
  for (const platform of ['tizen', 'webos'] as const) {
    cpSync(path.join(labDir, platform), path.join(target, platform), { recursive: true });
    const index = path.join(target, platform, 'index.html');
    const html = readFileSync(index, 'utf8');
    const marker = '<script src="main.js"></script>';
    if (!html.includes(marker)) throw new Error(`${index} has no main.js script to seed before`);
    writeFileSync(index, html.replace(marker, `<script>${LAB_SEED.script}</script>\n${marker}`));
  }
  return target;
}

export function labUrl(dir: string, platform: TvPlatform, port: number): string {
  return `file:///app/${dir}/${platform}/index.html?server=http://${LAB_HOST}:${port}&mb=${LAB_WRITE_MB}&auto=1`;
}

export interface LabServer {
  readonly port: number;
  readonly logDir: string;
  stop(): void;
}

/**
 * The mock provider in its own process (tools/ may not import apps/), on a free port. Docker
 * Desktop forwards host.docker.internal to the host's loopback; on Linux (CI) it is the bridge's
 * gateway, so the mock listens on every interface there.
 */
export function startLabServer(root: string, logDir: string, timeoutMs = 30_000): Promise<LabServer> {
  const host = process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1';
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(root, 'apps/mock-provider/src/main.ts'), '--port', '0', '--host', host, '--lab-log-dir', logDir, '--no-media', '--quiet'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the lab's mock provider did not start within ${timeoutMs} ms:\n${output}`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      const port = /http:\/\/[\d.]+:(\d+)\//.exec(output)?.[1];
      if (port === undefined) return;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      resolve({ port: Number(port), logDir, stop: () => void child.kill() });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the lab's mock provider exited (${code ?? 'signal'}):\n${output}`));
    });
  });
}

export function readCollected(logDir: string, session: string): LabRecord[] | null {
  const file = path.join(logDir, `${session}.ndjson`);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LabRecord);
}

export async function runLab(client: CdpClient, platform: TvPlatform, url: string, logDir: string, timeoutMs: number): Promise<LabRun> {
  const started = Date.now();
  const reset = await resetDatabase(client);
  await blankPage(client);
  const watch = watchErrors(client);
  const erroredOut = labErrorGate(() => watch.errors());
  try {
    await client.send('Page.navigate', { url });
    const done = await waitForProbe<LabState>(
      client,
      LAB_STATE_EXPRESSION,
      (state) => state.records !== null || state.ready === 'error' || state.bootError.trim() !== '' || erroredOut(),
      timeoutMs,
    );
    const session = done.state?.session ?? null;
    return {
      platform,
      url,
      state: done.state,
      finished: done.met && done.state?.records !== null,
      collected: session === null ? null : readCollected(logDir, session),
      exceptions: watch.errors(),
      durationMs: Date.now() - started,
      reset,
    };
  } finally {
    watch.stop();
  }
}

/** The first Chromium that has each built-in natively (the native probe's names). */
export const NATIVE_SINCE: Readonly<Record<string, number>> = {
  'String.prototype.padStart': 57,
  'Object.entries': 54,
  'Object.values': 54,
  'Object.fromEntries': 73,
  'Promise.prototype.finally': 63,
  'Array.prototype.flat': 69,
  'Array.prototype.includes': 47,
  globalThis: 71,
  queueMicrotask: 71,
};

/**
 * What each check must answer in a desktop engine running a TV bundle: S7's no-CORS checks fail
 * (it enforces CORS), and S3 finds no device ID (no TV APIs).
 */
export const EXPECTED_STATUSES: ReadonlyArray<readonly [string, string]> = [
  ['S0/device', 'info'],
  ['S1/boot', 'pass'],
  ['S1/polyfills', 'pass'],
  ['S1/apis', 'info'],
  ['S1/preact', 'pass'],
  ['S1/blob-worker', 'pass'],
  ['S1/text-decoder', 'pass'],
  ['S1/fetch-stream', 'pass'],
  ['S1/fetch-stream-worker', 'pass'],
  ['S1/idb', 'pass'],
  ['S1/idb-bulk-worker', 'pass'],
  // A marker from the other platform's run (the same file:// origin) is "info" too.
  ['S2/local-storage', 'info'],
  ['S2/indexeddb', 'info'],
  ['S2/quota', 'info'],
  ['S2/write-test', 'pass'],
  // A TV platform with no TV APIs: the adapter finds no ID.
  ['S3/device-id', 'fail'],
  ['S3/stable', 'skip'],
  ['S7/xhr-cors', 'pass'],
  ['S7/xhr-no-cors', 'fail'],
  ['S7/fetch-no-cors', 'fail'],
  ['S7/xhr-redirect', 'pass'],
  ['S7/fetch-redirect', 'pass'],
  ['S7/xhr-redirect-no-cors', 'fail'],
  // The host mock's own small catalog: S6 measures and judges nothing.
  ['S6/source', 'info'],
  ['S6/ingest', 'info'],
  ['S6/search', 'info'],
  ['S6/keys', 'info'],
  ['S6/guide', 'info'],
  ['S6/cold-start', 'info'],
  ['S6/cleanup', 'info'],
];

const keyOf = (record: LabRecord): string => `${record.spike ?? ''}/${record.check ?? ''}`;

/**
 * The console errors S7's no-CORS checks cause on purpose (Chromium 53 reports them like
 * uncaught errors): a refusal of a `cors=0` probe. Any other error still fails the run.
 */
export function isExpectedRefusal(error: string): boolean {
  return /No 'Access-Control-Allow-Origin' header/.test(error) && /\/__lab\/(echo|redirect)\?[^ ]*cors=0/.test(error);
}

/** How long an unexpected error may stand before the wait for the run gives up (scenario.ts's grace). */
export const LAB_ERROR_GRACE_MS = 2_000;

/**
 * The lab run's "errored out": like `watchErrors().erroredOut()`, but S7's own refusals don't
 * count. They come mid-run since S6 runs after S7, and the run goes on for minutes after them.
 */
export function labErrorGate(errors: () => readonly string[], now: () => number = Date.now, graceMs = LAB_ERROR_GRACE_MS): () => boolean {
  let firstAt: number | null = null;
  return () => {
    if (!errors().some((error) => !isExpectedRefusal(error))) return false;
    firstAt ??= now();
    return now() - firstAt > graceMs;
  };
}

export function evaluateLab(run: LabRun, engine: Pick<Engine, 'major'>): string[] {
  const failures: string[] = [];
  const { state } = run;
  if (run.reset !== 'ok') failures.push(`the app's database was not deleted before the lab: ${run.reset}`);
  if (state === null) return [...failures, 'the lab page never answered the probe'];
  if (state.bootError.trim() !== '') failures.push(`boot error: ${state.bootError.trim()}`);
  if (state.ready === 'error') failures.push(`the lab could not start: ${state.error ?? ''}`);
  for (const exception of run.exceptions) if (!isExpectedRefusal(exception)) failures.push(`uncaught: ${exception}`);
  if (!run.finished || state.records === null) {
    failures.push(`no finished run with every record sent (runs ${state.runs}, phase ${state.phase ?? '-'}, sent ${JSON.stringify(state.sent)})`);
    return failures;
  }
  const records = state.records;
  const checks = records.filter((r) => r.type === 'check');
  const expected = EXPECTED_STATUSES;
  if (checks.length !== expected.length) failures.push(`${checks.length} check records, expected ${expected.length}`);
  for (const [key, status] of expected) {
    const record = checks.find((r) => keyOf(r) === key);
    if (record === undefined) failures.push(`${key}: no record`);
    else if (record.status !== status) failures.push(`${key}: ${record.status ?? '-'}, expected ${status}${record.note === undefined ? '' : ` (${record.note})`}`);
  }
  // The bundle filled exactly what this engine lacks.
  const polyfills = checks.find((r) => keyOf(r) === 'S1/polyfills')?.value as { polyfilled?: unknown; broken?: unknown } | undefined;
  const lacking = Object.keys(NATIVE_SINCE)
    .filter((name) => (NATIVE_SINCE[name] ?? 0) > engine.major)
    .sort();
  const filled = Array.isArray(polyfills?.polyfilled) ? [...(polyfills.polyfilled as string[])].sort() : null;
  if (filled === null) failures.push('S1/polyfills: no native-probe record (the probe did not run before the bundle)');
  else if (filled.join(',') !== lacking.join(',')) failures.push(`S1/polyfills: filled ${filled.join(', ') || 'nothing'}, expected ${lacking.join(', ') || 'nothing'}`);
  if (records[0]?.type !== 'start') failures.push('the first record is not the start record');
  if (records[records.length - 1]?.type !== 'end') failures.push('the last record is not the end record');
  // Every record reached the collector, in order.
  if (run.collected === null) failures.push('the collector has no file for this session');
  else {
    const got = run.collected.map((r) => `${r.seq}:${r.type}:${keyOf(r)}:${r.status ?? ''}`).join(' ');
    const want = records.map((r) => `${r.seq}:${r.type}:${keyOf(r)}:${r.status ?? ''}`).join(' ');
    if (got !== want) failures.push(`the collector has ${run.collected.length} records, the page ${records.length}, or they differ`);
  }
  return failures;
}

export function labSummary(run: LabRun): string {
  const records = run.state?.records;
  if (records === null || records === undefined) return '';
  const counts: Record<string, number> = {};
  for (const r of records) if (r.type === 'check' && r.status !== undefined) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const bulk = records.find((r) => r.check === 'idb-bulk-worker')?.value as { writeMs?: number } | undefined;
  const write = records.find((r) => r.check === 'write-test')?.value as { mbPerSecond?: number | null } | undefined;
  return `  [${Object.keys(counts)
    .sort()
    .map((k) => `${k} ${counts[k] ?? 0}`)
    .join(', ')}; 10k items ${bulk?.writeMs ?? '?'} ms; IDB ${write?.mbPerSecond ?? '?'} MB/s; ${records.length} records collected]`;
}
