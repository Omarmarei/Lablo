import type { ConfigPolicy, ConfigResult, ConfigRunRequest } from '@lablo/data';
import { CONFIG_REFRESH_MS, CONFIG_RETRY_MS, noPolicy } from '@lablo/data/client';
import type { LifecycleEvent } from '@lablo/platform-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigEngine } from './config-schedule';
import { createConfigSchedule } from './config-schedule';
import type { SchedulerTimers } from './refresh-scheduler';

const T0 = Date.UTC(2026, 10, 17, 9, 0, 0);
const REQUEST: ConfigRunRequest = { base: 'http://127.0.0.1:3100', platform: 'webos', version: '0.1.0', keys: ['XSL7BTMmu8T8z5VeovgdDDUYpXucxAgRpaNV8mOUSxc'] };

function policy(kill: string | null): ConfigPolicy {
  return { ...noPolicy(), kill: kill === null ? null : { id: kill, mode: 'disable-playback', message: null } };
}

function result(status: ConfigResult['status'], kill: string | null, failure: ConfigResult['failure'] = null): ConfigResult {
  return { status, policy: policy(kill), issuedAt: kill === null ? null : 1, expiresAt: kill === null ? null : 2, failure, stored: status !== 'none' };
}

interface Held {
  readonly request: ConfigRunRequest;
  /** Sends the cached copy's policy, as the worker does after reading it. */
  cached(r: ConfigResult): void;
  resolve(r: ConfigResult): void;
  reject(error: unknown): void;
}

/** A data engine whose config runs are held until the test settles them. */
class FakeEngine implements ConfigEngine {
  readonly runs: Held[] = [];
  refreshConfig(request: ConfigRunRequest, onCached?: (r: ConfigResult) => void): Promise<ConfigResult> {
    return new Promise<ConfigResult>((resolve, reject) => {
      this.runs.push({ request, cached: (r) => onCached?.(r), resolve, reject });
    });
  }
  get last(): Held {
    const held = this.runs[this.runs.length - 1];
    if (held === undefined) throw new Error('no run');
    return held;
  }
}

