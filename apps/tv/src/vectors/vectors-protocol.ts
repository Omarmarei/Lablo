/**
 * The crypto vectors page (RELAY step 29b1): `dist/tv-vectors`, built by `pnpm build:tv`
 * through the TV pipeline, runs @lablo/crypto's shared vectors (packages/crypto/test/vectors.json)
 * in the page and in a Blob worker. `pnpm verify:engines` reads the report on Chromium 53, 56
 * and 68 (tools/engines/src/vectors.ts); e2e/crypto-vectors.spec.ts in current Chromium.
 */
import type { CryptoVectors, VectorResult } from '@lablo/crypto/check-vectors';

/** One run of every check: in the page or in the worker. */
export interface VectorsRun {
  readonly results: readonly VectorResult[] | null;
  /** The whole run's time, ms. */
  readonly ms: number;
  /** Why there are no results. */
  readonly error: string | null;
  /** Where it ran, by the realm's own globals: the harness checks the worker run had no document. */
  readonly where: 'page' | 'worker';
}

/** `worker` in a realm without a document (a worker), `page` otherwise. */
export function where(): 'page' | 'worker' {
  return typeof document === 'undefined' ? 'worker' : 'page';
}

/** `window.__LABLO_VECTORS__` once both runs ended. */
export interface VectorsReport {
  readonly page: VectorsRun;
  readonly worker: VectorsRun;
  readonly userAgent: string;
}

declare global {
  interface Window {
    /** The vectors (`dist/tv-vectors/vectors.js`, from packages/crypto/test/vectors.json). */
    LABLO_CRYPTO_VECTORS?: CryptoVectors;
    /** The report, for the old-engine harness and the e2e test. */
    __LABLO_VECTORS__?: VectorsReport;
  }
}
