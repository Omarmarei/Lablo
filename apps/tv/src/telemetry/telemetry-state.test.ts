import type { LoadedProfile, TelemetrySendRequest, TelemetrySendResult } from '@lablo/data';
import type { LifecycleEvent } from '@lablo/platform-api';
import type { TelemetryEvent } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import type { SchedulerTimers } from '../data/refresh-scheduler';
import type { TelemetryCall, TelemetryEngine } from './telemetry-state';
import { TELEMETRY_FIRST_MS, TELEMETRY_GAP_MS, TELEMETRY_MEMORY_MAX, createTelemetry, telemetryOn } from './telemetry-state';

// RELAY step 33b1: when main hands its events to the telemetry worker.

const T0 = Date.UTC(2026, 10, 19, 9, 0, 0);
const CALL: TelemetryCall = { base: 'http://127.0.0.1:3100', platform: 'webos', appVersion: '1.2.3', sampling: null };

const stall = (attempts: number): TelemetryEvent => ({ kind: 'stall', at: T0 + attempts, recovered: true, attempts });

interface Held {
  readonly request: TelemetrySendRequest;
  resolve(r: TelemetrySendResult): void;
  reject(error: unknown): void;
}

/** A data engine whose sends are held until the test settles them. */
class FakeEngine implements TelemetryEngine {
  readonly runs: Held[] = [];
  sendTelemetry(request: TelemetrySendRequest): Promise<TelemetrySendResult> {
    return new Promise<TelemetrySendResult>((resolve, reject) => {
      this.runs.push({ request, resolve, reject });
    });
  }
  get last(): Held {
    const held = this.runs[this.runs.length - 1];
    if (held === undefined) throw new Error('no run');
    return held;
  }
}

/** Timers run by hand, with a clock that `advance` moves (as in backup-schedule.test.ts). */
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

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const SENT = (sent: number, queued = 0): TelemetrySendResult => ({ state: 'sent', sent, queued });

function setup(call: () => TelemetryCall = () => CALL) {
  const engine = new FakeEngine();
  const clock = manualTimers(T0);
  let listener: ((event: LifecycleEvent) => void) | null = null;
  let subscriptions = 0;
  let unsubscribed = 0;
  const warnings: [string, unknown][] = [];
  const telemetry = createTelemetry({
    engine,
    request: call,
    lifecycle: (l) => {
      subscriptions += 1;
      listener = l;
      return () => {
        unsubscribed += 1;
        listener = null;
      };
    },
    now: clock.now,
    timers: clock.timers,
    warn: (message, detail) => warnings.push([message, detail]),
  });
  const lifecycle = (event: LifecycleEvent): void => {
    if (listener === null) throw new Error('not subscribed');
    listener(event);
  };
  return { engine, clock, telemetry, warnings, lifecycle, subscribed: () => listener !== null, subscriptions: () => subscriptions, unsubscribed: () => unsubscribed };
}

