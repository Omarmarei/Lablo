import { toBase64Url } from '@lablo/crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ByteResponse, ByteTransport } from './bytes';
import { NetworkError } from './bytes';
import { noPolicy } from './config-policy';
import type { ConfigEvents, ConfigResult } from './config-service';
import { CONFIG_KEY, CONFIG_MAX_BYTES, CONFIG_REFRESH_MS, CONFIG_RETRY_MS, CONFIG_TIMEOUT_MS, ConfigService, configHandlers } from './config-service';
import { getValue, openDatabase, transact } from './idb';
import type { RpcPort } from './rpc';
import { RpcClient, RpcError, serveRpc } from './rpc';
import { STORE } from './schema';
import type { FakeResponse } from './test-support';
import { configAnswer, configDocFields, configSigner, fakeTransport, freshFactory } from './test-support';
import type { Clock } from './throttle';

const DEV = configSigner();
const OTHER = configSigner('another key');
const BASE = 'http://127.0.0.1:3100';
const TARGET = { platform: 'webos', version: '1.0.0' } as const;
const REQUEST = { ...TARGET, base: BASE };
const T0 = 1_500_000;

/** A clock that moves only when told; `sleep`s resolve as it passes them. */
function manualClock(start = T0) {
  let now = start;
  const sleepers: { at: number; wake: () => void }[] = [];
  const clock: Clock = {
    now: () => now,
    sleep: (ms) => new Promise<void>((wake) => sleepers.push({ at: now + ms, wake })),
  };
  return {
    clock,
    sleepers,
    async advance(ms: number) {
      now += ms;
      for (const s of sleepers.splice(0)) {
        if (s.at <= now) s.wake();
        else sleepers.push(s);
      }
      await settle();
    },
  };
}

/** Lets pending promise callbacks run (fake-indexeddb answers on later tasks). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Settles until `ready()` holds (the code under test reads IndexedDB first, over several tasks). */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await settle();
  expect(ready()).toBe(true);
}

const opened: IDBDatabase[] = [];
const ports: MessagePort[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const port of ports.splice(0)) port.close();
});

function setup(options: { respond?: (url: string) => FakeResponse; transport?: ByteTransport; keys?: Uint8Array[]; factory?: IDBFactory; openDb?: () => Promise<IDBDatabase> } = {}) {
  const factory = options.factory ?? freshFactory();
  const time = manualClock();
  const transport = options.transport ?? fakeTransport((url) => (options.respond ?? (() => ({ status: 404 })))(url));
  const openDb =
    options.openDb ??
    (async () => {
      const db = await openDatabase(factory);
      opened.push(db);
      return db;
    });
  const service = new ConfigService({ openDb, transport, keys: options.keys ?? [DEV.publicKey], clock: time.clock });
  return { factory, time, transport, service };
}

async function storedRecord(factory: IDBFactory): Promise<unknown> {
  const db = await openDatabase(factory);
  opened.push(db);
  return getValue(db, STORE.kv, CONFIG_KEY);
}

/** A doc with a kill rule and a minimum version, so its policy is recognisable. */
const CACHED_DOC = configDocFields({ issuedAt: 1_000_000, kill: [{ id: 'old', match: { countries: ['AE'] }, mode: 'block-new-sources' }], minVersion: { webos: '1.2.0' } });
const NEWER_DOC = configDocFields({ issuedAt: 1_100_000, kill: [{ id: 'new', match: {}, mode: 'disable-playback' }] });

/** A service whose cache already holds `CACHED_DOC` (fetched with country AE). */
async function cachedSetup(respond: (url: string) => FakeResponse) {
  const factory = freshFactory();
  const first = setup({ factory, respond: () => ({ body: configAnswer(CACHED_DOC) }) });
  expect((await first.service.refresh(REQUEST)).status).toBe('fresh');
  const stored = await storedRecord(factory);
  return { ...setup({ factory, respond }), stored };
}

