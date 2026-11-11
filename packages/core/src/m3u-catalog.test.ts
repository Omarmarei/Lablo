import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseContentKey } from './content-key';
import { M3uCatalogParser, classifyStreamUrl, parseM3uCatalog } from './m3u-catalog';
import type { CatalogItem } from './model';
import { MAX_TEXT } from './model';
import { normalizeName } from './normalize';

describe('classifyStreamUrl', () => {
  it.each([
    ['http://p.test:8080/movie/u/p/123.mp4', 'movie'],
    ['http://p.test/MOVIES/123', 'movie'],
    ['http://p.test/vod/abc.ts', 'movie'],
    ['http://p.test/series/u/p/9.mkv', 'series'],
    ['http://p.test/live/u/p/1.ts', 'live'],
    ['http://p.test/live/u/p/1.mp4', 'live'],
    ['http://p.test/u/p/1', 'live'],
    ['http://p.test/films/Some.Film.2020.mkv', 'movie'],
    ['http://p.test/clip.MP4?token=1', 'movie'],
    ['http://p.test/hls/index.m3u8', 'live'],
    ['http://p.test/stream.ts', 'live'],
    ['http://p.test/live.m3u8?next=/movie/x.mp4', 'live'],
    ['http://movie.test/series.mp4.example/x', 'live'],
    ['http://p.test/dir.mp4/stream', 'live'],
    ['rtmp://p.test/app/stream', 'live'],
    ['udp://@239.0.0.1:1234', 'live'],
  ])('%s → %s', (url, kind) => {
    expect(classifyStreamUrl(url)).toBe(kind);
  });
});

