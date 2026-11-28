import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fields, FixtureError } from '../src/config';
import {
  FAULT_TYPES,
  INVALID_UTF8,
  MALFORMED_M3U_BLOCK,
  MALFORMED_M3U_TAIL,
  Outages,
  globToRegExp,
  listScenarios,
  loadScenario,
  parseFault,
  parseFaultFlags,
  parseScenario,
  scenarioFaults,
} from '../src/faults';
import type { FaultType, MatchContext } from '../src/faults';
import { PlaceholderMedia } from '../src/media';
import type { MockServer } from '../src/server';
import { outageKey } from '../src/server';
import type { RawResult } from './helpers';
import { NOW_SEC, api, listen, mock, rawGet } from './helpers';

let app: MockServer | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const HOST = 'tv-lab.local:8080';
const M3U = '/get.php?username=lablo&password=lablo-test&type=m3u_plus';
const XMLTV = '/xmltv.php?username=lablo&password=lablo-test';
const withFault = (url: string, fault: string): string => `${url}${url.includes('?') ? '&' : '?'}mock_fault=${encodeURIComponent(fault)}`;

async function inject(url: string, headers: Record<string, string> = {}) {
  return app!.inject({ url, headers: { host: HOST, ...headers } });
}
async function plain(url: string): Promise<Buffer> {
  return (await inject(url)).rawPayload;
}
const isValidUtf8 = (buf: Buffer): boolean => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
};

