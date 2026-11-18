import { FILE_FRAME_BYTES, FILE_FRAME_OVERHEAD, fileCipherLength, sealFile } from '@lablo/crypto';
import { describe, expect, it } from 'vitest';
import type { ByteSource } from './bytes';
import { NetworkError } from './bytes';
import { FileError, openFileFrames } from './file-frames';

/**
 * The phone's file as the pair worker opens it (RELAY step 31d2a): real `secretbox` frames from
 * `@lablo/crypto`'s `sealFile`, cut into network chunks every which way.
 */

const FRAME = FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD;
const KEY = new Uint8Array(32).fill(9);
const BASE = new Uint8Array(24).fill(3);

/** `size` bytes of a recognisable pattern. */
function plainOf(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + (i >>> 11)) & 255;
  return out;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));

interface Download extends ByteSource {
  /** Times `cancel` was called. */
  readonly cancels: () => number;
  /** Chunks handed out so far. */
  readonly reads: () => number;
}

/** A download giving `chunks` in turn, then failing with `NetworkError` when `fail` is set. */
function download(chunks: Uint8Array[], fail = false): Download {
  let at = 0;
  let cancels = 0;
  let done = false;
  return {
    async read() {
      await Promise.resolve();
      if (done) return null;
      if (at < chunks.length) return chunks[at++]!;
      done = true;
      if (fail) throw new NetworkError('Connection lost');
      return null;
    },
    cancel() {
      cancels++;
      done = true;
    },
    cancels: () => cancels,
    reads: () => at,
  };
}

/** `bytes` cut at `cuts` (sorted, may repeat: equal cuts give empty chunks). */
function cut(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let from = 0;
  for (const c of cuts.slice().sort((a, b) => a - b)) {
    out.push(bytes.subarray(from, c));
    from = c;
  }
  out.push(bytes.subarray(from));
  return out;
}

/** Fixed-size chunks. */
function every(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, Math.min(bytes.length, i + size)));
  return out;
}

/** Every read until the end; the reads' lengths too. */
async function readAll(source: ByteSource): Promise<{ bytes: Uint8Array; lengths: number[] }> {
  const parts: Uint8Array[] = [];
  for (let chunk = await source.read(); chunk !== null; chunk = await source.read()) parts.push(chunk);
  return { bytes: new Uint8Array(Buffer.concat(parts)), lengths: parts.map((p) => p.length) };
}

