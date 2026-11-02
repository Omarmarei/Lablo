import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TextResponse, TextTransport, XtreamDecodeContext, XtreamListItem } from './xtream';
import {
  XtreamClient,
  XtreamError,
  XtreamListParser,
  decodeCategory,
  decodeListItem,
  decodeLogin,
  decodeSeriesInfo,
  decodeShortEpg,
  decodeVodInfo,
  xId,
  xInt,
  xNumber,
  xtreamEpgProgrammes,
} from './xtream';
import { EPG_DEFAULT_LENGTH, EPG_FLAG_CUT, EPG_FLAG_STOP_GUESSED, EPG_MAX_LENGTH } from './epg-guide';

const account = { base: 'http://p.test:8080', username: 'zoma', password: 'zoma-test' };
const ctx: XtreamDecodeContext = { src: 'src1', account, categories: new Map([['3', 'Kids Test | أطفال']]) };
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const BOM = String.fromCharCode(0xfeff);

/** What the mock's `json-quirks` fault does: numbers ↔ numeric strings, null → "". */
function quirk(v: unknown): unknown {
  if (v === null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  if (Array.isArray(v)) return v.map(quirk);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, quirk(x)]));
  return v;
}

const LIVE = {
  num: 5,
  name: 'Zoma Kids Test',
  stream_type: 'live',
  stream_id: 105,
  stream_icon: 'http://p.test/images/channel-105.png',
  epg_channel_id: 'Zoma.Kids',
  added: '1761955200',
  is_adult: '0',
  category_id: '3',
  category_ids: [3],
  custom_sid: '',
  tv_archive: 1,
  direct_source: '',
  tv_archive_duration: 1,
};
const MOVIE = {
  num: 1,
  name: 'Big Buck Bunny',
  title: 'Big Buck Bunny',
  year: '2008',
  stream_type: 'movie',
  stream_id: 201,
  stream_icon: 'http://p.test/images/movie-201.png',
  rating: '7.5',
  rating_5based: 3.8,
  added: '1761955200',
  is_adult: '0',
  category_id: '10',
  container_extension: 'MKV',
};
const SERIES = { num: 1, name: 'Zoma Test Series', series_id: 301, cover: 'http://p.test/images/series-301.png', rating: '8', releaseDate: '2026-01-01', last_modified: '1761955200', category_id: '20' };

describe('tolerant values', () => {
  it('reads numbers and ids written either way', () => {
    expect([xNumber(7.5), xNumber(' 7.5 '), xNumber('7,5'), xNumber(''), xNumber(null), xNumber('7a')]).toEqual([7.5, 7.5, 7.5, null, null, null]);
    expect([xInt('12'), xInt(12), xInt('12.0'), xInt('12.5'), xInt(NaN)]).toEqual([12, 12, 12, null, null]);
    expect([xId(105), xId('105'), xId(' 105 '), xId(-1), xId(1.5), xId('a b'), xId('a:b'), xId(''), xId(null), xId('abc')]).toEqual([
      '105', '105', '105', null, null, null, null, null, null, 'abc',
    ]);
  });
});

