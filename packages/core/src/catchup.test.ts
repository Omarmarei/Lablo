import { describe, expect, it } from 'vitest';
import { catchupMode, fillCatchupTemplate, flussonicCatchupUrl, m3uCatchupUrl, xtreamCatchupUrl } from './catchup';
import type { CatchupInfo } from './model';
import { fixedZone, intlZone } from './timezone';

// Programme 10:30-11:15 UTC on 2026-11-02; now is 12:00 UTC.
const START = Date.UTC(2026, 10, 2, 10, 30);
const END = Date.UTC(2026, 10, 2, 11, 15);
const NOW = Date.UTC(2026, 10, 2, 12, 0);
const S = START / 1000;
const E = END / 1000;
const N = NOW / 1000;
const window = { startMs: START, endMs: END, nowMs: NOW };

const info = (mode: string | null, source: string | null = null, days: number | null = 3): CatchupInfo => ({ mode, days, source });
const LIVE = 'http://p.test:8080/live/zoma/zoma-test/101.ts';

describe('catchupMode', () => {
  it.each([
    ['shift', null, LIVE, 'shift'],
    ['timeshift', null, LIVE, 'shift'],
    ['flussonic', null, LIVE, 'flussonic'],
    ['flussonic-hls', null, LIVE, 'flussonic-hls'],
    ['flussonic-ts', null, LIVE, 'flussonic-ts'],
    ['fs', null, LIVE, 'flussonic-ts'],
    ['xc', null, LIVE, 'xc'],
    ['xtream', null, LIVE, 'xc'],
    ['default', 'http://a.test/{utc}', LIVE, 'default'],
    ['vod', 'http://a.test/{utc}', LIVE, 'default'],
    ['default', '?utc={utc}', LIVE, 'append'],
    ['append', '?utc={utc}', LIVE, 'append'],
    ['append', 'http://a.test/{utc}', LIVE, 'default'],
    // No mode, or a mode missing its source: inferred (ADR-010).
    [null, 'http://a.test/{utc}', LIVE, 'default'],
    [null, '&utc={utc}', LIVE, 'append'],
    [null, null, LIVE, 'xc'],
    ['default', null, LIVE, 'xc'],
    [null, null, 'http://cdn.test/channel/stream.m3u8', 'shift'],
    [null, null, 'http://p.test/movie/u/p/1.mp4', 'shift'],
    ['mystery', null, LIVE, null],
  ])('mode %j with source %j on %s → %j', (mode, source, url, expected) => {
    expect(catchupMode(info(mode, source), url)).toBe(expected);
  });
});

describe('fillCatchupTemplate', () => {
  it('fills every placeholder', () => {
    const t = '{utc}|${start}|{utcend}|${end}|{lutc}|${now}|${timestamp}|{duration}|${duration}|{duration:60}|{offset}|${offset}|{offset:60}';
    expect(fillCatchupTemplate(t, window)).toBe(`${S}|${S}|${E}|${E}|${N}|${N}|${N}|2700|2700|45|5400|5400|90`);
    expect(fillCatchupTemplate('/{Y}/{m}/{d}/{H}-{M}-{S}.ts', window)).toBe('/2026/11/02/10-30-00.ts');
    expect(fillCatchupTemplate('{utc:Y-m-d H:M:S}~{utcend:YmdHMS}~{lutc:H.M}', window)).toBe('2026-11-02 10:30:00~20261102111500~12.00');
  });

  it('writes date parts in the given zone', () => {
    expect(fillCatchupTemplate('{Y}{m}{d}{H}{M}|{utc:H:M}', window, fixedZone(345))).toBe('202611021615|16:15');
    expect(fillCatchupTemplate('{H}', window, intlZone('America/New_York')!)).toBe('05');
  });

  it('leaves unknown placeholders and bad divisors as written', () => {
    expect(fillCatchupTemplate('{catchup-id}{foo}{duration:0}{duration:x}{y}', window)).toBe('{catchup-id}{foo}{duration:0}{duration:x}{y}');
  });
});

describe('xtreamCatchupUrl', () => {
  const account = { base: 'http://p.test:8080', username: 'special+user@zoma.test', password: 'p@ss/w0rd&?# é' };

  it('writes the start as wall time in the panel zone, cut to the minute', () => {
    const u = 'special%2Buser%40zoma.test';
    const p = 'p%40ss%2Fw0rd%26%3F%23%20%C3%A9';
    expect(xtreamCatchupUrl(account, 101, window, fixedZone(0))).toBe(`http://p.test:8080/timeshift/${u}/${p}/45/2026-11-02:10-30/101.ts`);
    expect(xtreamCatchupUrl(account, '101', window, fixedZone(345), 'm3u8')).toBe(`http://p.test:8080/timeshift/${u}/${p}/45/2026-11-02:16-15/101.m3u8`);
    // A start at 10:30:40 is cut to 10:30 and the length grows to still reach the end.
    const odd = { ...window, startMs: START + 40_000, endMs: END + 10_000 };
    expect(xtreamCatchupUrl(account, 1, odd, fixedZone(-300))).toMatch(/\/46\/2026-11-02:05-30\/1\.ts$/);
  });
});