const CACHED_RESULT: Omit<ConfigResult, 'failure'> = {
  status: 'cached',
  policy: { kill: { id: 'old', mode: 'block-new-sources', message: null }, notices: [], updateRequired: true, minVersion: '1.2.0', flags: {}, tunables: {} },
  issuedAt: 1_000_000,
  expiresAt: 2_000_000,
  stored: true,
};

describe('ConfigService.refresh', () => {
  it('asks <base>/v1/config once, and keeps and applies a good answer', async () => {
    const { factory, service, transport } = setup({ respond: () => ({ body: configAnswer(CACHED_DOC) }) });
    expect(await service.refresh(REQUEST)).toEqual({ ...CACHED_RESULT, status: 'fresh', failure: null });
    expect((transport as ReturnType<typeof fakeTransport>).requests.map((r) => r.url)).toEqual([BASE + '/v1/config']);
    const answer = JSON.parse(configAnswer(CACHED_DOC)) as { doc: string; sig: string };
    expect(await storedRecord(factory)).toEqual({ doc: answer.doc, sig: answer.sig, country: 'AE', fetchedAt: T0 });
  });

  it("works out the policy for this build and the answer's country", async () => {
    const answer = configAnswer(CACHED_DOC, DEV, 'US');
    const { service } = setup({ respond: () => ({ body: answer }) });
    const result = await service.refresh({ ...REQUEST, platform: 'tizen', version: '1.0.0' });
    expect(result.policy).toEqual({ ...noPolicy(), minVersion: null });
    // This build's version against the doc's minimum (webOS 1.2.0).
    expect((await service.load({ platform: 'webos', version: '1.2.0' })).policy.updateRequired).toBe(false);
    expect((await service.load({ platform: 'webos', version: '1.1.9' })).policy.updateRequired).toBe(true);
  });

  it('replaces the cached copy with a newer one, and with the same one from another country', async () => {
    const newer = await cachedSetup(() => ({ body: configAnswer(NEWER_DOC, DEV, null) }));
    expect(await newer.service.refresh(REQUEST)).toMatchObject({ status: 'fresh', issuedAt: 1_100_000, policy: { kill: { id: 'new' } } });
    expect(await storedRecord(newer.factory)).toMatchObject({ country: null, doc: JSON.stringify(NEWER_DOC) });

    const same = await cachedSetup(() => ({ body: configAnswer(CACHED_DOC, DEV, 'SA') }));
    await same.time.advance(5_000);
    expect(await same.service.refresh(REQUEST)).toMatchObject({ status: 'fresh', issuedAt: 1_000_000, policy: { kill: null } });
    expect(await storedRecord(same.factory)).toMatchObject({ country: 'SA', fetchedAt: T0 + 5_000 });
  });

  const failures: [string, (url: string) => FakeResponse, ConfigResult['failure']][] = [
    ['not JSON', () => ({ body: '<html>busy</html>' }), 'not-json'],
    ['the wrong shape', () => ({ body: '{"doc":"{}"}' }), 'bad-response'],
    ['an untrusted signature', () => ({ body: configAnswer(NEWER_DOC, OTHER) }), 'bad-signature'],
    ['a signed text that is no doc', () => ({ body: configAnswer(configDocFields({ v: 2, issuedAt: 1_100_000 })) }), 'bad-doc'],
    ['an expired doc', () => ({ body: configAnswer(configDocFields({ issuedAt: 1_100_000, expiresAt: 1_200_000 })) }), 'expired'],
    ['an older doc', () => ({ body: configAnswer(configDocFields({ issuedAt: 900_000 })) }), 'older'],
    ['a status other than 200', () => ({ status: 503, body: configAnswer(NEWER_DOC) }), 'status'],
    ['a 304', () => ({ status: 304 }), 'status'],
    ['a connection lost mid-answer', () => ({ body: configAnswer(NEWER_DOC), chunk: 50, failAfter: 120 }), 'network'],
    ['an answer over the cap', () => ({ body: new Uint8Array(CONFIG_MAX_BYTES + 1), chunk: 1 << 20 }), 'too-large'],
  ];

  for (const [name, respond, failure] of failures) {
    it(`keeps the cached copy on ${name} (${failure})`, async () => {
      const { factory, service, stored } = await cachedSetup(respond);
      expect(await service.refresh(REQUEST)).toEqual({ ...CACHED_RESULT, failure });
      expect(await storedRecord(factory)).toEqual(stored);
    });

    // With nothing cached, no doc is older.
    if (failure === 'older') continue;
    it(`falls back to no policy on ${name} with nothing cached`, async () => {
      const { factory, service } = setup({ respond });
      expect(await service.refresh(REQUEST)).toEqual({ status: 'none', policy: noPolicy(), issuedAt: null, expiresAt: null, failure, stored: false });
      expect(await storedRecord(factory)).toBeUndefined();
    });
  }

  it('cancels a refused answer it stopped reading: a wrong status, a body over the cap', async () => {
    const status = setup({ respond: () => ({ status: 500, body: 'x'.repeat(10_000) }) });
    await status.service.refresh(REQUEST);
    expect((status.transport as ReturnType<typeof fakeTransport>).cancelled).toBe(1);
    const big = setup({ respond: () => ({ body: new Uint8Array(CONFIG_MAX_BYTES + 1), chunk: 1 << 20 }) });
    await big.service.refresh(REQUEST);
    expect((big.transport as ReturnType<typeof fakeTransport>).cancelled).toBe(1);
  });

  it('reads an answer of exactly the cap', async () => {
    const { service } = setup({ respond: () => ({ body: new Uint8Array(CONFIG_MAX_BYTES).fill(32), chunk: 1 << 20 }) });
    expect((await service.refresh(REQUEST)).failure).toBe('not-json');
  });

  it('reads an answer split anywhere, even inside a character', async () => {
    const doc = configDocFields({ kill: [{ id: 'k', match: {}, mode: 'notice', message: { en: 'Hello', ar: String.fromCharCode(0x645, 0x631, 0x62d, 0x628, 0x627) } }] });
    const { service } = setup({ respond: () => ({ body: configAnswer(doc), chunk: 3 }) });
    expect((await service.refresh(REQUEST)).policy.notices[0]?.message?.ar).toBe(String.fromCharCode(0x645, 0x631, 0x62d, 0x628, 0x627));
  });

  it('says network when the request fails outright', async () => {
    const { service } = setup({
      transport: {
        get: () => Promise.reject(new NetworkError()),
      },
    });
    expect(await service.refresh(REQUEST)).toMatchObject({ status: 'none', failure: 'network' });
  });

  it(`gives up after ${CONFIG_TIMEOUT_MS} ms without an answer, and cancels the answer when it comes late`, async () => {
    let answer: (response: ByteResponse) => void = () => undefined;
    let cancelled = 0;
    const late: ByteResponse = { status: 200, header: () => null, read: () => Promise.resolve(null), cancel: () => cancelled++ };
    let result: ConfigResult | null = null;
    let asked = false;
    const { service, time } = setup({
      transport: {
        get: () => {
          asked = true;
          return new Promise<ByteResponse>((resolve) => (answer = resolve));
        },
      },
    });
    void service.refresh(REQUEST).then((r) => (result = r));
    await until(() => asked && time.sleepers.length === 1);
    await time.advance(CONFIG_TIMEOUT_MS - 1);
    expect(result).toBeNull();
    await time.advance(1);
    expect(result).toEqual({ status: 'none', policy: noPolicy(), issuedAt: null, expiresAt: null, failure: 'timeout', stored: false });
    answer(late);
    await settle();
    expect(cancelled).toBe(1);
  });

  it('gives up on a body still arriving after the limit, and cancels it', async () => {
    let stall: (() => void) | null = null;
    const respond = (): FakeResponse => ({
      body: configAnswer(NEWER_DOC),
      chunk: 100,
      beforeChunk: (n) => (n === 1 ? new Promise<void>((resolve) => (stall = resolve)) : undefined),
    });
    const { service, time, transport, stored, factory } = await cachedSetup(respond);
    let result: ConfigResult | null = null;
    void service.refresh(REQUEST).then((r) => (result = r));
    await until(() => stall !== null && time.sleepers.length === 1);
    await time.advance(CONFIG_TIMEOUT_MS);
    expect(result).toEqual({ ...CACHED_RESULT, failure: 'timeout' });
    expect((transport as ReturnType<typeof fakeTransport>).cancelled).toBe(1);
    stall!();
    await settle();
    expect(await storedRecord(factory)).toEqual(stored);
  });

  it('takes an answer that comes in time, and the limit firing later cancels nothing', async () => {
    // A response that counts every cancel, read to its end or not.
    let cancels = 0;
    const body = new TextEncoder().encode(configAnswer(CACHED_DOC));
    let sent = false;
    const response: ByteResponse = {
      status: 200,
      header: () => null,
      read: () => {
        const chunk = sent ? null : body;
        sent = true;
        return Promise.resolve(chunk);
      },
      cancel: () => cancels++,
    };
    const { service, time } = setup({ transport: { get: () => Promise.resolve(response) } });
    const result = await service.refresh(REQUEST);
    expect(result.status).toBe('fresh');
    expect(time.sleepers.map((s) => s.at)).toEqual([T0 + CONFIG_TIMEOUT_MS]);
    await time.advance(CONFIG_TIMEOUT_MS);
    expect(result.status).toBe('fresh');
    expect(cancels).toBe(0);
  });

  it("applies a good answer IndexedDB couldn't keep, for this run", async () => {
    const { service } = setup({ respond: () => ({ body: configAnswer(CACHED_DOC) }), openDb: () => Promise.reject(new Error('quota')) });
    expect(await service.refresh(REQUEST)).toEqual({ ...CACHED_RESULT, status: 'fresh', failure: null, stored: false });
  });

  it('applies a good answer whose write fails', async () => {
    const factory = freshFactory();
    const { service } = setup({
      factory,
      respond: () => ({ body: configAnswer(CACHED_DOC) }),
      openDb: async () => {
        const db = await openDatabase(factory);
        opened.push(db);
        // Reads work, the write's transaction can't start.
        const transaction = db.transaction.bind(db);
        db.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
          if (mode === 'readwrite') throw new DOMException('Quota', 'QuotaExceededError');
          return transaction(stores, mode);
        }) as IDBDatabase['transaction'];
        return db;
      },
    });
    expect(await service.refresh(REQUEST)).toEqual({ ...CACHED_RESULT, status: 'fresh', failure: null, stored: false });
    expect(await storedRecord(factory)).toBeUndefined();
  });

  it('tries IndexedDB again on the next call after it failed to open', async () => {
    const factory = freshFactory();
    let opens = 0;
    const { service } = setup({
      factory,
      respond: () => ({ body: configAnswer(CACHED_DOC) }),
      openDb: async () => {
        opens++;
        if (opens === 1) throw new Error('blocked');
        const db = await openDatabase(factory);
        opened.push(db);
        return db;
      },
    });
    expect((await service.refresh(REQUEST)).stored).toBe(true);
    expect(opens).toBe(2);
    expect((await service.load(TARGET)).status).toBe('cached');
    expect(opens).toBe(2);
  });
});