describe('decodeListItem', () => {
  it('maps a live stream to a catalog item', () => {
    expect(decodeListItem('live', LIVE, ctx)).toEqual<XtreamListItem>({
      item: {
        key: 'x:src1:live:105',
        src: 'src1',
        kind: 'live',
        name: 'Zoma Kids Test',
        normName: 'zoma kids test',
        group: 'Kids Test | أطفال',
        url: 'http://p.test:8080/live/zoma/zoma-test/105.ts',
        logo: 'http://p.test/images/channel-105.png',
        epgId: 'Zoma.Kids',
        tvgName: null,
        matchName: 'zomakidstest',
        chno: 5,
        tvgShift: 0,
        catchup: { mode: 'xc', days: 1, source: null },
        radio: false,
        hints: null,
      },
      id: '105',
      categoryId: '3',
      added: 1761955200,
      adult: false,
      rating: null,
      year: null,
    });
  });

  it('maps movies and series', () => {
    const movie = decodeListItem('movie', MOVIE, ctx)!;
    expect(movie.item).toMatchObject({ key: 'x:src1:movie:201', kind: 'movie', url: 'http://p.test:8080/movie/zoma/zoma-test/201.mkv', group: '', matchName: null, catchup: null });
    expect(movie).toMatchObject({ rating: 7.5, year: 2008, added: 1761955200 });
    const series = decodeListItem('series', SERIES, ctx)!;
    expect(series.item).toMatchObject({ key: 'x:src1:series:301', kind: 'series', url: '', logo: 'http://p.test/images/series-301.png' });
    expect(series).toMatchObject({ rating: 8, year: 2026, added: 1761955200 });
  });

  it('gives identical items for the json-quirks variant (keys survive type flips)', () => {
    for (const [kind, v] of [['live', LIVE], ['movie', MOVIE], ['series', SERIES]] as const) {
      expect(decodeListItem(kind, quirk(v), ctx)).toEqual(decodeListItem(kind, v, ctx));
    }
  });

  it('reads radio, adult flags, odd ratings and missing fields', () => {
    const radio = decodeListItem('live', { ...LIVE, stream_type: 'radio_streams', is_adult: 1, tv_archive: '0', epg_channel_id: null, num: '' }, ctx)!;
    expect(radio.item).toMatchObject({ radio: true, catchup: null, epgId: null, chno: null });
    expect(radio.adult).toBe(true);
    expect(decodeListItem('movie', { stream_id: 1, rating: '0', rating_5based: '4.5' }, ctx)).toMatchObject({ rating: 9, item: { name: '', url: 'http://p.test:8080/movie/zoma/zoma-test/1.mp4' } });
    expect(decodeListItem('movie', { stream_id: 1, title: 'Only a title', container_extension: 'm p4' }, ctx)!.item).toMatchObject({ name: 'Only a title', url: 'http://p.test:8080/movie/zoma/zoma-test/1.mp4' });
  });

  it('skips items without a usable id', () => {
    for (const v of [{ ...LIVE, stream_id: null }, { ...LIVE, stream_id: 'a b' }, { ...LIVE, stream_id: -5 }, [LIVE], 'x', null]) {
      expect(decodeListItem('live', v, ctx)).toBeNull();
    }
  });
});

describe('XtreamListParser', () => {
  it('streams a list, counting bad JSON, unusable items and duplicate ids', () => {
    const text = `${BOM}[${JSON.stringify(LIVE)},{"stream_id":"x y"},{bad json},${JSON.stringify({ ...LIVE, name: 'Twin' })},${JSON.stringify({ ...LIVE, stream_id: 106 })}]`;
    const parser = new XtreamListParser('live', ctx);
    const items = [...parser.push(text.slice(0, 50)), ...parser.push(text.slice(50)), ...parser.end()];
    expect(items.map((i) => i.id)).toEqual(['105', '106']);
    expect(parser.stats()).toMatchObject({ items: 2, badJson: 1, skipped: 1, duplicates: 1, json: { shape: 'array', elements: 5, truncated: false } });
  });

  it('returns the same items however the response is chunked, quirky or not', () => {
    const arb = fc.array(fc.record({ stream_id: fc.nat({ max: 50 }), name: fc.string({ maxLength: 12 }), num: fc.nat(), tv_archive: fc.constantFrom(0, 1), epg_channel_id: fc.option(fc.string({ maxLength: 6 })) }), { maxLength: 15 });
    fc.assert(
      fc.property(arb, fc.boolean(), fc.array(fc.nat(), { maxLength: 8 }), (list, quirky, cuts) => {
        const text = JSON.stringify(quirky ? quirk(list) : list);
        const whole = new XtreamListParser('live', ctx);
        const expected = [...whole.push(text), ...whole.end()];
        const points = cuts.map((c) => c % (text.length + 1)).sort((a, b) => a - b);
        const chunked = new XtreamListParser('live', ctx);
        const got: XtreamListItem[] = [];
        let last = 0;
        for (const p of [...points, text.length]) {
          got.push(...chunked.push(text.slice(last, p)));
          last = p;
        }
        got.push(...chunked.end());
        expect(got).toEqual(expected);
        expect(new Set(got.map((i) => i.id)).size).toBe(got.length);
      }),
      { numRuns: 200 },
    );
  });
});

