/**
 * Reading one XMLTV guide into per-channel-day buckets (architecture.md §1.5 steps 5-7 and 9).
 * Pure: the ingest worker (step 9b) feeds it decoded text and writes the buckets it hands back.
 *
 * - **Filter:** programmes of XMLTV channels that feed no playlist channel are skipped by the
 *   tokenizer before they are tokenized (`EpgMatcher`, epg-match.ts); the rest must overlap the
 *   tier's time window.
 * - **Times** become UTC epoch minutes. A time without an offset is read in the fallback zone
 *   (the source's time offset, or the panel zone for an Xtream guide). In a DST zone the repeated
 *   hour is ambiguous: it is read as the earlier instant, and a start that then falls before the
 *   channel's previous stop moves forward an hour, as does its stop (ADR-010). A user correction
 *   (`shiftMinutes`, step 24) is added to every time.
 * - **tvg-shift is not applied here.** Several playlist channels can share one XMLTV channel
 *   with different shifts (the `+1` variants), so it is applied per playlist channel when
 *   reading (`epgNowNext`); the window widens by the largest shift instead.
 * - **A missing stop** is the channel's next start (`EPG_FLAG_STOP_GUESSED`), or one hour for the
 *   last programme. Lengths are capped at 24 h, and a programme overlapping the next one ends
 *   where it starts (`EPG_FLAG_CUT`).
 * - **Buckets:** one per XMLTV channel per UTC day of the start, with column arrays sorted by
 *   start. A programme from the evening before can still be on air, so readers take day - 1 too.
 *   Buckets are handed out when `flushAt` programmes are held: those of the channel being read
 *   stay, so a guide grouped by channel (the usual case) gives one bucket per channel-day. A
 *   channel-day handed out before comes again with `merge: true` (`mergeEpgBuckets`).
 * - **Interleaved guides** (channels after programmes): a programme of a channel not declared
 *   yet is kept when its id alone matches; otherwise it waits (at most `orphanCap` programmes)
 *   for its `<channel>` element, and is dropped if none comes.
 */

import type { DeviceTier } from './device';
import type { EpgMatchStats, EpgWantedChannel, EpgWantedSet } from './epg-match';
import { EPG_MATCH_METHODS, EpgMatcher } from './epg-match';
import type { ZoneOffset } from './timezone';
import type { XmltvItem, XmltvProgramme, XmltvStats } from './xmltv';
import { XmltvTokenizer, parseXmltvTime, xmltvTimeHasZone } from './xmltv';

const MINUTE = 60_000;
const HOUR = 3_600_000;
export const EPG_DAY_MINUTES = 1440;
/** Longest programme kept, in minutes; longer ones are cut (and readers look back one day). */
export const EPG_MAX_LENGTH = 1440;
/** Length given to a channel's last programme when it has no stop, in minutes. */
export const EPG_DEFAULT_LENGTH = 60;

/** The stop was missing: it is the channel's next start, or `EPG_DEFAULT_LENGTH`. */
export const EPG_FLAG_STOP_GUESSED = 1;
/** A start or stop in the repeated DST hour moved forward an hour. */
export const EPG_FLAG_TIME_REPAIRED = 2;
/** Cut at 24 h, or where the next programme starts. */
export const EPG_FLAG_CUT = 4;

// ---- Window ---------------------------------------------------------------------------------

/** One tier's window (remote-configurable). */
export interface EpgTierWindow {
  /** Past days kept: the matched channels' longest catch-up, clamped to [min, max]. */
  minPastDays: number;
  maxPastDays: number;
  futureDays: number;
  /** Longest description kept, in characters. */
  descLimit: number;
}

/** architecture.md §1.5 step 6. */
export const EPG_WINDOWS: Record<DeviceTier, EpgTierWindow> = {
  full: { minPastDays: 1, maxPastDays: 7, futureDays: 7, descLimit: 1000 },
  low: { minPastDays: 1, maxPastDays: 2, futureDays: 3, descLimit: 300 },
};

