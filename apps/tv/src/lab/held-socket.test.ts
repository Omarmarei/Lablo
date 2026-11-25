import { describe, expect, it } from 'vitest';
import { createAvplayPlayer } from './avplay-player';
import { PLACEHOLDER_NOTE } from './battery';
import type { AvplayPlan } from './fakes';
import { FakeAvplay, FakeClock, LAB_MEDIA_FIXTURE, fakeAvplayStage, labMediaItem } from './fakes';
import type { CallStats, HeldSample, HeldWindows, PolledStats, SignalReport } from './held-socket';
import { HELD, NO_OUTAGE_ITEM, WATCHED_CALLBACKS, callChange, callStats, heldSocketRow, heldVerdict, heldWindows, outageTiming, phaseAt, polledChange, polledStats } from './held-socket';
import type { CheckResult, LabContext } from './types';

const STOP = 30_000;
const BACK = 60_000;
const OUTAGE_URL = 'http://lab/live/104.ts?mock_fault=stall:after_ms=30000:outage_ms=30000';

/**
 * What the Samsung did through `live-outages` (docs/spikes/results.md, 2026-11-25): `getState()`
 * PLAYING and the clock running on, with two signals that do see it here: the bandwidth drops to 0
 * a second after the data stops, and `onbufferingstart` comes once as the buffer runs dry.
 */
const TV_OUTAGE: AvplayPlan = {
  prepareAfterMs: 600,
  properties: (ms) => ({ CURRENT_BANDWIDTH: ms >= STOP + 1000 && ms < BACK + 1000 ? '0' : '1200000', IS_LIVE: '1', AVAILABLE_BITRATE: '1200000' }),
  callbacks: [
    [STOP + 6000, 'onbufferingstart'],
    [BACK + 1500, 'onbufferingcomplete'],
  ],
};

function row(plan: AvplayPlan, media: unknown = LAB_MEDIA_FIXTURE) {
  const clock = new FakeClock();
  const api = new FakeAvplay(clock, () => plan);
  const stages: Array<ReturnType<typeof fakeAvplayStage>> = [];
  const urls: string[] = [];
  const check = heldSocketRow('S4', {
    createPlayer: () => {
      const stage = fakeAvplayStage();
      stages.push(stage);
      return createAvplayPlayer(api, stage, { timers: clock.timers, now: clock.now });
    },
    getJson: (url) => {
      urls.push(url);
      return Promise.resolve(media);
    },
    clock,
  });
  const run = (): Promise<CheckResult> => check.run({ server: 'http://lab:8080' } as LabContext);
  return { clock, api, stages, urls, check, run };
}

type Value = { changed: string[]; signals: Record<string, SignalReport>; columns: string[]; samples: Array<Array<string | number>>; samplesPerPhase: Record<string, number>; windows: HeldWindows; frameMs: number; fault: string };

describe('the outage item and its phases', () => {
  it("reads the fault's two numbers, in either order, and nothing else", () => {
    expect(outageTiming('stall:after_ms=30000:outage_ms=30000')).toEqual({ afterMs: 30_000, outageMs: 30_000 });
    expect(outageTiming('stall:outage_ms=25000:after_ms=60000')).toEqual({ afterMs: 60_000, outageMs: 25_000 });
    expect(outageTiming('stall:after_bytes=2125152:outage_ms=5000')).toBeNull();
    expect(outageTiming('stall:after_ms=5000')).toBeNull();
    expect(outageTiming('stall:after_ms=0:outage_ms=5000')).toBeNull();
    expect(outageTiming('stall:after_ms=5000:outage_ms=0')).toBeNull();
    expect(outageTiming(null)).toBeNull();
  });

  it('starts each phase from the open: settle, drain and reconnect margins, the end before the next stop', () => {
    expect(heldWindows({ afterMs: STOP, outageMs: 30_000 }, 750)).toEqual({ beforeMs: 2750, drainMs: 30_000, outageMs: 40_000, reconnectMs: 60_000, afterMs: 70_000, endMs: 84_000 });
    // A short outage (the e2e's): each margin at most a third of what it cuts into.
    expect(heldWindows({ afterMs: 6000, outageMs: 6000 }, 500)).toEqual({ beforeMs: 2500, drainMs: 6000, outageMs: 8000, reconnectMs: 12_000, afterMs: 14_000, endMs: 16_800 });
    expect(HELD).toMatchObject({ sampleMs: 1000, settleMs: 2000, bufferMs: 10_000, reconnectMs: 10_000, afterMs: 25_000 });
  });

  it('puts each moment in its phase, the boundaries in the later one', () => {
    const w = heldWindows({ afterMs: STOP, outageMs: 30_000 }, 750);
    expect([0, 2749, 2750, 29_999, 30_000, 39_999, 40_000, 59_999, 60_000, 69_999, 70_000, 99_000].map((t) => phaseAt(t, w))).toEqual([
      'start',
      'start',
      'before',
      'before',
      'drain',
      'drain',
      'outage',
      'outage',
      'reconnect',
      'reconnect',
      'after',
      'after',
    ]);
  });
});

