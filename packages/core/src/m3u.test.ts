import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { M3uEntry, M3uParserOptions } from './m3u';
import { M3uParser } from './m3u';

const BOM = String.fromCharCode(0xfeff);

interface Parsed {
  entries: M3uEntry[];
  stats: M3uParser['stats'];
  header: M3uParser['header'];
}

function parseChunks(chunks: string[], options?: M3uParserOptions): Parsed {
  const parser = new M3uParser(options);
  const entries: M3uEntry[] = [];
  for (const chunk of chunks) entries.push(...parser.push(chunk));
  entries.push(...parser.end());
  return { entries, stats: parser.stats, header: parser.header };
}

const parse = (text: string, options?: M3uParserOptions): Parsed => parseChunks([text], options);

/** Splits `text` at the given offsets (any order; repeated offsets give empty chunks). */
function split(text: string, cuts: number[]): string[] {
  const points = cuts.map((c) => c % (text.length + 1)).sort((a, b) => a - b);
  const out: string[] = [];
  let last = 0;
  for (const p of points) {
    out.push(text.slice(last, p));
    last = p;
  }
  out.push(text.slice(last));
  return out;
}

const attrs = (o: Record<string, string>): Map<string, string> => new Map(Object.entries(o));
const entry = (e: Partial<M3uEntry> & Pick<M3uEntry, 'url' | 'line'>): M3uEntry => ({
  title: '',
  duration: -1,
  attrs: new Map(),
  group: null,
  userAgent: null,
  referrer: null,
  ...e,
});

