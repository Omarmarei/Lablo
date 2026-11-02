/**
 * The query worker (architecture.md §1.2): started once by the app (`import QueryWorker from
 * '@zoma/data/…?worker'` lands with the app wiring in step 8b; the TV build inlines it as a Blob
 * worker) and kept running. It serves `QueryService` over RPC; the UI talks to it through
 * `createDataClient`.
 */

import { openDatabase } from './idb';
import { QueryService } from './query-service';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';

const service = new QueryService({ openDb: () => openDatabase(indexedDB) });
serveRpc(self as unknown as RpcPort, service.handlers());
