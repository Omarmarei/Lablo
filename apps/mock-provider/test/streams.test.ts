import { request as httpRequest } from 'node:http';
import type { ClientRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerFixture } from '../src/config';
import { PlaceholderMedia, TS_PACKET_SIZE, patternByte } from '../src/media';
import type { MockServer } from '../src/server';
import { PNG_1X1, parseRange } from '../src/streams';
import { NOW_SEC, listen, mock } from './helpers';

let app: MockServer;
afterEach(async () => {
  await app.close();
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ url, headers: { host: 'tv-lab.local:8080', ...headers } });
const archiveHeaders = (res: Awaited<ReturnType<typeof get>>) => ({
  channel: res.headers['x-mock-archive-channel'],
  start: Number(res.headers['x-mock-archive-start']),
  duration: Number(res.headers['x-mock-archive-duration']),
});

function expectTs(body: Buffer): void {
  expect(body.length).toBeGreaterThan(0);
  expect(body.length % TS_PACKET_SIZE).toBe(0);
  for (let o = 0; o < body.length; o += TS_PACKET_SIZE) expect(body[o]).toBe(0x47);
}

const SEQ_NOW = NOW_SEC / 6;
const TWO_HOURS_AGO = NOW_SEC - 7200;

describe('live', () => {
  it('serves MPEG-TS for .ts and extension-less URLs', async () => {
    app = await mock();
    for (const url of ['/live/zoma/zoma-test/101.ts', '/live/zoma/zoma-test/101', '/zoma/zoma-test/101']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toBe('video/mp2t');
      expect(res.rawPayload).toHaveLength(4096); // the test media's finite live limit
      expect(res.rawPayload[0]).toBe(0x47);
    }
  });

  it("refuses a live format the account's allowed_output_formats leave out (the hls account: no .ts)", async () => {
    app = await mock();
    for (const url of ['/live/hls/hls-test/101.ts', '/live/hls/hls-test/101', '/hls/hls-test/101']) expect((await get(url)).statusCode, url).toBe(403);
    expect((await get('/live/hls/hls-test/101.m3u8')).statusCode).toBe(200);
    // The formats it allows are the ones user_info names.
    expect(JSON.parse((await get('/player_api.php?username=hls&password=hls-test')).body).user_info.allowed_output_formats).toEqual(['m3u8']);
    expect(JSON.parse((await get('/player_api.php?username=zoma&password=zoma-test')).body).user_info.allowed_output_formats).toEqual(['m3u8', 'ts']);
  });

  it('serves a sliding-window HLS playlist whose segments resolve', async () => {
    app = await mock();
    const res = await get('/live/zoma/zoma-test/101.m3u8');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    const lines = res.body.trim().split('\n');
    expect(lines.slice(0, 4)).toEqual(['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6', `#EXT-X-MEDIA-SEQUENCE:${SEQ_NOW - 6}`]);
    const segments = lines.filter((l) => l.startsWith('http'));
    expect(segments).toHaveLength(6);
    expect(segments[0]).toBe(`http://tv-lab.local:8080/hls/zoma/zoma-test/101/${SEQ_NOW - 6}.ts`);
    expect(res.body).not.toContain('#EXT-X-ENDLIST');
    const seg = await get(segments[5]!.slice('http://tv-lab.local:8080'.length));
    expect(seg.statusCode).toBe(200);
    expect(seg.headers['content-type']).toBe('video/mp2t');
    expectTs(seg.rawPayload);
    expect(seg.rawPayload.toString('latin1')).toContain(`seq=${SEQ_NOW - 1}`);
  });

  it('refuses future and malformed segments, unknown channels and odd extensions', async () => {
    app = await mock();
    expect((await get(`/hls/zoma/zoma-test/101/${SEQ_NOW + 1}.ts`)).statusCode).toBe(404);
    expect((await get('/hls/zoma/zoma-test/101/abc.ts')).statusCode).toBe(404);
    expect((await get('/hls/zoma/zoma-test/999/1.ts')).statusCode).toBe(404);
    expect((await get('/live/zoma/zoma-test/999.ts')).statusCode).toBe(404);
    expect((await get('/live/zoma/zoma-test/101.mp4')).statusCode).toBe(404);
    expect((await get('/zoma/zoma-test/999')).statusCode).toBe(404);
    expect((await get('/zoma/zoma-test/abc')).statusCode).toBe(404);
  });

  it.each([
    ['/live/zoma/nope/101.ts', 401],
    ['/zoma/nope/101', 401],
    ['/hls/zoma/nope/101/1.ts', 401],
    ['/movie/zoma/nope/201.mp4', 401],
    ['/series/zoma/nope/3001.mkv', 401],
    ['/timeshift/zoma/nope/30/2026-11-02:10-00/101.ts', 401],
    ['/streaming/timeshift.php?username=zoma&password=nope&stream=101&start=2026-11-02:10-00&duration=30', 401],
    ['/catchup/zoma/nope/102.ts?start=1&end=2', 401],
    ['/flussonic/zoma/nope/106/mpegts', 401],
    ['/live/expired/expired-test/101.ts', 403],
    ['/movie/banned/banned-test/201.mp4', 403],
    ['/live/maxed/maxed-test/101.ts', 509],
    ['/movie/maxed/maxed-test/201.mp4', 509],
  ])('%s -> %i', async (url, status) => {
    app = await mock();
    expect((await get(url)).statusCode).toBe(status);
  });
});

