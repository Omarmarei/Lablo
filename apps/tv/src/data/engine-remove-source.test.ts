import type { RpcHandlers, RpcPort } from '@lablo/data';
import { serveRpc } from '@lablo/data';
import { afterEach, describe, expect, it } from 'vitest';
import type { DataEngineOptions, WorkerLike } from './engine';
import { DataEngine } from './engine';

/**
 * `DataEngine.removeSource` (RELAY step 40f): the catalog and the profile go in the ingest worker
 * (in the refresh slot), then the query worker reads everything again, and main is told.
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

function setup(removal: (arg: { src: string }) => boolean | Promise<boolean>, options: Partial<DataEngineOptions> = {}) {
  const calls: string[] = [];
  const engine = new DataEngine({
    startQueryWorker: () =>
      fakeWorker({
        reload: () => {
          calls.push('reload');
          return null;
        },
      }),
    startIngestWorker: () =>
      fakeWorker({
        prune: () => 0,
        removeSource: async (arg: { src: string }) => {
          calls.push(`remove ${arg.src}`);
          return removal(arg);
        },
      }),
    startEpgWorker: () => fakeWorker({}),
    startConfigWorker: () => fakeWorker({}),
    startPairWorker: () => fakeWorker({}),
    startBackupWorker: () => fakeWorker({}),
    startTelemetryWorker: () => fakeWorker({}),
    ...options,
  });
  return { engine, calls };
}

describe('DataEngine.removeSource', () => {
  it('removes in the ingest worker, then has the query worker read again, then tells main; resolves what the worker answered', async () => {
    const told: string[] = [];
    const t = setup(() => true, { onProfileChanged: () => told.push('changed') });
    expect(await t.engine.removeSource('s2')).toBe(true);
    expect(t.calls).toEqual(['remove s2', 'reload']);
    expect(told).toEqual(['changed']);
  });

  it('tells main nothing when the profile held no such source, but still has the query worker read again', async () => {
    const told: string[] = [];
    const t = setup(() => false, { onProfileChanged: () => told.push('changed') });
    expect(await t.engine.removeSource('s9')).toBe(false);
    expect(t.calls).toEqual(['remove s9', 'reload']);
    expect(told).toEqual([]);
  });

  it('holds the refresh slot while it runs: a second removal meanwhile is refused as a second refresh is, and the slot is free after', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
    let first = true;
    const t = setup(() => {
      if (!first) return true;
      first = false;
      return held;
    });
    const running = t.engine.removeSource('s1');
    await expect(t.engine.removeSource('s2')).rejects.toThrow('A catalog refresh is already running');
    release();
    expect(await running).toBe(true);
    expect(await t.engine.removeSource('s2')).toBe(true);
    expect(t.calls).toEqual(['remove s1', 'reload', 'remove s2', 'reload']);
  });

  it('frees the slot and reads nothing again when the removal fails; the failure reaches the caller', async () => {
    let fail = true;
    const t = setup(() => {
      if (fail) throw new Error('the store is gone');
      return true;
    });
    await expect(t.engine.removeSource('s1')).rejects.toThrow('the store is gone');
    expect(t.calls).toEqual(['remove s1']);
    fail = false;
    expect(await t.engine.removeSource('s1')).toBe(true);
  });
});
