import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Sample } from './soak';
import {
  HEAP_EVERY,
  LISTED_STALLS,
  readDrain,
  replaySoak,
  SAMPLE_CAP,
  SAMPLE_MS,
  SOAK_DRAIN,
  SOAK_SAMPLER,
  STALL_MS,
  StallDetector,
  summaryLine,
} from './soak';

/** Samples every 100 ms from `start`: `[state, position]` pairs. */
function samples(start: number, rows: readonly (readonly [string, number])[]): Sample[] {
  return rows.map(([state, pos], i) => [start + i * SAMPLE_MS, state, pos]);
}

/** `count` samples, playing: the position moves 100 ms each. */
function playing(start: number, count: number, from = 0): Sample[] {
  return samples(start, Array.from({ length: count }, (_, i) => ['PLAYING', from + i * 100] as const));
}

/** `count` samples frozen at `pos`. */
function frozen(start: number, count: number, pos: number, state = 'PLAYING'): Sample[] {
  return samples(start, Array.from({ length: count }, () => [state, pos] as const));
}

function feed(detector: StallDetector, list: readonly Sample[]): void {
  for (const sample of list) detector.push(sample);
}

describe('StallDetector', () => {
  it('finds nothing while the position moves', () => {
    const detector = new StallDetector();
    feed(detector, playing(0, 600));
    expect(detector.stalls).toEqual([]);
    expect(detector.openStallMs()).toBeNull();
  });

  it('counts a freeze from the last move once it reaches 1.5 s, and ends it at the next move', () => {
    const detector = new StallDetector();
    feed(detector, playing(0, 10)); // the last move at 900 ms, position 900
    feed(detector, frozen(1000, 14, 900)); // 1000..2300: 1.4 s after the last move, not yet
    expect(detector.openStallMs()).toBeNull();
    detector.push([2400, 'PLAYING', 900]); // 1.5 s: open
    expect(detector.openStallMs()).toBe(1500);
    feed(detector, frozen(2500, 5, 900, 'BUFFERING'));
    expect(detector.openStallMs()).toBe(2000);
    const ended = detector.push([3000, 'PLAYING', 1000]);
    expect(ended).toBeNull(); // BUFFERING then PLAYING: not a move yet
    const stall = detector.push([3100, 'PLAYING', 1100]);
    // The sample at 3000 (PLAYING after BUFFERING) still counts as frozen.
    expect(stall).toEqual({ startMs: 900, ms: 2200, states: { PLAYING: 2, BUFFERING: 5 }, posBefore: 900, posAfter: 1100 });
    expect(detector.stalls).toEqual([stall]);
    expect(detector.openStallMs()).toBeNull();
  });

  it('counts a freeze of 1.4 s as nothing', () => {
    const detector = new StallDetector();
    feed(detector, playing(0, 10));
    feed(detector, frozen(1000, 14, 900)); // the last frozen sample 1.4 s after the last move
    feed(detector, playing(2400, 5, 1000));
    expect(detector.stalls).toEqual([]);
  });

  it('takes its threshold from the constructor', () => {
    expect(STALL_MS).toBe(1500);
    const detector = new StallDetector(500);
    feed(detector, playing(0, 2));
    feed(detector, frozen(200, 4, 100));
    expect(detector.openStallMs()).toBeNull();
    detector.push([600, 'PLAYING', 100]);
    expect(detector.openStallMs()).toBe(500);
  });

  it('ignores the time before the first move, and a pause is no move', () => {
    const detector = new StallDetector();
    feed(detector, frozen(0, 100, 0, 'IDLE'));
    feed(detector, samples(10_000, [['PAUSED', 0], ['PAUSED', 100], ['PLAYING', 200]]));
    expect(detector.openStallMs()).toBeNull();
    expect(detector.summary([]).played).toBe(false);
    detector.push([10_300, 'PLAYING', 300]);
    expect(detector.summary([]).played).toBe(true);
  });

  it('counts a reopen that restarts near 0 as a move', () => {
    const detector = new StallDetector();
    feed(detector, playing(0, 10, 50_000));
    feed(detector, frozen(1000, 30, 50_900, 'IDLE'));
    feed(detector, samples(4000, [['PLAYING', 40], ['PLAYING', 140]]));
    expect(detector.stalls).toEqual([{ startMs: 900, ms: 3200, states: { IDLE: 16, PLAYING: 1 }, posBefore: 50_900, posAfter: 140 }]);
  });

  it('sums up as soak-report.js did', () => {
    const detector = new StallDetector();
    let t = 0;
    let pos = 0;
    // Four stalls of 2, 3, 11 and 12 s, separated by 10 s of play.
    for (const freezeMs of [2000, 3000, 11_000, 12_000]) {
      feed(detector, playing(t, 100, pos));
      t += 100 * SAMPLE_MS;
      pos += 100 * 100;
      feed(detector, frozen(t, freezeMs / SAMPLE_MS - 1, pos - 100));
      t += freezeMs - SAMPLE_MS;
    }
    feed(detector, playing(t, 50, pos));
    t += 50 * SAMPLE_MS;
    feed(detector, frozen(t, 30, pos + 4900));
    const summary = detector.summary([
      [0, 10],
      [300_000, 11],
      [600_000, null],
    ]);
    expect(detector.stalls.map((stall) => stall.ms)).toEqual([2000, 3000, 11_000, 12_000]);
    expect(summary).toEqual({
      minutes: 1.3,
      played: true,
      state: 'PLAYING',
      position: pos + 4900,
      stalls: 4,
      over10s: 2,
      medianMs: 11_000,
      maxMs: 12_000,
      openStallMs: 3000,
      heapMB: [
        [0, 10],
        [5, 11],
        [10, null],
      ],
    });
  });

  it('sums up an empty soak', () => {
    expect(new StallDetector().summary([[5, 3]])).toEqual({
      minutes: 0,
      played: false,
      state: null,
      position: null,
      stalls: 0,
      over10s: 0,
      medianMs: null,
      maxMs: null,
      openStallMs: null,
      heapMB: [[0, 3]],
    });
  });

  it('lists the last stalls in minutes from the first sample', () => {
    const detector = new StallDetector();
    expect(detector.recent(5)).toEqual([]);
    let t = 60_000; // the first sample at 60 s
    let pos = 0;
    for (let i = 0; i < 3; i += 1) {
      feed(detector, playing(t, 300, pos)); // 30 s of play
      t += 300 * SAMPLE_MS;
      pos += 300 * 100;
      feed(detector, frozen(t, 20, pos - 100)); // 2 s frozen at the last position
      t += 2000;
    }
    feed(detector, playing(t, 2, pos));
    expect(detector.recent(2)).toEqual([
      { atMin: 1, ms: 2100, states: { PLAYING: 6 }, posBefore: 59_900, posAfter: 60_000 },
      { atMin: 1.6, ms: 2100, states: { PLAYING: 6 }, posBefore: 89_900, posAfter: 90_000 },
    ]);
    expect(detector.recent(1)[0]?.atMin).toBe(1.6);
    expect(detector.recent(3)[0]?.atMin).toBe(0.5);
    expect(detector.recent(LISTED_STALLS)).toHaveLength(3);
    expect(LISTED_STALLS).toBe(40);
  });

  it('counts a stall of exactly 10 s as within the rule', () => {
    const detector = new StallDetector();
    feed(detector, playing(0, 10));
    feed(detector, frozen(1000, 99, 900));
    feed(detector, playing(10_900, 2, 1000));
    expect(detector.stalls.map((stall) => stall.ms)).toEqual([10_000]);
    expect(detector.summary([]).over10s).toBe(0);
  });
});

