/**
 * The backup on the TV (architecture.md §3.3 B, RELAY steps 32b and 32c1). The backup worker serves
 * it (`backupHandlers`): the app starts one for each call and ends it after, so no key leaves it.
 *
 * `prepare({platform, appId, secret})` makes sure the backup's master key is in IndexedDB:
 * - **the secret:** the TV's device ID when the app passes one (it reads it only after "Allow" at
 *   the consent screen); else the **backup code**, the one kept in `kv`, or a new one (128 random
 *   bits) written before anything is derived from it;
 * - **the master:** scrypt (`deriveBackupMaster`, seconds on a 2018 TV) only when `kv` has no
 *   master for this secret; `progress` events say how far it is. The record keeps a check of the
 *   secret it came from, so a consent given later, or another code (step 32d), derives again.
 *
 * `upload({…, base})` sends the profile (step 32c1):
 * - `none`: no profile, one from a newer app version, or one with no source yet;
 * - the master as `prepare` makes sure of it; then the keys (`backupKeys`);
 * - `same`: the document and the lookup ID are those of the last send (`kv` `backup.sent`);
 * - `held`: nothing was sent under this lookup ID yet, and `GET` finds a backup there. A backup
 *   this TV hasn't seen (a look-up that failed after a wipe, or one from a newer app) is never
 *   written over: step 32d offers to restore or replace it;
 * - else the lookup ID is claimed in `backup.sent` (so a `PUT` that fails is sent again without the
 *   `GET`), the plaintext is checked against the API's size (`too-large`), sealed and `PUT`
 *   (`sent`);
 * - **old copies:** after a send under a new lookup ID (a consent given later), the copy under the
 *   one before is deleted with its own token; one that can't be yet is kept in `backup.sent.old`
 *   and tried at each later upload.
 * - `backup.sent.sentAt` says when the copy on the server was last written (a send, or a restore).
 *
 * `restore({…, base})` looks for a backup at a start with no profile (Omar's decision, RELAY
 * step 32): the device ID's master is derived in memory, and **nothing is written until a backup
 * is restored**, so a look-up that finds nothing, or is ended by the app's time limit, keeps
 * nothing derived. A restored profile (older versions upgraded) is written with the master record
 * and `backup.sent` in one transaction, and only where there is still no profile.
 *
 * Settings' backup page (step 32d2a):
 * - `status` says whether the backup is on, where its master comes from, the backup code (only
 *   when it is the secret; made and kept then if there is none), when the last send went, and
 *   whether copies are still to delete;
 * - `setEnabled(false)` turns it off: `backup.off` is written first (no upload sends after it),
 *   then every copy this TV wrote is deleted with its own token. What can't be deleted yet stays
 *   in `backup.sent` (under no lookup ID of its own) and is tried again by each `upload`, which
 *   answers `off` with no `GET` or `PUT` while the backup is off. `setEnabled(true)` removes the
 *   flag: the next upload sends as a first send does, and a copy of its own lookup ID whose delete
 *   never went through is this TV's, written over without the `GET`;
 * - a `held` backup: `restoreHeld` reads it as `restore` does and writes it over the profile, the
 *   profile it replaces kept as a snapshot (`restore`), and clears every catalog and guide with it
 *   (step 32d2b: `RESTORE_CLEARS`); `replaceHeld` sends the profile over it
 *   (the same master gives the same write token, so the API takes it).
 *
 * `kv` holds one thing that can't be rebuilt from the providers: the backup code.
 */