/** One test per fault type; Record<FaultType, …> makes the type checker demand a case for every type. */
const cases: Record<FaultType, () => Promise<void>> = {
  async status() {
    app = await mock();
    const res = await inject(withFault('/live/lablo/lablo-test/101.ts', 'status:509'));
    expect(res.statusCode).toBe(509);
    expect(res.body).toBe('Bandwidth Limit Exceeded');
    for (const s of [401, 403, 404]) expect((await inject(withFault(M3U, `status:${s}`))).statusCode).toBe(s);
    // A panel that answers 200 with an HTML maintenance page instead of JSON.
    const html = await inject(withFault(api(), 'status:status=200:body=<html>maintenance</html>:content_type=text/html'));
    expect(html.statusCode).toBe(200);
    expect(html.headers['content-type']).toBe('text/html');
    expect(html.body).toBe('<html>maintenance</html>');
  },

  async redirect() {
    app = await mock();
    let url = withFault('/movie/lablo/lablo-test/201.mp4', 'redirect:hops=3');
    const locations: string[] = [];
    let res = await inject(url, { range: 'bytes=0-3' });
    while (res.statusCode === 302 && locations.length < 10) {
      const location = String(res.headers.location);
      locations.push(location);
      url = location.replace(`http://${HOST}`, '');
      res = await inject(url, { range: 'bytes=0-3' });
    }
    expect(locations).toHaveLength(3);
    expect(locations[0]).toMatch(/^http:\/\/tv-lab\.local:8080\/__mock\/redirect\/[0-9a-f]{16}\/2$/);
    expect(locations[1]).toMatch(/\/1$/);
    expect(locations[2]).toBe(`http://${HOST}${withFault('/movie/lablo/lablo-test/201.mp4', 'redirect:hops=3')}&mock_hop=done`);
    expect(res.statusCode).toBe(206);

    const relative = await inject(withFault(M3U, 'redirect:hops=1:status=301:relative=true'));
    expect(relative.statusCode).toBe(301);
    expect(relative.headers.location).toMatch(/^\/get\.php\?.*&mock_hop=done$/);

    // A different host (a load balancer / CDN hop).
    await app.close();
    app = await mock({
      scenario: parseScenario({ rules: [{ match: { path: '/get.php' }, faults: [{ type: 'redirect', host: 'cdn.mock.test:8081', status: 307 }] }] }, 'cdn'),
    });
    const cdn = await inject(M3U);
    expect(cdn.statusCode).toBe(307);
    expect(cdn.headers.location).toBe(`http://cdn.mock.test:8081${M3U}&mock_hop=done`);

    // A real client follows the whole chain.
    await app.close();
    app = await mock();
    const base = await listen(app);
    const followed = await fetch(`${base}${withFault('/movie/lablo/lablo-test/201.mp4', 'redirect:hops=3')}`, { headers: { range: 'bytes=0-3' } });
    expect(followed.redirected).toBe(true);
    expect(followed.status).toBe(206);
    expect(followed.url).toContain('mock_hop=done');
  },

  async 'slow-headers'() {
    app = await mock();
    const base = await listen(app);
    const slow = await rawGet(`${base}${withFault(api(), 'slow-headers:400')}`);
    expect(slow.status).toBe(200);
    expect(slow.headersAt).toBeGreaterThanOrEqual(380);
    const fast = await rawGet(`${base}${api()}`);
    expect(fast.headersAt).toBeLessThan(300);
  },

  async stall() {
    app = await mock();
    const base = await listen(app);
    const full = (await rawGet(`${base}${M3U}`)).body; // same Host as the faulted requests
    // Headers promise the whole body, 100 bytes arrive, then nothing while the socket stays open.
    const held = await rawGet(`${base}${withFault(M3U, 'stall:after_bytes=100')}`, 600);
    expect(held.status).toBe(200);
    expect(held.headers['content-length']).toBe(String(full.length));
    expect(held.body.equals(full.subarray(0, 100))).toBe(true);
    expect(held.ended).toBe('timeout');
    // hold_ms: the server gives up and drops the socket.
    const dropped = await rawGet(`${base}${withFault(M3U, 'stall:after_bytes=10:hold_ms=200')}`, 3000);
    expect(dropped.body).toHaveLength(10);
    expect(dropped.ended).toBe('aborted');
    // Headers, then no body at all.
    const empty = await rawGet(`${base}${withFault(M3U, 'stall')}`, 400);
    expect(empty.status).toBe(200);
    expect(empty.body).toHaveLength(0);
    expect(empty.ended).toBe('timeout');

    // after_ms on an endless live stream: data flows, then stops.
    await app.close();
    app = await mock({ media: new PlaceholderMedia({ liveIntervalMs: 10 }) });
    const liveBase = await listen(app);
    const live = await rawGet(`${liveBase}${withFault('/live/lablo/lablo-test/101.ts', 'stall:after_ms=150')}`, 800);
    expect(live.status).toBe(200);
    expect(live.body.length).toBeGreaterThan(0);
    expect(live.body.length).toBeLessThan(13_160 * 35); // ~15 chunks in 150 ms; ~80 if it never stalled
    expect(live.ended).toBe('timeout');
  },

  async reset() {
    app = await mock();
    const base = await listen(app);
    await expect(rawGet(`${base}${withFault(M3U, 'reset')}`)).rejects.toThrow();
    const mid = await rawGet(`${base}${withFault(M3U, 'reset:after_bytes=50')}`, 3000);
    expect(mid.status).toBe(200);
    expect(mid.body).toHaveLength(50);
    expect(mid.ended).toBe('aborted');
  },

  async bom() {
    app = await mock();
    const raw = (await inject(withFault(M3U, 'bom'))).rawPayload;
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.subarray(3).equals(await plain(M3U))).toBe(true);
    const json = await inject(withFault(api(), 'bom'));
    expect(() => JSON.parse(json.body)).toThrow();
  },

  async crlf() {
    app = await mock();
    const text = (await inject(withFault(M3U, 'crlf'))).body;
    expect(text).toBe((await plain(M3U)).toString('utf8').replace(/\n/g, '\r\n'));
    expect(/[^\r]\n/.test(text)).toBe(false);
  },

  async 'invalid-utf8'() {
    app = await mock();
    const m3u = (await plain(M3U)).toString('utf8');
    const bad = (await inject(withFault(M3U, 'invalid-utf8'))).rawPayload;
    expect(isValidUtf8(bad)).toBe(false);
    expect(bad.indexOf(INVALID_UTF8)).toBe(Buffer.byteLength(m3u.slice(0, m3u.indexOf(',Lablo Test 1 SMPTE\n') + 1)));
    const xml = (await inject(withFault(XMLTV, 'invalid-utf8'))).rawPayload;
    expect(xml.indexOf(INVALID_UTF8)).toBe(xml.indexOf('<display-name>') + '<display-name>'.length);
    const json = (await inject(withFault(api('get_live_streams'), 'invalid-utf8'))).rawPayload;
    expect(json.indexOf(INVALID_UTF8)).toBe(json.indexOf('"name":"') + '"name":"'.length);
  },

  async 'malformed-m3u'() {
    app = await mock();
    const text = (await inject(withFault(M3U, 'malformed-m3u'))).body;
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^#EXTM3U url-tvg=/);
    expect(lines.slice(1, 1 + MALFORMED_M3U_BLOCK.length)).toEqual(MALFORMED_M3U_BLOCK);
    expect(lines.at(-1)).toBe(MALFORMED_M3U_TAIL);
    expect(text.endsWith('\n')).toBe(false);
    // The real entries are all still there.
    expect(text.match(/\/live\/lablo\/lablo-test\/\d+\.ts$/gm)).toHaveLength(11);
    // JSON is left alone.
    expect((await inject(withFault(api(), 'malformed-m3u'))).body).toBe((await plain(api())).toString('utf8'));
  },

  async truncate() {
    app = await mock();
    const full = await plain(M3U);
    const cut = await inject(withFault(M3U, 'truncate:100'));
    expect(cut.rawPayload.equals(full.subarray(0, 100))).toBe(true);
    expect(cut.headers['content-length']).toBe('100');
    expect((await inject(withFault(M3U, 'truncate'))).rawPayload).toHaveLength(Math.floor(full.length / 2));
    expect((await inject(withFault(api(), 'truncate:fraction=0.9'))).statusCode).toBe(200);
  },

  async gzip() {
    app = await mock();
    const encoded = await inject(withFault(XMLTV, 'gzip'));
    expect(encoded.headers['content-encoding']).toBe('gzip');
    expect(encoded.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(gunzipSync(encoded.rawPayload).equals(await plain(XMLTV))).toBe(true);
    const raw = await inject(withFault(M3U, 'gzip:raw'));
    expect(raw.headers['content-encoding']).toBeUndefined();
    expect(raw.headers['content-type']).toBe('application/gzip');
    expect(gunzipSync(raw.rawPayload).equals(await plain(M3U))).toBe(true);
    // Streamed media is compressed on the fly.
    const live = await inject(withFault('/live/lablo/lablo-test/101.ts', 'gzip'));
    const ts = gunzipSync(live.rawPayload);
    expect(ts).toHaveLength(4096);
    expect(ts[188]).toBe(0x47);
  },

  async timezone() {
    app = await mock();
    const tz = 'timezone:tz=Asia/Kathmandu';
    const info = (await inject(withFault(api(), tz))).json<{ server_info: Record<string, unknown> }>();
    expect(info.server_info).toMatchObject({ timezone: 'Asia/Kathmandu', time_now: '2026-11-02 17:45:00', timestamp_now: NOW_SEC });
    const epg = (await inject(withFault(api('get_short_epg', '&stream_id=101&limit=1'), tz))).json<{ epg_listings: Record<string, unknown>[] }>();
    expect(epg.epg_listings[0]).toMatchObject({ start: '2026-11-02 17:45:00', start_timestamp: String(NOW_SEC) });
    const firstStart = async (fault: string): Promise<string | undefined> =>
      /<programme start="([^"]+)"/.exec((await inject(withFault(XMLTV, fault))).body)?.[1];
    expect(await firstStart(tz)).toBe('20261026174500 +0545');
    expect(await firstStart(`${tz}:xmltv=none`)).toBe('20261026174500');
    expect(await firstStart(`${tz}:xmltv=colon`)).toBe('20261026174500 +05:45');
    expect(await firstStart(`${tz}:xmltv=utc`)).toBe('20261026120000 +0000');
    // Timeshift starts are read in the same zone.
    const shift = await inject(withFault('/timeshift/lablo/lablo-test/30/2026-11-02:15-45/101.ts', tz));
    expect(shift.headers['x-mock-archive-start']).toBe(String(NOW_SEC - 7200));
  },

  async 'json-quirks'() {
    app = await mock();
    const info = (await inject(withFault(api(), 'json-quirks'))).json<{ user_info: Record<string, unknown> }>();
    expect(info.user_info).toMatchObject({ auth: '1', max_connections: 2, exp_date: expect.any(Number), active_cons: 0 });
    const streams = (await inject(withFault(api('get_live_streams'), 'json-quirks'))).json<Record<string, unknown>[]>();
    expect(streams[0]).toMatchObject({ stream_id: '101', num: '1', category_id: 1, tv_archive_duration: '7' });
    expect(streams.find((s) => s['stream_id'] === '107')).toMatchObject({ epg_channel_id: '' });
    const series = (await inject(withFault(api('get_series_info', '&series_id=301'), 'json-quirks'))).json<{ episodes: unknown }>();
    expect(Array.isArray(series.episodes)).toBe(true);
    expect((series.episodes as unknown[][]).map((s) => s.length)).toEqual([3, 2]);
  },

  async 'no-cors'() {
    app = await mock();
    expect((await inject(api())).headers['access-control-allow-origin']).toBe('*');
    expect((await inject(withFault(api(), 'no-cors'))).headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/player_api.php',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-lablo-test' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
    expect(preflight.headers['access-control-allow-headers']).toBe('x-lablo-test');
  },
};

