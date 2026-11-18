// BackupService's upload and restore (RELAY step 32c1), against fake-indexeddb and the backup API
// in memory (backup-stand-in.ts, with the 32a server's rules), faults injected per request.
import { createHash } from 'node:crypto';
import type { BackupEnvelope } from '@lablo/crypto';
import { backupCodeText, backupKeys, openBackup, sealBackup, tokenHash, toBase64Url, utf8 } from '@lablo/crypto';
import { BACKUP_CT_MAX_BYTES } from '@lablo/protocol/backup-limits';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUP_ANSWER_MAX_BYTES, BACKUP_TIMEOUT_MS, envelopeBody, readEnvelope } from './backup-api';
import { backupPlain, profileHash, readBackupPlain } from './backup-plain';
import type { BackupCallRequest, BackupEvents, MasterRecord, SentRecord } from './backup-service';
import { BACKUP_MASTER_KEY, BACKUP_SENT_KEY, BackupService, backupHandlers, readSentRecord, secretCheck } from './backup-service';
import type { BackupStandIn } from './backup-stand-in';
import { backupStandIn } from './backup-stand-in';
import type { ByteRequest, ByteResponse, ByteTransport } from './bytes';
import { NetworkError } from './bytes';
import { getValue, openDatabase, transact } from './idb';
import type { AnyProfile, ProfileDoc } from './profile';
import { PROFILE_VERSION, applyProfileEdit, emptyProfile, noPlayerMemory, saveProfile, storedProfileDoc, updateProfile } from './profile';
import type { RpcPort } from './rpc';
import { RpcClient, serveRpc } from './rpc';
import { STORE } from './schema';
import { freshFactory } from './test-support';
import type { Clock } from './throttle';

const BASE = 'http://api.test:8091';
const DEVICE: BackupCallRequest = { platform: 'webos', appId: 'com.lablo.iptv', secret: 'LGUDID-1', base: BASE };
const CODE: BackupCallRequest = { ...DEVICE, secret: null };
const NOW = 1_700_000_000_000;

const SOURCE = { id: 's1', type: 'xtream' as const, name: 'Panel', account: { base: 'http://panel.test', username: 'user1', password: 'pass-secret-1' }, added: 1 };
const FILE = { id: 's2', type: 'm3u-file' as const, name: 'Kitchen', added: 2 };
const ANSWERS = { language: 'ar', disclaimerAt: 5, consent: true };

function docWith(sources: unknown[], extra: Record<string, unknown> = {}): ProfileDoc {
  return { ...emptyProfile(), onboarding: ANSWERS, sources, ...extra } as ProfileDoc;
}
const DOC = docWith([SOURCE, FILE], { favourites: [{ key: 'x:s1:live:7', src: 's1', kind: 'live', normName: 'news', added: 3, missingSince: null }] });

const opened: IDBDatabase[] = [];
const ports: MessagePort[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const port of ports.splice(0)) port.close();
});

/** A master that says which secret, platform and app id it came from (32 bytes). */
function fakeMaster(secret: string, platform: string, appId: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`${secret}|${platform}|${appId}`).digest());
}

/** The 16 bytes of the backup code `random` gives (no two alike, in no symmetric order). */
const codeBytes = (): Uint8Array => Uint8Array.from({ length: 16 }, (_, i) => (i * i + 3) & 255);
/** The backup code those bytes make: a code request's secret. */
const CODE_SECRET = backupCodeText(codeBytes());

/** The keys of a request's secret (the fake master's); a code request's from the kept code. */
function keysOf(request: BackupCallRequest) {
  return backupKeys(fakeMaster(request.secret ?? CODE_SECRET, request.platform, request.appId));
}

/** A clock whose sleeps end only when the test says. */
function manualClock() {
  const sleepers: (() => void)[] = [];
  const clock: Clock = { now: () => NOW, sleep: () => new Promise<void>((resolve) => sleepers.push(resolve)) };
  return { clock, sleepers, expire: () => sleepers.splice(0).forEach((wake) => wake()) };
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(done()).toBe(true);
}

type FaultAnswer = 'network' | 'hang' | number;
interface Fault {
  readonly method: string;
  readonly answer?: FaultAnswer;
  /** Runs before the stand-in answers (the request then goes through). */
  readonly before?: () => Promise<void>;
}

function statusOnly(status: number): ByteResponse {
  return { status, header: () => null, read: () => Promise.resolve(null), cancel: () => undefined };
}

interface Options {
  factory?: IDBFactory;
  api?: BackupStandIn;
  clock?: Clock;
  wrap?: (db: IDBDatabase) => IDBDatabase;
}

