// The Blender Foundation open movies (Creative Commons Attribution), fetched on request only:
// `pnpm mock:open-movies` (opt-in, about 1.2 GB; never in CI). Each download is pinned by URL
// and SHA-256, then unpacked or remuxed (stream copy) into the container the catalog lists.
// The credits below are served at GET /attribution.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createInflateRaw } from 'node:zlib';
import type { OpenMovieKey } from './config';
import type { OpenMoviesManifest } from './file-media';
import { MANIFEST_FILE, OPEN_MOVIES_DIR } from './file-media';
import { run } from './media-gen';

export interface OpenMovie {
  key: OpenMovieKey;
  title: string;
  year: number;
  /** The credit line the licence asks for. */
  credit: string;
  license: string;
  licenseUrl: string;
  homepage: string;
  url: string;
  sha256: string;
  bytes: number;
  /** The container we serve (the catalog's `ext`). */
  ext: 'mp4' | 'mkv';
  /** The file inside a zip download; otherwise the download is remuxed into `ext`. */
  zipEntry?: string;
}

export const OPEN_MOVIES: readonly OpenMovie[] = [
  {
    key: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    year: 2008,
    credit: '(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    homepage: 'https://peach.blender.org/',
    url: 'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4.zip',
    sha256: '109e3ede8790bd633f374ca311d9cc61dce8d7f98f5b0797ca98199c9fbceedf',
    bytes: 64_657_225,
    ext: 'mp4',
    zipEntry: 'BigBuckBunny_320x180.mp4',
  },
  {
    key: 'sintel',
    title: 'Sintel',
    year: 2010,
    credit: '(c) copyright Blender Foundation | durian.blender.org',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    homepage: 'https://durian.blender.org/',
    url: 'https://download.blender.org/durian/movies/Sintel.2010.720p.mkv.zip',
    sha256: 'd252f898641b20f51c64206f31063e659c28b152a9d988936736d1b56e6e4db3',
    bytes: 681_285_470,
    ext: 'mkv',
    zipEntry: 'Sintel.2010.720p.mkv',
  },
  {
    key: 'tears-of-steel',
    title: 'Tears of Steel',
    year: 2012,
    credit: '(CC) Blender Foundation | mango.blender.org',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    homepage: 'https://mango.blender.org/',
    url: 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov',
    sha256: 'efa9062d9cdb7a338e40ad530dfdf234806743f29ae6a1a136b97ece4e588e8f',
    bytes: 372_178_639,
    ext: 'mp4',
  },
  {
    key: 'elephants-dream',
    title: 'Elephants Dream',
    year: 2006,
    credit: '(c) copyright 2006, Blender Foundation / Netherlands Media Art Institute / www.elephantsdream.org',
    license: 'CC BY 2.5',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
    homepage: 'https://orange.blender.org/',
    url: 'https://download.blender.org/ED/elephantsdream-480-h264-st-aac.mov',
    sha256: 'a7dbacae5fa2bc345dbd7b10588575f3e2bba36012e9a93df5346467053b0634',
    bytes: 103_636_531,
    ext: 'mp4',
  },
];

