/**
 * The backup's keys on the TV (architecture.md §3.3 B, RELAY step 32b). The backup worker serves
 * it (`backupHandlers`): the app starts one for each call and ends it after (step 32c's upload and
 * restore run there too, so no key leaves it).
 *
 * `prepare({platform, appId, secret})` makes sure the backup's master key is in IndexedDB:
 * - **the secret:** the TV's device ID when the app passes one (it reads it only after "Allow" at
 *   the consent screen); else the **backup code**, the one kept in `kv`, or a new one (128 random
 *   bits) written before anything is derived from it;
 * - **the master:** scrypt (`deriveBackupMaster`, seconds on a 2018 TV) only when `kv` has no
 *   master for this secret; `progress` events say how far it is. The record keeps a check of the
 *   secret it came from, so a consent given later, or another code (step 32d), derives again.
 *
 * `kv` now holds one thing that can't be rebuilt from the providers: the backup code.
 */
import { BACKUP_CODE_BYTES, backupCodeText, backupSalt, deriveBackupMaster, fromBase64Url, randomBytes, readBackupCode, sha256, toBase64Url, utf8 } from '@lablo/crypto';
import { getValue, onSuccess, transact } from './idb';
import type { RpcContext } from './rpc';
import { STORE } from './schema';

/** `kv`'s key for the backup code (26 characters). */
export const BACKUP_CODE_KEY = 'backup.code';
/** `kv`'s key for the cached master (`MasterRecord`). */
export const BACKUP_MASTER_KEY = 'backup.master';

/** Where the master comes from: the TV's device ID, or the backup code. */
export type BackupSource = 'device' | 'code';

export interface BackupPrepareRequest {
  /** The build's platform (`tizen`, `webos` or `browser`): part of the scrypt salt. */
  platform: string;
  /** The build's app id (`__APP_ID__`): part of the scrypt salt. */
  appId: string;
  /** The device ID after "Allow", or `null` for the backup code. */
  secret: string | null;
}

export interface BackupPrepareResult {
  source: BackupSource;
  /** scrypt ran in this call (no master was kept for this secret). */
  derived: boolean;
}

/** Events the backup worker pushes. */
export interface BackupEvents extends Record<string, unknown> {
  /** How far scrypt is, 0 to 1, in whole percents. */
  progress: number;
}

/** What `kv` keeps of the master. */
export interface MasterRecord {
  source: BackupSource;
  /** `secretCheck` of the secret it came from. */
  check: string;
  /** 32 bytes, base64url. */
  master: string;
}

/** The master's derivation (scrypt; a stand-in in tests). */
export type DeriveMaster = (secret: string, platform: string, appId: string, onProgress?: (fraction: number) => void) => Promise<Uint8Array>;

export interface BackupServiceOptions {
  openDb: () => Promise<IDBDatabase>;
  /** Default `deriveBackupMaster`. */
  derive?: DeriveMaster;
  /** Default `randomBytes` (the platform's CSPRNG). */
  random?: (length: number) => Uint8Array;
}

/**
 * Which secret a master came from: b64url(SHA-256(UTF-8(salt + "|" + secret))). It tells a kept
 * master from another secret's without scrypt; anyone who can read it can read the master too.
 */
export function secretCheck(platform: string, appId: string, secret: string): string {
  return toBase64Url(sha256(utf8(backupSalt(platform, appId) + '|' + secret)));
}

/** The kept master if `record` is one for `check`, else `null`. */
export function readMasterRecord(record: unknown, check: string): Uint8Array | null {
  if (typeof record !== 'object' || record === null) return null;
  const { source, check: kept, master } = record as Partial<MasterRecord>;
  if ((source !== 'device' && source !== 'code') || kept !== check || typeof master !== 'string') return null;
  const bytes = fromBase64Url(master);
  return bytes !== null && bytes.length === 32 ? bytes : null;
}

function checkRequest(request: BackupPrepareRequest): void {
  const { platform, appId, secret } = request;
  if (typeof platform !== 'string' || platform === '' || typeof appId !== 'string' || appId === '') {
    throw new TypeError('A backup request needs the platform and the app id');
  }
  if (secret !== null && (typeof secret !== 'string' || secret === '')) throw new TypeError("A backup request's secret is a device ID or null");
}

export class BackupService {
  private readonly derive: DeriveMaster;
  private readonly random: (length: number) => Uint8Array;

  constructor(private readonly options: BackupServiceOptions) {
    this.derive = options.derive ?? deriveBackupMaster;
    this.random = options.random ?? randomBytes;
  }

  /** Makes sure a master for this request's secret is kept; see the module's comment. */
  async prepare(request: BackupPrepareRequest, onProgress?: (fraction: number) => void): Promise<BackupPrepareResult> {
    checkRequest(request);
    const db = await this.options.openDb();
    try {
      const source: BackupSource = request.secret === null ? 'code' : 'device';
      const secret = request.secret === null ? await this.keepCode(db) : request.secret;
      const check = secretCheck(request.platform, request.appId, secret);
      let kept: unknown;
      try {
        kept = await getValue<unknown>(db, STORE.kv, BACKUP_MASTER_KEY);
      } catch {
        kept = undefined;
      }
      if (readMasterRecord(kept, check) !== null) return { source, derived: false };
      const master = await this.derive(secret, request.platform, request.appId, onProgress);
      const record: MasterRecord = { source, check, master: toBase64Url(master) };
      try {
        await transact(db, STORE.kv, 'readwrite', (tx) => {
          tx.objectStore(STORE.kv).put(record, BACKUP_MASTER_KEY);
        });
      } catch {
        // Derived again at the next call; this one still did its work.
      }
      return { source, derived: true };
    } finally {
      db.close();
    }
  }

  /**
   * The kept backup code, or a new one written now. One transaction reads and writes, so two
   * workers asking at once keep the same code. Rejects when IndexedDB can't keep it.
   */
  private keepCode(db: IDBDatabase): Promise<string> {
    return transact<string>(db, STORE.kv, 'readwrite', (tx, done) => {
      const store = tx.objectStore(STORE.kv);
      onSuccess(store.get(BACKUP_CODE_KEY), (value) => {
        const kept = typeof value === 'string' ? readBackupCode(value) : null;
        if (kept !== null && kept === value) {
          done(kept);
          return;
        }
        const code = backupCodeText(this.random(BACKUP_CODE_BYTES));
        store.put(code, BACKUP_CODE_KEY);
        done(code);
      });
    });
  }
}

/** Whole percents of `onProgress`'s fractions, each once. */
function percents(send: (fraction: number) => void): (fraction: number) => void {
  let last = -1;
  return (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent > last) {
      last = percent;
      send(percent / 100);
    }
  };
}

/** The backup worker's RPC methods (backup.worker.ts). */
export function backupHandlers(options: BackupServiceOptions) {
  const service = new BackupService(options);
  return {
    prepare: (request: BackupPrepareRequest, ctx: RpcContext): Promise<BackupPrepareResult> =>
      service.prepare(request, percents((fraction) => ctx.emit('progress', fraction))),
  };
}