describe('M3uParser golden', () => {
  // Built in code: .gitattributes would turn CRLF in a checked-in file into LF.
  const lines = [
    `${BOM}#EXTM3U url-tvg="http://epg.test/a.xml.gz, http://epg.test/b.xml" x-tvg-url="http://epg.test/b.xml" catchup="shift"`, // 1
    '#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://img.test/bbc1.png" group-title="UK, News" tvg-chno="101",BBC One HD, London', // 2
    'http://p.test/live/user/pass/1.ts', // 3
    '   ', // 4: blank (not empty: after line 3's \r, an empty line's \n would make a CRLF)
    "  #extinf:0 tvg-id='single' group-title=Bare radio=true , Radio, One  ", // 5
    '#EXTVLCOPT:http-user-agent=VLC/3.0', // 6
    '#EXTVLCOPT:http-referrer=http://ref.test/', // 7
    'http://p.test/radio.mp3', // 8
    '#EXTINF:-1,Entry without a URL', // 9
    '#EXTGRP:Fallback Group', // 10
    '#EXTINF:abc tvg-id="bad.duration",Bad duration', // 11
    'not a url at all', // 12
    'https://p.test/movie/user/pass/2.mkv|User-Agent=Kodi%2F21&Referer=http://r.test/', // 13
    'http://p.test/orphan.ts', // 14
    '#EXTINF:-1 tvg-name="Unbalanced quote,Broken entry', // 15
    '#KODIPROP:inputstream=inputstream.adaptive', // 16
    'http://p.test/series/user/pass/3.mp4', // 17
    '#EXTINF:tvg-id="no.duration" group-title="G",No duration', // 18
    '#EXT-X-TARGETDURATION:10', // 19
    'rtmp://p.test/app/stream', // 20
    '#EXTINF:-1 tvg-id="x" tvg-id="second" TVG-NAME="Upper",', // 21
    'http://p.test/last.m3u8', // 22, no line end
  ];
  const endings = ['\n', '\r\n', '\r'];
  const text = lines.map((l, i) => l + (i === lines.length - 1 ? '' : endings[i % 3])).join('');

  const expected: Parsed = {
    entries: [
      entry({
        title: 'BBC One HD, London',
        attrs: attrs({ 'tvg-id': 'bbc1.uk', 'tvg-name': 'BBC One', 'tvg-logo': 'http://img.test/bbc1.png', 'group-title': 'UK, News', 'tvg-chno': '101' }),
        url: 'http://p.test/live/user/pass/1.ts',
        line: 3,
      }),
      entry({
        title: 'Radio, One',
        duration: 0,
        attrs: attrs({ 'tvg-id': 'single', 'group-title': 'Bare', radio: 'true' }),
        url: 'http://p.test/radio.mp3',
        userAgent: 'VLC/3.0',
        referrer: 'http://ref.test/',
        line: 8,
      }),
      entry({
        title: 'Bad duration',
        attrs: attrs({ 'tvg-id': 'bad.duration' }),
        url: 'https://p.test/movie/user/pass/2.mkv',
        group: 'Fallback Group',
        userAgent: 'Kodi/21',
        referrer: 'http://r.test/',
        line: 13,
      }),
      entry({ title: 'Broken entry', attrs: attrs({ 'tvg-name': 'Unbalanced quote' }), url: 'http://p.test/series/user/pass/3.mp4', line: 17 }),
      entry({ title: 'No duration', attrs: attrs({ 'tvg-id': 'no.duration', 'group-title': 'G' }), url: 'rtmp://p.test/app/stream', line: 20 }),
      entry({ attrs: attrs({ 'tvg-id': 'x', 'tvg-name': 'Upper' }), url: 'http://p.test/last.m3u8', line: 22 }),
    ],
    stats: {
      lines: 22,
      entries: 6,
      extinfWithoutUrl: 1,
      orphanUrls: 1,
      junkLines: 1,
      overlongLines: 0,
      unbalancedQuotes: 1,
      badDurations: 1,
      vlcOpts: 2,
      extgrp: 1,
      otherDirectives: 1,
      hlsTags: 1,
    },
    header: {
      attrs: attrs({ 'url-tvg': 'http://epg.test/a.xml.gz, http://epg.test/b.xml', 'x-tvg-url': 'http://epg.test/b.xml', catchup: 'shift' }),
      epgUrls: ['http://epg.test/a.xml.gz', 'http://epg.test/b.xml'],
    },
  };

  it('parses every construct and counts every skip', () => {
    expect(parse(text)).toEqual(expected);
  });

  it('gives the same result one character at a time', () => {
    expect(parseChunks(text.split(''))).toEqual(expected);
  });

  it('treats a plain URL list (no #EXTM3U, no #EXTINF) as entries', () => {
    const out = parse('http://a.test/1.ts\n\nhttp://a.test/2.ts\n# a comment\nrelative/3.ts\n');
    expect(out.entries.map((e) => [e.url, e.title, e.line])).toEqual([
      ['http://a.test/1.ts', '', 1],
      ['http://a.test/2.ts', '', 3],
    ]);
    expect(out.stats).toMatchObject({ entries: 2, orphanUrls: 0, junkLines: 1, otherDirectives: 1 });
  });

  it('skips lines longer than the limit without buffering them, in any chunking', () => {
    const long = `#EXTINF:-1 tvg-name="${'x'.repeat(100)}",Long`;
    const text = `#EXTM3U\n${long}\nhttp://a.test/1.ts\n#EXTINF:-1,Short\nhttp://a.test/2.ts\n${'y'.repeat(200)}`;
    const whole = parse(text, { maxLineLength: 64 });
    expect(whole.entries.map((e) => e.title)).toEqual(['Short']);
    expect(whole.stats).toMatchObject({ overlongLines: 2, orphanUrls: 1, lines: 5 });
    expect(parseChunks(text.split(''), { maxLineLength: 64 })).toEqual(whole);
  });

  it('refuses input after end()', () => {
    const parser = new M3uParser();
    parser.end();
    expect(parser.end()).toEqual([]);
    expect(() => parser.push('x')).toThrow(/after end/);
  });
});

// ---- Fuzzing -------------------------------------------------------------------------------

