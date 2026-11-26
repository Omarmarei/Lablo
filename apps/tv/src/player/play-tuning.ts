import type { PlayTuning, WatchdogConfig } from '@lablo/player';
import { DEFAULT_WATCHDOG } from '@lablo/player';

/**
 * Settings › "Player"'s "Buffering" (RELAY step 39d, architecture.md §2 "Built in step 39d"): what
 * each play is tuned with, read by the controller at each `play` (`ControllerOptions.tuning`).
 *
 * - **Fast start** (the default): the watchdog as before (`DEFAULT_WATCHDOG`), and on Samsung
 *   AVPlay plays once it holds 5 s of media (Samsung's example value: half its own 10 s, above
 *   its 4 s floor); after a stall it keeps its own buffer.
 * - **Stable:** a more patient watchdog (live frozen 12 s, live buffering 25 s, VOD buffering
 *   40 s, open 20 s), so a slow provider buffers instead of reconnecting (each reconnect restarts
 *   the stream and can trip a one-connection account); on Samsung AVPlay holds 10 s before
 *   playing (its own amount) and 15 s after a stall (Samsung's example). Live buffering must
 *   outlast that 15 s plus AVPlay's own reconnect, about 7 s after the data stops. The give-up
 *   window grows with the open timeout (`windowFor`: 92 s), so a stream that never opens still
 *   ends on the error card. A live URL that shows nothing while another is untried gets 12 s
 *   (Fast start 6 s: the fallback's cap, RELAY step 39s2), so a slow first URL isn't left early.
 *
 * The `<video>` (webOS, the desktop, Tizen's HLS fallback) can't be told a buffer: there Stable
 * changes the watchdog only. Remote config's tunables set Fast start's numbers (`PlayTunables`);
 * Stable keeps its own, or Fast start's where those are larger, so it is never less patient.
 * The numbers are a first guess until a TV session (step 21).
 */

export type BufferMode = 'fast' | 'stable';

/** The row's values, in order. */
export const BUFFER_MODES: readonly BufferMode[] = ['fast', 'stable'];

/** Remote config's tunables that tune a play (the signed config's `tunables`; all optional). */
export interface PlayTunables {
  /** AVPlay's buffer before a live stream plays, in seconds. */
  readonly liveBufferSeconds?: number | undefined;
  /** The same for VOD and catch-up. */
  readonly vodBufferSeconds?: number | undefined;
  /** No first frame this long after a load: an open timeout. */
  readonly openTimeoutMs?: number | undefined;
  /** A live stream buffering this long is a stall. */
  readonly stallTimeoutMs?: number | undefined;
}

/** Fast start's buffer before playing, in seconds. */
export const FAST_PLAY_SECONDS = 5;

/** Stable's numbers. */
export const STABLE = {
  liveFrozenMs: 12_000,
  liveBufferingMs: 25_000,
  vodBufferingMs: 40_000,
  openTimeoutMs: 20_000,
  fallbackMs: 12_000,
  playSeconds: 10,
  resumeSeconds: 15,
} as const;

/**
 * The give-up window for an open timeout (never under the default 60 s): the ladder's attempts
 * that each wait out the open timeout, with the longest backoff between them, must fit in it, or
 * a stream that never shows a frame is tried again for ever. Four attempts within 60 s never
 * happen with a 20 s open timeout (they come every 24 s or so).
 */
export function windowFor(openTimeoutMs: number): number {
  const d = DEFAULT_WATCHDOG;
  const longest = d.backoffMs[d.backoffMs.length - 1]!;
  return Math.max(d.windowMs, d.maxAttempts * openTimeoutMs + (d.maxAttempts - 1) * longest);
}

/** The default watchdog with its five limits replaced, and the window to fit its open timeout. */
function watchdog(liveFrozenMs: number, liveBufferingMs: number, vodBufferingMs: number, openTimeoutMs: number, fallbackMs: number): WatchdogConfig {
  const d = DEFAULT_WATCHDOG;
  return { liveFrozenMs, liveBufferingMs, liveNoDataMs: d.liveNoDataMs, vodBufferingMs, openTimeoutMs, fallbackMs, tickMs: d.tickMs, maxAttempts: d.maxAttempts, windowMs: windowFor(openTimeoutMs), backoffMs: d.backoffMs };
}

/** What a play is tuned with in `mode`, Fast start's numbers set by remote config's `tunables`. */
export function playTuning(mode: BufferMode, tunables: PlayTunables): PlayTuning {
  const d = DEFAULT_WATCHDOG;
  const open = tunables.openTimeoutMs ?? d.openTimeoutMs;
  const stall = tunables.stallTimeoutMs ?? d.liveBufferingMs;
  const live = tunables.liveBufferSeconds ?? FAST_PLAY_SECONDS;
  const vod = tunables.vodBufferSeconds ?? FAST_PLAY_SECONDS;
  if (mode === 'fast') {
    return {
      watchdog: watchdog(d.liveFrozenMs, stall, d.vodBufferingMs, open, d.fallbackMs),
      liveBuffer: { playSeconds: live, resumeSeconds: null },
      vodBuffer: { playSeconds: vod, resumeSeconds: null },
    };
  }
  return {
    watchdog: watchdog(STABLE.liveFrozenMs, Math.max(STABLE.liveBufferingMs, stall), STABLE.vodBufferingMs, Math.max(STABLE.openTimeoutMs, open), STABLE.fallbackMs),
    liveBuffer: { playSeconds: Math.max(STABLE.playSeconds, live), resumeSeconds: STABLE.resumeSeconds },
    vodBuffer: { playSeconds: Math.max(STABLE.playSeconds, vod), resumeSeconds: STABLE.resumeSeconds },
  };
}