function setup(options: Options = {}) {
  const factory = options.factory ?? freshFactory();
  const api = options.api ?? backupStandIn();
  const faults: Fault[] = [];
  /** Requests a fault answered (the stand-in never saw them). */
  const faulted: { method: string; answer: FaultAnswer }[] = [];
  const derived: string[] = [];
  let opens = 0;
  let closes = 0;
  const transport: ByteTransport = {
    async get(url: string, request: ByteRequest = {}): Promise<ByteResponse> {
      const method = request.method ?? 'GET';
      const at = faults.findIndex((f) => f.method === method);
      if (at !== -1) {
        const fault = faults.splice(at, 1)[0]!;
        if (fault.before) await fault.before();
        if (fault.answer !== undefined) {
          faulted.push({ method, answer: fault.answer });
          if (fault.answer === 'network') throw new NetworkError();
          if (fault.answer === 'hang') return new Promise<ByteResponse>(() => undefined);
          return statusOnly(fault.answer);
        }
      }
      return api.transport.get(url, request);
    },
  };
  const service = new BackupService({
    openDb: async () => {
      opens++;
      const db = await openDatabase(factory);
      opened.push(db);
      const close = db.close.bind(db);
      db.close = () => {
        closes++;
        close();
      };
      return options.wrap ? options.wrap(db) : db;
    },
    derive: (secret, platform, appId, onProgress) => {
      derived.push(secret);
      onProgress?.(0.5);
      onProgress?.(1);
      return Promise.resolve(fakeMaster(secret, platform, appId));
    },
    random: () => codeBytes(),
    transport,
    clock: options.clock ?? { now: () => NOW, sleep: () => new Promise<void>(() => undefined) },
  });
  return { factory, api, service, faults, faulted, derived, counts: () => ({ opens, closes }) };
}

async function db(factory: IDBFactory): Promise<IDBDatabase> {
  const d = await openDatabase(factory);
  opened.push(d);
  return d;
}
const kv = async (factory: IDBFactory, key: string): Promise<unknown> => getValue(await db(factory), STORE.kv, key);
async function putKv(factory: IDBFactory, key: string, value: unknown): Promise<void> {
  await transact(await db(factory), STORE.kv, 'readwrite', (tx) => {
    tx.objectStore(STORE.kv).put(value, key);
  });
}
const save = async (factory: IDBFactory, doc: ProfileDoc): Promise<void> => saveProfile(await db(factory), doc, { now: 1 });
/** Puts any document as the current profile, as an older or newer app would have. */
async function putRaw(factory: IDBFactory, doc: unknown): Promise<void> {
  await transact(await db(factory), STORE.profile, 'readwrite', (tx) => {
    tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 1, doc });
  });
}
const stored = async (factory: IDBFactory): Promise<unknown> => storedProfileDoc(await db(factory));
const record = async (factory: IDBFactory): Promise<unknown> => getValue(await db(factory), STORE.profile, 'current');

/** The document the stand-in holds under `request`'s lookup ID, opened with its keys. */
function held(api: BackupStandIn, request: BackupCallRequest): AnyProfile | null {
  const keys = keysOf(request);
  const envelope = readEnvelope(api.blobs.get(keys.lookupId) ?? null);
  const plain = envelope === null ? null : openBackup(envelope, keys.encKey);
  return plain === null ? null : readBackupPlain(plain);
}

/** Puts `doc` (any JSON) under `request`'s lookup ID with its token, sealed with its keys. */
async function putBackup(api: BackupStandIn, request: BackupCallRequest, plain: Uint8Array, key?: Uint8Array): Promise<void> {
  const keys = keysOf(request);
  const envelope: BackupEnvelope = sealBackup(plain, key ?? keys.encKey);
  const response = await api.transport.get(`${BASE}/v1/backup/${keys.lookupId}`, { method: 'PUT', headers: { 'x-write-token': keys.writeToken }, body: envelopeBody(envelope) });
  expect(response.status).toBe(200);
}

const lean = (api: BackupStandIn) => api.requests.map((r) => `${r.method} ${r.lookupId === keysOf(DEVICE).lookupId ? 'device' : r.lookupId === keysOf(CODE).lookupId ? 'code' : r.lookupId} ${r.token === null ? '-' : r.token === keysOf(DEVICE).writeToken ? 'device' : r.token === keysOf(CODE).writeToken ? 'code' : r.token} ${r.status}`);

function masterRecord(request: BackupCallRequest): MasterRecord {
  const secret = request.secret ?? CODE_SECRET;
  return { source: request.secret === null ? 'code' : 'device', check: secretCheck(request.platform, request.appId, secret), master: toBase64Url(fakeMaster(secret, request.platform, request.appId)) };
}
function sent(request: BackupCallRequest, doc: unknown, old: SentRecord['old'] = []): SentRecord {
  const keys = keysOf(request);
  return { lookupId: keys.lookupId, token: keys.writeToken, hash: doc === null ? '' : profileHash(JSON.stringify(doc)), old };
}

