/**
 * The telemetry worker (architecture.md §3.4, RELAY step 33b1): started by the app for each send
 * and terminated when it answers (`DataEngine.sendTelemetry`, through
 * `import TelemetryWorker from '@lablo/data/telemetry.worker?worker'` in
 * apps/tv/src/data/workers.ts; the TV build inlines it as a Blob worker). It keeps the install ID
 * and the queue in `kv`, and posts the queue to the telemetry API. It serves `telemetryHandlers`
 * over RPC; the app talks to it through `createTelemetryClient`.
 */

import { fetchTransport } from './bytes';
import { openDatabase } from './idb';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';
import { telemetryHandlers } from './telemetry-service';

serveRpc(self as unknown as RpcPort, telemetryHandlers({ openDb: () => openDatabase(indexedDB), transport: fetchTransport() }));
