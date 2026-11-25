/**
 * A raw WebSocket client (RFC 6455) over a TCP or TLS socket, for the Samsung TV's remote API
 * (`wss://<tv>:8002`). The TV never answers Node's built-in `WebSocket` there; a hand-written
 * upgrade with an `Origin` header does (the Samsung session of 2026-11-24, docs/spikes/results.md
 * "The app on the Samsung TV"). The codec is pure and tested; `openRawWebSocket` is the socket.
 */
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface Frame {
  readonly opcode: number;
  readonly payload: Buffer;
}

/**
 * One frame, always final. A client's frames carry a 4-byte `mask` (RFC 6455 5.3); a server's
 * don't. Lengths up to 125 bytes fit the second byte, up to 65,535 take 16 bits, longer ones 64.
 */
export function encodeFrame(opcode: number, payload: Buffer, mask: Buffer | null): Buffer {
  const length = payload.length;
  const maskBit = mask === null ? 0 : 0x80;
  let head: Buffer;
  if (length < 126) {
    head = Buffer.from([0, maskBit | length]);
  } else if (length <= 0xffff) {
    head = Buffer.alloc(4);
    head[1] = maskBit | 126;
    head.writeUInt16BE(length, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = maskBit | 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  head[0] = 0x80 | opcode;
  if (mask === null) return Buffer.concat([head, payload]);
  return Buffer.concat([head, mask, applyMask(payload, mask)]);
}

function applyMask(data: Buffer, mask: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = (data[i] ?? 0) ^ (mask[i % 4] ?? 0);
  return out;
}

/**
 * Frames from a byte stream that arrives in any chunks. A message split over continuation frames
 * comes out whole, with its first frame's opcode; control frames (close, ping, pong) come out as
 * they arrive, even between a message's parts.
 */
export class FrameParser {
  private buffer: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private partsOpcode = 0;

  push(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: Frame[] = [];
    for (;;) {
      const frame = this.next();
      if (frame === null) return out;
      const message = this.join(frame);
      if (message !== null) out.push(message);
    }
  }

  private next(): (Frame & { readonly fin: boolean }) | null {
    const buffer = this.buffer;
    if (buffer.length < 2) return null;
    const first = buffer[0] ?? 0;
    const second = buffer[1] ?? 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return null;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    let mask: Buffer | null = null;
    if ((second & 0x80) !== 0) {
      // A partial mask key is caught by the length check below, which counts it.
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buffer.length < offset + length) return null;
    const body = buffer.subarray(offset, offset + length);
    this.buffer = buffer.subarray(offset + length);
    return { fin: (first & 0x80) !== 0, opcode: first & 0x0f, payload: mask === null ? Buffer.from(body) : applyMask(body, mask) };
  }

  private join(frame: Frame & { readonly fin: boolean }): Frame | null {
    if (frame.opcode >= OPCODE.close) return { opcode: frame.opcode, payload: frame.payload };
    // A message's first frame finds `parts` empty: the last message's final frame emptied it.
    if (frame.opcode !== OPCODE.continuation) this.partsOpcode = frame.opcode;
    this.parts.push(frame.payload);
    if (!frame.fin) return null;
    const payload = Buffer.concat(this.parts);
    this.parts = [];
    return { opcode: this.partsOpcode, payload };
  }
}

/** The client's opening handshake (RFC 6455 4.1), with the `Origin` the TV wants. */
export function upgradeRequest(host: string, port: number, path: string, key: string, origin: string): string {
  return [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    `Origin: ${origin}`,
    '',
    '',
  ].join('\r\n');
}

export interface UpgradeResponse {
  readonly status: number;
  readonly statusLine: string;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  /** Bytes after the header: the first frames, if the server sent them at once. */
  readonly rest: Buffer;
}

/** The server's answer to the handshake, or null while its header is incomplete. */
export function readUpgradeResponse(buffer: Buffer): UpgradeResponse | null {
  const end = buffer.indexOf('\r\n\r\n');
  if (end < 0) return null;
  const lines = buffer.subarray(0, end).toString('latin1').split('\r\n');
  const statusLine = lines[0] ?? '';
  const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(statusLine)?.[1] ?? 0);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status, statusLine, headers, rest: buffer.subarray(end + 4) };
}

/** `Sec-WebSocket-Accept` for a key (RFC 6455 4.2.2): what a server answers. */
export function acceptFor(key: string): string {
  return createHash('sha1').update(key + ACCEPT_GUID).digest('base64');
}

export interface RawWebSocketOptions {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  /** TLS (`wss:`), accepting the TV's own certificate; plain TCP otherwise. */
  readonly secure: boolean;
  /** Default `http://<host>:<port>`, as the session's script sent. */
  readonly origin?: string;
  /** The handshake's time limit. */
  readonly timeoutMs?: number;
  /**
   * Each text message the server sends. Given here, not set later: a server may send its first
   * message in the same packet as its 101, before the caller's `await` resumes.
   */
  readonly onText: (text: string) => void;
  /** Once, after the upgrade, when the connection ends (a close frame, the socket's end or an error). */
  readonly onClose?: (reason: string) => void;
}

/** An open connection: text messages out (they come in through `onText`). */
export interface RawWebSocket {
  send(text: string): void;
  close(): void;
}

export function openRawWebSocket(options: RawWebSocketOptions): Promise<RawWebSocket> {
  const { host, port, path, secure } = options;
  const origin = options.origin ?? `http://${host}:${port}`;
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const socket: net.Socket = secure
      ? tls.connect({ host, port, rejectUnauthorized: false }, () => socket.write(upgradeRequest(host, port, path, key, origin)))
      : net.connect({ host, port }, () => socket.write(upgradeRequest(host, port, path, key, origin)));
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no WebSocket answer from ${host}:${port} within ${options.timeoutMs ?? 10_000} ms`));
    }, options.timeoutMs ?? 10_000);
    let header: Buffer | null = Buffer.alloc(0);
    let upgraded = false;
    let closed = false;
    let ending = false;
    const parser = new FrameParser();
    const ws: RawWebSocket = {
      send: (text) => {
        socket.write(encodeFrame(OPCODE.text, Buffer.from(text), randomBytes(4)));
      },
      close: () => {
        if (closed || ending) return;
        ending = true;
        socket.write(encodeFrame(OPCODE.close, Buffer.from([0x03, 0xe8]), randomBytes(4)));
        socket.end();
      },
    };
    const end = (reason: string): void => {
      if (closed || !upgraded) return;
      closed = true;
      options.onClose?.(reason);
    };
    const frames = (chunk: Buffer): void => {
      for (const frame of parser.push(chunk)) {
        if (frame.opcode === OPCODE.text) options.onText(frame.payload.toString('utf8'));
        else if (frame.opcode === OPCODE.ping) socket.write(encodeFrame(OPCODE.pong, frame.payload, randomBytes(4)));
        else if (frame.opcode === OPCODE.close) {
          ws.close();
          end('closed by the server');
        }
      }
    };
    socket.on('data', (chunk: Buffer) => {
      if (header === null) {
        frames(chunk);
        return;
      }
      header = Buffer.concat([header, chunk]);
      const answer = readUpgradeResponse(header);
      if (answer === null) return;
      header = null;
      clearTimeout(timer);
      if (answer.status !== 101) {
        socket.destroy();
        reject(new Error(`the WebSocket upgrade was refused: ${answer.statusLine}`));
        return;
      }
      upgraded = true;
      resolve(ws);
      frames(answer.rest);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
      end(error.message);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      reject(new Error(`${host}:${port} closed the connection before the upgrade`));
      end('socket closed');
    });
  });
}