/** A database whose transactions of `mode` can't start. */
function failing(mode: IDBTransactionMode) {
  return (d: IDBDatabase): IDBDatabase => {
    const transaction = d.transaction.bind(d);
    d.transaction = ((stores: string | string[], m?: IDBTransactionMode) => {
      if ((m ?? 'readonly') === mode) throw new DOMException('Quota', 'QuotaExceededError');
      return transaction(stores, m);
    }) as IDBDatabase['transaction'];
    return d;
  };
}

describe("the backup's send record", () => {
  it('keeps its key (pinned: a TV that changed it would send its first upload again with a GET)', () => {
    expect(BACKUP_SENT_KEY).toBe('backup.sent');
  });

  it('is read back as written, old copies that are broken dropped', () => {
    const good = { lookupId: 'L', token: 'T', hash: 'H', old: [{ lookupId: 'L0', token: 'T0' }] };
    expect(readSentRecord(good)).toEqual(good);
    expect(readSentRecord({ ...good, old: [{ lookupId: 'L0' }, 'x', null, { lookupId: 'L1', token: 'T1', more: 1 }] })).toEqual({ ...good, old: [{ lookupId: 'L1', token: 'T1' }] });
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'sent'],
    ['no lookup ID', { token: 'T', hash: 'H', old: [] }],
    ['a token that is not text', { lookupId: 'L', token: 1, hash: 'H', old: [] }],
    ['no hash', { lookupId: 'L', token: 'T', old: [] }],
    ['a hash that is not text', { lookupId: 'L', token: 'T', hash: null, old: [] }],
    ['old copies that are not a list', { lookupId: 'L', token: 'T', hash: 'H', old: {} }],
  ])('is no send for %s', (_, value) => {
    expect(readSentRecord(value)).toBeNull();
  });
});

