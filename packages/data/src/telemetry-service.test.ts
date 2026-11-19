import type { TelemetryEvent } from '@lablo/protocol';
import { readTelemetryEvents, telemetryBatchSchema } from '@lablo/protocol';
import { TELEMETRY_BODY_MAX_BYTES } from '@lablo/protocol/telemetry-buckets';
import { afterEach, describe, expect, it } from 'vitest';
import type { ByteRequest, ByteResponse, ByteTransport } from './bytes';
import { NetworkError } from './bytes';
import { getValue, openDatabase, transact } from './idb';
import { emptyProfile, saveProfile } from './profile';
import type { RpcPort } from './rpc';
import { RpcClient, serveRpc } from './rpc';
import { STORE } from './schema';
import type { TelemetrySendRequest, TelemetrySendResult } from './telemetry-service';
import {
  TELEMETRY_CAPABILITY_KEY,
  TELEMETRY_ID_BYTES,
  TELEMETRY_ID_KEY,
  TELEMETRY_QUEUE_KEY,
  TELEMETRY_QUEUE_MAX,
  TELEMETRY_TIMEOUT_MS,
  batchBody,
  capabilityKey,
  samplePoint,
  sampled,
  telemetryHandlers,
  telemetryOff,
  utf8Length,
} from './telemetry-service';
import type { Clock } from './throttle';
import { freshFactory } from './test-support';

const opened: IDBDatabase[] = [];
const ports: MessagePort[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const port of ports.splice(0)) port.close();
});

const BASE = 'http://api.test';

const start = (at: number): TelemetryEvent => ({ kind: 'app_start', at, tier: 'full', coldStartMs: 1200 + at, catalog: '1k+' });
const capability = (at: number, firmware = '05.30.40'): TelemetryEvent => ({ kind: 'capability', at, model: '43UK6300PLB', firmware, chromium: 68, probes: { mse: true, year: 2018 } });
const crash = (at: number, stack: string): TelemetryEvent => ({ kind: 'crash', at, where: 'main', stack });

function request(events: TelemetryEvent[], fields: Partial<TelemetrySendRequest> = {}): TelemetrySendRequest {
  return { events, base: BASE, platform: 'webos', appVersion: '1.2.3', sampling: null, ...fields };
}

/** One post the transport saw. */
interface Posted {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string;
}

/** How the transport answers the next post: a status, a network failure, or never. */
type Answer = number | 'network' | 'hang';

/** A transport that records each post and answers from `answers` (200 once they run out). */
function apiTransport(answers: Answer[] = []) {
  const posts: Posted[] = [];
  let cancelled = 0;
  const transport: ByteTransport = {
    get(url: string, req: ByteRequest = {}): Promise<ByteResponse> {
      posts.push({ url, method: req.method, headers: { ...(req.headers ?? {}) }, body: req.body ?? '' });
      const answer = answers.shift() ?? 200;
      if (answer === 'network') return Promise.reject(new NetworkError());
      if (answer === 'hang') return new Promise<ByteResponse>(() => undefined);
      return Promise.resolve({
        status: answer,
        header: () => null,
        read: () => Promise.reject(new Error('The body is never read')),
        cancel: () => {
          cancelled++;
        },
      });
    },
  };
  return { transport, posts, cancelled: () => cancelled };
}

/** A clock whose time limit never comes, or comes at once (`now`). */
function testClock(limit: 'never' | 'now' = 'never'): Clock & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => 0,
    sleep: (ms) => {
      slept.push(ms);
      return limit === 'now' ? Promise.resolve() : new Promise<void>(() => undefined);
    },
  };
}

/** The 16 bytes `random` gives on its n-th call: no two alike, in no symmetric order. */
const idBytes = (n: number): Uint8Array => Uint8Array.from({ length: 16 }, (_, i) => (n * 41 + i * i * 3 + 7) & 255);