describe('ConfigService.load', () => {
  it('gives no policy with nothing cached, without the network', async () => {
    const { service, transport } = setup();
    expect(await service.load(TARGET)).toEqual({ status: 'none', policy: noPolicy(), issuedAt: null, expiresAt: null, failure: null, stored: false });
    expect((transport as ReturnType<typeof fakeTransport>).requests).toEqual([]);
  });

  it("gives the cached copy's policy with the country it came with, expired or not", async () => {
    const { service, time } = await cachedSetup(() => ({ status: 500 }));
    await time.advance(10 * CONFIG_REFRESH_MS + 2_000_000);
    expect(await service.load(TARGET)).toEqual({ ...CACHED_RESULT, failure: null });
    expect(await service.load({ platform: 'tizen', version: '1.0.0' })).toMatchObject({ status: 'cached', policy: { kill: { id: 'old' }, updateRequired: false } });
  });

  it("deletes a cached copy this build's keys don't verify, so the query worker's blocklist drops it too", async () => {
    const factory = freshFactory();
    await setup({ factory, respond: () => ({ body: configAnswer(CACHED_DOC) }) }).service.refresh(REQUEST);
    // A copy that checks out stays, however often it is read.
    const same = setup({ factory });
    expect((await same.service.load(TARGET)).status).toBe('cached');
    expect((await same.service.load(TARGET)).status).toBe('cached');
    expect(await storedRecord(factory)).toMatchObject({ country: 'AE' });
    const rotated = setup({ factory, keys: [OTHER.publicKey] });
    expect((await rotated.service.load(TARGET)).status).toBe('none');
    expect(await storedRecord(factory)).toBeUndefined();
    // A trusting build has nothing left to read either.
    expect((await setup({ factory }).service.load(TARGET)).status).toBe('none');
  });

  it('deletes a broken record, and reads past a missing one', async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory);
    opened.push(db);
    await transact(db, STORE.kv, 'readwrite', (tx) => {
      tx.objectStore(STORE.kv).put({ doc: 5, sig: 'x', country: null, fetchedAt: 1 }, CONFIG_KEY);
    });
    const { service } = setup({ factory });
    expect((await service.load(TARGET)).status).toBe('none');
    expect(await storedRecord(factory)).toBeUndefined();
    expect((await service.load(TARGET)).status).toBe('none');
  });

  it("ignores a cached copy this build's keys don't verify", async () => {
    const factory = freshFactory();
    await setup({ factory, respond: () => ({ body: configAnswer(CACHED_DOC) }) }).service.refresh(REQUEST);
    const rotated = setup({ factory, keys: [OTHER.publicKey], respond: () => ({ body: configAnswer(NEWER_DOC, OTHER) }) });
    expect(await rotated.service.load(TARGET)).toMatchObject({ status: 'none', policy: noPolicy() });
    // A copy it can't verify doesn't make a newer doc "older" either.
    expect(await rotated.service.refresh(REQUEST)).toMatchObject({ status: 'fresh', issuedAt: 1_100_000 });
    const olderButTrusted = setup({ factory: freshFactory(), keys: [OTHER.publicKey], respond: () => ({ body: configAnswer(configDocFields({ issuedAt: 900_000 }), OTHER) }) });
    expect(await olderButTrusted.service.refresh(REQUEST)).toMatchObject({ status: 'fresh', issuedAt: 900_000 });
  });

  it('gives no policy when IndexedDB fails', async () => {
    const { service } = setup({ openDb: () => Promise.reject(new Error('broken')) });
    expect(await service.load(TARGET)).toMatchObject({ status: 'none', policy: noPolicy() });
  });

  it('exports the schedule the app follows, and the key the query worker reads', () => {
    expect(CONFIG_KEY).toBe('config');
    expect(CONFIG_TIMEOUT_MS).toBe(3_000);
    expect(CONFIG_REFRESH_MS).toBe(6 * 3_600_000);
    expect(CONFIG_MAX_BYTES).toBe(4 * 1_048_576);
    expect(CONFIG_RETRY_MS).toBe(30 * 60_000);
  });
});