describe('the telemetry schedule', () => {
  it('keeps its timings (pinned)', () => {
    expect(TELEMETRY_FIRST_MS).toBe(60_000);
    expect(TELEMETRY_GAP_MS).toBe(15 * 60_000);
    expect(TELEMETRY_MEMORY_MAX).toBe(200);
  });

  it('sends 60 s after the first event not yet sent, with the request asked afresh, and the events in their order', async () => {
    let sampling: Readonly<Record<string, number>> | null = null;
    const t = setup(() => ({ base: CALL.base, platform: CALL.platform, appVersion: CALL.appVersion, sampling }));
    t.telemetry.load(true);
    t.telemetry.start();
    expect(t.clock.due()).toEqual([]);
    t.telemetry.record(stall(1));
    expect(t.clock.due()).toEqual([TELEMETRY_FIRST_MS]);
    t.clock.advance(30_000);
    // A second event doesn't move it.
    t.telemetry.record(stall(2));
    expect(t.clock.due()).toEqual([30_000]);
    sampling = { stall: 0.5 };
    t.clock.advance(29_999);
    expect(t.engine.runs).toHaveLength(0);
    t.clock.advance(1);
    expect(t.engine.runs).toHaveLength(1);
    expect(t.engine.last.request).toEqual({ ...CALL, sampling: { stall: 0.5 }, events: [stall(1), stall(2)] });
    expect(t.telemetry.idle()).toBe(false);
    t.engine.last.resolve(SENT(2));
    await flush();
    expect(t.telemetry.idle()).toBe(true);
    expect(t.clock.due()).toEqual([]);
    expect(t.warnings).toEqual([]);
  });

  it('sends no sooner than 15 minutes after the last send began', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    t.telemetry.record(stall(1));
    t.clock.advance(TELEMETRY_FIRST_MS);
    t.engine.last.resolve(SENT(1));
    await flush();
    t.clock.advance(1_000);
    t.telemetry.record(stall(2));
    // The gap counts from the last send's start, 1 s ago.
    expect(t.clock.due()).toEqual([TELEMETRY_GAP_MS - 1_000]);
    t.clock.advance(TELEMETRY_GAP_MS - 1_001);
    expect(t.engine.runs).toHaveLength(1);
    t.clock.advance(1);
    expect(t.engine.runs).toHaveLength(2);
    expect(t.engine.last.request.events).toEqual([stall(2)]);
    // Long after the gap, an event waits its 60 s only.
    t.engine.last.resolve(SENT(1));
    await flush();
    t.clock.advance(TELEMETRY_GAP_MS * 2);
    t.telemetry.record(stall(3));
    expect(t.clock.due()).toEqual([TELEMETRY_FIRST_MS]);
  });

  it('holds what is recorded before the profile is read, then drops it when the switch is off and records nothing more', async () => {
    const t = setup();
    t.telemetry.start();
    t.telemetry.record(stall(1));
    // Not read yet: held, nothing timed, nothing sent when hidden.
    expect(t.clock.due()).toEqual([]);
    t.lifecycle('hidden');
    expect(t.engine.runs).toHaveLength(0);
    t.lifecycle('visible');
    t.telemetry.load(false);
    t.telemetry.record(stall(2));
    expect(t.clock.due()).toEqual([]);
    t.clock.advance(TELEMETRY_GAP_MS * 2);
    expect(t.engine.runs).toHaveLength(0);
    // A send asked by the test hook carries nothing (the worker answers off).
    const asked = t.telemetry.sendNow();
    expect(t.engine.last.request.events).toEqual([]);
    t.engine.last.resolve({ state: 'off' });
    expect(await asked).toEqual({ state: 'off' });

    // Held while not read, then on: sent 60 s after the first was recorded.
    const u = setup();
    u.telemetry.start();
    u.telemetry.record(stall(1));
    u.clock.advance(20_000);
    u.telemetry.load(true);
    expect(u.clock.due()).toEqual([40_000]);
    u.clock.advance(40_000);
    expect(u.engine.last.request.events).toEqual([stall(1)]);

    // Read as off with something held, then on from Settings: nothing is left to send.
    const v = setup();
    v.telemetry.start();
    v.telemetry.record(stall(1));
    v.telemetry.load(false);
    v.telemetry.setOn(true);
    expect(v.clock.due()).toEqual([]);
    v.clock.advance(TELEMETRY_GAP_MS * 2);
    expect(v.engine.runs).toHaveLength(0);
    // The next event is timed as a first one.
    v.telemetry.record(stall(2));
    expect(v.clock.due()).toEqual([TELEMETRY_FIRST_MS]);
  });

  it('sends nothing before the live screen starts it, then what was recorded meanwhile', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.record(stall(1));
    t.clock.advance(TELEMETRY_GAP_MS);
    expect(t.engine.runs).toHaveLength(0);
    await expect(t.telemetry.sendNow()).resolves.toBeNull();
    expect(t.subscribed()).toBe(false);
    t.telemetry.start();
    expect(t.subscribed()).toBe(true);
    // Its 60 s have passed: at once.
    expect(t.clock.due()).toEqual([0]);
    t.clock.advance(0);
    expect(t.engine.last.request.events).toEqual([stall(1)]);
  });

  it('keeps the newest 200 events in memory', () => {
    const t = setup();
    t.telemetry.load(true);
    for (let i = 0; i < 250; i++) t.telemetry.record(stall(i));
    t.telemetry.start();
    t.clock.advance(TELEMETRY_FIRST_MS);
    const sent = t.engine.last.request.events;
    expect(sent).toHaveLength(200);
    expect(sent[0]).toEqual(stall(50));
    expect(sent[199]).toEqual(stall(249));
  });

  it('sends once more 15 minutes after a send that left a queue, and not after one that left none', async () => {
    const left: TelemetrySendResult[] = [
      { state: 'failed', failure: 'network', status: null, queued: 3 },
      { state: 'failed', failure: 'status', status: 503, queued: 3 },
      SENT(200, 12),
      { state: 'refused', status: 413, dropped: 5, queued: 1 },
    ];
    for (const answer of left) {
      const t = setup();
      t.telemetry.load(true);
      t.telemetry.start();
      t.telemetry.record(stall(1));
      t.clock.advance(TELEMETRY_FIRST_MS);
      t.engine.last.resolve(answer);
      await flush();
      expect(t.clock.due()).toEqual([TELEMETRY_GAP_MS]);
      t.clock.advance(TELEMETRY_GAP_MS);
      expect(t.engine.runs).toHaveLength(2);
      expect(t.engine.last.request.events).toEqual([]);
      // That one emptied it: no more.
      t.engine.last.resolve(SENT(3));
      await flush();
      expect(t.clock.due()).toEqual([]);
    }
    for (const answer of [SENT(1), { state: 'refused', status: 400, dropped: 1, queued: 0 } as const, { state: 'empty' } as const, { state: 'off' } as const]) {
      const t = setup();
      t.telemetry.load(true);
      t.telemetry.start();
      t.telemetry.record(stall(1));
      t.clock.advance(TELEMETRY_FIRST_MS);
      t.engine.last.resolve(answer);
      await flush();
      expect(t.clock.due()).toEqual([]);
    }
  });

  it('tells a failure and a refusal, never with the request', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    for (const answer of [
      { state: 'failed', failure: 'network', status: null, queued: 1 },
      { state: 'failed', failure: 'status', status: 429, queued: 1 },
      { state: 'refused', status: 400, dropped: 1, queued: 0 },
    ] as const) {
      const asked = t.telemetry.sendNow();
      t.engine.last.resolve(answer);
      await asked;
    }
    expect(t.warnings).toEqual([
      ['Telemetry was not sent', 'network'],
      ['Telemetry was not sent', 429],
      ['Telemetry was refused', 400],
    ]);
  });

  it("puts a dead worker's events back before the ones recorded since, and sends them after the gap", async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    t.telemetry.record(stall(1));
    t.telemetry.record(stall(2));
    t.clock.advance(TELEMETRY_FIRST_MS);
    t.telemetry.record(stall(3));
    const dead = new Error('Telemetry worker failed: boom');
    t.engine.last.reject(dead);
    await flush();
    expect(t.warnings).toEqual([['Telemetry was not sent', dead]]);
    // Pending since the first: the gap from the failed send's start holds it.
    expect(t.clock.due()).toEqual([TELEMETRY_GAP_MS]);
    t.clock.advance(TELEMETRY_GAP_MS);
    expect(t.engine.last.request.events).toEqual([stall(1), stall(2), stall(3)]);

    // Back with many recorded since: the newest 200.
    const u = setup();
    u.telemetry.load(true);
    u.telemetry.start();
    for (let i = 0; i < 150; i++) u.telemetry.record(stall(i));
    u.clock.advance(TELEMETRY_FIRST_MS);
    for (let i = 150; i < 250; i++) u.telemetry.record(stall(i));
    u.engine.last.reject(new Error('gone'));
    await flush();
    u.clock.advance(TELEMETRY_GAP_MS);
    const sent = u.engine.last.request.events;
    expect(sent).toHaveLength(200);
    expect(sent[0]).toEqual(stall(50));
    expect(sent[199]).toEqual(stall(249));

    // A dead send that carried nothing (a retry) leaves an event recorded meanwhile pending.
    const r = setup();
    r.telemetry.load(true);
    r.telemetry.start();
    const asked = r.telemetry.sendNow();
    r.engine.last.resolve({ state: 'failed', failure: 'network', status: null, queued: 4 });
    await asked;
    r.clock.advance(TELEMETRY_GAP_MS);
    expect(r.engine.runs).toHaveLength(2);
    expect(r.engine.last.request.events).toEqual([]);
    r.telemetry.record(stall(7));
    r.engine.last.reject(new Error('gone'));
    await flush();
    expect(r.clock.due()).toEqual([TELEMETRY_GAP_MS]);
    r.clock.advance(TELEMETRY_GAP_MS);
    expect(r.engine.last.request.events).toEqual([stall(7)]);

    // A request that throws counts as a dead worker.
    let throwing = true;
    const v = setup(() => {
      if (throwing) throw new Error('no config');
      return CALL;
    });
    v.telemetry.load(true);
    v.telemetry.start();
    v.telemetry.record(stall(1));
    v.clock.advance(TELEMETRY_FIRST_MS);
    expect(v.engine.runs).toHaveLength(0);
    await flush();
    throwing = false;
    v.clock.advance(TELEMETRY_GAP_MS);
    expect(v.engine.last.request.events).toEqual([stall(1)]);
  });

  it('sends one at a time: an event recorded during a send waits for the next', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    t.telemetry.record(stall(1));
    t.clock.advance(TELEMETRY_FIRST_MS);
    t.telemetry.record(stall(2));
    // Nothing timed while one runs.
    expect(t.clock.due()).toEqual([]);
    t.engine.last.resolve(SENT(1));
    await flush();
    expect(t.clock.due()).toEqual([TELEMETRY_GAP_MS]);
    t.clock.advance(TELEMETRY_GAP_MS);
    expect(t.engine.runs).toHaveLength(2);
    expect(t.engine.last.request.events).toEqual([stall(2)]);
  });

  it('sends once at once when hidden with something pending, times nothing while hidden, and arms again when shown', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    // Hidden with nothing pending: nothing.
    t.lifecycle('hidden');
    expect(t.engine.runs).toHaveLength(0);
    t.lifecycle('visible');
    t.telemetry.record(stall(1));
    t.lifecycle('hidden');
    expect(t.engine.runs).toHaveLength(1);
    expect(t.clock.due()).toEqual([]);
    // Twice hidden is once, during the send and after it.
    t.lifecycle('hidden');
    t.telemetry.record(stall(2));
    t.engine.last.resolve(SENT(1));
    await flush();
    t.lifecycle('hidden');
    // One send each time it is hidden: the new event waits for the app to show.
    expect(t.engine.runs).toHaveLength(1);
    expect(t.clock.due()).toEqual([]);
    t.clock.advance(TELEMETRY_GAP_MS);
    expect(t.engine.runs).toHaveLength(1);
    t.lifecycle('visible');
    expect(t.clock.due()).toEqual([0]);
    t.clock.advance(0);
    expect(t.engine.last.request.events).toEqual([stall(2)]);

    // Hidden after a send that left a queue: its retry goes at once.
    t.engine.last.resolve({ state: 'failed', failure: 'timeout', status: null, queued: 1 });
    await flush();
    t.lifecycle('hidden');
    expect(t.engine.runs).toHaveLength(3);
    expect(t.engine.last.request.events).toEqual([]);

    // Hidden while a send runs: no second one.
    const u = setup();
    u.telemetry.load(true);
    u.telemetry.start();
    u.telemetry.record(stall(1));
    u.clock.advance(TELEMETRY_FIRST_MS);
    u.telemetry.record(stall(2));
    u.lifecycle('hidden');
    expect(u.engine.runs).toHaveLength(1);

    // Hidden with the switch off: nothing.
    const v = setup();
    v.telemetry.load(false);
    v.telemetry.start();
    v.telemetry.record(stall(1));
    v.lifecycle('hidden');
    expect(v.engine.runs).toHaveLength(0);
  });

  it('off from Settings drops what is held and sends once, so the worker clears the queue; on again records', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    t.telemetry.record(stall(1));
    t.telemetry.setOn(true);
    expect(t.engine.runs).toHaveLength(0);
    t.telemetry.setOn(false);
    expect(t.engine.runs).toHaveLength(1);
    expect(t.engine.last.request.events).toEqual([]);
    t.engine.last.resolve({ state: 'off' });
    await flush();
    t.telemetry.record(stall(2));
    t.telemetry.setOn(false);
    expect(t.engine.runs).toHaveLength(1);
    expect(t.clock.due()).toEqual([]);
    t.telemetry.setOn(true);
    expect(t.clock.due()).toEqual([]);
    t.telemetry.record(stall(3));
    expect(t.clock.due()).toEqual([TELEMETRY_GAP_MS]);
    t.clock.advance(TELEMETRY_GAP_MS);
    expect(t.engine.last.request.events).toEqual([stall(3)]);

    // Off before the live screen: nothing to send yet, the next start's worker reads the profile.
    const u = setup();
    u.telemetry.load(true);
    u.telemetry.record(stall(1));
    u.telemetry.setOn(false);
    expect(u.engine.runs).toHaveLength(0);
    u.telemetry.start();
    expect(u.clock.due()).toEqual([]);

    // A failure's retry ends with off.
    const v = setup();
    v.telemetry.load(true);
    v.telemetry.start();
    const asked = v.telemetry.sendNow();
    v.engine.last.resolve({ state: 'failed', failure: 'network', status: null, queued: 2 });
    await asked;
    expect(v.clock.due()).toEqual([TELEMETRY_GAP_MS]);
    v.telemetry.setOn(false);
    v.engine.last.resolve({ state: 'off' });
    await flush();
    expect(v.clock.due()).toEqual([]);
    // Off during a send: the clearing send comes right after it (that one read the switch before
    // it changed), and a dead worker's events aren't put back once off.
    const w = setup();
    w.telemetry.load(true);
    w.telemetry.start();
    w.telemetry.record(stall(1));
    w.clock.advance(TELEMETRY_FIRST_MS);
    w.telemetry.setOn(false);
    expect(w.engine.runs).toHaveLength(1);
    w.engine.runs[0]!.reject(new Error('gone'));
    await flush();
    expect(w.engine.runs).toHaveLength(2);
    expect(w.engine.runs[1]!.request.events).toEqual([]);
    w.engine.runs[1]!.resolve({ state: 'off' });
    await flush();
    expect(w.clock.due()).toEqual([]);
    w.telemetry.setOn(true);
    w.telemetry.record(stall(2));
    w.clock.advance(TELEMETRY_GAP_MS);
    expect(w.engine.runs).toHaveLength(3);
    expect(w.engine.runs[2]!.request.events).toEqual([stall(2)]);
  });

  it("reads the profile's switch: on unless it says false, and with no profile yet (step 33b3)", () => {
    const profile = (doc: Record<string, unknown>) => ({ doc, newer: false, migratedFrom: null }) as unknown as LoadedProfile;
    expect(telemetryOn(null)).toBe(true);
    expect(telemetryOn(profile({ v: 1 }))).toBe(true);
    expect(telemetryOn(profile({ v: 1, telemetry: false }))).toBe(false);
    // Only `false` turns it off (a value an older or newer app wrote otherwise counts as on).
    expect(telemetryOn(profile({ v: 1, telemetry: 0 }))).toBe(true);
    expect(telemetryOn(profile({ v: 1, telemetry: true }))).toBe(true);
  });

  it("resolves Settings' off once its clearing send has answered, and on, a repeat or off while stopped at once (step 33b3)", async () => {
    const settled = (promise: Promise<void>): (() => boolean) => {
      let done = false;
      void promise.then(() => {
        done = true;
      });
      return () => done;
    };
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    // On while on, then off: held until the clearing send answers.
    const same = settled(t.telemetry.setOn(true));
    await flush();
    expect(same()).toBe(true);
    const off = settled(t.telemetry.setOn(false));
    await flush();
    expect(t.engine.runs).toHaveLength(1);
    expect(off()).toBe(false);
    t.engine.last.resolve({ state: 'off' });
    await flush();
    expect(off()).toBe(true);
    // Off again: nothing to clear twice.
    const again = settled(t.telemetry.setOn(false));
    await flush();
    expect(again()).toBe(true);
    expect(t.engine.runs).toHaveLength(1);
    const on = settled(t.telemetry.setOn(true));
    await flush();
    expect(on()).toBe(true);

    // Off during a send: it resolves after the send in progress and the clearing one after it.
    const u = setup();
    u.telemetry.load(true);
    u.telemetry.start();
    void u.telemetry.sendNow();
    const later = settled(u.telemetry.setOn(false));
    u.engine.runs[0]!.resolve(SENT(0));
    await flush();
    expect(u.engine.runs).toHaveLength(2);
    expect(later()).toBe(false);
    // A clearing send whose worker died resolves too.
    u.engine.runs[1]!.reject(new Error('gone'));
    await flush();
    expect(later()).toBe(true);

    // Stopped (the config's disable-app): at once, with no send.
    const v = setup();
    v.telemetry.load(true);
    const stopped = settled(v.telemetry.setOn(false));
    await flush();
    expect(stopped()).toBe(true);
    expect(v.engine.runs).toHaveLength(0);

    // Disposed during the clearing send: resolved when that send answers, and not before.
    const w = setup();
    w.telemetry.load(true);
    w.telemetry.start();
    const gone = settled(w.telemetry.setOn(false));
    w.telemetry.dispose();
    await flush();
    expect(gone()).toBe(false);
    w.engine.last.resolve({ state: 'off' });
    await flush();
    expect(gone()).toBe(true);
    // Disposed with a clearing send still waiting behind another: resolved at once.
    const x = setup();
    x.telemetry.load(true);
    x.telemetry.start();
    void x.telemetry.sendNow();
    const waiting = settled(x.telemetry.setOn(false));
    x.telemetry.dispose();
    await flush();
    expect(waiting()).toBe(true);
  });

  it('stops with disable-app (a send in progress finishes) and starts again', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    t.telemetry.record(stall(1));
    t.telemetry.stop();
    expect(t.clock.due()).toEqual([]);
    expect(t.unsubscribed()).toBe(1);
    t.clock.advance(TELEMETRY_GAP_MS);
    expect(t.engine.runs).toHaveLength(0);
    await expect(t.telemetry.sendNow()).resolves.toBeNull();
    t.telemetry.start();
    t.clock.advance(0);
    expect(t.engine.last.request.events).toEqual([stall(1)]);
    // Stopped mid-send: the answer comes, nothing is timed after it.
    t.telemetry.record(stall(2));
    t.telemetry.stop();
    t.engine.last.resolve(SENT(1));
    await flush();
    expect(t.clock.due()).toEqual([]);
    // Hidden while stopped: no listener.
    expect(t.subscribed()).toBe(false);

    // Stopped while hidden, then started: shown again as far as the schedule knows.
    const u = setup();
    u.telemetry.load(true);
    u.telemetry.start();
    u.lifecycle('hidden');
    u.telemetry.stop();
    u.telemetry.start();
    u.telemetry.record(stall(1));
    expect(u.clock.due()).toEqual([TELEMETRY_FIRST_MS]);
    // Started twice: one listener.
    u.telemetry.start();
    expect(u.subscriptions()).toBe(2);
    u.telemetry.stop();
    expect(u.unsubscribed()).toBe(2);
    expect(u.subscribed()).toBe(false);
  });

  it('answers sendNow with the next send, sharing it with the calls made meanwhile, and a call during a send gets the next', async () => {
    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    t.telemetry.record(stall(1));
    const first = t.telemetry.sendNow();
    expect(t.engine.runs).toHaveLength(1);
    expect(t.clock.due()).toEqual([]);
    const second = t.telemetry.sendNow();
    expect(t.engine.runs).toHaveLength(1);
    t.engine.runs[0]!.resolve(SENT(1));
    expect(await first).toEqual(SENT(1));
    await flush();
    expect(t.engine.runs).toHaveLength(2);
    t.engine.runs[1]!.resolve({ state: 'empty' });
    expect(await second).toEqual({ state: 'empty' });
    // A dead worker answers null.
    const third = t.telemetry.sendNow();
    t.engine.last.reject(new Error('gone'));
    expect(await third).toBeNull();
  });

  it('settles waiting calls with null when disposed, and records and sends nothing after', async () => {
    // A timer armed before is let go.
    const armed = setup();
    armed.telemetry.load(true);
    armed.telemetry.start();
    armed.telemetry.record(stall(1));
    armed.telemetry.dispose();
    expect(armed.clock.due()).toEqual([]);
    armed.clock.advance(TELEMETRY_GAP_MS);
    expect(armed.engine.runs).toHaveLength(0);

    const t = setup();
    t.telemetry.load(true);
    t.telemetry.start();
    const first = t.telemetry.sendNow();
    const second = t.telemetry.sendNow();
    t.telemetry.dispose();
    expect(await second).toBeNull();
    expect(t.unsubscribed()).toBe(1);
    t.engine.last.resolve(SENT(0));
    expect(await first).toEqual(SENT(0));
    await flush();
    expect(t.engine.runs).toHaveLength(1);
    t.telemetry.record(stall(1));
    t.telemetry.load(true);
    t.telemetry.setOn(false);
    t.telemetry.start();
    expect(t.clock.due()).toEqual([]);
    await expect(t.telemetry.sendNow()).resolves.toBeNull();
    expect(t.engine.runs).toHaveLength(1);
  });
});

