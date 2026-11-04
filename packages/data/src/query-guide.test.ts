// The grid guide's read (RELAY step 23a): `QueryService.guide` over guides written straight into
// the store, so each case controls the days, the shifts and the match methods. The refresh's own
// buckets are checked against now/next in epg-ingest.test.ts.

import type { EpgMatchMethod, EpgProgramme } from '@zoma/core';
import { buildEpgBucket, epgDay } from '@zoma/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredEpgMatch } from './epg-store';
import { beginEpgGeneration, commitEpgGeneration, deleteEpgGeneration, putEpgBuckets, putEpgChannels } from './epg-store';
import { openDatabase } from './idb';
import type { GuideRow } from './query-service';
import { GUIDE_MAX_READS, QueryService } from './query-service';
import { freshFactory } from './test-support';

const MIN = 60_000;
/** 2026-11-02 12:00 UTC, in epoch minutes. */
const NOW = Date.UTC(2026, 10, 2, 12) / MIN;
const DAY = epgDay(NOW);
const MIDNIGHT = DAY * 1440;

const row = (start: number, end: number, title: string): EpgProgramme => ({ start, end, title, sub: '', desc: `About ${title}`, category: '', episode: '', flags: 0 });

/** `slot`-minute programmes of `channel` from `from` to `to` (epoch minutes), titled `<tag><start - NOW>`. */
function slots(from: number, to: number, slot: number, tag: string): EpgProgramme[] {
  const out: EpgProgramme[] = [];
  for (let t = from; t < to; t += slot) out.push(row(t, t + slot, `${tag}${t - NOW}`));
  return out;
}

const match = (key: string, channel: string, method: EpgMatchMethod, shift = 0): StoredEpgMatch => ({ key, channel, method, ambiguous: false, shift });

/** Writes and commits a generation of `epgSrc`: each channel's rows, bucketed by the UTC day of their start. */
async function storeGuide(db: IDBDatabase, epgSrc: string, rank: number, matches: StoredEpgMatch[], channels: Record<string, EpgProgramme[]>): Promise<number> {
  const gen = await beginEpgGeneration(db, epgSrc, rank);
  for (const [channel, rows] of Object.entries(channels)) {
    const days = new Map<number, EpgProgramme[]>();
    for (const r of rows) days.set(epgDay(r.start), [...(days.get(epgDay(r.start)) ?? []), r]);
    await putEpgBuckets(
      db,
      epgSrc,
      gen,
      [...days].map(([day, list]) => buildEpgBucket(channel, day, list)),
    );
  }
  await putEpgChannels(db, epgSrc, gen, { matches, channels: [], unmatched: [] });
  await commitEpgGeneration(db, epgSrc, gen, NOW * MIN, { rank });
  return gen;
}

const show = (r: GuideRow): string[] => r.start.map((t, i) => `${t - NOW}..${r.end[i]! - NOW} ${r.title[i]}`);

let db: IDBDatabase;
let q: QueryService;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
  q = new QueryService({ openDb: async () => db, now: () => NOW * MIN });
});
afterEach(() => {
  db.close();
});

