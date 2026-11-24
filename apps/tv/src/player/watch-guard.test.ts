import { describe, expect, it } from 'vitest';
import type { Timers } from '../live/live-state';
import { DEFAULT_STILL_HOURS, PROMPT_SECONDS, PROMPT_TICK_MS, SLEEP_MINUTES, STILL_HOURS, createWatchGuard } from './watch-guard';

/**
 * "Still watching?" and the sleep timer (RELAY step 39c): the two counts, the prompt they end in,
 * its countdown, the wait for room, and the app hiding and coming back.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** The wall clock when each test starts. */
const WALL = Date.UTC(2026, 10, 24, 18, 0, 0);

function manualTimers() {
  let now = 0;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: Timers = {
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
    pending: () => queue.length,
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

function setup(hours: number | null = 4) {
  const clock = manualTimers();
  /** What the guard told the player, in order. */
  const told: string[] = [];
  /** `room`: the player has no card up. `late`: how far the countdown's clock runs ahead of the timers (a timer that fires late). */
  const state = { room: true, late: 0 };
  const guard = createWatchGuard({
    timers: clock.timers,
    clock: () => WALL + clock.now(),
    now: () => clock.now() + state.late,
    hours,
    room: () => state.room,
    shown: () => told.push(`shown ${guard.prompt.value === null ? 'before' : 'after'}`),
    kept: () => told.push(`kept ${guard.prompt.value === null ? 'gone' : 'up'}`),
    stop: () => {
      told.push(`stop ${guard.prompt.value === null ? 'gone' : 'up'}`);
      // The player closes.
      guard.watching(false);
    },
  });
  return { clock, guard, told, state };
}

describe('"Still watching?": the no-key count (RELAY step 39c)', () => {
  it('offers 2, 4 or 6 hours, 4 until told, and a 60-second prompt', () => {
    expect(STILL_HOURS).toEqual([2, 4, 6]);
    expect(DEFAULT_STILL_HOURS).toBe(4);
    expect(SLEEP_MINUTES).toEqual([30, 60, 90, 120]);
    expect([PROMPT_SECONDS, PROMPT_TICK_MS]).toEqual([60, 1000]);
  });

  it('asks after the hours with no key, once the player is open; not before, and not while it is closed', () => {
    const t = setup(4);
    expect(t.guard.hours.value).toBe(4);
    // Closed: nothing counts.
    t.clock.advance(10 * HOUR);
    expect(t.guard.prompt.value).toBeNull();
    expect(t.clock.pending()).toBe(0);
    t.guard.watching(true);
    t.clock.advance(4 * HOUR - 1);
    expect(t.guard.prompt.value).toBeNull();
    t.clock.advance(1);
    // The player made room first, then the prompt shows with all its seconds.
    expect(t.told).toEqual(['shown before']);
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 60 });
  });

  it('counts down a second at a time, then the prompt goes and the player closes', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(2 * HOUR);
    t.clock.advance(PROMPT_TICK_MS - 1);
    expect(t.guard.prompt.value!.seconds).toBe(60);
    t.clock.advance(1);
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 59 });
    t.clock.advance(58 * PROMPT_TICK_MS);
    expect(t.guard.prompt.value!.seconds).toBe(1);
    expect(t.told).toEqual(['shown before']);
    t.clock.advance(PROMPT_TICK_MS);
    expect(t.guard.prompt.value).toBeNull();
    expect(t.told).toEqual(['shown before', 'stop gone']);
    // Closed: no timer is left, and nothing asks again.
    expect(t.clock.pending()).toBe(0);
    t.clock.advance(10 * HOUR);
    expect(t.told).toHaveLength(2);
  });

  it('reads the seconds off the clock: a late timer shows the time truly left, and the player closes on time', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(2 * HOUR);
    expect(t.guard.prompt.value!.seconds).toBe(60);
    // The TV was busy: the first step comes 2.5 s late.
    t.state.late = 2500;
    t.clock.advance(PROMPT_TICK_MS);
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 57 });
    // Much later than the whole minute: closed at the next step, not 57 steps on.
    t.state.late = 70_000;
    t.clock.advance(PROMPT_TICK_MS);
    expect(t.guard.prompt.value).toBeNull();
    expect(t.told).toEqual(['shown before', 'stop gone']);
    // Asked again later, the minute is counted from then.
    const again = setup(2);
    again.state.late = 123_456;
    again.guard.watching(true);
    again.clock.advance(2 * HOUR + 59 * PROMPT_TICK_MS);
    expect(again.guard.prompt.value).toEqual({ reason: 'idle', seconds: 1 });
    again.guard.keep();
    again.clock.advance(2 * HOUR + PROMPT_TICK_MS);
    expect(again.guard.prompt.value).toEqual({ reason: 'idle', seconds: 59 });
  });

  it('starts again at each key, and when the player opens again', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(2 * HOUR - 1);
    t.guard.activity();
    t.clock.advance(2 * HOUR - 1);
    expect(t.guard.prompt.value).toBeNull();
    // One timer: each key replaces the count.
    expect(t.clock.pending()).toBe(1);
    t.clock.advance(1);
    expect(t.guard.prompt.value).not.toBeNull();
    t.guard.watching(false);
    expect(t.guard.prompt.value).toBeNull();
    expect(t.clock.pending()).toBe(0);
    // Opened twice in a row: one count, from the first.
    t.guard.watching(true);
    t.clock.advance(HOUR);
    t.guard.watching(true);
    t.clock.advance(HOUR);
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 60 });
    // A key with the player closed counts nothing.
    t.guard.watching(false);
    t.guard.activity();
    expect(t.clock.pending()).toBe(0);
  });

  it('"Keep watching" takes the prompt away, hands the focus back and starts the count again', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(2 * HOUR + 10 * PROMPT_TICK_MS);
    expect(t.guard.prompt.value!.seconds).toBe(50);
    t.guard.keep();
    expect(t.guard.prompt.value).toBeNull();
    expect(t.told).toEqual(['shown before', 'kept gone']);
    // The countdown is gone: nothing closes the player.
    t.clock.advance(2 * HOUR - 1);
    expect(t.told).toHaveLength(2);
    t.clock.advance(1);
    // Asked again, with all its seconds.
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 60 });
    // Nothing to keep without a prompt.
    t.guard.keep();
    t.guard.keep();
    expect(t.told).toEqual(['shown before', 'kept gone', 'shown before', 'kept gone']);
  });

  it('leaves the prompt to its own keys: a key while it shows changes nothing', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(2 * HOUR + 5 * PROMPT_TICK_MS);
    t.guard.activity();
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 55 });
    // Only the countdown runs: the key started no count under the prompt.
    expect(t.clock.pending()).toBe(1);
    t.clock.advance(55 * PROMPT_TICK_MS);
    expect(t.told).toEqual(['shown before', 'stop gone']);
  });

  it('never asks when set to never; other hours start the count again', () => {
    const t = setup(null);
    t.guard.watching(true);
    expect(t.clock.pending()).toBe(0);
    t.clock.advance(24 * HOUR);
    expect(t.guard.prompt.value).toBeNull();
    t.guard.setHours(6);
    expect(t.guard.hours.value).toBe(6);
    t.clock.advance(5 * HOUR);
    // The same hours again: the count runs on.
    t.guard.setHours(6);
    t.clock.advance(HOUR - 1);
    expect(t.guard.prompt.value).toBeNull();
    t.clock.advance(1);
    expect(t.guard.prompt.value).not.toBeNull();
    t.guard.keep();
    t.guard.setHours(2);
    t.clock.advance(2 * HOUR);
    expect(t.guard.prompt.value).not.toBeNull();
    t.guard.keep();
    t.guard.setHours(null);
    expect(t.clock.pending()).toBe(0);
  });
});