describe('summaryLine', () => {
  it('reads one line per drain', () => {
    const detector = new StallDetector();
    feed(detector, playing(0, 10));
    feed(detector, frozen(1000, 20, 900));
    feed(detector, playing(3000, 600, 1000));
    feed(detector, frozen(63_000, 25, 60_900, 'BUFFERING'));
    expect(summaryLine(detector.summary([[0, 10], [60_000, 12]]))).toBe(
      '1.1 min, BUFFERING, stalls 1 (over 10 s: 0, longest 2.1 s), frozen now 2.5 s, heap 12 MB',
    );
  });

  it('says when the picture never moved, and leaves out a missing heap', () => {
    const detector = new StallDetector();
    detector.push([0, 'IDLE', 0]);
    expect(summaryLine(detector.summary([[0, null]]))).toBe('0 min, IDLE, never played');
    expect(summaryLine(new StallDetector().summary([]))).toBe('0 min, no samples, never played');
    const played = new StallDetector();
    feed(played, playing(0, 3));
    expect(summaryLine(played.summary([]))).toBe('0 min, PLAYING, stalls 0 (over 10 s: 0, longest -)');
  });
});

describe('readDrain', () => {
  const good = { started: 1, samples: [[2, 'PLAYING', 3]], heap: [[2, 10], [3, null]], dropped: 0 };

  it('takes a drain as the page returns it', () => {
    expect(readDrain(good)).toEqual(good);
    expect(readDrain({ ...good, samples: [], heap: [] })).toEqual({ ...good, samples: [], heap: [] });
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      'x',
      { ...good, started: '1' },
      { ...good, samples: 'x' },
      { ...good, heap: {} },
      { ...good, dropped: null },
      { ...good, samples: [[2, 'PLAYING']] },
      { ...good, samples: [[2, 'PLAYING', 3, 4]] },
      { ...good, samples: [['2', 'PLAYING', 3]] },
      { ...good, samples: [[2, 7, 3]] },
      { ...good, samples: [[2, 'PLAYING', '3']] },
      { ...good, samples: ['x'] },
      { ...good, heap: [[2]] },
      { ...good, heap: [['2', 10]] },
      { ...good, heap: [[2, '10']] },
      { ...good, heap: ['x'] },
    ]) {
      expect(readDrain(bad)).toBeNull();
    }
  });
});