/** Timers run by hand, with a clock that `advance` moves (as in refresh-scheduler.test.ts). */
function manualTimers(start: number) {
  let now = start;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: SchedulerTimers = {
    set: (run, ms) => {
      seq += 1;
      queue.push({ id: seq, at: now + ms, run });
      return seq;
    },
    clear: (handle) => {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  return {
    timers,
    now: () => now,
    due: () => queue.map((t) => t.at - now).sort((a, b) => a - b),
    /** Moves the clock without running timers (a TV asleep: its timers didn't run). */
    jump(ms: number): void {
      now += ms;
    },
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const schedules: { dispose(): void }[] = [];
afterEach(() => {
  for (const s of schedules.splice(0)) s.dispose();
  vi.restoreAllMocks();
});

function setup(options: { lifecycle?: boolean } = {}) {
  const engine = new FakeEngine();
  const clock = manualTimers(T0);
  const paints: (() => void)[] = [];
  let listener: ((event: LifecycleEvent) => void) | null = null;
  let unsubscribed = 0;
  const schedule = createConfigSchedule({
    engine,
    request: REQUEST,
    afterPaint: (run) => paints.push(run),
    ...(options.lifecycle === false
      ? {}
      : {
          lifecycle: (l: (event: LifecycleEvent) => void) => {
            listener = l;
            return () => {
              unsubscribed += 1;
              listener = null;
            };
          },
        }),
    now: clock.now,
    timers: clock.timers,
  });
  schedules.push(schedule);
  const paint = (): void => {
    for (const run of paints.splice(0)) run();
  };
  const emit = (event: LifecycleEvent): void => {
    if (listener === null) throw new Error('no lifecycle listener');
    listener(event);
  };
  /** Finishes the run in progress with `r` and lets the schedule see it. */
  const finish = async (r: ConfigResult): Promise<void> => {
    engine.last.resolve(r);
    await settle();
  };
  return { engine, clock, schedule, paint, emit, finish, paints, unsubscribed: () => unsubscribed, listening: () => listener !== null };
}

describe('createConfigSchedule', () => {
  it('starts with the defaults and runs nothing before start and the paint after it', () => {
    const { engine, schedule, paint, paints, clock } = setup();
    expect(schedule.policy.value).toEqual(noPolicy());
    expect(schedule.last.value).toBeNull();
    clock.advance(CONFIG_REFRESH_MS * 2);
    paint();
    expect(engine.runs).toHaveLength(0);
    schedule.start();
    expect(paints).toHaveLength(1);
    expect(engine.runs).toHaveLength(0);
    paint();
    expect(engine.runs).toHaveLength(1);
    expect(engine.last.request).toBe(REQUEST);
    // Only the first start counts.
    schedule.start();
    expect(paints).toHaveLength(0);
  });

  it("applies the cached copy's policy as soon as the worker sends it, then the run's", async () => {
    const { engine, schedule, paint, finish } = setup();
    schedule.start();
    paint();
    engine.last.cached(result('cached', 'old'));
    expect(schedule.policy.value.kill?.id).toBe('old');
    expect(schedule.last.value?.status).toBe('cached');
    await finish(result('fresh', 'new'));
    expect(schedule.policy.value.kill?.id).toBe('new');
    expect(schedule.last.value?.status).toBe('fresh');
  });

  it(`runs again ${CONFIG_REFRESH_MS / 3_600_000} h after a run that brought a new doc`, async () => {
    const { engine, schedule, paint, finish, clock } = setup();
    schedule.start();
    paint();
    await finish(result('fresh', 'a'));
    expect(clock.due()).toEqual([CONFIG_REFRESH_MS]);
    clock.advance(CONFIG_REFRESH_MS - 1);
    expect(engine.runs).toHaveLength(1);
    clock.advance(1);
    expect(engine.runs).toHaveLength(2);
    // No timer while a run is in progress: one run at a time.
    expect(clock.due()).toEqual([]);
    await finish(result('fresh', 'b'));
    expect(clock.due()).toEqual([CONFIG_REFRESH_MS]);
  });

  it(`tries again after ${CONFIG_RETRY_MS / 60_000} min when a run brought no new doc, or its worker died`, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { engine, schedule, paint, finish, clock } = setup();
    schedule.start();
    paint();
    await finish(result('none', null, 'network'));
    expect(schedule.policy.value).toEqual(noPolicy());
    expect(clock.due()).toEqual([CONFIG_RETRY_MS]);
    clock.advance(CONFIG_RETRY_MS);
    await finish(result('cached', 'kept', 'timeout'));
    expect(schedule.policy.value.kill?.id).toBe('kept');
    expect(clock.due()).toEqual([CONFIG_RETRY_MS]);
    clock.advance(CONFIG_RETRY_MS);
    engine.last.reject(new Error('Config worker failed: boom'));
    await settle();
    // The policy in force stays.
    expect(schedule.policy.value.kill?.id).toBe('kept');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(clock.due()).toEqual([CONFIG_RETRY_MS]);
    clock.advance(CONFIG_RETRY_MS);
    await finish(result('fresh', 'new'));
    expect(clock.due()).toEqual([CONFIG_REFRESH_MS]);
  });

  it('runs a run that fell due while hidden when the app is visible again, and none before', async () => {
    const { engine, schedule, paint, finish, clock, emit } = setup();
    schedule.start();
    paint();
    await finish(result('fresh', 'a'));
    emit('hidden');
    clock.advance(CONFIG_REFRESH_MS + 5_000);
    expect(engine.runs).toHaveLength(1);
    emit('hidden');
    expect(engine.runs).toHaveLength(1);
    emit('visible');
    expect(engine.runs).toHaveLength(2);
    await finish(result('fresh', 'b'));
    // Due exactly when the app is visible again: it runs.
    emit('hidden');
    clock.advance(CONFIG_REFRESH_MS);
    expect(engine.runs).toHaveLength(2);
    emit('visible');
    expect(engine.runs).toHaveLength(3);
    await finish(result('fresh', 'c'));
    // Visible again before it is due: nothing.
    emit('hidden');
    clock.advance(CONFIG_REFRESH_MS - 1);
    emit('visible');
    expect(engine.runs).toHaveLength(3);
    clock.advance(1);
    expect(engine.runs).toHaveLength(4);
  });

  it('runs at once when a TV that slept past the due time wakes (its timer never ran)', async () => {
    const { engine, schedule, paint, finish, clock, emit } = setup();
    schedule.start();
    paint();
    await finish(result('fresh', 'a'));
    emit('hidden');
    clock.jump(CONFIG_REFRESH_MS * 3);
    emit('relaunch');
    expect(engine.runs).toHaveLength(2);
    // The run ends before the stale timer can fire: its end replaces that timer.
    await finish(result('fresh', 'b'));
    expect(clock.due()).toEqual([CONFIG_REFRESH_MS]);
    clock.advance(1);
    expect(engine.runs).toHaveLength(2);
  });

  it("drops a stale timer that fires while a run started on waking is in progress", async () => {
    const { engine, schedule, paint, finish, clock, emit } = setup();
    schedule.start();
    paint();
    await finish(result('fresh', 'a'));
    emit('hidden');
    clock.jump(CONFIG_REFRESH_MS * 3);
    emit('visible');
    clock.advance(1);
    expect(engine.runs).toHaveLength(2);
    await finish(result('fresh', 'b'));
    expect(clock.due()).toEqual([CONFIG_REFRESH_MS]);
  });

  it('never starts a second run while one is in progress', async () => {
    const { engine, schedule, paint, clock, emit } = setup();
    schedule.start();
    paint();
    clock.jump(CONFIG_REFRESH_MS * 2);
    emit('visible');
    expect(engine.runs).toHaveLength(1);
  });

  it('ignores visibility before the first run', () => {
    const { engine, schedule, emit, paint } = setup();
    schedule.start();
    emit('hidden');
    emit('visible');
    expect(engine.runs).toHaveLength(0);
    paint();
    expect(engine.runs).toHaveLength(1);
  });

  it('runs the first run even if the app is hidden when the paint comes', () => {
    const { engine, schedule, emit, paint } = setup();
    schedule.start();
    emit('hidden');
    paint();
    expect(engine.runs).toHaveLength(1);
  });

  it('works without a lifecycle', async () => {
    const { engine, schedule, paint, finish, clock } = setup({ lifecycle: false });
    schedule.start();
    paint();
    await finish(result('fresh', 'a'));
    clock.advance(CONFIG_REFRESH_MS);
    expect(engine.runs).toHaveLength(2);
  });

  it('stops on dispose: no timer, no lifecycle, and the answer of a run in progress is dropped', async () => {
    const { engine, schedule, paint, clock, unsubscribed, listening } = setup();
    schedule.start();
    expect(listening()).toBe(true);
    paint();
    engine.last.cached(result('cached', 'old'));
    schedule.dispose();
    expect(unsubscribed()).toBe(1);
    expect(listening()).toBe(false);
    schedule.dispose();
    expect(unsubscribed()).toBe(1);
    engine.last.cached(result('cached', 'late'));
    engine.last.resolve(result('fresh', 'late'));
    await settle();
    expect(schedule.policy.value.kill?.id).toBe('old');
    expect(clock.due()).toEqual([]);
    clock.advance(CONFIG_REFRESH_MS * 2);
    expect(engine.runs).toHaveLength(1);
    // Started after dispose: nothing.
    schedule.start();
    expect(engine.runs).toHaveLength(1);
  });

  it('clears a waiting timer on dispose', async () => {
    const { engine, schedule, paint, finish, clock } = setup();
    schedule.start();
    paint();
    await finish(result('fresh', 'a'));
    expect(clock.due()).toEqual([CONFIG_REFRESH_MS]);
    schedule.dispose();
    expect(clock.due()).toEqual([]);
    clock.advance(CONFIG_REFRESH_MS * 2);
    expect(engine.runs).toHaveLength(1);
  });

  it('never starts once disposed, even if never started before', () => {
    const { engine, schedule, paint, paints, listening } = setup();
    schedule.dispose();
    schedule.start();
    expect(paints).toHaveLength(0);
    expect(listening()).toBe(false);
    paint();
    expect(engine.runs).toHaveLength(0);
  });

  it('never runs when disposed before the paint', () => {
    const { engine, schedule, paint } = setup();
    schedule.start();
    schedule.dispose();
    paint();
    expect(engine.runs).toHaveLength(0);
  });

  it('defaults to the next paint: an animation frame, then a task', async () => {
    const engine = new FakeEngine();
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
      frames.push(run);
      return frames.length;
    });
    try {
      const schedule = createConfigSchedule({ engine, request: REQUEST });
      schedules.push(schedule);
      schedule.start();
      expect(frames).toHaveLength(1);
      expect(engine.runs).toHaveLength(0);
      frames[0]!();
      // Not in the frame itself: after the paint that follows it.
      expect(engine.runs).toHaveLength(0);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(engine.runs).toHaveLength(1);
      engine.last.resolve(result('fresh', 'a'));
      await settle();
      expect(schedule.policy.value.kill?.id).toBe('a');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
