import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeXtreamBase,
  parseQuery,
  parseXtreamStreamUrl,
  streamExtension,
  xtreamApiUrl,
  xtreamFromM3uUrl,
  xtreamM3uUrl,
  xtreamStreamUrl,
  xtreamXmltvUrl,
} from './xtream-url';

const account = { base: 'http://panel.test:8080', username: 'special+user@lablo.test', password: 'p@ss/w0rd&?# é' };

describe('normalizeXtreamBase', () => {
  it.each([
    ['panel.test:8080', 'http://panel.test:8080'],
    ['  HTTP://Panel.Test:8080/  ', 'http://panel.test:8080'],
    ['https://panel.test', 'https://panel.test'],
    ['http://panel.test:8080/player_api.php?username=a&password=b', 'http://panel.test:8080'],
    ['http://panel.test/get.php', 'http://panel.test'],
    ['http://panel.test/xtream/', 'http://panel.test/xtream'],
    ['http://panel.test/Xtream//', 'http://panel.test/Xtream'],
    ['http://192.168.1.10:25461', 'http://192.168.1.10:25461'],
  ])('%s → %s', (input, base) => {
    expect(normalizeXtreamBase(input)).toBe(base);
  });

  it.each(['', '   ', 'ftp://panel.test', 'http://', 'http://user:pass@panel.test', 'panel test', 'http://panel.test:port'])('rejects %j', (input) => {
    expect(normalizeXtreamBase(input)).toBeNull();
  });
});

describe('Xtream URL builders', () => {
  it('percent-encodes credentials in queries and paths', () => {
    const u = 'special%2Buser%40lablo.test';
    const p = 'p%40ss%2Fw0rd%26%3F%23%20%C3%A9';
    expect(xtreamApiUrl(account)).toBe(`http://panel.test:8080/player_api.php?username=${u}&password=${p}`);
    expect(xtreamApiUrl(account, 'get_vod_info', { vod_id: 7, category_id: undefined })).toBe(
      `http://panel.test:8080/player_api.php?username=${u}&password=${p}&action=get_vod_info&vod_id=7`,
    );
    expect(xtreamStreamUrl(account, 'live', 101, 'ts')).toBe(`http://panel.test:8080/live/${u}/${p}/101.ts`);
    expect(xtreamM3uUrl(account)).toBe(`http://panel.test:8080/get.php?username=${u}&password=${p}&type=m3u_plus&output=ts`);
    expect(xtreamXmltvUrl(account)).toBe(`http://panel.test:8080/xmltv.php?username=${u}&password=${p}`);
  });

  it('sanitizes extensions', () => {
    expect(streamExtension('MKV', 'mp4')).toBe('mkv');
    expect(streamExtension('.mp4', 'ts')).toBe('mp4');
    expect(streamExtension('', 'mp4')).toBe('mp4');
    expect(streamExtension('m p4', 'mp4')).toBe('mp4');
    expect(streamExtension(null, 'ts')).toBe('ts');
  });
});

describe('xtreamFromM3uUrl (M3U → Xtream upgrade)', () => {
  it('reads the account from a get.php link', () => {
    expect(xtreamFromM3uUrl('http://Panel.Test:8080/get.php?username=lablo&password=lablo-test&type=m3u_plus&output=ts')).toEqual({
      base: 'http://panel.test:8080',
      username: 'lablo',
      password: 'lablo-test',
    });
  });

  it('decodes credentials the way PHP panels do (+ is a space, %XX)', () => {
    expect(xtreamFromM3uUrl('https://panel.test/iptv/get.php?type=m3u&username=special%2Buser%40lablo.test&password=p%40ss%2Fw0rd%26%3F%23+%C3%A9')).toEqual({
      base: 'https://panel.test/iptv',
      username: 'special+user@lablo.test',
      password: 'p@ss/w0rd&?# é',
    });
    // Broken percent-encoding is kept as written; the first of repeated parameters wins.
    expect(xtreamFromM3uUrl('http://p.test/get.php?username=a%ZZ&password=b&password=c')).toEqual({ base: 'http://p.test', username: 'a%ZZ', password: 'b' });
  });

  it('accepts pasted player_api, panel_api and xmltv links', () => {
    for (const page of ['player_api.php', 'panel_api.php', 'xmltv.php', 'GET.PHP']) {
      expect(xtreamFromM3uUrl(`http://p.test:80/${page}?username=u&password=p#x`)).toEqual({ base: 'http://p.test:80', username: 'u', password: 'p' });
    }
  });

  it.each([
    'http://p.test/get.php?username=u',
    'http://p.test/get.php?username=&password=p',
    'http://p.test/playlist.m3u?username=u&password=p',
    'http://p.test/get.phpx?username=u&password=p',
    'file:///get.php?username=u&password=p',
    'http://user:pw@p.test/get.php?username=u&password=p',
    'not a url',
  ])('ignores %s', (url) => {
    expect(xtreamFromM3uUrl(url)).toBeNull();
  });

  it('parses queries tolerantly', () => {
    expect([...parseQuery('a=1&&b&c=x%20y+z&a=2')]).toEqual([
      ['a', '1'],
      ['b', ''],
      ['c', 'x y z'],
    ]);
  });
});

describe('parseXtreamStreamUrl', () => {
  it('takes apart live, movie and series URLs', () => {
    expect(parseXtreamStreamUrl('http://p.test:8080/live/lablo/lablo-test/101.ts')).toEqual({
      base: 'http://p.test:8080',
      username: 'lablo',
      password: 'lablo-test',
      kind: 'live',
      id: '101',
      ext: 'ts',
    });
    expect(parseXtreamStreamUrl('http://p.test/movie/u/p/201.MKV?token=1')).toMatchObject({ kind: 'movie', id: '201', ext: 'mkv' });
    expect(parseXtreamStreamUrl('http://p.test/sub/series/u/p/3001.mp4')).toMatchObject({ base: 'http://p.test/sub', kind: 'series', id: '3001' });
    // The short live form.
    expect(parseXtreamStreamUrl('http://p.test:8080/lablo/lablo-test/101')).toMatchObject({ kind: 'live', id: '101', ext: null, username: 'lablo' });
  });

  it.each([
    'http://p.test/live/u/p/abc.ts',
    'http://p.test/live/u/p/101.toolong',
    'http://p.test/flussonic/u/p/106/mpegts',
    'http://p.test/a/b/c/d/101.ts',
    'http://p.test/101.ts',
    'rtmp://p.test/live/u/p/1.ts',
  ])('rejects %s', (url) => {
    expect(parseXtreamStreamUrl(url)).toBeNull();
  });

  it('round-trips any credentials through xtreamStreamUrl', () => {
    const cred = fc.string({ minLength: 1, maxLength: 20 });
    fc.assert(
      fc.property(cred, cred, fc.constantFrom('live', 'movie', 'series') as fc.Arbitrary<'live' | 'movie' | 'series'>, fc.nat(), (username, password, kind, id) => {
        const url = xtreamStreamUrl({ base: 'http://p.test:8080/x', username, password }, kind, id, 'ts');
        expect(parseXtreamStreamUrl(url)).toEqual({ base: 'http://p.test:8080/x', username, password, kind, id: String(id), ext: 'ts' });
      }),
    );
  });

  it('round-trips any credentials through get.php', () => {
    const cred = fc.string({ minLength: 1, maxLength: 20 });
    fc.assert(
      fc.property(cred, cred, (username, password) => {
        const url = xtreamM3uUrl({ base: 'https://p.test', username, password });
        expect(xtreamFromM3uUrl(url)).toEqual({ base: 'https://p.test', username, password });
      }),
    );
  });
});
