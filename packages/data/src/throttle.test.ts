import { describe, expect, it } from 'vitest';
import { CancelError, CancelSource } from './rpc';
import type { Clock } from './throttle';
import { BUSY_MAX_MS, BUSY_POLL_MS, LOW_TIER_DUTY, Throttle, YIELD_EVERY_MS } from './throttle';

/** A virtual clock: `sleep` advances time at once and logs the call; `work` advances it too. */
function fakeClock(onSleep?: (ms: number, clock: { t: number }) => void): Clock & { t: number; sleeps: number[]; work(ms: number): void } {
  const c = {
    t: 1_000,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
      onSleep?.(ms, c);
    },
    work: (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

describe('Throttle', () => {
  it('runs a 50/50 duty cycle on low-tier TVs', async () => {
    const clock = fakeClock();
    const t = new Throttle({ duty: LOW_TIER_DUTY, clock });
    // 10 ms of work between checkpoints: a sleep after every fifth one.
    for (let i = 0; i < 20; i++) {
      clock.work(10);
      await t.checkpoint();
    }
    expect(clock.sleeps).toEqual([50, 50, 50, 50]);
    expect(t.stats()).toEqual({ checkpoints: 20, busyMs: 0, sleptMs: 200 });
  });

  it('only yields a task now and then at full speed', async () => {
    const clock = fakeClock();
    const t = new Throttle({ clock });
    for (let i = 0; i < 20; i++) {
      clock.work(10);
      await t.checkpoint();
    }
    expect(clock.sleeps).toEqual([0, 0, 0, 0]);
    expect(YIELD_EVERY_MS).toBe(50);
  });

  it('waits while the UI is busy and goes on once it is idle', async () => {
    let throttle: Throttle | null = null;
    const clock = fakeClock((_ms, c) => {
      // The UI clears the flag after 450 ms of zapping.
      if (c.t >= 1_450) throttle!.setBusy(false);
    });
    throttle = new Throttle({ clock });
    throttle.setBusy(true);
    expect(throttle.busy).toBe(true);
    await throttle.checkpoint();
    expect(clock.sleeps.every((ms) => ms === BUSY_POLL_MS)).toBe(true);
    expect(clock.sleeps).toHaveLength(5);
    expect(throttle.stats().busyMs).toBe(500);
    expect(throttle.busy).toBe(false);
  });

  it('ignores a busy flag the UI forgot to clear after 15 s', async () => {
    const clock = fakeClock();
    const t = new Throttle({ clock });
    t.setBusy(true);
    await t.checkpoint();
    expect(t.stats().busyMs).toBe(BUSY_MAX_MS);
    expect(t.busy).toBe(false);
  });

  it('a new setBusy(true) restarts the expiry', async () => {
    let throttle: Throttle | null = null;
    let renewed = false;
    const clock = fakeClock((_ms, c) => {
      if (!renewed && c.t >= 1_000 + 10_000) {
        renewed = true;
        throttle!.setBusy(true);
      }
    });
    throttle = new Throttle({ clock });
    throttle.setBusy(true);
    await throttle.checkpoint();
    expect(throttle.stats().busyMs).toBe(10_000 + BUSY_MAX_MS);
  });

  it('rejects with CancelError when cancelled, also during a busy pause', async () => {
    const cancel = new CancelSource();
    const clock = fakeClock((_ms, c) => {
      if (c.t >= 1_300) cancel.cancel();
    });
    const t = new Throttle({ clock });
    t.setBusy(true);
    await expect(t.checkpoint(cancel.token)).rejects.toBeInstanceOf(CancelError);
    await expect(t.checkpoint(cancel.token)).rejects.toBeInstanceOf(CancelError);
  });

  it('reset starts fresh counters and a fresh work slice', async () => {
    const clock = fakeClock();
    const t = new Throttle({ duty: LOW_TIER_DUTY, clock });
    clock.work(49);
    await t.checkpoint();
    t.reset();
    clock.work(49);
    await t.checkpoint();
    expect(clock.sleeps).toEqual([]);
    expect(t.stats()).toEqual({ checkpoints: 1, busyMs: 0, sleptMs: 0 });
  });
});