describe('"Still watching?": waiting for room (RELAY step 39c)', () => {
  it('waits while a card is up, and shows once the player has room again', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.state.room = false;
    t.clock.advance(2 * HOUR);
    expect(t.guard.prompt.value).toBeNull();
    expect(t.told).toEqual([]);
    // Still no room: it goes on waiting.
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 60 });
    // Nothing waits any more.
    t.guard.keep();
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
  });

  it('a key drops a no-key prompt that waits: someone is there', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.state.room = false;
    t.clock.advance(2 * HOUR);
    t.guard.activity();
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
    // The key started the count again.
    t.clock.advance(2 * HOUR);
    expect(t.guard.prompt.value).not.toBeNull();
  });

  it('a card that comes while the prompt shows takes its place; the prompt is back when the card goes', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(2 * HOUR + 20 * PROMPT_TICK_MS);
    t.state.room = false;
    t.guard.covered();
    expect(t.guard.prompt.value).toBeNull();
    // The countdown stopped with it: the card's stream is not closed under it.
    t.clock.advance(HOUR);
    expect(t.told).toEqual(['shown before']);
    // The next episode starts by itself: asked again, from 60.
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 60 });
    expect(t.told).toEqual(['shown before', 'shown before']);
    // No prompt: nothing to cover.
    t.guard.keep();
    t.guard.covered();
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
  });

  it('a waiting prompt goes with the player, and when other hours are set', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.state.room = false;
    t.clock.advance(2 * HOUR);
    t.guard.watching(false);
    t.guard.watching(true);
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
    t.state.room = false;
    t.clock.advance(2 * HOUR);
    t.guard.setHours(6);
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
  });
});