import {
  BACKUP_CODE_BYTES,
  backupCodeText,
  backupKeys,
  backupSalt,
  deriveBackupMaster,
  fromBase64Url,
  openBackup,
  randomBytes,
  readBackupCode,
  sealBackup,
  sha256,
  toBase64Url,
  utf8,
} from '@lablo/crypto';
import { BACKUP_CT_MAX_BYTES } from '@lablo/protocol/backup-limits';
import type { BackupAnswer } from './backup-api';
import { BackupApi, readEnvelope } from './backup-api';
import { backupPlain, profileHash, readBackupPlain } from './backup-plain';
import type { ByteTransport } from './bytes';
import { getValue, onSuccess, transact } from './idb';
import type { AnyProfile } from './profile';
import { migrateProfile, putProfileIfNone, putProfileOver, storedProfileDoc } from './profile';
import type { RpcContext } from './rpc';
import { STORE } from './schema';
import type { Clock } from './throttle';
import { REAL_CLOCK } from './throttle';

/** `kv`'s key for the backup code (26 characters). */
export const BACKUP_CODE_KEY = 'backup.code';
/** `kv`'s key for the cached master (`MasterRecord`). */
export const BACKUP_MASTER_KEY = 'backup.master';
/** `kv`'s key for what was sent last (`SentRecord`, step 32c1). */
export const BACKUP_SENT_KEY = 'backup.sent';
/** `kv`'s key for "the backup is off" (`true`; step 32d2a). No key: on, as onboarding says. */
export const BACKUP_OFF_KEY = 'backup.off';

/**
 * What a held backup's restore clears with the profile it replaces (step 32d2b): every catalog and
 * guide, so the TV holds what a first-start restore leaves, and the app reads them all again.
 */
export const RESTORE_CLEARS: readonly string[] = [STORE.sources, STORE.chunks, STORE.cats, STORE.index, STORE.epgMeta, STORE.epgBuckets, STORE.epgChannels];

/** secretbox's tag, which the ciphertext adds to the plaintext. */
const TAG_BYTES = 16;

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

/** An upload's or a restore's request: `prepare`'s, and the API's origin (step 32c1). */
export interface BackupCallRequest extends BackupPrepareRequest {
  /** `http(s)://host[:port]`, no path (`?api=` in tests). */
  base: string;
}

/** Why a request gave nothing: no connection, the time limit, an unexpected status, 429. */
export type BackupFailure = 'network' | 'timeout' | 'status' | 'rate';

export type BackupUploadResult =
  /** Sent now. */
  | { readonly state: 'sent' }
  /** Unchanged since the last send: no request. */
  | { readonly state: 'same' }
  /** Nothing to send: no profile, a newer one, or no source yet. */
  | { readonly state: 'none' }
  /** A backup this TV hasn't seen is under its lookup ID: never written over. */
  | { readonly state: 'held' }
  /** The plaintext is over the API's size (nothing sent). */
  | { readonly state: 'too-large' }
  /** The backup is off (step 32d2a): nothing sent; copies still to delete were tried. */
  | { readonly state: 'off' }
  | { readonly state: 'failed'; readonly failure: BackupFailure };

/** What Settings' backup page shows (step 32d2a). */
export interface BackupStatus {
  readonly on: boolean;
  /** Where the master comes from for this request's secret. */
  readonly source: BackupSource;
  /** The backup code (26 characters), only while on with the code as the secret. */
  readonly code: string | null;
  /** When the copy on the server was last written (a send or a restore); `null`: not yet. */
  readonly sentAt: number | null;
  /** Off, with copies on the server not deleted yet (each upload tries again). */
  readonly deleting: boolean;
}

/** Turning the backup on or off (step 32d2a). */
export interface BackupSwitchRequest extends BackupCallRequest {
  on: boolean;
}

/** Turning the backup off or on (step 32d2a): off answers whether every copy is deleted. */
export type BackupSwitchResult = { readonly state: 'on' } | { readonly state: 'off'; readonly deleted: boolean };

export type BackupRestoreResult =
  /** The backup's profile is now the TV's: its language (`null`: none picked) and how many sources it has. */
  | { readonly state: 'restored'; readonly language: string | null; readonly sources: number }
  /** A profile is there: never written over. */
  | { readonly state: 'kept' }
  /** No backup under this TV's lookup ID. */
  | { readonly state: 'none' }
  /** Something is there that isn't this TV's envelope or profile. */
  | { readonly state: 'unreadable' }
  /** The profile is from a newer app version. */
  | { readonly state: 'newer' }
  | { readonly state: 'failed'; readonly failure: BackupFailure };

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