describe('flussonicCatchupUrl', () => {
  it('builds each form from HLS and TS live URLs, keeping the query', () => {
    const hls = 'http://f.test/u/p/106/index.m3u8?token=abc';
    const ts = 'http://f.test/u/p/106/mpegts';
    expect(flussonicCatchupUrl(hls, window)).toBe(`http://f.test/u/p/106/index-${S}-2700.m3u8?token=abc`);
    expect(flussonicCatchupUrl(ts, window)).toBe(`http://f.test/u/p/106/timeshift_abs-${S}.ts`);
    expect(flussonicCatchupUrl(ts, window, 'archive')).toBe(`http://f.test/u/p/106/archive-${S}-2700.ts`);
    expect(flussonicCatchupUrl(ts, window, 'hls')).toBe(`http://f.test/u/p/106/index-${S}-2700.m3u8`);
    expect(flussonicCatchupUrl('http://f.test/ch1/video.m3u8', window)).toBe(`http://f.test/ch1/video-${S}-2700.m3u8`);
    expect(flussonicCatchupUrl('http://f.test/ch1', window)).toBe(`http://f.test/ch1/timeshift_abs-${S}.ts`);
    expect(flussonicCatchupUrl('http://f.test/ch1/', window, 'hls')).toBe(`http://f.test/ch1/index-${S}-2700.m3u8`);
  });

  it('is null for URLs it cannot rewrite', () => {
    expect(flussonicCatchupUrl('http://f.test', window)).toBeNull();
    expect(flussonicCatchupUrl('http://f.test/mpegts', window)).toBeNull();
    expect(flussonicCatchupUrl('/relative/index.m3u8', window)).toBeNull();
  });
});

describe('m3uCatchupUrl', () => {
  it('builds each mode', () => {
    expect(m3uCatchupUrl(LIVE, info('default', 'http://p.test/catchup/u/p/102.ts?start={utc}&end={utcend}'), window)).toBe(
      `http://p.test/catchup/u/p/102.ts?start=${S}&end=${E}`,
    );
    expect(m3uCatchupUrl(LIVE, info('append', '?utc={utc}&lutc={lutc}'), window)).toBe(`${LIVE}?utc=${S}&lutc=${N}`);
    expect(m3uCatchupUrl(`${LIVE}?token=1`, info('append', '?utc={utc}'), window)).toBe(`${LIVE}?token=1&utc=${S}`);
    expect(m3uCatchupUrl(LIVE, info('append', '&utc={utc}'), window)).toBe(`${LIVE}?utc=${S}`);
    expect(m3uCatchupUrl(LIVE, info('shift'), window)).toBe(`${LIVE}?utc=${S}&lutc=${N}`);
    expect(m3uCatchupUrl(`${LIVE}?a=b`, info('shift'), window)).toBe(`${LIVE}?a=b&utc=${S}&lutc=${N}`);
    expect(m3uCatchupUrl('http://f.test/u/p/106/mpegts', info('flussonic'), window)).toBe(`http://f.test/u/p/106/timeshift_abs-${S}.ts`);
    expect(m3uCatchupUrl('http://f.test/u/p/106/mpegts', info('flussonic-hls'), window)).toBe(`http://f.test/u/p/106/index-${S}-2700.m3u8`);
    expect(m3uCatchupUrl('http://f.test/u/p/106/index.m3u8', info('fs'), window)).toBe(`http://f.test/u/p/106/timeshift_abs-${S}.ts`);
    expect(m3uCatchupUrl('http://f.test/u/p/106/mpegts', info('flussonic'), window, { flussonic: 'archive' })).toBe(`http://f.test/u/p/106/archive-${S}-2700.ts`);
    expect(m3uCatchupUrl(LIVE, info('xc'), window, { zone: fixedZone(180) })).toBe('http://p.test:8080/timeshift/zoma/zoma-test/45/2026-11-02:13-30/101.ts');
    expect(m3uCatchupUrl('http://p.test/live/u/p/7.m3u8', info('xc'), window)).toBe('http://p.test/timeshift/u/p/45/2026-11-02:10-30/7.m3u8');
  });

  it('is null without catch-up, for unknown modes and for URLs a mode cannot rewrite', () => {
    expect(m3uCatchupUrl(LIVE, null, window)).toBeNull();
    expect(m3uCatchupUrl(LIVE, info('mystery'), window)).toBeNull();
    expect(m3uCatchupUrl('http://cdn.test/a/b/c.ts', info('xc'), window)).toBeNull();
    expect(m3uCatchupUrl('http://p.test/movie/u/p/1.mp4', info('xc'), window)).toBeNull();
  });
});
