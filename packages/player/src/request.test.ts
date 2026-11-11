import { describe, expect, it } from 'vitest';
import type { ZoneOffset } from '@lablo/core';
import { fixedZone, intlZone } from '@lablo/core';
import { MemorySourceMemory, catchupCandidates, containerOf, orderCandidates, streamCandidates } from './request';

const BASE = 'http://panel.example:8080';

describe('containerOf', () => {
  it('reads the container from the path only', () => {
    expect(containerOf(`${BASE}/live/u/p/1.ts`)).toBe('ts');
    expect(containerOf(`${BASE}/live/u/p/1.M3U8`)).toBe('hls');
    expect(containerOf(`${BASE}/movie/u/p/2.mkv?token=a.ts`)).toBe('mkv');
    expect(containerOf(`${BASE}/movie/u/p/2.mp4#t=1.m3u8`)).toBe('mp4');
    expect(containerOf(`${BASE}/movie/u/p/2.m4v`)).toBe('mp4');
    expect(containerOf(`${BASE}/movie/u/p/2.mov`)).toBe('mp4');
    expect(containerOf('http://cdn.example/channel/mpegts?token=x')).toBe('ts');
    expect(containerOf(`${BASE}/u/p/3`)).toBe('other');
    expect(containerOf(`${BASE}/movie/u/p/4.avi`)).toBe('other');
    // A dot in the host or an earlier segment is not an extension.
    expect(containerOf('http://cdn.example.ts/stream')).toBe('other');
  });
});

describe('streamCandidates (the URL strategy)', () => {
  it('tries .ts first, then .m3u8, for an Xtream live URL', () => {
    expect(streamCandidates(`${BASE}/live/u/p/1.ts`, 'live')).toEqual([
      { url: `${BASE}/live/u/p/1.ts`, container: 'ts' },
      { url: `${BASE}/live/u/p/1.m3u8`, container: 'hls' },
    ]);
    // The playlist's URL keeps its own spelling; the other form is built (and encoded) from it.
    expect(streamCandidates(`${BASE}/live/u@x/p/1.m3u8`, 'live')).toEqual([
      { url: `${BASE}/live/u%40x/p/1.ts`, container: 'ts' },
      { url: `${BASE}/live/u@x/p/1.m3u8`, container: 'hls' },
    ]);
    expect(streamCandidates(`${BASE}/live/u@x/p/1.ts`, 'live')).toEqual([
      { url: `${BASE}/live/u@x/p/1.ts`, container: 'ts' },
      { url: `${BASE}/live/u%40x/p/1.m3u8`, container: 'hls' },
    ]);
  });

  it('plays the short live form as MPEG-TS and adds the /live/ .m3u8 form', () => {
    expect(streamCandidates(`${BASE}/u/p/77`, 'live')).toEqual([
      { url: `${BASE}/u/p/77`, container: 'ts' },
      { url: `${BASE}/live/u/p/77.m3u8`, container: 'hls' },
    ]);
  });

  it("keeps only what the account's allowed_output_formats allow", () => {
    const url = `${BASE}/live/u/p/1.ts`;
    expect(streamCandidates(url, 'live', ['m3u8'])).toEqual([{ url: `${BASE}/live/u/p/1.m3u8`, container: 'hls' }]);
    expect(streamCandidates(url, 'live', ['ts', 'rtmp'])).toEqual([{ url, container: 'ts' }]);
    expect(streamCandidates(url, 'live', ['m3u8', 'ts'])).toHaveLength(2);
    // A list naming neither (or none at all) rules nothing out.
    expect(streamCandidates(url, 'live', ['rtmp'])).toHaveLength(2);
    expect(streamCandidates(url, 'live', [])).toHaveLength(2);
    expect(streamCandidates(url, 'live', null)).toHaveLength(2);
  });

  it('plays anything else as it is', () => {
    const movie = `${BASE}/movie/u/p/5.mp4`;
    expect(streamCandidates(movie, 'vod')).toEqual([{ url: movie, container: 'mp4' }]);
    // Not live mode, even for a live-shaped URL (catch-up).
    expect(streamCandidates(`${BASE}/live/u/p/1.ts`, 'catchup')).toEqual([{ url: `${BASE}/live/u/p/1.ts`, container: 'ts' }]);
    // A live URL that isn't Xtream-shaped, or has another extension.
    expect(streamCandidates('http://cdn.example/channel/index.m3u8', 'live')).toEqual([{ url: 'http://cdn.example/channel/index.m3u8', container: 'hls' }]);
    expect(streamCandidates(`${BASE}/live/u/p/1.mp4`, 'live')).toEqual([{ url: `${BASE}/live/u/p/1.mp4`, container: 'mp4' }]);
    expect(streamCandidates(`${BASE}/movie/u/p/5.ts`, 'live')).toEqual([{ url: `${BASE}/movie/u/p/5.ts`, container: 'ts' }]);
  });
});

