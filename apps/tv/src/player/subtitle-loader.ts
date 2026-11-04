import type { SubtitleCue } from '@zoma/core';
import { normalizeLang, parseSubtitles } from '@zoma/core';
import type { ExternalSub } from '@zoma/player';

/**
 * The app's side of subtitle files (RELAY step 20b2b, `ControllerOptions.loadSubtitles`): a
 * file beside the stream is fetched, its bytes decoded and its cues parsed (`parseSubtitles`).
 *
 * - **The fetch:** an XHR GET for an `ArrayBuffer`, refused past `MAX_SUBTITLE_BYTES` (the
 *   length header when it says so, else as the bytes arrive) or after `SUBTITLE_TIMEOUT_MS`.
 *   XHR rather than `fetch`: its progress events count the bytes without typed arrays, and a
 *   `Uint8Array` would pull 35 core-js modules (about 14 KB) into the TV bundle.
 * - **The charset:** UTF-16 with its byte-order mark; else UTF-8 when the bytes are valid
 *   UTF-8; else the Windows code page of the file's language: Windows-1256 for Arabic, Persian,
 *   Urdu or a file whose language isn't known (the GCC's files), Windows-1252 for the rest.
 *   Chromium has `TextDecoder` and these labels since 38.
 */

/** A bigger subtitle file isn't loaded (a feature film's SRT is 50–150 KB). */
export const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
export const SUBTITLE_TIMEOUT_MS = 20_000;

/** Languages whose old files are in Windows-1256 ('' is a file that doesn't say). */
const ARABIC_SCRIPT: readonly string[] = ['', 'ar', 'fa', 'ur'];

/** The text of a subtitle file's bytes, in the charset worked out as above. */
export function decodeSubtitleBytes(bytes: ArrayBuffer, lang: string): string {
  // DataView, not Uint8Array: no polyfill (see above).
  const view = new DataView(bytes);
  const first = bytes.byteLength > 1 ? view.getUint16(0) : 0;
  // The decoders drop the mark itself.
  if (first === 0xfffe) return new TextDecoder('utf-16le').decode(bytes);
  if (first === 0xfeff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8: an old file in its language's code page.
  }
  return new TextDecoder(ARABIC_SCRIPT.indexOf(normalizeLang(lang)) === -1 ? 'windows-1252' : 'windows-1256').decode(bytes);
}

/** The parts of `XMLHttpRequest` the fetch uses (tests pass a fake). */
export interface XhrLike {
  readyState: number;
  status: number;
  response: unknown;
  responseType: XMLHttpRequestResponseType;
  timeout: number;
  onreadystatechange: (() => void) | null;
  onprogress: ((event: { readonly loaded: number }) => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  send(): void;
  abort(): void;
  getResponseHeader(name: string): string | null;
}

export interface FetchLimits {
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

const HEADERS_RECEIVED = 2;

/**
 * GETs `url` as bytes. Rejects on an HTTP error, a network error, the timeout, or more than
 * `maxBytes` (the request is aborted at once). The URL may hold credentials: never in the error.
 */
export function fetchBytes(url: string, limits: FetchLimits, createXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = createXhr();
    let settled = false;
    const fail = (why: string): void => {
      if (settled) return;
      settled = true;
      xhr.abort();
      reject(new Error(`The subtitle file was not loaded: ${why}`));
    };
    const tooBig = (bytes: number): boolean => {
      if (bytes <= limits.maxBytes) return false;
      fail('too big');
      return true;
    };
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = limits.timeoutMs;
    xhr.onreadystatechange = () => {
      if (xhr.readyState === HEADERS_RECEIVED) tooBig(Number(xhr.getResponseHeader('content-length')));
    };
    xhr.onprogress = (event) => {
      tooBig(event.loaded);
    };
    xhr.onload = () => {
      // With responseType 'arraybuffer': an ArrayBuffer, or null. (No `instanceof ArrayBuffer`: the global's name pulls polyfills.)
      const body = xhr.response as ArrayBuffer | null;
      if (xhr.status < 200 || xhr.status > 299 || body === null) {
        fail(`HTTP ${String(xhr.status)}`);
        return;
      }
      if (tooBig(body.byteLength)) return;
      settled = true;
      resolve(body);
    };
    xhr.onerror = () => fail('network error');
    xhr.ontimeout = () => fail('timeout');
    xhr.send();
  });
}

/** `ControllerOptions.loadSubtitles`: fetch, decode, parse. */
export function createSubtitleLoader(fetcher: (url: string, limits: FetchLimits) => Promise<ArrayBuffer> = fetchBytes): (sub: ExternalSub) => Promise<readonly SubtitleCue[]> {
  return (sub) =>
    fetcher(sub.url, { maxBytes: MAX_SUBTITLE_BYTES, timeoutMs: SUBTITLE_TIMEOUT_MS }).then((bytes) => parseSubtitles(decodeSubtitleBytes(bytes, sub.lang), { format: sub.fmt }).cues);
}