describe('decodeLogin', () => {
  const login = {
    user_info: { username: 'zoma', password: 'zoma-test', message: 'Welcome', auth: 1, status: 'Active', exp_date: '1793491200', is_trial: '0', active_cons: '0', created_at: '1761955200', max_connections: '2', allowed_output_formats: ['m3u8', 'ts'] },
    server_info: { url: 'p.test', port: '8080', https_port: '8443', server_protocol: 'http', rtmp_port: '8880', timezone: 'Asia/Kathmandu', timestamp_now: 1793620800, time_now: '2026-11-02 17:45:00', process: true },
  };

  it('reads user and server info, quirky or not', () => {
    const expected = {
      user: { auth: true, status: 'Active', expDate: 1793491200, isTrial: false, activeCons: 0, maxConnections: 2, createdAt: 1761955200, message: 'Welcome', outputFormats: ['m3u8', 'ts'] },
      server: { url: 'p.test', port: '8080', httpsPort: '8443', protocol: 'http', timezone: 'Asia/Kathmandu', timestampNow: 1793620800, timeNow: '2026-11-02 17:45:00' },
    };
    expect(decodeLogin(login)).toEqual(expected);
    expect(decodeLogin(quirk(login))).toEqual(expected);
  });

  it('reads refusals and odd shapes', () => {
    expect(decodeLogin({ user_info: { auth: 0 } })).toMatchObject({ user: { auth: false, status: '' }, server: null });
    expect(decodeLogin({ user_info: { status: 'Expired', exp_date: null } })).toMatchObject({ user: { auth: true, status: 'Expired', expDate: null } });
    expect(decodeLogin([])).toBeNull();
    expect(decodeLogin({ user_info: 'x' })).toBeNull();
  });
});

