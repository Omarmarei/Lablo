import { describe, expect, it } from 'vitest';
import type { DiagReport } from './index';
import { AGE_BUCKETS, ageBucket, DIAG_EVENTS_MAX, DIAG_GUIDES_MAX, DIAG_SOURCES_MAX, diagCode, diagReportSchema, diagRequestSchema, diagResponseSchema } from './index';

/** The diagnostics report's schema (RELAY step 33d1): what it takes, what it strips, what it refuses. */

const HOUR = 3_600_000;

const SOURCE = { type: 'xtream', items: '10k+', checked: '1h+', needs: null } as const;
const GUIDE = { programmes: '100k+', matched: '75-99', checked: '<1h', failure: null } as const;
const PLAY = {
  kind: 'play_result',
  at: 1_763_500_000_000,
  engine: 'avplay',
  container: 'ts',
  mode: 'live',
  ttffMs: null,
  error: { kind: 'http', code: 'HTTP_404', status: 404 },
} as const;
const CRASH = { kind: 'crash', at: 1_763_500_001_000, where: 'worker', stack: 'Uncaught Error: x\n    at query.worker.js:1:2' } as const;

const REPORT: DiagReport = {
  v: 1,
  at: 1_763_500_002_000,
  zoneMin: 240,
  locale: 'ar',
  tier: 'low',
  model: 'OLED55A1PVA',
  firmware: '03.21.15',
  chromium: 79,
  probes: { year: 2021, lowTier: true, mse: true, hevc: false },
  telemetry: false,
  config: 'cached',
  sources: [SOURCE, { type: 'm3u', items: '100+', checked: null, needs: 'link' }, { type: 'm3u-file', items: '0', checked: '30d+', needs: null }],
  guides: [GUIDE, { programmes: '0', matched: '0', checked: '3d+', failure: { code: 'http', status: 503 } }, { ...GUIDE, checked: null, failure: { code: 'network', status: null } }],
  events: [PLAY, { kind: 'stall', at: 1_763_500_000_500, recovered: true, attempts: 2 }, CRASH],
};

/** `REPORT` with `change` applied to a copy. */
function changed(change: (report: Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(REPORT)) as Record<string, unknown>;
  change(copy);
  return copy;
}

describe('ageBucket', () => {
  it('puts an age in hours or days, a negative one (a clock moved back) under an hour', () => {
    const cases: Array<[number, string]> = [
      [-5 * HOUR, '<1h'],
      [Number.NaN, '<1h'],
      [0, '<1h'],
      [HOUR - 1, '<1h'],
      [HOUR, '1h+'],
      [6 * HOUR - 1, '1h+'],
      [6 * HOUR, '6h+'],
      [24 * HOUR - 1, '6h+'],
      [24 * HOUR, '1d+'],
      [72 * HOUR - 1, '1d+'],
      [72 * HOUR, '3d+'],
      [168 * HOUR - 1, '3d+'],
      [168 * HOUR, '7d+'],
      [720 * HOUR - 1, '7d+'],
      [720 * HOUR, '30d+'],
      [Number.POSITIVE_INFINITY, '30d+'],
    ];
    for (const [ms, bucket] of cases) expect([ms, ageBucket(ms)]).toEqual([ms, bucket]);
    expect(AGE_BUCKETS).toEqual(['<1h', '1h+', '6h+', '1d+', '3d+', '7d+', '30d+']);
  });
});

