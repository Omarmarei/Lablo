/**
 * The EPG worker (architecture.md §1.5, RELAY step 9b): started by the app for one EPG refresh
 * and terminated when it is done (`import EpgWorker from '@lablo/data/epg.worker?worker'` in
 * apps/tv/src/data/workers.ts; the TV build inlines it as a Blob worker). It serves `EpgService`
 * over RPC; the UI talks to it through `createEpgClient`.
 */

import { fetchTransport } from './bytes';
import { EpgService } from './epg-service';
import { openDatabase } from './idb';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';

const service = new EpgService({ openDb: () => openDatabase(indexedDB), transport: fetchTransport() });
serveRpc(self as unknown as RpcPort, service.handlers());
