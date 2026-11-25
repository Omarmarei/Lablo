import type { XtreamAccount } from '@lablo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_REFUSED } from './account-check';
import type { ByteResponse, ByteTransport } from './bytes';
import { NetworkError } from './bytes';
import type { StoredSource } from './profile';
import { PROBE_ANSWER_MAX, PROBE_TIMEOUT_MS, probeSource, startsPlaylist } from './source-probe';
import { fakeTransport } from './test-support';

/**
 * Settings' "Check the connection" (RELAY step 40a): each source's server asked as the app asks
 * it, never longer than the time limit, and never the URL in what comes back.
 */

const ACCOUNT: XtreamAccount = { base: 'http://panel.test:8080', username: 'u1', password: 'p 1' };
const LOGIN = 'http://panel.test:8080/player_api.php?username=u1&password=p%201';
const XTREAM: StoredSource = { id: 's1', type: 'xtream', name: 'Panel', account: ACCOUNT, added: 1 };
const GET_PHP: StoredSource = { id: 's2', type: 'm3u', name: 'Get', url: 'http://panel.test:8080/get.php?username=u1&password=p%201&type=m3u_plus', added: 1 };
const PLAIN: StoredSource = { id: 's3', type: 'm3u', name: 'List', url: 'http://lists.test/tv.m3u?key=secret', added: 1 };

function userInfo(fields: Record<string, unknown>): string {
  return JSON.stringify({ user_info: fields, server_info: { url: 'panel.test', port: '8080' } });
}