describe('M3uCatalogParser golden', () => {
  const longName = `Very ${'long '.repeat(80)}name`;
  const text = [
    '#EXTM3U url-tvg="http://epg.test/guide.xml.gz"',
    '#EXTINF:-1 tvg-id="mbc1.ae" tvg-name="MBC 1" tvg-logo="http://img.test/mbc1.png" group-title="AR | عام" tvg-chno="7" tvg-shift="+2" catchup="xc" catchup-days="5",AR: MBC 1 HD',
    'http://p.test/live/u/p/1.ts',
    '#EXTINF:-1 tvg-id="mbc1.ae" group-title="AR | عام",AR: MBC 1 SD',
    'http://p.test/live/u/p/2.ts',
    '#EXTINF:-1 tvg-id="MBC1.ae" group-title="AR | Backup",AR: MBC 1 HD',
    'http://p.test/live/u/p/3.ts',
    '#EXTGRP:أخبار',
    '#EXTINF:-1,قناةُ الأخبار ١',
    'http://p.test/live/u/p/4.ts',
    '#EXTGRP:اخبار',
    '#EXTINF:-1,قناه الاخبار 1',
    'http://p.test/live/u/p/5.ts',
    '#EXTINF:-1 tvg-logo="" group-title="AR | أفلام",فيلم الصيف (2020)',
    'http://p.test/movie/u/p/6.mkv',
    '#EXTINF:-1 group-title="Films",Night City',
    'http://cdn.test/vod/night-city.mp4',
    '#EXTINF:-1 group-title="EN | Drama",Night City S01E02',
    'http://p.test/series/u/p/8.mp4',
    '#EXTINF:-1 radio="true" group-title="Radio",Lablo FM',
    'http://p.test/radio/lablo.mp3',
    '#EXTINF:-1 tvg-name="Name From Attribute" group-title="X",',
    'http://p.test/live/u/p/10.ts',
    '#EXTINF:-1 catchup="false" catchup-days="3",No Archive',
    'http://p.test/live/u/p/11.ts',
    '#EXTINF:-1 catchup-days="3" catchup-source="?utc={utc}",Days Only',
    'http://p.test/live/u/p/12.ts',
    '#EXTINF:-1 timeshift="2" tvg-chno="abc" tvg-shift="99",Timeshift Days',
    'http://p.test/live/u/p/13.ts',
    '#EXTINF:-1 user-agent="AttrUA/1" http-referrer="http://ref.test/",With Hints',
    'http://p.test/live/u/p/14.ts',
    `#EXTINF:-1,${longName}`,
    'http://p.test/live/u/p/15.ts',
  ].join('\n');

  const { items, summary } = parseM3uCatalog('src1', text);
  const byUrl = (n: number): CatalogItem => items.find((i) => i.url.endsWith(`/${n}.ts`) || i.url.endsWith(`/${n}.mkv`) || i.url.endsWith(`/${n}.mp4`))!;

  it('matches the reviewed golden file', async () => {
    await expect(`${JSON.stringify({ items, summary }, null, 2)}\n`).toMatchFileSnapshot('../test/golden/m3u-catalog.json');
  });

  it('keys: tvg-id plus name, shared tvg-ids kept apart, duplicates numbered, never the URL', () => {
    const [hd, sd, backup] = [byUrl(1), byUrl(2), byUrl(3)];
    expect(hd.key).not.toBe(sd.key);
    // Same tvg-id (any case) and name, another group: the same channel, numbered.
    expect(backup.key).toBe(hd.key.replace(/:0$/, ':1'));
    // Without a tvg-id, spelling variants of name and group normalize to one key.
    expect(byUrl(5).key).toBe(byUrl(4).key.replace(/:0$/, ':1'));
    for (const item of items) {
      expect(parseContentKey(item.key)).toMatchObject({ type: 'm3u', src: 'src1' });
      expect(item.key).not.toMatch(/p\.test|\/u\/p\//);
    }
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it('classifies, names and normalizes', () => {
    expect(items.map((i) => i.kind)).toEqual(['live', 'live', 'live', 'live', 'live', 'movie', 'movie', 'series', 'live', 'live', 'live', 'live', 'live', 'live', 'live']);
    expect(byUrl(1)).toMatchObject({ name: 'AR: MBC 1 HD', normName: 'ar mbc 1 hd', matchName: 'mbc1', tvgName: 'MBC 1', chno: 7, tvgShift: 2, epgId: 'mbc1.ae' });
    expect(byUrl(4)).toMatchObject({ group: 'أخبار', normName: 'قناه الاخبار 1' });
    expect(byUrl(6)).toMatchObject({ kind: 'movie', logo: null, matchName: null });
    expect(byUrl(10)).toMatchObject({ name: 'Name From Attribute', tvgName: null });
    expect(byUrl(15).name).toHaveLength(MAX_TEXT);
    const radio = items.find((i) => i.radio)!;
    expect(radio).toMatchObject({ kind: 'live', name: 'Lablo FM' });
  });

  it('records catch-up facts and stream hints as written', () => {
    expect(byUrl(1).catchup).toEqual({ mode: 'xc', days: 5, source: null });
    expect(byUrl(11).catchup).toBeNull();
    expect(byUrl(12).catchup).toEqual({ mode: null, days: 3, source: '?utc={utc}' });
    expect(byUrl(13)).toMatchObject({ catchup: { mode: null, days: 2, source: null }, chno: null, tvgShift: 0 });
    expect(byUrl(14).hints).toEqual({ userAgent: 'AttrUA/1', referrer: 'http://ref.test/' });
    expect(byUrl(1).hints).toBeNull();
  });

  it('summarizes the source', () => {
    expect(summary).toMatchObject({
      epgUrls: ['http://epg.test/guide.xml.gz'],
      counts: { live: 12, movie: 2, series: 1 },
      userAgents: ['AttrUA/1'],
      looksLikeHls: false,
    });
    expect(summary.stats.entries).toBe(15);
  });
});

describe('M3uCatalogParser', () => {
  it('flags an HLS stream playlist given as a source', () => {
    const { summary } = parseM3uCatalog('s', '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n');
    expect(summary.looksLikeHls).toBe(true);
    expect(summary.stats.entries).toBe(0);
  });

  it('rejects a bad source id up front', () => {
    expect(() => new M3uCatalogParser('bad:id')).toThrow(RangeError);
  });

  const line = fc.oneof(
    fc.constantFrom('#EXTM3U', '#EXTINF:-1 tvg-id="a",A', '#EXTINF:-1 tvg-id="A",A', '#EXTINF:-1,أ', '#EXTINF:-1,ا', '#EXTINF:-1 group-title="g",x', '#EXTGRP:g'),
    fc.constantFrom('http://h.test/live/1.ts', 'http://h.test/movie/2.mp4', 'http://h.test/series/3.mkv', 'http://h.test/4'),
    fc.string({ unit: 'binary', maxLength: 12 }),
  );
  const playlist = fc.array(line, { maxLength: 60 }).map((lines) => lines.join('\n'));

  it('gives the same items and keys however the text is chunked; keys are unique and well-formed', () => {
    fc.assert(
      fc.property(playlist, fc.array(fc.nat(), { maxLength: 8 }), (text, cuts) => {
        const whole = parseM3uCatalog('s1', text);
        const points = cuts.map((c) => c % (text.length + 1)).sort((a, b) => a - b);
        const parser = new M3uCatalogParser('s1');
        const items: CatalogItem[] = [];
        let last = 0;
        for (const p of [...points, text.length]) {
          items.push(...parser.push(text.slice(last, p)));
          last = p;
        }
        items.push(...parser.end());
        expect(items).toEqual(whole.items);
        expect(parser.summary()).toEqual(whole.summary);
        expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
        for (const item of items) {
          expect(parseContentKey(item.key)).not.toBeNull();
          expect(item.normName).toBe(normalizeName(item.name));
          expect(item.name.length).toBeLessThanOrEqual(MAX_TEXT);
          expect(item.matchName === null).toBe(item.kind !== 'live');
        }
      }),
      { numRuns: 1500 },
    );
  });
});
