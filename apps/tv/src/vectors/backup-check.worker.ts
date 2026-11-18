/**
 * The backup worker's checks in a Blob worker of their own (RELAY step 32b): `@lablo/data`'s
 * `BackupService` with this realm's IndexedDB, scrypt and CSPRNG, from the shared vectors' first
 * backup chain (`checkBackup`, in a database of its own). On the TV the backup's master key is
 * derived and kept in a worker like this one.
 */
import type { CryptoVectors } from '@lablo/crypto/check-vectors';
import { checkBackup } from '@lablo/data/check-backup';
import type { VectorsRun } from './vectors-protocol';
import { where } from './vectors-protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<CryptoVectors>) => void) | null;
  postMessage(message: VectorsRun): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const started = Date.now();
  const vector = event.data.backup[0];
  if (vector === undefined) {
    scope.postMessage({ results: null, ms: 0, error: 'the vectors have no backup chain', where: where() });
    return;
  }
  checkBackup(vector, indexedDB).then(
    (results) => scope.postMessage({ results, ms: Date.now() - started, error: null, where: where() }),
    (error: unknown) => scope.postMessage({ results: null, ms: Date.now() - started, error: String(error), where: where() }),
  );
};
