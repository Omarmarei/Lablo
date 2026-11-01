// Streamed, hashed file output: text is batched into ~1 MiB writes (backpressure respected),
// optionally gzipped alongside (zlib runs on the libuv pool, off the main thread). The SHA-256
// covers the uncompressed bytes, which is what determinism is checked on.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const BATCH = 1 << 20;

export interface WrittenFile {
  path: string;
  bytes: number;
  sha256: string;
  gzPath?: string;
  gzBytes?: number;
}

function write(stream: Writable, chunk: Buffer): Promise<void> | undefined {
  if (stream.write(chunk)) return undefined;
  return new Promise((resolve) => stream.once('drain', resolve));
}

export class FixtureWriter {
  private readonly out: Writable;
  private readonly gz: Writable | undefined;
  private readonly gzOut: Writable | undefined;
  private readonly hash = createHash('sha256');
  private parts: string[] = [];
  private pending = 0;
  private bytes = 0;

  constructor(
    readonly path: string,
    gzip = false,
  ) {
    this.out = createWriteStream(path);
    if (gzip) {
      this.gzOut = createWriteStream(`${path}.gz`);
      this.gz = createGzip({ level: 6 });
      this.gz.pipe(this.gzOut);
    }
  }

  /** Appends text; awaits only when a batch is flushed into a full stream. */
  async text(s: string): Promise<void> {
    this.parts.push(s);
    this.pending += s.length;
    if (this.pending >= BATCH) await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.parts.length === 0) return;
    const chunk = Buffer.from(this.parts.join(''), 'utf8');
    this.parts = [];
    this.pending = 0;
    this.bytes += chunk.length;
    this.hash.update(chunk);
    await Promise.all([write(this.out, chunk), this.gz ? write(this.gz, chunk) : undefined]);
  }

  async close(): Promise<WrittenFile> {
    await this.flush();
    this.out.end();
    this.gz?.end();
    await Promise.all([finished(this.out), this.gzOut ? finished(this.gzOut) : undefined]);
    const file: WrittenFile = { path: this.path, bytes: this.bytes, sha256: this.hash.digest('hex') };
    if (this.gzOut) {
      file.gzPath = `${this.path}.gz`;
      file.gzBytes = (this.gzOut as unknown as { bytesWritten: number }).bytesWritten;
    }
    return file;
  }
}