describe('every fault type', () => {
  for (const type of FAULT_TYPES) it(type, cases[type], 10_000);
});

describe('fault parsing', () => {
  const fault = (obj: Record<string, unknown>) => parseFault(Fields.of(obj, 'test'));

  it('reads query flags: positional, key=value and several faults', () => {
    expect(parseFaultFlags('status:509')).toEqual([{ type: 'status', status: 509, body: undefined, contentType: 'text/plain; charset=utf-8' }]);
    expect(parseFaultFlags('redirect:hops=3:status=307,stall:after_bytes=4096,bom')).toEqual([
      { type: 'redirect', hops: 3, status: 307, host: undefined, relative: false },
      { type: 'stall', afterBytes: 4096, afterMs: undefined, holdMs: 120_000, outageMs: undefined },
      { type: 'bom' },
    ]);
    expect(parseFaultFlags('stall:after_ms=60000:outage_ms=25000')).toEqual([{ type: 'stall', afterBytes: undefined, afterMs: 60_000, holdMs: 120_000, outageMs: 25_000 }]);
    expect(parseFaultFlags('truncate')).toEqual([{ type: 'truncate', bytes: undefined, fraction: 0.5 }]);
  });

  it.each([
    ['an unknown type', 'explode'],
    ['a positional value on a fault without one', 'bom:1'],
    ['an unknown key', 'stall:after_byte=1'],
    ['an outage of no time', 'stall:outage_ms=0'],
    ['a non-redirect status', 'redirect:status=200'],
    ['an unknown time zone', 'timezone:tz=Mars/Olympus'],
    ['an out-of-range fraction', 'truncate:fraction=2'],
    ['a non-numeric value', 'slow-headers:soon'],
    ['an impossible status', 'status:700'],
  ])('rejects %s', (_name, flags) => {
    expect(() => parseFaultFlags(flags)).toThrow(FixtureError);
  });

  it('answers a bad mock_fault with 400', async () => {
    app = await mock();
    const res = await inject(withFault(api(), 'explode'));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('type');
  });

  it('defaults gzip to Content-Encoding and timezone XMLTV offsets to local', () => {
    expect(fault({ type: 'gzip' })).toEqual({ type: 'gzip', mode: 'encoding' });
    expect(fault({ type: 'timezone', tz: 'UTC' })).toEqual({ type: 'timezone', tz: 'UTC', xmltv: 'local' });
  });

  it('matches path globs within and across segments', () => {
    expect(globToRegExp('/live/*').test('/live/a')).toBe(true);
    expect(globToRegExp('/live/*').test('/live/a/b')).toBe(false);
    expect(globToRegExp('/live/**').test('/live/a/b/101.ts')).toBe(true);
    expect(globToRegExp('/get.php').test('/getXphp')).toBe(false);
    expect(globToRegExp('**').test('/anything/at/all')).toBe(true);
  });
});

