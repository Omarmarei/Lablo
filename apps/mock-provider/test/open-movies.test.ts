import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPEN_MOVIE_KEYS, loadCatalog } from '../src/config';
import { OPEN_MOVIES, OpenMovieError, attributionHtml, download, extractZipEntry, readZipEntries } from '../src/open-movies';
import { mock } from './helpers';

/** A zip with one stored and one deflated entry (local headers, central directory, EOCD). */
function makeZip(entries: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(3, 28); // a 3-byte extra field, to prove we skip it
    locals.push(local, name, Buffer.from([1, 2, 3]), body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + 3 + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lablo-open-movies-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('zip reader', () => {
  it('extracts stored and deflated entries', async () => {
    const film = Buffer.alloc(200_000, 'film');
    const zip = join(dir, 'a.zip');
    writeFileSync(zip, makeZip([{ name: 'readme.txt', data: Buffer.from('hi'), deflate: false }, { name: 'film.mkv', data: film, deflate: true }]));
    expect((await readZipEntries(zip)).map((e) => [e.name, e.method])).toEqual([['readme.txt', 0], ['film.mkv', 8]]);
    await extractZipEntry(zip, 'film.mkv', join(dir, 'film.mkv'));
    expect(readFileSync(join(dir, 'film.mkv')).equals(film)).toBe(true);
    await extractZipEntry(zip, 'readme.txt', join(dir, 'readme.txt'));
    expect(readFileSync(join(dir, 'readme.txt'), 'utf8')).toBe('hi');
    await expect(extractZipEntry(zip, 'nope', join(dir, 'x'))).rejects.toThrow(/no entry nope/);
    writeFileSync(join(dir, 'not.zip'), 'plain text');
    await expect(readZipEntries(join(dir, 'not.zip'))).rejects.toThrow(OpenMovieError);
  });
});

describe('pinned download', () => {
  it('keeps the file only when the SHA-256 matches', async () => {
    const body = Buffer.from('open movie bytes');
    const server = createServer((_req, res) => res.end(body));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/film.mov`;
    try {
      const good = createHash('sha256').update(body).digest('hex');
      await download(url, join(dir, 'ok.mov'), good);
      expect(readFileSync(join(dir, 'ok.mov')).equals(body)).toBe(true);
      await expect(download(url, join(dir, 'bad.mov'), '0'.repeat(64))).rejects.toThrow(/SHA-256/);
      expect(existsSync(join(dir, 'bad.mov'))).toBe(false);
      expect(existsSync(join(dir, 'bad.mov.part'))).toBe(false);
    } finally {
      server.close();
    }
  });

  it('pins every open movie the catalog can reference, from download.blender.org', () => {
    expect(OPEN_MOVIES.map((m) => m.key).sort()).toEqual([...OPEN_MOVIE_KEYS].sort());
    for (const m of OPEN_MOVIES) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(new URL(m.url).hostname).toBe('download.blender.org');
      expect(m.license).toMatch(/^CC BY \d\.\d$/);
    }
    // The catalog lists each film in the container the fetch produces.
    for (const movie of loadCatalog().movies.filter((m) => m.media.startsWith('open-movie:'))) {
      const film = OPEN_MOVIES.find((m) => `open-movie:${m.key}` === movie.media)!;
      expect(movie.ext, movie.name).toBe(film.ext);
      expect(movie.name).toBe(film.title);
    }
  });
});

describe('GET /attribution', () => {
  it('credits every open movie with its licence', async () => {
    const app = await mock();
    try {
      const res = await app.inject({ url: '/attribution' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      for (const m of OPEN_MOVIES) {
        expect(res.body).toContain(m.title);
        expect(res.body).toContain(m.licenseUrl);
      }
      expect(res.body).toContain('Blender Foundation');
      expect(res.body).toBe(attributionHtml());
      expect((await app.inject({ url: '/' })).body).toContain('/attribution');
    } finally {
      await app.close();
    }
  });
});
