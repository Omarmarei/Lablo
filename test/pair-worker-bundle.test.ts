// The pair worker as the TV runs it (RELAY step 31c1): packages/data/src/pair.worker.ts bundled by
// the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, the ES2016 gate), then run in a fresh
// realm that stands in for a Chromium 53 worker (no `BigInt`, no `globalThis`, none of the ES2017
// APIs Chromium 53 lacks), with a fake `fetch` playing the pairing API. A whole pairing goes
// through its RPC: a code (whose QR modules equal Node's), `waiting`, the phone's payload opened
// and parsed, the status posted. Step 31d2a: the phone's M3U file, its URL asked for, fetched and
// opened frame by frame in the realm, its plain frames read from a port as the ingest worker reads
// them. The old engines start this worker from the pairing screen (step 31c2's `verify:engines`
// walk).
import { randomFillSync } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { encodeQr } from '@lablo/core';
import { FILE_FRAME_BYTES, fromBase64Url, sealFile, sealPairPayload, toBase64Url, utf8 } from '@lablo/crypto';
import type { RpcPort } from '@lablo/data';
import { feedResponse } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { bundleIife } from '../tools/build/src/bundle';
import { BUDGETS } from '../tools/build/src/budgets';
import { CHROMIUM_53_MISSING } from './realm-support';

const ROOT = join(import.meta.dirname, '..');
const BASE = 'http://api.test';
const SID = 'AAAAAAAAAAAAAAAAAAAAAA';
const TOKEN = 'A'.repeat(43);
const PAYLOAD = { v: 1, source: { type: 'xtream', server: 'http://panel.example:8080', username: 'user', password: 'pass' }, name: 'غرفة الجلوس', epg: ['http://epg.example/a.xml'] };

interface Reply {
  readonly zr: 1;
  readonly t: string;
  readonly id: number;
  readonly v?: unknown;
  readonly e?: { message: string };
}

