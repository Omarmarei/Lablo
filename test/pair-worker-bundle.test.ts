// The pair worker as the TV runs it (RELAY step 31c1): packages/data/src/pair.worker.ts bundled by
// the TV pipeline (Rollup IIFE, Babel chrome 53, core-js, the ES2016 gate), then run in a fresh
// realm that stands in for a Chromium 53 worker (no `BigInt`, no `globalThis`, none of the ES2017
// APIs Chromium 53 lacks), with a fake `fetch` playing the pairing API. A whole pairing goes
// through its RPC: a code (whose QR modules equal Node's), `waiting`, the phone's payload opened
// and parsed, the status posted. The old engines start this worker from the pairing screen
// (step 31c2's `verify:engines` walk).
import { randomFillSync } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { encodeQr } from '@lablo/core';
import { fromBase64Url, sealPairPayload, utf8 } from '@lablo/crypto';
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

/** A `fetch` answer as Chromium 53 gives it: a status, headers and a body stream of one chunk. */
function response(status: number, body: string) {
  let sent = false;
  return {
    status,
    headers: { get: (): string | null => null },
    body: {
      getReader: () => ({
        read: () => {
          if (sent) return Promise.resolve({ done: true, value: undefined });
          sent = true;
          return Promise.resolve({ done: false, value: new TextEncoder().encode(body) });
        },
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

describe('the pair worker bundle', () => {
  it('builds to gated Chromium 53 code within its budget and runs a whole pairing without BigInt or globalThis', async () => {
    const input = join(ROOT, 'packages/data/src/pair.worker.ts');
    const { code } = await bundleIife({ input, platform: 'webos', label: 'pair.worker.js' });
    expect(Buffer.byteLength(code, 'utf8')).toBeLessThanOrEqual(BUDGETS.worker);
    expect(code).not.toMatch(/BigInt\s*\(\s*\d/);
    // Neither core-js's DOMException nor its URL (zod's unused paths would bring them).
    for (const marker of ['DATA_CLONE_ERR', 'searchParams']) expect([marker, code.includes(marker)]).toEqual([marker, false]);

    const requests: Array<{ url: string; method: string; headers: Record<string, string>; body: string | null }> = [];
    let tvPk: Uint8Array | null = null;
    let polls = 0;
    const fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
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
    };

    const replies: Reply[] = [];
    const listeners: Array<(event: { data: unknown }) => void> = [];
    const realm = vm.createContext({
      postMessage: (message: Reply) => replies.push(JSON.parse(JSON.stringify(message)) as Reply),
      addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
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
    const call = async (m: string, a?: unknown): Promise<unknown> => {
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
});