function setup(options: { answers?: Answer[]; limit?: 'never' | 'now'; factory?: IDBFactory } = {}) {
  const factory = options.factory ?? freshFactory();
  const api = apiTransport(options.answers);
  const clock = testClock(options.limit);
  const randoms: number[] = [];
  let opens = 0;
  let closes = 0;
  const handlers = telemetryHandlers({
    openDb: async () => {
      opens++;
      const db = await openDatabase(factory);
      opened.push(db);
      const close = db.close.bind(db);
      db.close = () => {
        closes++;
        close();
      };
      return db;
    },
    transport: api.transport,
    clock,
    random: (length) => {
      randoms.push(length);
      return idBytes(randoms.length - 1);
    },
  });
  return { factory, api, clock, randoms, send: (req: TelemetrySendRequest) => handlers.send(req), counts: () => ({ opens, closes }) };
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

async function putProfile(factory: IDBFactory, fields: Record<string, unknown>): Promise<void> {
  const db = await openDatabase(factory);
  opened.push(db);
  await saveProfile(db, { ...emptyProfile(), ...fields });
}

interface Batch {
  installId: string;
  platform: string;
  appVersion: string;
  events: TelemetryEvent[];
}

const batchOf = (posted: Posted): Batch => JSON.parse(posted.body) as Batch;

/** The base64url of `idBytes(n)`, as the worker writes it. */
const idText = (n: number): string => Buffer.from(idBytes(n)).toString('base64url');

describe("telemetry's records in kv", () => {
  it('keep their keys and limits (pinned: a TV that changed them would lose its queue or make a new ID)', () => {
    expect(TELEMETRY_ID_KEY).toBe('telemetry.id');
    expect(TELEMETRY_QUEUE_KEY).toBe('telemetry.queue');
    expect(TELEMETRY_CAPABILITY_KEY).toBe('telemetry.capability');
    expect(TELEMETRY_QUEUE_MAX).toBe(200);
    expect(TELEMETRY_TIMEOUT_MS).toBe(20_000);
    expect(TELEMETRY_ID_BYTES).toBe(16);
  });
});

describe('telemetryOff', () => {
  it('is only a profile that says `telemetry: false`', () => {
    expect(telemetryOff({ v: 9, telemetry: false })).toBe(true);
    for (const doc of [undefined, null, 'x', 9, { v: 9 }, { v: 9, telemetry: true }, { v: 9, telemetry: 'false' }, { v: 9, telemetry: 0 }]) expect(telemetryOff(doc)).toBe(false);
  });
});

describe('sampling', () => {
  it('places each install and kind at a fixed point in [0, 1): FNV-1a of `id:kind` over 2^32', () => {
    const id = idText(0);
    // FNV-1a by hand, byte by byte.
    let h = 0x811c9dc5;
    for (const byte of Buffer.from(`${id}:app_start`, 'utf8')) h = Math.imul(h ^ byte, 0x01000193);
    expect(samplePoint(id, 'app_start')).toBe((h >>> 0) / 2 ** 32);
    expect(samplePoint(id, 'app_start')).toBe(samplePoint(id, 'app_start'));
    expect(samplePoint(id, 'crash')).not.toBe(samplePoint(id, 'app_start'));
    expect(samplePoint(idText(1), 'app_start')).not.toBe(samplePoint(id, 'app_start'));
    for (let n = 0; n < 50; n++) {
      const point = samplePoint(idText(n), 'stall');
      expect(point).toBeGreaterThanOrEqual(0);
      expect(point).toBeLessThan(1);
    }
  });

  it('keeps a kind with no rate, never one at 0, always one at 1, and one in between when its point is under the rate', () => {
    const id = idText(3);
    expect(sampled(id, 'stall', null)).toBe(true);
    expect(sampled(id, 'stall', {})).toBe(true);
    expect(sampled(id, 'stall', { crash: 0 })).toBe(true);
    expect(sampled(id, 'stall', { stall: 0 })).toBe(false);
    expect(sampled(id, 'stall', { stall: 1 })).toBe(true);
    const point = samplePoint(id, 'stall');
    expect(sampled(id, 'stall', { stall: point })).toBe(false);
    expect(sampled(id, 'stall', { stall: point + 1e-9 })).toBe(true);
    // A name every object has is no rate of its own.
    expect(sampled(id, 'constructor', {})).toBe(true);
    // Across many installs, a rate keeps about its share.
    let kept = 0;
    for (let n = 0; n < 2000; n++) if (sampled(idText(n), 'play_result', { play_result: 0.25 })) kept++;
    expect(kept).toBeGreaterThan(400);
    expect(kept).toBeLessThan(600);
  });
});

describe('capabilityKey', () => {
  it('is the same for a repeat at another time, and differs with the app version, the firmware or a probe', () => {
    const key = capabilityKey(capability(1), '1.2.3');
    expect(capabilityKey(capability(2), '1.2.3')).toBe(key);
    expect(capabilityKey(capability(1), '1.2.4')).not.toBe(key);
    expect(capabilityKey(capability(1, '05.30.41'), '1.2.3')).not.toBe(key);
    expect(capabilityKey({ ...capability(1), probes: { mse: false, year: 2018 } } as TelemetryEvent, '1.2.3')).not.toBe(key);
    expect(capabilityKey({ ...capability(1), chromium: null } as TelemetryEvent, '1.2.3')).not.toBe(key);
    expect(capabilityKey({ ...capability(1), model: 'X' } as TelemetryEvent, '1.2.3')).not.toBe(key);
    expect(capabilityKey(start(1), '1.2.3')).toBe('');
  });
});

describe('utf8Length', () => {
  it("counts each character's UTF-8 bytes, at each boundary, a surrogate pair as its 4", () => {
    const samples = ['', 'a', '\u007f', '\u0080', '\u07ff', '\u0800', '\uffff', '\ud800\udc00', '\udbff\udfff', '\ud83d\ude00', 'b\u00e9\u0628\u20ac\ud83d\ude00z'];
    for (const text of samples) expect([text, utf8Length(text)]).toEqual([text, Buffer.byteLength(text, 'utf8')]);
    expect(utf8Length('\u007f\u0080\u07ff\u0800\uffff\ud800\udc00\udbff\udfff')).toBe(1 + 2 + 2 + 3 + 3 + 4 + 4);
  });
});

describe('batchBody', () => {
  it('is the envelope with the oldest events that fit in the body, at least one', () => {
    const events = [start(1), capability(2)];
    const { body, count } = batchBody('id', 'webos', '1.2.3', events);
    expect(count).toBe(2);
    expect(JSON.parse(body)).toEqual({ installId: 'id', platform: 'webos', appVersion: '1.2.3', events });

    // Crashes of 4,000 three-byte characters (the euro sign): 12 KB each, so five fit in 64 KB and the sixth doesn't.
    const big = Array.from({ length: 8 }, (_, i) => crash(i, '€'.repeat(4000)));
    const split = batchBody('id', 'webos', '1.2.3', big);
    expect(split.count).toBe(5);
    expect(Buffer.byteLength(split.body, 'utf8')).toBeLessThanOrEqual(TELEMETRY_BODY_MAX_BYTES);
    expect((JSON.parse(split.body) as Batch).events).toEqual(big.slice(0, 5));

    // Filled to the byte: an event that would end exactly at the limit goes in, one byte more doesn't.
    const head = batchBody('id', 'webos', '1.2.3', [crash(0, '')]).body;
    const room = TELEMETRY_BODY_MAX_BYTES - Buffer.byteLength(head, 'utf8') - 1;
    const exact = [crash(0, ''), crash(0, 'x'.repeat(room - JSON.stringify(crash(0, '')).length))];
    expect(Buffer.byteLength(batchBody('id', 'webos', '1.2.3', exact).body, 'utf8')).toBe(TELEMETRY_BODY_MAX_BYTES);
    expect(batchBody('id', 'webos', '1.2.3', exact).count).toBe(2);
    const over = [crash(0, ''), crash(0, 'x'.repeat(room - JSON.stringify(crash(0, '')).length + 1))];
    expect(batchBody('id', 'webos', '1.2.3', over).count).toBe(1);

    // A surrogate pair counts as its 4 bytes.
    const emoji = [crash(0, ''), crash(0, '😀'.repeat(Math.floor((room - JSON.stringify(crash(0, '')).length) / 4)) + 'x'.repeat((room - JSON.stringify(crash(0, '')).length) % 4))];
    expect(Buffer.byteLength(batchBody('id', 'webos', '1.2.3', emoji).body, 'utf8')).toBe(TELEMETRY_BODY_MAX_BYTES);
    expect(batchBody('id', 'webos', '1.2.3', emoji).count).toBe(2);

    // One event alone over the limit still goes (the API refuses it, and so it is dropped).
    const huge = batchBody('id', 'webos', '1.2.3', [crash(0, 'x'.repeat(TELEMETRY_BODY_MAX_BYTES)), start(1)]);
    expect(huge.count).toBe(1);
    // At most the batch's 200.
    expect(batchBody('id', 'webos', '1.2.3', Array.from({ length: 250 }, (_, i) => start(i))).count).toBe(200);
  });
});

describe('the telemetry worker: send', () => {
  it('makes the install ID once, queues the events and posts them to the API, which the server reads whole', async () => {
    const t = setup();
    const answer = await t.send(request([start(1), capability(2)]));
    expect(answer).toEqual({ state: 'sent', sent: 2, queued: 0 });
    expect(t.randoms).toEqual([16]);
    expect(await kv(t.factory, TELEMETRY_ID_KEY)).toBe(idText(0));
    expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toBeUndefined();
    expect(t.api.posts).toHaveLength(1);
    const posted = t.api.posts[0]!;
    expect(posted.url).toBe(`${BASE}/v1/telemetry`);
    expect(posted.method).toBe('POST');
    expect(posted.headers).toEqual({ 'content-type': 'application/json' });
    const batch = batchOf(posted);
    expect(batch).toEqual({ installId: idText(0), platform: 'webos', appVersion: '1.2.3', events: [start(1), capability(2)] });
    expect(telemetryBatchSchema.safeParse(batch).success).toBe(true);
    expect(readTelemetryEvents(batch.events)).toEqual({ events: [start(1), capability(2)], dropped: 0 });
    // The answer's body is never read; the connection is let go.
    expect(t.api.cancelled()).toBe(1);
    expect(t.clock.slept).toEqual([TELEMETRY_TIMEOUT_MS]);
    expect(t.counts()).toEqual({ opens: 1, closes: 1 });

    // The next send keeps the ID.
    expect(await t.send(request([start(3)]))).toEqual({ state: 'sent', sent: 1, queued: 0 });
    expect(t.randoms).toEqual([16]);
    expect(batchOf(t.api.posts[1]!).installId).toBe(idText(0));
  });

  it('makes a new ID for one that is not an ID', async () => {
    for (const broken of [42, 'short', idText(5) + 'A', idText(5).slice(0, 21) + 'B', { id: idText(5) }]) {
      const t = setup();
      await putKv(t.factory, TELEMETRY_ID_KEY, broken);
      await t.send(request([start(1)]));
      expect(await kv(t.factory, TELEMETRY_ID_KEY)).toBe(idText(0));
      expect(batchOf(t.api.posts[0]!).installId).toBe(idText(0));
    }
    // A good one is kept.
    const t = setup();
    await putKv(t.factory, TELEMETRY_ID_KEY, idText(7));
    await t.send(request([start(1)]));
    expect(t.randoms).toEqual([]);
    expect(batchOf(t.api.posts[0]!).installId).toBe(idText(7));
  });

  it('with the switch off, deletes the queue, the ID and the last capability, and posts nothing', async () => {
    const t = setup({ answers: [500] });
    await t.send(request([start(1), capability(2)]));
    expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toHaveLength(2);
    await putProfile(t.factory, { telemetry: false });
    expect(await t.send(request([start(3)]))).toEqual({ state: 'off' });
    expect(t.api.posts).toHaveLength(1);
    for (const key of [TELEMETRY_QUEUE_KEY, TELEMETRY_ID_KEY, TELEMETRY_CAPABILITY_KEY]) expect(await kv(t.factory, key)).toBeUndefined();
    expect(t.counts()).toEqual({ opens: 2, closes: 2 });

    // On again: a new ID, and the same capability is queued again.
    await putProfile(t.factory, {});
    expect(await t.send(request([capability(4)]))).toEqual({ state: 'sent', sent: 1, queued: 0 });
    expect(batchOf(t.api.posts[1]!)).toMatchObject({ installId: idText(1), events: [capability(4)] });
  });

  it('posts for a profile with the switch on, or with none', async () => {
    for (const fields of [{}, { telemetry: true }]) {
      const t = setup();
      await putProfile(t.factory, fields);
      expect(await t.send(request([start(1)]))).toEqual({ state: 'sent', sent: 1, queued: 0 });
    }
  });

  it('samples per kind: a kind this install does not send is never queued, and nothing left posts nothing', async () => {
    const t = setup();
    expect(await t.send(request([start(1), capability(2)], { sampling: { app_start: 0, capability: 0 } }))).toEqual({ state: 'empty' });
    expect(t.api.posts).toEqual([]);
    expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toBeUndefined();
    // The ID is made for the decision, and kept.
    expect(await kv(t.factory, TELEMETRY_ID_KEY)).toBe(idText(0));
    // A sampled-out capability isn't kept as sent: it is queued when its kind is sent again.
    expect(await kv(t.factory, TELEMETRY_CAPABILITY_KEY)).toBeUndefined();

    const point = samplePoint(idText(0), 'app_start');
    expect(await t.send(request([start(3), start(4), capability(5)], { sampling: { app_start: point + 1e-9, capability: 1 } }))).toEqual({ state: 'sent', sent: 3, queued: 0 });
    expect(await t.send(request([start(6), capability(7, 'new')], { sampling: { app_start: point, capability: 1 } }))).toEqual({ state: 'sent', sent: 1, queued: 0 });
    expect(batchOf(t.api.posts[1]!).events).toEqual([capability(7, 'new')]);
  });

  it("queues a capability only when it changed since the last one queued", async () => {
    const t = setup();
    await t.send(request([capability(1), capability(2)]));
    expect(batchOf(t.api.posts[0]!).events).toEqual([capability(1)]);
    expect(await kv(t.factory, TELEMETRY_CAPABILITY_KEY)).toBe(capabilityKey(capability(1), '1.2.3'));
    expect(await t.send(request([capability(3)]))).toEqual({ state: 'empty' });
    // A firmware update, then an app update.
    await t.send(request([capability(4, '05.30.41')]));
    await t.send(request([capability(5, '05.30.41')], { appVersion: '1.2.4' }));
    expect(t.api.posts.map((p) => batchOf(p).events)).toEqual([[capability(1)], [capability(4, '05.30.41')], [capability(5, '05.30.41')]]);
  });

  it('counts a stored queue that is not a list as none', async () => {
    for (const broken of ['x', 7, { 0: 'a' }, null]) {
      const t = setup();
      await putKv(t.factory, TELEMETRY_QUEUE_KEY, broken);
      expect(await t.send(request([start(1)]))).toEqual({ state: 'sent', sent: 1, queued: 0 });
      expect(batchOf(t.api.posts[0]!).events).toEqual([start(1)]);
    }
  });

  it('keeps the newest 200 events, oldest first, while the API is away', async () => {
    const t = setup({ answers: [500, 500] });
    await t.send(request(Array.from({ length: 150 }, (_, i) => start(i))));
    const answer = await t.send(request(Array.from({ length: 100 }, (_, i) => start(150 + i))));
    expect(answer).toEqual({ state: 'failed', failure: 'status', status: 500, queued: 200 });
    expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toEqual(Array.from({ length: 200 }, (_, i) => start(50 + i)));
    expect(batchOf(t.api.posts[1]!).events).toEqual(Array.from({ length: 200 }, (_, i) => start(50 + i)));
    // Then it comes back: the queue goes, with nothing new.
    expect(await t.send(request([]))).toEqual({ state: 'sent', sent: 200, queued: 0 });
    expect(await t.send(request([]))).toEqual({ state: 'empty' });
    expect(t.api.posts).toHaveLength(3);
  });

  it('posts a long queue in parts that fit the body, the rest kept for the next send', async () => {
    const t = setup();
    const big = Array.from({ length: 8 }, (_, i) => crash(i, '€'.repeat(4000)));
    expect(await t.send(request(big))).toEqual({ state: 'sent', sent: 5, queued: 3 });
    expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toEqual(big.slice(5));
    expect(await t.send(request([start(9)]))).toEqual({ state: 'sent', sent: 4, queued: 0 });
    expect(batchOf(t.api.posts[1]!).events).toEqual([...big.slice(5), start(9)]);
    for (const posted of t.api.posts) expect(Buffer.byteLength(posted.body, 'utf8')).toBeLessThanOrEqual(TELEMETRY_BODY_MAX_BYTES);
  });

  it('drops what the API refuses for good (400, 413), and keeps the events for anything else', async () => {
    for (const status of [400, 413]) {
      const t = setup({ answers: [status] });
      expect(await t.send(request([start(1), start(2)]))).toEqual({ state: 'refused', status, dropped: 2, queued: 0 });
      expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toBeUndefined();
    }
    for (const status of [201, 204, 301, 401, 404, 429, 500, 503]) {
      const t = setup({ answers: [status] });
      expect(await t.send(request([start(1), start(2)]))).toEqual({ state: 'failed', failure: 'status', status, queued: 2 });
      expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toEqual([start(1), start(2)]);
    }
    // A refusal takes only what was posted.
    const t = setup({ answers: [413] });
    const big = Array.from({ length: 6 }, (_, i) => crash(i, '€'.repeat(4000)));
    expect(await t.send(request(big))).toEqual({ state: 'refused', status: 413, dropped: 5, queued: 1 });
    expect(await kv(t.factory, TELEMETRY_QUEUE_KEY)).toEqual(big.slice(5));
  });

  it('keeps the events after a network failure or the time limit, and lets a late answer go', async () => {
    const network = setup({ answers: ['network'] });
    expect(await network.send(request([start(1)]))).toEqual({ state: 'failed', failure: 'network', status: null, queued: 1 });
    expect(await kv(network.factory, TELEMETRY_QUEUE_KEY)).toEqual([start(1)]);

    const late = setup({ answers: ['hang'], limit: 'now' });
    expect(await late.send(request([start(1)]))).toEqual({ state: 'failed', failure: 'timeout', status: null, queued: 1 });
    expect(late.clock.slept).toEqual([TELEMETRY_TIMEOUT_MS]);
    expect(await kv(late.factory, TELEMETRY_QUEUE_KEY)).toEqual([start(1)]);
    expect(late.counts()).toEqual({ opens: 1, closes: 1 });
  });

  it('never puts a URL, the base or the ID in an answer', async () => {
    const answers: TelemetrySendResult[] = [];
    for (const answer of [200, 400, 500, 'network'] as Answer[]) {
      const t = setup({ answers: [answer] });
      answers.push(await t.send(request([start(1)], { base: 'http://user:pass@api.test:8080' })));
    }
    const text = JSON.stringify(answers);
    for (const secret of ['http', 'api.test', 'user', 'pass', '8080', idText(0)]) expect(text).not.toContain(secret);
  });

  it('answers over RPC as the worker serves it', async () => {
    const factory = freshFactory();
    const api = apiTransport();
    const channel = new MessageChannel();
    ports.push(channel.port1, channel.port2);
    serveRpc(channel.port1 as unknown as RpcPort, telemetryHandlers({ openDb: () => openDatabase(factory), transport: api.transport, clock: testClock(), random: () => idBytes(2) }));
    const client = new RpcClient<ReturnType<typeof telemetryHandlers>>(channel.port2 as unknown as RpcPort);
    expect(await client.call('send', request([start(1)]))).toEqual({ state: 'sent', sent: 1, queued: 0 });
    expect(batchOf(api.posts[0]!).installId).toBe(idText(2));
    client.close();
  });
});
