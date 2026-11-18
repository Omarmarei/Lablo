import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backupCodeText, backupKeys, deriveBackupMaster, toBase64Url } from '@lablo/crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackupEvents, BackupPrepareRequest, DeriveMaster, MasterRecord } from './backup-service';
import { BACKUP_CODE_KEY, BACKUP_MASTER_KEY, BackupService, backupHandlers, readMasterRecord, secretCheck } from './backup-service';
import { getValue, openDatabase, transact } from './idb';
import type { RpcPort } from './rpc';
import { RpcClient, serveRpc } from './rpc';
import { STORE } from './schema';
import { freshFactory } from './test-support';

const VECTOR = (
  JSON.parse(readFileSync(join(import.meta.dirname, '../../crypto/test/vectors.json'), 'utf8')) as {
    backup: { deviceSecret: string; platform: string; appId: string; master: string; lookupId: string }[];
  }
).backup[0]!;

const DEVICE: BackupPrepareRequest = { platform: 'webos', appId: 'com.lablo.iptv', secret: 'LGUDID-1' };
const CODE: BackupPrepareRequest = { platform: 'webos', appId: 'com.lablo.iptv', secret: null };

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

/** The 16 bytes `random` gives on its n-th call: no two alike, in no symmetric order. */
const codeBytes = (n: number): Uint8Array => Uint8Array.from({ length: 16 }, (_, i) => (n * 37 + i * i + 1) & 255);

interface Options {
  factory?: IDBFactory;
  /** Wraps each opened database (to make its transactions fail). */
  wrap?: (db: IDBDatabase) => IDBDatabase;
  derive?: DeriveMaster;
}

function setup(options: Options = {}) {
  const factory = options.factory ?? freshFactory();
  const derived: { secret: string; platform: string; appId: string; progress: boolean }[] = [];
  const randoms: number[] = [];
  let opens = 0;
  let closes = 0;
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
    derive:
      options.derive ??
      ((secret, platform, appId, onProgress) => {
        derived.push({ secret, platform, appId, progress: onProgress !== undefined });
        if (onProgress) {
          onProgress(0.5);
          onProgress(1);
        }
        return Promise.resolve(fakeMaster(secret, platform, appId));
      }),
    random: (length) => {
      expect(length).toBe(16);
      randoms.push(length);
      return codeBytes(randoms.length - 1);
    },
  });
  return { factory, service, derived, randoms, counts: () => ({ opens, closes }) };
}

async function kv(factory: IDBFactory, key: string): Promise<unknown> {
  const db = await openDatabase(factory);
  opened.push(db);
  return getValue(db, STORE.kv, key);
}

async function putKv(factory: IDBFactory, key: string, value: unknown): Promise<void> {
  const db = await openDatabase(factory);
  opened.push(db);
  await transact(db, STORE.kv, 'readwrite', (tx) => {
    tx.objectStore(STORE.kv).put(value, key);
  });
}

/** The record `prepare` keeps for a request (the fake master). */
function record(request: BackupPrepareRequest, secret: string, source: 'device' | 'code'): MasterRecord {
  return { source, check: secretCheck(request.platform, request.appId, secret), master: toBase64Url(fakeMaster(secret, request.platform, request.appId)) };
}

/** A database whose transactions of `mode` can't start. */
function failing(mode: IDBTransactionMode) {
  return (db: IDBDatabase): IDBDatabase => {
    const transaction = db.transaction.bind(db);
    db.transaction = ((stores: string | string[], m?: IDBTransactionMode) => {
      if ((m ?? 'readonly') === mode) throw new DOMException('Quota', 'QuotaExceededError');
      return transaction(stores, m);
    }) as IDBDatabase['transaction'];
    return db;
  };
}

describe("the backup's records in kv", () => {
  it('keep their keys (pinned: a TV that changed them would lose its code)', () => {
    expect(BACKUP_CODE_KEY).toBe('backup.code');
    expect(BACKUP_MASTER_KEY).toBe('backup.master');
  });
});

describe('secretCheck', () => {
  it("is b64url(SHA-256(UTF-8(the salt + '|' + the secret)))", () => {
    const expected = createHash('sha256').update('lablo.backup.v1|webos|com.lablo.iptv|LGUDID-1', 'utf8').digest('base64url');
    expect(secretCheck('webos', 'com.lablo.iptv', 'LGUDID-1')).toBe(expected);
    expect(secretCheck('webos', 'com.lablo.iptv', 'LGUDID-2')).not.toBe(expected);
    expect(secretCheck('tizen', 'com.lablo.iptv', 'LGUDID-1')).not.toBe(expected);
    expect(secretCheck('webos', 'other', 'LGUDID-1')).not.toBe(expected);
  });
});