/** A clock that moves `step` ms at each read (the request's start, then its headers). */
function stepClock(step: number): () => number {
  let t = 1000;
  return () => {
    const now = t;
    t += step;
    return now;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('probeSource: a panel (RELAY step 40a)', () => {
  it("asks an Xtream source's player_api.php and keeps the status, the time and the account", async () => {
    const panel = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Active', exp_date: '1800000000', active_cons: '1', max_connections: '2' }) }));
    const probe = await probeSource(XTREAM, { transport: panel, now: stepClock(420) });
    expect(probe).toEqual({ kind: 'answered', status: 200, ms: 420, account: { auth: true, status: 'Active', expDate: 1_800_000_000, activeCons: 1, maxConnections: 2 }, playlist: null });
    expect(panel.requests.map((r) => r.url)).toEqual([LOGIN]);
  });

  it("asks the panel behind an M3U source's get.php link", async () => {
    const panel = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Expired' }) }));
    const probe = await probeSource(GET_PHP, { transport: panel, now: stepClock(30) });
    expect(probe).toMatchObject({ kind: 'answered', status: 200, ms: 30, account: { auth: true, status: 'Expired' }, playlist: null });
    expect(panel.requests.map((r) => r.url)).toEqual([LOGIN]);
  });

  it('says the login was refused for 401 and 403, and cancels the body; another error status has no account', async () => {
    for (const status of [401, 403]) {
      const panel = fakeTransport(() => ({ status, body: 'no' }));
      expect(await probeSource(XTREAM, { transport: panel, now: stepClock(5) })).toEqual({ kind: 'answered', status, ms: 5, account: LOGIN_REFUSED, playlist: null });
      expect(panel.cancelled).toBe(1);
    }
    for (const status of [199, 300, 404, 503]) {
      const panel = fakeTransport(() => ({ status, body: userInfo({ auth: 1, status: 'Active' }) }));
      expect(await probeSource(XTREAM, { transport: panel, now: stepClock(5) })).toEqual({ kind: 'answered', status, ms: 5, account: null, playlist: null });
      expect(panel.cancelled).toBe(1);
    }
  });

  it('keeps the edges of 2xx: 200 and 299 are read', async () => {
    for (const status of [200, 299]) {
      const panel = fakeTransport(() => ({ status, body: userInfo({ auth: 0 }) }));
      expect(await probeSource(XTREAM, { transport: panel, now: stepClock(5) })).toMatchObject({ kind: 'answered', status, account: { auth: false } });
    }
  });

  it('has no account for an answer that is not JSON, or has no user_info', async () => {
    const html = fakeTransport(() => ({ body: '<html>Suspended</html>' }));
    expect(await probeSource(XTREAM, { transport: html, now: stepClock(5) })).toEqual({ kind: 'answered', status: 200, ms: 5, account: null, playlist: null });
    const bare = fakeTransport(() => ({ body: '{"server_info":{}}' }));
    expect(await probeSource(XTREAM, { transport: bare, now: stepClock(5) })).toMatchObject({ account: null });
  });

  it('reads the answer across chunks, and cuts one longer than the limit', async () => {
    const chunked = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Banned' }), chunk: 7 }));
    expect(await probeSource(XTREAM, { transport: chunked, now: stepClock(5) })).toMatchObject({ account: { auth: true, status: 'Banned' } });
    expect(chunked.cancelled).toBe(0);
    const long = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Active', message: 'x'.repeat(PROBE_ANSWER_MAX) }), chunk: 4096 }));
    expect(await probeSource(XTREAM, { transport: long, now: stepClock(5) })).toMatchObject({ kind: 'answered', status: 200, account: null });
    expect(long.cancelled).toBe(1);
    // Exactly the limit is read whole.
    const body = userInfo({ auth: 1, status: 'Active', message: '' });
    const exact = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Active', message: 'x'.repeat(PROBE_ANSWER_MAX - body.length) }), chunk: 4096 }));
    expect(await probeSource(XTREAM, { transport: exact, now: stepClock(5) })).toMatchObject({ account: { auth: true, status: 'Active' } });
  });

  it('has no account when the connection breaks while the answer is read', async () => {
    const broken = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Active' }), chunk: 10, failAfter: 20 }));
    expect(await probeSource(XTREAM, { transport: broken, now: stepClock(5) })).toEqual({ kind: 'answered', status: 200, ms: 5, account: null, playlist: null });
  });
});

describe('probeSource: a plain playlist', () => {
  it('asks the link, and says whether its first bytes start a playlist', async () => {
    const list = fakeTransport(() => ({ body: '#EXTM3U\n#EXTINF:-1,One\nhttp://s.test/1.ts\n' }));
    expect(await probeSource(PLAIN, { transport: list, now: stepClock(250) })).toEqual({ kind: 'answered', status: 200, ms: 250, account: null, playlist: true });
    expect(list.requests.map((r) => r.url)).toEqual(['http://lists.test/tv.m3u?key=secret']);
    const page = fakeTransport(() => ({ body: '<!doctype html><title>Login</title>' }));
    expect(await probeSource(PLAIN, { transport: page, now: stepClock(5) })).toMatchObject({ playlist: false });
    const empty = fakeTransport(() => ({ body: '' }));
    expect(await probeSource(PLAIN, { transport: empty, now: stepClock(5) })).toMatchObject({ playlist: false });
  });

  it('reads only the first kilobyte of a long playlist, then cancels it', async () => {
    const big = fakeTransport(() => ({ body: `#EXTM3U\n${'#EXTINF:-1,Channel\nhttp://s.test/1.ts\n'.repeat(500)}`, chunk: 100 }));
    expect(await probeSource(PLAIN, { transport: big, now: stepClock(5) })).toMatchObject({ playlist: true });
    expect(big.cancelled).toBe(1);
  });

  it('has no playlist word for an error status, and a broken read is no playlist', async () => {
    const gone = fakeTransport(() => ({ status: 404, body: '#EXTM3U' }));
    expect(await probeSource(PLAIN, { transport: gone, now: stepClock(5) })).toEqual({ kind: 'answered', status: 404, ms: 5, account: null, playlist: null });
    // A playlist's 401 or 403 is no panel's refused login: it has no account.
    const refused = fakeTransport(() => ({ status: 403, body: 'no' }));
    expect(await probeSource(PLAIN, { transport: refused, now: stepClock(5) })).toEqual({ kind: 'answered', status: 403, ms: 5, account: null, playlist: null });
    const broken = fakeTransport(() => ({ body: '#EXTM3U\n#EXTINF', chunk: 4, failAfter: 8 }));
    expect(await probeSource(PLAIN, { transport: broken, now: stepClock(5) })).toMatchObject({ status: 200, playlist: false });
  });
});

describe('probeSource: no server, no answer, and the time limit', () => {
  it('asks nothing for a file from the phone or a source without its login', async () => {
    const none = fakeTransport(() => ({ body: '' }));
    const now = vi.fn(() => 0);
    expect(await probeSource({ id: 'f', type: 'm3u-file', name: 'File', added: 1 }, { transport: none, now })).toEqual({ kind: 'file' });
    expect(await probeSource({ id: 'x', type: 'xtream', name: 'X', account: null, base: 'http://panel.test', added: 1 }, { transport: none, now })).toEqual({ kind: 'no-login' });
    expect(await probeSource({ id: 'm', type: 'm3u', name: 'M', url: null, origin: 'http://lists.test', added: 1 }, { transport: none, now })).toEqual({ kind: 'no-login' });
    expect(none.requests).toEqual([]);
    expect(now).not.toHaveBeenCalled();
  });

  it('is unreachable when the connection fails, without the URL', async () => {
    const down: ByteTransport = { get: () => Promise.reject(new NetworkError()) };
    const probe = await probeSource(XTREAM, { transport: down, now: stepClock(5) });
    expect(probe).toEqual({ kind: 'unreachable' });
    // A transport that throws something else is unreachable too: the probe never rejects.
    const odd: ByteTransport = {
      get: () => {
        throw new Error('http://panel.test:8080 u1');
      },
    };
    expect(await probeSource(PLAIN, { transport: odd, now: stepClock(5) })).toEqual({ kind: 'unreachable' });
  });

  it('times out without headers, and cancels headers that come after the time', async () => {
    vi.useFakeTimers();
    let answer: ((res: ByteResponse) => void) | null = null;
    const slow: ByteTransport = {
      get: () =>
        new Promise<ByteResponse>((resolve) => {
          answer = resolve;
        }),
    };
    const probe = probeSource(XTREAM, { transport: slow, now: () => 0, timeoutMs: 3000 });
    let result: unknown = null;
    void probe.then((p) => (result = p));
    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ kind: 'timeout' });
    const cancel = vi.fn();
    answer!({ status: 200, header: () => null, read: () => Promise.resolve(null), cancel });
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('waits PROBE_TIMEOUT_MS by default', async () => {
    vi.useFakeTimers();
    const never: ByteTransport = { get: () => new Promise<ByteResponse>(() => undefined) };
    let result: unknown = null;
    void probeSource(PLAIN, { transport: never, now: () => 0 }).then((p) => (result = p));
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('cuts a body still coming at the time limit, and answers with what it read', async () => {
    vi.useFakeTimers();
    let cancelled = 0;
    let release: (() => void) | null = null;
    const stalled: ByteTransport = {
      get: () => {
        let done = false;
        let sent = false;
        return Promise.resolve<ByteResponse>({
          status: 200,
          header: () => null,
          read: () => {
            if (done) return Promise.resolve(null);
            if (!sent) {
              sent = true;
              return Promise.resolve(new TextEncoder().encode('{"user_info":{"auth":1,'));
            }
            return new Promise<Uint8Array | null>((resolve) => {
              release = () => resolve(null);
            });
          },
          cancel: () => {
            cancelled++;
            done = true;
            release?.();
          },
        });
      },
    };
    let result: unknown = null;
    void probeSource(XTREAM, { transport: stalled, now: stepClock(40), timeoutMs: 2000 }).then((p) => (result = p));
    await vi.advanceTimersByTimeAsync(1999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ kind: 'answered', status: 200, ms: 40, account: null, playlist: null });
    expect(cancelled).toBe(1);
  });

  it('clears its timer once answered', async () => {
    vi.useFakeTimers();
    const panel = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Active' }) }));
    await probeSource(XTREAM, { transport: panel, now: stepClock(5) });
    expect(vi.getTimerCount()).toBe(0);
    const down: ByteTransport = { get: () => Promise.reject(new NetworkError()) };
    await probeSource(XTREAM, { transport: down, now: stepClock(5) });
    expect(vi.getTimerCount()).toBe(0);
    // Anything else that fails while asking (here the clock) is unreachable too, its timer cleared.
    const broken = (): number => {
      throw new Error('no clock');
    };
    expect(await probeSource(XTREAM, { transport: panel, now: broken })).toEqual({ kind: 'unreachable' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never holds the URL or the login in what it answers', async () => {
    const answers = await Promise.all([
      probeSource(XTREAM, { transport: fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Active' }) })), now: stepClock(5) }),
      probeSource(PLAIN, { transport: fakeTransport(() => ({ body: '#EXTM3U' })), now: stepClock(5) }),
      probeSource(PLAIN, { transport: { get: () => Promise.reject(new NetworkError()) }, now: stepClock(5) }),
    ]);
    expect(JSON.stringify(answers)).not.toMatch(/panel\.test|lists\.test|u1|secret/);
  });
});

describe('startsPlaylist', () => {
  it('takes #EXT in any case past a byte-order mark and blank space', () => {
    expect(startsPlaylist('#EXTM3U')).toBe(true);
    expect(startsPlaylist('#extinf:-1,One')).toBe(true);
    expect(startsPlaylist(`${String.fromCharCode(0xfeff)} \t\r\n#EXTM3U`)).toBe(true);
    expect(startsPlaylist('#EX')).toBe(false);
    expect(startsPlaylist('x#EXTM3U')).toBe(false);
    expect(startsPlaylist('<html>')).toBe(false);
    expect(startsPlaylist('')).toBe(false);
    expect(startsPlaylist('   ')).toBe(false);
  });
});
