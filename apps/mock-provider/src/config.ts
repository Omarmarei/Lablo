// Fixture model and loader. The fixtures are YAML (snake_case, like the Xtream wire format);
// this module validates them and turns them into the camelCase types the routes use.
// Test credentials live only in fixtures/server.yaml (CLAUDE.md legal guardrails).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { isValidTimeZone } from './time';

export const DEFAULT_FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

export const ACCOUNT_STATUSES = ['Active', 'Expired', 'Banned', 'Disabled'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface Account {
  username: string;
  password: string;
  status: AccountStatus;
  /** Days from today (UTC midnight) to the expiry date; `null` means no expiry. */
  expDays: number | null;
  createdDaysAgo: number;
  isTrial: boolean;
  maxConnections: number;
  /** Connections "from other devices", added to the streams this server holds open. */
  activeCons: number;
  /** HTTP status for a stream request once `max_connections` is reached. */
  overLimitStatus: number;
  /**
   * `allowed_output_formats` (`ts`, `m3u8`): a live stream in another format is refused with 403
   * (the mock's choice; real panels differ). Default: both.
   */
  outputFormats: string[];
  message: string;
}

export interface ServerSettings {
  /** IANA zone of the panel: `server_info.timezone`, short-EPG strings and timeshift starts. */
  timezone: string;
  httpsPort: number;
  rtmpPort: number;
  /** Days of EPG after "now" in XMLTV and the EPG actions. */
  epgFutureDays: number;
}

export interface ServerFixture {
  server: ServerSettings;
  accounts: Account[];
}

export const CATCHUP_MODES = ['xc', 'default', 'append', 'shift', 'flussonic'] as const;
export type CatchupMode = (typeof CATCHUP_MODES)[number];

/** Test-channel looks (media-plan.ts). `clock` is the default. */
export const LIVE_MEDIA_PROFILES = ['clock', 'bars', 'bilingual', 'hd', 'fhd', 'radio'] as const;
export type LiveMediaProfile = (typeof LIVE_MEDIA_PROFILES)[number];

/** The Blender open movies that `pnpm mock:open-movies` can fetch (open-movies.ts). */
export const OPEN_MOVIE_KEYS = ['big-buck-bunny', 'sintel', 'tears-of-steel', 'elephants-dream'] as const;
export type OpenMovieKey = (typeof OPEN_MOVIE_KEYS)[number];

/** VOD and episode media (media-plan.ts). `vod` is the default. */
export const FILE_MEDIA_PROFILES = ['vod', 'hevc-4k', 'multi-audio', ...OPEN_MOVIE_KEYS.map((k) => `open-movie:${k}` as const)] as const;
export type FileMediaProfile = (typeof FILE_MEDIA_PROFILES)[number];

export interface Category {
  id: number;
  name: string;
  parentId: number;
}

export interface LiveChannel {
  id: number;
  num: number;
  name: string;
  categoryId: number;
  /** `epg_channel_id` / `tvg-id`. */
  epgId: string | null;
  /** Channel id inside the XMLTV when it differs from `epgId` (exercises EPG matching). */
  xmltvId: string | null;
  logo: boolean;
  archiveDays: number;
  /** How the M3U advertises catch-up; Xtream always uses `/timeshift`. */
  catchup: CatchupMode | null;
  radio: boolean;
  adult: boolean;
  addedDaysAgo: number;
  media: LiveMediaProfile;
}

export interface Movie {
  id: number;
  num: number;
  name: string;
  categoryId: number;
  ext: string;
  year: number;
  durationSecs: number;
  rating: number;
  genre: string;
  plot: string;
  addedDaysAgo: number;
  media: FileMediaProfile;
}

export interface Episode {
  id: number;
  episodeNum: number;
  title: string;
  ext: string;
  durationSecs: number;
  plot: string;
  media: FileMediaProfile;
}

export interface Season {
  number: number;
  name: string;
  episodes: Episode[];
}

export interface Series {
  id: number;
  num: number;
  name: string;
  categoryId: number;
  year: number;
  rating: number;
  genre: string;
  plot: string;
  addedDaysAgo: number;
  seasons: Season[];
}

export interface Catalog {
  liveCategories: Category[];
  vodCategories: Category[];
  seriesCategories: Category[];
  live: LiveChannel[];
  movies: Movie[];
  series: Series[];
}

export class FixtureError extends Error {
  override name = 'FixtureError';
}

type Obj = Record<string, unknown>;

/** Small typed reader over one YAML mapping, with errors that name the offending field. */
export class Fields {
  constructor(
    readonly obj: Obj,
    readonly where: string,
  ) {}

  static of(value: unknown, where: string): Fields {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new FixtureError(`${where}: expected a mapping`);
    }
    return new Fields(value as Obj, where);
  }

  has(key: string): boolean {
    return this.obj[key] !== undefined && this.obj[key] !== null;
  }

  /** Rejects keys outside `keys`, so a typo in a fixture or scenario fails loudly. */
  only(keys: readonly string[]): this {
    const extra = Object.keys(this.obj).filter((k) => !keys.includes(k));
    if (extra.length > 0) throw new FixtureError(`${this.where}: unknown key(s) ${extra.join(', ')} (allowed: ${keys.join(', ')})`);
    return this;
  }

  private fail(key: string, expected: string): never {
    throw new FixtureError(`${this.where}.${key}: expected ${expected}, got ${JSON.stringify(this.obj[key])}`);
  }

  str(key: string, fallback?: string): string {
    const value = this.obj[key];
    if (value === undefined || value === null) {
      if (fallback !== undefined) return fallback;
      this.fail(key, 'a string');
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    this.fail(key, 'a string');
  }

  /** Accepts numbers and numeric strings (query-string overrides arrive as strings). */
  num(key: string, fallback?: number): number {
    const value = this.obj[key];
    if (value === undefined || value === null) {
      if (fallback !== undefined) return fallback;
      this.fail(key, 'a number');
    }
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isFinite(n)) this.fail(key, 'a number');
    return n;
  }

  int(key: string, fallback?: number, min = 0): number {
    const n = this.num(key, fallback);
    if (!Number.isInteger(n) || n < min) this.fail(key, `an integer >= ${min}`);
    return n;
  }

  optInt(key: string, min = 0): number | undefined {
    return this.has(key) ? this.int(key, undefined, min) : undefined;
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.obj[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    this.fail(key, 'a boolean');
  }

  oneOf<T extends string>(key: string, options: readonly T[], fallback?: T): T {
    const value = this.str(key, fallback);
    if (!(options as readonly string[]).includes(value)) this.fail(key, `one of ${options.join(', ')}`);
    return value as T;
  }

  list(key: string, optional = false): Fields[] {
    const value = this.obj[key];
    if ((value === undefined || value === null) && optional) return [];
    if (!Array.isArray(value)) this.fail(key, 'a list');
    return value.map((item, i) => Fields.of(item, `${this.where}.${key}[${i}]`));
  }

  /** A string or a list of strings, as a list. */
  strings(key: string): string[] | undefined {
    const value = this.obj[key];
    if (value === undefined || value === null) return undefined;
    const items = Array.isArray(value) ? value : [value];
    return items.map((item, i) => {
      if (typeof item !== 'string' && typeof item !== 'number') {
        throw new FixtureError(`${this.where}.${key}[${i}]: expected a string`);
      }
      return String(item);
    });
  }
}

export function readYaml(path: string): unknown {
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new FixtureError(`${path}: ${(error as Error).message}`);
  }
}

