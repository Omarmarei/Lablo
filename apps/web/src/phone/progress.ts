/**
 * The progress poll (RELAY step 31b): while the progress shows, the page reads the code's progress
 * every 2 s, one read at a time, until the TV's status (`done`) or the row is gone (404). A read
 * that fails waits for the next tick. Stopping it (the view changed, the page closed) drops any
 * answer still on its way.
 */
import type { PairProgressResponse } from '@lablo/protocol';
import type { ApiResult, PhoneApi } from './api';

export const PROGRESS_POLL_MS = 2000;

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Whether an answer ends the poll. */
export function isFinal(result: ApiResult<PairProgressResponse>): boolean {
  return result.ok ? result.value.state === 'done' : result.error === 'gone';
}

/** Starts the poll for `code`; each answer goes to `onAnswer`. Returns the stop. */
export function pollProgress(
  code: string,
  api: Pick<PhoneApi, 'progress'>,
  onAnswer: (result: ApiResult<PairProgressResponse>) => void,
  timers: Timers = browserTimers,
): () => void {
  let stopped = false;
  let handle: unknown = null;
  const tick = (): void => {
    handle = null;
    void api.progress(code).then((result) => {
      if (stopped) return;
      onAnswer(result);
      if (!isFinal(result)) handle = timers.setTimeout(tick, PROGRESS_POLL_MS);
    });
  };
  handle = timers.setTimeout(tick, PROGRESS_POLL_MS);
  return () => {
    stopped = true;
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
}
