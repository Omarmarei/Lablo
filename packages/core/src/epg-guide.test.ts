import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EpgBucket, EpgGuideOptions, EpgProgramme } from './epg-guide';
import {
  EPG_FLAG_CUT,
  EPG_FLAG_STOP_GUESSED,
  EPG_FLAG_TIME_REPAIRED,
  EpgGuideReader,
  buildEpgBucket,
  epgNowNext,
  epgProgrammes,
  epgSchedule,
  epgWindow,
  formatEpgReport,
  mergeEpgBuckets,
} from './epg-guide';
import { EpgWantedSet } from './epg-match';
import type { CatalogItem } from './model';
import { matchName, normalizeName } from './normalize';
import type { ZoneOffset } from './timezone';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 2026-11-02 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 2, 12);
const nowMin = NOW / MIN;

let serial = 0;
function live(name: string, over: Partial<CatalogItem> = {}): CatalogItem {
  serial++;
  return {
    key: `m:tv:g${serial}:0`,
    src: 'tv',
    kind: 'live',
    name,
    normName: normalizeName(name),
    group: '',
    url: 'http://127.0.0.1/x.ts',
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: matchName(name),
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
    ...over,
  };
}

const pad = (n: number, w = 2): string => String(Math.abs(n)).padStart(w, '0');