describe('the report', () => {
  it('takes a full report as it is', () => {
    expect(diagReportSchema.parse(REPORT)).toEqual(REPORT);
    expect(diagRequestSchema.parse({ platform: 'webos', appVersion: '1.0.0', report: REPORT })).toEqual({ platform: 'webos', appVersion: '1.0.0', report: REPORT });
    // The smallest: no source, guide or event yet, no Chromium version, no probes.
    const empty = { ...REPORT, chromium: null, probes: {}, sources: [], guides: [], events: [] };
    expect(diagReportSchema.parse(empty)).toEqual(empty);
  });

  it('strips what it doesn’t know: a name, a link, an ID', () => {
    const extra = changed((r) => {
      r.installId = 'AAAAAAAAAAAAAAAAAAAAAA';
      (r.sources as Record<string, unknown>[])[0]!.name = 'My panel';
      (r.sources as Record<string, unknown>[])[0]!.url = 'http://panel.example.com/get.php?username=u&password=p';
      (r.guides as Record<string, unknown>[])[0]!.url = 'http://epg.example.com/guide.xml';
      ((r.guides as Record<string, unknown>[])[1]!.failure as Record<string, unknown>).message = 'GET http://epg.example.com failed';
      (r.events as Record<string, unknown>[])[0]!.channel = 'News 24';
    });
    expect(diagReportSchema.parse(extra)).toEqual(REPORT);
    expect(diagRequestSchema.parse({ platform: 'tizen', appVersion: '1.0.0', report: REPORT, installId: 'x', ip: '192.0.2.1' })).toEqual({
      platform: 'tizen',
      appVersion: '1.0.0',
      report: REPORT,
    });
  });

  it('refuses a URL, an address, an e-mail or a name where a token or a device name goes, and anything outside its lists', () => {
    const refused: Array<[string, (r: Record<string, unknown>) => void]> = [
      ['a URL as the model', (r) => (r.model = 'http://panel.example.com')],
      ['an address with its port as the firmware', (r) => (r.firmware = '192.168.1.8:8080')],
      ['an e-mail as the model', (r) => (r.model = 'user@example.com')],
      ['an empty model', (r) => (r.model = '')],
      ['a long firmware', (r) => (r.firmware = 'x'.repeat(65))],
      ['a probe named by a URL', (r) => (r.probes = { 'http://x': true })],
      ['a probe with text', (r) => (r.probes = { mse: 'panel.example.com' })],
      ['a guide failure code with a space', (r) => ((r.guides as Record<string, unknown>[])[1]!.failure = { code: 'News 24', status: 503 })],
      ['a guide failure code that is a URL', (r) => ((r.guides as Record<string, unknown>[])[1]!.failure = { code: 'http://x', status: null })],
      ['a status out of range', (r) => ((r.guides as Record<string, unknown>[])[1]!.failure = { code: 'http', status: 99 })],
      ['a play error code that is a URL', (r) => ((r.events as Record<string, unknown>[])[0]!.error = { kind: 'http', code: 'http://x/y', status: 404 })],
      ['another source type', (r) => ((r.sources as Record<string, unknown>[])[0]!.type = 'stalker')],
      ['a count that is not a bucket', (r) => ((r.sources as Record<string, unknown>[])[0]!.items = '12345')],
      ['a programme count that is not a bucket', (r) => ((r.guides as Record<string, unknown>[])[0]!.programmes = '5 million')],
      ['an age that is not a bucket', (r) => ((r.sources as Record<string, unknown>[])[0]!.checked = '2h')],
      ['another need', (r) => ((r.sources as Record<string, unknown>[])[0]!.needs = 'password')],
      ['a rate that is not a bucket', (r) => ((r.guides as Record<string, unknown>[])[0]!.matched = '80')],
      ['an event the telemetry schema can’t read', (r) => ((r.events as Record<string, unknown>[])[1] = { kind: 'stall', at: 1, recovered: 'yes', attempts: 2 })],
      ['a crash stack over 4,000 characters', (r) => ((r.events as Record<string, unknown>[])[2] = { ...CRASH, stack: 'x'.repeat(4001) })],
      ['another locale', (r) => (r.locale = 'fr')],
      ['another tier', (r) => (r.tier = 'mid')],
      ['another config state', (r) => (r.config = 'stale')],
      ['a switch that is not a boolean', (r) => (r.telemetry = 'off')],
      ['another version', (r) => (r.v = 2)],
      ['a negative time', (r) => (r.at = -1)],
      ['a zone past 14 hours', (r) => (r.zoneMin = 841)],
      ['a zone west of -14 hours', (r) => (r.zoneMin = -841)],
      ['a zone that is not whole minutes', (r) => (r.zoneMin = 30.5)],
      ['a Chromium version of 0', (r) => (r.chromium = 0)],
      ['no sources list', (r) => delete r.sources],
    ];
    for (const [name, change] of refused) expect([name, diagReportSchema.safeParse(changed(change)).success]).toEqual([name, false]);
    // The edges are taken.
    for (const zoneMin of [-840, 840, 0, -210, 345]) expect(diagReportSchema.safeParse(changed((r) => (r.zoneMin = zoneMin))).success).toBe(true);
  });

  it('takes at most 10 sources, guides and events', () => {
    const lists: Array<[string, unknown, number]> = [
      ['sources', SOURCE, DIAG_SOURCES_MAX],
      ['guides', GUIDE, DIAG_GUIDES_MAX],
      ['events', PLAY, DIAG_EVENTS_MAX],
    ];
    for (const [key, item, max] of lists) {
      expect([key, diagReportSchema.safeParse({ ...REPORT, [key]: Array.from({ length: max }, () => item) }).success]).toEqual([key, true]);
      expect([key, diagReportSchema.safeParse({ ...REPORT, [key]: Array.from({ length: max + 1 }, () => item) }).success]).toEqual([key, false]);
    }
  });

  it('is sent with the platform and the app’s version', () => {
    for (const body of [
      { platform: 'browser', appVersion: '1.0.0', report: REPORT },
      { platform: 'webos', appVersion: '1.0', report: REPORT },
      { platform: 'webos', appVersion: '1.0.0' },
      { platform: 'webos', appVersion: '1.0.0', report: { ...REPORT, v: undefined } },
    ]) {
      expect(diagRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('the support code', () => {
  it('is 6 characters of Crockford’s base32', () => {
    for (const code of ['K7M2Q9', '000000', 'ZZZZZZ', 'ABCDEF', 'GHJKMN', 'PQRSTV', 'WXYZ01']) expect([code, diagCode.safeParse(code).success]).toEqual([code, true]);
    for (const code of ['K7M2Q', 'K7M2Q90', 'k7m2q9', 'K7M2QI', 'K7M2QL', 'K7M2QO', 'K7M2QU', 'K7M2Q-', '']) expect([code, diagCode.safeParse(code).success]).toEqual([code, false]);
    expect(diagResponseSchema.parse({ code: 'K7M2Q9', extra: 1 })).toEqual({ code: 'K7M2Q9' });
    expect(diagResponseSchema.safeParse({ code: 'K7M2QI' }).success).toBe(false);
  });
});
