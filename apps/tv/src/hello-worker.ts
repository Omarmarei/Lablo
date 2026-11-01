import type { HelloPing, HelloPong } from './workers/hello-protocol';
import HelloWorker from './workers/hello.worker?worker';

export interface WorkerReport {
  readonly roundTripMs: number;
  readonly features: readonly string[];
}

/** Starts the hello worker, sends one ping and resolves with its answer. */
export function pingHelloWorker(timeoutMs = 5000): Promise<WorkerReport> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const nonce = Math.floor(Math.random() * 1e9);
    let worker: Worker;
    try {
      worker = new HelloWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`no reply within ${timeoutMs} ms`));
    }, timeoutMs);
    const finish = (): void => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<HelloPong>) => {
      finish();
      if (event.data.type !== 'pong' || event.data.nonce !== nonce) {
        reject(new Error('unexpected worker reply'));
        return;
      }
      resolve({ roundTripMs: Date.now() - started, features: event.data.features });
    };
    worker.onerror = (event: ErrorEvent) => {
      finish();
      reject(new Error(event.message || 'worker error'));
    };
    const ping: HelloPing = { type: 'ping', nonce };
    worker.postMessage(ping);
  });
}
