/**
 * Poster images for the movies screen's checks (RELAY step 26b): real PNG files, made here so
 * nothing is downloaded or committed. The old-engine fixture stages a few small ones (fixture.ts
 * `stagePosters`), and the poster grid's throttled e2e run answers its poster requests with a
 * provider-sized one (e2e/movies-throttled.spec.ts).
 *
 * Each is 8-bit RGB, a vertical gradient between two colours with a lighter band across its
 * middle third, so a poster that is drawn shows in a screenshot.
 */
import { deflateSync } from 'node:zlib';

export type Rgb = readonly [number, number, number];

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_v, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** PNG's CRC-32 (ISO 3309) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const mix = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

/** A `width` x `height` PNG: a gradient from `top` to `bottom`, lighter across its middle third. */
export function posterPng(width: number, height: number, top: Rgb, bottom: Rgb): Buffer {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error(`posterPng: ${width}x${height} is not a size`);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // 8 bits a sample, colour type 2 (RGB), deflate, no filters, no interlace.
  header.set([8, 2, 0, 0, 0], 8);
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const t = height === 1 ? 0 : y / (height - 1);
    const band = y >= height / 3 && y < (2 * height) / 3 ? 48 : 0;
    const rgb = [0, 1, 2].map((i) => Math.min(255, mix(top[i]!, bottom[i]!, t) + band));
    // Each scanline starts with its filter type: 0, none.
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) raw.set(rgb, y * stride + 1 + x * 3);
  }
  return Buffer.concat([SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** A PNG's size from its IHDR (null: not a PNG). */
export function pngSize(png: Uint8Array): { readonly width: number; readonly height: number } | null {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
