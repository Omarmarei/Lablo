// Xtream Codes `player_api.php`. Field names and types follow what common panels send: ids as
// numbers in stream lists, most other numbers as strings, `user_info` numbers as strings. The
// `json-quirks` fault flips those types to test a tolerant client.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Account, Category, LiveChannel, Movie, Series } from './config';
import { epgWindow, hasArchive, programmes, upcoming } from './epg';
import type { Programme } from './epg';
import type { MockState } from './state';
import { dayOffsetSec, findAccount, imageUrl, requestParams, requestTz } from './state';
import { formatDuration, formatSqlTime } from './time';

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

export function userInfo(state: MockState, account: Account): Record<string, unknown> {
  return {
    username: account.username,
    password: account.password,
    message: account.message,
    auth: 1,
    status: account.status,
    exp_date: account.expDays === null ? null : String(dayOffsetSec(state, account.expDays)),
    is_trial: account.isTrial ? '1' : '0',
    active_cons: String(account.activeCons + state.connections.count(account.username)),
    created_at: String(dayOffsetSec(state, -account.createdDaysAgo)),
    max_connections: String(account.maxConnections),
    allowed_output_formats: ['m3u8', 'ts'],
  };
}

export function serverInfo(state: MockState, request: FastifyRequest): Record<string, unknown> {
  const tz = requestTz(state, request);
  const now = state.now();
  return {
    url: request.hostname || '127.0.0.1',
    port: String(request.port ?? 80),
    https_port: String(state.fixture.server.httpsPort),
    server_protocol: 'http',
    rtmp_port: String(state.fixture.server.rtmpPort),
    timezone: tz,
    timestamp_now: Math.floor(now / 1000),
    time_now: formatSqlTime(now, tz),
    process: true,
  };
}

function category(c: Category): Record<string, unknown> {
  return { category_id: String(c.id), category_name: c.name, parent_id: c.parentId };
}

function byCategory<T extends { categoryId: number }>(items: T[], categoryId: string | undefined): T[] {
  return categoryId === undefined || categoryId === '' ? items : items.filter((i) => String(i.categoryId) === categoryId);
}

function liveStream(state: MockState, request: FastifyRequest, c: LiveChannel): Record<string, unknown> {
  return {
    num: c.num,
    name: c.name,
    stream_type: c.radio ? 'radio_streams' : 'live',
    stream_id: c.id,
    stream_icon: c.logo ? imageUrl(request, `channel-${c.id}`) : '',
    epg_channel_id: c.epgId,
    added: String(dayOffsetSec(state, -c.addedDaysAgo)),
    is_adult: c.adult ? '1' : '0',
    category_id: String(c.categoryId),
    category_ids: [c.categoryId],
    custom_sid: '',
    tv_archive: c.archiveDays > 0 ? 1 : 0,
    direct_source: '',
    tv_archive_duration: c.archiveDays,
  };
}

function vodStream(state: MockState, request: FastifyRequest, m: Movie): Record<string, unknown> {
  return {
    num: m.num,
    name: m.name,
    title: m.name,
    year: String(m.year),
    stream_type: 'movie',
    stream_id: m.id,
    stream_icon: imageUrl(request, `movie-${m.id}`),
    rating: String(m.rating),
    rating_5based: Math.round((m.rating / 2) * 10) / 10,
    added: String(dayOffsetSec(state, -m.addedDaysAgo)),
    is_adult: '0',
    category_id: String(m.categoryId),
    category_ids: [m.categoryId],
    container_extension: m.ext,
    custom_sid: '',
    direct_source: '',
  };
}

function vodInfo(state: MockState, request: FastifyRequest, m: Movie): Record<string, unknown> {
  const poster = imageUrl(request, `movie-${m.id}`);
  return {
    info: {
      kinopoisk_url: '',
      tmdb_id: '',
      name: m.name,
      o_name: m.name,
      cover_big: poster,
      movie_image: poster,
      release_date: `${m.year}-01-01`,
      releasedate: `${m.year}-01-01`,
      episode_run_time: String(Math.round(m.durationSecs / 60)),
      youtube_trailer: '',
      director: '',
      actors: '',
      cast: '',
      description: m.plot,
      plot: m.plot,
      age: '',
      country: '',
      genre: m.genre,
      backdrop_path: [poster],
      duration_secs: m.durationSecs,
      duration: formatDuration(m.durationSecs),
      video: {},
      audio: {},
      bitrate: 0,
      rating: String(m.rating),
    },
    movie_data: {
      stream_id: m.id,
      name: m.name,
      title: m.name,
      year: String(m.year),
      added: String(dayOffsetSec(state, -m.addedDaysAgo)),
      category_id: String(m.categoryId),
      category_ids: [m.categoryId],
      container_extension: m.ext,
      custom_sid: '',
      direct_source: '',
    },
  };
}

