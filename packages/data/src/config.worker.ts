/**
 * The config worker (architecture.md §3.3 C, RELAY step 30b2): started by the app for one config
 * refresh and terminated when it answers (`import ConfigWorker from '@lablo/data/config.worker?worker'`
 * in apps/tv/src/data/workers.ts; the TV build inlines it as a Blob worker). It holds the schemas
 * and the signature check, which the main bundle can't take (leg 83 measured +89.6 KB). It serves
 * `configHandlers` over RPC; the app talks to it through `createConfigClient`.
 */

import { fetchTransport } from './bytes';
import { configHandlers } from './config-service';
import { openDatabase } from './idb';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';

serveRpc(self as unknown as RpcPort, configHandlers({ openDb: () => openDatabase(indexedDB), transport: fetchTransport() }));
