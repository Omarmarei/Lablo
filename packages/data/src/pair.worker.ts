/**
 * The pair worker (architecture.md §3.3 A, RELAY step 31c1): started by the app when the pairing
 * screen opens and terminated when it closes (`DataEngine.pairing`, through
 * `import PairWorker from '@lablo/data/pair.worker?worker'` in apps/tv/src/data/workers.ts; the TV
 * build inlines it as a Blob worker). It holds the TV's secret key, the network calls, the box
 * and the schemas, which the main bundle can't take. It serves `pairHandlers` over RPC; the app
 * talks to it through `createPairClient`.
 */

import { fetchTransport } from './bytes';
import { pairHandlers } from './pair-service';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';

serveRpc(self as unknown as RpcPort, pairHandlers({ transport: fetchTransport() }));