describe('QueryService.guide', () => {
  it('gives each channel its programmes over the range, from the guide its now/next comes from', async () => {
    // The user's guide is listed first, but the panel's matches `a` by id: the stronger method wins,
    // as for now/next. `b` (by name, one hour later) only in the user's guide; `c` only in the panel's.
    await storeGuide(db, 'u~g1', 0, [match('a', 'user.a', 'match-name'), match('b', 'user.b', 'name', 1)], {
      'user.a': slots(MIDNIGHT - 1440, MIDNIGHT + 2880, 60, 'ua'),
      'user.b': slots(MIDNIGHT - 1440, MIDNIGHT + 2880, 45, 'ub'),
    });
    await storeGuide(db, 'tv:xmltv', 1, [match('a', 'panel.a', 'xtream-id'), match('c', 'panel.c', 'id'), match('b', 'panel.b', 'match-name')], {
      'panel.a': slots(MIDNIGHT - 1440, MIDNIGHT + 2880, 30, 'pa'),
      'panel.b': slots(MIDNIGHT - 1440, MIDNIGHT + 2880, 30, 'pb'),
      'panel.c': slots(MIDNIGHT - 1440, MIDNIGHT + 2880, 90, 'pc'),
    });
    const rows = await q.guide({ keys: ['a', 'b', 'c', 'nothing'], from: NOW - 20, to: NOW + 60 });
    expect(rows.map((r) => [r.key, r.epgSrc])).toEqual([
      ['a', 'tv:xmltv'],
      ['b', 'u~g1'],
      ['c', 'tv:xmltv'],
      ['nothing', null],
    ]);
    expect(show(rows[0]!)).toEqual(['-30..0 pa-30', '0..30 pa0', '30..60 pa30']);
    // `b` runs an hour late: its guide's 10:30 programme (titled from guide time) is on at 11:30.
    expect(show(rows[1]!)).toEqual(['-30..15 ub-90', '15..60 ub-45']);
    expect(show(rows[2]!)).toEqual(['-90..0 pc-90', '0..90 pc0']);
    expect(rows[3]).toEqual({ key: 'nothing', epgSrc: null, start: [], end: [], title: [] });

    // Titles only, as plain arrays: the grid's code never touches a typed array.
    expect(Object.keys(rows[0]!).sort()).toEqual(['end', 'epgSrc', 'key', 'start', 'title']);
    expect(Array.isArray(rows[0]!.start) && Array.isArray(rows[0]!.end)).toBe(true);

    // Every minute agrees with now/next.
    for (let t = NOW - 20; t < NOW + 60; t += 5) {
      const nn = await q.nowNext(['a', 'b', 'c'], t * MIN);
      nn.forEach((n, i) => {
        const r = rows[i]!;
        const on = r.start.findIndex((s, j) => s <= t && t < r.end[j]!);
        expect(n.epgSrc).toBe(r.epgSrc);
        expect({ start: r.start[on], end: r.end[on], title: r.title[on] }, `${r.key} at ${t - NOW}`).toEqual({ start: n.now!.start, end: n.now!.end, title: n.now!.title });
        if (on + 1 < r.start.length) expect(r.title[on + 1]).toBe(n.next!.title);
      });
    }
  });

  it("reads the day before the range, and the days it covers in the channel's own time", async () => {
    await storeGuide(db, 'g', 0, [match('a', 'a.tv', 'id'), match('east', 'a.tv', 'id', -3), match('west', 'w.tv', 'id', 1)], {
      // 22:00 the day before to 01:00, then hourly for two days.
      'a.tv': [row(MIDNIGHT - 120, MIDNIGHT + 60, 'late'), ...slots(MIDNIGHT + 60, MIDNIGHT + 2880, 60, 'h')],
      // 24 hours from ten to midnight the day before.
      'w.tv': [row(MIDNIGHT - 10, MIDNIGHT + 1430, 'day')],
    });
    // On at 00:30, but stored under the day before.
    const [a] = await q.guide({ keys: ['a'], from: MIDNIGHT + 30, to: MIDNIGHT + 90 });
    expect(a!.start.map((t) => t - MIDNIGHT)).toEqual([-120, 60]);
    expect(a!.title[0]).toBe('late');
    // Three hours early: 23:00 to midnight is the guide's 02:00 to 03:00 on the next day.
    const [east] = await q.guide({ keys: ['east'], from: MIDNIGHT + 1440 - 60, to: MIDNIGHT + 1440 });
    expect(east!.start.map((t) => t - MIDNIGHT)).toEqual([1440 - 60]);
    expect(east!.title).toEqual([`h${MIDNIGHT + 1440 + 120 - NOW}`]);
    // An hour late: 00:20 to 00:40 tomorrow is the guide's 23:20 to 23:40 today, when the programme
    // stored under the day before is still on.
    const [west] = await q.guide({ keys: ['west'], from: MIDNIGHT + 1440 + 20, to: MIDNIGHT + 1440 + 40 });
    expect(west).toMatchObject({ start: [MIDNIGHT + 50], end: [MIDNIGHT + 1490], title: ['day'] });
    // A range over three days reads them all.
    const [all] = await q.guide({ keys: ['a'], from: MIDNIGHT - 60, to: MIDNIGHT + 2880 });
    expect(all!.start).toHaveLength(1 + 47);
    expect(all!.end.at(-1)).toBe(MIDNIGHT + 2880);
  });

  it('gives a matched channel its guide and no programme for an empty range', async () => {
    await storeGuide(db, 'g', 0, [match('a', 'a.tv', 'id')], { 'a.tv': slots(MIDNIGHT, MIDNIGHT + 1440, 60, 'h') });
    expect(await q.guide({ keys: ['a'], from: NOW, to: NOW })).toEqual([{ key: 'a', epgSrc: 'g', start: [], end: [], title: [] }]);
    expect(await q.guide({ keys: [], from: NOW, to: NOW + 60 })).toEqual([]);
  });

  it(`refuses an ask of more than ${GUIDE_MAX_READS} channel-days, counted over every channel`, async () => {
    await storeGuide(db, 'g', 0, [match('a', 'a.tv', 'id'), match('b', 'b.tv', 'id')], { 'a.tv': slots(MIDNIGHT, MIDNIGHT + 120, 60, 'h') });
    // Each channel reads the range's days and the one before.
    const days = (n: number): { from: number; to: number } => ({ from: MIDNIGHT, to: MIDNIGHT + (n - 1) * 1440 });
    const [one] = await q.guide({ keys: ['a', 'nothing'], ...days(GUIDE_MAX_READS) });
    expect(one!.start).toHaveLength(2);
    await expect(q.guide({ keys: ['a'], from: MIDNIGHT, to: MIDNIGHT + (GUIDE_MAX_READS - 1) * 1440 + 1 })).rejects.toThrow(RangeError);
    // Half each for two channels is fine; one day more each is over.
    expect(await q.guide({ keys: ['a', 'b'], ...days(GUIDE_MAX_READS / 2) })).toHaveLength(2);
    await expect(q.guide({ keys: ['a', 'b'], ...days(GUIDE_MAX_READS / 2 + 1) })).rejects.toThrow(`more than ${GUIDE_MAX_READS} channel-days`);
  });

  it('reads the new generation once the worker reloads', async () => {
    await storeGuide(db, 'g', 0, [match('a', 'a.tv', 'id')], { 'a.tv': slots(MIDNIGHT, MIDNIGHT + 1440, 60, 'old') });
    const before = await q.guide({ keys: ['a'], from: NOW, to: NOW + 60 });
    expect(before[0]!.title).toEqual(['old0']);
    await storeGuide(db, 'g', 0, [match('a', 'a.tv', 'id')], { 'a.tv': slots(MIDNIGHT, MIDNIGHT + 1440, 60, 'new') });
    expect((await q.guide({ keys: ['a'], from: NOW, to: NOW + 60 }))[0]!.title).toEqual(['old0']);
    await q.reload();
    expect((await q.guide({ keys: ['a'], from: NOW, to: NOW + 60 }))[0]!.title).toEqual(['new0']);
    // The old generation deleted, as the refresh does after the swap: nothing reads it any more.
    await deleteEpgGeneration(db, 'g', 1);
    expect((await q.guide({ keys: ['a'], from: NOW, to: NOW + 60 }))[0]!.title).toEqual(['new0']);
  });
});
