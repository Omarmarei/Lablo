import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BULK_DB, bulkItem, idbBulkWrite } from './idb-bulk';
import {
  MARKER_KEY,
  WRITE_TEST_DB,
  idbWriteTest,
  markerVerdict,
  nextMarker,
  noise,
  parseMarker,
  readIdbMarker,
  readLocalMarker,
  readQuota,
  writeIdbMarker,
  writeLocalMarker,
} from './storage';
import type { LabMarker } from './types';

beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const MARKER: LabMarker = { version: '0.1.0', session: 'webos-a-1', at: '2026-11-04T02:00:00.000Z', runs: 1, deviceIdHash: 'abc' };

/** A Storage over a Map (localStorage in a test). */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

function databases(factory: IDBFactory): Promise<string[]> {
  return factory.databases().then((list) => list.map((d) => d.name ?? ''));
}

describe('S2 markers', () => {
  it('parse only our own markers', () => {
    expect(parseMarker(JSON.stringify(MARKER))).toEqual(MARKER);
    expect(parseMarker({ ...MARKER, deviceIdHash: 7 })).toEqual({ ...MARKER, deviceIdHash: null });
    for (const bad of [null, 'nope', '{"version":"1"}', 42, JSON.stringify({ ...MARKER, runs: '1' })]) expect(parseMarker(bad)).toBeNull();
  });

  it('count runs on from the highest marker found', () => {
    const run = { version: '0.1.1', session: 's2', at: 'now', deviceIdHash: null };
    expect(nextMarker({ localStorage: null, indexedDB: null }, run).runs).toBe(1);
    expect(nextMarker({ localStorage: { ...MARKER, runs: 4 }, indexedDB: { ...MARKER, runs: 2 } }, run)).toEqual({ ...run, runs: 5 });
  });

  it('judge: none found, the same version (a relaunch) or an older one (an update survived)', () => {
    expect(markerVerdict('IndexedDB', null, '0.1.0')).toMatchObject({ status: 'info', value: { found: null } });
    expect(markerVerdict('IndexedDB', MARKER, '0.1.0')).toMatchObject({ status: 'info', note: expect.stringMatching(/^IndexedDB kept the marker of an earlier run of 0\.1\.0/) });
    expect(markerVerdict('localStorage', MARKER, '0.2.0')).toMatchObject({ status: 'pass', note: expect.stringMatching(/^localStorage survived an update from 0\.1\.0 to 0\.2\.0/) });
  });

  it('round-trip through localStorage, and report a store that refuses', () => {
    const storage = memoryStorage();
    expect(readLocalMarker(storage)).toBeNull();
    expect(writeLocalMarker(storage, MARKER)).toBeNull();
    expect(storage.getItem(MARKER_KEY)).toBe(JSON.stringify(MARKER));
    expect(readLocalMarker(storage)).toEqual(MARKER);
    const full = { ...memoryStorage(), setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(writeLocalMarker(full, MARKER)).toBe('QuotaExceededError: full');
    expect(writeLocalMarker(null, MARKER)).toBe('no localStorage');
    // A store that takes the write without keeping it (a TV in a private mode).
    const forgetful = { ...memoryStorage(), setItem: () => undefined };
    expect(writeLocalMarker(forgetful, MARKER)).toBe('read back something else');
    expect(readLocalMarker(null)).toBeNull();
  });

  it('round-trip through IndexedDB', async () => {
    const factory = new FakeIDBFactory();
    expect(await readIdbMarker(factory)).toBeNull();
    expect(await writeIdbMarker(factory, MARKER)).toBeNull();
    expect(await readIdbMarker(factory)).toEqual(MARKER);
    expect(await writeIdbMarker(factory, { ...MARKER, runs: 2 })).toBeNull();
    expect((await readIdbMarker(factory))?.runs).toBe(2);
    expect(await readIdbMarker(null)).toBeNull();
    expect(await writeIdbMarker(null, MARKER)).toBe('no indexedDB');
  });
});

describe('S2 quota and write test', () => {
  it('reads the quota from storage.estimate, else webkitTemporaryStorage', async () => {
    const MB = 1024 * 1024;
    expect(await readQuota({ storage: { estimate: () => Promise.resolve({ quota: 300 * MB, usage: 1.5 * MB }), persisted: () => Promise.resolve(false) } })).toEqual({
      api: 'storage.estimate',
      quotaMb: 300,
      usageMb: 1.5,
      persisted: false,
    });
    expect(await readQuota({ webkitTemporaryStorage: { queryUsageAndQuota: (ok) => ok(2 * MB, 64 * MB) } })).toEqual({
      api: 'webkitTemporaryStorage',
      quotaMb: 64,
      usageMb: 2,
      persisted: null,
    });
    expect(await readQuota({})).toEqual({ api: 'none', quotaMb: null, usageMb: null, persisted: null });
  });

  it('writes the target in 1 MB records and deletes the scratch database', async () => {
    const factory = new FakeIDBFactory();
    let now = 0;
    const report = await idbWriteTest(factory, 6, () => (now += 500));
    expect(report).toEqual({ targetMb: 6, writtenMb: 6, ms: 500, mbPerSecond: 12, error: null, deleted: true });
    expect(await databases(factory)).not.toContain(WRITE_TEST_DB);
  });

  it('stops at the first refused transaction and says why', async () => {
    const factory = new FakeIDBFactory();
    const proto = Object.getPrototypeOf(await openStore(factory)) as IDBObjectStore;
    const put = proto.put;
    let puts = 0;
    // The engine refuses the second transaction (records 3 and 4): a full disk aborts it.
    const spy = vi.spyOn(proto, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      puts += 1;
      const request = put.apply(this, args);
      if (puts === 3) this.transaction.abort();
      return request;
    });
    try {
      const report = await idbWriteTest(factory, 8, undefined, 2);
      expect(report).toMatchObject({ targetMb: 8, writtenMb: 2, error: expect.stringMatching(/\S/), deleted: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('fills each megabyte with bytes that do not repeat', () => {
    const a = noise(1024, 1);
    const b = noise(1024, 2);
    expect(a.length).toBe(1024);
    expect(new Set(a).size).toBeGreaterThan(200);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

/** An object store of the fake, to reach its prototype. */
async function openStore(factory: IDBFactory): Promise<IDBObjectStore> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const req = factory.open('proto', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('s');
    req.onsuccess = () => resolve(req.result);
  });
  const store = db.transaction('s', 'readwrite').objectStore('s');
  db.close();
  return store;
}

describe('S1 bulk write', () => {
  it('writes the items in chunks, counts them, reads one chunk back and deletes the database', async () => {
    const factory = new FakeIDBFactory();
    let now = 0;
    const report = await idbBulkWrite(factory, 1200, 500, () => (now += 10));
    expect(report).toMatchObject({ items: 1200, chunk: 500, count: 1200, getAll: 500, deleted: true });
    expect(report.writeMs).toBeGreaterThan(0);
    expect(await databases(factory)).not.toContain(BULK_DB);
    expect(bulkItem(3)).toEqual({ id: 3, num: 4, name: 'Channel 3 قناة', group: 'Group 3', url: 'http://example.invalid/live/3.ts' });
  });
});