describe('BackupService.upload', () => {
  it.each([
    ['no profile', null],
    ['a profile with no source yet', docWith([])],
    ['a profile from a newer app version', { ...DOC, v: PROFILE_VERSION + 1 }],
    ['a profile with no version', { sources: [SOURCE] }],
    ['a profile whose sources are not a list', { ...DOC, sources: { s1: SOURCE } }],
    ['a profile whose sources are text', { ...DOC, sources: 's1' }],
  ])('sends nothing for %s: no key derived, no request', async (_, doc) => {
    const s = setup();
    if (doc !== null) await putRaw(s.factory, doc);
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'none' });
    expect(s.derived).toEqual([]);
    expect(s.api.requests).toEqual([]);
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toBeUndefined();
  });

  it('sends the profile the first time after a GET finds nothing there, logins and a file source by name, and keeps what it sent', async () => {
    const s = setup();
    await save(s.factory, DOC);
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
    expect(lean(s.api)).toEqual(['GET device - 404', 'PUT device device 200']);
    expect(held(s.api, DEVICE)).toEqual(DOC);
    // The stand-in holds ciphertext only, and the token's hash.
    const blob = s.api.blobs.get(keysOf(DEVICE).lookupId)!;
    for (const marker of ['pass-secret-1', 'Panel', 'Kitchen', 'user1']) expect(blob).not.toContain(marker);
    expect(s.api.hashes.get(keysOf(DEVICE).lookupId)).toBe(tokenHash(keysOf(DEVICE).writeToken));
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, DOC));
    // The master is kept as `prepare` keeps it.
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toEqual(masterRecord(DEVICE));
    expect(s.derived).toEqual(['LGUDID-1']);
    expect(s.counts()).toEqual({ opens: 1, closes: 1 });
  });

  it('sends nothing while the profile is unchanged, and only a PUT once it changed', async () => {
    const s = setup();
    await save(s.factory, DOC);
    await s.service.upload(DEVICE);
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'same' });
    expect(s.api.requests).toHaveLength(2);
    expect(s.derived).toHaveLength(1);

    expect(await updateProfile(await db(s.factory), (doc) => applyProfileEdit(doc, { kind: 'source', source: { ...SOURCE, name: 'Panel 2' } }))).toBe(true);
    const changed = await stored(s.factory);
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
    expect(lean(s.api).slice(2)).toEqual(['PUT device device 200']);
    expect(held(s.api, DEVICE)).toEqual(changed);
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, changed));
    expect(s.counts()).toEqual({ opens: 3, closes: 3 });
  });

  it('sends a profile an older app version stored as this version, and leaves the stored one as it was', async () => {
    const s = setup();
    const v7 = { v: 7, favourites: [], sources: [SOURCE], onboarding: ANSWERS, player: noPlayerMemory(), guides: [], progress: {}, shows: {}, channels: [] };
    await putRaw(s.factory, v7);
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
    expect(held(s.api, DEVICE)).toEqual({ ...v7, v: PROFILE_VERSION });
    expect(await stored(s.factory)).toEqual(v7);
  });

  it("holds the upload when a backup it hasn't seen is under its lookup ID, and writes nothing", async () => {
    const api = backupStandIn();
    const before = setup({ api });
    await save(before.factory, DOC);
    await before.service.upload(DEVICE);
    const blob = api.blobs.get(keysOf(DEVICE).lookupId);

    // The same TV after a wipe whose look-up failed: a new profile.
    const after = setup({ api });
    await save(after.factory, docWith([{ ...SOURCE, name: 'New' }]));
    expect(await after.service.upload(DEVICE)).toEqual({ state: 'held' });
    expect(lean(api).slice(2)).toEqual(['GET device - 200']);
    expect(api.blobs.get(keysOf(DEVICE).lookupId)).toBe(blob);
    expect(await kv(after.factory, BACKUP_SENT_KEY)).toBeUndefined();
    // Asked again later, it is held again.
    expect(await after.service.upload(DEVICE)).toEqual({ state: 'held' });
  });

  it('treats a broken send record as no send: the GET comes first', async () => {
    const s = setup();
    await save(s.factory, DOC);
    await putKv(s.factory, BACKUP_SENT_KEY, { lookupId: keysOf(DEVICE).lookupId, token: keysOf(DEVICE).writeToken, hash: 7, old: [] });
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
    expect(lean(s.api)).toEqual(['GET device - 404', 'PUT device device 200']);
  });

  it('claims the lookup ID before its first PUT: a PUT that failed is sent again without the GET', async () => {
    const s = setup();
    await save(s.factory, DOC);
    s.faults.push({ method: 'PUT', answer: 'network' });
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'failed', failure: 'network' });
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, null));
    expect(s.api.blobs.size).toBe(0);
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
    expect(lean(s.api)).toEqual(['GET device - 404', 'PUT device device 200']);
    expect(s.faulted).toEqual([{ method: 'PUT', answer: 'network' }]);
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, DOC));
  });

  it.each([
    ['no connection', 'network', 'network'],
    ['429', 429, 'rate'],
    ['500', 500, 'status'],
    ['401', 401, 'status'],
    ['204', 204, 'status'],
  ] as const)("fails when the first send's GET gives %s, claiming nothing and sending nothing", async (_, answer, failure) => {
    const s = setup();
    await save(s.factory, DOC);
    s.faults.push({ method: 'GET', answer });
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'failed', failure });
    expect(s.api.requests).toEqual([]);
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toBeUndefined();
    expect(s.counts()).toEqual({ opens: 1, closes: 1 });
  });

  it(`fails with \`timeout\` when the first send's GET has no answer in ${BACKUP_TIMEOUT_MS} ms`, async () => {
    const { clock, sleepers, expire } = manualClock();
    const s = setup({ clock });
    await save(s.factory, DOC);
    s.faults.push({ method: 'GET', answer: 'hang' });
    const pending = s.service.upload(DEVICE);
    await until(() => sleepers.length === 1);
    expire();
    expect(await pending).toEqual({ state: 'failed', failure: 'timeout' });
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toBeUndefined();
  });

  it.each([
    ['413', 413, { state: 'too-large' }],
    ['429', 429, { state: 'failed', failure: 'rate' }],
    ['401', 401, { state: 'failed', failure: 'status' }],
    ['500', 500, { state: 'failed', failure: 'status' }],
    ['201', 201, { state: 'failed', failure: 'status' }],
  ] as const)('answers a PUT refused with %s, the lookup ID claimed and nothing recorded as sent', async (_, answer, result) => {
    const s = setup();
    await save(s.factory, DOC);
    s.faults.push({ method: 'PUT', answer });
    expect(await s.service.upload(DEVICE)).toEqual(result);
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, null));
  });

  it("fails when the claim can't be written, before any PUT", async () => {
    const factory = freshFactory();
    await save(factory, DOC);
    // The master is kept first: only the claim's write fails.
    await setup({ factory }).service.prepare(DEVICE);
    const s = setup({ factory, wrap: failing('readwrite') });
    await expect(s.service.upload(DEVICE)).rejects.toMatchObject({ code: 'QuotaExceededError' });
    expect(lean(s.api)).toEqual(['GET device - 404']);
    expect(s.counts()).toEqual({ opens: 1, closes: 1 });
  });

  it("rejects when the record after the PUT can't be written: the claim stands, and the next upload sends again without the GET", async () => {
    const factory = freshFactory();
    await save(factory, DOC);
    const first = setup({ factory });
    first.faults.push({ method: 'PUT', answer: 500 });
    await first.service.upload(DEVICE);
    const s = setup({ factory, api: first.api, wrap: failing('readwrite') });
    await expect(s.service.upload(DEVICE)).rejects.toMatchObject({ code: 'QuotaExceededError' });
    // The PUT went: only the record is missing, and the claim still stands.
    expect(lean(s.api)).toEqual(['GET device - 404', 'PUT device device 200']);
    expect(await kv(factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, null));
    expect(await setup({ factory, api: first.api }).service.upload(DEVICE)).toEqual({ state: 'sent' });
    expect(lean(s.api).slice(2)).toEqual(['PUT device device 200']);
  });

  describe("the API's size", () => {
    // Text no gzip can shrink much (6 bits a character): a name of base64url from a SHA-256 stream.
    const noise = Array.from({ length: 16_500 }, (_, i) => createHash('sha256').update(`noise ${i}`).digest('base64url')).join('');
    const docOf = (n: number, salt: number) => docWith([{ ...SOURCE, name: noise.slice(salt, salt + n) }]);
    const plainOf = (n: number, salt: number) => backupPlain(JSON.stringify(docOf(n, salt))).length;

    /** A document whose plaintext is exactly `size` bytes. */
    function docOfPlain(size: number): ProfileDoc {
      for (let salt = 0; salt < 40; salt++) {
        let low = 1;
        let high = 650_000;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (plainOf(mid, salt) < size) low = mid + 1;
          else high = mid;
        }
        for (let n = low; n < low + 8; n++) if (plainOf(n, salt) === size) return docOf(n, salt);
      }
      throw new Error(`no document's plaintext is ${size} bytes`);
    }

    it(`sends a plaintext that fills the ciphertext's ${BACKUP_CT_MAX_BYTES} bytes, and refuses one byte more before sealing`, async () => {
      const fits = docOfPlain(BACKUP_CT_MAX_BYTES - 16);
      const s = setup();
      await save(s.factory, fits);
      expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
      expect(held(s.api, DEVICE)).toEqual(fits);

      const over = docOfPlain(BACKUP_CT_MAX_BYTES - 15);
      const t = setup();
      await save(t.factory, over);
      expect(await t.service.upload(DEVICE)).toEqual({ state: 'too-large' });
      expect(lean(t.api)).toEqual(['GET device - 404']);
    }, 60_000);
  });

  describe('old copies', () => {
    it('deletes the copy under the lookup ID it used before, with its own token, once the new one holds the profile', async () => {
      const s = setup();
      await save(s.factory, DOC);
      expect(await s.service.upload(CODE)).toEqual({ state: 'sent' });
      // Consent given later: the device ID's lookup ID.
      expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
      expect(lean(s.api)).toEqual(['GET code - 404', 'PUT code code 200', 'GET device - 404', 'PUT device device 200', 'DELETE code code 200']);
      expect([...s.api.blobs.keys()]).toEqual([keysOf(DEVICE).lookupId]);
      expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, DOC));
      expect(await s.service.upload(DEVICE)).toEqual({ state: 'same' });
      expect(s.api.requests).toHaveLength(5);
    });

    it('keeps an old copy it could not delete, and deletes it at a later upload of the same profile', async () => {
      const s = setup();
      await save(s.factory, DOC);
      await s.service.upload(CODE);
      s.faults.push({ method: 'DELETE', answer: 'network' });
      expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
      const code = keysOf(CODE);
      expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, DOC, [{ lookupId: code.lookupId, token: code.writeToken }]));
      expect(s.api.blobs.has(code.lookupId)).toBe(true);

      expect(await s.service.upload(DEVICE)).toEqual({ state: 'same' });
      expect(lean(s.api).slice(4)).toEqual(['DELETE code code 200']);
      expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, DOC));
      expect(await s.service.upload(DEVICE)).toEqual({ state: 'same' });
      expect(s.api.requests).toHaveLength(5);
    });

    it('writes nothing when nothing changed and the old copy still could not be deleted', async () => {
      const factory = freshFactory();
      const s = setup({ factory });
      await save(factory, DOC);
      await s.service.upload(CODE);
      s.faults.push({ method: 'DELETE', answer: 503 });
      await s.service.upload(DEVICE);
      const before = await kv(factory, BACKUP_SENT_KEY);
      // A write would fail here: the upload answers without one.
      const t = setup({ factory, api: s.api, wrap: failing('readwrite') });
      t.faults.push({ method: 'DELETE', answer: 'network' });
      expect(await t.service.upload(DEVICE)).toEqual({ state: 'same' });
      expect(t.faulted).toEqual([{ method: 'DELETE', answer: 'network' }]);
      expect(await kv(factory, BACKUP_SENT_KEY)).toEqual(before);
    });

    it.each([
      ['404 (gone already)', 404, false],
      ['401 (claimed again by another token after the sweep)', 401, false],
      ['500', 500, true],
      ['429', 429, true],
      ['no connection', 'network', true],
    ] as const)('after a DELETE answered %s, %s', async (_, answer, kept) => {
      const s = setup();
      await save(s.factory, DOC);
      await s.service.upload(CODE);
      s.faults.push({ method: 'DELETE', answer });
      expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
      const code = keysOf(CODE);
      expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, DOC, kept ? [{ lookupId: code.lookupId, token: code.writeToken }] : []));
    });

    it('keeps the old copy, and its record, while the new lookup ID is held', async () => {
      const api = backupStandIn();
      const other = setup({ api });
      await save(other.factory, DOC);
      await other.service.upload(DEVICE);
      const s = setup({ api });
      await save(s.factory, docWith([SOURCE]));
      await s.service.upload(CODE);
      expect(await s.service.upload(DEVICE)).toEqual({ state: 'held' });
      expect(api.blobs.has(keysOf(CODE).lookupId)).toBe(true);
      expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(CODE, docWith([SOURCE])));
    });

    it('carries an old copy still to delete over a second change of lookup ID', async () => {
      const s = setup();
      await save(s.factory, DOC);
      await s.service.upload(CODE);
      s.faults.push({ method: 'DELETE', answer: 'network' });
      await s.service.upload(DEVICE);
      const other: BackupCallRequest = { ...DEVICE, secret: 'LGUDID-2' };
      s.faults.push({ method: 'DELETE', answer: 'network' }, { method: 'DELETE', answer: 'network' });
      expect(await s.service.upload(other)).toEqual({ state: 'sent' });
      const code = keysOf(CODE);
      const device = keysOf(DEVICE);
      expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(
        sent(other, DOC, [
          { lookupId: code.lookupId, token: code.writeToken },
          { lookupId: device.lookupId, token: device.writeToken },
        ]),
      );
    });
  });

  it.each([
    ['an empty base', ''],
    ['a base with no scheme', 'api.test'],
    ['another scheme', 'ftp://api.test'],
    ['a trailing slash', 'http://api.test/'],
    ['a path', 'http://api.test/v1'],
    ['a query', 'http://api.test?x=1'],
    ['a fragment', 'http://api.test#x'],
    ['a space', 'http://api .test'],
    ['a base that is not text', 1 as unknown as string],
  ])('refuses a call with %s, before IndexedDB opens', async (_, base) => {
    const s = setup();
    await expect(s.service.upload({ ...DEVICE, base })).rejects.toThrow(TypeError);
    await expect(s.service.restore({ ...DEVICE, base })).rejects.toThrow(TypeError);
    expect(s.counts().opens).toBe(0);
  });

  it('takes an https base, and one with a port', async () => {
    for (const base of ['https://api.lablo.example', 'HTTP://127.0.0.1:8091']) {
      const s = setup();
      expect(await s.service.upload({ ...DEVICE, base })).toEqual({ state: 'none' });
      expect(await s.service.restore({ ...DEVICE, base })).toEqual({ state: 'none' });
    }
  });

  it('refuses a request without a platform, or with a secret that is not one, and a service with no transport', async () => {
    const s = setup();
    await expect(s.service.upload({ ...DEVICE, platform: '' })).rejects.toThrow(TypeError);
    await expect(s.service.restore({ ...DEVICE, secret: '' })).rejects.toThrow(TypeError);
    const bare = new BackupService({ openDb: () => Promise.reject(new Error('not reached')) });
    await expect(bare.upload(DEVICE)).rejects.toThrow('This backup service has no transport');
    await expect(bare.restore(DEVICE)).rejects.toThrow('This backup service has no transport');
    expect(s.counts().opens).toBe(0);
  });
});