export interface EpgWindow {
  /** UTC epoch minutes: a programme is kept when it ends after `from` and starts before `to`. */
  from: number;
  to: number;
  pastDays: number;
  futureDays: number;
  descLimit: number;
}

/** The window around `nowMs`, widened on both sides by the largest tvg-shift. */
export function epgWindow(nowMs: number, tier: DeviceTier, catchupDays: number, maxShiftHours = 0, windows: Record<DeviceTier, EpgTierWindow> = EPG_WINDOWS): EpgWindow {
  const t = windows[tier];
  const pastDays = Math.min(t.maxPastDays, Math.max(t.minPastDays, Math.floor(catchupDays)));
  const now = Math.floor(nowMs / MINUTE);
  const shift = Math.ceil(Math.abs(maxShiftHours) * 60);
  return { from: now - pastDays * EPG_DAY_MINUTES - shift, to: now + t.futureDays * EPG_DAY_MINUTES + shift, pastDays, futureDays: t.futureDays, descLimit: t.descLimit };
}

// ---- Buckets --------------------------------------------------------------------------------

/** One programme, times in UTC epoch minutes; absent texts are `''`. */
export interface EpgProgramme {
  start: number;
  end: number;
  title: string;
  sub: string;
  desc: string;
  category: string;
  episode: string;
  flags: number;
}

/** The programmes of one XMLTV channel starting on one UTC day, as columns sorted by start. */
export interface EpgBucket {
  /** XMLTV channel id, as the guide declares it. */
  channel: string;
  /** UTC day of the starts: `floor(start / 1440)`. */
  day: number;
  start: Int32Array;
  end: Int32Array;
  title: string[];
  sub: string[];
  desc: string[];
  category: string[];
  episode: string[];
  flags: Uint8Array;
  /** This channel-day was handed out before in the same read: merge it into the stored one. */
  merge: boolean;
}

export const epgDay = (minute: number): number => Math.floor(minute / EPG_DAY_MINUTES);

/** The rows of a bucket. */
export function epgProgrammes(bucket: EpgBucket): EpgProgramme[] {
  const out: EpgProgramme[] = [];
  for (let i = 0; i < bucket.start.length; i++) {
    out.push({
      start: bucket.start[i]!,
      end: bucket.end[i]!,
      title: bucket.title[i] ?? '',
      sub: bucket.sub[i] ?? '',
      desc: bucket.desc[i] ?? '',
      category: bucket.category[i] ?? '',
      episode: bucket.episode[i] ?? '',
      flags: bucket.flags[i]!,
    });
  }
  return out;
}

/**
 * Columns from rows: sorted by start (stable: insertion sort, which is linear on the usual
 * sorted input and doesn't rely on `Array.prototype.sort` being stable, which it isn't on
 * Chromium 53), the first of equal starts kept, overlaps cut.
 */
export function buildEpgBucket(channel: string, day: number, rows: EpgProgramme[], merge = false): EpgBucket {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    let j = i - 1;
    while (j >= 0 && rows[j]!.start > row.start) {
      rows[j + 1] = rows[j]!;
      j--;
    }
    rows[j + 1] = row;
  }
  const kept: EpgProgramme[] = [];
  for (const row of rows) {
    const last = kept[kept.length - 1];
    if (last !== undefined && last.start === row.start) continue;
    if (last !== undefined && last.end > row.start) {
      last.end = row.start;
      last.flags |= EPG_FLAG_CUT;
    }
    kept.push(row);
  }
  const n = kept.length;
  const bucket: EpgBucket = {
    channel,
    day,
    start: new Int32Array(n),
    end: new Int32Array(n),
    title: new Array<string>(n),
    sub: new Array<string>(n),
    desc: new Array<string>(n),
    category: new Array<string>(n),
    episode: new Array<string>(n),
    flags: new Uint8Array(n),
    merge,
  };
  kept.forEach((p, i) => {
    bucket.start[i] = p.start;
    bucket.end[i] = p.end;
    bucket.title[i] = p.title;
    bucket.sub[i] = p.sub;
    bucket.desc[i] = p.desc;
    bucket.category[i] = p.category;
    bucket.episode[i] = p.episode;
    bucket.flags[i] = p.flags;
  });
  return bucket;
}

