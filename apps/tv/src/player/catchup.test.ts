import type { CatalogItem, CatchupInfo } from '@zoma/core';
import { fixedZone } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import type { LiveRow } from '../live/live-state';
import { archiveDays, archiveDaysLeft, archiveFrom, canWatchFromStart, catchupRequest, inArchive } from './catchup';

const MINUTE_MS = 60_000;
const DAY = 1440;
/** Now: 2026-11-05 12:00 UTC, in minutes. */
const NOW = Date.UTC(2026, 10, 5, 12) / MINUTE_MS;
const NOW_MS = NOW * MINUTE_MS;

function row(catchup: CatchupInfo | null, url = 'http://panel.test:8080/live/u/p/101.ts'): LiveRow {
  const item: CatalogItem = {
    key: 'x:s1:live:101',
    src: 's1',
    kind: 'live',
    name: 'Zoma Test 1',
    normName: '',
    group: '',
    url,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup,
    radio: false,
    hints: null,
  };
  return { item, number: 1 };
}

const XC7: CatchupInfo = { mode: 'xc', days: 7, source: null };
/** A programme of `length` minutes that started `ago` minutes before now. */
const programme = (ago: number, length = 60) => ({ start: NOW - ago, end: NOW - ago + length, title: 'Evening News' });

describe('which programmes can be watched from the start (RELAY step 25a)', () => {
  it('a programme gone by within the archive days, up to the oldest minute the archive keeps', () => {
    expect(canWatchFromStart(row(XC7), programme(120), NOW_MS)).toBe(true);
    // Ended this minute.
    expect(canWatchFromStart(row(XC7), programme(60), NOW_MS)).toBe(true);
    // Started exactly seven days ago, and a minute before that.
    expect(canWatchFromStart(row(XC7), programme(7 * DAY), NOW_MS)).toBe(true);
    expect(canWatchFromStart(row(XC7), programme(7 * DAY + 1), NOW_MS)).toBe(false);
    expect(canWatchFromStart(row({ mode: 'xc', days: 1, source: null }), programme(DAY + 1), NOW_MS)).toBe(false);
  });

  it('not one on air or to come', () => {
    // On air: it ends a minute from now (and a millisecond counts).
    expect(canWatchFromStart(row(XC7), programme(59), NOW_MS)).toBe(false);
    expect(canWatchFromStart(row(XC7), programme(60), NOW_MS - 1)).toBe(false);
    expect(canWatchFromStart(row(XC7), programme(-30), NOW_MS)).toBe(false);
  });

  it('as far back as the guide reaches when the channel states no days', () => {
    expect(canWatchFromStart(row({ mode: 'xc', days: null, source: null }), programme(30 * DAY), NOW_MS)).toBe(true);
  });

  it('not on a channel without catch-up, with an unknown mode, or whose URL the mode cannot carry', () => {
    expect(canWatchFromStart(row(null), programme(120), NOW_MS)).toBe(false);
    expect(canWatchFromStart(row({ mode: 'ftp-archive', days: 3, source: null }), programme(120), NOW_MS)).toBe(false);
    expect(canWatchFromStart(row(XC7, 'http://cdn.example/ch/index.m3u8'), programme(120), NOW_MS)).toBe(false);
    // An M3U mode that can: `shift` on any URL.
    expect(canWatchFromStart(row({ mode: 'shift', days: 1, source: null }, 'http://cdn.example/ch/index.m3u8'), programme(120), NOW_MS)).toBe(true);
  });
});

describe("a programme's catch-up request (RELAY step 25a)", () => {
  it("plays the programme's shown times from the archive, in the panel's zone and the account's formats", () => {
    const p = programme(120, 90);
    expect(catchupRequest(row(XC7), p, { outputFormats: ['m3u8'], zone: fixedZone(180) }, NOW_MS)).toEqual({
      key: 'x:s1:live:101',
      src: 's1',
      mode: 'catchup',
      candidates: [{ url: 'http://panel.test:8080/timeshift/u/p/90/2026-11-05:13-00/101.m3u8', container: 'hls' }],
    });
    // Without the source's facts (not read yet): UTC, both forms.
    expect(catchupRequest(row(XC7), p, undefined, NOW_MS)!.candidates).toEqual([
      { url: 'http://panel.test:8080/timeshift/u/p/90/2026-11-05:10-00/101.ts', container: 'ts' },
      { url: 'http://panel.test:8080/timeshift/u/p/90/2026-11-05:10-00/101.m3u8', container: 'hls' },
    ]);
    // An M3U mode with now in its URL.
    const shift = catchupRequest(row({ mode: 'shift', days: 1, source: null }, 'http://cdn.example/ch/index.m3u8'), p, undefined, NOW_MS)!;
    expect(shift.candidates).toEqual([{ url: `http://cdn.example/ch/index.m3u8?utc=${p.start * 60}&lutc=${NOW * 60}`, container: 'hls' }]);
  });

  it("is null when the channel's URL can't carry one", () => {
    expect(catchupRequest(row(null), programme(120), undefined, NOW_MS)).toBeNull();
    expect(catchupRequest(row(XC7, 'http://cdn.example/ch/index.m3u8'), programme(120), { outputFormats: null, zone: fixedZone(0) }, NOW_MS)).toBeNull();
  });
});