export function parseServerFixture(value: unknown, where = 'server.yaml'): ServerFixture {
  const root = Fields.of(value, where).only(['server', 'accounts']);
  const s = Fields.of(root.obj['server'] ?? {}, `${where}.server`).only(['timezone', 'https_port', 'rtmp_port', 'epg_future_days']);
  const timezone = s.str('timezone', 'UTC');
  if (!isValidTimeZone(timezone)) throw new FixtureError(`${where}.server.timezone: unknown time zone ${timezone}`);
  const server: ServerSettings = {
    timezone,
    httpsPort: s.int('https_port', 8443),
    rtmpPort: s.int('rtmp_port', 8880),
    epgFutureDays: s.int('epg_future_days', 3, 1),
  };
  const seen = new Set<string>();
  const accounts = root.list('accounts').map((a): Account => {
    a.only(ACCOUNT_KEYS);
    const username = a.str('username');
    if (username === '' || seen.has(username)) throw new FixtureError(`${a.where}.username: empty or duplicate`);
    seen.add(username);
    return {
      username,
      password: a.str('password'),
      status: a.oneOf('status', ACCOUNT_STATUSES, 'Active'),
      expDays: a.has('exp_days') ? a.int('exp_days', undefined, -100_000) : null,
      createdDaysAgo: a.int('created_days_ago', 400),
      isTrial: a.bool('is_trial', false),
      maxConnections: a.int('max_connections', 1, 1),
      activeCons: a.int('active_cons', 0),
      overLimitStatus: a.int('over_limit_status', 403, 400),
      outputFormats: a.strings('output_formats') ?? ['m3u8', 'ts'],
      message: a.str('message', ''),
    };
  });
  if (accounts.length === 0) throw new FixtureError(`${where}.accounts: at least one account is required`);
  return { server, accounts };
}

const ACCOUNT_KEYS = ['username', 'password', 'status', 'exp_days', 'created_days_ago', 'is_trial', 'max_connections', 'active_cons', 'over_limit_status', 'output_formats', 'message'];
const LIVE_KEYS = ['id', 'num', 'name', 'category', 'epg_id', 'xmltv_id', 'logo', 'archive_days', 'catchup', 'radio', 'adult', 'added_days_ago', 'media'];
const MOVIE_KEYS = ['id', 'num', 'name', 'category', 'ext', 'year', 'duration_secs', 'rating', 'genre', 'plot', 'added_days_ago', 'media'];
const SERIES_KEYS = ['id', 'num', 'name', 'category', 'year', 'rating', 'genre', 'plot', 'added_days_ago', 'seasons'];
const EPISODE_KEYS = ['id', 'episode_num', 'title', 'ext', 'duration_secs', 'plot', 'media'];

