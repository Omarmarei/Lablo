import { afterEach, describe, expect, it } from 'vitest';
import type { MockServer } from '../src/server';
import { etagMatches } from '../src/playlist';
import { mock } from './helpers';

let app: MockServer;
afterEach(async () => {
  await app.close();
});

const HOST = 'tv-lab.local:8080';
const BASE = `http://${HOST}`;

async function playlist(query: string): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
  const res = await app.inject({ url: `/get.php?${query}`, headers: { host: HOST } });
  return { status: res.statusCode, text: res.body, headers: res.headers };
}

/** [#EXTINF line, URL] pairs. */
function entries(text: string): [string, string][] {
  const lines = text.split('\n');
  const out: [string, string][] = [];
  lines.forEach((line, i) => {
    if (line.startsWith('#EXTINF')) out.push([line, lines[i + 1] ?? '']);
  });
  return out;
}

describe('get.php', () => {
  it('serves m3u_plus with tvg attributes, groups, VOD and episodes', async () => {
    app = await mock();
    const { status, text, headers } = await playlist('username=zoma&password=zoma-test&type=m3u_plus&output=ts');
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('audio/x-mpegurl; charset=utf-8');
    expect(headers['content-disposition']).toBe('attachment; filename="tv_channels_m3u_plus.m3u"');
    const epg = `${BASE}/xmltv.php?username=zoma&password=zoma-test`;
    expect(text.split('\n')[0]).toBe(`#EXTM3U url-tvg="${epg}" x-tvg-url="${epg}"`);
    const list = entries(text);
    expect(list).toHaveLength(12 + 6 + 7);
    expect(list[0]).toEqual([
      `#EXTINF:-1 tvg-id="zoma.test1" tvg-name="Zoma Test 1 SMPTE" tvg-logo="${BASE}/images/channel-101.png" group-title="Test News" catchup="xc" catchup-days="7",Zoma Test 1 SMPTE`,
      `${BASE}/live/zoma/zoma-test/101.ts`,
    ]);
    expect(list.find(([, url]) => url.endsWith('/201.mp4'))).toEqual([
      `#EXTINF:-1 tvg-id="" tvg-name="Big Buck Bunny" tvg-logo="${BASE}/images/movie-201.png" group-title="Open Movies | أفلام مفتوحة",Big Buck Bunny`,
      `${BASE}/movie/zoma/zoma-test/201.mp4`,
    ]);
    expect(list.find(([, url]) => url.endsWith('/3011.mp4'))?.[0]).toContain(',Zoma Test Series S02 E01');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('advertises each M3U catch-up mode', async () => {
    app = await mock();
    const { text } = await playlist('username=zoma&password=zoma-test&type=m3u_plus');
    const byId = new Map(entries(text).map(([info, url]) => [/\/(\d+)(\.\w+|\/\w+(\.m3u8)?)$/.exec(url)?.[1], { info, url }]));
    expect(byId.get('101')?.info).toContain('catchup="xc" catchup-days="7"');
    expect(byId.get('102')?.info).toContain(
      `catchup="default" catchup-days="3" catchup-source="${BASE}/catchup/zoma/zoma-test/102.ts?start={utc}&end={utcend}"`,
    );
    expect(byId.get('103')?.info).toContain('catchup="append" catchup-days="3" catchup-source="?utc={utc}&lutc={lutc}"');
    expect(byId.get('105')?.info).toContain('catchup="shift" catchup-days="1"');
    expect(byId.get('106')).toMatchObject({ url: `${BASE}/flussonic/zoma/zoma-test/106/mpegts` });
    expect(byId.get('106')?.info).toContain('catchup="flussonic" catchup-days="2"');
    expect(byId.get('104')?.info).not.toContain('catchup');
    expect(byId.get('108')?.info).toContain('radio="true"');
    expect(byId.get('108')?.info).toContain('tvg-logo=""');
    expect(byId.get('107')?.info).toContain('tvg-id=""');
    expect(byId.get('105')?.info).toContain('tvg-id="Zoma.Kids"');
  });

  it('switches live URLs to HLS with output=m3u8', async () => {
    app = await mock();
    const { text } = await playlist('username=zoma&password=zoma-test&type=m3u_plus&output=m3u8');
    const urls = entries(text).map(([, url]) => url);
    expect(urls).toContain(`${BASE}/live/zoma/zoma-test/101.m3u8`);
    expect(urls).toContain(`${BASE}/flussonic/zoma/zoma-test/106/index.m3u8`);
    expect(urls).toContain(`${BASE}/movie/zoma/zoma-test/202.mkv`);
  });

  it('serves the bare m3u type without attributes', async () => {
    app = await mock();
    const { text } = await playlist('username=zoma&password=zoma-test&type=m3u');
    expect(text.split('\n')[0]).toBe('#EXTM3U');
    expect(entries(text)[0]).toEqual(['#EXTINF:-1,Zoma Test 1 SMPTE', `${BASE}/live/zoma/zoma-test/101.ts`]);
    expect(text).not.toContain('tvg-');
  });

  it('rejects bad credentials, inactive accounts and unknown types', async () => {
    app = await mock();
    expect((await playlist('username=zoma&password=nope&type=m3u_plus')).status).toBe(401);
    expect((await playlist('type=m3u_plus')).status).toBe(401);
    expect((await playlist('username=expired&password=expired-test&type=m3u_plus')).status).toBe(403);
    expect((await playlist('username=banned&password=banned-test')).status).toBe(403);
    expect((await playlist('username=zoma&password=zoma-test&type=json')).status).toBe(400);
  });

  it('percent-encodes credentials in every URL, and those URLs work', async () => {
    app = await mock();
    const user = 'special+user@zoma.test';
    const pass = 'p@ss/w0rd&?# é';
    const { status, text } = await playlist(`username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus`);
    expect(status).toBe(200);
    const path = `${encodeURIComponent(user)}/${encodeURIComponent(pass)}`;
    expect(text).toContain(`${BASE}/live/${path}/101.ts`);
    expect(text).toContain(`url-tvg="${BASE}/xmltv.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}"`);
    for (const [, url] of entries(text).slice(0, 3)) {
      const res = await app.inject({ url: url.slice(BASE.length) });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('every playlist URL resolves (live, flussonic, VOD, episodes)', async () => {
    app = await mock();
    for (const output of ['ts', 'm3u8']) {
      const { text } = await playlist(`username=zoma&password=zoma-test&type=m3u_plus&output=${output}`);
      for (const [, url] of entries(text)) {
        const res = await app.inject({ url: url.slice(BASE.length), headers: { range: 'bytes=0-1023' } });
        expect([200, 206], url).toContain(res.statusCode);
      }
    }
  });
});

describe('get.php conditional GET', () => {
  const url = '/get.php?username=zoma&password=zoma-test&type=m3u_plus';

  it('answers 304 to its own ETag, and a new ETag once the catalog changes', async () => {
    app = await mock();
    const first = await app.inject({ url, headers: { host: HOST } });
    const etag = String(first.headers['etag']);
    expect(etag).toMatch(/^"[\w-]{27}"$/);
    const again = await app.inject({ url, headers: { host: HOST, 'if-none-match': etag } });
    expect([again.statusCode, again.body, again.headers['etag']]).toEqual([304, '', etag]);
    expect((await app.inject({ url, headers: { host: HOST, 'if-none-match': '"other"' } })).statusCode).toBe(200);
    // The body depends on the Host header, and so does the tag.
    expect((await app.inject({ url, headers: { host: 'other.local', 'if-none-match': etag } })).statusCode).toBe(200);

    app.mockState.catalog = { ...app.mockState.catalog, live: app.mockState.catalog.live.slice(1) };
    const changed = await app.inject({ url, headers: { host: HOST, 'if-none-match': etag } });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers['etag']).not.toBe(etag);
  });

  it('compares like HTTP does: weak tags, lists and *', () => {
    expect(etagMatches('W/"a"', '"a"')).toBe(true);
    expect(etagMatches('"x", "a"', '"a"')).toBe(true);
    expect(etagMatches('*', '"a"')).toBe(true);
    expect(etagMatches(['"x"', '"a"'], '"a"')).toBe(true);
    expect(etagMatches('"b"', '"a"')).toBe(false);
    expect(etagMatches(undefined, '"a"')).toBe(false);
  });
});
