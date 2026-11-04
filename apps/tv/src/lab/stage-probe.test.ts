import { describe, expect, it } from 'vitest';
import type { AttrSource, FrameClock, QueryRoot } from './stage-probe';
import { afterFrameWhere, drawnFocus, showsRows } from './stage-probe';

/** A stage with a live root carrying `attrs`, and a first row when `row0`. */
function stage(attrs: Record<string, string> | null, row0 = false): QueryRoot {
  const root: AttrSource | null = attrs === null ? null : { getAttribute: (name) => attrs[name] ?? null };
  return {
    querySelector: (selector) => {
      if (selector === '[data-testid="live"]') return root;
      if (selector === '[data-testid="row-0"]') return row0 ? { getAttribute: () => null } : null;
      return null;
    },
  };
}

/** Frames 16 ms apart; a task runs 4 ms after the frame that queued it. */
function frames(): FrameClock & { flush(limit?: number): void; time: number } {
  const queue: { at: number; run: () => void }[] = [];
  const clock = {
    time: 0,
    now: () => clock.time,
    frame: (run: () => void) => queue.push({ at: Math.floor(clock.time / 16) * 16 + 16, run }),
    later: (run: () => void) => queue.push({ at: clock.time + 4, run }),
    flush: (limit = 1000) => {
      for (let i = 0; i < limit && queue.length > 0; i += 1) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue.shift()!;
        clock.time = Math.max(clock.time, next.at);
        next.run();
      }
    },
  };
  return clock;
}

describe("the live stage's probes (RELAY step 15b)", () => {
  it('reads the focus the live screen draws', () => {
    expect(drawnFocus(stage({ 'data-screen': 'live', 'data-zone': 'channels', 'data-index': '3' }))).toBe('live/channels/3');
    expect(drawnFocus(stage(null))).toBeNull();
    // The loading screen has no focus attributes yet.
    expect(drawnFocus(stage({ 'data-testid': 'live' }))).toBeNull();
  });

  it('sees the rows once the screen is ready, its first row loaded and drawn', () => {
    expect(showsRows('ready', { name: 'x' }, stage({}, true))).toBe(true);
    expect(showsRows('ready', null, stage({}, true))).toBe(false);
    expect(showsRows('ready', { name: 'x' }, stage({}, false))).toBe(false);
    expect(showsRows('loading', { name: 'x' }, stage({}, true))).toBe(false);
    expect(() => showsRows('empty', null, stage({}))).toThrow('the live screen is empty');
    expect(() => showsRows('failed', null, stage({}))).toThrow('the live screen is failed');
  });

  it('times to the end of the first frame where the test holds', async () => {
    const clock = frames();
    let holds = false;
    const timed = afterFrameWhere(() => holds, 0, 1000, 'never', clock);
    clock.flush(3);
    holds = true;
    clock.flush();
    // Frames at 16, 32, 48: it held at 64, and the task after that frame ran at 68.
    expect(await timed).toBe(68);
  });

  it('gives up after the timeout, and passes on what the test throws', async () => {
    const clock = frames();
    const never = afterFrameWhere(() => false, 0, 100, 'no rows painted', clock);
    clock.flush();
    await expect(never).rejects.toThrow('no rows painted within 100 ms');
    const broken = afterFrameWhere(
      () => {
        throw new Error('the live screen is failed');
      },
      0,
      100,
      'x',
      clock,
    );
    clock.flush();
    await expect(broken).rejects.toThrow('the live screen is failed');
  });
});
