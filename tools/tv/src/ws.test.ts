import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestServer } from './test-server';
import { startTestServer, until } from './test-server';
import type { RawWebSocket } from './ws';
import { acceptFor, encodeFrame, FrameParser, OPCODE, openRawWebSocket, readUpgradeResponse, upgradeRequest } from './ws';

const MASK = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);

function bytes(length: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, i) => (i * 7 + 3) % 256));
}

describe('encodeFrame', () => {
  it('puts a short payload in the second byte, final and unmasked for a server', () => {
    // RFC 6455 5.7's single-frame unmasked "Hello".
    expect(encodeFrame(OPCODE.text, Buffer.from('Hello'), null)).toEqual(Buffer.from([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]));
  });

  it('masks a client frame with its key', () => {
    // RFC 6455 5.7's single-frame masked "Hello".
    expect(encodeFrame(OPCODE.text, Buffer.from('Hello'), MASK)).toEqual(
      Buffer.from([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]),
    );
  });

  it('takes 7 bits up to 125 bytes, 16 bits up to 65,535, 64 bits beyond', () => {
    expect([...encodeFrame(OPCODE.binary, bytes(125), null).subarray(0, 2)]).toEqual([0x82, 125]);
    const at126 = encodeFrame(OPCODE.binary, bytes(126), MASK);
    expect([at126[0], at126[1], at126.readUInt16BE(2)]).toEqual([0x82, 0x80 | 126, 126]);
    expect(at126.length).toBe(4 + 4 + 126);
    const at65535 = encodeFrame(OPCODE.text, bytes(65_535), null);
    expect([at65535[1], at65535.readUInt16BE(2), at65535.length]).toEqual([126, 65_535, 4 + 65_535]);
    const at65536 = encodeFrame(OPCODE.text, bytes(65_536), MASK);
    expect([at65536[1], at65536.readBigUInt64BE(2), at65536.length]).toEqual([0x80 | 127, BigInt(65_536), 10 + 4 + 65_536]);
  });

  it('round-trips through the parser at every size boundary, masked or not', () => {
    for (const length of [0, 1, 125, 126, 127, 65_535, 65_536, 70_000]) {
      for (const mask of [null, MASK]) {
        const payload = bytes(length);
        expect(new FrameParser().push(encodeFrame(OPCODE.binary, payload, mask))).toEqual([{ opcode: OPCODE.binary, payload }]);
      }
    }
  });
});

describe('FrameParser', () => {
  const message = encodeFrame(OPCODE.text, Buffer.from('{"event":"ms.channel.connect"}'), null);
  const long = encodeFrame(OPCODE.text, bytes(300), MASK);
  const huge = encodeFrame(OPCODE.text, bytes(66_000), null);

  it('waits for the rest of a frame split anywhere, one byte at a time included', () => {
    for (const frame of [message, long, huge]) {
      const parser = new FrameParser();
      const out = [];
      for (let i = 0; i < frame.length; i += frame === huge ? 997 : 1) out.push(...parser.push(frame.subarray(i, Math.min(frame.length, i + (frame === huge ? 997 : 1)))));
      expect(out).toHaveLength(1);
      expect(out[0]?.payload).toEqual(new FrameParser().push(frame)[0]?.payload);
    }
  });

  it('gives several frames from one chunk, in order, and keeps a partial one', () => {
    const parser = new FrameParser();
    const both = Buffer.concat([message, long, huge.subarray(0, 5)]);
    expect(parser.push(both).map((frame) => frame.payload.length)).toEqual([30, 300]);
    expect(parser.push(huge.subarray(5)).map((frame) => frame.payload.length)).toEqual([66_000]);
  });

  it('joins a message sent in continuation frames, with a ping between its parts', () => {
    const part = (fin: boolean, opcode: number, text: string): Buffer => {
      const frame = encodeFrame(opcode, Buffer.from(text), null);
      if (!fin) frame[0] = (frame[0] ?? 0) & 0x7f;
      return frame;
    };
    const parser = new FrameParser();
    const out = parser.push(
      Buffer.concat([part(false, OPCODE.text, 'ab'), encodeFrame(OPCODE.ping, Buffer.from('p'), null), part(false, OPCODE.continuation, 'cd'), part(true, OPCODE.continuation, 'ef')]),
    );
    expect(out.map((frame) => [frame.opcode, frame.payload.toString()])).toEqual([
      [OPCODE.ping, 'p'],
      [OPCODE.text, 'abcdef'],
    ]);
    // The next message starts afresh.
    expect(parser.push(part(true, OPCODE.binary, 'z')).map((frame) => [frame.opcode, frame.payload.toString()])).toEqual([[OPCODE.binary, 'z']]);
  });
});