function categories(root: Fields, key: string): Category[] {
  return root.list(key).map((f) => {
    const c = f.only(['id', 'name', 'parent_id']);
    return { id: c.int('id', undefined, 1), name: c.str('name'), parentId: c.int('parent_id', 0) };
  });
}

export function parseCatalog(value: unknown, where = 'catalog.yaml'): Catalog {
  const root = Fields.of(value, where).only(['live_categories', 'vod_categories', 'series_categories', 'live', 'movies', 'series']);
  const liveCategories = categories(root, 'live_categories');
  const vodCategories = categories(root, 'vod_categories');
  const seriesCategories = categories(root, 'series_categories');
  const ids = new Set<number>();
  const uniqueId = (f: Fields): number => {
    const id = f.int('id', undefined, 1);
    if (ids.has(id)) throw new FixtureError(`${f.where}.id: duplicate id ${id} (stream, VOD and episode ids share one space)`);
    ids.add(id);
    return id;
  };
  const inCategory = (f: Fields, cats: Category[]): number => {
    const id = f.int('category');
    if (!cats.some((c) => c.id === id)) throw new FixtureError(`${f.where}.category: unknown category ${id}`);
    return id;
  };

  const live = root.list('live').map((c, i): LiveChannel => {
    c.only(LIVE_KEYS);
    const archiveDays = c.int('archive_days', 0);
    return {
      id: uniqueId(c),
      num: c.int('num', i + 1, 1),
      name: c.str('name'),
      categoryId: inCategory(c, liveCategories),
      epgId: c.has('epg_id') ? c.str('epg_id') : null,
      xmltvId: c.has('xmltv_id') ? c.str('xmltv_id') : null,
      logo: c.bool('logo', true),
      archiveDays,
      catchup: archiveDays > 0 ? c.oneOf('catchup', CATCHUP_MODES, 'xc') : null,
      radio: c.bool('radio', false),
      adult: c.bool('adult', false),
      addedDaysAgo: c.int('added_days_ago', 30),
      media: c.oneOf('media', LIVE_MEDIA_PROFILES, c.bool('radio', false) ? 'radio' : 'clock'),
    };
  });

  const movies = root.list('movies').map((m, i): Movie => ({
    id: uniqueId(m.only(MOVIE_KEYS)),
    num: m.int('num', i + 1, 1),
    name: m.str('name'),
    categoryId: inCategory(m, vodCategories),
    ext: m.str('ext', 'mp4'),
    year: m.int('year'),
    durationSecs: m.int('duration_secs', undefined, 1),
    rating: m.num('rating', 0),
    genre: m.str('genre', ''),
    plot: m.str('plot', ''),
    addedDaysAgo: m.int('added_days_ago', 10),
    media: m.oneOf('media', FILE_MEDIA_PROFILES, 'vod'),
  }));

  const series = root.list('series').map((s, i): Series => ({
    id: uniqueId(s.only(SERIES_KEYS)),
    num: s.int('num', i + 1, 1),
    name: s.str('name'),
    categoryId: inCategory(s, seriesCategories),
    year: s.int('year'),
    rating: s.num('rating', 0),
    genre: s.str('genre', ''),
    plot: s.str('plot', ''),
    addedDaysAgo: s.int('added_days_ago', 5),
    seasons: s.list('seasons').map((f) => {
      const season = f.only(['number', 'name', 'episodes']);
      const number = season.int('number', undefined, 1);
      return {
      number,
      name: season.str('name', `Season ${number}`),
      episodes: season.list('episodes').map((e, j) => ({
        id: uniqueId(e.only(EPISODE_KEYS)),
        episodeNum: e.int('episode_num', j + 1, 1),
        title: e.str('title'),
        ext: e.str('ext', 'mp4'),
        durationSecs: e.int('duration_secs', undefined, 1),
        plot: e.str('plot', ''),
        media: e.oneOf('media', FILE_MEDIA_PROFILES, 'vod'),
      })),
      };
    }),
  }));

  return { liveCategories, vodCategories, seriesCategories, live, movies, series };
}

export function loadServerFixture(dir = DEFAULT_FIXTURES_DIR): ServerFixture {
  const path = join(dir, 'server.yaml');
  return parseServerFixture(readYaml(path), path);
}

export function loadCatalog(dir = DEFAULT_FIXTURES_DIR): Catalog {
  return loadCatalogFile(join(dir, 'catalog.yaml'));
}

/**
 * A catalog file: YAML, or JSON with the same snake_case shape. JSON is the fast path for the
 * 200k-item scale catalogs from `pnpm fixtures` (YAML parsing is far too slow at that size).
 */
export function loadCatalogFile(path: string): Catalog {
  if (!path.toLowerCase().endsWith('.json')) return parseCatalog(readYaml(path), path);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new FixtureError(`${path}: ${(error as Error).message}`);
  }
  return parseCatalog(value, path);
}
