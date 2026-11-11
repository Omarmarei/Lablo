// Build fixture: core's parsers and search (RELAY steps 5-7) through the TV pipeline. The app doesn't use
// them until the data worker does (step 8), so they are tree-shaken out of the TV bundle; this
// fixture proves they transpile to Chromium 53 code, pass the syntax gate and run without the
// ES2017 APIs that engine lacks. bundle.test.ts compares the bundled result with a native run.
import {
  JsonArraySplitter,
  M3uCatalogParser,
  XmltvTokenizer,
  SearchIndexBuilder,
  SearchSegment,
  XtreamListParser,
  decodeBase64Utf8,
  favouriteMarks,
  fixedZone,
  m3uCatchupUrl,
  normalizeName,
  panelZone,
  parseXmltvTime,
  searchSegments,
  xtreamCatchupUrl,
  xtreamFromM3uUrl,
} from '@lablo/core';

const account = { base: 'http://p.test:8080', username: 'u', password: 'p@ss' };

export function run(): string {
  const out: string[] = [];

  const json = `${String.fromCharCode(0xfeff)}[{"a":"x,]}"},[1,2],"s\\"t"]`;
  const splitter = new JsonArraySplitter();
  const elements = [...splitter.push(json.slice(0, 9)), ...splitter.push(json.slice(9)), ...splitter.end()];
  out.push(elements.join(';'));

  const list = '[{"stream_id":"7","name":"Lablo ١ HD","tv_archive":"1","tv_archive_duration":3,"category_id":3},{"stream_id":null}]';
  const xtream = new XtreamListParser('live', { src: 'tv', account, categories: new Map([['3', 'News']]) });
  const items = [...xtream.push(list.slice(0, 40)), ...xtream.push(list.slice(40)), ...xtream.end()];
  out.push(items.map((i) => `${i.item.key} ${i.item.group} ${i.item.normName} ${i.item.matchName} ${JSON.stringify(i.item.catchup)}`).join(';'));
  out.push(JSON.stringify(xtream.stats()));

  const m3u = new M3uCatalogParser('tv');
  const playlist = '#EXTM3U\n#EXTINF:-1 tvg-id="a.ar" group-title="أخبار" catchup="flussonic",قناة أ\nhttp://f.test/ch/index.m3u8\n';
  const entries = [...m3u.push(playlist.slice(0, 30)), ...m3u.push(playlist.slice(30)), ...m3u.end()];
  const window = { startMs: Date.UTC(2026, 10, 2, 10, 30), endMs: Date.UTC(2026, 10, 2, 11, 15), nowMs: Date.UTC(2026, 10, 2, 12) };
  out.push(entries.map((e) => `${e.key} ${e.normName} ${m3uCatchupUrl(e.url, e.catchup, window)}`).join(';'));

  const tokenizer = new XmltvTokenizer({ languages: ['en'] });
  const xml = '<tv><programme start="20261102174500 +0545" channel="c"><title lang="ar">نشرة</title><title lang="en">News &amp; more</title><desc><![CDATA[a <b>b</b>]]></desc></programme></tv>';
  const programmes = [...tokenizer.push(xml.slice(0, 50)), ...tokenizer.push(xml.slice(50)), ...tokenizer.end()];
  out.push(programmes.map((p) => (p.type === 'programme' ? `${p.title} ${p.desc} ${parseXmltvTime(p.start)}` : p.id)).join(';'));

  out.push(xtreamCatchupUrl(account, 101, window, fixedZone(345)));
  const zone = panelZone({ timezone: null, timeNow: '2026-11-02 17:45:00', timestampNow: Date.UTC(2026, 10, 2, 12) / 1000 });
  out.push(`${zone.source} ${zone.offset(0)}`);
  out.push(JSON.stringify(xtreamFromM3uUrl('http://p.test/get.php?username=special%2Buser&password=a+b&type=m3u_plus')));
  out.push(String(decodeBase64Utf8('2YbYtNix2Kk=')));

  const builder = new SearchIndexBuilder('tv', 'live', 3);
  ['Sky News', 'قناة الأخبار', 'News 24', 'Renews'].forEach((name, i) => {
    if (i % 2 === 0) builder.beginChunk(i, 0);
    builder.add(`x:tv:live:${i}`, normalizeName(name));
  });
  const segments = [new SearchSegment(builder.finish())];
  const favs = favouriteMarks(segments, ['x:tv:live:0']);
  for (const q of ['news', 'الاخبار', 'NEW 24']) {
    const result = searchSegments(segments, q, { favourites: favs });
    out.push(`${result.query}=${result.total}:${result.hits.map((h) => `${h.index}/${h.catIdx}.${h.slot}/${h.match}${h.favourite ? '*' : ''}`).join(',')}`);
  }
  return out.join('\n');
}

(globalThis as unknown as { fixture: unknown }).fixture = { run };
