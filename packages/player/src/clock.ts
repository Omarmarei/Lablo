/** The timers the controller runs on, injected so tests can drive time. */
export interface Clock {
  /** Monotonic milliseconds (a TV's wall clock can jump when it syncs). */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
};
