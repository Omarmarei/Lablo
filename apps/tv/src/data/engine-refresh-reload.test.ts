import type { RpcHandlers, RpcPort } from '@lablo/data';
import { serveRpc } from '@lablo/data';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkerLike } from './engine';
import { DataEngine } from './engine';

/**
 * `DataEngine.refresh` and the query worker (RELAY step 59): the worker keeps the sources' metas
 * from its last load. A catalog that swaps in reloads it (the ingest worker's `swapped`); an
 * unchanged one has still stored its check time and its account's facts (formats, zone), so the
 * worker reads them again before the refresh resolves. Before, `sourceFacts` kept the old formats
 * and the schedule the old check time.
 */

const ports: MessagePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** A worker that answers `handlers`. */
function fakeWorker(handlers: RpcHandlers): WorkerLike {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRpc(port1 as unknown as RpcPort, handlers);
  return {
    onerror: null,
    postMessage: (message, transfer) => port2.postMessage(message, transfer ?? []),
    addEventListener: (type, listener) => port2.addEventListener(type, listener),
    removeEventListener: (type, listener) => port2.removeEventListener(type, listener),
    start: () => port2.start(),
    terminate: () => undefined,
  };
}

function setup(status: 'committed' | 'unchanged') {
  const calls: string[] = [];
  const engine = new DataEngine({
    startQueryWorker: () =>
      fakeWorker({
        blocked: (arg: { urls: string[] }) => arg.urls.map(() => false),
        reload: () => {
          calls.push('reload');
          return null;
        },
      }),
    startIngestWorker: () =>
      fakeWorker({
        prune: () => 0,
        setBusy: () => undefined,
        run: (arg: { job: { src: string } }) => {
          calls.push(`run ${arg.job.src}`);
          return { src: arg.job.src, status, gen: 3, previous: status === 'committed' ? 2 : 3, counts: {}, fetch: null, gzipped: false, elapsedMs: 1, m3u: null, xtream: null };
        },
      }),
    startEpgWorker: () => fakeWorker({}),
    startConfigWorker: () => fakeWorker({}),
    startPairWorker: () => fakeWorker({}),
    startBackupWorker: () => fakeWorker({}),
    startTelemetryWorker: () => fakeWorker({}),
  });
  return { engine, calls };
}

const job = { src: 's1', source: { type: 'm3u' as const, url: 'http://panel.test/get.php?username=u&password=p' } };

describe('DataEngine.refresh and the query worker (RELAY step 59)', () => {
  it('has the query worker read again after an unchanged catalog, before it resolves', async () => {
    const t = setup('unchanged');
    expect((await t.engine.refresh(job)).status).toBe('unchanged');
    expect(t.calls).toEqual(['run s1', 'reload']);
  });

  it("leaves a commit's reload to the swap the ingest worker tells of", async () => {
    // (The fake ingest worker sends no `swapped`: nothing reads again here.)
    const t = setup('committed');
    expect((await t.engine.refresh(job)).status).toBe('committed');
    expect(t.calls).toEqual(['run s1']);
  });
});