/** Two fragments of one channel-day as one bucket; on equal starts `a`'s programme wins. */
export function mergeEpgBuckets(a: EpgBucket, b: EpgBucket): EpgBucket {
  return buildEpgBucket(a.channel, a.day, epgProgrammes(a).concat(epgProgrammes(b)));
}

const SEP = String.fromCharCode(1);

/** Groups programmes into channel-day buckets, handing them out in batches. */
export class EpgBucketBuilder {
  private readonly open = new Map<string, { channel: string; day: number; rows: EpgProgramme[] }>();
  private readonly handedOut = new Set<string>();
  private held = 0;
  private current = '';
  /** Buckets handed out, and how many of them were fragments of an earlier one. */
  buckets = 0;
  fragments = 0;

  constructor(readonly flushAt = 20_000) {}

  /** Adds a programme; returns the buckets handed out because `flushAt` was reached. */
  add(channel: string, programme: EpgProgramme): EpgBucket[] {
    const day = epgDay(programme.start);
    const key = channel + SEP + day;
    let slot = this.open.get(key);
    if (slot === undefined) {
      slot = { channel, day, rows: [] };
      this.open.set(key, slot);
    }
    slot.rows.push(programme);
    this.current = channel;
    if (++this.held < this.flushAt) return [];
    const out = this.take((c) => c !== this.current);
    return out.length > 0 ? out : this.take(() => true);
  }

  /** Every bucket still held. */
  flush(): EpgBucket[] {
    return this.take(() => true);
  }

  private take(which: (channel: string) => boolean): EpgBucket[] {
    const out: EpgBucket[] = [];
    this.open.forEach((slot, key) => {
      if (!which(slot.channel)) return;
      const merge = this.handedOut.has(key);
      out.push(buildEpgBucket(slot.channel, slot.day, slot.rows, merge));
      this.handedOut.add(key);
      this.held -= slot.rows.length;
      this.open.delete(key);
      if (merge) this.fragments++;
    });
    this.buckets += out.length;
    return out;
  }
}

/**
 * The programme on air at `nowMs` and the one after it, for a playlist channel whose XMLTV
 * channel has these buckets (any order; days `today - 1` and later are enough). `shiftHours`
 * is its tvg-shift: the returned programmes are shifted by it.
 */
export function epgNowNext(buckets: readonly EpgBucket[], nowMs: number, shiftHours = 0): { now: EpgProgramme | null; next: EpgProgramme | null } {
  const shift = Math.round(shiftHours * 60);
  const at = Math.floor(nowMs / MINUTE) - shift;
  // Compared in guide time; only the two winners are shifted.
  let nowBucket: EpgBucket | null = null;
  let nowAt = 0;
  let nextBucket: EpgBucket | null = null;
  let nextAt = 0;
  for (const bucket of buckets) {
    for (let i = 0; i < bucket.start.length; i++) {
      const start = bucket.start[i]!;
      const end = bucket.end[i]!;
      if (start <= at && end > at) {
        if (nowBucket === null || start > nowBucket.start[nowAt]!) {
          nowBucket = bucket;
          nowAt = i;
        }
      } else if (start > at && (nextBucket === null || start < nextBucket.start[nextAt]!)) {
        nextBucket = bucket;
        nextAt = i;
      }
    }
  }
  return { now: nowBucket === null ? null : row(nowBucket, nowAt, shift), next: nextBucket === null ? null : row(nextBucket, nextAt, shift) };
}

/** A channel's programmes over a time range, as plain columns: a row of the grid guide. */
export interface EpgSchedule {
  /** UTC epoch minutes, sorted; `end[i] <= start[i + 1]`. */
  start: number[];
  end: number[];
  title: string[];
}