describe('ConfigService.refresh with onCached', () => {
  it("gives the cached copy's policy before it asks the network", async () => {
    const seen: string[] = [];
    const { service } = await cachedSetup(() => {
      seen.push('fetch');
      return { body: configAnswer(NEWER_DOC) };
    });
    const result = await service.refresh(REQUEST, (cached) => seen.push(`cached ${cached.status} ${cached.policy.kill?.id ?? '-'}`));
    expect(seen).toEqual(['cached cached old', 'fetch']);
    expect(result).toMatchObject({ status: 'fresh', policy: { kill: { id: 'new' } } });
  });

  it('gives the defaults first when nothing is cached', async () => {
    const got: ConfigResult[] = [];
    const { service } = setup({ respond: () => ({ status: 500 }) });
    expect(await service.refresh(REQUEST, (cached) => got.push(cached))).toMatchObject({ status: 'none', failure: 'status' });
    expect(got).toEqual([{ status: 'none', policy: noPolicy(), issuedAt: null, expiresAt: null, failure: null, stored: false }]);
  });
});

describe('configHandlers (the config worker)', () => {
  function serve(respond: (url: string) => FakeResponse, factory = freshFactory()) {
    const time = manualClock();
    const transport = fakeTransport(respond);
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    const openDb = async () => {
      const db = await openDatabase(factory);
      opened.push(db);
      return db;
    };
    serveRpc(port1 as unknown as RpcPort, configHandlers({ openDb, transport, clock: time.clock }));
    const client = new RpcClient<ReturnType<typeof configHandlers>, ConfigEvents>(port2 as unknown as RpcPort);
    return { client, factory, transport };
  }

  const keys = [toBase64Url(DEV.publicKey)];

  it('pushes the cached policy, then answers the fetched one, with the keys the run carries', async () => {
    const first = serve(() => ({ body: configAnswer(CACHED_DOC) }));
    const pushed: ConfigResult[] = [];
    first.client.on('cached', (r) => pushed.push(r));
    // webos 1.0.0 is below CACHED_DOC's webos minimum (1.2.0).
    expect(await first.client.call('run', { ...REQUEST, keys })).toMatchObject({ status: 'fresh', policy: { kill: { id: 'old' }, updateRequired: true }, stored: true });
    expect(pushed).toMatchObject([{ status: 'none', failure: null }]);
    expect(first.transport.requests.map((r) => r.url)).toEqual([`${BASE}/v1/config`]);

    const second = serve(() => ({ status: 503 }), first.factory);
    const order: string[] = [];
    second.client.on('cached', (r) => order.push(`cached ${r.status}`));
    const answer = await second.client.call('run', { base: 'http://api.test', platform: 'tizen', version: '1.0.0', keys });
    order.push(`answer ${answer.status} ${answer.failure ?? '-'}`);
    expect(order).toEqual(['cached cached', 'answer cached status']);
    // The request's platform and base: tizen has no minVersion in CACHED_DOC.
    expect(answer.policy.updateRequired).toBe(false);
    expect(second.transport.requests.map((r) => r.url)).toEqual(['http://api.test/v1/config']);

    // Keys that don't verify the answer: refused, and the copy they can't verify is gone.
    const third = serve(() => ({ body: configAnswer(NEWER_DOC) }), first.factory);
    expect(await third.client.call('run', { ...REQUEST, keys: [toBase64Url(OTHER.publicKey)] })).toMatchObject({ status: 'none', failure: 'bad-signature' });
    expect(await storedRecord(first.factory)).toBeUndefined();
  });

  it('trusts any of several keys', async () => {
    const { client } = serve(() => ({ body: configAnswer(NEWER_DOC, OTHER) }));
    expect(await client.call('run', { ...REQUEST, keys: [...keys, toBase64Url(OTHER.publicKey)] })).toMatchObject({ status: 'fresh', issuedAt: 1_100_000 });
  });

  it('refuses a run without a key or with a broken one, before it touches anything', async () => {
    const { client, factory, transport } = serve(() => ({ body: configAnswer(CACHED_DOC) }));
    const broken = [[], [toBase64Url(DEV.publicKey.subarray(0, 31))], ['not base64url!'], [...keys, 'AAAA'], [42]];
    for (const bad of broken) {
      const error: unknown = await client.call('run', { ...REQUEST, keys: bad as string[] }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(RpcError);
      expect((error as Error).message).toMatch(bad.length === 0 ? /no public key/ : /is not 32 bytes of base64url/);
    }
    const missing: unknown = await client.call('run', { ...REQUEST, keys: undefined as unknown as string[] }).catch((e: unknown) => e);
    expect((missing as Error).message).toMatch(/no public key/);
    expect(transport.requests).toEqual([]);
    expect(await storedRecord(factory)).toBeUndefined();
  });
});
