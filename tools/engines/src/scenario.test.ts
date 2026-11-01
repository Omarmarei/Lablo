import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import type { PageState, PlatformRun } from './scenario';
import { KEY_STEPS, STATE_EXPRESSION, evaluateRun, formatConsoleError, formatException, isSettled } from './scenario';

const URL = 'file:///app/app/webos/index.html';
const UA53 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';

function state(overrides: Partial<PageState> = {}): PageState {
  return {
    href: URL,
    userAgent: UA53,
    bootError: '',
    ready: true,
    platformId: 'webos',
    worker: 'ok in 12 ms (TextDecoder, indexedDB, fetch)',
    idb: 'ok',
    lastIntent: 'OK',
    keyCount: '2',
    ...overrides,
  };
}

function run(overrides: Partial<PlatformRun> = {}): PlatformRun {
  return {
    platform: 'webos',
    url: URL,
    boot: state(),
    settled: true,
    keys: KEY_STEPS.map((step) => ({ key: step.key, expected: step.intent, observed: step.intent })),
    keyCount: '2',
    exceptions: [],
    durationMs: 200,
    ...overrides,
  };
}

const engine53 = { major: 53 };

describe('the in-page state probe', () => {
  it('is plain ES5, so it runs on every engine', () => {
    expect(() => parse(STATE_EXPRESSION, { ecmaVersion: 5 })).not.toThrow();
  });
});

describe('isSettled', () => {
  it('waits for this page, not the previous one', () => {
    expect(isSettled(state({ href: 'about:blank' }), URL)).toBe(false);
  });

  it('settles when the worker and IndexedDB checks have answered', () => {
    expect(isSettled(state(), URL)).toBe(true);
    expect(isSettled(state({ worker: 'failed: no reply within 5000 ms', idb: 'failed: no worker' }), URL)).toBe(true);
  });

  it('keeps waiting while the app is still starting', () => {
    expect(isSettled(state({ ready: false }), URL)).toBe(false);
    expect(isSettled(state({ worker: 'starting…' }), URL)).toBe(false);
    expect(isSettled(state({ idb: 'checking…' }), URL)).toBe(false);
  });

  it('settles at once on a boot error', () => {
    expect(isSettled(state({ ready: false, worker: null, idb: null, bootError: 'Boot error: Uncaught SyntaxError' }), URL)).toBe(true);
  });
});

describe('exception formatting', () => {
  it('reads protocol 1.2 exceptionDetails', () => {
    const params = {
      exceptionDetails: {
        text: 'Uncaught',
        url: 'file:///app/app/tizen/main.js',
        lineNumber: 0,
        exception: { description: 'TypeError: x.padStart is not a function\n    at clock (main.js:1:9)' },
      },
    };
    expect(formatException(params)).toBe('TypeError: x.padStart is not a function (main.js:1)');
  });

  it('reads the older details/exception shape', () => {
    expect(formatException({ details: { text: 'Uncaught SyntaxError: Unexpected token ...' } })).toBe(
      'Uncaught SyntaxError: Unexpected token ...',
    );
    expect(formatException({ details: { text: 'Uncaught' }, exception: { description: 'ReferenceError: x' } })).toBe('ReferenceError: x');
  });

  it('keeps JavaScript console errors and drops everything else', () => {
    const js = { message: { source: 'javascript', level: 'error', text: 'Uncaught SyntaxError: Unexpected token .', url: 'file:///a/main.js', line: 1 } };
    expect(formatConsoleError(js)).toBe('Uncaught SyntaxError: Unexpected token . (main.js:1)');
    // Tizen's $WEBAPIS/webapis/webapis.js only exists on a Samsung TV.
    expect(formatConsoleError({ message: { source: 'network', level: 'error', text: 'net::ERR_FILE_NOT_FOUND' } })).toBeNull();
    expect(formatConsoleError({ message: { source: 'console-api', level: 'log', text: 'hello' } })).toBeNull();
    expect(formatConsoleError(null)).toBeNull();
  });
});

describe('evaluateRun', () => {
  it('passes a clean run', () => {
    expect(evaluateRun(run(), engine53, 20_000)).toEqual([]);
  });

  it('fails when the engine is not the expected version', () => {
    expect(evaluateRun(run(), { major: 68 }, 20_000)).toEqual([expect.stringMatching(/reports Chrome 53 .*expected 68/)]);
  });

  it('reports a boot error without piling on follow-up failures', () => {
    const failed = run({
      boot: state({ bootError: 'Boot error: Uncaught SyntaxError: Unexpected token ...\n', ready: false, worker: null, idb: null }),
      keys: [],
      keyCount: null,
    });
    expect(evaluateRun(failed, engine53, 20_000)).toEqual(['Boot error: Uncaught SyntaxError: Unexpected token ...']);
  });

  it('reports a boot that never finished', () => {
    const stuck = run({ boot: state({ worker: 'starting…', idb: 'checking…' }), settled: false, keys: [] });
    expect(evaluateRun(stuck, engine53, 20_000)).toEqual([
      'did not finish booting within 20 s (ready=true, worker=starting…, idb=checking…)',
    ]);
  });

  it('reports worker, IndexedDB and platform problems', () => {
    const broken = run({ boot: state({ platformId: 'tizen', worker: 'failed: worker error', idb: 'failed: open threw denied' }) });
    expect(evaluateRun(broken, engine53, 20_000)).toEqual([
      'platform-id is "tizen", expected "webos"',
      'worker: failed: worker error',
      'IndexedDB in the worker: failed: open threw denied',
    ]);
  });

  it('reports keys that did not reach the app', () => {
    const deaf = run({
      keys: [
        { key: 'ArrowUp', expected: 'UP', observed: 'Press a key' },
        { key: 'Enter', expected: 'OK', observed: 'OK' },
      ],
      keyCount: '1',
    });
    expect(evaluateRun(deaf, engine53, 20_000)).toEqual(['key ArrowUp: expected intent UP, saw Press a key', 'key-count is 1, expected 2']);
  });

  it('fails on an uncaught exception even when the screen looks fine', () => {
    const noisy = run({ exceptions: ['ReferenceError: queueMicrotask is not defined (main.js:1)'], keys: [], keyCount: null });
    expect(evaluateRun(noisy, engine53, 20_000)).toEqual(['uncaught: ReferenceError: queueMicrotask is not defined (main.js:1)']);
  });

  it('fails when the page could not be read at all', () => {
    expect(evaluateRun(run({ boot: null }), engine53, 20_000)).toEqual(['the page state could not be read at all']);
  });
});
