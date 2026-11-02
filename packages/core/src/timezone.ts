/**
 * Wall-clock offsets for a provider's time zone, without depending on full `Intl` time-zone
 * support (ADR-010). Xtream catch-up URLs take the programme start as wall time in the panel's
 * zone (`server_info.timezone`), and old TV engines may lack the IANA data to compute it.
 *
 * Order of trust, best first:
 * 1. `Intl.DateTimeFormat` with the panel's IANA zone, when this engine supports it AND it agrees
 *    with the panel's own clock right now (it gets DST right for past programmes);
 * 2. the panel's clock: `server_info.time_now` (wall time) minus `timestamp_now` (UTC), rounded
 *    to 15 minutes: a fixed offset, wrong only across a DST change inside the archive window;
 * 3. UTC.
 */

/** Minutes east of UTC at an instant (Asia/Kathmandu: 345). */
export type ZoneOffset = (epochMs: number) => number;

export type ZoneSource = 'intl' | 'clock' | 'utc';

export interface PanelZone {
  offset: ZoneOffset;
  source: ZoneSource;
  /** The IANA name the panel reported, if any. */
  name: string | null;
}

const MINUTE = 60_000;
/** Real offsets lie within ±14 h (Kiribati +14, Baker Island -12). */
const MAX_OFFSET = 14 * 60;

export function fixedZone(minutes: number): ZoneOffset {
  return () => minutes;
}

export const UTC_ZONE: ZoneOffset = fixedZone(0);

const intlCache = new Map<string, ZoneOffset | null>();

/**
 * The offset function for an IANA zone through `Intl`, or `null` when this engine can't do it
 * (no time-zone data, an unknown name, or output it can't read). Only `format()` is used:
 * `formatToParts` and `hourCycle` are missing on Chromium 53.
 */
export function intlZone(name: string): ZoneOffset | null {
  const cached = intlCache.get(name);
  if (cached !== undefined) return cached;
  let zone: ZoneOffset | null = null;
  try {
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    const offset = (epochMs: number): number => {
      const whole = Math.floor(epochMs / 1000) * 1000;
      // en-US numeric: "11/2/2026, 17:45:00". Some engines write midnight as "24:00:00".
      const m = /(\d+)\D+(\d+)\D+(\d+)\D+(\d+)\D+(\d+)\D+(\d+)/.exec(format.format(new Date(whole)));
      if (!m) return NaN;
      const [mo, d, y, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
      return Math.round((Date.UTC(y, mo - 1, d, h === 24 ? 0 : h, mi, s) - whole) / MINUTE);
    };
    // Known answer: a fixed instant must give a sane offset, or this engine can't be trusted.
    const probe = offset(Date.UTC(2026, 0, 15, 12, 0, 0));
    if (isFinite(probe) && Math.abs(probe) <= MAX_OFFSET) zone = (epochMs) => {
      const minutes = offset(epochMs);
      return isFinite(minutes) && Math.abs(minutes) <= MAX_OFFSET ? minutes : probe;
    };
  } catch {
    zone = null;
  }
  intlCache.set(name, zone);
  return zone;
}

/**
 * The panel's clock offset from `server_info`: `time_now` (`YYYY-MM-DD HH:MM:SS`, wall time)
 * minus `timestamp_now` (epoch seconds), rounded to 15 minutes. `null` when either is missing
 * or the result is not a real offset.
 */
export function clockOffset(timeNow: string | null, timestampNowSec: number | null): number | null {
  if (timeNow === null || timestampNowSec === null || !isFinite(timestampNowSec)) return null;
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timeNow);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const minutes = Math.round((wall - timestampNowSec * 1000) / MINUTE / 15) * 15;
  return Math.abs(minutes) <= MAX_OFFSET ? minutes : null;
}

/** What `panelZone` needs from `server_info` (see `XtreamServerInfo`). */
export interface PanelClock {
  timezone: string | null;
  timeNow: string | null;
  timestampNow: number | null;
}

/** The best offset function for a panel (see the order of trust at the top of this file). */
export function panelZone(server: PanelClock | null): PanelZone {
  const name = server && server.timezone ? server.timezone : null;
  const clock = server ? clockOffset(server.timeNow, server.timestampNow) : null;
  const intl = name === null ? null : intlZone(name);
  if (intl !== null) {
    // The panel's clock is the truth for "now"; Intl adds DST history when it agrees with it.
    const nowSec = server ? server.timestampNow : null;
    if (clock === null || nowSec === null || intl(nowSec * 1000) === clock) return { offset: intl, source: 'intl', name };
  }
  if (clock !== null) return { offset: fixedZone(clock), source: 'clock', name };
  return { offset: UTC_ZONE, source: 'utc', name };
}

/** Wall-clock parts of an instant at an offset function. */
export function wallParts(epochMs: number, zone: ZoneOffset): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const d = new Date(epochMs + zone(epochMs) * MINUTE);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
