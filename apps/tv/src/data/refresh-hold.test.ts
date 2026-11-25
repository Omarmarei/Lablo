import { describe, expect, it } from 'vitest';
import { createRefreshHold } from './refresh-hold';

/** A hold whose slot frees when the test says, recording the scheduler's stops and starts. */
function setup() {
  const log: string[] = [];
  let free: Array<() => void> = [];
  const hold = createRefreshHold({
    stop: () => log.push('stop'),
    start: () => log.push('start'),
    slotFree: () => new Promise<void>((resolve) => free.push(resolve)),
  });
  const freeSlot = (): void => {
    const waiting = free;
    free = [];
    for (const resolve of waiting) resolve();
  };
  return { hold, log, freeSlot };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A job the test ends. */
function job<T>() {
  let end: (value: T) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const ran: number[] = [];
  const fn = (): Promise<T> => {
    ran.push(1);
    return new Promise<T>((resolve, reject) => {
      end = resolve;
      fail = reject;
    });
  };
  return { fn, ran, end: (value: T) => end(value), fail: (error: unknown) => fail(error) };
}

describe('the refreshes held (RELAY step 50b)', () => {
  it('stops them at the first hold and starts them again only when the last lets go', () => {
    const { hold, log } = setup();
    hold.hold(true);
    hold.hold(true);
    expect(log).toEqual(['stop']);
    expect(hold.holders()).toBe(2);
    hold.hold(false);
    expect(log).toEqual(['stop']);
    hold.hold(false);
    expect(log).toEqual(['stop', 'start']);
    // A let-go with no hold does nothing.
    hold.hold(false);
    expect(log).toEqual(['stop', 'start']);
    expect(hold.holders()).toBe(0);
  });

  it('runs a quiet job once the slot is free, then lets go with its answer', async () => {
    const { hold, log, freeSlot } = setup();
    const removal = job<boolean>();
    const done = hold.quiet(removal.fn);
    expect(log).toEqual(['stop']);
    await flush();
    expect(removal.ran).toEqual([]);
    freeSlot();
    await flush();
    expect(removal.ran).toEqual([1]);
    expect(log).toEqual(['stop']);
    removal.end(true);
    expect(await done).toBe(true);
    expect(log).toEqual(['stop', 'start']);
  });

  it('lets go when the job fails, and the failure reaches the caller', async () => {
    const { hold, log, freeSlot } = setup();
    const removal = job<boolean>();
    const done = hold.quiet(removal.fn);
    freeSlot();
    await flush();
    removal.fail(new Error('the store is gone'));
    await expect(done).rejects.toThrow('the store is gone');
    expect(log).toEqual(['stop', 'start']);
    expect(hold.holders()).toBe(0);
  });

  it("keeps them held for a removal still waiting when an add next to it ends first (the step's bug)", async () => {
    const { hold, log, freeSlot } = setup();
    // The phone's add holds them while it loads; the user removes another source meanwhile.
    hold.hold(true);
    const removal = job<boolean>();
    const done = hold.quiet(removal.fn);
    // The add ends: the removal still waits for the slot, so nothing may start again.
    hold.hold(false);
    expect(log).toEqual(['stop']);
    freeSlot();
    await flush();
    removal.end(true);
    await done;
    expect(log).toEqual(['stop', 'start']);
  });

  it('keeps them held across two quiet jobs that overlap', async () => {
    const { hold, log, freeSlot } = setup();
    const first = job<string>();
    const second = job<string>();
    const a = hold.quiet(first.fn);
    const b = hold.quiet(second.fn);
    freeSlot();
    await flush();
    first.end('a');
    expect(await a).toBe('a');
    expect(log).toEqual(['stop']);
    second.end('b');
    expect(await b).toBe('b');
    expect(log).toEqual(['stop', 'start']);
  });
});
