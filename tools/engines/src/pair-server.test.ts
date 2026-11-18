import { request } from 'node:http';
import { newBoxKeyPair, openPairPayload, toBase64Url } from '@lablo/crypto';
import type { PairPayload } from '@lablo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { phoneSees, phoneSends } from './pair-phone';
import type { PairServer } from './pair-server';
import { startPairServer } from './pair-server';

/** The stand-in over HTTP (RELAY step 31c2b): what the old-engine walk's TV and phone talk to. */

let server: PairServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

const PAYLOAD: PairPayload = { v: 1, source: { type: 'm3u', url: 'http://127.0.0.1:8090/list.m3u' }, name: 'Phone list' };

describe('startPairServer', () => {
  it("answers a whole pairing: the TV's code, the phone's sealed payload, the TV's read and status, the phone's progress", async () => {
    server = await startPairServer('127.0.0.1');
    expect(server.origin).toBe(`http://127.0.0.1:${server.port}`);
    const tv = newBoxKeyPair();
    const created = await fetch(`${server.origin}/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tvPk: toBase64Url(tv.publicKey) }) });
    expect(created.status).toBe(201);
    expect(created.headers.get('access-control-allow-origin')).toBe('*');
    const { sid, code, pollToken } = (await created.json()) as { sid: string; code: string; pollToken: string };
    expect(server.standIn.latest()?.code).toBe(code);
    expect(await phoneSees(server.origin, code)).toMatchObject({ state: 'open' });

    await phoneSends(server.origin, code, PAYLOAD);
    expect(await phoneSees(server.origin, code)).toEqual({ state: 'sent' });
    const read = await fetch(`${server.origin}/v1/pair/s/${sid}`, { headers: { authorization: `Bearer ${pollToken}` } });
    const ready = (await read.json()) as { state: string; payload: { phonePk: string; nonce: string; ct: string } };
    expect(ready.state).toBe('ready');
    const plain = openPairPayload(ready.payload, tv.secretKey);
    expect(JSON.parse(new TextDecoder().decode(plain!))).toEqual(PAYLOAD);
    expect(await phoneSees(server.origin, code)).toEqual({ state: 'received' });

    const status = await fetch(`${server.origin}/v1/pair/s/${sid}/status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${pollToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    });
    expect(status.status).toBe(200);
    expect(await phoneSees(server.origin, code)).toEqual({ state: 'done', status: 'ok' });
  });

  it("answers the TV's preflight, and a 404 with the TV's CORS for anything else (the config too)", async () => {
    server = await startPairServer('127.0.0.1');
    const preflight = await fetch(`${server.origin}/v1/pair`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
    for (const path of ['/v1/config', '/', '/p']) {
      const answer = await fetch(`${server.origin}${path}`);
      expect(answer.status, path).toBe(404);
      expect(answer.headers.get('access-control-allow-origin'), path).toBe('*');
    }
  });

  it('refuses a phone whose code the stand-in never gave', async () => {
    server = await startPairServer('127.0.0.1');
    await expect(phoneSends(server.origin, 'ABCD2345', PAYLOAD)).rejects.toThrow("The TV's key for ABCD2345: HTTP 404");
  });

  it('stops with a request still coming in (an engine stopped in the middle of one)', async () => {
    server = await startPairServer('127.0.0.1');
    const port = server.port;
    const coming = request({ host: '127.0.0.1', port, path: '/v1/pair', method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': '100' } });
    const ended = new Promise<string>((resolve) => {
      coming.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
      coming.on('response', (answer) => resolve(`HTTP ${answer.statusCode ?? 0}`));
    });
    coming.write('{"tvPk":');
    // The server has the request's head; its body never ends.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stopping = server.stop();
    server = null;
    await expect(Promise.race([stopping.then(() => 'stopped'), new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2_000))])).resolves.toBe('stopped');
    expect(await ended).toBe('ECONNRESET');
  });

  it('stops with a kept-alive connection still open (the engine keeps its socat connections)', async () => {
    server = await startPairServer('127.0.0.1');
    const port = server.port;
    await new Promise<void>((resolve, reject) => {
      const held = request({ host: '127.0.0.1', port, path: '/v1/config', agent: false, headers: { connection: 'keep-alive' } }, (answer) => {
        answer.resume();
        answer.on('end', () => resolve());
      });
      held.on('error', reject);
      held.end();
    });
    const stopping = server.stop();
    server = null;
    await expect(Promise.race([stopping.then(() => 'stopped'), new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2_000))])).resolves.toBe('stopped');
  });
});