/**
 * The programmes of a playlist channel that overlap `[from, to)` (UTC epoch minutes), from its
 * XMLTV channel's buckets in day order (the day before `from`'s is enough to find one on air at
 * `from`), shifted by its tvg-shift `shiftHours`. Times aren't cut to the range. Each bucket is
 * sorted with no overlap, but one day's last programme can run past the next day's first: it ends
 * where that one starts. Plain arrays, so the grid's code (main thread) never touches a typed one.
 */
export function epgSchedule(buckets: readonly EpgBucket[], from: number, to: number, shiftHours = 0): EpgSchedule {
  const shift = Math.round(shiftHours * 60);
  const out: EpgSchedule = { start: [], end: [], title: [] };
  if (to <= from) return out;
  // Compared in guide time.
  const lo = from - shift;
  const hi = to - shift;
  for (const bucket of buckets) {
    for (let i = 0; i < bucket.start.length; i++) {
      const start = bucket.start[i]!;
      const last = out.start.length - 1;
      if (last >= 0 && out.end[last]! > start + shift) {
        out.end[last] = start + shift;
        // Cut, it may now end before the range.
        if (start <= lo) {
          out.start.pop();
          out.end.pop();
          out.title.pop();
        }
      }
      if (start >= hi || bucket.end[i]! <= lo) continue;
      out.start.push(start + shift);
      out.end.push(bucket.end[i]! + shift);
      out.title.push(bucket.title[i] ?? '');
    }
  }
  return out;
}

function row(bucket: EpgBucket, i: number, shift: number): EpgProgramme {
  return {
    start: bucket.start[i]! + shift,
    end: bucket.end[i]! + shift,
    title: bucket.title[i] ?? '',
    sub: bucket.sub[i] ?? '',
    desc: bucket.desc[i] ?? '',
    category: bucket.category[i] ?? '',
    episode: bucket.episode[i] ?? '',
    flags: bucket.flags[i]!,
  };
}

// ---- Reading a guide ------------------------------------------------------------------------

export interface EpgGuideOptions {
  /** The guide's id (records and overrides are scoped by it). */
  epgSrc: string;
  wanted: EpgWantedSet;
  tier: DeviceTier;
  /** The clock the window is centred on. */
  nowMs: number;
  /** UI languages, most preferred first (titles and descriptions in them win). */
  languages?: string[];
  /** Zone of times written without an offset: fixed minutes east of UTC, or an offset function. */
  fallback?: number | ZoneOffset;
  /** User correction added to every time, in minutes (step 24). */
  shiftMinutes?: number;
  windows?: Record<DeviceTier, EpgTierWindow>;
  /** Programmes held before buckets are handed out (default 20,000). */
  flushAt?: number;
  /** Programmes of undeclared channels held for a later `<channel>` (default 20,000). */
  orphanCap?: number;
}

export interface EpgGuideStats {
  /** Programmes of matched channels read (after the tokenizer's channel filter). */
  programmes: number;
  kept: number;
  outOfWindow: number;
  /** Unreadable start, a stop before the start, or zero length. */
  invalidTime: number;
  repaired: number;
  stopGuessed: number;
  /** Programmes of a channel declared after them, kept once it was. */
  orphansKept: number;
  /** Programmes of a channel that was never declared, or over `orphanCap`. */
  orphansDropped: number;
  buckets: number;
  fragments: number;
}

/** What one guide matched and kept (architecture.md §1.5 step 4: the diagnostics' match rate). */
export interface EpgSourceReport {
  epgSrc: string;
  /** `matched / wanted` (0 when nothing is wanted). */
  rate: number;
  match: EpgMatchStats;
  /** Playlist channels this guide may match but doesn't, for manual mapping. */
  unmatched: { key: string; name: string; epgId: string | null }[];
  window: EpgWindow | null;
  programmes: EpgGuideStats;
  xmltv: XmltvStats;
}

