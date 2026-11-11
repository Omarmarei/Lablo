import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fixedZone, intlZone } from './timezone';
import type { XmltvItem, XmltvOptions, XmltvProgramme, XmltvStats } from './xmltv';
import { XmltvTokenizer, decodeXmlEntities, parseXmltv, parseXmltvTime, parseXmltvTimeGeneral, xmltvTimeHasZone } from './xmltv';

function tokenize(chunks: string[], options?: XmltvOptions): { items: XmltvItem[]; stats: XmltvStats } {
  const t = new XmltvTokenizer(options);
  const items: XmltvItem[] = [];
  for (const c of chunks) items.push(...t.push(c));
  items.push(...t.end());
  return { items, stats: { ...t.stats } };
}

/** Splits `text` at the given offsets (any order; repeated offsets give empty chunks). */
function cut(text: string, cuts: number[]): string[] {
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

const programmes = (items: XmltvItem[]): XmltvProgramme[] => items.filter((i): i is XmltvProgramme => i.type === 'programme');

const GUIDE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
  '<!-- a comment with <programme> inside -->',
  '<tv generator-info-name="test">',
  '  <channel id="lablo.ar4">',
  '    <display-name lang="en">Lablo News</display-name>',
  '    <display-name lang="ar">لابلو الإخبارية</display-name>',
  '    <display-name>Lablo News</display-name>',
  '    <icon src="http://img.test/a.png?x=1&amp;y=2" />',
  '  </channel>',
  "  <channel id='A&amp;E.us'><display-name>A &amp; E</display-name></channel>",
  '  <programme start="20261102120000 +0300" stop="20261102123000 +0300" channel="lablo.ar4">',
  '    <title lang="en">Evening   News</title>',
  '    <title lang="ar-SA">نشرة المساء</title>',
  '    <sub-title lang="en">&quot;42&quot; &amp; more</sub-title>',
  '    <desc lang="en"><![CDATA[Tom & Jerry <b>live</b>]]> &#233;t&#xE9; &#x1F600; &nbsp;&unknown; &#0;</desc>',
  '    <category lang="en">News</category><category lang="ar">أخبار</category>',
  '    <episode-num system="xmltv_ns">1.4.0/1</episode-num>',
  '    <icon src="p.png"/>',
  '  </programme>',
  '  <programme start="20261102123000" channel="A&amp;E.us"><title>Bare</title><episode-num system="onscreen">S2E5</episode-num><episode-num system="xmltv_ns">0.0.</episode-num></programme>',
  '  <programme start="20261102130000 +0000" channel="lablo.ar4" />',
  '</tv>',
].join('\n');

