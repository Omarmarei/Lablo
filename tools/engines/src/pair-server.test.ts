import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FILE_FRAME_BYTES, fileCipherLength, fileFrameCount, fromBase64Url, newBoxKeyPair, openFile, openPairPayload, sealFile, toBase64Url } from '@lablo/crypto';
import type { PairPayload } from '@lablo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { phonePadded, phoneSees, phoneSends, phoneSendsFile } from './pair-phone';
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

  it("answers a whole file pairing (step 31d2b2a): the phone's upload and payload, the TV's file URL and GET, the bytes opened, then 404 after the status", async () => {
    server = await startPairServer('127.0.0.1');
    const tv = newBoxKeyPair();
    const created = await fetch(`${server.origin}/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tvPk: toBase64Url(tv.publicKey) }) });
    const { sid, code, pollToken } = (await created.json()) as { sid: string; code: string; pollToken: string };
    const plain = phonePadded('#EXTM3U\n#EXTINF:-1,Family channel\nhttp://family.example/live/1.ts\n', 2);

    await phoneSendsFile(server.origin, code, plain, { name: 'Family list', epg: ['http://family.example/guide.xml'] });
    const session = server.standIn.latest()!;
    // Only ciphertext reached the server, of exactly the encrypted length.
    expect(session.uploads).toHaveLength(1);
    expect(session.uploads[0]!.length).toBe(fileCipherLength(plain.length));
    expect(Buffer.from(session.uploads[0]!).toString('latin1')).not.toContain('Family');
    expect(JSON.stringify(session.posted)).not.toContain('Family');
    expect(await phoneSees(server.origin, code)).toEqual({ state: 'sent' });

    const read = await fetch(`${server.origin}/v1/pair/s/${sid}`, { headers: { authorization: `Bearer ${pollToken}` } });
    const ready = (await read.json()) as { payload: { phonePk: string; nonce: string; ct: string } };
    const payload = JSON.parse(new TextDecoder().decode(openPairPayload(ready.payload, tv.secretKey)!)) as PairPayload;
    expect(payload).toMatchObject({ v: 1, name: 'Family list', epg: ['http://family.example/guide.xml'], source: { type: 'm3u-file', file: { key: session.fileId, size: plain.length } } });
    const file = (payload.source as Extract<PairPayload['source'], { type: 'm3u-file' }>).file;

    const located = await fetch(`${server.origin}/v1/pair/s/${sid}/file`, { headers: { authorization: `Bearer ${pollToken}` } });
    expect(located.status).toBe(200);
    expect(located.headers.get('access-control-allow-origin')).toBe('*');
    const { url, key } = (await located.json()) as { url: string; key: string };
    expect(key).toBe(file.key);
    expect(url.startsWith(`/dev/blob/pair/${sid}/${file.key}?m=GET&`)).toBe(true);
    const blob = await fetch(server.origin + url);
    expect(blob.status).toBe(200);
    expect(blob.headers.get('access-control-allow-origin')).toBe('*');
    expect(blob.headers.get('content-length')).toBe(String(fileCipherLength(plain.length)));
    const opened = openFile(new Uint8Array(await blob.arrayBuffer()), fromBase64Url(file.fileKey)!, fromBase64Url(file.base)!, file.size);
    expect(opened !== null && Buffer.from(opened).equals(Buffer.from(plain)), 'the file opens to exactly what the phone sent').toBe(true);

    await fetch(`${server.origin}/v1/pair/s/${sid}/status`, { method: 'POST', headers: { authorization: `Bearer ${pollToken}`, 'content-type': 'application/json' }, body: '{"status":"ok"}' });
    expect(server.standIn.blobs.size).toBe(0);
    const gone = await fetch(server.origin + url);
    expect(gone.status).toBe(404);
    expect(gone.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('sends a broken file: one bit of the last frame flipped, so the frames before it open and the file does not', async () => {
    server = await startPairServer('127.0.0.1');
    const tv = newBoxKeyPair();
    const created = await fetch(`${server.origin}/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tvPk: toBase64Url(tv.publicKey) }) });
    const { code } = (await created.json()) as { code: string };
    const plain = phonePadded('#EXTM3U\n', 3);
    await phoneSendsFile(server.origin, code, plain, { broken: true });
    const session = server.standIn.latest()!;
    const payload = JSON.parse(new TextDecoder().decode(openPairPayload(session.posted[0]!, tv.secretKey)!)) as PairPayload;
    // No name or guide given: none sent.
    expect(Object.keys(payload).sort()).toEqual(['source', 'v']);
    const file = (payload.source as Extract<PairPayload['source'], { type: 'm3u-file' }>).file;
    const keys = [fromBase64Url(file.fileKey)!, fromBase64Url(file.base)!] as const;
    const uploaded = session.uploads[0]!;
    const good = sealFile(plain, keys[0], keys[1]);
    const differ: number[] = [];
    for (let i = 0; i < good.length; i += 1) if (good[i] !== uploaded[i]) differ.push(i);
    expect(differ).toEqual([good.length - 1]);
    expect(uploaded[good.length - 1]! ^ good[good.length - 1]!).toBe(1);
    expect(openFile(uploaded, keys[0], keys[1], file.size)).toBeNull();
  });

  it('refuses the file for a code the stand-in never gave, before uploading anything', async () => {
    server = await startPairServer('127.0.0.1');
    await expect(phoneSendsFile(server.origin, 'ABCD2345', phonePadded('#EXTM3U\n', 1))).rejects.toThrow("The TV's key for ABCD2345: HTTP 404");
    expect(server.standIn.blobs.size).toBe(0);
  });

  it('stops when the upload URL is refused (a payload already sent), and posts nothing more', async () => {
    server = await startPairServer('127.0.0.1');
    const tv = newBoxKeyPair();
    const created = await fetch(`${server.origin}/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tvPk: toBase64Url(tv.publicKey) }) });
    const { code } = (await created.json()) as { code: string };
    await phoneSends(server.origin, code, PAYLOAD);
    await expect(phoneSendsFile(server.origin, code, phonePadded('#EXTM3U\n', 1))).rejects.toThrow(`The upload URL for ${code}: HTTP 409`);
    expect(server.standIn.latest()!.posted).toHaveLength(1);
    expect(server.standIn.blobs.size).toBe(0);
  });

  it('stops when the PUT is refused, and posts no payload', async () => {
    const tv = toBase64Url(newBoxKeyPair().publicKey);
    const asked: string[] = [];
    const refusing = createServer((request, response) => {
      asked.push(`${request.method ?? ''} ${(request.url ?? '').split('?')[0]!}`);
      request.resume();
      request.on('end', () => {
        if (request.url === '/v1/pair/ABCD2345') response.end(JSON.stringify({ tvPk: tv, exp: Date.now() + 60_000 }));
        else if (request.url === '/v1/pair/ABCD2345/upload-url') response.end(JSON.stringify({ url: '/dev/blob/pair/x/y?m=PUT&n=24&e=1&s=a', key: 'A'.repeat(22), exp: Date.now() + 60_000 }));
        else {
          response.writeHead(403);
          response.end();
        }
      });
    });
    await new Promise<void>((resolve) => refusing.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${(refusing.address() as AddressInfo).port}`;
      await expect(phoneSendsFile(origin, 'ABCD2345', phonePadded('#EXTM3U\n', 1))).rejects.toThrow('The upload for ABCD2345: HTTP 403');
      // The path resolved against the origin; nothing after it.
      expect(asked).toEqual(['GET /v1/pair/ABCD2345', 'POST /v1/pair/ABCD2345/upload-url', 'PUT /dev/blob/pair/x/y']);
    } finally {
      refusing.closeAllConnections();
      await new Promise<void>((resolve) => refusing.close(() => resolve()));
    }
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

describe('phonePadded', () => {
  it('pads a playlist at its end with 1 KiB comment lines until it needs exactly the frames asked', () => {
    const text = '#EXTM3U\n#EXTINF:-1,One\nhttp://one.example/1.ts';
    for (const frames of [1, 2, 3]) {
      const padded = phonePadded(text, frames);
      expect(fileFrameCount(padded.length), String(frames)).toBe(frames);
      // Just past the frames before: the last frame holds less than a pad line more than one byte.
      expect(padded.length - (frames - 1) * FILE_FRAME_BYTES, String(frames)).toBeLessThanOrEqual(1024);
      const decoded = new TextDecoder().decode(padded);
      expect(decoded.startsWith(`${text}\n`)).toBe(true);
      for (const line of decoded.slice(text.length + 1).split('\n').slice(0, -1)) {
        expect(line.startsWith('#PAD ')).toBe(true);
        expect(line.length).toBe(1023);
      }
      expect(decoded.endsWith('\n')).toBe(true);
    }
    // A playlist ending in a newline gets no second one; one frame needs no pad.
    expect(new TextDecoder().decode(phonePadded('#EXTM3U\n', 1))).toBe('#EXTM3U\n');
  });

  it('refuses a playlist that already needs more frames', () => {
    expect(() => phonePadded(`#EXTM3U\n${'#'.repeat(FILE_FRAME_BYTES)}`, 1)).toThrow('The padded playlist needs 2 frames, not 1');
  });
});