describe('scenario rules', () => {
  const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
    path: '/live/lablo/lablo-test/101.ts',
    method: 'GET',
    params: {},
    username: 'lablo',
    streamId: 101,
    ...over,
  });

  it('applies a rule only after `after` matches and for `times` matches', () => {
    const scenario = parseScenario({ rules: [{ match: { path: '/live/**' }, after: 1, times: 2, faults: [{ type: 'bom' }] }] }, 'counted');
    const applied = Array.from({ length: 5 }, () => scenarioFaults(scenario, ctx()).length);
    expect(applied).toEqual([0, 1, 1, 0, 0]);
    expect(scenarioFaults(scenario, ctx({ path: '/get.php' }))).toEqual([]);
  });

  it('matches by method, action, username and stream id', () => {
    const scenario = parseScenario(
      {
        rules: [
          { match: { method: 'post', action: 'get_live_streams' }, faults: [{ type: 'bom' }] },
          { match: { username: 'trial' }, faults: [{ type: 'crlf' }] },
          { match: { stream_id: [102, 103] }, faults: [{ type: 'no-cors' }] },
        ],
      },
      'match',
    );
    const types = (c: MatchContext) => scenarioFaults(scenario, c).map((f) => f.type);
    expect(types(ctx({ method: 'POST', params: { action: 'get_live_streams' } }))).toEqual(['bom']);
    expect(types(ctx({ method: 'GET', params: { action: 'get_live_streams' } }))).toEqual([]);
    expect(types(ctx({ username: 'trial' }))).toEqual(['crlf']);
    expect(types(ctx({ streamId: 103 }))).toEqual(['no-cors']);
    expect(types(ctx({ streamId: undefined }))).toEqual([]);
  });

  it('rejects malformed scenarios', () => {
    expect(() => parseScenario({ rules: [{ match: {}, faults: [] }] }, 'x')).toThrow(/at least one fault/);
    expect(() => parseScenario({ rules: [{ match: { paths: '/x' }, faults: [{ type: 'bom' }] }] }, 'x')).toThrow(/unknown key/);
    expect(() => parseScenario({ rule: [] }, 'x')).toThrow(/unknown key/);
    expect(() => loadScenario('does-not-exist')).toThrow(/unknown scenario/);
  });

  it('ships scenarios that all load', () => {
    const shipped = listScenarios();
    expect(shipped.map((s) => s.name)).toEqual([
      'broken-playlist',
      'flaky-live',
      'gzip-epg',
      // (By file name: '-' sorts before '.'.)
      'live-outages-hls-404',
      'live-outages',
      'no-xmltv',
      'odd-timezone',
      'provider-errors',
      'redirect-chain',
      'slow-provider',
      'stalling-streams',
    ]);
    for (const { name, description } of shipped) {
      expect(description, name).not.toBe('');
      expect(loadScenario(name).rules.length, name).toBeGreaterThan(0);
    }
    const slow = loadScenario('slow-provider');
    expect(scenarioFaults(slow, ctx({ path: '/player_api.php' }))).toEqual([{ type: 'slow-headers', delayMs: 3000 }]);
    const stalling = loadScenario('stalling-streams');
    const vod = ctx({ path: '/movie/lablo/lablo-test/201.mp4' });
    expect([1, 2, 3, 4].map(() => scenarioFaults(stalling, vod).map((f) => f.type))).toEqual([[], [], ['reset'], []]);
    // Live stalls by time: the 6 s burst plus 12 s is 18 s of media on every channel (RELAY 39s3).
    const live = ctx({ path: '/live/lablo/lablo-test/107.ts' });
    expect(scenarioFaults(stalling, live)).toEqual([{ type: 'stall', afterBytes: undefined, afterMs: 12_000, holdMs: 300_000, outageMs: undefined }]);
    // Step 21's soak: 60 s past the burst, then the channel is down 25 s.
    expect(scenarioFaults(loadScenario('live-outages'), live)).toEqual([{ type: 'stall', afterBytes: undefined, afterMs: 60_000, holdMs: 120_000, outageMs: 25_000 }]);
    expect(scenarioFaults(loadScenario('live-outages'), vod)).toEqual([]);
    // The same with the live .m3u8 on 404 (RELAY step 59): the .ts as above, the .m3u8 refused.
    const hls404 = loadScenario('live-outages-hls-404');
    expect(scenarioFaults(hls404, live)).toEqual([{ type: 'stall', afterBytes: undefined, afterMs: 60_000, holdMs: 120_000, outageMs: 25_000 }]);
    expect(scenarioFaults(hls404, ctx({ path: '/live/lablo/lablo-test/107.m3u8' })).map((f) => f.type)).toEqual(['stall', 'status']);
    expect(scenarioFaults(hls404, ctx({ path: '/live/lablo/lablo-test/107.m3u8' })).filter((f) => f.type === 'status')).toMatchObject([{ type: 'status', status: 404 }]);
    expect(scenarioFaults(hls404, vod)).toEqual([]);
  });
});