/** Reads one guide: push decoded text, write the buckets each call returns, then `end()`. */
export class EpgGuideReader {
  readonly matcher: EpgMatcher;
  readonly stats: EpgGuideStats = {
    programmes: 0,
    kept: 0,
    outOfWindow: 0,
    invalidTime: 0,
    repaired: 0,
    stopGuessed: 0,
    orphansKept: 0,
    orphansDropped: 0,
    buckets: 0,
    fragments: 0,
  };

  private readonly tokenizer: XmltvTokenizer;
  private readonly builder: EpgBucketBuilder;
  /** Per declared channel (matcher index): its previous stop in epoch ms, for the DST repair. */
  private readonly lastStop: number[] = [];
  /** Per declared channel: a programme without a stop, waiting for the next start. */
  private readonly pending: (EpgProgramme | null)[] = [];
  private readonly orphans = new Map<string, XmltvProgramme[]>();
  private orphanCount = 0;
  private readonly orphanCap: number;
  private readonly fallback: number | ZoneOffset;
  private readonly zone: ZoneOffset | null;
  private readonly shiftMinutes: number;
  private win: EpgWindow | null = null;
  /** Buckets handed out during the current `push` or `end`. */
  private out: EpgBucket[] = [];

  constructor(private readonly options: EpgGuideOptions) {
    this.matcher = new EpgMatcher(options.epgSrc, options.wanted);
    const windows = options.windows ?? EPG_WINDOWS;
    this.tokenizer = new XmltvTokenizer({
      languages: options.languages,
      descLimit: windows[options.tier].descLimit,
      wantChannel: (id) => this.wantChannel(id),
      onItem: (item) => this.item(item),
    });
    this.builder = new EpgBucketBuilder(options.flushAt);
    this.orphanCap = options.orphanCap ?? 20_000;
    this.fallback = options.fallback ?? 0;
    this.zone = typeof this.fallback === 'function' ? this.fallback : null;
    this.shiftMinutes = Math.round(options.shiftMinutes ?? 0);
  }

  /** The window, fixed when the first programme arrives (`null` before). */
  get window(): EpgWindow | null {
    return this.win;
  }

  get xmltvStats(): XmltvStats {
    return this.tokenizer.stats;
  }

  push(text: string): EpgBucket[] {
    this.tokenizer.push(text);
    return this.handOut();
  }

  /** Ends the guide: every bucket still held. */
  end(): EpgBucket[] {
    this.tokenizer.end();
    const out = this.handOut();
    for (let c = 0; c < this.pending.length; c++) {
      const p = this.pending[c];
      if (p === null || p === undefined) continue;
      this.pending[c] = null;
      p.end = p.start + EPG_DEFAULT_LENGTH;
      this.finish(c, p, out);
    }
    this.stats.orphansDropped += this.orphanCount;
    this.orphans.clear();
    this.orphanCount = 0;
    for (const b of this.builder.flush()) out.push(b);
    this.stats.buckets = this.builder.buckets;
    this.stats.fragments = this.builder.fragments;
    return out;
  }

  report(): EpgSourceReport {
    const match = this.matcher.stats();
    return {
      epgSrc: this.options.epgSrc,
      rate: match.wanted > 0 ? match.matched / match.wanted : 0,
      match,
      unmatched: this.matcher.unmatched().map((c: EpgWantedChannel) => ({ key: c.key, name: c.name, epgId: c.epgId })),
      window: this.win,
      programmes: { ...this.stats },
      xmltv: { ...this.tokenizer.stats },
    };
  }

  private wantChannel(id: string): boolean {
    const c = this.matcher.channelIndex(id);
    if (c >= 0) return this.matcher.usedAt(c);
    if (this.matcher.declareById(id)) return true;
    // Maybe declared later (an interleaved guide): read it and hold it, while there is room.
    if (this.orphanCount < this.orphanCap) return true;
    this.stats.orphansDropped++;
    return false;
  }

