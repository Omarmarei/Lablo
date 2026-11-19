import type { TelemetryEvent } from '@lablo/protocol';
import type { WorkerError } from '../data/engine';

/**
 * Crash reports (RELAY step 33c, architecture.md §3.4): main's uncaught errors and unhandled
 * rejections, and the data workers' uncaught errors (`DataEngineOptions.onWorkerError`), each
 * recorded as a `crash` event through telemetry's `record` (held until a send, dropped while the
 * switch is off).
 *
 * Main records the raw text: the scrubber can't be in main.js (its polyfills are 25.8 KB on
 * Chromium 53), so the telemetry worker scrubs each stack with the user's own logins, links and
 * hosts before anything is stored (`scrubbedCrash`). A raw stack lives only in memory until the next
 * send.
 *
 * - **The window's `error`** is recorded only when it carries the thrown value: a muted "Script
 *   error." has none, and neither has the copy of a worker's error that newer Chromium passes on
 *   to the window (53, 56 and 68 don't; that error is recorded from its own `Worker`).
 * - **The text reads as Chrome's console does:** `Uncaught <stack>` for errors, `Uncaught (in
 *   promise) <stack>` for rejections; a worker's message already begins `Uncaught`, and its frame is
 *   `<worker>.worker.js:<line>:<col>` (the bundle the position is in; its `blob:` URL says nothing).
 *   A value with no stack gives its text, and an error the event's place.
 * - **At most `CRASH_SESSION_MAX` a session**, each text's first two lines (the message and, for a
 *   V8 stack, its first frame) once: a crash loop must not fill the queue, and the first say the most.
 * - **The handler never throws, and never records itself:** its work runs inside `try`, and a crash
 *   raised while one is being recorded is dropped.
 */

/** Crashes recorded in a session, at most. */
export const CRASH_SESSION_MAX = 3;

/**
 * The longest text main holds for a crash. Longer than the scrubber's own pre-cut (16,000,
 * `SCRUB_INPUT_MAX_CHARS`), so that cut, which drops the token it falls in, is the one that
 * decides: main never leaves half a login at its cut (a test pins the order of the two).
 */
export const CRASH_TEXT_MAX = 20_000;

/** What the window's `error` event gives (an `ErrorEvent`; tests pass plain objects). */
export interface ErrorEventLike {
  readonly error?: unknown;
  readonly message?: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
}

/** What the window's `unhandledrejection` event gives (a `PromiseRejectionEvent`). */
export interface RejectionEventLike {
  readonly reason?: unknown;
}

export interface CrashReporterOptions {
  readonly record: (event: TelemetryEvent) => void;
  readonly now?: () => number;
  /** Where a crash the handler couldn't read is told (default: `console.warn`). */
  readonly warn?: (message: string, detail: unknown) => void;
}

export interface CrashReporter {
  /** The window's `error`. */
  error(event: ErrorEventLike): void;
  /** The window's `unhandledrejection`. */
  rejection(event: RejectionEventLike): void;
  /** A data worker's uncaught error. */
  worker(error: WorkerError): void;
}

/** A thrown value's stack, when it has one as text. */
function stackOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const stack = (value as { stack?: unknown }).stack;
  return typeof stack === 'string' && stack !== '' ? stack : null;
}

/** `String(value)`, or `[unreadable]` when that throws (an object whose `toString` does). */
function textOf(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unreadable]';
  }
}

/** The window's error as text, or `null` when it carries no thrown value (nothing of ours to learn). */
export function errorText(event: ErrorEventLike): string | null {
  const value = event.error;
  if (value === null || value === undefined) return null;
  const stack = stackOf(value);
  if (stack !== null) return 'Uncaught ' + stack;
  return (event.message || 'Uncaught ' + textOf(value)) + '\n    at ' + (event.filename || '?') + ':' + (event.lineno || 0) + ':' + (event.colno || 0);
}

/** An unhandled rejection's reason as text. */
export function rejectionText(reason: unknown): string {
  const stack = stackOf(reason);
  return 'Uncaught (in promise) ' + (stack !== null ? stack : textOf(reason));
}

/** A worker's error as text: its message, then its worker's bundle and the position in it. */
export function workerText(error: WorkerError): string {
  return (error.message || 'Uncaught error') + '\n    at ' + error.worker + '.worker.js:' + error.line + ':' + error.col;
}

/** The text's first two lines: what makes two crashes the same one. */
export function crashKey(text: string): string {
  const first = text.indexOf('\n');
  const second = first === -1 ? -1 : text.indexOf('\n', first + 1);
  return second === -1 ? text : text.slice(0, second);
}

export function createCrashReporter(options: CrashReporterOptions): CrashReporter {
  const now = options.now ?? (() => Date.now());
  const warn = options.warn ?? ((message: string, detail: unknown) => console.warn(message, detail));
  const seen: string[] = [];
  let recorded = 0;
  /** A crash is being recorded: one raised meanwhile is the handler's own. */
  let busy = false;

  const report = (where: 'main' | 'worker', read: () => string | null): void => {
    if (busy || recorded >= CRASH_SESSION_MAX) return;
    busy = true;
    try {
      const full = read();
      if (full === null) return;
      const text = full.length > CRASH_TEXT_MAX ? full.slice(0, CRASH_TEXT_MAX) : full;
      const key = crashKey(text);
      if (seen.indexOf(key) !== -1) return;
      seen.push(key);
      recorded++;
      options.record({ kind: 'crash', at: now(), where, stack: text });
    } catch (error) {
      warn('A crash was not recorded', error);
    } finally {
      busy = false;
    }
  };

  return {
    error: (event) => report('main', () => errorText(event)),
    rejection: (event) => report('main', () => rejectionText(event.reason)),
    worker: (error) => report('worker', () => workerText(error)),
  };
}

/** The window's two crash events, as `listenForCrashes` needs them. */
export interface CrashTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void;
}

/** Hands the window's `error` and `unhandledrejection` events to `reporter`; returns the undo. */
export function listenForCrashes(target: CrashTarget, reporter: CrashReporter): () => void {
  const onError = (event: Event): void => reporter.error(event as ErrorEventLike);
  const onRejection = (event: Event): void => reporter.rejection(event as RejectionEventLike);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
