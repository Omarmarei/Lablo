import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { searchSegments } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import { formatTable, measure } from '../src/harness';
import {
  SEARCH_QUERIES,
  SUITES,
  availableCases,
  buildSegments,
  countInStream,
  parseM3uStream,
  parsePlaylistItems,
  parseXtreamListStream,
  tokenizeXmltvStream,
} from '../src/suites';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 2));

describe('measure', () => {
  it('times each run and derives throughput from the input size and the median', async () => {
    let runs = 0;
    const r = await measure(
      {
        name: 'sleepy',
        bytes: 10e6,
        run: async () => {
          runs++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return 500;
        },
      },
      { iterations: 3, warmup: 1 },
    );
    expect(runs).toBe(4);
    expect(r.iterations).toBe(3);
    expect(r.items).toBe(500);
    expect(r.ms.median).toBeGreaterThanOrEqual(15);
    expect(r.mbPerSec).toBeCloseTo(10 / (r.ms.median / 1000), 5);
    expect(r.itemsPerSec).toBeCloseTo(500 / (r.ms.median / 1000), 5);
    expect(r.rssPeakMb).toBeGreaterThan(0);
  });

  it('sees heap growth while an async run holds memory', async () => {
    const r = await measure(
      {
        name: 'hungry',
        bytes: 0,
        run: async () => {
          const keep: { i: number; s: string }[] = [];
          for (let round = 0; round < 10; round++) {
            for (let i = 0; i < 100_000; i++) keep.push({ i, s: `item ${round}-${i}` });
            await tick();
          }
          return keep.length;
        },
      },
      { iterations: 1, warmup: 0 },
    );
    expect(r.items).toBe(1_000_000);
    expect(r.heapPeakMb).toBeGreaterThan(20);
    expect(r.mbPerSec).toBe(0);
  });

  it('propagates a failing run', async () => {
    await expect(measure({ name: 'bad', bytes: 1, run: () => Promise.reject(new Error('boom')) }, { warmup: 0 })).rejects.toThrow('boom');
  });

  it('formats an aligned table', () => {
    const table = formatTable([
      { name: 'a', iterations: 1, bytes: 2e6, items: 10, ms: { min: 1, median: 2, max: 3 }, mbPerSec: 1000, itemsPerSec: 5000, heapPeakMb: 1.25, rssPeakMb: 100 },
    ]);
    const [head, row] = table.split('\n');
    expect(head).toContain('MB/s');
    expect(row).toMatch(/^a\s+2\.0\s+10\s+2\s+1000\.0\s+5000\s+1\.3\s+100$/);
  });
});

describe('suites', () => {
  it('counts a needle across chunk boundaries, including split multi-byte characters', async () => {
    const text = Buffer.from('#EXTINF:-1,زوما\n#EXTINF:-1,b\n#EXTINF:-1,c\n');
    const at = text.indexOf(Buffer.from('و')) + 1; // inside a 2-byte character
    const pieces = [text.subarray(0, 4), text.subarray(4, at), text.subarray(at, 20), text.subarray(20)];
    expect(await countInStream(Readable.from(pieces), '#EXTINF')).toBe(3);
    expect(await countInStream(Readable.from([Buffer.from('#EXTINF#EXTINF')]), '#EXTINF')).toBe(2);
    expect(await countInStream(Readable.from([Buffer.from('#EXT'), Buffer.from('INF')]), '#EXTINF')).toBe(1);
  });

  it('parses an M3U byte stream with core, across split multi-byte characters', async () => {
    const text = Buffer.from(['#EXTM3U', '#EXTINF:-1,زوما', 'http://h.test/1.ts', '#EXTINF:-1,b', 'http://h.test/movie/2.mp4'].join('\n'));
    const at = text.indexOf(Buffer.from('و')) + 1; // inside a 2-byte character
    expect(await parseM3uStream(Readable.from([text.subarray(0, at), text.subarray(at)]))).toBe(2);
    // An orphan URL in an extended playlist is no entry.
    expect(await parseM3uStream(Readable.from([Buffer.from('#EXTM3U\nhttp://orphan.test/x.ts\n')]))).toBe(0);
  });

  it('streams Xtream lists through the list parser, across chunk and UTF-8 boundaries', async () => {
    const text = Buffer.from('[{"stream_id":1,"name":"أفلام"},{"stream_id":"x y"},{"stream_id":2,"name":"Two"}]');
    const at = text.indexOf(0xd9) + 1;
    expect(await parseXtreamListStream(Readable.from([text.subarray(0, at), text.subarray(at)]))).toBe(2);
  });

  it('streams XMLTV through the tokenizer, keeping only wanted channels', async () => {
    const xml = Buffer.from('<tv><programme start="1" channel="epg10.zoma.test"><title>نشرة</title></programme><programme start="1" channel="epg11.zoma.test"/></tv>');
    const at = xml.indexOf(0xd9) + 1;
    expect(await tokenizeXmltvStream(Readable.from([xml.subarray(0, at), xml.subarray(at)]))).toBe(2);
    expect(await tokenizeXmltvStream(Readable.from([xml]), (id) => id === 'epg10.zoma.test')).toBe(1);
  });

  it('builds search segments per kind and runs the search cases over a playlist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoma-bench-'));
    try {
      const lines = ['#EXTM3U'];
      for (let i = 0; i < 1203; i++) lines.push(`#EXTINF:-1,Zoma ${i}`, `http://h.test/${i % 3 === 0 ? 'movie/' : ''}${i}.${i % 3 === 0 ? 'mp4' : 'ts'}`);
      writeFileSync(join(dir, 'playlist.m3u'), lines.join('\n'));
      const { cases } = availableCases(dir, ['search-index-build', 'search-200k']);
      expect(await cases[0]!.run()).toBe(1203);
      expect(await cases[1]!.run()).toBe(SEARCH_QUERIES.length);
      const segs = buildSegments(await parsePlaylistItems(join(dir, 'playlist.m3u')));
      expect(segs.map((s) => [s.kind, s.count])).toEqual([['live', 802], ['movie', 401], ['series', 0]]);
      expect(segs[0]!.chunkOf(801)).toEqual({ catIdx: 0, chunk: 1, slot: 301 });
      expect(searchSegments(segs, 'zoma 1200').hits).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports missing fixtures instead of failing, and rejects unknown cases', () => {
    const { cases, missing } = availableCases('/nonexistent');
    expect(cases).toHaveLength(0);
    expect(missing).toHaveLength(Object.keys(SUITES).length);
    expect(() => availableCases('/nonexistent', ['nope'])).toThrow(/Unknown benchmark/);
  });
});
