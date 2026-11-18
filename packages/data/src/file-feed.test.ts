import { FILE_FRAME_BYTES, sealFile } from '@lablo/crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ByteSource } from './bytes';
import { NetworkError } from './bytes';
import { feedResponse } from './file-feed';
import { FileError, openFileFrames, serveFileFrames } from './file-frames';
import { IngestError } from './ingest-errors';
import type { RpcPort } from './rpc';
import { CancelError } from './rpc';

/**
 * The file's frames across two workers (RELAY step 31d2a): served by the pair worker's side
 * (`serveFileFrames`) on one end of a real `MessageChannel`, read by the ingest worker's side
 * (`feedResponse`) on the other.
 */

const KEY = new Uint8Array(32).fill(9);
const BASE = new Uint8Array(24).fill(3);
const SIZE = FILE_FRAME_BYTES + 300_000;
const PLAIN = new Uint8Array(SIZE).map((_, i) => (i * 7) & 255);
const SEALED = sealFile(PLAIN, KEY, BASE);

const opened: MessagePort[] = [];
afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));

/** A download of `bytes` in 64 KB chunks; `fail` breaks it after the first frame. */
function download(bytes: Uint8Array, fail = false): ByteSource & { cancels: () => number } {
  let at = 0;
  let cancels = 0;
  let done = false;
  return {
    async read() {
      await Promise.resolve();
      if (done) return null;
      if (fail && at > FILE_FRAME_BYTES) throw new NetworkError('Connection lost');
      if (at >= bytes.length) return null;
      const end = Math.min(bytes.length, at + 65536);
      const piece = bytes.subarray(at, end);
      at = end;
      return piece;
    },
    cancel() {
      cancels++;
      done = true;
    },
    cancels: () => cancels,
  };
}

/**
 * A port as Chromium 53 has it (step 31d2b2a's old-engine walk): a message posted with an
 * `ArrayBuffer` in its transfer list arrives as `null`.
 */
function asChromium53(port: MessagePort): RpcPort {
  return {
    postMessage: (message: unknown, transfer?: Transferable[]) => port.postMessage((transfer ?? []).some((t) => t instanceof ArrayBuffer) ? null : message),
    addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => port.addEventListener(type, listener),
    removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => port.removeEventListener(type, listener),
    start: () => port.start(),
  } as unknown as RpcPort;
}

/** Frames of `bytes` served on one port (as Chromium 53 posts, `old`); the feed reads the other. */
function channel(bytes: Uint8Array, fail = false, old = false) {
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  const source = download(bytes, fail);
  const frames = openFileFrames(source, { fileKey: KEY, base: BASE, size: SIZE });
  /** What the server side handed out (their buffers go to the other side). */
  const given: Uint8Array[] = [];
  let ended = 0;
  const watched: ByteSource = {
    read: () =>
      frames.read().then((chunk) => {
        if (chunk !== null) given.push(chunk);
        return chunk;
      }),
    cancel: () => frames.cancel(),
  };
  serveFileFrames(old ? asChromium53(port1) : (port1 as unknown as RpcPort), watched, () => ended++);
  const feed = feedResponse({ port: port2 as unknown as RpcPort, size: SIZE });
  return { feed, given, ended: () => ended, cancels: () => source.cancels() };
}

describe('the file feed', () => {
  it("reads the file's plain frames from the other port, copied, not transferred (step 31d2b2a: Chromium 53)", async () => {
    const { feed, given } = channel(SEALED);
    expect(feed.status).toBe(200);
    expect(feed.header('Content-Length')).toBe(String(SIZE));
    expect(feed.header('content-length')).toBe(String(SIZE));
    expect(feed.header('etag')).toBeNull();
    const parts: Uint8Array[] = [];
    for (let chunk = await feed.read(); chunk !== null; chunk = await feed.read()) parts.push(chunk);
    expect(parts.map((p) => p.length)).toEqual([FILE_FRAME_BYTES, 300_000]);
    expect(same(new Uint8Array(Buffer.concat(parts)), PLAIN)).toBe(true);
    // Copied: the serving side's arrays are whole still (a transfer would detach them).
    expect(given.map((g) => g.byteLength)).toEqual([FILE_FRAME_BYTES, 300_000]);
    expect(await feed.read()).toBeNull();
  });

  it('reads the whole file through a port that drops a message with a transferred buffer, as Chromium 53 does', async () => {
    const { feed } = channel(SEALED, false, true);
    const parts: Uint8Array[] = [];
    for (let chunk = await feed.read(); chunk !== null; chunk = await feed.read()) parts.push(chunk);
    expect(same(new Uint8Array(Buffer.concat(parts)), PLAIN)).toBe(true);
  });

  it("fails with the ingest's `file` when a frame doesn't open on the other side", async () => {
    const changed = SEALED.slice();
    changed[FILE_FRAME_BYTES + 100] = changed[FILE_FRAME_BYTES + 100]! ^ 1;
    const { feed, cancels } = channel(changed);
    expect((await feed.read())!.length).toBe(FILE_FRAME_BYTES);
    const error = await feed.read().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IngestError);
    expect((error as IngestError).code).toBe('file');
    expect(error).not.toBeInstanceOf(FileError);
    expect(cancels()).toBe(1);
    expect(await feed.read()).toBeNull();
  });

  it('fails as a broken connection when the download breaks on the other side', async () => {
    const { feed } = channel(SEALED, true);
    await feed.read();
    const error = await feed.read().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toBe('The file broke off');
  });

  it('tells the other side on cancel, which lets the download go', async () => {
    const { feed, ended, cancels } = channel(SEALED);
    await feed.read();
    feed.cancel();
    feed.cancel();
    expect(await feed.read()).toBeNull();
    // The message takes a turn of the event loop to cross.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([ended(), cancels()]).toEqual([1, 1]);
  });

  it('rejects a read waiting when the feed is cancelled with `CancelError`', async () => {
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    // Nobody answers on port1.
    port1.start();
    const feed = feedResponse({ port: port2 as unknown as RpcPort, size: SIZE });
    const read = feed.read().catch((e: unknown) => e);
    feed.cancel();
    expect(await read).toBeInstanceOf(CancelError);
  });

  it('fails as a broken connection when the other side answers with another error', async () => {
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    serveFileFrames(
      port1 as unknown as RpcPort,
      {
        read: () => Promise.reject(Object.assign(new Error('odd'), { code: 'odd' })),
        cancel: () => undefined,
      },
      () => undefined,
    );
    const feed = feedResponse({ port: port2 as unknown as RpcPort, size: SIZE });
    expect(await feed.read().catch((e: unknown) => e)).toBeInstanceOf(NetworkError);
  });
});