describe('details', () => {
  it('decodes categories', () => {
    expect(decodeCategory({ category_id: '3', category_name: ' Kids ', parent_id: 0 })).toEqual({ id: '3', name: 'Kids', parentId: null });
    expect(decodeCategory({ category_id: 7, category_name: 5, parent_id: '2' })).toEqual({ id: '7', name: '5', parentId: '2' });
    expect(decodeCategory({ category_name: 'no id' })).toBeNull();
  });

  it('decodes get_vod_info', () => {
    const info = { info: { name: 'Sintel', plot: 'A girl.', genre: 'Animation', duration: '00:14:48', rating: '7.4', cover_big: 'c.png', backdrop_path: ['b.png'], releasedate: '2010-01-01', youtube_trailer: '' }, movie_data: { stream_id: 202, container_extension: 'mkv' } };
    expect(decodeVodInfo(info)).toEqual({ name: 'Sintel', plot: 'A girl.', genre: 'Animation', cast: '', director: '', releaseDate: '2010-01-01', durationSecs: 888, rating: 7.4, cover: 'c.png', backdrops: ['b.png'], trailer: null, ext: 'mkv' });
    expect(decodeVodInfo(quirk(info))).toEqual(decodeVodInfo(info));
    expect(decodeVodInfo([])).toBeNull();
  });

  const episode = (id: number, season: number, num: number) => ({ id: String(id), episode_num: num, title: `E${num}`, container_extension: 'mp4', info: { duration_secs: 300, plot: 'p', movie_image: `i${id}.png` }, season, added: '1761955200' });
  const seriesInfo = {
    seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2, cover: 's1.png' }],
    info: { name: 'Zoma Test Series', plot: 'Ours.', rating: '8', cover: 'c.png', backdrop_path: ['b.png'] },
    episodes: { '2': [episode(3011, 2, 1)], '1': [episode(3002, 1, 2), episode(3001, 1, 1), episode(3001, 1, 1)] },
  };

  it('decodes get_series_info, sorting episodes and adding missing seasons', () => {
    const decoded = decodeSeriesInfo(seriesInfo, ctx)!;
    expect(decoded.episodes.map((e) => [e.key, e.season, e.episodeNum])).toEqual([
      ['x:src1:episode:3001', 1, 1],
      ['x:src1:episode:3002', 1, 2],
      ['x:src1:episode:3011', 2, 1],
    ]);
    expect(decoded.episodes[0]).toEqual({ key: 'x:src1:episode:3001', id: '3001', season: 1, episodeNum: 1, title: 'E1', url: 'http://p.test:8080/series/zoma/zoma-test/3001.mp4', durationSecs: 300, plot: 'p', image: 'i3001.png', added: 1761955200 });
    expect(decoded.seasons).toEqual([
      { number: 1, name: 'Season 1', cover: 's1.png', episodeCount: 2 },
      { number: 2, name: '', cover: null, episodeCount: null },
    ]);
    expect(decoded).toMatchObject({ name: 'Zoma Test Series', rating: 8, cover: 'c.png', backdrops: ['b.png'], skipped: 1 });
  });

  it('reads episodes as an array of arrays, a flat array or index-keyed objects', () => {
    const expected = decodeSeriesInfo(seriesInfo, ctx)!.episodes;
    const arrays = { ...seriesInfo, episodes: [[episode(3011, 2, 1)], [episode(3002, 1, 2), episode(3001, 1, 1)]] };
    const flat = { ...seriesInfo, episodes: [episode(3001, 1, 1), episode(3011, 2, 1), episode(3002, 1, 2)] };
    const keyed = { ...seriesInfo, episodes: { '1': { '0': episode(3001, 1, 1), '1': episode(3002, 1, 2) }, '2': { '0': episode(3011, 2, 1) } } };
    for (const v of [arrays, flat, keyed, quirk(arrays)]) expect(decodeSeriesInfo(v, ctx)!.episodes).toEqual(expected);
    // An episode without a season takes the season it is listed under.
    const { season: _s, ...noSeason } = episode(3021, 1, 1);
    expect(decodeSeriesInfo({ episodes: { '4': [noSeason] } }, ctx)!.episodes[0]!.season).toBe(4);
    expect(decodeSeriesInfo([], ctx)).toBeNull();
  });

  it('decodes the short EPG, base64 or plain', () => {
    const listing = { title: b64('نشرة الأخبار'), description: b64('Today & tomorrow'), start: '2026-11-02 17:45:00', end: '2026-11-02 18:15:00', start_timestamp: '1793620800', stop_timestamp: '1793622600' };
    expect(decodeShortEpg({ epg_listings: [listing, { ...listing, title: 'Plain title!', now_playing: 1, has_archive: '0' }, 'junk'] })).toEqual([
      { title: 'نشرة الأخبار', description: 'Today & tomorrow', startMs: 1793620800000, endMs: 1793622600000, start: '2026-11-02 17:45:00', end: '2026-11-02 18:15:00', nowPlaying: null, hasArchive: null },
      { title: 'Plain title!', description: 'Today & tomorrow', startMs: 1793620800000, endMs: 1793622600000, start: '2026-11-02 17:45:00', end: '2026-11-02 18:15:00', nowPlaying: true, hasArchive: false },
    ]);
    expect(decodeShortEpg({ epg_listings: [] })).toEqual([]);
    expect(decodeShortEpg([])).toEqual([]);
  });

  it('turns the short EPG into guide programmes in UTC minutes, in time order', () => {
    const at = 29_893_680; // 2026-11-02 18:00 UTC, in epoch minutes
    const entry = (start: number | null, end: number | null, title: string) => ({
      title,
      description: `${title} desc`,
      startMs: start === null ? null : start * 60_000,
      endMs: end === null ? null : end * 60_000,
      start: '',
      end: '',
      nowPlaying: null,
      hasArchive: null,
    });
    const row = (start: number, end: number, title: string, flags = 0) => ({ start, end, title, sub: '', desc: `${title} desc`, category: '', episode: '', flags });
    // Seconds are dropped the way the guide reader drops them.
    expect(xtreamEpgProgrammes([{ ...entry(at, at + 30, 'A'), startMs: at * 60_000 + 59_000, endMs: (at + 30) * 60_000 + 59_000 }])).toEqual([row(at, at + 30, 'A')]);
    expect(
      xtreamEpgProgrammes([
        entry(at + 60, at + 90, 'C'),
        entry(null, at + 30, 'no start'),
        entry(at, null, 'A'),
        entry(at + 30, at + 30, 'B'),
        entry(at, at + 15, 'A again'),
        entry(at + 90, null, 'D'),
      ]),
    ).toEqual([
      // No stop: the next start. A stop not after the start: the same. The last: an hour.
      row(at, at + 30, 'A', EPG_FLAG_STOP_GUESSED),
      row(at + 30, at + 60, 'B', EPG_FLAG_STOP_GUESSED),
      row(at + 60, at + 90, 'C'),
      row(at + 90, at + 90 + EPG_DEFAULT_LENGTH, 'D', EPG_FLAG_STOP_GUESSED),
    ]);
    // Cut at 24 h, and a guessed stop too.
    expect(xtreamEpgProgrammes([entry(at, at + 2 * EPG_MAX_LENGTH, 'long'), entry(at + 3 * EPG_MAX_LENGTH, null, 'gap'), entry(at + 5 * EPG_MAX_LENGTH, at + 5 * EPG_MAX_LENGTH + 30, 'last')])).toEqual([
      row(at, at + EPG_MAX_LENGTH, 'long', EPG_FLAG_CUT),
      row(at + 3 * EPG_MAX_LENGTH, at + 4 * EPG_MAX_LENGTH, 'gap', EPG_FLAG_STOP_GUESSED | EPG_FLAG_CUT),
      row(at + 5 * EPG_MAX_LENGTH, at + 5 * EPG_MAX_LENGTH + 30, 'last'),
    ]);
    // Decoded straight from a panel answer.
    const listing = { title: b64('News'), description: '', start_timestamp: String(at * 60), stop_timestamp: String((at + 45) * 60) };
    expect(xtreamEpgProgrammes(decodeShortEpg({ epg_listings: [listing, { title: 'No times' }] }))).toEqual([{ ...row(at, at + 45, 'News'), desc: '' }]);
    expect(xtreamEpgProgrammes([])).toEqual([]);
  });
});

