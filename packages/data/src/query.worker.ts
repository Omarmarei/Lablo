/**
 * The query worker (architecture.md §1.2): started once by the app (`import QueryWorker from
 * '@zoma/data/query.worker?worker'` in apps/tv/src/data/workers.ts; the TV build inlines it as a
 * Blob worker) and kept running. It serves `QueryService` over RPC; the UI talks to it through
 * `createDataClient` (from `@zoma/data/client`).
 */

import { fetchTransport } from './bytes';
import { openDatabase } from './idb';
import { QueryService } from './query-service';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';

// The transport is for the short-EPG fallback only (step 9c): the catalog reads never fetch.
const service = new QueryService({ openDb: () => openDatabase(indexedDB), transport: fetchTransport() });
serveRpc(self as unknown as RpcPort, service.handlers());