/** An XMLTV time for an instant, written in a zone `offset` minutes east of UTC (`null`: no offset). */
function xt(ms: number, offset: number | null = 0): string {
  const d = new Date(ms + (offset ?? 0) * MIN);
  const wall = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
  return offset === null ? wall : `${wall} ${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
}

/** A wall time written without an offset. */
const wall = (y: number, mo: number, d: number, h: number, mi: number): string => xt(Date.UTC(y, mo - 1, d, h, mi), null);

const ch = (id: string, ...names: string[]): string => `<channel id="${id}">${names.map((n) => `<display-name>${n}</display-name>`).join('')}</channel>`;
const pr = (channel: string, start: string, stop: string | null, title: string, inner = ''): string =>
  `<programme start="${start}"${stop === null ? '' : ` stop="${stop}"`} channel="${channel}"><title>${title}</title>${inner}</programme>`;
const tv = (...parts: string[]): string => `<?xml version="1.0"?><tv>${parts.join('\n')}</tv>`;

/** Reads a guide in the given chunks; fragments are merged as the store will. Keyed `channel|day`. */
function read(text: string | string[], options: Partial<EpgGuideOptions> & { wanted: EpgWantedSet }): { buckets: Record<string, EpgProgramme[]>; reader: EpgGuideReader } {
  const reader = new EpgGuideReader({ epgSrc: 'g1', tier: 'full', nowMs: NOW, ...options });
  const merged = new Map<string, EpgBucket>();
  const take = (list: EpgBucket[]): void => {
    for (const b of list) {
      const key = `${b.channel}|${b.day}`;
      const stored = merged.get(key);
      expect(b.merge, key).toBe(stored !== undefined);
      merged.set(key, stored === undefined ? b : mergeEpgBuckets(stored, b));
    }
  };
  for (const chunk of typeof text === 'string' ? [text] : text) take(reader.push(chunk));
  take(reader.end());
  const buckets: Record<string, EpgProgramme[]> = {};
  for (const key of [...merged.keys()].sort()) buckets[key] = epgProgrammes(merged.get(key)!);
  return { buckets, reader };
}

const slim = (rows: EpgProgramme[]): string[] => rows.map((p) => `${p.start - nowMin}..${p.end - nowMin} ${p.title}${p.flags ? ` f${p.flags}` : ''}`);
const dayOf = (ms: number): number => Math.floor(ms / DAY);

describe('epgWindow', () => {
  it('follows the tier table, catch-up days and tvg-shift', () => {
    const at = (tier: 'full' | 'low', catchup: number, shift = 0): number[] => {
      const w = epgWindow(NOW, tier, catchup, shift);
      return [(nowMin - w.from) / 1440, (w.to - nowMin) / 1440, w.descLimit];
    };
    expect(at('full', 0)).toEqual([1, 7, 1000]);
    expect(at('full', 3)).toEqual([3, 7, 1000]);
    expect(at('full', 12)).toEqual([7, 7, 1000]);
    expect(at('low', 0)).toEqual([1, 3, 300]);
    expect(at('low', 1)).toEqual([1, 3, 300]);
    expect(at('low', 5)).toEqual([2, 3, 300]);
    const shifted = epgWindow(NOW, 'low', 0, -2);
    expect([nowMin - shifted.from, shifted.to - nowMin]).toEqual([1440 + 120, 3 * 1440 + 120]);
    expect(epgWindow(NOW, 'full', 2.9).pastDays).toBe(2);
  });
});

describe('EpgGuideReader', () => {
  it('keeps matched channels only, in UTC minutes, one bucket per channel and day of the start', () => {
    const a = live('Zoma A', { epgId: 'a' });
    const wanted = EpgWantedSet.fromItems([a, live('Movie', { kind: 'movie' })]);
    const midnight = Date.UTC(2026, 10, 3);
    const { buckets, reader } = read(
      tv(
        ch('a', 'Zoma A'),
        ch('b', 'Zoma B'),
        pr('a', xt(NOW - HOUR, 180), xt(NOW, 180), 'One', '<title lang="ar">واحد</title><desc>First &amp; best</desc><sub-title>Pilot</sub-title><category>News</category><episode-num system="onscreen">E1</episode-num>'),
        pr('b', xt(NOW), xt(NOW + HOUR), 'Skipped'),
        pr('a', xt(midnight - 30 * MIN, -300), xt(midnight + 30 * MIN, -300), 'Late'),
        pr('a', xt(midnight + 30 * MIN), xt(midnight + 90 * MIN), 'Early'),
      ),
      { wanted, languages: ['ar', 'en'] },
    );
    expect(Object.keys(buckets)).toEqual([`a|${dayOf(NOW)}`, `a|${dayOf(midnight)}`]);
    expect(buckets[`a|${dayOf(NOW)}`]).toEqual([
      { start: nowMin - 60, end: nowMin, title: 'واحد', sub: 'Pilot', desc: 'First & best', category: 'News', episode: 'E1', flags: 0 },
      { start: midnight / MIN - 30, end: midnight / MIN + 30, title: 'Late', sub: '', desc: '', category: '', episode: '', flags: 0 },
    ]);
    expect(slim(buckets[`a|${dayOf(midnight)}`]!)).toEqual(['750..810 Early']);
    const r = reader.report();
    expect(r.rate).toBe(1);
    expect(r.xmltv.filtered).toBe(1);
    expect(r.programmes).toMatchObject({ programmes: 3, kept: 3, outOfWindow: 0, buckets: 2, fragments: 0 });
    expect(reader.matcher.usedChannels().map((c) => c.id)).toEqual(['a']);
  });

  it('drops programmes outside the tier window and cuts descriptions to the tier limit', () => {
    const a = live('A', { epgId: 'a', catchup: { mode: null, days: 3, source: null } });
    const at = (days: number, title: string): string => pr('a', xt(NOW + days * DAY), xt(NOW + days * DAY + HOUR), title, `<desc>${'x'.repeat(500)}</desc>`);
    const guide = tv(ch('a'), at(-3.5, 'old'), at(-2.5, 'past2'), at(-1.5, 'past1'), at(2.5, 'soon'), at(6.5, 'later'), at(7.5, 'far'));
    const full = read(guide, { wanted: EpgWantedSet.fromItems([a]) });
    const titles = (b: Record<string, EpgProgramme[]>): string[] => Object.values(b).flat().map((p) => p.title);
    expect(titles(full.buckets)).toEqual(['past2', 'past1', 'soon', 'later']);
    expect(full.reader.stats.outOfWindow).toBe(2);
    expect(Object.values(full.buckets).flat()[0]!.desc.length).toBe(500);
    const low = read(guide, { wanted: EpgWantedSet.fromItems([a]), tier: 'low' });
    expect(titles(low.buckets)).toEqual(['past1', 'soon']);
    expect(Object.values(low.buckets).flat()[0]!.desc.length).toBe(300);
    expect(low.reader.window).toMatchObject({ pastDays: 2, futureDays: 3, descLimit: 300 });
  });

  it('keeps a programme overlapping either edge of the window', () => {
    const a = live('A', { epgId: 'a' });
    const w = epgWindow(NOW, 'full', 0);
    const { buckets } = read(
      tv(
        ch('a'),
        pr('a', xt((w.from - 30) * MIN), xt((w.from + 30) * MIN), 'edge-in'),
        pr('a', xt((w.from - 90) * MIN), xt(w.from * MIN), 'edge-out'),
        pr('a', xt((w.to - 30) * MIN), xt((w.to + 30) * MIN), 'end-in'),
        pr('a', xt(w.to * MIN), xt((w.to + 60) * MIN), 'end-out'),
      ),
      { wanted: EpgWantedSet.fromItems([a]) },
    );
    expect(Object.values(buckets).flat().map((p) => p.title)).toEqual(['edge-in', 'end-in']);
  });

  it('guesses missing stops, cuts overlaps and 24 h, drops duplicates and bad times, sorts', () => {
    const a = live('A', { epgId: 'a', catchup: { mode: null, days: 3, source: null } });
    const at = (min: number): string => xt(NOW + min * MIN);
    const { buckets, reader } = read(
      tv(
        ch('a'),
        pr('a', at(60), null, 'no-stop'),
        pr('a', at(90), at(120), 'after'),
        pr('a', at(0), at(45), 'early'),
        pr('a', at(0), at(30), 'same-start'),
        pr('a', at(30), at(80), 'overlap'),
        pr('a', at(-600), at(-600), 'zero'),
        pr('a', at(-500), at(-560), 'backwards'),
        pr('a', 'tomorrow', at(10), 'unreadable'),
        pr('a', at(-3000), at(-3000 + 1500), 'marathon'),
        pr('a', at(200), null, 'last'),
        pr('a', at(150), null, 'out-of-order'),
      ),
      { wanted: EpgWantedSet.fromItems([a]) },
    );
    const g = EPG_FLAG_STOP_GUESSED;
    const cut = EPG_FLAG_CUT;
    expect(Object.values(buckets).flatMap(slim)).toEqual([
      `-3000..-1560 marathon f${cut}`,
      `0..30 early f${cut}`,
      `30..60 overlap f${cut}`,
      `60..90 no-stop f${g}`,
      '90..120 after',
      `150..200 out-of-order f${g | cut}`,
      `200..260 last f${g}`,
    ]);
    expect(reader.stats).toMatchObject({ invalidTime: 3, stopGuessed: 3, kept: 8 });
  });

  it('reads times without an offset in the fallback zone, and adds the user correction to all', () => {
    const a = live('A', { epgId: 'a' });
    const guide = tv(ch('a'), pr('a', wall(2026, 11, 2, 15, 0), wall(2026, 11, 2, 16, 0), 'riyadh'), pr('a', xt(NOW + 2 * HOUR, 60), xt(NOW + 3 * HOUR, 60), 'stated'));
    const fixed = read(guide, { wanted: EpgWantedSet.fromItems([a]), fallback: 180 });
    expect(Object.values(fixed.buckets).flatMap(slim)).toEqual(['0..60 riyadh', '120..180 stated']);
    const shifted = read(guide, { wanted: EpgWantedSet.fromItems([a]), fallback: 180, shiftMinutes: -30 });
    expect(Object.values(shifted.buckets).flatMap(slim)).toEqual(['-30..30 riyadh', '90..150 stated']);
  });

  describe('repairs the repeated DST hour from per-channel ordering (ADR-010)', () => {
    // A guide written in local wall time across the autumn change: 00:30-01:30, 01:30-01:45
    // (both in summer time), 01:45-01:15 (across the change) and 01:15-02:30 (winter time).
    const times: [number, number][] = [
      [30, 90],
      [90, 105],
      [105, 75],
      [75, 150],
    ];
    const cases: { name: string; zone: ZoneOffset; month: number; day: number; change: number }[] = [
      // East of UTC: parseXmltvTime reads the repeated hour as the later instant.
      { name: 'London', zone: (ms) => (ms < Date.UTC(2026, 9, 25, 1) ? 60 : 0), month: 10, day: 25, change: Date.UTC(2026, 9, 25, 1) },
      // West of UTC: it reads it as the earlier one.
      { name: 'New York', zone: (ms) => (ms < Date.UTC(2026, 10, 1, 6) ? -240 : -300), month: 11, day: 1, change: Date.UTC(2026, 10, 1, 6) },
    ];
    for (const c of cases) {
      it(c.name, () => {
        const a = live('A', { epgId: 'a' });
        const at = (minutes: number): string => wall(2026, c.month, c.day, Math.floor(minutes / 60), minutes % 60);
        const guide = tv(ch('a'), ...times.map(([s, e], i) => pr('a', at(s), at(e), `p${i + 1}`)));
        const { buckets, reader } = read(guide, { wanted: EpgWantedSet.fromItems([a]), nowMs: c.change, fallback: c.zone });
        const rows = Object.values(buckets).flat();
        const rel = rows.map((p) => `${p.start - c.change / MIN}..${p.end - c.change / MIN} ${p.title}${p.flags ? ` f${p.flags}` : ''}`);
        // Contiguous, in real time: 90 + 15 + 30 + 75 minutes, the change at 0.
        expect(rel).toEqual(['-90..-30 p1', '-30..-15 p2', `-15..15 p3 f${EPG_FLAG_TIME_REPAIRED}`, `15..90 p4 f${EPG_FLAG_TIME_REPAIRED}`]);
        expect(reader.stats.repaired).toBe(2);
      });
    }

    it('leaves times with a stated offset, and fixed fallback zones, alone', () => {
      const a = live('A', { epgId: 'a' });
      const change = Date.UTC(2026, 9, 25, 1);
      const london: ZoneOffset = (ms) => (ms < change ? 60 : 0);
      const stated = tv(ch('a'), pr('a', xt(change - 30 * MIN, 60), xt(change + 15 * MIN, 0), 'p1'), pr('a', xt(change - 45 * MIN, 0), xt(change, 0), 'p2'));
      const r = read(stated, { wanted: EpgWantedSet.fromItems([a]), nowMs: change, fallback: london });
      expect(r.reader.stats.repaired).toBe(0);
      const fixed = tv(ch('a'), pr('a', wall(2026, 10, 25, 1, 45), wall(2026, 10, 25, 1, 15), 'p1'));
      expect(read(fixed, { wanted: EpgWantedSet.fromItems([a]), nowMs: change, fallback: 60 }).reader.stats).toMatchObject({ repaired: 0, invalidTime: 1 });
    });
  });

  it('holds programmes of channels declared after them, within orphanCap', () => {
    const late = live('Late Show');
    const byId = live('By Id', { epgId: 'byid' });
    const wanted = EpgWantedSet.fromItems([late, byId]);
    const guide = tv(
      pr('late', xt(NOW), xt(NOW + HOUR), 'late-1'),
      pr('ghost', xt(NOW), xt(NOW + HOUR), 'ghost'),
      pr('byid', xt(NOW), xt(NOW + HOUR), 'by-id'),
      pr('nobody', xt(NOW), xt(NOW + HOUR), 'nobody'),
      pr('late', xt(NOW + HOUR), xt(NOW + 2 * HOUR), 'late-2'),
      ch('late', 'Late Show'),
      ch('nobody', 'Someone Else'),
      pr('late', xt(NOW + 2 * HOUR), xt(NOW + 3 * HOUR), 'late-3'),
    );
    const all = read(guide, { wanted });
    expect(Object.values(all.buckets).flat().map((p) => p.title).sort()).toEqual(['by-id', 'late-1', 'late-2', 'late-3']);
    expect(all.reader.stats).toMatchObject({ orphansKept: 2, orphansDropped: 2 });
    expect(all.reader.report().xmltv.lateChannels).toBe(2);
    expect(all.reader.report().match.byMethod).toMatchObject({ id: 1, name: 1 });
    const capped = read(guide, { wanted, orphanCap: 1 });
    expect(Object.values(capped.buckets).flat().map((p) => p.title).sort()).toEqual(['by-id', 'late-1', 'late-3']);
    expect(capped.reader.stats).toMatchObject({ orphansKept: 1, orphansDropped: 3 });
    // Over the cap, they aren't even tokenized.
    expect(capped.reader.xmltvStats.filtered).toBe(3);
    expect(all.reader.xmltvStats.filtered).toBe(0);
  });

  it('hands out buckets every flushAt programmes, keeping the channel being read', () => {
    const items = ['a', 'b', 'c'].map((id) => live(id.toUpperCase(), { epgId: id }));
    const progs = (id: string): string[] => [0, 1, 2, 3].map((h) => pr(id, xt(NOW + h * HOUR), xt(NOW + (h + 1) * HOUR), `${id}${h}`));
    const grouped = tv(ch('a'), ch('b'), ch('c'), ...progs('a'), ...progs('b'), ...progs('c'));
    const reference = read(grouped, { wanted: EpgWantedSet.fromItems(items), flushAt: 1e9 });
    const reader = new EpgGuideReader({ epgSrc: 'g1', wanted: EpgWantedSet.fromItems(items), tier: 'full', nowMs: NOW, flushAt: 5 });
    const handed = reader.push(grouped).map((b) => `${b.channel}${b.start.length}`);
    expect(handed).toEqual(['a4', 'b4']);
    expect(reader.end().map((b) => `${b.channel}${b.start.length}${b.merge ? 'm' : ''}`)).toEqual(['c4']);
    // Sorted by time instead: every flush splits channel-days, merged on write.
    const byTime = tv(ch('a'), ch('b'), ch('c'), ...[0, 1, 2, 3].flatMap((h) => ['a', 'b', 'c'].map((id) => progs(id)[h]!)));
    const split = read(byTime, { wanted: EpgWantedSet.fromItems(items), flushAt: 2 });
    expect(split.buckets).toEqual(reference.buckets);
    expect(split.reader.stats.fragments).toBeGreaterThan(0);
  });

  it('gives the same merged buckets for any chunking, flush size and channel order (property)', () => {
    const items = ['a', 'b', 'c'].map((id) => live(id.toUpperCase(), { epgId: id }));
    const prog = fc.record({
      channel: fc.constantFrom('a', 'b', 'c', 'x'),
      start: fc.integer({ min: -2000, max: 3000 }),
      length: fc.integer({ min: -10, max: 400 }),
      stop: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(prog, { maxLength: 40 }), fc.integer({ min: 1, max: 12 }), fc.array(fc.nat(), { maxLength: 8 }), (list, flushAt, cuts) => {
        const guide = tv(
          ch('a'),
          ch('b'),
          ch('c'),
          ...list.map((p, i) => pr(p.channel, xt(NOW + p.start * MIN), p.stop ? xt(NOW + (p.start + p.length) * MIN) : null, `t${i}`)),
        );
        const wanted = EpgWantedSet.fromItems(items);
        const reference = read(guide, { wanted, flushAt: 1e9 });
        const points = [...new Set(cuts.map((c) => c % (guide.length + 1)))].sort((x, y) => x - y);
        const chunks: string[] = [];
        let last = 0;
        for (const p of points) {
          chunks.push(guide.slice(last, p));
          last = p;
        }
        chunks.push(guide.slice(last));
        const other = read(chunks, { wanted, flushAt });
        expect(other.buckets).toEqual(reference.buckets);
        expect(other.reader.stats.kept).toBe(reference.reader.stats.kept);
        for (const rows of Object.values(reference.buckets)) {
          for (let i = 1; i < rows.length; i++) {
            expect(rows[i]!.start).toBeGreaterThan(rows[i - 1]!.start);
            expect(rows[i - 1]!.end).toBeLessThanOrEqual(rows[i]!.start);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('reports the match rate, the methods, the unmatched channels and what was dropped', () => {
    const items = [live('Zoma A', { epgId: 'a' }), live('Zoma B HD'), live('Nothing', { epgId: 'missing.id' }), live('Gone')];
    const { reader } = read(tv(ch('a'), ch('b.uk', 'UK: Zoma B'), ch('c', 'Other'), pr('a', xt(NOW), xt(NOW + HOUR), 'x'), pr('c', xt(NOW), xt(NOW + HOUR), 'y')), {
      wanted: EpgWantedSet.fromItems(items),
    });
    const r = reader.report();
    expect(r).toMatchObject({ epgSrc: 'g1', rate: 0.5, match: { wanted: 4, matched: 2, declared: 3, used: 2, byMethod: { id: 1, 'match-name': 1 } } });
    expect(r.unmatched).toEqual([
      { key: items[2]!.key, name: 'Nothing', epgId: 'missing.id' },
      { key: items[3]!.key, name: 'Gone', epgId: null },
    ]);
    const text = formatEpgReport(r, { unmatched: 1 });
    expect(text).toContain('EPG source g1: 2 of 4 live channels matched (50.0%)');
    expect(text).toContain('by method: override 0, id 1, xtream-id 0, name 0, match-name 1');
    expect(text).toContain('XMLTV channels: 3 declared, 2 used (66.7%)');
    expect(text).toContain('programmes: 2 read, 1 of unused channels skipped (50.0%), 0 outside the window, 0 with bad times; 1 kept in 1 channel-day buckets');
    expect(text).toContain('unmatched (2, first 1):\n    Nothing (id missing.id)');
    expect(text).not.toContain('Gone');
  });
});

describe('buckets', () => {
  const row = (start: number, end: number, title: string): EpgProgramme => ({ start, end, title, sub: '', desc: '', category: '', episode: '', flags: 0 });

  it('merges fragments, the stored one winning equal starts', () => {
    const a = buildEpgBucket('c', 1, [row(100, 160, 'stored'), row(200, 260, 'two')]);
    const b = buildEpgBucket('c', 1, [row(100, 130, 'new'), row(160, 200, 'gap')], true);
    expect(b.merge).toBe(true);
    const merged = mergeEpgBuckets(a, b);
    expect(merged.merge).toBe(false);
    expect(epgProgrammes(merged).map((p) => `${p.start}-${p.end} ${p.title}`)).toEqual(['100-160 stored', '160-200 gap', '200-260 two']);
    expect(merged.start).toBeInstanceOf(Int32Array);
  });

  it('finds now and next across days, shifted by tvg-shift', () => {
    const day = Math.floor(nowMin / 1440);
    const yesterday = buildEpgBucket('c', day - 1, [row(nowMin - 120, nowMin + 30, 'long')]);
    const today = buildEpgBucket('c', day, [row(nowMin + 30, nowMin + 90, 'next'), row(nowMin + 90, nowMin + 120, 'after')]);
    expect(epgNowNext([today, yesterday], NOW)).toMatchObject({ now: { title: 'long' }, next: { title: 'next' } });
    const shifted = epgNowNext([yesterday, today], NOW, 1);
    expect(shifted.now).toMatchObject({ title: 'long', start: nowMin - 60, end: nowMin + 90 });
    expect(shifted.next).toMatchObject({ title: 'next', start: nowMin + 90 });
    // 45 minutes on, 'next' is on air in UTC, but an hour-later channel still shows 'long'.
    expect(epgNowNext([today, yesterday], NOW + 45 * MIN).now).toMatchObject({ title: 'next' });
    expect(epgNowNext([today, yesterday], NOW + 45 * MIN, 1).now).toMatchObject({ title: 'long', end: nowMin + 90 });
    expect(epgNowNext([today], NOW + 2 * HOUR + MIN)).toEqual({ now: null, next: null });
  });

  it('compares candidates in guide time, whatever the bucket order and shift', () => {
    // Step 9b found it: the next programme was compared with an already-shifted one, so with a
    // shift the bucket order decided which programme came "next".
    const day = Math.floor(nowMin / 1440);
    const slots = (d: number): EpgProgramme[] => {
      const out: EpgProgramme[] = [];
      for (let t = d * 1440; t < (d + 1) * 1440; t += 30) out.push(row(t, t + 30, `s${t}`));
      return out;
    };
    const buckets = [day - 1, day, day + 1].map((d) => buildEpgBucket('c', d, slots(d)));
    const at = NOW + 7 * MIN;
    const slot = (min: number): number => min - (((min % 30) + 30) % 30);
    for (const shift of [-2, -1, 0, 1, 2.5]) {
      const guideNow = slot(Math.floor(at / MIN) - Math.round(shift * 60));
      for (const order of [buckets, buckets.slice().reverse(), [buckets[1]!, buckets[2]!, buckets[0]!]]) {
        const got = epgNowNext(order, at, shift);
        expect(got.now?.title, `shift ${shift}`).toBe(`s${guideNow}`);
        expect(got.next?.title, `shift ${shift}`).toBe(`s${guideNow + 30}`);
        expect(got.next!.start).toBe(guideNow + 30 + Math.round(shift * 60));
      }
    }
  });
});

describe('epgSchedule', () => {
  const row = (start: number, end: number, title: string): EpgProgramme => ({ start, end, title, sub: '', desc: '', category: '', episode: '', flags: 0 });
  const day = Math.floor(nowMin / 1440);
  const show = (s: { start: number[]; end: number[]; title: string[] }): string[] => s.start.map((t, i) => `${t - nowMin}..${s.end[i]! - nowMin} ${s.title[i]}`);

  it('keeps the programmes that overlap the range, uncut, as plain arrays', () => {
    const b = buildEpgBucket('c', day, [row(nowMin - 60, nowMin, 'ends at from'), row(nowMin, nowMin + 30, 'a'), row(nowMin + 30, nowMin + 61, 'b'), row(nowMin + 61, nowMin + 90, 'starts at to')]);
    const got = epgSchedule([b], nowMin, nowMin + 61);
    expect(show(got)).toEqual(['0..30 a', '30..61 b']);
    expect(Array.isArray(got.start) && Array.isArray(got.end)).toBe(true);
    // One minute either side takes in the neighbours.
    expect(show(epgSchedule([b], nowMin - 1, nowMin + 62))).toEqual(['-60..0 ends at from', '0..30 a', '30..61 b', '61..90 starts at to']);
    expect(show(epgSchedule([b], nowMin + 29, nowMin + 30))).toEqual(['0..30 a']);
  });

  it('gives nothing for an empty range, and an empty title for a missing one', () => {
    const b = buildEpgBucket('c', day, [row(nowMin, nowMin + 30, 'a')]);
    expect(epgSchedule([b], nowMin + 10, nowMin + 10)).toEqual({ start: [], end: [], title: [] });
    expect(epgSchedule([b], nowMin + 20, nowMin + 10)).toEqual({ start: [], end: [], title: [] });
    expect(epgSchedule([], nowMin, nowMin + 60)).toEqual({ start: [], end: [], title: [] });
    const untitled = { ...b, title: [] };
    expect(epgSchedule([untitled], nowMin, nowMin + 60).title).toEqual(['']);
  });

  it('reads the range in guide time and shifts what it gives back', () => {
    const b = buildEpgBucket('c', day, [row(nowMin - 60, nowMin, 'before'), row(nowMin, nowMin + 60, 'on'), row(nowMin + 60, nowMin + 120, 'after')]);
    // An hour later: 'before' runs from now to an hour on.
    expect(show(epgSchedule([b], nowMin, nowMin + 60, 1))).toEqual(['0..60 before']);
    expect(show(epgSchedule([b], nowMin + 59, nowMin + 61, 1))).toEqual(['0..60 before', '60..120 on']);
    // Two and a half hours earlier: 'after' runs from 90 minutes ago to 30 minutes ago.
    expect(show(epgSchedule([b], nowMin - 31, nowMin - 30, -2.5))).toEqual(['-90..-30 after']);
    expect(show(epgSchedule([b], nowMin - 30, nowMin, -2.5))).toEqual([]);
  });

  it('ends a programme running past the next day\'s first where that one starts', () => {
    const midnight = (day + 1) * 1440;
    const today = buildEpgBucket('c', day, [row(midnight - 120, midnight - 60, 'early'), row(midnight - 60, midnight + 90, 'late')]);
    const tomorrow = buildEpgBucket('c', day + 1, [row(midnight + 30, midnight + 60, 'first'), row(midnight + 60, midnight + 120, 'second')]);
    const at = (s: { start: number[]; end: number[]; title: string[] }): string[] => s.start.map((t, i) => `${t - midnight}..${s.end[i]! - midnight} ${s.title[i]}`);
    expect(at(epgSchedule([today, tomorrow], midnight - 120, midnight + 120))).toEqual(['-120..-60 early', '-60..30 late', '30..60 first', '60..120 second']);
    // Cut, 'late' ends at 30: a range from 30 on doesn't hold it, one from 29 does.
    expect(at(epgSchedule([today, tomorrow], midnight + 30, midnight + 45))).toEqual(['30..60 first']);
    expect(at(epgSchedule([today, tomorrow], midnight + 29, midnight + 30))).toEqual(['-60..30 late']);
    // A range that ends before 'first' still gets 'late' cut where 'first' starts.
    expect(at(epgSchedule([today, tomorrow], midnight - 10, midnight))).toEqual(['-60..30 late']);
    // Shifted an hour, the same cut, an hour later.
    expect(at(epgSchedule([today, tomorrow], midnight + 89, midnight + 90, 1))).toEqual(['0..90 late']);
    expect(at(epgSchedule([today, tomorrow], midnight + 90, midnight + 91, 1))).toEqual(['90..120 first']);
  });

  it('equals the guide cut by each next programme and filtered, for any days, range and shift', () => {
    // A day's programmes: sorted distinct starts in the day, none running into the next of the
    // same day, the last one up to 24 h long (it can run into the next day's).
    const dayRows = (d: number) =>
      fc.uniqueArray(fc.integer({ min: 0, max: 1439 }), { maxLength: 8 }).chain((offsets) => {
        const starts = [...offsets].sort((a, b) => a - b).map((o) => d * 1440 + o);
        return fc.tuple(...starts.map((s, i) => fc.integer({ min: 1, max: i + 1 < starts.length ? starts[i + 1]! - s : 1440 }))).map((lengths) =>
          starts.map((s, i) => row(s, s + lengths[i]!, `${d}.${i}`)),
        );
      });
    const first = 20_000;
    const input = fc.record({
      days: fc.tuple(dayRows(first), dayRows(first + 1), dayRows(first + 2), dayRows(first + 3)),
      present: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
      from: fc.integer({ min: (first - 1) * 1440, max: (first + 5) * 1440 }),
      length: fc.integer({ min: 1, max: 3 * 1440 }),
      shift: fc.constantFrom(0, 1, -1, 2.5, -3.25, 14),
    });
    fc.assert(
      fc.property(input, ({ days, present, from, length, shift }) => {
        const buckets = days.map((rows, i) => buildEpgBucket('c', first + i, rows.slice())).filter((_, i) => present[i]);
        const to = from + length;
        const s = Math.round(shift * 60);
        const all = buckets.flatMap((b) => epgProgrammes(b));
        const want: string[] = [];
        all.forEach((p, i) => {
          const next = all[i + 1];
          const end = next !== undefined && next.start < p.end ? next.start : p.end;
          if (p.start + s < to && end + s > from) want.push(`${p.start + s}..${end + s} ${p.title}`);
        });
        const got = epgSchedule(buckets, from, to, shift);
        expect(got.start.map((t, i) => `${t}..${got.end[i]} ${got.title[i]}`)).toEqual(want);
        for (let i = 0; i + 1 < got.start.length; i++) expect(got.end[i]!).toBeLessThanOrEqual(got.start[i + 1]!);
      }),
      { numRuns: 1000 },
    );
  });
});