describe('orderCandidates and the per-source memory', () => {
  const ts = { url: 'a.ts', container: 'ts' as const };
  const hls = { url: 'a.m3u8', container: 'hls' as const };

  it('puts the remembered container first and keeps the rest in order', () => {
    expect(orderCandidates([ts, hls], 'hls')).toEqual([hls, ts]);
    expect(orderCandidates([ts, hls], 'ts')).toEqual([ts, hls]);
    expect(orderCandidates([ts, hls], 'mp4')).toEqual([ts, hls]);
    const list = [ts, hls];
    const same = orderCandidates(list, null);
    expect(same).toEqual(list);
    expect(same).not.toBe(list);
  });

  it('remembers per source', () => {
    const memory = new MemorySourceMemory();
    expect(memory.preferred('s1')).toBeNull();
    memory.remember('s1', 'hls');
    memory.remember('s2', 'ts');
    expect(memory.preferred('s1')).toBe('hls');
    expect(memory.preferred('s2')).toBe('ts');
    // Not fooled by inherited names.
    expect(memory.preferred('constructor')).toBeNull();
  });
});

describe('catchupCandidates (RELAY step 25a)', () => {
  // 2026-11-03 18:00 to 19:30 UTC (winter in New York), and a July evening (summer).
  const START = Date.UTC(2026, 10, 3, 18, 0);
  const WINDOW = { startMs: START, endMs: START + 90 * 60_000, nowMs: START + 26 * 3_600_000 };
  const XC = { mode: 'xc', days: 7, source: null };

  it("gives an Xtream channel's /timeshift/ URL as .ts, then .m3u8, in UTC by default", () => {
    expect(catchupCandidates(`${BASE}/live/u/p/101.ts`, XC, WINDOW)).toEqual([
      { url: `${BASE}/timeshift/u/p/90/2026-11-03:18-00/101.ts`, container: 'ts' },
      { url: `${BASE}/timeshift/u/p/90/2026-11-03:18-00/101.m3u8`, container: 'hls' },
    ]);
    // The live URL's own form doesn't change the order; credentials are encoded.
    expect(catchupCandidates(`${BASE}/live/u@x/p/101.m3u8`, XC, WINDOW)).toEqual([
      { url: `${BASE}/timeshift/u%40x/p/90/2026-11-03:18-00/101.ts`, container: 'ts' },
      { url: `${BASE}/timeshift/u%40x/p/90/2026-11-03:18-00/101.m3u8`, container: 'hls' },
    ]);
    // The short live form, and an M3U channel with days only (no mode) and an Xtream-shaped URL.
    expect(catchupCandidates(`${BASE}/u/p/101`, XC, WINDOW)[0]!.url).toBe(`${BASE}/timeshift/u/p/90/2026-11-03:18-00/101.ts`);
    expect(catchupCandidates(`${BASE}/live/u/p/101.ts`, { mode: null, days: 3, source: null }, WINDOW)).toHaveLength(2);
  });

  it("writes the start as wall time in the panel's zone, DST included", () => {
    const at = (zone: ZoneOffset, window = WINDOW): string => catchupCandidates(`${BASE}/live/u/p/101.ts`, XC, window, { zone })[0]!.url;
    expect(at(fixedZone(180))).toBe(`${BASE}/timeshift/u/p/90/2026-11-03:21-00/101.ts`);
    // Both forms.
    expect(catchupCandidates(`${BASE}/live/u/p/101.ts`, XC, WINDOW, { zone: fixedZone(180) }).map((c) => c.url)).toEqual([
      `${BASE}/timeshift/u/p/90/2026-11-03:21-00/101.ts`,
      `${BASE}/timeshift/u/p/90/2026-11-03:21-00/101.m3u8`,
    ]);
    expect(at(fixedZone(345))).toBe(`${BASE}/timeshift/u/p/90/2026-11-03:23-45/101.ts`);
    const newYork = intlZone('America/New_York')!;
    expect(at(newYork)).toBe(`${BASE}/timeshift/u/p/90/2026-11-03:13-00/101.ts`);
    const july = Date.UTC(2026, 6, 1, 18, 0);
    expect(at(newYork, { startMs: july, endMs: july + 30 * 60_000, nowMs: july + 3_600_000 })).toBe(`${BASE}/timeshift/u/p/30/2026-07-01:14-00/101.ts`);
  });

  it("keeps to the account's allowed_output_formats as live does", () => {
    const url = `${BASE}/live/u/p/101.ts`;
    expect(catchupCandidates(url, XC, WINDOW, { outputFormats: ['m3u8'] })).toEqual([{ url: `${BASE}/timeshift/u/p/90/2026-11-03:18-00/101.m3u8`, container: 'hls' }]);
    expect(catchupCandidates(url, XC, WINDOW, { outputFormats: ['ts'] })).toEqual([{ url: `${BASE}/timeshift/u/p/90/2026-11-03:18-00/101.ts`, container: 'ts' }]);
    expect(catchupCandidates(url, XC, WINDOW, { outputFormats: ['ts', 'm3u8'] })).toHaveLength(2);
    expect(catchupCandidates(url, XC, WINDOW, { outputFormats: ['rtmp'] })).toHaveLength(2);
    expect(catchupCandidates(url, XC, WINDOW, { outputFormats: null })).toHaveLength(2);
  });

  it('gives the one URL of every other M3U mode, with its container', () => {
    const start = START / 1000;
    const shift = catchupCandidates('http://cdn.example/ch/index.m3u8', { mode: 'shift', days: 1, source: null }, WINDOW);
    expect(shift).toEqual([{ url: `http://cdn.example/ch/index.m3u8?utc=${start}&lutc=${start + 26 * 3600}`, container: 'hls' }]);
    const source = 'http://cdn.example/catchup/7.ts?start={utc}&end={utcend}';
    expect(catchupCandidates('http://cdn.example/live/7', { mode: 'default', days: 3, source }, WINDOW)).toEqual([
      { url: `http://cdn.example/catchup/7.ts?start=${start}&end=${start + 5400}`, container: 'ts' },
    ]);
    // The template's date parts in the zone given.
    const dated = catchupCandidates('http://cdn.example/live/7', { mode: 'default', days: 3, source: 'http://cdn.example/a/{Y}{m}{d}-{H}{M}.ts' }, WINDOW, { zone: fixedZone(180) });
    expect(dated).toEqual([{ url: 'http://cdn.example/a/20261103-2100.ts', container: 'ts' }]);
    expect(catchupCandidates('http://fl.example/ch/index.m3u8', { mode: 'flussonic', days: 2, source: null }, WINDOW)).toEqual([
      { url: `http://fl.example/ch/index-${start}-5400.m3u8`, container: 'hls' },
    ]);
  });

  it('gives none for a channel without catch-up, an unknown mode, or a URL the mode cannot carry', () => {
    expect(catchupCandidates(`${BASE}/live/u/p/101.ts`, null, WINDOW)).toEqual([]);
    expect(catchupCandidates(`${BASE}/live/u/p/101.ts`, { mode: 'archive-ftp', days: 3, source: null }, WINDOW)).toEqual([]);
    // `xc` needs an Xtream live URL.
    expect(catchupCandidates('http://cdn.example/ch/index.m3u8', XC, WINDOW)).toEqual([]);
    expect(catchupCandidates(`${BASE}/movie/u/p/5.mp4`, XC, WINDOW)).toEqual([]);
    // Flussonic needs a channel directory below the host.
    expect(catchupCandidates('http://fl.example/mpegts', { mode: 'flussonic', days: 2, source: null }, WINDOW)).toEqual([]);
  });
});
