/**
 * The backup on a real engine (RELAY steps 32b and 32c1): `BackupService` against an IndexedDB of
 * its own (`lablo-backup-check`, never the app's), from the shared crypto vectors' first backup
 * chain: the master and the backup code (32b); a profile sent to the backup API in memory
 * (`backupStandIn`: the vectors page has no server), unchanged so not sent again, and restored
 * after a wipe of the database (32c1), through the engine's own gzip, secretbox and IndexedDB;
 * then a held backup restored over a new profile (its catalogs cleared, 32d2b) and replaced, the
 * backup off (its copy deleted) and on again (32d2a); a send without the logins and links, and its
 * restore (32d4a); last, a send under the backup code and, after a wipe and onboarding's answers,
 * that code typed back (32d3b).
 * Its own entry point (`@lablo/data/check-backup`): the vectors page runs it in a Blob worker on
 * Chromium 53, 56 and 68 (`pnpm verify:engines`) and in current Chromium (`e2e/crypto-vectors.spec.ts`);
 * Node runs it with fake-indexeddb. The checks run in order and each one's error is its own failure.
 * It deletes its database first and last, so a page never leaves it half written.
 */
import type { CatalogItem } from '@lablo/core';
import { backupKeys, openBackup } from '@lablo/crypto';
import type { VectorResult } from '@lablo/crypto/check-vectors';
import { readEnvelope } from './backup-api';
import { readBackupPlain } from './backup-plain';
import type { BackupCallRequest, BackupPrepareRequest } from './backup-service';
import { BACKUP_CODE_KEY, BACKUP_MASTER_KEY, BackupService, readMasterRecord, secretCheck } from './backup-service';
import { backupStandIn } from './backup-stand-in';
import { deleteDatabase, getValue, openDatabase, transact } from './idb';
import { withoutLogins } from './logins';
import type { ProfileDoc, ProfileSnapshot } from './profile';
import { emptyProfile, listSnapshots, saveProfile, storedProfileDoc } from './profile';
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
  'backup.upload',
  'backup.same',
  'backup.code',
  'backup.codeKept',
  'backup.restore',
  'backup.held',
  'backup.restoreHeld',
  'backup.replaceHeld',
  'backup.off',
  'backup.on',
  'backup.noLogins',
  'backup.restoreNoLogins',
  'backup.codeUpload',
  'backup.restoreCode',
  'backup.cleanup',
];

/** The API's origin the checks call (the stand-in answers any). */
const CHECK_BASE = 'http://backup.check';

/** The profile the checks send and restore: an Arabic name, a login in its link, a favourite. */
export function checkProfile(): ProfileDoc {
  const doc = emptyProfile();
  doc.onboarding = { language: 'ar', disclaimerAt: 1, consent: true };
  doc.sources = [{ id: 's1', type: 'm3u', name: 'قنوات العائلة', url: 'http://user:pass@example.invalid/list.m3u', added: 1 }];
  doc.favourites = [{ key: 'm:s1:live:7', src: 's1', kind: 'live', normName: 'news', added: 2, missingSince: null }];
  return doc;
}

/** The profile of a new install whose look-up failed (step 32d2a): its own source, in English. */
export function otherProfile(): ProfileDoc {
  const doc = emptyProfile();
  doc.onboarding = { language: 'en', disclaimerAt: 2, consent: true };
  doc.sources = [{ id: 's1', type: 'm3u', name: 'Living room', url: 'http://example.invalid/new.m3u', added: 2 }];
  return doc;
}

/**
 * The profile with "Include logins and links" off (step 32d4a): an Xtream login, an M3U link and a
 * guide link each with a login in it, and a channel played last whose stream URL holds one.
 */