/** Samples of one polled signal, a second apart. */
const series = (values: readonly string[], phase: HeldSample['phase'] = 'before'): HeldSample[] => values.map((v, i) => ({ t: i * 1000, phase, polled: { s: v }, calls: {}, said: [] }));
const stats = (values: readonly string[]): PolledStats => polledStats(series(values), 's');
const change = (a: readonly string[], b: readonly string[], fresh: readonly string[] = b): string | null => polledChange(stats(a), stats(b), a, fresh);
const calls = (counts: readonly number[]): CallStats => callStats(counts.map((n, i) => ({ t: i * 1000, phase: 'before', polled: {}, calls: { c: n }, said: [] })), 'c');

describe('a polled signal', () => {
  it('has its share of moving steps, and as a number its median rate, level and whether it rises', () => {
    expect(stats(['0', '1000', '2000', '3000', '4000'])).toEqual({ n: 5, values: ['0', '1000', '2000', '3000'], moving: 1, rate: 1000, level: 2000, rising: true });
    expect(stats(['PLAYING', 'PLAYING', 'PAUSED'])).toEqual({ n: 3, values: ['PLAYING', 'PAUSED'], moving: 0.5, rate: null, level: null, rising: false });
    // Four steps of five up is a clock; three of five is not.
    expect(stats(['0', '1', '2', '3', '4', '3']).rising).toBe(true);
    expect(stats(['0', '1', '2', '1', '2', '1']).rising).toBe(false);
    expect(stats(['7'])).toEqual({ n: 1, values: ['7'], moving: 0, rate: null, level: 7, rising: false });
    expect(stats(['-1.5', '2.5']).level).toBe(0.5);
    expect(stats(['1', 'throws InvalidStateError']).level).toBeNull();
    expect(stats([])).toEqual({ n: 0, values: [], moving: 0, rate: null, level: null, rising: false });
  });

  it('changes when it stops or starts moving', () => {
    expect(change(['1', '2', '3', '4', '5'], ['6', '6', '6', '6', '6'])).toBe('moving, then still');
    expect(change(['1', '2', '3', '4', '5', '6'], ['6', '7', '7', '7', '7', '7'])).toBe('moving, then still');
    expect(change(['a', 'a', 'a', 'a'], ['b', 'c', 'd', 'e'])).toBe('still, then moving');
    // 3 of 5 steps moving before (0.6) still counts as moving; 2 of 5 isn't, and a rise that
    // stopped (median rate 0) is a level, not a clock.
    expect(change(['1', '2', '3', '4', '4', '4'], ['9', '9', '9', '9'])).toBe('moving, then still');
    expect(change(['1', '2', '3', '3', '3', '3'], ['9', '9', '9', '9'])).toBe('level 3 → 9');
    expect(change(['1', '2', '3', '3', '3', '3'], ['4', '4', '4', '4'])).toBeNull();
  });

  it('changes when a still value becomes one never seen before, in the outage or the drain before it', () => {
    expect(change(['PLAYING', 'PLAYING', 'PLAYING'], ['PAUSED', 'PAUSED', 'PAUSED'])).toBe('PLAYING → PAUSED');
    expect(change(['1200000', '1200000', '1200000'], ['1200000', '1200000', '1200000'], ['1200000', '0', '1200000'])).toBe('1200000 → 0');
    expect(change(['PLAYING', 'PLAYING', 'PLAYING'], ['PLAYING', 'PLAYING', 'PLAYING'])).toBeNull();
    // Long values are cut for the note.
    expect(change(['x', 'x', 'x'], ['VIDEO0 {"fourCC":"H264","Width":"1920"}', 'VIDEO0 {"fourCC":"H264","Width":"1920"}'])).toBe('x → VIDEO0 {"fourCC":"H264",…');
  });

  it("changes when a clock's rate halves or doubles, and a level halves, doubles or leaves 0", () => {
    const clock = ['0', '1000', '2000', '3000', '4000'];
    expect(change(clock, ['10000', '10500', '11000', '11500', '12000'])).toBe('1000 → 500 per s');
    expect(change(clock, ['10000', '12000', '14000', '16000', '18000'])).toBe('1000 → 2000 per s');
    expect(change(clock, ['10000', '10600', '11200', '11800', '12400'])).toBeNull();
    expect(change(clock, ['10000', '11900', '13800', '15700', '17600'])).toBeNull();
    // A level that moves about, never rising for long.
    const level = ['1000', '900', '1100', '800', '1000'];
    expect(change(level, ['400', '500', '450', '500', '400'])).toBe('level 1000 → 450');
    expect(change(level, ['2000', '2100', '1900', '2300', '2100'])).toBe('level 1000 → 2100');
    expect(change(level, ['700', '600', '800', '500', '700'])).toBeNull();
    expect(change(['0', '0', '1', '0', '1', '0'], ['1', '2', '1', '2', '1', '2'])).toBe('level 0 → 1.5');
    expect(change(['0', '1', '0', '1', '0'], ['0', '1', '0', '1', '0'])).toBeNull();
  });

  it('says nothing with fewer than two samples on a side', () => {
    expect(change(['1'], ['5', '5'])).toBeNull();
    expect(change(['1', '2', '3'], ['5'])).toBeNull();
  });
});