  private handOut(): EpgBucket[] {
    const out = this.out;
    this.out = [];
    return out;
  }

  /**
   * Each channel and programme in document order. A programme's channel is in the same state as
   * when `wantChannel` let it through: no channel can complete inside a programme.
   */
  private item(item: XmltvItem): void {
    const out = this.out;
    if (item.type === 'channel') {
      this.matcher.addChannel(item);
      const waiting = this.orphans.get(item.id);
      if (waiting === undefined) return;
      this.orphans.delete(item.id);
      this.orphanCount -= waiting.length;
      const c = this.matcher.channelIndex(item.id);
      if (this.matcher.usedAt(c)) {
        this.stats.orphansKept += waiting.length;
        for (const p of waiting) this.programme(p, c, out);
      } else {
        this.stats.orphansDropped += waiting.length;
      }
      return;
    }
    const c = this.matcher.channelIndex(item.channel);
    if (c >= 0 && this.matcher.usedAt(c)) {
      this.programme(item, c, out);
    } else if (c < 0 && this.orphanCount < this.orphanCap) {
      const list = this.orphans.get(item.channel);
      if (list === undefined) this.orphans.set(item.channel, [item]);
      else list.push(item);
      this.orphanCount++;
    } else {
      // Not reached: wantChannel let it through as used, or as an orphan with room left.
      this.stats.orphansDropped++;
    }
  }

  /**
   * A time without an offset in a DST zone: during the repeated hour it reads as two instants.
   * Returns the earlier one (`parseXmltvTime` may give either: the earlier one west of UTC, the
   * later one east of it), and whether there were two.
   */
  private settle(raw: string, ms: number): { ms: number; twice: boolean } {
    const zone = this.zone;
    if (zone === null || xmltvTimeHasZone(raw)) return { ms, twice: false };
    const wall = ms + zone(ms) * MINUTE;
    const before = ms - HOUR;
    if (before + zone(before) * MINUTE === wall) return { ms: before, twice: true };
    const after = ms + HOUR;
    return { ms, twice: after + zone(after) * MINUTE === wall };
  }

  /** A programme of declared channel `c` (its strings are only read, never kept). */
  private programme(p: XmltvProgramme, c: number, out: EpgBucket[]): void {
    this.stats.programmes++;
    if (this.win === null) {
      this.win = epgWindow(this.options.nowMs, this.options.tier, this.matcher.maxCatchupDays(), this.matcher.maxShiftHours(), this.options.windows);
    }
    const startMs = parseXmltvTime(p.start, this.fallback);
    if (startMs === null) {
      this.stats.invalidTime++;
      return;
    }
    const stopMs = p.stop === null ? null : parseXmltvTime(p.stop, this.fallback);
    const lastStop = this.lastStop[c] ?? -Infinity;
    // ADR-010: in the repeated DST hour, a start before the channel's previous stop is the
    // second occurrence; so is a stop that would end before its start, or one of a programme
    // whose start was moved.
    let flags = 0;
    const s = this.settle(p.start, startMs);
    let start = s.ms;
    if (s.twice && start < lastStop) {
      start += HOUR;
      flags |= EPG_FLAG_TIME_REPAIRED;
    }
    let stop: number | null = null;
    if (stopMs !== null && p.stop !== null) {
      const t = this.settle(p.stop, stopMs);
      stop = t.ms;
      if (t.twice && ((flags & EPG_FLAG_TIME_REPAIRED) !== 0 || stop <= start)) {
        stop += HOUR;
        flags |= EPG_FLAG_TIME_REPAIRED;
      }
    }
    if (flags !== 0) this.stats.repaired++;
    this.lastStop[c] = stop ?? start;
    const startMin = Math.floor(start / MINUTE) + this.shiftMinutes;
    const programme: EpgProgramme = {
      start: startMin,
      end: stop === null ? startMin : Math.floor(stop / MINUTE) + this.shiftMinutes,
      title: p.title,
      sub: p.subTitle ?? '',
      desc: p.desc ?? '',
      category: p.category ?? '',
      episode: p.episode ?? '',
      flags,
    };
    const pending = this.pending[c];
    if (pending !== null && pending !== undefined) {
      this.pending[c] = null;
      pending.end = startMin > pending.start ? startMin : pending.start + EPG_DEFAULT_LENGTH;
      this.finish(c, pending, out);
    }
    if (stop === null) {
      programme.flags |= EPG_FLAG_STOP_GUESSED;
      this.stats.stopGuessed++;
      this.pending[c] = programme;
      return;
    }
    this.finish(c, programme, out);
  }

