/**
 * Catch-up (archive) URLs (architecture.md §1.5, PLAN.md §4; ADR-010): Xtream `/timeshift/` and
 * the M3U modes `default`, `append`, `shift`, `flussonic` and `xc`, as Kodi's IPTV Simple and
 * TiviMate read them.
 *
 * The URLs hold credentials: never log them.
 */

import type { CatchupInfo } from './model';
import type { ZoneOffset } from './timezone';
import { UTC_ZONE, pad2, wallParts } from './timezone';
import type { XtreamAccount } from './xtream-url';
import { parseXtreamStreamUrl } from './xtream-url';

/** The programme to play back, and the current time. All epoch milliseconds. */
export interface CatchupWindow {
  startMs: number;
  endMs: number;
  nowMs: number;
}

/** The URL shape a catch-up channel uses, after reading its `catchup` attributes. */
export type CatchupMode = 'default' | 'append' | 'shift' | 'flussonic' | 'flussonic-hls' | 'flussonic-ts' | 'xc';

/** Flussonic archive URL forms: an HLS playlist, an endless TS from the start, or a bounded TS file. */
export type FlussonicForm = 'hls' | 'ts' | 'archive';

export interface CatchupOptions {
  /**
   * Wall-clock zone for `xc` start times and the `{Y}{m}{d}{H}{M}{S}` placeholders. Default UTC;
   * pass the panel's zone (`panelZone`) once the source is known to be Xtream.
   */
  zone?: ZoneOffset;
  /** Forces a Flussonic form; otherwise HLS for `.m3u8` streams and `timeshift_abs` TS for the rest. */
  flussonic?: FlussonicForm;
}

const MINUTE = 60_000;
const enc = encodeURIComponent;

function isAbsolute(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

/**
 * Reads a catch-up mode the way players do (ADR-010):
 * - `default`/`vod` need a `catchup-source` (a relative one is appended, like `append`);
 *   `append` with an absolute source is used as is;
 * - `shift`/`timeshift`, `flussonic`/`flussonic-hls`/`flussonic-ts`/`fs`, `xc`/`xtream`;
 * - no mode (just archive days), or `default`/`append` without a source: the source's own form
 *   when there is one, else `xc` for an Xtream-shaped live URL, else `shift`;
 * - anything else: `null` (not playable as catch-up).
 */
export function catchupMode(info: CatchupInfo, streamUrl: string): CatchupMode | null {
  const source = info.source;
  switch (info.mode) {
    case 'shift':
    case 'timeshift':
      return 'shift';
    case 'flussonic':
    case 'flussonic-hls':
      return info.mode;
    case 'flussonic-ts':
    case 'fs':
      return 'flussonic-ts';
    case 'xc':
    case 'xtream':
      return 'xc';
    case null:
    case 'default':
    case 'vod':
    case 'append':
      if (source !== null) return isAbsolute(source) ? 'default' : 'append';
      return parseXtreamStreamUrl(streamUrl)?.kind === 'live' ? 'xc' : 'shift';
    default:
      return null;
  }
}

const SECONDS_NAMES: Record<string, 'start' | 'end' | 'now'> = {
  utc: 'start',
  start: 'start',
  utcend: 'end',
  end: 'end',
  lutc: 'now',
  now: 'now',
  timestamp: 'now',
};
const PART_NAMES = ['Y', 'm', 'd', 'H', 'M', 'S'];

function formatTime(epochMs: number, format: string, zone: ZoneOffset): string {
  const p = wallParts(epochMs, zone);
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format.charAt(i);
    if (c === 'Y') out += String(p.year);
    else if (c === 'm') out += pad2(p.month);
    else if (c === 'd') out += pad2(p.day);
    else if (c === 'H') out += pad2(p.hour);
    else if (c === 'M') out += pad2(p.minute);
    else if (c === 'S') out += pad2(p.second);
    else out += c;
  }
  return out;
}

/**
 * Fills a `catchup-source` template. Placeholders (Kodi IPTV Simple names; unknown ones stay):
 * - `{utc}` `${start}`: start, epoch seconds; `{utcend}` `${end}`: end; `{lutc}` `${now}`
 *   `${timestamp}`: now. With a format, `{utc:Y-m-d H:M:S}`, the time is written with
 *   `Y m d H M S` in the option zone.
 * - `{duration}` `${duration}`: length in seconds; `{duration:60}`: divided by 60 (minutes).
 * - `{offset}` `${offset}`: seconds from start to now; `{offset:60}` likewise divided.
 * - `{Y}` `{m}` `{d}` `{H}` `{M}` `{S}`: the start's date parts in the option zone.
 */
export function fillCatchupTemplate(template: string, window: CatchupWindow, zone: ZoneOffset = UTC_ZONE): string {
  const start = Math.floor(window.startMs / 1000);
  const end = Math.floor(window.endMs / 1000);
  const now = Math.floor(window.nowMs / 1000);
  const seconds = { start, end, now };
  const ms = { start: window.startMs, end: window.endMs, now: window.nowMs };
  return template.replace(/\$?\{([A-Za-z]+)(?::([^{}]*))?\}/g, (whole, name: string, arg: string | undefined) => {
    const which = SECONDS_NAMES[name];
    if (which !== undefined) return arg === undefined ? String(seconds[which]) : formatTime(ms[which], arg, zone);
    if (name === 'duration' || name === 'offset') {
      const value = name === 'duration' ? end - start : now - start;
      const divisor = arg === undefined ? 1 : Number(arg);
      return divisor > 0 && isFinite(divisor) ? String(Math.floor(value / divisor)) : whole;
    }
    if (arg === undefined && PART_NAMES.indexOf(name) !== -1) return formatTime(window.startMs, name, zone);
    return whole;
  });
}

