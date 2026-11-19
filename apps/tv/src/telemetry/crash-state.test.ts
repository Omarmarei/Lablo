import type { TelemetryEvent } from '@lablo/protocol';
import { readTelemetryEvents } from '@lablo/protocol';
import { SCRUB_INPUT_MAX_CHARS, SCRUB_MAX_CHARS } from '@lablo/protocol/scrub';
import { describe, expect, it } from 'vitest';
import type { CrashReporter } from './crash-state';
import { CRASH_SESSION_MAX, CRASH_TEXT_MAX, crashKey, createCrashReporter, errorText, listenForCrashes, rejectionText, workerText } from './crash-state';

/** An error whose stack is exactly `stack` (as V8 writes one). */
function thrown(stack: string): Error {
  const error = new Error('ignored');
  error.stack = stack;
  return error;
}

/** A value whose `toString` throws. */
const unreadable = {
  toString(): string {
    throw new Error('no text');
  },
};

function setup(record?: (event: TelemetryEvent, reporter: CrashReporter) => void) {
  const recorded: TelemetryEvent[] = [];
  const warned: [string, unknown][] = [];
  let clock = 1_700_000_000_000;
  const reporter: CrashReporter = createCrashReporter({
    record: (event) => {
      recorded.push(event);
      record?.(event, reporter);
    },
    now: () => clock++,
    warn: (message, detail) => warned.push([message, detail]),
  });
  return { reporter, recorded, warned };
}

describe('errorText', () => {
  it("is `Uncaught` and the thrown error's stack", () => {
    expect(errorText({ error: thrown('Error: boom\n    at f (file:///app/main.js:1:2)'), message: 'Uncaught Error: boom', filename: 'file:///app/main.js', lineno: 1, colno: 2 })).toBe(
      'Uncaught Error: boom\n    at f (file:///app/main.js:1:2)',
    );
  });

  it("is the event's message and place for a value with no stack (a thrown string, an old engine's DOMException)", () => {
    expect(errorText({ error: 'main-string', message: 'Uncaught main-string', filename: 'file:///app/main.js', lineno: 42, colno: 26 })).toBe('Uncaught main-string\n    at file:///app/main.js:42:26');
    expect(errorText({ error: { name: 'QuotaExceededError', stack: '' }, message: 'Uncaught QuotaExceededError', filename: 'file:///app/main.js', lineno: 3, colno: 4 })).toBe(
      'Uncaught QuotaExceededError\n    at file:///app/main.js:3:4',
    );
    expect(errorText({ error: { stack: 7 }, message: 'Uncaught [object Object]', filename: 'f.js', lineno: 1, colno: 1 })).toBe('Uncaught [object Object]\n    at f.js:1:1');
    // No message, no place: the value's text, and `?:0:0`.
    expect(errorText({ error: 42 })).toBe('Uncaught 42\n    at ?:0:0');
    expect(errorText({ error: false, message: '' })).toBe('Uncaught false\n    at ?:0:0');
    expect(errorText({ error: unreadable })).toBe('Uncaught [unreadable]\n    at ?:0:0');
  });

  it('is nothing for an event with no thrown value: a muted "Script error.", or a worker\'s error passed on to the window', () => {
    expect(errorText({ error: null, message: 'Script error.', filename: '', lineno: 0, colno: 0 })).toBeNull();
    expect(errorText({ error: null, message: 'Uncaught Error: worker-throw', filename: 'blob:null/9f279f91-9fbd-43b5-9aba-b006059f6749', lineno: 1, colno: 32 })).toBeNull();
    expect(errorText({ message: 'Uncaught Error: x' })).toBeNull();
  });
});

describe('rejectionText', () => {
  it("is `Uncaught (in promise)` and the reason's stack, else its text", () => {
    expect(rejectionText(thrown('Error: main-reject\n    at file:///app/main.js:43:16'))).toBe('Uncaught (in promise) Error: main-reject\n    at file:///app/main.js:43:16');
    expect(rejectionText('main-reject-string')).toBe('Uncaught (in promise) main-reject-string');
    expect(rejectionText({ stack: '' })).toBe('Uncaught (in promise) [object Object]');
    expect(rejectionText(undefined)).toBe('Uncaught (in promise) undefined');
    expect(rejectionText(null)).toBe('Uncaught (in promise) null');
    expect(rejectionText(unreadable)).toBe('Uncaught (in promise) [unreadable]');
  });
});

