/**
 * The lab worker (RELAY step 15a): S1's checks where the data engine really runs, inside a
 * worker that the TV build inlines as a Blob URL. It answers one request at a time.
 */
import { idbBulkWrite } from './idb-bulk';
import { readLabStream } from './probes';
import type { LabWorkerReply, LabWorkerRequest, WorkerFeatures } from './worker-protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<LabWorkerRequest>) => void) | null;
  postMessage(message: LabWorkerReply): void;
  indexedDB?: IDBFactory;
  fetch?: typeof fetch;
}

const scope = self as unknown as WorkerScope;

function features(): WorkerFeatures {
  const g = self as unknown as Record<string, unknown>;
  const responseBody = typeof Response === 'function' && 'body' in Response.prototype;
  return {
    TextDecoder: typeof g.TextDecoder === 'function',
    TextEncoder: typeof g.TextEncoder === 'function',
    fetch: typeof g.fetch === 'function',
    'Response.body': responseBody,
    ReadableStream: typeof g.ReadableStream === 'function',
    indexedDB: typeof g.indexedDB === 'object' && g.indexedDB !== null,
    'IDBObjectStore.getAll': typeof IDBObjectStore === 'function' && typeof IDBObjectStore.prototype.getAll === 'function',
    DecompressionStream: typeof g.DecompressionStream === 'function',
    AbortController: typeof g.AbortController === 'function',
    XMLHttpRequest: typeof g.XMLHttpRequest === 'function',
  };
}

function handle(request: LabWorkerRequest): Promise<unknown> {
  switch (request.op) {
    case 'features':
      return Promise.resolve(features());
    case 'fetch-stream': {
      const fetchFn = scope.fetch;
      if (fetchFn === undefined) return Promise.reject(new Error('no fetch in the worker'));
      return readLabStream((url) => fetchFn.call(self, url), request.url);
    }
    case 'idb-bulk': {
      const factory = scope.indexedDB;
      if (factory === undefined || factory === null) return Promise.reject(new Error('no indexedDB in the worker'));
      return idbBulkWrite(factory, request.items, request.chunk);
    }
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  handle(request).then(
    (value) => scope.postMessage({ id: request.id, ok: true, value }),
    (error: unknown) => scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  );
};