describe('shipped scenarios against the server', () => {
  it('flaky-live: the first two live requests fail, then live works', async () => {
    app = await mock({ scenario: 'flaky-live' });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await inject('/live/lablo/lablo-test/101.ts')).statusCode);
    expect(codes).toEqual([509, 509, 200]);
    expect((await inject(M3U)).statusCode).toBe(200);
  });

  it('provider-errors: per-channel statuses, a truncated playlist and quirky JSON', async () => {
    app = await mock({ scenario: 'provider-errors' });
    const codes = [];
    for (const id of [101, 102, 103, 104, 105]) codes.push((await inject(`/live/lablo/lablo-test/${id}.ts`)).statusCode);
    expect(codes).toEqual([401, 403, 404, 509, 200]);
    const m3u = await inject(M3U);
    expect(m3u.body.endsWith('\n')).toBe(false);
    expect(m3u.body).toContain('/live/lablo/lablo-test/101.ts');
    expect(m3u.body).not.toContain('/series/lablo/lablo-test/3022.mp4');
    expect((await inject(api())).json<{ user_info: Record<string, unknown> }>().user_info['max_connections']).toBe(2);
  });

  it('broken-playlist, gzip-epg, odd-timezone, redirect-chain and no-xmltv do what they say', async () => {
    app = await mock({ scenario: 'broken-playlist' });
    const broken = (await inject(M3U)).rawPayload;
    expect([...broken.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(broken.includes(INVALID_UTF8)).toBe(true);
    expect(broken.includes(Buffer.from('\r\n'))).toBe(true);
    expect(broken.includes(Buffer.from(MALFORMED_M3U_TAIL))).toBe(true);
    await app.close();

    app = await mock({ scenario: 'gzip-epg' });
    expect((await inject(XMLTV)).headers['content-encoding']).toBe('gzip');
    expect((await inject(M3U)).headers['content-type']).toBe('application/gzip');
    await app.close();

    app = await mock({ scenario: 'odd-timezone' });
    expect((await inject(api())).json<{ server_info: { timezone: string } }>().server_info.timezone).toBe('Asia/Kathmandu');
    expect((await inject(XMLTV)).body).toMatch(/<programme start="\d{14}" stop="\d{14}"/);
    await app.close();

    app = await mock({ scenario: 'redirect-chain' });
    expect((await inject('/series/lablo/lablo-test/3001.mkv')).statusCode).toBe(302);
    expect((await inject(api())).statusCode).toBe(200);
    await app.close();

    // The guide is off, the short EPG still answers (the step-9c fallback).
    app = await mock({ scenario: 'no-xmltv' });
    expect((await inject(XMLTV)).statusCode).toBe(404);
    const short = (await inject(api('get_short_epg', '&stream_id=101&limit=2'))).json<{ epg_listings: unknown[] }>();
    expect(short.epg_listings).toHaveLength(2);
    expect((await inject(M3U)).body).toContain('url-tvg=');
  });
});

