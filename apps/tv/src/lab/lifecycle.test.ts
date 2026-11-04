import type { LifecycleEvent } from '@zoma/platform-api';
import { describe, expect, it } from 'vitest';
import type { LifecycleClock, LifecycleEntry } from './lifecycle';
import { createLifecycleLog, lifecycleNote } from './lifecycle';

function platform() {
  let listener: ((event: LifecycleEvent) => void) | null = null;
  let stopped = 0;
  return {
    onLifecycle: (next: (event: LifecycleEvent) => void) => {
      listener = next;
      return () => {
        stopped += 1;
        listener = null;
      };
    },
    fire: (event: LifecycleEvent) => listener?.(event),
    stopped: () => stopped,
  };
}

function clock(): LifecycleClock & { t: number; state: string; beat(): void; stopped: number } {
  let beat: (() => void) | null = null;
  const c = {
    t: 0,
    state: 'visible',
    stopped: 0,
    ms: () => c.t,
    iso: () => new Date(Date.UTC(2026, 10, 4, 0, 0, 0, c.t)).toISOString(),
    visibility: () => c.state,
    every: (run: () => void, ms: number) => {
      expect(ms).toBe(1000);
      beat = run;
      return () => {
        c.stopped += 1;
      };
    },
    beat: () => beat?.(),
  };
  return c;
}

const entry = (event: LifecycleEvent, ms: number, away?: { ms: number; beats: number }): LifecycleEntry => ({ event, ms, at: '', visibility: null, ...(away === undefined ? {} : { away }) });

describe("S11's lifecycle log (RELAY step 15b2)", () => {
  it('keeps every event, hands the early ones to the collector once it is attached, and the later ones at once', () => {
    const p = platform();
    const c = clock();
    const log = createLifecycleLog(p, c);
    c.t = 1200.4;
    c.state = 'hidden';
    p.fire('hidden');
    expect(log.entries).toEqual([{ event: 'hidden', ms: 1200, at: '2026-11-04T00:00:01.200Z', visibility: 'hidden' }]);
    const reported: string[] = [];
    log.attach((e) => reported.push(`${e.event}@${e.ms}`));
    expect(reported).toEqual(['hidden@1200']);
    c.t = 5000;
    c.state = 'visible';
    p.fire('visible');
    p.fire('relaunch');
    expect(reported).toEqual(['hidden@1200', 'visible@5000', 'relaunch@5000']);
    expect(log.entries.map((e) => e.visibility)).toEqual(['hidden', 'visible', 'visible']);
    log.stop();
    expect(p.stopped()).toBe(1);
    expect(c.stopped).toBe(1);
  });

  it('measures the time away and the heartbeats in it, from the first hidden to the next visible', () => {
    const p = platform();
    const c = clock();
    const log = createLifecycleLog(p, c);
    c.beat();
    c.t = 1000;
    p.fire('hidden');
    c.beat();
    c.t = 2000;
    // A second hidden (Tizen fires one on exit too) keeps the first one's start.
    p.fire('hidden');
    c.beat();
    c.t = 9000;
    p.fire('visible');
    expect(log.entries[2]?.away).toEqual({ ms: 8000, beats: 2 });
    // A visible with nothing hidden before it, and a relaunch, have no time away.
    p.fire('visible');
    p.fire('relaunch');
    expect(log.entries.slice(3).map((e) => e.away)).toEqual([undefined, undefined]);
    expect(Object.keys(log.entries[3] ?? {})).not.toContain('away');
    // The next trip counts from its own start.
    c.t = 10_000;
    p.fire('hidden');
    c.t = 10_500;
    p.fire('visible');
    expect(log.entries[6]?.away).toEqual({ ms: 500, beats: 0 });
  });

  it('writes the log as times since the start, with the time away', () => {
    expect(lifecycleNote([])).toBe('no lifecycle events yet: press Home, come back to the lab (or launch it again), then run S11 alone');
    expect(lifecycleNote([entry('hidden', 12_300), entry('visible', 40_100, { ms: 27_800, beats: 3 }), entry('relaunch', 51_000)])).toBe(
      'hidden at 12.3 s, visible at 40.1 s (away 27.8 s, 3 beats), relaunch at 51.0 s',
    );
    expect(lifecycleNote([entry('visible', 2000, { ms: 1000, beats: 1 })])).toBe('visible at 2.0 s (away 1.0 s, 1 beat)');
    expect(lifecycleNote([entry('visible', 2000)])).toBe('visible at 2.0 s');
    const many = [1, 2, 3, 4, 5, 6, 7].map((i) => entry(i % 2 === 1 ? 'hidden' : 'visible', i * 1000));
    expect(lifecycleNote(many)).toBe('hidden at 1.0 s, visible at 2.0 s, … 3 more, visible at 6.0 s, hidden at 7.0 s');
    expect(lifecycleNote(many.slice(0, 6))).toBe('hidden at 1.0 s, visible at 2.0 s, hidden at 3.0 s, visible at 4.0 s, hidden at 5.0 s, visible at 6.0 s');
  });
});