/** M3U-shaped noise: real directive fragments, quotes, commas and every kind of line end. */
const TOKENS = [
  '#EXTM3U', '#EXTM3U url-tvg="http://e.test/x.xml"', '#EXTINF:', '#EXTINF:-1 ', '#extinf:0,', '#EXTGRP:', '#EXTVLCOPT:http-user-agent=UA',
  '#EXT-X-VERSION:3', '#KODIPROP:x', 'tvg-id="', 'group-title=', 'tvg-name=\'', '"', "'", ',', '=', ' ', '\t', '\n', '\r', '\r\n', '\n\n',
  'http://h.test/', 'https://h.test/movie/u/p/1.mp4', '|User-Agent=A&Referer=B', '%', BOM, 'ة', 'é', String.fromCharCode(0xd83d),
];
const noise = fc
  .array(fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...TOKENS) }, { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 6 }) }), { maxLength: 80 })
  .map((parts) => parts.join(''));
const anyUtf16 = fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)), maxLength: 300 });
const options = fc.constantFrom<M3uParserOptions | undefined>(undefined, { maxLineLength: 8 }, { maxLineLength: 40 });

describe('M3uParser fuzz', () => {
  it('gives identical entries, header and stats however the text is chunked', () => {
    fc.assert(
      fc.property(fc.oneof(noise, anyUtf16), fc.array(fc.nat(), { maxLength: 12 }), options, (text, cuts, opts) => {
        expect(parseChunks(split(text, cuts), opts)).toEqual(parse(text, opts));
      }),
      { numRuns: 3000 },
    );
  });

  it('never throws on arbitrary input, and its output is well-formed', () => {
    fc.assert(
      fc.property(fc.oneof(noise, anyUtf16, fc.string({ unit: 'binary', maxLength: 500 })), options, (text, opts) => {
        const { entries, stats } = parse(text, opts);
        expect(stats.entries).toBe(entries.length);
        let lastLine = 0;
        for (const e of entries) {
          expect(e.url).toMatch(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//);
          expect(e.url + e.title).not.toMatch(/[\r\n]/);
          expect(e.line).toBeGreaterThan(lastLine);
          expect(e.line).toBeLessThanOrEqual(stats.lines);
          expect(Number.isFinite(e.duration)).toBe(true);
          lastLine = e.line;
        }
      }),
      { numRuns: 3000 },
    );
  });

  // Text that can't break the playlist syntax: no line ends, and no quotes in attribute values.
  const safe = (max: number) => fc.string({ unit: 'grapheme', maxLength: max }).map((s) => s.replace(/[\r\n"]/g, '').trim());
  const generated = fc.record({
    title: safe(30),
    group: safe(15),
    tvgId: fc.stringMatching(/^[a-z0-9.]{0,10}$/),
    path: fc.stringMatching(/^[a-z0-9/._-]{1,20}$/),
    noiseBefore: fc.constantFrom('', '\n', '# comment\n', '#EXTVLCOPT:x=y\n', '  \n'),
  });

  it('recovers every generated entry, whatever the line ends, BOM and chunking', () => {
    fc.assert(
      fc.property(
        fc.array(generated, { maxLength: 30 }),
        fc.constantFrom('\n', '\r\n', '\r'),
        fc.boolean(),
        fc.array(fc.nat(), { maxLength: 10 }),
        (items, eol, bom, cuts) => {
          let text = `${bom ? BOM : ''}#EXTM3U${eol}`;
          for (const it of items) {
            text += it.noiseBefore.replace(/\n/g, eol);
            text += `#EXTINF:-1 tvg-id="${it.tvgId}" group-title="${it.group}",${it.title}${eol}http://h.test/${it.path}${eol}`;
          }
          const { entries, stats } = parseChunks(split(text, cuts));
          expect(entries.map((e) => [e.title, e.attrs.get('group-title'), e.attrs.get('tvg-id'), e.url])).toEqual(
            items.map((it) => [it.title, it.group, it.tvgId, `http://h.test/${it.path}`]),
          );
          expect(stats).toMatchObject({ extinfWithoutUrl: 0, orphanUrls: 0, junkLines: 0 });
        },
      ),
      { numRuns: 1000 },
    );
  });
});