describe('recent', () => {
  const play = (at: number): TelemetryEvent => ({ kind: 'play_result', at, engine: 'html5', container: 'hls', mode: 'live', ttffMs: 900, error: null });
  const crash: TelemetryEvent = { kind: 'crash', at: T0, where: 'main', stack: 'Uncaught Error: x' };
  const start: TelemetryEvent = { kind: 'app_start', at: T0, tier: 'full', coldStartMs: 1000, catalog: '0' };

  it('keeps the last 10 plays, stalls and crashes, oldest first, whatever the switch, for the diagnostics report (step 33d2)', () => {
    const t = setup();
    expect(t.telemetry.recent()).toEqual([]);
    // Before the switch is read, while it is off, and on: all kept; other kinds never.
    t.telemetry.record(stall(1));
    t.telemetry.load(false);
    t.telemetry.record(crash);
    t.telemetry.record(start);
    t.telemetry.record({ kind: 'epg_match', at: T0, rate: '100' });
    void t.telemetry.setOn(true);
    t.telemetry.record(play(T0 + 1));
    expect(t.telemetry.recent()).toEqual([stall(1), crash, play(T0 + 1)]);
    for (let i = 2; i <= 12; i++) t.telemetry.record(play(T0 + i));
    const kept = t.telemetry.recent();
    expect(kept.map((e) => e.at)).toEqual([T0 + 3, T0 + 4, T0 + 5, T0 + 6, T0 + 7, T0 + 8, T0 + 9, T0 + 10, T0 + 11, T0 + 12]);
    // A copy: changing it changes nothing kept.
    kept.length = 0;
    expect(t.telemetry.recent()).toHaveLength(10);
    // A send takes the held events, never these.
    t.telemetry.start();
    void t.telemetry.sendNow();
    expect(t.telemetry.recent()).toHaveLength(10);
  });
});
