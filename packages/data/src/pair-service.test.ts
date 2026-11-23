import { encodeQr } from '@lablo/core';
import type { BoxKeyPair } from '@lablo/crypto';
import { FILE_FRAME_BYTES, boxKeyPairFromSecretKey, newBoxKeyPair, sealFile, sealPairPayload, toBase64Url, utf8 } from '@lablo/crypto';
import type { PairPayload } from '@lablo/protocol';
import { PAIR_PAYLOAD_MAX_BYTES } from '@lablo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ByteRequest, ByteResponse, ByteSource, ByteTransport } from './bytes';
import { NetworkError } from './bytes';
import { createPairClient } from './client';
import { feedResponse } from './file-feed';
import type { PairPollResult } from './pair-service';
import { PAIR_ANSWER_MAX_BYTES, PAIR_POLL_MS, PAIR_RETRY_MS, PAIR_TIMEOUT_MS, PairService, pairHandlers, readPayload, retryAfterMs } from './pair-service';
import type { RpcPort } from './rpc';
import { RpcClient, serveRpc } from './rpc';
import type { FakeResponse } from './test-support';
import { fakeTransport } from './test-support';
import type { Clock } from './throttle';

/**
 * The TV's pairing client (RELAY step 31c1) against a fake of the pairing API (apps/web's
 * answers, step 31a) and a scripted phone that seals real payloads with `@lablo/crypto`.
 */

const BASE = 'http://127.0.0.1:3100';
const SID = 'AAAAAAAAAAAAAAAAAAAAAA';
/** 32 bytes in base64url: its last character carries two unused bits, which must be 0. */
const TOKEN = 'p'.repeat(42) + 'A';
const CODE = '7K3MZ9QX';
const EXP = 1_800_000_000_000;

function keyPair(n: number): BoxKeyPair {
  const secret = new Uint8Array(32).fill(n);
  return boxKeyPairFromSecretKey(secret);
}

const XTREAM: PairPayload = { v: 1, source: { type: 'xtream', server: 'http://panel.example:8080', username: 'user', password: 'p@ss word' }, name: 'Living room', epg: ['http://epg.example/guide.xml.gz'] };
const M3U: PairPayload = { v: 1, source: { type: 'm3u', url: 'http://lists.example/get.php?username=u&password=p&type=m3u_plus' } };

/** What the phone posts: the payload sealed to the TV's public key. */
function sealed(payload: unknown, tvPk: Uint8Array): { phonePk: string; nonce: string; ct: string } {
  return sealPairPayload(utf8(typeof payload === 'string' ? payload : JSON.stringify(payload)), tvPk);
}

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