/** A copy under a lookup ID this TV no longer writes, to delete with its own token. */
export interface OldCopy {
  lookupId: string;
  token: string;
}

/**
 * What `kv` keeps of the sends (`backup.sent`): the lookup ID this TV writes (claimed before its
 * first `PUT`; `''` while the backup is off), its token, the hash of the document sent last (`''`:
 * none yet), the old copies, and when the copy on the server was last written (`null`: not yet;
 * a record from before step 32d2a has none).
 */
export interface SentRecord {
  lookupId: string;
  token: string;
  hash: string;
  old: OldCopy[];
  sentAt: number | null;
}

/** The master's derivation (scrypt; a stand-in in tests). */
export type DeriveMaster = (secret: string, platform: string, appId: string, onProgress?: (fraction: number) => void) => Promise<Uint8Array>;

export interface BackupServiceOptions {
  openDb: () => Promise<IDBDatabase>;
  /** Default `deriveBackupMaster`. */
  derive?: DeriveMaster;
  /** Default `randomBytes` (the platform's CSPRNG). */
  random?: (length: number) => Uint8Array;
  /** The API's transport (`fetchTransport` in the worker); `upload` and `restore` need it. */
  transport?: ByteTransport;
  /** The clock for the requests' time limit and the restored profile's save time (default the real one). */
  clock?: Clock;
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

const isOldCopy = (copy: unknown): copy is OldCopy =>
  typeof copy === 'object' && copy !== null && typeof (copy as OldCopy).lookupId === 'string' && typeof (copy as OldCopy).token === 'string';

/** `record` as a `SentRecord`, or `null` when it isn't one (a broken record counts as no send). */
export function readSentRecord(record: unknown): SentRecord | null {
  if (!isOldCopy(record)) return null;
  const { hash, old, sentAt } = record as Partial<SentRecord>;
  if (typeof hash !== 'string' || !Array.isArray(old)) return null;
  const copies: OldCopy[] = [];
  for (let i = 0; i < old.length; i++) if (isOldCopy(old[i])) copies.push({ lookupId: old[i]!.lookupId, token: old[i]!.token });
  return { lookupId: record.lookupId, token: record.token, hash, old: copies, sentAt: typeof sentAt === 'number' && Number.isFinite(sentAt) ? sentAt : null };
}

/** The copies a send record names on the server: its own lookup ID's (none while off), then the old ones. */
function copiesOf(sent: SentRecord): OldCopy[] {
  const copies: OldCopy[] = sent.lookupId === '' ? [] : [{ lookupId: sent.lookupId, token: sent.token }];
  for (let i = 0; i < sent.old.length; i++) copies.push(sent.old[i]!);
  return copies;
}

function checkRequest(request: BackupPrepareRequest): void {
  const { platform, appId, secret } = request;
  if (typeof platform !== 'string' || platform === '' || typeof appId !== 'string' || appId === '') {
    throw new TypeError('A backup request needs the platform and the app id');
  }
  if (secret !== null && (typeof secret !== 'string' || secret === '')) throw new TypeError("A backup request's secret is a device ID or null");
}

const ORIGIN = /^https?:\/\/[^/?#\s]+$/i;

function checkCall(request: BackupCallRequest): void {
  checkRequest(request);
  // (`exec` reads anything that isn't text as text, which never matches.)
  if (ORIGIN.exec(request.base) === null) throw new TypeError("A backup call's base is the API's http(s) origin");
}

/** The stored document worth sending (this version's shape, at least one source), or `null`. */
function worthSending(stored: unknown): AnyProfile | null {
  // (No profile, `undefined`, has no version: `migrateProfile` throws.)
  let migrated: ReturnType<typeof migrateProfile>;
  try {
    migrated = migrateProfile(stored);
  } catch {
    return null;
  }
  const sources = (migrated.doc as { sources?: unknown }).sources;
  return !migrated.newer && Array.isArray(sources) && sources.length > 0 ? migrated.doc : null;
}

/** A failed request's reason: its own failure, 429, or any status the caller didn't expect. */
function failure(answer: BackupAnswer): { readonly state: 'failed'; readonly failure: BackupFailure } {
  if (answer.failure === 'network' || answer.failure === 'timeout') return { state: 'failed', failure: answer.failure };
  return { state: 'failed', failure: answer.failure === null && answer.status === 429 ? 'rate' : 'status' };
}

/** A restore's answer: the restored profile's language (`null`: none picked) and how many sources it has. */
function restoredAnswer(doc: AnyProfile): BackupRestoreResult {
  // Read from the document as it is: an odd one (no answers, no list) still restores.
  const { onboarding, sources } = doc as { onboarding?: { language?: unknown } | null; sources?: unknown };
  const language = onboarding !== undefined && onboarding !== null && typeof onboarding.language === 'string' ? onboarding.language : null;
  return { state: 'restored', language, sources: Array.isArray(sources) ? sources.length : 0 };
}

export class BackupService {
  private readonly derive: DeriveMaster;
  private readonly random: (length: number) => Uint8Array;
  private readonly clock: Clock;

  constructor(private readonly options: BackupServiceOptions) {
    this.derive = options.derive ?? deriveBackupMaster;
    this.random = options.random ?? randomBytes;
    this.clock = options.clock ?? REAL_CLOCK;
  }

  /** Makes sure a master for this request's secret is kept; see the module's comment. */
  async prepare(request: BackupPrepareRequest, onProgress?: (fraction: number) => void): Promise<BackupPrepareResult> {
    checkRequest(request);
    const db = await this.options.openDb();
    try {
      const { source, derived } = await this.master(db, request, onProgress);
      return { source, derived };
    } finally {
      db.close();
    }
  }

  /** Sends the profile when it changed; see the module's comment. */
  upload(request: BackupCallRequest): Promise<BackupUploadResult> {
    return this.send(request, false);
  }

  /** Sends the profile over a held backup (step 32d2a): no `GET` first; else as `upload`. */
  replaceHeld(request: BackupCallRequest): Promise<BackupUploadResult> {
    return this.send(request, true);
  }

  /** What Settings' backup page shows; see the module's comment. */
  async status(request: BackupPrepareRequest): Promise<BackupStatus> {
    checkRequest(request);
    const db = await this.options.openDb();
    try {
      const on = !(await this.isOff(db));
      const source: BackupSource = request.secret === null ? 'code' : 'device';
      const sent = readSentRecord(await this.kvValue(db, BACKUP_SENT_KEY));
      return {
        on,
        source,
        code: on && source === 'code' ? await this.keepCode(db) : null,
        sentAt: on && sent !== null ? sent.sentAt : null,
        deleting: !on && sent !== null,
      };
    } finally {
      db.close();
    }
  }

  /**
   * Turns the backup on or off; see the module's comment. Off also deletes the copy under this
   * request's lookup ID (a held one too: this TV's secret wrote it, and off means no copy).
   */
  async setEnabled(request: BackupSwitchRequest): Promise<BackupSwitchResult> {
    checkCall(request);
    if (typeof request.on !== 'boolean') throw new TypeError('A backup switch is on or off');
    const api = this.api();
    const db = await this.options.openDb();
    try {
      if (request.on) {
        await transact(db, STORE.kv, 'readwrite', (tx) => {
          tx.objectStore(STORE.kv).delete(BACKUP_OFF_KEY);
        });
        return { state: 'on' };
      }
      await transact(db, STORE.kv, 'readwrite', (tx) => {
        tx.objectStore(STORE.kv).put(true, BACKUP_OFF_KEY);
      });
      const sent = readSentRecord(await this.kvValue(db, BACKUP_SENT_KEY));
      const keys = backupKeys((await this.master(db, request)).master);
      const copies = sent === null ? [] : copiesOf(sent);
      if (!copies.some((copy) => copy.lookupId === keys.lookupId)) copies.push({ lookupId: keys.lookupId, token: keys.writeToken });
      return { state: 'off', deleted: await this.forget(db, api, request.base, copies) };
    } finally {
      db.close();
    }
  }

  /** Looks for this TV's backup and restores it where there is no profile; see the module's comment. */
  async restore(request: BackupCallRequest, onProgress?: (fraction: number) => void): Promise<BackupRestoreResult> {
    checkCall(request);
    const secret = request.secret;
    if (secret === null) throw new TypeError('A restore needs the device ID');
    const api = this.api();
    const db = await this.options.openDb();
    try {
      if ((await storedProfileDoc(db)) !== undefined) return { state: 'kept' };
      // In memory only: nothing derived is kept unless a backup is restored.
      const master = await this.derive(secret, request.platform, request.appId, onProgress);
      const keys = backupKeys(master);
      const found = await this.fetch(api, request.base, keys);
      if (!('doc' in found)) return found;
      const record: MasterRecord = { source: 'device', check: secretCheck(request.platform, request.appId, secret), master: toBase64Url(master) };
      const now = this.clock.now();
      // The document the server holds (an older version's is sent again, upgraded, at the next upload).
      const sent: SentRecord = { lookupId: keys.lookupId, token: keys.writeToken, hash: found.hash, old: [], sentAt: now };
      const written = await transact<boolean>(db, [STORE.profile, STORE.kv], 'readwrite', (tx, done) => {
        done(false);
        putProfileIfNone(tx.objectStore(STORE.profile), found.doc, now, (put) => {
          if (!put) return;
          const kv = tx.objectStore(STORE.kv);
          kv.put(record, BACKUP_MASTER_KEY);
          kv.put(sent, BACKUP_SENT_KEY);
          done(true);
        });
      });
      return written ? restoredAnswer(found.doc) : { state: 'kept' };
    } finally {
      db.close();
    }
  }

  /**
   * Restores the backup under this request's lookup ID over the profile (step 32d2a: a held one,
   * from Settings); see the module's comment. `kept`: the profile there is from a newer app.
   */
  async restoreHeld(request: BackupCallRequest): Promise<BackupRestoreResult> {
    checkCall(request);
    const api = this.api();
    const db = await this.options.openDb();
    try {
      const keys = backupKeys((await this.master(db, request)).master);
      const found = await this.fetch(api, request.base, keys);
      if (!('doc' in found)) return found;
      const before = readSentRecord(await this.kvValue(db, BACKUP_SENT_KEY));
      // The copies this TV wrote under another lookup ID are still to delete.
      const old = before === null ? [] : copiesOf(before).filter((copy) => copy.lookupId !== keys.lookupId);
      const now = this.clock.now();
      const sent: SentRecord = { lookupId: keys.lookupId, token: keys.writeToken, hash: found.hash, old, sentAt: now };
      const written = await transact<boolean>(db, [STORE.profile, STORE.kv, ...RESTORE_CLEARS], 'readwrite', (tx, done) => {
        done(false);
        putProfileOver(tx.objectStore(STORE.profile), found.doc, now, (put) => {
          if (!put) return;
          tx.objectStore(STORE.kv).put(sent, BACKUP_SENT_KEY);
          // The replaced profile's catalogs and guides go with it (step 32d2b): source ids start
          // again at `s1` after a wipe, so its `s1` may be another server than the backup's.
          for (let i = 0; i < RESTORE_CLEARS.length; i++) tx.objectStore(RESTORE_CLEARS[i]!).clear();
          done(true);
        });
      });
      return written ? restoredAnswer(found.doc) : { state: 'kept' };
    } finally {
      db.close();
    }
  }

  /** `upload`, or with `replace` written over a held backup; see the module's comment. */
  private async send(request: BackupCallRequest, replace: boolean): Promise<BackupUploadResult> {
    checkCall(request);
    const api = this.api();
    const db = await this.options.openDb();
    try {
      const sent = readSentRecord(await this.kvValue(db, BACKUP_SENT_KEY));
      if (await this.isOff(db)) {
        // Only the copies still to delete.
        if (sent !== null) await this.forget(db, api, request.base, copiesOf(sent));
        return { state: 'off' };
      }
      const doc = worthSending(await storedProfileDoc(db));
      if (doc === null) return { state: 'none' };
      const json = JSON.stringify(doc);
      const hash = profileHash(json);
      const keys = backupKeys((await this.master(db, request)).master);
      const ours = sent !== null && sent.lookupId === keys.lookupId;
      // The copies to delete once this lookup ID holds the profile: those kept, and the last send's when it was another.
      const old: OldCopy[] = [];
      // A copy of this lookup ID still to delete (off, then on again before its delete went) is this TV's: written over without the GET.
      let own = replace;
      if (sent !== null) {
        for (let i = 0; i < sent.old.length; i++) {
          if (sent.old[i]!.lookupId === keys.lookupId) own = true;
          else old.push(sent.old[i]!);
        }
        if (!ours && sent.lookupId !== '') old.push({ lookupId: sent.lookupId, token: sent.token });
      }
      let state: 'sent' | 'same' = 'same';
      if (!ours || sent.hash !== hash) {
        if (!ours) {
          if (!own) {
            const there = await api.get(request.base, keys.lookupId, false);
            if (there.failure !== null || (there.status !== 200 && there.status !== 404)) return failure(there);
            if (there.status === 200) return { state: 'held' };
          }
          // Claimed before the PUT: one that fails is sent again without the GET.
          await this.keepSent(db, { lookupId: keys.lookupId, token: keys.writeToken, hash: '', old, sentAt: sent === null ? null : sent.sentAt });
        }
        const plain = backupPlain(json);
        if (plain.length + TAG_BYTES > BACKUP_CT_MAX_BYTES) return { state: 'too-large' };
        const put = await api.put(request.base, keys.lookupId, keys.writeToken, sealBackup(plain, keys.encKey));
        if (put.failure === null && put.status === 413) return { state: 'too-large' };
        if (put.failure !== null || put.status !== 200) return failure(put);
        state = 'sent';
      }
      const left = await this.deleteOld(api, request.base, old);
      // Unchanged, with no old copy gone: nothing to write.
      if (state === 'same' && left.length === old.length) return { state };
      await this.keepSent(db, { lookupId: keys.lookupId, token: keys.writeToken, hash, old: left, sentAt: state === 'sent' || sent === null ? this.clock.now() : sent.sentAt });
      return { state };
    } finally {
      db.close();
    }
  }

  /** The backup under `keys`' lookup ID, opened and upgraded to this version (with the hash of the document as stored), or why not. */
  private async fetch(api: BackupApi, base: string, keys: ReturnType<typeof backupKeys>): Promise<{ readonly doc: AnyProfile; readonly hash: string } | BackupRestoreResult> {
    const answer = await api.get(base, keys.lookupId, true);
    if (answer.failure === 'too-large') return { state: 'unreadable' };
    if (answer.failure === null && answer.status === 404) return { state: 'none' };
    if (answer.failure !== null || answer.status !== 200) return failure(answer);
    const envelope = readEnvelope(answer.text);
    const plain = envelope === null ? null : openBackup(envelope, keys.encKey);
    const stored = plain === null ? null : readBackupPlain(plain);
    if (stored === null) return { state: 'unreadable' };
    // (Its version was read: the migrations, pure, can't fail on it.)
    const migrated = migrateProfile(stored);
    if (migrated.newer) return { state: 'newer' };
    return { doc: migrated.doc, hash: profileHash(JSON.stringify(stored)) };
  }

  /** The backup is off (`backup.off`; one that can't be read counts as on, as onboarding says). */
  private async isOff(db: IDBDatabase): Promise<boolean> {
    return (await this.kvValue(db, BACKUP_OFF_KEY)) === true;
  }

  /**
   * Deletes `copies` with their own tokens. What is left is kept in `backup.sent` under no lookup ID
   * of its own, or the record goes when nothing is. Answers whether every copy went.
   */
  private async forget(db: IDBDatabase, api: BackupApi, base: string, copies: OldCopy[]): Promise<boolean> {
    const left = await this.deleteOld(api, base, copies);
    if (left.length > 0) {
      await this.keepSent(db, { lookupId: '', token: '', hash: '', old: left, sentAt: null });
    } else {
      await transact(db, STORE.kv, 'readwrite', (tx) => {
        tx.objectStore(STORE.kv).delete(BACKUP_SENT_KEY);
      });
    }
    return left.length === 0;
  }

  private api(): BackupApi {
    const transport = this.options.transport;
    if (transport === undefined) throw new Error('This backup service has no transport');
    return new BackupApi(transport, this.clock);
  }

  /** The master for `request`'s secret: the kept one, or derived now and kept (best effort). */
  private async master(db: IDBDatabase, request: BackupPrepareRequest, onProgress?: (fraction: number) => void): Promise<{ source: BackupSource; derived: boolean; master: Uint8Array }> {
    const source: BackupSource = request.secret === null ? 'code' : 'device';
    const secret = request.secret === null ? await this.keepCode(db) : request.secret;
    const check = secretCheck(request.platform, request.appId, secret);
    const kept = readMasterRecord(await this.kvValue(db, BACKUP_MASTER_KEY), check);
    if (kept !== null) return { source, derived: false, master: kept };
    const master = await this.derive(secret, request.platform, request.appId, onProgress);
    const record: MasterRecord = { source, check, master: toBase64Url(master) };
    try {
      await transact(db, STORE.kv, 'readwrite', (tx) => {
        tx.objectStore(STORE.kv).put(record, BACKUP_MASTER_KEY);
      });
    } catch {
      // Derived again at the next call; this one still did its work.
    }
    return { source, derived: true, master };
  }

  /** A `kv` value, or `undefined` when it can't be read (a broken record counts as none). */
  private async kvValue(db: IDBDatabase, key: string): Promise<unknown> {
    try {
      return await getValue<unknown>(db, STORE.kv, key);
    } catch {
      return undefined;
    }
  }

  private keepSent(db: IDBDatabase, record: SentRecord): Promise<void> {
    return transact(db, STORE.kv, 'readwrite', (tx) => {
      tx.objectStore(STORE.kv).put(record, BACKUP_SENT_KEY);
    });
  }

  /** Deletes each old copy with its own token; answers the ones still to delete (no answer, or one the API may give another time). */
  private async deleteOld(api: BackupApi, base: string, old: readonly OldCopy[]): Promise<OldCopy[]> {
    const left: OldCopy[] = [];
    for (let i = 0; i < old.length; i++) {
      const copy = old[i]!;
      const answer = await api.remove(base, copy.lookupId, copy.token);
      // Deleted, gone, or not this token's (claimed again by another TV after the sweep): forgotten.
      if (answer.failure === null && (answer.status === 200 || answer.status === 404 || answer.status === 401)) continue;
      left.push(copy);
    }
    return left;
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
    upload: (request: BackupCallRequest): Promise<BackupUploadResult> => service.upload(request),
    restore: (request: BackupCallRequest, ctx: RpcContext): Promise<BackupRestoreResult> =>
      service.restore(request, percents((fraction) => ctx.emit('progress', fraction))),
    status: (request: BackupPrepareRequest): Promise<BackupStatus> => service.status(request),
    setEnabled: (request: BackupSwitchRequest): Promise<BackupSwitchResult> => service.setEnabled(request),
    restoreHeld: (request: BackupCallRequest): Promise<BackupRestoreResult> => service.restoreHeld(request),
    replaceHeld: (request: BackupCallRequest): Promise<BackupUploadResult> => service.replaceHeld(request),
  };
}
