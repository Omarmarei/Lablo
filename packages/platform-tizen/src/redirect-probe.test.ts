import { describe, expect, it } from 'vitest';
import { FakeXhr, settle } from './fake-avplay';
import type { RedirectMemory } from './redirect-probe';
import { MemoryRedirectMemory, PROBE_TIMEOUT_MS, createRedirectProbe } from './redirect-probe';

const URL1 = 'http://panel.example/live/u/p/1.ts';
const FINAL = 'http://edge7.example/hls/1.ts?token=abc';

/** A probe whose XHRs the test answers, with the memory it keeps. */
function rig(timeoutMs?: number) {
  const xhrs: FakeXhr[] = [];
  const memory = new MemoryRedirectMemory();
  const resolve = createRedirectProbe({
    memory,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    createXhr: () => {
      const xhr = new FakeXhr();
      xhrs.push(xhr);
      return xhr;
    },
  });
  return { xhrs, memory, resolve, last: (): FakeXhr => xhrs[xhrs.length - 1]! };
}

/** How a probe settles. */
function watch(p: Promise<string>): { value: string | null; error: unknown } {
  const o: { value: string | null; error: unknown } = { value: null, error: null };
  p.then(
    (v) => {
      o.value = v;
    },
    (e: unknown) => {
      o.error = e;
    },
  );
  return o;
}

describe('the redirect probe (RELAY step 19)', () => {
  it('follows the redirects to the final URL, aborting at the headers, and marks the source', async () => {
    const r = rig();
    const answer = watch(r.resolve(URL1, 's1', false));
    expect(r.last().log).toEqual(['open GET ' + URL1 + ' true', 'send timeout=' + String(PROBE_TIMEOUT_MS)]);
    r.last().headers(200, FINAL);
    await settle();
    expect(answer.value).toBe(FINAL);
    expect(r.last().log[r.last().log.length - 1]).toBe('abort');
    expect(r.memory.mode('s1')).toBe('redirects');
  });

  it('probes a redirecting source before every play: the target may carry a short-lived token', async () => {
    const r = rig();
    void r.resolve(URL1, 's1', false);
    r.last().headers(200, FINAL);
    await settle();
    const again = watch(r.resolve(URL1, 's1', false));
    expect(r.xhrs).toHaveLength(2);
    r.last().headers(200, FINAL + '2');
    await settle();
    expect(again.value).toBe(FINAL + '2');
  });

  it('marks a source that does not redirect, and skips the probe for it from then on unless asked afresh', async () => {
    const r = rig();
    const first = watch(r.resolve(URL1, 's1', false));
    r.last().headers(200, URL1);
    await settle();
    expect(first.value).toBe(URL1);
    expect(r.memory.mode('s1')).toBe('none');
    const skipped = watch(r.resolve('http://panel.example/live/u/p/2.ts', 's1', false));
    await settle();
    expect(skipped.value).toBe('http://panel.example/live/u/p/2.ts');
    expect(r.xhrs).toHaveLength(1);
    // Another source is still unknown.
    void r.resolve('http://other.example/1.ts', 's2', false);
    expect(r.xhrs).toHaveLength(2);
    // The ladder's re-probe rung asks afresh, and finds the redirect the panel started.
    const fresh = watch(r.resolve(URL1, 's1', true));
    expect(r.xhrs).toHaveLength(3);
    r.last().headers(200, FINAL);
    await settle();
    expect(fresh.value).toBe(FINAL);
    expect(r.memory.mode('s1')).toBe('redirects');
  });

  it('takes the URL itself when the engine gives no responseURL', async () => {
    const r = rig();
    const answer = watch(r.resolve(URL1, 's1', false));
    r.last().headers(200, '');
    await settle();
    expect(answer.value).toBe(URL1);
    expect(r.memory.mode('s1')).toBe('none');
  });

  it("rejects an error status as the provider's HTTP error, and remembers nothing", async () => {
    for (const status of [400, 404, 509]) {
      const r = rig();
      const answer = watch(r.resolve(URL1, 's1', false));
      r.last().headers(status, FINAL);
      await settle();
      expect(answer.error, String(status)).toEqual({ kind: 'http', code: 'PROBE_HTTP', status });
      expect(r.memory.mode('s1')).toBe('unknown');
    }
    // 3xx never reaches the page (XHR follows it), and the last 2xx/3xx status is an answer.
    const r = rig();
    const ok = watch(r.resolve(URL1, 's1', false));
    r.last().headers(399, FINAL);
    await settle();
    expect(ok.value).toBe(FINAL);
  });

  it('gives the URL as it is without an answer: a network error, the timeout, status 0, a refused open', async () => {
    const cases: Array<[string, (xhr: FakeXhr) => void]> = [
      ['error', (xhr) => xhr.fail()],
      ['timeout', (xhr) => xhr.timesOut()],
      ['status 0', (xhr) => xhr.headers(0, FINAL)],
    ];
    for (const [name, answer] of cases) {
      const r = rig(1234);
      const probe = watch(r.resolve(URL1, 's1', false));
      expect(r.last().timeout, name).toBe(1234);
      answer(r.last());
      await settle();
      expect(probe.value, name).toBe(URL1);
      expect(r.memory.mode('s1'), name).toBe('unknown');
    }
    const refused = rig();
    const xhr = new FakeXhr();
    xhr.openThrows = new Error('SecurityError');
    const probe = watch(createRedirectProbe({ memory: refused.memory, createXhr: () => xhr })(URL1, 's1', false));
    await settle();
    expect(probe.value).toBe(URL1);
  });

  it('answers once: states before the headers wait, and the abort and later events change nothing', async () => {
    const r = rig();
    const memory: RedirectMemory = { mode: () => 'unknown', remember: (src, mode) => remembered.push(src + '=' + mode) };
    const remembered: string[] = [];
    const xhr = new FakeXhr();
    const answer = watch(createRedirectProbe({ memory, createXhr: () => xhr })(URL1, 's1', false));
    // readyState 1 came with open(): still waiting.
    await settle();
    expect(answer.value).toBeNull();
    xhr.headers(200, FINAL);
    // A late error from the aborted request would otherwise answer again.
    xhr.fail();
    xhr.timesOut();
    await settle();
    expect(answer.value).toBe(FINAL);
    expect(remembered).toEqual(['s1=redirects']);
    expect(xhr.onreadystatechange).toBeNull();
    expect(xhr.onerror).toBeNull();
    expect(xhr.ontimeout).toBeNull();
    expect(r.xhrs).toHaveLength(0);
  });
});