/** A transport over canned responses, recording requests and cancellations. */
class FakeTransport implements TextTransport {
  readonly urls: string[] = [];
  cancelled = 0;
  constructor(private readonly answer: (url: string) => { status: number; chunks: string[] }) {}
  async get(url: string): Promise<TextResponse> {
    this.urls.push(url);
    const { status, chunks } = this.answer(url);
    let i = 0;
    return {
      status,
      read: async () => (i < chunks.length ? chunks[i++]! : null),
      cancel: () => {
        this.cancelled++;
      },
    };
  }
}

describe('XtreamClient', () => {
  const loginBody = JSON.stringify({
    user_info: { auth: 1, status: 'Active' },
    server_info: { timezone: 'Asia/Kathmandu', timestamp_now: 1793620800, time_now: '2026-11-02 17:45:00' },
  });

  it('logs in, then builds catch-up URLs in the panel zone', async () => {
    const t = new FakeTransport(() => ({ status: 200, chunks: [`${BOM}${loginBody.slice(0, 10)}`, loginBody.slice(10)] }));
    const client = new XtreamClient(account, t, 'src1');
    expect(client.zone().source).toBe('utc');
    await client.login();
    expect(client.zone()).toMatchObject({ source: 'intl', name: 'Asia/Kathmandu' });
    const start = Date.UTC(2026, 10, 2, 10, 30);
    expect(client.catchupUrl(101, { startMs: start, endMs: start + 1_800_000, nowMs: start + 3_600_000 })).toBe(
      'http://p.test:8080/timeshift/zoma/zoma-test/30/2026-11-02:16-15/101.ts',
    );
    expect(t.urls).toEqual(['http://p.test:8080/player_api.php?username=zoma&password=zoma-test']);
  });

  it('turns refusals and broken answers into coded errors without URLs or credentials', async () => {
    const cases: [{ status: number; chunks: string[] }, string, number | null][] = [
      [{ status: 200, chunks: ['{"user_info":{"auth":0}}'] }, 'auth', null],
      [{ status: 401, chunks: ['Unauthorized'] }, 'auth', 401],
      [{ status: 403, chunks: [] }, 'auth', 403],
      [{ status: 509, chunks: [] }, 'http', 509],
      [{ status: 200, chunks: ['<html>busy</html>'] }, 'format', null],
      [{ status: 200, chunks: ['[]'] }, 'format', null],
    ];
    for (const [answer, code, status] of cases) {
      const t = new FakeTransport(() => answer);
      const error = await new XtreamClient(account, t, 'src1').login().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(XtreamError);
      expect(error).toMatchObject({ code, status });
      expect(String((error as Error).message)).not.toMatch(/zoma|p\.test/);
    }
  });

  it('streams lists in batches, with category names and a category filter', async () => {
    const body = JSON.stringify([LIVE, { ...LIVE, stream_id: 106 }, { ...LIVE, stream_id: 107 }]);
    const t = new FakeTransport(() => ({ status: 200, chunks: [body.slice(0, 300), body.slice(300, 330), body.slice(330)] }));
    const client = new XtreamClient(account, t, 'src1');
    const batches: string[][] = [];
    const stats = await client.list('live', async (items) => {
      batches.push(items.map((i) => i.item.group + i.id));
    }, { categories: ctx.categories, categoryId: '3', liveExt: 'm3u8' });
    expect(batches.flat()).toEqual(['Kids Test | أطفال105', 'Kids Test | أطفال106', 'Kids Test | أطفال107']);
    expect(batches.length).toBeGreaterThan(1);
    expect(stats.items).toBe(3);
    expect(t.urls[0]).toBe('http://p.test:8080/player_api.php?username=zoma&password=zoma-test&action=get_live_streams&category_id=3');
  });

  it('cancels the response when the consumer throws', async () => {
    const body = JSON.stringify([LIVE, { ...LIVE, stream_id: 106 }]);
    const t = new FakeTransport(() => ({ status: 200, chunks: [body.slice(0, 280), body.slice(280)] }));
    const failure = new Error('disk full');
    await expect(new XtreamClient(account, t, 'src1').list('live', () => Promise.reject(failure))).rejects.toBe(failure);
    expect(t.cancelled).toBe(1);
  });

  it('fetches categories and details', async () => {
    const t = new FakeTransport((url) => {
      if (url.includes('get_series_categories')) return { status: 200, chunks: ['{"0":{"category_id":"20","category_name":"Series"},"1":{"category_name":"no id"}}'] };
      if (url.includes('get_short_epg')) return { status: 200, chunks: [JSON.stringify({ epg_listings: [{ title: b64('Now'), start_timestamp: '1' }] })] };
      if (url.includes('get_series_info')) return { status: 200, chunks: ['[]'] };
      return { status: 200, chunks: ['[]'] };
    });
    const client = new XtreamClient(account, t, 'src1');
    expect(await client.categories('series')).toEqual([{ id: '20', name: 'Series', parentId: null }]);
    expect((await client.shortEpg(101, 2))[0]).toMatchObject({ title: 'Now', startMs: 1000 });
    expect(await client.seriesInfo(999)).toBeNull();
    expect(await client.vodInfo(999)).toBeNull();
    expect(t.urls.slice(1)).toEqual([
      'http://p.test:8080/player_api.php?username=zoma&password=zoma-test&action=get_short_epg&stream_id=101&limit=2',
      'http://p.test:8080/player_api.php?username=zoma&password=zoma-test&action=get_series_info&series_id=999',
      'http://p.test:8080/player_api.php?username=zoma&password=zoma-test&action=get_vod_info&vod_id=999',
    ]);
  });
});
