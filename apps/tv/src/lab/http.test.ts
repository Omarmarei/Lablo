import { describe, expect, it } from 'vitest';
import type { ProbeXhr } from './http';
import { probeRedirect } from './http';

/** An XHR the test moves through its states by hand. */
class FakeXhr {
  readyState = 0;
  status = 0;
  responseURL = '';
  timeout = 0;
  opened: Array<[string, string, boolean]> = [];
  sent = 0;
  aborted = 0;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(method: string, url: string, async: boolean): void {
    this.opened.push([method, url, async]);
    this.readyState = 1;
  }
  send(): void {
    this.sent += 1;
  }
  abort(): void {
    this.aborted += 1;
    // A real abort runs the handlers once more (readyState 4, then 0).
    this.readyState = 4;
    this.onreadystatechange?.();
    this.readyState = 0;
  }
  state(n: number, status = 0, responseURL = ''): void {
    this.readyState = n;
    this.status = status;
    this.responseURL = responseURL;
    this.onreadystatechange?.();
  }
}

const URL_ = 'http://lab:8080/live/lablo/lablo-test/104.ts?mock_fault=redirect:hops=3';
const FINAL = 'http://lab:8080/live/lablo/lablo-test/104.ts';

function probe(timeoutMs?: number) {
  const xhr = new FakeXhr();
  let t = 100;
  const promise = probeRedirect(URL_, { timeoutMs, now: () => t, createXhr: () => xhr as unknown as ProbeXhr });
  return { xhr, promise, at: (ms: number) => (t = ms) };
}

describe('the redirect probe (RELAY step 15c2, S4)', () => {
  it('reads responseURL when the headers come, then aborts: no body, no connection left', async () => {
    const p = probe();
    expect(p.xhr.opened).toEqual([['GET', URL_, true]]);
    expect(p.xhr.sent).toBe(1);
    expect(p.xhr.timeout).toBe(8000);
    // The request is out, nothing back yet.
    p.xhr.state(1);
    p.at(135);
    p.xhr.state(2, 200, FINAL);
    expect(await p.promise).toEqual({ finalUrl: FINAL, redirected: true, status: 200, ms: 35 });
    expect(p.xhr.aborted).toBe(1);
    // Its handlers are gone: the abort's own state changes reach nothing.
    expect(p.xhr.onreadystatechange).toBeNull();
    expect(p.xhr.onerror).toBeNull();
    expect(p.xhr.ontimeout).toBeNull();
  });

  it('answers at a later state too, and calls the same URL no redirect', async () => {
    const p = probe();
    p.xhr.state(3, 200, URL_);
    expect(await p.promise).toEqual({ finalUrl: URL_, redirected: false, status: 200, ms: 0 });
    // An engine without responseURL: the URL itself.
    const bare = probe();
    bare.xhr.state(2, 200, '');
    expect(await bare.promise).toMatchObject({ finalUrl: URL_, redirected: false });
  });

  it('rejects when nothing answers, or the headers take too long', async () => {
    const down = probe();
    down.xhr.onerror?.();
    await expect(down.promise).rejects.toThrow('no answer');
    expect(down.xhr.aborted).toBe(0);
    const slow = probe(500);
    expect(slow.xhr.timeout).toBe(500);
    slow.xhr.ontimeout?.();
    await expect(slow.promise).rejects.toThrow('no headers within 500 ms');
  });

  it('settles once', async () => {
    const p = probe();
    const { onerror, ontimeout } = p.xhr;
    p.xhr.state(2, 302, FINAL);
    // Late handlers kept by someone else change nothing.
    onerror?.();
    ontimeout?.();
    expect(await p.promise).toMatchObject({ status: 302, redirected: true });
    const failed = probe();
    const change = failed.xhr.onreadystatechange;
    failed.xhr.onerror?.();
    failed.xhr.readyState = 2;
    change?.();
    await expect(failed.promise).rejects.toThrow('no answer');
    expect(failed.xhr.aborted).toBe(0);
  });
});