describe('VOD and episodes', () => {
  const SIZE = 1024 * 1024 + 201;

  it('serves the whole file with its length and type', async () => {
    app = await mock();
    const res = await get('/movie/zoma/zoma-test/201.mp4');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBe(SIZE);
    expect(res.rawPayload).toHaveLength(SIZE);
    expect(res.rawPayload[SIZE - 1]).toBe(patternByte(201, SIZE - 1));
  });

  it('answers byte ranges with 206 and the right bytes', async () => {
    app = await mock();
    const res = await get('/movie/zoma/zoma-test/201.mp4', { range: 'bytes=1000-1009' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 1000-1009/${SIZE}`);
    expect(res.headers['content-length']).toBe('10');
    expect([...res.rawPayload]).toEqual(Array.from({ length: 10 }, (_, i) => patternByte(201, 1000 + i)));
    const open = await get('/movie/zoma/zoma-test/201.mp4', { range: `bytes=${SIZE - 5}-` });
    expect(open.headers['content-range']).toBe(`bytes ${SIZE - 5}-${SIZE - 1}/${SIZE}`);
    const suffix = await get('/movie/zoma/zoma-test/201.mp4', { range: 'bytes=-3' });
    expect(suffix.rawPayload).toHaveLength(3);
    const bad = await get('/movie/zoma/zoma-test/201.mp4', { range: `bytes=${SIZE}-` });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${SIZE}`);
  });

  it('answers HEAD with headers only', async () => {
    app = await mock();
    const res = await app.inject({ method: 'HEAD', url: '/movie/zoma/zoma-test/202.mkv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/x-matroska');
    expect(res.headers['content-length']).toBe(String(1024 * 1024 + 202));
    expect(res.rawPayload).toHaveLength(0);
  });

  it('serves episodes from /series and refuses ids of the wrong kind', async () => {
    app = await mock();
    const ep = await get('/series/zoma/zoma-test/3001.mkv', { range: 'bytes=0-0' });
    expect(ep.statusCode).toBe(206);
    expect(ep.headers['content-type']).toBe('video/x-matroska');
    expect((await get('/series/zoma/zoma-test/201.mp4')).statusCode).toBe(404);
    expect((await get('/movie/zoma/zoma-test/3001.mkv')).statusCode).toBe(404);
    expect((await get('/movie/zoma/zoma-test/999.mp4')).statusCode).toBe(404);
  });

  it('parses ranges', () => {
    expect(parseRange(undefined, 100)).toBeUndefined();
    expect(parseRange('bytes=0-9,20-29', 100)).toBeUndefined();
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=50-40', 100)).toBe('unsatisfiable');
  });
});

describe('catch-up', () => {
  it('serves Xtream /timeshift with the start in the panel zone and the duration in minutes', async () => {
    app = await mock();
    const res = await get('/timeshift/zoma/zoma-test/30/2026-11-02:10-00/101.ts');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp2t');
    expectTs(res.rawPayload);
    expect(archiveHeaders(res)).toEqual({ channel: '101', start: TWO_HOURS_AGO, duration: 1800 });

    const fixture = loadServerFixture();
    await app.close();
    app = await mock({ fixture: { ...fixture, server: { ...fixture.server, timezone: 'Asia/Riyadh' } } });
    const riyadh = await get('/timeshift/zoma/zoma-test/30/2026-11-02:13-00/101.ts');
    expect(archiveHeaders(riyadh).start).toBe(TWO_HOURS_AGO);
  });

  it('serves timeshift.php the same way', async () => {
    app = await mock();
    const res = await get('/streaming/timeshift.php?username=zoma&password=zoma-test&stream=101&start=2026-11-02:10-00&duration=60');
    expect(res.statusCode).toBe(200);
    expect(archiveHeaders(res)).toEqual({ channel: '101', start: TWO_HOURS_AGO, duration: 3600 });
  });

  it.each([
    ['no archive on the channel', '/timeshift/zoma/zoma-test/30/2026-11-02:10-00/104.ts', 404],
    ['before the archive window', '/timeshift/zoma/zoma-test/30/2026-10-20:10-00/101.ts', 404],
    ['a start in the future', '/timeshift/zoma/zoma-test/30/2026-11-02:13-00/101.ts', 404],
    ['a malformed start', '/timeshift/zoma/zoma-test/30/2026-11-02T10:00/101.ts', 400],
    ['a malformed duration', '/timeshift/zoma/zoma-test/abc/2026-11-02:10-00/101.ts', 400],
    ['an unknown channel', '/timeshift/zoma/zoma-test/30/2026-11-02:10-00/999.ts', 404],
    ['timeshift.php without a start', '/streaming/timeshift.php?username=zoma&password=zoma-test&stream=101&duration=30', 400],
    ['timeshift.php for an unknown channel', '/streaming/timeshift.php?username=zoma&password=zoma-test&stream=999&start=2026-11-02:10-00&duration=30', 404],
  ])('refuses %s', async (_name, url, status) => {
    app = await mock();
    expect((await get(url)).statusCode).toBe(status);
  });

  it('serves M3U catchup="default" from its catchup-source', async () => {
    app = await mock();
    const res = await get(`/catchup/zoma/zoma-test/102.ts?start=${TWO_HOURS_AGO}&end=${TWO_HOURS_AGO + 2700}`);
    expect(res.statusCode).toBe(200);
    expect(archiveHeaders(res)).toEqual({ channel: '102', start: TWO_HOURS_AGO, duration: 2700 });
    expect((await get(`/catchup/zoma/zoma-test/102.ts?start=${TWO_HOURS_AGO}&end=${TWO_HOURS_AGO}`)).statusCode).toBe(400);
    expect((await get(`/catchup/zoma/zoma-test/999.ts?start=1&end=2`)).statusCode).toBe(404);
  });

  it('serves M3U append/shift catch-up (?utc=&lutc=) on the live URL, as TS or HLS', async () => {
    app = await mock();
    const ts = await get(`/live/zoma/zoma-test/103.ts?utc=${TWO_HOURS_AGO}&lutc=${NOW_SEC}`);
    expect(ts.statusCode).toBe(200);
    expect(archiveHeaders(ts)).toEqual({ channel: '103', start: TWO_HOURS_AGO, duration: 7200 });
    // shift: no lutc, so the window runs to "now".
    const shift = await get(`/live/zoma/zoma-test/105.ts?utc=${NOW_SEC - 600}`);
    expect(archiveHeaders(shift)).toEqual({ channel: '105', start: NOW_SEC - 600, duration: 600 });
    const hls = await get(`/live/zoma/zoma-test/103.m3u8?utc=${TWO_HOURS_AGO}&lutc=${TWO_HOURS_AGO + 1800}`);
    expect(hls.statusCode).toBe(200);
    expect(hls.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(hls.body).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(hls.body.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
    expect(hls.body.split('\n').filter((l) => l.startsWith('http'))).toHaveLength(300);
    expect(hls.body).toContain(`#EXT-X-MEDIA-SEQUENCE:${TWO_HOURS_AGO / 6}`);
  });

  it('serves Flussonic live and archive URLs', async () => {
    app = await mock();
    const live = await get('/flussonic/zoma/zoma-test/106/index.m3u8');
    expect(live.statusCode).toBe(200);
    expect(live.body).toContain(`#EXT-X-MEDIA-SEQUENCE:${SEQ_NOW - 6}`);
    const mpegts = await get('/flussonic/zoma/zoma-test/106/mpegts');
    expect(mpegts.headers['content-type']).toBe('video/mp2t');
    const archive = await get(`/flussonic/zoma/zoma-test/106/archive-${TWO_HOURS_AGO}-900.ts`);
    expect(archiveHeaders(archive)).toEqual({ channel: '106', start: TWO_HOURS_AGO, duration: 900 });
    const index = await get(`/flussonic/zoma/zoma-test/106/index-${TWO_HOURS_AGO}-600.m3u8`);
    expect(index.body.split('\n').filter((l) => l.startsWith('http'))).toHaveLength(100);
    const abs = await get(`/flussonic/zoma/zoma-test/106/timeshift_abs-${NOW_SEC - 300}.ts`);
    expect(archiveHeaders(abs)).toEqual({ channel: '106', start: NOW_SEC - 300, duration: 300 });
    expect((await get('/flussonic/zoma/zoma-test/106/manifest.mpd')).statusCode).toBe(404);
    expect((await get('/flussonic/zoma/zoma-test/999/mpegts')).statusCode).toBe(404);
  });
});

describe('images', () => {
  it('serves a PNG for catalog image names only', async () => {
    app = await mock();
    const res = await get('/images/channel-101.png');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(PNG_1X1)).toBe(true);
    expect((await get('/images/../../etc/passwd')).statusCode).toBe(404);
    expect((await get('/images/logo.svg')).statusCode).toBe(404);
  });
});

describe('max_connections (real sockets)', () => {
  /** Opens an endless stream and resolves once its first bytes arrive. */
  function openStream(url: string): Promise<{ req: ClientRequest; status: number }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(url, { agent: false }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve({ req, status: res.statusCode ?? 0 });
          return;
        }
        res.once('data', () => resolve({ req, status: 200 }));
      });
      req.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
      });
      req.end();
    });
  }

  async function connections(base: string): Promise<Record<string, number>> {
    return (await fetch(`${base}/__mock/connections`)).json() as Promise<Record<string, number>>;
  }

  it('counts open streams in active_cons and refuses one over the limit until it closes', async () => {
    app = await mock({ media: new PlaceholderMedia({ liveIntervalMs: 20 }) }); // endless live
    const base = await listen(app);
    const first = await openStream(`${base}/live/trial/trial-test/101.ts`);
    expect(first.status).toBe(200);
    expect(await connections(base)).toEqual({ trial: 1 });
    const info = (await (await fetch(`${base}/player_api.php?username=trial&password=trial-test`)).json()) as { user_info: { active_cons: string } };
    expect(info.user_info.active_cons).toBe('1');

    const second = await openStream(`${base}/live/trial/trial-test/102.ts`);
    expect(second.status).toBe(403);
    second.req.destroy();

    first.req.destroy();
    for (let i = 0; i < 50 && Object.keys(await connections(base)).length > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await connections(base)).toEqual({});

    const third = await openStream(`${base}/live/trial/trial-test/102.ts`);
    expect(third.status).toBe(200);
    third.req.destroy();
  });
});
