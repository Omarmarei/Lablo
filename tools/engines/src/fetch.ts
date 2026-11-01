import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Engine } from './engines';
import { snapshotUrl } from './engines';

export function cachedZipPath(cacheDir: string, engine: Engine): string {
  return path.join(cacheDir, `chrome-linux-${engine.position}.zip`);
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Returns the cached snapshot zip for `engine`, downloading it first when it is missing or
 * does not match the pinned size and SHA-256. A mismatching download is deleted and rejected.
 */
export async function ensureEngineZip(engine: Engine, cacheDir: string, log: (line: string) => void): Promise<string> {
  const file = cachedZipPath(cacheDir, engine);
  if (existsSync(file) && statSync(file).size === engine.bytes && (await sha256File(file)) === engine.sha256) {
    return file;
  }

  mkdirSync(cacheDir, { recursive: true });
  const url = snapshotUrl(engine);
  log(`downloading ${engine.id} (${(engine.bytes / 1e6).toFixed(0)} MB) from ${url}`);
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`${url}: HTTP ${response.status}`);

  const partial = `${file}.part`;
  const hash = createHash('sha256');
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), hasher, createWriteStream(partial));
    const digest = hash.digest('hex');
    const size = statSync(partial).size;
    if (size !== engine.bytes || digest !== engine.sha256) {
      throw new Error(
        `${engine.id}: downloaded ${size} bytes with SHA-256 ${digest}, expected ${engine.bytes} bytes with ${engine.sha256}`,
      );
    }
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
  return file;
}