describe('BackupService.restore', () => {
  /** TV `before` sent `doc`; `after` is the same TV wiped. */
  async function wiped(doc: ProfileDoc = DOC, options: Options = {}) {
    const api = backupStandIn();
    const before = setup({ api });
    await save(before.factory, doc);
    expect(await before.service.upload(DEVICE)).toEqual({ state: 'sent' });
    return setup({ ...options, api });
  }

  it("restores this TV's backup where there is no profile: the profile, its master and what was sent, so the next upload sends nothing", async () => {
    const s = await wiped();
    const progress: number[] = [];
    expect(await s.service.restore(DEVICE, (f) => progress.push(f))).toEqual({ state: 'restored', language: 'ar', sources: 2 });
    expect(progress).toEqual([0.5, 1]);
    expect(await record(s.factory)).toEqual({ id: 'current', savedAt: NOW, doc: DOC });
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toEqual(masterRecord(DEVICE));
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, DOC));
    expect(lean(s.api).slice(2)).toEqual(['GET device - 200']);
    expect(s.derived).toEqual(['LGUDID-1']);
    expect(s.counts()).toEqual({ opens: 1, closes: 1 });

    expect(await s.service.upload(DEVICE)).toEqual({ state: 'same' });
    expect(s.api.requests).toHaveLength(3);
    expect(s.derived).toHaveLength(1);
  });

  it('answers the language as `null` when none was picked, and the sources it holds', async () => {
    const s = await wiped(docWith([SOURCE], { onboarding: { language: null, disclaimerAt: 5, consent: true } }));
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'restored', language: null, sources: 1 });
  });

  it('restores an odd document: no answers and no source list answer no language and no sources', async () => {
    for (const odd of [{ v: PROFILE_VERSION, favourites: [] }, { v: PROFILE_VERSION, onboarding: null, sources: 's1' }, { v: PROFILE_VERSION, onboarding: { disclaimerAt: 5 } }, { v: PROFILE_VERSION, onboarding: { language: 7 } }]) {
      const s = setup();
      await putBackup(s.api, DEVICE, backupPlain(JSON.stringify(odd)));
      expect(await s.service.restore(DEVICE)).toEqual({ state: 'restored', language: null, sources: 0 });
      expect(await stored(s.factory)).toEqual(odd);
    }
  });

  it('keeps a profile that is there: no key derived, no request', async () => {
    const s = await wiped();
    await save(s.factory, docWith([]));
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'kept' });
    expect(s.derived).toEqual([]);
    expect(s.api.requests).toHaveLength(2);
    expect(await stored(s.factory)).toEqual(docWith([]));
  });

  it('counts any stored profile as one, a broken one too', async () => {
    const s = await wiped();
    await putRaw(s.factory, 'broken');
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'kept' });
  });

  it('finds nothing under a lookup ID with no backup, and keeps nothing derived', async () => {
    const s = setup();
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'none' });
    expect(lean(s.api)).toEqual(['GET device - 404']);
    expect(s.derived).toEqual(['LGUDID-1']);
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toBeUndefined();
    expect(await stored(s.factory)).toBeUndefined();
  });

  const KEY = new Uint8Array(32).fill(3);
  it.each([
    ['an answer that is not JSON', (api: BackupStandIn) => api.blobs.set(keysOf(DEVICE).lookupId, 'nonsense')],
    ['an envelope of another version', (api: BackupStandIn) => api.blobs.set(keysOf(DEVICE).lookupId, '{"v":2,"kdf":"scrypt-15-8-1","nonce":"x","ct":"y"}')],
    ['an envelope that does not open with its key', (api: BackupStandIn) => putBackup(api, DEVICE, backupPlain(JSON.stringify(DOC)), KEY)],
    ['a plaintext that is not gzip', (api: BackupStandIn) => putBackup(api, DEVICE, utf8(JSON.stringify(DOC)))],
    ['a gzip that is not a profile', (api: BackupStandIn) => putBackup(api, DEVICE, backupPlain('[1]'))],
    ['an answer over the cap', (api: BackupStandIn) => api.blobs.set(keysOf(DEVICE).lookupId, 'a'.repeat(BACKUP_ANSWER_MAX_BYTES + 1))],
  ])('finds %s unreadable, and keeps nothing', async (_, put) => {
    const s = setup();
    await put(s.api);
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'unreadable' });
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toBeUndefined();
    expect(await stored(s.factory)).toBeUndefined();
  });

  it('takes an answer of exactly the cap (then finds it unreadable for what it is)', async () => {
    const s = setup();
    s.api.blobs.set(keysOf(DEVICE).lookupId, 'a'.repeat(BACKUP_ANSWER_MAX_BYTES));
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'unreadable' });
  });

  it('refuses a profile from a newer app version, and leaves the backup where it is', async () => {
    const s = setup();
    await putBackup(s.api, DEVICE, backupPlain(JSON.stringify({ ...DOC, v: PROFILE_VERSION + 1 })));
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'newer' });
    expect(s.api.blobs.has(keysOf(DEVICE).lookupId)).toBe(true);
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toBeUndefined();
    expect(await stored(s.factory)).toBeUndefined();
    // Its own upload then holds it.
    await save(s.factory, docWith([SOURCE]));
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'held' });
  });

  it("upgrades an older app version's backup, and sends the upgraded profile at the next upload", async () => {
    const s = setup();
    const v7 = { v: 7, favourites: [], sources: [SOURCE], onboarding: ANSWERS, player: noPlayerMemory(), guides: [], progress: {}, shows: {}, channels: [] };
    await putBackup(s.api, DEVICE, backupPlain(JSON.stringify(v7)));
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'restored', language: 'ar', sources: 1 });
    expect(await stored(s.factory)).toEqual({ ...v7, v: PROFILE_VERSION });
    // The send record holds what the server has: the older document.
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toEqual(sent(DEVICE, v7));
    expect(await s.service.upload(DEVICE)).toEqual({ state: 'sent' });
    expect(lean(s.api).slice(-1)).toEqual(['PUT device device 200']);
    expect(held(s.api, DEVICE)).toEqual({ ...v7, v: PROFILE_VERSION });
  });

  it.each([
    ['no connection', 'network', 'network'],
    ['429', 429, 'rate'],
    ['500', 500, 'status'],
    ['401', 401, 'status'],
    ['204', 204, 'status'],
  ] as const)('fails when the GET gives %s, and keeps nothing', async (_, answer, failure) => {
    const s = await wiped();
    s.faults.push({ method: 'GET', answer });
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'failed', failure });
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await stored(s.factory)).toBeUndefined();
    expect(s.counts()).toEqual({ opens: 1, closes: 1 });
  });

  it(`fails with \`timeout\` when the GET has no answer in ${BACKUP_TIMEOUT_MS} ms, and keeps nothing`, async () => {
    const { clock, sleepers, expire } = manualClock();
    const s = await wiped(DOC, { clock });
    s.faults.push({ method: 'GET', answer: 'hang' });
    const pending = s.service.restore(DEVICE);
    await until(() => sleepers.length === 1);
    expire();
    expect(await pending).toEqual({ state: 'failed', failure: 'timeout' });
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await stored(s.factory)).toBeUndefined();
  });

  it('never writes over a profile written while it looked', async () => {
    const s = await wiped();
    const meanwhile = docWith([{ ...SOURCE, name: 'Added meanwhile' }]);
    s.faults.push({ method: 'GET', before: () => save(s.factory, meanwhile) });
    expect(await s.service.restore(DEVICE)).toEqual({ state: 'kept' });
    expect(await stored(s.factory)).toEqual(meanwhile);
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await kv(s.factory, BACKUP_SENT_KEY)).toBeUndefined();
  });

  it('writes the profile and its records together, or none of them', async () => {
    const s = await wiped(DOC, { wrap: failing('readwrite') });
    await expect(s.service.restore(DEVICE)).rejects.toMatchObject({ code: 'QuotaExceededError' });
    expect(await stored(s.factory)).toBeUndefined();
    expect(await kv(s.factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(s.counts()).toEqual({ opens: 1, closes: 1 });
  });

  it('refuses a restore with no device ID (the backup code has its own path), before IndexedDB opens', async () => {
    const s = setup();
    await expect(s.service.restore(CODE)).rejects.toThrow('A restore needs the device ID');
    expect(s.counts().opens).toBe(0);
  });

  it('closes the database when the derivation fails', async () => {
    const factory = freshFactory();
    let opens = 0;
    let closes = 0;
    const service = new BackupService({
      openDb: async () => {
        opens++;
        const d = await openDatabase(factory);
        const close = d.close.bind(d);
        d.close = () => {
          closes++;
          close();
        };
        return d;
      },
      derive: () => Promise.reject(new Error('no memory')),
      transport: backupStandIn().transport,
    });
    await expect(service.restore(DEVICE)).rejects.toThrow('no memory');
    expect({ opens, closes }).toEqual({ opens: 1, closes: 1 });
  });
});

