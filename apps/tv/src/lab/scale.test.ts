import { DB_NAME } from '@zoma/data';
import { describe, expect, it } from 'vitest';
import {
  APP_DB,
  S6_CRITERIA,
  S6_PRESSES,
  S6_QUERIES,
  S6_SCALE,
  S6_SOURCE_ID,
  atScale,
  foreignSources,
  formatMs,
  judge,
  parseLabSource,
  summarizeMs,
} from './scale';

const SOURCE = {
  m3u: 'http://192.168.1.3:8080/get.php?username=u&password=p&type=m3u_plus',
  items: 200_000,
  live: 20_000,
  guide: { url: 'http://192.168.1.3:8080/__lab/guide.xml.gz?days=3', static: true, bytes: 148_344_801, gzBytes: 10_506_487, shiftDays: 3, from: '2026-10-28T00:00:00.000Z' },
};

describe("S6's criteria and arithmetic (RELAY step 15b)", () => {
  it('are the numbers of architecture.md §5', () => {
    expect(S6_CRITERIA).toEqual({ ingestMs: 90_000, pressMs: 200, guideMs: 240_000, coldStartMs: 3_000, searchMs: 200 });
    expect(S6_SCALE).toEqual({ items: 200_000, guideBytes: 140_000_000 });
  });

  it("stores S6's data in the app's own database name", () => {
    expect(APP_DB).toBe(DB_NAME);
  });

  it('judges only at scale, and a broken run always fails', () => {
    expect([judge(true, true), judge(true, false), judge(false, true), judge(false, false)]).toEqual(['pass', 'fail', 'info', 'info']);
    expect([judge(true, true, true), judge(false, true, true)]).toEqual(['fail', 'fail']);
  });

  it('summarizes timings: median, nearest-rank 95th percentile, maximum', () => {
    expect(summarizeMs([])).toEqual({ count: 0, median: 0, p95: 0, max: 0 });
    expect(summarizeMs([7.04])).toEqual({ count: 1, median: 7, p95: 7, max: 7 });
    const values = [20, 3, 1, 19, 2, 18, 4, 17, 5, 16, 6, 15, 7, 14, 8, 13, 9, 12, 10, 11];
    expect(summarizeMs(values)).toEqual({ count: 20, median: 10.5, p95: 19, max: 20 });
    expect(values[0]).toBe(20);
    expect(summarizeMs([1, 2, 300])).toEqual({ count: 3, median: 2, p95: 300, max: 300 });
  });

  it("reads the lab server's source answer, and nothing else", () => {
    expect(parseLabSource(SOURCE)).toEqual({ ...SOURCE, guide: { url: SOURCE.guide.url, static: true, bytes: 148_344_801, gzBytes: 10_506_487, shiftDays: 3 } });
    expect(parseLabSource(null)).toBeNull();
    expect(parseLabSource('source')).toBeNull();
    expect(parseLabSource({ ...SOURCE, m3u: 'ftp://x' })).toBeNull();
    expect(parseLabSource({ ...SOURCE, items: '200000' })).toBeNull();
    expect(parseLabSource({ ...SOURCE, live: Number.NaN })).toBeNull();
    expect(parseLabSource({ ...SOURCE, guide: null })).toBeNull();
    expect(parseLabSource({ ...SOURCE, guide: { ...SOURCE.guide, url: '/__lab/guide.xml.gz' } })).toBeNull();
    expect(parseLabSource({ ...SOURCE, guide: { ...SOURCE.guide, static: 'yes' } })).toBeNull();
    expect(parseLabSource({ ...SOURCE, guide: { ...SOURCE.guide, shiftDays: undefined } })).toBeNull();
  });

  it('is at scale with the 200k catalog and the 150 MB static guide', () => {
    const source = parseLabSource(SOURCE)!;
    expect(atScale(source)).toEqual({ catalog: true, guide: true });
    expect(atScale({ ...source, items: 199_999 })).toEqual({ catalog: false, guide: true });
    expect(atScale({ ...source, guide: { ...source.guide, bytes: 139_999_999 } })).toEqual({ catalog: true, guide: false });
    expect(atScale({ ...source, guide: { ...source.guide, static: false } })).toEqual({ catalog: true, guide: false });
  });

  it("names the stored sources that aren't S6's own, once each", () => {
    expect(foreignSources([S6_SOURCE_ID, S6_SOURCE_ID])).toEqual([]);
    expect(foreignSources(['m3u-1', S6_SOURCE_ID, 'm3u-1', 'xt-2'])).toEqual(['m3u-1', 'xt-2']);
  });

  it('formats a duration for a note', () => {
    expect([formatMs(0.4), formatMs(850), formatMs(999.6), formatMs(1000), formatMs(61_234)]).toEqual(['0 ms', '850 ms', '1000 ms', '1.0 s', '61.2 s']);
  });

  it('presses down the list, pages, the rail, a category and back in the list', () => {
    expect(S6_PRESSES).toHaveLength(35);
    expect(S6_PRESSES.slice(0, 10).every((i) => i === 'DOWN')).toBe(true);
    expect(S6_PRESSES.filter((i) => i === 'CH_DOWN')).toHaveLength(12);
    expect(S6_PRESSES.slice(22).join(' ')).toBe('LEFT DOWN DOWN DOWN DOWN DOWN OK RIGHT DOWN DOWN DOWN DOWN DOWN');
    expect(S6_QUERIES).toContain('زوما');
  });
});
