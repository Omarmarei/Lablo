import { describe, expect, it } from 'vitest';
import type { PlaybackError } from './engine';
import type { RetryPlan } from './ladder';
import { DEFAULT_WATCHDOG, RetryLadder } from './ladder';

const stall: PlaybackError = { kind: 'stall', code: 'FROZEN' };
const notFound: PlaybackError = { kind: 'http', code: 'PROBE', status: 404 };
const unsupported: PlaybackError = { kind: 'unsupported', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };

function ladder(candidates: number, canReprobe: boolean, config = DEFAULT_WATCHDOG): RetryLadder {
  return new RetryLadder(config, { candidates, canReprobe });
}

/** Feeds failures one by one (current URL updated from each plan), 1 s apart. */
function climb(l: RetryLadder, failures: number, framed = true, error = stall): (RetryPlan | null)[] {
  const plans: (RetryPlan | null)[] = [];
  let current = 0;
  for (let i = 0; i < failures; i++) {
    const plan = l.next(error, current, framed, i * 1000);
    plans.push(plan);
    if (plan !== null) current = plan.candidate;
  }
  return plans;
}

describe('RetryLadder', () => {
  it('climbs reopen, re-probe, switch, then backoff, and gives up at the 5th failure within 60 s', () => {
    expect(climb(ladder(2, true), 5)).toEqual([
      { rung: 'reopen', candidate: 0, delayMs: 0 },
      { rung: 'reprobe', candidate: 0, delayMs: 0 },
      { rung: 'switch', candidate: 1, delayMs: 0 },
      { rung: 'reopen', candidate: 1, delayMs: 1000 },
      null,
    ]);
  });

  it('skips the re-probe where the platform has no probe, and the switch with one URL', () => {
    expect(climb(ladder(2, false), 4)).toEqual([
      { rung: 'reopen', candidate: 0, delayMs: 0 },
      { rung: 'switch', candidate: 1, delayMs: 0 },
      { rung: 'reopen', candidate: 1, delayMs: 1000 },
      { rung: 'reopen', candidate: 1, delayMs: 2000 },
    ]);
    expect(climb(ladder(1, true), 3).map((p) => p?.rung)).toEqual(['reopen', 'reprobe', 'reopen']);
    expect(climb(ladder(1, false), 2)).toEqual([
      { rung: 'reopen', candidate: 0, delayMs: 0 },
      { rung: 'reopen', candidate: 0, delayMs: 1000 },
    ]);
  });

  it('switches back to the first URL from the last', () => {
    const l = ladder(2, false);
    expect(l.next(stall, 1, true, 0)).toEqual({ rung: 'reopen', candidate: 1, delayMs: 0 });
    expect(l.next(stall, 1, true, 1000)).toEqual({ rung: 'switch', candidate: 0, delayMs: 0 });
  });

  it('backs off 1, 2, 4 s and repeats the last delay when the config allows more attempts', () => {
    const l = ladder(1, false, { ...DEFAULT_WATCHDOG, maxAttempts: 10 });
    expect(climb(l, 6).map((p) => p?.delayMs)).toEqual([0, 1000, 2000, 4000, 4000, 4000]);
    const flat = ladder(1, false, { ...DEFAULT_WATCHDOG, backoffMs: [] });
    expect(climb(flat, 3).map((p) => p?.delayMs)).toEqual([0, 0, 0]);
  });

  it('counts attempts in a sliding 60 s window', () => {
    const l = ladder(1, false);
    // Four attempts at 0, 10, 20 and 30 s; a failure at 59.95 s still sees all four.
    for (const t of [0, 10_000, 20_000, 30_000]) {
      expect(l.next(stall, 0, true, t)).not.toBeNull();
      l.recovered();
    }
    expect(l.next(stall, 0, true, 59_950)).toBeNull();
    // At 60 s the first has left the window.
    expect(l.next(stall, 0, true, 60_000)).toEqual({ rung: 'reopen', candidate: 0, delayMs: 0 });
    // A refused attempt isn't counted: at 70 s the attempts are 10, 20, 30 and 60 s.
    expect(l.next(stall, 0, true, 69_950)).toBeNull();
  });

  it('starts from the first rung again after a frame, but keeps counting attempts', () => {
    const l = ladder(2, true);
    expect(l.next(stall, 0, true, 0)?.rung).toBe('reopen');
    expect(l.next(stall, 0, true, 1000)?.rung).toBe('reprobe');
    l.recovered();
    expect(l.next(stall, 0, true, 2000)?.rung).toBe('reopen');
    expect(l.next(stall, 0, true, 3000)?.rung).toBe('reprobe');
    l.recovered();
    expect(l.next(stall, 0, true, 4000)).toBeNull();
  });

  it('tries the untried URL first while nothing has played on the current one', () => {
    const l = ladder(3, true);
    expect(l.next(stall, 0, false, 0)).toEqual({ rung: 'next-url', candidate: 1, delayMs: 0 });
    expect(l.next(stall, 1, false, 1000)).toEqual({ rung: 'next-url', candidate: 2, delayMs: 0 });
    // Every URL tried: the ladder proper.
    expect(l.next(stall, 2, false, 2000)).toEqual({ rung: 'reopen', candidate: 2, delayMs: 0 });
  });

  it('climbs the ladder on a URL that has played, even with untried ones left', () => {
    const l = ladder(2, false);
    expect(l.next(stall, 0, true, 0)).toEqual({ rung: 'reopen', candidate: 0, delayMs: 0 });
  });

  it('never retries the same URL after a definitive error, but tries the others', () => {
    const l = ladder(2, true);
    // Even after the URL played (a mid-stream 404 or an unsupported track).
    expect(l.next(notFound, 0, true, 0)).toEqual({ rung: 'next-url', candidate: 1, delayMs: 0 });
    expect(l.next(unsupported, 1, false, 1000)).toBeNull();
    expect(ladder(1, true).next(unsupported, 0, false, 0)).toBeNull();
  });

  it('never switches back to a URL that failed definitively in the session', () => {
    // The desktop: .ts unsupported, then .m3u8 times out (placeholder bytes): reopen and back off on .m3u8 only.
    const timeout: PlaybackError = { kind: 'timeout', code: 'OPEN' };
    const l = ladder(2, false);
    expect(l.next(unsupported, 0, false, 0)).toEqual({ rung: 'next-url', candidate: 1, delayMs: 0 });
    expect(l.next(timeout, 1, false, 10_000)).toEqual({ rung: 'reopen', candidate: 1, delayMs: 0 });
    expect(l.next(timeout, 1, false, 20_000)).toEqual({ rung: 'reopen', candidate: 1, delayMs: 1000 });
    // With three URLs, the switch skips the dead one.
    const three = ladder(3, false, { ...DEFAULT_WATCHDOG, maxAttempts: 10 });
    expect(three.next(stall, 0, true, 0)).toEqual({ rung: 'reopen', candidate: 0, delayMs: 0 });
    expect(three.next(notFound, 0, true, 1000)).toEqual({ rung: 'next-url', candidate: 1, delayMs: 0 });
    expect(three.next(stall, 1, false, 2000)).toEqual({ rung: 'next-url', candidate: 2, delayMs: 0 });
    three.recovered();
    expect(three.next(stall, 2, true, 3000)).toEqual({ rung: 'reopen', candidate: 2, delayMs: 0 });
    // 2 + 1 wraps to 0, which answered 404: 1.
    expect(three.next(stall, 2, true, 4000)).toEqual({ rung: 'switch', candidate: 1, delayMs: 0 });
  });

  it('switches to the next live URL, wrapping and skipping a dead one', () => {
    const l = ladder(3, false, { ...DEFAULT_WATCHDOG, maxAttempts: 10 });
    expect(l.next(stall, 0, false, 0)).toEqual({ rung: 'next-url', candidate: 1, delayMs: 0 });
    expect(l.next(unsupported, 1, false, 1000)).toEqual({ rung: 'next-url', candidate: 2, delayMs: 0 });
    expect(l.next(stall, 2, false, 2000)).toEqual({ rung: 'reopen', candidate: 2, delayMs: 0 });
    // 2 + 1 wraps to 0.
    expect(l.next(stall, 2, false, 3000)).toEqual({ rung: 'switch', candidate: 0, delayMs: 0 });
    l.recovered();
    expect(l.next(stall, 0, true, 4000)).toEqual({ rung: 'reopen', candidate: 0, delayMs: 0 });
    // 1 is dead: 2.
    expect(l.next(stall, 0, true, 5000)).toEqual({ rung: 'switch', candidate: 2, delayMs: 0 });
  });
});
