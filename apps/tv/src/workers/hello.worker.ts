/**
 * A trivial worker that proves the worker path end to end: built as its own Chromium 53
 * IIFE, inlined into the main bundle and started from a Blob URL on the TV. It also writes and
 * reads one IndexedDB record, the way the data engine will store the catalog.
 */
import type { HelloPing, HelloPong } from './hello-protocol';
import { idbRoundTrip } from './idb-check';

interface WorkerScope {
  onmessage: ((event: MessageEvent<HelloPing>) => void) | null;
  postMessage(message: HelloPong): void;
  indexedDB?: IDBFactory;
}

const scope = self as unknown as WorkerScope;

const FEATURES: Record<string, boolean> = {
  TextDecoder: typeof TextDecoder === 'function',
  indexedDB: typeof indexedDB === 'object' && indexedDB !== null,
  fetch: typeof fetch === 'function',
};

scope.onmessage = (event) => {
  const nonce = event.data.nonce;
  void idbRoundTrip(scope.indexedDB, nonce).then((idb) => {
    scope.postMessage({
      type: 'pong',
      nonce,
      // Object.entries is missing in Chromium 53: this line also proves core-js reaches workers.
      features: Object.entries(FEATURES)
        .filter(([, present]) => present)
        .map(([name]) => name),
      idb,
    });
  });
};