describe('XmltvTokenizer golden', () => {
  it('reads channels and programmes with entities, CDATA and the preferred language', () => {
    const { items, stats } = parseXmltv(GUIDE, { languages: ['ar', 'en'] });
    expect(items).toEqual([
      { type: 'channel', id: 'lablo.ar4', name: 'لابلو الإخبارية', names: ['Lablo News', 'لابلو الإخبارية'], icon: 'http://img.test/a.png?x=1&y=2' },
      { type: 'channel', id: 'A&E.us', name: 'A & E', names: ['A & E'], icon: null },
      {
        type: 'programme',
        channel: 'lablo.ar4',
        start: '20261102120000 +0300',
        stop: '20261102123000 +0300',
        title: 'نشرة المساء',
        subTitle: '"42" & more',
        // &nbsp; decodes to U+00A0, which whitespace collapsing folds into the space before it.
        desc: `Tom & Jerry <b>live</b> été 😀 &unknown; ${String.fromCharCode(0xfffd)}`,
        category: 'أخبار',
        episode: 'S2 E5',
        icon: 'p.png',
      },
      { type: 'programme', channel: 'A&E.us', start: '20261102123000', stop: null, title: 'Bare', subTitle: null, desc: null, category: null, episode: 'S2E5', icon: null },
      { type: 'programme', channel: 'lablo.ar4', start: '20261102130000 +0000', stop: null, title: '', subTitle: null, desc: null, category: null, episode: null, icon: null },
    ]);
    expect(stats).toEqual({ channels: 2, programmes: 3, filtered: 0, invalid: 0, lateChannels: 0, cutTexts: 0, malformed: 0, truncated: false });
  });

  it('takes the first text when no language is preferred, and English when asked', () => {
    const first = programmes(parseXmltv(GUIDE).items)[0]!;
    expect([first.title, first.category]).toEqual(['Evening News', 'News']);
    const en = parseXmltv(GUIDE, { languages: ['EN-us'] }).items;
    expect((en[0] as { name: string }).name).toBe('Lablo News');
    expect(programmes(en)[0]!.title).toBe('Evening News');
  });

  it('skips unwanted programmes without reading them', () => {
    const asked: string[] = [];
    const { items, stats } = parseXmltv(GUIDE, {
      wantChannel: (id) => {
        asked.push(id);
        return id === 'A&E.us';
      },
    });
    expect(programmes(items).map((p) => p.title)).toEqual(['Bare']);
    expect(asked).toEqual(['lablo.ar4', 'A&E.us', 'lablo.ar4']);
    expect(stats).toMatchObject({ programmes: 1, filtered: 2, channels: 2 });
  });

  it('hands items to onItem in document order, before later wantChannel calls', () => {
    const seen: string[] = [];
    const t = new XmltvTokenizer({
      onItem: (item) => seen.push(item.type === 'channel' ? `channel ${item.id}` : `programme ${item.channel} ${item.title}`),
      wantChannel: (id) => {
        seen.push(`want ${id}`);
        return id !== 'b';
      },
    });
    const text =
      '<tv><programme start="20261102120000" channel="a"><title>1</title></programme><channel id="a"><display-name>A</display-name></channel>' +
      '<programme start="20261102120000" channel="b"><title>2</title></programme><channel id="b"/><programme start="20261102130000" channel="a"><title>3</title>';
    expect(t.push(text)).toEqual([]);
    expect(t.end()).toEqual([]);
    expect(seen).toEqual(['want a', 'programme a 1', 'channel a', 'want b', 'channel b', 'want a']);
    expect(t.stats).toMatchObject({ channels: 2, programmes: 1, filtered: 1, lateChannels: 2, truncated: true });
  });

  it('cuts long descriptions and titles', () => {
    const long = 'word '.repeat(400);
    const { items, stats } = parseXmltv(`<tv><programme start="1" channel="c"><title>${'T'.repeat(300)}</title><desc>${long}</desc></programme></tv>`, { descLimit: 300 });
    const p = programmes(items)[0]!;
    expect(p.title).toHaveLength(256);
    expect(p.desc!.length).toBeLessThanOrEqual(300);
    expect(p.desc!.startsWith('word word')).toBe(true);
    expect(stats.cutTexts).toBe(2);
  });

  it('counts invalid elements, late channels and truncation', () => {
    const text = '<tv><programme channel="c"><title>no start</title></programme><programme start="1"/><channel><display-name>x</display-name></channel><channel id="late"/><programme start="2" channel="c"><title>cut';
    const { items, stats } = parseXmltv(text);
    expect(items).toEqual([{ type: 'channel', id: 'late', name: 'late', names: [], icon: null }]);
    expect(stats).toMatchObject({ invalid: 3, lateChannels: 2, channels: 1, programmes: 0, truncated: true });
  });

  it('recovers from broken markup', () => {
    const text = [
      '<tv>',
      // An unclosed title runs into </programme>; the programme still ends there.
      '<programme start="1" channel="a"><title>Unclosed</programme>',
      // A programme never closed before the next one starts.
      '<programme start="2" channel="b"><title>Open',
      '</title><programme start="3" channel="c"><title lang="en>Bad quote</title></programme>',
      `<programme start="4" channel="d"><title>${'x'.repeat(5000)}</title></programme>`,
      '<programme start="5" channel="e"><title>After</title></programme>',
      '</tv>',
    ].join('\n');
    const { items, stats } = parseXmltv(text);
    expect(programmes(items).map((p) => [p.channel, p.title.length > 100 ? p.title.slice(0, 8) : p.title])).toEqual([
      ['a', 'Unclosed'],
      ['b', 'Open'],
      ['c', 'Bad quote'],
      ['d', 'xxxxxxxx'],
      ['e', 'After'],
    ]);
    expect(stats.malformed).toBeGreaterThanOrEqual(3);
  });

  it('decodes entities', () => {
    expect(decodeXmlEntities('a &amp;&lt;&gt;&quot;&apos; &#65;&#x42; &#xD800; &#1114112; &foo; & b')).toBe(`a &<>"' AB ${String.fromCharCode(0xfffd)} ${String.fromCharCode(0xfffd)} &foo; & b`);
    expect(decodeXmlEntities('&constructor; &toString;')).toBe('&constructor; &toString;');
  });
});