describe('workerText', () => {
  it("is the worker's message, then its bundle and the position in it", () => {
    expect(workerText({ worker: 'telemetry', message: 'Uncaught Error: worker-throw', line: 1, col: 32 })).toBe('Uncaught Error: worker-throw\n    at telemetry.worker.js:1:32');
    // A worker whose script didn't load says nothing.
    expect(workerText({ worker: 'query', message: '', line: 0, col: 0 })).toBe('Uncaught error\n    at query.worker.js:0:0');
  });
});

describe('crashKey', () => {
  it("is the text's first two lines: the message and the first frame", () => {
    expect(crashKey('Uncaught Error: a')).toBe('Uncaught Error: a');
    expect(crashKey('Uncaught Error: a\n    at f (main.js:1:2)')).toBe('Uncaught Error: a\n    at f (main.js:1:2)');
    expect(crashKey('Uncaught Error: a\n    at f (main.js:1:2)\n    at g (main.js:3:4)\n    at h (main.js:5:6)')).toBe('Uncaught Error: a\n    at f (main.js:1:2)');
    expect(crashKey('\n\n')).toBe('\n');
  });
});

describe('the crash reporter', () => {
  it('records each crash as a `crash` event the server reads, at its time, main or worker', () => {
    const t = setup();
    t.reporter.error({ error: thrown('Error: one\n    at f (file:///app/main.js:1:2)') });
    t.reporter.rejection({ reason: thrown('TypeError: two\n    at g (file:///app/main.js:3:4)') });
    t.reporter.worker({ worker: 'epg', message: 'Uncaught RangeError: three', line: 5, col: 6 });
    expect(t.recorded).toEqual([
      { kind: 'crash', at: 1_700_000_000_000, where: 'main', stack: 'Uncaught Error: one\n    at f (file:///app/main.js:1:2)' },
      { kind: 'crash', at: 1_700_000_000_001, where: 'main', stack: 'Uncaught (in promise) TypeError: two\n    at g (file:///app/main.js:3:4)' },
      { kind: 'crash', at: 1_700_000_000_002, where: 'worker', stack: 'Uncaught RangeError: three\n    at epg.worker.js:5:6' },
    ]);
    expect(readTelemetryEvents(t.recorded)).toEqual({ events: t.recorded, dropped: 0 });
    expect(t.warned).toEqual([]);
  });

  it('records a crash once: the same first two lines again record nothing, and do not count', () => {
    const t = setup();
    const stack = 'Error: same\n    at f (file:///app/main.js:1:2)';
    t.reporter.error({ error: thrown(stack + '\n    at g (file:///app/main.js:9:9)') });
    // The same message from the same place, by another way down.
    t.reporter.error({ error: thrown(stack + '\n    at h (file:///app/main.js:8:8)') });
    t.reporter.error({ error: thrown(stack) });
    expect(t.recorded).toHaveLength(1);
    // Another place, another message, or a rejection of the same error: each its own.
    t.reporter.error({ error: thrown('Error: same\n    at k (file:///app/main.js:7:7)') });
    t.reporter.rejection({ reason: thrown(stack) });
    expect(t.recorded.map((e) => (e as { stack: string }).stack.split('\n')[1])).toEqual(['    at f (file:///app/main.js:1:2)', '    at k (file:///app/main.js:7:7)', '    at f (file:///app/main.js:1:2)']);
  });

  it(`records at most ${CRASH_SESSION_MAX} crashes a session`, () => {
    expect(CRASH_SESSION_MAX).toBe(3);
    const t = setup();
    for (let i = 0; i < 5; i++) t.reporter.rejection({ reason: `reason ${i}` });
    t.reporter.worker({ worker: 'query', message: 'Uncaught Error: late', line: 1, col: 1 });
    expect(t.recorded.map((e) => (e as { stack: string }).stack)).toEqual(['Uncaught (in promise) reason 0', 'Uncaught (in promise) reason 1', 'Uncaught (in promise) reason 2']);
  });

  it('records nothing, and counts nothing, for an error with no thrown value', () => {
    const t = setup();
    for (let i = 0; i < 4; i++) t.reporter.error({ error: null, message: 'Script error.' });
    t.reporter.error({ message: 'Uncaught Error: copied from a worker', filename: 'blob:null/x', lineno: 1, colno: 2 });
    expect(t.recorded).toEqual([]);
    for (let i = 0; i < 3; i++) t.reporter.rejection({ reason: i });
    expect(t.recorded).toHaveLength(3);
    expect(t.warned).toEqual([]);
  });

  it("cuts a text at CRASH_TEXT_MAX, above the scrubber's pre-cut, so the scrubber's cut decides", () => {
    expect(CRASH_TEXT_MAX).toBe(20_000);
    expect(CRASH_TEXT_MAX).toBeGreaterThan(SCRUB_INPUT_MAX_CHARS);
    expect(SCRUB_INPUT_MAX_CHARS).toBeGreaterThan(SCRUB_MAX_CHARS);
    const t = setup();
    const long = 'Error: long\n    at f (file:///app/main.js:1:2)\n' + 'x'.repeat(30_000);
    t.reporter.error({ error: thrown(long) });
    t.reporter.error({ error: thrown('Error: exact\n' + 'y'.repeat(CRASH_TEXT_MAX - 'Uncaught Error: exact\n'.length)) });
    const stacks = t.recorded.map((e) => (e as { stack: string }).stack);
    expect(stacks[0]).toBe(('Uncaught ' + long).slice(0, CRASH_TEXT_MAX));
    expect(stacks[1]).toHaveLength(CRASH_TEXT_MAX);
    expect(stacks[1]!.slice(-1)).toBe('y');
  });

  it('never throws: a crash it cannot read, or a record that throws, is told and dropped, and the next one is recorded', () => {
    let failing = true;
    const t = setup(() => {
      if (failing) throw new Error('record broke');
    });
    const broken = {
      get error(): unknown {
        throw new Error('no error');
      },
    };
    expect(() => t.reporter.error(broken)).not.toThrow();
    expect(() => t.reporter.rejection({ reason: 'first' })).not.toThrow();
    expect(t.warned.map((w) => [w[0], (w[1] as Error).message])).toEqual([
      ['A crash was not recorded', 'no error'],
      ['A crash was not recorded', 'record broke'],
    ]);
    failing = false;
    t.reporter.rejection({ reason: 'second' });
    expect(t.recorded.map((e) => (e as { stack: string }).stack)).toEqual(['Uncaught (in promise) first', 'Uncaught (in promise) second']);
  });

  it('never records a crash raised while one is being recorded', () => {
    let inner = 0;
    const t = setup((event, reporter) => {
      if (inner++ > 0) return;
      reporter.error({ error: thrown('Error: raised inside\n    at record') });
      reporter.worker({ worker: 'ingest', message: 'Uncaught Error: inside too', line: 1, col: 1 });
    });
    t.reporter.rejection({ reason: 'outer' });
    expect(t.recorded.map((e) => (e as { stack: string }).stack)).toEqual(['Uncaught (in promise) outer']);
    // The guard is let go after it: the next crash is recorded.
    t.reporter.rejection({ reason: 'after' });
    expect(t.recorded).toHaveLength(2);
  });
});

describe('listenForCrashes', () => {
  it("hands the window's `error` and `unhandledrejection` to the reporter, until undone", () => {
    const target = new EventTarget();
    const t = setup();
    const undo = listenForCrashes(target, t.reporter);
    target.dispatchEvent(Object.assign(new Event('error'), { error: thrown('Error: e\n    at f (main.js:1:2)'), message: 'Uncaught Error: e' }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'r' }));
    expect(t.recorded.map((e) => (e as { stack: string }).stack)).toEqual(['Uncaught Error: e\n    at f (main.js:1:2)', 'Uncaught (in promise) r']);
    undo();
    target.dispatchEvent(Object.assign(new Event('error'), { error: thrown('Error: later') }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'later' }));
    expect(t.recorded).toHaveLength(2);
  });
});