describe('a callback', () => {
  it('counts its calls per 10 samples', () => {
    expect(calls([0, 2, 1, 0, 2])).toEqual({ n: 5, calls: 5, per10s: 10 });
    expect(calls([])).toEqual({ n: 0, calls: 0, per10s: 0 });
  });

  it('changes when it starts, stops, or runs three times faster or slower', () => {
    expect(callChange(calls([0, 0, 0]), calls([0, 1, 0, 0, 0]))).toBe('none, then 2 per 10 s');
    expect(callChange(calls([2, 2, 2]), calls([0, 0, 0]))).toBe('20 per 10 s, then none');
    expect(callChange(calls([1, 1, 1]), calls([3, 3, 3]))).toBe('10 → 30 per 10 s');
    expect(callChange(calls([3, 3, 3]), calls([1, 1, 1]))).toBe('30 → 10 per 10 s');
    expect(callChange(calls([1, 1, 1]), calls([2, 3, 2]))).toBeNull();
    expect(callChange(calls([3, 3, 3]), calls([2, 1, 2]))).toBeNull();
    expect(callChange(calls([0, 0, 0]), calls([0, 0, 0]))).toBeNull();
    expect(callChange(calls([0]), calls([1, 1, 1]))).toBeNull();
    expect(callChange(calls([0, 0]), calls([1]))).toBeNull();
  });
});

describe('the verdict', () => {
  const w: HeldWindows = { beforeMs: 1000, drainMs: 4000, outageMs: 5000, reconnectMs: 8000, afterMs: 9000, endMs: 12_000 };
  const at = (t: number, s: string, c = 0): HeldSample => ({ t, phase: phaseAt(t, w), polled: { s }, calls: { onbufferingstart: c }, said: c > 0 ? ['onevent PLAYER_MSG_HTTP_ERROR_CODE 0'] : [] });

  it('fails with too few samples on either side of the outage', () => {
    const r = heldVerdict([at(1000, 'a'), at(5000, 'b'), at(6000, 'b')], w, 500, 'f');
    expect(r).toMatchObject({ status: 'fail', note: 'too few samples to compare: 1 before the outage, 2 during it' });
    expect(heldVerdict([at(1000, 'a'), at(2000, 'a'), at(5000, 'b')], w, 500, 'f').note).toBe('too few samples to compare: 2 before the outage, 1 during it');
  });

  it('says when a change is still there after the outage, or not known', () => {
    const samples = [1000, 2000, 3000].map((t) => at(t, 'a')).concat([5000, 6000, 7000].map((t) => at(t, 'b', 1)), [9000, 10_000].map((t) => at(t, 'b')));
    const r = heldVerdict(samples, w, 500, 'f');
    expect(r.status).toBe('pass');
    expect(r.note).toBe(`changed at the outage: s (a → b; still changed after), onbufferingstart (none, then 10 per 10 s; back after); unchanged: ${WATCHED_CALLBACKS.slice(1).join(', ')}`);
    // The other way round: the value back, the callback still coming.
    const turned = heldVerdict(samples.slice(0, 6).concat([9000, 10_000].map((t) => at(t, 'a', 1))), w, 500, 'f');
    expect(turned.note).toMatch(/^changed at the outage: s \(a → b; back after\), onbufferingstart \(none, then 10 per 10 s; still changed after\); /);
    const unknown = heldVerdict(samples.slice(0, 6).concat([at(9000, 'a')]), w, 500, 'f');
    expect(unknown.note).toMatch(/^changed at the outage: s \(a → b; after: unknown\), onbufferingstart \(none, then 10 per 10 s; after: unknown\)/);
    expect((unknown.value as Value).samplesPerPhase).toEqual({ before: 3, drain: 0, outage: 3, after: 1 });
    expect((unknown.value as Value).samples[3]).toEqual([5000, 'outage', 'b', 1, 0, 0, 0, 0, 0, 0, 'onevent PLAYER_MSG_HTTP_ERROR_CODE 0']);
  });
});

