/**
 * S11's lifecycle log (RELAY step 15b2): every visibility change and relaunch the platform
 * reports while the lab is open (`Platform.onLifecycle`: Tizen `visibilitychange` and
 * `appcontrol`, webOS `visibilitychange` and `webOSRelaunch`). Each one goes to the collector at
 * once as an `event` record, so the log shows when the TV hid the lab (Home, another app) and
 * when it came back, even if the TV paused the lab's scripts in between: the records wait and
 * go out on its return. A heartbeat every second tells whether they ran while hidden (Samsung
 * says scripts pause in the background; LG doesn't say).
 */
import type { LifecycleEvent, Platform } from '@zoma/platform-api';

export interface LifecycleEntry {
  readonly event: LifecycleEvent;
  /** ms since the page's start (`performance.now`). */
  readonly ms: number;
  /** ISO time on the TV's clock. */
  readonly at: string;
  /** `document.visibilityState` when it came. */
  readonly visibility: string | null;
  /** On `visible` after `hidden`: how long the lab was away, and the heartbeats (1 s) in that time. */
  readonly away?: { readonly ms: number; readonly beats: number };
}

export interface LifecycleLog {
  readonly entries: readonly LifecycleEntry[];
  /** Hands every entry so far, then each new one, to `report` (the collector). */
  attach(report: (entry: LifecycleEntry) => void): void;
  stop(): void;
}

export interface LifecycleClock {
  ms(): number;
  iso(): string;
  visibility(): string | null;
  /** Calls `run` every `ms` until the returned function is called. */
  every(run: () => void, ms: number): () => void;
}

export const PAGE_CLOCK: LifecycleClock = {
  ms: () => performance.now(),
  iso: () => new Date().toISOString(),
  visibility: () => (typeof document.visibilityState === 'string' ? document.visibilityState : null),
  every: (run, ms) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
};

export const HEARTBEAT_MS = 1000;

export function createLifecycleLog(platform: Pick<Platform, 'onLifecycle'>, clock: LifecycleClock = PAGE_CLOCK): LifecycleLog {
  const entries: LifecycleEntry[] = [];
  let report: ((entry: LifecycleEntry) => void) | null = null;
  let beats = 0;
  let hidden: { readonly ms: number; readonly beats: number } | null = null;
  const stopBeats = clock.every(() => {
    beats += 1;
  }, HEARTBEAT_MS);
  const stopEvents = platform.onLifecycle((event) => {
    const ms = Math.round(clock.ms());
    let away: LifecycleEntry['away'];
    if (event === 'hidden') hidden ??= { ms, beats };
    else if (event === 'visible' && hidden !== null) {
      away = { ms: ms - hidden.ms, beats: beats - hidden.beats };
      hidden = null;
    }
    const entry: LifecycleEntry = { event, ms, at: clock.iso(), visibility: clock.visibility(), ...(away === undefined ? {} : { away }) };
    entries.push(entry);
    if (report !== null) report(entry);
  });
  return {
    entries,
    attach: (next) => {
      report = next;
      for (const entry of entries) next(entry);
    },
    stop: () => {
      stopEvents();
      stopBeats();
    },
  };
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** `hidden at 12.3 s, visible at 40.1 s (away 27.8 s, 3 beats), relaunch at 51.0 s`. */
export function lifecycleNote(entries: readonly LifecycleEntry[]): string {
  if (entries.length === 0) return 'no lifecycle events yet: press Home, come back to the lab (or launch it again), then run S11 alone';
  const parts: string[] = [];
  for (const entry of entries) {
    const away = entry.away === undefined ? '' : ` (away ${seconds(entry.away.ms)}, ${entry.away.beats} beat${entry.away.beats === 1 ? '' : 's'})`;
    parts.push(`${entry.event} at ${seconds(entry.ms)}${away}`);
  }
  const shown = parts.length > 6 ? [...parts.slice(0, 2), `… ${parts.length - 4} more`, ...parts.slice(-2)] : parts;
  return shown.join(', ');
}
