// RELAY step 8 at full scale: the 200k fixture playlist (`pnpm fixtures`, 45.6 MB) through the
// real ingest pipeline (byte stream in 64 KB chunks, FNV-1a, UTF-8 decode, M3U parser, chunker,
// search index, batched writes into fake-indexeddb, generation swap), plain and gzipped. Then a
// refresh that dies halfway keeps the 200k generation, and a refresh of the same bytes is
// recognised as unchanged. The times are a PC reference for spike S6 (200k ingest ≤ 90 s on a
// 2018 TV); fake-indexeddb is far slower than a real IndexedDB, so they are an upper bound for
// the pipeline itself. Runs in `pnpm test:media` (CI job `media`).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ByteRequest, ByteResponse, ByteTransport } from '@lablo/data';
import { NetworkError, QueryService, getSource, openDatabase, runIngest } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { freshFactory } from '../packages/data/src/test-support';

const fixtures = process.env['LABLO_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '.cache', 'fixtures');
const CHUNK = 64 * 1024;

/** Serves `body` in 64 KB chunks; with `failAt`, the connection breaks after that many bytes. */
function bodyTransport(body: Uint8Array, failAt?: number): ByteTransport {
  return {
    async get(_url: string, _request?: ByteRequest): Promise<ByteResponse> {
      let at = 0;
      return {
        status: 200,
        header: (name) => (name.toLowerCase() === 'content-length' ? String(body.length) : null),
        async read() {
          if (failAt !== undefined && at >= failAt) throw new NetworkError('Connection lost');
          if (at >= body.length) return null;
          const piece = body.subarray(at, Math.min(body.length, at + CHUNK));
          at += piece.length;
          return piece;
        },
        cancel() {
          at = body.length;
        },
      };
    },
  };
}

describe('ingest of the 200k fixture playlist', () => {
  it('streams it into a generation, survives a refresh that dies halfway, and skips unchanged bytes', async () => {
    const file = join(fixtures, 'playlist.m3u');
    if (!existsSync(file)) throw new Error(`${file} is missing: run pnpm fixtures (pnpm verify:media does)`);
    const plain = new Uint8Array(readFileSync(file));
    const job = { src: 'fx', source: { type: 'm3u' as const, url: 'http://fixture.test/playlist.m3u' } };
    const counts = { live: 20_000, movie: 120_000, series: 60_000 };
    const times: Record<string, number> = {};

    const factory = freshFactory();
    const db = await openDatabase(factory);
    let t = performance.now();
    const first = await runIngest(job, { db, transport: bodyTransport(plain) });
    times['plain'] = Math.round(performance.now() - t);
    expect(first).toMatchObject({ status: 'committed', gen: 1, counts, gzipped: false });
    expect(first.fetch?.bytes).toBe(plain.length);
    expect(first.m3u?.stats).toMatchObject({ entries: 200_000 });

    // Dies after half the bytes: the 200k generation stays active and searchable.
    const broken = await runIngest({ ...job, force: true }, { db, transport: bodyTransport(plain, plain.length / 2) }).catch((e: unknown) => e);
    expect(broken).toMatchObject({ code: 'network' });
    expect(await getSource(db, 'fx')).toMatchObject({ gen: 1, building: null, counts });
    const svc = new QueryService({ openDb: async () => db });
    expect((await svc.reload()).segments.map((s) => `${s.gen}:${s.count}`)).toEqual(['1:20000', '1:120000', '1:60000']);
    expect((await svc.search({ query: 'lablo' })).total).toBeGreaterThan(0);

    // The same bytes again: recognised by the hash, the active generation stays.
    t = performance.now();
    const same = await runIngest(job, { db, transport: bodyTransport(plain) });
    times['unchanged'] = Math.round(performance.now() - t);
    expect(same).toMatchObject({ status: 'unchanged', gen: 1 });
    db.close();

    // Gzipped, through fflate (what Chromium 53-79 run).
    const gz = new Uint8Array(gzipSync(plain));
    const db2 = await openDatabase(freshFactory());
    t = performance.now();
    const zipped = await runIngest(job, { db: db2, transport: bodyTransport(gz), gunzip: 'fflate' });
    times['gzip-fflate'] = Math.round(performance.now() - t);
    expect(zipped).toMatchObject({ status: 'committed', gzipped: true, counts });
    db2.close();

    console.log(`200k ingest (ms, fake-indexeddb): ${JSON.stringify(times)}; ${(plain.length / 1e6).toFixed(1)} MB plain, ${(gz.length / 1e6).toFixed(1)} MB gzipped`);
    expect(times['plain']!).toBeLessThan(90_000);
  }, 600_000);
});