describe('the sleep timer (RELAY step 39c)', () => {
  it('ends on the wall clock after its minutes, asks when the player is open, and is off from then', () => {
    const t = setup(null);
    expect(t.guard.sleep.value).toBeNull();
    t.guard.setSleep(30);
    expect(t.guard.sleep.value).toEqual({ minutes: 30, until: WALL + 30 * MINUTE });
    t.guard.watching(true);
    t.clock.advance(30 * MINUTE - 1);
    expect(t.guard.prompt.value).toBeNull();
    t.clock.advance(1);
    expect(t.guard.prompt.value).toEqual({ reason: 'sleep', seconds: 60 });
    expect(t.guard.sleep.value).toBeNull();
    // "Keep watching": it doesn't come back.
    t.guard.keep();
    t.clock.advance(24 * HOUR);
    expect(t.guard.prompt.value).toBeNull();
    expect(t.told).toEqual(['shown before', 'kept gone']);
  });

  it('closes the player when nobody answers', () => {
    const t = setup(null);
    t.guard.watching(true);
    t.guard.setSleep(60);
    t.clock.advance(60 * MINUTE + PROMPT_TICK_MS);
    // The countdown keeps saying why it asks.
    expect(t.guard.prompt.value).toEqual({ reason: 'sleep', seconds: 59 });
    t.clock.advance(59 * PROMPT_TICK_MS);
    expect(t.told).toEqual(['shown before', 'stop gone']);
    expect(t.guard.sleep.value).toBeNull();
  });

  it('only goes back to off when nothing plays at its end', () => {
    const t = setup(4);
    t.guard.setSleep(30);
    t.clock.advance(30 * MINUTE);
    expect(t.guard.sleep.value).toBeNull();
    // A channel opened later plays on.
    t.guard.watching(true);
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
    expect(t.told).toEqual([]);
  });

  it('counts from each setting, and off stops it', () => {
    const t = setup(null);
    t.guard.watching(true);
    t.guard.setSleep(30);
    t.clock.advance(20 * MINUTE);
    t.guard.setSleep(60);
    expect(t.guard.sleep.value).toEqual({ minutes: 60, until: WALL + 80 * MINUTE });
    // One timer: the first setting's is gone.
    expect(t.clock.pending()).toBe(1);
    t.clock.advance(59 * MINUTE);
    expect(t.guard.prompt.value).toBeNull();
    t.guard.setSleep(null);
    expect(t.guard.sleep.value).toBeNull();
    expect(t.clock.pending()).toBe(0);
    t.clock.advance(HOUR);
    expect(t.guard.prompt.value).toBeNull();
  });

  it('runs through keys and through the player closing and opening', () => {
    const t = setup(2);
    t.guard.setSleep(90);
    t.guard.watching(true);
    t.clock.advance(40 * MINUTE);
    t.guard.activity();
    t.guard.watching(false);
    t.clock.advance(10 * MINUTE);
    t.guard.watching(true);
    t.clock.advance(40 * MINUTE - 1);
    expect(t.guard.prompt.value).toBeNull();
    t.clock.advance(1);
    expect(t.guard.prompt.value).toEqual({ reason: 'sleep', seconds: 60 });
  });

  it('waits under a card through a key (the sleep timer still ended), and a new setting drops that wait', () => {
    const t = setup(null);
    t.guard.watching(true);
    t.guard.setSleep(30);
    t.state.room = false;
    t.clock.advance(30 * MINUTE);
    expect(t.guard.prompt.value).toBeNull();
    // "Try again" on the card: a key, then room.
    t.guard.activity();
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toEqual({ reason: 'sleep', seconds: 60 });
    // Covered again, then set anew: nothing waits.
    t.guard.covered();
    t.guard.setSleep(30);
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
    expect(t.guard.sleep.value).toEqual({ minutes: 30, until: WALL + 60 * MINUTE });
  });

  it('one prompt answers for both counts', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.guard.setSleep(120);
    // The no-key prompt at two hours stops its count, and the sleep timer ends under it.
    t.clock.advance(2 * HOUR);
    expect(t.guard.prompt.value).toEqual({ reason: 'idle', seconds: 60 });
    expect(t.guard.sleep.value).toBeNull();
    t.guard.keep();
    // No second prompt for the sleep timer.
    expect(t.guard.prompt.value).toBeNull();
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
    // While the sleep timer's prompt shows, the no-key count rests.
    const s = setup(2);
    s.guard.watching(true);
    s.clock.advance(HOUR + 59 * MINUTE + 30_000);
    s.guard.setSleep(30);
    s.guard.activity();
    s.clock.advance(30 * MINUTE);
    expect(s.guard.prompt.value!.reason).toBe('sleep');
    expect(s.clock.pending()).toBe(1);
  });
});

