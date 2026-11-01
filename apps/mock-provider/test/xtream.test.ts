import { afterEach, describe, expect, it } from 'vitest';
import { loadServerFixture } from '../src/config';
import type { MockServer } from '../src/server';
import { DAY_SEC, NOW_SEC, api, mock } from './helpers';

const DAY0_SEC = NOW_SEC - 12 * 3600; // UTC midnight of the pinned day

let app: MockServer;
afterEach(async () => {
  await app.close();
});

async function json<T = Record<string, unknown>>(url: string): Promise<T> {
  const res = await app.inject({ url, headers: { host: 'tv-lab.local:8080' } });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/^application\/json/);
  return res.json<T>();
}

type Obj = Record<string, unknown>;
const b64decode = (s: unknown): string => Buffer.from(String(s), 'base64').toString('utf8');

describe('player_api.php authentication and user_info', () => {
  it('returns user_info and server_info for an active account', async () => {
    app = await mock();
    const body = await json<{ user_info: Obj; server_info: Obj }>(api());
    expect(body.user_info).toEqual({
      username: 'zoma',
      password: 'zoma-test',
      message: 'Welcome to the Zoma test server',
      auth: 1,
      status: 'Active',
      exp_date: String(DAY0_SEC + 365 * DAY_SEC),
      is_trial: '0',
      active_cons: '0',
      created_at: String(DAY0_SEC - 400 * DAY_SEC),
      max_connections: '2',
      allowed_output_formats: ['m3u8', 'ts'],
    });
    expect(body.server_info).toEqual({
      url: 'tv-lab.local',
      port: '8080',
      https_port: '8443',
      server_protocol: 'http',
      rtmp_port: '8880',
      timezone: 'UTC',
      timestamp_now: NOW_SEC,
      time_now: '2026-11-02 12:00:00',
      process: true,
    });
  });

  it.each([
    ['a wrong password', api(undefined, '', 'zoma', 'nope')],
    ['an unknown user', api(undefined, '', 'nobody', 'zoma-test')],
    ['missing credentials', '/player_api.php'],
    ['a wrong password with an action', api('get_live_streams', '', 'zoma', 'nope')],
  ])('answers auth 0 for %s', async (_name, url) => {
    app = await mock();
    expect(await json(url)).toEqual({ user_info: { auth: 0 } });
  });

  it('reports every account state from the fixtures', async () => {
    app = await mock();
    const info = async (u: string): Promise<Obj> => {
      const account = loadServerFixture().accounts.find((a) => a.username === u)!;
      return (await json<{ user_info: Obj }>(api(undefined, '', u, account.password))).user_info;
    };
    expect(await info('expired')).toMatchObject({ auth: 1, status: 'Expired', exp_date: String(DAY0_SEC - 3 * DAY_SEC) });
    expect(await info('banned')).toMatchObject({ auth: 1, status: 'Banned' });
    expect(await info('disabled')).toMatchObject({ auth: 1, status: 'Disabled' });
    expect(await info('trial')).toMatchObject({ status: 'Active', is_trial: '1', max_connections: '1' });
    expect(await info('forever')).toMatchObject({ status: 'Active', exp_date: null, max_connections: '4' });
    expect(await info('maxed')).toMatchObject({ status: 'Active', active_cons: '1', max_connections: '1' });
  });

  it.each(['expired', 'banned', 'disabled'])('gives a %s account no content', async (u) => {
    app = await mock();
    const password = `${u}-test`;
    expect(await json(api('get_live_streams', '', u, password))).toEqual([]);
    expect(await json(api('get_vod_categories', '', u, password))).toEqual([]);
  });

  it('needs credentials percent-encoded (an unencoded + is a space)', async () => {
    app = await mock();
    const user = 'special+user@zoma.test';
    const pass = 'p@ss/w0rd&?# é';
    expect(await json(api(undefined, '', user, pass))).toMatchObject({ user_info: { auth: 1, username: user, password: pass } });
    expect(await json(`/player_api.php?username=special+user@zoma.test&password=${encodeURIComponent(pass)}`)).toEqual({ user_info: { auth: 0 } });
  });

  it('accepts a form POST', async () => {
    app = await mock();
    const res = await app.inject({
      method: 'POST',
      url: '/player_api.php',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'username=zoma&password=zoma-test&action=get_live_categories',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toHaveLength(6);
  });

  it('uses the panel time zone from server.yaml', async () => {
    const fixture = loadServerFixture();
    app = await mock({ fixture: { ...fixture, server: { ...fixture.server, timezone: 'Asia/Dubai' } } });
    const body = await json<{ server_info: Obj }>(api());
    expect(body.server_info).toMatchObject({ timezone: 'Asia/Dubai', time_now: '2026-11-02 16:00:00', timestamp_now: NOW_SEC });
    const epg = await json<{ epg_listings: Obj[] }>(api('get_short_epg', '&stream_id=101&limit=1'));
    expect(epg.epg_listings[0]).toMatchObject({ start: '2026-11-02 16:00:00', start_timestamp: String(NOW_SEC) });
  });
});

describe('player_api.php catalog actions', () => {
  it('lists categories in the panel shape', async () => {
    app = await mock();
    const live = await json<Obj[]>(api('get_live_categories'));
    expect(live).toHaveLength(6);
    expect(live[1]).toEqual({ category_id: '2', category_name: 'اختبار - أخبار', parent_id: 0 });
    expect(await json<Obj[]>(api('get_vod_categories'))).toHaveLength(2);
    expect(await json<Obj[]>(api('get_series_categories'))).toEqual([{ category_id: '20', category_name: 'Test Series | مسلسلات تجريبية', parent_id: 0 }]);
  });

  it('lists live streams with archive, radio, adult and logo fields', async () => {
    app = await mock();
    const streams = await json<Obj[]>(api('get_live_streams'));
    expect(streams).toHaveLength(12);
    expect(streams[0]).toEqual({
      num: 1,
      name: 'Zoma Test 1 SMPTE',
      stream_type: 'live',
      stream_id: 101,
      stream_icon: 'http://tv-lab.local:8080/images/channel-101.png',
      epg_channel_id: 'zoma.test1',
      added: String(DAY0_SEC - 30 * DAY_SEC),
      is_adult: '0',
      category_id: '1',
      category_ids: [1],
      custom_sid: '',
      tv_archive: 1,
      direct_source: '',
      tv_archive_duration: 7,
    });
    const byId = new Map(streams.map((s) => [s['stream_id'], s]));
    expect(byId.get(104)).toMatchObject({ tv_archive: 0, tv_archive_duration: 0 });
    expect(byId.get(107)).toMatchObject({ epg_channel_id: null });
    expect(byId.get(108)).toMatchObject({ stream_type: 'radio_streams', stream_icon: '' });
    expect(byId.get(109)).toMatchObject({ is_adult: '1' });
  });

  it('filters streams by category_id', async () => {
    app = await mock();
    const ids = (await json<Obj[]>(api('get_live_streams', '&category_id=2'))).map((s) => s['stream_id']);
    expect(ids).toEqual([103, 104, 112]);
    expect(await json(api('get_live_streams', '&category_id=999'))).toEqual([]);
    expect((await json<Obj[]>(api('get_vod_streams', '&category_id=11'))).map((s) => s['stream_id'])).toEqual([205, 206]);
    expect((await json<Obj[]>(api('get_series', '&category_id=20'))).map((s) => s['series_id'])).toEqual([301, 302]);
  });

  it('lists VOD and returns VOD info', async () => {
    app = await mock();
    const vod = await json<Obj[]>(api('get_vod_streams'));
    expect(vod).toHaveLength(6);
    expect(vod[1]).toMatchObject({ stream_id: 202, name: 'Sintel', stream_type: 'movie', container_extension: 'mkv', rating: '7.4', rating_5based: 3.7 });
    const info = await json<{ info: Obj; movie_data: Obj }>(api('get_vod_info', '&vod_id=201'));
    expect(info.info).toMatchObject({ name: 'Big Buck Bunny', duration_secs: 596, duration: '00:09:56', genre: 'Animation' });
    expect(String(info.info['plot'])).toContain('CC BY 3.0');
    expect(info.movie_data).toMatchObject({ stream_id: 201, container_extension: 'mp4', category_id: '10' });
    expect(await json(api('get_vod_info', '&vod_id=999'))).toEqual([]);
  });

  it('lists series and returns seasons with episodes keyed by season', async () => {
    app = await mock();
    const series = await json<Obj[]>(api('get_series'));
    expect(series.map((s) => s['name'])).toEqual(['Zoma Test Series', 'مسلسل الاختبار']);
    const info = await json<{ seasons: Obj[]; info: Obj; episodes: Record<string, Obj[]> }>(api('get_series_info', '&series_id=301'));
    expect(info.seasons.map((s) => [s['season_number'], s['episode_count']])).toEqual([
      [1, 3],
      [2, 2],
    ]);
    expect(info.info).toMatchObject({ name: 'Zoma Test Series', series_id: 301 });
    expect(Object.keys(info.episodes)).toEqual(['1', '2']);
    expect(info.episodes['2']?.[0]).toMatchObject({ id: '3011', episode_num: 1, container_extension: 'mp4', season: 2 });
    expect(info.episodes['1']?.[0]?.['info']).toMatchObject({ duration_secs: 300, duration: '00:05:00' });
    const arabic = await json<{ seasons: Obj[] }>(api('get_series_info', '&series_id=302'));
    expect(arabic.seasons[0]).toMatchObject({ name: 'الموسم ١' });
    expect(await json(api('get_series_info', '&series_id=999'))).toEqual([]);
  });

  it('answers an unknown action with an empty list', async () => {
    app = await mock();
    expect(await json(api('get_everything'))).toEqual([]);
  });
});

describe('player_api.php EPG actions', () => {
  it('returns the short EPG from the current programme, base64 encoded', async () => {
    app = await mock();
    const { epg_listings: listings } = await json<{ epg_listings: Obj[] }>(api('get_short_epg', '&stream_id=101'));
    expect(listings).toHaveLength(4);
    const first = listings[0]!;
    expect(first).toMatchObject({
      epg_id: '101',
      channel_id: 'zoma.test1',
      start: '2026-11-02 12:00:00',
      end: '2026-11-02 13:00:00',
      start_timestamp: String(NOW_SEC),
      stop_timestamp: String(NOW_SEC + 3600),
    });
    expect(b64decode(first['title'])).toMatch(/\S+ \d+$/);
    expect(b64decode(first['description'])).toContain('Zoma Test 1 SMPTE');
    // Consecutive programmes.
    expect(listings[1]).toMatchObject({ start: '2026-11-02 13:00:00' });
    expect(await json<{ epg_listings: Obj[] }>(api('get_short_epg', '&stream_id=101&limit=2'))).toMatchObject({ epg_listings: [{}, {}] });
  });

  it('returns no listings for channels without EPG or unknown streams', async () => {
    app = await mock();
    expect(await json(api('get_short_epg', '&stream_id=107'))).toEqual({ epg_listings: [] });
    expect(await json(api('get_short_epg', '&stream_id=999'))).toEqual({ epg_listings: [] });
    expect(await json(api('get_simple_data_table', '&stream_id=999'))).toEqual({ epg_listings: [] });
  });

  it('returns the full table with now_playing and has_archive', async () => {
    app = await mock();
    const { epg_listings: rows } = await json<{ epg_listings: Obj[] }>(api('get_simple_data_table', '&stream_id=101'));
    // 7 archive days + 3 future days of 60-minute slots.
    expect(rows).toHaveLength(240);
    expect(rows.filter((r) => r['now_playing'] === 1)).toEqual([expect.objectContaining({ start_timestamp: String(NOW_SEC) })]);
    const archived = rows.filter((r) => r['has_archive'] === 1);
    expect(archived).toHaveLength(168);
    expect(archived.every((r) => Number(r['stop_timestamp']) <= NOW_SEC)).toBe(true);
    // No archive on channel 104: nothing is replayable.
    const noArchive = await json<{ epg_listings: Obj[] }>(api('get_simple_data_table', '&stream_id=104'));
    expect(noArchive.epg_listings.length).toBeGreaterThan(0);
    expect(noArchive.epg_listings.every((r) => r['has_archive'] === 0)).toBe(true);
  });
});
