/** GET and parse JSON from the lab server with XHR (no `fetch` cancellation on Chromium 53). */
export function xhrJson(url: string, timeoutMs = 2 * 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status !== 200) {
        reject(new Error(`HTTP ${xhr.status}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error('the answer is not JSON'));
      }
    };
    xhr.onerror = () => reject(new Error('no answer'));
    xhr.ontimeout = () => reject(new Error(`no answer within ${timeoutMs} ms`));
    xhr.send();
  });
}

/** What the redirect probe found: where the URL ends up, without the body. */
export interface RedirectProbe {
  /** `responseURL` once the headers came (the URL itself when the engine gives none). */
  readonly finalUrl: string;
  readonly redirected: boolean;
  /** The final answer's HTTP status. */
  readonly status: number;
  /** From the request to the headers. */
  readonly ms: number;
}

/** The slice of `XMLHttpRequest` the probe uses (tests pass a fake). */
export type ProbeXhr = Pick<XMLHttpRequest, 'open' | 'send' | 'abort' | 'readyState' | 'status' | 'responseURL' | 'timeout'> & {
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
};

/** `XMLHttpRequest.HEADERS_RECEIVED`. */
const HEADERS_RECEIVED = 2;

/**
 * The redirect probe (docs/architecture.md §2 "Redirect handling", spike S4): an XHR GET that
 * follows the redirects and is aborted as soon as the final answer's headers come
 * (`readyState` 2), so no body is downloaded and the connection is closed again; `responseURL`
 * is where the stream really is. AVPlay may freeze on a 302 and is given that URL instead.
 */
export function probeRedirect(
  url: string,
  { timeoutMs = 8000, now = () => performance.now(), createXhr = () => new XMLHttpRequest() as ProbeXhr }: { timeoutMs?: number; now?: () => number; createXhr?: () => ProbeXhr } = {},
): Promise<RedirectProbe> {
  return new Promise((resolve, reject) => {
    const xhr = createXhr();
    const started = now();
    let done = false;
    const end = (): void => {
      done = true;
      xhr.onreadystatechange = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
    };
    xhr.onreadystatechange = () => {
      if (done || xhr.readyState < HEADERS_RECEIVED) return;
      const finalUrl = xhr.responseURL === '' ? url : xhr.responseURL;
      const result: RedirectProbe = { finalUrl, redirected: finalUrl !== url, status: xhr.status, ms: Math.round(now() - started) };
      end();
      xhr.abort();
      resolve(result);
    };
    xhr.onerror = () => {
      if (done) return;
      end();
      reject(new Error('no answer'));
    };
    xhr.ontimeout = () => {
      if (done) return;
      end();
      reject(new Error(`no headers within ${timeoutMs} ms`));
    };
    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs;
    xhr.send();
  });
}
