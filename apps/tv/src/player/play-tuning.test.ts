import { DEFAULT_WATCHDOG } from '@lablo/player';
import { describe, expect, it } from 'vitest';
import { BUFFER_MODES, FAST_PLAY_SECONDS, STABLE, playTuning, windowFor } from './play-tuning';

/**
 * "Buffering" (RELAY step 39d): what each play is tuned with. Fast start is today's watchdog with
 * AVPlay's smaller first buffer; Stable a more patient watchdog with AVPlay's larger buffers.
 * Remote config's tunables set Fast start's numbers, and Stable is never less patient.
 */

const SAME = { tickMs: DEFAULT_WATCHDOG.tickMs, maxAttempts: DEFAULT_WATCHDOG.maxAttempts, backoffMs: DEFAULT_WATCHDOG.backoffMs };

describe('playTuning (RELAY step 39d)', () => {
  it('lists Fast start, then Stable', () => {
    expect(BUFFER_MODES).toEqual(['fast', 'stable']);
  });

  it("Fast start: today's watchdog, AVPlay's 5 s before playing and its own after a stall", () => {
    expect(FAST_PLAY_SECONDS).toBe(5);
    expect(playTuning('fast', {})).toEqual({
      watchdog: DEFAULT_WATCHDOG,
      liveBuffer: { playSeconds: 5, resumeSeconds: null },
      vodBuffer: { playSeconds: 5, resumeSeconds: null },
    });
    expect(DEFAULT_WATCHDOG).toMatchObject({ liveFrozenMs: 6000, liveBufferingMs: 12_000, vodBufferingMs: 20_000, openTimeoutMs: 10_000 });
  });

  it('Stable: live frozen 12 s, live buffering 25 s, VOD buffering 40 s, open 20 s; AVPlay 10 s before playing and 15 s after a stall', () => {
    expect(playTuning('stable', {})).toEqual({
      watchdog: { liveFrozenMs: 12_000, liveBufferingMs: 25_000, vodBufferingMs: 40_000, openTimeoutMs: 20_000, windowMs: 92_000, ...SAME },
      liveBuffer: { playSeconds: 10, resumeSeconds: 15 },
      vodBuffer: { playSeconds: 10, resumeSeconds: 15 },
    });
    // Live buffering outlasts AVPlay's buffer after a stall plus its own reconnect (about 7 s).
    expect(STABLE.liveBufferingMs).toBeGreaterThan(STABLE.resumeSeconds * 1000 + 7000);
    // Every number at least Fast start's.
    const fast = playTuning('fast', {}).watchdog;
    const stable = playTuning('stable', {}).watchdog;
    for (const limit of ['liveFrozenMs', 'liveBufferingMs', 'vodBufferingMs', 'openTimeoutMs'] as const) expect(stable[limit]).toBeGreaterThan(fast[limit]);
  });

  it("takes remote config's tunables as Fast start's numbers", () => {
    const tuned = playTuning('fast', { liveBufferSeconds: 8, vodBufferSeconds: 12, openTimeoutMs: 15_000, stallTimeoutMs: 18_000 });
    expect(tuned).toEqual({
      watchdog: { liveFrozenMs: 6000, liveBufferingMs: 18_000, vodBufferingMs: 20_000, openTimeoutMs: 15_000, windowMs: 72_000, ...SAME },
      liveBuffer: { playSeconds: 8, resumeSeconds: null },
      vodBuffer: { playSeconds: 12, resumeSeconds: null },
    });
    // Each on its own, the rest as before; a buffer under AVPlay's floor is the engine's to raise.
    expect(playTuning('fast', { liveBufferSeconds: 2.5 }).liveBuffer).toEqual({ playSeconds: 2.5, resumeSeconds: null });
    expect(playTuning('fast', { liveBufferSeconds: 2.5 }).vodBuffer).toEqual({ playSeconds: 5, resumeSeconds: null });
    expect(playTuning('fast', { vodBufferSeconds: 30 }).liveBuffer).toEqual({ playSeconds: 5, resumeSeconds: null });
    expect(playTuning('fast', { stallTimeoutMs: 9000 }).watchdog).toEqual({ ...DEFAULT_WATCHDOG, liveBufferingMs: 9000 });
    expect(playTuning('fast', { openTimeoutMs: 4000 }).watchdog).toEqual({ ...DEFAULT_WATCHDOG, openTimeoutMs: 4000 });
    // Absent fields (as zod reads them) are the defaults.
    expect(playTuning('fast', { liveBufferSeconds: undefined, stallTimeoutMs: undefined })).toEqual(playTuning('fast', {}));
  });

  it('gives up within a window that holds four attempts at the open timeout, never under 60 s', () => {
    // Four opens of 20 s with the 4 s backoff between them: 92 s. Ten seconds: today's 60 s.
    expect([windowFor(10_000), windowFor(12_000), windowFor(13_000), windowFor(15_000), windowFor(20_000)]).toEqual([60_000, 60_000, 64_000, 72_000, 92_000]);
    expect(playTuning('fast', {}).watchdog.windowMs).toBe(60_000);
    expect(playTuning('stable', {}).watchdog.windowMs).toBe(92_000);
    expect(playTuning('fast', { openTimeoutMs: 4000 }).watchdog.windowMs).toBe(60_000);
  });

  it("keeps Stable's numbers, or Fast start's where remote config made those larger", () => {
    // Smaller than Stable's: Stable's stand.
    expect(playTuning('stable', { liveBufferSeconds: 3, vodBufferSeconds: 8, openTimeoutMs: 15_000, stallTimeoutMs: 18_000 })).toEqual(playTuning('stable', {}));
    // Larger: Fast start's.
    const raised = playTuning('stable', { liveBufferSeconds: 12, vodBufferSeconds: 20, openTimeoutMs: 30_000, stallTimeoutMs: 40_000 });
    expect(raised).toEqual({
      watchdog: { liveFrozenMs: 12_000, liveBufferingMs: 40_000, vodBufferingMs: 40_000, openTimeoutMs: 30_000, windowMs: 132_000, ...SAME },
      liveBuffer: { playSeconds: 12, resumeSeconds: 15 },
      vodBuffer: { playSeconds: 20, resumeSeconds: 15 },
    });
    // Each on its own.
    expect(playTuning('stable', { vodBufferSeconds: 20 }).liveBuffer).toEqual({ playSeconds: 10, resumeSeconds: 15 });
    expect(playTuning('stable', { liveBufferSeconds: 12 }).vodBuffer).toEqual({ playSeconds: 10, resumeSeconds: 15 });
    expect(playTuning('stable', { stallTimeoutMs: 40_000 }).watchdog.openTimeoutMs).toBe(20_000);
    expect(playTuning('stable', { openTimeoutMs: 30_000 }).watchdog.liveBufferingMs).toBe(25_000);
  });
});
