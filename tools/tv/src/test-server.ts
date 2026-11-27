/**
 * A local WebSocket server for the tests (no TV): plain HTTP plus the RFC 6455 upgrade, written
 * with this package's own codec, so the raw client and Node's built-in `WebSocket` (the inspector
 * client) can each be tested against it. Only test files import it.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { Frame } from './ws';
import { acceptFor, encodeFrame, FrameParser, OPCODE } from './ws';

export interface ServerPeer {
  /** The upgrade request's headers (lower-case names) and path. */
  readonly headers: http.IncomingHttpHeaders;
  readonly path: string;
  /** Every frame the client sent (control frames included), unmasked. */
  readonly frames: Frame[];
  /** Frames from the server: unmasked, as a server sends them. */
  send(opcode: number, payload: Buffer | string): void;
  /** Raw bytes, for split or hand-made frames. */
  write(bytes: Buffer): void;
  readonly socket: Duplex;
}

export interface TestServer {
  readonly port: number;
  readonly peers: ServerPeer[];
  close(): Promise<void>;
}

export interface TestServerOptions {
  /** Answer to plain HTTP requests (the inspector's `/json`). */
  readonly http?: (path: string, port: number) => unknown;
  /** Called for each frame the client sends. */
  readonly onFrame?: (frame: Frame, peer: ServerPeer) => void;
  /** Called once the upgrade is answered, with the bytes sent along with the 101. */
  readonly onOpen?: (peer: ServerPeer) => void;
  /** A status other than 101 refuses the upgrade (for this path). */
  readonly upgradeStatus?: (path: string) => number;
  /** False: a close frame gets no answer and the socket stays open, as through ares-inspect (step 58d). */
  readonly answerClose?: boolean;
}

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const peers: ServerPeer[] = [];
  const sockets = new Set<Duplex>();
  const server = http.createServer((request, response) => {
    const body = options.http?.(request.url ?? '/', (server.address() as AddressInfo).port);
    response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
    response.end(body === undefined ? '' : JSON.stringify(body));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request: http.IncomingMessage, socket: Duplex) => {
    const path = request.url ?? '/';
    const status = options.upgradeStatus?.(path) ?? 101;
    if (status !== 101) {
      socket.end(`HTTP/1.1 ${status} Refused\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    const key = String(request.headers['sec-websocket-key'] ?? '');
    socket.write(
      ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptFor(key)}`, '', ''].join('\r\n'),
    );
    const parser = new FrameParser();
    const peer: ServerPeer = {
      headers: request.headers,
      path,
      frames: [],
      send: (opcode, payload) => socket.write(encodeFrame(opcode, Buffer.from(payload), null)),
      write: (bytes) => socket.write(bytes),
      socket,
    };
    peers.push(peer);
    socket.on('data', (chunk: Buffer) => {
      for (const frame of parser.push(chunk)) {
        peer.frames.push(frame);
        if (frame.opcode === OPCODE.close && options.answerClose !== false) socket.end(encodeFrame(OPCODE.close, frame.payload, null));
        options.onFrame?.(frame, peer);
      }
    });
    socket.on('error', () => undefined);
    options.onOpen?.(peer);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    peers,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Resolves once `check` holds (polled), for frames that arrive asynchronously. */
export async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