export class OpenMovieError extends Error {
  override name = 'OpenMovieError';
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Downloads `url` to `dest`, verifying the SHA-256 on the fly; nothing is left behind on a mismatch. */
export async function download(url: string, dest: string, sha256: string, onProgress?: (bytes: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new OpenMovieError(`${url}: HTTP ${res.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      onProgress?.(bytes);
      callback(null, chunk);
    },
  });
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), meter, createWriteStream(part));
    const actual = hash.digest('hex');
    if (actual !== sha256) throw new OpenMovieError(`${url}: SHA-256 ${actual}, expected ${sha256}`);
    await rename(part, dest);
  } finally {
    await rm(part, { force: true });
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  dataOffset: number;
}

/** The entries of a zip file (stored or deflated, no zip64): enough for the Blender downloads. */
export async function readZipEntries(path: string): Promise<ZipEntry[]> {
  const handle = await open(path, 'r');
  try {
    const size = (await handle.stat()).size;
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, size - tailSize);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new OpenMovieError(`${path}: not a zip file`);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new OpenMovieError(`${path}: bad central directory`);
      const method = cd.readUInt16LE(p + 10);
      const compressedSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new OpenMovieError(`${path}: bad local header for ${name}`);
      const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      entries.push({ name, method, compressedSize, dataOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

export async function extractZipEntry(zip: string, name: string, dest: string): Promise<void> {
  const entry = (await readZipEntries(zip)).find((e) => e.name === name);
  if (!entry) throw new OpenMovieError(`${zip}: no entry ${name}`);
  if (entry.method !== 0 && entry.method !== 8) throw new OpenMovieError(`${zip}: unsupported compression method ${entry.method}`);
  const raw = createReadStream(zip, { start: entry.dataOffset, end: entry.dataOffset + entry.compressedSize - 1 });
  const part = `${dest}.part`;
  try {
    if (entry.method === 8) await pipeline(raw, createInflateRaw(), createWriteStream(part));
    else await pipeline(raw, createWriteStream(part));
    await rename(part, dest);
  } finally {
    await rm(part, { force: true });
  }
}

export interface FetchOptions {
  /** The media folder; films go to <mediaDir>/open-movies. */
  mediaDir: string;
  ffmpeg: string;
  only?: OpenMovieKey[];
  keepDownloads?: boolean;
  log?: (line: string) => void;
}

/** Fetches, verifies and unpacks the open movies, then writes open-movies/manifest.json. */
export async function fetchOpenMovies(options: FetchOptions): Promise<OpenMoviesManifest> {
  const log = options.log ?? (() => {});
  const root = join(options.mediaDir, OPEN_MOVIES_DIR);
  const downloads = join(root, 'downloads');
  await mkdir(downloads, { recursive: true });
  const manifestPath = join(root, MANIFEST_FILE);
  const manifest: OpenMoviesManifest = {};
  for (const movie of OPEN_MOVIES) {
    if (options.only && !options.only.includes(movie.key)) continue;
    const file = `${movie.key}.${movie.ext}`;
    const target = join(root, file);
    if (!existsSync(target)) {
      const dl = join(downloads, basename(new URL(movie.url).pathname));
      if (existsSync(dl) && (await sha256File(dl)) === movie.sha256) {
        log(`${movie.title}: using the verified download ${dl}`);
      } else {
        log(`${movie.title}: downloading ${(movie.bytes / 1e6).toFixed(0)} MB from ${movie.url}`);
        let lastLog = 0;
        await download(movie.url, dl, movie.sha256, (bytes) => {
          if (bytes - lastLog >= 50e6) {
            lastLog = bytes;
            log(`  ${(bytes / 1e6).toFixed(0)} / ${(movie.bytes / 1e6).toFixed(0)} MB`);
          }
        });
      }
      if (movie.zipEntry) {
        await extractZipEntry(dl, movie.zipEntry, target);
      } else {
        // .mov -> .mp4 is a container change only (stream copy), with the index up front.
        const tmp = `${target}.part.${movie.ext}`;
        await run(options.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', dl, '-map', '0:v', '-map', '0:a', '-c', 'copy', '-movflags', '+faststart', tmp], root);
        await rename(tmp, target);
      }
      if (!options.keepDownloads) await rm(dl, { force: true });
      log(`${movie.title}: ready (${file})`);
    }
    manifest[movie.key] = { path: file, ext: movie.ext, sha256: movie.sha256, bytes: (await stat(target)).size };
  }
  // Keep entries for films fetched earlier with --only.
  const previous: OpenMoviesManifest = existsSync(manifestPath)
    ? (JSON.parse(await readFile(manifestPath, 'utf8')) as OpenMoviesManifest)
    : {};
  const merged = { ...previous, ...manifest };
  await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

/** GET /attribution: credits for the open movies and a note on the generated test media. */
export function attributionHtml(): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  const rows = OPEN_MOVIES.map(
    (m) =>
      `<li><strong>${esc(m.title)}</strong> (${m.year}). ${esc(m.credit)}. Licensed under <a href="${esc(m.licenseUrl)}">${esc(m.license)}</a>. <a href="${esc(m.homepage)}">${esc(m.homepage)}</a>. Unmodified; served in its original encoding (container changed to ${m.ext.toUpperCase()} where needed).</li>`,
  ).join('\n      ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Attribution - Lablo mock provider</title>
  </head>
  <body>
    <h1>Attribution</h1>
    <p>This is a test-signal server for Lablo IPTV development. It carries no real channels.</p>
    <h2>Open movies</h2>
    <ul>
      ${rows}
    </ul>
    <h2>Test channels and test files</h2>
    <p>Generated by Lablo with FFmpeg (testsrc2 and SMPTE colour bar patterns, sine tones and our own subtitles). No third-party content.</p>
  </body>
</html>
`;
}