describe('the handshake', () => {
  it('asks for an upgrade with the Origin the TV wants', () => {
    expect(upgradeRequest('10.0.0.2', 8002, '/api/v2/channels/x?name=YQ==', 'a2V5', 'http://10.0.0.2:8002')).toBe(
      'GET /api/v2/channels/x?name=YQ== HTTP/1.1\r\nHost: 10.0.0.2:8002\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: a2V5\r\nSec-WebSocket-Version: 13\r\nOrigin: http://10.0.0.2:8002\r\n\r\n',
    );
  });

  it('reads the answer once its header is complete, keeping the bytes after it', () => {
    expect(readUpgradeResponse(Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'))).toBeNull();
    const answer = readUpgradeResponse(
      Buffer.concat([Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nX-Odd:a:b\r\nbad line\r\n\r\n'), Buffer.from([0x81, 0x00])]),
    );
    expect(answer?.status).toBe(101);
    expect(answer?.statusLine).toBe('HTTP/1.1 101 Switching Protocols');
    expect(answer?.headers).toEqual({ upgrade: 'websocket', 'x-odd': 'a:b' });
    expect([...(answer?.rest ?? [])]).toEqual([0x81, 0x00]);
    expect(readUpgradeResponse(Buffer.from('HTTP/1.0 403 Forbidden\r\n\r\n'))?.status).toBe(403);
    expect(readUpgradeResponse(Buffer.from('nonsense\r\n\r\n'))?.status).toBe(0);
  });

  it('computes the accept value of RFC 6455 4.2.2', () => {
    expect(acceptFor('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('openRawWebSocket (a local server, no TV)', () => {
  let server: TestServer | undefined;
  let client: RawWebSocket | undefined;
  afterEach(async () => {
    client?.close();
    client = undefined;
    await server?.close();
    server = undefined;
  });

  it('upgrades with the TV headers, then carries text both ways', async () => {
    server = await startTestServer({ onOpen: (peer) => peer.send(OPCODE.text, '{"event":"ms.channel.connect"}') });
    const received: string[] = [];
    client = await openRawWebSocket({ host: '127.0.0.1', port: server.port, path: '/api/v2/x?name=TGFibG8=', secure: false, onText: (text) => received.push(text) });
    await until(() => received.length === 1);
    expect(received).toEqual(['{"event":"ms.channel.connect"}']);
    const peer = server.peers[0];
    expect(peer?.path).toBe('/api/v2/x?name=TGFibG8=');
    expect(peer?.headers.origin).toBe(`http://127.0.0.1:${server.port}`);
    expect(peer?.headers.host).toBe(`127.0.0.1:${server.port}`);
    expect(peer?.headers['sec-websocket-version']).toBe('13');
    expect(Buffer.from(String(peer?.headers['sec-websocket-key']), 'base64')).toHaveLength(16);
    client.send('{"method":"ms.remote.control"}');
    client.send('x'.repeat(200));
    await until(() => (peer?.frames.length ?? 0) === 2);
    expect(peer?.frames.map((frame) => [frame.opcode, frame.payload.toString()])).toEqual([
      [OPCODE.text, '{"method":"ms.remote.control"}'],
      [OPCODE.text, 'x'.repeat(200)],
    ]);
  });

  it('takes frames the server sends with its 101, split frames, and a custom Origin', async () => {
    const frame = encodeFrame(OPCODE.text, Buffer.from('second'), null);
    server = await startTestServer({
      onOpen: (peer) => {
        peer.send(OPCODE.text, 'first');
        peer.write(frame.subarray(0, 3));
        setTimeout(() => peer.write(frame.subarray(3)), 20);
      },
    });
    const received: string[] = [];
    client = await openRawWebSocket({ host: '127.0.0.1', port: server.port, path: '/', secure: false, origin: 'http://tv', onText: (text) => received.push(text) });
    await until(() => received.length === 2);
    expect(received).toEqual(['first', 'second']);
    expect(server.peers[0]?.headers.origin).toBe('http://tv');
  });

  it('answers a ping with a pong carrying its payload, and ignores binary and pong frames', async () => {
    server = await startTestServer({
      onOpen: (peer) => {
        peer.send(OPCODE.binary, 'bin');
        peer.send(OPCODE.pong, 'unasked');
        peer.send(OPCODE.ping, 'are you there');
        peer.send(OPCODE.text, 'after');
      },
    });
    const received: string[] = [];
    client = await openRawWebSocket({ host: '127.0.0.1', port: server.port, path: '/', secure: false, onText: (text) => received.push(text) });
    await until(() => (server?.peers[0]?.frames.length ?? 0) === 1 && received.length === 1);
    expect(server.peers[0]?.frames.map((frame) => [frame.opcode, frame.payload.toString()])).toEqual([[OPCODE.pong, 'are you there']]);
    expect(received).toEqual(['after']);
  });

  it('answers a close and reports it once', async () => {
    server = await startTestServer({ onOpen: (peer) => setTimeout(() => peer.send(OPCODE.close, Buffer.from([0x03, 0xe8])), 20) });
    const reasons: string[] = [];
    client = await openRawWebSocket({ host: '127.0.0.1', port: server.port, path: '/', secure: false, onText: () => undefined, onClose: (reason) => reasons.push(reason) });
    await until(() => reasons.length > 0 && (server?.peers[0]?.frames.length ?? 0) > 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reasons).toEqual(['closed by the server']);
    expect(server.peers[0]?.frames.map((frame) => frame.opcode)).toEqual([OPCODE.close]);
  });

  it('closes with a 1000 close frame, only once', async () => {
    // The test server echoes a close, as RFC 6455 5.5.1 asks.
    server = await startTestServer();
    const reasons: string[] = [];
    client = await openRawWebSocket({ host: '127.0.0.1', port: server.port, path: '/', secure: false, onText: () => undefined, onClose: (reason) => reasons.push(reason) });
    client.close();
    client.close();
    await until(() => reasons.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.peers[0]?.frames.map((frame) => [frame.opcode, [...frame.payload]])).toEqual([[OPCODE.close, [0x03, 0xe8]]]);
    expect(reasons).toEqual(['closed by the server']);
  });

  it('reports the end of a socket that closes without a close frame', async () => {
    server = await startTestServer({ onOpen: (peer) => setTimeout(() => peer.socket.destroy(), 20) });
    const reasons: string[] = [];
    client = await openRawWebSocket({ host: '127.0.0.1', port: server.port, path: '/', secure: false, onText: () => undefined, onClose: (reason) => reasons.push(reason) });
    await until(() => reasons.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reasons).toEqual(['socket closed']);
  });

  it('refuses an answer other than 101, without reporting a close', async () => {
    server = await startTestServer({ upgradeStatus: () => 403 });
    const reasons: string[] = [];
    await expect(
      openRawWebSocket({ host: '127.0.0.1', port: server.port, path: '/', secure: false, onText: () => undefined, onClose: (reason) => reasons.push(reason) }),
    ).rejects.toThrow('the WebSocket upgrade was refused: HTTP/1.1 403 Refused');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reasons).toEqual([]);
  });

  it('fails when the server closes or never answers', async () => {
    const silent = net.createServer((socket) => socket.on('error', () => undefined));
    const closing = net.createServer((socket) => socket.end());
    await Promise.all([silent, closing].map((s) => new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))));
    const portOf = (s: net.Server): number => (s.address() as net.AddressInfo).port;
    try {
      await expect(openRawWebSocket({ host: '127.0.0.1', port: portOf(closing), path: '/', secure: false, onText: () => undefined })).rejects.toThrow(
        'closed the connection before the upgrade',
      );
      await expect(openRawWebSocket({ host: '127.0.0.1', port: portOf(silent), path: '/', secure: false, timeoutMs: 100, onText: () => undefined })).rejects.toThrow(
        `no WebSocket answer from 127.0.0.1:${portOf(silent)} within 100 ms`,
      );
    } finally {
      silent.close();
      closing.close();
    }
  });

  it('fails when nothing listens', async () => {
    const free = net.createServer();
    await new Promise<void>((resolve) => free.listen(0, '127.0.0.1', resolve));
    const port = (free.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => free.close(() => resolve()));
    await expect(openRawWebSocket({ host: '127.0.0.1', port, path: '/', secure: false, onText: () => undefined })).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("the codec against Node's own WebSocket", () => {
  it('a real client reads our server frames and we read its masked ones', async () => {
    const server = await startTestServer({
      onFrame: (frame, peer) => {
        if (frame.opcode === OPCODE.text) peer.send(OPCODE.text, `echo ${frame.payload.toString()}`);
      },
    });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
      const echoed = await new Promise<string>((resolve, reject) => {
        ws.addEventListener('open', () => ws.send('y'.repeat(70_000)));
        ws.addEventListener('message', (event) => resolve(String(event.data)));
        ws.addEventListener('error', () => reject(new Error('client error')));
      });
      expect(echoed).toBe(`echo ${'y'.repeat(70_000)}`);
      ws.close();
    } finally {
      await server.close();
    }
  });
});
