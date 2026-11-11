import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAB_BYTES_DEFAULT_CHUNK, labBytesChunks, labLine } from '../src/lab-probes';
import type { MockServer } from '../src/server';
import { listen, mock, rawGet } from './helpers';

let app: MockServer;

beforeEach(async () => {
  app = await mock();
});
afterEach(async () => {
  await app.close();
});

describe('lab probes (RELAY step 15a)', () => {
  it('numbers each line with Latin, Arabic, a 3-byte and a 4-byte character', () => {
    expect(labLine(42)).toBe('000042 Lablo لابلو ✓ 😀\n');
    expect(Buffer.byteLength(labLine(0), 'utf8')).toBe(33);
    expect(labLine(999_999).startsWith('999999 ')).toBe(true);
  });

  it('cuts the body into chunks that end inside multi-byte characters', () => {
    // 200 lines of 33 bytes: six edges, the fifth inside the emoji (100 lines' three edges all
    // fall between characters).
    const chunks = labBytesChunks(200, LAB_BYTES_DEFAULT_CHUNK);
    const body = Buffer.concat(chunks);
    expect(body.toString('utf8')).toBe(Array.from({ length: 200 }, (_, n) => labLine(n)).join(''));
    expect(chunks.slice(0, -1).every((c) => c.length === LAB_BYTES_DEFAULT_CHUNK)).toBe(true);
    // At least one edge splits a character: decoding a chunk on its own breaks it.
    expect(chunks.some((c) => c.toString('utf8').includes('�'))).toBe(true);
  });

  it('streams /__lab/bytes with its length, no caching and CORS', async () => {
    const res = await app.inject({ method: 'GET', url: '/__lab/bytes?lines=50&chunk=7' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['content-length']).toBe(String(50 * 33));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body.split('\n').slice(0, 3)).toEqual(['000000 Lablo لابلو ✓ 😀', '000001 Lablo لابلو ✓ 😀', '000002 Lablo لابلو ✓ 😀']);
    expect(res.body.split('\n')).toHaveLength(51);
  });

  it('defaults to 1,000 lines and rejects bad parameters', async () => {
    const res = await app.inject({ method: 'GET', url: '/__lab/bytes' });
    expect(res.body.split('\n')).toHaveLength(1001);
    for (const query of ['lines=-1', 'lines=1000001', 'lines=abc', 'chunk=0', 'delay=1001', 'delay=1.5']) {
      const bad = await app.inject({ method: 'GET', url: `/__lab/bytes?${query}` });
      expect(bad.statusCode, query).toBe(400);
    }
  });

  it('spaces the chunks by the delay over a real socket', async () => {
    const base = await listen(app);
    const started = Date.now();
    const res = await rawGet(`${base}/__lab/bytes?lines=10&chunk=100&delay=60`, 3000);
    expect(res.ended).toBe('end');
    expect(res.body.toString('utf8')).toBe(Array.from({ length: 10 }, (_, n) => labLine(n)).join(''));
    // 300 bytes in 3 chunks: two gaps of 60 ms.
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });

  it('answers /__lab/echo with or without CORS headers', async () => {
    const withCors = await app.inject({ method: 'GET', url: '/__lab/echo' });
    expect(withCors.json()).toEqual({ ok: true, path: '/__lab/echo', cors: true });
    expect(withCors.headers['access-control-allow-origin']).toBe('*');
    const without = await app.inject({ method: 'GET', url: '/__lab/echo?cors=0' });
    expect(without.statusCode).toBe(200);
    expect(without.json()).toEqual({ ok: true, path: '/__lab/echo', cors: false });
    expect(without.headers['access-control-allow-origin']).toBeUndefined();
    expect(without.headers['access-control-expose-headers']).toBeUndefined();
    // The next request gets its CORS headers again.
    const again = await app.inject({ method: 'GET', url: '/__lab/echo' });
    expect(again.headers['access-control-allow-origin']).toBe('*');
  });

  it('redirects only to other /__lab/ paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/__lab/redirect?to=/__lab/echo?cors=0' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/__lab/echo?cors=0');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const plain = await app.inject({ method: 'GET', url: '/__lab/redirect' });
    expect(plain.headers.location).toBe('/__lab/echo');
    const noCors = await app.inject({ method: 'GET', url: '/__lab/redirect?cors=0' });
    expect(noCors.statusCode).toBe(302);
    expect(noCors.headers['access-control-allow-origin']).toBeUndefined();
    for (const to of ['http://evil.example/', '//evil.example/', '/player_api.php', '/__lab/redirect?to=/__lab/echo', '/__lab/../x', '/__lab/a b']) {
      const bad = await app.inject({ method: 'GET', url: `/__lab/redirect?to=${encodeURIComponent(to)}` });
      expect(bad.statusCode, to).toBe(400);
    }
  });

  it('keeps the probes when the log collector is off', async () => {
    // mock() already runs with labLogDir: null.
    expect(app.mockRoutes.map((r) => `${r.method} ${r.url}`)).toEqual(
      expect.arrayContaining(['GET /__lab/bytes', 'GET /__lab/echo', 'GET /__lab/redirect']),
    );
    expect(app.mockRoutes.some((r) => r.url.startsWith('/__lab/logs'))).toBe(false);
  });
});
