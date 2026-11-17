import { boxKeyPairFromSecretKey, openPairPayload, sealPairPayload, toBase64Url } from '@lablo/crypto';
import type { PairProgressResponse } from '@lablo/protocol';
import { pairPayloadSchema } from '@lablo/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, Fetcher, PhoneApi } from '../src/phone/api';
import { createApi, DEFAULT_RETRY_AFTER_S, retryAfterSeconds } from '../src/phone/api';
import { send, startQr, submitCode } from '../src/phone/flows';
import type { Timers } from '../src/phone/progress';
import { isFinal, pollProgress, PROGRESS_POLL_MS } from '../src/phone/progress';
import type { PageEvent, PageState } from '../src/phone/state';
import { initialState, reduce } from '../src/phone/state';

/** The phone page's requests (RELAY step 31b): the API, the flows behind its actions, the progress poll. */

const TV = boxKeyPairFromSecretKey(new Uint8Array(32).fill(9));
const KEY = toBase64Url(TV.publicKey);
const CODE = '7K3MQ9XD';
const SEALED = { phonePk: KEY, nonce: 'A'.repeat(32), ct: 'A'.repeat(22) };

function answer(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

describe('createApi', () => {
  function api(response: Response | Error): { api: PhoneApi; calls: [string, RequestInit][] } {
    const calls: [string, RequestInit][] = [];
    const fetcher: Fetcher = (path, init) => {
      calls.push([path, init]);
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    };
    return { api: createApi(fetcher), calls };
  }

  it('asks its own origin, by relative paths, for exactly three things', async () => {
    const key = api(answer(200, { tvPk: KEY, exp: 5 }));
    expect(await key.api.tvKey(CODE)).toEqual({ ok: true, value: { tvPk: KEY, exp: 5 } });
    const sent = api(answer(200, { state: 'sent' }));
    expect(await sent.api.send(CODE, SEALED)).toEqual({ ok: true, value: { state: 'sent' } });
    const progress = api(answer(200, { state: 'done', status: 'blocked' }));
    expect(await progress.api.progress(CODE)).toEqual({ ok: true, value: { state: 'done', status: 'blocked' } });
    const quiet = { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' };
    expect(key.calls).toEqual([[`/v1/pair/${CODE}`, { method: 'GET', ...quiet }]]);
    expect(sent.calls).toEqual([[`/v1/pair/${CODE}/payload`, { method: 'POST', ...quiet, headers: { 'content-type': 'application/json' }, body: JSON.stringify(SEALED) }]]);
    expect(progress.calls).toEqual([[`/v1/pair/${CODE}/status`, { method: 'GET', ...quiet }]]);
  });

  it('puts only a well-formed code in a path', () => {
    const { api: a, calls } = api(answer(200, {}));
    for (const code of ['7k3mq9xd', '../../v1', 'ABCDEFGU', 'ABCDEFG', `${CODE}/x`]) {
      expect(() => a.tvKey(code)).toThrow(RangeError);
      expect(() => a.progress(code)).toThrow(RangeError);
      expect(() => a.send(code, SEALED)).toThrow(RangeError);
    }
    expect(calls).toEqual([]);
  });

  it.each([
    [answer(404, { error: 'not_found' }), { ok: false, error: 'gone' }],
    [answer(409, { error: 'conflict' }), { ok: false, error: 'conflict' }],
    [answer(429, { error: 'rate_limited' }, { 'retry-after': '125' }), { ok: false, error: 'limited', retryAfterS: 125 }],
    [answer(429, { error: 'rate_limited' }), { ok: false, error: 'limited', retryAfterS: DEFAULT_RETRY_AFTER_S }],
    [answer(503, { error: 'unavailable' }), { ok: false, error: 'network' }],
    [answer(400, { error: 'bad_request' }), { ok: false, error: 'network' }],
    // An error status never counts, whatever its body says.
    [answer(500, { state: 'sent' }), { ok: false, error: 'network' }],
    [answer(302, { state: 'sent' }), { ok: false, error: 'network' }],
    [answer(200, 'not json'), { ok: false, error: 'network' }],
    [answer(200, { state: 'later' }), { ok: false, error: 'network' }],
    [answer(200, { state: 'done', status: 'maybe' }), { ok: false, error: 'network' }],
    [new TypeError('Failed to fetch'), { ok: false, error: 'network' }],
  ])('reads %#', async (response, result) => {
    expect(await api(response).api.progress(CODE)).toEqual(result);
  });

  it('reads a key answer with its schema', async () => {
    expect(await api(answer(200, { tvPk: 'short', exp: 5 })).api.tvKey(CODE)).toEqual({ ok: false, error: 'network' });
    expect(await api(answer(201, { tvPk: KEY, exp: 5 })).api.tvKey(CODE)).toEqual({ ok: true, value: { tvPk: KEY, exp: 5 } });
  });

  it.each([
    ['125', 125],
    ['0.2', 1],
    ['0', 1],
    ['599.5', 600],
    [' 30 ', 30],
    [null, DEFAULT_RETRY_AFTER_S],
    ['', DEFAULT_RETRY_AFTER_S],
    ['soon', DEFAULT_RETRY_AFTER_S],
    ['-5', DEFAULT_RETRY_AFTER_S],
    ['Infinity', DEFAULT_RETRY_AFTER_S],
  ])('reads Retry-After %j as %i s', (header, seconds) => {
    expect(retryAfterSeconds(header)).toBe(seconds);
  });

  it('calls the browser’s fetch by default', async () => {
    const fetch = vi.fn(() => Promise.resolve(answer(200, { state: 'sent' })));
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await createApi().progress(CODE)).toEqual({ ok: true, value: { state: 'sent' } });
      expect(fetch).toHaveBeenCalledWith(`/v1/pair/${CODE}/status`, expect.objectContaining({ method: 'GET' }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** A fake API whose answers the test gives, and a log of its calls. */
function fakeApi(answers: Partial<Record<keyof PhoneApi, ApiResult<unknown>>>): { api: PhoneApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const reply = (name: keyof PhoneApi) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    const result = answers[name];
    if (result === undefined) throw new Error(`unexpected ${name}`);
    return Promise.resolve(result as never);
  };
  return { api: { tvKey: reply('tvKey'), send: reply('send'), progress: reply('progress') }, calls };
}

/** Runs a flow against the real reducer, keeping each event. */
function driver(state: PageState): { state: () => PageState; events: PageEvent[]; dispatch: (event: PageEvent) => void } {
  let current = state;
  const events: PageEvent[] = [];
  return {
    state: () => current,
    events,
    dispatch: (event) => {
      events.push(event);
      current = reduce(current, event);
    },
  };
}

const codeView = reduce(initialState('en'), { type: 'start' });

describe('submitCode', () => {
  it('asks for the typed code’s key and shows the form', async () => {
    const { api, calls } = fakeApi({ tvKey: { ok: true, value: { tvPk: KEY, exp: 5 } } });
    const d = driver(reduce(codeView, { type: 'codeInput', input: '7k3m-q9xd' }));
    await submitCode(d.state(), { api, dispatch: d.dispatch });
    expect(calls).toEqual([['tvKey', CODE]]);
    expect(d.state().view).toEqual({ kind: 'form', target: { code: CODE, tvPk: KEY }, busy: false, error: null, retryAfterS: 0 });
  });

  it('asks nothing for a malformed code, or while asking', async () => {
    const { api, calls } = fakeApi({});
    const d = driver(reduce(codeView, { type: 'codeInput', input: 'abc' }));
    await submitCode(d.state(), { api, dispatch: d.dispatch });
    expect(d.state().view).toMatchObject({ kind: 'code', error: 'format' });
    const busy = driver(reduce(reduce(codeView, { type: 'codeInput', input: CODE }), { type: 'codeSubmit' }));
    await submitCode(busy.state(), { api, dispatch: busy.dispatch });
    expect(busy.events).toEqual([]);
    await submitCode(initialState('en'), { api, dispatch: busy.dispatch });
    expect(calls).toEqual([]);
  });
});

describe('startQr', () => {
  it('asks only for the progress: the key is the QR link’s', async () => {
    const { api, calls } = fakeApi({ progress: { ok: true, value: { state: 'open', exp: 5 } } });
    const d = driver(initialState('ar'));
    await startQr({ code: CODE, tvPk: KEY }, { api, dispatch: d.dispatch });
    expect(calls).toEqual([['progress', CODE]]);
    expect(d.state().view).toEqual({ kind: 'form', target: { code: CODE, tvPk: KEY }, busy: false, error: null, retryAfterS: 0 });
  });
});

describe('send', () => {
  const formView = reduce(reduce(initialState('en'), { type: 'qr', target: { code: CODE, tvPk: KEY } }), {
    type: 'progressAnswer',
    code: CODE,
    result: { ok: true, value: { state: 'open', exp: 5 } },
  });
  const filled = [
    { type: 'sourceType', sourceType: 'm3u' },
    { type: 'field', key: 'playlist', value: ' Lists.example/a.m3u ' },
    { type: 'field', key: 'name', value: 'Salon' },
  ] as const satisfies readonly PageEvent[];
  const ready = filled.reduce<PageState>(reduce, formView);

  it('seals the checked payload to the TV’s key, in the browser, and posts it', async () => {
    const { api, calls } = fakeApi({ send: { ok: true, value: { state: 'sent' } } });
    const d = driver(ready);
    await send(d.state(), { api, dispatch: d.dispatch });
    expect(calls).toHaveLength(1);
    const [name, code, sealed] = calls[0] as [string, string, Parameters<typeof openPairPayload>[0]];
    expect([name, code]).toEqual(['send', CODE]);
    const plain = openPairPayload(sealed, TV.secretKey);
    expect(pairPayloadSchema.parse(JSON.parse(new TextDecoder().decode(plain!)))).toEqual({ v: 1, source: { type: 'm3u', url: 'http://lists.example/a.m3u' }, name: 'Salon' });
    expect(d.state().view).toEqual({ kind: 'progress', code: CODE, state: 'sent' });
  });

  it('uses the given seal: fresh keys per payload by default', async () => {
    const seal = vi.fn((plain: Uint8Array, tvPk: Uint8Array) => sealPairPayload(plain, tvPk));
    const { api } = fakeApi({ send: { ok: true, value: { state: 'sent' } } });
    const d = driver(ready);
    await send(d.state(), { api, dispatch: d.dispatch, seal });
    expect(seal).toHaveBeenCalledTimes(1);
    expect(seal.mock.calls[0]![1]).toEqual(TV.publicKey);
  });

  it('posts nothing when the form has problems, or while sending', async () => {
    const { api, calls } = fakeApi({});
    const d = driver(formView);
    await send(d.state(), { api, dispatch: d.dispatch });
    expect(d.state()).toMatchObject({ showProblems: true, problems: { server: 'required' } });
    const busy = driver(reduce(ready, { type: 'send' }));
    await send(busy.state(), { api, dispatch: busy.dispatch });
    expect(busy.events).toEqual([]);
    await send(codeView, { api, dispatch: busy.dispatch });
    expect(calls).toEqual([]);
  });
});

describe('pollProgress', () => {
  /** Timers the test runs by hand. */
  function manualTimers(): Timers & { pending: { callback: () => void; ms: number }[]; cleared: unknown[] } {
    const pending: { callback: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    return {
      pending,
      cleared,
      setTimeout: (callback, ms) => {
        const entry = { callback, ms };
        pending.push(entry);
        return entry;
      },
      clearTimeout: (handle) => {
        cleared.push(handle);
        pending.splice(pending.indexOf(handle as never), 1);
      },
    };
  }

  function scripted(results: ApiResult<PairProgressResponse>[]): { api: Pick<PhoneApi, 'progress'>; codes: string[]; release: () => Promise<void> } {
    const codes: string[] = [];
    let waiting: (() => void) | null = null;
    return {
      codes,
      api: {
        progress: (code) => {
          codes.push(code);
          const result = results.shift()!;
          return new Promise((resolve) => {
            waiting = () => resolve(result);
          });
        },
      },
      release: async () => {
        waiting?.();
        waiting = null;
        await Promise.resolve();
        await Promise.resolve();
      },
    };
  }

  it('reads every 2 s, one read at a time, until the TV’s status', async () => {
    const timers = manualTimers();
    const { api, codes, release } = scripted([
      { ok: true, value: { state: 'sent' } },
      { ok: false, error: 'network' },
      { ok: true, value: { state: 'received' } },
      { ok: true, value: { state: 'done', status: 'ok' } },
    ]);
    const answers: ApiResult<PairProgressResponse>[] = [];
    pollProgress(CODE, api, (result) => answers.push(result), timers);
    expect(PROGRESS_POLL_MS).toBe(2000);
    expect(timers.pending.map((p) => p.ms)).toEqual([2000]);
    expect(codes).toEqual([]);
    for (let read = 1; read <= 4; read++) {
      timers.pending.shift()!.callback();
      expect(codes).toHaveLength(read);
      // The next read waits for this answer.
      expect(timers.pending).toEqual([]);
      await release();
    }
    expect(codes).toEqual([CODE, CODE, CODE, CODE]);
    expect(answers.map((a) => (a.ok ? a.value.state : a.error))).toEqual(['sent', 'network', 'received', 'done']);
    expect(timers.pending).toEqual([]);
  });

  it('stops when the code’s row is gone', async () => {
    const timers = manualTimers();
    const { api, release } = scripted([{ ok: false, error: 'gone' }]);
    const answers: unknown[] = [];
    pollProgress(CODE, api, (result) => answers.push(result), timers);
    timers.pending.shift()!.callback();
    await release();
    expect(answers).toEqual([{ ok: false, error: 'gone' }]);
    expect(timers.pending).toEqual([]);
  });

  it('stops when told: the timer cleared, an answer on its way dropped', async () => {
    const timers = manualTimers();
    const waitingStop = pollProgress(CODE, scripted([]).api, () => undefined, timers);
    const handle = timers.pending[0];
    waitingStop();
    expect(timers.cleared).toEqual([handle]);
    expect(timers.pending).toEqual([]);

    const busy = manualTimers();
    const { api, release } = scripted([{ ok: true, value: { state: 'received' } }]);
    const answers: unknown[] = [];
    const stop = pollProgress(CODE, api, (result) => answers.push(result), busy);
    busy.pending.shift()!.callback();
    stop();
    expect(busy.cleared).toEqual([]);
    await release();
    expect(answers).toEqual([]);
    expect(busy.pending).toEqual([]);
  });

  it('uses the browser’s timers by default', async () => {
    vi.useFakeTimers();
    try {
      const progress = vi.fn(() => Promise.resolve<ApiResult<PairProgressResponse>>({ ok: true, value: { state: 'done', status: 'ok' } }));
      const answers: unknown[] = [];
      const stop = pollProgress(CODE, { progress }, (result) => answers.push(result));
      await vi.advanceTimersByTimeAsync(1999);
      expect(progress).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(answers).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(progress).toHaveBeenCalledTimes(1);
      stop();
      const again = pollProgress(CODE, { progress }, () => undefined);
      again();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(progress).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('knows which answers end it', () => {
    expect(isFinal({ ok: true, value: { state: 'done', status: 'auth_failed' } })).toBe(true);
    expect(isFinal({ ok: false, error: 'gone' })).toBe(true);
    expect(isFinal({ ok: true, value: { state: 'received' } })).toBe(false);
    expect(isFinal({ ok: true, value: { state: 'open', exp: 1 } })).toBe(false);
    expect(isFinal({ ok: false, error: 'network' })).toBe(false);
    expect(isFinal({ ok: false, error: 'limited', retryAfterS: 5 })).toBe(false);
    expect(isFinal({ ok: false, error: 'conflict' })).toBe(false);
  });
});