  private finish(c: number, p: EpgProgramme, out: EpgBucket[]): void {
    if (p.end <= p.start) {
      this.stats.invalidTime++;
      return;
    }
    if (p.end - p.start > EPG_MAX_LENGTH) {
      p.end = p.start + EPG_MAX_LENGTH;
      p.flags |= EPG_FLAG_CUT;
    }
    const win = this.win!;
    if (p.end <= win.from || p.start >= win.to) {
      this.stats.outOfWindow++;
      return;
    }
    this.stats.kept++;
    for (const b of this.builder.add(this.matcher.channelId(c), p)) out.push(b);
  }
}

// ---- Report text ----------------------------------------------------------------------------

const pct = (part: number, whole: number): string => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '-');

/** The report as plain text (the `pnpm epg:report` output and the diagnostics' source). */
export function formatEpgReport(r: EpgSourceReport, options: { unmatched?: number } = {}): string {
  const m = r.match;
  const lines = [
    `EPG source ${r.epgSrc}: ${m.matched} of ${m.wanted} live channels matched (${pct(m.matched, m.wanted)})`,
    `  by method: ${EPG_MATCH_METHODS.map((k) => `${k} ${m.byMethod[k]}`).join(', ')}${m.ambiguous > 0 ? `; ${m.ambiguous} ambiguous by name` : ''}`,
    `  XMLTV channels: ${m.declared} declared, ${m.used} used (${pct(m.used, m.declared)})${r.xmltv.lateChannels > 0 ? `, ${r.xmltv.lateChannels} after programmes` : ''}`,
  ];
  const p = r.programmes;
  const skipped = r.xmltv.filtered;
  const read = p.programmes + skipped;
  lines.push(
    `  programmes: ${read} read, ${skipped} of unused channels skipped (${pct(skipped, read)}), ${p.outOfWindow} outside the window, ${p.invalidTime} with bad times; ${p.kept} kept in ${p.buckets} channel-day buckets`,
  );
  if (r.window !== null) {
    const w = r.window;
    lines.push(`  window: ${w.pastDays} past and ${w.futureDays} future days, descriptions up to ${w.descLimit} characters`);
  }
  const notes: string[] = [];
  if (p.repaired > 0) notes.push(`${p.repaired} DST-repaired`);
  if (p.stopGuessed > 0) notes.push(`${p.stopGuessed} without a stop`);
  if (p.orphansKept > 0) notes.push(`${p.orphansKept} before their channel`);
  if (p.orphansDropped > 0) notes.push(`${p.orphansDropped} of undeclared channels dropped`);
  if (p.fragments > 0) notes.push(`${p.fragments} bucket fragments to merge`);
  if (r.xmltv.malformed > 0) notes.push(`${r.xmltv.malformed} malformed`);
  if (r.xmltv.truncated) notes.push('the guide was cut short');
  if (notes.length > 0) lines.push(`  notes: ${notes.join(', ')}`);
  const limit = options.unmatched ?? 20;
  if (r.unmatched.length > 0 && limit > 0) {
    lines.push(`  unmatched (${r.unmatched.length}${r.unmatched.length > limit ? `, first ${limit}` : ''}):`);
    for (const u of r.unmatched.slice(0, limit)) lines.push(`    ${u.name}${u.epgId === null ? ' (no id)' : ` (id ${u.epgId})`}`);
  }
  return lines.join('\n');
}
