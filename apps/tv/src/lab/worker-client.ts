/**
 * The page's side of the lab worker: started on first use (S1's Blob-worker check times that),
 * one request at a time by id, each with a timeout.
 */
import type { BulkReport, LabWorkerReply, LabWorkerRequest, StreamReport, WorkerFeatures } from './worker-protocol';

type Request = LabWorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export interface LabWorkerClient {
  /** Starts the worker (once) and times its first answer. */
  start(): Promise<{ readonly startMs: number; readonly features: WorkerFeatures }>;
  fetchStream(url: string, timeoutMs?: number): Promise<StreamReport>;
  idbBulk(items: number, chunk: number, timeoutMs?: number): Promise<BulkReport>;
}

export interface WorkerLike {
  onmessage: ((event: MessageEvent<LabWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: LabWorkerRequest): void;
}

export function createLabWorkerClient(create: () => WorkerLike, clock: () => number = () => Date.now()): LabWorkerClient {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  const failAll = (message: string): void => {
    waiting.forEach((entry) => entry.reject(new Error(message)));
    waiting.clear();
  };

  const ensure = (): WorkerLike => {
    if (worker !== null) return worker;
    const started = create();
    started.onmessage = (event) => {
      const reply = event.data;
      const entry = waiting.get(reply.id);
      if (entry === undefined) return;
      waiting.delete(reply.id);
      if (reply.ok) entry.resolve(reply.value);
      else entry.reject(new Error(reply.error));
    };
    started.onerror = (event) => failAll(`worker error: ${event.message || 'unknown'}`);
    worker = started;
    return started;
  };

  const call = <T>(request: Request, timeoutMs: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let target: WorkerLike;
      try {
        target = ensure();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`the worker did not answer ${request.op} within ${timeoutMs} ms`));
      }, timeoutMs);
      waiting.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      target.postMessage({ ...request, id } as LabWorkerRequest);
    });

  return {
    start() {
      const started = clock();
      return call<WorkerFeatures>({ op: 'features' }, 10_000).then((features) => ({ startMs: clock() - started, features }));
    },
    fetchStream: (url, timeoutMs = 30_000) => call<StreamReport>({ op: 'fetch-stream', url }, timeoutMs),
    idbBulk: (items, chunk, timeoutMs = 60_000) => call<BulkReport>({ op: 'idb-bulk', items, chunk }, timeoutMs),
  };
}