function seriesItem(state: MockState, request: FastifyRequest, s: Series): Record<string, unknown> {
  const cover = imageUrl(request, `series-${s.id}`);
  const runtime = s.seasons[0]?.episodes[0]?.durationSecs ?? 0;
  return {
    num: s.num,
    name: s.name,
    title: s.name,
    year: String(s.year),
    stream_type: 'series',
    series_id: s.id,
    cover,
    plot: s.plot,
    cast: '',
    director: '',
    genre: s.genre,
    release_date: `${s.year}-01-01`,
    releaseDate: `${s.year}-01-01`,
    last_modified: String(dayOffsetSec(state, -s.addedDaysAgo)),
    rating: String(s.rating),
    rating_5based: Math.round((s.rating / 2) * 10) / 10,
    backdrop_path: [cover],
    youtube_trailer: '',
    episode_run_time: String(Math.round(runtime / 60)),
    category_id: String(s.categoryId),
    category_ids: [s.categoryId],
  };
}

function seriesInfo(state: MockState, request: FastifyRequest, s: Series): Record<string, unknown> {
  const { num: _num, ...info } = seriesItem(state, request, s);
  const added = String(dayOffsetSec(state, -s.addedDaysAgo));
  return {
    seasons: s.seasons.map((season) => ({
      air_date: `${s.year}-01-01`,
      episode_count: season.episodes.length,
      id: season.number,
      name: season.name,
      overview: '',
      season_number: season.number,
      vote_average: 0,
      cover: info['cover'],
      cover_big: info['cover'],
    })),
    info,
    episodes: Object.fromEntries(
      s.seasons.map((season) => [
        String(season.number),
        season.episodes.map((e) => ({
          id: String(e.id),
          episode_num: e.episodeNum,
          title: e.title,
          container_extension: e.ext,
          info: {
            duration_secs: e.durationSecs,
            duration: formatDuration(e.durationSecs),
            movie_image: imageUrl(request, `episode-${e.id}`),
            plot: e.plot,
            release_date: `${s.year}-01-01`,
            rating: 0,
            season: season.number,
            tmdb_id: 0,
          },
          custom_sid: '',
          added,
          season: season.number,
          direct_source: '',
        })),
      ]),
    ),
  };
}

function listing(tz: string, channel: LiveChannel, p: Programme): Record<string, unknown> {
  return {
    id: `${channel.id}${p.index}`,
    epg_id: String(channel.id),
    title: b64(p.title),
    lang: p.lang,
    start: formatSqlTime(p.start, tz),
    end: formatSqlTime(p.stop, tz),
    description: b64(p.description),
    channel_id: channel.epgId,
    start_timestamp: String(p.start / 1000),
    stop_timestamp: String(p.stop / 1000),
  };
}

function findLive(state: MockState, id: string | undefined): LiveChannel | undefined {
  return state.catalog.live.find((c) => String(c.id) === id);
}

export function registerXtream(app: FastifyInstance, state: MockState): void {
  const handler = async (request: FastifyRequest): Promise<unknown> => {
    const p = requestParams(request);
    const account = findAccount(state, p['username'], p['password']);
    if (!account) return { user_info: { auth: 0 } };
    const action = p['action'];
    if (action === undefined || action === '') {
      return { user_info: userInfo(state, account), server_info: serverInfo(state, request) };
    }
    // Expired, banned and disabled accounts still authenticate, but get no content.
    if (account.status !== 'Active') return [];

    const { catalog } = state;
    const tz = requestTz(state, request);
    const now = state.now();
    switch (action) {
      case 'get_live_categories':
        return catalog.liveCategories.map(category);
      case 'get_vod_categories':
        return catalog.vodCategories.map(category);
      case 'get_series_categories':
        return catalog.seriesCategories.map(category);
      case 'get_live_streams':
        return byCategory(catalog.live, p['category_id']).map((c) => liveStream(state, request, c));
      case 'get_vod_streams':
        return byCategory(catalog.movies, p['category_id']).map((m) => vodStream(state, request, m));
      case 'get_series':
        return byCategory(catalog.series, p['category_id']).map((s) => seriesItem(state, request, s));
      case 'get_vod_info': {
        const movie = catalog.movies.find((m) => String(m.id) === p['vod_id']);
        return movie ? vodInfo(state, request, movie) : [];
      }
      case 'get_series_info': {
        const series = catalog.series.find((s) => String(s.id) === p['series_id']);
        return series ? seriesInfo(state, request, series) : [];
      }
      case 'get_short_epg': {
        const channel = findLive(state, p['stream_id']);
        const limit = Math.max(1, Math.min(50, Number(p['limit'] ?? 4) || 4));
        return { epg_listings: channel ? upcoming(channel, now, limit).map((prog) => listing(tz, channel, prog)) : [] };
      }
      case 'get_simple_data_table': {
        const channel = findLive(state, p['stream_id']);
        if (!channel) return { epg_listings: [] };
        const { from, to } = epgWindow(channel, now, state.fixture.server.epgFutureDays);
        return {
          epg_listings: programmes(channel, from, to).map((prog) => ({
            ...listing(tz, channel, prog),
            now_playing: prog.start <= now && now < prog.stop ? 1 : 0,
            has_archive: hasArchive(channel, prog, now) ? 1 : 0,
          })),
        };
      }
      default:
        return [];
    }
  };
  app.get('/player_api.php', handler);
  app.post('/player_api.php', handler);
}
