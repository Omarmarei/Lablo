// The backup worker as the TV runs it (RELAY step 32b): `packages/data/src/backup.worker.ts`
// bundled by the TV pipeline (Rollup IIFE, Babel chrome 68, core-js, the ES2019 gate), checked
// against the worker budget, then started in fresh realms that stand in for Chromium 68 workers:
// no `globalThis` (noble's scheduler reads it: core-js must fill it), none of the newer APIs
// Chromium 68 lacks, and no code generation. IndexedDB is fake-indexeddb, shared by the runs as a TV's database is; the
// realm's `crypto.getRandomValues` makes the backup code. Step 32c1: the realm's `fetch` answers
// from the backup API in memory (`backupStandIn`): a profile is sent, then restored after a wipe.
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { backupKeys } from '@lablo/crypto';
import type { BackupEvents, BackupPrepareRequest, BackupPrepareResult, BackupStandIn, RpcPort } from '@lablo/data';
import { BACKUP_CODE_KEY, BACKUP_MASTER_KEY, BACKUP_SENT_KEY, backupStandIn, createBackupClient, getValue, openDatabase, readMasterRecord, saveProfile, secretCheck, storedProfileDoc, STORE } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { BACKUP_CHECK_NAMES, checkProfile } from '@lablo/data/check-backup';
import { freshFactory } from '../packages/data/src/test-support';
import { BACKUP_CHECKS } from '../tools/engines/src/vectors';
import { checkBudget, formatBudget } from '../tools/build/src/budgets';
import { bundleIife } from '../tools/build/src/bundle';
import { CHROMIUM_68_MISSING, pipe } from './realm-support';

const VECTOR = (
  JSON.parse(readFileSync(join(import.meta.dirname, '../packages/crypto/test/vectors.json'), 'utf8')) as {
    backup: { deviceSecret: string; platform: string; appId: string; master: string; lookupId: string }[];
  }
).backup[0]!;
const DEVICE: BackupPrepareRequest = { platform: VECTOR.platform, appId: VECTOR.appId, secret: VECTOR.deviceSecret };

/** A `fetch` for the realm that answers from the backup API in memory. */
function standInFetch(api: BackupStandIn) {
  return async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> => {
    const answer = await api.transport.get(url, { method: init.method as 'GET' | 'PUT' | 'DELETE', headers: init.headers ?? {}, body: init.body });
    const chunks: Uint8Array[] = [];
    for (let chunk = await answer.read(); chunk !== null; chunk = await answer.read()) chunks.push(chunk);
    return new Response(Buffer.concat(chunks), { status: answer.status });
  };
}

