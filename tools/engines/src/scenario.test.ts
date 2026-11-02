import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import type { DataCheck } from './fixture';
import type { PageState, PlatformRun } from './scenario';
import { KEY_STEPS, STATE_EXPRESSION, evaluateRun, formatConsoleError, formatException, isSettled } from './scenario';

const URL = 'file:///app/app/webos/index.html';
const UA53 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';
const CHECK: DataCheck = { file: 'playlist.m3u.gz', query: 'اخبار', items: 3000, total: 240, gzip: true };

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
    data: 'ok: 1 source, 3000 items',
    ingest: 'ok: committed gen 1, 3000 items (live 2400, movie 600), gzip, 840 ms',
    ingestItems: '3000',
    gzip: 'true',
    search: 'ok: 240 for "اخبار": أخبار زوما 10, أخبار زوما 20, أخبار زوما 30',
    searchTotal: '240',
    ...overrides,
  };
}

function run(overrides: Partial<PlatformRun> = {}): PlatformRun {
  return {
    platform: 'webos',
    url: URL,
    data: CHECK,
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

  it('with a data check, also waits for the refresh and the search', () => {
    expect(isSettled(state(), URL, CHECK)).toBe(true);
    expect(isSettled(state({ ingest: 'running: 120 KB, 1500 items', search: 'waiting…' }), URL, CHECK)).toBe(false);
    expect(isSettled(state({ ingest: 'running: 120 KB, 1500 items', search: 'waiting…' }), URL)).toBe(true);
    expect(isSettled(state({ search: 'running…' }), URL, CHECK)).toBe(false);
    expect(isSettled(state({ data: 'starting…', ingest: 'waiting…', search: 'waiting…' }), URL, CHECK)).toBe(false);
    expect(isSettled(state({ data: null, ingest: null, search: null }), URL, CHECK)).toBe(false);
    const failed = { data: 'failed: denied', ingest: 'failed: no data workers', search: 'failed: no data workers' };
    expect(isSettled(state(failed), URL, CHECK)).toBe(true);
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
    const stuck = run({ data: null, boot: state({ worker: 'starting…', idb: 'checking…' }), settled: false, keys: [] });
    expect(evaluateRun(stuck, engine53, 20_000)).toEqual([
      'did not finish booting within 20 s (ready=true, worker=starting…, idb=checking…)',
    ]);
    const slow = run({ boot: state({ ingest: 'running: 40 KB, 1000 items', search: 'waiting…' }), settled: false, keys: [] });
    expect(evaluateRun(slow, engine53, 20_000)).toEqual([
      'did not finish booting within 20 s (ready=true, worker=ok in 12 ms (TextDecoder, indexedDB, fetch), idb=ok, ' +
        'data=ok: 1 source, 3000 items, refresh=running: 40 KB, 1000 items, search=waiting…)',
    ]);
  });

  it('reports data workers that did not start, once', () => {
    const dead = run({ boot: state({ data: 'failed: Query worker failed: denied', ingest: 'failed: no data workers', search: 'failed: no data workers' }) });
    expect(evaluateRun(dead, engine53, 20_000)).toEqual(['data workers: failed: Query worker failed: denied']);
  });

  it('reports a refresh that failed or committed the wrong catalog', () => {
    const failed = run({ boot: state({ ingest: 'failed: Catalog refresh failed: network', ingestItems: '', gzip: 'false' }) });
    expect(evaluateRun(failed, engine53, 20_000)).toEqual(['refresh of playlist.m3u.gz: failed: Catalog refresh failed: network']);
    const unchanged = run({ boot: state({ ingest: 'ok: unchanged gen 1, 3000 items (live 2400, movie 600), 20 ms' }) });
    expect(evaluateRun(unchanged, engine53, 20_000)).toEqual([
      'refresh of playlist.m3u.gz: ok: unchanged gen 1, 3000 items (live 2400, movie 600), 20 ms',
    ]);
    const short = run({ boot: state({ ingestItems: '2500', gzip: 'false' }) });
    expect(evaluateRun(short, engine53, 20_000)).toEqual([
      'refresh of playlist.m3u.gz committed 2500 items, expected 3000',
      'refresh of playlist.m3u.gz: gzip false, expected true',
    ]);
  });

  it('reports a search that failed or counted wrong', () => {
    const failed = run({ boot: state({ search: 'failed: RpcError: closed', searchTotal: '' }) });
    expect(evaluateRun(failed, engine53, 20_000)).toEqual(['search "اخبار": failed: RpcError: closed']);
    // A query worker that never reloaded after the swap finds nothing.
    const stale = run({ boot: state({ search: 'ok: 0 for "اخبار"', searchTotal: '0' }) });
    expect(evaluateRun(stale, engine53, 20_000)).toEqual(['search "اخبار" found 0, expected 240']);
  });

  it('skips the data checks for a run without one', () => {
    expect(evaluateRun(run({ data: null, boot: state({ data: null, ingest: null, search: null }) }), engine53, 20_000)).toEqual([]);
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