/** A small deterministic generator (xorshift32): the same splits on every run. */
function random(seed: number): () => number {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

const SIZE = 2 * FILE_FRAME_BYTES + 500_000;
const PLAIN = plainOf(SIZE);
const SEALED = sealFile(PLAIN, KEY, BASE);
const SECRET = { fileKey: KEY, base: BASE, size: SIZE };

describe('openFileFrames', () => {
  it('opens every frame in its place to exactly the file, one frame per read, whatever the chunks', async () => {
    expect(SEALED.length).toBe(fileCipherLength(SIZE));
    const splits: Array<[string, Uint8Array[]]> = [
      ['one chunk', [SEALED]],
      ['4 KB chunks', every(SEALED, 4096)],
      ['frame-sized chunks', every(SEALED, FRAME)],
      ['chunks across the frames', every(SEALED, FRAME + 17)],
      ['one-byte chunks at the frame edges', cut(SEALED, [FRAME - 1, FRAME, FRAME + 1, 2 * FRAME - 1, 2 * FRAME, 2 * FRAME + 1])],
      ['empty chunks first, between and last', [new Uint8Array(0), ...cut(SEALED, [FRAME, FRAME, 10, 10]), new Uint8Array(0)]],
    ];
    for (const [name, chunks] of splits) {
      const source = download(chunks);
      const { bytes, lengths } = await readAll(openFileFrames(source, SECRET));
      expect(same(bytes, PLAIN), name).toBe(true);
      expect(lengths, name).toEqual([FILE_FRAME_BYTES, FILE_FRAME_BYTES, 500_000]);
      expect(source.cancels(), name).toBe(0);
    }
  });

  it('opens random splits with empty chunks (seeded)', async () => {
    const next = random(0x31d2a);
    for (let run = 0; run < 25; run++) {
      const cuts: number[] = [];
      const count = Math.floor(next() * 12);
      for (let i = 0; i < count; i++) cuts.push(Math.floor(next() * (SEALED.length + 1)));
      // Some cuts repeat: those give empty chunks.
      if (count > 0 && next() < 0.5) cuts.push(cuts[0]!);
      const { bytes } = await readAll(openFileFrames(download(cut(SEALED, cuts)), SECRET));
      expect(same(bytes, PLAIN), cuts.join(',')).toBe(true);
    }
  });

  it('opens files of one byte, of exactly one frame and of one frame and a byte', async () => {
    for (const size of [1, FILE_FRAME_BYTES, FILE_FRAME_BYTES + 1]) {
      const plain = plainOf(size);
      const { bytes, lengths } = await readAll(openFileFrames(download(every(sealFile(plain, KEY, BASE), 65536)), { fileKey: KEY, base: BASE, size }));
      expect(same(bytes, plain), String(size)).toBe(true);
      expect(lengths, String(size)).toEqual(size === FILE_FRAME_BYTES + 1 ? [FILE_FRAME_BYTES, 1] : [size]);
    }
  });

  /** Reads until it fails: the frames read before, and the error. */
  async function failing(chunks: Uint8Array[], secret = SECRET): Promise<{ frames: number; error: unknown; again: unknown; cancels: number }> {
    const source = download(chunks);
    const frames = openFileFrames(source, secret);
    let count = 0;
    try {
      while ((await frames.read()) !== null) count++;
    } catch (error) {
      const again = await frames.read().then(
        () => 'no error',
        (e: unknown) => e,
      );
      return { frames: count, error, again, cancels: source.cancels() };
    }
    throw new Error('the file opened');
  }

  it('refuses a download cut at a frame edge, inside a frame, or one byte short', async () => {
    const cases: Array<[string, number, number]> = [
      ['nothing at all', 0, 0],
      ['after the first frame', FRAME, 1],
      ['inside the second frame', FRAME + 1000, 1],
      ['after the second frame', 2 * FRAME, 2],
      ['one byte short', SEALED.length - 1, 2],
    ];
    for (const [name, length, frames] of cases) {
      const result = await failing(every(SEALED.subarray(0, length), 65536));
      expect(result.frames, name).toBe(frames);
      expect(result.error, name).toBeInstanceOf(FileError);
      expect((result.error as FileError).code, name).toBe('file');
      // A failure ends it: the next read fails the same way, and the download was let go.
      expect(result.again, name).toBe(result.error);
      expect(result.cancels, name).toBe(1);
    }
  });

  it('refuses two frames swapped, and a frame dropped', async () => {
    const swapped = new Uint8Array(SEALED.length);
    swapped.set(SEALED.subarray(FRAME, 2 * FRAME), 0);
    swapped.set(SEALED.subarray(0, FRAME), FRAME);
    swapped.set(SEALED.subarray(2 * FRAME), 2 * FRAME);
    const result = await failing([swapped]);
    expect([result.frames, (result.error as Error).message]).toEqual([0, "Frame 0 of the file doesn't open"]);
    // The second frame left out: the last frame then sits in the second's place.
    const dropped = new Uint8Array(Buffer.concat([SEALED.subarray(0, FRAME), SEALED.subarray(2 * FRAME)]));
    const short = await failing([dropped]);
    expect(short.frames).toBe(1);
    expect(short.error).toBeInstanceOf(FileError);
  });

  it('refuses a byte changed in a frame, in a tag, and in the last frame', async () => {
    // A frame is the 16-byte tag, then the text.
    for (const [name, at, frames] of [
      ['the first frame', 5000, 0],
      ["the second frame's tag", FRAME + 3, 1],
      ['the last frame', SEALED.length - 1, 2],
    ] as const) {
      const changed = SEALED.slice();
      changed[at] = changed[at]! ^ 1;
      const result = await failing(every(changed, 65536));
      expect(result.frames, name).toBe(frames);
      expect((result.error as Error).message, name).toBe(`Frame ${frames} of the file doesn't open`);
    }
  });

  it('refuses one byte past the last frame, once every frame has opened', async () => {
    const longer = new Uint8Array(SEALED.length + 1);
    longer.set(SEALED);
    const result = await failing([longer]);
    expect([result.frames, (result.error as Error).message]).toEqual([3, 'The file is longer than its frames']);
    // A whole extra chunk after an exact end, too.
    const after = await failing([SEALED, new Uint8Array(0), new Uint8Array([1])]);
    expect([after.frames, after.error instanceof FileError]).toEqual([3, true]);
  });

  it('refuses another file key, and a size one off either way', async () => {
    const other = await failing([SEALED], { fileKey: new Uint8Array(32).fill(8), base: BASE, size: SIZE });
    expect([other.frames, other.error instanceof FileError]).toEqual([0, true]);
    const otherBase = await failing([SEALED], { fileKey: KEY, base: new Uint8Array(24).fill(4), size: SIZE });
    expect([otherBase.frames, otherBase.error instanceof FileError]).toEqual([0, true]);
    const larger = await failing([SEALED], { fileKey: KEY, base: BASE, size: SIZE + 1 });
    expect([larger.frames, (larger.error as Error).message]).toEqual([2, 'The file ends inside a frame']);
    const smaller = await failing([SEALED], { fileKey: KEY, base: BASE, size: SIZE - 1 });
    expect([smaller.frames, (smaller.error as Error).message]).toEqual([2, "Frame 2 of the file doesn't open"]);
  });

  it("passes the connection's own failure through, and keeps failing with it", async () => {
    const source = download(every(SEALED.subarray(0, FRAME + 100), 65536), true);
    const frames = openFileFrames(source, SECRET);
    expect((await frames.read())!.length).toBe(FILE_FRAME_BYTES);
    const error = await frames.read().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(FileError);
    expect(await frames.read().catch((e: unknown) => e)).toBe(error);
    expect(source.cancels()).toBe(1);
  });

  it('lets the download go on cancel, and then reads nothing', async () => {
    const source = download(every(SEALED, 65536));
    const frames = openFileFrames(source, SECRET);
    expect((await frames.read())!.length).toBe(FILE_FRAME_BYTES);
    const read = source.reads();
    frames.cancel();
    expect(source.cancels()).toBe(1);
    expect(await frames.read()).toBeNull();
    expect(source.reads()).toBe(read);
  });

  it('reads the download no further than the frame it opens', async () => {
    const source = download(every(SEALED, 65536));
    const frames = openFileFrames(source, SECRET);
    await frames.read();
    // The first frame ends 16 bytes into the 17th chunk: the rest waits for the next read.
    expect(source.reads()).toBe(17);
    await frames.read();
    expect(source.reads()).toBe(33);
  });

  it('refuses a size that is no file', () => {
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect(() => openFileFrames(download([]), { fileKey: KEY, base: BASE, size }), String(size)).toThrow(RangeError);
    }
  });
});