describe('replaySoak', () => {
  it('reads a recorded soak again, across drains', () => {
    const all = [...playing(0, 10), ...frozen(1000, 20, 900), ...playing(3000, 5, 1000)];
    const lines = [
      JSON.stringify({ started: 0, samples: all.slice(0, 15), heap: [[0, 10]], dropped: 2 }),
      '',
      JSON.stringify({ started: 0, samples: all.slice(15), heap: [[300_000, 11]], dropped: 7 }),
      '',
    ].join('\n');
    const { detector, heap, dropped } = replaySoak(lines);
    expect(detector.stalls).toEqual([{ startMs: 900, ms: 2100, states: { PLAYING: 6 }, posBefore: 900, posAfter: 1000 }]);
    expect(heap).toEqual([
      [0, 10],
      [300_000, 11],
    ]);
    expect(dropped).toBe(9);
  });

  it('refuses a line that is not a drain', () => {
    expect(() => replaySoak('{"started":0}\n')).toThrow('not a soak drain: {"started":0}');
  });
});

/** The sampler and the drain in a fake page, with a hand-driven interval. */
function page(globals: Record<string, unknown>) {
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  let now = 1_000_000;
  const context = vm.createContext({
    Date: { now: () => now },
    Math,
    setInterval: (fn: () => void, ms: number) => {
      intervals.set(nextId, { fn, ms });
      return nextId++;
    },
    clearInterval: (id: number) => intervals.delete(id),
    performance: { memory: { usedJSHeapSize: 10 * 1048576 } },
    document: { querySelector: () => null },
    ...globals,
  });
  vm.runInContext('var window = this;', context);
  return {
    run: (code: string): unknown => vm.runInContext(code, context),
    tick(count: number): void {
      for (let i = 0; i < count; i += 1) {
        now += SAMPLE_MS;
        for (const interval of [...intervals.values()]) interval.fn();
      }
    },
    intervals,
    context,
  };
}

