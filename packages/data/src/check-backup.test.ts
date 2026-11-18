import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BackupCheckVector } from './check-backup';
import { BACKUP_CHECK_DB, BACKUP_CHECK_NAMES, checkBackup, checkProfile, otherProfile } from './check-backup';
import { toBase64Url } from '@lablo/crypto';
import { BACKUP_CODE_KEY, BACKUP_MASTER_KEY, secretCheck } from './backup-service';
import { getValue, openDatabase, transact } from './idb';
import { DB_NAME, STORE } from './schema';
import { freshFactory } from './test-support';

const VECTOR = (JSON.parse(readFileSync(join(import.meta.dirname, '../../crypto/test/vectors.json'), 'utf8')) as { backup: BackupCheckVector[] }).backup[0]!;

/** The names of the checks that failed. */
const failed = (results: ReadonlyArray<{ name: string; ok: boolean }>): string[] => results.filter((r) => !r.ok).map((r) => r.name);

async function names(factory: IDBFactory): Promise<string[]> {
  return (await factory.databases()).map((d) => d.name ?? '');
}

describe('checkBackup (the backup worker on the old engines, steps 32b, 32c1 and 32d2a)', () => {
  it('passes every check, in order, under its names, and leaves no database behind', async () => {
    const factory = freshFactory();
    const results = await checkBackup(VECTOR, factory);
    expect(results.map((r) => r.name)).toEqual(BACKUP_CHECK_NAMES);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.every((r) => r.detail === '' && r.ms >= 0)).toBe(true);
    expect(BACKUP_CHECK_DB).toBe('lablo-backup-check');
    expect(await names(factory)).toEqual([]);
  }, 20_000);

  it("holds a new install's profile unlike the backup's (its source and language), so a restore that wrote nothing shows", () => {
    expect(otherProfile().sources).not.toEqual(checkProfile().sources);
    expect(otherProfile().onboarding.language).not.toBe(checkProfile().onboarding.language);
  });

  it("never touches the app's database", async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory);
    await transact(db, STORE.kv, 'readwrite', (tx) => {
      tx.objectStore(STORE.kv).put('kept', BACKUP_CODE_KEY);
    });
    db.close();
    expect(failed(await checkBackup(VECTOR, factory))).toEqual([]);
    expect(await names(factory)).toEqual([DB_NAME]);
    const again = await openDatabase(factory);
    expect(await getValue(again, STORE.kv, BACKUP_CODE_KEY)).toBe('kept');
    expect(await getValue(again, STORE.kv, BACKUP_MASTER_KEY)).toBeUndefined();
    again.close();
  }, 20_000);

  it('starts from nothing, whatever an earlier run left', async () => {
    const factory = freshFactory();
    const left = await openDatabase(factory, { name: BACKUP_CHECK_DB });
    // A master kept for the vector's own secret (a wrong one): without the reset, scrypt wouldn't run.
    const check = secretCheck(VECTOR.platform, VECTOR.appId, VECTOR.deviceSecret);
    await transact(left, STORE.kv, 'readwrite', (tx) => {
      tx.objectStore(STORE.kv).put({ source: 'device', check, master: toBase64Url(new Uint8Array(32)) }, BACKUP_MASTER_KEY);
      tx.objectStore(STORE.kv).put('0000000000000000000000000Z', BACKUP_CODE_KEY);
    });
    left.close();
    expect(failed(await checkBackup(VECTOR, factory))).toEqual([]);
  }, 20_000);

  it.each([
    ['the master', { ...VECTOR, master: VECTOR.master.replace(/^./, (c) => (c === '0' ? '1' : '0')) }, ['backup.master', 'backup.restore']],
    ['the lookup ID', { ...VECTOR, lookupId: `A${VECTOR.lookupId.slice(1)}` }, ['backup.lookupId', 'backup.upload']],
  ])('fails exactly the checks that read %s when it changes', async (_, vector, expected) => {
    expect(failed(await checkBackup(vector, freshFactory()))).toEqual(expected);
  }, 20_000);

  it('reports each failure as its own, with the error', async () => {
    const factory = freshFactory();
    // A database that can't be opened: every check that needs it fails with the error; the rest pass.
    const broken = { ...factory, open: () => {
      throw new Error('no IndexedDB here');
    }, deleteDatabase: factory.deleteDatabase.bind(factory), databases: factory.databases.bind(factory), cmp: factory.cmp.bind(factory) } as IDBFactory;
    const results = await checkBackup(VECTOR, broken);
    expect(results.map((r) => r.name)).toEqual(BACKUP_CHECK_NAMES);
    expect(failed(results)).toEqual(['backup.device', 'backup.master', 'backup.lookupId', 'backup.cached', 'backup.upload', 'backup.same', 'backup.code', 'backup.codeKept', 'backup.restore', 'backup.held', 'backup.restoreHeld', 'backup.replaceHeld', 'backup.off', 'backup.on']);
    expect(results.find((r) => r.name === 'backup.device')?.detail).toContain('no IndexedDB here');
    expect(results.find((r) => r.name === 'backup.lookupId')?.detail).toBe('no master kept for the secret');
  });
});
