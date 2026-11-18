import type { BackupCallRequest, BackupUploadResult } from '@lablo/data';
import type { LifecycleEvent } from '@lablo/platform-api';
import { describe, expect, it } from 'vitest';
import type { SchedulerTimers } from '../data/refresh-scheduler';
import type { BackupScheduleEngine } from './backup-schedule';
import { BACKUP_CHANGE_MS, BACKUP_GAP_MS, HIDDEN_RUNS, createBackupSchedule } from './backup-schedule';

// RELAY step 32c2: when the app asks the backup worker to send the profile.

const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const REQUEST: BackupCallRequest = { platform: 'webos', appId: 'com.lablo.iptv', secret: 'LGUDID-1', base: 'http://127.0.0.1:3100' };

interface Held {
  readonly request: BackupCallRequest;
  /** `uploadBackup`, or "Replace it"'s `replaceHeldBackup` (step 32d2b). */
  readonly kind: 'upload' | 'replace';
  resolve(r: BackupUploadResult): void;
  reject(error: unknown): void;
}

/** A data engine whose uploads are held until the test settles them. */
class FakeEngine implements BackupScheduleEngine {
  readonly runs: Held[] = [];
  uploadBackup(request: BackupCallRequest): Promise<BackupUploadResult> {
    return this.held(request, 'upload');
  }
  replaceHeldBackup(request: BackupCallRequest): Promise<BackupUploadResult> {
    return this.held(request, 'replace');
  }
  private held(request: BackupCallRequest, kind: Held['kind']): Promise<BackupUploadResult> {
    return new Promise<BackupUploadResult>((resolve, reject) => {
      this.runs.push({ request, kind, resolve, reject });
    });
  }
  get last(): Held {
    const held = this.runs[this.runs.length - 1];
    if (held === undefined) throw new Error('no run');
    return held;
  }
}

/** Timers run by hand, with a clock that `advance` moves (as in config-schedule.test.ts). */
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