export function loginsProfile(): ProfileDoc {
  const doc = checkProfile();
  const item: CatalogItem = {
    key: 'x:s1:live:7',
    src: 's1',
    kind: 'live',
    name: 'الأخبار',
    normName: 'news',
    group: 'News',
    url: 'http://panel.invalid:8080/live/check-user/check-pass/7.ts',
    logo: null,
    epgId: 'news.tv',
    tvgName: null,
    matchName: 'news',
    chno: 7,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
  doc.sources = [
    { id: 's1', type: 'xtream', name: 'لوحة', account: { base: 'http://panel.invalid:8080', username: 'check-user', password: 'check-pass' }, added: 1 },
    { id: 's2', type: 'm3u', name: 'قنوات العائلة', url: 'http://lists.invalid/get.php?username=check-user&password=check-pass', added: 2 },
  ];
  doc.guides = [{ id: 'g1', url: 'http://epg.invalid/check-token/guide.xml' }];
  doc.player = { last: { item, number: 7, category: null, index: 0, started: 3 }, containers: {}, redirects: {}, tracks: {}, subtitleSize: null };
  doc.channels = [doc.player.last!];
  doc.backupLogins = false;
  return doc;
}

/** What a backup without logins must never hold of `loginsProfile`, and what it must keep. */
const LOGIN_MARKERS = ['check-user', 'check-pass', 'check-token', 'get.php', 'guide.xml', '/live/'];
const KEPT_MARKERS = ['"base":"http://panel.invalid:8080"', '"origin":"http://lists.invalid"', '"origin":"http://epg.invalid"', '"backupLogins":false'];

/** What `text` (a backup's JSON of `loginsProfile`) holds that it must not, and lacks that it must keep: `''` when neither (step 32d4a). */
export function backupLeaks(text: string): string {
  let out = '';
  for (let i = 0; i < LOGIN_MARKERS.length; i++) if (text.indexOf(LOGIN_MARKERS[i]!) !== -1) out += `holds ${LOGIN_MARKERS[i]!}; `;
  for (let i = 0; i < KEPT_MARKERS.length; i++) if (text.indexOf(KEPT_MARKERS[i]!) === -1) out += `lacks ${KEPT_MARKERS[i]!}; `;
  return out;
}

/** Onboarding's answers before a source is added (step 32d3b): what a typed code's restore writes over. */
export function answersOnly(): ProfileDoc {
  const doc = emptyProfile();
  doc.onboarding = { language: 'en', disclaimerAt: 3, consent: false };
  return doc;
}

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
  const api = backupStandIn();
  const service = new BackupService({ openDb: () => openDatabase(factory, { name }), transport: api.transport });
  const device: BackupPrepareRequest = { platform: vector.platform, appId: vector.appId, secret: vector.deviceSecret };
  const call: BackupCallRequest = { platform: vector.platform, appId: vector.appId, secret: vector.deviceSecret, base: CHECK_BASE };
  const sent = JSON.stringify(checkProfile());
  const noSecret: BackupPrepareRequest = { platform: vector.platform, appId: vector.appId, secret: null };
  const codeCall: BackupCallRequest = { ...noSecret, base: CHECK_BASE };
  const read = async (key: string): Promise<unknown> => {
    const db = await openDatabase(factory, { name });
    try {
      return await getValue<unknown>(db, STORE.kv, key);
    } finally {
      db.close();
    }
  };
  const withDb = async (use: (db: IDBDatabase) => Promise<void>): Promise<void> => {
    const db = await openDatabase(factory, { name });
    try {
      await use(db);
    } finally {
      db.close();
    }
  };
  const saveDoc = (doc: ProfileDoc): Promise<void> => withDb((db) => saveProfile(db, doc));
  /** The requests made since `from`: method and status. */
  const asked = (from: number): string =>
    api.requests
      .slice(from)
      .map((r) => r.method + ' ' + r.status)
      .join(', ');
  let master: Uint8Array | null = null;
  let code: unknown;
  /** The code the send under the backup code made (step 32d3b), to type back. */
  let sentCode: unknown;
  /** The document a backup without logins sends of `loginsProfile` (step 32d4a). */
  const bare = JSON.stringify(withoutLogins(loginsProfile()));

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
      // The kept master (no scrypt): the GET finds nothing, the PUT stores the envelope.
      name: 'backup.upload',
      run: async () => {
        const db = await openDatabase(factory, { name });
        try {
          await saveProfile(db, checkProfile());
        } finally {
          db.close();
        }
        const result = await service.upload(call);
        const asked = api.requests.map((r) => r.method + ' ' + r.status).join(', ');
        return same('state', result.state, 'sent') + same('requests', asked, 'GET 404, PUT 200') + same('lookupId', String(api.blobs.has(vector.lookupId)), 'true');
      },
    },
    {
      name: 'backup.same',
      run: async () => {
        const result = await service.upload(call);
        return same('state', result.state, 'same') + same('requests', String(api.requests.length), '2');
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
    {
      // A wipe, then the look-up: scrypt again, the GET, the envelope opened and gunzipped, the profile written with its records.
      name: 'backup.restore',
      run: async () => {
        await deleteDatabase(factory, name);
        const result = await service.restore(call);
        if (result.state !== 'restored') return same('state', result.state, 'restored');
        const db = await openDatabase(factory, { name });
        let restored: unknown;
        let kept: Uint8Array | null;
        try {
          restored = await storedProfileDoc(db);
          kept = readMasterRecord(await getValue<unknown>(db, STORE.kv, BACKUP_MASTER_KEY), secretCheck(vector.platform, vector.appId, vector.deviceSecret));
        } finally {
          db.close();
        }
        return (
          same('language', String(result.language), 'ar') +
          same('sources', String(result.sources), '1') +
          same('profile', JSON.stringify(restored), sent) +
          (kept === null ? 'no master kept' : same('master', toHex(kept), vector.master))
        );
      },
    },
    {
      // Step 32d2a: a wipe whose look-up failed, a new profile: its upload finds the backup and holds.
      name: 'backup.held',
      run: async () => {
        await deleteDatabase(factory, name);
        await saveDoc(otherProfile());
        const before = api.requests.length;
        const result = await service.upload(call);
        return same('state', result.state, 'held') + same('requests', asked(before), 'GET 200');
      },
    },
    {
      // "Restore it": the backup over the new profile, which is kept as a snapshot; the new
      // profile's catalog and guide go with it (step 32d2b).
      name: 'backup.restoreHeld',
      run: async () => {
        await withDb((db) =>
          transact(db, [STORE.sources, STORE.epgMeta], 'readwrite', (tx) => {
            tx.objectStore(STORE.sources).put({ src: 's1', gen: 1, building: null, nextGen: 2, updatedAt: 1, counts: {} });
            tx.objectStore(STORE.epgMeta).put({ epgSrc: 'u~g1', gen: 1, building: null, nextGen: 2, updatedAt: 1, checkedAt: 1, rank: 0 });
          }),
        );
        const before = api.requests.length;
        const result = await service.restoreHeld(call);
        if (result.state !== 'restored') return same('state', result.state, 'restored');
        const db = await openDatabase(factory, { name });
        let restored: unknown;
        let snaps: ProfileSnapshot[];
        let left: unknown[];
        try {
          restored = await storedProfileDoc(db);
          snaps = await listSnapshots(db);
          left = [await getValue<unknown>(db, STORE.sources, 's1'), await getValue<unknown>(db, STORE.epgMeta, 'u~g1')];
        } finally {
          db.close();
        }
        const snap = snaps.length === 1 ? snaps[0]! : null;
        return (
          same('requests', asked(before), 'GET 200') +
          same('catalogs', String(left[0] === undefined && left[1] === undefined), 'true') +
          same('profile', JSON.stringify(restored), sent) +
          (snap === null ? `${snaps.length} snapshots, expected 1; ` : same('snapshot', `${snap.reason} ${JSON.stringify(snap.doc)}`, `restore ${JSON.stringify(otherProfile())}`))
        );
      },
    },
    {
      // "Replace it": the new profile sent over the held backup, with no GET; then nothing to send.
      name: 'backup.replaceHeld',
      run: async () => {
        await deleteDatabase(factory, name);
        await saveDoc(otherProfile());
        const before = api.requests.length;
        const result = await service.replaceHeld(call);
        const again = await service.upload(call);
        return same('state', result.state, 'sent') + same('requests', asked(before), 'PUT 200') + same('then', again.state, 'same');
      },
    },
    {
      // Off: the flag, the copy deleted with its token; an upload then sends nothing.
      name: 'backup.off',
      run: async () => {
        const before = api.requests.length;
        const result = await service.setEnabled({ platform: call.platform, appId: call.appId, secret: call.secret, base: call.base, on: false });
        const upload = await service.upload(call);
        const status = await service.status(device);
        return (
          same('state', result.state === 'off' ? `off ${String(result.deleted)}` : result.state, 'off true') +
          same('requests', asked(before), 'DELETE 200') +
          same('copy', String(api.blobs.has(vector.lookupId)), 'false') +
          same('upload', upload.state, 'off') +
          same('status', `${String(status.on)} ${String(status.deleting)}`, 'false false')
        );
      },
    },
    {
      // On again: the next upload is a first send.
      name: 'backup.on',
      run: async () => {
        const result = await service.setEnabled({ platform: call.platform, appId: call.appId, secret: call.secret, base: call.base, on: true });
        const before = api.requests.length;
        const upload = await service.upload(call);
        return same('state', result.state, 'on') + same('upload', upload.state, 'sent') + same('requests', asked(before), 'GET 404, PUT 200');
      },
    },
    {
      // Step 32d4a: "Include logins and links" off: only a PUT, and the envelope, opened with the
      // kept master's key, holds the document without them (the servers' origins kept).
      name: 'backup.noLogins',
      run: async () => {
        await saveDoc(loginsProfile());
        const before = api.requests.length;
        const result = await service.upload(call);
        const kept = readMasterRecord(await read(BACKUP_MASTER_KEY), secretCheck(vector.platform, vector.appId, vector.deviceSecret));
        if (kept === null) return 'no master kept for the secret';
        const envelope = readEnvelope(api.blobs.get(backupKeys(kept).lookupId) ?? null);
        const plain = envelope === null ? null : openBackup(envelope, backupKeys(kept).encKey);
        const opened = plain === null ? null : readBackupPlain(plain);
        if (opened === null) return 'no envelope to open';
        const text = JSON.stringify(opened);
        return same('state', result.state, 'sent') + same('requests', asked(before), 'PUT 200') + same('plaintext', text, bare) + backupLeaks(text);
      },
    },
    {
      // Its restore over another profile ("Restore it", no scrypt): the sources and guides without
      // their logins, the choice back with them; then nothing to send.
      name: 'backup.restoreNoLogins',
      run: async () => {
        await saveDoc(otherProfile());
        const before = api.requests.length;
        const result = await service.restoreHeld(call);
        if (result.state !== 'restored') return same('state', result.state, 'restored');
        let restored: unknown;
        await withDb(async (db) => {
          restored = await storedProfileDoc(db);
        });
        const again = await service.upload(call);
        const text = JSON.stringify(restored);
        return same('requests', asked(before), 'GET 200') + same('sources', String(result.sources), '2') + same('profile', text, bare) + backupLeaks(text) + same('then', again.state, 'same');
      },
    },
    {
      // Step 32d3b: a TV that said "Not now" sends under a new backup code (scrypt for the code).
      name: 'backup.codeUpload',
      run: async () => {
        await deleteDatabase(factory, name);
        await saveDoc(checkProfile());
        const before = api.requests.length;
        const result = await service.upload(codeCall);
        sentCode = await read(BACKUP_CODE_KEY);
        const kept = typeof sentCode === 'string' && CODE.exec(sentCode) !== null ? '' : `no backup code kept (${String(sentCode)}); `;
        return same('state', result.state, 'sent') + same('requests', asked(before), 'GET 404, PUT 200') + kept;
      },
    },
    {
      // A wipe, onboarding's answers, then the code typed in lower case and in two groups: scrypt
      // again, the profile back over the answers, the code kept as this TV's own, nothing to send.
      name: 'backup.restoreCode',
      run: async () => {
        if (typeof sentCode !== 'string') return 'no backup code to type';
        const kept = sentCode;
        await deleteDatabase(factory, name);
        await saveDoc(answersOnly());
        const before = api.requests.length;
        const typed = kept.slice(0, 13).toLowerCase() + ' ' + kept.slice(13);
        const result = await service.restoreCode({ platform: vector.platform, appId: vector.appId, base: CHECK_BASE, code: typed });
        if (result.state !== 'restored') return same('state', result.state, 'restored');
        const db = await openDatabase(factory, { name });
        let restored: unknown;
        let ownCode: unknown;
        try {
          restored = await storedProfileDoc(db);
          ownCode = await getValue<unknown>(db, STORE.kv, BACKUP_CODE_KEY);
        } finally {
          db.close();
        }
        const again = await service.upload(codeCall);
        return (
          same('requests', asked(before), 'GET 200') +
          same('profile', JSON.stringify(restored), sent) +
          same('code', String(ownCode), kept) +
          same('then', again.state, 'same')
        );
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
