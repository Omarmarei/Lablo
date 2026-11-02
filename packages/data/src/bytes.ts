/**
 * Bytes from the network for the ingest worker (architecture.md §1.4 steps 3-4): a pull-based
 * byte source, the fetch transport behind it, UTF-8 decoding, and the FNV-1a hash that tells an
 * unchanged download from a changed one.
 *
 * - Chromium 53 has no AbortController, so a download is stopped with `reader.cancel()`.
 * - Reading is pull-based: the ingest awaits its IndexedDB writes before it reads on, so a slow
 *   TV never buffers more than one network chunk ahead (TCP backpressure does the rest).
 * - Error messages never contain the URL: provider URLs carry credentials.
 */

/** A byte stream being read. */
export interface ByteSource {
  /** The next chunk, `null` at the end. Rejects with `NetworkError` when the connection fails. */
  read(): Promise<Uint8Array | null>;
  /** Stops reading and releases the connection. Safe to call more than once. */
  cancel(): void;
}

export interface ByteResponse extends ByteSource {
  status: number;
  /** A response header (case-insensitive name), `null` when absent. */
  header(name: string): string | null;
}

export interface ByteRequest {
  headers?: Record<string, string>;
}

/** GET over HTTP as a byte stream. The ingest worker uses `fetchTransport`; tests use fakes. */
export interface ByteTransport {
  get(url: string, request?: ByteRequest): Promise<ByteResponse>;
}

/** The connection failed or broke off. The message never holds the URL. */
export class NetworkError extends Error {
  readonly code = 'network';
  constructor(message = 'Network error') {
    super(message);
    this.name = 'NetworkError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The transport over `fetch` (the global one unless `fetchFn` is given). Validator headers
 * (`If-None-Match`, `If-Modified-Since`) are passed through; an engine whose HTTP cache answers
 * them itself returns the cached body with 200 instead of 304, which the byte hash still
 * recognises as unchanged.
 */
export function fetchTransport(fetchFn?: FetchLike): ByteTransport {
  return {
    async get(url, request = {}) {
      let res: Response;
      try {
        res = await (fetchFn ? fetchFn(url, { headers: request.headers ?? {}, credentials: 'omit' }) : fetch(url, { headers: request.headers ?? {}, credentials: 'omit' }));
      } catch {
        throw new NetworkError();
      }
      return responseSource(res);
    },
  };
}

function responseSource(res: Response): ByteResponse {
  const status = res.status;
  const header = (name: string): string | null => res.headers.get(name);
  let done = false;
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    return {
      status,
      header,
      async read() {
        if (done) return null;
        let r: ReadableStreamReadResult<Uint8Array>;
        try {
          r = await reader.read();
        } catch {
          done = true;
          throw new NetworkError('Connection lost');
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
      },
    };
  }
  // No body stream (an engine without one, or no body at all): the whole body in one chunk.
  return {
    status,
    header,
    async read() {
      if (done) return null;
      done = true;
      if (!body) return null;
      let buffer: ArrayBuffer;
      try {
        buffer = await res.arrayBuffer();
      } catch {
        throw new NetworkError('Connection lost');
      }
      return buffer.byteLength > 0 ? new Uint8Array(buffer) : null;
    },
    cancel() {
      done = true;
    },
  };
}

/** Passes the chunks of `source` through, showing each one to `see` first. */
export function tapBytes(source: ByteSource, see: (chunk: Uint8Array) => void): ByteSource {
  return {
    async read() {
      const chunk = await source.read();
      if (chunk !== null) see(chunk);
      return chunk;
    },
    cancel: () => source.cancel(),
  };
}

/** A text stream being read. */
export interface TextSource {
  /** The next piece of text, `null` at the end. */
  read(): Promise<string | null>;
  cancel(): void;
}

/**
 * UTF-8 decoding in stream mode: a character split across chunks comes out whole, a leading
 * BOM is dropped and invalid bytes become U+FFFD.
 */
export function decodeUtf8(source: ByteSource): TextSource {
  const decoder = new TextDecoder('utf-8');
  let done = false;
  return {
    async read() {
      for (;;) {
        if (done) return null;
        const chunk = await source.read();
        if (chunk === null) {
          done = true;
          const tail = decoder.decode();
          return tail.length > 0 ? tail : null;
        }
        const text = decoder.decode(chunk, { stream: true });
        if (text.length > 0) return text;
      }
    },
    cancel() {
      done = true;
      source.cancel();
    },
  };
}

/**
 * FNV-1a, 32 bits, fed chunk by chunk, plus the byte count. Together they identify a download:
 * a refresh whose bytes hash and count the same as the active generation's changed nothing.
 */
export class Fnv1a {
  private h = 0x811c9dc5;
  bytes = 0;

  update(chunk: Uint8Array): void {
    let h = this.h;
    for (let i = 0; i < chunk.length; i++) h = Math.imul(h ^ chunk[i]!, 0x01000193);
    this.h = h;
    this.bytes += chunk.length;
  }

  /** Eight lower-case hex digits. */
  digest(): string {
    // Not padStart: its polyfill would be in every worker that reads bytes (the query worker too).
    const hex = (this.h >>> 0).toString(16);
    return '00000000'.slice(hex.length) + hex;
  }
}