describe("a channel's archive, as the guide marks it (RELAY step 25c)", () => {
  it('holds the stated days, every day the guide reaches when none are stated, and none without a usable URL', () => {
    expect(archiveDays(row(XC7))).toBe(7);
    expect(archiveDays(row({ mode: 'shift', days: 1.5, source: null }))).toBe(1.5);
    expect(archiveDays(row({ mode: 'xc', days: null, source: null }))).toBe(Infinity);
    expect(archiveDays(row(null))).toBeNull();
    expect(archiveDays(row({ mode: 'ftp-archive', days: 3, source: null }))).toBeNull();
    expect(archiveDays(row(XC7, 'http://cdn.example/ch/index.m3u8'))).toBeNull();
  });

  it('starts at the first whole minute the archive keeps', () => {
    expect(archiveFrom(7, NOW_MS)).toBe(NOW - 7 * DAY);
    // Half a minute on: a programme that started at the minute before is half a minute too old.
    expect(archiveFrom(7, NOW_MS + 30_000)).toBe(NOW - 7 * DAY + 1);
    expect(archiveFrom(0.5, NOW_MS)).toBe(NOW - DAY / 2);
    expect(archiveFrom(Infinity, NOW_MS)).toBe(-Infinity);
  });

  it('holds a programme that has ended and started at its first minute or later, as canWatchFromStart', () => {
    const from = archiveFrom(7, NOW_MS);
    for (const [ago, length] of [
      [120, 60],
      [60, 60],
      [59, 60],
      [-30, 60],
      [7 * DAY, 60],
      [7 * DAY + 1, 60],
      [7 * DAY + 1, 2],
    ] as const) {
      const p = programme(ago, length);
      expect(inArchive(from, p, NOW_MS), `${ago} ${length}`).toBe(canWatchFromStart(row(XC7), p, NOW_MS));
    }
    expect(inArchive(from, programme(120), NOW_MS)).toBe(true);
    expect(inArchive(from, programme(7 * DAY + 1), NOW_MS)).toBe(false);
    expect(inArchive(from, programme(59), NOW_MS)).toBe(false);
    expect(inArchive(-Infinity, programme(300 * DAY), NOW_MS)).toBe(true);
  });

  it('counts the local calendar days left before a programme leaves the archive', () => {
    const local = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime();
    const at = (ms: number) => ({ start: Math.floor(ms / MINUTE_MS) });
    const now = local(5, 20, 17);
    // It leaves at 21:00 today, at 19:00 tomorrow, and at 01:00 the day after tomorrow.
    expect(archiveDaysLeft(1, at(local(4, 21)), now)).toBe(0);
    expect(archiveDaysLeft(1, at(local(5, 19)), now)).toBe(1);
    expect(archiveDaysLeft(7, at(local(5, 19)), now)).toBe(7);
    expect(archiveDaysLeft(2, at(local(5, 1)), now)).toBe(2);
    expect(archiveDaysLeft(1, at(local(5, 1)), now)).toBe(1);
    // Left already (the guide never asks then): no fewer than none.
    expect(archiveDaysLeft(1, at(local(3, 19)), now)).toBe(0);
    expect(archiveDaysLeft(Infinity, at(local(5, 19)), now)).toBeNull();
  });

  it('counts whole days across a change of daylight saving time', () => {
    // 2026-03-29 and 2026-10-25 change the clocks in Europe, 2026-03-08 and 2026-11-01 in North America.
    for (const [month, day] of [
      [2, 29],
      [9, 25],
      [2, 8],
      [10, 1],
    ] as const) {
      const now = new Date(2026, month, day - 2, 12).getTime();
      const start = Math.floor(new Date(2026, month, day - 3, 23, 30).getTime() / MINUTE_MS);
      // Seven days of archive from 23:30 three days before the change: it leaves about 23:30 four days after it.
      const leaves = new Date(start * MINUTE_MS + 7 * 86_400_000);
      const want = Math.round((Date.UTC(leaves.getFullYear(), leaves.getMonth(), leaves.getDate()) - Date.UTC(2026, month, day - 2)) / 86_400_000);
      expect(archiveDaysLeft(7, { start }, now)).toBe(want);
      expect(Number.isInteger(want)).toBe(true);
    }
  });
});