/**
 * Xtream catch-up: `{base}/timeshift/{u}/{p}/{minutes}/{YYYY-MM-DD:HH-MM}/{id}.{ext}`. The start
 * is cut to the minute and written as wall time in the panel's zone; the length is rounded up
 * to whole minutes so the programme's end is covered.
 */
export function xtreamCatchupUrl(account: XtreamAccount, streamId: string | number, window: CatchupWindow, zone: ZoneOffset, ext = 'ts'): string {
  const startMs = Math.floor(window.startMs / MINUTE) * MINUTE;
  const minutes = Math.max(1, Math.ceil((window.endMs - startMs) / MINUTE));
  const stamp = formatTime(startMs, 'Y-m-d:H-M', zone);
  return `${account.base}/timeshift/${enc(account.username)}/${enc(account.password)}/${minutes}/${stamp}/${enc(String(streamId))}.${ext}`;
}

/** Splits off `?query#fragment` (kept as written). */
function splitQuery(url: string): { path: string; rest: string } {
  const at = url.search(/[?#]/);
  return at === -1 ? { path: url, rest: '' } : { path: url.slice(0, at), rest: url.slice(at) };
}

/**
 * Flussonic archive URL from a live URL such as `…/channel/index.m3u8`, `…/channel/video.m3u8`
 * or `…/channel/mpegts` (any query, e.g. a token, is kept):
 * - `hls`: `…/channel/{name}-{start}-{duration}.m3u8` (`name` from the live playlist, else `index`)
 * - `ts`: `…/channel/timeshift_abs-{start}.ts` (plays on from the start, into live)
 * - `archive`: `…/channel/archive-{start}-{duration}.ts` (just the programme)
 */
export function flussonicCatchupUrl(streamUrl: string, window: CatchupWindow, form?: FlussonicForm): string | null {
  const { path, rest } = splitQuery(streamUrl);
  if (!isAbsolute(path)) return null;
  const authorityEnd = path.indexOf('/', path.indexOf('://') + 3);
  if (authorityEnd === -1) return null;
  const slash = path.lastIndexOf('/');
  const file = path.slice(slash + 1);
  let dir = path.slice(0, slash);
  let name = 'index';
  let hls = false;
  const m3u8 = /^(.+)\.m3u8$/i.exec(file);
  if (m3u8) {
    hls = true;
    name = m3u8[1]!;
  } else if (!/^mpegts$|\.ts$/i.test(file) && file.length > 0) {
    // `…/channel` with no file: the last segment is the channel itself.
    dir = path;
  }
  // The channel directory must be below the host (`http://host/mpegts` has none).
  if (dir.length <= authorityEnd) return null;
  const start = Math.floor(window.startMs / 1000);
  const duration = Math.max(1, Math.floor(window.endMs / 1000) - start);
  switch (form ?? (hls ? 'hls' : 'ts')) {
    case 'hls':
      return `${dir}/${name}-${start}-${duration}.m3u8${rest}`;
    case 'archive':
      return `${dir}/archive-${start}-${duration}.ts${rest}`;
    default:
      return `${dir}/timeshift_abs-${start}.ts${rest}`;
  }
}

/**
 * The catch-up URL of an M3U channel for a programme, or `null` when the channel has no usable
 * catch-up (no attributes, an unknown mode, or a URL the mode can't rewrite).
 */
export function m3uCatchupUrl(streamUrl: string, info: CatchupInfo | null, window: CatchupWindow, options: CatchupOptions = {}): string | null {
  if (info === null) return null;
  const mode = catchupMode(info, streamUrl);
  const zone = options.zone ?? UTC_ZONE;
  switch (mode) {
    case 'default':
      return fillCatchupTemplate(info.source!, window, zone);
    case 'append': {
      let tail = fillCatchupTemplate(info.source!, window, zone);
      const hasQuery = streamUrl.indexOf('?') !== -1;
      if (hasQuery && tail.charAt(0) === '?') tail = `&${tail.slice(1)}`;
      else if (!hasQuery && tail.charAt(0) === '&') tail = `?${tail.slice(1)}`;
      return streamUrl + tail;
    }
    case 'shift': {
      const sep = streamUrl.indexOf('?') === -1 ? '?' : '&';
      return `${streamUrl}${sep}utc=${Math.floor(window.startMs / 1000)}&lutc=${Math.floor(window.nowMs / 1000)}`;
    }
    case 'flussonic':
      return flussonicCatchupUrl(streamUrl, window, options.flussonic);
    case 'flussonic-hls':
      return flussonicCatchupUrl(streamUrl, window, options.flussonic ?? 'hls');
    case 'flussonic-ts':
      return flussonicCatchupUrl(streamUrl, window, options.flussonic ?? 'ts');
    case 'xc': {
      const parts = parseXtreamStreamUrl(streamUrl);
      if (!parts || parts.kind !== 'live') return null;
      return xtreamCatchupUrl(parts, parts.id, window, zone, parts.ext === 'm3u8' ? 'm3u8' : 'ts');
    }
    default:
      return null;
  }
}
