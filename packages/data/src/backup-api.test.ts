import { describe, expect, it } from 'vitest';
import type { BackupEnvelope } from '@lablo/crypto';
import { BACKUP_ANSWER_MAX_BYTES, BACKUP_TIMEOUT_MS, BackupApi, envelopeBody, readEnvelope } from './backup-api';
import type { ByteRequest, ByteResponse, ByteTransport } from './bytes';
import { NetworkError } from './bytes';
import type { Clock } from './throttle';

const BASE = 'http://api.test:8091';
const ID = 'A'.repeat(42) + 'E';
const TOKEN = 'B'.repeat(42) + 'I';
const ENVELOPE: BackupEnvelope = { v: 1, kdf: 'scrypt-15-8-1', nonce: 'N'.repeat(32), ct: 'Q2lwaGVydGV4dA' };

/** A clock whose sleeps end only when the test says. */
function manualClock() {
  const sleepers: { ms: number; wake: () => void }[] = [];
  const clock: Clock = {
    now: () => 0,
    sleep: (ms) => new Promise<void>((resolve) => sleepers.push({ ms, wake: resolve })),
  };
  return { clock, sleepers, expire: () => sleepers.splice(0).forEach((s) => s.wake()) };
}

interface Seen {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Script {
  status?: number;
  chunks?: Uint8Array[];
  /** Throws on this read (0-based). */
  failAt?: number;
  /** The answer never comes. */
  hang?: boolean;
  /** The body's read at this index never ends. */
  hangAt?: number;
  /** The transport itself rejects. */
  reject?: boolean;
}

function transport(script: Script = {}) {
  const seen: Seen[] = [];
  const state = { cancelled: 0, reads: 0 };
  const t: ByteTransport = {
    get(url: string, request: ByteRequest = {}): Promise<ByteResponse> {
      seen.push({ url, method: request.method, headers: { ...(request.headers ?? {}) }, body: request.body });
      if (script.reject) return Promise.reject(new NetworkError());
      if (script.hang) return new Promise<ByteResponse>(() => undefined);
      const chunks = script.chunks ?? [];
      let at = 0;
      return Promise.resolve({
        status: script.status ?? 200,
        header: () => null,
        read() {
          const n = state.reads++;
          if (script.failAt === n) return Promise.reject(new NetworkError());
          if (script.hangAt === n) return new Promise<Uint8Array | null>(() => undefined);
          return Promise.resolve(at < chunks.length ? chunks[at++]! : null);
        },
        cancel() {
          state.cancelled++;
        },
      });
    },
  };
  return { t, seen, state };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("the client's limits", () => {
  it('are pinned: 20 s a request, an answer of at most 512 KB and 1 KB', () => {
    expect(BACKUP_TIMEOUT_MS).toBe(20_000);
    expect(BACKUP_ANSWER_MAX_BYTES).toBe(524288 + 1024);
  });
});

describe('envelopeBody', () => {
  it("is the envelope's JSON, its fields in the API's order", () => {
    expect(envelopeBody(ENVELOPE)).toBe(JSON.stringify(ENVELOPE));
    expect(JSON.parse(envelopeBody(ENVELOPE))).toEqual(ENVELOPE);
  });
});

describe('readEnvelope', () => {
  it("gives an envelope's four fields, and nothing else", () => {
    expect(readEnvelope(envelopeBody(ENVELOPE))).toEqual(ENVELOPE);
    expect(readEnvelope(JSON.stringify({ ...ENVELOPE, extra: 1 }))).toEqual(ENVELOPE);
    // The kdf is passed on as given: openBackup refuses another.
    expect(readEnvelope(JSON.stringify({ ...ENVELOPE, kdf: 'other' }))).toEqual({ ...ENVELOPE, kdf: 'other' });
  });

  it.each([
    ['no text', null],
    ['text that is not JSON', '{"v":1'],
    ['JSON null', 'null'],
    ['a number', '1'],
    ['version 2', JSON.stringify({ ...ENVELOPE, v: 2 })],
    ['version "1"', JSON.stringify({ ...ENVELOPE, v: '1' })],
    ['a kdf that is not text', JSON.stringify({ ...ENVELOPE, kdf: 15 })],
    ['no nonce', JSON.stringify({ v: 1, kdf: ENVELOPE.kdf, ct: ENVELOPE.ct })],
    ['a nonce that is not text', JSON.stringify({ ...ENVELOPE, nonce: [1] })],
    ['no ciphertext', JSON.stringify({ v: 1, kdf: ENVELOPE.kdf, nonce: ENVELOPE.nonce })],
    ['a ciphertext that is not text', JSON.stringify({ ...ENVELOPE, ct: 7 })],
  ])('gives nothing for %s', (_, text) => {
    expect(readEnvelope(text)).toBeNull();
  });
});

describe('BackupApi', () => {
  it("GETs the lookup ID's path with no token, and gives a 200's text from all its chunks", async () => {
    const { t, seen, state } = transport({ chunks: [bytes('{"v":1,'), bytes('"kdf":"x"}')] });
    const answer = await new BackupApi(t, manualClock().clock).get(BASE, ID, true);
    expect(answer).toEqual({ failure: null, status: 200, text: '{"v":1,"kdf":"x"}' });
    expect(seen).toEqual([{ url: `${BASE}/v1/backup/${ID}`, method: 'GET', headers: {}, body: undefined }]);
    expect(state.cancelled).toBe(0);
  });

  it("doesn't read a GET's body when asked for the status alone, or when it isn't 200", async () => {
    for (const [status, read] of [
      [200, false],
      [404, true],
      [429, true],
    ] as const) {
      const { t, state } = transport({ status, chunks: [bytes('{"error":"x"}')] });
      expect(await new BackupApi(t, manualClock().clock).get(BASE, ID, read)).toEqual({ failure: null, status, text: null });
      expect(state).toEqual({ cancelled: 1, reads: 0 });
    }
  });

  it('PUTs the envelope as JSON with the write token, and answers the status alone', async () => {
    const { t, seen, state } = transport({ status: 200, chunks: [bytes('{"state":"stored"}')] });
    expect(await new BackupApi(t, manualClock().clock).put(BASE, ID, TOKEN, ENVELOPE)).toEqual({ failure: null, status: 200, text: null });
    expect(seen).toEqual([{ url: `${BASE}/v1/backup/${ID}`, method: 'PUT', headers: { 'content-type': 'application/json', 'x-write-token': TOKEN }, body: envelopeBody(ENVELOPE) }]);
    expect(state).toEqual({ cancelled: 1, reads: 0 });
  });

  it('DELETEs with the write token and no body', async () => {
    const { t, seen } = transport({ status: 404 });
    expect(await new BackupApi(t, manualClock().clock).remove(BASE, ID, TOKEN)).toEqual({ failure: null, status: 404, text: null });
    expect(seen).toEqual([{ url: `${BASE}/v1/backup/${ID}`, method: 'DELETE', headers: { 'x-write-token': TOKEN }, body: undefined }]);
  });

  it('gives `network` when the connection fails, before the answer or within its body', async () => {
    expect(await new BackupApi(transport({ reject: true }).t, manualClock().clock).get(BASE, ID, true)).toEqual({ failure: 'network' });
    expect(await new BackupApi(transport({ reject: true }).t, manualClock().clock).put(BASE, ID, TOKEN, ENVELOPE)).toEqual({ failure: 'network' });
    expect(await new BackupApi(transport({ chunks: [bytes('{"v"'), bytes(':1}')], failAt: 1 }).t, manualClock().clock).get(BASE, ID, true)).toEqual({ failure: 'network' });
  });

  it(`reads an answer of exactly ${BACKUP_ANSWER_MAX_BYTES} bytes, and gives up on one byte more`, async () => {
    const full = new Uint8Array(BACKUP_ANSWER_MAX_BYTES).fill(0x61);
    const fits = await new BackupApi(transport({ chunks: [full.slice(0, 1000), full.slice(1000)] }).t, manualClock().clock).get(BASE, ID, true);
    expect(fits.failure === null && fits.text!.length).toBe(BACKUP_ANSWER_MAX_BYTES);
    const over = transport({ chunks: [full.slice(0, 1000), full.slice(1000), bytes('a'), bytes('never read')] });
    expect(await new BackupApi(over.t, manualClock().clock).get(BASE, ID, true)).toEqual({ failure: 'too-large' });
    expect(over.state).toEqual({ cancelled: 1, reads: 3 });
  });

  it(`gives \`timeout\` after ${BACKUP_TIMEOUT_MS} ms with no answer, and cancels one that comes after`, async () => {
    const { clock, sleepers, expire } = manualClock();
    let answer!: (response: ByteResponse) => void;
    const late = { cancelled: 0 };
    const t: ByteTransport = {
      get: () =>
        new Promise<ByteResponse>((resolve) => {
          answer = resolve;
        }),
    };
    const pending = new BackupApi(t, clock).get(BASE, ID, true);
    expect(sleepers.map((s) => s.ms)).toEqual([BACKUP_TIMEOUT_MS]);
    expire();
    expect(await pending).toEqual({ failure: 'timeout' });
    answer({ status: 200, header: () => null, read: () => Promise.resolve(null), cancel: () => late.cancelled++ });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.cancelled).toBe(1);
  });

  it('gives `timeout` when the body stops coming, and cancels it', async () => {
    const { clock, expire } = manualClock();
    const { t, state } = transport({ chunks: [bytes('{')], hangAt: 1 });
    const pending = new BackupApi(t, clock).get(BASE, ID, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.reads).toBe(2);
    expire();
    expect(await pending).toEqual({ failure: 'timeout' });
    expect(state.cancelled).toBe(1);
  });

  it('keeps an answer that comes within the time limit', async () => {
    const { clock, expire } = manualClock();
    const { t, state } = transport({ status: 404 });
    const pending = new BackupApi(t, clock).get(BASE, ID, true);
    const answer = await pending;
    expire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answer).toEqual({ failure: null, status: 404, text: null });
    expect(await pending).toEqual({ failure: null, status: 404, text: null });
    // Cancelled once, by the answer itself (it wasn't read): the time limit doesn't touch it.
    expect(state.cancelled).toBe(1);
  });
});