describe('the sampler in the page', () => {
  it("samples AVPlay's state and position every 100 ms, and the drain empties it", () => {
    let pos = 0;
    const tv = page({ webapis: { avplay: { getState: () => 'PLAYING', getCurrentTime: () => (pos += 100) } } });
    expect(tv.run(SOAK_SAMPLER)).toBe('sampler on');
    expect([...tv.intervals.values()].map((interval) => interval.ms)).toEqual([SAMPLE_MS]);
    tv.tick(3);
    const drain = readDrain(JSON.parse(JSON.stringify(tv.run(SOAK_DRAIN))));
    expect(drain).toEqual({
      started: 1_000_000,
      samples: [
        [1_000_100, 'PLAYING', 100],
        [1_000_200, 'PLAYING', 200],
        [1_000_300, 'PLAYING', 300],
      ],
      heap: [[1_000_000, 10]],
      dropped: 0,
    });
    tv.tick(1);
    expect(JSON.parse(JSON.stringify(tv.run(SOAK_DRAIN)))).toEqual({ started: 1_000_000, samples: [[1_000_400, 'PLAYING', 400]], heap: [], dropped: 0 });
  });

  it("records AVPlay's errors as ERR and -1", () => {
    const tv = page({
      webapis: {
        avplay: {
          getState: () => {
            throw new Error('x');
          },
          getCurrentTime: () => {
            throw new Error('y');
          },
        },
      },
    });
    tv.run(SOAK_SAMPLER);
    tv.tick(1);
    expect(JSON.parse(JSON.stringify((tv.run(SOAK_DRAIN) as { samples: unknown[] }).samples))).toEqual([[1_000_100, 'ERR', -1]]);
  });

  it("reads the page's <video> where there is no AVPlay (webOS), and NONE without one", () => {
    const video = { paused: false, readyState: 4, currentTime: 1.2345 };
    const tv = page({ document: { querySelector: (selector: string) => (selector === 'video' ? video : null) } });
    tv.run(SOAK_SAMPLER);
    tv.tick(1);
    video.readyState = 2;
    tv.tick(1);
    video.readyState = 3;
    video.paused = true;
    tv.tick(1);
    video.paused = false;
    tv.tick(1);
    expect(JSON.parse(JSON.stringify((tv.run(SOAK_DRAIN) as { samples: unknown[] }).samples))).toEqual([
      [1_000_100, 'PLAYING', 1235],
      [1_000_200, 'BUFFERING', 1235],
      [1_000_300, 'PAUSED', 1235],
      [1_000_400, 'PLAYING', 1235],
    ]);
    const empty = page({});
    empty.run(SOAK_SAMPLER);
    empty.tick(1);
    expect(JSON.parse(JSON.stringify((empty.run(SOAK_DRAIN) as { samples: unknown[] }).samples))).toEqual([[1_000_100, 'NONE', -1]]);
  });

  it('reads the heap every 5 minutes, null where the engine has no performance.memory', () => {
    expect(HEAP_EVERY * SAMPLE_MS).toBe(300_000);
    const tv = page({ performance: {} });
    tv.run(SOAK_SAMPLER);
    tv.tick(HEAP_EVERY - 1);
    expect((tv.run(SOAK_DRAIN) as { heap: unknown[] }).heap).toHaveLength(1);
    tv.tick(1);
    expect(JSON.parse(JSON.stringify((tv.run(SOAK_DRAIN) as { heap: unknown[] }).heap))).toEqual([[1_000_000 + HEAP_EVERY * SAMPLE_MS, null]]);
  });

  it('keeps an hour of samples and counts what it drops', () => {
    expect(SAMPLE_CAP * SAMPLE_MS).toBe(3_600_000);
    const tv = page({});
    tv.run(SOAK_SAMPLER);
    tv.tick(SAMPLE_CAP + 2);
    const drain = JSON.parse(JSON.stringify(tv.run(SOAK_DRAIN))) as { samples: [number][]; dropped: number };
    expect(drain.samples).toHaveLength(SAMPLE_CAP);
    expect(drain.dropped).toBe(2);
    expect(drain.samples[0]?.[0]).toBe(1_000_000 + 3 * SAMPLE_MS);
    expect((tv.run(SOAK_DRAIN) as { dropped: number }).dropped).toBe(0);
  });

  it('restarts cleanly when installed twice, and the drain is null without it', () => {
    const tv = page({});
    expect(tv.run(SOAK_DRAIN)).toBeNull();
    tv.run(SOAK_SAMPLER);
    tv.tick(2);
    tv.run(SOAK_SAMPLER);
    expect(tv.intervals.size).toBe(1);
    tv.tick(1);
    expect((tv.run(SOAK_DRAIN) as { samples: unknown[] }).samples).toHaveLength(1);
  });
});
