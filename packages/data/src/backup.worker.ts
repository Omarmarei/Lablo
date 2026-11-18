/**
 * The backup worker (architecture.md §3.3 B, RELAY step 32b): started by the app for one call and
 * terminated when it answers (`DataEngine.prepareBackup`, through
 * `import BackupWorker from '@lablo/data/backup.worker?worker'` in apps/tv/src/data/workers.ts; the
 * TV build inlines it as a Blob worker). It holds scrypt, the backup code and the master key, which
 * the main bundle can't take, and sends and restores the profile through the backup API (step
 * 32c1). It serves `backupHandlers` over RPC; the app talks to it through `createBackupClient`.
 */

import { backupHandlers } from './backup-service';
import { fetchTransport } from './bytes';
import { openDatabase } from './idb';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';

serveRpc(self as unknown as RpcPort, backupHandlers({ openDb: () => openDatabase(indexedDB), transport: fetchTransport() }));