describe('readMasterRecord', () => {
  const check = secretCheck('webos', 'app', 'secret');
  const master = toBase64Url(new Uint8Array(32).fill(7));

  it('gives the kept master for its own check', () => {
    expect(readMasterRecord({ source: 'device', check, master }, check)).toEqual(new Uint8Array(32).fill(7));
    expect(readMasterRecord({ source: 'code', check, master }, check)).toEqual(new Uint8Array(32).fill(7));
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', master],
    ['another check', { source: 'device', check: secretCheck('webos', 'app', 'other'), master }],
    ['no check', { source: 'device', master }],
    ['another source', { source: 'phone', check, master }],
    ['no source', { check, master }],
    ['a master that is not text', { source: 'device', check, master: [1, 2] }],
    ['a master of 31 bytes', { source: 'device', check, master: toBase64Url(new Uint8Array(31)) }],
    ['a master of 33 bytes', { source: 'device', check, master: toBase64Url(new Uint8Array(33)) }],
    ['a master that is not base64url', { source: 'device', check, master: `${master.slice(1)}=` }],
  ])('gives nothing for %s', (_, value) => {
    expect(readMasterRecord(value, check)).toBeNull();
  });
});

describe('BackupService.prepare', () => {
  it('derives a device secret once, with its progress, then reads the kept master', async () => {
    const { factory, service, derived, randoms, counts } = setup();
    const progress: number[] = [];
    expect(await service.prepare(DEVICE, (f) => progress.push(f))).toEqual({ source: 'device', derived: true });
    expect(derived).toEqual([{ secret: 'LGUDID-1', platform: 'webos', appId: 'com.lablo.iptv', progress: true }]);
    expect(progress).toEqual([0.5, 1]);
    expect(await kv(factory, BACKUP_MASTER_KEY)).toEqual(record(DEVICE, 'LGUDID-1', 'device'));
    // A device secret makes no code.
    expect(await kv(factory, BACKUP_CODE_KEY)).toBeUndefined();
    expect(randoms).toEqual([]);

    expect(await service.prepare(DEVICE)).toEqual({ source: 'device', derived: false });
    expect(derived).toHaveLength(1);
    // Each call closes the database it opened.
    expect(counts()).toEqual({ opens: 2, closes: 2 });
  });

  it("passes no progress listener when it has none", async () => {
    const { service, derived } = setup();
    await service.prepare(DEVICE);
    expect(derived).toEqual([{ secret: 'LGUDID-1', platform: 'webos', appId: 'com.lablo.iptv', progress: false }]);
  });

  it("keeps the shared vectors' master for their device secret, and backupKeys gives their lookup ID", async () => {
    const { factory, service } = setup({ derive: deriveBackupMaster });
    const request = { platform: VECTOR.platform, appId: VECTOR.appId, secret: VECTOR.deviceSecret };
    expect(await service.prepare(request)).toEqual({ source: 'device', derived: true });
    const kept = readMasterRecord(await kv(factory, BACKUP_MASTER_KEY), secretCheck(VECTOR.platform, VECTOR.appId, VECTOR.deviceSecret));
    expect(kept).not.toBeNull();
    expect(Buffer.from(kept!).toString('hex')).toBe(VECTOR.master);
    expect(backupKeys(kept!).lookupId).toBe(VECTOR.lookupId);
  }, 20_000);

  it('makes a backup code when there is no device secret, keeps it, and derives from it', async () => {
    const { factory, service, derived, randoms } = setup();
    expect(await service.prepare(CODE)).toEqual({ source: 'code', derived: true });
    const code = backupCodeText(codeBytes(0));
    expect(randoms).toEqual([16]);
    expect(await kv(factory, BACKUP_CODE_KEY)).toBe(code);
    expect(derived.map((d) => d.secret)).toEqual([code]);
    expect(await kv(factory, BACKUP_MASTER_KEY)).toEqual(record(CODE, code, 'code'));
  });

  it('reads the kept code back unchanged in a later worker, and its master too', async () => {
    const first = setup();
    await first.service.prepare(CODE);
    const code = backupCodeText(codeBytes(0));

    const later = setup({ factory: first.factory });
    expect(await later.service.prepare(CODE)).toEqual({ source: 'code', derived: false });
    expect(later.randoms).toEqual([]);
    expect(later.derived).toEqual([]);
    expect(await kv(first.factory, BACKUP_CODE_KEY)).toBe(code);

    // The master gone, the same code derives it again.
    await putKv(first.factory, BACKUP_MASTER_KEY, undefined);
    expect(await later.service.prepare(CODE)).toEqual({ source: 'code', derived: true });
    expect(later.derived.map((d) => d.secret)).toEqual([code]);
    expect(later.randoms).toEqual([]);
  });

  it('derives again when consent is given later, and keeps the code for a later "Not now"', async () => {
    const { factory, service, derived } = setup();
    await service.prepare(CODE);
    const code = backupCodeText(codeBytes(0));
    expect(await service.prepare(DEVICE)).toEqual({ source: 'device', derived: true });
    expect(await kv(factory, BACKUP_MASTER_KEY)).toEqual(record(DEVICE, 'LGUDID-1', 'device'));
    expect(await kv(factory, BACKUP_CODE_KEY)).toBe(code);
    expect(await service.prepare(CODE)).toEqual({ source: 'code', derived: true });
    expect(derived.map((d) => d.secret)).toEqual([code, 'LGUDID-1', code]);
  });

  it.each([
    ['another device secret', { ...DEVICE, secret: 'LGUDID-2' }],
    ['another platform', { ...DEVICE, platform: 'tizen' }],
    ['another app id', { ...DEVICE, appId: 'LabloIPTV1.Lablo' }],
  ])('derives again for %s', async (_, other) => {
    const { factory, service, derived } = setup();
    await service.prepare(DEVICE);
    expect(await service.prepare(other)).toEqual({ source: 'device', derived: true });
    expect(derived).toHaveLength(2);
    expect(await kv(factory, BACKUP_MASTER_KEY)).toEqual(record(other, other.secret!, 'device'));
  });

  it.each([
    ['a broken record', { source: 'device', check: 'x', master: 'y' }],
    ['a record of another secret', { source: 'device', check: secretCheck('webos', 'com.lablo.iptv', 'LGUDID-9'), master: toBase64Url(new Uint8Array(32)) }],
    ['a short master', { source: 'device', check: secretCheck('webos', 'com.lablo.iptv', 'LGUDID-1'), master: toBase64Url(new Uint8Array(16)) }],
    ['a string', 'master'],
  ])('replaces %s', async (_, value) => {
    const { factory, service } = setup();
    await putKv(factory, BACKUP_MASTER_KEY, value);
    expect(await service.prepare(DEVICE)).toEqual({ source: 'device', derived: true });
    expect(await kv(factory, BACKUP_MASTER_KEY)).toEqual(record(DEVICE, 'LGUDID-1', 'device'));
  });

  it.each([
    ['a number', 42],
    ['a code in lower case', backupCodeText(codeBytes(7)).toLowerCase()],
    ['a code with a dash', `${backupCodeText(codeBytes(7)).slice(0, 13)}-${backupCodeText(codeBytes(7)).slice(13)}`],
    ['a short code', backupCodeText(codeBytes(7)).slice(1)],
    ['an object', { code: backupCodeText(codeBytes(7)) }],
  ])('replaces a kept code that is %s', async (_, value) => {
    const { factory, service, derived } = setup();
    await putKv(factory, BACKUP_CODE_KEY, value);
    await service.prepare(CODE);
    const code = backupCodeText(codeBytes(0));
    expect(await kv(factory, BACKUP_CODE_KEY)).toBe(code);
    expect(derived.map((d) => d.secret)).toEqual([code]);
  });

  it('gives two workers asking at once one code', async () => {
    const factory = freshFactory();
    const one = setup({ factory });
    const two = setup({ factory });
    // `two` makes its code from other bytes: only one of the two codes may be kept and used.
    two.randoms.push(16, 16);
    await Promise.all([one.service.prepare(CODE), two.service.prepare(CODE)]);
    const kept = await kv(factory, BACKUP_CODE_KEY);
    expect([...one.derived, ...two.derived].map((d) => d.secret)).toEqual(expect.arrayContaining([kept]));
    for (const d of [...one.derived, ...two.derived]) expect(d.secret).toBe(kept);
    expect(one.randoms.length + two.randoms.length).toBe(3);
  });

  it("fails when the code can't be kept, before anything is derived", async () => {
    const { factory, service, derived } = setup({ wrap: failing('readwrite') });
    await expect(service.prepare(CODE)).rejects.toMatchObject({ code: 'QuotaExceededError' });
    expect(derived).toEqual([]);
    expect(await kv(factory, BACKUP_CODE_KEY)).toBeUndefined();
  });

  it("answers when the master can't be written, and derives again next time", async () => {
    const { factory, service, derived, counts } = setup({ wrap: failing('readwrite') });
    expect(await service.prepare(DEVICE)).toEqual({ source: 'device', derived: true });
    expect(await kv(factory, BACKUP_MASTER_KEY)).toBeUndefined();
    expect(await service.prepare(DEVICE)).toEqual({ source: 'device', derived: true });
    expect(derived).toHaveLength(2);
    expect(counts()).toEqual({ opens: 2, closes: 2 });
  });

  it("derives when the kept master can't be read", async () => {
    const factory = freshFactory();
    await setup({ factory }).service.prepare(DEVICE);
    const { service, derived } = setup({ factory, wrap: failing('readonly') });
    expect(await service.prepare(DEVICE)).toEqual({ source: 'device', derived: true });
    expect(derived).toHaveLength(1);
  });

  it('rejects when IndexedDB does not open', async () => {
    const service = new BackupService({ openDb: () => Promise.reject(new Error('blocked')), derive: () => Promise.reject(new Error('not reached')) });
    await expect(service.prepare(DEVICE)).rejects.toThrow('blocked');
  });

  it('closes the database when the derivation fails', async () => {
    const { service, counts } = setup({ derive: () => Promise.reject(new Error('no memory')) });
    await expect(service.prepare(DEVICE)).rejects.toThrow('no memory');
    expect(counts()).toEqual({ opens: 1, closes: 1 });
  });

  it.each([
    ['no platform', { ...DEVICE, platform: '' }],
    ['no app id', { ...DEVICE, appId: '' }],
    ['a platform that is not text', { ...DEVICE, platform: 1 as unknown as string }],
    ['an app id that is not text', { ...DEVICE, appId: null as unknown as string }],
    ['an empty secret', { ...DEVICE, secret: '' }],
    ['a secret that is not text', { ...DEVICE, secret: 42 as unknown as string }],
    ['no secret field', { platform: 'webos', appId: 'app' } as unknown as BackupPrepareRequest],
  ])('refuses a request with %s, before IndexedDB opens', async (_, request) => {
    const { service, counts } = setup();
    await expect(service.prepare(request)).rejects.toThrow(TypeError);
    expect(counts().opens).toBe(0);
  });
});

