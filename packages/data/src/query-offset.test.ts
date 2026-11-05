// The user's time offset per guide (RELAY step 24b): `QueryService` adds it to the tvg-shift in
// now/next, the grid's rows and the programme details, over guides written straight into the
// store. The offsets come from the profile at each reload, and an `editProfile` applies them at once.

import type { EpgMatchMethod, EpgProgramme } from '@zoma/core';
import { buildEpgBucket, epgDay } from '@zoma/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredEpgMatch } from './epg-store';
import { beginEpgGeneration, commitEpgGeneration, putEpgBuckets, putEpgChannels } from './epg-store';
import { openDatabase } from './idb';
import { emptyProfile, saveProfile } from './profile';
import type { EpgNowNext, GuideRow } from './query-service';
import { QueryService } from './query-service';
import { freshFactory } from './test-support';

const MIN = 60_000;
/** 2026-11-02 12:00 UTC, in epoch minutes. */
const NOW = Date.UTC(2026, 10, 2, 12) / MIN;
const MIDNIGHT = epgDay(NOW) * 1440;

const row = (start: number, end: number, title: string): EpgProgramme => ({ start, end, title, sub: '', desc: `About ${title}`, category: '', episode: '', flags: 0 });

/** `slot`-minute programmes from `from` to `to` (epoch minutes), titled `<tag><start - NOW>`. */
function slots(from: number, to: number, slot: number, tag: string): EpgProgramme[] {
  const out: EpgProgramme[] = [];
  for (let t = from; t < to; t += slot) out.push(row(t, t + slot, `${tag}${t - NOW}`));
  return out;
}

const match = (key: string, channel: string, method: EpgMatchMethod, shift = 0): StoredEpgMatch => ({ key, channel, method, ambiguous: false, shift });

/** Writes and commits a generation of `epgSrc`: each channel's rows, bucketed by the UTC day of their start. */
async function storeGuide(db: IDBDatabase, epgSrc: string, rank: number, matches: StoredEpgMatch[], channels: Record<string, EpgProgramme[]>): Promise<void> {
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
}

/** A programme as `<start - NOW>..<end - NOW> <title>`. */
const at = (p: EpgProgramme | null): string | null => (p === null ? null : `${p.start - NOW}..${p.end - NOW} ${p.title}`);
const nowOf = (n: EpgNowNext[]): (string | null)[] => n.map((x) => at(x.now));
const cells = (r: GuideRow): string[] => r.start.map((t, i) => `${t - NOW}..${r.end[i]! - NOW} ${r.title[i]}`);

let db: IDBDatabase;
let q: QueryService;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
  q = new QueryService({ openDb: async () => db, now: () => NOW * MIN });
});
afterEach(() => {
  db.close();
});

const offset = (epgSrc: string, minutes: number): Promise<boolean> => q.editProfile({ kind: 'epgOffset', epgSrc, minutes });

