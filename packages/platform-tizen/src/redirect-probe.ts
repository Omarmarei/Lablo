/**
 * The redirect probe (architecture.md §2 "Redirect handling (Tizen)", RELAY step 19): AVPlay can
 * freeze on an HTTP 302, so before AVPlay opens a URL the probe finds where it really is. The
 * controller calls it before every load (`ControllerOptions.resolveUrl`).
 *
 * - **The probe:** an XHR GET that follows the redirects and is aborted as soon as the final
 *   answer's headers come (`readyState` 2), so no body is downloaded and the connection closes
 *   again; `responseURL` is the final URL (the lab's S4 `redirect-probe` row, step 15c2).
 * - **Per source** (`RedirectMemory`): `unknown` until a probe answered; `redirects` probes
 *   before every play (a redirect target often carries a short-lived token) and gives AVPlay
 *   the final URL; `none` skips the probe from then on, unless the controller asks for a fresh
 *   one (`fresh`: the ladder's re-probe rung, after AVPlay didn't prepare in time).
 * - **An error status** (4xx, 5xx) on the probe rejects as `http` with the status, which tells
 *   the error card more than AVPlay's "connection failed".
 * - **No answer** (a network error, the timeout, status 0) gives the URL as it is: AVPlay tries
 *   it and fails on its own if the provider is down, and a probe that can't run on some TV
 *   never stops playback.
 *
 * Every probe opens a provider connection for a moment; with `none` remembered, later plays
 * don't. On a one-connection account the probe's connection may not have closed on the panel's
 * side before AVPlay opens: the on-TV check (step 21) says whether that happens.
 */

import type { RedirectMemory, RedirectMode } from '@zoma/platform-api';
import type { PlaybackError } from '@zoma/player';

export type { RedirectMemory, RedirectMode };

/** What the probe learned per source, for the app's run (the app hands the platform the profile's, step 20c1). */
export class MemoryRedirectMemory implements RedirectMemory {
  private readonly modes = new Map<string, 'none' | 'redirects'>();

  mode(src: string): RedirectMode {
    return this.modes.get(src) ?? 'unknown';
  }

  remember(src: string, mode: 'none' | 'redirects'): void {
    this.modes.set(src, mode);
  }
}

/** The slice of `XMLHttpRequest` the probe uses (tests pass a fake). */
export interface ProbeXhr {
  readonly readyState: number;
  readonly status: number;
  readonly responseURL: string;
  timeout: number;
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  send(): void;
  abort(): void;
}

/** `XMLHttpRequest.HEADERS_RECEIVED`. */
const HEADERS_RECEIVED = 2;

/** Headers usually come in well under a second; a three-302 chain took up to 4.1 s to play on the LG TV (S5). */
export const PROBE_TIMEOUT_MS = 5000;

export interface RedirectProbeOptions {
  readonly memory?: RedirectMemory;
  readonly timeoutMs?: number;
  readonly createXhr?: () => ProbeXhr;
}

/** Where the URL ends up and the final answer's status, or null without an answer. */
interface ProbeAnswer {
  readonly finalUrl: string;
  readonly status: number;
}

function probe(url: string, xhr: ProbeXhr, timeoutMs: number): Promise<ProbeAnswer | null> {
  return new Promise((resolve) => {
    // Answers once: the handlers go, so the abort and anything after it find none.
    const end = (answer: ProbeAnswer | null): void => {
      xhr.onreadystatechange = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
      resolve(answer);
    };
    xhr.onreadystatechange = () => {
      if (xhr.readyState < HEADERS_RECEIVED) return;
      const status = xhr.status;
      end(status === 0 ? null : { finalUrl: xhr.responseURL === '' ? url : xhr.responseURL, status });
      // After `end`: the abort's own state change (4, status 0) finds no handler.
      xhr.abort();
    };
    xhr.onerror = () => end(null);
    xhr.ontimeout = () => end(null);
    try {
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs;
      xhr.send();
    } catch {
      end(null);
    }
  });
}

/**
 * The redirect probe as the controller's `resolveUrl(url, src, fresh)`: the URL to give AVPlay.
 * Rejects with an `http` `PlaybackError` when the final answer is an error status.
 */
export function createRedirectProbe(options: RedirectProbeOptions = {}): (url: string, src: string, fresh: boolean) => Promise<string> {
  const memory = options.memory ?? new MemoryRedirectMemory();
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const createXhr = options.createXhr ?? ((): ProbeXhr => new XMLHttpRequest() as unknown as ProbeXhr);
  return (url, src, fresh) => {
    if (!fresh && memory.mode(src) === 'none') return Promise.resolve(url);
    return probe(url, createXhr(), timeoutMs).then((answer) => {
      if (answer === null) return url;
      if (answer.status >= 400) {
        const error: PlaybackError = { kind: 'http', code: 'PROBE_HTTP', status: answer.status };
        return Promise.reject<string>(error);
      }
      memory.remember(src, answer.finalUrl === url ? 'none' : 'redirects');
      return answer.finalUrl;
    });
  };
}
