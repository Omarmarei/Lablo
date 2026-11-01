/**
 * A trivial worker that proves the worker path end to end: built as its own Chromium 53
 * IIFE, inlined into the main bundle and started from a Blob URL on the TV.
 */
import type { HelloPing, HelloPong } from './hello-protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<HelloPing>) => void) | null;
  postMessage(message: HelloPong): void;
}

const scope = self as unknown as WorkerScope;

const FEATURES: Record<string, boolean> = {
  TextDecoder: typeof TextDecoder === 'function',
  indexedDB: typeof indexedDB === 'object' && indexedDB !== null,
  fetch: typeof fetch === 'function',
};

scope.onmessage = (event) => {
  scope.postMessage({
    type: 'pong',
    nonce: event.data.nonce,
    // Object.entries is missing in Chromium 53: this line also proves core-js reaches workers.
    features: Object.entries(FEATURES)
      .filter(([, present]) => present)
      .map(([name]) => name),
  });
};