interface Request {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<unknown>;

/** A `fetch` answer as Chromium 53 gives it: a status, headers and a body stream in 64 KB chunks. */
function response(status: number, body: string | Uint8Array, headers: Record<string, string> = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  let at = 0;
  return {
    status,
    headers: { get: (name: string): string | null => headers[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: () => {
          if (at >= bytes.length) return Promise.resolve({ done: true, value: undefined });
          const value = bytes.slice(at, at + 65536);
          at += value.length;
          return Promise.resolve({ done: false, value });
        },
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

type Listener = (event: { data: unknown }) => void;

/** Two ends of a message channel between realms: structured clone, asynchronous delivery. */
function pipe(): [RpcPort, RpcPort] {
  const listeners: [Listener[], Listener[]] = [[], []];
  const end = (mine: Listener[], theirs: Listener[]): RpcPort => ({
    postMessage: (message) => {
      const data = structuredClone(message);
      setTimeout(() => {
        for (const l of theirs.slice()) l({ data });
      }, 0);
    },
    addEventListener: (_type, l) => {
      mine.push(l as Listener);
    },
    removeEventListener: (_type, l) => {
      const i = mine.indexOf(l as Listener);
      if (i !== -1) mine.splice(i, 1);
    },
  });
  return [end(listeners[0], listeners[1]), end(listeners[1], listeners[0])];
}

let bundled: Promise<string> | null = null;
/** The pair worker as the TV build bundles it (once for this file). */
function pairWorkerCode(): Promise<string> {
  bundled ??= bundleIife({ input: join(ROOT, 'packages/data/src/pair.worker.ts'), platform: 'webos', label: 'pair.worker.js' }).then((built) => built.code);
  return bundled;
}

/** The worker started in a fresh Chromium 53 realm over `fetch`: its RPC, called as the app calls it. */
function startRealm(code: string, fetch: Fetch): (m: string, a?: unknown) => Promise<unknown> {
  const replies: Reply[] = [];
  const listeners: Listener[] = [];
  const realm = vm.createContext({
    postMessage: (message: Reply) => replies.push(JSON.parse(JSON.stringify(message)) as Reply),
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') listeners.push(listener);
    },
    removeEventListener: () => undefined,
    fetch,
    TextDecoder,
    TextEncoder,
    crypto: { getRandomValues: (array: Uint8Array): Uint8Array => randomFillSync(array) },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext('var self = this;', realm);
  vm.runInContext(CHROMIUM_53_MISSING, realm);
  expect(vm.runInContext('typeof BigInt + " " + typeof globalThis + " " + typeof Object.values', realm)).toBe('undefined undefined undefined');
  vm.runInContext(code, realm);
  expect(listeners).toHaveLength(1);

  let id = 0;
  return async (m, a) => {
    id++;
    listeners[0]!({ data: { zr: 1, t: 'call', id, m, a } });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const reply = replies.find((r) => r.id === id);
      if (reply !== undefined) {
        if (reply.t !== 'ok') throw new Error(reply.e?.message ?? 'error');
        return reply.v;
      }
      if (Date.now() > deadline) throw new Error(`no answer to ${m}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
}

describe('the pair worker bundle', () => {
  it('builds to gated Chromium 53 code within its budget and runs a whole pairing without BigInt or globalThis', async () => {
    const code = await pairWorkerCode();
    expect(Buffer.byteLength(code, 'utf8')).toBeLessThanOrEqual(BUDGETS.worker);
    expect(code).not.toMatch(/BigInt\s*\(\s*\d/);
    // Neither core-js's DOMException nor its URL (zod's unused paths would bring them).
    for (const marker of ['DATA_CLONE_ERR', 'searchParams']) expect([marker, code.includes(marker)]).toEqual([marker, false]);

    const requests: Request[] = [];
    let tvPk: Uint8Array | null = null;
    let polls = 0;
    const call = startRealm(code, (url, init) => {
      requests.push({ url, method: init.method, headers: init.headers, body: init.body ?? null });
      if (url === `${BASE}/v1/pair`) {
        tvPk = fromBase64Url((JSON.parse(init.body!) as { tvPk: string }).tvPk);
        return Promise.resolve(response(201, JSON.stringify({ sid: SID, code: '7K3MZ9QX', pollToken: TOKEN, exp: 1_900_000_000_000 })));
      }
      if (url === `${BASE}/v1/pair/s/${SID}`) {
        polls++;
        if (polls === 1) return Promise.resolve(response(200, JSON.stringify({ state: 'waiting', exp: 1_900_000_000_000 })));
        return Promise.resolve(response(200, JSON.stringify({ state: 'ready', payload: sealPairPayload(utf8(JSON.stringify(PAYLOAD)), tvPk!) })));
      }
      return Promise.resolve(response(200, '{"state":"done","status":"ok"}'));
    });

    const opened = (await call('open', { base: BASE })) as { ok: boolean; code: { code: string; link: string; typed: string; qr: { rows: string[] } } };
    expect(opened.ok).toBe(true);
    expect(opened.code.code).toBe('7K3MZ9QX');
    expect(opened.code.typed).toBe('api.test/p');
    // The QR code drawn in the realm is the one Node draws for the same link.
    expect(opened.code.qr.rows).toEqual(encodeQr(opened.code.link)!.rows);
    expect(await call('poll')).toEqual({ state: 'waiting' });
    expect(await call('poll')).toEqual({ state: 'ready', payload: PAYLOAD });
    expect(await call('status', { status: 'ok' })).toEqual({ ok: true });
    expect(requests.map((r) => `${r.method} ${r.url.slice(BASE.length)}`)).toEqual(['POST /v1/pair', `GET /v1/pair/s/${SID}`, `GET /v1/pair/s/${SID}`, `POST /v1/pair/s/${SID}/status`]);
    expect(requests[1]!.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(requests[3]!.body).toBe('{"status":"ok"}');
    console.log(`pair worker: ${(Buffer.byteLength(code, 'utf8') / 1024).toFixed(1)} KB`);
  });

  it("fetches the phone's file and serves its opened frames on a port, in the Chromium 53 realm (step 31d2a)", async () => {
    const code = await pairWorkerCode();
    const fileKey = new Uint8Array(32).fill(12);
    const base = new Uint8Array(24).fill(0xff);
    const size = 2 * FILE_FRAME_BYTES + 12_345;
    const plain = new Uint8Array(size).map((_, i) => (i * 29 + 3) & 255);
    const sealed = sealFile(plain, fileKey, base);
    const blobKey = 'b'.repeat(21) + 'A';
    const blobPath = `/dev/blob/pair/${SID}/${blobKey}?m=GET&n=0&e=1900000000000&s=sig`;
    const payload = { v: 1, source: { type: 'm3u-file', file: { key: blobKey, fileKey: toBase64Url(fileKey), base: toBase64Url(base), size } } };

    const requests: Request[] = [];
    let tvPk: Uint8Array | null = null;
    const call = startRealm(code, (url, init) => {
      requests.push({ url, method: init.method, headers: init.headers, body: init.body ?? null });
      if (url === `${BASE}/v1/pair`) {
        tvPk = fromBase64Url((JSON.parse(init.body!) as { tvPk: string }).tvPk);
        return Promise.resolve(response(201, JSON.stringify({ sid: SID, code: '7K3MZ9QX', pollToken: TOKEN, exp: 1_900_000_000_000 })));
      }
      if (url === `${BASE}/v1/pair/s/${SID}`) return Promise.resolve(response(200, JSON.stringify({ state: 'ready', payload: sealPairPayload(utf8(JSON.stringify(payload)), tvPk!) })));
      if (url === `${BASE}/v1/pair/s/${SID}/file`) return Promise.resolve(response(200, JSON.stringify({ url: blobPath, key: blobKey, exp: 1_900_000_000_000 })));
      if (url === BASE + blobPath) return Promise.resolve(response(200, sealed, { 'content-length': String(sealed.length) }));
      return Promise.resolve(response(200, '{"state":"done","status":"ok"}'));
    });

    expect(((await call('open', { base: BASE })) as { ok: boolean }).ok).toBe(true);
    expect(await call('poll')).toEqual({ state: 'ready', payload });
    // The port as the worker gets it (the app transfers one end of a MessageChannel).
    const [workerEnd, ingestEnd] = pipe();
    expect(await call('file', { port: workerEnd })).toEqual({ ok: true, size });
    const feed = feedResponse({ port: ingestEnd, size });
    const parts: Uint8Array[] = [];
    for (let chunk = await feed.read(); chunk !== null; chunk = await feed.read()) parts.push(chunk);
    expect(parts.map((p) => p.length)).toEqual([FILE_FRAME_BYTES, FILE_FRAME_BYTES, 12_345]);
    expect(Buffer.concat(parts).equals(Buffer.from(plain))).toBe(true);
    expect(await call('status', { status: 'ok' })).toEqual({ ok: true });
    expect(requests.map((r) => `${r.method} ${r.url.slice(BASE.length)}`)).toEqual(['POST /v1/pair', `GET /v1/pair/s/${SID}`, `GET /v1/pair/s/${SID}/file`, `GET ${blobPath}`, `POST /v1/pair/s/${SID}/status`]);
    expect(requests[2]!.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(requests[3]!.headers).toEqual({});
  });
});