describe('parseXmltvTime', () => {
  const at = (h: number, m = 0, s = 0): number => Date.UTC(2026, 10, 2, h, m, s);

  it('reads every offset style the mock writes', () => {
    expect(parseXmltvTime('20261102120000 +0000')).toBe(at(12));
    expect(parseXmltvTime('20261102174500 +0545')).toBe(at(12));
    expect(parseXmltvTime('20261102174500 +05:45')).toBe(at(12));
    expect(parseXmltvTime('20261102070000 -0500')).toBe(at(12));
    expect(parseXmltvTime('20261102150000 +03')).toBe(at(12));
    expect(parseXmltvTime('20261102120000Z')).toBe(at(12));
    expect(parseXmltvTime('20261102120000 UTC')).toBe(at(12));
    expect(parseXmltvTime('202611021200')).toBe(at(12));
    expect(parseXmltvTime('20261102')).toBe(at(0));
  });

  it('uses the fallback zone when there is no offset', () => {
    expect(parseXmltvTime('20261102174500', 345)).toBe(at(12));
    expect(parseXmltvTime('20261102174500 EST', fixedZone(345))).toBe(at(12));
    const ny = intlZone('America/New_York')!;
    expect(parseXmltvTime('20261102070000', ny)).toBe(at(12));
    expect(parseXmltvTime('20260715080000', ny)).toBe(Date.UTC(2026, 6, 15, 12));
  });

  it('gives the same answers on its fast path as on the general one (property)', () => {
    const digit = fc.constantFrom('0', '1', '2', '3', '5', '6', '9', 'x', ' ');
    const field = (n: number): fc.Arbitrary<string> => fc.array(digit, { minLength: n, maxLength: n }).map((a) => a.join(''));
    const usual = fc
      .tuple(fc.integer({ min: 1990, max: 2099 }), fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 32 }), fc.integer({ min: 0, max: 25 }), fc.integer({ min: 0, max: 61 }), fc.integer({ min: 0, max: 61 }))
      .chain(([y, mo, d, h, mi, s]) =>
        fc.tuple(fc.constantFrom(' +', ' -', '  ', ' x', 'Z+'), field(4)).map(([sep, off]) => `${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}${String(h).padStart(2, '0')}${String(mi).padStart(2, '0')}${String(s).padStart(2, '0')}${sep}${off}`),
      );
    const zone = (ms: number): number => (ms % 7 === 0 ? 60 : 120);
    fc.assert(
      fc.property(fc.oneof(usual, field(20), fc.string({ maxLength: 24 })), (raw) => {
        expect(parseXmltvTime(raw), raw).toBe(parseXmltvTimeGeneral(raw));
        expect(parseXmltvTime(raw, 180), raw).toBe(parseXmltvTimeGeneral(raw, 180));
        expect(parseXmltvTime(raw, zone), raw).toBe(parseXmltvTimeGeneral(raw, zone));
      }),
      { numRuns: 3000 },
    );
    expect(parseXmltvTime('20261102243000 -0130')).toBe(Date.UTC(2026, 10, 3, 2, 0));
  });

  it('tells whether a time states its own offset', () => {
    for (const raw of ['20261102120000 +0300', '20261102120000 -05:00', '20261102120000 +05', '20261102120000 +3', '20261102120000Z', '20261102120000 UTC', ' 20261102120000 gmt ']) {
      expect(xmltvTimeHasZone(raw), raw).toBe(true);
    }
    for (const raw of ['20261102120000', '20261102120000 EST', '20261102120000 +123', 'tomorrow', '']) expect(xmltvTimeHasZone(raw), raw).toBe(false);
  });

  it('is null for unreadable dates', () => {
    for (const raw of ['', 'tomorrow', '2026110', '20261302120000 +0000', '20261102126000']) expect(parseXmltvTime(raw)).toBeNull();
  });
});

describe('XmltvTokenizer properties', () => {
  const cuts = fc.array(fc.nat(), { maxLength: 12 });

  it('gives the same items and stats for any chunking of a real guide', () => {
    fc.assert(
      fc.property(cuts, fc.boolean(), (at, filter) => {
        const options: XmltvOptions = { languages: ['ar'], wantChannel: filter ? (id) => id !== 'lablo.ar4' : undefined };
        expect(tokenize(cut(GUIDE, at), options)).toEqual(tokenize([GUIDE], options));
      }),
      { numRuns: 300 },
    );
    expect(tokenize(GUIDE.split(''))).toEqual(tokenize([GUIDE]));
  });

  it('round-trips generated programmes, whatever the text and chunking', () => {
    const text = fc.string({ maxLength: 30 });
    const prog = fc.record({ channel: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0), title: text, desc: text, cdata: fc.boolean() });
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    fc.assert(
      fc.property(fc.array(prog, { maxLength: 6 }), cuts, (list, at) => {
        const body = list
          .map((p) => {
            const desc = p.cdata && !p.desc.includes(']]>') ? `<![CDATA[${p.desc}]]>` : esc(p.desc);
            return `<programme start="20261102120000 +0000" channel="${esc(p.channel)}"><title>${esc(p.title)}</title><desc>${desc}</desc></programme>`;
          })
          .join('\n');
        const { items } = tokenize(cut(`<tv>${body}</tv>`, at));
        const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
        expect(items.map((i) => i.type === 'programme' && [i.channel, i.title, i.desc])).toEqual(
          list.map((p) => [p.channel.trim(), clean(p.title), clean(p.desc) || null]),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('never throws, and gives the same result for any chunking of any text', () => {
    const unit = fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c));
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 300 }), cuts, (text, at) => {
        expect(tokenize(cut(text, at))).toEqual(tokenize([text]));
      }),
      { numRuns: 300 },
    );
    const piece = fc.constantFrom('<programme start="1" channel="c">', '</programme>', '<title lang="ar">', '</title>', '<channel id="x">', '</channel>', '<display-name>', '<![CDATA[', ']]>', '<!--', '-->', '&amp;', '&#x41;', '"', "'", '<', '>', '/', 'a', ' ', '\n');
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 40 }), cuts, (pieces, at) => {
        const text = pieces.join('');
        const options = { languages: ['ar'], wantChannel: (id: string) => id !== 'x' };
        expect(tokenize(cut(text, at), options)).toEqual(tokenize([text], options));
      }),
      { numRuns: 1000 },
    );
  });
});