describe("S4's held-socket row on a fake AVPlay (RELAY step 49)", () => {
  it('finds the signals that see the held socket, with the clock running on as on the Samsung', async () => {
    const b = row(TV_OUTAGE);
    const r = await b.run();
    expect(b.urls).toEqual(['http://lab:8080/__lab/media']);
    expect(b.api.urls).toEqual([OUTAGE_URL]);
    expect(r.status).toBe('pass');
    expect(r.note).toBe(
      'changed at the outage: CURRENT_BANDWIDTH (1200000 → 0; back after), onbufferingstart (none, then 0.3 per 10 s; back after); unchanged: getState, getCurrentTime, GET_LIVE_DURATION, IS_LIVE, AVAILABLE_BITRATE, getCurrentStreamInfo, lastPlaytime, onbufferingprogress, onbufferingcomplete, oncurrentplaytime, onevent, onerror, onerrormsg',
    );
    const value = r.value as Value;
    // Prepared at 600 ms, moving at 700, seen at 750: the samples run from there to the end, a second apart.
    expect(value.frameMs).toBe(750);
    expect(value.windows).toEqual({ beforeMs: 2750, drainMs: 30_000, outageMs: 40_000, reconnectMs: 60_000, afterMs: 70_000, endMs: 84_000 });
    expect(value.samplesPerPhase).toEqual({ before: 28, drain: 10, outage: 20, after: 14 });
    expect(value.changed).toEqual(['CURRENT_BANDWIDTH', 'onbufferingstart']);
    expect(value.signals['getState']).toMatchObject({ kind: 'polled', before: { values: ['PLAYING'], moving: 0 }, outage: { values: ['PLAYING'] }, change: null, back: null });
    expect(value.signals['getCurrentTime']).toMatchObject({ before: { rate: 1000, rising: true }, outage: { rate: 1000 }, change: null });
    expect(value.signals['GET_LIVE_DURATION']?.before).toMatchObject({ values: ['throws NotSupportedError'] });
    expect(value.signals['onbufferingstart']).toMatchObject({ kind: 'callback', before: { calls: 0 }, outage: { n: 30, calls: 1 }, after: { calls: 0 }, back: true });
    // The record: the columns, one row a second, a long value repeated as `=`.
    expect(value.columns).toEqual(['t', 'phase', 'getState', 'getCurrentTime', 'CURRENT_BANDWIDTH', 'GET_LIVE_DURATION', 'IS_LIVE', 'AVAILABLE_BITRATE', 'getCurrentStreamInfo', 'lastPlaytime', ...WATCHED_CALLBACKS, 'said']);
    expect(value.samples).toHaveLength(84);
    expect(value.samples[0]?.slice(0, 2)).toEqual([750, 'start']);
    expect(value.samples[0]?.[8]).toMatch(/^VIDEO0 \{"fourCC":"H264".* \| AUDIO1 /);
    expect(value.samples[1]?.[8]).toBe('=');
    expect(value.samples[45]).toEqual([45_750, 'outage', 'PLAYING', '45050', '0', 'throws NotSupportedError', '1', '1200000', '=', '45050', 0, 0, 0, 1, 0, 0, 0, '']);
    // No URL in the record; the player gone and AVPlay closed.
    expect(JSON.stringify(r)).not.toMatch(/http:|lablo-test|\/live\//);
    expect(b.stages.map((s) => s.removed)).toEqual([1]);
    expect(b.api.state).toBe('NONE');
    expect(b.clock.running).toBe(0);
  });

  it('says so when the picture clock stops and stays stopped', async () => {
    // Moving from 700 ms; stopped at 36 s, as the buffer runs dry, for good.
    const r = await row({ ...TV_OUTAGE, properties: () => ({}), callbacks: [], stallAfterMs: 35_300 }).run();
    expect(r.status).toBe('pass');
    // The callback still comes every second, with the same position.
    expect(r.note).toMatch(/^changed at the outage: getCurrentTime \(moving, then still; still changed after\), lastPlaytime \(moving, then still; still changed after\); unchanged: getState, .*oncurrentplaytime/);
  });

  it('fails when nothing changes (the mock held nothing, or AVPlay hides it all)', async () => {
    const r = await row({ prepareAfterMs: 600 }).run();
    expect(r.status).toBe('fail');
    expect(r.note).toBe(
      'no signal changed at the outage (did the mock log "outage … down"?); unchanged: getState, getCurrentTime, CURRENT_BANDWIDTH, GET_LIVE_DURATION, IS_LIVE, AVAILABLE_BITRATE, getCurrentStreamInfo, lastPlaytime, onbufferingstart, onbufferingprogress, onbufferingcomplete, oncurrentplaytime, onevent, onerror, onerrormsg',
    );
  });

  it('records what the callbacks said, and an error AVPlay gives up with', async () => {
    const r = await row({
      ...TV_OUTAGE,
      properties: () => ({}),
      callbacks: [
        [STOP + 8000, 'onevent', 'PLAYER_MSG_HTTP_ERROR_CODE', '0'],
        [STOP + 8100, 'onerror', 'PLAYER_ERROR_CONNECTION_FAILED'],
        [STOP + 8200, 'onerrormsg', 'PLAYER_ERROR_CONNECTION_FAILED', 'timeout'],
        [STOP + 8300, 'onevent', 'PLAYER_MSG_NONE', ''],
      ],
    }).run();
    expect(r.note).toMatch(/^changed at the outage: onevent \(none, then 0\.7 per 10 s; back after\), onerror \(none, then 0\.3 per 10 s; back after\), onerrormsg \(none, then 0\.3 per 10 s; back after\); unchanged:/);
    const rows = (r.value as Value).samples;
    expect(rows.find((x) => x[17] !== '')?.slice(0, 2)).toEqual([38_750, 'drain']);
    expect(rows.find((x) => x[17] !== '')?.[17]).toBe('onevent PLAYER_MSG_HTTP_ERROR_CODE 0; onerror PLAYER_ERROR_CONNECTION_FAILED; onerrormsg PLAYER_ERROR_CONNECTION_FAILED timeout');
  });

  it('fails when the stream never plays, and skips without the media it needs', async () => {
    const never = row({ prepareAfterMs: null });
    expect(await never.run()).toMatchObject({ status: 'fail', note: 'the live TS never played: no answer', value: { played: false } });
    expect(never.stages[0]?.removed).toBe(1);
    expect(await row(TV_OUTAGE, { ...LAB_MEDIA_FIXTURE, media: 'placeholder' }).run()).toEqual({ status: 'skip', note: PLACEHOLDER_NOTE });
    const items = { ...LAB_MEDIA_FIXTURE.items };
    delete items['outage-ts'];
    const older = row(TV_OUTAGE, { media: 'files', items });
    expect(await older.run()).toEqual({ status: 'skip', note: NO_OUTAGE_ITEM });
    expect(older.stages).toEqual([]);
    const odd = { media: 'files', items: { 'outage-ts': labMediaItem('http://lab/live/104.ts?mock_fault=stall:after_bytes=5', { fault: 'stall:after_bytes=5' }) } };
    expect(await row(TV_OUTAGE, odd).run()).toEqual({ status: 'fail', value: { fault: 'stall:after_bytes=5' }, note: 'the outage-ts item carries no after_ms and outage_ms' });
    expect(await row(TV_OUTAGE, { nope: true }).run()).toEqual({ status: 'fail', note: 'the lab server answered something else than a media list' });
  });

  it('is its own row with its own wait', () => {
    expect(row(TV_OUTAGE).check).toMatchObject({ id: 'held-socket', title: 'A held socket: which signals change at the outage', timeoutMs: 240_000 });
  });
});
