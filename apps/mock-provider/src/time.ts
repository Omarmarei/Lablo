// Time-zone helpers built on Intl (Node ships full ICU), so the mock can act like a panel
// in any zone: short-EPG strings, XMLTV offsets and timeshift start times are all local.

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Minutes east of UTC at that instant (Asia/Kathmandu = 345). */
  offsetMinutes: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(timeZone: string): Intl.DateTimeFormat {
  let fmt = formats.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    format(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000;
  const values: Record<string, number> = {};
  for (const part of format(timeZone).formatToParts(new Date(wholeSecond))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const p = (k: string): number => values[k] ?? 0;
  const asUtc = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
  return {
    year: p('year'),
    month: p('month'),
    day: p('day'),
    hour: p('hour'),
    minute: p('minute'),
    second: p('second'),
    offsetMinutes: Math.round((asUtc - wholeSecond) / 60_000),
  };
}

/** The instant at which the wall clock in `timeZone` shows the given time. */
export function zonedToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = zonedParts(guess, timeZone).offsetMinutes;
  let epoch = guess - first * 60_000;
  const second_ = zonedParts(epoch, timeZone).offsetMinutes;
  if (second_ !== first) epoch = guess - second_ * 60_000;
  return epoch;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD HH:MM:SS` in the zone: Xtream `time_now` and short-EPG `start`/`end`. */
export function formatSqlTime(epochMs: number, timeZone: string): string {
  const p = zonedParts(epochMs, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export const XMLTV_OFFSET_STYLES = ['utc', 'local', 'none', 'colon'] as const;
export type XmltvOffsetStyle = (typeof XMLTV_OFFSET_STYLES)[number];

function offsetText(minutes: number, colon: boolean): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${colon ? ':' : ''}${pad(abs % 60)}`;
}

/**
 * XMLTV `start`/`stop` value.
 * - `utc`: `20261102120000 +0000` (the common case)
 * - `local`: wall time in the zone plus its offset, e.g. `20261102174500 +0545`
 * - `none`: wall time in the zone with no offset at all (the reader must guess)
 * - `colon`: wall time plus `+05:45` (not valid XMLTV, but seen in the wild)
 */
export function formatXmltvTime(epochMs: number, timeZone: string, style: XmltvOffsetStyle): string {
  const p = zonedParts(epochMs, style === 'utc' ? 'UTC' : timeZone);
  const stamp = `${p.year}${pad(p.month)}${pad(p.day)}${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
  if (style === 'none') return stamp;
  return `${stamp} ${offsetText(p.offsetMinutes, style === 'colon')}`;
}

/** Xtream timeshift start `YYYY-MM-DD:HH-MM` in the panel's zone; `null` when malformed. */
export function parseTimeshiftStart(value: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}):(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedToEpoch(y, mo, d, h, mi, 0, timeZone);
}

/** `HH:MM:SS` for a duration (Xtream `duration`). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export const DAY_MS = 86_400_000;

/** UTC midnight of the day containing `epochMs`: anchors relative fixture dates so they stay stable all day. */
export function startOfUtcDay(epochMs: number): number {
  return Math.floor(epochMs / DAY_MS) * DAY_MS;
}
