/**
 * The crypto vectors in a Blob worker: on the TV the backup's scrypt runs in one (architecture.md
 * §3.3 B), so the worker's realm must give the same answers as the page's.
 */
import type { CryptoVectors } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
import type { VectorsRun } from './vectors-protocol';
import { where } from './vectors-protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<CryptoVectors>) => void) | null;
  postMessage(message: VectorsRun): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const started = Date.now();
  checkVectors(event.data).then(
    (results) => scope.postMessage({ results, ms: Date.now() - started, error: null, where: where() }),
    (error: unknown) => scope.postMessage({ results: null, ms: Date.now() - started, error: String(error), where: where() }),
  );
};
