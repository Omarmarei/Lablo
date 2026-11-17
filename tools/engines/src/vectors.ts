/**
 * The crypto vectors page in the old engines (RELAY step 29b1): `dist/tv-vectors` (built by
 * `pnpm build:tv` through the TV pipeline) runs @lablo/crypto's shared vectors in the page and
 * in a Blob worker. Each engine must give every check the answer Node gives, under the same
 * names, so the TV's crypto path (tweetnacl and @noble/hashes through Babel and core-js) is
 * held to OpenSSL's answers on Chromium 53, 56 and 68. The self-test runs a page with one
 * vector changed, which must fail.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import { blankPage, waitForProbe, watchErrors } from './scenario';

/** The vectors page's folder in the container's /app. */
export const VECTORS_DIR = 'vectors';

/** One check's result, as `checkVectors` gives it (packages/crypto/src/check-vectors.ts). */
export interface VectorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

/** One run of every check, in the page or in the worker (apps/tv/src/vectors/vectors-protocol.ts). */
export interface VectorsRunState {
  readonly results: readonly VectorCheck[] | null;
  readonly ms: number;
  readonly error: string | null;
  /** `worker` when the run's realm had no document. */
  readonly where: string;
}

export interface VectorsState {
  readonly href: string;
  readonly report: { readonly page: VectorsRunState; readonly worker: VectorsRunState; readonly userAgent: string } | null;
  readonly userAgent: string;
}

export interface VectorsRun {
  readonly url: string;
  readonly state: VectorsState | null;
  readonly finished: boolean;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
}

/** ES5: the probe runs in Chromium 53. */
export const VECTORS_STATE_EXPRESSION = `(function () {
  return JSON.stringify({
    href: location.href,
    report: window.__LABLO_VECTORS__ || null,
    userAgent: navigator.userAgent
  });
})()`;

/** Copies the vectors page next to the app variants; null when it wasn't built. */
export function stageVectors(distVectors: string, variantsDir: string): string | null {
  for (const file of ['index.html', 'main.js', 'vectors.js']) if (!existsSync(path.join(distVectors, file))) return null;
  const target = path.join(variantsDir, VECTORS_DIR);
  mkdirSync(target, { recursive: true });
  cpSync(distVectors, target, { recursive: true });
  return target;
}

/** A seeded page that must fail: one expected SHA-256 changed before the checks run. */
export const VECTORS_SEED = {
  id: 'vectors-seed-changed',
  script: "window.LABLO_CRYPTO_VECTORS.sha256[1].digest = '0'.repeat(64);",
  failing: 'sha256[1]',
} as const;

export function stageVectorsSeed(vectorsDir: string, variantsDir: string): string {
  const target = path.join(variantsDir, VECTORS_SEED.id);
  cpSync(vectorsDir, target, { recursive: true });
  const index = path.join(target, 'index.html');
  const html = readFileSync(index, 'utf8');
  const marker = '<script src="main.js"></script>';
  if (!html.includes(marker)) throw new Error(`${index} has no main.js script to seed before`);
  writeFileSync(index, html.replace(marker, `<script>${VECTORS_SEED.script}</script>\n${marker}`));
  return target;
}

export function vectorsUrl(dir: string): string {
  return `file:///app/${dir}/index.html`;
}

export async function runVectors(client: CdpClient, url: string, timeoutMs: number): Promise<VectorsRun> {
  const started = Date.now();
  await blankPage(client);
  const watch = watchErrors(client);
  try {
    await client.send('Page.navigate', { url });
    const done = await waitForProbe<VectorsState>(client, VECTORS_STATE_EXPRESSION, (state) => state.report !== null || watch.erroredOut(), timeoutMs);
    return { url, state: done.state, finished: done.met && done.state?.report !== null, exceptions: watch.errors(), durationMs: Date.now() - started };
  } finally {
    watch.stop();
  }
}

function evaluateRunState(label: 'page' | 'worker', run: VectorsRunState, expected: readonly string[]): string[] {
  const failures: string[] = [];
  if (run.where !== label) failures.push(`${label}: ran in the ${run.where}`);
  if (run.results === null) return [...failures, `${label}: no results (${run.error ?? 'no error given'})`];
  for (const result of run.results) if (!result.ok) failures.push(`${label}: ${result.name}: ${result.detail}`);
  const names = run.results.map((r) => r.name).join(' ');
  if (names !== expected.join(' ')) failures.push(`${label}: ${run.results.length} checks, expected Node's ${expected.length} under the same names (a stale dist/tv-vectors? run pnpm build:tv)`);
  return failures;
}

/** Every check passed in the page and in the worker, under exactly the names Node's run has. */
export function evaluateVectors(run: VectorsRun, engine: Pick<Engine, 'major'>, expected: readonly string[]): string[] {
  const failures: string[] = [];
  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  const report = run.state?.report ?? null;
  if (!run.finished || report === null) return [...failures, `no report from the vectors page (${run.state === null ? 'it never answered the probe' : 'still running'})`];
  const major = /Chrome\/(\d+)/.exec(report.userAgent)?.[1];
  if (major !== String(engine.major)) failures.push(`user agent ${report.userAgent}: expected Chrome ${engine.major}`);
  failures.push(...evaluateRunState('page', report.page, expected), ...evaluateRunState('worker', report.worker, expected));
  return failures;
}

const passed = (run: VectorsRunState): string => (run.results === null ? 'none' : `${run.results.filter((r) => r.ok).length}/${run.results.length}`);
const checkMs = (run: VectorsRunState, name: string): string => {
  const ms = run.results?.find((r) => r.name === name)?.ms;
  return ms === undefined ? '?' : `${(ms / 1000).toFixed(1)} s`;
};

/** `  page 86/86 in 3.2 s, worker 86/86 in 3.0 s; the backup's scrypt 1.1 s / 1.0 s` for the log. */
export function vectorsSummary(run: VectorsRun): string {
  const report = run.state?.report;
  if (report === null || report === undefined) return '';
  return `  page ${passed(report.page)} in ${(report.page.ms / 1000).toFixed(1)} s, worker ${passed(report.worker)} in ${(report.worker.ms / 1000).toFixed(1)} s; the backup's scrypt ${checkMs(report.page, 'backup[0].master')} / ${checkMs(report.worker, 'backup[0].master')}`;
}
