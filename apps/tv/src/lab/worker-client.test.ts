import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerLike } from './worker-client';
import { createLabWorkerClient } from './worker-client';
import type { LabWorkerReply, LabWorkerRequest } from './worker-protocol';

/** A worker that answers each request with `answer(request)`, or never when it returns null. */
function fakeWorker(answer: (request: LabWorkerRequest) => LabWorkerReply | null) {
  const posted: LabWorkerRequest[] = [];
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(request) {
      posted.push(request);
      const reply = answer(request);
      if (reply !== null) setTimeout(() => worker.onmessage?.({ data: reply } as MessageEvent<LabWorkerReply>), 0);
    },
  };
  return { worker, posted };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the lab worker client', () => {
  it('starts the worker once, on first use, and times its first answer', async () => {
    const { worker, posted } = fakeWorker((r) => ({ id: r.id, ok: true, value: { TextDecoder: true } }));
    const create = vi.fn(() => worker);
    let now = 1000;
    const client = createLabWorkerClient(create, () => (now += 7));
    expect(create).not.toHaveBeenCalled();
    expect(await client.start()).toEqual({ startMs: 7, features: { TextDecoder: true } });
    await client.start();
    expect(create).toHaveBeenCalledTimes(1);
    expect(posted.map((r) => [r.id, r.op])).toEqual([
      [1, 'features'],
      [2, 'features'],
    ]);
  });

  it('matches answers to requests by id, and passes errors on', async () => {
    const { worker, posted } = fakeWorker((r) =>
      r.op === 'idb-bulk' ? { id: r.id, ok: false, error: 'QuotaExceededError: full' } : { id: r.id, ok: true, value: { lines: 3 } },
    );
    const client = createLabWorkerClient(() => worker);
    const [stream, bulk] = await Promise.allSettled([client.fetchStream('http://h/__lab/bytes'), client.idbBulk(10, 5)]);
    expect(stream).toEqual({ status: 'fulfilled', value: { lines: 3 } });
    expect(bulk).toMatchObject({ status: 'rejected', reason: new Error('QuotaExceededError: full') });
    expect(posted).toEqual([
      { op: 'fetch-stream', url: 'http://h/__lab/bytes', id: 1 },
      { op: 'idb-bulk', items: 10, chunk: 5, id: 2 },
    ]);
  });

  it('gives up on a request after its timeout', async () => {
    vi.useFakeTimers();
    const { worker } = fakeWorker(() => null);
    const client = createLabWorkerClient(() => worker);
    const pending = client.fetchStream('http://h/x', 2000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2000);
    expect(((await pending) as Error).message).toBe('the worker did not answer fetch-stream within 2000 ms');
  });

  it('fails every waiting request when the worker errors, and a worker that cannot start', async () => {
    const { worker } = fakeWorker(() => null);
    const client = createLabWorkerClient(() => worker);
    const pending = client.start().catch((e: unknown) => e);
    worker.onerror?.({ message: 'SyntaxError in the worker' } as ErrorEvent);
    expect(((await pending) as Error).message).toBe('worker error: SyntaxError in the worker');
    const broken = createLabWorkerClient(() => {
      throw new Error('Worker is not a constructor');
    });
    await expect(broken.start()).rejects.toThrow('Worker is not a constructor');
  });
});
