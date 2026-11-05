import type { CatalogItem, CatchupInfo } from '@zoma/core';
import { fixedZone } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import type { LiveRow } from '../live/live-state';
import { canWatchFromStart, catchupRequest } from './catchup';

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
