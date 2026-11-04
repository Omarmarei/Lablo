/**
 * S7 from docs/architecture.md §5: can a packaged app make cross-origin `http://` calls with no
 * CORS headers, follow redirects, and see where a redirect ended (`responseURL`)? Users' playlist
 * and guide hosts send no CORS headers, so the app depends on it. If webOS refuses, the plan
 * builds a luna JS-service relay.
 *
 * The lab page itself is cross-origin to the lab server everywhere: `file://` on a TV, the Vite
 * port in `pnpm dev`. A desktop browser enforces CORS, so the no-CORS checks fail there; that is
 * the expected desktop result, and how the e2e test knows the checks can fail.
 */
import type { Check, CheckResult, LabContext, Spike } from '../types';

interface XhrResult {
  readonly status: number;
  readonly responseURL: string | null;
  readonly body: string;
}

function xhrGet(url: string, timeoutMs = 10_000): Promise<XhrResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs;
    const finish = (): void => {
      const withUrl = xhr as XMLHttpRequest & { responseURL?: string };
      resolve({ status: xhr.status, responseURL: typeof withUrl.responseURL === 'string' ? withUrl.responseURL : null, body: xhr.status === 0 ? '' : xhr.responseText });
    };
    xhr.onload = finish;
    xhr.onerror = finish;
    xhr.ontimeout = finish;
    xhr.send();
  });
}

/** The echo probe's answer, or null when the body isn't it. */
function echoBody(text: string): { readonly ok: boolean; readonly cors: boolean } | null {
  try {
    const parsed = JSON.parse(text) as { ok?: unknown; cors?: unknown };
    return parsed.ok === true && typeof parsed.cors === 'boolean' ? { ok: true, cors: parsed.cors } : null;
  } catch {
    return null;
  }
}

const refused = (status: number): string => (status === 0 ? 'no readable answer (refused, or the server is unreachable)' : `HTTP ${status}`);

function xhrCheck(id: string, title: string, path: string, finalPath: string | null): Check {
  return {
    id,
    title,
    run: async (context: LabContext): Promise<CheckResult> => {
      const result = await xhrGet(`${context.server}${path}`);
      const echo = result.status === 200 ? echoBody(result.body) : null;
      const value = { status: result.status, responseURL: result.responseURL };
      if (echo === null) return { status: 'fail', value, note: refused(result.status) };
      if (finalPath !== null) {
        const expected = `${context.server}${finalPath}`;
        if (result.responseURL === null) return { status: 'fail', value, note: 'the redirect was followed, but the engine has no responseURL' };
        if (result.responseURL !== expected) return { status: 'fail', value, note: `responseURL is ${result.responseURL}, expected ${expected}` };
      }
      return { status: 'pass', value, note: finalPath === null ? 'read' : `followed to ${finalPath}` };
    },
  };
}

function fetchCheck(id: string, title: string, path: string, finalPath: string | null): Check {
  return {
    id,
    title,
    run: async (context: LabContext): Promise<CheckResult> => {
      let response: Response;
      try {
        response = await fetch(`${context.server}${path}`);
      } catch (error) {
        return { status: 'fail', note: `fetch rejected: ${error instanceof Error ? error.message : String(error)}` };
      }
      const value = { status: response.status, url: response.url, redirected: response.redirected };
      const echo = response.status === 200 ? echoBody(await response.text()) : null;
      if (echo === null) return { status: 'fail', value, note: refused(response.status) };
      // Response.redirected is Chromium 57+: the final URL is what the app needs, the flag is reported.
      if (finalPath !== null && response.url !== `${context.server}${finalPath}`) {
        return { status: 'fail', value, note: `url ${response.url}, expected ${context.server}${finalPath}` };
      }
      const flag = finalPath !== null && typeof response.redirected !== 'boolean' ? ' (this engine has no Response.redirected)' : '';
      return { status: 'pass', value, note: finalPath === null ? 'read' : `followed to ${finalPath}${flag}` };
    },
  };
}

export const S7: Spike = {
  id: 'S7',
  title: 'Cross-origin',
  question: 'Can the app make cross-origin http:// calls with no CORS headers, follow redirects and read responseURL?',
  checks: [
    xhrCheck('xhr-cors', 'XHR to a server sending CORS headers (baseline)', '/__lab/echo', null),
    xhrCheck('xhr-no-cors', 'XHR to a server sending no CORS headers', '/__lab/echo?cors=0', null),
    fetchCheck('fetch-no-cors', 'fetch from a server sending no CORS headers', '/__lab/echo?cors=0', null),
    xhrCheck('xhr-redirect', 'XHR follows a 302 and reports responseURL', '/__lab/redirect?to=/__lab/echo', '/__lab/echo'),
    fetchCheck('fetch-redirect', 'fetch follows a 302 (response.url)', '/__lab/redirect?to=/__lab/echo', '/__lab/echo'),
    xhrCheck('xhr-redirect-no-cors', 'XHR follows a 302 with no CORS headers anywhere', '/__lab/redirect?cors=0&to=/__lab/echo?cors=0', '/__lab/echo?cors=0'),
  ],
};
