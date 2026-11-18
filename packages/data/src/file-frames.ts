/**
 * The phone's M3U file as the TV opens it (architecture.md §3.3 A, RELAY step 31d2a). Its download
 * is the file's 1 MiB `secretbox` frames one after another (`@lablo/crypto`'s `sealFile`), and
 * `openFileFrames` gives back the plain bytes, one frame per read, never holding more than one
 * frame. The pair worker runs it: it holds tweetnacl already, and the ingest worker, which parses
 * the plain bytes, has no room for it (leg 98 measured 162.2 KB of its 150 KB with it).
 *
 * Every frame must open in its own place (frame i under the nonce base plus i, `frameNonce`), and
 * the download must be exactly `fileCipherLength(size)` long: a frame cut, changed, swapped,
 * dropped or added fails the read with `FileError`, and so does a byte past the last frame. The
 * connection's own failures pass through as they are (`NetworkError`).
 *
 * `serveFileFrames` serves the frames on a message port (`read`, `cancel`), each frame's buffer
 * transferred: the app gives the port's other end to the ingest worker (file-feed.ts), which pulls
 * one frame at a time. Messages never hold the URL or the keys.
 */
import { FILE_FRAME_BYTES, FILE_FRAME_OVERHEAD, fileFrameCount, openFileFrame } from '@lablo/crypto';
import type { ByteSource } from './bytes';
import type { RpcContext, RpcPort, RpcServer } from './rpc';
import { serveRpc } from './rpc';

/** The file doesn't open as its payload says: a frame cut, changed or out of place, or bytes past the last one. */
export class FileError extends Error {
  readonly code = 'file';
  constructor(message = "The file from the phone doesn't open") {
    super(message);
    this.name = 'FileError';
  }
}

/** What the boxed payload says about the file (`pairFileSchema`), its keys decoded. */
export interface FileSecret {
  /** The frames' `secretbox` key, 32 bytes. */
  readonly fileKey: Uint8Array;
  /** Frame 0's nonce, 24 bytes. */
  readonly base: Uint8Array;
  /** The plain file's length, at least 1. */
  readonly size: number;
}

/**
 * The plain file, one frame per read, from its encrypted download. A failure ends it: later reads
 * fail the same way.
 */
export function openFileFrames(source: ByteSource, file: FileSecret): ByteSource {
  if (!(file.size >= 1 && Math.floor(file.size) === file.size)) throw new RangeError('A file has at least one byte');
  const count = fileFrameCount(file.size);
  let index = 0;
  /** The rest of the last network chunk, in no frame yet. */
  let rest: Uint8Array | null = null;
  let ended = false;
  let failure: Error | null = null;

  /** Ends the read for good: the download is let go. */
  const fail = (error: Error): Error => {
    failure = error;
    rest = null;
    source.cancel();
    return error;
  };

  /** The next bytes that aren't empty: the rest first; `null` at the download's end. */
  const next = async (): Promise<Uint8Array | null> => {
    if (rest !== null) {
      const kept = rest;
      rest = null;
      return kept;
    }
    for (;;) {
      const chunk = await source.read();
      if (chunk === null || chunk.length > 0) return chunk;
    }
  };

  const frame = async (): Promise<Uint8Array | null> => {
    if (index === count) {
      // After the last frame the download must end.
      if ((await next()) !== null) throw fail(new FileError('The file is longer than its frames'));
      ended = true;
      return null;
    }
    const length = (index === count - 1 ? file.size - index * FILE_FRAME_BYTES : FILE_FRAME_BYTES) + FILE_FRAME_OVERHEAD;
    const cipher = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const chunk = await next();
      if (chunk === null) throw fail(new FileError('The file ends inside a frame'));
      const take = Math.min(chunk.length, length - filled);
      cipher.set(chunk.subarray(0, take), filled);
      filled += take;
      if (take < chunk.length) rest = chunk.subarray(take);
    }
    const plain = openFileFrame(cipher, file.fileKey, file.base, index);
    if (plain === null) throw fail(new FileError(`Frame ${index} of the file doesn't open`));
    index += 1;
    return plain;
  };

  return {
    async read() {
      if (failure !== null) throw failure;
      if (ended) return null;
      try {
        return await frame();
      } catch (error) {
        // The connection broke (or the frame failed): every later read says so.
        throw failure ?? fail(error instanceof Error ? error : new Error(String(error)));
      }
    },
    cancel() {
      ended = true;
      rest = null;
      source.cancel();
    },
  };
}

/** The handlers a file's frames are served with (file-feed.ts calls them). */
export type FileFrameHandlers = {
  /** The next plain frame (its buffer transferred), `null` at the end. */
  read: (arg: undefined, ctx: RpcContext) => Promise<Uint8Array | null>;
  /** The reader is done (or gave up): the download is let go. */
  cancel: () => void;
};

/** Serves `frames` on `port`; `cancel` (from the reader) runs `ended` too. */
export function serveFileFrames(port: RpcPort, frames: ByteSource, ended: () => void): RpcServer {
  const handlers: FileFrameHandlers = {
    read: async (_arg, ctx) => {
      const chunk = await frames.read();
      // tweetnacl's plaintext is a view of an array of its own: nothing else holds the buffer.
      if (chunk !== null) ctx.transfer(chunk.buffer);
      return chunk;
    },
    cancel: () => {
      frames.cancel();
      ended();
    },
  };
  return serveRpc(port, handlers);
}
