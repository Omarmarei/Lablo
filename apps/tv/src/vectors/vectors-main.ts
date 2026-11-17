/**
 * The vectors page's entry (`dist/tv-vectors/main.js`, see vectors-protocol.ts). The crypto
 * vectors come from `vectors.js` (`window.LABLO_CRYPTO_VECTORS`), loaded before this script; the
 * protocol samples are in the bundle (vectors-checks.ts). The page runs every check, then the
 * worker does, and the report goes to `window.__LABLO_VECTORS__` and the screen.
 */
import type { CryptoVectors } from '@lablo/crypto/check-vectors';
import type { VectorsReport, VectorsRun } from './vectors-protocol';
import { runChecks } from './vectors-checks';
import { where } from './vectors-protocol';
import VectorsWorker from './vectors.worker?worker';

/** A worker that answers nothing in this long has failed (Chromium 53 runs the lot in seconds). */
const WORKER_TIMEOUT_MS = 90_000;

function inPage(vectors: CryptoVectors): Promise<VectorsRun> {
  const started = Date.now();
  return runChecks(vectors).then(
    (results): VectorsRun => ({ results, ms: Date.now() - started, error: null, where: where() }),
    (error: unknown): VectorsRun => ({ results: null, ms: Date.now() - started, error: String(error), where: where() }),
  );
}

function inWorker(vectors: CryptoVectors): Promise<VectorsRun> {
  const started = Date.now();
  return new Promise((resolve) => {
    let worker: Worker;
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ results: null, ms: Date.now() - started, error: 'the worker did not answer', where: 'worker' });
    }, WORKER_TIMEOUT_MS);
    const done = (run: VectorsRun): void => {
      clearTimeout(timer);
      worker.terminate();
      resolve(run);
    };
    try {
      worker = new VectorsWorker();
    } catch (error) {
      clearTimeout(timer);
      resolve({ results: null, ms: Date.now() - started, error: `the worker did not start: ${String(error)}`, where: 'worker' });
      return;
    }
    worker.onmessage = (event: MessageEvent<VectorsRun>) => done(event.data);
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      done({ results: null, ms: Date.now() - started, error: `the worker failed: ${event.message}`, where: 'worker' });
    };
    worker.postMessage(vectors);
  });
}

function line(label: string, run: VectorsRun): string {
  if (run.results === null) return `${label}: ${run.error ?? 'no results'}`;
  let passed = 0;
  let failures = '';
  for (let i = 0; i < run.results.length; i++) {
    const result = run.results[i]!;
    if (result.ok) passed++;
    else failures += `\n  ${result.name}: ${result.detail}`;
  }
  return `${label}: ${passed}/${run.results.length} passed in ${run.ms} ms${failures}`;
}

function show(text: string): void {
  const out = document.getElementById('out');
  if (out !== null) out.textContent = text;
}

const vectors = window.LABLO_CRYPTO_VECTORS;
if (vectors === undefined) {
  const missing: VectorsRun = { results: null, ms: 0, error: 'vectors.js did not load', where: 'page' };
  window.__LABLO_VECTORS__ = { page: missing, worker: { ...missing, where: 'worker' }, userAgent: navigator.userAgent };
  show(missing.error ?? '');
} else {
  show('running…');
  void inPage(vectors).then((page) =>
    inWorker(vectors).then((worker) => {
      const report: VectorsReport = { page, worker, userAgent: navigator.userAgent };
      window.__LABLO_VECTORS__ = report;
      show(`${line('page', page)}\n${line('worker', worker)}\n${navigator.userAgent}`);
    }),
  );
}