describe('scenario control', () => {
  it('switches scenarios at runtime and resets their counters', async () => {
    app = await mock();
    const put = (name: string | null) => app!.inject({ method: 'PUT', url: '/__mock/scenario', payload: { name } });
    expect((await inject('/__mock/health')).json()).toMatchObject({ ok: true, scenario: null });
    expect((await put('flaky-live')).json()).toEqual({ active: 'flaky-live', rules: 1 });
    expect((await inject('/__mock/health')).json()).toMatchObject({ scenario: 'flaky-live' });
    expect((await inject('/live/lablo/lablo-test/101.ts')).statusCode).toBe(509);
    expect((await inject('/live/lablo/lablo-test/101.ts')).statusCode).toBe(509);
    expect((await inject('/live/lablo/lablo-test/101.ts')).statusCode).toBe(200);
    await put('flaky-live');
    expect((await inject('/live/lablo/lablo-test/101.ts')).statusCode).toBe(509);
    expect((await put('nope')).statusCode).toBe(404);
    expect((await put(null)).json()).toEqual({ active: null });
    expect((await inject('/live/lablo/lablo-test/101.ts')).statusCode).toBe(200);
    const listed = (await inject('/__mock/scenarios')).json<{ active: null; available: { name: string }[] }>();
    expect(listed.available).toHaveLength(11);
  });

  it('never faults the control and lab endpoints', async () => {
    app = await mock({ scenario: parseScenario({ rules: [{ match: { path: '**' }, faults: [{ type: 'status', status: 500 }] }] }, 'everything') });
    expect((await inject(api())).statusCode).toBe(500);
    expect((await inject('/__mock/health')).statusCode).toBe(200);
    expect((await inject(withFault('/__mock/health', 'status:500'))).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/__mock/scenario', payload: { name: null } })).statusCode).toBe(200);
    expect((await inject(api())).statusCode).toBe(200);
  });
});

describe('outages (stall:outage_ms, RELAY step 39s3)', () => {
  it('keeps a stream down for the outage: joined requests are held, everything held closes at its end', () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const outages = new Outages((line) => lines.push(line));
      const closed: string[] = [];
      const close = (name: string) => () => closed.push(name);
      expect(outages.isDown('lablo/104')).toBe(false);
      outages.start('lablo/104', 25_000, close('stalled'));
      expect(outages.isDown('lablo/104')).toBe(true);
      expect(outages.isDown('lablo/105')).toBe(false);
      vi.advanceTimersByTime(7000);
      outages.join('lablo/104', close('reconnect'));
      const gone = outages.join('lablo/104', close('hung up'));
      gone(); // the client closed it first
      // A second stall during the outage joins it: the end stays where it was.
      vi.advanceTimersByTime(10_000);
      outages.start('lablo/104', 25_000, close('second'));
      vi.advanceTimersByTime(7999);
      expect(closed).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(closed).toEqual(['stalled', 'reconnect', 'second']);
      expect(outages.isDown('lablo/104')).toBe(false);
      expect(lines).toEqual(['outage lablo/104: down for 25000 ms', 'outage lablo/104: back (3 held closed)']);
      // A request that found the stream down but joins after the end is closed at once.
      outages.join('lablo/104', close('late'));
      expect(closed.at(-1)).toBe('late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends every outage at once on clear, and a released response is never closed', () => {
    vi.useFakeTimers();
    try {
      const outages = new Outages();
      const closed: string[] = [];
      const release = outages.start('a', 5000, () => closed.push('a'));
      outages.start('b', 5000, () => closed.push('b'));
      release();
      outages.clear();
      expect(closed).toEqual(['b']);
      expect([outages.isDown('a'), outages.isDown('b')]).toEqual([false, false]);
      // The cleared outage's timer is gone: it never ends a new outage of the same stream early.
      vi.advanceTimersByTime(1000);
      outages.start('b', 5000, () => closed.push('b again'));
      vi.advanceTimersByTime(4999);
      expect(closed).toEqual(['b']);
      vi.advanceTimersByTime(1);
      expect(closed).toEqual(['b', 'b again']);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keys a stream by the account and its id, else by the path", () => {
    expect(outageKey('lablo', 104, '/live/lablo/lablo-test/104.ts')).toBe('lablo/104');
    expect(outageKey(undefined, undefined, '/get.php')).toBe('//get.php');
  });

  const FAULT = 'stall:after_ms=150:outage_ms=600';
  const at = async (startMs: number, url: string, waitMs: number, t0: number): Promise<RawResult & { endedAt: number }> => {
    const wait = startMs - (Date.now() - t0);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const result = await rawGet(url, waitMs);
    return { ...result, endedAt: Date.now() - t0 };
  };

  it("holds the channel's other requests until the outage ends, then closes them; a new request plays", async () => {
    app = await mock({ media: new PlaceholderMedia({ liveIntervalMs: 10 }) });
    const base = await listen(app);
    // An account with four connections: a held response still counts against its limit.
    const t0 = Date.now();
    const [stalled, reconnect, playlist, other, plainTs] = await Promise.all([
      at(0, `${base}${withFault('/live/forever/forever-test/101.ts', FAULT)}`, 3000, t0),
      at(300, `${base}${withFault('/live/forever/forever-test/101.ts', FAULT)}`, 3000, t0),
      at(300, `${base}${withFault('/live/forever/forever-test/101.m3u8', FAULT)}`, 3000, t0),
      at(300, `${base}${withFault('/live/forever/forever-test/102.ts', FAULT)}`, 3000, t0),
      at(300, `${base}/live/forever/forever-test/101.ts`, 200, t0),
    ]);
    // The stalled response: data, then nothing until the outage's end closes it.
    expect(stalled.status).toBe(200);
    expect(stalled.body.length).toBeGreaterThan(0);
    expect(stalled.ended).toBe('aborted');
    expect(stalled.endedAt).toBeGreaterThanOrEqual(700);
    // The reconnect and the channel's playlist: headers, no data, closed with it.
    for (const held of [reconnect, playlist]) {
      expect(held.status).toBe(200);
      expect(held.body).toHaveLength(0);
      expect(held.ended).toBe('aborted');
      expect(Math.abs(held.endedAt - stalled.endedAt)).toBeLessThan(150);
    }
    // Another channel plays during it (then has its own outage), and the same channel without the fault plays on.
    expect(other.body.length).toBeGreaterThan(0);
    expect(other.endedAt).toBeGreaterThanOrEqual(1000);
    expect(plainTs.body.length).toBeGreaterThan(0);
    expect(plainTs.ended).toBe('timeout');
    // After the outage the channel plays again, and stalls again into a new outage.
    const again = await rawGet(`${base}${withFault('/live/forever/forever-test/101.ts', FAULT)}`, 400);
    expect(again.body.length).toBeGreaterThan(0);
    expect(again.ended).toBe('timeout');
    const held = await rawGet(`${base}${withFault('/live/forever/forever-test/101.ts', FAULT)}`, 200);
    expect([held.status, held.body.length, held.ended]).toEqual([200, 0, 'timeout']);
  });

  it('ends the outages when the scenario switches, and logs each one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    app = await mock({ media: new PlaceholderMedia({ liveIntervalMs: 10 }), logRequests: true });
    const base = await listen(app);
    const url = `${base}${withFault('/live/lablo/lablo-test/101.ts', 'stall:after_ms=100:outage_ms=60000')}`;
    const t0 = Date.now();
    const stalled = at(0, url, 3000, t0);
    const held = at(300, url, 3000, t0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await app.inject({ method: 'PUT', url: '/__mock/scenario', payload: { name: null } });
    for (const r of await Promise.all([stalled, held])) {
      expect(r.ended).toBe('aborted');
      expect(r.endedAt).toBeLessThan(1500);
    }
    const outageLines = log.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('outage'));
    log.mockRestore();
    expect(outageLines).toEqual(['outage lablo/101: down for 60000 ms', 'outage lablo/101: back (2 held closed)']);
  });
});