function setup(request: () => Promise<BackupCallRequest> = () => Promise.resolve(REQUEST)) {
  const engine = new FakeEngine();
  const clock = manualTimers(T0);
  let listener: ((event: LifecycleEvent) => void) | null = null;
  let unsubscribed = 0;
  const warnings: [string, unknown][] = [];
  const schedule = createBackupSchedule({
    engine,
    request,
    lifecycle: (l) => {
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
  return {
    engine,
    clock,
    schedule,
    warnings,
    unsubscribed: () => unsubscribed,
    subscribed: () => listener !== null,
    lifecycle: (event: LifecycleEvent) => listener?.(event),
  };
}

/** Settles the run in progress with `answer` and lets the schedule see it. */
async function answer(s: ReturnType<typeof setup>, result: BackupUploadResult): Promise<void> {
  s.engine.last.resolve(result);
  await flush();
}

describe('createBackupSchedule', () => {
  it('pins its timings: 60 s after a change, 5 minutes between runs, two runs for each hide', () => {
    expect(BACKUP_CHANGE_MS).toBe(60_000);
    expect(BACKUP_GAP_MS).toBe(300_000);
    expect(HIDDEN_RUNS).toBe(2);
  });

  it('runs nothing before start, and counts its start as a change: the first run 60 s on', async () => {
    const s = setup();
    s.schedule.changed();
    expect(s.clock.due()).toEqual([]);
    expect(await s.schedule.uploadNow()).toBeNull();
    expect(s.engine.runs).toHaveLength(0);
    s.schedule.start();
    expect(s.subscribed()).toBe(true);
    expect(s.clock.due()).toEqual([BACKUP_CHANGE_MS]);
    s.clock.advance(BACKUP_CHANGE_MS - 1);
    await flush();
    expect(s.engine.runs).toHaveLength(0);
    s.clock.advance(1);
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    expect(s.engine.last.request).toEqual(REQUEST);
    expect(s.schedule.idle()).toBe(false);
    await answer(s, { state: 'same' });
    expect(s.schedule.idle()).toBe(true);
    expect(s.schedule.last.value).toEqual({ state: 'same' });
    // Nothing pending: nothing timed.
    expect(s.clock.due()).toEqual([]);
    // A second start does nothing.
    s.schedule.start();
    expect(s.clock.due()).toEqual([]);
  });

  it('times a change from the first one not sent, and keeps 5 minutes between the starts of two runs', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    await answer(s, { state: 'sent' });
    // A change 10 s after the run began: due 5 minutes after that start, not 60 s after the change.
    s.clock.advance(10_000);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS - 10_000]);
    // More changes don't push it back.
    s.clock.advance(100_000);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS - 110_000]);
    s.clock.advance(BACKUP_GAP_MS - 110_000);
    await flush();
    expect(s.engine.runs).toHaveLength(2);
    await answer(s, { state: 'sent' });
    // A change long after: 60 s after it.
    s.clock.advance(BACKUP_GAP_MS * 2);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([BACKUP_CHANGE_MS]);
  });

  it('keeps a change made during a run for the next run, and runs one at a time', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    s.clock.advance(1_000);
    s.schedule.changed();
    // Nothing is timed while a run goes on.
    expect(s.clock.due()).toEqual([]);
    s.clock.advance(BACKUP_GAP_MS);
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    await answer(s, { state: 'sent' });
    // The change waits out its 60 s (the gap has passed).
    expect(s.clock.due()).toEqual([0]);
    s.clock.advance(0);
    await flush();
    expect(s.engine.runs).toHaveLength(2);
  });

  it('keeps a change pending after a failed run or a dead worker, the next try 5 minutes on, and logs it', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    await answer(s, { state: 'failed', failure: 'network' });
    expect(s.warnings).toEqual([['The backup was not sent', 'network']]);
    expect(s.schedule.last.value).toEqual({ state: 'failed', failure: 'network' });
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
    s.clock.advance(BACKUP_GAP_MS);
    await flush();
    expect(s.engine.runs).toHaveLength(2);
    const died = new Error('worker died');
    s.engine.last.reject(died);
    await flush();
    expect(s.warnings[1]).toEqual(['The backup upload failed', died]);
    expect(s.schedule.last.value).toBeNull();
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
    s.clock.advance(BACKUP_GAP_MS);
    await flush();
    await answer(s, { state: 'sent' });
    expect(s.clock.due()).toEqual([]);
    expect(s.warnings).toHaveLength(2);
  });

  it('runs at once when hidden after a failed run while visible (the cap counts from the hide)', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    await answer(s, { state: 'failed', failure: 'network' });
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(2);
  });

  it('keeps the 60 s from the first change when more come (no debounce)', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    await answer(s, { state: 'sent' });
    s.clock.advance(BACKUP_GAP_MS * 3);
    s.schedule.changed();
    s.clock.advance(30_000);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([BACKUP_CHANGE_MS - 30_000]);
  });

  it('treats a request that cannot be made as a failed run', async () => {
    const s = setup(() => Promise.reject(new Error('no profile')));
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    expect(s.engine.runs).toHaveLength(0);
    expect(s.warnings.map((w) => w[0])).toEqual(['The backup upload failed']);
    expect(s.schedule.idle()).toBe(true);
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
  });

  it('settles the change on same, none and too-large (the last logged)', async () => {
    for (const state of ['same', 'none', 'too-large'] as const) {
      const s = setup();
      s.schedule.start();
      s.clock.advance(BACKUP_CHANGE_MS);
      await flush();
      await answer(s, { state });
      expect(s.clock.due()).toEqual([]);
      expect(s.warnings).toEqual(state === 'too-large' ? [['The backup was not sent', 'too-large']] : []);
    }
  });

  it('stops for the session once a backup this TV has not seen is held, and says so', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    expect(s.schedule.held.value).toBe(false);
    await answer(s, { state: 'held' });
    expect(s.schedule.held.value).toBe(true);
    expect(s.warnings).toEqual([['The backup was not sent', 'held: a backup this TV has not seen is on the server']]);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([]);
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    s.lifecycle('visible');
    expect(s.clock.due()).toEqual([]);
  });

  it('runs a pending change at once when the app is hidden, then one more for a change while hidden, never after a failure', async () => {
    const s = setup();
    s.schedule.start();
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    expect(s.clock.due()).toEqual([]);
    // The player keeps the movie's place as the app hides: a change during the run.
    s.schedule.changed();
    await answer(s, { state: 'sent' });
    expect(s.engine.runs).toHaveLength(2);
    s.schedule.changed();
    await answer(s, { state: 'sent' });
    // Two runs for this hide: the third change waits for the app to be visible.
    expect(s.engine.runs).toHaveLength(2);
    s.schedule.changed();
    await flush();
    expect(s.engine.runs).toHaveLength(2);
    expect(s.clock.due()).toEqual([]);
    // Visible: timed again (5 minutes after the last start).
    s.lifecycle('visible');
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
    // Hidden again: a run at once, and after its failure no other while hidden.
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(3);
    s.schedule.changed();
    await answer(s, { state: 'failed', failure: 'timeout' });
    expect(s.engine.runs).toHaveLength(3);
    s.schedule.changed();
    await flush();
    expect(s.engine.runs).toHaveLength(3);
    // A second hidden event without a visible one between changes nothing.
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(3);
    s.lifecycle('visible');
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
  });

  it('counts a worker that died while hidden as a failure: no other run until visible', async () => {
    const s = setup();
    s.schedule.start();
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    s.engine.last.reject(new Error('worker died'));
    await flush();
    s.schedule.changed();
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    s.lifecycle('visible');
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
  });

  it('runs nothing when hidden with nothing pending, and nothing timed fires while hidden', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    await answer(s, { state: 'sent' });
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    s.lifecycle('visible');
    s.schedule.changed();
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
    s.lifecycle('hidden');
    await flush();
    // The pending change ran at once; the timer went.
    expect(s.engine.runs).toHaveLength(2);
    expect(s.clock.due()).toEqual([]);
  });

  it('asks for the request afresh at each run', async () => {
    let n = 0;
    const s = setup(() => {
      n += 1;
      return Promise.resolve({ ...REQUEST, secret: n === 1 ? null : 'LGUDID-1' });
    });
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    expect(s.engine.last.request.secret).toBeNull();
    await answer(s, { state: 'sent' });
    s.schedule.changed();
    s.clock.advance(BACKUP_GAP_MS);
    await flush();
    expect(s.engine.last.request.secret).toBe('LGUDID-1');
  });

  it('runs now for the test hook, sharing one later run among the calls made during a run', async () => {
    const s = setup();
    s.schedule.start();
    const first = s.schedule.uploadNow();
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    // The timer went: the pending start was sent by this run.
    expect(s.clock.due()).toEqual([]);
    const second = s.schedule.uploadNow();
    const third = s.schedule.uploadNow();
    await answer(s, { state: 'sent' });
    expect(await first).toEqual({ state: 'sent' });
    expect(s.engine.runs).toHaveLength(2);
    await answer(s, { state: 'same' });
    expect(await second).toEqual({ state: 'same' });
    expect(await third).toEqual({ state: 'same' });
    expect(s.engine.runs).toHaveLength(2);
    // Even when held.
    const held = s.schedule.uploadNow();
    await flush();
    await answer(s, { state: 'held' });
    expect(await held).toEqual({ state: 'held' });
    const again = s.schedule.uploadNow();
    await flush();
    expect(s.engine.runs).toHaveLength(4);
    await answer(s, { state: 'held' });
    expect(await again).toEqual({ state: 'held' });
  });

  it('stops until started again, keeping what is pending, and lets a run in progress finish', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    s.schedule.changed();
    s.schedule.stop();
    expect(s.unsubscribed()).toBe(1);
    await answer(s, { state: 'sent' });
    expect(s.clock.due()).toEqual([]);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([]);
    expect(await s.schedule.uploadNow()).toBeNull();
    s.schedule.start();
    expect(s.subscribed()).toBe(true);
    // The change from before the stop: 5 minutes after the last run's start.
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
  });

  it('clears a timed run when stopped, and times a change as visible after a stop while hidden', async () => {
    const s = setup();
    s.schedule.start();
    expect(s.clock.due()).toEqual([BACKUP_CHANGE_MS]);
    s.schedule.stop();
    expect(s.clock.due()).toEqual([]);
    s.clock.advance(BACKUP_CHANGE_MS * 2);
    await flush();
    expect(s.engine.runs).toHaveLength(0);
    // Hidden, stopped (no visible event comes after it), started again: a change is timed, not run at once.
    s.schedule.start();
    s.lifecycle('hidden');
    await flush();
    await answer(s, { state: 'sent' });
    s.schedule.stop();
    s.schedule.start();
    s.schedule.changed();
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
  });

  it('runs nothing for a change once disposed, even while hidden', async () => {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    await answer(s, { state: 'sent' });
    s.lifecycle('hidden');
    s.schedule.dispose();
    s.schedule.changed();
    await flush();
    expect(s.engine.runs).toHaveLength(1);
  });

  it('stops for good once disposed: waiting calls get null', async () => {
    const s = setup();
    s.schedule.start();
    const waiting = s.schedule.uploadNow();
    await flush();
    const after = s.schedule.uploadNow();
    s.schedule.dispose();
    expect(s.unsubscribed()).toBe(1);
    expect(await after).toBeNull();
    await answer(s, { state: 'sent' });
    expect(await waiting).toBeNull();
    expect(s.engine.runs).toHaveLength(1);
    s.schedule.changed();
    s.schedule.start();
    expect(s.clock.due()).toEqual([]);
    expect(await s.schedule.uploadNow()).toBeNull();
  });
});

