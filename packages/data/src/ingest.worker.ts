/**
 * The ingest worker (architecture.md §1.4 step 2): started by the app for one refresh and
 * terminated when it is done (`import IngestWorker from '@zoma/data/ingest.worker?worker'` in
 * apps/tv/src/data/workers.ts; the TV build inlines it as a Blob worker). It serves
 * `IngestService` over RPC; the UI talks to it through `createIngestClient`.
 */

import { fetchTransport } from './bytes';
import { openDatabase } from './idb';
import { IngestService } from './ingest-service';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';

const service = new IngestService({ openDb: () => openDatabase(indexedDB), transport: fetchTransport() });
serveRpc(self as unknown as RpcPort, service.handlers());