/** A clock that moves only when told; `sleep`s resolve as it passes them. */
function manualClock() {
  let now = 0;
  const sleepers: { at: number; wake: () => void }[] = [];
  const clock: Clock = { now: () => now, sleep: (ms) => new Promise<void>((wake) => sleepers.push({ at: now + ms, wake })) };
  return {
    clock,
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

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** An answer whose headers come only once `after` settles. */
interface Late {
  readonly after: Promise<void>;
  readonly then: FakeResponse;
}

type Answer = FakeResponse | Late | 'throw' | 'hang';

/** The routes' answers, set per test; every request is kept with its method and body. */
function api(answer: (sent: Sent) => Answer) {
  const sent: Sent[] = [];
  let next: FakeResponse = {};
  const fake = fakeTransport(() => next);
  const transport: ByteTransport = {
    get(url: string, request: ByteRequest = {}): Promise<ByteResponse> {
      const one: Sent = { method: request.method ?? 'GET', url, headers: { ...(request.headers ?? {}) }, body: request.body ?? null };
      sent.push(one);
      const r = answer(one);
      if (r === 'throw') return Promise.reject(new NetworkError());
      if (r === 'hang') return new Promise<ByteResponse>(() => undefined);
      if ('after' in r) {
        return r.after.then(() => {
          next = r.then;
          return fake.get(url, request);
        });
      }
      next = r;
      return fake.get(url, request);
    },
  };
  /** Answers cancelled before their end. */
  return { sent, transport, cancelled: () => fake.cancelled };
}

const created = (fields: Record<string, unknown> = {}): FakeResponse => ({ status: 201, body: JSON.stringify({ sid: SID, code: CODE, pollToken: TOKEN, exp: EXP, ...fields }) });
const waiting: FakeResponse = { status: 200, body: JSON.stringify({ state: 'waiting', exp: EXP }) };
const ready = (payload: unknown): FakeResponse => ({ status: 200, body: JSON.stringify({ state: 'ready', payload }) });

/** A service whose next keys are `keys` (then fresh ones), over `answer`. */
function setup(answer: (sent: Sent) => Answer, keys: BoxKeyPair[] = [keyPair(7)]) {
  const time = manualClock();
  const { sent, transport, cancelled } = api(answer);
  const queue = keys.slice();
  const service = new PairService({ transport, clock: time.clock, keyPair: () => queue.shift() ?? newBoxKeyPair() });
  return { service, sent, time, cancelled };
}

/** A server whose poll answers `polls` in turn (then `waiting`), status 200. */
function scripted(polls: FakeResponse[], status: FakeResponse = { status: 200, body: '{"state":"done","status":"ok"}' }) {
  return (s: Sent): FakeResponse => {
    if (s.url === BASE + '/v1/pair') return created();
    if (s.url.endsWith('/status')) return status;
    return polls.shift() ?? waiting;
  };
}

describe('PairService.open', () => {
  it('posts a fresh public key and answers the code, its link, its QR code and the address to type', async () => {
    const keys = keyPair(7);
    const { service, sent } = setup(scripted([]), [keys]);
    const result = await service.open(BASE);
    const tvPk = toBase64Url(keys.publicKey);
    expect(sent).toEqual([{ method: 'POST', url: `${BASE}/v1/pair`, headers: { 'content-type': 'application/json' }, body: `{"tvPk":"${tvPk}"}` }]);
    const link = `${BASE}/p#c=${CODE}&k=${tvPk}`;
    expect(result).toEqual({ ok: true, code: { code: CODE, exp: EXP, link, typed: '127.0.0.1:3100/p', qr: encodeQr(link) } });
    expect(JSON.parse(sent[0]!.body!)).toEqual({ tvPk });
    expect(service.hasKey()).toBe(true);
  });

  it("asks for a check's code: the purpose in the body, the link ending &p=check (RELAY step 38c4)", async () => {
    const keys = keyPair(7);
    const { service, sent } = setup(scripted([]), [keys]);
    const result = await service.open(BASE, 'check');
    const tvPk = toBase64Url(keys.publicKey);
    expect(sent).toEqual([{ method: 'POST', url: `${BASE}/v1/pair`, headers: { 'content-type': 'application/json' }, body: `{"tvPk":"${tvPk}","purpose":"check"}` }]);
    expect(JSON.parse(sent[0]!.body!)).toEqual({ tvPk, purpose: 'check' });
    const link = `${BASE}/p#c=${CODE}&k=${tvPk}&p=check`;
    expect(result).toEqual({ ok: true, code: { code: CODE, exp: EXP, link, typed: '127.0.0.1:3100/p', qr: encodeQr(link) } });
    // An add, named or not, is as before.
    const add = setup(scripted([]), [keys]);
    await add.service.open(BASE, 'add');
    expect(add.sent[0]!.body).toBe(`{"tvPk":"${tvPk}"}`);
    // The worker's method passes the purpose on.
    const handled = api(scripted([]));
    const handlers = pairHandlers({ transport: handled.transport, keyPair: () => keys });
    const opened = await handlers.open({ base: BASE, purpose: 'check' });
    expect(opened.ok && opened.code.link).toBe(link);
    handlers.close();
  });

  it("refuses a check whose longer link would not fit a QR code, before any request (RELAY step 38c4)", async () => {
    // An add's link is the base plus 59 characters, a check's plus 67; a QR code holds 213 bytes.
    const longest = 'http://' + 'a'.repeat(139);
    const fits = setup(() => created());
    const result = await fits.service.open(longest, 'check');
    expect(result.ok && result.code.link.length).toBe(213);
    const over = setup(() => created());
    await expect(over.service.open(longest + 'a', 'check')).rejects.toThrow('The pairing link is too long for a QR code');
    expect(over.sent).toEqual([]);
  });

  it("types an https origin's host and port without the scheme", async () => {
    const { service } = setup(() => created());
    const result = await service.open('https://lablo.app');
    expect(result.ok && result.code.typed).toBe('lablo.app/p');
    expect(result.ok && result.code.link.startsWith('https://lablo.app/p#c=')).toBe(true);
    const other = await setup(() => created()).service.open('HTTP://Example.test:8443');
    expect(other.ok && other.code.typed).toBe('Example.test:8443/p');
  });

  it('refuses a base whose link would not fit a QR code, before any request', async () => {
    // The link is the base plus 59 characters; a QR code holds 213 bytes.
    const fits = setup(() => created());
    const longest = 'http://' + 'a'.repeat(147);
    const result = await fits.service.open(longest);
    expect(result.ok && result.code.link.length).toBe(213);
    expect(result.ok && result.code.qr.version).toBe(10);
    const over = setup(() => created());
    await expect(over.service.open(longest + 'a')).rejects.toThrow('The pairing link is too long for a QR code');
    expect(over.sent).toEqual([]);
  });

  it('refuses a base that is not an http(s) origin, before any request', async () => {
    for (const base of ['127.0.0.1:3100', 'ftp://a.test', 'http://a.test/', 'http://a.test/x', 'http://a b.test', 'http://', '']) {
      const { service, sent } = setup(() => created());
      await expect(service.open(base), base).rejects.toThrow('The pairing base must be an http(s) origin');
      expect(sent).toEqual([]);
    }
  });

  it('a new key pair for each code, and the session before it forgotten', async () => {
    const first = keyPair(1);
    const second = keyPair(2);
    const { service, sent } = setup(scripted([]), [first, second]);
    await service.open(BASE);
    await service.open(BASE);
    expect(sent.map((s) => JSON.parse(s.body!) as unknown)).toEqual([{ tvPk: toBase64Url(first.publicKey) }, { tvPk: toBase64Url(second.publicKey) }]);
    // A payload sealed to the first key no longer opens: the second key is the one held.
    const late = setup(scripted([ready(sealed(XTREAM, first.publicKey))]), [first, second]);
    await late.service.open(BASE);
    await late.service.open(BASE);
    expect(await late.service.poll()).toEqual({ state: 'unreadable' });
  });

  it('forgets the session before when a new code fails', async () => {
    let posts = 0;
    const { service, sent } = setup((s) => (s.url === BASE + '/v1/pair' ? (posts++ === 0 ? created() : 'throw') : waiting));
    expect((await service.open(BASE)).ok).toBe(true);
    expect(await service.open(BASE)).toEqual({ ok: false, failure: 'network', retryMs: null });
    expect(service.hasKey()).toBe(false);
    expect(await service.poll()).toEqual({ state: 'ended' });
    expect(sent).toHaveLength(2);
  });

  it('answers each failure without a session', async () => {
    const cases: Array<[FakeResponse | 'throw', unknown]> = [
      ['throw', { ok: false, failure: 'network', retryMs: null }],
      [{ status: 429, headers: { 'Retry-After': '30' } }, { ok: false, failure: 'rate', retryMs: 30_000 }],
      [{ status: 429 }, { ok: false, failure: 'rate', retryMs: PAIR_RETRY_MS }],
      [{ status: 503, body: '{"error":"unavailable"}' }, { ok: false, failure: 'status', retryMs: null }],
      [{ status: 200, body: created().body }, { ok: false, failure: 'status', retryMs: null }],
      [{ status: 201, body: 'not json' }, { ok: false, failure: 'malformed', retryMs: null }],
      [created({ code: 'lowercase' }), { ok: false, failure: 'malformed', retryMs: null }],
      [created({ pollToken: undefined }), { ok: false, failure: 'malformed', retryMs: null }],
      [{ status: 201, body: ' '.repeat(PAIR_ANSWER_MAX_BYTES + 1) }, { ok: false, failure: 'too-large', retryMs: null }],
      [{ status: 201, body: created().body, failAfter: 10 }, { ok: false, failure: 'network', retryMs: null }],
    ];
    for (const [answer, expected] of cases) {
      const { service, sent } = setup(() => answer);
      expect(await service.open(BASE), JSON.stringify(answer)).toEqual(expected);
      expect(service.hasKey()).toBe(false);
      expect(await service.poll()).toEqual({ state: 'ended' });
      expect(sent).toHaveLength(1);
    }
  });

  it('reads an answer of exactly the cap', async () => {
    const body = created().body as string;
    const { service } = setup(() => ({ status: 201, body: body + ' '.repeat(PAIR_ANSWER_MAX_BYTES - body.length) }));
    expect((await service.open(BASE)).ok).toBe(true);
  });

  it('gives up after the time limit, and drops the late answer', async () => {
    let release: () => void = () => undefined;
    const { service, time, cancelled } = setup(() => ({ ...created(), beforeChunk: () => new Promise<void>((resolve) => (release = resolve)) }));
    const result = service.open(BASE);
    await time.advance(PAIR_TIMEOUT_MS - 1);
    let done = false;
    void result.then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    await time.advance(1);
    expect(await result).toEqual({ ok: false, failure: 'timeout', retryMs: null });
    // The answer being read is cancelled at the limit.
    expect(cancelled()).toBe(1);
    release();
    await settle();
    expect(await service.poll()).toEqual({ state: 'ended' });
  });

  it('cancels an answer whose headers come after the time limit, as soon as they come', async () => {
    let release: () => void = () => undefined;
    const after = new Promise<void>((resolve) => (release = resolve));
    const { service, time, cancelled } = setup(() => ({ after, then: created() }));
    const result = service.open(BASE);
    await time.advance(PAIR_TIMEOUT_MS);
    expect(await result).toEqual({ ok: false, failure: 'timeout', retryMs: null });
    expect(cancelled()).toBe(0);
    release();
    await settle();
    await settle();
    expect(cancelled()).toBe(1);
    expect(await service.poll()).toEqual({ state: 'ended' });
  });

  it('times out a request that never answers at all', async () => {
    const { service, time } = setup(() => 'hang');
    const result = service.open(BASE);
    await time.advance(PAIR_TIMEOUT_MS);
    expect(await result).toEqual({ ok: false, failure: 'timeout', retryMs: null });
  });
});

describe('retryAfterMs', () => {
  it('whole seconds, at least one; anything else the default wait', () => {
    expect(retryAfterMs('30')).toBe(30_000);
    expect(retryAfterMs('0')).toBe(1_000);
    expect(retryAfterMs('999999')).toBe(999_999_000);
    // `fetch`'s Headers trims a value's ends: one with spaces can't come from it.
    for (const value of [null, '', '1.5', '-3', '1000000', 'Wed, 21 Oct 2015 07:28:00 GMT', '30s', ' 5', '5 ']) expect(retryAfterMs(value), String(value)).toBe(PAIR_RETRY_MS);
  });
});

describe('PairService.poll', () => {
  it('nothing open: ended, with no request', async () => {
    const { service, sent } = setup(scripted([]));
    expect(await service.poll()).toEqual({ state: 'ended' });
    expect(sent).toEqual([]);
  });

  it('asks with the poll token and no body: waiting, then the payload opened and parsed', async () => {
    const keys = keyPair(9);
    const { service, sent } = setup(scripted([waiting, ready(sealed(XTREAM, keys.publicKey))]), [keys]);
    await service.open(BASE);
    expect(await service.poll()).toEqual({ state: 'waiting' });
    expect(sent[1]).toEqual({ method: 'GET', url: `${BASE}/v1/pair/s/${SID}`, headers: { authorization: `Bearer ${TOKEN}` }, body: null });
    expect(await service.poll()).toEqual({ state: 'ready', payload: XTREAM });
    // The key is done with the read; the session stays for the status.
    expect(service.hasKey()).toBe(false);
    expect(await service.poll()).toEqual({ state: 'ended' });
    expect(sent).toHaveLength(3);
  });

  it('opens an M3U link with no name or guides, and keeps unicode', async () => {
    const keys = keyPair(3);
    const named: PairPayload = { v: 1, source: { type: 'm3u', url: 'http://lists.example/a.m3u' }, name: 'غرفة الجلوس 📺' };
    for (const payload of [M3U, named]) {
      const { service } = setup(scripted([ready(sealed(payload, keys.publicKey))]), [keys]);
      await service.open(BASE);
      expect(await service.poll()).toEqual({ state: 'ready', payload });
    }
  });

  it('reads the largest payload the server keeps', async () => {
    const keys = keyPair(12);
    // JSON allows trailing spaces: a valid payload padded to the protocol's 32 KB.
    const json = JSON.stringify(XTREAM);
    const padded = json + ' '.repeat(PAIR_PAYLOAD_MAX_BYTES - json.length);
    expect(utf8(padded).length).toBe(PAIR_PAYLOAD_MAX_BYTES);
    const { service } = setup(scripted([ready(sealPairPayload(utf8(padded), keys.publicKey))]), [keys]);
    await service.open(BASE);
    expect(await service.poll()).toEqual({ state: 'ready', payload: XTREAM });
  });

  it("a payload that doesn't open or parse is unreadable, and the session ends", async () => {
    const keys = keyPair(4);
    const other = keyPair(5);
    const cases: unknown[] = [
      sealed(XTREAM, other.publicKey),
      sealed('not json', keys.publicKey),
      sealed({ ...XTREAM, v: 2 }, keys.publicKey),
      sealed({ v: 1, source: { type: 'xtream', server: 'ftp://x', username: 'u', password: 'p' } }, keys.publicKey),
      sealPairPayload(new Uint8Array([0x7b, 0xff, 0x7d]), keys.publicKey),
      { ...sealed(XTREAM, keys.publicKey), nonce: toBase64Url(new Uint8Array(24)) },
    ];
    for (const payload of cases) {
      const { service, sent } = setup(scripted([ready(payload)], { status: 200, body: '{}' }), [keys]);
      await service.open(BASE);
      expect(await service.poll()).toEqual({ state: 'unreadable' });
      expect(service.hasKey()).toBe(false);
      expect(await service.poll()).toEqual({ state: 'ended' });
      await expect(service.status('ok')).rejects.toThrow('No pairing payload was read');
      expect(sent).toHaveLength(2);
    }
  });

  it('ends the session on 410, 404, 401 and 409', async () => {
    for (const status of [410, 404, 401, 409]) {
      const { service, sent } = setup(scripted([{ status, body: '{"error":"x"}' }]));
      await service.open(BASE);
      expect(await service.poll(), String(status)).toEqual({ state: 'ended' });
      expect(service.hasKey()).toBe(false);
      expect(await service.poll()).toEqual({ state: 'ended' });
      expect(sent).toHaveLength(2);
    }
  });

  it('keeps the session through a 429, a server error and a broken answer', async () => {
    const keys = keyPair(6);
    const polls: Array<FakeResponse | 'throw'> = [
      { status: 429, headers: { 'retry-after': '12' } },
      { status: 500 },
      { status: 200, body: '{"state":"later"}' },
      { status: 200, body: 'nope' },
      'throw',
      { status: 200, body: JSON.stringify({ state: 'waiting', exp: EXP, pad: 'x'.repeat(PAIR_ANSWER_MAX_BYTES) }) },
      { status: 201, body: waiting.body },
      ready(sealed(M3U, keys.publicKey)),
    ];
    const { service } = setup((s) => (s.url === BASE + '/v1/pair' ? created() : (polls.shift() ?? waiting)), [keys]);
    await service.open(BASE);
    const results: PairPollResult[] = [];
    for (let i = 0; i < 8; i++) results.push(await service.poll());
    expect(results).toEqual([
      { state: 'wait', retryMs: 12_000 },
      { state: 'failed', failure: 'status' },
      { state: 'failed', failure: 'malformed' },
      { state: 'failed', failure: 'malformed' },
      { state: 'failed', failure: 'network' },
      { state: 'failed', failure: 'too-large' },
      { state: 'failed', failure: 'status' },
      { state: 'ready', payload: M3U },
    ]);
  });

  it('a poll past the time limit fails, and the next one asks again', async () => {
    let calls = 0;
    const { service, time, sent } = setup((s) => (s.url === BASE + '/v1/pair' ? created() : calls++ === 0 ? 'hang' : waiting));
    await service.open(BASE);
    const first = service.poll();
    await time.advance(PAIR_TIMEOUT_MS);
    expect(await first).toEqual({ state: 'failed', failure: 'timeout' });
    expect(await service.poll()).toEqual({ state: 'waiting' });
    expect(sent).toHaveLength(3);
  });

  it("drops an answer that comes after the session was closed or replaced", async () => {
    const keys = keyPair(8);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup((s) => (s.url === BASE + '/v1/pair' ? created() : { ...ready(sealed(XTREAM, keys.publicKey)), beforeChunk: () => gate }), [keys, keyPair(1)]);
    await service.open(BASE);
    const polled = service.poll();
    await settle();
    service.close();
    release();
    expect(await polled).toEqual({ state: 'ended' });

    let releaseOld: () => void = () => undefined;
    const oldGate = new Promise<void>((resolve) => (releaseOld = resolve));
    const again = setup((s) => (s.url === BASE + '/v1/pair' ? created() : { ...waiting, beforeChunk: () => oldGate }), [keys, keyPair(1)]);
    await again.service.open(BASE);
    const old = again.service.poll();
    await settle();
    await again.service.open(BASE);
    releaseOld();
    expect(await old).toEqual({ state: 'ended' });
    // The new session is untouched.
    expect(again.service.hasKey()).toBe(true);
  });
});

describe('PairService.status', () => {
  async function read(statusAnswer: FakeResponse | 'throw') {
    const keys = keyPair(2);
    const { service, sent } = setup((s) => (s.url === BASE + '/v1/pair' ? created() : s.url.endsWith('/status') ? statusAnswer : ready(sealed(XTREAM, keys.publicKey))), [keys]);
    await service.open(BASE);
    expect((await service.poll()).state).toBe('ready');
    return { service, sent };
  }

  it('posts the category once with the poll token, then forgets the session', async () => {
    for (const status of ['ok', 'auth_failed', 'expired', 'unreachable', 'blocked'] as const) {
      const { service, sent } = await read({ status: 200, body: `{"state":"done","status":"${status}"}` });
      expect(await service.status(status)).toEqual({ ok: true });
      expect(sent[2]).toEqual({ method: 'POST', url: `${BASE}/v1/pair/s/${SID}/status`, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: `{"status":"${status}"}` });
      expect(JSON.parse(sent[2]!.body!)).toEqual({ status });
      await expect(service.status(status)).rejects.toThrow('No pairing payload was read');
      expect(await service.poll()).toEqual({ state: 'ended' });
      expect(sent).toHaveLength(3);
    }
  });

  it('refused for good (409, 404, 401): the session is forgotten', async () => {
    for (const code of [409, 404, 401]) {
      const { service } = await read({ status: code });
      expect(await service.status('ok')).toEqual({ ok: false, failure: 'status' });
      await expect(service.status('ok')).rejects.toThrow('No pairing payload was read');
    }
  });

  it('a 429, a server error or no connection: the session stays, so it can be sent again', async () => {
    const cases: Array<[FakeResponse | 'throw', unknown]> = [
      [{ status: 429, headers: { 'Retry-After': '9' } }, { ok: false, failure: 'rate' }],
      [{ status: 500 }, { ok: false, failure: 'status' }],
      ['throw', { ok: false, failure: 'network' }],
    ];
    for (const [answer, expected] of cases) {
      let first = true;
      const keys = keyPair(2);
      const { service, sent } = setup(
        (s) => {
          if (s.url === BASE + '/v1/pair') return created();
          if (!s.url.endsWith('/status')) return ready(sealed(XTREAM, keys.publicKey));
          if (first) {
            first = false;
            return answer;
          }
          return { status: 200, body: '{"state":"done","status":"ok"}' };
        },
        [keys],
      );
      await service.open(BASE);
      await service.poll();
      expect(await service.status('blocked')).toEqual(expected);
      expect(await service.status('blocked')).toEqual({ ok: true });
      expect(sent.filter((s) => s.url.endsWith('/status'))).toHaveLength(2);
    }
  });

  it("a new code made while a status is on its way isn't forgotten when the status answers", async () => {
    const keys = keyPair(2);
    let release: () => void = () => undefined;
    const after = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup(
      (s) => (s.url === BASE + '/v1/pair' ? created() : s.url.endsWith('/status') ? { after, then: { status: 200, body: '{}' } } : ready(sealed(XTREAM, keys.publicKey))),
      [keys, keyPair(3)],
    );
    await service.open(BASE);
    await service.poll();
    const sending = service.status('ok');
    await settle();
    expect((await service.open(BASE)).ok).toBe(true);
    release();
    expect(await sending).toEqual({ ok: true });
    expect(service.hasKey()).toBe(true);
  });

  it('refuses a status before the read, after close, or one the protocol lacks', async () => {
    const { service, sent } = setup(scripted([]));
    await expect(service.status('ok')).rejects.toThrow('No pairing payload was read');
    await service.open(BASE);
    await expect(service.status('ok')).rejects.toThrow('No pairing payload was read');
    const after = await read({ status: 200 });
    await expect(after.service.status('fine' as 'ok')).rejects.toThrow('Unknown pairing status');
    after.service.close();
    await expect(after.service.status('ok')).rejects.toThrow('No pairing payload was read');
    expect(sent).toHaveLength(1);
  });
});

describe('close', () => {
  it('forgets the key and the session', async () => {
    const { service, sent } = setup(scripted([]));
    await service.open(BASE);
    service.close();
    expect(service.hasKey()).toBe(false);
    expect(await service.poll()).toEqual({ state: 'ended' });
    expect(sent).toHaveLength(1);
    // Twice is fine.
    service.close();
  });
});

describe('readPayload', () => {
  it('UTF-8 JSON through the schema, else null', () => {
    expect(readPayload(utf8(JSON.stringify(M3U)))).toEqual(M3U);
    expect(readPayload(utf8('{"v":1}'))).toBeNull();
    expect(readPayload(utf8(''))).toBeNull();
    expect(readPayload(new Uint8Array([0xc3]))).toBeNull();
    // A broken byte inside a string isn't read as U+FFFD: the payload is refused.
    const bytes = utf8(JSON.stringify({ ...M3U, name: 'A#B' }));
    expect(readPayload(bytes)).toEqual({ ...M3U, name: 'A#B' });
    bytes[bytes.indexOf(0x23)] = 0xff;
    expect(readPayload(bytes)).toBeNull();
  });
});

describe('pairHandlers (the pair worker)', () => {
  const ports: MessagePort[] = [];
  afterEach(() => {
    for (const port of ports.splice(0)) port.close();
  });

  it('serves open, poll, status and close over RPC', async () => {
    const keys = keyPair(11);
    const { transport, sent } = api(scripted([waiting, waiting, ready(sealed(XTREAM, keys.publicKey))]));
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveRpc(port1 as unknown as RpcPort, pairHandlers({ transport, keyPair: () => keys }));
    const client = new RpcClient<ReturnType<typeof pairHandlers>>(port2 as unknown as RpcPort);
    const opened = await client.call('open', { base: BASE });
    expect(opened.ok && opened.code.qr.rows).toEqual(encodeQr(`${BASE}/p#c=${CODE}&k=${toBase64Url(keys.publicKey)}`)!.rows);
    expect(await client.call('poll')).toEqual({ state: 'waiting' });
    // Closed before anything came: nothing more is asked.
    await client.call('close');
    expect(await client.call('poll')).toEqual({ state: 'ended' });
    await client.call('open', { base: BASE });
    expect(await client.call('poll')).toEqual({ state: 'waiting' });
    expect(await client.call('poll')).toEqual({ state: 'ready', payload: XTREAM });
    expect(await client.call('status', { status: 'blocked' })).toEqual({ ok: true });
    expect(sent.at(-1)!.body).toBe('{"status":"blocked"}');
    expect(sent.map((s) => `${s.method} ${s.url.slice(BASE.length)}`)).toEqual([
      'POST /v1/pair',
      `GET /v1/pair/s/${SID}`,
      'POST /v1/pair',
      `GET /v1/pair/s/${SID}`,
      `GET /v1/pair/s/${SID}`,
      `POST /v1/pair/s/${SID}/status`,
    ]);
    client.close();
  });

  it("createPairClient: a pair worker that dies fails the calls waiting on it", async () => {
    const port = { onerror: null as ((event: ErrorEvent) => void) | null, postMessage: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
    const client = createPairClient(port);
    const waitingCall = client.call('poll');
    port.onerror!({ message: 'boom' } as ErrorEvent);
    await expect(waitingCall).rejects.toThrow('Pair worker failed: boom');
    await expect(client.call('poll')).rejects.toThrow('Pair worker failed: boom');
    const quiet = { onerror: null as ((event: ErrorEvent) => void) | null, postMessage: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
    const other = createPairClient(quiet);
    quiet.onerror!({ message: '' } as ErrorEvent);
    await expect(other.call('poll')).rejects.toThrow('Pair worker failed: unknown error');
    // A port without onerror (a MessagePort in tests) gets none.
    const plain = { postMessage: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
    createPairClient(plain);
    expect('onerror' in plain).toBe(false);
  });

  it('polls every 2 s (the screen runs the poll)', () => {
    expect(PAIR_POLL_MS).toBe(2000);
    expect(PAIR_TIMEOUT_MS).toBe(10_000);
    expect(PAIR_RETRY_MS).toBe(60_000);
  });
});

describe('PairService.file (step 31d2a)', () => {
  const ports: MessagePort[] = [];
  afterEach(() => {
    for (const port of ports.splice(0)) port.close();
  });

  const FILE_KEY = new Uint8Array(32).fill(21);
  const FILE_BASE = new Uint8Array(24).fill(22);
  const FILE_SIZE = FILE_FRAME_BYTES + 200_000;
  const FILE_PLAIN = new Uint8Array(FILE_SIZE).map((_, i) => (i * 13) & 255);
  const FILE_SEALED = sealFile(FILE_PLAIN, FILE_KEY, FILE_BASE);
  const BLOB_KEY = 'b'.repeat(21) + 'A';
  const BLOB_PATH = `/dev/blob/pair/${SID}/${BLOB_KEY}?m=GET&n=0&e=1800000600000&s=sig`;
  const FILE: PairPayload = { v: 1, source: { type: 'm3u-file', file: { key: BLOB_KEY, fileKey: toBase64Url(FILE_KEY), base: toBase64Url(FILE_BASE), size: FILE_SIZE } }, name: 'Family list' };
  const located = (fields: Record<string, unknown> = {}): FakeResponse => ({ status: 200, body: JSON.stringify({ url: BLOB_PATH, key: BLOB_KEY, exp: EXP, ...fields }) });
  const blob = (fields: Partial<FakeResponse> = {}): FakeResponse => ({ status: 200, headers: { 'Content-Length': String(FILE_SEALED.length) }, body: FILE_SEALED, chunk: 65536, ...fields });

  /** The pairing API with a file: the URL's answer and the blob's, each overridable. */
  function withFile(keys: BoxKeyPair, url: Answer = located(), file: Answer = blob(), payload: PairPayload = FILE) {
    return (s: Sent): Answer => {
      if (s.url === BASE + '/v1/pair') return created();
      if (s.url === `${BASE}/v1/pair/s/${SID}`) return ready(sealed(payload, keys.publicKey));
      if (s.url === `${BASE}/v1/pair/s/${SID}/file`) return url;
      if (s.url.endsWith('/status')) return { status: 200, body: '{"state":"done","status":"ok"}' };
      return file;
    };
  }

  /** A service that has read the file's payload. */
  async function readFile(url?: Answer, file?: Answer, payload?: PairPayload) {
    const keys = keyPair(17);
    const s = setup(withFile(keys, url, file, payload), [keys]);
    await s.service.open(BASE);
    expect((await s.service.poll()).state).toBe('ready');
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    return { ...s, serving: port1 as unknown as RpcPort, reading: port2 as unknown as RpcPort };
  }

  async function readAll(feed: ByteSource): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for (let chunk = await feed.read(); chunk !== null; chunk = await feed.read()) parts.push(chunk);
    return new Uint8Array(Buffer.concat(parts));
  }

  it("asks for the file's URL with the poll token, fetches it without, and serves the opened frames on the port", async () => {
    const { service, sent, serving, reading } = await readFile();
    expect(await service.file(serving)).toEqual({ ok: true, size: FILE_SIZE });
    expect(sent.slice(2)).toEqual([
      { method: 'GET', url: `${BASE}/v1/pair/s/${SID}/file`, headers: { authorization: `Bearer ${TOKEN}` }, body: null },
      // The path resolved against the base; no token, no body.
      { method: 'GET', url: BASE + BLOB_PATH, headers: {}, body: null },
    ]);
    expect(service.hasFeed()).toBe(true);
    const plain = await readAll(feedResponse({ port: reading, size: FILE_SIZE }));
    expect(Buffer.from(plain).equals(Buffer.from(FILE_PLAIN))).toBe(true);
    // The status ends what is left of the feed, and the session as before.
    expect(await service.status('ok')).toEqual({ ok: true });
    expect(service.hasFeed()).toBe(false);
  });

  it("ends the feed with the status even when the status doesn't go (it is tried again later)", async () => {
    const keys = keyPair(17);
    const routes = withFile(keys);
    const s = setup((sent) => (sent.url.endsWith('/status') ? 'throw' : routes(sent)), [keys]);
    await s.service.open(BASE);
    await s.service.poll();
    const { port1 } = new MessageChannel();
    ports.push(port1);
    expect((await s.service.file(port1 as unknown as RpcPort)).ok).toBe(true);
    expect(await s.service.status('unreachable')).toEqual({ ok: false, failure: 'network' });
    // The session stays for the next try; the file isn't read any more.
    expect(s.service.hasFeed()).toBe(false);
    expect(s.cancelled()).toBe(1);
  });

  it('answers nothing more on the port once the feed ended', async () => {
    const { service, serving, reading } = await readFile();
    expect((await service.file(serving)).ok).toBe(true);
    const feed = feedResponse({ port: reading, size: FILE_SIZE });
    expect((await feed.read())!.length).toBe(FILE_FRAME_BYTES);
    expect(await service.status('unreachable')).toEqual({ ok: true });
    // Nobody serves the port now: a read gets no answer (the ingest's load was cancelled first).
    const late = await Promise.race([feed.read().then(() => 'answered', () => 'answered'), new Promise((resolve) => setTimeout(() => resolve('silent'), 100))]);
    expect(late).toBe('silent');
    feed.cancel();
  });

  it('uses an https URL as it is, and takes a file with no Content-Length', async () => {
    const r2 = 'https://bucket.r2.example/pair/x?X-Amz-Signature=abc';
    const { service, sent, serving } = await readFile(located({ url: r2 }), blob({ headers: {} }));
    expect(await service.file(serving)).toEqual({ ok: true, size: FILE_SIZE });
    expect(sent[3]!.url).toBe(r2);
  });

  it("answers each failure of the URL's request, fetching nothing and keeping the session for its status", async () => {
    const cases: Array<[Answer, string]> = [
      ['throw', 'network'],
      [{ status: 429, headers: { 'Retry-After': '5' } }, 'rate'],
      [{ status: 404, body: '{"error":"not_found"}' }, 'gone'],
      [{ status: 409 }, 'status'],
      [{ status: 401 }, 'status'],
      [{ status: 503 }, 'status'],
      [{ status: 201, body: located().body }, 'status'],
      [{ status: 200, body: 'not json' }, 'malformed'],
      [located({ url: 'http://bucket.example/x' }), 'malformed'],
      [located({ url: '//evil.example/x' }), 'malformed'],
      [located({ exp: undefined }), 'malformed'],
      [{ status: 200, body: ' '.repeat(PAIR_ANSWER_MAX_BYTES + 1) }, 'too-large'],
      // Another file than the payload's (a second upload replaced it).
      [located({ key: 'c'.repeat(21) + 'A' }), 'file'],
    ];
    for (const [answer, failure] of cases) {
      const { service, sent, serving } = await readFile(answer);
      expect(await service.file(serving), JSON.stringify(answer)).toEqual({ ok: false, failure });
      expect(sent, failure).toHaveLength(3);
      expect(service.hasFeed()).toBe(false);
      expect(await service.status('unreachable')).toEqual({ ok: true });
    }
  });

  it("answers each failure of the file's GET, and lets its answer go", async () => {
    const cases: Array<[Answer, string, number]> = [
      ['throw', 'network', 0],
      [blob({ status: 403, headers: {}, body: '<Error/>' }), 'file', 1],
      [blob({ status: 404, headers: {}, body: '' }), 'file', 1],
      [blob({ status: 500, headers: {}, body: 'oops' }), 'status', 1],
      [blob({ status: 206 }), 'status', 1],
      [blob({ headers: { 'Content-Length': String(FILE_SEALED.length + 1) } }), 'file', 1],
      [blob({ headers: { 'Content-Length': String(FILE_SEALED.length - 1) } }), 'file', 1],
      [blob({ headers: { 'Content-Length': String(FILE_SIZE) } }), 'file', 1],
    ];
    for (const [answer, failure, cancels] of cases) {
      const { service, sent, serving, cancelled } = await readFile(located(), answer);
      expect(await service.file(serving), failure).toEqual({ ok: false, failure });
      expect(sent, failure).toHaveLength(4);
      expect(cancelled(), failure).toBe(cancels);
      expect(service.hasFeed()).toBe(false);
    }
  });

  it("gives each request the time limit: the URL's whole answer, the file's headers", async () => {
    const first = await readFile('hang');
    const asked = first.service.file(first.serving);
    await first.time.advance(PAIR_TIMEOUT_MS);
    expect(await asked).toEqual({ ok: false, failure: 'timeout' });

    const second = await readFile(located(), 'hang');
    const fetched = second.service.file(second.serving);
    // The file's time limit starts with its GET: wait for it before moving the clock.
    while (second.sent.length < 4) await settle();
    await second.time.advance(PAIR_TIMEOUT_MS - 1);
    let done = false;
    void fetched.then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    await second.time.advance(1);
    expect(await fetched).toEqual({ ok: false, failure: 'timeout' });
  });

  it("cancels a file whose headers come after the time limit, as soon as they come", async () => {
    let release: () => void = () => undefined;
    const after = new Promise<void>((resolve) => (release = resolve));
    const { service, time, serving, cancelled, sent } = await readFile(located(), { after, then: blob() });
    const fetched = service.file(serving);
    while (sent.length < 4) await settle();
    await time.advance(PAIR_TIMEOUT_MS);
    expect(await fetched).toEqual({ ok: false, failure: 'timeout' });
    release();
    await settle();
    await settle();
    expect(cancelled()).toBe(1);
    expect(service.hasFeed()).toBe(false);
  });

  it('a file only after a payload with one was read from this session', async () => {
    const keys = keyPair(17);
    const xtream = setup(withFile(keys, located(), blob(), XTREAM), [keys]);
    const { port1 } = new MessageChannel();
    ports.push(port1);
    const port = port1 as unknown as RpcPort;
    await expect(xtream.service.file(port)).rejects.toThrow('No pairing file was read');
    await xtream.service.open(BASE);
    await expect(xtream.service.file(port)).rejects.toThrow('No pairing file was read');
    await xtream.service.poll();
    await expect(xtream.service.file(port)).rejects.toThrow('No pairing file was read');
    // Closed after the file's payload: nothing left to fetch.
    const closed = await readFile();
    closed.service.close();
    await expect(closed.service.file(closed.serving)).rejects.toThrow('No pairing file was read');
    expect(closed.sent).toHaveLength(2);
    // And a new code forgets the file of the payload before.
    const renewed = await readFile();
    await renewed.service.open(BASE);
    await expect(renewed.service.file(renewed.serving)).rejects.toThrow('No pairing file was read');
  });

  it("drops a file call that the status, a close or another file call overtook", async () => {
    // Closed while the URL's request runs.
    let releaseUrl: () => void = () => undefined;
    const urlLate = await readFile({ after: new Promise<void>((resolve) => (releaseUrl = resolve)), then: located() });
    const first = urlLate.service.file(urlLate.serving);
    urlLate.service.close();
    releaseUrl();
    expect(await first).toEqual({ ok: false, failure: 'gone' });
    expect(urlLate.sent).toHaveLength(3);

    // The status sent while the file's GET runs: its answer is let go.
    let releaseBlob: () => void = () => undefined;
    const blobLate = await readFile(located(), { after: new Promise<void>((resolve) => (releaseBlob = resolve)), then: blob() });
    const second = blobLate.service.file(blobLate.serving);
    while (blobLate.sent.length < 4) await settle();
    expect(await blobLate.service.status('unreachable')).toEqual({ ok: true });
    releaseBlob();
    expect(await second).toEqual({ ok: false, failure: 'gone' });
    expect(blobLate.cancelled()).toBe(1);
    expect(blobLate.service.hasFeed()).toBe(false);

    // A second call overtakes the first: only the second serves.
    let releaseOld: () => void = () => undefined;
    let urls = 0;
    const keys = keyPair(17);
    const twice = setup(
      (s) => (s.url === `${BASE}/v1/pair/s/${SID}/file` ? (urls++ === 0 ? { after: new Promise<void>((resolve) => (releaseOld = resolve)), then: located() } : located()) : withFile(keys)(s)),
      [keys],
    );
    await twice.service.open(BASE);
    await twice.service.poll();
    const a = new MessageChannel();
    const b = new MessageChannel();
    ports.push(a.port1, a.port2, b.port1, b.port2);
    const old = twice.service.file(a.port1 as unknown as RpcPort);
    expect(await twice.service.file(b.port1 as unknown as RpcPort)).toEqual({ ok: true, size: FILE_SIZE });
    releaseOld();
    expect(await old).toEqual({ ok: false, failure: 'gone' });
    const plain = await readAll(feedResponse({ port: b.port2 as unknown as RpcPort, size: FILE_SIZE }));
    expect(plain.length).toBe(FILE_SIZE);
  });

  it('a second call ends the feed before it, and so do the status and close', async () => {
    const { service, serving, cancelled } = await readFile();
    expect((await service.file(serving)).ok).toBe(true);
    const again = new MessageChannel();
    ports.push(again.port1, again.port2);
    expect((await service.file(again.port1 as unknown as RpcPort)).ok).toBe(true);
    // The first download let go (nothing of it was read).
    expect(cancelled()).toBe(1);
    service.close();
    expect(cancelled()).toBe(2);
    expect(service.hasFeed()).toBe(false);
  });

  it("ends the feed when its reader cancels it", async () => {
    const { service, serving, reading, cancelled } = await readFile();
    expect((await service.file(serving)).ok).toBe(true);
    const feed = feedResponse({ port: reading, size: FILE_SIZE });
    expect((await feed.read())!.length).toBe(FILE_FRAME_BYTES);
    feed.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.hasFeed()).toBe(false);
    expect(cancelled()).toBe(1);
    // The session stays for the status.
    expect(await service.status('unreachable')).toEqual({ ok: true });
  });

  it("serves the file over RPC as the pair worker does, the port transferred", async () => {
    const keys = keyPair(17);
    const { transport } = api(withFile(keys));
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveRpc(port1 as unknown as RpcPort, pairHandlers({ transport, keyPair: () => keys }));
    const client = new RpcClient<ReturnType<typeof pairHandlers>>(port2 as unknown as RpcPort);
    await client.call('open', { base: BASE });
    expect((await client.call('poll')).state).toBe('ready');
    const feedChannel = new MessageChannel();
    ports.push(feedChannel.port1, feedChannel.port2);
    expect(await client.call('file', { port: feedChannel.port1 as unknown as RpcPort }, { transfer: [feedChannel.port1] })).toEqual({ ok: true, size: FILE_SIZE });
    const plain = await readAll(feedResponse({ port: feedChannel.port2 as unknown as RpcPort, size: FILE_SIZE }));
    expect(Buffer.from(plain).equals(Buffer.from(FILE_PLAIN))).toBe(true);
    client.close();
  });
});