describe("the schedule for Settings' backup page (RELAY step 32d2b)", () => {
  /** Started, its first run answered `held`: the timed runs end. */
  async function heldSetup() {
    const s = setup();
    s.schedule.start();
    s.clock.advance(BACKUP_CHANGE_MS);
    await flush();
    await answer(s, { state: 'held' });
    expect(s.schedule.held.value).toBe(true);
    s.warnings.length = 0;
    return s;
  }

  it('ends a held backup when an answer says otherwise: the timed runs come back', async () => {
    for (const state of ['sent', 'same', 'none', 'off', 'too-large'] as const) {
      const s = await heldSetup();
      const now = s.schedule.uploadNow();
      await flush();
      await answer(s, { state });
      expect(await now).toEqual({ state });
      expect(s.schedule.held.value).toBe(false);
      s.schedule.changed();
      expect(s.clock.due()).toEqual([BACKUP_GAP_MS]);
    }
  });

  it('keeps a held backup over a failed run and a dead worker', async () => {
    const s = await heldSetup();
    void s.schedule.uploadNow();
    await flush();
    await answer(s, { state: 'failed', failure: 'network' });
    expect(s.schedule.held.value).toBe(true);
    void s.schedule.uploadNow();
    await flush();
    s.engine.last.reject(new Error('worker died'));
    await flush();
    expect(s.schedule.held.value).toBe(true);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([]);
  });

  it('"Replace it" is a run of its own, with the request afresh: sent over the held backup, which ends, the change settled', async () => {
    const s = await heldSetup();
    s.schedule.changed();
    const replaced = s.schedule.replaceNow();
    await flush();
    expect(s.engine.runs.map((r) => r.kind)).toEqual(['upload', 'replace']);
    expect(s.engine.last.request).toEqual(REQUEST);
    expect(s.schedule.idle()).toBe(false);
    await answer(s, { state: 'sent' });
    expect(await replaced).toEqual({ state: 'sent' });
    expect(s.schedule.held.value).toBe(false);
    expect(s.schedule.last.value).toEqual({ state: 'sent' });
    expect(s.clock.due()).toEqual([]);
    // The next run is an upload again.
    void s.schedule.uploadNow();
    await flush();
    expect(s.engine.last.kind).toBe('upload');
  });

  it('keeps the held backup and the change after a failed replace, and logs it', async () => {
    const s = await heldSetup();
    s.schedule.changed();
    const replaced = s.schedule.replaceNow();
    await flush();
    await answer(s, { state: 'failed', failure: 'timeout' });
    expect(await replaced).toEqual({ state: 'failed', failure: 'timeout' });
    expect(s.schedule.held.value).toBe(true);
    expect(s.warnings).toEqual([['The backup was not sent', 'timeout']]);
    // Pending, but held: nothing timed.
    expect(s.clock.due()).toEqual([]);
  });

  it('replaces right after the run in progress, an upload asked meanwhile sharing it', async () => {
    const s = setup();
    s.schedule.start();
    const first = s.schedule.uploadNow();
    await flush();
    const replaced = s.schedule.replaceNow();
    const shared = s.schedule.uploadNow();
    await flush();
    expect(s.engine.runs.map((r) => r.kind)).toEqual(['upload']);
    await answer(s, { state: 'held' });
    expect(await first).toEqual({ state: 'held' });
    expect(s.engine.runs.map((r) => r.kind)).toEqual(['upload', 'replace']);
    await answer(s, { state: 'sent' });
    expect(await replaced).toEqual({ state: 'sent' });
    expect(await shared).toEqual({ state: 'sent' });
    expect(s.schedule.held.value).toBe(false);
  });

  it('replaces nothing before start, once stopped or disposed', async () => {
    const s = setup();
    expect(await s.schedule.replaceNow()).toBeNull();
    s.schedule.start();
    s.schedule.stop();
    expect(await s.schedule.replaceNow()).toBeNull();
    s.schedule.start();
    s.schedule.dispose();
    expect(await s.schedule.replaceNow()).toBeNull();
    expect(s.engine.runs).toHaveLength(0);
  });

  it('holds: waits for the run in progress, starts none while its job runs, then the run asked meanwhile', async () => {
    const s = setup();
    s.schedule.start();
    const first = s.schedule.uploadNow();
    await flush();
    let release: (value: string) => void = () => undefined;
    let started = 0;
    const held = s.schedule.hold(() => {
      started += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    await flush();
    expect(started).toBe(0);
    expect(s.schedule.idle()).toBe(false);
    const asked = s.schedule.uploadNow();
    await answer(s, { state: 'sent' });
    expect(await first).toEqual({ state: 'sent' });
    expect(started).toBe(1);
    // The run asked meanwhile waits for the job; so does a change.
    expect(s.engine.runs).toHaveLength(1);
    s.schedule.changed();
    expect(s.clock.due()).toEqual([]);
    expect(s.schedule.idle()).toBe(false);
    release('switched');
    expect(await held).toBe('switched');
    await flush();
    expect(s.engine.runs).toHaveLength(2);
    await answer(s, { state: 'same' });
    expect(await asked).toEqual({ state: 'same' });
    expect(s.schedule.idle()).toBe(true);
  });

  it('holds at once with no run in progress: the timed run is cleared, and timed again after', async () => {
    const s = setup();
    s.schedule.start();
    expect(s.clock.due()).toEqual([BACKUP_CHANGE_MS]);
    let started = 0;
    let release: () => void = () => undefined;
    const held = s.schedule.hold(() => {
      started += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    expect(s.clock.due()).toEqual([]);
    await flush();
    expect(started).toBe(1);
    s.clock.advance(BACKUP_CHANGE_MS * 2);
    await flush();
    expect(s.engine.runs).toHaveLength(0);
    release();
    await held;
    expect(s.clock.due()).toEqual([0]);
    s.clock.advance(0);
    await flush();
    expect(s.engine.runs).toHaveLength(1);
  });

  it('settles as its job when the job fails, and the schedule goes on', async () => {
    const s = setup();
    s.schedule.start();
    await expect(s.schedule.hold(() => Promise.reject(new Error('no worker')))).rejects.toThrow('no worker');
    expect(s.schedule.idle()).toBe(true);
    expect(s.clock.due()).toEqual([BACKUP_CHANGE_MS]);
  });

  it('waits for every hold: two at once', async () => {
    const s = setup();
    s.schedule.start();
    let first: () => void = () => undefined;
    let second: () => void = () => undefined;
    const one = s.schedule.hold(
      () =>
        new Promise<void>((resolve) => {
          first = resolve;
        }),
    );
    const two = s.schedule.hold(
      () =>
        new Promise<void>((resolve) => {
          second = resolve;
        }),
    );
    const asked = s.schedule.uploadNow();
    await flush();
    first();
    await one;
    await flush();
    expect(s.engine.runs).toHaveLength(0);
    second();
    await two;
    await flush();
    expect(s.engine.runs).toHaveLength(1);
    await answer(s, { state: 'sent' });
    expect(await asked).toEqual({ state: 'sent' });
  });

  it('runs a pending change hidden meanwhile once the hold ends', async () => {
    const s = setup();
    s.schedule.start();
    let release: () => void = () => undefined;
    const held = s.schedule.hold(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await flush();
    s.lifecycle('hidden');
    await flush();
    expect(s.engine.runs).toHaveLength(0);
    release();
    await held;
    await flush();
    expect(s.engine.runs).toHaveLength(1);
  });
});
