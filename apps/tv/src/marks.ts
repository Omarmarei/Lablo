/**
 * User Timing marks for the start (RELAY step 20c1): the e2e checks their order (the last
 * channel plays before the live screen's catalog is read), and the on-TV check (step 21) reads
 * their times (launch to the last channel's first frame).
 *
 * - `zoma:resume`: the start opened the last channel's stream;
 * - `zoma:resume-frame`: that stream's first frame;
 * - `zoma:live-ready`: the live screen's categories are in.
 */
export type StartMark = 'zoma:resume' | 'zoma:resume-frame' | 'zoma:live-ready';

/** Marks `name` now; an engine without User Timing marks nothing. */
export function mark(name: StartMark): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(name);
  } catch {
    // A mark must never stop the start.
  }
}
