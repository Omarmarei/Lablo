// The backup worker as the TV runs it (RELAY step 32b): `packages/data/src/backup.worker.ts`
// bundled by the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, the ES2016 gate), checked
// against the worker budget, then started in fresh realms that stand in for Chromium 53 workers:
// no `BigInt` (noble's top-level BigInt calls must be tree-shaken out), no `globalThis` (noble's
// scheduler reads it: core-js must fill it), none of the ES2017+ APIs Chromium 53 lacks, and no
// code generation. IndexedDB is fake-indexeddb, shared by the runs as a TV's database is; the
// realm's `crypto.getRandomValues` makes the backup code.
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { backupKeys } from '@lablo/crypto';
import type { BackupEvents, BackupPrepareRequest, BackupPrepareResult, RpcPort } from '@lablo/data';
import { BACKUP_CODE_KEY, BACKUP_MASTER_KEY, createBackupClient, getValue, openDatabase, readMasterRecord, secretCheck, STORE } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { BACKUP_CHECK_NAMES } from '@lablo/data/check-backup';
import { freshFactory } from '../packages/data/src/test-support';
import { BACKUP_CHECKS } from '../tools/engines/src/vectors';
import { checkBudget, formatBudget } from '../tools/build/src/budgets';
import { bundleIife } from '../tools/build/src/bundle';
import { CHROMIUM_53_MISSING, pipe } from './realm-support';

const VECTOR = (
  JSON.parse(readFileSync(join(import.meta.dirname, '../packages/crypto/test/vectors.json'), 'utf8')) as {
    backup: { deviceSecret: string; platform: string; appId: string; master: string; lookupId: string }[];
  }
).backup[0]!;
const DEVICE: BackupPrepareRequest = { platform: VECTOR.platform, appId: VECTOR.appId, secret: VECTOR.deviceSecret };

/** Starts `code` in a fresh Chromium 53 stand-in realm. */
function startWorker(code: string, factory: IDBFactory, randoms: { calls: number }): RpcPort {
  const [workerPort, uiPort] = pipe();
  const realm = vm.createContext(
    {
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
  vm.runInContext(CHROMIUM_53_MISSING, realm);
  expect(vm.runInContext('typeof BigInt + " " + typeof globalThis + " " + typeof Object.values', realm)).toBe('undefined undefined undefined');
  expect(() => vm.runInContext('new Function("return 1")', realm)).toThrow(/Code generation from strings disallowed/);
  vm.runInContext(code, realm);
  // core-js filled globalThis again; BigInt stays missing.
  expect(vm.runInContext('typeof globalThis + " " + typeof BigInt', realm)).toBe('object undefined');
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

describe('the bundled backup worker', () => {
  it('builds to gated Chromium 53 code within the worker budget, and derives, keeps and reads back the master and the backup code without BigInt or globalThis', async () => {
    const input = join(import.meta.dirname, '..', 'packages', 'data', 'src', 'backup.worker.ts');
    const { code } = await bundleIife({ input, platform: 'webos', label: 'backup.worker.js' });
    const budget = checkBudget('backup.worker.js', 'worker', code);
    console.log(formatBudget(budget));
    expect(budget.ok).toBe(true);
    expect(code).not.toMatch(/BigInt\s*\(\s*\d/);

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
});
