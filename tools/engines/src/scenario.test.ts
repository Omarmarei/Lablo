import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import type { DataCheck } from './fixture';
import type { PageState, PlatformRun } from './scenario';
import { KEY_STEPS, STATE_EXPRESSION, evaluateRun, fontsSettled, formatConsoleError, formatException, isSettled } from './scenario';

const URL = 'file:///app/app/webos/index.html';
const UA53 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';
const CHECK: DataCheck = { file: 'playlist.m3u.gz', query: 'اخبار', items: 3000, live: 2400, movies: 600, total: 240, gzip: true, guide: 'guide.xml.gz', epgMatched: 300, epgWanted: 2400 };

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
    focus: 'details · buttons 0',
    data: 'ok: 1 source, 3000 items',
    ingest: 'ok: committed gen 1, 3000 items (live 2400, movie 600), gzip, 840 ms',
    ingestItems: '3000',
    gzip: 'true',
    search: 'ok: 240 for "اخبار": أخبار زوما 10, أخبار زوما 20, أخبار زوما 30',
    searchTotal: '240',
    epg: 'ok: 300 of 2400 live channels have a guide (12.5%), 1 guide',
    epgMatched: '300',
    epgWanted: '2400',
    nowNext: 'ok: Zoma Channel 1: fixture.1 20h 20:00–21:00, next fixture.1 21h 21:00',
    fontsStatus: 'loaded',
    fonts: 'la400:loaded la700:loaded ar400:unloaded ar700:loaded',
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
    keys: KEY_STEPS.map((step) => ({
      key: step.key,
      expected: step.intent,
      observed: step.intent,
      expectedFocus: step.focus,
      focus: step.focus,
    })),
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
    expect(isSettled(state({ fontsStatus: 'loading' }), URL)).toBe(false);
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
    expect(isSettled(state({ ...failed, epg: 'waiting…', nowNext: 'waiting…' }), URL, CHECK)).toBe(true);
  });

  it('with a data check, also waits for the guide and now/next', () => {
    expect(isSettled(state({ epg: 'running: 120 KB, 900 programmes', nowNext: 'waiting…' }), URL, CHECK)).toBe(false);
    expect(isSettled(state({ nowNext: 'waiting…' }), URL, CHECK)).toBe(false);
    expect(isSettled(state({ epg: 'running…' }), URL)).toBe(true);
    expect(isSettled(state({ epg: 'none: no guide stored (the playlist names none)', nowNext: 'none: no channel here has programmes now' }), URL, CHECK)).toBe(true);
  });
});

describe('fontsSettled', () => {
  it('waits until a Latin and an Arabic face have each loaded or failed', () => {
    expect(fontsSettled('la400:loaded la700:unloaded ar400:loaded ar700:unloaded')).toBe(true);
    expect(fontsSettled('la400:loaded ar400:error')).toBe(true);
    expect(fontsSettled('la400:loaded la700:loading ar400:loaded')).toBe(false);
    expect(fontsSettled('la400:loaded ar400:unloaded ar700:unloaded')).toBe(false);
    expect(fontsSettled('la400:unloaded ar400:loaded')).toBe(false);
    expect(fontsSettled('')).toBe(false);
  });

  it('has nothing to wait for without document.fonts', () => {
    expect(fontsSettled(null)).toBe(true);
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

  it('reports a guide that failed, matched wrong, or gave no now/next', () => {
    const failed = run({ boot: state({ epg: 'failed: debug:tvg0 format', epgMatched: '', epgWanted: '' }) });
    expect(evaluateRun(failed, engine53, 20_000)).toEqual(['guide guide.xml.gz: failed: debug:tvg0 format']);
    const wrong = run({ boot: state({ epgMatched: '299' }) });
    expect(evaluateRun(wrong, engine53, 20_000)).toEqual(['guide guide.xml.gz matched 299 of 2400, expected 300 of 2400']);
    const none = run({ boot: state({ epg: 'none: no guide stored (the playlist names none)', nowNext: 'none: no channel here has programmes now' }) });
    expect(evaluateRun(none, engine53, 20_000)).toEqual(['guide guide.xml.gz: none: no guide stored (the playlist names none)', 'now/next: none: no channel here has programmes now']);
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

  it('reports fonts that failed, did not load, or cannot be read', () => {
    expect(evaluateRun(run({ boot: state({ fonts: 'la400:loaded la700:error ar400:unloaded ar700:loaded' }) }), engine53, 15_000)).toEqual([
      'fonts: la700:error failed to load',
    ]);
    expect(evaluateRun(run({ boot: state({ fonts: 'la400:loaded la700:loaded ar400:unloaded ar700:unloaded' }) }), engine53, 15_000)).toEqual([
      'fonts: no Arabic Zoma Sans face loaded (la400:loaded la700:loaded ar400:unloaded ar700:unloaded)',
    ]);
    expect(evaluateRun(run({ boot: state({ fonts: '' }) }), engine53, 15_000)).toEqual([
      'fonts: no Latin Zoma Sans face loaded (no faces)',
      'fonts: no Arabic Zoma Sans face loaded (no faces)',
    ]);
    expect(evaluateRun(run({ boot: state({ fonts: null, fontsStatus: null }) }), engine53, 15_000)).toEqual(['fonts: document.fonts is missing']);
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
        { key: 'ArrowUp', expected: 'UP', observed: 'Press a key', expectedFocus: 'home · rail 0', focus: 'home · list 0' },
        { key: 'Enter', expected: 'OK', observed: 'OK', expectedFocus: 'details · buttons 0', focus: 'details · buttons 0' },
      ],
      keyCount: '1',
    });
    expect(evaluateRun(deaf, engine53, 20_000)).toEqual(['key ArrowUp: expected intent UP, saw Press a key', 'key-count is 1, expected 2']);
  });

  it('reports keys the focus engine did not act on', () => {
    const stuck = run({
      keys: [
        { key: 'ArrowUp', expected: 'UP', observed: 'UP', expectedFocus: 'home · rail 0', focus: 'home · list 0' },
        { key: 'Enter', expected: 'OK', observed: 'OK', expectedFocus: 'details · buttons 0', focus: null },
      ],
    });
    expect(evaluateRun(stuck, engine53, 20_000)).toEqual([
      'key ArrowUp: expected focus "home · rail 0", saw "home · list 0"',
      'key Enter: expected focus "details · buttons 0", saw "nothing"',
    ]);
  });

  it('fails on an uncaught exception even when the screen looks fine', () => {
    const noisy = run({ exceptions: ['ReferenceError: queueMicrotask is not defined (main.js:1)'], keys: [], keyCount: null });
    expect(evaluateRun(noisy, engine53, 20_000)).toEqual(['uncaught: ReferenceError: queueMicrotask is not defined (main.js:1)']);
  });

  it('fails when the page could not be read at all', () => {
    expect(evaluateRun(run({ boot: null }), engine53, 20_000)).toEqual(['the page state could not be read at all']);
  });
});