/** Starts `code` in a fresh Chromium 68 stand-in realm. */
function startWorker(code: string, factory: IDBFactory, randoms: { calls: number }, fetch?: ReturnType<typeof standInFetch>): RpcPort {
  const [workerPort, uiPort] = pipe();
  const realm = vm.createContext(
    {
      fetch,
      TextEncoder,
      TextDecoder,
      postMessage: workerPort.postMessage,
      addEventListener: workerPort.addEventListener,
      removeEventListener: workerPort.removeEventListener,
      indexedDB: factory,
      IDBKeyRange,
      setTimeout,
      clearTimeout,
      crypto: {
        getRandomValues: (array: Uint8Array): Uint8Array => {
          randoms.calls++;
          return randomFillSync(array);
        },
      },
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  vm.runInContext('var self = this;', realm);
  vm.runInContext(CHROMIUM_68_MISSING, realm);
  expect(vm.runInContext('typeof globalThis + " " + typeof Object.fromEntries', realm)).toBe('undefined undefined');
  expect(() => vm.runInContext('new Function("return 1")', realm)).toThrow(/Code generation from strings disallowed/);
  vm.runInContext(code, realm);
  // core-js filled globalThis again.
  expect(vm.runInContext('typeof globalThis', realm)).toBe('object');
  return uiPort;
}

async function prepare(port: RpcPort, request: BackupPrepareRequest): Promise<{ result: BackupPrepareResult; progress: number[] }> {
  const client = createBackupClient(port);
  const progress: number[] = [];
  client.on('progress', (fraction: BackupEvents['progress']) => progress.push(fraction));
  const result = await client.call('prepare', request);
  client.close();
  return { result, progress };
}

async function kv(factory: IDBFactory, key: string): Promise<unknown> {
  const db = await openDatabase(factory);
  try {
    return await getValue(db, STORE.kv, key);
  } finally {
    db.close();
  }
}

describe("the old-engine harness's backup checks", () => {
  it('are the names @lablo/data/check-backup gives, in its order (the harness keeps its own copy)', () => {
    expect(BACKUP_CHECKS).toEqual(BACKUP_CHECK_NAMES);
  });
});

/** The worker as the TV build bundles it (once for the file). */
let bundled: Promise<string> | null = null;
function workerCode(): Promise<string> {
  bundled ??= bundleIife({ input: join(import.meta.dirname, '..', 'packages', 'data', 'src', 'backup.worker.ts'), platform: 'webos', label: 'backup.worker.js' }).then((b) => b.code);
  return bundled;
}

describe('the bundled backup worker', () => {
  it('builds to gated Chromium 68 code within the worker budget, and derives, keeps and reads back the master and the backup code without globalThis', async () => {
    const code = await workerCode();
    const budget = checkBudget('backup.worker.js', 'worker', code);
    console.log(formatBudget(budget));
    expect(budget.ok).toBe(true);

    const factory = freshFactory();
    const randoms = { calls: 0 };

    // The vectors' device secret: scrypt runs, with its progress, and the vectors' master is kept.
    const first = await prepare(startWorker(code, factory, randoms), DEVICE);
    expect(first.result).toEqual({ source: 'device', derived: true });
    expect(first.progress.length).toBeGreaterThan(10);
    expect(first.progress[first.progress.length - 1]).toBe(1);
    for (let i = 1; i < first.progress.length; i++) expect(first.progress[i]).toBeGreaterThan(first.progress[i - 1]!);
    const kept = readMasterRecord(await kv(factory, BACKUP_MASTER_KEY), secretCheck(VECTOR.platform, VECTOR.appId, VECTOR.deviceSecret));
    expect(kept).not.toBeNull();
    expect(Buffer.from(kept!).toString('hex')).toBe(VECTOR.master);
    expect(backupKeys(kept!).lookupId).toBe(VECTOR.lookupId);
    expect(randoms.calls).toBe(0);

    // A later worker reads the kept master: no scrypt, no progress.
    const second = await prepare(startWorker(code, factory, randoms), DEVICE);
    expect(second).toEqual({ result: { source: 'device', derived: false }, progress: [] });

    // No device secret: a backup code is made from the realm's CSPRNG, kept, and derived from.
    const third = await prepare(startWorker(code, factory, randoms), { ...DEVICE, secret: null });
    expect(third.result).toEqual({ source: 'code', derived: true });
    expect(randoms.calls).toBeGreaterThan(0);
    const backupCode = await kv(factory, BACKUP_CODE_KEY);
    expect(backupCode).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(readMasterRecord(await kv(factory, BACKUP_MASTER_KEY), secretCheck(VECTOR.platform, VECTOR.appId, backupCode as string))).not.toBeNull();

    // A fourth worker reads the code back unchanged, and its master.
    const calls = randoms.calls;
    const fourth = await prepare(startWorker(code, factory, randoms), { ...DEVICE, secret: null });
    expect(fourth).toEqual({ result: { source: 'code', derived: false }, progress: [] });
    expect(randoms.calls).toBe(calls);
    expect(await kv(factory, BACKUP_CODE_KEY)).toBe(backupCode);
  }, 120_000);

  it('sends a profile, then restores it into a wiped database, without globalThis (step 32c1)', async () => {
    const code = await workerCode();
    const api = backupStandIn();
    const randoms = { calls: 0 };
    const call = { ...DEVICE, base: 'http://api.test:8091' };
    const tv = freshFactory();
    const db = await openDatabase(tv);
    await saveProfile(db, checkProfile());
    db.close();

    const sender = createBackupClient(startWorker(code, tv, randoms, standInFetch(api)));
    expect(await sender.call('upload', call)).toEqual({ state: 'sent' });
    expect(await sender.call('upload', call)).toEqual({ state: 'same' });
    sender.close();
    expect(api.requests.map((r) => `${r.method} ${r.status}`)).toEqual(['GET 404', 'PUT 200']);
    expect([...api.blobs.keys()]).toEqual([VECTOR.lookupId]);
    expect(api.blobs.get(VECTOR.lookupId)).not.toContain('example.invalid');

    // The same TV wiped: the look-up derives in the realm, opens the envelope and writes the profile.
    const wiped = freshFactory();
    const restorer = createBackupClient(startWorker(code, wiped, randoms, standInFetch(api)));
    const progress: number[] = [];
    restorer.on('progress', (fraction: BackupEvents['progress']) => progress.push(fraction));
    expect(await restorer.call('restore', call)).toEqual({ state: 'restored', language: 'ar', sources: 1 });
    restorer.close();
    expect(progress[progress.length - 1]).toBe(1);
    const again = await openDatabase(wiped);
    expect(await storedProfileDoc(again)).toEqual(checkProfile());
    expect(await getValue(again, STORE.kv, BACKUP_SENT_KEY)).toMatchObject({ lookupId: VECTOR.lookupId, old: [] });
    // No backup code was made: the one draw from the realm's CSPRNG is the envelope's nonce.
    expect(await getValue(again, STORE.kv, BACKUP_CODE_KEY)).toBeUndefined();
    again.close();
    expect(randoms.calls).toBe(1);
  }, 120_000);
});
