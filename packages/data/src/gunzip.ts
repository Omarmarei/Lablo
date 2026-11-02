/**
 * Gzip bodies (architecture.md §1.4 step 4). A provider may serve a playlist or guide as a raw
 * `.gz` file without `Content-Encoding` (which the engine would undo itself), so the first two
 * bytes decide: `1f 8b` means gzip.
 *
 * Decompression uses the engine's `DecompressionStream` where it exists (Chromium 80+), and
 * fflate's streaming `Gunzip` (pure JS, about 8 KB) on older engines. A body that ends before
 * the gzip stream does is an error, never a shorter catalog.
 */

import { Gunzip } from 'fflate';
import type { ByteSource } from './bytes';
import { NetworkError } from './bytes';

export type GunzipMode = 'auto' | 'native' | 'fflate';

/** The bytes are not valid gzip. */
export class GzipError extends Error {
  readonly code = 'format';
  constructor(message = 'Corrupt gzip data') {
    super(message);
    this.name = 'GzipError';
  }
}

/** Does this engine have `DecompressionStream` (and the streams to pipe through it)? */
export function hasNativeGunzip(): boolean {
  return typeof DecompressionStream === 'function' && typeof ReadableStream === 'function' && typeof ReadableStream.prototype.pipeThrough === 'function';
}

/**
 * Wraps a byte source: if its bytes start with the gzip magic, reading gives the decompressed
 * bytes; otherwise the bytes pass through unchanged. `gzipped` is known after the first read.
 */
export class MaybeGunzip implements ByteSource {
  /** `null` until the first read has seen the magic bytes (or the end). */
  gzipped: boolean | null = null;
  /** Which decompressor ran (`null`: none). */
  engine: 'native' | 'fflate' | null = null;
  private inner: ByteSource | null = null;
  private starting: Promise<ByteSource> | null = null;
  private cancelled = false;

  constructor(
    private readonly source: ByteSource,
    private readonly mode: GunzipMode = 'auto',
  ) {}

  async read(): Promise<Uint8Array | null> {
    if (this.cancelled) return null;
    if (!this.inner) {
      if (!this.starting) this.starting = this.start();
      this.inner = await this.starting;
    }
    return this.inner.read();
  }

  cancel(): void {
    this.cancelled = true;
    if (this.inner) this.inner.cancel();
    else this.source.cancel();
  }

  private async start(): Promise<ByteSource> {
    const head: Uint8Array[] = [];
    let have = 0;
    let ended = false;
    while (have < 2) {
      const chunk = await this.source.read();
      if (chunk === null) {
        ended = true;
        break;
      }
      if (chunk.length === 0) continue;
      head.push(chunk);
      have += chunk.length;
    }
    const first = head[0];
    const second = first && first.length > 1 ? first[1] : head[1]?.[0];
    this.gzipped = first !== undefined && first[0] === 0x1f && second === 0x8b;
    const replay = replayHead(head, this.source, ended);
    if (!this.gzipped) return replay;
    const native = this.mode === 'native' || (this.mode === 'auto' && hasNativeGunzip());
    this.engine = native ? 'native' : 'fflate';
    return native ? nativeGunzip(replay) : fflateGunzip(replay);
  }
}

/** The chunks already read, then the rest of `source` (nothing more if it had ended). */
function replayHead(head: Uint8Array[], source: ByteSource, ended: boolean): ByteSource {
  return {
    async read() {
      const next = head.shift();
      if (next) return next;
      return ended ? null : source.read();
    },
    cancel: () => source.cancel(),
  };
}

function fflateGunzip(source: ByteSource): ByteSource {
  const out: Uint8Array[] = [];
  const gunzip = new Gunzip((data) => {
    if (data.length > 0) out.push(data);
  });
  let ended = false;
  let cancelled = false;
  return {
    async read() {
      for (;;) {
        const next = out.shift();
        if (next) return next;
        if (ended || cancelled) return null;
        const chunk = await source.read();
        try {
          if (chunk === null) {
            ended = true;
            gunzip.push(new Uint8Array(0), true);
          } else {
            gunzip.push(chunk);
          }
        } catch {
          ended = true;
          source.cancel();
          throw new GzipError();
        }
      }
    },
    cancel() {
      cancelled = true;
      out.length = 0;
      source.cancel();
    },
  };
}

function nativeGunzip(source: ByteSource): ByteSource {
  let failure: unknown = null;
  const input = new ReadableStream<Uint8Array>({
    pull: (controller) =>
      source.read().then(
        (chunk) => {
          if (chunk === null) controller.close();
          else controller.enqueue(chunk);
        },
        (error: unknown) => {
          failure = error;
          throw error;
        },
      ),
    cancel: () => source.cancel(),
  });
  const output = input.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = output.getReader();
  let done = false;
  return {
    async read() {
      if (done) return null;
      let r: ReadableStreamReadResult<Uint8Array>;
      try {
        r = await reader.read();
      } catch (error) {
        done = true;
        // A broken connection stays a network error; anything else is bad gzip data.
        if (failure instanceof NetworkError) throw failure;
        if (failure !== null) throw failure;
        throw error instanceof NetworkError ? error : new GzipError();
      }
      if (r.done) {
        done = true;
        return null;
      }
      return r.value;
    },
    cancel() {
      if (done) return;
      done = true;
      reader.cancel().catch(() => undefined);
      // The pipe would pass the cancel back in a few ticks; release the connection now.
      source.cancel();
    },
  };
}
