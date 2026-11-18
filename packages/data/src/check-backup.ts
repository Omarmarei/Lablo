/**
 * The backup's keys on a real engine (RELAY step 32b): `BackupService` against an IndexedDB of its
 * own (`lablo-backup-check`, never the app's), from the shared crypto vectors' first backup chain.
 * Its own entry point (`@lablo/data/check-backup`): the vectors page runs it in a Blob worker on
 * Chromium 53, 56 and 68 (`pnpm verify:engines`) and in current Chromium (`e2e/crypto-vectors.spec.ts`);
 * Node runs it with fake-indexeddb. The checks run in order and each one's error is its own failure.
 * It deletes its database first and last, so a page never leaves it half written.
 */
import { backupKeys } from '@lablo/crypto';
import type { VectorResult } from '@lablo/crypto/check-vectors';
import type { BackupPrepareRequest } from './backup-service';
import { BACKUP_CODE_KEY, BACKUP_MASTER_KEY, BackupService, readMasterRecord, secretCheck } from './backup-service';
import { deleteDatabase, getValue, openDatabase } from './idb';
import { STORE } from './schema';

/** The checks' own database. */
export const BACKUP_CHECK_DB = 'lablo-backup-check';

/** The names `checkBackup` gives, in its order (the harness and the e2e test expect them). */
export const BACKUP_CHECK_NAMES: readonly string[] = [
  'backup.reset',
  'backup.device',
  'backup.master',
  'backup.lookupId',
  'backup.cached',
  'backup.code',
  'backup.codeKept',
  'backup.cleanup',
];

/** What it needs of a crypto vectors' backup chain (`vectors.backup[0]`). */
export interface BackupCheckVector {
  readonly deviceSecret: string;
  readonly platform: string;
  readonly appId: string;
  /** Hex. */
  readonly master: string;
  readonly lookupId: string;
}

const CODE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ('0' + bytes[i]!.toString(16)).slice(-2);
  return out;
}

const same = (what: string, got: string, want: string): string => (got === want ? '' : `${what}: got ${got}, expected ${want}; `);

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Runs every check on `factory` (the realm's `indexedDB`); see the module's comment. */
export async function checkBackup(vector: BackupCheckVector, factory: IDBFactory, name: string = BACKUP_CHECK_DB): Promise<VectorResult[]> {
  const service = new BackupService({ openDb: () => openDatabase(factory, { name }) });
  const device: BackupPrepareRequest = { platform: vector.platform, appId: vector.appId, secret: vector.deviceSecret };
  const noSecret: BackupPrepareRequest = { platform: vector.platform, appId: vector.appId, secret: null };
  const read = async (key: string): Promise<unknown> => {
    const db = await openDatabase(factory, { name });
    try {
      return await getValue<unknown>(db, STORE.kv, key);
    } finally {
      db.close();
    }
  };
  let master: Uint8Array | null = null;
  let code: unknown;

  const checks: Array<{ name: string; run: () => Promise<string> | string }> = [
    { name: 'backup.reset', run: () => deleteDatabase(factory, name).then(() => '') },
    {
      // scrypt in this realm, with its progress: the time that matters on a TV.
      name: 'backup.device',
      run: async () => {
        const progress: number[] = [];
        const result = await service.prepare(device, (fraction) => progress.push(fraction));
        const last = progress.length === 0 ? -1 : progress[progress.length - 1]!;
        return same('source', result.source, 'device') + same('derived', String(result.derived), 'true') + same('progress', String(last), '1');
      },
    },
    {
      name: 'backup.master',
      run: async () => {
        master = readMasterRecord(await read(BACKUP_MASTER_KEY), secretCheck(vector.platform, vector.appId, vector.deviceSecret));
        return master === null ? 'no master kept for the secret' : same('master', toHex(master), vector.master);
      },
    },
    { name: 'backup.lookupId', run: () => (master === null ? 'no master kept for the secret' : same('lookupId', backupKeys(master).lookupId, vector.lookupId)) },
    {
      name: 'backup.cached',
      run: async () => {
        let progress = 0;
        const result = await service.prepare(device, () => progress++);
        return same('source', result.source, 'device') + same('derived', String(result.derived), 'false') + same('progress', String(progress), '0');
      },
    },
    {
      name: 'backup.code',
      run: async () => {
        const result = await service.prepare(noSecret);
        code = await read(BACKUP_CODE_KEY);
        if (typeof code !== 'string' || CODE.exec(code) === null) return `no backup code kept (${String(code)})`;
        const kept = readMasterRecord(await read(BACKUP_MASTER_KEY), secretCheck(vector.platform, vector.appId, code));
        return same('source', result.source, 'code') + same('derived', String(result.derived), 'true') + (kept === null ? 'no master kept for the code' : '');
      },
    },
    {
      name: 'backup.codeKept',
      run: async () => {
        const result = await service.prepare(noSecret);
        return same('derived', String(result.derived), 'false') + same('code', String(await read(BACKUP_CODE_KEY)), String(code));
      },
    },
    { name: 'backup.cleanup', run: () => deleteDatabase(factory, name).then(() => '') },
  ];

  const results: VectorResult[] = [];
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i]!;
    const started = Date.now();
    try {
      const detail = await check.run();
      results.push({ name: check.name, ok: detail === '', detail, ms: Date.now() - started });
    } catch (error) {
      results.push({ name: check.name, ok: false, detail: errorText(error), ms: Date.now() - started });
    }
  }
  return results;
}
