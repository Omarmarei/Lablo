import type { SourceDraft } from './form';

/**
 * Loading a new source, as onboarding shows it (RELAY step 13a). Step 13b implements it with the
 * data engine against the provider; until then `createFakeLoader` stands in, so the screens and
 * their e2e run without a provider.
 */

export type LoadPhase = 'checking' | 'download' | 'saving';

export interface LoadProgress {
  readonly phase: LoadPhase;
  /** Bytes received so far. */
  readonly bytes: number;
  /** The size being read, when the server sent one. */
  readonly total: number | null;
  /** Items parsed so far. */
  readonly items: number;
}

/** Why a source couldn't be added. Each has its own message (`error.<code>`). */
export type LoadErrorCode = 'auth' | 'expired' | 'network' | 'http' | 'format' | 'empty' | 'other';

export class LoadError extends Error {
  constructor(
    readonly code: LoadErrorCode,
    /** The HTTP status for `http`. */
    readonly status: number | null = null,
  ) {
    super(`Loading the source failed: ${code}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'LoadError';
  }
}

export interface LoadResult {
  readonly live: number;
  readonly movies: number;
  readonly series: number;
}

export interface LoadHandle {
  /** Resolves with the counts, or rejects with a `LoadError`. Never settles once cancelled. */
  readonly done: Promise<LoadResult>;
  cancel(): void;
}

export interface SourceLoader {
  start(draft: SourceDraft, onProgress: (progress: LoadProgress) => void): LoadHandle;
}

export interface FakeLoaderOptions {
  /** The fake's result (default 1,240 channels, 380 films and 45 series). */
  readonly result?: LoadResult;
  /** Fails the load with this error after the check. */
  readonly fail?: LoadError;
  /** Milliseconds per step (default 150; 6 steps in all). */
  readonly stepMs?: number;
  readonly setTimeout?: (run: () => void, ms: number) => unknown;
}

const FAKE_RESULT: LoadResult = { live: 1240, movies: 380, series: 45 };
const FAKE_BYTES = 2_000_000;

/**
 * A loader with no network: a check, four download steps and a save, then the result. It never
 * reads the draft's address or login (step 13b's loader does).
 */
export function createFakeLoader(options: FakeLoaderOptions = {}): SourceLoader {
  const result = options.result ?? FAKE_RESULT;
  const stepMs = options.stepMs ?? 150;
  const later = options.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  return {
    start(_draft: SourceDraft, onProgress: (progress: LoadProgress) => void): LoadHandle {
      let cancelled = false;
      const items = result.live + result.movies + result.series;
      const done = new Promise<LoadResult>((resolve, reject) => {
        const steps: Array<() => void> = [() => onProgress({ phase: 'checking', bytes: 0, total: null, items: 0 })];
        if (options.fail !== undefined) {
          const error = options.fail;
          steps.push(() => reject(error));
        } else {
          for (let i = 1; i <= 4; i++) {
            steps.push(() => onProgress({ phase: 'download', bytes: (FAKE_BYTES * i) / 4, total: FAKE_BYTES, items: Math.round((items * i) / 4) }));
          }
          steps.push(() => onProgress({ phase: 'saving', bytes: FAKE_BYTES, total: FAKE_BYTES, items }));
          steps.push(() => resolve(result));
        }
        const run = (i: number): void => {
          if (cancelled) return;
          steps[i]?.();
          if (i + 1 < steps.length) later(() => run(i + 1), stepMs);
        };
        run(0);
      });
      return {
        done,
        cancel: () => {
          cancelled = true;
        },
      };
    },
  };
}