describe('backupHandlers: upload and restore (the backup worker)', () => {
  function serve(factory: IDBFactory, api: BackupStandIn) {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    const openDb = async () => db(factory);
    serveRpc(
      port1 as unknown as RpcPort,
      backupHandlers({
        openDb,
        derive: (secret, platform, appId, onProgress) => {
          for (const f of [0, 0.004, 0.5, 0.501, 1]) onProgress?.(f);
          return Promise.resolve(fakeMaster(secret, platform, appId));
        },
        transport: api.transport,
        clock: { now: () => NOW, sleep: () => new Promise<void>(() => undefined) },
      }),
    );
    return new RpcClient<ReturnType<typeof backupHandlers>, BackupEvents>(port2 as unknown as RpcPort);
  }

  it('sends over RPC, then restores into a wiped database with the progress in whole percents', async () => {
    const api = backupStandIn();
    const tv = freshFactory();
    await save(tv, DOC);
    const sender = serve(tv, api);
    const sendProgress: number[] = [];
    sender.on('progress', (f) => sendProgress.push(f));
    expect(await sender.call('upload', DEVICE)).toEqual({ state: 'sent' });
    // The upload derives with no progress pushed.
    expect(sendProgress).toEqual([]);
    sender.close();

    const restorer = serve(freshFactory(), api);
    const progress: number[] = [];
    restorer.on('progress', (f) => progress.push(f));
    expect(await restorer.call('restore', DEVICE)).toEqual({ state: 'restored', language: 'ar', sources: 2 });
    expect(progress).toEqual([0, 0.5, 1]);
    restorer.close();
  });
});