describe('"Still watching?" and the sleep timer: the app hidden (RELAY step 39c)', () => {
  it('stops the no-key count while hidden, and starts it from zero when the app is back', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(HOUR);
    t.guard.hidden();
    expect(t.clock.pending()).toBe(0);
    t.clock.advance(5 * HOUR);
    expect(t.guard.prompt.value).toBeNull();
    // A key the hidden app still got counts nothing.
    t.guard.activity();
    expect(t.clock.pending()).toBe(0);
    t.guard.visible();
    t.clock.advance(2 * HOUR - 1);
    expect(t.guard.prompt.value).toBeNull();
    t.clock.advance(1);
    expect(t.guard.prompt.value).not.toBeNull();
  });

  it('takes the prompt away when the app hides, handing the focus back; nothing closes the player later', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.clock.advance(2 * HOUR + 30 * PROMPT_TICK_MS);
    t.guard.hidden();
    expect(t.guard.prompt.value).toBeNull();
    expect(t.told).toEqual(['shown before', 'kept gone']);
    t.clock.advance(HOUR);
    expect(t.told).toHaveLength(2);
    // Hidden with no prompt: the player is told nothing.
    t.guard.visible();
    t.guard.hidden();
    expect(t.told).toHaveLength(2);
  });

  it('drops a prompt that waited under a card when the app hides', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.state.room = false;
    t.clock.advance(2 * HOUR);
    t.guard.hidden();
    t.guard.visible();
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
  });

  it('keeps the sleep timer through a hide: back before its time it runs on, back after it is off', () => {
    const t = setup(null);
    t.guard.watching(true);
    t.guard.setSleep(60);
    t.clock.advance(10 * MINUTE);
    t.guard.hidden();
    // No timer runs while hidden.
    expect(t.clock.pending()).toBe(0);
    t.clock.advance(20 * MINUTE);
    expect(t.guard.sleep.value).toEqual({ minutes: 60, until: WALL + 60 * MINUTE });
    t.guard.visible();
    t.clock.advance(30 * MINUTE - 1);
    expect(t.guard.prompt.value).toBeNull();
    t.clock.advance(1);
    expect(t.guard.prompt.value).toEqual({ reason: 'sleep', seconds: 60 });
    t.guard.keep();
    // Back after its time: off, and nothing asks.
    t.guard.setSleep(30);
    t.guard.hidden();
    t.clock.advance(30 * MINUTE);
    expect(t.guard.sleep.value).not.toBeNull();
    t.guard.visible();
    expect(t.guard.sleep.value).toBeNull();
    expect(t.guard.prompt.value).toBeNull();
    expect(t.clock.pending()).toBe(0);
    // Set while hidden: it starts counting when the app is back, from its own time.
    t.guard.hidden();
    t.guard.setSleep(30);
    expect(t.clock.pending()).toBe(0);
    t.clock.advance(10 * MINUTE);
    t.guard.visible();
    t.clock.advance(20 * MINUTE);
    expect(t.guard.prompt.value).toEqual({ reason: 'sleep', seconds: 60 });
  });

  it('asks nothing while hidden even when a count ends on the way', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.state.room = false;
    t.clock.advance(2 * HOUR);
    // The prompt waits; the app hides and the card goes meanwhile.
    t.guard.hidden();
    t.state.room = true;
    t.guard.retry();
    expect(t.guard.prompt.value).toBeNull();
  });

  it('stops every timer on dispose', () => {
    const t = setup(2);
    t.guard.watching(true);
    t.guard.setSleep(30);
    expect(t.clock.pending()).toBe(2);
    t.guard.dispose();
    expect(t.clock.pending()).toBe(0);
    const prompted = setup(2);
    prompted.guard.watching(true);
    prompted.clock.advance(2 * HOUR);
    expect(prompted.clock.pending()).toBe(1);
    prompted.guard.dispose();
    expect(prompted.clock.pending()).toBe(0);
  });
});
