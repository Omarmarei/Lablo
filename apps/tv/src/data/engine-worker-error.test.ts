import type { RpcHandlers, RpcPort } from '@lablo/data';
import { serveRpc } from '@lablo/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEngineOptions, WorkerError, WorkerLike, WorkerName } from './engine';
import { DataEngine } from './engine';

/**
 * `DataEngineOptions.onWorkerError` (RELAY step 33c): each worker the engine starts tells it of
 * its uncaught errors, named, after its client has failed its calls.
 */

const ports: MessagePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
});

interface FakeWorker extends WorkerLike {
  /** Fires the worker's `error` event, as a `Worker` does for an uncaught error in it. */
  fire(event: Partial<ErrorEvent>): void;
  terminated: boolean;
}

/** A worker that answers `handlers` (none: it never answers). */
function fakeWorker(handlers: RpcHandlers | null = null): FakeWorker {
  let post: RpcPort['postMessage'] = () => undefined;
  let listen: RpcPort['addEventListener'] = () => undefined;
  let unlisten: RpcPort['removeEventListener'] = () => undefined;
  let start: () => void = () => undefined;
  if (handlers !== null) {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveRpc(port1 as unknown as RpcPort, handlers);
    post = (message, transfer) => port2.postMessage(message, transfer ?? []);
    listen = (type, listener) => port2.addEventListener(type, listener);
    unlisten = (type, listener) => port2.removeEventListener(type, listener);
    start = () => port2.start();
  }
  const worker: FakeWorker = {
    onerror: null,
    terminated: false,
    postMessage: (message, transfer) => post(message, transfer),
    addEventListener: (type, listener) => listen(type, listener),
    removeEventListener: (type, listener) => unlisten(type, listener),
    start: () => start(),
    terminate: () => {
      worker.terminated = true;
    },
    fire: (event) => worker.onerror?.(event as ErrorEvent),
  };
  return worker;
}

/** An engine whose workers are fakes, each kept by its name; the query worker answers the EPG refresh's two questions. */
function setup(options: Partial<DataEngineOptions> = {}) {
  const started: Record<WorkerName, FakeWorker[]> = { query: [], ingest: [], epg: [], config: [], pair: [], backup: [], telemetry: [] };
  const reports: WorkerError[] = [];
  const make = (name: WorkerName, handlers: RpcHandlers | null = null) => () => {
    const worker = fakeWorker(handlers);
    started[name].push(worker);
    return worker;
  };
  const engine = new DataEngine({
    startQueryWorker: make('query', {
      epgStatus: () => ({ guides: [], matched: 0, sources: [], mapping: '' }),
      blocked: (args: { urls: string[] }) => args.urls.map(() => false),
      status: () => new Promise(() => undefined),
    }),
    startIngestWorker: make('ingest'),
    startEpgWorker: make('epg'),
    startConfigWorker: make('config'),
    startPairWorker: make('pair'),
    startBackupWorker: make('backup'),
    startTelemetryWorker: make('telemetry'),
    onWorkerError: (error) => reports.push(error),
    ...options,
  });
  return { engine, started, reports };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const BACKUP = { platform: 'webos', appId: 'com.lablo.iptv', secret: { kind: 'code' } } as unknown as Parameters<DataEngine['backupStatus']>[0];
const TELEMETRY = { events: [], base: 'http://api.test', platform: 'webos', appVersion: '1.0.0', sampling: null };
const CONFIG = { base: 'http://api.test', platform: 'webos', version: '1.0.0', keys: [] } as unknown as Parameters<DataEngine['refreshConfig']>[0];

describe('the data engine: onWorkerError', () => {
  it("tells of each worker's uncaught error by the worker's name, its message and position, after the worker's calls failed", async () => {
    const t = setup();
    const cases: [WorkerName, () => Promise<unknown>, RegExp][] = [
      ['telemetry', () => t.engine.sendTelemetry(TELEMETRY), /^Telemetry worker failed: Uncaught Error: telemetry$/],
      ['config', () => t.engine.refreshConfig(CONFIG), /^Config worker failed: Uncaught Error: config$/],
      ['backup', () => t.engine.backupStatus(BACKUP), /^Backup worker failed: Uncaught Error: backup$/],
      ['pair', () => t.engine.pairing().open('http://api.test'), /^Pair worker failed: Uncaught Error: pair$/],
      ['query', () => t.engine.summary(), /^Query worker failed: Uncaught Error: query$/],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [name, call, failed] = cases[i]!;
      const pending = call();
      await tick();
      const worker = t.started[name][t.started[name].length - 1]!;
      worker.fire({ message: `Uncaught Error: ${name}`, filename: 'blob:file:///0b8c3c48-5d1e-4f43-9a83-1b0a5c4c2a11', lineno: 10 + i, colno: 20 + i });
      await expect(pending).rejects.toThrow(failed);
      expect(t.reports[i]).toEqual({ worker: name, message: `Uncaught Error: ${name}`, line: 10 + i, col: 20 + i });
    }
    expect(t.reports).toHaveLength(cases.length);
  });

  it("names the ingest worker (the start's prune) and the EPG worker (a guide refresh)", async () => {
    const t = setup();
    const refresh = t.engine.refreshEpg([], { tier: 'full' });
    await tick();
    // The refresh waits for the start's prune, in an ingest worker; it dies.
    t.started.ingest[0]!.fire({ message: 'Uncaught Error: prune', lineno: 1, colno: 2 });
    await vi.waitFor(() => expect(t.started.epg).toHaveLength(1));
    t.started.epg[0]!.fire({ message: 'Uncaught RangeError: epg', lineno: 3, colno: 4 });
    await expect(refresh).rejects.toThrow(/^EPG worker failed: Uncaught RangeError: epg$/);
    expect(t.reports).toEqual([
      { worker: 'ingest', message: 'Uncaught Error: prune', line: 1, col: 2 },
      { worker: 'epg', message: 'Uncaught RangeError: epg', line: 3, col: 4 },
    ]);
    // Each was ended as the refresh ended.
    expect(t.started.ingest[0]!.terminated).toBe(true);
    expect(t.started.epg[0]!.terminated).toBe(true);
  });

  it("tells of a worker whose script didn't load (a plain `Event`) with no message and no position", async () => {
    const t = setup();
    const pending = t.engine.sendTelemetry(TELEMETRY);
    await tick();
    t.started.telemetry[0]!.fire({});
    await expect(pending).rejects.toThrow(/^Telemetry worker failed: unknown error$/);
    expect(t.reports).toEqual([{ worker: 'telemetry', message: '', line: 0, col: 0 }]);
  });

  it("still fails the worker's calls when the report throws, or when there is no one to tell", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const thrown = new Error('the report broke');
    const t = setup({
      onWorkerError: () => {
        throw thrown;
      },
    });
    const pending = t.engine.sendTelemetry(TELEMETRY);
    await tick();
    t.started.telemetry[0]!.fire({ message: 'Uncaught Error: x', lineno: 1, colno: 1 });
    await expect(pending).rejects.toThrow(/^Telemetry worker failed: Uncaught Error: x$/);
    expect(warn).toHaveBeenCalledWith('A worker error was not reported', thrown);

    const quiet = setup({ onWorkerError: undefined });
    const summary = quiet.engine.summary();
    await tick();
    const worker = quiet.started.query[0]!;
    worker.fire({ message: 'Uncaught Error: y' });
    await expect(summary).rejects.toThrow(/^Query worker failed: Uncaught Error: y$/);
    expect(quiet.reports).toEqual([]);
    // (Nothing to tell is not a failure to tell.)
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