describe("QueryService: the guides' time offsets (step 24b)", () => {
  beforeEach(async () => {
    // `a` and its +1 variant `b` share one guide channel; `c` comes from another guide.
    await storeGuide(db, 'g', 0, [match('a', 'a.tv', 'id'), match('b', 'a.tv', 'id', 1)], { 'a.tv': slots(MIDNIGHT - 2880, MIDNIGHT + 4320, 60, 'a') });
    await storeGuide(db, 'h', 1, [match('c', 'c.tv', 'id')], { 'c.tv': slots(MIDNIGHT - 2880, MIDNIGHT + 4320, 60, 'c') });
  });

  it("adds the guide's offset to the tvg-shift in now/next, the grid and the details, for that guide only", async () => {
    expect(nowOf(await q.nowNext(['a', 'b', 'c']))).toEqual(['0..60 a0', '0..60 a-60', '0..60 c0']);

    expect(await offset('g', 90)).toBe(true);
    // An hour and a half later: at 12:00 the guide's 10:30 is on (its 10:00 programme), and `b` has its hour too.
    const nn = await q.nowNext(['a', 'b', 'c']);
    expect(nowOf(nn)).toEqual(['-30..30 a-120', '-30..30 a-180', '0..60 c0']);
    expect(nn.map((x) => at(x.next))).toEqual(['30..90 a-60', '30..90 a-120', '60..120 c60']);

    const rows = await q.guide({ keys: ['a', 'b', 'c'], from: NOW - 60, to: NOW + 60 });
    expect(cells(rows[0]!)).toEqual(['-90..-30 a-180', '-30..30 a-120', '30..90 a-60']);
    expect(cells(rows[1]!)).toEqual(['-90..-30 a-240', '-30..30 a-180', '30..90 a-120']);
    expect(cells(rows[2]!)).toEqual(['-60..0 c-60', '0..60 c0']);

    // The details find a programme at the start the grid shows, and none at the start without the offset.
    expect(at(await q.programme({ key: 'a', start: NOW - 30 }))).toBe('-30..30 a-120');
    expect((await q.programme({ key: 'a', start: NOW - 30 }))!.desc).toBe('About a-120');
    expect(at(await q.programme({ key: 'b', start: NOW + 30 }))).toBe('30..90 a-120');
    expect(await q.programme({ key: 'a', start: NOW })).toBeNull();
    expect(at(await q.programme({ key: 'c', start: NOW }))).toBe('0..60 c0');

    // Earlier, and then none again.
    expect(await offset('g', -30)).toBe(true);
    expect(nowOf(await q.nowNext(['a', 'b']))).toEqual(['-30..30 a0', '-30..30 a-60']);
    expect(await offset('g', 0)).toBe(true);
    expect(nowOf(await q.nowNext(['a', 'b', 'c']))).toEqual(['0..60 a0', '0..60 a-60', '0..60 c0']);
    expect(cells((await q.guide({ keys: ['a'], from: NOW, to: NOW + 60 }))[0]!)).toEqual(['0..60 a0']);
  });

  it('reads the offsets stored in the profile at the first read, and again at each reload', async () => {
    await saveProfile(db, { ...emptyProfile(), epgOffsets: { h: 60 } }, { now: NOW * MIN });
    expect(nowOf(await q.nowNext(['a', 'c']))).toEqual(['0..60 a0', '0..60 c-60']);
    // Written by someone else (another worker): the next reload reads it.
    await saveProfile(db, { ...emptyProfile(), epgOffsets: { g: 30, h: -60 } }, { now: NOW * MIN });
    expect(nowOf(await q.nowNext(['a', 'c']))).toEqual(['0..60 a0', '0..60 c-60']);
    await q.reload();
    expect(nowOf(await q.nowNext(['a', 'c']))).toEqual(['-30..30 a-60', '0..60 c60']);
  });

  it('keeps the offsets when an edit writes nothing; an edit of another kind keeps them too', async () => {
    expect(await offset('g', 60)).toBe(true);
    expect(await offset('g', 60)).toBe(false);
    expect(await offset('g', 45)).toBe(false);
    expect(await offset('g', 750)).toBe(false);
    expect(nowOf(await q.nowNext(['a']))).toEqual(['0..60 a-60']);
    expect(await q.editProfile({ kind: 'answers', answers: { language: 'ar' } })).toBe(true);
    expect(nowOf(await q.nowNext(['a']))).toEqual(['0..60 a-60']);
  });

  it("drops a removed guide's offset at once (its records stay until the refresh deletes them)", async () => {
    await storeGuide(db, 'u~g1', 2, [match('d', 'd.tv', 'id')], { 'd.tv': slots(MIDNIGHT - 2880, MIDNIGHT + 4320, 60, 'd') });
    await q.editProfile({ kind: 'guide', change: { op: 'add', guide: { id: 'g1', url: 'http://g.test/g1.xml' } } });
    expect(await offset('u~g1', 120)).toBe(true);
    expect(nowOf(await q.nowNext(['d']))).toEqual(['0..60 d-120']);
    expect(await q.editProfile({ kind: 'guide', change: { op: 'remove', id: 'g1' } })).toBe(true);
    expect(nowOf(await q.nowNext(['d']))).toEqual(['0..60 d0']);
  });

  it('never lets a read of the offsets that went out before an edit undo it', async () => {
    // The reload reads the profile first, then the catalogs and the guides; the edit is written
    // after that read, and lands before the reload ends.
    const reload = q.reload();
    const edit = offset('g', 60);
    expect(await edit).toBe(true);
    await reload;
    expect(nowOf(await q.nowNext(['a']))).toEqual(['0..60 a-60']);
    // A reload that starts after the edit reads it from the profile.
    await q.reload();
    expect(nowOf(await q.nowNext(['a']))).toEqual(['0..60 a-60']);
  });
});

describe('QueryService: every offset, across midnight, is the guide read at the shifted time', () => {
  // 70-minute programmes start at every minute of the hour over the days, so many cross midnight.
  const programmes = slots(MIDNIGHT - 4 * 1440, MIDNIGHT + 4 * 1440, 70, 'x');
  // tvg-shift in hours: none, two and a half hours early, and 2.05 h (122.99999999999999 minutes: rounded, not cut).
  const shifts: Record<string, { hours: number; minutes: number }> = { x: { hours: 0, minutes: 0 }, y: { hours: -2.5, minutes: -150 }, z: { hours: 2.05, minutes: 123 } };

  /** The programmes shifted by `shift` minutes that overlap `[from, to)`. */
  const expected = (shift: number, from: number, to: number): string[] =>
    programmes.filter((p) => p.end + shift > from && p.start + shift < to).map((p) => `${p.start + shift - NOW}..${p.end + shift - NOW} ${p.title}`);

  it('holds for each step from -12 h to +12 h, at times either side of midnight', async () => {
    await storeGuide(db, 'g', 0, [match('x', 'x.tv', 'id'), match('y', 'x.tv', 'id', -2.5), match('z', 'x.tv', 'id', 2.05)], { 'x.tv': programmes });
    const keys = Object.keys(shifts);
    const times = [MIDNIGHT - 1, MIDNIGHT, MIDNIGHT + 25, NOW, MIDNIGHT + 1440 - 5];
    let checked = 0;
    for (let minutes = -720; minutes <= 720; minutes += 30) {
      await offset('g', minutes);
      for (const t of times) {
        const nn = await q.nowNext(keys, t * MIN);
        const rows = await q.guide({ keys, from: t - 90, to: t + 90 });
        for (let i = 0; i < keys.length; i += 1) {
          const shift = shifts[keys[i]!]!.minutes + minutes;
          const on = expected(shift, t, t + 1);
          expect(on, `${keys[i]} ${minutes} at ${t - MIDNIGHT}`).toHaveLength(1);
          expect(at(nn[i]!.now), `${keys[i]} ${minutes} at ${t - MIDNIGHT}`).toBe(on[0]);
          expect(cells(rows[i]!), `${keys[i]} ${minutes} at ${t - MIDNIGHT}`).toEqual(expected(shift, t - 90, t + 90));
          checked += 1;
        }
      }
      // The details of the programme on air at midnight, for the 2.05 h variant.
      const z = (await q.nowNext(['z'], MIDNIGHT * MIN))[0]!.now!;
      expect(at(await q.programme({ key: 'z', start: z.start }))).toBe(at(z));
    }
    expect(checked).toBe(49 * times.length * keys.length);
  });
});