describe('backupHandlers (the backup worker)', () => {
  function serve(derive: DeriveMaster, factory = freshFactory()) {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    const openDb = async () => {
      const db = await openDatabase(factory);
      opened.push(db);
      return db;
    };
    serveRpc(port1 as unknown as RpcPort, backupHandlers({ openDb, derive, random: () => codeBytes(0) }));
    return new RpcClient<ReturnType<typeof backupHandlers>, BackupEvents>(port2 as unknown as RpcPort);
  }

  it('pushes the progress in whole percents, each once, then answers', async () => {
    const client = serve((secret, platform, appId, onProgress) => {
      for (const f of [0, 0.001, 0.005, 0.01, 0.019, 0.02, 0.02, 0.5, 0.4, 0.999, 1]) onProgress!(f);
      return Promise.resolve(fakeMaster(secret, platform, appId));
    });
    const progress: number[] = [];
    client.on('progress', (f) => progress.push(f));
    expect(await client.call('prepare', CODE)).toEqual({ source: 'code', derived: true });
    expect(progress).toEqual([0, 0.01, 0.02, 0.5, 0.99, 1]);
    client.close();
  });

  it('answers a kept master without progress', async () => {
    const factory = freshFactory();
    const derive: DeriveMaster = (secret, platform, appId, onProgress) => {
      onProgress!(1);
      return Promise.resolve(fakeMaster(secret, platform, appId));
    };
    const first = serve(derive, factory);
    await first.call('prepare', DEVICE);
    first.close();
    const second = serve(derive, factory);
    const progress: number[] = [];
    second.on('progress', (f) => progress.push(f));
    expect(await second.call('prepare', DEVICE)).toEqual({ source: 'device', derived: false });
    expect(progress).toEqual([]);
    second.close();
  });
});
